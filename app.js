const urlParams = new URLSearchParams(window.location.search);

function normalizeRoomId(value) {
  if (typeof value !== 'string') return null;
  const roomId = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(roomId) ? roomId : null;
}

const storageKey = 'trpg-session-room-state';
const participantAbilityKeys = ['STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU', 'LUK'];
const pcBoardHiddenKey = 'trpg-session-room-pc-board-hidden';
const requestedMode = urlParams.get('mode');
const mode = requestedMode && ['pc', 'gm'].includes(requestedMode.toLowerCase())
  ? requestedMode.toLowerCase()
  : 'gm';
const boardVisibilityChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('trpg-session-room-board-visibility') : null;
const visibilitySocket = typeof io === 'function' ? io() : null;
const realtimeSocket = typeof io === 'function' ? io() : null;
const roomParam = normalizeRoomId(urlParams.get('room'));
const storedRoomId = mode === 'gm' ? normalizeRoomId(localStorage.getItem('trpg-session-room-id')) : null;
const visibilityRoomId = roomParam || storedRoomId || (mode === 'gm' ? `session-${Math.random().toString(36).slice(2, 10)}` : 'trpg-session-room');
if (mode === 'gm') {
  localStorage.setItem('trpg-session-room-id', visibilityRoomId);
  if (!roomParam) {
    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.searchParams.set('mode', 'gm');
    canonicalUrl.searchParams.set('room', visibilityRoomId);
    window.history.replaceState({}, '', canonicalUrl);
  }
}
let applyingRemoteState = false;
let remoteSyncTimer = null;
let remoteBgmShouldPlay = false;
let localSaveTimer = null;

const defaultState = {
  backgroundLayers: [],
  characterImage: '',
  clueImages: [],
  sceneImages: [],
  characterImages: [],
  sceneOverlays: [],
  backgroundScale: 100,
  backgroundLayerOrder: ['whiteDark', 'blackDark'],
  backgroundDimming: { white: false, black: false },
  backgroundLocked: false,
  sizeBoxLayouts: {},
  layerGroups: [],
  skillTemplates: [],
  bgm: { name: '', data: '', volume: 0.5 },
  bgmTracks: [],
  players: [],
  logs: [],
  scenarios: [],
};

// ユーティリティ関数
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[c]);
}

function nowTime() {
  return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(new Date());
}

// 状態の初期化およびクレンジング
function loadInitialState() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return structuredClone(defaultState);

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      delete parsed.backgroundImage;
      return parsed;
    }
  } catch (e) {
    console.error('Failed to parse state from localStorage:', e);
  }
  return structuredClone(defaultState);
}

let state = loadInitialState();

function sanitizeAndNormalizeState() {
  const obsoleteLogs = [
    ['21:43', 'リナが灯台の扉に手をかけた。'],
    ['21:39', '霧の向こうに人影。'],
    ['21:31', 'カイが〈観察〉に成功。'],
    ['21:26', 'シーン「海岸線」を開始。']
  ];
  const logsBeforeCleanup = Array.isArray(state.logs) ? state.logs : [];
  state.logs = logsBeforeCleanup.filter((log) => {
    const plainText = String(log?.text || '').replace(/<[^>]*>/g, '');
    return !obsoleteLogs.some(([time, text]) => log?.time === time && plainText.includes(text));
  });
  const logsChanged = state.logs.length !== logsBeforeCleanup.length;
  delete state.sceneNote;
  delete state.scenarioNote;
  delete state.scenarioTitle;
  delete state.scenarioTabs;
  delete state.activeScenarioTabId;
  state.scenarios = Array.isArray(state.scenarios) ? state.scenarios : [];

  // 内部データモデルの平準化
  state.clueImages ||= [];
  state.sceneImages ||= [];
  state.characterImages ||= [];
  state.backgroundScale ||= 100;
  state.backgroundDimming ||= { white: false, black: false };
  state.backgroundLocked = Boolean(state.backgroundLocked);
  state.sizeBoxLayouts ||= {};
  state.layerGroups ||= [];
  state.skillTemplates = Array.isArray(state.skillTemplates) ? state.skillTemplates : [];
  state.bgm = { name: '', data: '', volume: 0.5, ...(state.bgm || {}) };
  state.bgmTracks = Array.isArray(state.bgmTracks) ? state.bgmTracks : [];
  if (!state.bgmTracks.length && state.bgm.data) {
    state.bgmTracks.push({ id: `bgm-${Date.now()}`, name: state.bgm.name || 'BGM', data: state.bgm.data });
  }

  state.players = (state.players || []).map((player) => {
    const participant = { ...player };
    participant.abilities = participantAbilityKeys.reduce((abilities, key) => {
      abilities[key] = participant.abilities?.[key] ?? '';
      return abilities;
    }, {});
    const con = Number(participant.abilities.CON) || 0;
    const siz = Number(participant.abilities.SIZ) || 0;
    const pow = Number(participant.abilities.POW) || 0;
    participant.currentHP ??= (con + siz) / 10;
    participant.currentSAN ??= pow;
    participant.skillTemplates = Array.isArray(participant.skillTemplates) ? participant.skillTemplates : [];
    return participant;
  });
  const legacyPlayerNames = new Set(['リナ・ノース', 'カイ・ルーン', 'ミレイユ', 'サラ・アッシュ']);
  state.players = state.players.filter((player) => !legacyPlayerNames.has(player.name));

  state.backgroundLayers = (state.backgroundLayers || [])
    .map((layer) => ({ visible: true, order: 0, x: 50, y: 50, scale: state.backgroundScale, ...layer }))
    .filter((layer) => Boolean(layer && layer.id && layer.data));

  state.backgroundLayers = state.backgroundLayers.filter(
    (layer, index, list) => list.findIndex((item) => item.id === layer.id) === index
  );

  state.sceneOverlays = (state.sceneOverlays || []).map((overlay) => ({
    visible: true,
    rotation: 0,
    layer: 'material',
    groupId: null,
    ...overlay
  }));

  state.backgroundLayerOrder = [...new Set([
    ...(Array.isArray(state.backgroundLayerOrder)
      ? state.backgroundLayerOrder.filter((id) => state.backgroundLayers.some((l) => l.id === id))
      : []),
    ...state.backgroundLayers.map((l) => l.id),
    'whiteDark',
    'blackDark'
  ])];

  state.layerGroups = state.layerGroups.map((group) => ({ visible: true, ...group }));
  return logsChanged;
}

const initialLogsCleaned = sanitizeAndNormalizeState();
if (initialLogsCleaned) localStorage.setItem(storageKey, JSON.stringify(state));

visibilitySocket?.on('connect', () => visibilitySocket.emit('trpg_join', {
  roomId: visibilityRoomId,
  mode,
  state: mode === 'gm' ? state : undefined
}));
visibilitySocket?.on('trpg_board_visibility', ({ hidden }) => applyPcBoardVisibility(hidden === true));
visibilitySocket?.on('trpg_bgm_control', ({ playing }) => {
  remoteBgmShouldPlay = playing === true;
  const audio = $('#bgmAudio');
  if (!audio || !state.bgm.data) return;
  if (remoteBgmShouldPlay) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
  renderBgm();
});
realtimeSocket?.on('connect', () => realtimeSocket.emit('trpg_subscribe', { roomId: visibilityRoomId }));
visibilitySocket?.on('trpg_board_visibility', ({ hidden }) => applyPcBoardVisibility(hidden === true));
realtimeSocket?.on('trpg_logs', (logs) => {
  state.logs = logs;
  renderLogs();
});
realtimeSocket?.on('trpg_layer_visibility', ({ layerType, layerId, visible }) => {
  if (layerType === 'background') {
    if (layerId === 'whiteDark' || layerId === 'blackDark') {
      const config = getBackgroundLayerConfig(layerId);
      state.backgroundDimming[config.key] = visible === true;
    } else {
      const layer = state.backgroundLayers.find((entry) => entry.id === layerId);
      if (layer) layer.visible = visible === true;
    }
    renderImages();
    renderBackgroundLayerList();
  } else if (layerType === 'overlay') {
    const overlay = state.sceneOverlays[Number(layerId)];
    if (!overlay) return;
    overlay.visible = visible === true;
    renderOverlays();
  }
});
realtimeSocket?.on('trpg_image_transform', ({ layerType, layerId, x, y, size }) => {
  const numericId = Number(layerId);
  const target = layerType === 'background'
    ? state.backgroundLayers.find((layer) => layer.id === layerId)
    : state.sceneOverlays[numericId];
  if (!target) return;
  if (Number.isFinite(x)) target.x = x;
  if (Number.isFinite(y)) target.y = y;
  if (Number.isFinite(size) && layerType === 'overlay') target.size = size;
  renderOverlays();
});
realtimeSocket?.on('trpg_asset_add', ({ assetType, asset, overlay }) => {
  if (!asset?.data) return;
  if (assetType === 'background') {
    if (!state.backgroundLayers.some((layer) => layer.id === asset.id)) state.backgroundLayers.push(asset);
    state.backgroundLayerOrder = getBackgroundLayerOrder();
  } else if (assetType === 'clueImages' || assetType === 'sceneImages') {
    if (!state[assetType].some((item) => item.name === asset.name && item.data === asset.data)) state[assetType].push(asset);
    if (overlay && !state.sceneOverlays.some((item) => item.name === overlay.name && item.data === overlay.data)) state.sceneOverlays.push(overlay);
  }
  render();
});

function mergeRemoteState(remoteState) {
  const merged = { ...state, ...remoteState };
  const mergeArray = (key, identity) => {
    if (!Array.isArray(remoteState[key])) return;
    const currentItems = Array.isArray(state[key]) ? state[key] : [];
    merged[key] = remoteState[key].map((item, index) => {
      const current = identity(item, index, currentItems);
      return current ? { ...current, ...item, data: item.data ?? current.data } : item;
    });
  };
  mergeArray('backgroundLayers', (item) => state.backgroundLayers.find((entry) => entry.id === item.id));
  mergeArray('sceneOverlays', (_item, index) => state.sceneOverlays[index]);
  mergeArray('clueImages', (_item, index) => state.clueImages[index]);
  mergeArray('sceneImages', (_item, index) => state.sceneImages[index]);
  mergeArray('bgmTracks', (item) => state.bgmTracks.find((entry) => entry.id === item.id));
  if (remoteState.bgm) merged.bgm = { ...state.bgm, ...remoteState.bgm, data: remoteState.bgm.data ?? state.bgm.data };
  return merged;
}

visibilitySocket?.on('trpg_dice_result', (result) => {
  if (mode === 'pc') showPcDiceResult(result);
});
visibilitySocket?.on('trpg_state', (remoteState) => {
  if (!remoteState || typeof remoteState !== 'object') return;
  applyingRemoteState = true;
  state = mergeRemoteState(remoteState);
  const logsChanged = sanitizeAndNormalizeState();
  render();
  applyingRemoteState = false;
  if (mode === 'gm' && logsChanged) save({ syncState: false, syncLog: true });
});

// UI選択状態
let selectedOverlayIndex = null;
let selectedGroupId = null;
let selectedBackgroundLayerId = null;
let multiSelectOverlayIndexes = [];
let activeSizeLayer = 'character';

let pendingDeleteIndex = null;
let pendingDeleteGroupId = null;
let pendingDeleteBackgroundLayerId = null;
let pendingUngroupGroupId = null;
let pendingGroupLayerCategory = null;
let pendingAssetCategory = null;
let activeLibraryScenarioIndex = 0;
let activeSidebarPlayerIndex = 0;

function createLightweightState() {
  const lightweight = structuredClone(state);
  lightweight.backgroundLayers = lightweight.backgroundLayers.map(({ data, ...layer }) => layer);
  lightweight.sceneOverlays = lightweight.sceneOverlays.map(({ data, ...overlay }) => overlay);
  lightweight.clueImages = lightweight.clueImages.map(({ data, ...image }) => image);
  lightweight.sceneImages = lightweight.sceneImages.map(({ data, ...image }) => image);
  lightweight.bgm = { ...lightweight.bgm, data: undefined };
  lightweight.bgmTracks = lightweight.bgmTracks.map(({ data, ...track }) => track);
  return lightweight;
}

function save({ syncState = true, syncLog = false, includeAssets = false, deferLocalSave = false } = {}) {
  if (deferLocalSave) {
    if (localSaveTimer) window.clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(state));
      localSaveTimer = null;
    }, 250);
  } else {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }
  if (!syncState && remoteSyncTimer) {
    window.clearTimeout(remoteSyncTimer);
    remoteSyncTimer = null;
  }
  if (syncState) syncRemoteState(includeAssets);
  if (syncLog) syncLogs();
  const saveState = $('#saveState');
  if (saveState) {
    saveState.textContent = '● 保存済み';
    saveState.style.color = 'var(--teal)';
  }
}

