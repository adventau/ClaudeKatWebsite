/* ═══════════════════════════════════════════════════════════════════
   THE ROYAL KAT & KAI VAULT — Main Application Logic
═══════════════════════════════════════════════════════════════════ */

'use strict';

// ── Utility ──────────────────────────────────────────────────────────
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Global state ─────────────────────────────────────────────────────
let currentUser = null;
let otherUser   = null;
let allMessages = [];
let brainstormMessages = [];
let replyToId   = null;
let ctxMsgId    = null;
let vaultPasscode = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calTab = 'personal';
let notesTab = 'mine';
let allNotes = { mine: [], shared: [] };
let activeNoteId = null;
let formatting = { bold: false, italic: false, underline: false, font: 'default' };
let nameColors = {};
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recInterval = null;
let recSeconds = 0;
let peerConnection = null;
let localStream  = null;
let callType = null;
let emojiTarget = 'msg';
let currentEmojiReactMsgId = null;
let isSending = false;
let inactivityTimer = null;
let warningTimer = null;
let lastActivity = Date.now();
const TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 29 * 60 * 1000;

const EMOJIS = ['😀','😂','😍','🥰','😎','🤩','😜','🤔','😮','😢','😡','🥳',
  '🎉','🔥','💜','❤️','💙','💚','🖤','🤍','✨','⭐','🌙','☀️','🌈',
  '💫','🦋','🌸','🍀','🎵','🎶','👑','💎','🔮','🎯','💡','🧠','🚀',
  '🌊','🏆','💪','🙌','👏','🤝','✌️','👋','🙏','💅','🫶','❄️','🌺'];

const THEMES = [
  { id: 'kaliph',   name: 'AVNT Purple',       preview: 'linear-gradient(135deg,#08051a,#7c3aed,#3b82f6)' },
  { id: 'kathrine', name: 'Royal Violet',       preview: 'linear-gradient(135deg,#0d0716,#8b5cf6,#e9d5ff)' },
  { id: 'royal',    name: 'Crimson Throne',     preview: 'linear-gradient(135deg,#0a0703,#b91c1c,#d97706)' },
  { id: 'light',    name: 'Pristine Light',     preview: 'linear-gradient(135deg,#f8fafc,#6366f1,#e0e7ff)' },
  { id: 'dark',     name: 'Midnight Dark',      preview: 'linear-gradient(135deg,#0f172a,#818cf8,#1e293b)' },
  { id: 'heaven',   name: 'Celestial Heaven',   preview: 'linear-gradient(135deg,#fafaf8,#c8a96e,#fef9f0)' },
];

// ── Socket ────────────────────────────────────────────────────────────
const socket = io();

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  const r = await fetch('/api/auth/session');
  const data = await r.json();
  if (!data.authenticated || !data.user) {
    window.location.href = '/';
    return;
  }
  currentUser = data.user;
  otherUser   = currentUser === 'kaliph' ? 'kathrine' : 'kaliph';

  const users = await fetch('/api/users').then(r => r.json());
  applyUserData(users[currentUser], users[otherUser]);
  applyTheme(users[currentUser].theme || 'dark');
  buildThemeGrid();
  populateEmojiGrid();
  setupKeyboardShortcuts();
  setupActivityTracking();
  setupSocketEvents();

  socket.emit('user-online', { user: currentUser });

  // When connecting, always show as online (override any stale stored status)
  setStatusDot('my-status-dot', 'online');
  updateStatusText('online');

  // Init Lucide icons early so UI is always visible
  if (window.lucide) lucide.createIcons();

  await Promise.all([loadMessages(), loadAnnouncements()]).catch(console.error);
  checkAndShowAnnouncements();
  requestNotificationPermission();
}

// Format toolbar + priority row toggles
function toggleFormatBar() {
  const tb = document.getElementById('format-toolbar');
  const btn = document.getElementById('format-toggle-btn');
  if (!tb) return;
  const visible = tb.classList.toggle('visible');
  btn?.classList.toggle('active', visible);
}

function togglePriorityRow() {
  const row = document.getElementById('priority-row');
  const btn = document.getElementById('priority-btn');
  if (!row) return;
  const showing = row.style.display === 'none' || !row.style.display;
  row.style.display = showing ? 'flex' : 'none';
  btn?.classList.toggle('active', showing);
}

function applyUserData(me, other) {
  // Cache user data for call overlay & notifications
  window._users = window._users || {};
  window._users[currentUser] = me;
  window._users[otherUser] = other;
  // My sidebar
  document.getElementById('my-name').textContent = me.displayName || me.name;
  document.getElementById('my-initial').textContent = (me.displayName || me.name)[0].toUpperCase();
  if (me.avatar) {
    const wrapper = document.getElementById('my-avatar');
    const avatarDiv = wrapper.querySelector('.avatar') || wrapper;
    avatarDiv.innerHTML = `<img src="${me.avatar}" alt="">`;
    // Ensure status dot exists on wrapper
    if (!wrapper.querySelector('.status-indicator')) {
      wrapper.insertAdjacentHTML('beforeend', `<div class="status-indicator ${me.status||'online'}" id="my-status-dot"></div>`);
    }
  }
  setStatusDot('my-status-dot', me.status || 'online');
  updateStatusText(me.status || 'online');

  // Other user in chat header
  const oName = other.displayName || other.name;
  document.getElementById('other-name').textContent = oName;
  document.getElementById('other-initial').textContent = oName[0].toUpperCase();
  document.getElementById('typing-name').textContent = oName;
  if (other.avatar) {
    const oWrapper = document.getElementById('other-avatar');
    const oAvatarDiv = oWrapper.querySelector('.avatar') || oWrapper;
    oAvatarDiv.innerHTML = `<img src="${other.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    if (!oWrapper.querySelector('.status-indicator')) {
      oWrapper.insertAdjacentHTML('beforeend', `<div class="status-indicator ${other.status||'online'}" id="other-status-dot"></div>`);
    }
  }
  // Use _presence from server: 'online' | 'idle' | 'offline'
  const presence = other._presence || 'offline';
  if (presence === 'online') {
    setStatusDot('other-status-dot', 'online');
    document.getElementById('other-status-label').textContent = 'Online';
  } else if (presence === 'idle') {
    setStatusDot('other-status-dot', 'idle');
    document.getElementById('other-status-label').textContent = 'Idle';
  } else if (other.lastSeen) {
    setStatusDot('other-status-dot', 'invisible');
    document.getElementById('other-status-label').textContent = formatLastSeen(other.lastSeen);
    window._lastSeenTime = other.lastSeen;
    startLastSeenUpdater();
  } else {
    setStatusDot('other-status-dot', 'invisible');
    document.getElementById('other-status-label').textContent = 'Offline';
  }

  // Settings profile
  document.getElementById('settings-avatar-initial').textContent = (me.displayName || me.name)[0].toUpperCase();
  if (me.avatar) {
    document.getElementById('settings-avatar').innerHTML = `<img src="${me.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
  document.getElementById('profile-display-name').value = me.displayName || me.name;
  document.getElementById('profile-pronouns').value = me.pronouns || '';
  document.getElementById('profile-custom-status').value = me.customStatus || '';
  document.getElementById('profile-bio').value = me.bio || '';
  if (me.nameStyle?.color) document.getElementById('profile-name-color').value = me.nameStyle.color;
  if (me.banner) {
    document.getElementById('banner-preview').style.display = '';
    document.getElementById('banner-preview-img').src = me.banner;
  }
  // Store name colors for chat rendering
  if (me.nameStyle?.color) nameColors[currentUser] = me.nameStyle.color;
  if (other.nameStyle?.color) nameColors[otherUser] = other.nameStyle.color;

  // Vault other tab label
  const vaultOtherTab = document.getElementById('vault-other-tab');
  if (vaultOtherTab) vaultOtherTab.textContent = oName + "'s Files";

  // Wallpaper — shared between users, toggle is per-user
  fetch('/api/wallpaper').then(r => r.json()).then(wpRes => {
    if (me.wallpaperEnabled && wpRes.wallpaper) {
      applyWallpaper(wpRes.wallpaper);
      document.getElementById('toggle-wallpaper').checked = true;
      const mwt = document.getElementById('modal-wallpaper-toggle');
      if (mwt) mwt.checked = true;
      document.getElementById('wallpaper-upload-row').style.display = '';
    }
  }).catch(() => {});
  if (!me.gifEnabled) {
    document.getElementById('gif-btn').style.display = 'none';
    document.getElementById('toggle-gif').checked = false;
  }
}

function applyTheme(themeId) {
  const body = document.body;
  THEMES.forEach(t => body.classList.remove('theme-' + t.id));
  body.classList.add('theme-' + (themeId || 'dark'));
  try { localStorage.setItem('rkk-theme', themeId || 'dark'); } catch {}
  SoundSystem.setTheme(themeId || 'dark');
  // Mark active in grid
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === themeId);
  });
  // AVNT footer
  const footer = document.getElementById('avnt-footer');
  if (footer) footer.style.display = themeId === 'kaliph' ? 'flex' : 'none';
}

function buildThemeGrid() {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  grid.innerHTML = THEMES.map(t => `
    <div class="theme-card" data-theme="${t.id}" onclick="selectTheme('${t.id}')">
      <div class="theme-preview" style="background:${t.preview}"></div>
      <div class="theme-preview-name">${t.name}</div>
    </div>
  `).join('');
}

async function selectTheme(themeId) {
  applyTheme(themeId);
  await fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: themeId })
  });
  showToast('🎨 Theme updated!');
}

// ── Navigation ────────────────────────────────────────────────────────
let currentSection = 'chat';
function showSection(name, el) {
  currentSection = name;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('section-' + name);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');

  // Search bar only visible on Chat tab
  const searchWrap = document.getElementById('search-wrap');
  if (searchWrap) searchWrap.style.display = name === 'chat' ? '' : 'none';

  if (name === 'notes')     loadNotes();
  if (name === 'calendar')  renderCalendar();
  if (name === 'contacts')  loadContacts();
  if (name === 'vault')     { resetVault(); }
  if (name === 'announcements') loadAnnouncements();
  if (name === 'guest-messages') loadGuestMessages();
}

function toggleSidebar() {
  document.getElementById('app').classList.toggle('sidebar-collapsed');
}

// ── Messages ──────────────────────────────────────────────────────────
async function loadMessages() {
  const data = await fetch('/api/messages').then(r => r.json());
  allMessages = Array.isArray(data) ? data : [];
  renderMessages();
}

function renderMessages(filter = null) {
  const area = document.getElementById('messages-area');
  const msgs = filter ? allMessages.filter(m => m.text.toLowerCase().includes(filter.toLowerCase())) : allMessages;

  // Remove old message elements (keep wallpaper overlay + empty state)
  const wallpaper = area.querySelector('.wallpaper-overlay');
  area.innerHTML = '';
  if (wallpaper) area.appendChild(wallpaper);

  const empty = document.getElementById('chat-empty') || (() => {
    const d = document.createElement('div');
    d.className = 'empty-state'; d.id = 'chat-empty';
    d.innerHTML = '<div class="empty-state-icon">💜</div><div class="empty-state-text">Start your conversation</div>';
    return d;
  })();

  if (msgs.length === 0) { area.appendChild(empty); return; }

  let lastDate = null;
  msgs.forEach(msg => {
    const msgDate = new Date(msg.timestamp).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = formatDate(msg.timestamp);
      area.appendChild(sep);
    }
    area.appendChild(buildMsgElement(msg));
  });
  area.scrollTop = area.scrollHeight;
}

