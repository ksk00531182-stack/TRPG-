const storageKey = 'trpg-session-room-state';
const pcBoardHiddenKey = 'trpg-session-room-pc-board-hidden';
const mode = new URLSearchParams(window.location.search).get('mode') === 'pc' ? 'pc' : 'gm';
const boardVisibilityChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('trpg-session-room-board-visibility') : null;
const visibilitySocket = typeof io === 'function' ? io() : null;
const roomParam = new URLSearchParams(window.location.search).get('room');
const storedRoomId = localStorage.getItem('trpg-session-room-id');
const visibilityRoomId = roomParam || storedRoomId || (mode === 'gm' ? `session-${Math.random().toString(36).slice(2, 10)}` : 'trpg-session-room');
if (mode === 'gm' && !roomParam && !storedRoomId) localStorage.setItem('trpg-session-room-id', visibilityRoomId);
let applyingRemoteState = false;

visibilitySocket?.on('connect', () => visibilitySocket.emit('trpg_join', {
  roomId: visibilityRoomId,
  mode,
  state: mode === 'gm' ? state : undefined
}));
visibilitySocket?.on('trpg_board_visibility', ({ hidden }) => applyPcBoardVisibility(hidden === true));
visibilitySocket?.on('trpg_state', (remoteState) => {
  if (!remoteState || typeof remoteState !== 'object') return;
  applyingRemoteState = true;
  state = remoteState;
  state.backgroundLayers ||= [];
  state.backgroundLayerOrder ||= [];
  state.backgroundDimming ||= { white: false, black: false };
  state.layerGroups ||= [];
  state.skillTemplates ||= [];
  state.scenePresets ||= [];
  state.bgmTracks ||= [];
  state.players ||= [];
  render();
  applyingRemoteState = false;
});

