'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   ROYAL VAULT — Desktop App Renderer
   ═══════════════════════════════════════════════════════════════════════════ */

const API_BASE = 'https://royalkvault.up.railway.app';

// ── Global State ──────────────────────────────────────────────────────────────
const S = {
  user: null,          // 'kaliph' | 'kathrine'
  users: {},           // { kaliph: {...}, kathrine: {...} }
  socket: null,
  messages: [],
  currentSection: 'chat',
  replyingTo: null,
  editingMessageId: null,
  isAtBottom: true,
  oldestMsgTs: null,
  hasOlderMessages: false,
  typingTimeout: null,
  otherIsTyping: false,
  priorityMode: false,
  isRecording: false,
  mediaRecorder: null,
  recordedChunks: [],
  vaultUnlocked: false,
  vaultPasscode: null,
  reminderInterval: null,
  gifSearchTimeout: null,
  selectedProfileForAuth: null,
};

// ── Utility ───────────────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeader(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function otherUser() {
  return S.user === 'kaliph' ? 'kathrine' : 'kaliph';
}

function avatarUrl(user) {
  const u = S.users[user];
  if (u && u.avatar) return API_BASE + u.avatar;
  return null;
}

function avatarEl(user, size = 28) {
  const url = avatarUrl(user);
  const name = S.users[user]?.name || user;
  const initial = name.charAt(0).toUpperCase();
  if (url) {
    return `<img src="${esc(url)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size*0.4)}px;font-weight:600;color:var(--text-primary);flex-shrink:0">${initial}</div>`;
}

function fileIcon(type) {
  if (!type) return '📄';
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📕';
  if (type.includes('zip') || type.includes('rar')) return '🗜️';
  if (type.includes('word') || type.includes('doc')) return '📝';
  if (type.includes('sheet') || type.includes('csv')) return '📊';
  return '📄';
}

function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

async function api(method, path, body, isFormData = false) {
  const opts = {
    method,
    credentials: 'include',
  };
  if (body && !isFormData) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  } else if (isFormData) {
    opts.body = body; // FormData — let browser set content-type
  }
  try {
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) { handleUnauth(); return null; }
    return res.ok ? res.json().catch(() => null) : null;
  } catch (e) {
    console.error('API error:', e);
    return null;
  }
}

function handleUnauth() {
  // Session expired — re-show auth
  S.user = null;
  el('app').classList.add('hidden');
  el('auth-screen').classList.remove('hidden');
  el('title-user-info').style.display = 'none';
  showProfileSelect();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function init() {
  // Wire PIN digit inputs
  setupPinInputs();

  // Wire keyboard shortcuts
  document.addEventListener('keydown', globalKeydown);

  // Listen for events from main process
  window.electron.on('switch-user', showSwitchUserMenu);

  // Check existing session
  try {
    const sess = await fetch(API_BASE + '/api/auth/session', { credentials: 'include' })
      .then(r => r.json()).catch(() => null);

    if (sess && sess.user) {
      // Already fully logged in — go to app
      await enterApp(sess.user);
      return;
    }

    if (sess && sess.authenticated) {
      // Site-authenticated but no profile yet
      showProfileSelect();
      return;
    }
  } catch (_) { /* offline */ }

  // No session — try stored site password
  const storedPass = await window.electron.store.get('sitePassword');
  if (storedPass) {
    const ok = await doSiteAuth(storedPass, true);
    if (ok) { showProfileSelect(); return; }
  }

  // Need site password entry
  showSitePassScreen();
}

function showSitePassScreen() {
  el('auth-site-pass').classList.remove('hidden');
  el('auth-profile-select').classList.add('hidden');
  el('auth-pin').classList.add('hidden');
  setTimeout(() => el('site-pass-input').focus(), 100);
}

function showProfileSelect() {
  el('auth-site-pass').classList.add('hidden');
  el('auth-profile-select').classList.remove('hidden');
  el('auth-pin').classList.add('hidden');
  // Populate avatars if user data available
  updateProfileCardAvatars();
  // If there's a remembered user, go straight to their PIN
  window.electron.store.get('lastUser').then(last => {
    if (last) selectProfile(last);
  });
}

function updateProfileCardAvatars() {
  for (const profile of ['kaliph', 'kathrine']) {
    const avatarEl2 = el('avatar-' + profile);
    if (!avatarEl2) continue;
    const u = S.users[profile];
    if (u && u.avatar) {
      avatarEl2.innerHTML = `<img src="${esc(API_BASE + u.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.remove()">`;
    }
  }
}

async function submitSitePassword() {
  const pass = el('site-pass-input').value.trim();
  if (!pass) return;
  el('site-pass-btn').disabled = true;
  el('site-pass-error').textContent = '';
  const ok = await doSiteAuth(pass, false);
  if (ok) {
    await window.electron.store.set('sitePassword', pass);
    showProfileSelect();
  } else {
    el('site-pass-error').textContent = 'Incorrect password. Try again.';
    el('site-pass-btn').disabled = false;
    el('site-pass-input').select();
  }
}

async function doSiteAuth(password, silent) {
  try {
    const res = await fetch(API_BASE + '/api/auth/password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    return data && data.success;
  } catch (e) {
    if (!silent) console.error('Site auth error:', e);
    return false;
  }
}

function selectProfile(profile) {
  S.selectedProfileForAuth = profile;
  $$('.profile-card').forEach(c => c.classList.remove('selected'));
  el('card-' + profile)?.classList.add('selected');

  el('pin-profile-name').textContent = profile.charAt(0).toUpperCase() + profile.slice(1);
  el('pin-profile-emoji').textContent = profile === 'kaliph' ? '💙' : '🩷';

  el('auth-profile-select').classList.add('hidden');
  el('auth-pin').classList.remove('hidden');

  // Clear pin digits
  $$('.pin-digit').forEach(d => { d.value = ''; });
  el('pin-error').textContent = '';
  setTimeout(() => $$('.pin-digit')[0].focus(), 100);
}

function backToProfileSelect() {
  el('auth-pin').classList.add('hidden');
  el('auth-profile-select').classList.remove('hidden');
  S.selectedProfileForAuth = null;
  window.electron.store.delete('lastUser');
}

function setupPinInputs() {
  $$('.pin-digit').forEach((input, idx, arr) => {
    input.addEventListener('input', e => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val ? val[0] : '';
      if (val && idx < arr.length - 1) arr[idx + 1].focus();
      if (arr.every(d => d.value)) submitPin();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        arr[idx - 1].focus();
      }
    });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      arr.forEach((d, i) => { d.value = text[i] || ''; });
      if (text.length >= 4) submitPin();
    });
  });
}

async function submitPin() {
  const digits = $$('.pin-digit');
  const pin = digits.map(d => d.value).join('');
  if (pin.length !== 4) return;

  el('pin-error').textContent = '';
  digits.forEach(d => d.disabled = true);

  try {
    const res = await fetch(API_BASE + '/api/auth/profile', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: S.selectedProfileForAuth, passcode: pin })
    });
    const data = await res.json();

    if (data && data.success) {
      await window.electron.store.set('lastUser', S.selectedProfileForAuth);
      await enterApp(S.selectedProfileForAuth);
    } else {
      el('pin-error').textContent = data?.error || 'Incorrect PIN. Try again.';
      digits.forEach(d => { d.value = ''; d.disabled = false; });
      digits[0].focus();
    }
  } catch (e) {
    el('pin-error').textContent = 'Connection error. Retrying…';
    digits.forEach(d => { d.value = ''; d.disabled = false; });
  }
}

