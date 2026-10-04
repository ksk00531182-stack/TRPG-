const params = new URLSearchParams(location.search);
const socket = io();

const $ = (selector) => document.querySelector(selector);

// DOM Elements
const elements = {
  entry: $('#entry'),
  room: $('#room'),
  joinForm: $('#joinForm'),
  roomIdInput: $('#roomId'),
  roomTitleInput: $('#roomTitle'),
  playerIdInput: $('#playerId'),
  playerIdLabel: $('#playerIdLabel'),
  systemIdInput: $('#systemId'),
  systemLabel: $('#systemLabel'),
  nameInput: $('#name'),
  nameLabel: $('#nameLabel'),
  joinButton: $('#joinButton'),
  roomListButton: $('#roomListButton'),
  entryHint: $('#entryHint'),
  roomLibrary: $('#roomLibrary'),
  roomList: $('#roomList'),
  chatTab: $('#chatTab'),
  diceTab: $('#diceTab'),
  memoTab: $('#memoTab'),
  chatPanel: $('#chatPanel'),
  dicePanel: $('#dicePanel'),
  secretDiceOption: $('#secretDiceOption'),
  secretDiceInput: $('#secretDiceInput'),
  diceActorOption: $('#diceActorOption'),
  diceActor: $('#diceActor'),
  skillRollSection: $('#skillRollSection'),
  skillRollMode: $('#skillRollMode'),
  skillRollList: $('#skillRollList'),
  memoPanel: $('#memoPanel'),
  memoInput: $('#memoInput'),
  roomLabel: $('#roomLabel'),
  roomSystem: $('#roomSystem'),
  messageTarget: $('#messageTarget'),
  messageList: $('#messageList'),
  messageForm: $('#messageForm'),
  messageInput: $('#messageInput'),
  status: $('#status'),
  typing: $('#typing'),
  assetList: $('#assetList'),
  assetStatus: $('#assetStatus'),
  assetUpload: $('#assetUpload'),
  assetCategory: $('#assetCategory'),
  assetFiles: $('#assetFiles'),
  playArea: document.querySelector('.play-area'),
  masterBgmVolume: $('#masterBgmVolume'),
  boardAssets: $('#boardAssets'),
  characterBoardAssets: $('#characterBoardAssets'),
  boardDifferenceMenu: $('#boardDifferenceMenu'),
  layerBox: $('#layerBox'),
  characterLayerBox: $('#characterLayerBox'),
  bgmLayerBox: $('#bgmLayerBox'),
  layerList: $('#layerList'),
  characterLayerList: $('#characterLayerList'),
  bgmLayerList: $('#bgmLayerList'),
  layerGroupForm: $('#layerGroupForm'),
  layerGroupName: $('#layerGroupName'),
  layerArrangeTools: $('#layerArrangeTools'),
  characterLayerGroupForm: $('#characterLayerGroupForm'),
  characterLayerGroupName: $('#characterLayerGroupName'),
  characterLayerArrangeTools: $('#characterLayerArrangeTools'),
  playAreaAssetPanel: $('#playAreaAssetPanel'),
  pcSidebarTab: $('#pcSidebarTab'),
  layerSidebarTab: $('#layerSidebarTab'),
  pcSidebarPanel: $('#pcSidebarPanel'),
  layerSidebarPanel: $('#layerSidebarPanel'),
  roomGrid: $('#roomGrid'),
  leftSidebar: $('#leftSidebar'),
  sessionSidebar: $('#sessionSidebar'),
  characterStatusBoxes: $('#characterStatusBoxes'),
  playAreaTabs: document.querySelectorAll('.play-area-tab[role="tab"]'),
  characterSheetButton: $('#characterSheetButton'),
  characterSheetDialog: $('#characterSheetDialog'),
  characterSheetClose: $('#characterSheetClose'),
  characterSheetTabs: $('#characterSheetTabs'),
  characterSheetForm: $('#characterSheetForm'),
  deleteNpcButton: $('#deleteNpcButton'),
  characterSheetOwner: $('#characterSheetOwner'),
  characterSheetFields: $('#characterSheetFields'),
  skillRollSettings: $('#skillRollSettings'),
  skillRollSettingList: $('#skillRollSettingList'),
  characterSheetImport: $('#characterSheetImport'),
  characterSheetImportData: $('#characterSheetImportData'),
  characterSheetImportButton: $('#characterSheetImportButton'),
  characterSheetStatus: $('#characterSheetStatus'),
  copyLink: $('#copyLink')
};

const state = {
  typingTimer: null,
  sessionToken: '',
  currentRole: 'pc',
  currentRoomId: '',
  currentMembers: [],
  characterStatuses: [],
  assets: [],
  boardAssets: [],
  bgmPlayers: new Map(),
  masterBgmVolume: 1,
  collapsedGroupIds: new Set(),
  selectedBoardAssetId: '',
  selectedLayerIds: new Set(),
  diceAudioContext: null,
  diceSoundQueue: Promise.resolve(),
  diceSoundBuffers: new Map(),
  characterSheetSystemId: '',
  characterSheetFields: [],
  characterSheets: [],
  activeCharacterSheetPlayerId: '',
  playerId: '',
  inviteToken: params.get('invite') || '',
  isInviteMode: Boolean(params.get('room') && (params.get('invite') || '')),
  roomStorageKey: 'trpg-studio-gm-rooms',
  playerStorageKey: 'trpg-studio-player-ids',
  playerNameStorageKey: 'trpg-studio-player-names',
  memoStorageKey: 'trpg-studio-room-memos'
};

// ヘルパー: エラーメッセージ等のステータス表示
function setStatus(message) {
  if (elements.status) elements.status.textContent = message;
}

function canManageLayerAssets(assets) {
  if (state.currentRole === 'gm') return true;
  return state.currentRole === 'pc' && Boolean(state.playerId) && assets.length > 0
    && assets.every((asset) => asset.category === 'characters' && asset.assignedPlayerId === state.playerId);
}

// LocalStorage Utils
const Storage = {
  get(key, defaultValue) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      return data ?? defaultValue;
    } catch {
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`LocalStorageへの保存失敗 [${key}]:`, e);
    }
  }
};

function getMasterBgmVolumeKey() {
  const owner = state.currentRole === 'pc' ? state.playerId || 'pc' : 'gm';
  return `trpg-studio-master-bgm-volume:${state.currentRoomId}:${owner}`;
}

function setMasterBgmVolume(value, persist = false) {
  const volume = Number(value);
  state.masterBgmVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  if (elements.masterBgmVolume) elements.masterBgmVolume.value = String(state.masterBgmVolume);
  if (persist && state.currentRoomId) Storage.set(getMasterBgmVolumeKey(), state.masterBgmVolume);
  state.boardAssets.forEach((placedAsset) => {
    const player = state.bgmPlayers.get(placedAsset.id);
    const trackVolume = Number(placedAsset.bgmVolume);
    if (player) player.audio.volume = (Number.isFinite(trackVolume) ? trackVolume : 1) * state.masterBgmVolume;
  });
}

if (elements.masterBgmVolume) elements.masterBgmVolume.addEventListener('input', () => setMasterBgmVolume(elements.masterBgmVolume.value, true));

function getSavedRooms() { return Storage.get(state.roomStorageKey, []); }
function saveRooms(rooms) { Storage.set(state.roomStorageKey, rooms); }
function removeSavedRoom(roomId) {
  saveRooms(getSavedRooms().filter((room) => room?.roomId !== roomId));
  renderRoomList();
}

function getSavedPlayerIds() { return Storage.get(state.playerStorageKey, {}); }
function savePlayerId(roomId, playerId) {
  const ids = getSavedPlayerIds();
  ids[roomId] = playerId;
  Storage.set(state.playerStorageKey, ids);
}

function getSavedPlayerNames() { return Storage.get(state.playerNameStorageKey, {}); }
function savePlayerName(roomId, name) {
  const names = getSavedPlayerNames();
  names[roomId] = name;
  Storage.set(state.playerNameStorageKey, names);
}

function getSavedMemos() { return Storage.get(state.memoStorageKey, {}); }
function saveMemo(roomId, memo) {
  const memos = getSavedMemos();
  memos[roomId] = memo;
  Storage.set(state.memoStorageKey, memos);
}

function saveRoom(roomRecord) {
  if (!roomRecord || !roomRecord.roomId) return;
  const rooms = getSavedRooms().filter((r) => r && r.roomId !== roomRecord.roomId);
  rooms.unshift(roomRecord);
  saveRooms(rooms);
  renderRoomList();
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '-'
    : new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatRelativeDate(value) {
  if (!value) return '-';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '-';
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  if (days < 7) return `${days}日前`;
  if (days < 31) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}か月前`;
  return `${Math.floor(days / 365)}年前`;
}

function renderRoomList() {
  if (!elements.roomList) return;
  const rooms = getSavedRooms();
  elements.roomList.innerHTML = '';
  
  if (!rooms.length) {
    const p = document.createElement('p');
    p.className = 'empty-rooms';
    p.textContent = 'ルームがまだ作成されていません。';
    elements.roomList.appendChild(p);
    return;
  }

  rooms.forEach((savedRoom) => {
    const article = document.createElement('article');
    article.className = 'room-card';
    article.dataset.roomId = savedRoom.roomId;

    const heading = document.createElement('div');
    heading.className = 'room-card-heading';
    
    const h3 = document.createElement('h3');
    h3.textContent = `■ ${savedRoom.roomTitle || ''}`;
    
    const span = document.createElement('span');
    span.textContent = savedRoom.systemName || '';
    
    heading.append(h3, span);

    const meta = document.createElement('p');
    meta.className = 'room-meta';
    meta.innerHTML = `作成日: ${formatDate(savedRoom.createdAt)} <b>|</b> 最終更新: ${formatRelativeDate(savedRoom.updatedAt)}`;

    const actions = document.createElement('div');
    actions.className = 'room-actions';

    const enterBtn = document.createElement('button');
    enterBtn.type = 'button';
    enterBtn.dataset.action = 'enter';
    enterBtn.textContent = '部屋に入る';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.dataset.action = 'copy';
    copyBtn.textContent = '招待URLコピー';

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.dataset.action = 'duplicate';
    dupBtn.textContent = '複製';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.dataset.action = 'delete';
    delBtn.className = 'danger';
    delBtn.textContent = '削除';

    actions.append(enterBtn, copyBtn, dupBtn, delBtn);
    article.append(heading, meta, actions);
    elements.roomList.appendChild(article);
  });
}

function findSavedRoom(roomId) {
  return getSavedRooms().find((r) => r && r.roomId === roomId);
}

function updateSavedRoom(roomId, changes) {
  const rooms = getSavedRooms().map((r) => (r && r.roomId === roomId) ? { ...r, ...changes } : r);
  saveRooms(rooms);
  renderRoomList();
}

function roomInviteUrl(savedRoom) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(savedRoom.roomId)}&invite=${encodeURIComponent(savedRoom.inviteToken)}`;
}

function parseDiceNotation(value) {
  const normalized = value.normalize('NFKC').replace(/\s+/g, '');
  const match = normalized.match(/^(\d+)[dD](\d+)(?:([+-])(\d+))?$/);
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? (match[3] === '+' ? Number(match[4]) : -Number(match[4])) : 0;
  if (!Number.isInteger(count) || count < 1 || count > 20 || !Number.isInteger(sides) || sides < 2 || sides > 1000 || Math.abs(modifier) > 100000) return null;
  return { count, sides, modifier, expression: normalized };
}

const diceRollSoundPath = '/assets/sounds/dice/roll.mp3';
const diceSoundPaths = Object.freeze({
  success: '/assets/sounds/dice/success.mp3',
  failure: '/assets/sounds/dice/failure.mp3',
  critical: '/assets/sounds/dice/critical.mp3',
  extremeSuccess: '/assets/sounds/dice/extreme-success.mp3',
  hardSuccess: '/assets/sounds/dice/hard-success.mp3',
  fumble: '/assets/sounds/dice/fumble.mp3'
});