function buildMsgElement(msg) {
  const isSelf = msg.sender === currentUser;
  const isAI   = msg.sender === 'ai' || msg.aiGenerated;

  const row = document.createElement('div');
  row.className = `msg-row ${isSelf ? 'self' : 'other'}`;
  row.id = 'msg-' + msg.id;
  row.dataset.msgId = msg.id;

  // Avatar
  const avatarEl = document.createElement('div');
  avatarEl.className = 'msg-avatar-sm';
  if (isAI) {
    avatarEl.textContent = '🤖';
  } else {
    const senderData = (window._users || {})[msg.sender];
    if (senderData?.avatar) {
      avatarEl.innerHTML = `<img src="${senderData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      avatarEl.textContent = msg.sender[0].toUpperCase();
    }
    avatarEl.style.cursor = 'pointer';
    avatarEl.onclick = () => viewProfile(msg.sender);
  }

  const content = document.createElement('div');
  content.className = 'msg-content';

  // Sender label
  const label = document.createElement('div');
  label.className = 'msg-sender-label';
  if (isAI) label.innerHTML = '<span class="ai-label">🤖 Claude</span>';
  else {
    label.textContent = capitalize(msg.sender);
    if (nameColors[msg.sender]) label.style.color = nameColors[msg.sender];
    label.style.cursor = 'pointer';
    label.onclick = () => viewProfile(msg.sender);
  }
  content.appendChild(label);

  // Priority badge
  if (msg.priority) {
    const pb = document.createElement('div');
    pb.className = 'msg-priority-badge';
    pb.innerHTML = '🔴 Priority';
    content.appendChild(pb);
  }

  // Bubble
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${isSelf ? 'msg-bubble-self' : (isAI ? 'msg-bubble ai-bubble' : 'msg-bubble-other')}`;

  // Reply preview
  if (msg.replyTo) {
    const orig = allMessages.find(m => m.id === msg.replyTo);
    if (orig) {
      const rp = document.createElement('div');
      rp.className = 'reply-preview';
      rp.textContent = (orig.text || '').substring(0, 80) + (orig.text?.length > 80 ? '…' : '');
      bubble.appendChild(rp);
    }
  }

  // Apply text formatting
  if (msg.text) {
    let t = msg.text;
    if (msg.formatting) {
      if (msg.formatting.bold) t = `<strong>${t}</strong>`;
      if (msg.formatting.italic) t = `<em>${t}</em>`;
      if (msg.formatting.underline) t = `<u>${t}</u>`;
    }
    const textNode = document.createElement('div');
    textNode.innerHTML = t;
    if (msg.formatting?.font && msg.formatting.font !== 'default') {
      textNode.style.fontFamily = msg.formatting.font;
    }
    bubble.appendChild(textNode);
  }

  // Files
  (msg.files || []).forEach(file => {
    if (file.type?.startsWith('image')) {
      const img = document.createElement('img');
      img.src = file.url; img.className = 'msg-image';
      img.onclick = () => openLightbox(file.url);
      bubble.appendChild(img);
    } else if (file.type?.startsWith('audio') || file.url?.endsWith('.webm') || file.url?.endsWith('.ogg')) {
      const wrap = document.createElement('div');
      wrap.className = 'msg-audio';
      wrap.innerHTML = `<audio controls preload="metadata"><source src="${file.url}"></audio>`;
      bubble.appendChild(wrap);
    } else {
      const fileEl = document.createElement('div');
      fileEl.className = 'msg-file-attachment';
      fileEl.innerHTML = `📄 <span>${file.name}</span>`;
      fileEl.onclick = () => window.open(file.url, '_blank');
      bubble.appendChild(fileEl);
    }
  });

  if (msg.edited) {
    const ed = document.createElement('span');
    ed.className = 'msg-edited'; ed.textContent = '(edited)';
    bubble.appendChild(ed);
  }

  // Context menu (right-click still works as fallback)
  bubble.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e, msg); };

  content.appendChild(bubble);

  // Hover action bar (iMessage / Discord style)
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const unsendBtn = (isSelf && msg.unsendable) ? `<button class="msg-action-btn msg-unsend-btn" data-msg-id="${msg.id}" onclick="quickUnsend('${msg.id}')" title="Unsend">🗑️</button>` : '';
  actions.innerHTML = `
    <button class="msg-action-btn react-trigger" onclick="showQuickReact('${msg.id}', this)" title="React">😊</button>
    <button class="msg-action-btn" onclick="setReply('${msg.id}')" title="Reply">↩</button>
    <button class="msg-action-btn" onclick="copyMsgText('${msg.id}')" title="Copy">📋</button>
    ${isSelf ? `<button class="msg-action-btn" onclick="ctxMsgId='${msg.id}';ctxEdit()" title="Edit">✏️</button>` : ''}
    ${unsendBtn}
  `;
  content.appendChild(actions);

  // Reactions
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    const reactRow = document.createElement('div');
    reactRow.className = 'msg-reactions';
    Object.entries(msg.reactions).forEach(([emoji, users]) => {
      if (users.length === 0) return;
      const chip = document.createElement('div');
      chip.className = `reaction-chip ${users.includes(currentUser) ? 'mine' : ''}`;
      chip.textContent = `${emoji} ${users.length}`;
      chip.title = users.join(', ');
      chip.onclick = () => reactToMessage(msg.id, emoji);
      reactRow.appendChild(chip);
    });
    content.appendChild(reactRow);
  }

  // Meta row
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = `<span>${formatTime(msg.timestamp)}</span>`;
  if (isSelf && msg.read) {
    const readTime = msg.readAt ? new Date(msg.readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    meta.innerHTML += `<span class="read-tick">Read${readTime ? ' at ' + readTime : ''}</span>`;
  } else if (isSelf) meta.innerHTML += `<span class="delivered-tick">Delivered</span>`;
  content.appendChild(meta);

  if (isSelf) { row.appendChild(content); row.appendChild(avatarEl); }
  else { row.appendChild(avatarEl); row.appendChild(content); }

  return row;
}

async function sendMessage() {
  if (isSending) return;
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  const priority = document.getElementById('priority-checkbox').checked;

  if (!text && !window._pendingFiles?.length) return;

  isSending = true;
  const formData = new FormData();
  formData.append('text', text);
  formData.append('type', 'text');
  formData.append('priority', priority);
  formData.append('formatting', JSON.stringify(formatting));
  if (replyToId) formData.append('replyTo', replyToId);
  if (window._pendingFiles) {
    window._pendingFiles.forEach(f => formData.append('files', f));
    window._pendingFiles = null;
    clearFilePreview();
  }

  input.value = '';
  resetInputHeight();
  cancelReply();
  document.getElementById('priority-checkbox').checked = false;
  SoundSystem.send();
  socket.emit('stop-typing', { user: currentUser });

  try {
    await fetch('/api/messages', { method: 'POST', body: formData });
  } finally {
    isSending = false;
  }
}

function handleFileSelect(input) {
  window._pendingFiles = Array.from(input.files);
  if (window._pendingFiles.length > 0) {
    showToast(`📎 ${window._pendingFiles.length} file(s) ready to send`);
  }
  input.value = '';
}

function clearFilePreview() {
  const fp = document.getElementById('file-preview');
  if (fp) fp.remove();
}

// ── Voice Recording ───────────────────────────────────────────────────
async function toggleVoiceRecording() {
  if (isRecording) { stopVoiceRec(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    isRecording = true;
    recSeconds = 0;
    document.getElementById('voice-recording-bar').classList.add('show');
    document.getElementById('voice-btn').textContent = '⏹';
    recInterval = setInterval(() => {
      recSeconds++;
      document.getElementById('rec-timer').textContent = `Recording… ${Math.floor(recSeconds/60)}:${String(recSeconds%60).padStart(2,'0')}`;
    }, 1000);
  } catch (e) {
    showToast('❌ Microphone access denied');
  }
}

function stopVoiceRec() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  clearInterval(recInterval);
}

function cancelVoiceRec() {
  stopVoiceRec();
  audioChunks = [];
  document.getElementById('voice-recording-bar').classList.remove('show');
  document.getElementById('voice-btn').textContent = '🎙️';
}

async function sendVoiceMsg() {
  stopVoiceRec();
  await new Promise(r => setTimeout(r, 200));
  if (!audioChunks.length) return;
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('type', 'voice');
  formData.append('text', '🎙️ Voice message');
  formData.append('files', blob, `voice-${Date.now()}.webm`);
  document.getElementById('voice-recording-bar').classList.remove('show');
  document.getElementById('voice-btn').textContent = '🎙️';
  SoundSystem.send();
  await fetch('/api/messages', { method: 'POST', body: formData });
}

// ── Reply ─────────────────────────────────────────────────────────────
function setReply(msgId) {
  const msg = allMessages.find(m => m.id === msgId);
  if (!msg) return;
  replyToId = msgId;
  const bar = document.getElementById('reply-preview-bar');
  bar.classList.add('show');
  document.getElementById('reply-preview-text').textContent = `Replying to: ${(msg.text || 'file').substring(0, 60)}`;
  document.getElementById('msg-input').focus();
}

function cancelReply() {
  replyToId = null;
  document.getElementById('reply-preview-bar').classList.remove('show');
}

// ── Context Menu ──────────────────────────────────────────────────────
function showContextMenu(e, msg) {
  ctxMsgId = msg.id;
  const menu = document.getElementById('context-menu');
  const editBtn   = document.getElementById('ctx-edit-btn');
  const unsendBtn = document.getElementById('ctx-unsend-btn');

  editBtn.style.display   = msg.sender === currentUser ? '' : 'none';
  unsendBtn.style.display = (msg.sender === currentUser && msg.unsendable) ? '' : 'none';

  menu.style.left = Math.min(e.clientX, window.innerWidth  - 170) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  menu.classList.add('open');
}

function closeContextMenu() { document.getElementById('context-menu').classList.remove('open'); }

function ctxReply()   { setReply(ctxMsgId); closeContextMenu(); }

function ctxReact() {
  currentEmojiReactMsgId = ctxMsgId;
  const menu = document.getElementById('context-menu');
  const rect = menu.getBoundingClientRect();
  const picker = document.getElementById('reaction-picker');
  picker.style.left = rect.left + 'px';
  picker.style.top  = (rect.top  - 60) + 'px';
  picker.classList.add('open');
  closeContextMenu();
}

function ctxCopy() {
  const msg = allMessages.find(m => m.id === ctxMsgId);
  if (msg?.text) navigator.clipboard.writeText(msg.text).then(() => showToast('📋 Copied!'));
  closeContextMenu();
}

async function ctxEdit() {
  const msg = allMessages.find(m => m.id === ctxMsgId);
  if (!msg) return;
  const newText = prompt('Edit message:', msg.text);
  if (newText !== null && newText.trim() !== msg.text) {
    await fetch(`/api/messages/${ctxMsgId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText.trim() })
    });
  }
  closeContextMenu();
}

async function ctxUnsend() {
  if (!confirm('Unsend this message?')) return;
  const r = await fetch(`/api/messages/${ctxMsgId}`, { method: 'DELETE' });
  const d = await r.json();
  if (!d.success) showToast('⚠️ ' + (d.error || 'Cannot unsend'));
  closeContextMenu();
}

async function reactToMessage(msgId, emoji) {
  await fetch(`/api/messages/${msgId}/react`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji })
  });
}

function copyMsgText(msgId) {
  const msg = allMessages.find(m => m.id === msgId);
  if (msg?.text) navigator.clipboard.writeText(msg.text).then(() => showToast('📋 Copied!'));
}

async function quickUnsend(msgId) {
  const r = await fetch(`/api/messages/${msgId}`, { method: 'DELETE' });
  const d = await r.json();
  if (!d.success) showToast('⚠️ ' + (d.error || 'Cannot unsend'));
}

function showQuickReact(msgId, btnEl) {
  // Close any existing quick react bars
  document.querySelectorAll('.msg-quick-react').forEach(el => el.remove());

  const content = btnEl.closest('.msg-content');
  const bar = document.createElement('div');
  bar.className = 'msg-quick-react';
  bar.innerHTML = ['❤️','😂','👍','😮','😢','🔥','💜','✨'].map(e =>
    `<button onclick="reactToMessage('${msgId}','${e}');this.parentElement.remove()">${e}</button>`
  ).join('');
  content.appendChild(bar);

  // Auto-close when clicking elsewhere
  const close = (e) => { if (!bar.contains(e.target) && e.target !== btnEl) { bar.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 10);
}

async function addReaction(emoji) {
  if (currentEmojiReactMsgId) {
    await reactToMessage(currentEmojiReactMsgId, emoji);
    currentEmojiReactMsgId = null;
  }
  document.getElementById('reaction-picker').classList.remove('open');
}

// ── Text Formatting ───────────────────────────────────────────────────
function applyFormat(type) {
  formatting[type] = !formatting[type];
  document.querySelectorAll('.format-btn').forEach(b => {
    if (b.onclick?.toString().includes(type)) b.classList.toggle('active', formatting[type]);
  });
}
function setFont(val) { formatting.font = val; }

// ── Emoji ─────────────────────────────────────────────────────────────
function populateEmojiGrid() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = EMOJIS.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}

function filterEmoji(q) {
  const grid = document.getElementById('emoji-grid');
  const filtered = q ? EMOJIS.filter(e => e.includes(q)) : EMOJIS;
  grid.innerHTML = filtered.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}

function openEmojiPicker(e, target) {
  emojiTarget = target || 'msg';
  const picker = document.getElementById('emoji-picker');
  picker.style.left = Math.min(e.clientX, window.innerWidth - 310) + 'px';
  picker.style.top  = (e.clientY - 280) + 'px';
  picker.classList.toggle('open');
  e.stopPropagation();
}

function insertEmoji(emoji) {
  const input = document.getElementById('msg-input');
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + emoji + input.value.slice(pos);
  input.selectionStart = input.selectionEnd = pos + emoji.length;
  input.focus();
  SoundSystem.keystroke();
}

// ── GIF Search ────────────────────────────────────────────────────────
function openGifSearch() { openModal('gif-modal'); }

let gifTimeout = null;
function searchGifs(q) {
  clearTimeout(gifTimeout);
  if (!q.trim()) return;
  gifTimeout = setTimeout(async () => {
    const grid = document.getElementById('gif-grid');
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Searching…</p>';
    try {
      const r = await fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=LIVDSRZULELA&limit=9&media_filter=gif`);
      const d = await r.json();
      if (!d.results?.length) { grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No GIFs found</p>'; return; }
      grid.innerHTML = d.results.map(g => {
        const url = g.media_formats?.gif?.url || g.media_formats?.mediumgif?.url;
        return `<img src="${url}" style="width:100%;border-radius:6px;cursor:pointer" onclick="sendGif('${url}')" loading="lazy">`;
      }).join('');
    } catch {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Add a Tenor API key to enable GIF search</p>';
    }
  }, 400);
}

async function sendGif(url) {
  closeModal('gif-modal');
  const formData = new FormData();
  formData.append('text', url);
  formData.append('type', 'gif');
  await fetch('/api/messages', { method: 'POST', body: formData });
}

