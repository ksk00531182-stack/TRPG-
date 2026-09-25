const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Server } = require('socket.io');

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const rooms = new Map();
const roomStorePath = process.env.TRPG_ROOM_STORE || path.join(root, 'rooms.json');
const contentTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
const maxAssetSize = 25 * 1024 * 1024;
const assetCategories = new Set(['characters', 'materials', 'icons', 'backgrounds', 'bgm']);
const allowedAssetTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/ogg', 'audio/wav']);
const r2Configured = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].every((key) => process.env[key]);
const r2 = r2Configured ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;
const sessions = new Map();
const trpgSystems = Object.freeze({
  coc: Object.freeze({ id: 'coc', name: 'クトゥルフ神話TRPG' }),
  emoklore: Object.freeze({ id: 'emoklore', name: 'エモクロアTRPG' })
});

function normalizeRoomId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null; }
function cleanText(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function createRoomId() {
  let id;
  do {
    id = crypto.randomBytes(9).toString('base64url');
  } while (rooms.has(id));
  return id;
}
function getRoom(id, systemId = 'coc', title = '') {
  if (!rooms.has(id)) {
    const now = new Date().toISOString();
    rooms.set(id, { messages: [], members: new Map(), assets: new Map(), inviteToken: null, gmToken: null, systemId, title, createdAt: now, updatedAt: now });
  }
  return rooms.get(id);
}
function persistRooms() {
  const savedRooms = [...rooms.entries()].map(([id, room]) => ({ id, messages: room.messages, assets: [...room.assets.entries()], inviteToken: room.inviteToken, gmToken: room.gmToken, systemId: room.systemId, title: room.title, createdAt: room.createdAt, updatedAt: room.updatedAt }));
  try { fs.writeFileSync(roomStorePath, JSON.stringify(savedRooms)); } catch (error) { console.error('Could not persist TRPG rooms:', error.message); }
}
function loadPersistedRooms() {
  try {
    const savedRooms = JSON.parse(fs.readFileSync(roomStorePath, 'utf8'));
    let migrated = false;
    for (const savedRoom of savedRooms) {
      if (!normalizeRoomId(savedRoom.id) || !trpgSystems[savedRoom.systemId] || typeof savedRoom.inviteToken !== 'string') continue;
      const gmToken = savedRoom.gmToken || crypto.randomBytes(32).toString('hex');
      migrated ||= !savedRoom.gmToken;
      rooms.set(savedRoom.id, { messages: Array.isArray(savedRoom.messages) ? savedRoom.messages : [], members: new Map(), assets: new Map(savedRoom.assets || []), inviteToken: savedRoom.inviteToken, gmToken, systemId: savedRoom.systemId, title: cleanText(savedRoom.title, 80), createdAt: savedRoom.createdAt, updatedAt: savedRoom.updatedAt });
    }
    if (migrated) persistRooms();
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load TRPG rooms:', error.message);
  }
}
function touchRoom(room) { room.updatedAt = new Date().toISOString(); persistRooms(); }

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) reject(new Error('payload-too-large')); });
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('invalid-json')); } });
    request.on('error', reject);
  });
}

function getSession(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return token ? sessions.get(token) : null;
}

function safeFileName(value) {
  return cleanText(value, 100).replace(/[^A-Za-z0-9._-]/g, '_') || 'asset';
}