async function enterApp(profile) {
  S.user = profile;
  el('auth-screen').classList.add('hidden');
  el('app').classList.remove('hidden');

  // Load user data
  const users = await api('GET', '/api/users');
  if (users) {
    S.users = users.reduce ? users.reduce((a, u) => ({ ...a, [u.name?.toLowerCase()]: u }), {}) : users;
    // Handle object format { kaliph: {...}, kathrine: {...} }
    if (!Array.isArray(users)) Object.assign(S.users, users);
  }

  // Apply theme
  const myUser = S.users[profile] || S.users[profile.toLowerCase()] || {};
  applyTheme(myUser.theme || (profile === 'kaliph' ? 'kaliph' : 'kathrine'));

  // Update UI
  updateUserUI();
  initChatHeader();

  // Initialize Socket.IO
  initSocket();

  // Load initial section
  navigate('chat');
  await loadMessages();

  // Start reminder checker
  startReminderChecker();
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme || 'dark');
}

// ── User UI ───────────────────────────────────────────────────────────────────
function updateUserUI() {
  const user = S.users[S.user] || {};
  const name = user.name || S.user || '';

  // Nav footer
  el('nav-user-name').textContent = name;
  el('nav-user-status').textContent = user.customStatus || 'online';
  const navAvatar = el('nav-user-avatar');
  if (user.avatar) {
    navAvatar.innerHTML = `<img src="${esc(API_BASE + user.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.remove()">`;
  } else {
    navAvatar.textContent = name.charAt(0).toUpperCase();
  }

  // Title bar
  const titleInfo = el('title-user-info');
  titleInfo.style.display = 'flex';
  el('title-user-name').textContent = name;
  const titleAvatar = el('title-user-avatar');
  if (user.avatar) {
    titleAvatar.innerHTML = `<img src="${esc(API_BASE + user.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    titleAvatar.textContent = name.charAt(0).toUpperCase();
    titleAvatar.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--accent);color:#fff;border-radius:50%;width:24px;height:24px';
  }
}

function initChatHeader() {
  const other = otherUser();
  const u = S.users[other] || {};
  const name = u.name || other;

  el('chat-other-name').textContent = name;

  const avatarDiv = el('chat-other-avatar');
  if (u.avatar) {
    avatarDiv.innerHTML = `<img src="${esc(API_BASE + u.avatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`;
  } else {
    avatarDiv.textContent = name.charAt(0).toUpperCase();
    avatarDiv.style.cssText = 'width:36px;height:36px;border-radius:50%;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--text-primary)';
  }
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  if (S.socket) { S.socket.disconnect(); }

  S.socket = io(API_BASE, {
    withCredentials: true,
    transports: ['websocket', 'polling']
  });

  S.socket.on('connect', () => {
    S.socket.emit('user-online', { user: S.user });
    S.socket.emit('heartbeat', { user: S.user });
  });

  S.socket.on('disconnect', () => {
    updateOtherPresence('offline');
  });

  // New message
  S.socket.on('new-message', (msg) => {
    // De-duplicate
    if (S.messages.find(m => m.id === msg.id)) return;
    S.messages.push(msg);
    appendMessageToDOM(msg);
    if (S.isAtBottom) scrollToBottom();

    // Mark as read if we're in chat and window focused
    if (S.currentSection === 'chat' && document.hasFocus() && msg.sender !== S.user) {
      api('POST', `/api/messages/${msg.id}/read`);
    }

    // Desktop notification if window not focused
    if (!document.hasFocus() && msg.sender !== S.user) {
      const senderName = S.users[msg.sender]?.name || msg.sender;
      const body = msg.text ? msg.text.slice(0, 120) : (msg.files?.length ? '📎 File' : '');
      const title = msg.priority ? `🔴 Priority — ${senderName}` : senderName;
      window.electron.notify(title, body);
    }
  });

  // Edits & deletes
  S.socket.on('msg-edited', ({ id, text, editedAt }) => {
    const m = S.messages.find(m => m.id === id);
    if (m) { m.text = text; m.edited = true; m.editedAt = editedAt; }
    const bubble = document.querySelector(`[data-msg-id="${id}"] .message-text`);
    if (bubble) bubble.innerHTML = esc(text);
    const editedBadge = document.querySelector(`[data-msg-id="${id}"] .msg-edited`);
    if (editedBadge) editedBadge.style.display = 'inline';
  });

  S.socket.on('msg-unsent', (id) => {
    S.messages = S.messages.filter(m => m.id !== id);
    const row = document.querySelector(`[data-msg-id="${id}"]`);
    if (row) row.remove();
  });

  S.socket.on('msg-reaction', ({ id, reactions }) => {
    const m = S.messages.find(m => m.id === id);
    if (m) m.reactions = reactions;
    updateMessageReactions(id, reactions);
  });

  S.socket.on('msg-read', ({ id, readAt }) => {
    const m = S.messages.find(m => m.id === id);
    if (m) { m.read = true; m.readAt = readAt; }
    updateReadReceipts();
  });

  S.socket.on('msg-pinned', ({ id, pinnedBy, pinnedAt }) => {
    const m = S.messages.find(m => m.id === id);
    if (m) { m.pinned = true; m.pinnedBy = pinnedBy; m.pinnedAt = pinnedAt; }
    loadPinnedBanner();
  });

  S.socket.on('msg-unpinned', ({ id }) => {
    const m = S.messages.find(m => m.id === id);
    if (m) m.pinned = false;
    loadPinnedBanner();
  });

  // Typing
  S.socket.on('user-typing', ({ user }) => {
    if (user !== S.user) showTypingIndicator(user);
  });
  S.socket.on('user-stop-typing', ({ user }) => {
    if (user !== S.user) hideTypingIndicator();
  });

  // Presence
  S.socket.on('user-presence', ({ user, state }) => {
    if (user !== S.user) updateOtherPresence(state);
    window.electron.sendPresenceToTray(user, state);
  });

  S.socket.on('user-updated', ({ user: profile, data }) => {
    if (S.users[profile]) Object.assign(S.users[profile], data);
    if (profile === S.user) {
      applyTheme(data.theme);
      updateUserUI();
    }
  });

  // Calendar / Reminders
  S.socket.on('calendar-updated', () => {
    if (S.currentSection === 'calendar') loadCalendar();
  });
  S.socket.on('reminder-updated', () => {
    if (S.currentSection === 'reminders') loadReminders();
  });
  S.socket.on('reminder-due', (reminder) => {
    if (reminder.user === S.user || !reminder.user) {
      window.electron.notify('🔔 Reminder', reminder.title);
    }
  });

  // Heartbeat
  setInterval(() => {
    if (S.socket && S.socket.connected) {
      S.socket.emit('heartbeat', { user: S.user });
    }
  }, 30000);
}

