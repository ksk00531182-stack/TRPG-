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
  membersTab: $('#membersTab'),
  chatPanel: $('#chatPanel'),
  membersPanel: $('#membersPanel'),
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
  copyLink: $('#copyLink')
};

const state = {
  typingTimer: null,
  sessionToken: '',
  currentRole: 'pc',
  currentRoomId: '',
  playerId: '',
  inviteToken: params.get('invite') || '',
  isInviteMode: Boolean(params.get('room') && (params.get('invite') || '')),
  roomStorageKey: 'trpg-studio-gm-rooms',
  playerStorageKey: 'trpg-studio-player-ids',
  playerNameStorageKey: 'trpg-studio-player-names'
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
  elements.memberList.innerHTML = '';
  members.forEach((member) => {
    const li = document.createElement('li');
    
    const presence = document.createElement('span');
    presence.className = 'presence';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = member.name || '';
    
    const roleSmall = document.createElement('small');
    roleSmall.textContent = member.role === 'gm' ? 'GM' : 'PC';
    
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
      if (member.role === 'pc' && member.playerId === state.playerId) return;
      const option = document.createElement('option');
      option.value = member.playerId || member.id;
      option.textContent = `${member.name || '名前未設定'}${member.role === 'gm' ? '（GM）' : ''}`;
      elements.messageTarget.appendChild(option);
    });
  }
}

function renderAssets(assets) {
  if (!elements.assetList) return;
  elements.assetList.innerHTML = '';
  
  if (!assets || !assets.length) {
    const p = document.createElement('p');
    p.className = 'empty-assets';
    p.textContent = 'このルームには素材がありません。';
    elements.assetList.appendChild(p);
    return;
  }

  assets.forEach((asset) => {
    const article = document.createElement('article');
    article.className = 'asset-card';

    const link = document.createElement('a');
    link.href = asset.url || '#';
    link.target = '_blank';
    link.rel = 'noreferrer';

    if (asset.type?.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = asset.url;
      img.alt = asset.name || '';
      img.loading = 'lazy';
      link.appendChild(img);
    } else {
      const audioSpan = document.createElement('span');
      audioSpan.className = 'asset-audio';
      audioSpan.textContent = '♫';
      link.appendChild(audioSpan);
    }

    const infoDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = asset.name || '';
    const small = document.createElement('small');
    small.textContent = asset.category || '';
    infoDiv.append(strong, small);

    article.append(link, infoDiv);

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
  state.playerId = result.playerId || state.playerId;
  if (elements.roomLabel) elements.roomLabel.textContent = result.roomTitle || result.roomId;
  if (elements.roomSystem) elements.roomSystem.textContent = result.systemName || '';
  state.currentRole = role;
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
  elements.chatPanel.hidden = !showChat;
  elements.membersPanel.hidden = showChat;
  elements.chatTab.classList.toggle('is-active', showChat);
  elements.membersTab.classList.toggle('is-active', !showChat);
  elements.chatTab.setAttribute('aria-selected', String(showChat));
  elements.membersTab.setAttribute('aria-selected', String(!showChat));
}
elements.chatTab?.addEventListener('click', () => switchSessionTab('chat'));
elements.membersTab?.addEventListener('click', () => switchSessionTab('members'));

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

if (elements.messageForm) {
  elements.messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!elements.messageInput) return;
    const text = elements.messageInput.value.trim();
    if (!text) return;
    socket.emit('send-message', { text, targetId: elements.messageTarget?.value || '' });
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

renderRoomList();