// ── Socket Events ─────────────────────────────────────────────────────
function setupSocketEvents() {
  socket.on('new-message', msg => {
    allMessages.push(msg);
    const area = document.getElementById('messages-area');
    const empty = document.getElementById('chat-empty');
    if (empty) empty.remove();
    area.appendChild(buildMsgElement(msg));
    area.scrollTop = area.scrollHeight;
    if (msg.sender !== currentUser && msg.sender !== 'ai') {
      SoundSystem.receive();
      markMessageRead(msg.id);
      sendDesktopNotif(`New message from ${capitalize(msg.sender)}`, msg.text?.substring(0, 80) || 'New file');
      // In-app notification popup when chat isn't active
      if (currentSection !== 'chat') {
        showMsgNotif(msg.sender, msg.text?.substring(0, 80) || 'Sent a file');
      }
    }
  });

  socket.on('msg-unsent', id => {
    const el = document.getElementById('msg-' + id);
    if (el) el.style.animation = 'toastOut 0.3s ease both';
    setTimeout(() => el?.remove(), 300);
    allMessages = allMessages.filter(m => m.id !== id);
  });

  socket.on('msg-edited', ({ id, text, editedAt }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) { msg.text = text; msg.edited = true; msg.editedAt = editedAt; }
    const el = document.getElementById('msg-' + id);
    if (el) {
      const bubble = el.querySelector('.msg-bubble');
      if (bubble) {
        const textDiv = bubble.querySelector('div');
        if (textDiv) textDiv.textContent = text;
        let ed = bubble.querySelector('.msg-edited');
        if (!ed) { ed = document.createElement('span'); ed.className = 'msg-edited'; bubble.appendChild(ed); }
        ed.textContent = '(edited)';
      }
    }
  });

  socket.on('msg-reaction', ({ id, reactions }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) msg.reactions = reactions;
    const el = document.getElementById('msg-' + id);
    if (!el) return;
    let reactRow = el.querySelector('.msg-reactions');
    if (!reactRow) {
      reactRow = document.createElement('div');
      reactRow.className = 'msg-reactions';
      el.querySelector('.msg-content')?.appendChild(reactRow);
    }
    reactRow.innerHTML = Object.entries(reactions).filter(([,u]) => u.length > 0).map(([emoji, users]) =>
      `<div class="reaction-chip ${users.includes(currentUser)?'mine':''}" onclick="reactToMessage('${id}','${emoji}')" title="${users.join(', ')}">${emoji} ${users.length}</div>`
    ).join('');
  });

  socket.on('msg-read', ({ id, readAt }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) { msg.read = true; msg.readAt = readAt; }
    const el = document.getElementById('msg-' + id);
    if (el) {
      const deliveredTick = el.querySelector('.delivered-tick');
      const readTick = el.querySelector('.read-tick');
      const readTime = readAt ? new Date(readAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      if (deliveredTick) {
        deliveredTick.className = 'read-tick';
        deliveredTick.textContent = `Read${readTime ? ' at ' + readTime : ''}`;
      } else if (!readTick) {
        const meta = el.querySelector('.msg-meta');
        if (meta) meta.innerHTML += `<span class="read-tick">Read${readTime ? ' at ' + readTime : ''}</span>`;
      }
    }
  });

  socket.on('msg-unsend-expire', id => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) msg.unsendable = false;
    // Hide unsend button in hover bar
    const btn = document.querySelector(`.msg-unsend-btn[data-msg-id="${id}"]`);
    if (btn) btn.remove();
  });

  socket.on('user-typing', ({ user }) => {
    if (user !== currentUser) {
      document.getElementById('typing-indicator').classList.add('show');
    }
  });

  socket.on('user-stop-typing', ({ user }) => {
    if (user !== currentUser) {
      document.getElementById('typing-indicator').classList.remove('show');
    }
  });

  socket.on('ai-typing', v => {
    const el = document.getElementById('ai-typing-indicator');
    if (el) el.style.display = v ? 'flex' : 'none';
  });

  socket.on('status-changed', ({ user, status }) => {
    if (user === otherUser) {
      // Only update if user is actually online (don't override last seen)
      setStatusDot('other-status-dot', status);
      const sLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
      document.getElementById('other-status-label').textContent = sLabels[status] || 'Online';
      // If they set themselves to a real status, they're active — stop last seen
      if (status !== 'invisible') stopLastSeenUpdater();
    }
  });

  // user-presence fires when user connects/disconnects/goes idle
  // state: 'online' | 'idle' | 'offline'
  socket.on('user-presence', ({ user, state }) => {
    if (user === otherUser) {
      if (state === 'online') {
        stopLastSeenUpdater();
        setStatusDot('other-status-dot', 'online');
        document.getElementById('other-status-label').textContent = 'Online';
      } else if (state === 'idle') {
        stopLastSeenUpdater();
        setStatusDot('other-status-dot', 'idle');
        document.getElementById('other-status-label').textContent = 'Idle';
      } else {
        // offline — show last seen
        setStatusDot('other-status-dot', 'invisible');
        document.getElementById('other-status-label').textContent = 'Last seen just now';
        window._lastSeenTime = Date.now();
        startLastSeenUpdater();
      }
    }
  });

  // Heartbeat — update lastSeen on server every 60s, only while active
  setInterval(() => {
    if (!_isAutoIdle) socket.emit('heartbeat', { user: currentUser });
  }, 60000);

  socket.on('user-updated', ({ user, data }) => {
    if (user === otherUser) {
      if (data.avatar) {
        const oWrapper = document.getElementById('other-avatar');
        const oAvatarDiv = oWrapper.querySelector('.avatar') || oWrapper;
        oAvatarDiv.innerHTML = `<img src="${data.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        if (!oWrapper.querySelector('.status-indicator')) {
          oWrapper.insertAdjacentHTML('beforeend', `<div class="status-indicator ${data.status||'online'}" id="other-status-dot"></div>`);
        }
      }
    }
  });

  socket.on('announcement', ann => {
    if (ann.targetUser === 'both' || ann.targetUser === currentUser) {
      showBanner(ann);
    }
  });

  socket.on('brainstorm-msg', msg => {
    brainstormMessages.push(msg);
    const area = document.getElementById('brainstorm-messages');
    const empty = document.getElementById('brainstorm-empty');
    if (empty) empty.remove();
    area.appendChild(buildBrainstormMsg(msg));
    area.scrollTop = area.scrollHeight;
  });

  socket.on('force-logout', () => {
    showToast('⚠️ Site data was reset. Logging out…');
    setTimeout(() => logout(), 2000);
  });

  // Shared wallpaper
  socket.on('wallpaper-changed', ({ wallpaper }) => {
    const me = allUsers?.[currentUser];
    if (me?.wallpaperEnabled !== false) applyWallpaper(wallpaper);
  });

  // WebRTC
  socket.on('call-offer', handleCallOffer);
  socket.on('call-answer', handleCallAnswer);
  socket.on('call-ice-candidate', handleIceCandidate);
  socket.on('call-ended', () => endCall(true));
}

async function markMessageRead(msgId) {
  await fetch(`/api/messages/${msgId}/read`, { method: 'POST' });
}

// ── Brainstorm ────────────────────────────────────────────────────────
async function loadBrainstorm() {
  brainstormMessages = await fetch('/api/brainstorm').then(r => r.json()) || [];
  renderBrainstorm();
}

function renderBrainstorm() {
  const area = document.getElementById('brainstorm-messages');
  area.innerHTML = '';
  if (!brainstormMessages.length) {
    area.innerHTML = '<div class="empty-state" id="brainstorm-empty"><div class="empty-state-icon">💡</div><div class="empty-state-text">Throw ideas out there!</div></div>';
    return;
  }
  brainstormMessages.forEach(m => area.appendChild(buildBrainstormMsg(m)));
  area.scrollTop = area.scrollHeight;
}

function buildBrainstormMsg(msg) {
  const isSelf = msg.sender === currentUser;
  const div = document.createElement('div');
  div.className = `msg-row ${isSelf ? 'self' : 'other'}`;
  div.innerHTML = `
    <div class="msg-bubble ${isSelf ? 'msg-bubble-self' : 'msg-bubble-other'}" style="position:relative">
      <div style="font-size:0.7rem;opacity:0.7;margin-bottom:3px">${capitalize(msg.sender)}</div>
      ${msg.text}
      <div class="msg-meta"><span>${formatTime(msg.timestamp)}</span></div>
    </div>`;
  return div;
}

async function sendBrainstorm() {
  const input = document.getElementById('brainstorm-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  SoundSystem.send();
  await fetch('/api/brainstorm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}

async function clearBrainstorm() {
  if (!confirm('Clear the brainstorm board? (Messages are saved on server still)')) return;
  document.getElementById('brainstorm-messages').innerHTML =
    '<div class="empty-state" id="brainstorm-empty"><div class="empty-state-icon">💡</div><div class="empty-state-text">Board cleared locally.</div></div>';
}

// ── Notes ─────────────────────────────────────────────────────────────
async function loadNotes() {
  const data = await fetch('/api/notes').then(r => r.json());
  allNotes = data;
  renderNotesList();
}

function switchNotesTab(tab, el) {
  notesTab = tab;
  document.querySelectorAll('#section-notes .section-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderNotesList();
}

function renderNotesList() {
  const list = document.getElementById('notes-list');
  let notes = [];
  if (notesTab === 'mine') notes = (allNotes.mine || []).filter(n => !n.archived);
  else if (notesTab === 'shared') notes = allNotes.shared || [];
  else notes = (allNotes.mine || []).filter(n => n.archived);

  if (!notes.length) {
    list.innerHTML = '<div class="empty-state" style="height:200px"><div class="empty-state-icon">📝</div><div class="empty-state-text">No notes here</div></div>';
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-item ${n.id === activeNoteId ? 'active' : ''}" onclick="openNote('${n.id}')">
      <div class="note-item-title">${n.title}</div>
      <div class="note-item-preview">${n.type === 'todo' ? '☑️ Todo list' : (n.content?.substring(0,60) || '…')}</div>
      <div class="note-item-meta">
        ${n.pinned ? '<span class="tag tag-pinned">📌</span>' : ''}
        ${n.sharedWith?.length ? '<span class="tag tag-shared">Shared</span>' : ''}
        ${n.archived ? '<span class="tag tag-archived">Archived</span>' : ''}
        <span>${formatDate(n.updatedAt)}</span>
      </div>
    </div>`).join('');
}

function openNote(id) {
  activeNoteId = id;
  const allN = [...(allNotes.mine || []), ...(allNotes.shared || [])];
  const note = allN.find(n => n.id === id);
  if (!note) return;
  renderNotesList(); // refresh active state

  const editor = document.getElementById('notes-editor');
  const isOwn = (allNotes.mine || []).some(n => n.id === id);

  if (note.type === 'todo') {
    editor.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <input type="text" id="edit-note-title" value="${note.title}" style="font-size:1.1rem;font-weight:700;flex:1;margin-right:1rem">
        ${isOwn ? `
          <button class="btn-ghost" onclick="shareNote('${id}')">${note.sharedWith?.includes(otherUser) ? '🔗 Unshare' : '🔗 Share'}</button>
          <button class="btn-ghost" onclick="archiveNote('${id}')">${note.archived ? '📤 Unarchive' : '📦 Archive'}</button>
          <button class="btn-danger" onclick="deleteNote('${id}')">🗑️</button>
        ` : ''}
      </div>
      <div id="todo-list-editor">
        ${(note.todos||[]).map((item, i) => `
          <div class="todo-item ${item.done ? 'done' : ''}">
            <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleTodoItem('${id}',${i},this.checked)">
            <span>${item.text}</span>
          </div>`).join('')}
        ${isOwn ? `<div style="margin-top:0.5rem;display:flex;gap:6px"><input type="text" id="new-todo-item" placeholder="New item…" style="flex:1"><button class="btn-primary" onclick="addTodoItemToNote('${id}')">Add</button></div>` : ''}
      </div>
      ${isOwn ? '<button class="btn-primary" onclick="saveCurrentNote()" style="margin-top:1rem">Save</button>' : ''}`;
  } else {
    editor.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <input type="text" id="edit-note-title" value="${note.title}" style="font-size:1.1rem;font-weight:700;flex:1;margin-right:1rem" ${isOwn?'':'readonly'}>
        ${isOwn ? `
          <button class="btn-ghost" onclick="shareNote('${id}')">${note.sharedWith?.includes(otherUser) ? '🔗 Unshare' : '🔗 Share'}</button>
          <button class="btn-ghost" onclick="archiveNote('${id}')">${note.archived ? '📤 Unarchive' : '📦 Archive'}</button>
          <button class="btn-danger" onclick="deleteNote('${id}')">🗑️</button>
        ` : ''}
      </div>
      <textarea id="edit-note-content" rows="20" style="width:100%" ${isOwn?'':'readonly'}>${note.content||''}</textarea>
      ${isOwn ? '<div style="display:flex;gap:8px;margin-top:1rem"><button class="btn-primary" onclick="saveCurrentNote()">Save</button></div>' : ''}`;
  }
}

async function saveCurrentNote() {
  const note = [...(allNotes.mine||[])].find(n => n.id === activeNoteId);
  if (!note) return;
  const titleEl = document.getElementById('edit-note-title');
  const contentEl = document.getElementById('edit-note-content');
  const body = { title: titleEl?.value || note.title };
  if (contentEl) body.content = contentEl.value;
  await fetch(`/api/notes/${activeNoteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await loadNotes();
  showToast('📝 Note saved!');
}

async function saveNote() {
  const title = document.getElementById('note-title').value.trim() || 'Untitled';
  const content = document.getElementById('note-content').value;
  await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, type: 'note' })
  });
  closeModal('new-note-modal');
  await loadNotes();
  showToast('📝 Note saved!');
}

async function saveTodo() {
  const title = document.getElementById('todo-title').value.trim() || 'My Todo List';
  const items = Array.from(document.querySelectorAll('.todo-new-item')).map(i => ({ text: i.value, done: false })).filter(i => i.text);
  await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, todos: items, type: 'todo' })
  });
  closeModal('new-todo-modal');
  await loadNotes();
  showToast('✅ Todo list saved!');
}

function addTodoItem() {
  const list = document.getElementById('todo-items-list');
  const count = list.querySelectorAll('.todo-new-item').length + 1;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  div.innerHTML = `<input type="text" class="todo-new-item" placeholder="Item ${count}" style="flex:1">`;
  list.appendChild(div);
}

async function toggleTodoItem(noteId, idx, done) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note) return;
  note.todos[idx].done = done;
  await fetch(`/api/notes/${noteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos: note.todos })
  });
}