async function playDiceSoundFile(key, path) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return false;
  state.diceAudioContext ||= new AudioContext();
  const context = state.diceAudioContext;
  if (context.state === 'suspended') await context.resume();

  let bufferPromise = state.diceSoundBuffers.get(key);
  if (!bufferPromise) {
    bufferPromise = fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .catch((error) => {
        console.warn(`ダイス効果音を読み込めませんでした: ${path}`, error);
        return null;
      });
    state.diceSoundBuffers.set(key, bufferPromise);
  }
  const buffer = await bufferPromise;
  if (!buffer) return false;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  return new Promise((resolve) => {
    source.addEventListener('ended', () => resolve(true), { once: true });
    try {
      source.start();
    } catch {
      resolve(false);
    }
  });
}

function playDiceRollSound(outcome = '') {
  state.diceSoundQueue = state.diceSoundQueue.then(async () => {
    await playDiceSoundFile('roll', diceRollSoundPath);
    const outcomePath = diceSoundPaths[outcome];
    if (outcomePath) await playDiceSoundFile(outcome, outcomePath);
  }).catch(() => {});
}

function unlockDiceAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.diceAudioContext ||= new AudioContext();
  if (state.diceAudioContext.state === 'suspended') state.diceAudioContext.resume().catch(() => {});
}

document.addEventListener('pointerdown', unlockDiceAudio, { passive: true });
document.addEventListener('keydown', unlockDiceAudio);

function addMessage(message) {
  if (!elements.messageList || !message) return;
  const item = document.createElement('article');
  const isGmPrivate = message.scope === 'private' && (message.role === 'gm' || message.targetRole === 'gm');
  item.className = `message ${message.role === 'gm' ? 'is-gm' : ''} ${message.scope === 'private' ? 'is-private' : ''} ${isGmPrivate ? 'is-gm-private' : ''}`;
  
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  
  const nameStrong = document.createElement('strong');
  nameStrong.textContent = message.name || '';

  if (message.scope === 'private') {
    const privateLabel = document.createElement('small');
    privateLabel.textContent = message.targetName ? `個別: ${message.targetName}` : '個別チャット';
    meta.appendChild(privateLabel);
  }
  
  const timeEl = document.createElement('time');
  timeEl.textContent = new Date(message.time || Date.now()).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  
  meta.append(nameStrong, timeEl);
  
  const textP = document.createElement('p');
  textP.style.whiteSpace = 'pre-wrap';
  textP.textContent = message.text || '';
  
  item.append(meta, textP);
  elements.messageList.append(item);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderMembers(members) {
  if (!Array.isArray(members)) return;
  state.currentMembers = members;
  if (elements.messageTarget) {
    elements.messageTarget.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = '全体チャット';
    elements.messageTarget.appendChild(allOption);
    members.forEach((member) => {
      if (member.role === 'gm' && state.currentRole === 'gm') return;
      if (member.role === 'pc' && member.playerId === state.playerId) return;
      const option = document.createElement('option');
      option.value = member.playerId || member.id;
      option.textContent = `${member.name || '名前未設定'}${member.role === 'gm' ? '（GM）' : ''}`;
      elements.messageTarget.appendChild(option);
    });
  }
  if (elements.diceActor) {
    elements.diceActor.innerHTML = '<option value="">GM</option>';
    members.filter((member) => member.role === 'npc').forEach((npc) => {
      const option = document.createElement('option');
      option.value = npc.id;
      option.textContent = npc.name;
      elements.diceActor.appendChild(option);
    });
  }
  loadCharacterStatuses();
  if (state.currentRole === 'gm' && state.assets.length) renderAssets(state.assets);
}

function renderCharacterStatuses() {
  if (!elements.characterStatusBoxes) return;
  elements.characterStatusBoxes.innerHTML = '';
  state.characterStatuses.forEach((status) => {
    const card = document.createElement('article');
    card.className = `character-status-card${status.role === 'npc' ? ' is-npc' : ''}`;
    const headingRow = document.createElement('div');
    headingRow.className = 'character-status-heading';
    const heading = document.createElement('h3');
    heading.textContent = status.role === 'npc' ? status.name : status.characterName || 'キャラクター未設定';
    headingRow.appendChild(heading);
    const playerName = document.createElement('span');
    playerName.className = 'character-status-player';
    playerName.textContent = status.role === 'npc' ? 'NPC' : `PC: ${status.name || status.playerId}`;
    headingRow.appendChild(playerName);
    if (status.role === 'npc' && state.currentRole === 'gm') {
      const visibilityButton = document.createElement('button');
      visibilityButton.type = 'button';
      visibilityButton.className = 'npc-status-visibility-toggle';
      visibilityButton.textContent = status.statsVisibleToPlayers === false ? 'PCに公開' : 'PCに非公開';
      visibilityButton.addEventListener('click', () => {
        visibilityButton.disabled = true;
        socket.emit('set-npc-status-visibility', {
          npcId: status.playerId,
          visible: status.statsVisibleToPlayers === false
        }, (result) => {
          if (!result?.ok) renderCharacterStatuses();
        });
      });
      headingRow.appendChild(visibilityButton);
    }
    const values = document.createElement('dl');
    [['HP', status.hp], ['SAN', status.san], ['幸運', status.luck]].forEach(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = status.statsHidden ? '非公開' : String(value ?? '').trim() || '－';
      row.append(term, detail);
      if (state.currentRole === 'gm' || (state.currentRole === 'pc' && status.playerId === state.playerId)) {
        const controls = document.createElement('span');
        controls.className = 'character-status-controls';
        [['−', -1, '減らす'], ['+', 1, '増やす']].forEach(([symbol, delta, description]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'character-status-adjust';
          button.textContent = symbol;
          button.title = `${label}を1${description}`;
          button.setAttribute('aria-label', `${status.name || status.playerId}の${label}を1${description}`);
          button.disabled = delta < 0 && Number(value || 0) <= 0;
          button.addEventListener('click', () => {
            button.disabled = true;
            socket.emit('adjust-character-status', { playerId: status.playerId, field: label === 'HP' ? 'hp' : label === 'SAN' ? 'san' : 'luck', delta }, (result) => {
              if (!result?.ok) renderCharacterStatuses();
            });
          });
          controls.appendChild(button);
        });
        row.appendChild(controls);
      }
      values.appendChild(row);
    });
    card.append(headingRow, values);
    elements.characterStatusBoxes.appendChild(card);
  });
  elements.characterStatusBoxes.hidden = state.currentRole === 'entry'
    || state.characterSheetSystemId !== 'coc'
    || state.characterStatuses.length === 0;
}

function loadCharacterStatuses() {
  if (!state.sessionToken) return;
  socket.emit('get-character-statuses', {}, (result) => {
    if (!result?.ok) return;
    state.characterSheetSystemId = result.systemId || state.characterSheetSystemId;
    state.characterStatuses = Array.isArray(result.statuses) ? result.statuses : [];
    renderCharacterStatuses();
  });
}

function renderCharacterSheet() {
  if (!elements.characterSheetFields || !elements.characterSheetForm) return;
  const isGm = state.currentRole === 'gm';
  if (elements.characterSheetTabs) {
    elements.characterSheetTabs.hidden = !isGm;
    elements.characterSheetTabs.innerHTML = '';
    if (isGm) {
      state.characterSheets.forEach((sheet) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `character-sheet-tab${sheet.playerId === state.activeCharacterSheetPlayerId ? ' is-active' : ''}`;
        tab.textContent = `${sheet.role === 'npc' ? 'NPC' : 'PC'}・${sheet.name || sheet.playerId}`;
        tab.setAttribute('aria-selected', String(sheet.playerId === state.activeCharacterSheetPlayerId));
        tab.addEventListener('click', () => {
          state.activeCharacterSheetPlayerId = sheet.playerId;
          renderCharacterSheet();
        });
        elements.characterSheetTabs.appendChild(tab);
      });
      const addNpcButton = document.createElement('button');
      addNpcButton.type = 'button';
      addNpcButton.className = 'character-sheet-tab character-sheet-tab-add';
      addNpcButton.textContent = '+';
      addNpcButton.title = 'NPCを追加';
      addNpcButton.setAttribute('aria-label', 'NPCを追加');
      addNpcButton.addEventListener('click', () => {
        addNpcButton.disabled = true;
        socket.emit('add-npc', {}, (result) => {
          if (!result?.ok) {
            addNpcButton.disabled = false;
            if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = result?.error || 'NPCを追加できませんでした';
            return;
          }
          state.activeCharacterSheetPlayerId = result.npc.id;
          if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = 'NPCを追加しました。名前や能力値を入力してください';
          loadCharacterSheets();
        });
      });
      elements.characterSheetTabs.appendChild(addNpcButton);
    }
  }

  const sheet = state.characterSheets.find((item) => item.playerId === state.activeCharacterSheetPlayerId);
  if (elements.deleteNpcButton) {
    elements.deleteNpcButton.hidden = state.currentRole !== 'gm' || sheet?.role !== 'npc';
    elements.deleteNpcButton.disabled = false;
  }
  if (elements.characterSheetImport) elements.characterSheetImport.hidden = state.characterSheetSystemId !== 'coc';
  if (elements.characterSheetOwner) {
    const systemName = state.characterSheetSystemId === 'coc' ? 'クトゥルフ神話TRPG' : 'エモクロアTRPG';
    elements.characterSheetOwner.textContent = sheet
      ? `${sheet.name || sheet.playerId} ・ ${sheet.role === 'npc' ? 'NPC' : 'PC'} ・ ${systemName}`
      : 'キャラクターシートがありません';
  }
  elements.characterSheetFields.innerHTML = '';
  elements.characterSheetForm.hidden = !sheet;
  if (!sheet) return;

  state.characterSheetFields.forEach(([key, labelText, type, placeholder]) => {
    if (key === 'rollSkills') {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.dataset.sheetField = key;
      input.value = sheet.values?.[key] || '';
      elements.characterSheetFields.appendChild(input);
      return;
    }
    const label = document.createElement('label');
    label.className = `character-sheet-field${type === 'textarea' ? ' is-wide' : ''}`;
    label.append(document.createTextNode(labelText));
    const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (type === 'textarea') { input.rows = 4; input.maxLength = 5000; }
    else input.type = type === 'number' ? 'number' : 'text';
    if (type === 'number') input.step = 'any';
    if (placeholder) input.placeholder = placeholder;
    input.dataset.sheetField = key;
    input.value = sheet.values?.[key] || '';
    if (key === 'skills') {
      input.addEventListener('input', () => {
        sheet.values.skills = input.value;
        renderSkillRollSettings(sheet);
        renderSkillRollButtons();
      });
    }
    label.appendChild(input);
    elements.characterSheetFields.appendChild(label);
  });
  renderSkillRollSettings(sheet);
  renderSkillRollButtons();
}

function parseCocofoliaCharacter(jsonText) {
  const character = JSON.parse(jsonText);
  if (character?.kind !== 'character' || !character.data || typeof character.data !== 'object') {
    throw new Error('ココフォリアのキャラクターデータではありません');
  }

  const { data } = character;
  const values = {};
  const addValue = (key, value) => {
    if (typeof value === 'string' || typeof value === 'number') values[key] = String(value);
  };
  addValue('characterName', data.name);
  addValue('memo', data.memo);
  addValue('initiative', data.initiative);

  const parameterFields = {
    STR: 'str', CON: 'con', POW: 'pow', DEX: 'dex', APP: 'app',
    SIZ: 'siz', INT: 'int', EDU: 'edu', DB: 'db'
  };
  (Array.isArray(data.params) ? data.params : []).forEach((parameter) => {
    const key = parameterFields[String(parameter?.label || '').normalize('NFKC').trim().toUpperCase()];
    if (key) addValue(key, parameter.value);
  });
  if (values.int !== undefined) values.idea = values.int;
  if (values.edu !== undefined) values.knowledge = values.edu;

  const statusFields = { HP: 'hp', MP: 'mp', SAN: 'san', '幸運': 'luck' };
  (Array.isArray(data.status) ? data.status : []).forEach((status) => {
    const key = statusFields[String(status?.label || '').normalize('NFKC').trim().toUpperCase()];
    if (key) addValue(key, status.value ?? status.max);
  });

  const skills = typeof data.commands === 'string'
    ? data.commands.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*CC\s*<=\s*(\d{1,3})\s*(?:〈([^〉]+)〉|<([^>]+)>)/i);
      if (!match) return [];
      const target = Number(match[1]);
      const name = (match[2] || match[3] || '').trim();
      return name && target <= 100 ? [`${name} ${target}`] : [];
    })
    : [];
  if (typeof data.commands === 'string') values.skills = skills.join('\n');

  return { values, skillCount: skills.length };
}