async function handleAssetApi(request, response, requestPath) {
  if (!requestPath.startsWith('/api/assets')) return false;
  if (!r2) { sendJson(response, 503, { error: 'R2 is not configured on this server.' }); return true; }
  const session = getSession(request);
  if (!session) { sendJson(response, 401, { error: 'Room session is required.' }); return true; }
  const room = getRoom(session.roomId);

  if (request.method === 'GET' && requestPath === '/api/assets') {
    const result = await r2.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix: `rooms/${session.roomId}/` }));
    const assets = await Promise.all((result.Contents || []).map(async (object) => {
      const asset = room.assets.get(object.Key) || { key: object.Key, name: path.basename(object.Key), category: object.Key.split('/')[2] || 'materials', size: object.Size, type: '' };
      return { ...asset, size: object.Size, updatedAt: object.LastModified, url: await getSignedUrl(r2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: object.Key }), { expiresIn: 3600 }) };
    }));
    sendJson(response, 200, { assets });
    return true;
  }

  if (request.method === 'POST' && requestPath === '/api/assets/upload-url') {
    if (session.role !== 'gm') { sendJson(response, 403, { error: 'GM only.' }); return true; }
    const payload = await readJson(request);
    const category = cleanText(payload.category, 30);
    const name = safeFileName(payload.name);
    const type = cleanText(payload.type, 100);
    const size = Number(payload.size);
    if (!assetCategories.has(category) || !allowedAssetTypes.has(type) || !Number.isInteger(size) || size < 1 || size > maxAssetSize) {
      sendJson(response, 400, { error: 'Unsupported category, file type, or size.' });
      return true;
    }
    const key = `rooms/${session.roomId}/${category}/${crypto.randomUUID()}-${name}`;
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: type }), { expiresIn: 600 });
    room.assets.set(key, { key, name, category, type, size });
    touchRoom(room);
    sendJson(response, 200, { asset: { key, name, category, type, size }, uploadUrl });
    return true;
  }

  if (request.method === 'DELETE' && requestPath === '/api/assets') {
    if (session.role !== 'gm') { sendJson(response, 403, { error: 'GM only.' }); return true; }
    const payload = await readJson(request);
    const key = typeof payload.key === 'string' && payload.key.startsWith(`rooms/${session.roomId}/`) ? payload.key : null;
    if (!key) { sendJson(response, 400, { error: 'Invalid asset key.' }); return true; }
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    room.assets.delete(key);
    touchRoom(room);
    io.to(`room:${session.roomId}`).emit('asset-deleted', { key });
    sendJson(response, 200, { ok: true });
    return true;
  }
  return false;
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  handleAssetApi(request, response, requestPath).then((handled) => {
    if (handled) return;
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
    const filePath = path.resolve(root, relativePath);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) { response.writeHead(404); response.end('Not Found'); return; }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); response.end('Not Found'); return; }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  }).catch((error) => { console.error(error); sendJson(response, 500, { error: 'Asset operation failed.' }); });
});

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
loadPersistedRooms();
function broadcastMembers(id) { io.to(`room:${id}`).emit('members', [...getRoom(id).members.values()]); }