function updateOtherPresence(state) {
  const dot = el('chat-other-presence');
  const statusText = el('chat-other-status');
  if (dot) { dot.className = 'presence-dot ' + (state || 'offline'); }
  if (statusText) statusText.textContent = state || 'offline';
  const navDot = el('nav-user-presence');
  // nav dot shows OUR presence, not other's
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(section) {
  S.currentSection = section;
  $$('.section').forEach(s => s.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  el(section + '-section')?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
  closeRightPanel();

  // Load section data
  switch (section) {
    case 'notes':     loadNotes();     break;
    case 'calendar':  loadCalendar();  break;
    case 'vault':     loadVault();     break;
    case 'contacts':  loadContacts();  break;
    case 'reminders': loadReminders(); break;
    case 'guests':    loadGuests();    break;
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function loadMessages(before = null) {
  let url = '/api/messages?limit=50';
  if (before) url += `&before=${before}`;

  const data = await api('GET', url);
  if (!data) return;

  const msgs = Array.isArray(data) ? data : (data.messages || []);

  if (!before) {
    S.messages = msgs;
    const container = el('messages-container');
    container.innerHTML = '';
    // Show load-older button
    el('load-older-btn').style.display = msgs.length >= 50 ? 'block' : 'none';
    S.hasOlderMessages = msgs.length >= 50;
    renderAllMessages();
    scrollToBottom(true);
    loadPinnedBanner();
  } else {
    // Prepend older messages
    const prevFirstId = S.messages[0]?.id;
    S.messages = [...msgs, ...S.messages];
    S.oldestMsgTs = msgs[0]?.timestamp;
    renderAllMessages();
    // Restore scroll position
    if (prevFirstId) {
      const el2 = document.querySelector(`[data-msg-id="${prevFirstId}"]`);
      el2?.scrollIntoView({ block: 'start' });
    }
    el('load-older-btn').style.display = msgs.length >= 50 ? 'block' : 'none';
  }

  S.oldestMsgTs = S.messages[0]?.timestamp;

  // Mark visible messages as read
  markVisibleAsRead();
}

async function loadOlderMessages() {
  if (!S.oldestMsgTs) return;
  await loadMessages(S.oldestMsgTs);
}

function renderAllMessages() {
  const container = el('messages-container');
  // Keep the load-older button
  const loadBtn = el('load-older-btn');
  container.innerHTML = '';
  container.appendChild(loadBtn);

  let prevMsg = null;
  for (const msg of S.messages) {
    // Date divider
    if (!prevMsg || !sameDay(prevMsg.timestamp, msg.timestamp)) {
      const div = document.createElement('div');
      div.className = 'date-divider';
      div.textContent = formatDateHeader(msg.timestamp);
      container.appendChild(div);
    }
    const grouped = prevMsg && prevMsg.sender === msg.sender &&
      (msg.timestamp - prevMsg.timestamp) < 120000;
    container.appendChild(createMessageEl(msg, grouped));
    prevMsg = msg;
  }
}

function appendMessageToDOM(msg) {
  const container = el('messages-container');
  const lastMsg = S.messages[S.messages.length - 2]; // msg already pushed
  const grouped = lastMsg && lastMsg.sender === msg.sender &&
    (msg.timestamp - lastMsg.timestamp) < 120000;

  // Date divider if needed
  if (!lastMsg || !sameDay(lastMsg?.timestamp, msg.timestamp)) {
    const div = document.createElement('div');
    div.className = 'date-divider fade-in';
    div.textContent = formatDateHeader(msg.timestamp);
    container.appendChild(div);
  }
  container.appendChild(createMessageEl(msg, grouped));
  updateReadReceipts();
}

function createMessageEl(msg, grouped = false) {
  const isSelf = msg.sender === S.user;
  const user = S.users[msg.sender] || {};
  const row = document.createElement('div');
  row.className = `msg-row ${isSelf ? 'self' : ''} ${grouped ? 'grouped' : ''}`;
  row.setAttribute('data-msg-id', msg.id);
  row.setAttribute('data-sender', msg.sender);
  row.setAttribute('data-ts', msg.timestamp);

  // Context menu on right-click
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, msg);
  });

  // Avatar
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';
  avatarDiv.innerHTML = avatarEl(msg.sender, 28);
  row.appendChild(avatarDiv);

  // Bubble wrap
  const wrap = document.createElement('div');
  wrap.className = 'msg-bubble-wrap';

  // Priority badge
  if (msg.priority && !isSelf) {
    const pb = document.createElement('div');
    pb.className = 'msg-priority-badge';
    pb.innerHTML = '🔴 Priority';
    wrap.appendChild(pb);
  }

  // Bubble
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble ${msg.priority ? 'priority' : ''}`;

  // Reply quote
  if (msg.replyTo) {
    const quoted = S.messages.find(m => m.id === msg.replyTo);
    if (quoted) {
      const quote = document.createElement('div');
      quote.className = 'msg-reply-quote';
      const qName = S.users[quoted.sender]?.name || quoted.sender;
      quote.innerHTML = `<strong>${esc(qName)}</strong><span>${esc(quoted.text || (quoted.files?.length ? '📎 File' : ''))}</span>`;
      quote.onclick = () => scrollToMessage(msg.replyTo);
      bubble.appendChild(quote);
    }
  }

  // Text
  if (msg.text) {
    const textEl = document.createElement('span');
    textEl.className = 'message-text';
    textEl.innerHTML = linkifyText(esc(msg.text));
    if (msg.edited) {
      const ed = document.createElement('span');
      ed.className = 'msg-edited';
      ed.textContent = '(edited)';
      textEl.appendChild(ed);
    }
    bubble.appendChild(textEl);
  }

  // Files
  if (msg.files && msg.files.length) {
    const filesDiv = document.createElement('div');
    filesDiv.className = 'msg-files';
    msg.files.forEach(f => {
      if (f.type && f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = API_BASE + f.url;
        img.className = 'msg-image-thumb';
        img.alt = f.name || 'image';
        img.onclick = () => openLightbox(API_BASE + f.url);
        filesDiv.appendChild(img);
      } else if (f.type && f.type.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = API_BASE + f.url;
        audio.className = 'msg-audio';
        audio.controls = true;
        filesDiv.appendChild(audio);
      } else {
        const fd = document.createElement('div');
        fd.className = 'msg-file';
        fd.innerHTML = `<span class="msg-file-icon">${fileIcon(f.type)}</span>
          <div class="msg-file-info">
            <div class="msg-file-name">${esc(f.name || 'File')}</div>
            <div class="msg-file-size">${formatBytes(f.size)}</div>
          </div>`;
        fd.onclick = () => window.electron.openExternal(API_BASE + f.url);
        filesDiv.appendChild(fd);
      }
    });
    bubble.appendChild(filesDiv);
  }

  wrap.appendChild(bubble);

  // Reactions
  const reactions = msg.reactions || {};
  if (Object.keys(reactions).length) {
    wrap.appendChild(createReactionsEl(msg.id, reactions));
  }

  // Footer (time + read receipt)
  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  footer.innerHTML = `<span class="msg-time">${formatTime(msg.timestamp)}</span>`;
  if (isSelf && msg.read) {
    footer.innerHTML += `<span class="msg-read">✓ Seen</span>`;
  }
  wrap.appendChild(footer);

  // Hover actions
  wrap.appendChild(createMsgActions(msg, isSelf));

  row.appendChild(wrap);
  return row;
}

function createMsgActions(msg, isSelf) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const now = Date.now();
  const canUnsend = isSelf && (now - msg.timestamp) < 180000;
  const canEdit = isSelf && msg.text;

  // React button
  const reactBtn = document.createElement('button');
  reactBtn.className = 'msg-action-btn';
  reactBtn.title = 'React';
  reactBtn.textContent = '😊';
  reactBtn.onclick = (e) => { e.stopPropagation(); showReactionPicker(e, msg.id); };
  actions.appendChild(reactBtn);

  // Reply
  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn';
  replyBtn.title = 'Reply';
  replyBtn.textContent = '↩';
  replyBtn.onclick = (e) => { e.stopPropagation(); startReply(msg); };
  actions.appendChild(replyBtn);

  if (canEdit) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = '✏️';
    editBtn.onclick = (e) => { e.stopPropagation(); startEditMessage(msg); };
    actions.appendChild(editBtn);
  }

  if (canUnsend) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn';
    delBtn.title = 'Unsend';
    delBtn.textContent = '🗑️';
    delBtn.onclick = (e) => { e.stopPropagation(); unsendMessage(msg.id); };
    actions.appendChild(delBtn);
  }

  return actions;
}

function createReactionsEl(msgId, reactions) {
  const div = document.createElement('div');
  div.className = 'msg-reactions';
  div.id = `reactions-${msgId}`;
  renderReactionsInto(div, msgId, reactions);
  return div;
}

function renderReactionsInto(container, msgId, reactions) {
  container.innerHTML = '';
  for (const [emoji, reactors] of Object.entries(reactions)) {
    if (!reactors.length) continue;
    const chip = document.createElement('div');
    chip.className = `reaction-chip ${reactors.includes(S.user) ? 'mine' : ''}`;
    chip.innerHTML = `${emoji}<span class="reaction-count">${reactors.length}</span>`;
    chip.onclick = () => toggleReaction(msgId, emoji);
    container.appendChild(chip);
  }
}

function updateMessageReactions(msgId, reactions) {
  let container = el('reactions-' + msgId);
  if (!container) {
    // Create reactions container and append to bubble wrap
    const row = document.querySelector(`[data-msg-id="${msgId}"] .msg-bubble-wrap`);
    if (!row) return;
    container = document.createElement('div');
    container.className = 'msg-reactions';
    container.id = `reactions-${msgId}`;
    // Insert before footer
    const footer = row.querySelector('.msg-footer');
    row.insertBefore(container, footer);
  }
  renderReactionsInto(container, msgId, reactions);
}

function updateReadReceipts() {
  // Find the last message from me that has been read
  const myMsgs = S.messages.filter(m => m.sender === S.user && m.read);
  const lastRead = myMsgs[myMsgs.length - 1];
  // Remove old seen indicators
  $$('.msg-read').forEach(el2 => el2.remove());
  if (lastRead) {
    const row = document.querySelector(`[data-msg-id="${lastRead.id}"] .msg-footer`);
    if (row) {
      const seen = document.createElement('span');
      seen.className = 'msg-read';
      seen.textContent = `✓ Seen ${formatTime(lastRead.readAt)}`;
      row.appendChild(seen);
    }
  }
}

function markVisibleAsRead() {
  const unread = S.messages.filter(m => m.sender !== S.user && !m.read);
  unread.forEach(m => api('POST', `/api/messages/${m.id}/read`));
}

async function sendMessage() {
  const input = el('message-input');
  const text = input.value.trim();
  const hasReply = !!S.replyingTo;
  const hasEdit = !!S.editingMessageId;

  if (hasEdit) {
    if (!text) return;
    await api('PUT', `/api/messages/${S.editingMessageId}`, { text });
    cancelEdit();
    return;
  }

  if (!text) return;

  const body = { text, priority: S.priorityMode };
  if (S.replyingTo) body.replyTo = S.replyingTo.id;

  input.value = '';
  autoResizeInput(input);
  cancelReply();

  await api('POST', '/api/messages', body);

  // Stop typing indicator
  if (S.typingTimeout) {
    clearTimeout(S.typingTimeout);
    S.socket?.emit('stop-typing', { user: S.user });
  }
}

async function uploadAndSendFiles(files) {
  if (!files || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (S.replyingTo) fd.append('replyTo', S.replyingTo.id);
  if (S.priorityMode) fd.append('priority', 'true');
  await fetch(API_BASE + '/api/messages', {
    method: 'POST',
    credentials: 'include',
    body: fd
  });
  cancelReply();
}

function startReply(msg) {
  S.replyingTo = msg;
  const senderName = S.users[msg.sender]?.name || msg.sender;
  el('reply-label').textContent = `Replying to ${senderName}`;
  el('reply-preview').textContent = msg.text || (msg.files?.length ? '📎 File' : '');
  el('reply-bar').classList.add('visible');
  el('message-input').focus();
}

function cancelReply() {
  S.replyingTo = null;
  el('reply-bar').classList.remove('visible');
}

function startEditMessage(msg) {
  S.editingMessageId = msg.id;
  const input = el('message-input');
  input.value = msg.text || '';
  autoResizeInput(input);
  input.focus();
  el('reply-label').textContent = 'Editing message';
  el('reply-preview').textContent = msg.text || '';
  el('reply-bar').classList.add('visible');
}

function cancelEdit() {
  S.editingMessageId = null;
  cancelReply();
  el('message-input').value = '';
  autoResizeInput(el('message-input'));
}

async function unsendMessage(id) {
  await api('DELETE', `/api/messages/${id}`);
}

async function toggleReaction(msgId, emoji) {
  await api('POST', `/api/messages/${msgId}/react`, { emoji });
}

function showReactionPicker(e, msgId) {
  closeAllPickers();
  const EMOJIS = ['❤️','🥰','😂','😭','😤','🔥','💀','👏','🙏','✨','💯','😍','🤔','😮','🫶','💕','😘','🤣','👀','💙','💜','🤍'];
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = em;
    btn.title = em;
    btn.onclick = () => { toggleReaction(msgId, em); picker.remove(); };
    picker.appendChild(btn);
  });
  document.body.appendChild(picker);
  const rect = e.target.getBoundingClientRect();
  picker.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
  picker.style.top = (rect.top - picker.offsetHeight - 8) + 'px';

  setTimeout(() => document.addEventListener('click', function h(ev) {
    if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', h); }
  }), 10);
}

function showMessageContextMenu(e, msg) {
  closeAllPickers();
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const items = [
    { label: '↩ Reply', action: () => startReply(msg) },
  ];

  if (msg.sender === S.user && msg.text) {
    items.push({ label: '✏️ Edit', action: () => startEditMessage(msg) });
  }
  if (msg.sender === S.user && (Date.now() - msg.timestamp) < 180000) {
    items.push({ label: '🗑️ Unsend', action: () => unsendMessage(msg.id), danger: true });
  }
  items.push({ separator: true });
  if (!msg.pinned) {
    items.push({ label: '📌 Pin', action: () => api('POST', `/api/messages/${msg.id}/pin`) });
  } else {
    items.push({ label: '📌 Unpin', action: () => api('POST', `/api/messages/${msg.id}/unpin`) });
  }
  items.push({ label: '😊 React', action: (ev) => showReactionPicker({ target: ev.target, clientX: e.clientX, clientY: e.clientY, ...e }, msg.id) });

  items.forEach(item => {
    if (item.separator) {
      const s = document.createElement('div');
      s.className = 'context-menu-item separator';
      menu.appendChild(s);
      return;
    }
    const el2 = document.createElement('div');
    el2.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    el2.textContent = item.label;
    el2.onclick = () => { item.action(); menu.remove(); };
    menu.appendChild(el2);
  });

  document.body.appendChild(menu);
  menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px';

  setTimeout(() => document.addEventListener('click', function h() {
    menu.remove(); document.removeEventListener('click', h);
  }), 10);
}

async function loadPinnedBanner() {
  const data = await api('GET', '/api/messages/pinned');
  const pinned = Array.isArray(data) ? data : [];
  const banner = el('pinned-banner');
  if (!pinned.length) { banner.classList.remove('visible'); return; }
  const latest = pinned[pinned.length - 1];
  el('pinned-banner-text').textContent = `📌 ${latest.text || (latest.files?.length ? '📎 File' : '(pinned message)')}`;
  banner.classList.add('visible');
  banner.onclick = () => scrollToMessage(latest.id);
}

function closePinnedBanner() {
  el('pinned-banner').classList.remove('visible');
}

async function loadPinnedMessages() {
  const data = await api('GET', '/api/messages/pinned');
  const pinned = Array.isArray(data) ? data : [];
  openRightPanel('pinned-messages', { pinned });
}

function scrollToMessage(id) {
  const el2 = document.querySelector(`[data-msg-id="${id}"]`);
  if (el2) {
    el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el2.style.background = 'rgba(var(--accent-rgb),0.15)';
    setTimeout(() => el2.style.background = '', 1500);
  }
}

function scrollToBottom(instant = false) {
  const c = el('messages-container');
  c.scrollTo({ top: c.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
}

function handleChatScroll() {
  const c = el('messages-container');
  const atBottom = c.scrollHeight - c.clientHeight - c.scrollTop < 80;
  S.isAtBottom = atBottom;
  el('scroll-to-bottom').classList.toggle('visible', !atBottom);

  if (c.scrollTop < 100 && S.hasOlderMessages) {
    el('load-older-btn').style.display = 'block';
  }
}

function handleTyping() {
  if (!S.socket) return;
  S.socket.emit('typing', { user: S.user });
  clearTimeout(S.typingTimeout);
  S.typingTimeout = setTimeout(() => {
    S.socket.emit('stop-typing', { user: S.user });
  }, 1500);
}

function showTypingIndicator(user) {
  const name = S.users[user]?.name || user;
  el('typing-indicator').innerHTML = `
    <span style="font-size:12px;color:var(--text-muted)">${esc(name)} is typing</span>
    <div class="typing-dots">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
}

function hideTypingIndicator() {
  el('typing-indicator').innerHTML = '';
}

function autoResizeInput(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function handleInputKeydown(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
  if (e.key === 'Escape') {
    if (S.editingMessageId) cancelEdit();
    else if (S.replyingTo) cancelReply();
  }
  if (e.key === 'ArrowUp' && !el('message-input').value && !S.editingMessageId) {
    // Edit last message
    const lastMyMsg = [...S.messages].reverse().find(m => m.sender === S.user && m.text);
    if (lastMyMsg) startEditMessage(lastMyMsg);
  }
}

function togglePriority() {
  S.priorityMode = !S.priorityMode;
  el('priority-toggle').classList.toggle('active', S.priorityMode);
}

// ── Emoji Picker ──────────────────────────────────────────────────────────────
function toggleEmojiPicker() {
  const picker = el('emoji-picker');
  if (picker.classList.contains('open')) { picker.classList.remove('open'); return; }
  const EMOJIS = ['😊','😂','🤣','❤️','😍','😭','😤','🔥','💀','👏','🙏','✨','💯','🥰','😘','🤔','😮','🫶','💕','💙','💜','🖤','💚','🤍','😏','👀','🎉','🤝','💪','🌟','⭐','💎','🌹','🦋','🌙','☀️','🌊','🎵','🎶','🍀'];
  picker.innerHTML = '';
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = em;
    btn.onclick = () => {
      const input = el('message-input');
      const start = input.selectionStart;
      input.value = input.value.slice(0, start) + em + input.value.slice(start);
      input.selectionStart = input.selectionEnd = start + em.length;
      input.focus();
      picker.classList.remove('open');
    };
    picker.appendChild(btn);
  });
  picker.classList.add('open');
  closeGifPicker();
}