async function addTodoItemToNote(noteId) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note) return;
  const input = document.getElementById('new-todo-item');
  if (!input?.value.trim()) return;
  note.todos = [...(note.todos||[]), { text: input.value.trim(), done: false }];
  await fetch(`/api/notes/${noteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos: note.todos })
  });
  await loadNotes();
  openNote(noteId);
}

async function shareNote(id) {
  await fetch(`/api/notes/${id}/share`, { method: 'POST' });
  await loadNotes(); openNote(id);
  showToast('🔗 Note sharing updated!');
}

async function archiveNote(id) {
  const note = (allNotes.mine||[]).find(n => n.id === id);
  if (!note) return;
  await fetch(`/api/notes/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: !note.archived })
  });
  await loadNotes(); activeNoteId = null;
  document.getElementById('notes-editor').innerHTML = '<div class="empty-state"><div class="empty-state-text">Select a note</div></div>';
  showToast(note.archived ? '📤 Note unarchived' : '📦 Note archived');
}

async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  await loadNotes();
  activeNoteId = null;
  document.getElementById('notes-editor').innerHTML = '<div class="empty-state"><div class="empty-state-text">Select a note</div></div>';
}

// ── Calendar ──────────────────────────────────────────────────────────
function switchCalTab(tab, el) {
  calTab = tab;
  document.querySelectorAll('#section-calendar .section-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderCalendar();
}
function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }

async function renderCalendar() {
  const label = document.getElementById('cal-month-label');
  label.textContent = new Date(calYear, calMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
  let events = [];
  if (calTab === 'personal') events = calData[currentUser] || [];
  else events = calData.shared || [];

  const grid = document.getElementById('cal-grid');
  // Remove day cells (keep headers)
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const d = document.createElement('div');
    d.className = 'cal-day'; d.style.opacity = '0.3';
    grid.appendChild(d);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()) cell.classList.add('today');
    cell.innerHTML = `<div class="cal-day-num">${d}</div>`;
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayEvents = events.filter(e => e.start?.startsWith(dateStr));
    dayEvents.forEach(ev => {
      const el = document.createElement('div');
      el.className = 'cal-event';
      el.style.background = ev.color || 'var(--accent)';
      el.title = ev.description || ev.title;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = ev.title;
      el.appendChild(titleSpan);

      const delBtn = document.createElement('button');
      delBtn.className = 'cal-event-del';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete event';
      delBtn.onclick = (e) => { e.stopPropagation(); deleteCalEvent(ev.id); };
      el.appendChild(delBtn);

      cell.appendChild(el);
    });
    cell.ondblclick = () => { document.getElementById('event-start').value = dateStr + 'T09:00'; openModal('new-event-modal'); };
    grid.appendChild(cell);
  }
}

async function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  if (!title) return showToast('⚠️ Event title required');
  await fetch('/api/calendar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      start: document.getElementById('event-start').value,
      end:   document.getElementById('event-end').value,
      description: document.getElementById('event-desc').value,
      color: document.getElementById('event-color').value,
      shared: document.getElementById('event-shared').checked,
    })
  });
  closeModal('new-event-modal');
  renderCalendar();
  showToast('📅 Event saved!');
}

async function deleteCalEvent(eventId) {
  await fetch(`/api/calendar/${eventId}`, { method: 'DELETE' });
  renderCalendar();
  showToast('🗑️ Event deleted');
}

// ── Vault ──────────────────────────────────────────────────────────────
let vaultTab = 'mine';

function resetVault() {
  document.getElementById('vault-lock-screen').style.display = '';
  document.getElementById('vault-content').style.display = 'none';
  Array.from(document.querySelectorAll('.passcode-digit')).forEach(i => i.value = '');
  document.getElementById('passcode-error').style.display = 'none';
  vaultPasscode = null;
}

function handlePasscodeInput(input, idx) {
  const val = input.value.toString().slice(-1);
  input.value = val;
  const digits = Array.from(document.querySelectorAll('.passcode-digit'));
  if (val && idx < 3) digits[idx+1].focus();
  if (idx === 3) checkVaultPasscode();
}

async function checkVaultPasscode() {
  const digits = Array.from(document.querySelectorAll('.passcode-digit')).map(i => i.value);
  if (digits.some(d => d === '')) return;
  vaultPasscode = digits.join('');
  const r = await fetch(`/api/vault?passcode=${vaultPasscode}`);
  if (r.status === 403) {
    document.getElementById('passcode-error').style.display = '';
    digits.forEach(i => {}); // reset
    Array.from(document.querySelectorAll('.passcode-digit')).forEach(i => { i.value = ''; });
    document.querySelectorAll('.passcode-digit')[0].focus();
    vaultPasscode = null;
    SoundSystem.error();
    return;
  }
  const data = await r.json();
  document.getElementById('vault-lock-screen').style.display = 'none';
  document.getElementById('vault-content').style.display = 'flex';
  renderVault(data);
}

function lockVault() { resetVault(); vaultPasscode = null; }

function switchVaultTab(tab, el) {
  vaultTab = tab;
  document.querySelectorAll('#vault-content .section-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json()).then(renderVault);
}

function renderVault(data) {
  const items = vaultTab === 'mine' ? (data[currentUser] || []) : (data[otherUser] || []);
  const grid = document.getElementById('vault-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📁</div><div class="empty-state-text">No files yet</div></div>';
    return;
  }
  grid.innerHTML = items.map(item => {
    const icon = item.type === 'link' ? '🔗' : getFileIcon(item.mimeType);
    return `
      <div class="vault-item" onclick="${item.type === 'link' ? `window.open('${item.url}','_blank')` : `window.open('${item.url}','_blank')`}">
        <div class="vault-item-icon">${icon}</div>
        <div class="vault-item-name">${item.name}</div>
        <div class="vault-item-meta">${formatDate(item.uploadedAt)}</div>
        ${vaultTab === 'mine' ? `<button class="vault-del-btn" onclick="event.stopPropagation();deleteVaultItem('${item.id}')">✕</button>` : ''}
      </div>`;
  }).join('');
}

async function uploadVaultLink() {
  const link = document.getElementById('vault-link').value.trim();
  if (!link) return;
  const fd = new FormData();
  fd.append('passcode', vaultPasscode);
  fd.append('link', link);
  fd.append('linkName', document.getElementById('vault-link-name').value || link);
  await fetch('/api/vault', { method: 'POST', body: fd });
  closeModal('vault-upload-modal');
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
  showToast('🔗 Link added!');
}

async function handleVaultFiles(input) {
  if (!input.files.length) return;
  const fd = new FormData();
  fd.append('passcode', vaultPasscode);
  Array.from(input.files).forEach(f => fd.append('files', f));
  await fetch('/api/vault', { method: 'POST', body: fd });
  closeModal('vault-upload-modal');
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
  showToast('📁 Files added to vault!');
}

async function deleteVaultItem(id) {
  if (!confirm('Remove from vault?')) return;
  await fetch(`/api/vault/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: vaultPasscode })
  });
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
}

function getFileIcon(mime = '') {
  if (mime.startsWith('image')) return '🖼️';
  if (mime.startsWith('video')) return '🎬';
  if (mime.startsWith('audio')) return '🎵';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📁';
}

// ── Contacts ──────────────────────────────────────────────────────────
async function loadContacts() {
  try {
    const contacts = await fetch('/api/contacts').then(r => r.json());
    const grid = document.getElementById('contacts-grid');
    if (!Array.isArray(contacts) || !contacts.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon"><i data-lucide="users" style="width:48px;height:48px;opacity:0.5"></i></div><div class="empty-state-text">No contacts yet</div></div>';
      if (window.lucide) lucide.createIcons();
      return;
    }
    grid.innerHTML = contacts.map(c => `
      <div class="contact-card">
        <div class="contact-avatar">${c.photo ? `<img src="${c.photo}">` : (c.name ? c.name[0].toUpperCase() : '?')}</div>
        <div class="contact-info">
          <div class="contact-name">${c.name || 'Unknown'}</div>
          ${c.phone ? `<div class="contact-detail">${c.phone}</div>` : ''}
          ${c.email ? `<div class="contact-detail">${c.email}</div>` : ''}
          ${c.notes ? `<div class="contact-detail" style="font-style:italic;font-size:0.75rem">${c.notes}</div>` : ''}
        </div>
        <button class="btn-icon" onclick="deleteContact('${c.id}')" style="align-self:flex-start;color:#ef4444" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Failed to load contacts:', err);
  }
}

async function saveContact() {
  const name = document.getElementById('contact-name').value.trim();
  if (!name) return showToast('Name required');
  const fd = new FormData();
  fd.append('name', name);
  fd.append('phone', document.getElementById('contact-phone').value.trim());
  fd.append('email', document.getElementById('contact-email').value.trim());
  fd.append('notes', document.getElementById('contact-notes').value.trim());
  const photoFile = document.getElementById('contact-photo-input').files[0];
  if (photoFile) fd.append('photo', photoFile);
  try {
    const resp = await fetch('/api/contacts', { method: 'POST', body: fd });
    const result = await resp.json();
    if (!result.success) { showToast('Failed to save contact'); return; }
    // Clear form
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-email').value = '';
    document.getElementById('contact-notes').value = '';
    document.getElementById('contact-photo-input').value = '';
    closeModal('new-contact-modal');
    await loadContacts();
    showToast('Contact saved!');
  } catch (err) {
    showToast('Error saving contact');
  }
}

async function deleteContact(id) {
  if (!confirm('Delete contact?')) return;
  await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  await loadContacts();
}

// ── Announcements ─────────────────────────────────────────────────────
async function loadAnnouncements() {
  const anns = await fetch('/api/announcements').then(r => r.json());
  const list = document.getElementById('announcements-list');
  if (!list) return;
  if (!anns.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📢</div><div class="empty-state-text">No announcements</div></div>';
    return;
  }
  list.innerHTML = anns.filter(a => a.active).map(a => `
    <div class="announcement-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
        <div style="flex:1">
          <div class="announcement-card-title">${a.title}</div>
          <div class="announcement-card-content">${a.content}</div>
          <div class="announcement-card-meta">Posted by ${capitalize(a.createdBy)} · ${formatDate(a.createdAt)}</div>
        </div>
        ${a.createdBy === currentUser ? `<button class="btn-icon" onclick="deleteAnnouncement('${a.id}')" title="Remove" style="color:#ef4444;flex-shrink:0"><i data-lucide="trash-2"></i></button>` : ''}
      </div>
    </div>`).join('');
  if (window.lucide) lucide.createIcons();
}

function checkAndShowAnnouncements() {
  fetch('/api/announcements').then(r => r.json()).then(anns => {
    const relevant = anns.filter(a => a.active && (a.targetUser === 'both' || a.targetUser === currentUser));
    if (relevant.length > 0) showBanner(relevant[0]);
  });
}

function showBanner(ann) {
  const banner = document.getElementById('announcement-banner');
  document.getElementById('banner-title').textContent = ann.title;
  document.getElementById('banner-content').textContent = ann.content;
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 8000);
}

function closeBanner() { document.getElementById('announcement-banner').classList.remove('show'); }

async function postAnnouncement() {
  const title = document.getElementById('ann-title').value.trim();
  const content = document.getElementById('ann-content').value.trim();
  if (!title || !content) return showToast('⚠️ Title and content required');
  await fetch('/api/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, targetUser: document.getElementById('ann-target').value })
  });
  closeModal('new-announcement-modal');
  await loadAnnouncements();
  showToast('📢 Announcement posted!');
}

async function deleteAnnouncement(id) {
  await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
  await loadAnnouncements();
}

// ── Guest Messages ────────────────────────────────────────────────────
let activeGuestId = null;
let activeGuestChannel = 'group';
let guestData = [];

async function loadGuestMessages() {
  try {
    const res = await fetch('/api/guest-messages');
    if (!res.ok) return;
    guestData = await res.json();
  } catch { guestData = []; }
  renderGuestList();
}