function syncLogs() {
  if (applyingRemoteState) return;
  realtimeSocket?.emit('trpg_logs_update', { roomId: visibilityRoomId, logs: state.logs });
}

function createPlayerInviteUrl() {
  const inviteUrl = new URL(window.location.href);
  inviteUrl.hash = '';
  inviteUrl.search = '';
  inviteUrl.searchParams.set('mode', 'pc');
  inviteUrl.searchParams.set('room', visibilityRoomId);
  return inviteUrl;
}

function syncRemoteState(includeAssets = false) {
  if (mode === 'gm' && !applyingRemoteState) {
    if (remoteSyncTimer) window.clearTimeout(remoteSyncTimer);
    remoteSyncTimer = window.setTimeout(() => {
      visibilitySocket?.emit('trpg_state_update', {
        roomId: visibilityRoomId,
        state: includeAssets ? state : createLightweightState(),
        includeAssets
      });
      remoteSyncTimer = null;
    }, 50);
  }
}

function syncLayerVisibility(layerId, visible) {
  if (mode !== 'gm') return;
  realtimeSocket?.emit('trpg_layer_visibility', {
    roomId: visibilityRoomId,
    layerType: 'background',
    layerId,
    visible: visible === true
  });
}

function syncOverlayVisibility(index, visible) {
  if (mode !== 'gm') return;
  realtimeSocket?.emit('trpg_layer_visibility', {
    roomId: visibilityRoomId,
    layerType: 'overlay',
    layerId: String(index),
    visible: visible === true
  });
}

function syncImageTransform(layerType, layerId, target) {
  if (mode !== 'gm') return;
  realtimeSocket?.emit('trpg_image_transform', {
    roomId: visibilityRoomId,
    layerType,
    layerId: String(layerId),
    x: target.x,
    y: target.y,
    size: target.size
  });
}

function syncAssetAdd(assetType, asset, overlay = null) {
  if (mode !== 'gm') return;
  realtimeSocket?.emit('trpg_asset_add', { roomId: visibilityRoomId, assetType, asset, overlay }, (result) => {
    if (result?.ok) return;
    // Recover from a disconnected or restarted realtime channel with one complete sync.
    save({ includeAssets: true });
  });
}

function syncBgmPlayback(playing) {
  if (mode !== 'gm') return;
  state.bgm.playing = playing === true;
  visibilitySocket?.emit('trpg_bgm_control', { roomId: visibilityRoomId, playing: playing === true });
}

function exportStateToJson() {
  const dataStr = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(state, null, 2))}`;
  const downloadAnchor = document.createElement('a');
  const fileName = `trpg_backup_${new Date().toISOString().slice(0, 10)}.json`;

  downloadAnchor.href = dataStr;
  downloadAnchor.download = fileName;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importStateFromJson(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener('load', (event) => {
    try {
      const importedState = JSON.parse(event.target.result);
      if (!importedState || typeof importedState !== 'object' || Array.isArray(importedState)) {
        throw new Error('無効なデータ形式です。');
      }

      state = importedState;
      sanitizeAndNormalizeState();
      render();
      save();
      window.alert('データを正常に読み込みました。');
    } catch (error) {
      window.alert(`ファイルの読み込みに失敗しました: ${error.message}`);
    }
  });
  reader.readAsText(file);
}

function renderBgm() {
  const audio = $('#bgmAudio');
  const controls = $('#bgmControls');
  const select = $('#bgmSelect');
  const trackList = $('#bgmTrackList');
  const playToggle = $('#bgmPlayToggle');
  const volume = $('#bgmVolume');
  if (controls) controls.classList.toggle('is-empty', !state.bgm.data && !state.bgmTracks.length);
  if (select) {
    select.innerHTML = '<option value="">BGMなし</option>' + state.bgmTracks
      .map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.name)}</option>`)
      .join('');
    const activeTrack = state.bgmTracks.find((track) => track.data === state.bgm.data);
    select.value = activeTrack?.id || '';
    if (trackList) {
      trackList.innerHTML = state.bgmTracks.length ? state.bgmTracks.map((track) =>
        `<div class="bgm-track-row ${track.data === state.bgm.data ? 'active' : ''}" draggable="true" data-bgm-track-id="${escapeHtml(track.id)}"><button type="button" class="bgm-track-select" data-bgm-select="${escapeHtml(track.id)}">${escapeHtml(track.name)}</button><button type="button" class="bgm-track-delete" data-bgm-delete="${escapeHtml(track.id)}" title="BGMを削除" aria-label="${escapeHtml(track.name)}を削除">×</button></div>`
      ).join('') : '<span class="bgm-track-empty">BGMなし</span>';
    }
  }
  if (volume) volume.value = String(state.bgm.volume ?? 0.5);
  if (playToggle) {
    const isPlaying = Boolean(audio && !audio.paused && state.bgm.data);
    playToggle.textContent = isPlaying ? 'Ⅱ' : '▶';
    playToggle.title = isPlaying ? 'BGMを停止' : 'BGMを再生';
    playToggle.setAttribute('aria-label', playToggle.title);
    playToggle.disabled = !state.bgm.data;
  }
  if (!audio) return;
  audio.loop = true;
  audio.volume = Number(state.bgm.volume ?? 0.5);
  if (state.bgm.data && audio.dataset.bgmData !== state.bgm.data) {
    audio.pause();
    audio.src = state.bgm.data;
    audio.dataset.bgmData = state.bgm.data;
    audio.load();
  } else if (!state.bgm.data) {
    audio.pause();
    audio.removeAttribute('src');
    delete audio.dataset.bgmData;
    audio.load();
  }
  if (mode === 'pc' && state.bgm.playing) {
    remoteBgmShouldPlay = true;
    audio.play().catch(() => {});
  }
}

function loadBgm(file, shouldPlay = true) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', async () => {
    $('#bgmAudio')?.pause();
    const track = { id: `bgm-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, name: file.name, data: reader.result };
    state.bgmTracks.push(track);
    state.bgm = { ...track, volume: state.bgm.volume ?? 0.5 };
    renderBgm();
    save({ includeAssets: true });
    if (shouldPlay) {
      try {
        await $('#bgmAudio')?.play();
        renderBgm();
      } catch {
        // Autoplay safe catch
      }
    }
  });
  reader.readAsDataURL(file);
}

async function selectBgmTrack(track) {
  const audio = $('#bgmAudio');
  if (!track) {
    audio?.pause();
    state.bgm = { name: '', data: '', volume: state.bgm.volume ?? 0.5 };
    renderBgm();
    save({ includeAssets: true });
    return;
  }
  audio?.pause();
  state.bgm = { ...track, volume: state.bgm.volume ?? 0.5 };
  renderBgm();
  save();
  try {
    await audio?.play();
    renderBgm();
  } catch {
    // Autoplay safe catch
  }
}

function applyPcBoardVisibility(hidden) {
  document.body.classList.toggle('pc-board-hidden', mode === 'pc' && hidden);
}

function applyPcDiceVisibility(hidden) {
  document.body.classList.toggle('pc-dice-hidden', mode === 'pc' && hidden);
}

function showPcDiceResult(result = {}) {
  const modal = $('#pcDiceResultModal');
  const title = $('#pcDiceResultTitle');
  const message = $('#pcDiceResultMessage');
  if (!modal || !title || !message) return;
  modal.classList.remove('result-critical', 'result-extreme', 'result-hard', 'result-success', 'result-failure', 'result-fumble');
  if (result.resultClass) modal.classList.add(`result-${result.resultClass}`);
  title.textContent = result.title || 'ダイス判定';
  message.textContent = result.message || '';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function getResultClass(result) {
  return {
    クリティカル: 'critical',
    エクストリーム成功: 'extreme',
    ハード成功: 'hard',
    成功: 'success',
    失敗: 'failure',
    ファンブル: 'fumble'
  }[result] || null;
}

function closePcDiceResult() {
  const modal = $('#pcDiceResultModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function notifyDiceResult(result) {
  if (mode === 'gm') visibilitySocket?.emit('trpg_dice_result', { roomId: visibilityRoomId, ...result });
  if (mode === 'pc') showPcDiceResult(result);
}

function setPcBoardVisibility(hidden) {
  localStorage.setItem(pcBoardHiddenKey, hidden ? 'true' : 'false');
  boardVisibilityChannel?.postMessage({ hidden });
  visibilitySocket?.emit('trpg_board_visibility', { roomId: visibilityRoomId, hidden });
  applyPcBoardVisibility(hidden);
}

function getSelectedOverlayIndexes() {
  if (selectedGroupId !== null) return getGroupMembers(selectedGroupId);
  if (multiSelectOverlayIndexes.length > 0) return [...multiSelectOverlayIndexes];
  if (selectedOverlayIndex !== null) return [selectedOverlayIndex];
  return [];
}

function setSingleSelection(index) {
  selectedOverlayIndex = index;
  selectedGroupId = null;
  multiSelectOverlayIndexes = [];
  if (index !== null && Number.isInteger(index)) {
    activeSizeLayer = state.sceneOverlays[index]?.layer || activeSizeLayer;
  }
}

function toggleMultiSelection(index) {
  if (state.sceneOverlays[index]?.groupId) {
    selectGroup(state.sceneOverlays[index].groupId, state.sceneOverlays[index].layer || 'material');
    return;
  }
  const nextSelection = new Set(multiSelectOverlayIndexes);
  if (nextSelection.has(index)) nextSelection.delete(index); else nextSelection.add(index);
  multiSelectOverlayIndexes = [...nextSelection];
  selectedOverlayIndex = multiSelectOverlayIndexes[0] ?? null;
  selectedGroupId = null;
  if (multiSelectOverlayIndexes.length > 0) {
    activeSizeLayer = state.sceneOverlays[multiSelectOverlayIndexes[0]]?.layer || activeSizeLayer;
  }
  renderOverlays();
}

function selectGroup(groupId, layer) {
  multiSelectOverlayIndexes = [];
  selectedGroupId = groupId;
  selectedOverlayIndex = null;
  activeSizeLayer = layer;
  renderOverlays();
}

function selectOverlay(index) {
  setSingleSelection(index);
  multiSelectOverlayIndexes = [];
  $('#sceneOverlays')?.querySelectorAll('.scene-overlay').forEach((image) => {
    const overlayIndex = Number(image.dataset.overlayIndex);
    const overlay = state.sceneOverlays[overlayIndex];
    const isSelected = overlayIndex === index && (!overlay?.groupId || selectedGroupId === null);
    image.classList.toggle('selected', isSelected);
  });
  renderOverlayControls();
}

function applyMode() {
  document.body.classList.toggle('pc-mode', mode === 'pc');
  document.body.classList.toggle('gm-mode', mode === 'gm');
  const roleBadge = $('#roleBadge');
  const connectionStatus = $('#connectionStatus');

  if (mode === 'pc') {
    if (roleBadge) roleBadge.textContent = 'PLAYER VIEW';
    if (connectionStatus) connectionStatus.textContent = '参加者モード';
    document.querySelectorAll('.gm-only').forEach((element) => element.classList.add('gm-only-hidden'));
  } else {
    if (roleBadge) roleBadge.textContent = 'GM EDITOR';
  }
  applyPcBoardVisibility(localStorage.getItem(pcBoardHiddenKey) === 'true');
}

function renderLogs() {
  const el = $('#logList');
  if (!el) return;
  el.innerHTML = state.logs.map((log) =>
    `<div class="log-entry">
      <time>${escapeHtml(log.time)}</time>
      <div>${mode === 'pc' && log.secret ? (log.playerText || '<strong>秘密のダイス</strong>が振られました。') : log.text}</div>
    </div>`
  ).join('');
}

function renderSidebarPlayers() {
  const tabs = $('#sidebarPlayerTabs');
  const list = $('#sidebarPlayerList');
  if (!list) return;
  activeSidebarPlayerIndex = Math.min(activeSidebarPlayerIndex, Math.max(0, state.players.length - 1));
  if (tabs) {
    tabs.innerHTML = state.players.length > 1
      ? state.players.map((player, index) => `<button type="button" class="sidebar-player-tab ${index === activeSidebarPlayerIndex ? 'active' : ''}" data-sidebar-player-tab="${index}" role="tab" aria-selected="${index === activeSidebarPlayerIndex}">${escapeHtml(player.name || '名前未設定')}</button>`).join('')
      : '';
  }
  const visiblePlayers = state.players.length > 1
    ? [state.players[activeSidebarPlayerIndex]]
    : state.players;
  list.innerHTML = visiblePlayers.length
    ? visiblePlayers.map((player) => {
      const index = state.players.indexOf(player);
      return `<article class="sidebar-player-card">
        <div class="sidebar-player-name"><span class="avatar" style="background:${escapeHtml(player.color || '#6b8f8a')}">${escapeHtml(player.initials || 'PC')}</span><strong>${escapeHtml(player.name || '名前未設定')}</strong><i></i></div>
        <div class="sidebar-player-stats">
          <label>HP<input type="number" min="0" value="${escapeHtml(player.currentHP ?? 0)}" data-sidebar-player-index="${index}" data-sidebar-stat="currentHP" ${mode === 'pc' ? 'disabled' : ''}></label>
          <label>SAN<input type="number" min="0" value="${escapeHtml(player.currentSAN ?? 0)}" data-sidebar-player-index="${index}" data-sidebar-stat="currentSAN" ${mode === 'pc' ? 'disabled' : ''}></label>
        </div>
        <div class="sidebar-ability-stats">
          ${participantAbilityKeys.map((key) => `<div><small>${key}</small><strong>${escapeHtml(player.abilities?.[key] ?? '-')}</strong></div>`).join('')}
        </div>
      </article>`;
    }).join('')
    : '<div class="category-layer-empty">参加者未登録</div>';
  renderSidebarSkillTemplates();
}

function renderSessionLibraryLists() {
  const participantList = $('#participantLibraryList');
  const scenarioList = $('#scenarioLibraryList');
  if (participantList) {
    participantList.innerHTML = state.players.length
      ? state.players.map((player, index) => `<div class="session-library-item participant-library-item"><div class="participant-library-main"><span>${escapeHtml(player.name || '名前未設定')}</span><div class="participant-ability-grid">${participantAbilityKeys.map((key) => `<label><small>${key}</small><input type="text" value="${escapeHtml(player.abilities?.[key] ?? '')}" data-library-participant-index="${index}" data-library-ability-key="${key}" aria-label="${escapeHtml(player.name || '参加者')} ${key}"></label>`).join('')}</div></div><button type="button" data-library-participant-delete="${index}" aria-label="参加者を削除">×</button></div>`).join('')
      : '<span class="category-layer-empty">参加者が登録されていません</span>';
  }
  if (scenarioList) {
    scenarioList.innerHTML = state.scenarios.length
      ? state.scenarios.map((scenario, index) => `<div class="session-library-item ${index === activeLibraryScenarioIndex ? 'active' : ''}" data-library-scenario-index="${index}"><span><b>${escapeHtml(scenario.title || '無題のシナリオ')}</b></span><button type="button" data-library-scenario-delete="${index}" aria-label="シナリオを削除">×</button></div>`).join('')
      : '<span class="category-layer-empty">シナリオが登録されていません</span>';
  }
  const editor = $('#scenarioLibraryEditor');
  const titleInput = $('#scenarioLibraryTitleInput');
  const content = $('#scenarioLibraryContent');
  const tabs = $('#scenarioLibraryTabs');
  const scenario = state.scenarios[activeLibraryScenarioIndex];
  if (editor && titleInput && content && tabs) {
    editor.hidden = !scenario;
    if (scenario) {
      titleInput.value = scenario.title || '';
      content.innerHTML = scenario.content || '';
      tabs.innerHTML = state.scenarios.map((entry, index) => `<button type="button" class="${index === activeLibraryScenarioIndex ? 'active' : ''}" data-library-scenario-tab="${index}">${escapeHtml(entry.title || '無題')}</button>`).join('');
    }
  }
}

function getAssetLibrary(category) {
  if (category === 'all') {
    return [
      ...getAssetLibrary('character').map((asset) => ({ ...asset, category: 'character' })),
      ...getAssetLibrary('material').map((asset) => ({ ...asset, category: 'material' })),
      ...getAssetLibrary('icon').map((asset) => ({ ...asset, category: 'icon' })),
      ...getAssetLibrary('background').map((asset) => ({ ...asset, category: 'background' }))
    ];
  }
  if (category === 'background') {
    return state.backgroundLayers.filter((layer) => layer.data).map((layer) => ({ name: layer.name || '背景画像', type: 'image', data: layer.data }));
  }
  if (category === 'character') {
    return state.characterImages.filter((image) => image.data);
  }
  const images = category === 'material' ? state.clueImages : state.sceneImages;
  return (images || []).filter((image) => image.data && image.type !== 'application/pdf');
}

function closeAssetSourceModal() {
  pendingAssetCategory = null;
  const modal = $('#assetSourceModal');
  if (modal) {
    modal.classList.remove('session-library-open');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function openAssetSourceModal(category) {
  pendingAssetCategory = category;
  const modal = $('#assetSourceModal');
  const list = $('#assetLibraryList');
  const title = $('#assetSourceTitle');
  if (!modal || !list) return;
  modal.classList.toggle('session-library-open', category === 'all');
  if (title) title.textContent = category === 'all'
    ? '素材一覧'
    : `${{ character: 'キャラクター', material: '資料', icon: 'アイコン', background: '背景' }[category] || '素材'}を追加`;
  const chooseFileButton = $('#chooseAssetFile');
  if (chooseFileButton) chooseFileButton.hidden = category === 'all';
  document.querySelectorAll('.session-library-section').forEach((section) => {
    section.hidden = category !== 'all';
  });
  renderSessionLibraryLists();
  const assets = getAssetLibrary(category);
  list.innerHTML = assets.length ? assets.map((asset, index) =>
    `<button type="button" class="asset-library-item" data-library-index="${index}" data-library-category="${escapeHtml(asset.category || category)}"><img src="${asset.data}" alt="${escapeHtml(asset.name || '素材')}" loading="lazy"><span>${escapeHtml(asset.name || '素材')}</span></button>`
  ).join('') : '<div class="category-layer-empty">保存済み素材がありません</div>';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function addSavedAsset(category, asset) {
  if (!asset?.data) return;
  if (category === 'background') {
    const layerId = `bg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    state.backgroundLayers.push({ id: layerId, name: asset.name || '背景画像', data: asset.data, visible: true });
    state.backgroundLayerOrder = getBackgroundLayerOrder();
    renderImages();
    renderBackgroundLayerList();
  } else {
    addOverlay({ ...asset, layer: category });
  }
  save();
}