function closeAllPickers() {
  el('emoji-picker').classList.remove('open');
  closeGifPicker();
  $$('.reaction-picker').forEach(p => p.remove());
  $$('.context-menu').forEach(m => m.remove());
}

// ── GIF Picker ────────────────────────────────────────────────────────────────
function toggleGifPicker() {
  const picker = el('gif-picker');
  if (picker.classList.contains('open')) { closeGifPicker(); return; }
  picker.classList.add('open');
  closeEmojiPicker();
  loadTrendingGifs();
}

function closeGifPicker() { el('gif-picker').classList.remove('open'); }
function closeEmojiPicker() { el('emoji-picker').classList.remove('open'); }

async function loadTrendingGifs() {
  const grid = el('gif-grid');
  grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Loading…</div>';
  const data = await api('GET', '/api/gif-trending?limit=15');
  renderGifs(data);
}

async function searchGifs(q) {
  clearTimeout(S.gifSearchTimeout);
  if (!q.trim()) { loadTrendingGifs(); return; }
  S.gifSearchTimeout = setTimeout(async () => {
    const data = await api('GET', `/api/gif-search?q=${encodeURIComponent(q)}&limit=15`);
    renderGifs(data);
  }, 400);
}

function renderGifs(data) {
  const grid = el('gif-grid');
  const results = data?.results || data?.gifs || data || [];
  if (!results.length) {
    grid.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">No GIFs found</div>';
    return;
  }
  grid.innerHTML = '';
  results.forEach(gif => {
    const url = gif.media_formats?.gif?.url || gif.url || gif.media?.[0]?.gif?.url;
    const preview = gif.media_formats?.tinygif?.url || gif.media_formats?.nanogif?.url || url;
    if (!url) return;
    const item = document.createElement('div');
    item.className = 'gif-item';
    item.innerHTML = `<img src="${esc(preview)}" loading="lazy" alt="gif">`;
    item.onclick = () => sendGif(url);
    grid.appendChild(item);
  });
}