function renderGuestList() {
  const list = document.getElementById('guest-list');
  const badge = document.getElementById('guest-count-badge');
  if (!list) return;
  if (badge) badge.textContent = guestData.length;
  if (!guestData.length) {
    list.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;height:auto"><div class="empty-state-icon"><i data-lucide="user-x" style="width:32px;height:32px;opacity:0.4"></i></div><div class="empty-state-text" style="font-size:0.82rem">No active guests</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }
  list.innerHTML = guestData.map(g => {
    const totalMsgs = (g.channels.group?.length || 0) + (g.channels[currentUser]?.length || 0);
    const lastMsg = [...(g.channels.group || []), ...(g.channels[currentUser] || [])].sort((a,b) => b.timestamp - a.timestamp)[0];
    const preview = lastMsg ? (lastMsg.text.length > 30 ? lastMsg.text.slice(0,30) + '...' : lastMsg.text) : 'No messages yet';
    return `<div class="guest-list-item ${activeGuestId === g.id ? 'active' : ''}" onclick="selectGuest('${g.id}')">
      <div class="guest-item-avatar">${g.name[0].toUpperCase()}</div>
      <div class="guest-item-info">
        <div class="guest-item-name">${escapeHtml(g.name)}</div>
        <div class="guest-item-meta">${escapeHtml(preview)}</div>
      </div>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function selectGuest(guestId) {
  activeGuestId = guestId;
  activeGuestChannel = 'group';
  renderGuestList();
  renderGuestChat();
  // Show header and reply bar
  document.getElementById('guest-chat-header').style.display = '';
  document.getElementById('guest-reply-bar').style.display = '';
  // Reset channel tabs
  document.querySelectorAll('.guest-tab').forEach(b => b.classList.remove('active'));
  const groupTab = document.querySelector('.guest-tab[data-ch="group"]');
  if (groupTab) groupTab.classList.add('active');
  // Re-init lucide icons in the tabs
  if (window.lucide) lucide.createIcons();
  // Listen for real-time messages
  listenGuestSockets(guestId);
}

function switchGuestChannel(ch, el) {
  activeGuestChannel = ch === 'dm' ? currentUser : 'group';
  document.querySelectorAll('.guest-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderGuestChat();
}

function renderGuestChat() {
  const area = document.getElementById('guest-messages-area');
  if (!area || !activeGuestId) return;
  const guest = guestData.find(g => g.id === activeGuestId);
  if (!guest) { area.innerHTML = '<div class="empty-state"><div class="empty-state-text">Guest not found</div></div>'; return; }

  document.getElementById('guest-chat-name').textContent = guest.name;
  document.getElementById('guest-chat-initial').textContent = guest.name[0].toUpperCase();
  document.getElementById('guest-chat-channel').textContent = activeGuestChannel === 'group' ? 'Group Chat' : 'Direct Message';

  const msgs = guest.channels[activeGuestChannel] || [];
  if (!msgs.length) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-circle" style="width:36px;height:36px;opacity:0.35"></i></div><div class="empty-state-text">No messages yet</div><div class="empty-state-sub">Messages in this channel will appear here</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  area.innerHTML = msgs.map((m, i) => {
    const isSelf = m.sender === currentUser;
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const prev = msgs[i - 1];
    const sameSender = prev && prev.sender === m.sender && (m.timestamp - prev.timestamp < 120000);
    return `<div class="msg-row ${isSelf ? 'self' : ''}${sameSender ? ' same-sender' : ''}">
      ${!isSelf ? `<div class="msg-avatar-sm" style="${sameSender ? 'visibility:hidden' : ''}">${m.sender[0].toUpperCase()}</div>` : ''}
      <div class="msg-bubble ${isSelf ? 'msg-bubble-self' : 'msg-bubble-other'}">
        ${!isSelf && !sameSender ? `<div class="msg-sender">${escapeHtml(m.sender)}</div>` : ''}
        <div class="msg-text">${escapeHtml(m.text)}</div>
        <div class="msg-meta">${time}</div>
      </div>
    </div>`;
  }).join('');
  area.scrollTop = area.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

async function sendGuestReply() {
  const input = document.getElementById('guest-reply-input');
  const text = input.value.trim();
  if (!text || !activeGuestId) return;
  input.value = '';
  try {
    await fetch(`/api/guests/${activeGuestId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target: activeGuestChannel })
    });
  } catch (e) { showToast('Failed to send'); }
}

function listenGuestSockets(guestId) {
  // Remove old listeners
  socket.off(`guest-msg-${guestId}-group`);
  socket.off(`guest-msg-${guestId}-${currentUser}`);
  // Add new ones
  socket.on(`guest-msg-${guestId}-group`, msg => {
    const g = guestData.find(x => x.id === guestId);
    if (g) { if (!g.channels.group) g.channels.group = []; g.channels.group.push(msg); }
    if (activeGuestId === guestId && activeGuestChannel === 'group') renderGuestChat();
  });
  socket.on(`guest-msg-${guestId}-${currentUser}`, msg => {
    const g = guestData.find(x => x.id === guestId);
    if (g) { if (!g.channels[currentUser]) g.channels[currentUser] = []; g.channels[currentUser].push(msg); }
    if (activeGuestId === guestId && activeGuestChannel === currentUser) renderGuestChat();
  });
}

// ── Settings ──────────────────────────────────────────────────────────
function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  modal.classList.add('open');
  loadSettings();
  loadGuests();
  loadSuggestions();
  if (window.lucide) lucide.createIcons();
}

function switchSettingsTab(tab, el) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + tab)?.classList.add('active');
}

async function loadSettings() {
  const s = await fetch('/api/settings').then(r => r.json());
  if (s.emails) {
    // Support both old format (string) and new format (array)
    const kEmails = Array.isArray(s.emails.kaliph) ? s.emails.kaliph : (s.emails.kaliph ? [s.emails.kaliph] : ['']);
    const keEmails = Array.isArray(s.emails.kathrine) ? s.emails.kathrine : (s.emails.kathrine ? [s.emails.kathrine] : ['']);
    renderEmailList('kaliph', kEmails);
    renderEmailList('kathrine', keEmails);
    // Legacy single input for profile tab
    const myInput = document.getElementById('my-email-input');
    if (myInput) {
      const myEmails = currentUser === 'kaliph' ? kEmails : keEmails;
      myInput.value = myEmails[0] || '';
    }
  }
  loadProfilePasscodeState();
}

function renderEmailList(person, emails) {
  const list = document.getElementById(`${person}-emails-list`);
  if (!list) return;
  if (!emails.length) emails = [''];
  list.innerHTML = emails.map((email, i) => `
    <div class="email-row">
      <input type="email" value="${escapeHtml(email)}" placeholder="${capitalize(person)}'s email${i > 0 ? ' ' + (i+1) : ''}" data-person="${person}">
      ${emails.length > 1 ? `<button class="email-remove-btn" onclick="removeEmailField('${person}',${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
    </div>
  `).join('');
}

function addEmailField(person) {
  const list = document.getElementById(`${person}-emails-list`);
  if (!list) return;
  const current = getEmailValues(person);
  current.push('');
  renderEmailList(person, current);
  // Focus the new input
  const inputs = list.querySelectorAll('input[type="email"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeEmailField(person, index) {
  const current = getEmailValues(person);
  current.splice(index, 1);
  if (!current.length) current.push('');
  renderEmailList(person, current);
}

function getEmailValues(person) {
  const list = document.getElementById(`${person}-emails-list`);
  if (!list) return [];
  return Array.from(list.querySelectorAll(`input[data-person="${person}"]`)).map(i => i.value.trim());
}

async function saveProfile() {
  const displayName = document.getElementById('profile-display-name').value.trim();
  const pronouns = document.getElementById('profile-pronouns').value.trim();
  const customStatus = document.getElementById('profile-custom-status').value.trim();
  const bio = document.getElementById('profile-bio').value;
  const color = document.getElementById('profile-name-color').value;
  await fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, pronouns, customStatus, bio, nameStyle: { color, gradient: true } })
  });
  document.getElementById('my-name').textContent = displayName;
  nameColors[currentUser] = color;
  renderMessages();
  showToast('✅ Profile saved!');
}

async function saveEmails() {
  const email = document.getElementById('my-email-input').value;
  const body = { emails: { [currentUser]: email } };
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  showToast('📧 Email saved!');
}

async function saveAllEmails() {
  const kaliphEmails = getEmailValues('kaliph').filter(e => e);
  const kathrineEmails = getEmailValues('kathrine').filter(e => e);
  await fetch('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: {
      kaliph: kaliphEmails,
      kathrine: kathrineEmails,
    }})
  });
  showToast('📧 Emails saved!');
}

async function uploadAvatar(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('avatar', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/avatar`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.avatar) {
    document.getElementById('settings-avatar').innerHTML = `<img src="${d.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    const wrapper = document.getElementById('my-avatar');
    const avatarDiv = wrapper.querySelector('.avatar');
    if (avatarDiv) avatarDiv.innerHTML = `<img src="${d.avatar}" alt="">`;
    else wrapper.innerHTML = `<div class="avatar"><img src="${d.avatar}" alt=""></div><div class="status-indicator online" id="my-status-dot"></div>`;
    showToast('🖼️ Avatar updated!');
  }
}

async function uploadBanner(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('banner', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/banner`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.banner) {
    document.getElementById('banner-preview').style.display = '';
    document.getElementById('banner-preview-img').src = d.banner;
    showToast('🖼️ Banner updated!');
  }
}

async function viewProfile(username) {
  const users = await fetch('/api/users').then(r => r.json());
  const u = users[username];
  if (!u) return;
  // Banner
  const banner = document.getElementById('pv-banner');
  if (u.banner) {
    banner.style.backgroundImage = `url(${u.banner})`;
    banner.style.backgroundSize = 'cover';
    banner.style.backgroundPosition = 'center';
  } else {
    banner.style.backgroundImage = '';
    banner.style.background = `linear-gradient(135deg, var(--accent), var(--bg-card))`;
  }
  // Avatar
  const avatarEl = document.getElementById('pv-avatar');
  if (u.avatar) {
    avatarEl.innerHTML = `<img src="${u.avatar}" alt="">`;
  } else {
    avatarEl.innerHTML = `<span>${(u.displayName || u.name)[0].toUpperCase()}</span>`;
  }
  // Status — use live _presence from server
  const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
  const pvPresence = u._presence || 'offline';
  const pvStatus = pvPresence === 'online' ? 'online' : pvPresence === 'idle' ? 'idle' : 'invisible';
  document.getElementById('pv-status-dot').style.background = statusColors[pvStatus] || '#22c55e';
  // Names
  const nameEl = document.getElementById('pv-name');
  nameEl.textContent = u.displayName || capitalize(u.name);
  nameEl.style.color = u.nameStyle?.color || '';
  document.getElementById('pv-username').textContent = u.name + (u.pronouns ? ' \u2022 ' + u.pronouns : '');
  // Custom status
  const csEl = document.getElementById('pv-custom-status');
  const csTxt = document.getElementById('pv-custom-status-text');
  if (u.customStatus) { csEl.style.display = ''; csTxt.textContent = u.customStatus; }
  else csEl.style.display = 'none';
  // Pronouns
  const pronounsSec = document.getElementById('pv-pronouns-section');
  if (u.pronouns) { pronounsSec.style.display = ''; document.getElementById('pv-pronouns').textContent = u.pronouns; }
  else pronounsSec.style.display = 'none';
  // Bio
  document.getElementById('pv-bio').textContent = u.bio || 'No bio set.';
  // Last seen — only show if user is actually offline (not online or idle)
  const lsSec = document.getElementById('pv-lastseen-section');
  if (u._presence === 'offline' && u.lastSeen && username !== currentUser) {
    lsSec.style.display = '';
    document.getElementById('pv-lastseen').textContent = formatLastSeen(u.lastSeen);
  } else {
    lsSec.style.display = 'none';
  }
  // Member since
  document.getElementById('pv-member-since').textContent = u.createdAt ? new Date(u.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : 'The beginning';
  // Edit button (only for own profile)
  document.getElementById('pv-edit-btn').style.display = username === currentUser ? 'flex' : 'none';
  openModal('profile-viewer-modal');
  if (window.lucide) lucide.createIcons();
}

async function toggleWallpaper(el) {
  const enabled = el.checked;
  const uploadRow = document.getElementById('wallpaper-upload-row');
  if (uploadRow) uploadRow.style.display = enabled ? '' : 'none';
  fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallpaperEnabled: enabled })
  });
  if (enabled) {
    // Re-fetch the shared wallpaper when re-enabling
    const wpRes = await fetch('/api/wallpaper').then(r => r.json()).catch(() => ({}));
    if (wpRes.wallpaper) applyWallpaper(wpRes.wallpaper);
  } else {
    const area = document.getElementById('messages-area');
    area.classList.remove('wallpaper-on');
    area.style.backgroundImage = '';
  }
  // Sync both toggles
  ['toggle-wallpaper','modal-wallpaper-toggle'].forEach(id => {
    const el2 = document.getElementById(id);
    if (el2) el2.checked = enabled;
  });
}

async function uploadWallpaper(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('wallpaper', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/wallpaper`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.wallpaper) { applyWallpaper(d.wallpaper); showToast('🖼️ Wallpaper set!'); }
}

function applyWallpaper(url) {
  const area = document.getElementById('messages-area');
  area.classList.add('wallpaper-on');
  area.style.backgroundImage = `url(${url})`;
}

function clearWallpaper() {
  const area = document.getElementById('messages-area');
  area.classList.remove('wallpaper-on');
  area.style.backgroundImage = '';
  // Just disable locally — don't remove the shared wallpaper
  fetch(`/api/users/${currentUser}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallpaperEnabled: false }) });
  ['toggle-wallpaper','modal-wallpaper-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  showToast('Wallpaper hidden on your side');
}