function joinRoom(socket, id, member, acknowledge, inviteToken) {
  const room = getRoom(id);
  if (inviteToken !== room.inviteToken) { acknowledge?.({ ok: false, error: '有効なルーム招待URLが必要です。' }); return; }
  socket.join(`room:${id}`);
  socket.data.roomId = id;
  socket.data.member = member;
  room.members.set(socket.id, member);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { roomId: id, role: member.role, socketId: socket.id });
  socket.data.sessionToken = token;
  socket.emit('history', room.messages);
  broadcastMembers(id);
  const system = trpgSystems[room.systemId];
  const management = member.role === 'gm' ? { gmToken: room.gmToken } : {};
  acknowledge?.({ ok: true, roomId: id, roomTitle: room.title, systemId: system.id, systemName: system.name, createdAt: room.createdAt, updatedAt: room.updatedAt, ...management, sessionToken: token, r2Configured });
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ systemId, roomTitle, name } = {}, acknowledge) => {
    const system = trpgSystems[systemId];
    const title = cleanText(roomTitle, 80);
    const member = { id: socket.id, name: cleanText(name, 40), role: 'gm' };
    if (!system || !title || !member.name) { acknowledge?.({ ok: false, error: 'システム、ルームタイトル、GM名を入力してください。' }); return; }
    const id = createRoomId();
    const room = getRoom(id, system.id, title);
    room.inviteToken = crypto.randomBytes(32).toString('hex');
    room.gmToken = crypto.randomBytes(32).toString('hex');
    persistRooms();
    joinRoom(socket, id, member, (result) => acknowledge?.({ ...result, inviteToken: room.inviteToken }), room.inviteToken);
  });

  socket.on('resume-room', ({ roomId, gmToken, name } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const room = id && rooms.get(id);
    const member = { id: socket.id, name: cleanText(name, 40), role: 'gm' };
    if (!room || room.gmToken !== gmToken || !member.name) { acknowledge?.({ ok: false, error: 'ルーム情報が無効か、GM名がありません。' }); return; }
    joinRoom(socket, id, member, acknowledge, room.inviteToken);
  });

  socket.on('duplicate-room', ({ roomId, gmToken } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const sourceRoom = id && rooms.get(id);
    if (!sourceRoom || sourceRoom.gmToken !== gmToken) { acknowledge?.({ ok: false, error: 'ルーム情報が無効です。' }); return; }
    const duplicateId = createRoomId();
    const duplicateRoom = getRoom(duplicateId, sourceRoom.systemId, `${sourceRoom.title}（複製）`.slice(0, 80));
    duplicateRoom.inviteToken = crypto.randomBytes(32).toString('hex');
    duplicateRoom.gmToken = crypto.randomBytes(32).toString('hex');
    persistRooms();
    const system = trpgSystems[duplicateRoom.systemId];
    acknowledge?.({ ok: true, roomId: duplicateId, roomTitle: duplicateRoom.title, systemId: system.id, systemName: system.name, inviteToken: duplicateRoom.inviteToken, gmToken: duplicateRoom.gmToken, createdAt: duplicateRoom.createdAt, updatedAt: duplicateRoom.updatedAt });
  });

  socket.on('delete-room', ({ roomId, gmToken } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const room = id && rooms.get(id);
    if (!room || room.gmToken !== gmToken) { acknowledge?.({ ok: false, error: 'ルーム情報が無効です。' }); return; }
    rooms.delete(id);
    for (const [token, session] of sessions) if (session.roomId === id) sessions.delete(token);
    io.to(`room:${id}`).emit('room-deleted');
    persistRooms();
    acknowledge?.({ ok: true });
  });

  socket.on('join-room', ({ roomId, inviteToken, name } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const member = { id: socket.id, name: cleanText(name, 40), role: 'pc' };
    if (!id || !member.name || typeof inviteToken !== 'string') { acknowledge?.({ ok: false, error: '有効な招待URLと表示名が必要です。' }); return; }
    if (!rooms.has(id)) { acknowledge?.({ ok: false, error: 'ルームが存在しないか、GMがまだ作成していません。' }); return; }
    joinRoom(socket, id, member, acknowledge, inviteToken);
  });

  socket.on('send-message', (value) => {
    const id = socket.data.roomId;
    const text = cleanText(value, 2000);
    if (!id || !text || !socket.data.member) return;
    const message = { id: `${Date.now()}-${socket.id}`, text, name: socket.data.member.name, role: socket.data.member.role, time: new Date().toISOString() };
    const room = getRoom(id);
    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();
    touchRoom(room);
    io.to(`room:${id}`).emit('message', message);
  });

  socket.on('typing', (isTyping) => {
    const id = socket.data.roomId;
    if (id && socket.data.member) socket.to(`room:${id}`).emit('typing', { name: socket.data.member.name, isTyping: Boolean(isTyping) });
  });

  socket.on('asset-added', (asset) => {
    const id = socket.data.roomId;
    if (id && socket.data.member?.role === 'gm' && asset?.key?.startsWith(`rooms/${id}/`)) io.to(`room:${id}`).emit('asset-added', asset);
  });

  socket.on('disconnect', () => {
    const id = socket.data.roomId;
    if (!id) return;
    const room = rooms.get(id);
    if (socket.data.sessionToken) sessions.delete(socket.data.sessionToken);
    room?.members.delete(socket.id);
    if (room) broadcastMembers(id);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`TRPG communication room listening on port ${port}`));