function parseCharacterSkill(line) {
  const match = String(line || '').normalize('NFKC').trim().match(/^(.+?)\s*[:：]?\s*(\d{1,3})$/);
  if (!match) return null;
  const name = match[1].trim();
  const target = Number(match[2]);
  return name && target >= 0 && target <= 100 ? { name, target } : null;
}

const cocBasicRollFields = [
  { name: 'SAN', field: 'san' },
  { name: '幸運', field: 'luck' },
  { name: 'アイデア', field: 'idea' },
  { name: '知識', field: 'knowledge' }
];

function getSkillRollKey(skill) {
  return skill.name;
}

function getCharacterRollSkills(sheet) {
  const basicSkills = state.characterSheetSystemId === 'coc'
    ? cocBasicRollFields.flatMap(({ name, field }) => {
      const value = String(sheet.values?.[field] ?? '').trim();
      const target = Number(value);
      return value && Number.isInteger(target) && target >= 0 && target <= 100
        ? [{ name, target, isBasic: true }]
        : [];
    })
    : [];
  const customSkills = String(sheet.values?.skills || '').split(/\r?\n/)
    .map(parseCharacterSkill).filter(Boolean);
  const seenNames = new Set();
  return [...basicSkills, ...customSkills].filter((skill) => {
    if (seenNames.has(skill.name)) return false;
    seenNames.add(skill.name);
    return true;
  });
}

function getSelectedSkillRollKeys(sheet, skills) {
  const savedValue = typeof sheet.values?.rollSkills === 'string' ? sheet.values.rollSkills : '';
  const savedLines = savedValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const explicitSelection = savedLines.includes('*');
  if (explicitSelection) return new Set(savedLines.filter((line) => line !== '*'));
  if (!savedLines.length) return new Set(skills.map(getSkillRollKey));

  const selected = new Set(skills.filter((skill) => skill.isBasic).map(getSkillRollKey));
  savedLines.map(parseCharacterSkill).filter(Boolean).forEach((skill) => selected.add(getSkillRollKey(skill)));
  return selected;
}

function serializeSkillRollKeys(selectedSkills) {
  return ['*', ...selectedSkills].join('\n');
}

function renderSkillRollSettings(sheet) {
  if (!elements.skillRollSettings || !elements.skillRollSettingList) return;
  const skills = getCharacterRollSkills(sheet);
  const selectionInput = elements.characterSheetFields.querySelector('[data-sheet-field="rollSkills"]');
  if (!selectionInput) return;

  const selectedSkills = getSelectedSkillRollKeys(sheet, skills);
  selectionInput.value = serializeSkillRollKeys(selectedSkills);
  sheet.values.rollSkills = selectionInput.value;
  elements.skillRollSettings.hidden = skills.length === 0;
  elements.skillRollSettingList.innerHTML = '';

  skills.forEach((skill) => {
    const key = getSkillRollKey(skill);
    const label = document.createElement('label');
    label.className = 'skill-roll-setting';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedSkills.has(key);
    checkbox.dataset.skillKey = key;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedSkills.add(key);
      else selectedSkills.delete(key);
      selectionInput.value = serializeSkillRollKeys(selectedSkills);
      sheet.values.rollSkills = selectionInput.value;
      elements.skillRollSettingList.querySelectorAll('[data-skill-key]').forEach((item) => {
        item.checked = selectedSkills.has(item.dataset.skillKey);
      });
      renderSkillRollButtons();
    });
    const text = document.createElement('span');
    text.textContent = `${skill.name} ${skill.target}`;
    label.append(checkbox, text);
    elements.skillRollSettingList.appendChild(label);
  });
}

function renderSkillRollButtons() {
  if (!elements.skillRollList || !elements.skillRollSection) return;
  elements.skillRollList.innerHTML = '';
  const sheets = state.currentRole === 'gm'
    ? state.characterSheets.filter((sheet) => sheet.role === 'npc')
    : state.characterSheets.filter((sheet) => sheet.playerId === state.playerId);
  let skillCount = 0;
  sheets.forEach((sheet) => {
    const skills = getCharacterRollSkills(sheet);
    const selectedSkills = getSelectedSkillRollKeys(sheet, skills);
    skills.forEach((skill) => {
      if (!selectedSkills.has(getSkillRollKey(skill))) return;
      skillCount += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'skill-roll-button';
      button.textContent = state.currentRole === 'gm'
        ? `${sheet.name || sheet.playerId}・${skill.name} ${skill.target}`
        : `${skill.name} ${skill.target}`;
      button.title = `${skill.name}（目標値${skill.target}）を1D100で判定`;
      button.addEventListener('click', () => {
        socket.emit('roll-dice', {
          sides: 100,
          count: 1,
          expression: '1D100',
          skillName: skill.name,
          skillValue: skill.target,
          skillPlayerId: sheet.playerId,
          rollMode: elements.skillRollMode?.value || 'normal'
        });
        switchSessionTab('chat');
      });
      elements.skillRollList.appendChild(button);
    });
  });
  elements.skillRollSection.hidden = skillCount === 0;
}

function loadCharacterSheets() {
  if (!state.sessionToken) return;
  socket.emit('get-character-sheets', {}, (result) => {
    if (!result?.ok) {
      if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = result?.error || 'シートを取得できませんでした';
      return;
    }
    state.characterSheetSystemId = result.systemId;
    state.characterSheetFields = Array.isArray(result.fields) ? result.fields : [];
    state.characterSheets = Array.isArray(result.sheets) ? result.sheets : [];
    if (!state.characterSheets.some((sheet) => sheet.playerId === state.activeCharacterSheetPlayerId)) {
      state.activeCharacterSheetPlayerId = state.currentRole === 'pc' ? state.playerId : state.characterSheets[0]?.playerId || '';
    }
    renderCharacterSheet();
  });
}

function renderAssets(assets) {
  if (!elements.assetList) return;
  state.assets = Array.isArray(assets) ? assets : [];
  elements.assetList.innerHTML = '';
  const visibleAssets = state.assets.filter((asset) => asset.category === elements.assetCategory?.value);
  if (!visibleAssets.length) {
    const p = document.createElement('p');
    p.className = 'empty-assets';
    p.textContent = state.currentRole === 'pc' ? '登録した画像がありません。' : 'このジャンルには素材がありません。';
    elements.assetList.appendChild(p);
    renderBoardAssets();
    return;
  }

  visibleAssets.forEach((asset) => {
    const article = document.createElement('article');
    article.className = 'asset-card';

    if (asset.type?.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = asset.url;
      img.alt = asset.name || '';
      img.loading = 'lazy';
        if (canManageLayerAssets([asset])) {
        const placeButton = document.createElement('button');
        placeButton.type = 'button';
        placeButton.className = 'asset-place';
        placeButton.dataset.assetKey = asset.key;
        placeButton.title = 'プレイエリアに配置';
        placeButton.appendChild(img);
        article.appendChild(placeButton);
      } else {
        img.className = 'asset-preview';
        article.appendChild(img);
      }
    } else {
      const audioSpan = document.createElement('span');
      audioSpan.className = 'asset-audio';
      audioSpan.textContent = '♫';
      article.appendChild(audioSpan);
      if (state.currentRole === 'gm') {
        const placeButton = document.createElement('button');
        placeButton.type = 'button';
        placeButton.className = 'asset-place asset-audio-place';
        placeButton.dataset.assetKey = asset.key;
        placeButton.textContent = '盤面へ';
        placeButton.title = '盤面にBGMプレイヤーを追加';
        article.appendChild(placeButton);
      }
    }

    const infoDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = asset.name || '';
    const small = document.createElement('small');
    small.textContent = asset.category || '';
    infoDiv.append(strong, small);

    article.appendChild(infoDiv);

    if (state.currentRole === 'gm' && asset.category === 'characters') {
      const assignment = document.createElement('select');
      assignment.className = 'character-assignment';
      assignment.setAttribute('aria-label', `${asset.name || 'キャラクター'}の担当PC`);
      const unassigned = document.createElement('option');
      unassigned.value = '';
      unassigned.textContent = '未割当';
      assignment.appendChild(unassigned);
      state.currentMembers.filter((member) => member.role === 'pc').forEach((member) => {
        const option = document.createElement('option');
        option.value = member.playerId;
        option.textContent = member.name || '名前未設定';
        assignment.appendChild(option);
      });
      assignment.value = asset.assignedPlayerId || '';
      assignment.addEventListener('change', () => {
        socket.emit('assign-character', { key: asset.key, playerId: assignment.value }, (result) => {
          if (!result?.ok) {
            setStatus(result?.error || '担当PCを設定できませんでした');
            assignment.value = asset.assignedPlayerId || '';
          }
        });
      });
      article.appendChild(assignment);
    }

    if (state.currentRole === 'gm') {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'asset-delete';
      deleteBtn.type = 'button';
      deleteBtn.dataset.key = asset.key;
      deleteBtn.textContent = '削除';
      article.appendChild(deleteBtn);
    }

    elements.assetList.appendChild(article);
  });
  renderBoardAssets();
}

function getBgmPlayer(placedAsset, asset) {
  let player = state.bgmPlayers.get(placedAsset.id);
  if (!player || player.url !== asset.url) {
    player?.audio.pause();
    const audio = new Audio(asset.url);
    audio.loop = true;
    audio.preload = 'auto';
    player = { audio, url: asset.url, generation: 0 };
    state.bgmPlayers.set(placedAsset.id, player);
  }
  const volume = Number(placedAsset.bgmVolume);
  player.audio.volume = (Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1) * state.masterBgmVolume;
  return player;
}

function stopBgm(player) {
  if (!player) return;
  player.generation += 1;
  player.audio.pause();
  player.audio.currentTime = 0;
}

function pauseBgm(player) {
  if (!player) return;
  player.generation += 1;
  player.audio.pause();
}

function playBgm(player, startedAt = Date.now(), offset = 0) {
  const { audio } = player;
  if (!audio.paused) return;
  const generation = player.generation;
  const start = () => {
    if (!audio.paused || generation !== player.generation) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (offset + (Date.now() - startedAt) / 1000) % audio.duration;
    }
    audio.play().catch(() => {
      if (elements.assetStatus) elements.assetStatus.textContent = 'BGMの再生がブラウザーにブロックされました';
    });
  };
  if (audio.readyState >= 1) start();
  else audio.addEventListener('loadedmetadata', start, { once: true });
}

function clipBoardObjectToPlayArea(image, hitArea, boardLayer) {
  const boardBounds = boardLayer?.getBoundingClientRect();
  const imageBounds = image?.getBoundingClientRect();
  if (!boardBounds?.width || !boardBounds.height || !imageBounds?.width || !imageBounds.height) return;
  const top = Math.max(0, boardBounds.top - imageBounds.top);
  const right = Math.max(0, imageBounds.right - boardBounds.right);
  const bottom = Math.max(0, imageBounds.bottom - boardBounds.bottom);
  const left = Math.max(0, boardBounds.left - imageBounds.left);
  const clipPath = top || right || bottom || left
    ? `inset(${top}px ${right}px ${bottom}px ${left}px)`
    : '';
  image.style.clipPath = clipPath;
  if (hitArea) hitArea.style.clipPath = clipPath;
}