function toggleGif(el) {
  fetch(`/api/users/${currentUser}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gifEnabled: el.checked }) });
  document.getElementById('gif-btn').style.display = el.checked ? '' : 'none';
}

function toggleSound(el) { SoundSystem.setEnabled(el.checked); }

async function changeSitePassword() {
  const np = document.getElementById('new-pw').value;
  const cp = document.getElementById('confirm-pw').value;
  if (!np) return showToast('⚠️ Enter a new password');
  if (np !== cp) return showToast('⚠️ Passwords do not match');
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: np }) });
  document.getElementById('new-pw').value = '';
  document.getElementById('confirm-pw').value = '';
  showToast('🔐 Password updated!');
}

async function changeVaultPasscode() {
  const p = document.getElementById('new-vault-passcode').value;
  if (p.length !== 4) return showToast('⚠️ Must be 4 digits');
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaultPasscode: p }) });
  showToast('🔐 Vault passcode updated!');
}

// ── Profile Passcode ──────────────────────────────────────────────────
function toggleProfilePasscode(el) {
  const fields = document.getElementById('profile-passcode-fields');
  fields.style.display = el.checked ? '' : 'none';
  if (!el.checked) {
    // Remove passcode
    fetch('/api/auth/profile-passcode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: null })
    }).then(() => showToast('Profile passcode removed'));
    document.getElementById('profile-passcode-input').value = '';
    document.getElementById('profile-passcode-confirm').value = '';
  }
}

async function saveProfilePasscode() {
  const pin = document.getElementById('profile-passcode-input').value;
  const confirm = document.getElementById('profile-passcode-confirm').value;
  if (!/^\d{4}$/.test(pin)) return showToast('Passcode must be exactly 4 digits');
  if (pin !== confirm) return showToast('Passcodes do not match');
  const r = await fetch('/api/auth/profile-passcode', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: pin })
  });
  const d = await r.json();
  if (d.success) {
    showToast('Profile passcode saved');
    document.getElementById('profile-passcode-input').value = '';
    document.getElementById('profile-passcode-confirm').value = '';
  } else {
    showToast(d.error || 'Failed to save passcode');
  }
}

async function loadProfilePasscodeState() {
  const users = await fetch('/api/users').then(r => r.json());
  const user = users[currentUser];
  const toggle = document.getElementById('toggle-profile-passcode');
  const fields = document.getElementById('profile-passcode-fields');
  if (user && user.profilePasscode) {
    toggle.checked = true;
    fields.style.display = '';
  } else {
    toggle.checked = false;
    fields.style.display = 'none';
  }
}

// ── Guests ────────────────────────────────────────────────────────────
async function loadGuests() {
  const guests = await fetch('/api/guests').then(r => r.json());
  const list = document.getElementById('guests-list');
  const entries = Object.values(guests).filter(g => g.active);
  if (!entries.length) { list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No active guest passes.</p>'; return; }
  const channelLabels = { kaliph: 'Kaliph', kathrine: 'Kathrine', group: 'Group' };
  list.innerHTML = entries.map(g => {
    const ch = g.channels || ['kaliph','kathrine','group'];
    const badges = ch.map(c => `<span class="channel-badge">${channelLabels[c] || capitalize(c)}</span>`).join('');
    let expiryInfo = 'Never expires';
    if (g.expiresAt) {
      const diff = new Date(g.expiresAt) - Date.now();
      if (diff <= 0) {
        expiryInfo = '<span style="color:#ef4444">Expired</span>';
      } else {
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        expiryInfo = `<span class="guest-countdown" data-expires="${g.expiresAt}">⏱ ${hrs}h ${mins}m ${secs}s</span>`;
      }
    }
    return `
    <div class="guest-pass-card">
      <div class="guest-pass-info">
        <div class="guest-pass-name">${escapeHtml(g.name)}</div>
        <div class="guest-pass-meta">${expiryInfo}${g.createdBy ? ' · Created by ' + capitalize(g.createdBy) : ''}</div>
        <div class="guest-pass-channels">${badges}</div>
      </div>
      <div class="guest-pass-actions">
        <button class="btn-danger" style="padding:6px 14px;font-size:0.78rem;border-radius:8px" onclick="revokeGuest('${g.id}','${escapeHtml(g.name)}')">Revoke</button>
      </div>
    </div>`;
  }).join('');
  // Start countdown timers
  startGuestCountdowns();
  // Update guest-to-guest channel options in the creation form
  updateGuestChannelOptions(entries);
}

function startGuestCountdowns() {
  clearInterval(window._guestCountdownInterval);
  window._guestCountdownInterval = setInterval(() => {
    document.querySelectorAll('.guest-countdown').forEach(el => {
      const expires = new Date(el.dataset.expires);
      const diff = expires - Date.now();
      if (diff <= 0) {
        el.innerHTML = '<span style="color:#ef4444">Expired</span>';
      } else {
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        el.textContent = `⏱ ${hrs}h ${mins}m ${secs}s`;
      }
    });
  }, 1000);
}

function updateGuestChannelOptions(activeGuests) {
  // Add/remove guest-to-guest channel checkboxes dynamically
  const container = document.getElementById('guest-to-guest-perms');
  if (!container) return;
  container.innerHTML = '';
  activeGuests.forEach(g => {
    container.innerHTML += `<label class="channel-perm-check"><input type="checkbox" data-guest-channel="${g.id}"> <span>Chat with ${escapeHtml(g.name)} (guest)</span></label>`;
  });
}

async function createGuest() {
  const name = document.getElementById('guest-name').value.trim();
  const pw   = document.getElementById('guest-pw').value;
  const exp  = document.getElementById('guest-expires').value;
  if (!name || !pw) return showToast('⚠️ Name and password required');
  const channels = [];
  if (document.getElementById('guest-perm-kaliph').checked) channels.push('kaliph');
  if (document.getElementById('guest-perm-kathrine').checked) channels.push('kathrine');
  if (document.getElementById('guest-perm-group').checked) channels.push('group');
  // Guest-to-guest channels
  document.querySelectorAll('#guest-to-guest-perms input[data-guest-channel]').forEach(cb => {
    if (cb.checked) channels.push('guest-' + cb.dataset.guestChannel);
  });
  if (!channels.length) return showToast('⚠️ Select at least one channel');
  await fetch('/api/guests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password: pw, expiresIn: exp || null, channels })
  });
  document.getElementById('guest-name').value = '';
  document.getElementById('guest-pw').value = '';
  document.getElementById('guest-expires').value = '';
  document.getElementById('guest-perm-kaliph').checked = true;
  document.getElementById('guest-perm-kathrine').checked = true;
  document.getElementById('guest-perm-group').checked = true;
  await loadGuests();
  showToast(`🌟 Guest pass created for ${name}!`);
}

// Custom confirm dialog (replaces browser confirm())
let _confirmResolve = null;
function showConfirmDialog({ icon = '⚠️', title = 'Are you sure?', msg = 'This action cannot be undone.', okText = 'Confirm', cancelText = 'Cancel' } = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-icon').textContent = icon;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-ok-btn').textContent = okText;
    document.getElementById('confirm-cancel-btn').textContent = cancelText;
    document.getElementById('confirm-dialog').classList.add('open');
  });
}
function closeConfirmDialog(result) {
  document.getElementById('confirm-dialog').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

async function revokeGuest(id, name) {
  const ok = await showConfirmDialog({
    icon: '🚫',
    title: 'Revoke Guest Pass',
    msg: `Are you sure you want to revoke ${name || 'this guest'}'s access? They will be logged out immediately.`,
    okText: 'Revoke',
    cancelText: 'Cancel'
  });
  if (!ok) return;
  await fetch(`/api/guests/${id}`, { method: 'DELETE' });
  await loadGuests();
  showToast('✅ Guest pass revoked');
}

// ── Suggestions ───────────────────────────────────────────────────────
async function loadSuggestions() {
  const sug = await fetch('/api/suggestions').then(r => r.json());
  const list = document.getElementById('suggestions-list');
  const mine = sug.filter(s => s.from === currentUser);
  if (!mine.length) { list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No submissions yet.</p>'; return; }
  list.innerHTML = mine.map(s => `
    <div class="glass-card" style="padding:0.8rem;margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
        <span class="chip">${s.type}</span>
        <span style="font-size:0.72rem;color:var(--text-muted)">${formatDate(s.createdAt)}</span>
      </div>
      <div style="font-size:0.875rem">${s.message}</div>
    </div>`).join('');
}

async function submitSuggestion() {
  const msg = document.getElementById('suggestion-msg').value.trim();
  if (!msg) return showToast('⚠️ Write something first');
  await fetch('/api/suggestions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: document.getElementById('suggestion-type').value, message: msg })
  });
  document.getElementById('suggestion-msg').value = '';
  await loadSuggestions();
  showToast('💌 Feedback submitted!');
}

// ── Status ────────────────────────────────────────────────────────────
function toggleStatusMenu() {
  const menu = document.getElementById('status-menu');
  menu.classList.toggle('open');
  if (menu.classList.contains('open')) {
    // Position fixed menu near the status text
    const trigger = document.getElementById('my-status-text');
    const rect = trigger.getBoundingClientRect();
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.left = rect.left + 'px';
    const close = (e) => {
      if (!e.target.closest('.sidebar-user-status') && !e.target.closest('.status-menu')) {
        menu.classList.remove('open');
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 10);
  }
}

async function setStatus(status) {
  document.getElementById('status-menu').classList.remove('open');
  setStatusDot('my-status-dot', status);
  updateStatusText(status);
  await fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  socket.emit('status-change', { user: currentUser, status });
}

function setStatusDot(id, status) {
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.className = `status-indicator ${status}`;
  const colors = { online:'var(--status-online)', idle:'var(--status-idle)', dnd:'var(--status-dnd)', invisible:'var(--status-invisible)' };
  dot.style.background = colors[status] || colors.online;
}

function updateStatusText(status) {
  const labels = { online: '● Online', idle: '● Idle', dnd: '⊘ Do Not Disturb', invisible: '○ Invisible' };
  document.getElementById('my-status-text').textContent = labels[status] || '● Online';
}

// ── Calls (WebRTC) ────────────────────────────────────────────────────
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let callPeer = null;          // who we're in a call with
let iceCandidateQueue = [];   // buffer ICE candidates before peerConnection exists
let callTimer = null;
let callSeconds = 0;
let inCall = false;

function setupLocalVideo(stream) {
  const vid = document.getElementById('call-video-local');
  vid.srcObject = stream;
  vid.muted = true;
  vid.playsInline = true;
  vid.style.display = 'block';
  vid.style.transform = 'scaleX(-1)';
  // Use loadedmetadata to ensure video is ready before playing
  const tryPlay = () => {
    vid.play().catch(() => {
      // Retry after a short delay if play fails
      setTimeout(() => vid.play().catch(() => {}), 200);
    });
  };
  if (vid.readyState >= 2) { tryPlay(); }
  else { vid.onloadedmetadata = tryPlay; }
}

async function startCall(type) {
  if (inCall) { showToast('Already in a call'); return; }
  callType = type;
  callPeer = otherUser;
  const videoConstraints = type === 'video' ? { width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 }, frameRate: { ideal: 30, min: 15 }, facingMode: 'user' } : false;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoConstraints }).catch(() => null);
  if (!localStream) { showToast('Media device access denied'); return; }

  peerConnection = new RTCPeerConnection(ICE_CONFIG);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('call-ice-candidate', { candidate: e.candidate }); };
  peerConnection.ontrack = e => {
    const remoteVid = document.getElementById('call-video-remote');
    remoteVid.srcObject = e.streams[0];
    if (type === 'video') { remoteVid.style.display = 'block'; document.getElementById('call-user-info').style.display = 'none'; }
    // Detect remote camera on/off
    e.streams[0].getVideoTracks().forEach(track => {
      track.onmute = () => { remoteVid.style.display = 'none'; document.getElementById('call-remote-avatar-bg').style.display = 'flex'; };
      track.onunmute = () => { remoteVid.style.display = 'block'; document.getElementById('call-remote-avatar-bg').style.display = 'none'; };
    });
  };
  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection?.iceConnectionState === 'disconnected' || peerConnection?.iceConnectionState === 'failed') {
      endCall(true);
    }
  };

  if (type === 'video') {
    setupLocalVideo(localStream);
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('call-offer', { offer, type, from: currentUser });
  inCall = true;
  SoundSystem.startRingtone('outgoing');
  showCallOverlay('Calling ' + capitalize(callPeer) + '...', type);
}

async function handleCallOffer({ offer, type, from }) {
  if (inCall) return; // already in a call
  callType = type;
  callPeer = from;
  iceCandidateQueue = [];
  document.getElementById('incoming-call').style.display = 'block';
  document.getElementById('incoming-call-name').textContent = capitalize(from);
  document.getElementById('incoming-call-type').textContent = type === 'video' ? 'Video Call' : 'Voice Call';
  document.getElementById('incoming-call-icon').innerHTML = type === 'video'
    ? '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>'
    : '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  SoundSystem.startRingtone('incoming');
  window._pendingOffer = offer;
}

async function acceptCall() {
  SoundSystem.stopRingtone();
  document.getElementById('incoming-call').style.display = 'none';
  const videoConstraints = callType === 'video' ? { width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 }, frameRate: { ideal: 30, min: 15 }, facingMode: 'user' } : false;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoConstraints }).catch(() => null);
  if (!localStream) { showToast('Media access denied'); return; }

  peerConnection = new RTCPeerConnection(ICE_CONFIG);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('call-ice-candidate', { candidate: e.candidate }); };
  peerConnection.ontrack = e => {
    const remoteVid = document.getElementById('call-video-remote');
    remoteVid.srcObject = e.streams[0];
    if (callType === 'video') { remoteVid.style.display = 'block'; document.getElementById('call-user-info').style.display = 'none'; }
    e.streams[0].getVideoTracks().forEach(track => {
      track.onmute = () => { remoteVid.style.display = 'none'; document.getElementById('call-remote-avatar-bg').style.display = 'flex'; };
      track.onunmute = () => { remoteVid.style.display = 'block'; document.getElementById('call-remote-avatar-bg').style.display = 'none'; };
    });
  };
  peerConnection.oniceconnectionstatechange = () => {
    if (peerConnection?.iceConnectionState === 'disconnected' || peerConnection?.iceConnectionState === 'failed') {
      endCall(true);
    }
  };

  if (callType === 'video') {
    setupLocalVideo(localStream);
  }

  await peerConnection.setRemoteDescription(window._pendingOffer);
  // Flush any ICE candidates that arrived before peerConnection was ready
  for (const c of iceCandidateQueue) await peerConnection.addIceCandidate(c);
  iceCandidateQueue = [];

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('call-answer', { answer });
  inCall = true;
  startCallTimer();
  showCallOverlay(capitalize(callPeer), callType);
}

async function handleCallAnswer({ answer }) {
  SoundSystem.stopRingtone();
  if (peerConnection) {
    await peerConnection.setRemoteDescription(answer);
    document.getElementById('call-status').textContent = 'Connected';
    startCallTimer();
  }
}

async function handleIceCandidate({ candidate }) {
  if (!candidate) return;
  if (peerConnection && peerConnection.remoteDescription) {
    await peerConnection.addIceCandidate(candidate);
  } else {
    iceCandidateQueue.push(candidate);
  }
}

function declineCall() {
  SoundSystem.stopRingtone();
  document.getElementById('incoming-call').style.display = 'none';
  callPeer = null;
  window._pendingOffer = null;
  iceCandidateQueue = [];
  socket.emit('call-end', {});
}

