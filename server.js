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
  let requestedPath = decodeURIComponent(requestUrl.pathname);
  if (requestedPath === '/') requestedPath = '/index.html';
  if (requestedPath.startsWith('/trpg-session-room/')) {
    requestedPath = requestedPath.slice('/trpg-session-room'.length);
  }
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

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 50 * 1024 * 1024
});

function normalizeRoomId(roomId) {
  return typeof roomId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(roomId)
    ? roomId
    : 'trpg-session-room';
}

io.on('connection', (socket) => {
  socket.on('trpg_subscribe', ({ roomId } = {}) => {
    socket.join(`trpg:${normalizeRoomId(roomId)}`);
  });

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

  socket.on('trpg_logs_update', ({ roomId, logs } = {}) => {
    if (!Array.isArray(logs)) return;
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomState = trpgRooms.get(normalizedRoomId);
    if (roomState) roomState.logs = logs;
    socket.to(`trpg:${normalizedRoomId}`).emit('trpg_logs', logs);
  });

  socket.on('trpg_board_visibility', ({ roomId, hidden } = {}) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    io.to(`trpg:${normalizedRoomId}`).emit('trpg_board_visibility', { hidden: hidden === true });
  });

  socket.on('trpg_bgm_control', ({ roomId, playing } = {}) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomState = trpgRooms.get(normalizedRoomId);
    if (roomState?.bgm) roomState.bgm.playing = playing === true;
    io.to(`trpg:${normalizedRoomId}`).emit('trpg_bgm_control', { playing: playing === true });
  });

  socket.on('trpg_layer_visibility', ({ roomId, layerType, layerId, visible } = {}) => {
    if (!['background', 'overlay'].includes(layerType) || typeof layerId !== 'string') return;
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomState = trpgRooms.get(normalizedRoomId);
    if (roomState) {
      if (layerType === 'overlay') {
        const overlay = Array.isArray(roomState.sceneOverlays)
          ? roomState.sceneOverlays[Number(layerId)]
          : null;
        if (overlay) overlay.visible = visible === true;
      } else if (layerId === 'whiteDark' || layerId === 'blackDark') {
        roomState.backgroundDimming ||= { white: false, black: false };
        roomState.backgroundDimming[layerId === 'whiteDark' ? 'white' : 'black'] = visible === true;
      } else {
        const layer = Array.isArray(roomState.backgroundLayers)
          ? roomState.backgroundLayers.find((entry) => entry.id === layerId)
          : null;
        if (layer) layer.visible = visible === true;
      }
    }
    io.to(`trpg:${normalizedRoomId}`).emit('trpg_layer_visibility', {
      layerType,
      layerId,
      visible: visible === true
    });
  });

  socket.on('trpg_image_transform', ({ roomId, layerType, layerId, x, y, size } = {}) => {
    if (!['background', 'overlay'].includes(layerType) || typeof layerId !== 'string') return;
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomState = trpgRooms.get(normalizedRoomId);
    const target = layerType === 'background'
      ? roomState?.backgroundLayers?.find((layer) => layer.id === layerId)
      : roomState?.sceneOverlays?.[Number(layerId)];
    if (target) {
      if (Number.isFinite(x)) target.x = x;
      if (Number.isFinite(y)) target.y = y;
      if (Number.isFinite(size) && layerType === 'overlay') target.size = size;
    }
    io.to(`trpg:${normalizedRoomId}`).emit('trpg_image_transform', {
      layerType, layerId, x, y, size
    });
  });

  socket.on('trpg_dice_result', ({ roomId, title, message, resultClass } = {}) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    socket.to(`trpg:${normalizedRoomId}`).emit('trpg_dice_result', {
      title: typeof title === 'string' ? title : 'ダイス判定',
      message: typeof message === 'string' ? message : '',
      resultClass: typeof resultClass === 'string' ? resultClass : null
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`TRPG Session Room listening on port ${port}`);
});
