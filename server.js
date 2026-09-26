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
const sessions = new Map();
const roomStorePath = process.env.TRPG_ROOM_STORE || path.join(root, 'rooms.json');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

const maxAssetSize = 25 * 1024 * 1024;
const assetCategories = new Set(['characters', 'materials', 'icons', 'backgrounds', 'bgm']);
const allowedAssetTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/ogg', 'audio/wav']);

const r2Configured = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].every((key) => Boolean(process.env[key]));
const r2 = r2Configured ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;

const trpgSystems = Object.freeze({
  coc: Object.freeze({ id: 'coc', name: 'クトゥルフ神話TRPG' }),
  emoklore: Object.freeze({ id: 'emoklore', name: 'エモクロアTRPG' })
});

function normalizeRoomId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null; }
function cleanText(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function normalizePlayerId(value) { return typeof value === 'string' && /^[^\s]{1,40}$/.test(value.trim()) ? value.trim() : null; }
function parseDiceNotation(value) {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '') : '';
  const match = normalized.match(/^(\d+)[dD](\d+)(?:([+-])(\d+))?$/);
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? (match[3] === '+' ? Number(match[4]) : -Number(match[4])) : 0;
  if (!Number.isInteger(count) || count < 1 || count > 20 || !Number.isInteger(sides) || sides < 2 || sides > 1000 || Math.abs(modifier) > 100000) return null;
  return { count, sides, modifier, expression: normalized };
}

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
    rooms.set(id, { messages: [], members: new Map(), players: new Map(), npcs: new Map(), assets: new Map(), boardAssets: [], inviteToken: null, gmToken: null, systemId, title, createdAt: now, updatedAt: now });
  }
  return rooms.get(id);
}

function persistRooms() {
  const savedRooms = [...rooms.entries()].map(([id, room]) => ({
    id,
    messages: room.messages,
    players: [...room.players.entries()],
    npcs: [...room.npcs.entries()],
    assets: [...room.assets.entries()],
    boardAssets: room.boardAssets,
    inviteToken: room.inviteToken,
    gmToken: room.gmToken,
    systemId: room.systemId,
    title: room.title,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  }));
  try { fs.writeFileSync(roomStorePath, JSON.stringify(savedRooms)); } catch (error) { console.error('Could not persist TRPG rooms:', error.message); }
}

function loadPersistedRooms() {
  try {
    if (!fs.existsSync(roomStorePath)) return;
    const savedRooms = JSON.parse(fs.readFileSync(roomStorePath, 'utf8'));
    let migrated = false;
    for (const savedRoom of savedRooms) {
      if (!normalizeRoomId(savedRoom.id) || !trpgSystems[savedRoom.systemId] || typeof savedRoom.inviteToken !== 'string') continue;
      const gmToken = savedRoom.gmToken || crypto.randomBytes(32).toString('hex');
      migrated ||= !savedRoom.gmToken;
      rooms.set(savedRoom.id, {
        messages: Array.isArray(savedRoom.messages) ? savedRoom.messages : [],
        members: new Map(),
        players: new Map(savedRoom.players || []),
        npcs: new Map(savedRoom.npcs || []),
        assets: new Map(savedRoom.assets || []),
        boardAssets: Array.isArray(savedRoom.boardAssets) ? savedRoom.boardAssets.map((asset) => ({ ...asset, width: Number(asset.width) || 0.16, height: Number(asset.height) || 0.19, locked: Boolean(asset.locked), visible: asset.visible !== false })) : [],
        inviteToken: savedRoom.inviteToken,
        gmToken,
        systemId: savedRoom.systemId,
        title: cleanText(savedRoom.title, 80),
        createdAt: savedRoom.createdAt,
        updatedAt: savedRoom.updatedAt
      });
    }
    if (migrated) persistRooms();
  } catch (error) {
    console.error('Could not load TRPG rooms:', error.message);
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
      let url = '';
      try {
        url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: object.Key }), { expiresIn: 3600 });
      } catch (err) {
        console.error('Failed to generate presigned URL:', err);
      }
      return { ...asset, size: object.Size, updatedAt: object.LastModified, url };
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
    if (!filePath.startsWith(root)) { response.writeHead(404); response.end('Not Found'); return; }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); response.end('Not Found'); return; }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  }).catch((error) => { console.error('API Error:', error); sendJson(response, 500, { error: 'Asset operation failed.' }); });
});

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
loadPersistedRooms();

