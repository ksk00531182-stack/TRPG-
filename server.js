const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const port = Number(process.env.PORT) || 3000;
const rooms = new Map();
const root = __dirname;
const contentTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

function normalizeRoomId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null; }
function cleanText(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { messages: [], members: new Map() });
  return rooms.get(id);
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) { response.writeHead(404); response.end('Not Found'); return; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { response.writeHead(404); response.end('Not Found'); return; }
  response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(response);
});

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
function broadcastMembers(id) { io.to(`room:${id}`).emit('members', [...getRoom(id).members.values()]); }

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, role, name } = {}, acknowledge) => {
    const id = normalizeRoomId(roomId);
    const member = { id: socket.id, name: cleanText(name, 40), role: role === 'gm' ? 'gm' : 'pc' };
    if (!id || !member.name) { acknowledge?.({ ok: false, error: 'ルームIDと名前を入力してください。' }); return; }
    const room = getRoom(id);
    socket.join(`room:${id}`);
    socket.data.roomId = id;
    socket.data.member = member;
    room.members.set(socket.id, member);
    socket.emit('history', room.messages);
    broadcastMembers(id);
    acknowledge?.({ ok: true, roomId: id });
  });

  socket.on('send-message', (value) => {
    const id = socket.data.roomId;
    const text = cleanText(value, 2000);
    if (!id || !text || !socket.data.member) return;
    const message = { id: `${Date.now()}-${socket.id}`, text, name: socket.data.member.name, role: socket.data.member.role, time: new Date().toISOString() };
    const room = getRoom(id);
    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();
    io.to(`room:${id}`).emit('message', message);
  });

  socket.on('typing', (isTyping) => {
    const id = socket.data.roomId;
    if (id && socket.data.member) socket.to(`room:${id}`).emit('typing', { name: socket.data.member.name, isTyping: Boolean(isTyping) });
  });

  socket.on('disconnect', () => {
    const id = socket.data.roomId;
    if (!id) return;
    const room = rooms.get(id);
    room?.members.delete(socket.id);
    if (room) broadcastMembers(id);
    if (room?.members.size === 0) rooms.delete(id);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`TRPG communication room listening on port ${port}`));