function renderSkillTemplates() {
  const select = $('#skillTemplateSelect');
  const deleteButton = $('#deleteSkillTemplate');
  if (!select) return;
  const selected = select.value;
  const san = state.players[activeSidebarPlayerIndex]?.currentSAN ?? 0;
  const sanOption = mode === 'pc' ? `<option value="builtin-san">SAN (${escapeHtml(san)})</option>` : '';
  select.innerHTML = '<option value="">技能を選択</option>' + sanOption + state.skillTemplates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} (${escapeHtml(template.value)})</option>`)
    .join('');
  if (selected === 'builtin-san' || state.skillTemplates.some((template) => template.id === selected)) select.value = selected;
  if (deleteButton) deleteButton.disabled = !select.value || select.value === 'builtin-san';
}

function renderSidebarSkillTemplates() {
  const select = $('#sidebarSkillTemplateSelect');
  const deleteButton = $('#sidebarSkillDeleteButton');
  if (!select) return;
  const player = state.players[activeSidebarPlayerIndex];
  const skillTemplates = player?.skillTemplates || [];
  const selected = select.value;
  select.innerHTML = '<option value="">技能を選択</option>' + skillTemplates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} (${escapeHtml(template.value)})</option>`)
    .join('');
  if (skillTemplates.some((template) => template.id === selected)) select.value = selected;
  if (deleteButton) deleteButton.disabled = !select.value;
}

function getSkillResult(roll, successValue) {
  if (roll === 1) return 'クリティカル';
  if (roll >= 96) return 'ファンブル';
  if (roll <= Math.floor(successValue / 5)) return 'エクストリーム成功';
  if (roll <= Math.floor(successValue / 2)) return 'ハード成功';
  if (roll <= successValue) return '成功';
  return '失敗';
}

function getBackgroundLayerConfig(layerId) {
  const configs = {
    image: { label: '背景レイヤー', key: 'image', preview: '▣', fixed: false },
    whiteDark: { label: '白暗転', key: 'white', preview: '◼', fixed: true },
    blackDark: { label: '黒暗転', key: 'black', preview: '◼', fixed: true }
  };
  return configs[layerId] || { label: layerId, key: layerId, preview: '◦', fixed: false };
}

function getBackgroundLayerOrder() {
  const fixed = ['whiteDark', 'blackDark'];
  const imageIds = state.backgroundLayers.map((layer) => layer.id);
  const preserved = Array.isArray(state.backgroundLayerOrder)
    ? state.backgroundLayerOrder.filter((layerId) => imageIds.includes(layerId))
    : [];
  return [...new Set([...preserved, ...imageIds, ...fixed])];
}

function getBackgroundLayerVisible(layerId) {
  if (layerId === 'whiteDark' || layerId === 'blackDark') {
    const config = getBackgroundLayerConfig(layerId);
    return Boolean(state.backgroundDimming?.[config.key]);
  }
  const backgroundLayer = state.backgroundLayers.find((layer) => layer.id === layerId);
  return backgroundLayer ? backgroundLayer.visible !== false : false;
}

function getSelectedBackgroundLayer() {
  if (selectedBackgroundLayerId) {
    return state.backgroundLayers.find((layer) => layer.id === selectedBackgroundLayerId) || null;
  }
  return state.backgroundLayers.at(-1) || null;
}

function getBackgroundLayerEntries() {
  return getBackgroundLayerOrder().map((layerId) => {
    if (layerId === 'whiteDark' || layerId === 'blackDark') {
      const config = getBackgroundLayerConfig(layerId);
      return { id: layerId, type: 'fixed', label: config.label, visible: getBackgroundLayerVisible(layerId), preview: config.preview };
    }
    const backgroundLayer = state.backgroundLayers.find((layer) => layer.id === layerId);
    if (!backgroundLayer) return null;
    return {
      id: backgroundLayer.id,
      type: 'image',
      label: backgroundLayer.name || '背景レイヤー',
      visible: backgroundLayer.visible !== false,
      data: backgroundLayer.data,
      x: backgroundLayer.x ?? 50,
      y: backgroundLayer.y ?? 50,
      scale: backgroundLayer.scale ?? state.backgroundScale ?? 100
    };
  }).filter(Boolean);
}

function renderBackgroundLayerList() {
  const list = $('[data-category-layers="background"]');
  if (!list) return;

  const entries = getBackgroundLayerEntries().map((layer) => {
    const isSelected = selectedBackgroundLayerId ? selectedBackgroundLayerId === layer.id : layer.id === getSelectedBackgroundLayer()?.id;
    const isVisible = layer.visible;
    const toggleButton = `<button type="button" class="category-layer-visibility ${isVisible ? 'on' : 'off'}" data-background-action="toggle" data-background-layer-id="${escapeHtml(layer.id)}" title="${isVisible ? '表示中: クリックで非表示' : '非表示: クリックで表示'}" aria-label="${isVisible ? '表示中' : '非表示'}"></button>`;
    const deleteButton = layer.type === 'image' ? `<button type="button" data-background-action="delete" data-background-layer-id="${escapeHtml(layer.id)}" title="削除">×</button>` : '';
    const preview = layer.type === 'image'
      ? `<span class="category-layer-preview"><img src="${layer.data}" alt="${escapeHtml(layer.label)}"></span>`
      : `<span class="category-layer-preview">${escapeHtml(layer.preview)}</span>`;
    return `<div class="category-layer-row background-layer-row ${isSelected ? 'active' : ''} ${isVisible ? 'active' : ''}" data-background-layer-id="${escapeHtml(layer.id)}" draggable="true">${preview}${toggleButton}<span class="category-layer-name"><b>${escapeHtml(layer.label)}</b></span>${deleteButton}</div>`;
  }).join('');

  list.innerHTML = entries || '<span class="category-layer-empty">背景なし</span>';

  list.querySelectorAll('[data-background-action="toggle"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const layerId = button.dataset.backgroundLayerId;
      if (layerId === 'whiteDark' || layerId === 'blackDark') {
        const config = getBackgroundLayerConfig(layerId);
        state.backgroundDimming[config.key] = !state.backgroundDimming[config.key];
      } else {
        const target = state.backgroundLayers.find((layer) => layer.id === layerId);
        if (target) target.visible = !target.visible;
      }
      syncLayerVisibility(layerId, getBackgroundLayerVisible(layerId));
      renderOverlays();
      renderBackgroundLayerList();
      save({ syncState: false, syncLog: false });
    });
  });

  list.querySelectorAll('[data-background-action="delete"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const layerId = button.dataset.backgroundLayerId;
      openDeleteBackgroundConfirm(layerId);
    });
  });

  list.querySelectorAll('.background-layer-row').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      selectedBackgroundLayerId = row.dataset.backgroundLayerId;
      activeSizeLayer = 'background';
      renderOverlays();
      renderBackgroundLayerList();
    });

    row.addEventListener('dragstart', (event) => {
      const layerId = row.dataset.backgroundLayerId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'background-layer', layerId }));
      row.classList.add('dragging');
    });

    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.stopPropagation();
      row.classList.add('drag-over-reorder');
    });

    row.addEventListener('dragleave', () => row.classList.remove('drag-over-reorder'));

    row.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      row.classList.remove('drag-over-reorder');
      try {
        const payload = JSON.parse(event.dataTransfer.getData('text/plain'));
        if (payload.type === 'background-layer' && payload.layerId && payload.layerId !== row.dataset.backgroundLayerId) {
          const fromIndex = getBackgroundLayerOrder().indexOf(payload.layerId);
          const toIndex = getBackgroundLayerOrder().indexOf(row.dataset.backgroundLayerId);
          if (fromIndex >= 0 && toIndex >= 0) {
            const nextOrder = [...getBackgroundLayerOrder()];
            const [moved] = nextOrder.splice(fromIndex, 1);
            nextOrder.splice(toIndex, 0, moved);
            state.backgroundLayerOrder = nextOrder;
            renderBackgroundLayerList();
            renderOverlays();
            save();
          }
        }
      } catch (error) {
        // Safe fail on invalid drop
      }
    });

    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  });
}