function broadcastMembers(id) {
  const room = getRoom(id);
  io.to(`room:${id}`).emit('members', [...room.members.values(), ...room.npcs.values()]);
}
function canSeeMessage(message, member) {
  if (message.scope !== 'private') return true;
  if (member.role === 'gm') return true;
  return message.senderPlayerId === member.playerId
    || message.targetPlayerId === member.playerId
    || message.senderId === member.id
    || message.targetId === member.id;
}
function formatMessageForMember(message, member) {
  if (!message.secret || member.role === 'gm') return message;
  const { rollResults, rollTotal, ...visibleMessage } = message;
  return { ...visibleMessage, text: `${message.name}がシークレットダイスを振りました：？` };
}

function clearSocketRoom(socket) {
  const previousRoomId = socket.data.roomId;
  if (socket.data.sessionToken) {
    sessions.delete(socket.data.sessionToken);
  }
  
  for (const [token, session] of sessions.entries()) {
    if (session.socketId === socket.id) {
      sessions.delete(token);
    }
  }

  if (previousRoomId) {
    const previousRoom = rooms.get(previousRoomId);
    if (previousRoom) {
      previousRoom.members.delete(socket.id);
      broadcastMembers(previousRoomId);
    }
  }
  socket.data.roomId = null;
  socket.data.member = null;
  socket.data.sessionToken = null;
}