const defaultState = {
  backgroundLayers: [],
  characterImage: '',
  clueImages: [],
  sceneImages: [],
  sceneOverlays: [],
  backgroundScale: 100,
  backgroundLayerOrder: ['whiteDark', 'blackDark'],
  backgroundDimming: { white: false, black: false },
  backgroundLocked: false,
  sizeBoxLayouts: {},
  layerGroups: [],
  skillTemplates: [],
  scenePresets: [],
  bgm: { name: '', data: '', volume: 0.5 },
  bgmTracks: [],
  players: [],
  logs: [
    { time: '21:43', text: 'リナが灯台の扉に手をかけた。' },
    { time: '21:39', text: 'GM <strong>霧の向こうに人影。</strong>' },
    { time: '21:31', text: 'カイが〈観察〉に成功。' },
    { time: '21:26', text: 'シーン「海岸線」を開始。' }
  ],
  scenarioTitle: '灰色港の灯台',
  scenarioTabs: [
    { id: 'scenario-intro', title: '導入', content: '防波堤の先にある古い灯台。入口は開いているが、中から潮の匂いがする。灯りがまたたくたび、霧の中に人影が増えていく。' }
  ],
  activeScenarioTabId: 'scenario-intro'
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
const legacyScenarioNote = state.scenarioNote || state.sceneNote || defaultState.scenarioTabs[0].content;
state.scenarioTitle ||= defaultState.scenarioTitle;
state.scenarioTabs = Array.isArray(state.scenarioTabs) && state.scenarioTabs.length
  ? state.scenarioTabs
  : [{ id: `scenario-${Date.now()}`, title: '導入', content: legacyScenarioNote }];
state.activeScenarioTabId = state.scenarioTabs.some((tab) => tab.id === state.activeScenarioTabId)
  ? state.activeScenarioTabId
  : state.scenarioTabs[0].id;
delete state.sceneNote;
delete state.scenarioNote;

// 内部データモデルの平準化
state.clueImages ||= [];
state.sceneImages ||= [];
state.backgroundScale ||= 100;
state.backgroundDimming ||= { white: false, black: false };
state.backgroundLocked = Boolean(state.backgroundLocked);
state.sizeBoxLayouts ||= {};
state.layerGroups ||= [];
state.skillTemplates = Array.isArray(state.skillTemplates) ? state.skillTemplates : [];
state.scenePresets = Array.isArray(state.scenePresets) ? state.scenePresets : [];
state.bgm = { name: '', data: '', volume: 0.5, ...(state.bgm || {}) };
state.bgmTracks = Array.isArray(state.bgmTracks) ? state.bgmTracks : [];
if (!state.bgmTracks.length && state.bgm.data) {
  state.bgmTracks.push({ id: `bgm-${Date.now()}`, name: state.bgm.name || 'BGM', data: state.bgm.data });
}

const defaultPlayerAbilities = [
  { STR: 50, CON: 55, POW: 60, DEX: 65, APP: 45, SIZ: 55, INT: 70, EDU: 60, LUK: 50 },
  { STR: 70, CON: 65, POW: 48, DEX: 55, APP: 40, SIZ: 60, INT: 50, EDU: 45, LUK: 55 },
  { STR: 40, CON: 45, POW: 62, DEX: 45, APP: 60, SIZ: 50, INT: 80, EDU: 75, LUK: 65 },
  { STR: 55, CON: 60, POW: 71, DEX: 60, APP: 70, SIZ: 55, INT: 65, EDU: 55, LUK: 45 }
];
const playerAbilityKeys = ['STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU', 'LUK'];

state.players = (state.players || []).map((player, index) => ({
  ...player,
  abilities: { ...(defaultPlayerAbilities[index] || defaultPlayerAbilities[0]), ...(player.abilities || {}) },
  skillTemplates: Array.isArray(player.skillTemplates) ? player.skillTemplates : []
}));

state.players = state.players.map((player) => {
  const con = Number(player.abilities.CON) || 0;
  const siz = Number(player.abilities.SIZ) || 0;
  return {
    ...player,
    currentHP: player.currentHP ?? (con + siz) / 10,
    currentSAN: player.currentSAN ?? (player.abilities.POW ?? '')
  };
});

const initialPlayerNames = new Set(['リナ・ノース', 'カイ・ルーン', 'ミレイユ', 'サラ・アッシュ']);
state.players = state.players.filter((player) => !initialPlayerNames.has(player.name));

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

// UI選択状態
let selectedOverlayIndex = null;
let selectedGroupId = null;
let selectedBackgroundLayerId = null;
let multiSelectOverlayIndexes = [];
let activeSizeLayer = 'character';
let activeStagePlayerIndex = 0;

let pendingDeleteIndex = null;
let pendingDeleteGroupId = null;
let pendingDeleteBackgroundLayerId = null;
let pendingUngroupGroupId = null;
let pendingGroupLayerCategory = null;
let pendingAssetCategory = null;

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (mode === 'gm' && !applyingRemoteState) {
    visibilitySocket?.emit('trpg_state_update', { roomId: visibilityRoomId, state });
  }
  const saveState = $('#saveState');
  if (saveState) {
    saveState.textContent = '● 保存済み';
    saveState.style.color = 'var(--teal)';
  }
}