window.addEventListener('resize', () => {
  document.querySelectorAll('.board-asset-image').forEach((image) => {
    const object = image.closest('.board-object');
    clipBoardObjectToPlayArea(image, object?.querySelector('.board-asset-hitarea'), image.closest('.board-assets'));
  });
});

function renderBoardAssets(boardAssets = state.boardAssets) {
  if (!elements.boardAssets || !elements.characterBoardAssets || !elements.layerList || !elements.characterLayerList || !elements.bgmLayerList || !elements.characterLayerBox || !elements.bgmLayerBox) return;
  if (elements.boardDifferenceMenu) elements.boardDifferenceMenu.hidden = true;
  state.boardAssets = Array.isArray(boardAssets) ? boardAssets : [];
  const activeBgmIds = new Set(state.boardAssets.filter((asset) => asset.category === 'bgm').map((asset) => asset.id));
  state.bgmPlayers.forEach((player, assetId) => {
    if (!activeBgmIds.has(assetId)) {
      stopBgm(player);
      state.bgmPlayers.delete(assetId);
    }
  });
  state.selectedLayerIds = new Set([...state.selectedLayerIds].filter((id) => state.boardAssets.some((asset) => asset.id === id && !asset.locked && asset.category !== 'bgm')));
  if (!state.boardAssets.some((asset) => asset.id === state.selectedBoardAssetId && !asset.locked)) state.selectedBoardAssetId = '';
  elements.boardAssets.inert = false;
  elements.characterBoardAssets.inert = false;
  elements.boardAssets.innerHTML = '';
  elements.characterBoardAssets.innerHTML = '';
  elements.layerList.innerHTML = '';
  elements.characterLayerList.innerHTML = '';
  elements.bgmLayerList.innerHTML = '';
  const imageLayers = state.boardAssets.filter((asset) => asset.category !== 'bgm' && asset.category !== 'characters');
  const characterLayers = state.boardAssets.filter((asset) => asset.category === 'characters');
  const visibleCharacterLayers = state.currentRole === 'gm'
    ? characterLayers
    : characterLayers.filter((asset) => asset.assignedPlayerId && asset.assignedPlayerId === state.playerId);
  const bgmLayers = state.boardAssets.filter((asset) => asset.category === 'bgm');
  if (elements.layerBox) elements.layerBox.hidden = state.currentRole !== 'gm' || imageLayers.length === 0;
  elements.characterLayerBox.hidden = state.currentRole !== 'gm' || characterLayers.length === 0;
  elements.bgmLayerBox.hidden = state.currentRole !== 'gm' || bgmLayers.length === 0;
  renderCharacterStatuses();
  const selectedAssets = state.boardAssets.filter((asset) => state.selectedLayerIds.has(asset.id));
  const selectedCategories = new Set(selectedAssets.map((asset) => asset.category));
  const canOperateSelectedAssets = selectedAssets.length >= 2 && selectedCategories.size === 1 && canManageLayerAssets(selectedAssets);
  const selectedCharacters = canOperateSelectedAssets && selectedCategories.has('characters');
  const selectedMaterials = state.currentRole === 'gm' && selectedAssets.length >= 2
    && selectedCategories.size === 1 && !selectedCategories.has('characters') && !selectedCategories.has('bgm');
  if (elements.layerGroupForm) elements.layerGroupForm.hidden = !selectedMaterials;
  if (elements.layerArrangeTools) elements.layerArrangeTools.hidden = !canOperateSelectedAssets || selectedCategories.has('characters') || selectedCategories.has('bgm');
  if (elements.characterLayerGroupForm) elements.characterLayerGroupForm.hidden = !selectedCharacters;
  if (elements.characterLayerArrangeTools) elements.characterLayerArrangeTools.hidden = !selectedCharacters;

  state.boardAssets.forEach((placedAsset, index) => {
    if (placedAsset.differenceSetId && !placedAsset.differenceActive) return;
    const asset = state.assets.find((item) => item.key === placedAsset.key);
    if (!asset?.url) {
      if (placedAsset.category === 'bgm') stopBgm(state.bgmPlayers.get(placedAsset.id));
      return;
    }
    if (placedAsset.visible === false || placedAsset.groupVisible === false) {
      if (placedAsset.category === 'bgm') stopBgm(state.bgmPlayers.get(placedAsset.id));
      return;
    }
    if (placedAsset.category === 'bgm' && asset.type?.startsWith('audio/')) {
      const player = getBgmPlayer(placedAsset, asset);
      if (placedAsset.bgmPlaying) playBgm(player, placedAsset.bgmStartedAt || Date.now(), placedAsset.bgmOffset || 0);
      else if (!player.audio.paused) pauseBgm(player);
      return;
    }
    const canEditBoardAsset = state.currentRole === 'gm'
      || (placedAsset.category === 'characters' && placedAsset.assignedPlayerId === state.playerId && Boolean(state.playerId));
    const object = document.createElement('div');
    const boardLayer = placedAsset.category === 'characters' ? elements.characterBoardAssets : elements.boardAssets;
    const isSelected = state.selectedBoardAssetId === placedAsset.id;
    const isMultiSelected = state.selectedLayerIds.has(placedAsset.id);
    object.className = `board-object${isSelected ? ' is-selected' : ''}${isMultiSelected ? ' is-multi-selected' : ''}${placedAsset.locked ? ' is-locked' : ''}${placedAsset.category === 'characters' ? ' is-character' : ''}${canEditBoardAsset ? ' is-editable' : ''}`;
    object.dataset.assetId = placedAsset.id;
    object.style.zIndex = String(index + 1);
    object.style.left = `${Math.max(0.03, Math.min(0.97, Number(placedAsset.x) || 0.5)) * 100}%`;
    object.style.top = `${Math.max(0.03, Math.min(0.97, Number(placedAsset.y) || 0.5)) * 100}%`;
    object.style.width = `${Math.max(0.04, Math.min(3, Number(placedAsset.width) || 0.16)) * 100}%`;
    object.style.height = `${Math.max(0.04, Math.min(3, Number(placedAsset.height) || 0.19)) * 100}%`;
    const image = document.createElement('img');
    image.className = 'board-asset-image';
    image.alt = placedAsset.name || asset.name || '';
    image.title = `${image.alt}（${placedAsset.placedBy || ''}）`;
    image.draggable = false;
    const hitArea = document.createElement('div');
    hitArea.className = 'board-asset-hitarea';
    const fitBoundingBoxToImage = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const bounds = boardLayer.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const height = Math.max(0.04, Math.min(3, Number(placedAsset.height) || 0.19));
      const width = Math.max(0.04, Math.min(3, height * bounds.height * image.naturalWidth / image.naturalHeight / bounds.width));
      const currentWidth = Number(placedAsset.width) || 0.16;
      object.style.width = `${width * 100}%`;
      clipBoardObjectToPlayArea(image, hitArea, boardLayer);
      if (Math.abs(width - currentWidth) < 0.001) return;
      placedAsset.width = width;
      if (canEditBoardAsset && !placedAsset.locked) {
        socket.emit('update-board-asset', {
          assetId: placedAsset.id,
          action: 'resize',
          x: placedAsset.x,
          y: placedAsset.y,
          width,
          height
        });
      }
    };
    image.addEventListener('load', fitBoundingBoxToImage, { once: true });
    image.src = asset.url;
    object.append(image, hitArea);
    object.addEventListener('contextmenu', (event) => {
      if (!placedAsset.differenceSetId) return;
      const differenceAssets = state.boardAssets.filter((item) => item.differenceSetId === placedAsset.differenceSetId);
      if (differenceAssets.length < 2 || !canManageLayerAssets(differenceAssets)) return;
      event.preventDefault();
      showBoardDifferenceMenu(event, placedAsset, differenceAssets);
    });
    if (canEditBoardAsset && !placedAsset.locked) {
      object.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.bounding-handle')) return;
        if (event.shiftKey) return;
        if (event.button !== 0) return;
        state.selectedBoardAssetId = placedAsset.id;
        event.preventDefault();
        object.setPointerCapture(event.pointerId);
        const bounds = boardLayer.getBoundingClientRect();
        const updatePosition = (pointerEvent) => {
          object.style.left = `${Math.max(0.03, Math.min(0.97, (pointerEvent.clientX - bounds.left) / bounds.width)) * 100}%`;
          object.style.top = `${Math.max(0.03, Math.min(0.97, (pointerEvent.clientY - bounds.top) / bounds.height)) * 100}%`;
          clipBoardObjectToPlayArea(image, hitArea, boardLayer);
        };
        const finishMove = (pointerEvent) => {
          updatePosition(pointerEvent);
          object.removeEventListener('pointermove', updatePosition);
          object.removeEventListener('pointerup', finishMove);
          const x = (pointerEvent.clientX - bounds.left) / bounds.width;
          const y = (pointerEvent.clientY - bounds.top) / bounds.height;
          socket.emit('update-board-asset', { assetId: placedAsset.id, action: 'move', x, y });
        };
        object.addEventListener('pointermove', updatePosition);
        object.addEventListener('pointerup', finishMove);
      });
    }
    object.addEventListener('click', (event) => {
      if (!canEditBoardAsset || placedAsset.locked || event.target.closest('.bounding-handle')) return;
      if (event.shiftKey) {
        if (state.selectedLayerIds.has(placedAsset.id)) {
          state.selectedLayerIds.delete(placedAsset.id);
          if (state.selectedBoardAssetId === placedAsset.id) state.selectedBoardAssetId = [...state.selectedLayerIds].pop() || '';
        } else {
          state.selectedLayerIds.add(placedAsset.id);
          state.selectedBoardAssetId = placedAsset.id;
        }
      } else {
        state.selectedLayerIds = new Set([placedAsset.id]);
        state.selectedBoardAssetId = placedAsset.id;
      }
      renderBoardAssets();
    });
    if (isSelected && canEditBoardAsset && !placedAsset.locked) {
      ['nw', 'ne', 'se', 'sw'].forEach((handle) => {
        const resizeHandle = document.createElement('button');
        resizeHandle.type = 'button';
        resizeHandle.className = `bounding-handle handle-${handle}`;
        resizeHandle.dataset.handle = handle;
        resizeHandle.setAttribute('aria-label', `画像サイズ変更 ${handle}`);
        resizeHandle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          resizeHandle.setPointerCapture(event.pointerId);
          const bounds = boardLayer.getBoundingClientRect();
          const startX = event.clientX;
          const startY = event.clientY;
          const initial = { x: Number(placedAsset.x) || 0.5, y: Number(placedAsset.y) || 0.5, width: Number(placedAsset.width) || 0.16, height: Number(placedAsset.height) || 0.19 };
          const directionX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
          const directionY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
          const resize = (pointerEvent) => {
            const dx = (pointerEvent.clientX - startX) / bounds.width;
            const dy = (pointerEvent.clientY - startY) / bounds.height;
            const width = Math.max(0.04, Math.min(3, initial.width + directionX * dx));
            const height = Math.max(0.04, Math.min(3, initial.height + directionY * dy));
            const x = Math.max(0.03, Math.min(0.97, initial.x + (directionX ? dx / 2 : 0)));
            const y = Math.max(0.03, Math.min(0.97, initial.y + (directionY ? dy / 2 : 0)));
            object.style.width = `${width * 100}%`;
            object.style.height = `${height * 100}%`;
            object.style.left = `${x * 100}%`;
            object.style.top = `${y * 100}%`;
            clipBoardObjectToPlayArea(image, hitArea, boardLayer);
          };
          const finishResize = (pointerEvent) => {
            resize(pointerEvent);
            resizeHandle.removeEventListener('pointermove', resize);
            resizeHandle.removeEventListener('pointerup', finishResize);
            const dx = (pointerEvent.clientX - startX) / bounds.width;
            const dy = (pointerEvent.clientY - startY) / bounds.height;
            socket.emit('update-board-asset', {
              assetId: placedAsset.id,
              action: 'resize',
              x: initial.x + (directionX ? dx / 2 : 0),
              y: initial.y + (directionY ? dy / 2 : 0),
              width: initial.width + directionX * dx,
              height: initial.height + directionY * dy
            });
          };
          resizeHandle.addEventListener('pointermove', resize);
          resizeHandle.addEventListener('pointerup', finishResize);
        });
        object.appendChild(resizeHandle);
      });
    }
    boardLayer.appendChild(object);
    if (image.complete && image.naturalWidth) fitBoundingBoxToImage();
  });

  const layerSections = [
    { assets: [...visibleCharacterLayers].reverse(), list: elements.characterLayerList },
    { assets: [...state.boardAssets].reverse().filter((asset) => asset.category !== 'characters' && asset.category !== 'bgm'), list: elements.layerList },
    { assets: [...state.boardAssets].reverse().filter((asset) => asset.category === 'bgm'), list: elements.bgmLayerList }
  ];
  layerSections.forEach(({ assets: displayOrder, list }) => {
    let activeGroupId = null;
    displayOrder.forEach((placedAsset) => {
      const asset = state.assets.find((item) => item.key === placedAsset.key);
      const isBgmLayer = placedAsset.category === 'bgm';
      const layerGroupId = isBgmLayer ? null : placedAsset.groupId || null;
      if (layerGroupId !== activeGroupId) {
        activeGroupId = layerGroupId;
        if (activeGroupId) {
          const groupId = activeGroupId;
          const groupAssets = state.boardAssets.filter((asset) => asset.groupId === activeGroupId);
          const groupRow = document.createElement('li');
          groupRow.className = 'layer-group-row';
          groupRow.dataset.groupId = activeGroupId;
          groupRow.dataset.assetId = displayOrder.find((asset) => asset.groupId === activeGroupId)?.id || '';
          groupRow.draggable = canManageLayerAssets(groupAssets) && groupAssets.every((asset) => !asset.locked);
          const groupCollapsed = state.collapsedGroupIds.has(activeGroupId);
          const groupMarker = document.createElement('button');
          groupMarker.type = 'button';
          groupMarker.className = 'layer-group-toggle';
          groupMarker.textContent = groupCollapsed ? '▸' : '▾';
          groupMarker.title = placedAsset.differenceSetId
            ? groupCollapsed ? '差分一覧を展開' : '差分一覧を折りたたむ'
            : groupCollapsed ? 'グループを展開' : 'グループを折りたたむ';
          groupMarker.setAttribute('aria-label', groupMarker.title);
          groupMarker.setAttribute('aria-expanded', String(!groupCollapsed));
          groupMarker.addEventListener('click', () => {
            if (state.collapsedGroupIds.has(groupId)) state.collapsedGroupIds.delete(groupId);
            else state.collapsedGroupIds.add(groupId);
            renderBoardAssets();
          });
          const groupName = document.createElement('strong');
          groupName.className = 'layer-group-name';
          groupName.textContent = placedAsset.differenceSetId
            ? `差分: ${placedAsset.groupName || '差分セット'}`
            : placedAsset.groupName || 'グループ';
          const groupCount = document.createElement('small');
          groupCount.className = 'layer-group-count';
          groupCount.textContent = String(groupAssets.length);
          groupRow.append(groupMarker, groupName, groupCount);
          if (canManageLayerAssets(groupAssets)) {
            const controls = document.createElement('div');
            controls.className = 'layer-controls';
            const groupActions = placedAsset.differenceSetId
              ? [
                ['toggle-group-visibility', groupAssets.every((asset) => asset.groupVisible !== false) ? '👁' : '○', '差分表示切り替え', { visible: groupAssets.some((asset) => asset.groupVisible === false) }],
                ['toggle-group-lock', groupAssets.every((asset) => asset.locked) ? '🔒' : '🔓', '差分ロック切り替え', { locked: !groupAssets.every((asset) => asset.locked) }],
                ['ungroup', '解除', '差分登録を解除', {}]
              ]
              : [
                ['toggle-group-visibility', groupAssets.every((asset) => asset.groupVisible !== false) ? '👁' : '○', 'グループ表示切り替え', { visible: groupAssets.some((asset) => asset.groupVisible === false) }],
                ['toggle-group-lock', groupAssets.every((asset) => asset.locked) ? '🔒' : '🔓', 'グループロック切り替え', { locked: !groupAssets.every((asset) => asset.locked) }],
                ['ungroup', '解除', 'グループ解除', {}]
              ];
            groupActions.forEach(([action, label, title, values]) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = `${action.includes('lock') ? 'layer-lock' : ''}${action.includes('lock') && groupAssets.every((asset) => asset.locked) ? ' is-locked' : ''}`;
              button.dataset.layerAction = action;
              button.dataset.groupId = activeGroupId;
              Object.entries(values).forEach(([key, value]) => { button.dataset[key] = String(value); });
              button.textContent = label;
              button.title = title;
              button.setAttribute('aria-label', title);
              controls.appendChild(button);
            });
            groupRow.appendChild(controls);
          }
          list.appendChild(groupRow);
        }
      }
      const row = document.createElement('li');
      row.className = `layer-row${placedAsset.groupId && !isBgmLayer ? ' is-grouped' : ''}${placedAsset.differenceActive ? ' is-difference-active' : ''}${placedAsset.locked && !isBgmLayer ? ' is-locked' : ''}${isBgmLayer ? ' is-bgm-layer' : ''}`;
      row.hidden = Boolean(activeGroupId && state.collapsedGroupIds.has(activeGroupId));
      row.dataset.assetId = placedAsset.id;
      const canManagePlacedAsset = canManageLayerAssets([placedAsset]);
      row.draggable = canManagePlacedAsset && (isBgmLayer || !placedAsset.locked);
      if (canManagePlacedAsset && !isBgmLayer) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'layer-select';
        checkbox.checked = state.selectedLayerIds.has(placedAsset.id);
        checkbox.disabled = Boolean(placedAsset.locked);
        checkbox.dataset.assetId = placedAsset.id;
        checkbox.setAttribute('aria-label', `${placedAsset.name || '画像'}を選択`);
        row.appendChild(checkbox);
      }
      if (isBgmLayer) {
        const icon = document.createElement('span');
        icon.className = 'layer-bgm-icon';
        icon.textContent = '♫';
        icon.setAttribute('aria-hidden', 'true');
        row.appendChild(icon);
      } else {
        const thumbnail = document.createElement('img');
        thumbnail.className = 'layer-thumbnail';
        thumbnail.src = asset?.url || '';
        thumbnail.alt = '';
        thumbnail.draggable = false;
        row.appendChild(thumbnail);
      }
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = placedAsset.name || '画像';
      row.appendChild(name);
      if (state.currentRole === 'gm' && isBgmLayer && asset?.url && asset.type?.startsWith('audio/')) {
        const player = getBgmPlayer(placedAsset, asset);
        const controls = document.createElement('div');
        controls.className = 'layer-controls bgm-layer-controls';
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'bgm-toggle';
        const updateToggleButton = () => {
          toggleButton.textContent = placedAsset.bgmPlaying ? 'Ⅱ' : '▷';
          toggleButton.title = placedAsset.bgmPlaying ? 'BGMを一時停止' : 'BGMを再生（ループ）';
          toggleButton.setAttribute('aria-label', toggleButton.title);
        };
        updateToggleButton();
        toggleButton.addEventListener('click', () => {
          if (placedAsset.bgmPlaying) {
            placedAsset.bgmOffset = player.audio.currentTime || placedAsset.bgmOffset || 0;
            placedAsset.bgmPlaying = false;
            placedAsset.bgmStartedAt = 0;
            pauseBgm(player);
            socket.emit('control-board-bgm', { assetId: placedAsset.id, action: 'pause', currentTime: placedAsset.bgmOffset });
          } else {
            placedAsset.bgmPlaying = true;
            placedAsset.bgmStartedAt = Date.now();
            playBgm(player, placedAsset.bgmStartedAt, placedAsset.bgmOffset || 0);
            socket.emit('control-board-bgm', { assetId: placedAsset.id, action: 'play', currentTime: placedAsset.bgmOffset || 0 });
          }
          updateToggleButton();
        });
        const volumeLabel = document.createElement('label');
        volumeLabel.className = 'bgm-layer-volume';
        volumeLabel.textContent = '音量';
        const volumeInput = document.createElement('input');
        volumeInput.type = 'range';
        volumeInput.min = '0';
        volumeInput.max = '1';
        volumeInput.step = '0.01';
        volumeInput.value = String(placedAsset.bgmVolume ?? player.audio.volume);
        volumeInput.setAttribute('aria-label', `${name.textContent}の音量`);
        volumeInput.addEventListener('input', () => {
          placedAsset.bgmVolume = Number(volumeInput.value);
          player.audio.volume = placedAsset.bgmVolume * state.masterBgmVolume;
        });
        volumeInput.addEventListener('change', () => {
          socket.emit('control-board-bgm', { assetId: placedAsset.id, action: 'volume', volume: placedAsset.bgmVolume }, (result) => {
            if (!result?.ok) setStatus(result?.error || 'BGMの音量を変更できませんでした');
          });
        });
        volumeLabel.appendChild(volumeInput);
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'layer-delete';
        deleteButton.dataset.boardAssetDelete = placedAsset.id;
        deleteButton.textContent = '削除';
        deleteButton.title = '配置を盤面から削除';
        deleteButton.setAttribute('aria-label', `${name.textContent}を盤面から削除`);
        controls.append(toggleButton, volumeLabel, deleteButton);
        row.appendChild(controls);
      } else if (canManagePlacedAsset && !isBgmLayer) {
        const controls = document.createElement('div');
        controls.className = 'layer-controls';
        const lockButton = document.createElement('button');
        lockButton.type = 'button';
        lockButton.className = `layer-lock${placedAsset.locked ? ' is-locked' : ''}`;
        lockButton.dataset.layerAction = 'toggle-lock';
        lockButton.dataset.assetId = placedAsset.id;
        lockButton.textContent = placedAsset.locked ? '🔒' : '🔓';
        lockButton.title = placedAsset.locked ? 'ロック解除' : 'ロック';
        lockButton.setAttribute('aria-label', lockButton.title);
        controls.appendChild(lockButton);
        const visibilityButton = document.createElement('button');
        visibilityButton.type = 'button';
        visibilityButton.className = `layer-visibility${placedAsset.visible === false ? ' is-hidden' : ''}`;
        visibilityButton.dataset.layerAction = 'toggle-visibility';
        visibilityButton.dataset.assetId = placedAsset.id;
        visibilityButton.dataset.visible = String(placedAsset.visible === false);
        visibilityButton.textContent = placedAsset.visible === false ? '○' : '👁';
        visibilityButton.title = placedAsset.visible === false ? '表示する' : '非表示にする';
        visibilityButton.setAttribute('aria-label', visibilityButton.title);
        controls.appendChild(visibilityButton);
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'layer-delete';
        deleteButton.dataset.boardAssetDelete = placedAsset.id;
        deleteButton.textContent = '削除';
        deleteButton.title = '配置を盤面から削除';
        deleteButton.setAttribute('aria-label', `${name.textContent}を盤面から削除`);
        controls.appendChild(deleteButton);
        row.appendChild(controls);
      } else if (!isBgmLayer) {
        const status = document.createElement('small');
        status.className = `layer-status-icons${placedAsset.locked ? ' is-locked' : ''}`;
        status.textContent = `${placedAsset.locked ? '🔒' : ''}${placedAsset.visible === false ? '○' : '👁'}`;
        row.appendChild(status);
      }
      list.appendChild(row);
    });
  });
}

