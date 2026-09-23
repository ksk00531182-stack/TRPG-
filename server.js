const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const port = Number.parseInt(process.env.PORT, 10) || 3000;
const rootDirectory = __dirname;
const trpgRooms = new Map();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function getStaticFile(requestUrl) {
  const requestedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
  const filePath = path.resolve(rootDirectory, `.${requestedPath}`);
  if (filePath !== rootDirectory && !filePath.startsWith(`${rootDirectory}${path.sep}`)) return null;
  return filePath;
}

const server = http.createServer((request, response) => {
  try {
    const filePath = getStaticFile(new URL(request.url, `http://${request.headers.host || 'localhost'}`));
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad Request');
  }
});

const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

function normalizeRoomId(roomId) {
  return typeof roomId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(roomId)
    ? roomId
    : 'trpg-session-room';
}

io.on('connection', (socket) => {
  socket.on('trpg_join', ({ roomId, mode, state } = {}) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomKey = `trpg:${normalizedRoomId}`;
    socket.join(roomKey);

    if (mode === 'gm' && state && typeof state === 'object' && !trpgRooms.has(normalizedRoomId)) {
      trpgRooms.set(normalizedRoomId, state);
    }
    const storedState = trpgRooms.get(normalizedRoomId);
    if (storedState) socket.emit('trpg_state', storedState);
  });

  socket.on('trpg_state_update', ({ roomId, state } = {}) => {
    if (!state || typeof state !== 'object') return;
    const normalizedRoomId = normalizeRoomId(roomId);
    trpgRooms.set(normalizedRoomId, state);
    socket.to(`trpg:${normalizedRoomId}`).emit('trpg_state', state);
  });

  socket.on('trpg_board_visibility', ({ roomId, hidden } = {}) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    io.to(`trpg:${normalizedRoomId}`).emit('trpg_board_visibility', { hidden: hidden === true });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`TRPG Session Room listening on port ${port}`);
});