async function sendGif(url) {
  closeGifPicker();
  await api('POST', '/api/messages', { text: url });
}

// ── Voice Recording ───────────────────────────────────────────────────────────
async function toggleVoiceRecording() {
  if (S.isRecording) {
    stopVoiceRecording();
  } else {
    await startVoiceRecording();
  }
}

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    S.isRecording = true;
    S.recordedChunks = [];
    S.mediaRecorder = new MediaRecorder(stream);
    S.mediaRecorder.ondataavailable = e => S.recordedChunks.push(e.data);
    S.mediaRecorder.onstop = async () => {
      const blob = new Blob(S.recordedChunks, { type: 'audio/webm' });
      const file = new File([blob], 'voice-message.webm', { type: 'audio/webm' });
      await uploadAndSendFiles([file]);
      stream.getTracks().forEach(t => t.stop());
      S.isRecording = false;
      el('voice-btn').innerHTML = '🎙️';
      el('voice-btn').title = 'Voice message';
    };
    S.mediaRecorder.start();
    el('voice-btn').innerHTML = '⏹️';
    el('voice-btn').title = 'Stop recording';
    el('voice-btn').style.color = '#ef4444';
  } catch (e) {
    console.error('Mic access denied:', e);
  }
}

function stopVoiceRecording() {
  if (S.mediaRecorder && S.mediaRecorder.state !== 'inactive') {
    S.mediaRecorder.stop();
  }
}

// ── File handling ─────────────────────────────────────────────────────────────
function handleFilePicker(files) {
  if (files?.length) uploadAndSendFiles([...files]);
}

// Drag and drop into chat
(function setupDragDrop() {
  document.addEventListener('DOMContentLoaded', () => {
    const panel = el('center-panel');
    if (!panel) return;
    ['dragenter', 'dragover'].forEach(ev => {
      panel.addEventListener(ev, e => {
        e.preventDefault();
        if (S.currentSection === 'chat') {
          el('drop-overlay').classList.add('visible');
        }
      });
    });
    ['dragleave', 'dragend'].forEach(ev => {
      panel.addEventListener(ev, e => {
        if (!panel.contains(e.relatedTarget)) {
          el('drop-overlay').classList.remove('visible');
        }
      });
    });
    panel.addEventListener('drop', e => {
      e.preventDefault();
      el('drop-overlay').classList.remove('visible');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length && S.currentSection === 'chat') uploadAndSendFiles(files);
    });
  });
})();

