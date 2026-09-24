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
let typingTimer;

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function addMessage(message) {
  const item = document.createElement('article');
  item.className = `message ${message.role === 'gm' ? 'is-gm' : ''}`;
  item.innerHTML = `<div class="message-meta"><strong>${escapeHtml(message.name)}</strong><time>${new Date(message.time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</time></div><p>${escapeHtml(message.text).replace(/\n/g, '<br>')}</p>`;
  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
}
function renderMembers(members) { memberList.innerHTML = members.map((member) => `<li><span class="presence"></span><span>${escapeHtml(member.name)}</span><small>${member.role === 'gm' ? 'GM' : 'PC'}</small></li>`).join(''); }

$('#joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  socket.emit('join-room', { roomId: roomIdInput.value.trim(), name: nameInput.value.trim(), role: roleInput.value }, (result) => {
    if (!result?.ok) { status.textContent = result?.error || '参加できませんでした'; return; }
    roomLabel.textContent = result.roomId;
    entry.hidden = true;
    room.hidden = false;
    history.replaceState({}, '', `?room=${encodeURIComponent(result.roomId)}`);
    messageInput.focus();
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