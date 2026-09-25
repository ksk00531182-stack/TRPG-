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
  systemIdInput: $('#systemId'),
  systemLabel: $('#systemLabel'),
  nameInput: $('#name'),
  nameLabel: $('#nameLabel'),
  joinButton: $('#joinButton'),
  roomListButton: $('#roomListButton'),
  entryHint: $('#entryHint'),
  roomLibrary: $('#roomLibrary'),
  roomList: $('#roomList'),
  roomLabel: $('#roomLabel'),
  roomSystem: $('#roomSystem'),
  memberList: $('#memberList'),
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
  copyLink: $('#copyLink') // null safeチェック対応
};

const state = {
  typingTimer: null,
  sessionToken: '',
  currentRole: 'pc',
  currentRoomId: '',
  inviteToken: params.get('invite') || '',
  isInviteMode: Boolean(params.get('room') && (params.get('invite') || '')),
  roomStorageKey: 'trpg-studio-gm-rooms'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char] || char));
}

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
    console.error('Failed to save rooms to LocalStorage:', e);
  }
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
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function formatRelativeDate(value) {
  if (!value) return '-';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
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
  if (!rooms.length) {
    elements.roomList.innerHTML = '<p class="empty-rooms">ルームがまだ作成されていません。</p>';
    return;
  }
  elements.roomList.innerHTML = rooms.map((savedRoom) => `
    <article class="room-card" data-room-id="${escapeHtml(savedRoom.roomId)}">
      <div class="room-card-heading">
        <h3>■ ${escapeHtml(savedRoom.roomTitle)}</h3>
        <span>${escapeHtml(savedRoom.systemName)}</span>
      </div>
      <p class="room-meta">作成日: ${formatDate(savedRoom.createdAt)} <b>|</b> 最終更新: ${formatRelativeDate(savedRoom.updatedAt)}</p>
      <div class="room-actions">
        <button type="button" data-action="enter">部屋に入る</button>
        <button type="button" data-action="copy">招待URLコピー</button>
        <button type="button" data-action="duplicate">複製</button>
        <button type="button" data-action="delete" class="danger">削除</button>
      </div>
    </article>
  `).join('');
}

function findSavedRoom(roomId) { return getSavedRooms().find((r) => r && r.roomId === roomId); }

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
  item.className = `message ${message.role === 'gm' ? 'is-gm' : ''}`;
  item.innerHTML = `
    <div class="message-meta">
      <strong>${escapeHtml(message.name)}</strong>
      <time>${new Date(message.time || Date.now()).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</time>
    </div>
    <p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>
  `;
  elements.messageList.append(item);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderMembers(members) {
  if (!elements.memberList || !Array.isArray(members)) return;
  elements.memberList.innerHTML = members.map((member) => `
    <li>
      <span class="presence"></span>
      <span>${escapeHtml(member.name)}</span>
      <small>${member.role === 'gm' ? 'GM' : 'PC'}</small>
    </li>
  `).join('');
}

function renderAssets(assets) {
  if (!elements.assetList) return;
  if (!assets || !assets.length) {
    elements.assetList.innerHTML = '<p class="empty-assets">このルームには素材がありません。</p>';
    return;
  }
  elements.assetList.innerHTML = assets.map((asset) => {
    const preview = asset.type?.startsWith('image/')
      ? `<img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy">`
      : '<span class="asset-audio">♫</span>';
    const remove = state.currentRole === 'gm'
      ? `<button class="asset-delete" type="button" data-key="${encodeURIComponent(asset.key)}">削除</button>`
      : '';
    return `
      <article class="asset-card">
        <a href="${escapeHtml(asset.url)}" target="_blank" rel="noreferrer">${preview}</a>
        <div>
          <strong>${escapeHtml(asset.name)}</strong>
          <small>${escapeHtml(asset.category)}</small>
        </div>
        ${remove}
      </article>
    `;
  }).join('');
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
        body: JSON.stringify({ category: elements.assetCategory.value, name: file.name, type: file.type, size: file.size })
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
  if (elements.roomLabel) elements.roomLabel.textContent = result.roomTitle || result.roomId;
  if (elements.roomSystem) elements.roomSystem.textContent = result.systemName || '';
  state.currentRole = role;
  state.sessionToken = result.sessionToken;
  state.inviteToken = result.inviteToken || state.inviteToken;

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

// Event Listeners Initialization
if (elements.joinForm) {
  elements.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const eventName = state.isInviteMode ? 'join-room' : 'create-room';
    const payload = state.isInviteMode
      ? { roomId: elements.roomIdInput.value.trim(), inviteToken: state.inviteToken, name: elements.nameInput.value.trim() }
      : { systemId: elements.systemIdInput.value, roomTitle: elements.roomTitleInput.value.trim(), name: elements.nameInput.value.trim() };

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
        enterRoom(result, 'gm');
      });
    } else if (action === 'duplicate') {
      socket.emit('duplicate-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken }, (result) => {
        if (!result?.ok) { if (elements.status) elements.status.textContent = result?.error || 'ルームを複製できませんでした'; return; }
        saveRoom({ ...result, gmName: savedRoom.gmName });
        if (elements.status) elements.status.textContent = 'ルームを複製しました';
      });
    } else if (action === 'delete' && window.confirm(`「${savedRoom.roomTitle}」を削除しますか？`)) {
      socket.emit('delete-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken }, (result) => {
        if (!result?.ok) { if (elements.status) elements.status.textContent = result?.error || 'ルームを削除できませんでした'; return; }
        saveRooms(getSavedRooms().filter((r) => r.roomId !== savedRoom.roomId));
        renderRoomList();
        if (elements.status) elements.status.textContent = 'ルームを削除しました';
      });
    }
  });
}

if (elements.messageForm) {
  elements.messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = elements.messageInput.value.trim();
    if (!text) return;
    socket.emit('send-message', text);
    elements.messageInput.value = '';
    socket.emit('typing', false);
  });
}

if (elements.messageInput) {
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
        body: JSON.stringify({ key: decodeURIComponent(button.dataset.key) })
      });
      if (response.ok) loadAssets();
    } catch (e) {
      console.error('Failed to delete asset:', e);
    }
  });
}

renderRoomList();