function endCall(remote = false) {
  SoundSystem.stopRingtone();
  SoundSystem.callSound('hangup');
  if (!remote) socket.emit('call-end', {});
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  stopCallTimer();
  stopCallControlsAutoHide();
  inCall = false;
  callPeer = null;
  window._pendingOffer = null;
  iceCandidateQueue = [];
  document.getElementById('call-overlay').classList.remove('active');
  document.getElementById('call-video-remote').style.display = 'none';
  document.getElementById('call-video-local').style.display = 'none';
  document.getElementById('call-remote-avatar-bg').style.display = 'none';
  document.getElementById('call-local-avatar').style.display = 'none';
  document.getElementById('incoming-call').style.display = 'none';
  document.getElementById('call-user-info').style.display = '';
  // Reset toggle states
  document.getElementById('btn-mute').classList.remove('active');
  document.getElementById('btn-cam').classList.remove('active');
  document.getElementById('btn-screen').classList.remove('active');
  document.getElementById('mute-icon-on').style.display = '';
  document.getElementById('mute-icon-off').style.display = 'none';
  document.getElementById('cam-icon-on').style.display = '';
  document.getElementById('cam-icon-off').style.display = 'none';
  document.getElementById('screen-icon-on').style.display = '';
  document.getElementById('screen-icon-off').style.display = 'none';
}