function showBoardDifferenceMenu(event, placedAsset, differenceAssets) {
  const menu = elements.boardDifferenceMenu;
  if (!menu || !elements.playArea) return;
  menu.innerHTML = '';
  differenceAssets.forEach((differenceAsset) => {
    const asset = state.assets.find((item) => item.key === differenceAsset.key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-difference-option';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(differenceAsset.id === placedAsset.id));
    if (asset?.url && asset.type?.startsWith('image/')) {
      const thumbnail = document.createElement('img');
      thumbnail.src = asset.url;
      thumbnail.alt = '';
      button.appendChild(thumbnail);
    }
    const label = document.createElement('span');
    label.textContent = differenceAsset.name || asset?.name || '差分';
    button.appendChild(label);
    button.addEventListener('click', () => {
      menu.hidden = true;
      if (differenceAsset.id === placedAsset.id) return;
      socket.emit('select-board-difference', { differenceSetId: placedAsset.differenceSetId, assetId: differenceAsset.id }, (result) => {
        if (!result?.ok) setStatus(result?.error || '差分を切り替えられませんでした');
      });
    });
    menu.appendChild(button);
  });
  const bounds = elements.playArea.getBoundingClientRect();
  menu.hidden = false;
  const left = Math.max(8, Math.min(bounds.width - menu.offsetWidth - 8, event.clientX - bounds.left));
  const top = Math.max(8, Math.min(bounds.height - menu.offsetHeight - 8, event.clientY - bounds.top));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function editLayerLabel(labelElement, target) {
  const targetAssets = target.groupId
    ? state.boardAssets.filter((asset) => asset.groupId === target.groupId)
    : state.boardAssets.filter((asset) => asset.id === target.assetId);
  if (!canManageLayerAssets(targetAssets) || !labelElement || labelElement.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'layer-inline-edit';
  input.maxLength = 40;
  input.value = labelElement.textContent.trim();
  labelElement.replaceWith(input);
  input.focus();
  input.select();
  let completed = false;
  const finish = (save) => {
    if (completed) return;
    completed = true;
    const name = input.value.trim();
    if (!save || !name) { renderBoardAssets(); return; }
    socket.emit('update-board-asset', { ...target, action: 'rename', name }, (result) => {
      if (!result?.ok) {
        setStatus(result?.error || '名前を変更できませんでした');
        return;
      }
      renderBoardAssets(result.boardAssets);
    });
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true), { once: true });
}

async function loadAssets({ afterUpload = false } = {}) {
  if (!state.sessionToken) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/assets', { headers: { Authorization: `Bearer ${state.sessionToken}` } });
      if (!response.ok) {
        if (elements.assetStatus) {
          elements.assetStatus.textContent = response.status === 503
            ? 'R2未設定'
            : afterUpload
              ? `素材は追加されましたが、一覧を更新できません（HTTP ${response.status}）`
              : `素材を取得できません（HTTP ${response.status}）`;
        }
        return false;
      }
      const data = await response.json();
      renderAssets(data.assets || []);
      if (elements.assetStatus) elements.assetStatus.textContent = '';
      return true;
    } catch (error) {
      if (attempt < 2) {
        if (elements.assetStatus) elements.assetStatus.textContent = '素材一覧を再取得中...';
        await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      console.error('素材一覧の取得に失敗しました:', error);
      if (elements.assetStatus) {
        elements.assetStatus.textContent = afterUpload
          ? '素材は追加されましたが、一覧の通信に失敗しました。接続を確認して再読み込みしてください'
          : `素材一覧の通信に失敗しました${error?.message ? `: ${error.message}` : ''}`;
      }
      return false;
    }
  }
  return false;
}

async function uploadAssets() {
  if (!elements.assetFiles || !elements.assetFiles.files) return;
  const files = [...elements.assetFiles.files];
  if (!files.length) return;
  if (state.currentRole === 'pc' && files.some((file) => !file.type.startsWith('image/'))) {
    if (elements.assetStatus) elements.assetStatus.textContent = '画像ファイルを選択してください';
    return;
  }
  
  if (elements.assetStatus) elements.assetStatus.textContent = `${files.length}件をアップロード中...`;
  
  try {
    const uploadedAssets = [];
    for (const file of files) {
      const permission = await fetch('/api/assets/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.sessionToken}` },
        body: JSON.stringify({ category: state.currentRole === 'pc' ? 'characters' : elements.assetCategory?.value || 'materials', name: file.name, type: file.type, size: file.size })
      });
      if (!permission.ok) throw new Error(`アップロード許可を取得できません (${permission.status})`);

      const { asset, uploadUrl } = await permission.json();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120000);

      try {
        const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, signal: controller.signal });
        if (!upload.ok) throw new Error(`${file.name} のアップロードに失敗しました (${upload.status})`);
      } finally {
        window.clearTimeout(timeout);
      }
      uploadedAssets.push(asset);
      socket.emit('asset-added', asset);
    }
    elements.assetFiles.value = '';
    const uploadedKeys = new Set(uploadedAssets.map((asset) => asset.key));
    state.assets = [...state.assets.filter((asset) => !uploadedKeys.has(asset.key)), ...uploadedAssets];
    renderAssets(state.assets);
    if (elements.assetStatus) elements.assetStatus.textContent = 'アップロード完了';
  } catch (error) {
    if (elements.assetStatus) {
      elements.assetStatus.textContent = error.name === 'AbortError'
        ? 'アップロードがタイムアウトしました'
        : error.message === 'Failed to fetch'
          ? 'R2接続失敗: CORS設定を確認してください'
          : `アップロード失敗: ${error.message}`;
    }
  }
}