function renderBgm() {
  const audio = $('#bgmAudio');
  const select = $('#bgmSelect');
  const trackList = $('#bgmTrackList');
  const playToggle = $('#bgmPlayToggle');
  const volume = $('#bgmVolume');
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
    save();
    if (shouldPlay) {
      try {
        await $('#bgmAudio')?.play();
        renderBgm();
      } catch {
        // Browser autoplay policy may require another user gesture.
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
    save();
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
    // Browser autoplay policy may require pressing play.
  }
}

function applyPcBoardVisibility(hidden) {
  document.body.classList.toggle('pc-board-hidden', mode === 'pc' && hidden);
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

function renderPlayers() {
  const el = $('#playerList');
  if (!el) return;
  el.innerHTML = state.players.map((player, index) => {
    const abilities = player.abilities || {};
    const abilityEditor = playerAbilityKeys.map((key) =>
      `<label><span>${escapeHtml(key)}</span><input type="text" value="${escapeHtml(abilities[key] ?? '')}" data-player-index="${index}" data-ability-key="${escapeHtml(key)}" aria-label="${escapeHtml(player.name)} ${escapeHtml(key)}"></label>`
    ).join('');
    return `<div class="player-card">
      <div class="player">
      <div class="avatar" style="background:${escapeHtml(player.color || '#6b8f8a')}">${escapeHtml(player.initials || 'PC')}</div>
      <div class="player-name">${escapeHtml(player.name)}</div>
      <i class="presence"></i>
      </div>
      <div class="player-ability-editor gm-only">${abilityEditor}</div>
    </div>`;
  }).join('');
}

function renderStagePlayerStats() {
  const tabs = $('#stagePlayerTabs');
  const el = $('#stagePlayerStats');
  if (!el) return;
  if (!state.players.length) {
    if (tabs) tabs.innerHTML = '';
    el.innerHTML = '<div class="category-layer-empty">参加者未登録</div>';
    return;
  }
  activeStagePlayerIndex = Math.min(activeStagePlayerIndex, state.players.length - 1);
  if (tabs) {
    tabs.innerHTML = state.players.length > 1 ? state.players.map((player, index) =>
      `<button type="button" class="stage-player-tab ${index === activeStagePlayerIndex ? 'active' : ''}" data-stage-player-index="${index}" role="tab" aria-selected="${index === activeStagePlayerIndex}">${escapeHtml(player.name)}</button>`
    ).join('') : '';
  }
  const player = state.players[activeStagePlayerIndex];
  el.innerHTML = [player].map((p) => {
    const abilities = p.abilities || {};
    const con = Number(abilities.CON) || 0;
    const siz = Number(abilities.SIZ) || 0;
    const hitPoints = p.currentHP ?? (con + siz) / 10;
    const sanity = p.currentSAN ?? (abilities.POW ?? '');
    const skillOptions = (p.skillTemplates || [])
      .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} (${escapeHtml(template.value)})</option>`)
      .join('');
    return `<article class="stage-player-card">
      <div class="stage-player-name"><span class="avatar" style="background:${escapeHtml(p.color || '#6b8f8a')}">${escapeHtml(p.initials || 'PC')}</span><strong>${escapeHtml(p.name)}</strong></div>
      <div class="stage-ability-grid">
        <label><b>HP</b><span class="sidebar-stat-display">${escapeHtml(hitPoints)}</span><input class="gm-only sidebar-stat-input" type="number" min="0" step="1" value="${escapeHtml(hitPoints)}" data-player-index="${state.players.indexOf(p)}" data-current-stat="currentHP" aria-label="${escapeHtml(p.name)} HP"></label>
        <label><b>SAN</b><span class="sidebar-stat-display">${escapeHtml(sanity)}</span><input class="gm-only sidebar-stat-input" type="number" min="0" step="1" value="${escapeHtml(sanity)}" data-player-index="${state.players.indexOf(p)}" data-current-stat="currentSAN" aria-label="${escapeHtml(p.name)} SAN"></label>
      </div>
      <div class="player-skill-roll" data-player-index="${state.players.indexOf(p)}">
        <div class="player-skill-picker"><select data-player-skill-select aria-label="${escapeHtml(p.name)}の技能"><option value="">技能を選択</option>${skillOptions}</select><button type="button" data-player-skill-roll title="技能判定" aria-label="技能判定">🎲</button><button type="button" class="gm-only player-skill-delete" data-player-skill-delete title="技能を削除" aria-label="技能を削除">×</button></div>
        <div class="gm-only player-skill-editor"><input type="text" data-player-skill-name placeholder="技能名" maxlength="30"><input type="number" data-player-skill-value min="1" max="100" placeholder="値"><button type="button" data-player-skill-save title="技能を保存" aria-label="技能を保存">＋</button></div>
      </div>
    </article>`;
  }).join('');
}

function getActiveScenarioTab() {
  return state.scenarioTabs.find((tab) => tab.id === state.activeScenarioTabId) || state.scenarioTabs[0];
}

function sanitizeScenarioHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  const allowedColors = new Set(['#e8edf0', '#eb8d7e', '#91b9e8']);
  const colorAliases = new Map([
    ['rgb(232, 237, 240)', '#e8edf0'],
    ['rgb(235, 141, 126)', '#eb8d7e'],
    ['rgb(145, 185, 232)', '#91b9e8']
  ]);
  template.content.querySelectorAll('*').forEach((element) => {
    if (element.tagName === 'BR') return;
    if (element.tagName !== 'SPAN' && element.tagName !== 'FONT') {
      element.replaceWith(...element.childNodes);
      return;
    }
    if (element.tagName === 'FONT' && element.getAttribute('color')) {
      const legacyColor = element.getAttribute('color').toLowerCase();
      if (allowedColors.has(legacyColor)) element.style.color = legacyColor;
    }
    const normalizedColor = colorAliases.get(element.style.color.toLowerCase()) || element.style.color.toLowerCase();
    if (!allowedColors.has(normalizedColor)) {
      element.replaceWith(...element.childNodes);
      return;
    }
    element.removeAttribute('color');
    element.removeAttribute('face');
    element.removeAttribute('size');
    element.removeAttribute('class');
    element.setAttribute('style', `color: ${normalizedColor}`);
  });
  return template.innerHTML;
}

function renderScenario() {
  const activeTab = getActiveScenarioTab();
  const titleInput = $('#scenarioTitleInput');
  if (titleInput) titleInput.value = state.scenarioTitle || '';

  const tabs = $('#scenarioTabs');
  if (tabs) {
    tabs.innerHTML = state.scenarioTabs.map((tab) =>
      `<div class="scenario-tab-item" draggable="true" data-scenario-tab-id="${escapeHtml(tab.id)}">
        <button type="button" class="scenario-tab ${tab.id === activeTab?.id ? 'active' : ''}" role="tab" aria-selected="${tab.id === activeTab?.id}">${escapeHtml(tab.title)}</button>
        <button type="button" class="scenario-tab-delete gm-only" data-scenario-action="delete" title="タブを削除" aria-label="${escapeHtml(tab.title)}を削除">×</button>
      </div>`
    ).join('');
  }

  const note = $('#scenarioNote');
  if (note) note.innerHTML = sanitizeScenarioHtml(activeTab?.content || '');
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

function getAssetLibrary(category) {
  if (category === 'background') {
    return state.backgroundLayers.filter((layer) => layer.data).map((layer) => ({ name: layer.name || '背景画像', type: 'image', data: layer.data }));
  }
  if (category === 'character') {
    return state.sceneOverlays.filter((overlay) => overlay.data && (overlay.layer || 'material') === 'character');
  }
  const images = category === 'material' ? state.clueImages : state.sceneImages;
  return (images || []).filter((image) => image.data && image.type !== 'application/pdf');
}

function closeAssetSourceModal() {
  pendingAssetCategory = null;
  const modal = $('#assetSourceModal');
  if (modal) {
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
  if (title) title.textContent = `${{ character: 'キャラクター', material: '資料', icon: 'アイコン', background: '背景' }[category] || '素材'}を追加`;
  const assets = getAssetLibrary(category);
  list.innerHTML = assets.length ? assets.map((asset, index) =>
    `<button type="button" class="asset-library-item" data-library-index="${index}"><img src="${asset.data}" alt="${escapeHtml(asset.name || '素材')}" loading="lazy"><span>${escapeHtml(asset.name || '素材')}</span></button>`
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

function captureScenePreset(name) {
  return {
    id: `scene-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    backgroundLayers: structuredClone(state.backgroundLayers),
    backgroundLayerOrder: structuredClone(state.backgroundLayerOrder),
    backgroundScale: state.backgroundScale,
    backgroundDimming: structuredClone(state.backgroundDimming),
    sceneOverlays: structuredClone(state.sceneOverlays),
    layerGroups: structuredClone(state.layerGroups)
  };
}

function closeScenePresetModal() {
  const modal = $('#scenePresetModal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function renderScenePresetList() {
  const list = $('#scenePresetList');
  if (!list) return;
  list.innerHTML = state.scenePresets.length ? state.scenePresets.map((preset) =>
    `<div class="scene-preset-item"><button type="button" data-scene-preset-id="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</button><button type="button" class="scene-preset-delete" data-scene-preset-delete="${escapeHtml(preset.id)}" title="シーンを削除" aria-label="シーンを削除">×</button></div>`
  ).join('') : '<div class="category-layer-empty">保存済みシーンがありません</div>';
}

function openScenePresetModal() {
  renderScenePresetList();
  const modal = $('#scenePresetModal');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function restoreScenePreset(preset) {
  if (!preset) return;
  state.backgroundLayers = structuredClone(preset.backgroundLayers || []);
  state.backgroundLayerOrder = structuredClone(preset.backgroundLayerOrder || []);
  state.backgroundScale = preset.backgroundScale ?? 100;
  state.backgroundDimming = structuredClone(preset.backgroundDimming || { white: false, black: false });
  state.sceneOverlays = structuredClone(preset.sceneOverlays || []);
  state.layerGroups = structuredClone(preset.layerGroups || []);
  selectedOverlayIndex = null;
  selectedGroupId = null;
  selectedBackgroundLayerId = null;
  multiSelectOverlayIndexes = [];
  renderImages();
  renderBackgroundLayerList();
  renderOverlayControls();
  save();
}

function renderSkillTemplates() {
  const select = $('#skillTemplateSelect');
  if (!select) return;
  const selected = select.value;
  select.innerHTML = '<option value="">技能を選択</option>' + state.skillTemplates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} (${escapeHtml(template.value)})</option>`)
    .join('');
  if (state.skillTemplates.some((template) => template.id === selected)) select.value = selected;
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
      renderOverlays();
      renderBackgroundLayerList();
      save();
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
    return `<img class="scene-overlay ${isSelected ? 'selected' : ''} ${isGroupMember ? 'group-member' : ''}" data-overlay-index="${index}" src="${overlay.data}" alt="${escapeHtml(overlay.name)}" title="${escapeHtml(overlay.name)}" style="left:${overlay.x}%;top:${overlay.y}%;width:${overlay.size}px;z-index:${index + 1};transform:translate(-50%, -50%) rotate(${overlay.rotation}deg);display:${isVisible ? 'block' : 'none'}">`;
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
  save();
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
      if (state.sceneOverlays[index]) Object.assign(state.sceneOverlays[index], update);
    });
    renderOverlays();
    save();
    return;
  }
  const index = selectedOverlayIndex ?? selectedIndexes[0];
  if (index === null || index === undefined || !state.sceneOverlays[index]) return;
  Object.assign(state.sceneOverlays[index], update);
  renderOverlays();
  save();
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
  renderScenario();
  renderPlayers();
  renderStagePlayerStats();
  renderLogs();
  renderSkillTemplates();
  renderImages();
  renderBackgroundLayerList();
}

function readBackgroundImages(files) {
  Array.from(files || []).forEach((file) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const layerId = `bg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const alreadyExists = state.backgroundLayers.some((layer) => layer.data === reader.result && layer.name === file.name);
      if (!alreadyExists) {
        state.backgroundLayers.push({ id: layerId, name: file.name, data: reader.result, visible: true });
        state.backgroundLayerOrder = getBackgroundLayerOrder();
      }
      renderImages();
      renderBackgroundLayerList();
      save();
    });
    reader.readAsDataURL(file);
  });
}