function joinRoom(socket, id, member, acknowledge, inviteToken) {
  const room = getRoom(id);
  if (inviteToken !== room.inviteToken) { acknowledge?.({ ok: false, error: '有効なルーム招待URLが必要です。' }); return; }
  clearSocketRoom(socket);
  socket.join(`room:${id}`);
  socket.data.roomId = id;
  socket.data.member = member;
  room.members.set(socket.id, member);
  if (member.role === 'pc') {
    room.players.set(member.playerId, { playerId: member.playerId, name: member.name });
    persistRooms();
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { roomId: id, role: member.role, socketId: socket.id });
  socket.data.sessionToken = token;
  socket.emit('history', room.messages.filter((message) => canSeeMessage(message, member)).map((message) => formatMessageForMember(message, member)));
  broadcastMembers(id);
  const system = trpgSystems[room.systemId];
  const management = member.role === 'gm' ? { gmToken: room.gmToken, inviteToken: room.inviteToken } : {};
  acknowledge?.({ ok: true, roomId: id, roomTitle: room.title, systemId: system.id, systemName: system.name, playerId: member.playerId || '', boardAssets: room.boardAssets, createdAt: room.createdAt, updatedAt: room.updatedAt, ...management, sessionToken: token, r2Configured });
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

  socket.on('resume-room', ({ roomId, gmToken, inviteToken, name } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const room = id && rooms.get(id);
    const member = { id: socket.id, name: cleanText(name, 40), role: 'gm' };
    const hasValidManagementToken = room && (room.gmToken === gmToken || room.inviteToken === inviteToken);
    if (!hasValidManagementToken || !member.name) { acknowledge?.({ ok: false, error: 'ルーム情報が無効か、GM名がありません。' }); return; }
    joinRoom(socket, id, member, acknowledge, room.inviteToken);
  });

  socket.on('add-npc', ({ name } = {}, acknowledge) => {
    const id = socket.data.roomId;
    const room = id && rooms.get(id);
    const npcName = cleanText(name, 40);
    if (!room || socket.data.member?.role !== 'gm' || !npcName) { acknowledge?.({ ok: false, error: 'GMのみNPCを追加できます。' }); return; }
    if ([...room.npcs.values()].some((npc) => npc.name === npcName)) { acknowledge?.({ ok: false, error: '同じ名前のNPCがすでに存在します。' }); return; }
    const npc = { id: `npc-${crypto.randomUUID()}`, name: npcName, role: 'npc' };
    room.npcs.set(npc.id, npc);
    touchRoom(room);
    broadcastMembers(id);
    acknowledge?.({ ok: true, npc });
  });

  socket.on('place-board-asset', ({ key } = {}, acknowledge) => {
    const id = socket.data.roomId;
    const room = id && rooms.get(id);
    const assetKey = typeof key === 'string' && key.startsWith(`rooms/${id}/`) ? key : '';
    const asset = assetKey && room?.assets.get(assetKey);
    if (!room || !socket.data.member || !asset || !asset.type?.startsWith('image/')) {
      acknowledge?.({ ok: false, error: '配置できる画像素材が見つかりません。' });
      return;
    }
    const placementIndex = room.boardAssets.length;
    const boardAsset = {
      id: crypto.randomUUID(),
      key: asset.key,
      name: asset.name,
      category: asset.category,
      x: 0.5 + ((placementIndex % 5) - 2) * 0.08,
      y: 0.5 + ((Math.floor(placementIndex / 5) % 5) - 2) * 0.08,
      width: 0.16,
      height: 0.19,
      placedBy: socket.data.member.name,
      locked: false,
      visible: true
    };
    room.boardAssets.push(boardAsset);
    touchRoom(room);
    io.to(`room:${id}`).emit('board-assets', room.boardAssets);
    acknowledge?.({ ok: true, boardAsset });
  });

  socket.on('update-board-asset', ({ assetId, action, x, y, width, height, order, assetIds, groupId, groupName, name: rawName, visible, locked } = {}, acknowledge) => {
    const id = socket.data.roomId;
    const room = id && rooms.get(id);
    const member = socket.data.member;
    if (!room || !member) { acknowledge?.({ ok: false, error: 'ルームに参加していません。' }); return; }

    if (['align-selected', 'match-size-selected', 'stack-selected'].includes(action)) {
      const selectedIds = [...new Set(Array.isArray(assetIds) ? assetIds : [])];
      const selectedAssets = selectedIds.map((selectedId) => room.boardAssets.find((asset) => asset.id === selectedId));
      if (member.role !== 'gm' || selectedAssets.length < 2 || selectedAssets.some((asset) => !asset)) {
        acknowledge?.({ ok: false, error: 'GMとして2つ以上のレイヤーを選択してください。' });
        return;
      }
      if (selectedAssets.some((asset) => asset.locked)) {
        acknowledge?.({ ok: false, error: 'ロック中のレイヤーを解除してから整列してください。' });
        return;
      }
      const reference = selectedAssets[0];
      selectedAssets.slice(1).forEach((asset) => {
        if (action === 'align-selected' || action === 'stack-selected') {
          asset.x = reference.x;
          asset.y = reference.y;
        }
        if (action === 'match-size-selected' || action === 'stack-selected') {
          asset.width = reference.width || 0.16;
          asset.height = reference.height || 0.19;
        }
      });
    } else if (action === 'group') {
      const selectedIds = [...new Set(Array.isArray(assetIds) ? assetIds : [])];
      const name = cleanText(groupName, 40);
      if (member.role !== 'gm' || selectedIds.length < 2 || !name || selectedIds.some((selectedId) => !room.boardAssets.some((asset) => asset.id === selectedId))) {
        acknowledge?.({ ok: false, error: 'グループ名と2つ以上のレイヤーを選択してください。' });
        return;
      }
      const selectedSet = new Set(selectedIds);
      const selectedAssets = room.boardAssets.filter((asset) => selectedSet.has(asset.id));
      const firstIndex = room.boardAssets.findIndex((asset) => selectedSet.has(asset.id));
      const previousGroupIds = new Set(selectedAssets.map((asset) => asset.groupId).filter(Boolean));
      room.boardAssets = room.boardAssets.filter((asset) => !selectedSet.has(asset.id));
      room.boardAssets.filter((asset) => previousGroupIds.has(asset.groupId)).forEach((asset) => {
        delete asset.groupId;
        delete asset.groupName;
      });
      const group = { id: crypto.randomUUID(), name };
      selectedAssets.forEach((asset) => { asset.groupId = group.id; asset.groupName = group.name; });
      room.boardAssets.splice(Math.min(firstIndex, room.boardAssets.length), 0, ...selectedAssets);
    } else if (action === 'rename') {
      const name = cleanText(rawName, 40);
      if (member.role !== 'gm' || !name) { acknowledge?.({ ok: false, error: 'GMのみ名前を変更できます。' }); return; }
      if (groupId) {
        const groupedAssets = room.boardAssets.filter((asset) => asset.groupId === groupId);
        if (!groupedAssets.length) { acknowledge?.({ ok: false, error: 'グループが見つかりません。' }); return; }
        groupedAssets.forEach((asset) => { asset.groupName = name; });
      } else {
        const renamedAsset = room.boardAssets.find((asset) => asset.id === assetId);
        if (!renamedAsset) { acknowledge?.({ ok: false, error: 'レイヤーが見つかりません。' }); return; }
        renamedAsset.name = name;
      }
    } else if (action === 'ungroup') {
      if (member.role !== 'gm' || !groupId) { acknowledge?.({ ok: false, error: 'レイヤー操作はGMのみ行えます。' }); return; }
      room.boardAssets.filter((asset) => asset.groupId === groupId).forEach((asset) => {
        delete asset.groupId;
        delete asset.groupName;
      });
    } else if (action === 'toggle-group-visibility' || action === 'toggle-group-lock') {
      if (member.role !== 'gm' || !groupId) { acknowledge?.({ ok: false, error: 'レイヤー操作はGMのみ行えます。' }); return; }
      const groupedAssets = room.boardAssets.filter((asset) => asset.groupId === groupId);
      if (!groupedAssets.length) { acknowledge?.({ ok: false, error: 'グループが見つかりません。' }); return; }
      if (action === 'toggle-group-lock') groupedAssets.forEach((asset) => { asset.locked = Boolean(locked); });
      else groupedAssets.forEach((asset) => { asset.visible = Boolean(visible); });
    } else {
    const assetIndex = room?.boardAssets.findIndex((asset) => asset.id === assetId) ?? -1;
    if (assetIndex < 0) { acknowledge?.({ ok: false, error: 'レイヤーが見つかりません。' }); return; }
    const boardAsset = room.boardAssets[assetIndex];

    if (action === 'reorder') {
      if (member.role !== 'gm' || !Array.isArray(order)) { acknowledge?.({ ok: false, error: 'レイヤー操作はGMのみ行えます。' }); return; }
      const currentIds = room.boardAssets.map((asset) => asset.id);
      if (order.length !== currentIds.length || new Set(order).size !== currentIds.length || order.some((id) => !currentIds.includes(id))) {
        acknowledge?.({ ok: false, error: 'レイヤーの並び順が不正です。' });
        return;
      }
      const assetsById = new Map(room.boardAssets.map((asset) => [asset.id, asset]));
      const frontToBack = [];
      const includedGroups = new Set();
      order.forEach((orderedId) => {
        const asset = assetsById.get(orderedId);
        if (!asset.groupId) {
          frontToBack.push(asset);
          return;
        }
        if (includedGroups.has(asset.groupId)) return;
        includedGroups.add(asset.groupId);
        order.forEach((groupedId) => {
          const groupedAsset = assetsById.get(groupedId);
          if (groupedAsset.groupId === asset.groupId) frontToBack.push(groupedAsset);
        });
      });
      room.boardAssets = frontToBack.reverse();
    } else if (action === 'move') {
      const nextX = Number(x);
      const nextY = Number(y);
      if (boardAsset.locked || !Number.isFinite(nextX) || !Number.isFinite(nextY)) { acknowledge?.({ ok: false, error: 'このレイヤーは移動できません。' }); return; }
      const offsetX = nextX - boardAsset.x;
      const offsetY = nextY - boardAsset.y;
      const movingAssets = boardAsset.groupId ? room.boardAssets.filter((asset) => asset.groupId === boardAsset.groupId) : [boardAsset];
      if (movingAssets.some((asset) => asset.locked)) { acknowledge?.({ ok: false, error: 'グループ内にロック中のレイヤーがあります。' }); return; }
      movingAssets.forEach((asset) => {
        asset.x = Math.max(0.03, Math.min(0.97, asset.x + offsetX));
        asset.y = Math.max(0.03, Math.min(0.97, asset.y + offsetY));
      });
    } else if (action === 'resize') {
      const nextX = Number(x);
      const nextY = Number(y);
      const nextWidth = Number(width);
      const nextHeight = Number(height);
      if (boardAsset.locked || ![nextX, nextY, nextWidth, nextHeight].every(Number.isFinite)) { acknowledge?.({ ok: false, error: 'この画像はサイズ変更できません。' }); return; }
      boardAsset.x = Math.max(0.03, Math.min(0.97, nextX));
      boardAsset.y = Math.max(0.03, Math.min(0.97, nextY));
      boardAsset.width = Math.max(0.04, Math.min(0.9, nextWidth));
      boardAsset.height = Math.max(0.04, Math.min(0.9, nextHeight));
    } else {
      if (member.role !== 'gm') { acknowledge?.({ ok: false, error: 'レイヤー操作はGMのみ行えます。' }); return; }
      if (action === 'toggle-lock') {
        const nextLocked = !boardAsset.locked;
        const affectedAssets = boardAsset.groupId ? room.boardAssets.filter((asset) => asset.groupId === boardAsset.groupId) : [boardAsset];
        affectedAssets.forEach((asset) => { asset.locked = nextLocked; });
      } else if (action === 'toggle-visibility') {
        const nextVisible = visible === undefined ? !boardAsset.visible : Boolean(visible);
        const affectedAssets = boardAsset.groupId ? room.boardAssets.filter((asset) => asset.groupId === boardAsset.groupId) : [boardAsset];
        affectedAssets.forEach((asset) => { asset.visible = nextVisible; });
      } else if (action === 'forward' || action === 'backward') {
        const groupedAssets = boardAsset.groupId ? room.boardAssets.filter((asset) => asset.groupId === boardAsset.groupId) : [boardAsset];
        const firstIndex = Math.min(...groupedAssets.map((asset) => room.boardAssets.indexOf(asset)));
        const reordered = room.boardAssets.filter((asset) => !groupedAssets.includes(asset));
        const insertionIndex = action === 'forward' ? Math.min(reordered.length, firstIndex + 1) : Math.max(0, firstIndex - 1);
        if (insertionIndex !== firstIndex) {
          reordered.splice(insertionIndex, 0, ...groupedAssets);
          room.boardAssets = reordered;
        }
      } else {
        acknowledge?.({ ok: false, error: '不明なレイヤー操作です。' });
        return;
      }
    }
    }

    touchRoom(room);
    io.to(`room:${id}`).emit('board-assets', room.boardAssets);
    acknowledge?.({ ok: true, boardAssets: room.boardAssets });
  });

  socket.on('duplicate-room', ({ roomId, gmToken, inviteToken } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const sourceRoom = id && rooms.get(id);
    const hasValidManagementToken = sourceRoom && (sourceRoom.gmToken === gmToken || sourceRoom.inviteToken === inviteToken);
    if (!hasValidManagementToken) { acknowledge?.({ ok: false, error: 'ルーム情報が無効です。' }); return; }
    const duplicateId = createRoomId();
    const duplicateRoom = getRoom(duplicateId, sourceRoom.systemId, `${sourceRoom.title}（複製）`.slice(0, 80));
    duplicateRoom.inviteToken = crypto.randomBytes(32).toString('hex');
    duplicateRoom.gmToken = crypto.randomBytes(32).toString('hex');
    persistRooms();
    const system = trpgSystems[duplicateRoom.systemId];
    acknowledge?.({ ok: true, roomId: duplicateId, roomTitle: duplicateRoom.title, systemId: system.id, systemName: system.name, inviteToken: duplicateRoom.inviteToken, gmToken: duplicateRoom.gmToken, createdAt: duplicateRoom.createdAt, updatedAt: duplicateRoom.updatedAt });
  });

  socket.on('delete-room', ({ roomId, gmToken, inviteToken } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const room = id && rooms.get(id);
    const hasValidManagementToken = room && (room.gmToken === gmToken || room.inviteToken === inviteToken);
    if (!hasValidManagementToken) { acknowledge?.({ ok: false, error: 'ルーム情報が無効です。' }); return; }
    rooms.delete(id);
    for (const [token, session] of sessions) if (session.roomId === id) sessions.delete(token);
    io.to(`room:${id}`).emit('room-deleted');
    persistRooms();
    acknowledge?.({ ok: true });
  });

  socket.on('join-room', ({ roomId, inviteToken, playerId: rawPlayerId, name } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const playerId = normalizePlayerId(rawPlayerId);
    const room = id && rooms.get(id);
    const member = { id: socket.id, playerId, name: cleanText(name, 40) || room?.players.get(playerId)?.name || '', role: 'pc' };
    if (!id || !playerId || !member.name || typeof inviteToken !== 'string') { acknowledge?.({ ok: false, error: '有効な招待URL、プレイヤーID、表示名が必要です。' }); return; }
    if (!room) { acknowledge?.({ ok: false, error: 'ルームが存在しないか、GMがまだ作成していません。' }); return; }
    joinRoom(socket, id, member, acknowledge, inviteToken);
  });

  socket.on('send-message', (payload = {}) => {
    const id = socket.data.roomId;
    const text = cleanText(typeof payload === 'string' ? payload : payload.text, 2000);
    if (!id || !text || !socket.data.member) return;
    const room = getRoom(id);
    const targetValue = cleanText(typeof payload === 'string' ? '' : payload.targetId, 80);
    const targetMember = targetValue
      ? [...room.members.values()].find((member) => member.id === targetValue || member.playerId === targetValue)
      : null;
    if (targetValue && (!targetMember || targetMember.id === socket.id)) return;
    const message = {
      id: `${Date.now()}-${socket.id}`,
      text,
      name: socket.data.member.name,
      role: socket.data.member.role,
      scope: targetMember ? 'private' : 'public',
      senderId: socket.id,
      senderPlayerId: socket.data.member.playerId || '',
      targetId: targetMember?.id || '',
      targetPlayerId: targetMember?.playerId || '',
      targetName: targetMember?.name || '',
      targetRole: targetMember?.role || '',
      time: new Date().toISOString()
    };
    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();
    touchRoom(room);
    if (!targetMember) {
      io.to(`room:${id}`).emit('message', message);
      return;
    }
    const recipientIds = new Set([socket.id, targetMember.id]);
    for (const member of room.members.values()) if (member.role === 'gm') recipientIds.add(member.id);
    for (const recipientId of recipientIds) io.to(recipientId).emit('message', message);
  });

  socket.on('roll-dice', ({ sides, count = 1, modifier = 0, expression = '', actorId = '', secret = false } = {}) => {
    const id = socket.data.roomId;
    const member = socket.data.member;
    const room = id && rooms.get(id);
    const diceSides = Number(sides);
    const diceCount = Number(count);
    const diceModifier = Number(modifier);
    if (!room || !member || !Number.isInteger(diceSides) || diceSides < 2 || diceSides > 1000 || !Number.isInteger(diceCount) || diceCount < 1 || diceCount > 20 || !Number.isInteger(diceModifier) || Math.abs(diceModifier) > 100000) return;
    const actor = member.role === 'gm' && actorId ? room.npcs.get(actorId) : member;
    if (!actor) return;
    const results = Array.from({ length: diceCount }, () => crypto.randomInt(1, diceSides + 1));
    const total = results.reduce((sum, result) => sum + result, 0) + diceModifier;
    const isSecret = Boolean(secret) && member.role === 'gm';
    const notation = typeof expression === 'string' && /^\d+[dD]\d+(?:[+-]\d+)?$/.test(expression)
      ? expression
      : `${diceCount}D${diceSides}${diceModifier > 0 ? `+${diceModifier}` : diceModifier < 0 ? diceModifier : ''}`;
    const message = {
      id: `${Date.now()}-${socket.id}`,
      text: isSecret
        ? `${actor.name}がシークレットダイスを振りました：${results.join(', ')}${diceModifier ? ` (${diceModifier > 0 ? '+' : ''}${diceModifier})` : ''} (合計 ${total})`
        : `${actor.name} が ${notation} を振りました: ${results.join(', ')} (合計 ${total})`,
      name: actor.name,
      role: actor.role,
      scope: 'public',
      senderId: socket.id,
      senderPlayerId: member.playerId || '',
      secret: isSecret,
      rollResults: results,
      rollTotal: total,
      time: new Date().toISOString()
    };
    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();
    touchRoom(room);
    if (!isSecret) {
      io.to(`room:${id}`).emit('message', message);
      return;
    }
    for (const recipient of room.members.values()) {
      io.to(recipient.id).emit('message', formatMessageForMember(message, recipient));
    }
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
    clearSocketRoom(socket);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`TRPG communication room listening on port ${port}`));