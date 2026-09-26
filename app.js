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
  membersTab: $('#membersTab'),
  memoTab: $('#memoTab'),
  chatPanel: $('#chatPanel'),
  dicePanel: $('#dicePanel'),
  secretDiceOption: $('#secretDiceOption'),
  secretDiceInput: $('#secretDiceInput'),
  diceActorOption: $('#diceActorOption'),
  diceActor: $('#diceActor'),
  npcForm: $('#npcForm'),
  npcName: $('#npcName'),
  membersPanel: $('#membersPanel'),
  memoPanel: $('#memoPanel'),
  memoInput: $('#memoInput'),
  roomLabel: $('#roomLabel'),
  roomSystem: $('#roomSystem'),
  memberList: $('#memberList'),
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
  boardAssets: $('#boardAssets'),
  layerBox: $('#layerBox'),
  layerList: $('#layerList'),
  layerGroupForm: $('#layerGroupForm'),
  layerGroupName: $('#layerGroupName'),
  layerArrangeTools: $('#layerArrangeTools'),
  playAreaAssetPanel: $('#playAreaAssetPanel'),
  playAreaTabs: document.querySelectorAll('.play-area-tab'),
  copyLink: $('#copyLink')
};

const state = {
  typingTimer: null,
  sessionToken: '',
  currentRole: 'pc',
  currentRoomId: '',
  currentMembers: [],
  assets: [],
  boardAssets: [],
  selectedBoardAssetId: '',
  selectedLayerIds: new Set(),
  playerId: '',
  inviteToken: params.get('invite') || '',
  isInviteMode: Boolean(params.get('room') && (params.get('invite') || '')),
  roomStorageKey: 'trpg-studio-gm-rooms',
  playerStorageKey: 'trpg-studio-player-ids',
  playerNameStorageKey: 'trpg-studio-player-names',
  memoStorageKey: 'trpg-studio-room-memos'
};