function renderOverlays() {
  const overlaysContainer = $('#sceneOverlays');
  if (!overlaysContainer) return;

  const backgroundHtml = getBackgroundLayerEntries()
    .filter((layer) => layer.type === 'image' && layer.visible)
    .map((layer, index) => {
      const scale = layer.scale ?? state.backgroundScale ?? 100;
      const x = layer.x ?? 50;
      const y = layer.y ?? 50;
      const isBackgroundSelected = selectedBackgroundLayerId ? selectedBackgroundLayerId === layer.id : layer.id === getSelectedBackgroundLayer()?.id;
      const layerStyle = `position:absolute;inset:0;background-image:url('${layer.data}');background-size:${scale}% auto;background-position:${x}% ${y}%;z-index:${index + 1};pointer-events:auto;cursor:grab;${isBackgroundSelected ? 'outline:2px solid var(--accent); outline-offset:-2px;' : ''}`;
      return `<div class="scene-background-layer" data-background-layer-id="${escapeHtml(layer.id)}" style="${layerStyle}"></div>`;
    }).join('');

  const overlayHtml = state.sceneOverlays.map((overlay, index) => {
    const isGroupMember = Boolean(overlay.groupId);
    const isSelected = selectedGroupId !== null ? overlay.groupId === selectedGroupId : (multiSelectOverlayIndexes.includes(index) || selectedOverlayIndex === index);
    const groupVisible = overlay.groupId ? getGroupEffectiveVisible(overlay.groupId) : true;
    const isVisible = overlay.visible && groupVisible;
    return `<img class="scene-overlay ${isSelected ? 'selected' : ''} ${isGroupMember ? 'group-member' : ''}" data-overlay-index="${index}" src="${overlay.data}" alt="${escapeHtml(overlay.name)}" title="${escapeHtml(overlay.name)}" style="left:${overlay.x}%;top:${overlay.y}%;width:${overlay.size}px;z-index:${300 + index};transform:translate(-50%, -50%) rotate(${overlay.rotation}deg);display:${isVisible ? 'block' : 'none'}">`;
  }).join('');

  const dimmerHtml = getBackgroundLayerEntries()
    .filter((layer) => layer.type === 'fixed' && layer.visible)
    .map((layer) => {
      const isWhite = layer.id === 'whiteDark';
      const bg = isWhite ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.7)';
      return `<div class="scene-background-dim ${escapeHtml(layer.id)}" style="position:absolute;inset:0;background:${bg};z-index:${layer.id === 'whiteDark' ? 200 : 201};pointer-events:none;opacity:1;"></div>`;
    }).join('');

  overlaysContainer.innerHTML = `${backgroundHtml}${dimmerHtml}${overlayHtml}`;

  overlaysContainer.querySelectorAll('.scene-background-layer').forEach((layerElement) => {
    layerElement.addEventListener('pointerdown', (event) => {
      const layerId = layerElement.dataset.backgroundLayerId;
      const layer = state.backgroundLayers.find((entry) => entry.id === layerId);
      if (!layer) return;
      selectedBackgroundLayerId = layerId;
      activeSizeLayer = 'background';
      renderBackgroundLayerList();
      renderOverlayControls();
      if (state.backgroundLocked) return;
      startDraggingBackgroundLayer(event, layer);
    });
  });

  overlaysContainer.querySelectorAll('.scene-overlay').forEach((image) => {
    image.addEventListener('pointerdown', (event) => {
      const overlayIndex = Number(image.dataset.overlayIndex);
      const overlay = state.sceneOverlays[overlayIndex];
      if (!overlay) return;

      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        if (!overlay.groupId) toggleMultiSelection(overlayIndex);
        return;
      }
      if (overlay.groupId) {
        selectGroup(overlay.groupId, overlay.layer || 'material');
      } else {
        selectOverlay(overlayIndex);
      }
      startDraggingOverlay(event, image);
    });
  });

  renderOverlayControls();
}

function renderOverlayControls() {
  const controls = $('#overlayControls');
  if (!controls) return;

  const groupMembers = selectedGroupId !== null ? getGroupMembers(selectedGroupId) : getSelectedOverlayIndexes();
  const overlay = selectedGroupId !== null ? state.sceneOverlays[groupMembers[0]] : state.sceneOverlays[selectedOverlayIndex];
  renderSizeBoxes();

  const isBackground = activeSizeLayer === 'background';
  const targetOverlay = isBackground ? null : overlay;
  const backgroundLayer = getSelectedBackgroundLayer();

  controls.classList.toggle('has-selection', Boolean(overlay || backgroundLayer || state.backgroundLayers.length));

  const nameEl = $('#overlayControlName');
  if (nameEl) {
    if (selectedGroupId !== null) {
      nameEl.textContent = `グループ:${state.layerGroups.find((g) => g.id === selectedGroupId)?.name || 'グループ'}`;
    } else if (multiSelectOverlayIndexes.length > 1) {
      nameEl.textContent = `複数選択: ${multiSelectOverlayIndexes.length}枚`;
    } else {
      nameEl.textContent = isBackground
        ? (backgroundLayer ? backgroundLayer.name || '背景画像' : '背景画像')
        : (targetOverlay ? targetOverlay.name : `${activeSizeLayer === 'character' ? 'キャラクター' : activeSizeLayer === 'material' ? '資料' : 'アイコン'}を選択`);
    }
  }

  ['rotateLeft', 'rotateRight', 'deleteOverlay'].forEach((id) => {
    const button = $(`#${id}`);
    if (button) button.style.display = isBackground ? 'none' : '';
  });
}

function renderSizeBoxes() {
  renderCategoryLayerLists();
  applySizeBoxLayouts();

  ['character', 'material', 'icon'].forEach((layer) => {
    const matching = state.sceneOverlays.map((overlay, index) => ({ overlay, index })).filter(({ overlay }) => (overlay.layer || 'material') === layer);
    const activeIndexes = getSelectedOverlayIndexes().filter((index) => state.sceneOverlays[index] && (state.sceneOverlays[index].layer || 'material') === layer);
    const selected = activeIndexes.length ? activeIndexes[0] : (matching[0]?.index ?? null);

    const input = $(`[data-size-input="${layer}"]`);
    if (input) {
      const box = input.closest('.size-box');
      if (box) box.classList.toggle('is-empty', matching.length === 0);
      input.value = selected !== null ? state.sceneOverlays[selected].size : 110;
      input.disabled = !matching.length;
    }
  });

  const bgInput = $('[data-size-input="background"]');
  if (bgInput) {
    const bgBox = bgInput.closest('.size-box');
    if (bgBox) bgBox.classList.toggle('is-empty', !state.backgroundLayers.length);
    const backgroundScaleValue = getSelectedBackgroundLayer()?.scale ?? state.backgroundScale ?? 100;
    bgInput.value = backgroundScaleValue;
  }
  const backgroundLockButton = $('[data-background-lock]');
  if (backgroundLockButton) {
    backgroundLockButton.textContent = state.backgroundLocked ? '🔒' : '🔓';
    backgroundLockButton.title = state.backgroundLocked ? '背景のロックを解除' : '背景をロック';
    backgroundLockButton.setAttribute('aria-label', backgroundLockButton.title);
    backgroundLockButton.classList.toggle('is-locked', state.backgroundLocked);
  }
}

function applySizeBoxLayouts() {
  document.querySelectorAll('[data-size-box]').forEach((box) => {
    const layout = state.sizeBoxLayouts[box.dataset.sizeBox];
    if (!layout) return;
    box.style.left = `${layout.left}px`;
    box.style.top = `${layout.top}px`;
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.width = `${layout.width}px`;
    box.style.height = `${layout.height}px`;
  });
}

function saveSizeBoxLayout(box) {
  const bounds = box.getBoundingClientRect();
  state.sizeBoxLayouts[box.dataset.sizeBox] = {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
  save();
}

function setupSizeBoxInteractions() {
  document.querySelectorAll('[data-size-box]').forEach((box) => {
    const dragEl = box.querySelector('.size-box-drag');
    if (dragEl) {
      dragEl.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const bounds = box.getBoundingClientRect();
        const move = (moveEvent) => {
          box.style.left = `${Math.max(0, bounds.left + moveEvent.clientX - startX)}px`;
          box.style.top = `${Math.max(0, bounds.top + moveEvent.clientY - startY)}px`;
          box.style.right = 'auto';
          box.style.bottom = 'auto';
        };
        const stop = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', stop);
          saveSizeBoxLayout(box);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', stop);
      });
    }

    const resizeEl = box.querySelector('.size-box-resize');
    if (resizeEl) {
      resizeEl.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const bounds = box.getBoundingClientRect();
        const move = (moveEvent) => {
          box.style.width = `${Math.max(170, bounds.width + moveEvent.clientX - startX)}px`;
          box.style.height = `${Math.max(110, bounds.height + moveEvent.clientY - startY)}px`;
        };
        const stop = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', stop);
          saveSizeBoxLayout(box);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', stop);
      });
    }
  });
}

function getGroupMembers(groupId) {
  return state.sceneOverlays
    .map((overlay, index) => ({ overlay, index }))
    .filter(({ overlay }) => overlay.groupId === groupId)
    .map(({ index }) => index);
}

function getGroupEffectiveVisible(groupId) {
  const group = state.layerGroups.find((entry) => entry.id === groupId);
  return group ? group.visible !== false : true;
}

function reindexLayerGroups(layer) {
  const groups = state.layerGroups.filter((group) => group.layer === layer).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  groups.forEach((group, index) => {
    group.order = index;
  });
}