function switchLeftSidebarTab(tab) {
  const showLayers = tab === 'layers' && state.currentRole === 'gm';
  if (elements.pcSidebarPanel) elements.pcSidebarPanel.hidden = showLayers;
  if (elements.layerSidebarPanel) elements.layerSidebarPanel.hidden = !showLayers;
  if (elements.pcSidebarTab) {
    elements.pcSidebarTab.classList.toggle('is-active', !showLayers);
    elements.pcSidebarTab.setAttribute('aria-selected', String(!showLayers));
  }
  if (elements.layerSidebarTab) {
    elements.layerSidebarTab.classList.toggle('is-active', showLayers);
    elements.layerSidebarTab.setAttribute('aria-selected', String(showLayers));
  }
}

function enterRoom(result, role) {
  state.currentRoomId = result.roomId;
  state.selectedLayerIds.clear();
  state.boardAssets = Array.isArray(result.boardAssets) ? result.boardAssets : [];
  if (elements.memoInput) elements.memoInput.value = getSavedMemos()[result.roomId] || '';
  state.playerId = result.playerId || state.playerId;
  if (elements.roomLabel) elements.roomLabel.textContent = result.roomTitle || result.roomId;
  if (elements.roomSystem) elements.roomSystem.textContent = result.systemName || '';
  state.currentRole = role;
  setMasterBgmVolume(Storage.get(getMasterBgmVolumeKey(), 1));
  state.characterSheetSystemId = result.systemId || '';
  state.characterStatuses = [];
  if (elements.layerSidebarTab) elements.layerSidebarTab.hidden = role !== 'gm';
  switchLeftSidebarTab('pc');
  if (elements.characterSheetButton) elements.characterSheetButton.hidden = !['gm', 'pc'].includes(role);
  if (elements.assetCategory) {
    if (role === 'pc') elements.assetCategory.value = 'characters';
    const categoryLabel = elements.assetCategory.closest('.asset-genre');
    if (categoryLabel) categoryLabel.hidden = role === 'pc';
  }
  elements.playAreaTabs?.forEach((tab) => { tab.textContent = role === 'pc' ? '登録' : '素材'; });
  if (elements.assetFiles) {
    elements.assetFiles.accept = role === 'pc'
      ? 'image/png,image/jpeg,image/webp,image/gif'
      : 'image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/ogg,audio/wav';
  }
  renderBoardAssets();
  state.sessionToken = result.sessionToken;
  loadCharacterStatuses();
  state.inviteToken = result.inviteToken || state.inviteToken;
  if (role === 'pc' && state.playerId) {
    savePlayerId(result.roomId, state.playerId);
    savePlayerName(result.roomId, elements.nameInput?.value.trim() || '');
  }

  if (role === 'gm') {
    saveRoom({
      roomId: result.roomId,
      roomTitle: result.roomTitle,
      systemId: result.systemId,
      systemName: result.systemName,
      inviteToken: state.inviteToken,
      gmToken: result.gmToken,
      gmName: elements.nameInput ? elements.nameInput.value.trim() : '',
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    });
  }

  if (elements.assetUpload) elements.assetUpload.hidden = !result.r2Configured;
  if (elements.secretDiceOption) elements.secretDiceOption.hidden = role !== 'gm';
  if (elements.diceActorOption) elements.diceActorOption.hidden = role !== 'gm';
  renderMembers(state.currentMembers);
  loadCharacterSheets();
  if (role !== 'gm' && elements.secretDiceInput) elements.secretDiceInput.checked = false;
  if (elements.entry) elements.entry.hidden = true;
  if (elements.room) elements.room.hidden = false;

  const currentUrl = role === 'gm'
    ? location.pathname
    : `?room=${encodeURIComponent(result.roomId)}&invite=${encodeURIComponent(state.inviteToken)}`;
  history.replaceState({}, '', currentUrl);

  if (elements.messageInput) elements.messageInput.focus();
  loadAssets();
}

// Global Event Listeners
if (elements.joinForm) {
  elements.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const eventName = state.isInviteMode ? 'join-room' : 'create-room';
    const payload = state.isInviteMode
      ? { roomId: elements.roomIdInput?.value.trim(), inviteToken: state.inviteToken, playerId: elements.playerIdInput?.value.trim(), name: elements.nameInput?.value.trim() }
      : { systemId: elements.systemIdInput?.value, roomTitle: elements.roomTitleInput?.value.trim(), name: elements.nameInput?.value.trim() };

    socket.emit(eventName, payload, (result) => {
      if (!result?.ok) {
        setStatus(result?.error || '参加できませんでした');
        return;
      }
      enterRoom(result, state.isInviteMode ? 'pc' : 'gm');
    });
  });
}

