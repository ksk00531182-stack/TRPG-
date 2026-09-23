const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const port = Number.parseInt(process.env.PORT, 10) || 3000;
const rootDirectory = __dirname;
const trpgRooms = new Map();
const assetDirectory = path.join(rootDirectory, 'assets', 'session');
fs.mkdirSync(assetDirectory, { recursive: true });
const bundledAssetDirectories = {
  background: path.join(rootDirectory, 'assets', 'backgrounds'),
  character: path.join(rootDirectory, 'assets', 'characters'),
  material: path.join(rootDirectory, 'assets', 'clues'),
  icon: path.join(rootDirectory, 'assets', 'scene-images')
};

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
    if (request.method === 'POST' && request.url?.split('?')[0] === '/api/assets') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 80 * 1024 * 1024) request.destroy();
      });
      request.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const match = typeof payload.data === 'string' && payload.data.match(/^data:([^;]+);base64,(.+)$/s);
          if (!match) throw new Error('Invalid asset data');
          const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav' }[match[1]] || '';
          const fileName = `${crypto.randomUUID()}${extension}`;
          fs.writeFileSync(path.join(assetDirectory, fileName), Buffer.from(match[2], 'base64'));
          response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ url: `/assets/session/${fileName}`, name: payload.name || fileName }));
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid asset' }));
        }
      });
      return;
    }
    if (request.method === 'GET' && request.url?.split('?')[0] === '/api/assets/catalog') {
      const catalog = Object.entries(bundledAssetDirectories).flatMap(([category, directory]) => {
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && !entry.name.toLowerCase().endsWith('.txt'))
          .map((entry) => ({
            category,
            name: entry.name,
            data: `/assets/${path.basename(directory)}/${encodeURIComponent(entry.name)}`
          }));
      });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(catalog));
      return;
    }
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

function mergeSessionState(currentState, nextState) {
  if (!currentState) return nextState;
  const merged = { ...currentState, ...nextState };
  const mergeArray = (key, identity) => {
    if (!Array.isArray(nextState[key])) return;
    const currentItems = Array.isArray(currentState[key]) ? currentState[key] : [];
    merged[key] = nextState[key].map((item, index) => {
      const current = identity(item, index, currentItems);
      return current ? { ...current, ...item, data: item.data ?? current.data } : item;
    });
  };
  mergeArray('backgroundLayers', (item) => currentState.backgroundLayers?.find((entry) => entry.id === item.id));
  mergeArray('sceneOverlays', (_item, index) => currentState.sceneOverlays?.[index]);
  mergeArray('clueImages', (_item, index) => currentState.clueImages?.[index]);
  mergeArray('sceneImages', (_item, index) => currentState.sceneImages?.[index]);
  mergeArray('bgmTracks', (item) => currentState.bgmTracks?.find((entry) => entry.id === item.id));
  if (nextState.bgm) merged.bgm = { ...currentState.bgm, ...nextState.bgm, data: nextState.bgm.data ?? currentState.bgm?.data };
  return merged;
}

io.on('connection', (socket) => {
  socket.on('trpg_subscribe', ({ roomId } = {}) => {
    socket.join(`trpg:${normalizeRoomId(roomId)}`);
  });

  socket.on('trpg_join', ({ roomId, mode, state } = {}) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomKey = `trpg:${normalizedRoomId}`;
    socket.join(roomKey);

    if (mode === 'gm' && state && typeof state === 'object') {
      trpgRooms.set(normalizedRoomId, mergeSessionState(trpgRooms.get(normalizedRoomId), state));
    }
    const storedState = trpgRooms.get(normalizedRoomId);
    if (storedState) socket.emit('trpg_state', storedState);
  });

  socket.on('trpg_state_update', ({ roomId, state } = {}) => {
    if (!state || typeof state !== 'object') return;
    const normalizedRoomId = normalizeRoomId(roomId);
    const storedState = mergeSessionState(trpgRooms.get(normalizedRoomId), state);
    trpgRooms.set(normalizedRoomId, storedState);
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

  socket.on('trpg_asset_add', ({ roomId, assetType, asset, overlay } = {}, acknowledge) => {
    if (!asset || typeof asset.data !== 'string') {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'invalid-asset' });
      return;
    }
    const normalizedRoomId = normalizeRoomId(roomId);
    const roomState = trpgRooms.get(normalizedRoomId);
    if (roomState) {
      if (assetType === 'background') {
        roomState.backgroundLayers ||= [];
        if (!roomState.backgroundLayers.some((layer) => layer.id === asset.id)) roomState.backgroundLayers.push(asset);
      } else if (assetType === 'clueImages' || assetType === 'sceneImages') {
        roomState[assetType] ||= [];
        if (!roomState[assetType].some((item) => item.name === asset.name && item.data === asset.data)) roomState[assetType].push(asset);
        if (overlay) {
          roomState.sceneOverlays ||= [];
          if (!roomState.sceneOverlays.some((item) => item.name === overlay.name && item.data === overlay.data)) roomState.sceneOverlays.push(overlay);
        }
      } else if (assetType === 'character' && overlay) {
        roomState.sceneOverlays ||= [];
        if (!roomState.sceneOverlays.some((item) => item.name === overlay.name && item.data === overlay.data)) roomState.sceneOverlays.push(overlay);
      }
    }
    socket.to(`trpg:${normalizedRoomId}`).emit('trpg_asset_add', { assetType, asset, overlay });
    if (typeof acknowledge === 'function') acknowledge({ ok: true, assetId: asset.id || asset.name });
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