function getLayerEntries(layer) {
  const groupEntries = state.layerGroups
    .filter((group) => group.layer === layer)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((group) => ({ type: 'group', groupId: group.id, order: Number.isFinite(group.order) ? group.order : 0, group }));

  const overlayEntries = state.sceneOverlays
    .map((overlay, index) => ({ type: 'overlay', index, order: Number.isFinite(overlay.order) ? overlay.order : index, overlay }))
    .filter(({ overlay }) => (overlay.layer || 'material') === layer && overlay.groupId === null)
    .sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index));

  return [...groupEntries, ...overlayEntries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function applyLayerEntryOrder(layer, entries) {
  const normalizedEntries = entries.filter((entry) => {
    if (entry.type === 'group') {
      return Boolean(state.layerGroups.find((item) => item.id === entry.groupId && item.layer === layer));
    }
    return Boolean(state.sceneOverlays[entry.index] && (state.sceneOverlays[entry.index].layer || 'material') === layer);
  });

  normalizedEntries.forEach((entry, index) => {
    if (entry.type === 'group') {
      const group = state.layerGroups.find((item) => item.id === entry.groupId);
      if (group) group.order = index;
    } else if (state.sceneOverlays[entry.index]) {
      state.sceneOverlays[entry.index].order = index;
    }
  });
}

function syncLayerOrders(layer) {
  const entries = getLayerEntries(layer);
  applyLayerEntryOrder(layer, entries);
}

function addGroupLayer(layer, nameOverride) {
  const groupId = `group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const currentGroups = state.layerGroups.filter((group) => group.layer === layer);
  const baseName = nameOverride && nameOverride.trim() ? nameOverride.trim() : `グループレイヤー ${currentGroups.length + 1}`;
  state.layerGroups.push({ id: groupId, name: baseName, layer, memberIndexes: [], expanded: true, order: currentGroups.length, visible: true });
  reindexLayerGroups(layer);
  syncLayerOrders(layer);
  selectedGroupId = groupId;
  selectedOverlayIndex = null;
  multiSelectOverlayIndexes = [];
  renderOverlays();
  save({ syncState: false, syncLog: false });
}

function addOverlayToGroup(groupId, overlayIndex) {
  if (!groupId || overlayIndex === null || overlayIndex === undefined || !state.sceneOverlays[overlayIndex]) return;
  const group = state.layerGroups.find((entry) => entry.id === groupId);
  if (!group) return;
  const overlay = state.sceneOverlays[overlayIndex];
  if (overlay.groupId && overlay.groupId !== groupId) {
    const previousGroup = state.layerGroups.find((entry) => entry.id === overlay.groupId);
    if (previousGroup) previousGroup.memberIndexes = previousGroup.memberIndexes.filter((i) => i !== overlayIndex);
  }
  if (!group.memberIndexes.includes(overlayIndex)) group.memberIndexes.push(overlayIndex);
  overlay.groupId = groupId;
  selectedGroupId = groupId;
  selectedOverlayIndex = overlayIndex;
  renderOverlays();
  save();
}

function moveLayerEntryWithinLayer(payload, target, layer) {
  if (!payload || !target || !layer) return;
  const entries = getLayerEntries(layer);
  const sourceMatcher = payload.type === 'group'
    ? (entry) => entry.type === 'group' && entry.groupId === payload.groupId
    : (entry) => entry.type === 'overlay' && entry.index === payload.index;
  const targetMatcher = target.type === 'group'
    ? (entry) => entry.type === 'group' && entry.groupId === target.groupId
    : (entry) => entry.type === 'overlay' && entry.index === target.index;

  const sourceIndex = entries.findIndex(sourceMatcher);
  const targetIndex = entries.findIndex(targetMatcher);
  if (sourceIndex < 0 || targetIndex < 0 || (payload.type === target.type && sourceIndex === targetIndex)) return;

  const [source] = entries.splice(sourceIndex, 1);
  const insertionIndex = Math.max(0, Math.min(targetIndex, entries.length));
  entries.splice(insertionIndex, 0, source);
  applyLayerEntryOrder(layer, entries);
  renderOverlays();
  save();
}

function handleLayerDrop(payload, target, layer) {
  if (!payload || !target || !layer) return;
  if (payload.layer && payload.layer !== layer) return;

  if (payload.type === 'overlay' && payload.groupId && target.type === 'group' && target.groupId && payload.groupId !== target.groupId) {
    const sourceGroup = state.layerGroups.find((g) => g.id === payload.groupId);
    if (sourceGroup) sourceGroup.memberIndexes = sourceGroup.memberIndexes.filter((i) => i !== payload.index);
    state.sceneOverlays[payload.index].groupId = null;
    addOverlayToGroup(target.groupId, payload.index);
    return;
  }

  if (payload.type === 'overlay' && payload.groupId && target.type === 'overlay' && payload.index !== target.index) {
    const sourceGroup = state.layerGroups.find((g) => g.id === payload.groupId);
    if (sourceGroup) sourceGroup.memberIndexes = sourceGroup.memberIndexes.filter((i) => i !== payload.index);
    if (state.sceneOverlays[payload.index]) state.sceneOverlays[payload.index].groupId = null;
    moveLayerEntryWithinLayer({ type: 'overlay', index: payload.index, layer }, target, layer);
    return;
  }

  if (payload.type === 'overlay' && target.type === 'group') {
    if (target.mode === 'insert' && Number.isInteger(payload.index) && target.groupId) {
      addOverlayToGroup(target.groupId, payload.index);
      return;
    }
    moveLayerEntryWithinLayer(payload, target, layer);
    return;
  }

  if (payload.type === 'group') {
    if ((target.type === 'group' && payload.groupId !== target.groupId) || target.type === 'overlay') {
      moveLayerEntryWithinLayer(payload, target, layer);
      return;
    }
  }

  if (payload.type === 'overlay' && target.type === 'overlay' && payload.index !== target.index) {
    moveLayerEntryWithinLayer(payload, target, layer);
  }
}

function renderCategoryLayerLists() {
  renderBackgroundLayerList();
  ['character', 'material', 'icon'].forEach((layer) => {
    syncLayerOrders(layer);
    const list = $(`[data-category-layers="${layer}"]`);
    if (!list) return;

    const rows = getLayerEntries(layer).map((entry) => {
      if (entry.type === 'group') {
        const group = state.layerGroups.find((item) => item.id === entry.groupId);
        if (!group) return '';
        const memberIndexes = getGroupMembers(group.id);
        const orderedMemberIndexes = [...memberIndexes].sort((a, b) => b - a);
        const firstIndex = orderedMemberIndexes[0];
        const firstOverlay = firstIndex !== undefined ? state.sceneOverlays[firstIndex] : null;
        const preview = firstOverlay ? `<span class="category-layer-preview"><img src="${firstOverlay.data}" alt="${escapeHtml(firstOverlay.name)}"></span>` : '<span class="category-layer-preview">◎</span>';
        const groupVisible = getGroupEffectiveVisible(group.id);

        const memberRows = orderedMemberIndexes.length ? orderedMemberIndexes.map((memberIndex) => {
          const memberOverlay = state.sceneOverlays[memberIndex];
          return `<div class="category-layer-row ${selectedOverlayIndex === memberIndex ? 'active' : ''}" data-category-index="${memberIndex}" draggable="true">
            <span class="category-layer-preview"><img src="${memberOverlay.data}" alt="${escapeHtml(memberOverlay.name)}"></span>
            <button type="button" class="category-layer-visibility ${memberOverlay.visible ? 'on' : 'off'}" data-category-action="toggle" title="${memberOverlay.visible ? '表示中: クリックで非表示' : '非表示: クリックで表示'}"></button>
            <span class="category-layer-name" data-layer-name="${escapeHtml(memberOverlay.name)}"><b>${escapeHtml(memberOverlay.name)}</b></span>
            <button type="button" data-category-action="delete" title="削除">×</button>
          </div>`;
        }).join('') : '<span class="category-layer-empty">画像をドロップ</span>';

        return `<div class="group-layer-container ${selectedGroupId === group.id ? 'active' : ''}" data-group-id="${escapeHtml(group.id)}" data-group-layer="${layer}">
          <div class="category-layer-row group-row ${selectedGroupId === group.id ? 'active' : ''}" data-group-id="${escapeHtml(group.id)}" draggable="true">
            <span class="category-layer-group-mark">◎</span>${preview}
            <span class="group-layer-name" data-group-name="${escapeHtml(group.name || 'グループ')}" data-drop-role="group-name"><b>${escapeHtml(group.name || 'グループ')} (${memberIndexes.length})</b></span>
            <button type="button" class="category-layer-visibility ${groupVisible ? 'on' : 'off'}" data-group-action="toggle-visibility" title="${groupVisible ? '表示中: クリックで非表示' : '非表示: クリックで表示'}"></button>
            <button type="button" class="group-layer-toggle" data-group-action="toggle-expand" data-group-id="${escapeHtml(group.id)}" title="${group.expanded === false ? '展開' : '折りたたみ'}">${group.expanded === false ? '＋' : '−'}</button>
            <button type="button" class="group-layer-ungroup" data-group-action="ungroup" title="グループ解除">×</button>
          </div>
          <div class="group-member-list ${group.expanded === false ? 'collapsed' : ''}">${memberRows}</div>
        </div>`;
      }

      const overlay = state.sceneOverlays[entry.index];
      if (!overlay) return '';
      return `<div class="category-layer-row ${selectedOverlayIndex === entry.index ? 'active' : ''}" data-category-index="${entry.index}" draggable="true">
        <span class="category-layer-preview"><img src="${overlay.data}" alt="${escapeHtml(overlay.name)}"></span>
        <button type="button" class="category-layer-visibility ${overlay.visible ? 'on' : 'off'}" data-category-action="toggle" title="${overlay.visible ? '表示中: クリックで非表示' : '非表示: クリックで表示'}"></button>
        <span class="category-layer-name"><b>${escapeHtml(overlay.name)}</b></span>
        <button type="button" data-category-action="delete" title="削除">×</button>
      </div>`;
    });

    list.innerHTML = rows.length ? rows.join('') : '<span class="category-layer-empty">レイヤーなし</span>';

    // イベントバインド
    list.querySelectorAll('[data-group-action="toggle-visibility"]').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = button.closest('.group-row')?.dataset.groupId;
        const group = state.layerGroups.find((g) => g.id === groupId);
        if (group) {
          group.visible = !getGroupEffectiveVisible(group.id);
          renderOverlays();
          save();
        }
      });
    });

    list.querySelectorAll('.group-layer-toggle').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const group = state.layerGroups.find((g) => g.id === button.dataset.groupId);
        if (group) {
          group.expanded = !group.expanded;
          renderOverlays();
          save();
        }
      });
    });

    list.querySelectorAll('.group-layer-ungroup').forEach((button) => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = button.closest('.category-layer-row')?.dataset.groupId;
        if (groupId) openUngroupConfirm(groupId);
      });
    });

    list.querySelectorAll('.group-layer-container').forEach((container) => {
      container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isGroupInsert = Boolean(e.target.closest('.group-layer-name'));
        container.classList.toggle('drag-over-reorder', !isGroupInsert);
        container.classList.toggle('drag-over-group', isGroupInsert);
      });
      container.addEventListener('dragleave', () => {
        container.classList.remove('drag-over', 'drag-over-reorder', 'drag-over-group');
      });
      container.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over', 'drag-over-reorder', 'drag-over-group');
        const isGroupInsert = Boolean(e.target.closest('.group-layer-name'));
        try {
          const payload = JSON.parse(e.dataTransfer.getData('text/plain'));
          handleLayerDrop(payload, { type: 'group', groupId: container.dataset.groupId, mode: isGroupInsert ? 'insert' : 'reorder' }, layer);
        } catch (error) {
          // Fallback handling
        }
      });
    });

    list.querySelectorAll('.category-layer-row').forEach((row) => {
      const groupId = row.dataset.groupId;
      if (groupId) {
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          selectGroup(groupId, layer);
        });
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'group', groupId, layer }));
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
      }

      const index = Number(row.dataset.categoryIndex);
      if (Number.isNaN(index)) return;

      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-category-action]') || e.target.closest('.group-layer-toggle') || e.target.closest('.group-layer-ungroup')) return;
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleMultiSelection(index);
          return;
        }
        setSingleSelection(index);
        activeSizeLayer = layer;
        renderOverlays();
      });

      const toggleBtn = row.querySelector('[data-category-action="toggle"]');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setSingleSelection(index);
          updateSelectedOverlay({ visible: !state.sceneOverlays[index].visible });
        });
      }

      const deleteBtn = row.querySelector('[data-category-action="delete"]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedOverlayIndex = index;
          openDeleteConfirm(index);
        });
      }

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        const overlay = state.sceneOverlays[index];
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'overlay', index, layer, groupId: overlay?.groupId || null }));
        row.classList.add('dragging');
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.add('drag-over-reorder');
      });

      row.addEventListener('dragleave', () => row.classList.remove('drag-over-reorder'));

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove('drag-over-reorder');
        try {
          const payload = JSON.parse(e.dataTransfer.getData('text/plain'));
          handleLayerDrop(payload, { type: 'overlay', index }, layer);
        } catch (error) {
          // Safe fail
        }
      });

      row.addEventListener('dragend', () => row.classList.remove('dragging'));
    });
  });
}

function updateSelectedOverlay(update) {
  const selectedIndexes = getSelectedOverlayIndexes();
  if (selectedGroupId !== null || selectedIndexes.length > 1 || multiSelectOverlayIndexes.length > 1) {
    selectedIndexes.forEach((index) => {
      if (state.sceneOverlays[index]) {
        Object.assign(state.sceneOverlays[index], update);
        if (update.visible !== undefined) syncOverlayVisibility(index, state.sceneOverlays[index].visible);
      }
    });
    renderOverlays();
    save({ syncState: update.visible === undefined, syncLog: update.visible === undefined });
    return;
  }
  const index = selectedOverlayIndex ?? selectedIndexes[0];
  if (index === null || index === undefined || !state.sceneOverlays[index]) return;
  Object.assign(state.sceneOverlays[index], update);
  if (update.visible !== undefined) syncOverlayVisibility(index, state.sceneOverlays[index].visible);
  renderOverlays();
  save({ syncState: update.visible === undefined, syncLog: update.visible === undefined });
}

function renderImages() {
  const banner = $('#sessionBanner');
  const spotlight = $('#spotlightImage');
  const visibleBackground = getBackgroundLayerEntries().filter((layer) => layer.type === 'image' && layer.visible);
  if (banner) banner.classList.toggle('has-image', visibleBackground.length > 0);
  if (spotlight) {
    spotlight.src = state.characterImage || '';
    if (spotlight.parentElement) spotlight.parentElement.classList.toggle('has-image', Boolean(state.characterImage));
  }
  renderOverlays();
}

function render() {
  renderBgm();
  renderSidebarPlayers();
  renderSidebarSkillTemplates();
  renderLogs();
  renderSkillTemplates();
  renderImages();
  renderBackgroundLayerList();
}

async function loadBundledAssets() {
  if (mode !== 'gm') return;
  try {
    const response = await fetch('/api/assets/catalog');
    if (!response.ok) return;
    const catalog = await response.json();
    let changed = false;
    catalog.forEach((asset) => {
      const image = { name: asset.name, type: '', data: asset.data, layer: asset.category };
      if (asset.category === 'background') {
        if (!state.backgroundLayers.some((layer) => layer.data === image.data)) {
          state.backgroundLayers.push({ id: `bundled-${asset.name}`, ...image, visible: true });
          changed = true;
        }
      } else if (asset.category === 'character') {
        if (!state.characterImages.some((entry) => entry.data === image.data)) {
          state.characterImages.push(image);
          changed = true;
        }
      } else {
        const target = asset.category === 'material' ? state.clueImages : state.sceneImages;
        if (!target.some((entry) => entry.data === image.data)) {
          target.push(image);
          changed = true;
        }
      }
    });
    if (changed) {
      state.backgroundLayerOrder = getBackgroundLayerOrder();
      render();
      save({ includeAssets: true });
    }
  } catch (error) {
    console.error('Failed to load bundled assets:', error);
  }
}

function readBackgroundImages(files) {
  Array.from(files || []).forEach((file) => {
    const reader = new FileReader();
    reader.addEventListener('load', async () => {
      const layerId = `bg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      let assetUrl;
      try {
        assetUrl = await uploadAsset(file.name, reader.result);
      } catch (error) {
        console.error(error);
        return;
      }
      const alreadyExists = state.backgroundLayers.some((layer) => layer.data === assetUrl && layer.name === file.name);
      if (!alreadyExists) {
        const layer = { id: layerId, name: file.name, data: assetUrl, visible: true };
        state.backgroundLayers.push(layer);
        state.backgroundLayerOrder = getBackgroundLayerOrder();
        syncAssetAdd('background', layer);
      }
      renderImages();
      renderBackgroundLayerList();
      save({ deferLocalSave: true });
    });
    reader.readAsDataURL(file);
  });
}