if (elements.copyLink) {
  elements.copyLink.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${encodeURIComponent(state.currentRoomId)}&invite=${encodeURIComponent(state.inviteToken)}`);
      setStatus('PC参加用URLをコピーしました');
    } catch {
      setStatus('URLのコピーに失敗しました');
    }
  });
}

if (elements.roomListButton) {
  elements.roomListButton.addEventListener('click', () => {
    if (!elements.roomLibrary) return;
    elements.roomLibrary.hidden = !elements.roomLibrary.hidden;
    elements.roomListButton.textContent = elements.roomLibrary.hidden ? 'ルーム一覧' : 'ルーム一覧を閉じる';
    if (!elements.roomLibrary.hidden) renderRoomList();
  });
}

if (elements.roomLibrary) {
  elements.roomLibrary.addEventListener('click', (event) => {
    if (event.target === elements.roomLibrary) {
      elements.roomLibrary.hidden = true;
      if (elements.roomListButton) elements.roomListButton.textContent = 'ルーム一覧';
    }
  });
}

function switchSessionTab(tab) {
  const showChat = tab === 'chat';
  const showDice = tab === 'dice';
  elements.chatPanel.hidden = !showChat;
  elements.dicePanel.hidden = !showDice;
  elements.memoPanel.hidden = tab !== 'memo';
  elements.chatTab.classList.toggle('is-active', showChat);
  elements.diceTab.classList.toggle('is-active', showDice);
  elements.memoTab.classList.toggle('is-active', tab === 'memo');
  elements.chatTab.setAttribute('aria-selected', String(showChat));
  elements.diceTab.setAttribute('aria-selected', String(showDice));
  elements.memoTab.setAttribute('aria-selected', String(tab === 'memo'));
}
elements.chatTab?.addEventListener('click', () => switchSessionTab('chat'));
elements.diceTab?.addEventListener('click', () => switchSessionTab('dice'));
elements.memoTab?.addEventListener('click', () => switchSessionTab('memo'));

if (elements.roomList) {
  elements.roomList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const card = button?.closest('.room-card');
    const savedRoom = card && findSavedRoom(card.dataset.roomId);
    if (!savedRoom) return;

    const action = button.dataset.action;
    if (action === 'copy') {
      navigator.clipboard.writeText(roomInviteUrl(savedRoom));
      setStatus('PC参加用URLをコピーしました');
    } else if (action === 'enter') {
      socket.emit('resume-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken, name: savedRoom.gmName }, (result) => {
        if (!result?.ok) { setStatus(result?.error || 'ルームに入れませんでした'); return; }
        if (elements.nameInput) elements.nameInput.value = savedRoom.gmName || '';
        enterRoom(result, 'gm');
      });
    } else if (action === 'duplicate') {
      socket.emit('duplicate-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken }, (result) => {
        if (!result?.ok) { setStatus(result?.error || 'ルームを複製できませんでした'); return; }
        saveRoom({ ...result, gmName: savedRoom.gmName });
        setStatus('ルームを複製しました');
      });
    } else if (action === 'delete' && window.confirm(`「${savedRoom.roomTitle}」を削除しますか？`)) {
      socket.emit('delete-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken }, (result) => {
        if (!result?.ok) {
          if (result?.error === 'ルーム情報が無効です。') {
            removeSavedRoom(savedRoom.roomId);
            setStatus('存在しないルーム履歴を一覧から削除しました');
          } else {
            setStatus(result?.error || 'ルームを削除できませんでした');
          }
          return;
        }
        removeSavedRoom(savedRoom.roomId);
        setStatus('ルームを削除しました');
      });
    }
  });
}

if (elements.messageForm) {
  elements.messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!elements.messageInput) return;
    const text = elements.messageInput.value.trim();
    if (!text) return;
    const dice = parseDiceNotation(text);
    if (dice) {
      socket.emit('roll-dice', {
        sides: dice.sides,
        count: dice.count,
        modifier: dice.modifier,
        actorId: elements.diceActor?.value || '',
        secret: Boolean(elements.secretDiceInput?.checked)
      });
    } else {
      socket.emit('send-message', { text, targetId: elements.messageTarget?.value || '' });
    }
    elements.messageInput.value = '';
    if (elements.messageTarget) elements.messageTarget.value = '';
    socket.emit('typing', false);
  });
}

if (elements.messageInput) {
  elements.messageInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    elements.messageForm?.requestSubmit();
  });
  elements.messageInput.addEventListener('input', () => {
    socket.emit('typing', true);
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => socket.emit('typing', false), 900);
  });
}

if (elements.memoInput) {
  elements.memoInput.addEventListener('input', () => saveMemo(state.currentRoomId, elements.memoInput.value));
}

elements.characterSheetButton?.addEventListener('click', () => {
  if (!elements.characterSheetDialog?.open) elements.characterSheetDialog?.showModal();
  loadCharacterSheets();
});
elements.characterSheetClose?.addEventListener('click', () => elements.characterSheetDialog?.close());
elements.characterSheetDialog?.addEventListener('click', (event) => {
  if (event.target === elements.characterSheetDialog) elements.characterSheetDialog.close();
});
elements.characterSheetImportButton?.addEventListener('click', () => {
  try {
    const imported = parseCocofoliaCharacter(elements.characterSheetImportData?.value || '');
    const fields = new Map([...elements.characterSheetFields.querySelectorAll('[data-sheet-field]')]
      .map((input) => [input.dataset.sheetField, input]));
    let importedCount = 0;
    Object.entries(imported.values).forEach(([key, value]) => {
      const input = fields.get(key);
      if (!input) return;
      input.value = value;
      importedCount += 1;
    });
    const sheet = state.characterSheets.find((item) => item.playerId === state.activeCharacterSheetPlayerId);
    if (sheet) {
      Object.assign(sheet.values, imported.values);
      renderSkillRollSettings(sheet);
      renderSkillRollButtons();
    }
    if (elements.characterSheetStatus) {
      elements.characterSheetStatus.textContent = `JSONを反映しました（${importedCount}項目、技能${imported.skillCount}件）。内容を確認して保存してください。`;
    }
  } catch (error) {
    if (elements.characterSheetStatus) {
      elements.characterSheetStatus.textContent = error instanceof SyntaxError
        ? 'JSONを読み取れません。コピーしたデータを確認してください。'
        : error.message;
    }
  }
});
elements.characterSheetForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const playerId = state.activeCharacterSheetPlayerId;
  if (!playerId) return;
  const values = Object.fromEntries([...elements.characterSheetFields.querySelectorAll('[data-sheet-field]')]
    .map((input) => [input.dataset.sheetField, input.value]));
  if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = '保存中...';
  socket.emit('update-character-sheet', { playerId, values }, (result) => {
    if (!result?.ok) {
      if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = result?.error || '保存できませんでした';
      return;
    }
    const sheet = state.characterSheets.find((item) => item.playerId === playerId);
    if (sheet) sheet.values = result.values;
    if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = '保存しました';
    renderCharacterSheet();
  });
});
function removeNpcFromClient(npcId) {
  state.characterSheets = state.characterSheets.filter((sheet) => sheet.playerId !== npcId);
  state.characterStatuses = state.characterStatuses.filter((status) => status.playerId !== npcId);
  if (state.activeCharacterSheetPlayerId === npcId) {
    state.activeCharacterSheetPlayerId = state.characterSheets[0]?.playerId || '';
  }
  renderCharacterStatuses();
  renderSkillRollButtons();
  if (elements.characterSheetDialog?.open) renderCharacterSheet();
}

elements.deleteNpcButton?.addEventListener('click', () => {
  const npc = state.characterSheets.find((sheet) => sheet.playerId === state.activeCharacterSheetPlayerId);
  if (state.currentRole !== 'gm' || npc?.role !== 'npc') return;
  const npcName = npc.name || npc.playerId;
  if (!window.confirm(`「${npcName}」を削除します。\n削除したNPCは復元できません。削除しますか？`)) return;
  elements.deleteNpcButton.disabled = true;
  socket.emit('delete-npc', { npcId: npc.playerId }, (result) => {
    if (!result?.ok) {
      elements.deleteNpcButton.disabled = false;
      if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = result?.error || 'NPCを削除できませんでした';
      return;
    }
    removeNpcFromClient(npc.playerId);
    if (elements.characterSheetStatus) elements.characterSheetStatus.textContent = 'NPCを削除しました';
  });
});

elements.playAreaTabs?.forEach((tab) => {
  tab.addEventListener('click', () => {
    const shouldClose = tab.classList.contains('is-active') && elements.playAreaAssetPanel && !elements.playAreaAssetPanel.hidden;
    elements.playAreaTabs.forEach((item) => {
      const active = !shouldClose && item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (elements.playAreaAssetPanel) elements.playAreaAssetPanel.hidden = shouldClose;
  });
});

elements.pcSidebarTab?.addEventListener('click', () => switchLeftSidebarTab('pc'));
elements.layerSidebarTab?.addEventListener('click', () => switchLeftSidebarTab('layers'));
elements.assetCategory?.addEventListener('change', () => renderAssets(state.assets));

// Socket Events
socket.on('connect', () => { setStatus('接続中'); });
socket.on('disconnect', () => { setStatus('接続が切れています'); });
socket.on('history', (messages) => {
  if (elements.messageList) elements.messageList.innerHTML = '';
  if (Array.isArray(messages)) messages.forEach(addMessage);
});
socket.on('message', (message) => {
  if (message?.secret || Array.isArray(message?.rollResults)) playDiceRollSound(message?.rollOutcome);
  addMessage(message);
  if (state.currentRole === 'gm') {
    updateSavedRoom(state.currentRoomId, { updatedAt: new Date().toISOString() });
  }
});
socket.on('members', (members) => {
  renderMembers(members);
  if (state.currentRole === 'gm') loadCharacterSheets();
});
socket.on('character-status-updated', (status) => {
  if (!status?.playerId) return;
  const existing = state.characterStatuses.find((item) => item.playerId === status.playerId);
  if (existing) Object.assign(existing, status);
  else state.characterStatuses.push(status);
  renderCharacterStatuses();
});
socket.on('character-sheet-updated', (update) => {
  const existing = state.characterSheets.find((sheet) => sheet.playerId === update.playerId);
  if (existing) {
    existing.name = update.name;
    existing.values = update.values;
  } else {
    state.characterSheets.push(update);
  }
  renderSkillRollButtons();
  if (elements.characterSheetDialog?.open) renderCharacterSheet();
});
socket.on('npc-deleted', ({ npcId } = {}) => {
  if (typeof npcId === 'string') removeNpcFromClient(npcId);
});
socket.on('typing', ({ name, isTyping }) => {
  if (elements.typing) elements.typing.textContent = isTyping ? `${name} が入力中...` : '';
});
socket.on('asset-added', (asset) => {
  if (!asset?.key || !asset.url) {
    loadAssets();
    return;
  }
  state.assets = [...state.assets.filter((item) => item.key !== asset.key), asset];
  renderAssets(state.assets);
});
socket.on('asset-deleted', loadAssets);
socket.on('character-assigned', loadAssets);
socket.on('board-bgm-control', ({ assetId, action, startedAt, currentTime, volume }) => {
  const placedAsset = state.boardAssets.find((asset) => asset.id === assetId && asset.category === 'bgm');
  if (!placedAsset) return;
  if (action === 'volume') {
    placedAsset.bgmVolume = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : 1;
    const player = state.bgmPlayers.get(assetId);
    if (player) player.audio.volume = placedAsset.bgmVolume * state.masterBgmVolume;
    return;
  }
  placedAsset.bgmPlaying = action === 'play';
  placedAsset.bgmStartedAt = action === 'play' ? startedAt : 0;
  if (Number.isFinite(currentTime)) placedAsset.bgmOffset = Math.max(0, currentTime);
  if (action === 'pause') {
    const player = state.bgmPlayers.get(assetId);
    if (player) pauseBgm(player);
    renderBoardAssets();
    return;
  }
  const asset = state.assets.find((item) => item.key === placedAsset.key);
  if (asset?.url) renderBoardAssets();
  else loadAssets();
});
socket.on('board-assets', (boardAssets) => {
  const assets = Array.isArray(boardAssets) ? boardAssets : [];
  renderBoardAssets(assets);
  if (state.currentRole === 'pc' && assets.some((placedAsset) => !state.assets.some((asset) => asset.key === placedAsset.key))) loadAssets();
});

// URL Params Initialization
if (params.get('room')) {
  if (elements.roomIdInput) elements.roomIdInput.value = params.get('room');
  if (state.isInviteMode) {
    if (elements.roomListButton) elements.roomListButton.hidden = true;
    if (elements.roomLibrary) elements.roomLibrary.hidden = true;
    if (elements.systemLabel) elements.systemLabel.hidden = true;
    if (elements.playerIdLabel) elements.playerIdLabel.hidden = false;
    if (elements.playerIdInput) {
      elements.playerIdInput.required = true;
      elements.playerIdInput.value = getSavedPlayerIds()[params.get('room')] || '';
      if (elements.nameInput) elements.nameInput.value = getSavedPlayerNames()[params.get('room')] || '';
    }
    if (elements.systemIdInput) elements.systemIdInput.removeAttribute('required');
    
    if (elements.roomTitleInput) elements.roomTitleInput.removeAttribute('required');
    const roomTitleLabel = elements.roomTitleInput?.closest('label');
    if (roomTitleLabel) roomTitleLabel.hidden = true;
    
    const nameLabelSpan = elements.nameLabel?.querySelector('span');
    if (nameLabelSpan) nameLabelSpan.textContent = '表示名';
    
    if (elements.roomIdInput) elements.roomIdInput.readOnly = true;
    if (elements.systemIdInput) elements.systemIdInput.disabled = true;
    if (elements.joinButton) elements.joinButton.textContent = 'ルームに入る →';
    if (elements.entryHint) elements.entryHint.textContent = 'GMから共有された招待URLです。表示名を入力して入室してください。';
  }
}

if (elements.assetFiles) elements.assetFiles.addEventListener('change', uploadAssets);
if (elements.assetList) {
  elements.assetList.addEventListener('click', async (event) => {
    const placeButton = event.target.closest('.asset-place');
    if (placeButton) {
      socket.emit('place-board-asset', { key: placeButton.dataset.assetKey }, (result) => {
        if (!result?.ok && elements.assetStatus) elements.assetStatus.textContent = result?.error || '画像を配置できませんでした';
      });
      return;
    }
    const button = event.target.closest('.asset-delete');
    if (!button) return;
    try {
      const response = await fetch('/api/assets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.sessionToken}` },
        body: JSON.stringify({ key: button.dataset.key })
      });
      if (response.ok) loadAssets();
    } catch (e) {
      console.error('Failed to delete asset:', e);
    }
  });
}