// ── Linkify ───────────────────────────────────────────────────────────────────
function linkifyText(text) {
  return text.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    url => `<a href="#" onclick="window.electron.openExternal('${url.replace(/'/g, "\\'")}');return false">${url}</a>`
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────
async function loadNotes() {
  const data = await api('GET', '/api/notes');
  const notes = Array.isArray(data) ? data : [];
  const list = el('notes-list');
  if (!notes.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>No notes yet</p></div>';
    return;
  }
  list.innerHTML = '<div class="notes-list">' + notes.map(n => `
    <div class="note-item" onclick="openNote(${JSON.stringify(esc(n.id))})" data-note-id="${esc(n.id)}">
      <span class="note-icon">${n.type === 'todo' ? '☑️' : '📄'}</span>
      <div class="note-info">
        <div class="note-title">${esc(n.title || 'Untitled')}</div>
        <div class="note-preview">${esc((n.content || '').slice(0, 60))}</div>
      </div>
      <div class="note-meta">${formatTime(n.updatedAt || n.createdAt)}</div>
    </div>`).join('') + '</div>';
}

async function openNote(id) {
  $$('.note-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-note-id="${id}"]`)?.classList.add('active');
  const data = await api('GET', '/api/notes');
  const note = (Array.isArray(data) ? data : []).find(n => n.id === id);
  if (!note) return;
  openRightPanel('note', { note });
}

async function createNote() {
  const note = await api('POST', '/api/notes', { title: 'New Note', content: '', owner: S.user });
  if (note) { await loadNotes(); openNote(note.id); }
}

async function saveNote(id, title, content) {
  await api('PUT', `/api/notes/${id}`, { title, content });
  await loadNotes();
}

async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  await api('DELETE', `/api/notes/${id}`);
  closeRightPanel();
  await loadNotes();
}

// ── Calendar ──────────────────────────────────────────────────────────────────
let calYear, calMonth;
async function loadCalendar() {
  const now = new Date();
  calYear = calYear || now.getFullYear();
  calMonth = calMonth !== undefined ? calMonth : now.getMonth();

  const data = await api('GET', '/api/calendar');
  const events = Array.isArray(data) ? data : [];
  renderCalendarView(events);
}

function renderCalendarView(events) {
  const body = el('calendar-body');
  const now = new Date();
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  const monthName = firstDay.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const eventsByDay = {};
  events.forEach(ev => {
    const d = new Date(ev.date || ev.startDate || ev.start || ev.timestamp);
    const key = d.toDateString();
    (eventsByDay[key] = eventsByDay[key] || []).push(ev);
  });

  let html = `<div class="calendar-grid">
    <div class="cal-header">
      <button class="ghost" onclick="calNav(-1)">◀</button>
      <div class="cal-title">${monthName}</div>
      <button class="ghost" onclick="calNav(1)">▶</button>
    </div>
    <div class="cal-days-header">
      ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div>${d}</div>`).join('')}
    </div>
    <div class="cal-days">`;

  // Leading blanks
  for (let i = 0; i < firstDay.getDay(); i++) {
    html += `<div class="cal-day other-month"></div>`;
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(calYear, calMonth, d);
    const key = date.toDateString();
    const hasEv = !!eventsByDay[key];
    const isToday = date.toDateString() === now.toDateString();
    html += `<div class="cal-day ${isToday ? 'today' : ''} ${hasEv ? 'has-event' : ''}"
      onclick="openCalendarDay(${calYear},${calMonth},${d})">${d}</div>`;
  }
  html += `</div></div>`;

  // Upcoming events list
  const upcoming = events
    .filter(ev => new Date(ev.date || ev.startDate || ev.start || ev.timestamp) >= new Date(calYear, calMonth, 1))
    .sort((a, b) => new Date(a.date||a.startDate||a.start) - new Date(b.date||b.startDate||b.start))
    .slice(0, 10);

  if (upcoming.length) {
    html += '<div style="padding:12px;display:flex;flex-direction:column;gap:6px">';
    html += '<div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Upcoming</div>';
    upcoming.forEach(ev => {
      const d = new Date(ev.date || ev.startDate || ev.start || ev.timestamp);
      html += `<div class="card" style="padding:10px 14px;cursor:pointer" onclick="openEventDetail(${JSON.stringify(JSON.stringify(ev))})">
        <div style="font-weight:500;font-size:13px">${esc(ev.title)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
      </div>`;
    });
    html += '</div>';
  }

  body.innerHTML = html;
}

function calNav(dir) {
  calMonth += dir;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  loadCalendar();
}

function openCalendarDay(y, m, d) {
  createEvent(new Date(y, m, d));
}

function openEventDetail(evJson) {
  const ev = JSON.parse(evJson);
  openRightPanel('event', { event: ev });
}

async function createEvent(date = new Date()) {
  const dateStr = date.toISOString().split('T')[0];
  openRightPanel('new-event', { date: dateStr });
}

async function saveEvent(data, id = null) {
  if (id) {
    await api('PUT', `/api/calendar/${id}`, data);
  } else {
    await api('POST', '/api/calendar', data);
  }
  await loadCalendar();
  closeRightPanel();
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  await api('DELETE', `/api/calendar/${id}`);
  await loadCalendar();
  closeRightPanel();
}

// ── Vault ─────────────────────────────────────────────────────────────────────
async function loadVault() {
  if (!S.vaultUnlocked) {
    showVaultUnlock();
    return;
  }
  const data = await api('GET', `/api/vault?passcode=${encodeURIComponent(S.vaultPasscode)}`);
  const items = Array.isArray(data) ? data : [];
  el('vault-upload-btn').style.display = 'block';

  if (!items.length) {
    el('vault-body').innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><p>Vault is empty</p></div>';
    return;
  }

  el('vault-body').innerHTML = `<div class="vault-grid">${items.map(item => {
    const isImg = item.type?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(item.url || '');
    const thumb = isImg ? `<img class="vault-item-thumb" src="${esc(API_BASE + item.url)}" loading="lazy">` :
      `<div class="vault-item-icon">${fileIcon(item.type)}</div>`;
    return `<div class="vault-item" onclick="openVaultItem(${JSON.stringify(JSON.stringify(item))})">
      ${thumb}
      <div class="vault-item-name">${esc(item.name || item.title || 'File')}</div>
    </div>`;
  }).join('')}</div>`;
}

function showVaultUnlock() {
  el('vault-upload-btn').style.display = 'none';
  el('vault-body').innerHTML = `
    <div class="vault-unlock">
      <div style="font-size:48px">🔒</div>
      <h2>Vault Locked</h2>
      <p style="color:var(--text-muted);font-size:13px;text-align:center">Enter your vault passcode to access</p>
      <div style="display:flex;flex-direction:column;gap:10px;width:280px">
        <input type="password" id="vault-pass-input" placeholder="Passcode" maxlength="20">
        <p id="vault-pass-error" style="color:#ef4444;font-size:12px;min-height:16px"></p>
        <button class="primary" onclick="unlockVault()">Unlock</button>
      </div>
    </div>`;
  el('vault-pass-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') unlockVault();
  });
}

async function unlockVault() {
  const pass = el('vault-pass-input')?.value.trim();
  if (!pass) return;
  const data = await api('GET', `/api/vault?passcode=${encodeURIComponent(pass)}`);
  if (data && !data.error) {
    S.vaultUnlocked = true;
    S.vaultPasscode = pass;
    await loadVault();
  } else {
    if (el('vault-pass-error')) el('vault-pass-error').textContent = 'Incorrect passcode';
  }
}

async function vaultUpload() {
  const result = await window.electron.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (result.canceled || !result.filePaths.length) return;
  // Use file input for consistency
  el('file-picker').click();
}

function openVaultItem(itemJson) {
  const item = JSON.parse(itemJson);
  openRightPanel('vault-item', { item });
}

// ── Contacts ──────────────────────────────────────────────────────────────────
async function loadContacts() {
  const data = await api('GET', '/api/contacts');
  const contacts = Array.isArray(data) ? data : [];
  const list = el('contacts-list');

  if (!contacts.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>No contacts yet</p></div>';
    return;
  }

  list.innerHTML = '<div class="contacts-list">' + contacts.map(c => {
    const initial = (c.name || '?').charAt(0).toUpperCase();
    const avatarHtml = c.photo ?
      `<img class="contact-avatar" src="${esc(API_BASE + c.photo)}" onerror="this.style.display='none'">` :
      `<div class="contact-avatar">${initial}</div>`;
    return `<div class="contact-item" onclick="openContact(${JSON.stringify(JSON.stringify(c))})" data-contact-id="${esc(c.id)}">
      ${avatarHtml}
      <div class="contact-info">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-sub">${esc(c.email || c.phone || c.nickname || '')}</div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function openContact(cJson) {
  const c = JSON.parse(cJson);
  $$('.contact-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`[data-contact-id="${c.id}"]`)?.classList.add('active');
  openRightPanel('contact', { contact: c });
}

async function createContact() {
  openRightPanel('new-contact', {});
}

async function saveContact(data, id = null) {
  const fd = new FormData();
  Object.entries(data).forEach(([k, v]) => { if (v !== undefined) fd.append(k, v); });
  if (id) {
    await fetch(API_BASE + `/api/contacts/${id}`, { method: 'PUT', credentials: 'include', body: fd });
  } else {
    await fetch(API_BASE + '/api/contacts', { method: 'POST', credentials: 'include', body: fd });
  }
  await loadContacts();
  closeRightPanel();
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  await api('DELETE', `/api/contacts/${id}`);
  closeRightPanel();
  await loadContacts();
}

// ── Reminders ─────────────────────────────────────────────────────────────────
async function loadReminders() {
  const data = await api('GET', '/api/reminders');
  const reminders = Array.isArray(data) ? data : [];
  const list = el('reminders-list');

  if (!reminders.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><p>No reminders</p></div>';
    return;
  }

  list.innerHTML = '<div class="reminders-list">' + reminders.map(r => {
    const done = r.completed || r.done;
    const when = r.datetime ? new Date(r.datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="reminder-item ${done ? 'done' : ''}" data-reminder-id="${esc(r.id)}">
      <div class="reminder-check" onclick="toggleReminder('${esc(r.id)}', ${!done})">${done ? '✓' : ''}</div>
      <div class="reminder-info">
        <div class="reminder-title">${esc(r.title)}</div>
        ${when ? `<div class="reminder-when">⏰ ${when}</div>` : ''}
      </div>
      <button class="reminder-delete" onclick="deleteReminder('${esc(r.id)}')">✕</button>
    </div>`;
  }).join('') + '</div>';
}

async function createReminder() {
  openRightPanel('new-reminder', {});
}

async function saveReminder(data) {
  await api('POST', '/api/reminders', { ...data, user: S.user });
  await loadReminders();
  closeRightPanel();
}

async function toggleReminder(id, done) {
  await api('PUT', `/api/reminders/${id}`, { completed: done });
  await loadReminders();
}

async function deleteReminder(id) {
  await api('DELETE', `/api/reminders/${id}`);
  await loadReminders();
}

function startReminderChecker() {
  clearInterval(S.reminderInterval);
  S.reminderInterval = setInterval(async () => {
    const data = await api('GET', '/api/reminders');
    const reminders = Array.isArray(data) ? data : [];
    const now = Date.now();
    reminders.forEach(r => {
      if (!r.datetime || r.completed || r.notified) return;
      const dt = new Date(r.datetime).getTime();
      if (dt <= now && dt > now - 60000) {
        window.electron.notify('🔔 Reminder', r.title);
      }
    });
  }, 30000);
}

// ── Guests ────────────────────────────────────────────────────────────────────
async function loadGuests() {
  const data = await api('GET', '/api/guests');
  const guests = data ? Object.values(data) : [];
  const list = el('guests-list');

  if (!guests.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🚪</div><p>No guests</p></div>';
    return;
  }

  list.innerHTML = '<div class="guests-list">' + guests.map(g => {
    const avatarHtml = g.avatar ?
      `<div class="guest-avatar"><img src="${esc(API_BASE + g.avatar)}" onerror="this.remove()"></div>` :
      `<div class="guest-avatar">${(g.name || '?').charAt(0).toUpperCase()}</div>`;
    return `<div class="guest-item" onclick="openGuest(${JSON.stringify(JSON.stringify(g))})" data-guest-id="${esc(g.id)}">
      ${avatarHtml}
      <div class="guest-info">
        <div class="guest-name">${esc(g.name)}</div>
        <div class="guest-sub">${esc(g.channels?.join(', ') || 'Guest')}</div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

async function openGuest(gJson) {
  const guest = JSON.parse(gJson);
  $$('.guest-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`[data-guest-id="${guest.id}"]`)?.classList.add('active');

  // Load guest messages
  const msgs = await api('GET', '/api/guest-messages');
  const guestMsgs = Array.isArray(msgs) ? msgs.filter(m => m.guestId === guest.id || m.sender === guest.id) : [];
  openRightPanel('guest-thread', { guest, messages: guestMsgs });
}

// ── Right Panel ───────────────────────────────────────────────────────────────
function openRightPanel(type, data) {
  const panel = el('right-panel');
  panel.classList.add('open');
  renderRightPanelContent(type, data);
}

function closeRightPanel() {
  el('right-panel').classList.remove('open');
  el('right-panel-content').innerHTML = '';
}

function setRightPanelTitle(t) {
  el('right-panel-title').textContent = t;
}

function renderRightPanelContent(type, data) {
  const content = el('right-panel-content');
  content.innerHTML = '';

  switch (type) {
    case 'note': {
      setRightPanelTitle('Note');
      const { note } = data;
      content.innerHTML = `
        <input class="note-editor-title" id="rp-note-title" value="${esc(note.title || '')}" placeholder="Title">
        <textarea class="note-editor-body" id="rp-note-body" style="min-height:300px">${esc(note.content || '')}</textarea>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="primary" onclick="saveNote('${esc(note.id)}', el('rp-note-title').value, el('rp-note-body').value)">Save</button>
          <button class="danger" onclick="deleteNote('${esc(note.id)}')">Delete</button>
        </div>`;
      break;
    }

    case 'new-event': {
      setRightPanelTitle('New Event');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div><label style="font-size:12px;color:var(--text-muted);margin-bottom:4px;display:block">Title</label>
            <input id="ev-title" placeholder="Event title"></div>
          <div><label style="font-size:12px;color:var(--text-muted);margin-bottom:4px;display:block">Date</label>
            <input type="date" id="ev-date" value="${esc(data.date || '')}"></div>
          <div><label style="font-size:12px;color:var(--text-muted);margin-bottom:4px;display:block">Time (optional)</label>
            <input type="time" id="ev-time"></div>
          <div><label style="font-size:12px;color:var(--text-muted);margin-bottom:4px;display:block">Notes</label>
            <textarea id="ev-notes" placeholder="Details…"></textarea></div>
          <div style="display:flex;gap:8px">
            <button class="primary" onclick="saveEvent({title:el('ev-title').value,date:el('ev-date').value,time:el('ev-time').value,notes:el('ev-notes').value,user:S.user})">Save</button>
            <button onclick="closeRightPanel()">Cancel</button>
          </div>
        </div>`;
      break;
    }

    case 'event': {
      setRightPanelTitle('Event');
      const { event: ev } = data;
      const d = new Date(ev.date || ev.startDate || ev.start || ev.timestamp);
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px">
          <div style="font-size:20px;font-weight:600;font-family:var(--font-heading)">${esc(ev.title)}</div>
          <div style="color:var(--text-muted);font-size:14px">📅 ${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
          ${ev.notes ? `<div style="font-size:14px;color:var(--text-secondary)">${esc(ev.notes)}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="danger" onclick="deleteEvent('${esc(ev.id)}')">Delete</button>
          </div>
        </div>`;
      break;
    }

    case 'vault-item': {
      setRightPanelTitle('Vault Item');
      const { item } = data;
      const isImg = item.type?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(item.url || '');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:16px">
          ${isImg ? `<img src="${esc(API_BASE + item.url)}" style="width:100%;border-radius:12px;object-fit:contain;max-height:300px" onclick="openLightbox('${esc(API_BASE + item.url)}')">` :
            `<div style="text-align:center;font-size:64px">${fileIcon(item.type)}</div>`}
          <div style="font-weight:500;font-size:15px">${esc(item.name || item.title || 'File')}</div>
          ${item.size ? `<div style="color:var(--text-muted);font-size:13px">${formatBytes(item.size)}</div>` : ''}
          <div style="display:flex;gap:8px">
            <button class="primary" onclick="window.electron.openExternal('${esc(API_BASE + item.url)}')">Open</button>
            <button class="danger" onclick="deleteVaultItem('${esc(item.id)}')">Delete</button>
          </div>
        </div>`;
      break;
    }

    case 'contact': {
      setRightPanelTitle('Contact');
      const { contact: c } = data;
      const initial = (c.name || '?').charAt(0).toUpperCase();
      content.innerHTML = `
        <div class="contact-detail-header">
          ${c.photo ? `<img class="contact-detail-avatar" src="${esc(API_BASE + c.photo)}" onerror="this.style.display='none'">` :
            `<div class="contact-detail-avatar">${initial}</div>`}
          <div class="contact-detail-name">${esc(c.name)}</div>
          ${c.nickname ? `<div style="color:var(--text-muted);font-size:13px">${esc(c.nickname)}</div>` : ''}
        </div>
        ${c.email ? `<div class="detail-field"><div class="detail-label">Email</div><div class="detail-value">${esc(c.email)}</div></div>` : ''}
        ${c.phone ? `<div class="detail-field"><div class="detail-label">Phone</div><div class="detail-value">${esc(c.phone)}</div></div>` : ''}
        ${c.birthday ? `<div class="detail-field"><div class="detail-label">Birthday</div><div class="detail-value">${esc(c.birthday)}</div></div>` : ''}
        ${c.notes ? `<div class="detail-field"><div class="detail-label">Notes</div><div class="detail-value">${esc(c.notes)}</div></div>` : ''}
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="danger" onclick="deleteContact('${esc(c.id)}')">Delete</button>
        </div>`;
      break;
    }

    case 'new-contact': {
      setRightPanelTitle('New Contact');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <input id="nc-name" placeholder="Name *">
          <input id="nc-nickname" placeholder="Nickname">
          <input id="nc-email" type="email" placeholder="Email">
          <input id="nc-phone" placeholder="Phone">
          <input id="nc-birthday" type="date" placeholder="Birthday">
          <textarea id="nc-notes" placeholder="Notes…"></textarea>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="primary" onclick="saveContact({name:el('nc-name').value,nickname:el('nc-nickname').value,email:el('nc-email').value,phone:el('nc-phone').value,birthday:el('nc-birthday').value,notes:el('nc-notes').value})">Save</button>
            <button onclick="closeRightPanel()">Cancel</button>
          </div>
        </div>`;
      break;
    }

    case 'new-reminder': {
      setRightPanelTitle('New Reminder');
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <input id="rm-title" placeholder="Reminder title *">
          <input id="rm-datetime" type="datetime-local">
          <select id="rm-repeat" style="background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border);border-radius:10px;padding:10px 14px">
            <option value="">No repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="primary" onclick="saveReminder({title:el('rm-title').value,datetime:el('rm-datetime').value,repeat:el('rm-repeat').value})">Save</button>
            <button onclick="closeRightPanel()">Cancel</button>
          </div>
        </div>`;
      break;
    }

    case 'guest-thread': {
      setRightPanelTitle(`Guest: ${esc(data.guest.name)}`);
      const msgs2 = data.messages || [];
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;gap:8px">
          <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
            ${msgs2.length ? msgs2.map(m => `
              <div style="display:flex;flex-direction:column;gap:2px;align-items:${m.sender === S.user ? 'flex-end' : 'flex-start'}">
                <div style="background:${m.sender === S.user ? 'var(--bubble-self)' : 'var(--bubble-other)'};color:${m.sender === S.user ? 'var(--bubble-self-text)' : 'var(--bubble-other-text)'};padding:8px 12px;border-radius:14px;font-size:13px;max-width:90%">${esc(m.text || '')}</div>
                <div style="font-size:10px;color:var(--text-muted)">${formatTime(m.timestamp)}</div>
              </div>`).join('') :
              '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px">No messages yet</div>'}
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0;padding-top:8px;border-top:1px solid var(--border)">
            <input id="guest-reply-input" placeholder="Reply to guest…" style="flex:1" onkeydown="if(event.key==='Enter')sendGuestReply('${esc(data.guest.id)}')">
            <button class="primary" onclick="sendGuestReply('${esc(data.guest.id)}')">Send</button>
          </div>
        </div>`;
      break;
    }

    case 'pinned-messages': {
      setRightPanelTitle('Pinned Messages');
      const { pinned } = data;
      if (!pinned.length) {
        content.innerHTML = '<div class="empty-state"><div class="empty-icon">📌</div><p>No pinned messages</p></div>';
        break;
      }
      content.innerHTML = pinned.map(msg => {
        const name = S.users[msg.sender]?.name || msg.sender;
        return `<div class="card" style="margin-bottom:8px;cursor:pointer" onclick="scrollToMessage('${esc(msg.id)}');closeRightPanel()">
          <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px">${esc(name)}</div>
          <div style="font-size:13px">${esc(msg.text || (msg.files?.length ? '📎 File' : ''))}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${formatTime(msg.pinnedAt || msg.timestamp)}</div>
        </div>`;
      }).join('');
      break;
    }
  }
}

async function sendGuestReply(guestId) {
  const input = el('guest-reply-input');
  const text = input?.value.trim();
  if (!text) return;
  await api('POST', `/api/guests/${guestId}/message`, { text, sender: S.user });
  input.value = '';
  // Reload guest thread
  const gData = await api('GET', '/api/guests');
  const guest = gData?.[guestId];
  if (guest) openGuest(JSON.stringify(guest));
}

async function deleteVaultItem(id) {
  if (!confirm('Delete this item from the vault?')) return;
  await api('DELETE', `/api/vault/${id}`);
  closeRightPanel();
  await loadVault();
}

// ── Image Lightbox ─────────────────────────────────────────────────────────────
function openLightbox(url) {
  const lb = el('image-lightbox');
  lb.innerHTML = `<img src="${esc(url)}" onclick="event.stopPropagation()">`;
  lb.style.display = 'flex';
}

function closeLightbox() {
  const lb = el('image-lightbox');
  lb.style.display = 'none';
  lb.innerHTML = '';
}

// ── User menu ─────────────────────────────────────────────────────────────────
function showSwitchUserMenu() {
  closeAllPickers();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.top = '44px';
  menu.style.right = '16px';
  menu.style.left = 'auto';

  const autoLaunch = window.electron.getAutoLaunch();

  [
    { label: `Logged in as ${S.user}`, disabled: true },
    { separator: true },
    { label: '🔄 Switch Profile', action: () => {
        S.user = null;
        S.vaultUnlocked = false;
        if (S.socket) S.socket.disconnect();
        clearInterval(S.reminderInterval);
        el('app').classList.add('hidden');
        el('auth-screen').classList.remove('hidden');
        el('title-user-info').style.display = 'none';
        showProfileSelect();
      }
    },
    { label: '🔓 Logout (clear session)', action: async () => {
        await api('POST', '/api/auth/logout');
        await window.electron.clearSession();
        window.electron.store.delete('lastUser');
        window.electron.store.delete('sitePassword');
        S.user = null;
        if (S.socket) S.socket.disconnect();
        el('app').classList.add('hidden');
        el('auth-screen').classList.remove('hidden');
        el('title-user-info').style.display = 'none';
        showSitePassScreen();
      }
    },
    { separator: true },
    { label: '⚙️ Auto-launch at login', action: async () => {
        const current = await window.electron.getAutoLaunch();
        await window.electron.setAutoLaunch(!current);
      }
    },
    { separator: true },
    { label: '✕ Quit Royal Vault', action: () => window.electron.quit(), danger: true }
  ].forEach(item => {
    if (item.separator) {
      const s = document.createElement('div');
      s.className = 'context-menu-item separator';
      menu.appendChild(s);
      return;
    }
    const el2 = document.createElement('div');
    el2.className = 'context-menu-item' + (item.danger ? ' danger' : '');
    el2.textContent = item.label;
    if (item.disabled) el2.style.opacity = '0.5';
    else el2.onclick = () => { item.action(); menu.remove(); };
    menu.appendChild(el2);
  });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function h() {
    menu.remove(); document.removeEventListener('click', h);
  }), 10);
}

// ── Global keyboard shortcuts ──────────────────────────────────────────────────
function globalKeydown(e) {
  if (e.key === 'Escape') {
    closeAllPickers();
    closeLightbox();
    $$('.modal-overlay').forEach(m => m.remove());
  }
  // Section navigation (if focus not in input)
  if (document.activeElement === document.body || document.activeElement === el('app')) {
    const sectionKeys = { '1': 'chat', '2': 'notes', '3': 'calendar', '4': 'vault', '5': 'contacts', '6': 'reminders', '7': 'guests' };
    if (e.metaKey && sectionKeys[e.key]) {
      e.preventDefault();
      navigate(sectionKeys[e.key]);
    }
  }
}

// ── Site password enter on keydown ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  el('site-pass-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitSitePassword();
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
init().catch(console.error);