function readImages(files, stateKey) {
  const defaultLayer = stateKey === 'clueImages' ? 'material' : 'icon';
  Array.from(files || []).forEach((file) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const image = { name: file.name, type: file.type, data: reader.result, layer: defaultLayer };
      state[stateKey].push(image);
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        addOverlay({ ...image, layer: image.layer || defaultLayer });
      }
      save();
    });
    reader.readAsDataURL(file);
  });
}

function addOverlay(image) {
  state.sceneOverlays.push({ name: image.name, data: image.data, layer: image.layer || 'material', x: 50, y: 50, size: 110, rotation: 0, visible: true, groupId: null });
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
  };

  const stop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    save();
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
  };

  const stop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    save();
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

  $('#saveScenePreset')?.addEventListener('click', () => {
    const name = window.prompt('保存するシーン名を入力してください');
    if (!name?.trim()) return;
    state.scenePresets.push(captureScenePreset(name.trim()));
    save();
  });

  $('#openScenePresets')?.addEventListener('click', openScenePresetModal);
  $('#closeScenePresets')?.addEventListener('click', closeScenePresetModal);
  $('#scenePresetModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'scenePresetModal') closeScenePresetModal();
  });
  $('#scenePresetList')?.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-scene-preset-delete]');
    if (deleteButton) {
      const preset = state.scenePresets.find((entry) => entry.id === deleteButton.dataset.scenePresetDelete);
      if (!preset || !window.confirm(`${preset.name} を削除しますか？`)) return;
      state.scenePresets = state.scenePresets.filter((entry) => entry.id !== preset.id);
      renderScenePresetList();
      save();
      return;
    }
    const restoreButton = event.target.closest('[data-scene-preset-id]');
    if (!restoreButton) return;
    const preset = state.scenePresets.find((entry) => entry.id === restoreButton.dataset.scenePresetId);
    closeScenePresetModal();
    restoreScenePreset(preset);
  });

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
    const category = pendingAssetCategory;
    const asset = assets[Number(item.dataset.libraryIndex)];
    closeAssetSourceModal();
    addSavedAsset(category, asset);
  });

  $('#closeAssetSource')?.addEventListener('click', closeAssetSourceModal);
  $('#assetSourceModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'assetSourceModal') closeAssetSourceModal();
  });

  $('#scenarioTitleInput')?.addEventListener('input', (e) => {
    state.scenarioTitle = e.target.value;
    save();
  });

  $('#scenarioTabs')?.addEventListener('click', (event) => {
    const tabItem = event.target.closest('[data-scenario-tab-id]');
    if (!tabItem) return;
    if (event.target.closest('[data-scenario-action="delete"]')) {
      if (state.scenarioTabs.length <= 1) return;
      if (!window.confirm('このタブを削除しますか？')) return;
      const deleteIndex = state.scenarioTabs.findIndex((tab) => tab.id === tabItem.dataset.scenarioTabId);
      if (deleteIndex < 0) return;
      state.scenarioTabs.splice(deleteIndex, 1);
      if (state.activeScenarioTabId === tabItem.dataset.scenarioTabId) {
        state.activeScenarioTabId = state.scenarioTabs[Math.max(0, deleteIndex - 1)].id;
      }
      renderScenario();
      save();
      return;
    }
    state.activeScenarioTabId = tabItem.dataset.scenarioTabId;
    renderScenario();
    save();
  });

  $('#scenarioTabs')?.addEventListener('dragstart', (event) => {
    const tabItem = event.target.closest('[data-scenario-tab-id]');
    if (!tabItem) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tabItem.dataset.scenarioTabId);
    tabItem.classList.add('dragging');
  });

  $('#scenarioTabs')?.addEventListener('dragover', (event) => {
    const tabItem = event.target.closest('[data-scenario-tab-id]');
    if (!tabItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });

  $('#scenarioTabs')?.addEventListener('drop', (event) => {
    const targetItem = event.target.closest('[data-scenario-tab-id]');
    if (!targetItem) return;
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetItem.dataset.scenarioTabId) return;
    const sourceIndex = state.scenarioTabs.findIndex((tab) => tab.id === sourceId);
    const targetIndex = state.scenarioTabs.findIndex((tab) => tab.id === targetItem.dataset.scenarioTabId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [movedTab] = state.scenarioTabs.splice(sourceIndex, 1);
    state.scenarioTabs.splice(targetIndex, 0, movedTab);
    renderScenario();
    save();
  });

  $('#scenarioTabs')?.addEventListener('dragend', (event) => {
    event.target.closest('[data-scenario-tab-id]')?.classList.remove('dragging');
  });

  $('#addScenarioTab')?.addEventListener('click', () => {
    const title = window.prompt('タブ名を入力してください', '新しい場面');
    if (!title?.trim()) return;
    const tab = { id: `scenario-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, title: title.trim(), content: '' };
    state.scenarioTabs.push(tab);
    state.activeScenarioTabId = tab.id;
    renderScenario();
    save();
    $('#scenarioNote')?.focus();
  });

  $('#scenarioNote')?.addEventListener('input', (e) => {
    const activeTab = getActiveScenarioTab();
    if (!activeTab) return;
    activeTab.content = sanitizeScenarioHtml(e.target.innerHTML);
    save();
  });

  document.querySelectorAll('[data-scenario-color]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      $('#scenarioNote')?.focus();
      document.execCommand('foreColor', false, button.dataset.scenarioColor);
      $('#scenarioNote')?.dispatchEvent(new Event('input', { bubbles: true }));
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
      reader.addEventListener('load', () => {
        const imageData = reader.result;
        const image = { name: file.name, data: imageData, layer: 'character' };
        if (files.length === 1 && !state.characterImage) {
          state.characterImage = imageData;
          const initials = $('#spotlightInitials');
          if (initials) initials.textContent = file.name.slice(0, 2).toUpperCase();
        }
        addOverlay(image);
        save();
      });
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  });

  $('#placeCharacterButton')?.addEventListener('click', () => {
    if (state.characterImage) addOverlay({ name: 'リナ・ノース', data: state.characterImage, layer: 'character' });
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

  $('#rollButton')?.addEventListener('click', () => {
    const count = Number($('#diceCount')?.value || 1);
    const sides = Number($('#diceSides')?.value || 6);
    const modifier = Number($('#diceModifier')?.value) || 0;
    const secret = Boolean($('#secretDice')?.checked);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;

    const resEl = $('#rollResult');
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
    save();
  });

  $('#skillTemplateSelect')?.addEventListener('change', (event) => {
    const template = state.skillTemplates.find((entry) => entry.id === event.target.value);
    const nameInput = $('#skillNameInput');
    const valueInput = $('#skillValueInput');
    if (nameInput) nameInput.value = template?.name || '';
    if (valueInput) valueInput.value = template?.value || '';
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
    const template = state.skillTemplates.find((entry) => entry.id === select?.value);
    if (!template) return;
    const roll = Math.floor(Math.random() * 100) + 1;
    const result = getSkillResult(roll, template.value);
    const secret = Boolean($('#secretDice')?.checked);
    const resEl = $('#rollResult');
    if (resEl) {
      resEl.innerHTML = `<span>${escapeHtml(template.name)}</span><strong>${roll}</strong><small>${result} / 成功値 ${template.value}</small>`;
    }
    state.logs.unshift({
      time: nowTime(),
      text: secret
        ? `<strong>秘密の技能判定</strong> ${escapeHtml(template.name)}: ${result} (${roll})`
        : `<strong>技能判定</strong> ${escapeHtml(template.name)}: ${roll} / ${template.value} → ${result}`,
      secret,
      playerText: `<strong>秘密の技能判定</strong> ${escapeHtml(template.name)} が行われました。`
    });
    state.logs = state.logs.slice(0, 8);
    renderLogs();
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
    save();
  });

  $('#clearLog')?.addEventListener('click', () => {
    state.logs = [];
    renderLogs();
    save();
  });

  $('#playerList')?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-player-index][data-ability-key]');
    if (!input) return;
    const player = state.players[Number(input.dataset.playerIndex)];
    if (!player) return;
    player.abilities ||= {};
    player.abilities[input.dataset.abilityKey] = input.value;
    renderStagePlayerStats();
    save();
  });

  $('#stagePlayerStats')?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-player-index][data-current-stat]');
    if (!input || mode === 'pc') return;
    const player = state.players[Number(input.dataset.playerIndex)];
    if (!player) return;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) return;
    player[input.dataset.currentStat] = value;
    renderStagePlayerStats();
    save();
  });

  $('#stagePlayerTabs')?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-stage-player-index]');
    if (!tab) return;
    activeStagePlayerIndex = Number(tab.dataset.stagePlayerIndex);
    renderStagePlayerStats();
  });

  $('#stagePlayerStats')?.addEventListener('click', (event) => {
    const container = event.target.closest('[data-player-index]');
    if (!container) return;
    const player = state.players[Number(container.dataset.playerIndex)];
    if (!player) return;

    if (event.target.closest('[data-player-skill-save]')) {
      const nameInput = container.querySelector('[data-player-skill-name]');
      const valueInput = container.querySelector('[data-player-skill-value]');
      const name = nameInput?.value.trim() || '';
      const value = Number(valueInput?.value);
      if (!name || !Number.isInteger(value) || value < 1 || value > 100) return;
      const existing = player.skillTemplates.find((template) => template.name === name);
      if (existing) existing.value = value;
      else player.skillTemplates.push({ id: `player-skill-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, name, value });
      renderStagePlayerStats();
      save();
      return;
    }

    if (event.target.closest('[data-player-skill-delete]')) {
      const select = container.querySelector('[data-player-skill-select]');
      const templateIndex = player.skillTemplates.findIndex((entry) => entry.id === select?.value);
      if (templateIndex < 0) return;
      if (!window.confirm(`${player.skillTemplates[templateIndex].name} を削除しますか？`)) return;
      player.skillTemplates.splice(templateIndex, 1);
      renderStagePlayerStats();
      save();
      return;
    }

    if (event.target.closest('[data-player-skill-roll]')) {
      const select = container.querySelector('[data-player-skill-select]');
      const template = player.skillTemplates.find((entry) => entry.id === select?.value);
      if (!template) return;
      const roll = Math.floor(Math.random() * 100) + 1;
      const result = getSkillResult(roll, template.value);
      const secret = Boolean($('#secretDice')?.checked);
      state.logs.unshift({
        time: nowTime(),
        text: secret
          ? `<strong>秘密の技能判定</strong> ${escapeHtml(player.name)} / ${escapeHtml(template.name)}: ${result} (${roll})`
          : `<strong>技能判定</strong> ${escapeHtml(player.name)} / ${escapeHtml(template.name)}: ${roll} / ${template.value} → ${result}`,
        secret,
        playerText: `<strong>技能判定</strong> ${escapeHtml(player.name)} が技能を判定しました。`
      });
      state.logs = state.logs.slice(0, 8);
      renderLogs();
      save();
    }
  });

  $('#addPlayer')?.addEventListener('click', () => {
    const name = window.prompt('参加者の名前');
    if (!name?.trim()) return;
    const initials = name.trim().slice(0, 2);
    state.players.push({ initials, name: name.trim(), role: '参加者', color: '#6b8f8a', abilities: Object.fromEntries(playerAbilityKeys.map((key) => [key, ''])), currentHP: 0, currentSAN: 0, skillTemplates: [] });
    renderPlayers();
    renderStagePlayerStats();
    save();
  });

  $('#resetButton')?.addEventListener('click', () => {
    if (!window.confirm('セッションを初期状態に戻しますか？')) return;
    state = structuredClone(defaultState);
    render();
    save();
  });

  $('#editScenarioButton')?.addEventListener('click', () => $('#scenarioTitleInput')?.focus());

  $('#shareButton')?.addEventListener('click', async () => {
    const pcUrl = new URL(window.location.href);
    pcUrl.searchParams.set('mode', 'pc');
    pcUrl.searchParams.set('room', visibilityRoomId);
    try {
      await navigator.clipboard.writeText(pcUrl.href);
      const saveState = $('#saveState');
      if (saveState) saveState.textContent = '● PC参加URLをコピーしました';
    } catch {
      window.prompt('このURLを参加者へ送ってください', pcUrl.href);
    }
  });

  $('#toggleGmLibrary')?.addEventListener('click', () => document.body.classList.toggle('gm-library-open'));

  const boardVisibilityButton = $('#boardVisibilityToggle');
  let boardVisibilityPressed = false;
  const releaseBoardVisibility = () => {
    if (!boardVisibilityPressed) return;
    boardVisibilityPressed = false;
    setPcBoardVisibility(false);
    if (boardVisibilityButton) boardVisibilityButton.textContent = 'PC盤面を隠す';
  };
  boardVisibilityButton?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    boardVisibilityPressed = true;
    setPcBoardVisibility(true);
    boardVisibilityButton.textContent = 'PC盤面を表示';
  });
  window.addEventListener('pointerup', releaseBoardVisibility);
  window.addEventListener('pointercancel', releaseBoardVisibility);
  window.addEventListener('blur', releaseBoardVisibility);

  window.addEventListener('storage', (event) => {
    if (event.key === pcBoardHiddenKey) applyPcBoardVisibility(event.newValue === 'true');
  });
  boardVisibilityChannel?.addEventListener('message', (event) => {
    applyPcBoardVisibility(event.data?.hidden === true);
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