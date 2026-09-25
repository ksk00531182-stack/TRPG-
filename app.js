const params = new URLSearchParams(location.search);
const socket = io();
const $ = (selector) => document.querySelector(selector);
const entry = $('#entry');
const room = $('#room');
const joinForm = $('#joinForm');
const roomIdInput = $('#roomId');
const roomTitleInput = $('#roomTitle');
const systemIdInput = $('#systemId');
const systemLabel = $('#systemLabel');
const nameInput = $('#name');
const nameLabel = $('#nameLabel');
const joinButton = $('#joinButton');
const roomListButton = $('#roomListButton');
const entryHint = $('#entryHint');
const roomLibrary = $('#roomLibrary');
const roomList = $('#roomList');
const roomLabel = $('#roomLabel');
const roomSystem = $('#roomSystem');
const memberList = $('#memberList');
const messageList = $('#messageList');
const messageForm = $('#messageForm');
const messageInput = $('#messageInput');
const status = $('#status');
const typing = $('#typing');
const assetList = $('#assetList');
const assetStatus = $('#assetStatus');
const assetUpload = $('#assetUpload');
const assetCategory = $('#assetCategory');
const assetFiles = $('#assetFiles');
let typingTimer;
let sessionToken = '';
let currentRole = 'pc';
let currentRoomId = '';
let inviteToken = params.get('invite') || '';
const roomStorageKey = 'trpg-studio-gm-rooms';

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function getSavedRooms() {
  try { return JSON.parse(localStorage.getItem(roomStorageKey) || '[]'); } catch { return []; }
}
function saveRooms(rooms) { localStorage.setItem(roomStorageKey, JSON.stringify(rooms)); }
function saveRoom(roomRecord) {
  const rooms = getSavedRooms().filter((room) => room.roomId !== roomRecord.roomId);
  rooms.unshift(roomRecord);
  saveRooms(rooms);
  renderRoomList();
}
function formatDate(value) { return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function formatRelativeDate(value) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return '今日';
  if (days === 1) return '昨日';
  if (days < 7) return `${days}日前`;
  if (days < 31) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}か月前`;
  return `${Math.floor(days / 365)}年前`;
}
function renderRoomList() {
  const rooms = getSavedRooms();
  if (!rooms.length) { roomList.innerHTML = '<p class="empty-rooms">ルームがまだ作成されていません。</p>'; return; }
  roomList.innerHTML = rooms.map((savedRoom) => `<article class="room-card" data-room-id="${escapeHtml(savedRoom.roomId)}"><div class="room-card-heading"><h3>■ ${escapeHtml(savedRoom.roomTitle)}</h3><span>${escapeHtml(savedRoom.systemName)}</span></div><p class="room-meta">作成日: ${formatDate(savedRoom.createdAt)} <b>|</b> 最終更新: ${formatRelativeDate(savedRoom.updatedAt)}</p><div class="room-actions"><button type="button" data-action="enter">部屋に入る</button><button type="button" data-action="copy">招待URLコピー</button><button type="button" data-action="duplicate">複製</button><button type="button" data-action="delete" class="danger">削除</button></div></article>`).join('');
}
function findSavedRoom(roomId) { return getSavedRooms().find((savedRoom) => savedRoom.roomId === roomId); }
function updateSavedRoom(roomId, changes) {
  const rooms = getSavedRooms().map((savedRoom) => savedRoom.roomId === roomId ? { ...savedRoom, ...changes } : savedRoom);
  saveRooms(rooms);
  renderRoomList();
}
function roomInviteUrl(savedRoom) { return `${location.origin}${location.pathname}?room=${encodeURIComponent(savedRoom.roomId)}&invite=${encodeURIComponent(savedRoom.inviteToken)}`; }
function addMessage(message) {
  const item = document.createElement('article');
  item.className = `message ${message.role === 'gm' ? 'is-gm' : ''}`;
  item.innerHTML = `<div class="message-meta"><strong>${escapeHtml(message.name)}</strong><time>${new Date(message.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</time></div><p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>`;
  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
}
function renderMembers(members) { memberList.innerHTML = members.map((member) => `<li><span class="presence"></span><span>${escapeHtml(member.name)}</span><small>${member.role === 'gm' ? 'GM' : 'PC'}</small></li>`).join(''); }
function renderAssets(assets) {
  if (!assets.length) { assetList.innerHTML = '<p class="empty-assets">このルームには素材がありません。</p>'; return; }
  assetList.innerHTML = assets.map((asset) => {
    const preview = asset.type?.startsWith('image/') ? `<img src="${asset.url}" alt="${escapeHtml(asset.name)}" loading="lazy">` : '<span class="asset-audio">♫</span>';
    const remove = currentRole === 'gm' ? `<button class="asset-delete" type="button" data-key="${encodeURIComponent(asset.key)}">削除</button>` : '';
    return `<article class="asset-card"><a href="${asset.url}" target="_blank" rel="noreferrer">${preview}</a><div><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.category)}</small></div>${remove}</article>`;
  }).join('');
}
async function loadAssets() {
  const response = await fetch('/api/assets', { headers: { Authorization: `Bearer ${sessionToken}` } });
  if (!response.ok) { assetStatus.textContent = response.status === 503 ? 'R2未設定' : '素材を取得できません'; return; }
  renderAssets((await response.json()).assets || []);
}
async function uploadAssets() {
  const files = [...assetFiles.files];
  if (!files.length) return;
  assetStatus.textContent = `${files.length}件をアップロード中...`;
  try {
    for (const file of files) {
      const permission = await fetch('/api/assets/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ category: assetCategory.value, name: file.name, type: file.type, size: file.size }) });
      if (!permission.ok) { throw new Error(`アップロード許可を取得できません (${permission.status})`); }
      const { asset, uploadUrl } = await permission.json();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120000);
      let upload;
      try {
        upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!upload.ok) { throw new Error(`${file.name} のアップロードに失敗しました (${upload.status})`); }
      socket.emit('asset-added', asset);
    }
    assetFiles.value = '';
    assetStatus.textContent = 'アップロード完了';
    loadAssets();
  } catch (error) {
    assetStatus.textContent = error.name === 'AbortError'
      ? 'アップロードがタイムアウトしました'
      : error.message === 'Failed to fetch'
        ? 'R2接続失敗: バケットのCORS設定を確認してください'
        : `アップロード失敗: ${error.message}`;
  }
}

function enterRoom(result, role) {
  currentRoomId = result.roomId;
  roomLabel.textContent = result.roomTitle || result.roomId;
  roomSystem.textContent = result.systemName || '';
  currentRole = role;
  sessionToken = result.sessionToken;
  inviteToken = result.inviteToken || inviteToken;
  if (role === 'gm') {
    saveRoom({ roomId: result.roomId, roomTitle: result.roomTitle, systemId: result.systemId, systemName: result.systemName, inviteToken, gmToken: result.gmToken, gmName: nameInput.value.trim(), createdAt: result.createdAt, updatedAt: result.updatedAt });
  }
  assetUpload.hidden = currentRole !== 'gm' || !result.r2Configured;
  entry.hidden = true;
  room.hidden = false;
  const currentUrl = role === 'gm'
    ? location.pathname
    : `?room=${encodeURIComponent(result.roomId)}&invite=${encodeURIComponent(inviteToken)}`;
  history.replaceState({}, '', currentUrl);
  messageInput.focus();
  loadAssets();
}

$('#joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const eventName = inviteToken ? 'join-room' : 'create-room';
  const payload = inviteToken
    ? { roomId: roomIdInput.value.trim(), inviteToken, name: nameInput.value.trim() }
    : { systemId: systemIdInput.value, roomTitle: roomTitleInput.value.trim(), name: nameInput.value.trim() };
  socket.emit(eventName, payload, (result) => {
    if (!result?.ok) { status.textContent = result?.error || '参加できませんでした'; return; }
    enterRoom(result, inviteToken ? 'pc' : 'gm');
  });
});
$('#copyLink').addEventListener('click', async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${encodeURIComponent(currentRoomId)}&invite=${encodeURIComponent(inviteToken)}`); status.textContent = 'PC参加用URLをコピーしました'; });
roomListButton.addEventListener('click', () => {
  roomLibrary.hidden = !roomLibrary.hidden;
  roomListButton.textContent = roomLibrary.hidden ? 'ルーム一覧' : 'ルーム一覧を閉じる';
  if (!roomLibrary.hidden) renderRoomList();
});
roomLibrary.addEventListener('click', (event) => {
  if (event.target === roomLibrary) {
    roomLibrary.hidden = true;
    roomListButton.textContent = 'ルーム一覧';
  }
});
roomList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  const savedRoom = button && findSavedRoom(button.closest('.room-card').dataset.roomId);
  if (!savedRoom) return;
  const action = button.dataset.action;
  if (action === 'copy') {
    navigator.clipboard.writeText(roomInviteUrl(savedRoom));
    status.textContent = 'PC参加用URLをコピーしました';
    return;
  }
  if (action === 'enter') {
    socket.emit('resume-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken, inviteToken: savedRoom.inviteToken, name: savedRoom.gmName }, (result) => {
      if (!result?.ok) { status.textContent = result?.error || 'ルームに入れませんでした'; return; }
      enterRoom(result, 'gm');
    });
    return;
  }
  if (action === 'duplicate') {
    socket.emit('duplicate-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken }, (result) => {
      if (!result?.ok) { status.textContent = result?.error || 'ルームを複製できませんでした'; return; }
      saveRoom({ ...result, gmName: savedRoom.gmName });
      status.textContent = 'ルームを複製しました';
    });
    return;
  }
  if (action === 'delete' && window.confirm(`「${savedRoom.roomTitle}」を削除しますか？`)) {
    socket.emit('delete-room', { roomId: savedRoom.roomId, gmToken: savedRoom.gmToken }, (result) => {
      if (!result?.ok) { status.textContent = result?.error || 'ルームを削除できませんでした'; return; }
      saveRooms(getSavedRooms().filter((room) => room.roomId !== savedRoom.roomId));
      renderRoomList();
      status.textContent = 'ルームを削除しました';
    });
  }
});
messageForm.addEventListener('submit', (event) => { event.preventDefault(); if (!messageInput.value.trim()) return; socket.emit('send-message', messageInput.value); messageInput.value = ''; socket.emit('typing', false); });
messageInput.addEventListener('input', () => { socket.emit('typing', true); clearTimeout(typingTimer); typingTimer = setTimeout(() => socket.emit('typing', false), 900); });
socket.on('connect', () => { status.textContent = '接続中'; });
socket.on('disconnect', () => { status.textContent = '接続が切れています'; });
socket.on('history', (messages) => messages.forEach(addMessage));
socket.on('message', addMessage);
socket.on('members', renderMembers);
socket.on('typing', ({ name, isTyping }) => { typing.textContent = isTyping ? `${name} が入力中...` : ''; });
socket.on('message', () => { if (currentRole === 'gm') updateSavedRoom(currentRoomId, { updatedAt: new Date().toISOString() }); });
if (params.get('room')) {
  roomIdInput.value = params.get('room');
  if (inviteToken) {
    roomListButton.hidden = true;
    roomLibrary.hidden = true;
    systemLabel.hidden = true;
    roomTitleInput.closest('label').hidden = true;
    nameLabel.querySelector('span').textContent = '表示名';
    roomIdInput.readOnly = true;
    systemIdInput.disabled = true;
    joinButton.textContent = 'ルームに入る →';
    entryHint.textContent = 'GMから共有された招待URLです。表示名を入力して入室してください。';
  }
}
assetFiles.addEventListener('change', uploadAssets);
assetList.addEventListener('click', async (event) => {
  const button = event.target.closest('.asset-delete');
  if (!button) return;
  const response = await fetch('/api/assets', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ key: decodeURIComponent(button.dataset.key) }) });
  if (response.ok) loadAssets();
});
socket.on('asset-added', loadAssets);
socket.on('asset-deleted', loadAssets);
renderRoomList();