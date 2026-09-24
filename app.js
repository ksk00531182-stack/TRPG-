const params = new URLSearchParams(location.search);
const socket = io();
const $ = (selector) => document.querySelector(selector);
const entry = $('#entry');
const room = $('#room');
const roomIdInput = $('#roomId');
const nameInput = $('#name');
const roleInput = $('#role');
const roomLabel = $('#roomLabel');
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

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
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
    assetStatus.textContent = error.name === 'AbortError' ? 'アップロードがタイムアウトしました' : `アップロード失敗: ${error.message}`;
  }
}

$('#joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('join-room', { roomId: roomIdInput.value.trim(), name: nameInput.value.trim(), role: roleInput.value }, (result) => {
    if (!result?.ok) { status.textContent = result?.error || '参加できませんでした'; return; }
    roomLabel.textContent = result.roomId;
    currentRole = roleInput.value;
    sessionToken = result.sessionToken;
    assetUpload.hidden = currentRole !== 'gm' || !result.r2Configured;
    entry.hidden = true;
    room.hidden = false;
    history.replaceState({}, '', `?room=${encodeURIComponent(result.roomId)}`);
    messageInput.focus();
    loadAssets();
  });
});
$('#copyLink').addEventListener('click', async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${encodeURIComponent(roomLabel.textContent)}`); status.textContent = 'PC参加用URLをコピーしました'; });
messageForm.addEventListener('submit', (event) => { event.preventDefault(); if (!messageInput.value.trim()) return; socket.emit('send-message', messageInput.value); messageInput.value = ''; socket.emit('typing', false); });
messageInput.addEventListener('input', () => { socket.emit('typing', true); clearTimeout(typingTimer); typingTimer = setTimeout(() => socket.emit('typing', false), 900); });
socket.on('connect', () => { status.textContent = '接続中'; });
socket.on('disconnect', () => { status.textContent = '接続が切れています'; });
socket.on('history', (messages) => messages.forEach(addMessage));
socket.on('message', addMessage);
socket.on('members', renderMembers);
socket.on('typing', ({ name, isTyping }) => { typing.textContent = isTyping ? `${name} が入力中...` : ''; });
if (params.get('room')) roomIdInput.value = params.get('room');
roleInput.addEventListener('change', () => { $('#roleHint').textContent = roleInput.value === 'gm' ? 'ルームを作成してPCへURLを共有します' : 'GMから受け取ったルームIDを入力します'; });
$('#uploadAssets').addEventListener('click', uploadAssets);
assetList.addEventListener('click', async (event) => {
  const button = event.target.closest('.asset-delete');
  if (!button) return;
  const response = await fetch('/api/assets', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ key: decodeURIComponent(button.dataset.key) }) });
  if (response.ok) loadAssets();
});
socket.on('asset-added', loadAssets);
socket.on('asset-deleted', loadAssets);