const layerBoxes = [elements.layerBox, elements.characterLayerBox].filter(Boolean);
layerBoxes.forEach((layerBox) => {
  layerBox.addEventListener('dblclick', (event) => {
    if (event.target.closest('button, input')) return;
    const groupName = event.target.closest('.layer-group-name');
    if (groupName) {
      const groupId = groupName.closest('.layer-group-row')?.dataset.groupId;
      editLayerLabel(groupName, { groupId });
      return;
    }
    const layerName = event.target.closest('.layer-name');
    if (layerName) editLayerLabel(layerName, { assetId: layerName.closest('.layer-row')?.dataset.assetId });
  });
  layerBox.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('button[data-board-asset-delete]');
    if (deleteButton) {
      socket.emit('remove-board-asset', { assetId: deleteButton.dataset.boardAssetDelete }, (result) => {
        if (!result?.ok) setStatus(result?.error || '盤面から削除できませんでした');
      });
      return;
    }
    const button = event.target.closest('button[data-layer-action]');
    if (!button) return;
    const payload = { assetId: button.dataset.assetId, groupId: button.dataset.groupId, action: button.dataset.layerAction };
    const targetAssets = payload.groupId
      ? state.boardAssets.filter((asset) => asset.groupId === payload.groupId)
      : state.boardAssets.filter((asset) => asset.id === payload.assetId);
    if (!canManageLayerAssets(targetAssets)) return;
    if (button.dataset.visible !== undefined) payload.visible = button.dataset.visible === 'true';
    if (button.dataset.locked !== undefined) payload.locked = button.dataset.locked === 'true';
    socket.emit('update-board-asset', payload, (result) => {
      if (!result?.ok) setStatus(result?.error || 'レイヤーを更新できませんでした');
    });
  });
  layerBox.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.layer-select');
    if (!checkbox) return;
    if (checkbox.checked) {
      state.selectedLayerIds.add(checkbox.dataset.assetId);
      state.selectedBoardAssetId = checkbox.dataset.assetId;
    } else {
      state.selectedLayerIds.delete(checkbox.dataset.assetId);
      if (state.selectedBoardAssetId === checkbox.dataset.assetId) state.selectedBoardAssetId = [...state.selectedLayerIds].pop() || '';
    }
    renderBoardAssets();
  });
});

const reorderableLayerBoxes = [...layerBoxes, elements.bgmLayerBox].filter(Boolean);
reorderableLayerBoxes.forEach((layerBox) => {
  layerBox.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.layer-row[draggable="true"], .layer-group-row[draggable="true"]');
    if (!row || event.target.closest('button, input')) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.assetId);
    row.classList.add('is-dragging');
  });
  layerBox.addEventListener('dragend', (event) => {
    event.target.closest('.layer-row, .layer-group-row')?.classList.remove('is-dragging');
    layerBox.querySelectorAll('.drop-target').forEach((row) => row.classList.remove('drop-target'));
  });
  layerBox.addEventListener('dragover', (event) => {
    const targetRow = event.target.closest('.layer-row, .layer-group-row');
    const asset = state.boardAssets.find((item) => item.id === targetRow?.dataset.assetId);
    if (!asset || !canManageLayerAssets([asset])) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    layerBox.querySelectorAll('.drop-target').forEach((row) => row.classList.remove('drop-target'));
    targetRow?.classList.add('drop-target');
  });
  layerBox.addEventListener('drop', (event) => {
    const targetRow = event.target.closest('.layer-row, .layer-group-row');
    const draggedId = event.dataTransfer.getData('text/plain');
    if (!targetRow || !draggedId || draggedId === targetRow.dataset.assetId) return;
    event.preventDefault();
    const draggedAsset = state.boardAssets.find((asset) => asset.id === draggedId);
    const targetAsset = state.boardAssets.find((asset) => asset.id === targetRow.dataset.assetId);
    if (!draggedAsset || !targetAsset || !canManageLayerAssets([draggedAsset, targetAsset])) return;
    const visibleOrder = [...state.boardAssets].reverse();
    const getBundleKey = (asset) => asset.groupId ? `group:${asset.groupId}` : `asset:${asset.id}`;
    const bundles = [];
    const seenBundles = new Set();
    visibleOrder.forEach((asset) => {
      const key = getBundleKey(asset);
      if (seenBundles.has(key)) return;
      seenBundles.add(key);
      bundles.push(visibleOrder.filter((candidate) => getBundleKey(candidate) === key));
    });
    const sourceKey = getBundleKey(draggedAsset);
    const targetKey = getBundleKey(targetAsset);
    if (sourceKey === targetKey) return;
    const isAfterTarget = event.clientY > targetRow.getBoundingClientRect().top + targetRow.getBoundingClientRect().height / 2;
    const moveBundle = (bundleList) => {
      const sourceIndex = bundleList.findIndex((bundle) => getBundleKey(bundle[0]) === sourceKey);
      if (sourceIndex < 0) return false;
      const [sourceBundle] = bundleList.splice(sourceIndex, 1);
      const targetIndex = bundleList.findIndex((bundle) => getBundleKey(bundle[0]) === targetKey);
      if (!sourceBundle || targetIndex < 0) return false;
      bundleList.splice(targetIndex + (isAfterTarget ? 1 : 0), 0, sourceBundle);
      return true;
    };
    if (state.currentRole === 'pc') {
      const ownedPositions = bundles.map((bundle, index) => bundle.every((asset) => canManageLayerAssets([asset])) ? index : -1).filter((index) => index >= 0);
      const ownedBundles = ownedPositions.map((index) => bundles[index]);
      if (!moveBundle(ownedBundles)) return;
      ownedPositions.forEach((position, index) => { bundles[position] = ownedBundles[index]; });
    } else if (!moveBundle(bundles)) {
      return;
    }
    const reorderedVisible = bundles.flat();
    state.boardAssets = [...reorderedVisible].reverse();
    renderBoardAssets();
    socket.emit('update-board-asset', { assetId: draggedId, action: 'reorder', order: reorderedVisible.map((asset) => asset.id) }, (result) => {
      if (!result?.ok) setStatus(result?.error || 'レイヤーを並べ替えられませんでした');
    });
  });
});

if (elements.bgmLayerBox) {
  elements.bgmLayerBox.addEventListener('dblclick', (event) => {
    if (state.currentRole !== 'gm' || event.target.closest('button, input')) return;
    const layerName = event.target.closest('.layer-name');
    if (layerName) editLayerLabel(layerName, { assetId: layerName.closest('.layer-row')?.dataset.assetId });
  });
  elements.bgmLayerBox.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('button[data-board-asset-delete]');
    if (!deleteButton) return;
    socket.emit('remove-board-asset', { assetId: deleteButton.dataset.boardAssetDelete }, (result) => {
      if (!result?.ok) setStatus(result?.error || '盤面から削除できませんでした');
    });
  });
}

const enableLayerBoxDragging = (box, handle, handleSelector = '') => {
  if (!box || !handle || !elements.playArea) return;
  handle.addEventListener('pointerdown', (event) => {
    if (handleSelector && !event.target.closest(handleSelector)) return;
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const bounds = elements.playArea.getBoundingClientRect();
    const boxBounds = box.getBoundingClientRect();
    const offsetX = event.clientX - boxBounds.left;
    const offsetY = event.clientY - boxBounds.top;
    box.style.left = `${boxBounds.left - bounds.left}px`;
    box.style.top = `${boxBounds.top - bounds.top}px`;
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    const move = (pointerEvent) => {
      const maxLeft = Math.max(0, bounds.width - boxBounds.width);
      const maxTop = Math.max(0, bounds.height - boxBounds.height);
      const left = Math.max(0, Math.min(maxLeft, pointerEvent.clientX - bounds.left - offsetX));
      const top = Math.max(0, Math.min(maxTop, pointerEvent.clientY - bounds.top - offsetY));
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
};

enableLayerBoxDragging(elements.characterStatusBoxes, elements.characterStatusBoxes, '.character-status-card h3');

const layerArrangeToolsets = [elements.layerArrangeTools, elements.characterLayerArrangeTools].filter(Boolean);
layerArrangeToolsets.forEach((tools) => {
  tools.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-layer-batch]');
    const selectedAssets = state.boardAssets.filter((asset) => state.selectedLayerIds.has(asset.id));
    if (!button || selectedAssets.length < 2 || !canManageLayerAssets(selectedAssets)) return;
    socket.emit('update-board-asset', { action: button.dataset.layerBatch, assetIds: [...state.selectedLayerIds] }, (result) => {
      if (!result?.ok) {
        setStatus(result?.error || 'レイヤーを整列できませんでした');
        return;
      }
      renderBoardAssets(result.boardAssets);
    });
  });
});

elements.playArea?.addEventListener('click', (event) => {
  if (!event.target.closest('.board-difference-menu') && elements.boardDifferenceMenu) elements.boardDifferenceMenu.hidden = true;
  if (event.target.closest('.board-object, .board-difference-menu, .play-area-tools, .layer-box, .character-layer-box, .bgm-layer-box')) return;
  if (!state.selectedLayerIds.size && !state.selectedBoardAssetId) return;
  state.selectedLayerIds.clear();
  state.selectedBoardAssetId = '';
  renderBoardAssets();
});

const layerGroupForms = [
  [elements.layerGroupForm, elements.layerGroupName],
  [elements.characterLayerGroupForm, elements.characterLayerGroupName]
];
layerGroupForms.forEach(([form, nameInput]) => {
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const selectedAssets = state.boardAssets.filter((asset) => state.selectedLayerIds.has(asset.id));
    if (selectedAssets.length < 2 || !canManageLayerAssets(selectedAssets)) {
      setStatus('差分登録する画像を2つ以上選択してください');
      return;
    }
    const selectedCategories = new Set(selectedAssets.map((asset) => asset.category));
    const assignedPlayers = new Set(selectedAssets.map((asset) => asset.assignedPlayerId || ''));
    if (selectedCategories.size !== 1 || selectedCategories.has('bgm') || assignedPlayers.size !== 1
      || selectedAssets.some((asset) => asset.differenceSetId)) {
      setStatus('同じカテゴリ・同じ担当の未登録画像を選択してください。BGMは差分登録できません');
      return;
    }
    const existingNames = new Set(state.boardAssets.filter((asset) => asset.differenceSetId).map((asset) => asset.groupName).filter(Boolean));
    let differenceNumber = 1;
    while (existingNames.has(`差分${differenceNumber}`)) differenceNumber += 1;
    const groupName = nameInput?.value.trim() || `差分${differenceNumber}`;
    const selectedIds = [...state.selectedLayerIds];
    socket.emit('update-board-asset', { action: 'register-differences', assetIds: selectedIds, groupName }, (result) => {
      if (!result?.ok) {
        setStatus(result?.error || '差分を登録できませんでした');
        return;
      }
      state.selectedLayerIds.clear();
      state.selectedBoardAssetId = result.boardAssets.find((asset) => selectedIds.includes(asset.id) && asset.differenceActive)?.id || '';
      if (nameInput) nameInput.value = '';
      renderBoardAssets(result.boardAssets);
    });
  });
});

renderRoomList();