function readImages(files, stateKey) {
  const defaultLayer = stateKey === 'clueImages' ? 'material' : 'icon';
  Array.from(files || []).forEach((file) => {
    const reader = new FileReader();
    reader.addEventListener('load', async () => {
      let assetUrl;
      try {
        assetUrl = await uploadAsset(file.name, reader.result);
      } catch (error) {
        console.error(error);
        return;
      }
      const image = { name: file.name, type: file.type, data: assetUrl, layer: defaultLayer };
      state[stateKey].push(image);
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        const overlay = createOverlay({ ...image, layer: image.layer || defaultLayer });
        state.sceneOverlays.push(overlay);
        selectedOverlayIndex = state.sceneOverlays.length - 1;
        activeSizeLayer = image.layer || defaultLayer;
        renderOverlays();
        syncAssetAdd(stateKey, image, overlay);
      }
      save({ deferLocalSave: true });
    });
    reader.readAsDataURL(file);
  });
}

function createOverlay(image) {
  return { name: image.name, data: image.data, layer: image.layer || 'material', x: 50, y: 50, size: 110, rotation: 0, visible: true, groupId: null };
}

async function uploadAsset(fileName, data) {
  const response = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fileName, data })
  });
  if (!response.ok) throw new Error(`Asset upload failed: ${response.status}`);
  const result = await response.json();
  return result.url;
}

function addOverlay(image) {
  state.sceneOverlays.push(createOverlay(image));
  selectedOverlayIndex = state.sceneOverlays.length - 1;
  selectedGroupId = null;
  activeSizeLayer = image.layer || 'material';
  renderOverlays();
  save();
}

function ungroupGroup(groupId) {
  const members = getGroupMembers(groupId);
  members.forEach((index) => { if (state.sceneOverlays[index]) state.sceneOverlays[index].groupId = null; });
  state.layerGroups = state.layerGroups.filter((group) => group.id !== groupId);
  selectedGroupId = null;
  selectedOverlayIndex = members[0] ?? null;
  renderOverlays();
  save();
}