function showCallOverlay(statusText, type) {
  const overlay = document.getElementById('call-overlay');
  overlay.classList.add('active');
  const name = callPeer || otherUser;
  document.getElementById('call-name').textContent = capitalize(name);
  document.getElementById('call-status').textContent = statusText;
  // Set avatar (image or initial)
  const avatarEl = document.getElementById('call-avatar');
  const users = window._users || {};
  const peerData = users[name];
  if (peerData?.avatar) {
    avatarEl.innerHTML = `<img src="${peerData.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    avatarEl.textContent = name[0].toUpperCase();
  }
  // Also set the remote-off avatar
  const bgAvatar = document.getElementById('call-avatar-bg');
  if (peerData?.avatar) {
    bgAvatar.innerHTML = `<img src="${peerData.avatar}">`;
  } else {
    bgAvatar.textContent = name[0].toUpperCase();
  }
  document.getElementById('call-name-bg').textContent = capitalize(name);
  document.getElementById('call-video-remote').style.display = type === 'video' ? 'block' : 'none';
  document.getElementById('call-video-local').style.display = type === 'video' ? 'block' : 'none';
  // Start auto-hide for video calls
  if (type === 'video') startCallControlsAutoHide();
}

function startCallTimer() {
  callSeconds = 0;
  const pill = document.getElementById('call-timer-pill');
  pill.style.display = 'block';
  callTimer = setInterval(() => {
    callSeconds++;
    const m = Math.floor(callSeconds / 60);
    const s = String(callSeconds % 60).padStart(2, '0');
    pill.textContent = `${m}:${s}`;
    document.getElementById('call-status').textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  callSeconds = 0;
  const pill = document.getElementById('call-timer-pill');
  if (pill) { pill.style.display = 'none'; pill.textContent = ''; }
}

function toggleCallMute() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    SoundSystem.callSound(track.enabled ? 'unmute' : 'mute');
    document.getElementById('mute-icon-on').style.display = track.enabled ? '' : 'none';
    document.getElementById('mute-icon-off').style.display = track.enabled ? 'none' : '';
    document.getElementById('btn-mute').classList.toggle('active', !track.enabled);
  }
}

function toggleCallVideo() {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (track) {
    track.enabled = !track.enabled;
    document.getElementById('cam-icon-on').style.display = track.enabled ? '' : 'none';
    document.getElementById('cam-icon-off').style.display = track.enabled ? 'none' : '';
    document.getElementById('btn-cam').classList.toggle('active', !track.enabled);
    // Show/hide local avatar when camera off
    document.getElementById('call-video-local').style.display = track.enabled ? 'block' : 'none';
    const localAv = document.getElementById('call-local-avatar');
    if (!track.enabled) {
      const me = (window._users || {})[currentUser];
      if (me?.avatar) {
        localAv.innerHTML = `<img src="${me.avatar}">`;
      } else {
        localAv.innerHTML = `<span style="color:#fff;font-size:1.5rem;font-weight:700">${currentUser[0].toUpperCase()}</span>`;
      }
      localAv.style.display = 'flex';
    } else {
      localAv.style.display = 'none';
    }
  }
}

// ── Screen Share ─────────────────────────────────────────────────────
let screenStream = null;
async function toggleScreenShare() {
  if (!inCall || !peerConnection) return;
  if (screenStream) {
    // Stop sharing
    SoundSystem.callSound('screenshare-off');
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    // Restore camera track
    const camTrack = localStream?.getVideoTracks()[0];
    if (camTrack) {
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(camTrack);
    }
    document.getElementById('btn-screen').classList.remove('active');
    document.getElementById('screen-icon-on').style.display = '';
    document.getElementById('screen-icon-off').style.display = 'none';
    // Restore local video preview
    const localVid = document.getElementById('call-video-local');
    if (localStream) { localVid.srcObject = localStream; localVid.style.display = 'block'; }
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = screenStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (sender) sender.replaceTrack(screenTrack);
    SoundSystem.callSound('screenshare-on');
    document.getElementById('btn-screen').classList.add('active');
    document.getElementById('screen-icon-on').style.display = 'none';
    document.getElementById('screen-icon-off').style.display = '';
    // Show screen share in local preview
    const localVid = document.getElementById('call-video-local');
    localVid.srcObject = screenStream; localVid.style.display = 'block';
    localVid.style.transform = 'none'; // Don't mirror screen share
    // Handle user stopping share via browser UI
    screenTrack.onended = () => toggleScreenShare();
  } catch { showToast('Screen share cancelled'); }
}

// ── Call Controls Auto-Hide ──────────────────────────────────────────
let callIdleTimer = null;
function startCallControlsAutoHide() {
  const overlay = document.getElementById('call-overlay');
  const controls = document.getElementById('call-controls');
  const info = document.getElementById('call-user-info');
  function showControls() {
    controls.classList.remove('hidden');
    if (info) info.style.opacity = '1';
    clearTimeout(callIdleTimer);
    callIdleTimer = setTimeout(hideControls, 3000);
  }
  function hideControls() {
    // Only hide during active video call
    if (!inCall || callType !== 'video') return;
    controls.classList.add('hidden');
    if (info) info.style.opacity = '0';
  }
  overlay.addEventListener('mousemove', showControls);
  overlay.addEventListener('touchstart', showControls);
  overlay._showControls = showControls;
  overlay._hideControls = hideControls;
  showControls();
}
function stopCallControlsAutoHide() {
  const overlay = document.getElementById('call-overlay');
  const controls = document.getElementById('call-controls');
  const info = document.getElementById('call-user-info');
  clearTimeout(callIdleTimer);
  if (overlay._showControls) {
    overlay.removeEventListener('mousemove', overlay._showControls);
    overlay.removeEventListener('touchstart', overlay._showControls);
  }
  controls.classList.remove('hidden');
  if (info) info.style.opacity = '1';
}

// ── Message Notification Popup ───────────────────────────────────────
function showMsgNotif(sender, text) {
  const container = document.getElementById('msg-notif-container');
  const users = window._users || {};
  const senderData = users[sender];
  const el = document.createElement('div');
  el.className = 'msg-notif';
  const avatarHtml = senderData?.avatar
    ? `<img src="${senderData.avatar}">`
    : sender[0].toUpperCase();
  el.innerHTML = `
    <div class="msg-notif-avatar">${avatarHtml}</div>
    <div class="msg-notif-body">
      <div class="msg-notif-name">${capitalize(sender)}</div>
      <div class="msg-notif-text">${text.replace(/</g, '&lt;')}</div>
    </div>`;
  el.onclick = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
    showSection('chat', document.querySelector('.nav-item[data-section=chat]'));
  };
  container.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4000);
}

// ── Wallpaper lightbox ────────────────────────────────────────────────
function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  openModal('image-lightbox');
}

// ── Discord-style Search System ───────────────────────────────────────
let searchFilters = []; // Array of { type: 'from', value: 'kaliph' }
let searchPendingFilter = null; // filter type waiting for value input

const SEARCH_FILTER_DEFS = [
  { type: 'from', icon: 'user', label: 'From a specific user', hint: 'from: user' },
  { type: 'has', icon: 'paperclip', label: 'Includes a type of content', hint: 'has: link, image, file' },
  { type: 'mentions', icon: 'at-sign', label: 'Mentions a specific user', hint: 'mentions: user' },
  { type: 'before', icon: 'calendar', label: 'Before a date', hint: 'before: YYYY-MM-DD' },
  { type: 'after', icon: 'calendar-check', label: 'After a date', hint: 'after: YYYY-MM-DD' },
];

function setupSearch() {
  const bar = document.getElementById('search-bar');
  const dropdown = document.getElementById('search-results');

  bar.addEventListener('focus', () => {
    if (!bar.value.trim() && !searchPendingFilter && !searchFilters.length) showSearchFilters();
    else if (searchPendingFilter && !bar.value.trim()) showValueSuggestions();
  });

  bar.addEventListener('input', () => {
    const raw = bar.value;

    // Auto-detect typed filter prefixes like "from:" "has:" etc
    const filterMatch = raw.match(/^(from|has|mentions|before|after):\s*(.*)$/i);
    if (filterMatch && !searchPendingFilter) {
      const type = filterMatch[1].toLowerCase();
      const remainder = filterMatch[2].trim();
      if (remainder) {
        // Complete filter typed: "from:kaliph" → add as committed filter
        searchFilters.push({ type, value: remainder });
        bar.value = '';
        renderSearchTags();
        executeSearch();
        return;
      } else {
        // Just the prefix typed: "from:" → enter pending filter mode
        searchPendingFilter = type;
        bar.value = '';
        updateSearchPlaceholder();
        renderSearchTags();
        showValueSuggestions();
        return;
      }
    }

    const q = bar.value.trim();

    if (searchPendingFilter) {
      // User is typing a value for the pending filter
      if (q) showValueSuggestions(q);
      else showValueSuggestions();
      return;
    }

    // Plain text search
    if (!q && !searchFilters.length) { showSearchFilters(); return; }
    executeSearch();
  });

  bar.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      clearEntireSearch();
      bar.blur();
    }
    if (e.key === 'Enter' && searchPendingFilter) {
      e.preventDefault();
      const val = bar.value.trim();
      if (val) commitPendingFilter(val);
    }
    if (e.key === 'Enter' && !searchPendingFilter) {
      e.preventDefault();
      executeSearch();
    }
    if (e.key === 'Backspace' && !bar.value) {
      if (searchPendingFilter) {
        searchPendingFilter = null;
        bar.placeholder = 'Search messages…';
        renderSearchTags();
        showSearchFilters();
      } else if (searchFilters.length) {
        searchFilters.pop();
        renderSearchTags();
        if (searchFilters.length) executeSearch();
        else showSearchFilters();
      }
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap')) {
      dropdown.classList.remove('open');
    }
  });
}

function renderSearchTags() {
  const container = document.getElementById('search-tags');
  const clearBtn = document.getElementById('search-clear-btn');
  const hasContent = searchFilters.length || searchPendingFilter;
  clearBtn.style.display = hasContent ? '' : 'none';

  let html = searchFilters.map((f, i) => `
    <span class="search-tag">
      ${f.type}:<span class="tag-value">${escapeHtml(f.value)}</span>
      <button class="search-tag-close" onclick="event.stopPropagation();removeSearchFilter(${i})">&times;</button>
    </span>
  `).join('');

  if (searchPendingFilter) {
    html += `<span class="search-tag">${searchPendingFilter}:</span>`;
  }

  container.innerHTML = html;
}

function removeSearchFilter(idx) {
  searchFilters.splice(idx, 1);
  renderSearchTags();
  const bar = document.getElementById('search-bar');
  if (searchFilters.length || bar.value.trim()) executeSearch();
  else showSearchFilters();
  bar.focus();
}

function clearEntireSearch() {
  searchFilters = [];
  searchPendingFilter = null;
  const bar = document.getElementById('search-bar');
  bar.value = '';
  bar.placeholder = 'Search messages…';
  renderSearchTags();
  document.getElementById('search-results').classList.remove('open');
}

function showSearchFilters() {
  const dropdown = document.getElementById('search-results');
  const bar = document.getElementById('search-bar');
  const q = bar.value.trim();

  let html = '';

  // If there's text, show "Search for ___" option first
  if (q) {
    html += `<div class="search-text-option" onclick="executeSearch()">
      <i data-lucide="search" style="width:15px;height:15px;color:var(--text-muted)"></i>
      Search for <span class="search-query-pill">${escapeHtml(q)}</span>
    </div>`;
  }

  html += '<div class="search-filter-header">Filters</div>';
  SEARCH_FILTER_DEFS.forEach(f => {
    html += `<div class="search-filter-item" onclick="applySearchFilter('${f.type}')">
      <div class="search-filter-icon"><i data-lucide="${f.icon}" style="width:16px;height:16px"></i></div>
      <div class="search-filter-info">
        <div class="search-filter-label">${f.label}</div>
        <div class="search-filter-hint">${f.hint}</div>
      </div>
    </div>`;
  });

  dropdown.innerHTML = html;
  dropdown.classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function showValueSuggestions(q) {
  const dropdown = document.getElementById('search-results');
  const type = searchPendingFilter;
  let html = '<div class="search-filter-header">Select a value</div>';

  if (type === 'from' || type === 'mentions') {
    const users = ['kaliph', 'kathrine'];
    const filtered = q ? users.filter(u => u.includes(q.toLowerCase())) : users;
    filtered.forEach(u => {
      html += `<div class="search-suggestion-item" onclick="commitPendingFilter('${u}')">
        <div class="search-suggestion-avatar">${u[0].toUpperCase()}</div>
        <span class="search-suggestion-name">${capitalize(u)}</span>
      </div>`;
    });
    // Also allow typing any guest name
    if (q && !filtered.length) {
      html += `<div class="search-suggestion-item" onclick="commitPendingFilter('${escapeHtml(q)}')">
        <div class="search-suggestion-avatar">${q[0].toUpperCase()}</div>
        <span class="search-suggestion-name">${escapeHtml(q)}</span>
        <span class="search-suggestion-hint">Press Enter</span>
      </div>`;
    }
  } else if (type === 'has') {
    const opts = [
      { val: 'link', icon: 'link', label: 'Link', hint: 'Messages with URLs' },
      { val: 'image', icon: 'image', label: 'Image', hint: 'Messages with images' },
      { val: 'file', icon: 'file', label: 'File', hint: 'Messages with attachments' },
    ];
    const filtered = q ? opts.filter(o => o.val.includes(q.toLowerCase())) : opts;
    filtered.forEach(o => {
      html += `<div class="search-suggestion-item" onclick="commitPendingFilter('${o.val}')">
        <div class="search-filter-icon" style="width:28px;height:28px"><i data-lucide="${o.icon}" style="width:14px;height:14px"></i></div>
        <span class="search-suggestion-name">${o.label}</span>
        <span class="search-suggestion-hint">${o.hint}</span>
      </div>`;
    });
  } else if (type === 'before' || type === 'after') {
    const today = new Date().toISOString().split('T')[0];
    const week = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const month = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const presets = type === 'before'
      ? [{ val: today, label: 'Today' }, { val: week, label: 'Past week' }, { val: month, label: 'Past month' }]
      : [{ val: month, label: '30 days ago' }, { val: week, label: '7 days ago' }, { val: today, label: 'Today' }];
    presets.forEach(p => {
      html += `<div class="search-suggestion-item" onclick="commitPendingFilter('${p.val}')">
        <div class="search-filter-icon" style="width:28px;height:28px"><i data-lucide="calendar" style="width:14px;height:14px"></i></div>
        <span class="search-suggestion-name">${p.label}</span>
        <span class="search-suggestion-hint">${p.val}</span>
      </div>`;
    });
    if (q) {
      html += `<div class="search-suggestion-item" onclick="commitPendingFilter('${escapeHtml(q)}')">
        <span class="search-suggestion-name">${escapeHtml(q)}</span>
        <span class="search-suggestion-hint">Custom date — press Enter</span>
      </div>`;
    }
  }

  dropdown.innerHTML = html;
  dropdown.classList.add('open');
  if (window.lucide) lucide.createIcons();
}

function applySearchFilter(type) {
  searchPendingFilter = type;
  const bar = document.getElementById('search-bar');
  bar.value = '';
  updateSearchPlaceholder();
  renderSearchTags();
  showValueSuggestions();
  bar.focus();
}

function commitPendingFilter(value) {
  if (!searchPendingFilter) return;
  searchFilters.push({ type: searchPendingFilter, value });
  searchPendingFilter = null;
  const bar = document.getElementById('search-bar');
  bar.value = '';
  bar.placeholder = 'Search messages…';
  renderSearchTags();
  executeSearch();
  bar.focus();
}

function updateSearchPlaceholder() {
  const bar = document.getElementById('search-bar');
  if (!searchPendingFilter) { bar.placeholder = 'Search messages…'; return; }
  const hints = {
    from: 'Enter username…',
    has: 'Enter type (link, image, file)…',
    mentions: 'Enter username…',
    before: 'Enter date (YYYY-MM-DD)…',
    after: 'Enter date (YYYY-MM-DD)…'
  };
  bar.placeholder = hints[searchPendingFilter] || 'Enter value…';
}

function executeSearch() {
  const dropdown = document.getElementById('search-results');
  const bar = document.getElementById('search-bar');
  const textQuery = bar.value.trim().toLowerCase();
  let hits = [...allMessages];

  // Apply all committed filters
  searchFilters.forEach(f => {
    const ft = f.type;
    const v = f.value.toLowerCase();
    if (ft === 'from') {
      hits = hits.filter(m => m.sender?.toLowerCase().includes(v));
    } else if (ft === 'has') {
      if (v === 'link') hits = hits.filter(m => m.text && /https?:\/\//.test(m.text));
      else if (v === 'image' || v === 'img') hits = hits.filter(m => m.files?.some(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)));
      else if (v === 'file') hits = hits.filter(m => m.files?.length > 0);
    } else if (ft === 'mentions') {
      hits = hits.filter(m => m.text?.toLowerCase().includes('@' + v) || m.text?.toLowerCase().includes(v));
    } else if (ft === 'before') {
      const d = new Date(v); if (!isNaN(d)) hits = hits.filter(m => new Date(m.timestamp) < d);
    } else if (ft === 'after') {
      const d = new Date(v); if (!isNaN(d)) hits = hits.filter(m => new Date(m.timestamp) > d);
    }
  });

  // Apply text search
  if (textQuery) {
    hits = hits.filter(m => m.text?.toLowerCase().includes(textQuery));
  }

  // Show no-search state
  if (!textQuery && !searchFilters.length) { showSearchFilters(); return; }

  const count = hits.length;
  let html = `<div class="search-results-header">
    <span class="search-results-count">${count} result${count !== 1 ? 's' : ''}</span>
  </div>`;

  if (!count) {
    html += '<div class="search-result-item"><div class="search-result-text" style="color:var(--text-muted);text-align:center">No messages found</div></div>';
  } else {
    html += hits.slice(0, 25).map(m => {
      const time = formatTime(m.timestamp);
      const text = highlight(m.text || '', textQuery);
      return `<div class="search-result-item" onclick="clickSearchResult('${m.id}')">
        <div class="search-result-top">
          <span class="search-result-sender">${capitalize(m.sender)}</span>
          <span class="search-result-time">${time}</span>
        </div>
        <div class="search-result-text">${text}</div>
      </div>`;
    }).join('');
  }

  dropdown.innerHTML = html;
  dropdown.classList.add('open');
  document.getElementById('search-clear-btn').style.display = '';
}

function clickSearchResult(id) {
  document.getElementById('search-results').classList.remove('open');
  scrollToMessage(id);
}

function scrollToMessage(id) {
  showSection('chat', document.querySelector('.nav-item[data-section=chat]'));
  setTimeout(() => {
    const el = document.getElementById('msg-' + id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('msg-highlight');
      setTimeout(() => el.classList.remove('msg-highlight'), 2500);
    }
  }, 100);
}

function highlight(text, q) {
  if (!text || !q) return escapeHtml(text || '').substring(0, 140);
  const safe = escapeHtml(text).substring(0, 140);
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(escaped, 'gi'), m => `<mark style="background:var(--accent);color:#fff;border-radius:2px;padding:0 2px">${m}</mark>`);
  } catch { return safe; }
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const noMod = !e.ctrlKey && !e.metaKey;
    const mod = e.ctrlKey || e.metaKey;
    const input = document.getElementById('msg-input');
    const focused = document.activeElement === input;

    if (mod && e.key === 'Enter') { e.preventDefault(); sendMessage(); } // Ctrl+Enter also works
    if (mod && e.key === 'b' && focused) { e.preventDefault(); applyFormat('bold'); }
    if (mod && e.key === 'i' && focused) { e.preventDefault(); applyFormat('italic'); }
    if (mod && e.key === 'u' && focused) { e.preventDefault(); applyFormat('underline'); }
    if (mod && e.key === 'k') { e.preventDefault(); document.getElementById('search-bar').focus(); }
    if (mod && e.key === '1') { e.preventDefault(); showSection('chat', document.querySelector('[data-section=chat]')); }
    if (mod && e.key === '2') { e.preventDefault(); showSection('notes', document.querySelector('[data-section=notes]')); }
    if (mod && e.key === ',') { e.preventDefault(); openSettingsModal(); }
    if (mod && e.key === 'n') { e.preventDefault(); openModal('new-note-modal'); }
    if (mod && e.key === 'e' && focused) { e.preventDefault(); openEmojiPicker({clientX:100,clientY:400,stopPropagation:()=>{}}, 'msg'); }
    if (e.key === 'Escape') { closeAllModals(); closeContextMenu(); document.getElementById('emoji-picker').classList.remove('open'); document.getElementById('reaction-picker').classList.remove('open'); }
    if (noMod && !focused) {
      if (e.key === '/') { e.preventDefault(); input.focus(); }
    }
  });

  // Typing sound on input + Enter to send
  document.getElementById('msg-input')?.addEventListener('keydown', e => {
    if (e.key.length === 1 || e.key === 'Backspace') SoundSystem.keystroke();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.getElementById('brainstorm-input')?.addEventListener('keydown', e => {
    if (e.key.length === 1 || e.key === 'Backspace') SoundSystem.keystroke();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendBrainstorm(); }
  });

  // Typing emit
  let typingTimeout;
  document.getElementById('msg-input')?.addEventListener('input', () => {
    socket.emit('typing', { user: currentUser });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop-typing', { user: currentUser }), 1500);
    autoResizeInput();
  });

  setupSearch();
}

function autoResizeInput() {
  const t = document.getElementById('msg-input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
}

function resetInputHeight() {
  const t = document.getElementById('msg-input');
  t.style.height = '36px';
}

// ── Last Seen helpers ─────────────────────────────────────────────────
function formatLastSeen(ts) {
  if (!ts) return 'Offline';
  const date = new Date(ts);
  const now = new Date();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins}m ago`;
  // Same day — show time
  if (date.toDateString() === now.toDateString()) return `Last seen today at ${time}`;
  // Yesterday
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Last seen yesterday at ${time}`;
  // Older — show date and time
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `Last seen ${dateStr} at ${time}`;
}

let _lastSeenInterval = null;
function startLastSeenUpdater() {
  if (_lastSeenInterval) clearInterval(_lastSeenInterval);
  _lastSeenInterval = setInterval(() => {
    if (!window._lastSeenTime) { clearInterval(_lastSeenInterval); return; }
    document.getElementById('other-status-label').textContent = formatLastSeen(window._lastSeenTime);
  }, 60000);
}

function stopLastSeenUpdater() {
  if (_lastSeenInterval) { clearInterval(_lastSeenInterval); _lastSeenInterval = null; }
  window._lastSeenTime = null;
}

// ── Activity tracking / auto-logout ───────────────────────────────────
function setupActivityTracking() {
  const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
  events.forEach(ev => document.addEventListener(ev, resetActivity, { passive: true }));
  inactivityTimer = setInterval(checkActivity, 10000);
}

let _isAutoIdle = false;    // 'idle' or 'invisible' when auto-set
const IDLE_MS = 3 * 60 * 1000;       // 3 min → Idle (yellow)
const INVISIBLE_MS = 5 * 60 * 1000;  // 5 min → Invisible (gray + last seen)

function resetActivity() {
  lastActivity = Date.now();
  document.getElementById('inactivity-warning').style.display = 'none';
  if (_isAutoIdle) {
    _isAutoIdle = false;
    socket.emit('user-active', { user: currentUser });
    setStatusDot('my-status-dot', 'online');
    updateStatusText('online');
  }
}

function checkActivity() {
  const elapsed = Date.now() - lastActivity;
  if (elapsed >= TIMEOUT_MS) { logout(); return; }
  if (elapsed >= WARNING_MS) {
    const remaining = Math.ceil((TIMEOUT_MS - elapsed) / 1000);
    document.getElementById('logout-countdown').textContent = remaining;
    document.getElementById('inactivity-warning').style.display = 'block';
  }
  // Tier 1: 3 min → Idle (yellow)
  // Tier 2: 5 min → Invisible (gray, shows last seen to others)
  if (elapsed >= INVISIBLE_MS && _isAutoIdle !== 'invisible') {
    _isAutoIdle = 'invisible';
    socket.emit('user-invisible', { user: currentUser });
    setStatusDot('my-status-dot', 'invisible');
    updateStatusText('invisible');
  } else if (elapsed >= IDLE_MS && !_isAutoIdle) {
    _isAutoIdle = 'idle';
    socket.emit('user-idle', { user: currentUser });
    setStatusDot('my-status-dot', 'idle');
    updateStatusText('idle');
  }
}

// Save lastSeen when user closes tab or navigates away
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon('/api/users/' + currentUser + '/lastseen', '');
});

// Tab hidden = go idle, tab visible = come back online
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!_isAutoIdle) {
      _isAutoIdle = 'idle';
      socket.emit('user-idle', { user: currentUser });
    }
  } else {
    if (_isAutoIdle) {
      _isAutoIdle = false;
      lastActivity = Date.now();
      socket.emit('user-active', { user: currentUser });
      setStatusDot('my-status-dot', 'online');
      updateStatusText('online');
    }
  }
});

// ── Modal helpers ─────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }

// Click outside modal
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
  if (!e.target.closest('#context-menu')) closeContextMenu();
  if (!e.target.closest('#emoji-picker') && !e.target.closest('.format-btn[onclick*=emoji]')) document.getElementById('emoji-picker').classList.remove('open');
  if (!e.target.closest('#reaction-picker')) document.getElementById('reaction-picker').classList.remove('open');
  if (!e.target.closest('.status-menu') && !e.target.closest('#my-status-text')) document.getElementById('status-menu').classList.remove('open');
});

// ── Notifications ─────────────────────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendDesktopNotif(title, body) {
  if (document.hasFocus()) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
}

// ── Toast ─────────────────────────────────────────────────────────────
function showToast(msg, duration = 3000) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.style.pointerEvents = 'auto';
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, duration);
}

// ── Utility ───────────────────────────────────────────────────────────
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date(); const yest = new Date(today); yest.setDate(yest.getDate()-1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' });
}

function triggerFileUpload() { document.getElementById('file-input').click(); }

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  clearInterval(inactivityTimer);
  window.location.href = '/';
}

// ── Start ─────────────────────────────────────────────────────────────
init().catch(err => console.error('Init failed:', err));