function getSavedRooms() {
  try {
    const data = JSON.parse(localStorage.getItem(state.roomStorageKey) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveRooms(rooms) {
  try {
    localStorage.setItem(state.roomStorageKey, JSON.stringify(rooms));
  } catch (e) {
    console.error('LocalStorageへの保存に失敗しました:', e);
  }
}
function removeSavedRoom(roomId) {
  saveRooms(getSavedRooms().filter((room) => room?.roomId !== roomId));
  renderRoomList();
}

function getSavedPlayerIds() {
  try {
    const data = JSON.parse(localStorage.getItem(state.playerStorageKey) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}

function savePlayerId(roomId, playerId) {
  const playerIds = getSavedPlayerIds();
  playerIds[roomId] = playerId;
  try { localStorage.setItem(state.playerStorageKey, JSON.stringify(playerIds)); } catch (e) { console.error('プレイヤーIDの保存に失敗しました:', e); }
}
function getSavedPlayerNames() {
  try {
    const data = JSON.parse(localStorage.getItem(state.playerNameStorageKey) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
function savePlayerName(roomId, name) {
  const names = getSavedPlayerNames();
  names[roomId] = name;
  try { localStorage.setItem(state.playerNameStorageKey, JSON.stringify(names)); } catch (e) { console.error('表示名の保存に失敗しました:', e); }
}
function getSavedMemos() {
  try {
    const data = JSON.parse(localStorage.getItem(state.memoStorageKey) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}
function saveMemo(roomId, memo) {
  const memos = getSavedMemos();
  memos[roomId] = memo;
  try { localStorage.setItem(state.memoStorageKey, JSON.stringify(memos)); } catch (e) { console.error('メモの保存に失敗しました:', e); }
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
  if (!elements.memberList || !Array.isArray(members)) return;
  state.currentMembers = members;
  elements.memberList.innerHTML = '';
  if (elements.npcForm) elements.npcForm.hidden = state.currentRole !== 'gm';
  members.forEach((member) => {
    const li = document.createElement('li');
    
    const presence = document.createElement('span');
    presence.className = 'presence';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = member.name || '';
    
    const roleSmall = document.createElement('small');
    roleSmall.textContent = member.role === 'gm' ? 'GM' : member.role === 'npc' ? 'NPC' : 'PC';
    
    li.append(presence, nameSpan, roleSmall);
    elements.memberList.appendChild(li);
  });
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
}

function renderAssets(assets) {
  if (!elements.assetList) return;
  state.assets = Array.isArray(assets) ? assets : [];
  elements.assetList.innerHTML = '';
  const visibleAssets = state.assets.filter((asset) => asset.category === elements.assetCategory?.value);
  if (!visibleAssets.length) {
    const p = document.createElement('p');
    p.className = 'empty-assets';
    p.textContent = 'このジャンルには素材がありません。';
    elements.assetList.appendChild(p);
    return;
  }

  visibleAssets.forEach((asset) => {
    const article = document.createElement('article');
    article.className = 'asset-card';

    if (asset.type?.startsWith('image/')) {
      const placeButton = document.createElement('button');
      placeButton.type = 'button';
      placeButton.className = 'asset-place';
      placeButton.dataset.assetKey = asset.key;
      placeButton.title = 'プレイエリアに配置';
      const img = document.createElement('img');
      img.src = asset.url;
      img.alt = asset.name || '';
      img.loading = 'lazy';
      placeButton.appendChild(img);
      article.appendChild(placeButton);
    } else {
      const link = document.createElement('a');
      link.href = asset.url || '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      const audioSpan = document.createElement('span');
      audioSpan.className = 'asset-audio';
      audioSpan.textContent = '♫';
      link.appendChild(audioSpan);
      article.appendChild(link);
    }

    const infoDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = asset.name || '';
    const small = document.createElement('small');
    small.textContent = asset.category || '';
    infoDiv.append(strong, small);

    article.appendChild(infoDiv);

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

function renderBoardAssets(boardAssets = state.boardAssets) {
  if (!elements.boardAssets || !elements.layerList) return;
  state.boardAssets = Array.isArray(boardAssets) ? boardAssets : [];
  state.selectedLayerIds = new Set([...state.selectedLayerIds].filter((id) => state.boardAssets.some((asset) => asset.id === id)));
  if (!state.boardAssets.some((asset) => asset.id === state.selectedBoardAssetId)) state.selectedBoardAssetId = '';
  elements.boardAssets.innerHTML = '';
  elements.layerList.innerHTML = '';
  if (elements.layerBox) elements.layerBox.hidden = state.boardAssets.length === 0;
  if (elements.layerGroupForm) elements.layerGroupForm.hidden = state.currentRole !== 'gm' || state.selectedLayerIds.size < 2;
  if (elements.layerArrangeTools) elements.layerArrangeTools.hidden = state.currentRole !== 'gm' || state.selectedLayerIds.size < 2;

  state.boardAssets.forEach((placedAsset, index) => {
    const asset = state.assets.find((item) => item.key === placedAsset.key);
    if (!asset?.url || placedAsset.visible === false) return;
    const object = document.createElement('div');
    const isSelected = state.selectedBoardAssetId === placedAsset.id;
    object.className = `board-object${isSelected ? ' is-selected' : ''}${placedAsset.locked ? ' is-locked' : ''}`;
    object.dataset.assetId = placedAsset.id;
    object.style.zIndex = String(index + 1);
    object.style.left = `${Math.max(0.03, Math.min(0.97, Number(placedAsset.x) || 0.5)) * 100}%`;
    object.style.top = `${Math.max(0.03, Math.min(0.97, Number(placedAsset.y) || 0.5)) * 100}%`;
    object.style.width = `${Math.max(0.04, Math.min(0.9, Number(placedAsset.width) || 0.16)) * 100}%`;
    object.style.height = `${Math.max(0.04, Math.min(0.9, Number(placedAsset.height) || 0.19)) * 100}%`;
    const image = document.createElement('img');
    image.className = 'board-asset-image';
    image.src = asset.url;
    image.alt = placedAsset.name || asset.name || '';
    image.title = `${image.alt}（${placedAsset.placedBy || ''}）`;
    image.draggable = false;
    object.appendChild(image);
    if (!placedAsset.locked) {
      object.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.bounding-handle')) return;
        if (event.button !== 0) return;
        state.selectedBoardAssetId = placedAsset.id;
        event.preventDefault();
        object.setPointerCapture(event.pointerId);
        const bounds = elements.boardAssets.getBoundingClientRect();
        const updatePosition = (pointerEvent) => {
          object.style.left = `${Math.max(0.03, Math.min(0.97, (pointerEvent.clientX - bounds.left) / bounds.width)) * 100}%`;
          object.style.top = `${Math.max(0.03, Math.min(0.97, (pointerEvent.clientY - bounds.top) / bounds.height)) * 100}%`;
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
      if (event.target.closest('.bounding-handle')) return;
      const selectionChanged = state.selectedBoardAssetId !== placedAsset.id || !state.selectedLayerIds.has(placedAsset.id);
      state.selectedBoardAssetId = placedAsset.id;
      state.selectedLayerIds.add(placedAsset.id);
      if (selectionChanged) renderBoardAssets();
    });
    if (isSelected && !placedAsset.locked) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((handle) => {
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
          const bounds = elements.boardAssets.getBoundingClientRect();
          const startX = event.clientX;
          const startY = event.clientY;
          const initial = { x: Number(placedAsset.x) || 0.5, y: Number(placedAsset.y) || 0.5, width: Number(placedAsset.width) || 0.16, height: Number(placedAsset.height) || 0.19 };
          const directionX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
          const directionY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
          const resize = (pointerEvent) => {
            const dx = (pointerEvent.clientX - startX) / bounds.width;
            const dy = (pointerEvent.clientY - startY) / bounds.height;
            const width = Math.max(0.04, Math.min(0.9, initial.width + directionX * dx));
            const height = Math.max(0.04, Math.min(0.9, initial.height + directionY * dy));
            const x = Math.max(0.03, Math.min(0.97, initial.x + (directionX ? dx / 2 : 0)));
            const y = Math.max(0.03, Math.min(0.97, initial.y + (directionY ? dy / 2 : 0)));
            object.style.width = `${width * 100}%`;
            object.style.height = `${height * 100}%`;
            object.style.left = `${x * 100}%`;
            object.style.top = `${y * 100}%`;
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
    elements.boardAssets.appendChild(object);
  });

  const displayOrder = [...state.boardAssets].reverse();
  let activeGroupId = null;
  displayOrder.forEach((placedAsset, reversedIndex) => {
    const asset = state.assets.find((item) => item.key === placedAsset.key);
    if (placedAsset.groupId !== activeGroupId) {
      activeGroupId = placedAsset.groupId || null;
      if (activeGroupId) {
        const groupAssets = state.boardAssets.filter((asset) => asset.groupId === activeGroupId);
        const groupRow = document.createElement('li');
        groupRow.className = 'layer-group-row';
        groupRow.dataset.groupId = activeGroupId;
        const groupMarker = document.createElement('span');
        groupMarker.className = 'layer-group-marker';
        groupMarker.textContent = '▾';
        const groupName = document.createElement('strong');
        groupName.className = 'layer-group-name';
        groupName.textContent = placedAsset.groupName || 'グループ';
        const groupCount = document.createElement('small');
        groupCount.className = 'layer-group-count';
        groupCount.textContent = String(groupAssets.length);
        groupRow.append(groupMarker, groupName, groupCount);
        if (state.currentRole === 'gm') {
          const controls = document.createElement('div');
          controls.className = 'layer-controls';
          [
            ['toggle-group-visibility', groupAssets.every((asset) => asset.visible !== false) ? '👁' : '○', 'グループ表示切り替え', { visible: groupAssets.some((asset) => asset.visible === false) }],
            ['toggle-group-lock', groupAssets.every((asset) => asset.locked) ? '🔒' : '🔓', 'グループロック切り替え', { locked: !groupAssets.every((asset) => asset.locked) }],
            ['ungroup', '解除', 'グループ解除', {}]
          ].forEach(([action, label, title, values]) => {
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
        elements.layerList.appendChild(groupRow);
      }
    }
    const row = document.createElement('li');
    row.className = `layer-row${placedAsset.groupId ? ' is-grouped' : ''}${placedAsset.locked ? ' is-locked' : ''}`;
    row.dataset.assetId = placedAsset.id;
    row.draggable = state.currentRole === 'gm' && !placedAsset.locked;
    if (state.currentRole === 'gm') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'layer-select';
      checkbox.checked = state.selectedLayerIds.has(placedAsset.id);
      checkbox.dataset.assetId = placedAsset.id;
      checkbox.setAttribute('aria-label', `${placedAsset.name || '画像'}を選択`);
      row.appendChild(checkbox);
    }
    const thumbnail = document.createElement('img');
    thumbnail.className = 'layer-thumbnail';
    thumbnail.src = asset?.url || '';
    thumbnail.alt = '';
    thumbnail.draggable = false;
    row.appendChild(thumbnail);
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = placedAsset.name || '画像';
    row.appendChild(name);
    if (state.currentRole === 'gm') {
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
      row.appendChild(controls);
    } else {
      const status = document.createElement('small');
      status.className = `layer-status-icons${placedAsset.locked ? ' is-locked' : ''}`;
      status.textContent = `${placedAsset.locked ? '🔒' : ''}${placedAsset.visible === false ? '○' : '👁'}`;
      row.appendChild(status);
    }
    elements.layerList.appendChild(row);
  });
}

function editLayerLabel(labelElement, target) {
  if (state.currentRole !== 'gm' || !labelElement || labelElement.querySelector('input')) return;
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
        if (elements.status) elements.status.textContent = result?.error || '名前を変更できませんでした';
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

async function loadAssets() {
  if (!state.sessionToken) return;
  try {
    const response = await fetch('/api/assets', { headers: { Authorization: `Bearer ${state.sessionToken}` } });
    if (!response.ok) {
      if (elements.assetStatus) {
        elements.assetStatus.textContent = response.status === 503 ? 'R2未設定' : '素材を取得できません';
      }
      return;
    }
    const data = await response.json();
    renderAssets(data.assets || []);
    if (elements.assetStatus) elements.assetStatus.textContent = '';
  } catch {
    if (elements.assetStatus) elements.assetStatus.textContent = '通信エラーが発生しました';
  }
}

async function uploadAssets() {
  if (!elements.assetFiles || !elements.assetFiles.files) return;
  const files = [...elements.assetFiles.files];
  if (!files.length) return;
  
  if (elements.assetStatus) elements.assetStatus.textContent = `${files.length}件をアップロード中...`;
  
  try {
    for (const file of files) {
      const permission = await fetch('/api/assets/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.sessionToken}` },
        body: JSON.stringify({ category: elements.assetCategory?.value || 'materials', name: file.name, type: file.type, size: file.size })
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
      socket.emit('asset-added', asset);
    }
    elements.assetFiles.value = '';
    if (elements.assetStatus) elements.assetStatus.textContent = 'アップロード完了';
    loadAssets();
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

function enterRoom(result, role) {
  state.currentRoomId = result.roomId;
  state.selectedLayerIds.clear();
  state.boardAssets = Array.isArray(result.boardAssets) ? result.boardAssets : [];
  if (elements.memoInput) elements.memoInput.value = getSavedMemos()[result.roomId] || '';
  state.playerId = result.playerId || state.playerId;
  if (elements.roomLabel) elements.roomLabel.textContent = result.roomTitle || result.roomId;
  if (elements.roomSystem) elements.roomSystem.textContent = result.systemName || '';
  state.currentRole = role;
  renderBoardAssets();
  state.sessionToken = result.sessionToken;
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

  if (elements.assetUpload) {
    elements.assetUpload.hidden = state.currentRole !== 'gm' || !result.r2Configured;
  }
  if (elements.secretDiceOption) elements.secretDiceOption.hidden = role !== 'gm';
  if (elements.diceActorOption) elements.diceActorOption.hidden = role !== 'gm';
  if (elements.npcForm) elements.npcForm.hidden = role !== 'gm';
  renderMembers(state.currentMembers);
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
        if (elements.status) elements.status.textContent = result?.error || '参加できませんでした';
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
      if (elements.status) elements.status.textContent = 'PC参加用URLをコピーしました';
    } catch {
      if (elements.status) elements.status.textContent = 'URLのコピーに失敗しました';
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
  const showMembers = tab === 'members';
  elements.chatPanel.hidden = !showChat;
  elements.dicePanel.hidden = !showDice;
  elements.membersPanel.hidden = !showMembers;
  elements.memoPanel.hidden = tab !== 'memo';
  elements.chatTab.classList.toggle('is-active', showChat);
  elements.diceTab.classList.toggle('is-active', showDice);
  elements.membersTab.classList.toggle('is-active', showMembers);
  elements.memoTab.classList.toggle('is-active', tab === 'memo');
  elements.chatTab.setAttribute('aria-selected', String(showChat));
  elements.diceTab.setAttribute('aria-selected', String(showDice));
  elements.membersTab.setAttribute('aria-selected', String(showMembers));
  elements.memoTab.setAttribute('aria-selected', String(tab === 'memo'));
}
elements.chatTab?.addEventListener('click', () => switchSessionTab('chat'));
elements.diceTab?.addEventListener('click', () => switchSessionTab('dice'));
elements.membersTab?.addEventListener('click', () => switchSessionTab('members'));
elements.memoTab?.addEventListener('click', () => switchSessionTab('memo'));

elements.dicePanel?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-dice-sides]');
  if (!button) return;
  socket.emit('roll-dice', { sides: Number(button.dataset.diceSides), count: 1, actorId: elements.diceActor?.value || '', secret: Boolean(elements.secretDiceInput?.checked) });
  switchSessionTab('chat');
});

if (elements.roomList) {
  elements.roomList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const card = button?.closest('.room-card');
    const savedRoom = card && findSavedRoom(card.dataset.roomId);
    if (!savedRoom) return;

    const action = button.dataset.action;
    if (action === 'copy') {
      navigator.clipboard.writeText(roomInviteUrl(savedRoom));
      if (elements.status) elements.status.textContent = 'PC参加用URLをコピーしました';
    } else if (action === 'enter') {
      socket.emit('resume-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken, name: savedRoom.gmName }, (result) => {
        if (!result?.ok) { if (elements.status) elements.status.textContent = result?.error || 'ルームに入れませんでした'; return; }
        if (elements.nameInput) elements.nameInput.value = savedRoom.gmName || '';
        enterRoom(result, 'gm');
      });
    } else if (action === 'duplicate') {
      socket.emit('duplicate-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken }, (result) => {
        if (!result?.ok) { if (elements.status) elements.status.textContent = result?.error || 'ルームを複製できませんでした'; return; }
        saveRoom({ ...result, gmName: savedRoom.gmName });
        if (elements.status) elements.status.textContent = 'ルームを複製しました';
      });
    } else if (action === 'delete' && window.confirm(`「${savedRoom.roomTitle}」を削除しますか？`)) {
      socket.emit('delete-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken }, (result) => {
        if (!result?.ok) {
          if (result?.error === 'ルーム情報が無効です。') {
            removeSavedRoom(savedRoom.roomId);
            if (elements.status) elements.status.textContent = '存在しないルーム履歴を一覧から削除しました';
          } else if (elements.status) {
            elements.status.textContent = result?.error || 'ルームを削除できませんでした';
          }
          return;
        }
        removeSavedRoom(savedRoom.roomId);
        if (elements.status) elements.status.textContent = 'ルームを削除しました';
      });
    }
  });
}

if (elements.npcForm) {
  elements.npcForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = elements.npcName?.value.trim();
    if (!name || state.currentRole !== 'gm') return;
    socket.emit('add-npc', { name }, (result) => {
      if (!result?.ok) {
        if (elements.status) elements.status.textContent = result?.error || 'NPCを追加できませんでした';
        return;
      }
      elements.npcName.value = '';
      if (elements.status) elements.status.textContent = 'NPCを追加しました';
    });
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
      socket.emit('roll-dice', { ...dice, actorId: elements.diceActor?.value || '', secret: Boolean(elements.secretDiceInput?.checked) });
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

elements.assetCategory?.addEventListener('change', () => renderAssets(state.assets));

// Socket Events
socket.on('connect', () => { if (elements.status) elements.status.textContent = '接続中'; });
socket.on('disconnect', () => { if (elements.status) elements.status.textContent = '接続が切れています'; });
socket.on('history', (messages) => {
  if (elements.messageList) elements.messageList.innerHTML = '';
  if (Array.isArray(messages)) messages.forEach(addMessage);
});
socket.on('message', (message) => {
  addMessage(message);
  if (state.currentRole === 'gm') {
    updateSavedRoom(state.currentRoomId, { updatedAt: new Date().toISOString() });
  }
});
socket.on('members', renderMembers);
socket.on('typing', ({ name, isTyping }) => {
  if (elements.typing) elements.typing.textContent = isTyping ? `${name} が入力中...` : '';
});
socket.on('asset-added', loadAssets);
socket.on('asset-deleted', loadAssets);
socket.on('board-assets', renderBoardAssets);

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

if (elements.layerList) {
  elements.layerList.addEventListener('dblclick', (event) => {
    if (state.currentRole !== 'gm' || event.target.closest('button, input')) return;
    const groupName = event.target.closest('.layer-group-name');
    if (groupName) {
      editLayerLabel(groupName, { groupId: groupName.closest('.layer-group-row')?.dataset.groupId });
      return;
    }
    const layerName = event.target.closest('.layer-name');
    if (layerName) editLayerLabel(layerName, { assetId: layerName.closest('.layer-row')?.dataset.assetId });
  });
  elements.layerList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-layer-action]');
    if (!button || state.currentRole !== 'gm') return;
    const payload = { assetId: button.dataset.assetId, groupId: button.dataset.groupId, action: button.dataset.layerAction };
    if (button.dataset.visible !== undefined) payload.visible = button.dataset.visible === 'true';
    if (button.dataset.locked !== undefined) payload.locked = button.dataset.locked === 'true';
    socket.emit('update-board-asset', payload, (result) => {
      if (!result?.ok && elements.status) elements.status.textContent = result?.error || 'レイヤーを更新できませんでした';
    });
  });
  elements.layerList.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.layer-select');
    if (!checkbox) return;
    if (checkbox.checked) state.selectedLayerIds.add(checkbox.dataset.assetId);
    else state.selectedLayerIds.delete(checkbox.dataset.assetId);
    if (elements.layerGroupForm) elements.layerGroupForm.hidden = state.currentRole !== 'gm' || state.selectedLayerIds.size < 2;
    if (elements.layerArrangeTools) elements.layerArrangeTools.hidden = state.currentRole !== 'gm' || state.selectedLayerIds.size < 2;
  });
  elements.layerList.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.layer-row[draggable="true"]');
    if (!row || event.target.closest('button, input')) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.dataset.assetId);
    row.classList.add('is-dragging');
  });
  elements.layerList.addEventListener('dragend', (event) => {
    event.target.closest('.layer-row')?.classList.remove('is-dragging');
    elements.layerList.querySelectorAll('.drop-target').forEach((row) => row.classList.remove('drop-target'));
  });
  elements.layerList.addEventListener('dragover', (event) => {
    if (state.currentRole !== 'gm' || !event.target.closest('.layer-row')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });
  elements.layerList.addEventListener('drop', (event) => {
    if (state.currentRole !== 'gm') return;
    const targetRow = event.target.closest('.layer-row');
    const draggedId = event.dataTransfer.getData('text/plain');
    if (!targetRow || !draggedId || draggedId === targetRow.dataset.assetId) return;
    event.preventDefault();
    const visibleOrder = [...state.boardAssets].reverse();
    const sourceIndex = visibleOrder.findIndex((asset) => asset.id === draggedId);
    const targetIndex = visibleOrder.findIndex((asset) => asset.id === targetRow.dataset.assetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [draggedAsset] = visibleOrder.splice(sourceIndex, 1);
    visibleOrder.splice(targetIndex, 0, draggedAsset);
    state.boardAssets = [...visibleOrder].reverse();
    renderBoardAssets();
    socket.emit('update-board-asset', { assetId: draggedId, action: 'reorder', order: visibleOrder.map((asset) => asset.id) }, (result) => {
      if (!result?.ok && elements.status) elements.status.textContent = result?.error || 'レイヤーを並べ替えられませんでした';
    });
  });
}

if (elements.layerArrangeTools) {
  elements.layerArrangeTools.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-layer-batch]');
    if (!button || state.currentRole !== 'gm' || state.selectedLayerIds.size < 2) return;
    socket.emit('update-board-asset', { action: button.dataset.layerBatch, assetIds: [...state.selectedLayerIds] }, (result) => {
      if (!result?.ok) {
        if (elements.status) elements.status.textContent = result?.error || 'レイヤーを整列できませんでした';
        return;
      }
      renderBoardAssets(result.boardAssets);
    });
  });
}

if (elements.layerGroupForm) {
  elements.layerGroupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.currentRole !== 'gm') return;
    if (state.selectedLayerIds.size < 2) {
      if (elements.status) elements.status.textContent = 'グループ化するレイヤーを2つ以上選択してください';
      return;
    }
    const existingNames = new Set(state.boardAssets.map((asset) => asset.groupName).filter(Boolean));
    let groupNumber = 1;
    while (existingNames.has(`グループ${groupNumber}`)) groupNumber += 1;
    const groupName = elements.layerGroupName?.value.trim() || `グループ${groupNumber}`;
    socket.emit('update-board-asset', { action: 'group', assetIds: [...state.selectedLayerIds], groupName }, (result) => {
      if (!result?.ok) {
        if (elements.status) elements.status.textContent = result?.error || 'グループを作成できませんでした';
        return;
      }
      state.selectedLayerIds.clear();
      if (elements.layerGroupName) elements.layerGroupName.value = '';
      renderBoardAssets(result.boardAssets);
    });
  });
}

renderRoomList();