function createGroupFromSelection() {
  const candidateIndexes = multiSelectOverlayIndexes.length > 0 ? [...multiSelectOverlayIndexes] : (selectedGroupId !== null ? getGroupMembers(selectedGroupId) : (selectedOverlayIndex !== null ? [selectedOverlayIndex] : []));
  const validIndexes = [...new Set(candidateIndexes.filter((index) => Number.isInteger(index) && state.sceneOverlays[index] && !state.sceneOverlays[index].groupId))];
  if (validIndexes.length < 2) return;

  const baseIndex = validIndexes[0];
  const baseLayer = state.sceneOverlays[baseIndex].layer || 'material';
  const groupId = `group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  validIndexes.forEach((index) => {
    if (state.sceneOverlays[index]) state.sceneOverlays[index].groupId = groupId;
  });

  state.layerGroups.push({ id: groupId, name: `グループ ${state.layerGroups.length + 1}`, layer: baseLayer, memberIndexes: validIndexes });
  selectedGroupId = groupId;
  selectedOverlayIndex = null;
  multiSelectOverlayIndexes = [];
  renderOverlays();
  save();
}

function startDraggingBackgroundLayer(event, layer) {
  if (mode === 'pc') return;
  event.preventDefault();
  const banner = $('#sceneOverlays');
  if (!banner) return;

  const startX = event.clientX;
  const startY = event.clientY;
  const startPosition = { x: layer.x ?? 50, y: layer.y ?? 50 };

  const move = (moveEvent) => {
    const bounds = banner.getBoundingClientRect();
    const deltaX = ((moveEvent.clientX - startX) / bounds.width) * 100;
    const deltaY = ((moveEvent.clientY - startY) / bounds.height) * 100;
    layer.x = Math.max(0, Math.min(100, startPosition.x + deltaX));
    layer.y = Math.max(0, Math.min(100, startPosition.y + deltaY));
    renderOverlays();
    syncImageTransform('background', layer.id, layer);
  };

  const stop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    save({ includeAssets: true });
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', stop);
}

function startDraggingOverlay(event, image) {
  if (mode === 'pc') return;
  event.preventDefault();
  const overlayIndex = Number(image.dataset.overlayIndex);
  const targetGroupId = state.sceneOverlays[overlayIndex]?.groupId || null;
  const affectedIndexes = targetGroupId ? getGroupMembers(targetGroupId) : [overlayIndex];
  const affectedObjects = affectedIndexes.map((index) => state.sceneOverlays[index]).filter(Boolean);
  const banner = $('#sessionBanner');
  if (!banner) return;

  const startX = event.clientX;
  const startY = event.clientY;
  const startPositions = affectedObjects.map((item) => ({ x: item.x, y: item.y }));

  const move = (moveEvent) => {
    const bounds = banner.getBoundingClientRect();
    const deltaX = ((moveEvent.clientX - startX) / bounds.width) * 100;
    const deltaY = ((moveEvent.clientY - startY) / bounds.height) * 100;

    affectedObjects.forEach((item, idx) => {
      item.x = Math.max(3, Math.min(97, startPositions[idx].x + deltaX));
      item.y = Math.max(5, Math.min(95, startPositions[idx].y + deltaY));
    });

    $('#sceneOverlays')?.querySelectorAll('.scene-overlay').forEach((node) => {
      const idx = Number(node.dataset.overlayIndex);
      if (affectedIndexes.includes(idx)) {
        const item = state.sceneOverlays[idx];
        node.style.left = `${item.x}%`;
        node.style.top = `${item.y}%`;
      }
    });
    affectedObjects.forEach((item, idx) => syncImageTransform('overlay', affectedIndexes[idx], item));
  };

  const stop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    save({ includeAssets: true });
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', stop);
}

function openViewer(source, isPdf = false) {
  const imgEl = $('#viewerImage');
  const pdfEl = $('#viewerPdf');
  const modal = $('#imageViewer');

  if (imgEl) imgEl.style.display = isPdf ? 'none' : 'block';
  if (pdfEl) pdfEl.style.display = isPdf ? 'block' : 'none';

  if (isPdf && pdfEl) pdfEl.src = source;
  else if (imgEl) imgEl.src = source;

  if (modal) modal.classList.add('open');
}

function closeViewer() {
  const modal = $('#imageViewer');
  if (modal) modal.classList.remove('open');
  const imgEl = $('#viewerImage');
  const pdfEl = $('#viewerPdf');
  if (imgEl) imgEl.src = '';
  if (pdfEl) pdfEl.src = '';
}

function openDeleteConfirm(index) {
  if (index === null || !state.sceneOverlays[index]) return;
  pendingDeleteIndex = index;
  pendingDeleteGroupId = null;
  pendingDeleteBackgroundLayerId = null;

  const msg = $('#confirmMessage');
  if (msg) msg.textContent = `${state.sceneOverlays[index].name} を削除しますか？`;

  const modal = $('#confirmModal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'grid';
  }
}

function openDeleteBackgroundConfirm(layerId) {
  const layer = state.backgroundLayers.find((entry) => entry.id === layerId);
  if (!layer) return;
  pendingDeleteBackgroundLayerId = layerId;
  pendingDeleteIndex = null;
  pendingDeleteGroupId = null;

  const msg = $('#confirmMessage');
  if (msg) msg.textContent = `${layer.name || '背景画像'} を削除しますか？`;

  const modal = $('#confirmModal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'grid';
  }
}

function openDeleteGroupConfirm(groupId) {
  if (!groupId) return;
  pendingDeleteGroupId = groupId;
  pendingDeleteIndex = null;
  pendingDeleteBackgroundLayerId = null;
  const group = state.layerGroups.find((entry) => entry.id === groupId);

  const msg = $('#confirmMessage');
  if (msg) msg.textContent = `${group?.name || 'グループ'} を削除しますか？`;

  const modal = $('#confirmModal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'grid';
  }
}

function closeDeleteConfirm() {
  pendingDeleteIndex = null;
  pendingDeleteGroupId = null;
  pendingDeleteBackgroundLayerId = null;
  pendingUngroupGroupId = null;
  const modal = $('#confirmModal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
  }
}

function openGroupNameModal(layer) {
  if (!layer) return;
  pendingGroupLayerCategory = layer;
  const defaultName = `グループ ${state.layerGroups.filter((g) => g.layer === layer).length + 1}`;
  const input = $('#groupNameInput');
  if (input) input.value = defaultName;

  const modal = $('#groupNameModal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'grid';
  }
  window.setTimeout(() => {
    if (input) {
      input.focus();
      input.select();
    }
  }, 0);
}

function closeGroupNameModal() {
  pendingGroupLayerCategory = null;
  const modal = $('#groupNameModal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
  }
}

function openUngroupConfirm(groupId) {
  if (!groupId) return;
  pendingUngroupGroupId = groupId;
  pendingDeleteIndex = null;
  pendingDeleteGroupId = null;
  const group = state.layerGroups.find((entry) => entry.id === groupId);

  const msg = $('#confirmMessage');
  if (msg) msg.textContent = `${group?.name || 'グループ'} を解除しますか？`;

  const modal = $('#confirmModal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'grid';
  }
}

// イベントリスナーのセットアップ
function setupEventListeners() {
  $('#exportBtn')?.addEventListener('click', exportStateToJson);
  $('#importFileInput')?.addEventListener('change', (event) => {
    importStateFromJson(event.target.files?.[0]);
    event.target.value = '';
  });
  $('#bgmUploadButton')?.addEventListener('click', () => $('#bgmUpload')?.click());
  $('#bgmUpload')?.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    files.forEach((file, index) => loadBgm(file, index === files.length - 1));
    event.target.value = '';
  });
  $('#bgmSelect')?.addEventListener('change', async (event) => {
    const track = state.bgmTracks.find((entry) => entry.id === event.target.value);
    await selectBgmTrack(track);
  });
  $('#bgmTrackList')?.addEventListener('click', async (event) => {
    const selectButton = event.target.closest('[data-bgm-select]');
    if (selectButton) {
      await selectBgmTrack(state.bgmTracks.find((track) => track.id === selectButton.dataset.bgmSelect));
      return;
    }
    const deleteButton = event.target.closest('[data-bgm-delete]');
    if (!deleteButton) return;
    const track = state.bgmTracks.find((entry) => entry.id === deleteButton.dataset.bgmDelete);
    if (!track || !window.confirm(`${track.name} を削除しますか？`)) return;
    const wasActive = state.bgm.data === track.data;
    state.bgmTracks = state.bgmTracks.filter((entry) => entry.id !== track.id);
    if (wasActive) await selectBgmTrack(state.bgmTracks[0]);
    else { renderBgm(); save(); }
  });
  $('#bgmTrackList')?.addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-bgm-track-id]');
    if (!row) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.bgmTrackId);
    row.classList.add('dragging');
  });
  $('#bgmTrackList')?.addEventListener('dragover', (event) => {
    if (event.target.closest('[data-bgm-track-id]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  });
  $('#bgmTrackList')?.addEventListener('drop', (event) => {
    const target = event.target.closest('[data-bgm-track-id]');
    const sourceId = event.dataTransfer.getData('text/plain');
    if (!target || !sourceId || sourceId === target.dataset.bgmTrackId) return;
    event.preventDefault();
    const sourceIndex = state.bgmTracks.findIndex((track) => track.id === sourceId);
    const targetIndex = state.bgmTracks.findIndex((track) => track.id === target.dataset.bgmTrackId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = state.bgmTracks.splice(sourceIndex, 1);
    state.bgmTracks.splice(targetIndex, 0, moved);
    renderBgm();
    save();
  });
  $('#bgmTrackList')?.addEventListener('dragend', (event) => {
    event.target.closest('[data-bgm-track-id]')?.classList.remove('dragging');
  });
  $('#bgmVolume')?.addEventListener('input', (event) => {
    state.bgm.volume = Number(event.target.value);
    const audio = $('#bgmAudio');
    if (audio) audio.volume = state.bgm.volume;
    save();
  });
  $('#bgmPlayToggle')?.addEventListener('click', async () => {
    const audio = $('#bgmAudio');
    if (!audio || !state.bgm.data) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        return;
      }
    } else {
      audio.pause();
    }
    renderBgm();
  });
  $('#bgmAudio')?.addEventListener('play', renderBgm);
  $('#bgmAudio')?.addEventListener('pause', renderBgm);
  $('#bgmAudio')?.addEventListener('play', () => syncBgmPlayback(true));
  $('#bgmAudio')?.addEventListener('pause', () => syncBgmPlayback(false));
  document.addEventListener('pointerdown', () => {
    if (mode !== 'pc' || !remoteBgmShouldPlay) return;
    const audio = $('#bgmAudio');
    if (audio && state.bgm.data && audio.paused) audio.play().catch(() => {});
  }, { once: false });

  document.querySelectorAll('[data-asset-category]').forEach((button) => {
    button.addEventListener('click', () => openAssetSourceModal(button.dataset.assetCategory));
  });

  $('#chooseAssetFile')?.addEventListener('click', () => {
    const inputId = { character: 'characterUpload', material: 'clueUpload', icon: 'sceneImageUpload', background: 'backgroundUpload' }[pendingAssetCategory];
    closeAssetSourceModal();
    if (inputId) $(`#${inputId}`)?.click();
  });

  $('#assetLibraryList')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-library-index]');
    if (!item || !pendingAssetCategory) return;
    const assets = getAssetLibrary(pendingAssetCategory);
    const category = item.dataset.libraryCategory || pendingAssetCategory;
    const asset = assets[Number(item.dataset.libraryIndex)];
    closeAssetSourceModal();
    addSavedAsset(category, asset);
  });

  $('#closeAssetSource')?.addEventListener('click', closeAssetSourceModal);
  $('#assetSourceModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'assetSourceModal') closeAssetSourceModal();
  });

  $('#addLibraryParticipant')?.addEventListener('click', () => {
    const name = window.prompt('参加者の名前');
    if (!name?.trim()) return;
    state.players.push({
      name: name.trim(),
      initials: name.trim().slice(0, 2),
      role: '参加者',
      color: '#6b8f8a',
      abilities: {},
      skillTemplates: []
    });
    activeSidebarPlayerIndex = state.players.length - 1;
    renderSessionLibraryLists();
    renderSidebarPlayers();
    save();
  });

  $('#addLibraryScenario')?.addEventListener('click', () => {
    const title = window.prompt('シナリオ名');
    if (!title?.trim()) return;
    const content = window.prompt('シナリオ概要（任意）', '') || '';
    state.scenarios.push({ title: title.trim(), content: content.trim() });
    renderSessionLibraryLists();
    save();
  });

  $('#participantLibraryList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-library-participant-delete]');
    if (!button) return;
    const deletedIndex = Number(button.dataset.libraryParticipantDelete);
    state.players.splice(deletedIndex, 1);
    if (deletedIndex <= activeSidebarPlayerIndex) activeSidebarPlayerIndex = Math.max(0, activeSidebarPlayerIndex - 1);
    renderSessionLibraryLists();
    renderSidebarPlayers();
    save();
  });

  $('#sidebarPlayerTabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-sidebar-player-tab]');
    if (!tab) return;
    activeSidebarPlayerIndex = Number(tab.dataset.sidebarPlayerTab);
    renderSidebarPlayers();
    renderSkillTemplates();
  });

  $('#participantLibraryList')?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-library-participant-index][data-library-ability-key]');
    if (!input) return;
    const player = state.players[Number(input.dataset.libraryParticipantIndex)];
    if (!player) return;
    player.abilities ||= {};
    player.abilities[input.dataset.libraryAbilityKey] = input.value;
    const con = Number(player.abilities.CON) || 0;
    const siz = Number(player.abilities.SIZ) || 0;
    const pow = Number(player.abilities.POW) || 0;
    player.currentHP = (con + siz) / 10;
    player.currentSAN = pow;
    renderSidebarPlayers();
    renderSkillTemplates();
    save();
  });

  $('#scenarioLibraryList')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-library-scenario-index]');
    if (item && !event.target.closest('[data-library-scenario-delete]')) {
      activeLibraryScenarioIndex = Number(item.dataset.libraryScenarioIndex);
      renderSessionLibraryLists();
      return;
    }
    const button = event.target.closest('[data-library-scenario-delete]');
    if (!button) return;
    state.scenarios.splice(Number(button.dataset.libraryScenarioDelete), 1);
    activeLibraryScenarioIndex = Math.min(activeLibraryScenarioIndex, Math.max(0, state.scenarios.length - 1));
    renderSessionLibraryLists();
    save();
  });

  $('#scenarioLibraryTabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-library-scenario-tab]');
    if (!tab) return;
    activeLibraryScenarioIndex = Number(tab.dataset.libraryScenarioTab);
    renderSessionLibraryLists();
  });

  $('#scenarioLibraryTitleInput')?.addEventListener('input', (event) => {
    const scenario = state.scenarios[activeLibraryScenarioIndex];
    if (!scenario) return;
    scenario.title = event.target.value;
    const activeItem = document.querySelector(`[data-library-scenario-index="${activeLibraryScenarioIndex}"] b`);
    if (activeItem) activeItem.textContent = scenario.title || '無題のシナリオ';
    save();
  });

  $('#scenarioLibraryContent')?.addEventListener('input', (event) => {
    const scenario = state.scenarios[activeLibraryScenarioIndex];
    if (!scenario) return;
    scenario.content = event.target.innerHTML;
    save();
  });

  document.querySelectorAll('[data-scenario-library-color]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      $('#scenarioLibraryContent')?.focus();
      document.execCommand('foreColor', false, button.dataset.scenarioLibraryColor);
      $('#scenarioLibraryContent')?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  $('#backgroundUpload')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    readBackgroundImages(files);
    e.target.value = '';
  });

  $('#characterUpload')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach((file) => {
      const reader = new FileReader();
      reader.addEventListener('load', async () => {
        let imageData;
        try {
          imageData = await uploadAsset(file.name, reader.result);
        } catch (error) {
          console.error(error);
          return;
        }
        const image = { name: file.name, data: imageData, layer: 'character' };
        if (files.length === 1 && !state.characterImage) {
          state.characterImage = imageData;
          const initials = $('#spotlightInitials');
          if (initials) initials.textContent = file.name.slice(0, 2).toUpperCase();
        }
        const overlay = createOverlay(image);
        state.sceneOverlays.push(overlay);
        selectedOverlayIndex = state.sceneOverlays.length - 1;
        activeSizeLayer = 'character';
        renderOverlays();
        syncAssetAdd('character', image, overlay);
        save({ deferLocalSave: true });
      });
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  });

  $('#placeCharacterButton')?.addEventListener('click', () => {
    if (state.characterImage) addOverlay({ name: 'キャラクター', data: state.characterImage, layer: 'character' });
  });

  $('#clueUpload')?.addEventListener('change', (e) => readImages(e.target.files, 'clueImages'));
  $('#sceneImageUpload')?.addEventListener('change', (e) => readImages(e.target.files, 'sceneImages'));
  $('#closeViewer')?.addEventListener('click', closeViewer);

  $('#imageViewer')?.addEventListener('click', (e) => {
    if (e.target.id === 'imageViewer') closeViewer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewer();
  });

  $('#pcDiceResultModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'pcDiceResultModal') closePcDiceResult();
  });

  const rollDice = (prefix, resultSelector) => {
    const count = Number($(`#${prefix}DiceCount`)?.value || 1);
    const sides = Number($(`#${prefix}DiceSides`)?.value || 6);
    const modifier = Number($(`#${prefix}DiceModifier`)?.value) || 0;
    const secret = prefix === '' && Boolean($('#secretDice')?.checked);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;

    const resEl = $(resultSelector);
    if (resEl) {
      resEl.innerHTML = `<span>RESULT</span><strong>${total}</strong><small>${rolls.join(' + ')}${modifier ? ` ${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}` : ''} = ${total}</small>`;
    }

    state.logs.unshift({
      time: nowTime(),
      text: secret ? `<strong>秘密のダイス</strong> 結果: ${total}` : `<strong>ダイス</strong> ${count}d${sides}${modifier ? ` ${modifier > 0 ? '+' : ''}${modifier}` : ''} → ${total}`,
      secret,
      playerText: '<strong>秘密のダイス</strong>が振られました。'
    });
    state.logs = state.logs.slice(0, 8);
    renderLogs();
    save({ syncState: false, syncLog: true });
    notifyDiceResult({
      title: secret ? '秘密のダイス' : 'ダイス判定',
      message: secret ? '秘密のダイスが振られました。' : `${count}d${sides}${modifier ? ` ${modifier > 0 ? '+' : ''}${modifier}` : ''} = ${total}`
    });
  };

  $('#rollButton')?.addEventListener('click', () => rollDice('', '#rollResult'));
  const saveSkillTemplate = (nameSelector, valueSelector) => {
    const name = $(nameSelector)?.value.trim() || '';
    const value = Number($(valueSelector)?.value);
    if (!name || !Number.isInteger(value) || value < 1 || value > 100) return;
    const existing = state.skillTemplates.find((template) => template.name === name);
    if (existing) existing.value = value;
    else state.skillTemplates.push({ id: `skill-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, name, value });
    renderSkillTemplates();
    renderSidebarSkillTemplates();
    save();
  };

  $('#sidebarSkillTemplateSelect')?.addEventListener('change', (event) => {
    const player = state.players[activeSidebarPlayerIndex];
    const template = player?.skillTemplates?.find((entry) => entry.id === event.target.value);
    $('#sidebarSkillNameInput').value = template?.name || '';
    $('#sidebarSkillValueInput').value = template?.value || '';
    $('#sidebarSkillDeleteButton').disabled = !template;
  });

  $('#sidebarSaveSkillTemplate')?.addEventListener('click', () => {
    const player = state.players[activeSidebarPlayerIndex];
    if (!player) return;
    const name = $('#sidebarSkillNameInput')?.value.trim() || '';
    const value = Number($('#sidebarSkillValueInput')?.value);
    if (!name || !Number.isInteger(value) || value < 1 || value > 100) return;
    player.skillTemplates ||= [];
    const existing = player.skillTemplates.find((template) => template.name === name);
    if (existing) existing.value = value;
    else player.skillTemplates.push({ id: `player-skill-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, name, value });
    renderSidebarSkillTemplates();
    const saved = player.skillTemplates.find((template) => template.name === name);
    if (saved) $('#sidebarSkillTemplateSelect').value = saved.id;
    save();
  });
  $('#sidebarSkillRollButton')?.addEventListener('click', () => {
    const player = state.players[activeSidebarPlayerIndex];
    const template = player?.skillTemplates?.find((entry) => entry.id === $('#sidebarSkillTemplateSelect')?.value);
    if (!template) return;
    const roll = Math.floor(Math.random() * 100) + 1;
    const result = getSkillResult(roll, template.value);
    state.logs.unshift({ time: nowTime(), text: `<strong>技能判定</strong> ${escapeHtml(template.name)}: ${roll} / ${template.value} → ${result}` });
    state.logs = state.logs.slice(0, 8);
    renderLogs();
    save({ syncState: false, syncLog: true });
    notifyDiceResult({ title: template.name, message: result, resultClass: getResultClass(result) });
  });

  $('#sidebarSkillDeleteButton')?.addEventListener('click', () => {
    const player = state.players[activeSidebarPlayerIndex];
    const select = $('#sidebarSkillTemplateSelect');
    if (!player || !select?.value) return;
    const skillIndex = player.skillTemplates?.findIndex((entry) => entry.id === select.value) ?? -1;
    if (skillIndex < 0) return;
    player.skillTemplates.splice(skillIndex, 1);
    $('#sidebarSkillNameInput').value = '';
    $('#sidebarSkillValueInput').value = '';
    renderSidebarSkillTemplates();
    save();
  });

  $('#sidebarPlayerList')?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-sidebar-player-index][data-sidebar-stat]');
    if (!input) return;
    const player = state.players[Number(input.dataset.sidebarPlayerIndex)];
    if (!player) return;
    player[input.dataset.sidebarStat] = Math.max(0, Number(input.value) || 0);
    renderSidebarPlayers();
    save();
  });

  $('#skillTemplateSelect')?.addEventListener('change', (event) => {
    const isSan = event.target.value === 'builtin-san';
    const template = state.skillTemplates.find((entry) => entry.id === event.target.value);
    const nameInput = $('#skillNameInput');
    const valueInput = $('#skillValueInput');
    if (nameInput) nameInput.value = isSan ? 'SAN' : (template?.name || '');
    if (valueInput) valueInput.value = isSan ? (state.players[activeSidebarPlayerIndex]?.currentSAN ?? 0) : (template?.value || '');
    const deleteButton = $('#deleteSkillTemplate');
    if (deleteButton) deleteButton.disabled = isSan || !template;
  });

  $('#saveSkillTemplate')?.addEventListener('click', () => {
    const nameInput = $('#skillNameInput');
    const valueInput = $('#skillValueInput');
    const name = nameInput?.value.trim() || '';
    const value = Number(valueInput?.value);
    if (!name || !Number.isInteger(value) || value < 1 || value > 100) {
      if (valueInput) valueInput.reportValidity();
      return;
    }
    const existing = state.skillTemplates.find((template) => template.name === name);
    if (existing) {
      existing.value = value;
    } else {
      state.skillTemplates.push({ id: `skill-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, name, value });
    }
    renderSkillTemplates();
    const saved = state.skillTemplates.find((template) => template.name === name);
    const select = $('#skillTemplateSelect');
    if (select && saved) select.value = saved.id;
    save();
  });

  $('#skillRollButton')?.addEventListener('click', () => {
    const select = $('#skillTemplateSelect');
    const isSan = select?.value === 'builtin-san';
    const template = state.skillTemplates.find((entry) => entry.id === select?.value);
    if (!template && !isSan) return;
    const skillName = isSan ? 'SAN' : template.name;
    const skillValue = isSan ? Number(state.players[activeSidebarPlayerIndex]?.currentSAN) || 0 : template.value;
    const roll = Math.floor(Math.random() * 100) + 1;
    const result = getSkillResult(roll, skillValue);
    const secret = Boolean($('#secretDice')?.checked);
    const resEl = $('#rollResult');
    if (resEl) {
      resEl.innerHTML = `<span>${escapeHtml(skillName)}</span><strong>${roll}</strong><small>${result} / 成功値 ${skillValue}</small>`;
    }
    state.logs.unshift({
      time: nowTime(),
      text: secret
        ? `<strong>秘密の技能判定</strong> ${escapeHtml(skillName)} が行われました。`
        : `<strong>技能判定</strong> ${escapeHtml(skillName)}: ${roll} / ${skillValue} → ${result}`,
      secret,
      playerText: `<strong>秘密の技能判定</strong> ${escapeHtml(skillName)} が行われました.`
    });
    state.logs = state.logs.slice(0, 8);
    renderLogs();
    save({ syncState: false, syncLog: true });
    notifyDiceResult({
      title: secret ? '秘密の技能判定' : skillName,
      message: secret ? '秘密の技能判定が行われました。' : result,
      resultClass: secret ? null : getResultClass(result)
    });
  });

  $('#deleteSkillTemplate')?.addEventListener('click', () => {
    const select = $('#skillTemplateSelect');
    if (!select?.value) return;
    const skillIndex = state.skillTemplates.findIndex((template) => template.id === select.value);
    if (skillIndex < 0) return;
    state.skillTemplates.splice(skillIndex, 1);
    $('#skillNameInput').value = '';
    $('#skillValueInput').value = '';
    renderSkillTemplates();
    save();
  });

  $('#logForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#logInput');
    if (!input || !input.value.trim()) return;
    state.logs.unshift({ time: nowTime(), text: escapeHtml(input.value.trim()) });
    state.logs = state.logs.slice(0, 8);
    input.value = '';
    renderLogs();
    save({ syncState: false, syncLog: true });
  });

  $('#clearLog')?.addEventListener('click', () => {
    state.logs = [];
    renderLogs();
    save({ syncState: false, syncLog: true });
  });

  $('#resetButton')?.addEventListener('click', () => {
    if (!window.confirm('セッションを初期状態に戻しますか？')) return;
    state = structuredClone(defaultState);
    render();
    save();
  });

  $('#shareButton')?.addEventListener('click', async () => {
    const pcUrl = createPlayerInviteUrl();
    try {
      await navigator.clipboard.writeText(pcUrl.href);
      const saveState = $('#saveState');
      if (saveState) saveState.textContent = '● PC参加URLをコピーしました';
    } catch {
      window.prompt('このURLを参加者へ送ってください', pcUrl.href);
    }
  });

  $('#dataInviteButton')?.addEventListener('click', async (event) => {
    const pcUrl = createPlayerInviteUrl();
    try {
      await navigator.clipboard.writeText(pcUrl.href);
      event.currentTarget.textContent = 'コピーしました';
    } catch {
      window.prompt('このURLを参加者へ送ってください', pcUrl.href);
    }
  });

  $('#toggleGmLibrary')?.addEventListener('click', () => {
    const modal = $('#assetSourceModal');
    if (modal?.classList.contains('session-library-open')) closeAssetSourceModal();
    else openAssetSourceModal('all');
  });

  $('#togglePcPanel')?.addEventListener('click', () => {
    const box = $('[data-size-box="pc"]');
    if (!box) return;
    const isOpen = box.classList.toggle('is-collapsed') === false;
    $('#togglePcPanel').setAttribute('aria-expanded', String(isOpen));
  });

  const boardVisibilityButton = $('#boardVisibilityToggle');
  const diceVisibilityButton = $('#diceVisibilityToggle');
  let diceVisibilityHidden = false;
  let boardVisibilityHidden = localStorage.getItem(pcBoardHiddenKey) === 'true';
  if (boardVisibilityButton) boardVisibilityButton.textContent = boardVisibilityHidden ? 'PC盤面を表示' : 'PC盤面を隠す';
  boardVisibilityButton?.addEventListener('click', () => {
    boardVisibilityHidden = !boardVisibilityHidden;
    setPcBoardVisibility(boardVisibilityHidden);
    boardVisibilityButton.textContent = boardVisibilityHidden ? 'PC盤面を表示' : 'PC盤面を隠す';
  });

  diceVisibilityButton?.addEventListener('click', () => {
    diceVisibilityHidden = !diceVisibilityHidden;
    applyPcDiceVisibility(diceVisibilityHidden);
    diceVisibilityButton.textContent = diceVisibilityHidden ? '情報を表示' : '情報を隠す';
  });

  window.addEventListener('storage', (event) => {
    if (event.key === pcBoardHiddenKey) {
      boardVisibilityHidden = event.newValue === 'true';
      applyPcBoardVisibility(boardVisibilityHidden);
      if (boardVisibilityButton) boardVisibilityButton.textContent = boardVisibilityHidden ? 'PC盤面を表示' : 'PC盤面を隠す';
    }
  });
  boardVisibilityChannel?.addEventListener('message', (event) => {
    boardVisibilityHidden = event.data?.hidden === true;
    applyPcBoardVisibility(boardVisibilityHidden);
    if (boardVisibilityButton) boardVisibilityButton.textContent = boardVisibilityHidden ? 'PC盤面を表示' : 'PC盤面を隠す';
  });

  $('#toggleDiceRoller')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const box = $('.dice-box');
    if (!box) return;
    const isOpen = box.classList.toggle('is-collapsed') === false;
    button.setAttribute('aria-expanded', String(isOpen));
  });

  $('#rotateLeft')?.addEventListener('click', () => {
    const targetIndex = selectedGroupId !== null ? getGroupMembers(selectedGroupId)[0] : selectedOverlayIndex;
    if (targetIndex === null || targetIndex === undefined || !state.sceneOverlays[targetIndex]) return;
    updateSelectedOverlay({ rotation: state.sceneOverlays[targetIndex].rotation - 15 });
  });

  $('#rotateRight')?.addEventListener('click', () => {
    const targetIndex = selectedGroupId !== null ? getGroupMembers(selectedGroupId)[0] : selectedOverlayIndex;
    if (targetIndex === null || targetIndex === undefined || !state.sceneOverlays[targetIndex]) return;
    updateSelectedOverlay({ rotation: state.sceneOverlays[targetIndex].rotation + 15 });
  });

  $('#createGroup')?.addEventListener('click', createGroupFromSelection);

  document.querySelectorAll('.group-layer-add').forEach((button) => {
    button.addEventListener('click', () => openGroupNameModal(button.dataset.groupLayerCategory));
  });

  $('#groupNameCancel')?.addEventListener('click', closeGroupNameModal);

  $('#groupNameConfirm')?.addEventListener('click', () => {
    const layer = pendingGroupLayerCategory;
    const input = $('#groupNameInput');
    const name = input ? input.value.trim() : '';
    closeGroupNameModal();
    if (!layer) return;
    addGroupLayer(layer, name || undefined);
  });

  $('#groupNameModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'groupNameModal') closeGroupNameModal();
  });

  $('#groupNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#groupNameConfirm')?.click();
    }
  });

  $('#deleteOverlay')?.addEventListener('click', () => {
    if (selectedGroupId !== null) {
      openDeleteGroupConfirm(selectedGroupId);
      return;
    }
    if (selectedOverlayIndex !== null && selectedOverlayIndex !== undefined) {
      openDeleteConfirm(selectedOverlayIndex);
    }
  });

  $('#confirmCancel')?.addEventListener('click', closeDeleteConfirm);

  $('#confirmDelete')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const deleteIndex = pendingDeleteIndex;
    const deleteGroupId = pendingDeleteGroupId;
    const deleteBackgroundLayerId = pendingDeleteBackgroundLayerId;
    const ungroupGroupId = pendingUngroupGroupId;

    closeDeleteConfirm();

    if (ungroupGroupId) {
      ungroupGroup(ungroupGroupId);
      return;
    }

    if (deleteBackgroundLayerId) {
      state.backgroundLayers = state.backgroundLayers.filter((layer) => layer.id !== deleteBackgroundLayerId);
      state.backgroundLayerOrder = getBackgroundLayerOrder().filter((entry) => entry !== deleteBackgroundLayerId);
      if (selectedBackgroundLayerId === deleteBackgroundLayerId) selectedBackgroundLayerId = null;
      renderOverlays();
      renderBackgroundLayerList();
      save();
      return;
    }

    if (deleteGroupId) {
      const memberIndexes = getGroupMembers(deleteGroupId);
      memberIndexes.slice().reverse().forEach((index) => state.sceneOverlays.splice(index, 1));
      state.layerGroups = state.layerGroups.filter((group) => group.id !== deleteGroupId);
      selectedGroupId = null;
      selectedOverlayIndex = null;
      renderOverlays();
      save();
      return;
    }

    if (deleteIndex === null || !state.sceneOverlays[deleteIndex]) return;
    state.sceneOverlays.splice(deleteIndex, 1);
    selectedOverlayIndex = null;
    renderOverlays();
    save();
  });

  $('#confirmModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'confirmModal') closeDeleteConfirm();
  });

  $('[data-background-lock]')?.addEventListener('click', () => {
    state.backgroundLocked = !state.backgroundLocked;
    renderOverlayControls();
    save();
  });

  document.querySelectorAll('[data-size-input]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const layer = e.target.dataset.sizeInput;
      if (layer === 'background') {
        const value = Number(e.target.value);
        const targetLayer = getSelectedBackgroundLayer();
        if (targetLayer) targetLayer.scale = value;
        state.backgroundScale = value;
        renderImages();
        renderOverlays();
        save();
        return;
      }
      const targetIndexes = getSelectedOverlayIndexes();
      targetIndexes.forEach((index) => {
        if (state.sceneOverlays[index] && (state.sceneOverlays[index].layer || 'material') === layer) {
          state.sceneOverlays[index].size = Number(e.target.value);
        }
      });
      if (targetIndexes.length) {
        renderOverlays();
        save();
      }
    });
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });
}

// タイマー開始
let seconds = 2 * 3600 + 18 * 60 + 44;
setInterval(() => {
  seconds += 1;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const timerEl = $('#sessionTime');
  if (timerEl) {
    timerEl.textContent = [hours, minutes, remainder].map((v) => String(v).padStart(2, '0')).join(':');
  }
}, 1000);

// アプリケーション初期化実行
applyMode();
render();
setupEventListeners();
setupSizeBoxInteractions();
loadBundledAssets();