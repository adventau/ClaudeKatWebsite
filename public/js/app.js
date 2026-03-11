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

// ── Stealth preview mode ─────────────────────────────────────────────
let stealthMode = false;
let stealthRealUser = null;  // The actual logged-in user when in stealth

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
let pinnedPanelOpen = false;
let isSending = false;
let inactivityTimer = null;
let warningTimer = null;
let lastActivity = Date.now();
const TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 29 * 60 * 1000;

// ── Unread tracking ──────────────────────────────────────────────────
let unreadCount = 0;
let chatLastReadTs = 0; // Timestamp of last time user viewed chat

const EMOJIS = [
  // Faces
  '😀','😃','😄','😁','😂','🤣','😅','😊','😇','🥰','😍','🤩','😘','😗','😋','😛',
  '😜','🤪','😝','🤑','🤗','🤭','🫢','🤫','🤔','🫡','🤐','🤨','😐','😑','😶',
  '🫥','😏','😒','🙄','😬','😮‍💨','🤥','🫠','😌','😔','😪','🤤','😴','😷','🤒',
  '🤕','🤢','🤮','🥵','🥶','🥴','😵','😵‍💫','🤯','🤠','🥳','🥸','😎','🤓','🧐',
  // Emotional
  '😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰',
  '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','🤬','😈',
  '👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖',
  // Gestures & people
  '👋','🤚','🖐️','✋','🖖','🫱','🫲','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘',
  '🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏',
  '🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪',
  // Hearts & love
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕',
  '💞','💓','💗','💖','💘','💝',
  // Symbols & nature
  '✨','⭐','🌟','💫','🔥','💥','🌈','☀️','🌙','⚡','❄️','🌊','🌸','🌺','🍀',
  '🦋','🌹','🎵','🎶','🎤','🎧',
  // Objects
  '👑','💎','🔮','🎯','💡','🧠','🚀','🏆','🎉','🎊','🎁','🎀','🎗️','🏅','🥇',
  '💰','💸','📱','💻','⌚','📷','🔔','🔕','📌','📍','✅','❌','⭕','💯',
];

const THEMES = [
  { id: 'kaliph',   name: 'AVNT Purple',       preview: 'linear-gradient(135deg,#08051a,#7c3aed,#3b82f6)' },
  { id: 'kathrine', name: 'Royal Violet',       preview: 'linear-gradient(135deg,#0d0716,#8b5cf6,#e9d5ff)' },
  { id: 'royal',    name: 'Crimson Throne',     preview: 'linear-gradient(135deg,#0a0703,#b91c1c,#d97706)' },
  { id: 'light',    name: 'Pristine Light',     preview: 'linear-gradient(135deg,#f8fafc,#6366f1,#e0e7ff)' },
  { id: 'dark',     name: 'Midnight Dark',      preview: 'linear-gradient(135deg,#0f172a,#818cf8,#1e293b)' },
  { id: 'heaven',   name: 'Celestial Heaven',   preview: 'linear-gradient(135deg,#fafaf8,#c8a96e,#fef9f0)' },
  { id: 'rosewood', name: 'Rose & Ember',       preview: 'linear-gradient(135deg,#0c0912,#c8967a,#e8c9a0)' },
  { id: 'ocean',    name: 'Deep Tide',          preview: 'linear-gradient(135deg,#060d10,#14b8a6,#2dd4bf)' },
  { id: 'forest',   name: 'Enchanted Forest',   preview: 'linear-gradient(135deg,#0f1a14,#52b788,#c8a84e)' },
];

// ── Socket ────────────────────────────────────────────────────────────
const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });

// Re-join rooms on reconnect so messages keep flowing
socket.on('connect', () => {
  if (stealthMode) return; // Don't emit presence in stealth mode
  if (typeof currentUser === 'string' && currentUser) {
    socket.emit('user-online', { user: currentUser });
    // Sync any messages we missed during disconnection
    if (typeof syncMissedMessages === 'function') syncMissedMessages();
  }
});

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  // Check for stealth preview mode (?stealth=username)
  const urlParams = new URLSearchParams(window.location.search);
  const stealthTarget = urlParams.get('stealth')?.toLowerCase();

  const r = await fetch('/api/auth/session');
  const data = await r.json();
  if (!data.authenticated || !data.user) {
    window.location.href = '/';
    return;
  }

  // Stealth mode: view as another user without affecting their presence
  if (stealthTarget && ['kaliph', 'kathrine'].includes(stealthTarget)) {
    stealthMode = true;
    stealthRealUser = data.user;
    currentUser = stealthTarget;
    otherUser = stealthTarget === 'kaliph' ? 'kathrine' : 'kaliph';
    activateStealthBanner(stealthTarget);
  } else {
    currentUser = data.user;
    otherUser   = currentUser === 'kaliph' ? 'kathrine' : 'kaliph';
  }

  const users = await fetch('/api/users').then(r => r.json());
  applyUserData(users[currentUser], users[otherUser]);
  applyTheme(users[currentUser].theme || 'dark');
  buildThemeGrid();
  populateEmojiGrid();
  setupKeyboardShortcuts();
  if (!stealthMode) setupActivityTracking();
  setupSocketEvents();

  // In stealth mode: don't emit presence, don't update anything
  if (!stealthMode) {
    socket.emit('user-online', { user: currentUser });
    setStatusDot('my-status-dot', 'online');
    updateStatusText('online');
  } else {
    // Show the target user's actual status in stealth
    const presence = users[currentUser]?._presence || 'offline';
    setStatusDot('my-status-dot', presence);
    updateStatusText(presence);
  }

  // Load last-read timestamp for unread tracking
  chatLastReadTs = parseInt(localStorage.getItem('chatLastReadTs_' + currentUser) || '0', 10);

  // Init Lucide icons early so UI is always visible
  if (window.lucide) lucide.createIcons();

  await Promise.all([loadMessages(), loadAnnouncements(), loadNotes(), loadContacts(), loadGuestMessages()]).catch(console.error);

  // Count initial unread messages (from other user, after last read time)
  if (chatLastReadTs) {
    unreadCount = allMessages.filter(m =>
      m.sender !== currentUser && m.sender !== 'ai' && m.timestamp > chatLastReadTs
    ).length;
    updateUnreadBadge();
  }
  // Mark as read since chat is the default section (skip in stealth)
  if (currentSection === 'chat' && !stealthMode) clearUnreadBadge();

  checkAndShowAnnouncements();
  if (!stealthMode) requestNotificationPermission();

  // Reveal chat content now that messages are loaded (prevents flash of empty state)
  document.body.classList.add('app-loaded');

  // Show update log if user hasn't dismissed the latest version
  if (!stealthMode) checkAndShowUpdateLog();

  // Set up drag & drop and paste for message input
  setupDragDropPaste();

  // In stealth mode, disable the input area
  if (stealthMode) {
    const msgInput = document.getElementById('msg-input');
    if (msgInput) { msgInput.disabled = true; msgInput.placeholder = 'Stealth mode — read only'; }
    const sendBtn = document.querySelector('.send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '0.3'; sendBtn.style.pointerEvents = 'none'; }
  }
}

// ── Stealth Mode Helpers ──────────────────────────────────────────────
function activateStealthBanner(target) {
  document.getElementById('app').classList.add('stealth-active');
  const banner = document.getElementById('stealth-banner');
  if (banner) banner.style.display = '';
  const nameEl = document.getElementById('stealth-target-name');
  if (nameEl) nameEl.textContent = target.charAt(0).toUpperCase() + target.slice(1);
  const select = document.getElementById('stealth-user-select');
  if (select) select.value = target;
}

function exitStealthMode() {
  window.location.href = '/app';
}

function switchStealthUser(user) {
  window.location.href = '/app?stealth=' + user;
}

function enterStealthFromProfile() {
  const btn = document.getElementById('pv-stealth-btn');
  const target = btn?.getAttribute('data-target');
  if (target) window.location.href = '/app?stealth=' + target;
}

function setupDragDropPaste() {
  const inputArea = document.querySelector('.input-area');
  const msgInput = document.getElementById('msg-input');
  if (!inputArea) return;

  // Drag & drop
  let dragCounter = 0;
  inputArea.addEventListener('dragenter', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter++;
    inputArea.classList.add('drag-over');
  });
  inputArea.addEventListener('dragleave', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; inputArea.classList.remove('drag-over'); }
  });
  inputArea.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  inputArea.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter = 0;
    inputArea.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      if (!window._pendingFiles) window._pendingFiles = [];
      window._pendingFiles.push(...Array.from(files));
      renderFileAttachBar();
    }
  });

  // Paste images/files
  if (msgInput) {
    msgInput.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        e.preventDefault();
        if (!window._pendingFiles) window._pendingFiles = [];
        window._pendingFiles.push(...files);
        renderFileAttachBar();
      }
    });
  }
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

  // Clear unread badge when entering chat
  if (name === 'chat') {
    clearUnreadBadge();
  }

  if (name === 'notes')     loadNotes();
  if (name === 'calendar')  renderCalendar();
  if (name === 'contacts')  loadContacts();
  if (name === 'vault')     { resetVault(); }
  if (name === 'announcements') loadAnnouncements();
  if (name === 'guest-messages') {
    loadGuestMessages();
    // Clear unread for active guest
    if (activeGuestId) { delete guestUnread[activeGuestId]; updateGuestNavBadge(); renderGuestList(); }
  }

  // Close mobile sidebar when navigating on tablet
  if (window.innerWidth <= 834) closeMobileSidebar();
}

// ── Unread Badge System ─────────────────────────────────────────────
function updateUnreadBadge() {
  const badge = document.getElementById('unread-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
  // Also update page title with unread count
  document.title = unreadCount > 0 ? `(${unreadCount}) Royal K&K Vault` : 'Royal K&K Vault';
}

function clearUnreadBadge() {
  unreadCount = 0;
  chatLastReadTs = Date.now();
  if (!stealthMode) localStorage.setItem('chatLastReadTs_' + currentUser, chatLastReadTs);
  updateUnreadBadge();
  // Remove the NEW marker if present
  const marker = document.querySelector('.new-msg-marker');
  if (marker) marker.remove();
}

function toggleSidebar() {
  // On tablet/mobile, toggle the mobile overlay sidebar instead
  if (window.innerWidth <= 834) {
    toggleMobileSidebar();
    return;
  }
  document.getElementById('app').classList.toggle('sidebar-collapsed');
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('show');
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.remove('show');
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
  let newMarkerInserted = false;

  // Find the first unread message from the other user (after our last read time)
  const firstUnreadIdx = chatLastReadTs
    ? msgs.findIndex(m => m.sender !== currentUser && m.sender !== 'ai' && m.timestamp > chatLastReadTs)
    : -1;

  msgs.forEach((msg, idx) => {
    const msgDate = new Date(msg.timestamp).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = formatDate(msg.timestamp);
      area.appendChild(sep);
    }

    // Insert "NEW" marker before the first unread message
    if (!newMarkerInserted && firstUnreadIdx >= 0 && idx === firstUnreadIdx) {
      newMarkerInserted = true;
      const marker = document.createElement('div');
      marker.className = 'new-msg-marker';
      marker.innerHTML = '<span class="new-msg-marker-line"></span><span class="new-msg-marker-badge">NEW</span>';
      area.appendChild(marker);
    }

    area.appendChild(buildMsgElement(msg));
  });

  // If there's a NEW marker, scroll to it instead of the bottom
  const marker = area.querySelector('.new-msg-marker');
  if (marker) {
    marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    area.scrollTop = area.scrollHeight;
  }
}

function buildMsgElement(msg) {
  // Call event system messages
  if (msg.type === 'call-event') {
    const row = document.createElement('div');
    row.className = 'msg-row call-event-row';
    row.id = 'msg-' + msg.id;
    const isMissed = msg.callStatus === 'missed';
    row.innerHTML = `<div class="call-event ${isMissed ? 'missed' : 'ended'}">
      <span class="call-event-text">${msg.text}</span>
      <span class="call-event-time">${formatTime(msg.timestamp)}</span>
    </div>`;
    return row;
  }

  // Pin notice system messages
  if (msg.type === 'pin-notice') {
    const row = document.createElement('div');
    row.className = 'msg-row pin-notice-row';
    row.id = 'msg-' + msg.id;
    const pinnerName = capitalize(msg.pinnedBy || 'someone');
    row.innerHTML = `<div class="pin-notice">
      <span class="pin-notice-icon">📌</span>
      <span class="pin-notice-text"><a href="#" onclick="scrollToMessage('${msg.pinnedMsgId}');return false" class="pin-notice-link">New message pinned</a> by <strong>${escapeHtml(pinnerName)}</strong></span>
    </div>`;
    return row;
  }

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

  // GIF messages — embed as image
  if (msg.type === 'gif' && msg.text) {
    const gifImg = document.createElement('img');
    gifImg.src = msg.text;
    gifImg.className = 'msg-gif';
    gifImg.style.cssText = 'max-width:100%;border-radius:10px;cursor:pointer;display:block';
    gifImg.loading = 'lazy';
    gifImg.onclick = () => openLightbox(msg.text);
    bubble.appendChild(gifImg);
    bubble.style.padding = '4px';
    bubble.style.background = 'transparent';
  }
  // Apply text formatting
  else if (msg.text) {
    let t = msg.text;
    // Convert :emoji_name: shortcodes to actual emoji
    t = convertColonEmojis(t);
    // Extract URLs before HTML-ifying for link previews
    const urlMatches = t.match(/(https?:\/\/[^\s<]+)/g) || [];
    // Auto-detect URLs and make them clickable
    t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;word-break:break-all">$1</a>');
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
    // Rich link previews for URLs
    if (urlMatches.length > 0) {
      urlMatches.slice(0, 2).forEach(url => renderLinkPreview(bubble, url));
    }
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
      wrap.className = 'msg-audio-player';
      const uid = 'aud-' + msg.id + '-' + Math.random().toString(36).slice(2,6);
      wrap.innerHTML = `
        <audio id="${uid}" preload="metadata" src="${file.url}"></audio>
        <button class="audio-play-btn" onclick="toggleAudioPlay('${uid}', this)" title="Play">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="audio-wave-track" onclick="seekAudio(event, '${uid}')">
          <div class="audio-wave-progress" id="${uid}-prog"></div>
        </div>
        <span class="audio-time" id="${uid}-time">0:00</span>
      `;
      bubble.appendChild(wrap);
    } else {
      const fileEl = document.createElement('div');
      fileEl.className = 'msg-file-attachment';
      fileEl.innerHTML = `📄 <span>${file.name}</span>`;
      fileEl.onclick = () => window.open(file.url, '_blank');
      bubble.appendChild(fileEl);
    }
  });

  if (msg.pinned) {
    const pin = document.createElement('div');
    pin.className = 'msg-pinned-indicator';
    pin.innerHTML = '📌 Pinned';
    bubble.insertBefore(pin, bubble.firstChild);
  }

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
  const pinBtn = msg.pinned
    ? `<button class="msg-action-btn" onclick="unpinMessage('${msg.id}')" title="Unpin">📌</button>`
    : `<button class="msg-action-btn" onclick="pinMessage('${msg.id}')" title="Pin">📌</button>`;
  actions.innerHTML = `
    <button class="msg-action-btn react-trigger" onclick="showQuickReact('${msg.id}', this)" title="React">😊</button>
    <button class="msg-action-btn" onclick="setReply('${msg.id}')" title="Reply">↩</button>
    ${pinBtn}
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
  if (stealthMode || isSending) return;
  hideEmojiAutocomplete();
  const input = document.getElementById('msg-input');
  // Convert any :emoji_name: shortcodes to actual emoji before sending
  const text  = convertColonEmojis(input.value.trim());
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

  const savedText = input.value;
  input.value = '';
  resetInputHeight();
  cancelReply();
  document.getElementById('priority-checkbox').checked = false;
  // Reset formatting state after send
  formatting = { bold: false, italic: false, underline: false, font: 'default' };
  input.classList.remove('fmt-bold', 'fmt-italic', 'fmt-underline');
  input.style.fontFamily = '';
  document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
  const fontSel = document.getElementById('font-select');
  if (fontSel) fontSel.value = 'default';
  SoundSystem.send();
  socket.emit('stop-typing', { user: currentUser });

  try {
    const resp = await fetch('/api/messages', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error('Server returned ' + resp.status);
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || 'Send failed');
    // If socket didn't deliver our message yet, add it from the HTTP response
    if (result.message && !allMessages.some(m => m.id === result.message.id)) {
      allMessages.push(result.message);
      const area = document.getElementById('messages-area');
      const empty = document.getElementById('chat-empty');
      if (empty) empty.remove();
      area.appendChild(buildMsgElement(result.message));
      area.scrollTop = area.scrollHeight;
    }
    if (priority && result.emailStatus) {
      if (result.emailStatus === 'sent') {
        showToast('📧 Priority email sent!');
      } else if (result.emailStatus === 'no_recipient') {
        showToast('⚠️ Priority set but no email configured — go to Settings > Email Notifications');
      } else if (result.emailStatus === 'failed') {
        showToast('❌ Priority email failed to send — check email settings');
      }
    }
  } catch (err) {
    console.error('Send error:', err);
    // Restore the text so the user doesn't lose their message
    input.value = savedText;
    showToast('⚠️ Message failed to send — try again');
  } finally {
    isSending = false;
  }
}

function handleFileSelect(input) {
  if (!window._pendingFiles) window._pendingFiles = [];
  window._pendingFiles.push(...Array.from(input.files));
  input.value = '';
  renderFileAttachBar();
}

function removeAttachedFile(idx) {
  if (window._pendingFiles) {
    window._pendingFiles.splice(idx, 1);
    if (!window._pendingFiles.length) window._pendingFiles = null;
  }
  renderFileAttachBar();
}

function renderFileAttachBar() {
  const bar = document.getElementById('file-attach-bar');
  if (!bar) return;
  const files = window._pendingFiles || [];
  if (!files.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  bar.style.display = 'flex';
  bar.innerHTML = files.map((f, i) => {
    const isImage = f.type?.startsWith('image');
    const icon = isImage ? '' : getFileIcon(f.type || '');
    const thumb = isImage ? URL.createObjectURL(f) : '';
    return `<div class="file-chip">
      ${isImage ? `<img src="${thumb}" class="file-chip-thumb">` : `<span class="file-chip-icon">${icon}</span>`}
      <span class="file-chip-name">${f.name.length > 18 ? f.name.slice(0,15) + '…' : f.name}</span>
      <button class="file-chip-x" onclick="removeAttachedFile(${i})">✕</button>
    </div>`;
  }).join('');
}

function getFileIcon(mime) {
  if (mime?.startsWith('image')) return '🖼️';
  if (mime?.startsWith('video')) return '🎬';
  if (mime?.startsWith('audio')) return '🎵';
  if (mime?.includes('pdf')) return '📕';
  if (mime?.includes('word') || mime?.includes('doc')) return '📄';
  if (mime?.includes('zip') || mime?.includes('rar') || mime?.includes('compress')) return '📦';
  return '📎';
}

function clearFilePreview() {
  window._pendingFiles = null;
  const bar = document.getElementById('file-attach-bar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
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
  const pinBtn    = document.getElementById('ctx-pin-btn');

  editBtn.style.display   = msg.sender === currentUser ? '' : 'none';
  unsendBtn.style.display = (msg.sender === currentUser && msg.unsendable) ? '' : 'none';
  // Pin/unpin toggle
  if (pinBtn) {
    pinBtn.textContent = msg.pinned ? '📌 Unpin Message' : '📌 Pin Message';
    pinBtn.onclick = () => { msg.pinned ? ctxUnpin() : ctxPin(); };
  }

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
  closeContextMenu();
  const newText = await showPromptDialog({ value: msg.text, placeholder: 'Edit your message...', okText: 'Save' });
  if (newText !== null && newText.trim() && newText.trim() !== msg.text) {
    await fetch(`/api/messages/${ctxMsgId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText.trim() })
    });
  }
}

async function ctxUnsend() {
  closeContextMenu();
  const ok = await showConfirmDialog({ icon: '🗑️', title: 'Unsend message?', msg: 'This message will be removed for everyone.', okText: 'Unsend' });
  if (!ok) return;
  const r = await fetch(`/api/messages/${ctxMsgId}`, { method: 'DELETE' });
  const d = await r.json();
  if (!d.success) showToast('⚠️ ' + (d.error || 'Cannot unsend'));
}

async function ctxPin() {
  closeContextMenu();
  await pinMessage(ctxMsgId);
}

async function ctxUnpin() {
  closeContextMenu();
  await unpinMessage(ctxMsgId);
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
  bar.innerHTML = ['❤️','😂','👍','😮','😭','🔥','💜','✨'].map(e =>
    `<button onclick="reactToMessage('${msgId}','${e}');this.parentElement.remove()">${e}</button>`
  ).join('') + `<button class="quick-react-add" onclick="openReactionPicker('${msgId}', this)" title="Add Emoji">+</button>`;
  content.appendChild(bar);

  // Auto-close when clicking elsewhere
  const close = (e) => { if (!bar.contains(e.target) && e.target !== btnEl && !e.target.closest('.reaction-emoji-picker')) { bar.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 10);
}

// Full emoji picker for reactions
function openReactionPicker(msgId, btnEl) {
  // Remove any existing reaction picker
  document.querySelectorAll('.reaction-emoji-picker').forEach(el => el.remove());

  const picker = document.createElement('div');
  picker.className = 'reaction-emoji-picker';
  picker.dataset.msgId = msgId;
  picker.innerHTML = `
    <div class="rep-search-wrap"><input class="rep-search" type="text" placeholder="Search emoji..." oninput="filterReactionEmoji(this.value, this)"></div>
    <div class="rep-grid">${EMOJIS.map(e => `<button class="rep-emoji-btn" onclick="pickReactionEmoji('${msgId}','${e}',this)">${e}</button>`).join('')}</div>
  `;

  // Position near the button
  const rect = btnEl.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.left = Math.min(rect.left - 100, window.innerWidth - 310) + 'px';
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  document.body.appendChild(picker);

  // Focus search
  setTimeout(() => picker.querySelector('.rep-search')?.focus(), 50);

  // Auto-close
  const close = (e) => { if (!picker.contains(e.target) && e.target !== btnEl) { picker.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 10);
}

function filterReactionEmoji(q, inputEl) {
  const pickerEl = inputEl.closest('.reaction-emoji-picker');
  const grid = pickerEl?.querySelector('.rep-grid');
  if (!grid) return;
  const msgId = pickerEl?.dataset.msgId || '';
  if (!q) {
    grid.innerHTML = EMOJIS.map(e => `<button class="rep-emoji-btn" onclick="pickReactionEmoji('${msgId}','${e}',this)">${e}</button>`).join('');
    return;
  }
  const lower = q.toLowerCase();
  const filtered = EMOJIS.filter(e =>
    e.includes(q) || (EMOJI_NAMES[e] && EMOJI_NAMES[e].toLowerCase().includes(lower))
  );
  // Also search Discord names
  const discordMatches = Object.entries(DISCORD_EMOJI)
    .filter(([name]) => name.includes(lower))
    .map(([, emoji]) => emoji.trim())
    .filter(e => !filtered.includes(e));
  const all = [...filtered, ...discordMatches].slice(0, 60);
  grid.innerHTML = all.length
    ? all.map(e => `<button class="rep-emoji-btn" onclick="pickReactionEmoji('${msgId}','${e}',this)">${e}</button>`).join('')
    : '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:0.8rem;padding:0.5rem">No emoji found</p>';
}

function pickReactionEmoji(msgId, emoji, btnEl) {
  // Find msgId from the quick react bar if not passed
  if (!msgId) {
    const qr = document.querySelector('.msg-quick-react');
    if (qr) msgId = qr.querySelector('[onclick*="reactToMessage"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  }
  if (msgId) reactToMessage(msgId, emoji);
  // Clean up
  btnEl?.closest('.reaction-emoji-picker')?.remove();
  document.querySelectorAll('.msg-quick-react').forEach(el => el.remove());
}

async function addReaction(emoji) {
  if (currentEmojiReactMsgId) {
    await reactToMessage(currentEmojiReactMsgId, emoji);
    currentEmojiReactMsgId = null;
  }
  document.getElementById('reaction-picker').classList.remove('open');
}

// ── Pinned Messages ──────────────────────────────────────────────────
async function pinMessage(msgId) {
  await fetch(`/api/messages/${msgId}/pin`, { method: 'POST' });
}

async function unpinMessage(msgId) {
  await fetch(`/api/messages/${msgId}/unpin`, { method: 'POST' });
}

function scrollToMessage(msgId) {
  const el = document.getElementById('msg-' + msgId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 2000);
  }
  // Close pinned panel if open
  closePinnedPanel();
}

async function togglePinnedPanel() {
  const panel = document.getElementById('pinned-panel');
  if (pinnedPanelOpen) { closePinnedPanel(); return; }
  pinnedPanelOpen = true;
  panel.classList.add('open');
  // Fetch pinned messages
  const pinned = await fetch('/api/messages/pinned').then(r => r.json());
  const list = document.getElementById('pinned-list');
  if (!pinned.length) {
    list.innerHTML = '<div class="pinned-empty">No pinned messages</div>';
    return;
  }
  list.innerHTML = pinned.map(m => {
    const sender = capitalize(m.sender);
    const senderData = (window._users || {})[m.sender];
    const avatarHtml = senderData?.avatar
      ? `<img src="${senderData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `<span>${(m.sender || 'U')[0].toUpperCase()}</span>`;
    const chatColor = m.sender === 'kaliph' ? 'var(--kaliph-color, #7c3aed)' : 'var(--kathrine-color, #c084fc)';
    const text = (m.text || '').substring(0, 120) || (m.files?.length ? '📎 File' : m.voiceUrl ? '🎙️ Voice message' : '(no text)');
    const time = new Date(m.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `<div class="pinned-item" onclick="scrollToMessage('${m.id}')">
      <div class="pinned-item-header">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="msg-avatar-sm" style="width:24px;height:24px;min-width:24px;font-size:0.6rem;background:${chatColor};display:flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;color:#fff">${avatarHtml}</div>
          <strong>${escapeHtml(sender)}</strong>
        </div>
        <span class="pinned-item-time">${time}</span>
      </div>
      <div class="pinned-item-text">${escapeHtml(text)}</div>
      <button class="pinned-unpin-btn" onclick="event.stopPropagation();unpinMessage('${m.id}')" title="Unpin">✕</button>
    </div>`;
  }).join('');
}

function closePinnedPanel() {
  pinnedPanelOpen = false;
  const panel = document.getElementById('pinned-panel');
  if (panel) panel.classList.remove('open');
}

// ── Text Formatting ───────────────────────────────────────────────────
function applyFormat(type) {
  formatting[type] = !formatting[type];
  document.querySelectorAll('.format-btn').forEach(b => {
    if (b.onclick?.toString().includes(type)) b.classList.toggle('active', formatting[type]);
  });
  // Live preview: apply formatting to textarea visually
  const input = document.getElementById('msg-input');
  if (input) {
    input.classList.toggle('fmt-bold', !!formatting.bold);
    input.classList.toggle('fmt-italic', !!formatting.italic);
    input.classList.toggle('fmt-underline', !!formatting.underline);
  }
}
function setFont(val) {
  formatting.font = val;
  const input = document.getElementById('msg-input');
  if (input) input.style.fontFamily = val === 'default' ? '' : val;
}

// ── Emoji ─────────────────────────────────────────────────────────────
function populateEmojiGrid() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = EMOJIS.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}

// Discord-style emoji shortcode map — :name: → emoji
const DISCORD_EMOJI = {
  // Faces - smileys
  'grinning':'😀','smiley':'😃','smile':'😄','grin':'😁','joy':'😂','rofl':'🤣',
  'sweat_smile':'😅','blush':'😊','innocent':'😇','smiling_face_with_hearts':'🥰',
  'heart_eyes':'😍','star_struck':'🤩','kissing_heart':'😘','kissing':'😗',
  'yum':'😋','stuck_out_tongue':'😛','stuck_out_tongue_winking_eye':'😜',
  'zany_face':'🤪','stuck_out_tongue_closed_eyes':'😝','money_mouth':'🤑',
  'hugging':'🤗','hand_over_mouth':'🤭','shushing_face':'🤫','thinking':'🤔',
  'saluting_face':'🫡','zipper_mouth':'🤐','raised_eyebrow':'🤨','neutral_face':'😐',
  'expressionless':'😑','no_mouth':'😶','dotted_line_face':'🫥','smirk':'😏',
  'unamused':'😒','rolling_eyes':'🙄','grimacing':'😬','face_exhaling':'😮‍💨',
  'lying_face':'🤥','melting_face':'🫠','relieved':'😌','pensive':'😔',
  'sleepy':'😪','drooling_face':'🤤','sleeping':'😴','mask':'😷',
  'face_with_thermometer':'🤒','head_bandage':'🤕','nauseated_face':'🤢',
  'face_vomiting':'🤮','hot_face':'🥵','cold_face':'🥶','woozy_face':'🥴',
  'dizzy_face':'😵','face_with_spiral_eyes':'😵‍💫','exploding_head':'🤯',
  'cowboy':'🤠','partying_face':'🥳','disguised_face':'🥸','sunglasses':'😎',
  'nerd':'🤓','monocle_face':'🧐',
  // Emotional
  'confused':'😕','face_with_diagonal_mouth':'🫤','worried':'😟',
  'slightly_frowning_face':'🙁','frowning':'☹️','open_mouth':'😮',
  'hushed':'😯','astonished':'😲','flushed':'😳','pleading_face':'🥺',
  'face_holding_back_tears':'🥹','frowning_open_mouth':'😦','anguished':'😧',
  'fearful':'😨','cold_sweat':'😰','disappointed_relieved':'😥','cry':'😢',
  'sob':'😭','scream':'😱','confounded':'😖','persevere':'😣',
  'disappointed':'😞','sweat':'😓','weary':'😩','tired_face':'😫',
  'yawning_face':'🥱','triumph':'😤','rage':'😡','cursing_face':'🤬',
  'smiling_imp':'😈','imp':'👿','skull':'💀','skull_crossbones':'☠️',
  'poop':'💩','clown':'🤡','japanese_ogre':'👹','japanese_goblin':'👺',
  'ghost':'👻','alien':'👽','space_invader':'👾','robot':'🤖',
  // Gestures & people
  'wave':'👋','raised_back_of_hand':'🤚','hand_splayed':'🖐️','raised_hand':'✋',
  'vulcan':'🖖','rightwards_hand':'🫱','leftwards_hand':'🫲','ok_hand':'👌',
  'pinched_fingers':'🤌','pinching_hand':'🤏','v':'✌️','crossed_fingers':'🤞',
  'hand_with_index_finger_and_thumb_crossed':'🫰','love_you_gesture':'🤟',
  'metal':'🤘','call_me':'🤙','point_left':'👈','point_right':'👉',
  'point_up_2':'👆','middle_finger':'🖕','point_down':'👇','point_up':'☝️',
  'index_pointing_at_the_viewer':'🫵','thumbsup':' 👍','thumbs_up':'👍','+1':'👍',
  'thumbsdown':'👎','thumbs_down':'👎','-1':'👎','fist':'✊','punch':'👊',
  'left_facing_fist':'🤛','right_facing_fist':'🤜','clap':'👏',
  'raised_hands':'🙌','heart_hands':'🫶','open_hands':'👐','palms_up':'🤲',
  'handshake':'🤝','pray':'🙏','writing_hand':'✍️','nail_care':'💅',
  'selfie':'🤳','muscle':'💪','flexed_biceps':'💪',
  // Hearts & love
  'heart':'❤️','red_heart':'❤️','orange_heart':'🧡','yellow_heart':'💛',
  'green_heart':'💚','blue_heart':'💙','purple_heart':'💜','black_heart':'🖤',
  'white_heart':'🤍','brown_heart':'🤎','broken_heart':'💔','heart_on_fire':'❤️‍🔥',
  'mending_heart':'❤️‍🩹','heart_exclamation':'❣️','two_hearts':'💕',
  'revolving_hearts':'💞','heartbeat':'💓','heartpulse':'💗','sparkling_heart':'💖',
  'cupid':'💘','gift_heart':'💝',
  // Symbols & nature
  'sparkles':'✨','star':'⭐','star2':'🌟','dizzy':'💫','fire':'🔥','boom':'💥',
  'rainbow':'🌈','sunny':'☀️','crescent_moon':'🌙','zap':'⚡','snowflake':'❄️',
  'ocean':'🌊','cherry_blossom':'🌸','hibiscus':'🌺','four_leaf_clover':'🍀',
  'butterfly':'🦋','rose':'🌹','musical_note':'🎵','notes':'🎶','microphone':'🎤',
  'headphones':'🎧',
  // Objects
  'crown':'👑','gem':'💎','crystal_ball':'🔮','dart':'🎯','bulb':'💡','brain':'🧠',
  'rocket':'🚀','trophy':'🏆','tada':'🎉','confetti_ball':'🎊','gift':'🎁',
  'ribbon':'🎀','reminder_ribbon':'🎗️','medal':'🏅','first_place':'🥇',
  'moneybag':'💰','money_with_wings':'💸','iphone':'📱','computer':'💻',
  'watch':'⌚','camera':'📷','bell':'🔔','no_bell':'🔕','pushpin':'📌',
  'round_pushpin':'📍','white_check_mark':'✅','x':'❌','o':'⭕','100':'💯',
  // Food & drink
  'pizza':'🍕','hamburger':'🍔','fries':'🍟','hotdog':'🌭','taco':'🌮',
  'burrito':'🌯','ice_cream':'🍦','doughnut':'🍩','cookie':'🍪','cake':'🎂',
  'coffee':'☕','tea':'🍵','beer':'🍺','wine_glass':'🍷','cocktail':'🍸',
  // Animals
  'dog':'🐶','cat':'🐱','mouse':'🐭','hamster':'🐹','rabbit':'🐰',
  'fox':'🦊','bear':'🐻','panda_face':'🐼','koala':'🐨','lion_face':'🦁',
  'cow':'🐮','pig':'🐷','frog':'🐸','monkey_face':'🐵','chicken':'🐔',
  'penguin':'🐧','bird':'🐦','eagle':'🦅','owl':'🦉','bat':'🦇',
  'wolf':'🐺','horse':'🐴','unicorn':'🦄','bee':'🐝','snake':'🐍',
  'turtle':'🐢','octopus':'🐙','shark':'🦈','whale':'🐳','dolphin':'🐬',
  // Misc
  'eyes':'👀','eye':'👁️','tongue':'👅','lips':'👄','kiss':'💋',
  'droplet':'💧','sweat_drops':'💦','dash':'💨','zzz':'💤',
  'speech_balloon':'💬','thought_balloon':'💭','anger':'💢',
  'no_entry':'⛔','warning':'⚠️','radioactive':'☢️','biohazard':'☣️',
  'heavy_plus_sign':'➕','heavy_minus_sign':'➖','question':'❓','exclamation':'❗',
  'interrobang':'⁉️','wavy_dash':'〰️','recycle':'♻️','infinity':'♾️',
  'peace':'☮️','yin_yang':'☯️','beginner':'🔰','trident':'🔱',
  'flag_white':'🏳️','flag_black':'🏴','rainbow_flag':'🏳️‍🌈',
  'pirate_flag':'🏴‍☠️','triangular_flag':'🚩','checkered_flag':'🏁',
  'crossed_flags':'🎌',
};

// Build reverse lookup: emoji → discord name
const EMOJI_TO_NAME = {};
Object.entries(DISCORD_EMOJI).forEach(([name, emoji]) => {
  const e = emoji.trim();
  if (!EMOJI_TO_NAME[e]) EMOJI_TO_NAME[e] = name;
});

// Legacy EMOJI_NAMES for search (maps emoji → search keywords)
const EMOJI_NAMES = {};
Object.entries(DISCORD_EMOJI).forEach(([name, emoji]) => {
  const e = emoji.trim();
  const existing = EMOJI_NAMES[e] || '';
  EMOJI_NAMES[e] = existing ? existing + ' ' + name.replace(/_/g, ' ') : name.replace(/_/g, ' ');
});

function filterEmoji(q) {
  const grid = document.getElementById('emoji-grid');
  if (!q) {
    grid.innerHTML = EMOJIS.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('');
    return;
  }
  const lower = q.toLowerCase();
  // Search by emoji character match OR by name
  const filtered = EMOJIS.filter(e =>
    e.includes(q) || (EMOJI_NAMES[e] && EMOJI_NAMES[e].toLowerCase().includes(lower))
  );
  grid.innerHTML = filtered.length
    ? filtered.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('')
    : '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:0.8rem;padding:1rem">No emoji found</p>';
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

// ── Emoji Autocomplete (Discord-style :name: ) ───────────────────────
let emojiACOpen = false, emojiACIndex = 0, emojiACResults = [];

function getEmojiColonQuery(input) {
  const val = input.value, pos = input.selectionStart;
  // Walk backwards from cursor to find ':'
  let i = pos - 1;
  while (i >= 0 && val[i] !== ':' && val[i] !== ' ' && val[i] !== '\n') i--;
  if (i < 0 || val[i] !== ':') return null;
  // Don't match if there's a closing : already (completed emoji)
  const query = val.slice(i + 1, pos);
  if (query.length < 2) return null;
  return { start: i, end: pos, query: query.toLowerCase() };
}

function showEmojiAutocomplete(input) {
  const match = getEmojiColonQuery(input);
  const panel = document.getElementById('emoji-autocomplete');
  if (!match) { hideEmojiAutocomplete(); return; }

  const q = match.query;
  emojiACResults = Object.entries(DISCORD_EMOJI)
    .filter(([name]) => name.includes(q))
    .slice(0, 8)
    .map(([name, emoji]) => ({ name, emoji: emoji.trim() }));

  if (!emojiACResults.length) { hideEmojiAutocomplete(); return; }

  emojiACOpen = true;
  emojiACIndex = 0;
  panel.innerHTML = emojiACResults.map((r, i) =>
    `<div class="emoji-ac-item ${i === 0 ? 'selected' : ''}" data-idx="${i}" onmousedown="selectEmojiAC(${i})" onmouseenter="hoverEmojiAC(${i})">
      <span class="emoji-ac-emoji">${r.emoji}</span>
      <span class="emoji-ac-name">:${r.name}:</span>
    </div>`
  ).join('');
  panel.style.display = 'block';

  // Position above input
  const rect = input.getBoundingClientRect();
  panel.style.left = rect.left + 'px';
  panel.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
}

function hideEmojiAutocomplete() {
  emojiACOpen = false;
  emojiACResults = [];
  const panel = document.getElementById('emoji-autocomplete');
  if (panel) panel.style.display = 'none';
}

function hoverEmojiAC(idx) {
  emojiACIndex = idx;
  document.querySelectorAll('.emoji-ac-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
}

function selectEmojiAC(idx) {
  const input = document.getElementById('msg-input');
  const match = getEmojiColonQuery(input);
  if (!match || !emojiACResults[idx]) return;
  const r = emojiACResults[idx];
  input.value = input.value.slice(0, match.start) + r.emoji + input.value.slice(match.end);
  input.selectionStart = input.selectionEnd = match.start + r.emoji.length;
  input.focus();
  hideEmojiAutocomplete();
}

function handleEmojiACKeydown(e) {
  if (!emojiACOpen) return false;
  if (e.key === 'ArrowDown') { e.preventDefault(); emojiACIndex = (emojiACIndex + 1) % emojiACResults.length; hoverEmojiAC(emojiACIndex); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); emojiACIndex = (emojiACIndex - 1 + emojiACResults.length) % emojiACResults.length; hoverEmojiAC(emojiACIndex); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectEmojiAC(emojiACIndex); return true; }
  if (e.key === 'Escape') { hideEmojiAutocomplete(); return true; }
  return false;
}

// Auto-convert completed :emoji_name: patterns in text
function convertColonEmojis(text) {
  return text.replace(/:([a-z0-9_+-]+):/gi, (match, name) => {
    const emoji = DISCORD_EMOJI[name.toLowerCase()];
    return emoji ? emoji.trim() : match;
  });
}

// ── Link Previews ─────────────────────────────────────────────────────
const linkPreviewCache = {};

async function fetchLinkPreview(url) {
  if (linkPreviewCache[url]) return linkPreviewCache[url];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch('/api/link-preview?url=' + encodeURIComponent(url), { signal: controller.signal });
    clearTimeout(timeout);
    const data = await resp.json();
    if (data.error) return null;
    linkPreviewCache[url] = data;
    return data;
  } catch { return null; }
}

function renderLinkPreview(bubble, url) {
  // Don't preview GIF urls, image urls, or internal links
  if (/\.(gif|png|jpg|jpeg|webp|svg|mp4|webm)(\?.*)?$/i.test(url)) return;
  if (url.includes('/uploads/')) return;

  fetchLinkPreview(url).then(data => {
    if (!data || (!data.title && !data.description && !data.image)) return;
    const card = document.createElement('a');
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.className = 'link-preview-card';
    card.onclick = (e) => e.stopPropagation();

    let html = '';
    if (data.image) {
      html += `<div class="lp-image"><img src="${escapeHtml(data.image)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>`;
    }
    html += `<div class="lp-body">`;
    if (data.siteName) html += `<div class="lp-site">${escapeHtml(data.siteName)}</div>`;
    if (data.title) html += `<div class="lp-title">${escapeHtml(data.title)}</div>`;
    if (data.description) {
      const desc = data.description.length > 150 ? data.description.slice(0, 150) + '…' : data.description;
      html += `<div class="lp-desc">${escapeHtml(desc)}</div>`;
    }
    html += `</div>`;
    card.innerHTML = html;
    bubble.appendChild(card);
  });
}

// ── Custom Audio Player ───────────────────────────────────────────────
function toggleAudioPlay(uid, btn) {
  const audio = document.getElementById(uid);
  if (!audio) return;
  if (audio.paused) {
    // Pause any other playing audio
    document.querySelectorAll('.msg-audio-player audio').forEach(a => { if (a.id !== uid && !a.paused) a.pause(); });
    audio.play();
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
    audio.ontimeupdate = () => {
      const pct = (audio.currentTime / audio.duration) * 100;
      const prog = document.getElementById(uid + '-prog');
      if (prog) prog.style.width = pct + '%';
      const timeEl = document.getElementById(uid + '-time');
      if (timeEl) timeEl.textContent = fmtAudioTime(audio.currentTime);
    };
    audio.onended = () => {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      const prog = document.getElementById(uid + '-prog');
      if (prog) prog.style.width = '0%';
      const timeEl = document.getElementById(uid + '-time');
      if (timeEl && audio.duration) timeEl.textContent = fmtAudioTime(audio.duration);
    };
  } else {
    audio.pause();
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }
}

function seekAudio(e, uid) {
  const audio = document.getElementById(uid);
  if (!audio || !audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
}

function fmtAudioTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── GIF Search ────────────────────────────────────────────────────────
function openGifSearch() {
  openModal('gif-modal');
  const grid = document.getElementById('gif-grid');
  const input = document.getElementById('gif-search-input');
  if (input) input.value = '';
  // Load trending GIFs on open
  loadTrendingGifs();
}

let gifTimeout = null;
async function loadTrendingGifs() {
  const grid = document.getElementById('gif-grid');
  grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Loading…</p>';
  try {
    const r = await fetch('/api/gif-trending');
    const d = await r.json();
    renderGifResults(d.results || []);
  } catch {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Could not load GIFs</p>';
  }
}

function searchGifs(q) {
  clearTimeout(gifTimeout);
  if (!q.trim()) { loadTrendingGifs(); return; }
  gifTimeout = setTimeout(async () => {
    const grid = document.getElementById('gif-grid');
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Searching…</p>';
    try {
      const r = await fetch(`/api/gif-search?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      renderGifResults(d.results || []);
    } catch {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">GIF search failed</p>';
    }
  }, 400);
}

function renderGifResults(results) {
  const grid = document.getElementById('gif-grid');
  if (!results.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No GIFs found</p>';
    return;
  }
  grid.innerHTML = results.map(g =>
    `<img src="${g.preview || g.url}" data-full="${g.url}" style="width:100%;border-radius:8px;cursor:pointer;aspect-ratio:${g.width || 200}/${g.height || 200};object-fit:cover" onclick="sendGif('${g.url}')" loading="lazy">`
  ).join('');
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
    // Skip if we already have this message (e.g. added from HTTP response)
    if (allMessages.some(m => m.id === msg.id)) return;
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
      // Track unread & show popup when chat isn't active
      if (currentSection !== 'chat') {
        unreadCount++;
        updateUnreadBadge();
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

  socket.on('msg-edit-cleared', ({ id }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) { msg.edited = false; msg.editedAt = null; }
    const el = document.getElementById('msg-' + id);
    if (el) {
      const ed = el.querySelector('.msg-edited');
      if (ed) ed.remove();
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

  // Pinned messages
  socket.on('msg-pinned', ({ id, pinnedBy, pinnedAt }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) { msg.pinned = true; msg.pinnedBy = pinnedBy; msg.pinnedAt = pinnedAt; }
    const el = document.getElementById('msg-' + id);
    if (el) {
      const bubble = el.querySelector('.msg-bubble');
      if (bubble && !bubble.querySelector('.msg-pinned-indicator')) {
        const pin = document.createElement('div');
        pin.className = 'msg-pinned-indicator';
        pin.innerHTML = '📌 Pinned';
        bubble.insertBefore(pin, bubble.firstChild);
      }
    }
  });

  socket.on('msg-unpinned', ({ id }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) { msg.pinned = false; delete msg.pinnedBy; delete msg.pinnedAt; }
    const el = document.getElementById('msg-' + id);
    if (el) {
      const pin = el.querySelector('.msg-pinned-indicator');
      if (pin) pin.remove();
    }
    // Refresh pinned panel if open
    if (pinnedPanelOpen) togglePinnedPanel();
  });

  // Eval granted unsend permission (bypasses time limit)
  socket.on('msg-unsend-allowed', ({ id }) => {
    const msg = allMessages.find(m => m.id === id);
    if (msg) {
      msg.unsendable = true;
      // Show unsend button if it's the current user's message
      if (msg.sender === currentUser) {
        const btn = document.querySelector(`.msg-unsend-btn[data-msg-id="${id}"]`);
        if (btn) btn.style.display = '';
      }
    }
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
    if (stealthMode) return; // Don't send heartbeats in stealth mode
    if (!_isAutoIdle) socket.emit('heartbeat', { user: currentUser });
  }, 60000);

  socket.on('user-updated', ({ user, data }) => {
    if (user === currentUser) {
      if (data.theme) applyTheme(data.theme);
      if (data.displayName) {
        const el = document.getElementById('my-display-name');
        if (el) el.textContent = data.displayName;
      }
    }
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

  socket.on('messages-cleared', () => {
    allMessages = [];
    renderMessages();
    showToast('Chat history has been erased.');
  });

  socket.on('messages-updated', () => {
    loadMessages();
  });

  socket.on('calendar-updated', () => {
    if (currentSection === 'calendar') renderCalendar();
  });

  socket.on('show-update-log', ({ target }) => {
    if (target === 'both' || target === currentUser) {
      localStorage.removeItem('rkk-changelog-dismissed-' + currentUser);
      checkAndShowUpdateLog();
    }
  });

  socket.on('show-custom-update-log', ({ target, message }) => {
    if (target === 'both' || target === currentUser) {
      const container = document.getElementById('update-log-content');
      container.innerHTML = `<div style="font-size:0.85rem;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</div>`;
      openModal('update-log-modal');
    }
  });

  socket.on('force-reload', () => {
    window.location.reload();
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
  socket.on('call-camera-toggle', ({ user, cameraOn }) => {
    if (!inCall || user === currentUser) return;
    const remoteVid = document.getElementById('call-video-remote');
    const remoteBg = document.getElementById('call-remote-avatar-bg');
    if (cameraOn) {
      remoteVid.style.display = 'block';
      remoteBg.style.display = 'none';
    } else {
      remoteVid.style.display = 'none';
      remoteBg.style.display = 'flex';
    }
  });
}

async function markMessageRead(msgId) {
  if (stealthMode) return; // Don't mark messages as read in stealth mode
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
  const ok = await showConfirmDialog({ icon: '💡', title: 'Clear brainstorm board?', msg: 'Messages are still saved on the server.', okText: 'Clear', danger: false });
  if (!ok) return;
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
    const doneCount = (note.todos||[]).filter(t => t.done).length;
    const totalCount = (note.todos||[]).length;
    const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
    editor.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:8px">
        <input type="text" id="edit-note-title" value="${note.title}" style="font-size:1.1rem;font-weight:700;flex:1" ${isOwn?'':'readonly'}>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${isOwn ? `
            <button class="btn-ghost" onclick="shareNote('${id}')" title="${note.sharedWith?.includes(otherUser) ? 'Unshare' : 'Share'}"><i data-lucide="link"></i> Share</button>
            <button class="btn-ghost" onclick="archiveNote('${id}')" title="${note.archived ? 'Unarchive' : 'Archive'}"><i data-lucide="archive"></i> Archive</button>
            <button class="btn-danger" onclick="deleteNote('${id}')" title="Delete"><i data-lucide="trash-2"></i></button>
          ` : ''}
        </div>
      </div>
      ${totalCount ? `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:0.72rem;color:var(--text-muted)">${doneCount} of ${totalCount} complete</span>
          <span style="font-size:0.72rem;font-weight:600;color:var(--accent)">${pct}%</span>
        </div>
        <div style="height:4px;border-radius:2px;background:var(--border);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px;transition:width 0.3s"></div>
        </div>
      </div>` : ''}
      <div id="todo-list-editor">
        ${(note.todos||[]).map((item, i) => `
          <div class="todo-item ${item.done ? 'done' : ''}" onclick="toggleTodoItem('${id}',${i},${!item.done})">
            <div class="todo-check">
              <span class="todo-check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>
            </div>
            <span class="todo-item-text">${item.text}</span>
            ${isOwn ? `<button class="todo-item-del" onclick="event.stopPropagation();removeTodoItem('${id}',${i})" title="Remove">✕</button>` : ''}
          </div>`).join('')}
        ${isOwn ? `<div style="margin-top:8px;display:flex;gap:6px">
          <input type="text" id="new-todo-item" placeholder="Add a task…" style="flex:1" onkeydown="if(event.key==='Enter'){addTodoItemToNote('${id}');event.preventDefault()}">
          <button class="btn-primary" onclick="addTodoItemToNote('${id}')" style="border-radius:10px;padding:8px 16px">Add</button>
        </div>` : ''}
      </div>
      ${isOwn ? '<button class="btn-primary" onclick="saveCurrentNote()" style="margin-top:1rem;width:100%;border-radius:10px">Save Changes</button>' : ''}`;
    if (window.lucide) lucide.createIcons();
  } else {
    editor.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:8px">
        <input type="text" id="edit-note-title" value="${note.title}" style="font-size:1.1rem;font-weight:700;flex:1" ${isOwn?'':'readonly'}>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${isOwn ? `
            <button class="btn-ghost" onclick="shareNote('${id}')" title="${note.sharedWith?.includes(otherUser) ? 'Unshare' : 'Share'}"><i data-lucide="link"></i> Share</button>
            <button class="btn-ghost" onclick="archiveNote('${id}')" title="${note.archived ? 'Unarchive' : 'Archive'}"><i data-lucide="archive"></i> Archive</button>
            <button class="btn-danger" onclick="deleteNote('${id}')" title="Delete"><i data-lucide="trash-2"></i></button>
          ` : ''}
        </div>
      </div>
      <textarea id="edit-note-content" rows="20" style="width:100%;border-radius:10px;line-height:1.75" ${isOwn?'':'readonly'}>${note.content||''}</textarea>
      ${isOwn ? '<button class="btn-primary" onclick="saveCurrentNote()" style="margin-top:1rem;width:100%;border-radius:10px">Save Changes</button>' : ''}`;
    if (window.lucide) lucide.createIcons();
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
  openNote(noteId); // Re-render to update progress bar + checkbox state
}

async function removeTodoItem(noteId, idx) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note) return;
  note.todos.splice(idx, 1);
  await fetch(`/api/notes/${noteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos: note.todos })
  });
  openNote(noteId);
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
  const ok = await showConfirmDialog({ icon: '📝', title: 'Delete note?', msg: 'This note will be permanently removed.', okText: 'Delete' });
  if (!ok) return;
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  await loadNotes();
  activeNoteId = null;
  document.getElementById('notes-editor').innerHTML = '<div class="empty-state"><div class="empty-state-text">Select a note</div></div>';
}

// ── Calendar ──────────────────────────────────────────────────────────
function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }

async function renderCalendar() {
  const label = document.getElementById('cal-month-label');
  label.textContent = new Date(calYear, calMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
  const events = calData.shared || [];

  const grid = document.getElementById('cal-grid');
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  // Build day cells
  const dayCells = {};
  for (let i = 0; i < firstDay; i++) {
    const d = document.createElement('div');
    d.className = 'cal-day cal-day-empty';
    grid.appendChild(d);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()) cell.classList.add('today');
    cell.innerHTML = `<div class="cal-day-num">${d}</div>`;
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cell.dataset.date = dateStr;
    dayCells[dateStr] = cell;
    cell.ondblclick = () => { openEventModalForDate(dateStr); };
    grid.appendChild(cell);
  }

  // Render events
  events.forEach(ev => {
    const evStart = ev.start || ev.date;
    const evEnd = ev.end || evStart;
    if (!evStart) return;

    // Single-day event or multi-day?
    if (evStart === evEnd) {
      // Single-day: render as pill in that cell
      const cell = dayCells[evStart];
      if (cell) {
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
      }
    } else {
      // Multi-day: render spanning bars per week row
      const startD = new Date(evStart + 'T00:00:00');
      const endD = new Date(evEnd + 'T00:00:00');
      const monthStart = new Date(calYear, calMonth, 1);
      const monthEnd = new Date(calYear, calMonth, daysInMonth);

      // Clamp to visible month
      const visStart = startD < monthStart ? monthStart : startD;
      const visEnd = endD > monthEnd ? monthEnd : endD;

      // Iterate day by day, grouping into week rows
      let current = new Date(visStart);
      let rowStart = new Date(current);

      while (current <= visEnd) {
        const dayOfWeek = current.getDay();
        const isRowEnd = dayOfWeek === 6 || current.getTime() === visEnd.getTime();

        if (isRowEnd) {
          // Render bar from rowStart to current
          const barStartStr = fmtDate(rowStart);
          const barEndStr = fmtDate(current);
          const startCell = dayCells[barStartStr];

          if (startCell) {
            const isEventStart = rowStart.getTime() === startD.getTime();
            const isEventEnd = current.getTime() === endD.getTime();
            const spanDays = Math.round((current - rowStart) / 86400000) + 1;

            const bar = document.createElement('div');
            bar.className = 'cal-event-bar';
            if (isEventStart && isEventEnd) bar.classList.add('cal-bar-single');
            else if (isEventStart) bar.classList.add('cal-bar-start');
            else if (isEventEnd) bar.classList.add('cal-bar-end');
            else bar.classList.add('cal-bar-mid');

            bar.style.background = ev.color || 'var(--accent)';
            bar.title = `${ev.title}${ev.description ? ' — ' + ev.description : ''}`;
            // Span across cells using calc
            bar.style.width = `calc(${spanDays * 100}% + ${(spanDays - 1) * 1}px)`;

            const titleSpan = document.createElement('span');
            titleSpan.className = 'cal-bar-title';
            titleSpan.textContent = isEventStart || rowStart.getDate() === 1 ? ev.title : '';
            bar.appendChild(titleSpan);

            // Delete button only on first segment
            if (isEventStart) {
              const delBtn = document.createElement('button');
              delBtn.className = 'cal-event-del';
              delBtn.textContent = '✕';
              delBtn.title = 'Delete event';
              delBtn.onclick = (e) => { e.stopPropagation(); deleteCalEvent(ev.id); };
              bar.appendChild(delBtn);
            }

            startCell.appendChild(bar);
          }

          // Start new row segment
          const next = new Date(current);
          next.setDate(next.getDate() + 1);
          rowStart = new Date(next);
        }

        current.setDate(current.getDate() + 1);
      }
    }
  });
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Event Date Picker ──
let edpYear, edpMonth, edpSelectStart = null, edpSelectEnd = null, edpPickerOpen = false;

function openEventModalForDate(dateStr) {
  edpSelectStart = dateStr;
  edpSelectEnd = dateStr;
  document.getElementById('event-start-date').value = dateStr;
  document.getElementById('event-end-date').value = dateStr;
  updateEventDateDisplay();
  const d = new Date(dateStr + 'T00:00:00');
  edpYear = d.getFullYear();
  edpMonth = d.getMonth();
  openModal('new-event-modal');
  // Auto-open the date picker
  document.getElementById('event-date-picker').style.display = '';
  edpPickerOpen = true;
  renderEdpGrid();
}

function toggleEventDatePicker() {
  const picker = document.getElementById('event-date-picker');
  edpPickerOpen = !edpPickerOpen;
  picker.style.display = edpPickerOpen ? '' : 'none';
  if (edpPickerOpen) {
    const today = new Date();
    if (!edpYear) { edpYear = today.getFullYear(); edpMonth = today.getMonth(); }
    renderEdpGrid();
  }
}

function edpPrev() { edpMonth--; if (edpMonth < 0) { edpMonth = 11; edpYear--; } renderEdpGrid(); }
function edpNext() { edpMonth++; if (edpMonth > 11) { edpMonth = 0; edpYear++; } renderEdpGrid(); }

function renderEdpGrid() {
  document.getElementById('edp-month-label').textContent =
    new Date(edpYear, edpMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const grid = document.getElementById('edp-grid');
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(edpYear, edpMonth, 1).getDay();
  const daysInMonth = new Date(edpYear, edpMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'edp-day edp-day-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'edp-day';
    const dateStr = `${edpYear}-${String(edpMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    if (d === today.getDate() && edpMonth === today.getMonth() && edpYear === today.getFullYear()) {
      cell.classList.add('edp-today');
    }

    // Highlight selection range
    if (edpSelectStart && edpSelectEnd) {
      const s = edpSelectStart <= edpSelectEnd ? edpSelectStart : edpSelectEnd;
      const e = edpSelectStart <= edpSelectEnd ? edpSelectEnd : edpSelectStart;
      if (dateStr === s && dateStr === e) cell.classList.add('edp-selected-single');
      else if (dateStr === s) cell.classList.add('edp-range-start');
      else if (dateStr === e) cell.classList.add('edp-range-end');
      else if (dateStr > s && dateStr < e) cell.classList.add('edp-range-mid');
    } else if (edpSelectStart && dateStr === edpSelectStart) {
      cell.classList.add('edp-selected-single');
    }

    cell.textContent = d;
    cell.onclick = () => edpSelectDate(dateStr);
    grid.appendChild(cell);
  }
}

function edpSelectDate(dateStr) {
  if (!edpSelectStart || edpSelectEnd) {
    // First click or reset: set start
    edpSelectStart = dateStr;
    edpSelectEnd = null;
  } else {
    // Second click: set end (auto-sort)
    if (dateStr === edpSelectStart) {
      edpSelectEnd = dateStr; // same day = single day
    } else if (dateStr < edpSelectStart) {
      edpSelectEnd = edpSelectStart;
      edpSelectStart = dateStr;
    } else {
      edpSelectEnd = dateStr;
    }
  }
  document.getElementById('event-start-date').value = edpSelectStart;
  document.getElementById('event-end-date').value = edpSelectEnd || edpSelectStart;
  updateEventDateDisplay();
  renderEdpGrid();
}

function updateEventDateDisplay() {
  const display = document.getElementById('event-date-display');
  const start = edpSelectStart;
  const end = edpSelectEnd || edpSelectStart;
  if (!start) { display.textContent = 'Select date(s)...'; return; }

  const fmt = (ds) => {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (start === end || !end) {
    display.textContent = fmt(start);
  } else {
    display.textContent = `${fmt(start)} – ${fmt(end)}`;
  }
  display.classList.add('has-value');
}

async function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  const start = document.getElementById('event-start-date').value;
  const end = document.getElementById('event-end-date').value || start;
  if (!title) return showToast('Event title required');
  if (!start) return showToast('Date required');
  await fetch('/api/calendar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      start,
      end,
      description: document.getElementById('event-desc').value,
      color: document.getElementById('event-color').value,
    })
  });
  // Reset form
  document.getElementById('event-title').value = '';
  document.getElementById('event-start-date').value = '';
  document.getElementById('event-end-date').value = '';
  document.getElementById('event-desc').value = '';
  document.getElementById('event-date-display').textContent = 'Select date(s)...';
  document.getElementById('event-date-display').classList.remove('has-value');
  edpSelectStart = null; edpSelectEnd = null; edpPickerOpen = false;
  document.getElementById('event-date-picker').style.display = 'none';
  closeModal('new-event-modal');
  renderCalendar();
  showToast('Event saved!');
}

async function deleteCalEvent(eventId) {
  await fetch(`/api/calendar/${eventId}`, { method: 'DELETE' });
  renderCalendar();
  showToast('Event deleted');
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
    const mime = item.mimeType || '';
    // Show thumbnail preview for images/videos
    let thumbHtml;
    if (mime.startsWith('image')) {
      thumbHtml = `<div class="vault-item-thumb"><img src="${item.url}" alt="" loading="lazy"></div>`;
    } else if (mime.startsWith('video')) {
      thumbHtml = `<div class="vault-item-thumb"><video src="${item.url}" muted preload="metadata"></video></div>`;
    } else {
      thumbHtml = `<div class="vault-item-icon">${icon}</div>`;
    }
    const escapedName = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const escapedUrl = (item.url || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const clickAction = item.type === 'link'
      ? `window.open('${escapedUrl}','_blank')`
      : `openVaultPreview('${escapedUrl}','${escapedName}','${mime}')`;
    return `
      <div class="vault-item" onclick="${clickAction}">
        ${thumbHtml}
        <div class="vault-item-name">${item.name}</div>
        <div class="vault-item-meta">${formatDate(item.uploadedAt)}</div>
        ${vaultTab === 'mine' ? `<button class="vault-del-btn" onclick="event.stopPropagation();deleteVaultItem('${item.id}')">✕</button>` : ''}
      </div>`;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openVaultPreview(url, name, mime) {
  const body = document.getElementById('vault-preview-body');
  const titleEl = document.getElementById('vault-preview-name');
  const openBtn = document.getElementById('vault-preview-open');
  const dlBtn = document.getElementById('vault-preview-download');
  titleEl.textContent = name || 'File';
  openBtn.onclick = () => window.open(url, '_blank');
  dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url; a.download = name || 'file'; a.click();
  };

  let content = '';
  if (mime.startsWith('image')) {
    content = `<img src="${url}" alt="${name}">`;
  } else if (mime.startsWith('video')) {
    content = `<video src="${url}" controls autoplay style="max-width:100%;max-height:70vh;border-radius:8px"></video>`;
  } else if (mime.startsWith('audio')) {
    content = `<audio src="${url}" controls autoplay></audio>`;
  } else if (mime.includes('pdf')) {
    content = `<iframe src="${url}"></iframe>`;
  } else {
    const icon = getFileIcon(mime);
    content = `<div class="file-preview-placeholder">
      <div class="file-icon">${icon}</div>
      <div class="file-name">${name}</div>
      <div class="file-hint">No preview available — click the button above to open or download</div>
    </div>`;
  }
  body.innerHTML = content;
  openModal('vault-preview-modal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
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
  const ok = await showConfirmDialog({ icon: '🔒', title: 'Remove from vault?', msg: 'This file will be permanently removed.', okText: 'Remove' });
  if (!ok) return;
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
let allContactsCache = [];

async function loadContacts() {
  try {
    allContactsCache = await fetch('/api/contacts').then(r => r.json());
    if (!Array.isArray(allContactsCache)) allContactsCache = [];
    renderContactsList(allContactsCache);
  } catch (err) {
    console.error('Failed to load contacts:', err);
  }
}

function filterContacts(q) {
  const lower = q.toLowerCase();
  const filtered = lower
    ? allContactsCache.filter(c =>
        (c.name||'').toLowerCase().includes(lower) ||
        (c.phone||'').includes(lower) ||
        (c.email||'').toLowerCase().includes(lower))
    : allContactsCache;
  renderContactsList(filtered);
}

function renderContactsList(contacts) {
  const grid = document.getElementById('contacts-grid');
  if (!contacts.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📇</div><div class="empty-state-text">No contacts found</div></div>';
    return;
  }

  // Sort
  const sortBy = document.getElementById('contacts-sort')?.value || 'name-asc';
  const sorted = [...contacts].sort((a, b) => {
    if (sortBy === 'name-asc') return (a.name||'').localeCompare(b.name||'');
    if (sortBy === 'name-desc') return (b.name||'').localeCompare(a.name||'');
    if (sortBy === 'newest') return (b.createdAt||0) - (a.createdAt||0);
    if (sortBy === 'oldest') return (a.createdAt||0) - (b.createdAt||0);
    return 0;
  });

  // Group by first letter for alphabetical sorting
  let html = '';
  if (sortBy === 'name-asc' || sortBy === 'name-desc') {
    let currentLetter = '';
    sorted.forEach(c => {
      const letter = (c.name||'?')[0].toUpperCase();
      if (letter !== currentLetter) {
        currentLetter = letter;
        html += `<div class="contact-group-letter">${letter}</div>`;
      }
      html += renderContactCard(c);
    });
  } else {
    sorted.forEach(c => { html += renderContactCard(c); });
  }

  grid.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function renderContactCard(c) {
  const avatar = c.photo ? `<img src="${c.photo}">` : (c.name ? c.name[0].toUpperCase() : '?');
  return `
    <div class="contact-card" onclick="viewContact('${c.id}')">
      <div class="contact-avatar">${avatar}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name || 'Unknown'}</div>
        ${c.phone ? `<div class="contact-detail">${c.phone}</div>` : ''}
      </div>
      <i data-lucide="chevron-right" style="width:16px;height:16px;opacity:0.3;flex-shrink:0"></i>
    </div>`;
}

function viewContact(id) {
  const c = allContactsCache.find(x => x.id === id);
  if (!c) return;
  const avatar = c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<span style="font-size:2.5rem;font-weight:700">${(c.name||'?')[0].toUpperCase()}</span>`;
  const modal = document.getElementById('contact-detail-modal');
  if (!modal) return;
  document.getElementById('contact-detail-content').innerHTML = `
    <div style="text-align:center;margin-bottom:1.5rem">
      <div style="width:80px;height:80px;border-radius:50%;background:var(--bg-btn);display:inline-flex;align-items:center;justify-content:center;color:#fff;overflow:hidden;margin-bottom:12px">${avatar}</div>
      <div style="font-size:1.3rem;font-weight:700">${c.name || 'Unknown'}</div>
    </div>
    <div class="contact-detail-rows">
      ${c.phone ? `<div class="contact-detail-row" onclick="navigator.clipboard.writeText('${c.phone}');showToast('📋 Copied!')">
        <i data-lucide="phone" style="width:18px;height:18px;color:var(--accent)"></i>
        <div><div style="font-size:0.72rem;color:var(--text-muted)">Phone</div><div style="font-weight:500">${c.phone}</div></div>
      </div>` : ''}
      ${c.email ? `<div class="contact-detail-row" onclick="navigator.clipboard.writeText('${c.email}');showToast('📋 Copied!')">
        <i data-lucide="mail" style="width:18px;height:18px;color:var(--accent)"></i>
        <div><div style="font-size:0.72rem;color:var(--text-muted)">Email</div><div style="font-weight:500">${c.email}</div></div>
      </div>` : ''}
      ${c.notes ? `<div class="contact-detail-row">
        <i data-lucide="file-text" style="width:18px;height:18px;color:var(--accent)"></i>
        <div><div style="font-size:0.72rem;color:var(--text-muted)">Notes</div><div style="font-size:0.85rem">${c.notes}</div></div>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:1.5rem">
      <button class="btn-danger" onclick="deleteContact('${c.id}');closeModal('contact-detail-modal')" style="flex:1;border-radius:10px"><i data-lucide="trash-2"></i> Delete</button>
      <button class="btn-ghost" onclick="closeModal('contact-detail-modal')" style="flex:1;border-radius:10px">Close</button>
    </div>`;
  if (window.lucide) lucide.createIcons();
  openModal('contact-detail-modal');
}

function formatPhoneInput(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 10) v = v.slice(0, 10);
  if (v.length >= 7) input.value = `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
  else if (v.length >= 4) input.value = `(${v.slice(0,3)}) ${v.slice(3)}`;
  else if (v.length >= 1) input.value = `(${v}`;
  else input.value = '';
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
  const ok = await showConfirmDialog({ icon: '📇', title: 'Delete contact?', msg: 'This contact will be permanently removed.', okText: 'Delete' });
  if (!ok) return;
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
        <button class="btn-icon" onclick="deleteAnnouncement('${a.id}')" title="Dismiss" style="color:#ef4444;flex-shrink:0"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`).join('');
  if (window.lucide) lucide.createIcons();
}

function checkAndShowAnnouncements() {
  fetch('/api/announcements').then(r => r.json()).then(anns => {
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
    const relevant = anns.filter(a => a.active && (a.targetUser === 'both' || a.targetUser === currentUser) && !dismissed.includes(a.id));
    if (relevant.length > 0) showBanner(relevant[0]);
  });
}

function showBanner(ann) {
  const banner = document.getElementById('announcement-banner');
  document.getElementById('banner-title').textContent = ann.title;
  document.getElementById('banner-content').textContent = ann.content;
  banner.dataset.annId = ann.id;
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 8000);
}

function closeBanner() {
  const banner = document.getElementById('announcement-banner');
  const annId = banner.dataset.annId;
  if (annId) {
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
    if (!dismissed.includes(annId)) dismissed.push(annId);
    localStorage.setItem('dismissedAnnouncements', JSON.stringify(dismissed));
  }
  banner.classList.remove('show');
}

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
let activeGuestChannel = null; // 'group', 'kaliph', 'kathrine'
let guestData = [];
let guestUnread = {}; // { 'guestId:channel': count }

async function loadGuestMessages() {
  try {
    const res = await fetch('/api/guest-messages');
    if (!res.ok) return;
    guestData = await res.json();
  } catch { guestData = []; }
  renderGuestList();
  setupGuestSocketListeners();
}

function setupGuestSocketListeners() {
  socket.off('guest-revoked');
  guestData.forEach(g => {
    socket.off(`guest-msg-${g.id}-group`);
    socket.off(`guest-msg-${g.id}-${currentUser}`);
  });

  socket.on('guest-revoked', ({ guestId }) => {
    guestData = guestData.filter(g => g.id !== guestId);
    if (activeGuestId === guestId) {
      activeGuestId = null;
      activeGuestChannel = null;
      document.getElementById('guest-chat-header').style.display = 'none';
      document.getElementById('guest-reply-bar').style.display = 'none';
      document.getElementById('guest-messages-area').innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-square-plus" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">Select a guest to view messages</div><div class="empty-state-sub">Guests can message you through the guest portal</div></div>';
      if (window.lucide) lucide.createIcons();
    }
    renderGuestList();
    updateGuestNavBadge();
  });

  guestData.forEach(g => {
    const handleGuestMsg = (channel) => (msg) => {
      const guest = guestData.find(x => x.id === g.id);
      if (guest) {
        if (!guest.channels[channel]) guest.channels[channel] = [];
        guest.channels[channel].push(msg);
      }
      if (activeGuestId === g.id && activeGuestChannel === channel) {
        renderGuestChat();
      } else {
        const key = g.id + ':' + channel;
        guestUnread[key] = (guestUnread[key] || 0) + 1;
        renderGuestList();
      }
      if (msg.sender !== currentUser) {
        updateGuestNavBadge();
        if (currentSection !== 'guest-messages' || activeGuestId !== g.id || activeGuestChannel !== channel) {
          const chLabel = channel === 'group' ? 'Group' : 'DM';
          sendDesktopNotif(`${msg.sender} (${chLabel})`, msg.text?.substring(0, 80) || 'New message');
          SoundSystem.receive();
          showMsgNotif(`${msg.sender} · ${chLabel}`, msg.text?.substring(0, 80) || 'New message');
        }
      }
    };
    socket.on(`guest-msg-${g.id}-group`, handleGuestMsg('group'));
    socket.on(`guest-msg-${g.id}-${currentUser}`, handleGuestMsg(currentUser));
  });
}

function updateGuestNavBadge() {
  const totalUnread = Object.values(guestUnread).reduce((a, b) => a + b, 0);
  const navItem = document.querySelector('.nav-item[data-section="guest-messages"]');
  if (!navItem) return;
  let badge = navItem.querySelector('.nav-badge');
  if (totalUnread > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      navItem.appendChild(badge);
    }
    badge.textContent = totalUnread;
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
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

  // Build separate entries per channel
  let html = '';
  guestData.forEach(g => {
    const channels = g.channels || {};
    // Determine which channels to show — show any channel that has messages, plus 'group' always
    const channelIds = ['group', currentUser].filter(ch => {
      const msgs = channels[ch];
      return msgs && msgs.length > 0;
    });
    // If no channels have messages, show a single entry for the guest
    if (!channelIds.length) channelIds.push('group');

    channelIds.forEach(ch => {
      const msgs = channels[ch] || [];
      const lastMsg = msgs[msgs.length - 1];
      const preview = lastMsg ? (lastMsg.text.length > 30 ? lastMsg.text.slice(0, 30) + '…' : lastMsg.text) : 'No messages yet';
      const time = lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      const unreadKey = g.id + ':' + ch;
      const unread = guestUnread[unreadKey] || 0;
      const isActive = activeGuestId === g.id && activeGuestChannel === ch;
      const chLabel = ch === 'group' ? 'Group' : 'DM';
      const chIcon = ch === 'group' ? 'users' : 'message-circle';
      html += `<div class="guest-list-item ${isActive ? 'active' : ''}" onclick="selectGuest('${g.id}','${ch}')">
        <div class="guest-item-avatar">${g.name[0].toUpperCase()}</div>
        <div class="guest-item-info">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="guest-item-name">${escapeHtml(g.name)} <span style="font-size:0.65rem;color:var(--text-muted);font-weight:400">· ${chLabel}</span></div>
            ${time ? `<span style="font-size:0.65rem;color:var(--text-muted);flex-shrink:0">${time}</span>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
            <div class="guest-item-meta">${escapeHtml(preview)}</div>
            ${unread ? `<span class="guest-unread-badge">${unread}</span>` : ''}
          </div>
        </div>
      </div>`;
    });
  });
  list.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function selectGuest(guestId, channel) {
  activeGuestId = guestId;
  activeGuestChannel = channel || 'group';
  // Clear unread for this specific guest+channel
  delete guestUnread[guestId + ':' + activeGuestChannel];
  updateGuestNavBadge();
  renderGuestList();
  renderGuestChat();
  document.getElementById('guest-chat-header').style.display = '';
  document.getElementById('guest-reply-bar').style.display = '';
  if (window.lucide) lucide.createIcons();
}

function renderGuestChat() {
  const area = document.getElementById('guest-messages-area');
  if (!area || !activeGuestId || !activeGuestChannel) return;
  const guest = guestData.find(g => g.id === activeGuestId);
  if (!guest) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-text">Guest not found</div></div>';
    return;
  }

  const chLabel = activeGuestChannel === 'group' ? 'Group Chat' : 'Direct Message';
  document.getElementById('guest-chat-name').textContent = guest.name;
  document.getElementById('guest-chat-initial').textContent = guest.name[0].toUpperCase();
  const statusEl = document.getElementById('guest-chat-status');
  if (statusEl) statusEl.textContent = chLabel;

  // Show only the selected channel's messages
  const msgs = (guest.channels || {})[activeGuestChannel] || [];

  if (!msgs.length) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-circle" style="width:36px;height:36px;opacity:0.35"></i></div><div class="empty-state-text">No messages yet</div><div class="empty-state-sub">Send a message to start the conversation</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  area.innerHTML = msgs.map((m, i) => {
    // Only current user's messages go on the right — other host + guest on left
    const isSelf = m.sender === currentUser;
    const isHost = m.sender === 'kaliph' || m.sender === 'kathrine';
    const senderName = isHost ? capitalize(m.sender) : escapeHtml(m.sender);
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const prev = msgs[i - 1];
    const sameSender = prev && prev.sender === m.sender && (m.timestamp - prev.timestamp < 120000);
    const chatColor = m.sender === 'kaliph' ? 'var(--kaliph-color, #7c3aed)' : m.sender === 'kathrine' ? 'var(--kathrine-color, #c084fc)' : 'var(--accent)';
    // Use profile picture for host users, initial letter for guests
    const userData = isHost && window._users ? window._users[m.sender] : null;
    const avatarInner = userData?.avatar
      ? `<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : (m.sender || 'G')[0].toUpperCase();

    return `<div class="guest-msg-row ${isSelf ? 'self' : ''}${sameSender ? ' same-sender' : ''}">
      ${!isSelf ? `<div class="guest-msg-avatar" style="${sameSender ? 'visibility:hidden' : ''};background:${chatColor}">${avatarInner}</div>` : ''}
      <div class="guest-msg-content">
        ${!sameSender ? `<div class="guest-msg-sender ${isSelf ? 'self' : ''}" style="color:${chatColor}">${senderName}</div>` : ''}
        <div class="guest-msg-bubble ${isSelf ? 'self' : 'other'}">
          <span>${escapeHtml(m.text)}</span>
          <span class="guest-msg-time">${time}</span>
        </div>
      </div>
      ${isSelf ? `<div class="guest-msg-avatar" style="${sameSender ? 'visibility:hidden' : ''};background:${chatColor}">${avatarInner}</div>` : ''}
    </div>`;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

async function sendGuestReply() {
  const input = document.getElementById('guest-reply-input');
  const text = input.value.trim();
  if (!text || !activeGuestId || !activeGuestChannel) return;
  input.value = '';
  try {
    await fetch(`/api/guests/${activeGuestId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target: activeGuestChannel })
    });
  } catch (e) { showToast('Failed to send'); }
}

// ── Settings ──────────────────────────────────────────────────────────
function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  modal.classList.add('open');
  loadSettings();
  loadGuests();
  loadSuggestions();
  if (window.lucide) lucide.createIcons();
  // Close mobile sidebar when opening settings on tablet
  if (window.innerWidth <= 834) closeMobileSidebar();
}

function switchSettingsTab(tab, el) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + tab)?.classList.add('active');
  if (tab === 'updates') renderUpdateHistory();
}

function renderUpdateHistory() {
  const container = document.getElementById('update-history-list');
  if (!container || !CHANGELOG.length) return;
  let html = '';
  CHANGELOG.forEach((entry, idx) => {
    const isOpen = idx === 0 ? 'open' : '';
    const count = entry.sections
      ? entry.sections.reduce((n, s) => n + s.items.length, 0)
      : (entry.improvements?.length || 0);
    html += `<details ${isOpen} style="margin-bottom:0.75rem;border:1px solid var(--border);border-radius:8px;overflow:hidden">`;
    html += `<summary style="padding:0.75rem 1rem;cursor:pointer;background:var(--bg-sidebar);font-size:0.85rem;font-weight:600;display:flex;justify-content:space-between;align-items:center">`;
    html += `<span>v${escapeHtml(entry.version)}${count ? ` <span style="font-weight:400;color:var(--accent);font-size:0.7rem">${count} features</span>` : ''}</span>`;
    html += `<span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">${escapeHtml(entry.date)}</span>`;
    html += `</summary>`;
    html += `<div style="padding:0.75rem 1rem;font-size:0.82rem;line-height:1.6">`;
    html += renderChangelogEntry(entry, { skipHeader: true });
    html += `</div></details>`;
  });
  container.innerHTML = html;
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
  // Check email system status
  checkEmailStatus();
}

async function checkEmailStatus() {
  try {
    const status = await fetch('/api/settings/email-status').then(r => r.json());
    const banner = document.getElementById('email-status-banner');
    if (!banner) return;
    if (!status.configured) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.color = '#ef4444';
      banner.textContent = '⚠ Email not configured — set EMAIL_USER and EMAIL_PASS in your server environment variables.';
    } else if (!status.canConnect) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(245,158,11,0.15)';
      banner.style.color = '#f59e0b';
      banner.textContent = '⚠ Email configured but cannot connect — check your EMAIL_PASS (Gmail App Password).';
    } else if (!status.hasRecipients) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(245,158,11,0.15)';
      banner.style.color = '#f59e0b';
      banner.textContent = 'Email server connected. Add email addresses below to enable priority notifications.';
    } else {
      banner.style.display = 'block';
      banner.style.background = 'rgba(34,197,94,0.15)';
      banner.style.color = '#22c55e';
      banner.textContent = '✓ Email notifications are working.';
    }
  } catch {}
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

async function sendTestEmail() {
  showToast('📧 Sending test email...');
  try {
    const r = await fetch('/api/settings/test-email', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const result = await r.json();
    if (result.success) {
      showToast('✅ Test email sent! Check your inbox.');
    } else {
      showToast('❌ ' + (result.error || 'Failed to send test email'));
    }
  } catch {
    showToast('❌ Could not reach the server');
  }
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
  window._users = users; // Refresh cache
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
  // Status display (Discord style — icon + label)
  const statusSection = document.getElementById('pv-status-section');
  if (statusSection) {
    const statusIcons = { online: '🟢', idle: '🌙', dnd: '⛔', invisible: '⚫' };
    const statusLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
    const userStatus = u.status || pvStatus;
    statusSection.innerHTML = `
      <div class="pc-section-title">STATUS</div>
      <div class="pv-status-row">
        <span class="pv-status-icon">${statusIcons[userStatus] || '🟢'}</span>
        <span class="pv-status-label">${statusLabels[userStatus] || 'Online'}</span>
        ${u.customStatus ? `<span class="pv-status-custom">— ${escapeHtml(u.customStatus)}</span>` : ''}
        ${u.statusEmoji ? `<span class="pv-status-emoji">${u.statusEmoji}</span>` : ''}
      </div>
      ${username === currentUser ? `<button class="pv-edit-status-btn" onclick="openStatusEditor()"><i data-lucide="pencil" style="width:12px;height:12px"></i> Edit Status</button>` : ''}
    `;
    statusSection.style.display = '';
    if (window.lucide) lucide.createIcons({ attrs: { class: 'lucide' } });
  }

  // Custom status (legacy display — now merged into status section above)
  const csEl = document.getElementById('pv-custom-status');
  csEl.style.display = 'none'; // Hidden — shown in status section now
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
  // Stealth preview button (only for the other user's profile, not in stealth mode)
  const stealthBtn = document.getElementById('pv-stealth-btn');
  if (stealthBtn) {
    stealthBtn.style.display = (username !== currentUser && !stealthMode) ? 'flex' : 'none';
    stealthBtn.setAttribute('data-target', username);
  }
  openModal('profile-viewer-modal');
  if (window.lucide) lucide.createIcons();
}

// ── Status Editor (editable from profile) ─────────────────────────────
function openStatusEditor() {
  closeModal('profile-viewer-modal');
  setTimeout(() => openModal('status-editor-modal'), 150);
  // Populate with current values
  const users = window._users || {};
  const u = users[currentUser] || {};
  document.getElementById('se-status-select').value = u.status || 'online';
  document.getElementById('se-custom-status').value = u.customStatus || '';
  document.getElementById('se-status-emoji').value = u.statusEmoji || '';
}

async function saveStatus() {
  const status = document.getElementById('se-status-select').value;
  const customStatus = document.getElementById('se-custom-status').value.trim();
  const statusEmoji = document.getElementById('se-status-emoji').value.trim();
  await fetch(`/api/users/${currentUser}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, customStatus, statusEmoji })
  });
  // Update local cache
  if (window._users && window._users[currentUser]) {
    window._users[currentUser].status = status;
    window._users[currentUser].customStatus = customStatus;
    window._users[currentUser].statusEmoji = statusEmoji;
  }
  closeModal('status-editor-modal');
  showToast('✅ Status updated!');
  // Also emit to socket so header updates
  socket.emit('status-change', { user: currentUser, status });
  // Update own status dot
  setStatusDot('my-status-dot', status);
  updateStatusText(status);
}

async function clearStatus() {
  await fetch(`/api/users/${currentUser}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'online', customStatus: '', statusEmoji: '' })
  });
  if (window._users && window._users[currentUser]) {
    window._users[currentUser].status = 'online';
    window._users[currentUser].customStatus = '';
    window._users[currentUser].statusEmoji = '';
  }
  closeModal('status-editor-modal');
  showToast('Status cleared');
  socket.emit('status-change', { user: currentUser, status: 'online' });
  setStatusDot('my-status-dot', 'online');
  updateStatusText('online');
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
function showConfirmDialog({ icon = '⚠️', title = 'Are you sure?', msg = 'This action cannot be undone.', okText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-icon').textContent = icon;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.textContent = okText;
    okBtn.className = danger ? 'btn-danger' : 'btn-primary';
    okBtn.style.flex = '1';
    okBtn.style.maxWidth = '140px';
    document.getElementById('confirm-cancel-btn').textContent = cancelText;
    document.getElementById('confirm-dialog').classList.add('open');
  });
}
function closeConfirmDialog(result) {
  document.getElementById('confirm-dialog').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}

// Custom prompt dialog (replaces browser prompt())
let _promptResolve = null;
function showPromptDialog({ value = '', placeholder = 'Type here...', okText = 'Send', cancelText = 'Cancel' } = {}) {
  return new Promise(resolve => {
    _promptResolve = resolve;
    const input = document.getElementById('prompt-input');
    input.value = value;
    input.placeholder = placeholder;
    document.getElementById('prompt-ok-btn').textContent = okText;
    document.getElementById('prompt-cancel-btn').textContent = cancelText;
    document.getElementById('prompt-dialog').classList.add('open');
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 50);
  });
}
function closePromptDialog(submit) {
  const input = document.getElementById('prompt-input');
  const val = submit ? input.value : null;
  document.getElementById('prompt-dialog').classList.remove('open');
  if (_promptResolve) { _promptResolve(val); _promptResolve = null; }
}
// Wire up prompt dialog buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prompt-cancel-btn')?.addEventListener('click', () => closePromptDialog(false));
  document.getElementById('prompt-ok-btn')?.addEventListener('click', () => closePromptDialog(true));
  document.getElementById('prompt-dialog')?.addEventListener('click', e => { if (e.target.id === 'prompt-dialog') closePromptDialog(false); });
  // Allow Ctrl+Enter to submit prompt
  document.getElementById('prompt-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closePromptDialog(true); }
    if (e.key === 'Escape') closePromptDialog(false);
  });
});

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
  if (stealthMode) return; // Can't change status in stealth mode
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
let callAnswered = false;      // track if call was answered

// Post a call event (missed/ended) as a system message in chat
async function postCallEvent(type, peer, cType) {
  const icon = cType === 'video' ? '📹' : '📞';
  let text;
  if (type === 'missed') {
    text = `${icon} Missed ${cType || 'voice'} call`;
  } else if (type === 'ended') {
    const dur = callSeconds > 0 ? ` (${Math.floor(callSeconds / 60)}:${String(callSeconds % 60).padStart(2, '0')})` : '';
    text = `${icon} ${capitalize(cType || 'Voice')} call ended${dur}`;
  }
  if (!text) return;
  // Insert as a system-style message
  const sysMsg = {
    id: 'call-' + Date.now(),
    sender: 'system',
    type: 'call-event',
    text,
    files: [],
    priority: false,
    replyTo: null,
    timestamp: Date.now(),
    callType: cType,
    callStatus: type,
    callPeer: peer,
  };
  // Save to server
  try {
    await fetch('/api/messages/call-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sysMsg),
    });
  } catch {}
}

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
  callAnswered = false;
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
    const state = peerConnection?.iceConnectionState;
    if (state === 'failed') {
      endCall(true);
    } else if (state === 'disconnected') {
      // Give it a few seconds to reconnect (iOS/iPad often briefly disconnects on tab switch)
      clearTimeout(window._iceDisconnectTimer);
      window._iceDisconnectTimer = setTimeout(() => {
        if (peerConnection?.iceConnectionState === 'disconnected') endCall(true);
      }, 5000);
    } else if (state === 'connected' || state === 'completed') {
      clearTimeout(window._iceDisconnectTimer);
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
  callAnswered = true;
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
    const state = peerConnection?.iceConnectionState;
    if (state === 'failed') {
      endCall(true);
    } else if (state === 'disconnected') {
      clearTimeout(window._iceDisconnectTimer);
      window._iceDisconnectTimer = setTimeout(() => {
        if (peerConnection?.iceConnectionState === 'disconnected') endCall(true);
      }, 5000);
    } else if (state === 'connected' || state === 'completed') {
      clearTimeout(window._iceDisconnectTimer);
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
  callAnswered = true;
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
  // Post missed call to chat
  postCallEvent('missed', callPeer, callType);
  callPeer = null;
  window._pendingOffer = null;
  iceCandidateQueue = [];
  socket.emit('call-end', {});
}

function endCall(remote = false) {
  SoundSystem.stopRingtone();
  SoundSystem.callSound('hangup');
  if (!remote) socket.emit('call-end', {});
  // Post call event to chat
  const peer = callPeer;
  const cType = callType;
  if (callAnswered) {
    postCallEvent('ended', peer, cType);
  } else if (remote && !callAnswered) {
    // Other person ended before we answered = missed call
    postCallEvent('missed', peer, cType);
  }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  stopCallTimer();
  stopCallControlsAutoHide();
  inCall = false;
  callAnswered = false;
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
    // Notify the remote peer about camera on/off so they see our profile pic
    socket.emit('call-camera-toggle', { user: currentUser, cameraOn: track.enabled });
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
    // Restore local video preview (re-mirror camera after screenshare)
    const localVid = document.getElementById('call-video-local');
    if (localStream) { localVid.srcObject = localStream; localVid.style.display = 'block'; }
    localVid.style.transform = 'scaleX(-1)'; // Restore camera mirror
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
  { type: 'before', icon: 'calendar', label: 'Before a date', hint: 'before: YYYY-MM-DD' },
  { type: 'after', icon: 'calendar-check', label: 'After a date', hint: 'after: YYYY-MM-DD' },
];

function setupSearch() {
  const bar = document.getElementById('search-bar');
  const dropdown = document.getElementById('search-results');

  // Clear any browser autofill that may have populated the search bar
  bar.value = '';

  bar.addEventListener('focus', () => {
    if (!bar.value.trim() && !searchPendingFilter && !searchFilters.length) showSearchFilters();
    else if (searchPendingFilter && !bar.value.trim()) showValueSuggestions();
  });

  bar.addEventListener('input', () => {
    const raw = bar.value;

    // Auto-detect typed filter prefixes like "from:" "has:" etc
    const filterMatch = raw.match(/^(from|has|before|after):\s*(.*)$/i);
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

  if (type === 'from') {
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

  // Typing sound on input + Enter to send + emoji autocomplete
  document.getElementById('msg-input')?.addEventListener('keydown', e => {
    // Emoji autocomplete intercepts arrow/enter/tab/escape
    if (handleEmojiACKeydown(e)) return;
    if (e.key.length === 1 || e.key === 'Backspace') SoundSystem.keystroke();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.getElementById('brainstorm-input')?.addEventListener('keydown', e => {
    if (e.key.length === 1 || e.key === 'Backspace') SoundSystem.keystroke();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendBrainstorm(); }
  });

  // Typing emit + emoji autocomplete
  let typingTimeout;
  document.getElementById('msg-input')?.addEventListener('input', (e) => {
    socket.emit('typing', { user: currentUser });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop-typing', { user: currentUser }), 1500);
    autoResizeInput();
    // Show emoji autocomplete when typing :name
    showEmojiAutocomplete(e.target);
  });

  // Jump-to-latest scroll detection
  const msgArea = document.getElementById('messages-area');
  const jumpBtn = document.getElementById('jump-to-latest');
  if (msgArea && jumpBtn) {
    msgArea.addEventListener('scroll', () => {
      const distFromBottom = msgArea.scrollHeight - msgArea.scrollTop - msgArea.clientHeight;
      jumpBtn.classList.toggle('show', distFromBottom > 300);
    });
  }

  setupSearch();
}

function jumpToLatest() {
  const area = document.getElementById('messages-area');
  if (area) area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
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
  if (stealthMode) return; // Don't update lastSeen in stealth mode
  navigator.sendBeacon('/api/users/' + currentUser + '/lastseen', '');
});

// Tab hidden = go idle, tab visible = come back online + sync messages
document.addEventListener('visibilitychange', () => {
  if (stealthMode) return; // Don't emit presence in stealth mode
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
    // Sync messages we may have missed while tab was hidden
    syncMissedMessages();
  }
});

async function syncMissedMessages() {
  try {
    const resp = await fetch('/api/messages');
    const msgs = await resp.json();
    const serverMsgs = msgs.main || [];
    if (serverMsgs.length <= allMessages.length) return;
    // Find messages we don't have yet
    const existingIds = new Set(allMessages.map(m => m.id));
    const missed = serverMsgs.filter(m => !existingIds.has(m.id));
    if (missed.length === 0) return;
    const area = document.getElementById('messages-area');
    missed.forEach(msg => {
      allMessages.push(msg);
      area.appendChild(buildMsgElement(msg));
    });
    area.scrollTop = area.scrollHeight;
  } catch {}
}

// ── Modal helpers ─────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }

// Click outside modal
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    // Persist update log dismissal when clicking overlay
    if (e.target.id === 'update-log-modal') { dismissUpdateLog(); return; }
    closeModal(e.target.id);
  }
  if (!e.target.closest('#context-menu')) closeContextMenu();
  if (!e.target.closest('#emoji-picker') && !e.target.closest('.format-btn[onclick*=emoji]')) document.getElementById('emoji-picker').classList.remove('open');
  if (!e.target.closest('#reaction-picker')) document.getElementById('reaction-picker').classList.remove('open');
  if (!e.target.closest('#emoji-autocomplete') && !e.target.closest('#msg-input')) hideEmojiAutocomplete();
  if (!e.target.closest('.status-menu') && !e.target.closest('#my-status-text')) document.getElementById('status-menu').classList.remove('open');
});

// ── Notifications + Push (Service Worker) ─────────────────────────────
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result === 'granted') await registerPushSubscription();
  } else if (Notification.permission === 'granted') {
    await registerPushSubscription();
  }
}

async function registerPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    // Get VAPID key from server
    const resp = await fetch('/api/push/vapid-key');
    const { publicKey } = await resp.json();
    if (!publicKey) return;
    // Convert VAPID key
    const vapidBytes = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidBytes,
      });
    }
    // Send subscription to server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });
  } catch (e) { console.error('Push registration failed:', e); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Register service worker on load
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function sendDesktopNotif(title, body) {
  if (document.hasFocus()) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    // Service worker handles push when site is closed;
    // this handles when the tab is open but not focused
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
  if (stealthMode) { window.location.href = '/app'; return; }
  // Immediately broadcast offline + save lastSeen before leaving
  socket.emit('user-invisible', { user: currentUser });
  navigator.sendBeacon('/api/users/' + currentUser + '/lastseen', '');
  await fetch('/api/auth/logout', { method: 'POST' });
  clearInterval(inactivityTimer);
  window.location.href = '/';
}

// ── Update / Changelog Log ────────────────────────────────────────────
const CHANGELOG = [
  {
    version: '3.1.0',
    date: 'Mar 10 2026',
    intro: 'This is the biggest update yet — 25 new features across chat, emoji, profiles, guests, and more. Everything has been refined to feel smoother, look cleaner, and work faster. ✨',
    sections: [
      { icon: '💬', title: 'Chat', items: [
        { name: 'Pinned Messages', desc: 'Pin via hover menu or right-click. Pinned panel in the header.' },
        { name: 'Unread Divider', desc: 'Red "NEW" marker auto-scrolls to where you left off.' },
        { name: 'Rich Link Embeds', desc: 'URLs show preview cards with image, title & description.' },
        { name: 'Drag & Drop Files', desc: 'Drop images or files into the message box, or paste from clipboard.' },
        { name: 'File Previews', desc: 'Thumbnails appear above the input before you send.' },
        { name: 'Live Formatting', desc: 'Bold, italic, underline preview as you type.' },
        { name: 'Custom Audio Player', desc: 'Sleek play/pause, progress bar & seek for voice messages.' },
        { name: 'Self Messages', desc: 'Your name, avatar & chat color now show on your own messages.' },
      ]},
      { icon: '😊', title: 'Emoji & Reactions', items: [
        { name: 'Emoji Autocomplete', desc: 'Type :name: for Discord-style autocomplete with arrow keys.' },
        { name: 'Reaction Picker', desc: 'Click + on the reaction bar to pick any emoji.' },
        { name: 'Expanded Emoji Set', desc: '160+ emojis with text search.' },
        { name: 'GIF Search', desc: 'GIPHY-powered search with proper embed rendering.' },
      ]},
      { icon: '👤', title: 'Profiles & Status', items: [
        { name: 'Status on Profiles', desc: 'Online/Idle/DND/Invisible & custom text on profile cards.' },
        { name: 'Editable Status', desc: 'Click "Edit Status" on your profile — no Settings needed.' },
      ]},
      { icon: '👋', title: 'Guest Experience', items: [
        { name: 'Guest Profile Viewing', desc: 'Guests can click host avatars to see full profiles.' },
        { name: 'Messages Overhaul', desc: 'Proper bubbles, sender names, live notifications with sound.' },
        { name: 'Guest Revocation', desc: 'Revoked guests instantly disappear from the sidebar.' },
      ]},
      { icon: '📱', title: 'Apps & Tools', items: [
        { name: 'Contacts Revamp', desc: 'Search, sort, letter headers, detail modal & phone formatting.' },
        { name: 'Calendar Multi-Day', desc: 'One UI-style range picker with spanning colored bars.' },
        { name: 'Notes & Todos', desc: 'Animated circular checkboxes, progress bar, polished layout.' },
        { name: 'Two New Themes', desc: 'Rose & Ember (warm rose-gold) and Deep Tide (teal-emerald).' },
        { name: 'Instant Loading', desc: 'Notes, contacts & guest data preloaded at startup.' },
      ]},
      { icon: '🛠️', title: 'Admin & Eval', items: [
        { name: 'Stealth Browse', desc: 'Inspect user data without touching lastSeen or read receipts.' },
        { name: 'Eval Unsend', desc: 'Flag messages as unsendable — bypasses the 3-minute limit.' },
        { name: 'Announcement Dismiss', desc: 'Both users can now dismiss any announcement.' },
      ]},
    ],
    fixes: [
      'Update log only dismisses once per version',
      'GIF messages render as images, not text links',
      'Guest messages match main chat styling',
    ],
  },
  {
    version: '2.0.0',
    date: 'Mar 10 2026',
    improvements: [
      'Vault File Preview — click any file to preview inline (images, videos, PDFs, audio) with open & download buttons',
      'Push Notifications — get notified of new messages even when the site is closed',
      'Missed & Ended Call Indicators — calls now show as system messages in chat',
      'Custom Dialogs — all popups replaced with sleek in-app modals',
      'Eval Terminal — password now saves across server restarts',
    ],
    fixes: [
      'Email notifications restored with reliable connection pooling',
      'Backdoor confirm dialog is now a proper popup instead of always visible',
      'Backdoor page scrolls correctly on all screen sizes',
      'Eval login clears input on wrong password',
      'Eval login screen made larger and easier to use',
    ],
  },
  {
    version: '1.5.0',
    date: 'Mar 10 2026',
    improvements: [
      'Update History tab in Settings — browse all past changelogs',
    ],
  },
  {
    version: '1.4.0',
    date: 'Mar 10 2026',
    improvements: [
      'Admin eval terminal with 90+ commands',
      'Eval settings with 3 themes (Hacker, Cyberpunk, Amber)',
      'Command autocomplete in eval terminal',
      'Update logs shown on login',
    ],
    removed: [
      'Gmail SMTP (replaced with Brevo email API)',
    ],
    fixes: [
      'Email notifications now use Brevo HTTP API (works on Railway)',
      'Test emails send to all addresses instead of just the first',
      'Search bar no longer shows autofill on load',
      'Chat no longer flashes empty before messages load',
      'Backdoor: separate option to erase chat history',
      'Fixed "set banner clear" command being unreachable',
    ],
  },
];

function renderChangelogEntry(entry, { skipHeader = false } = {}) {
  let html = '';

  // New sectioned format (v3.1.0+)
  if (entry.sections) {
    // Version badge (skip in settings history where summary already shows it)
    if (!skipHeader) {
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">`;
      html += `<span style="background:var(--accent);color:#fff;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:99px;letter-spacing:0.5px">v${escapeHtml(entry.version)}</span>`;
      html += `<span style="color:var(--text-muted);font-size:0.7rem">${escapeHtml(entry.date)}</span>`;
      html += `</div>`;
    }

    // Intro paragraph
    if (entry.intro) {
      html += `<p style="color:var(--text);font-size:0.82rem;line-height:1.55;margin:0 0 1rem 0;opacity:0.9">${escapeHtml(entry.intro)}</p>`;
    }

    // Sections
    entry.sections.forEach(section => {
      html += `<div style="margin-bottom:0.85rem">`;
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
      html += `<span style="font-size:0.95rem">${section.icon}</span>`;
      html += `<span style="font-weight:700;font-size:0.8rem;color:var(--text);letter-spacing:0.3px">${escapeHtml(section.title)}</span>`;
      html += `</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:4px;padding-left:2px">`;
      section.items.forEach(item => {
        html += `<div style="display:flex;gap:6px;font-size:0.78rem;line-height:1.45">`;
        html += `<span style="color:var(--accent);font-weight:600;white-space:nowrap">${escapeHtml(item.name)}</span>`;
        html += `<span style="color:var(--text-muted)">— ${escapeHtml(item.desc)}</span>`;
        html += `</div>`;
      });
      html += `</div></div>`;
    });

    // Bug fixes
    if (entry.fixes?.length) {
      html += `<div style="margin-top:0.5rem;padding-top:0.6rem;border-top:1px solid var(--border)">`;
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
      html += `<span style="font-size:0.95rem">🐛</span>`;
      html += `<span style="font-weight:700;font-size:0.8rem;color:#34d399;letter-spacing:0.3px">Bug Fixes</span>`;
      html += `</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:3px;padding-left:2px">`;
      entry.fixes.forEach(f => {
        html += `<div style="font-size:0.78rem;color:var(--text-muted);line-height:1.45">• ${escapeHtml(f)}</div>`;
      });
      html += `</div></div>`;
    }
  }
  // Legacy flat format (v2.0.0 and older)
  else {
    if (!skipHeader) html += `<div style="color:var(--text-muted);font-size:0.75rem;margin-bottom:0.75rem">v${escapeHtml(entry.version)} — ${escapeHtml(entry.date)}</div>`;
    if (entry.improvements?.length) {
      html += `<div style="font-weight:600;color:var(--accent);margin-bottom:4px">Improvements</div><ul style="margin:0 0 0.75rem 1.1rem;padding:0">`;
      entry.improvements.forEach(i => { html += `<li style="margin-bottom:2px;font-size:0.82rem">${escapeHtml(i)}</li>`; });
      html += `</ul>`;
    }
    if (entry.removed?.length) {
      html += `<div style="font-weight:600;color:var(--text-muted);margin-bottom:4px">Removed</div><ul style="margin:0 0 0.75rem 1.1rem;padding:0">`;
      entry.removed.forEach(i => { html += `<li style="margin-bottom:2px;font-size:0.82rem">${escapeHtml(i)}</li>`; });
      html += `</ul>`;
    }
    if (entry.fixes?.length) {
      html += `<div style="font-weight:600;color:#34d399;margin-bottom:4px">Bug Fixes</div><ul style="margin:0 0 0.75rem 1.1rem;padding:0">`;
      entry.fixes.forEach(i => { html += `<li style="margin-bottom:2px;font-size:0.82rem">${escapeHtml(i)}</li>`; });
      html += `</ul>`;
    }
  }
  return html;
}

function checkAndShowUpdateLog() {
  if (!CHANGELOG.length) return;
  const key = 'rkk-changelog-dismissed-' + currentUser;
  const dismissed = localStorage.getItem(key);
  if (dismissed === CHANGELOG[0].version) return;

  // Find all unseen versions (everything newer than what was dismissed)
  const unseen = dismissed
    ? CHANGELOG.filter((_, i) => i < CHANGELOG.findIndex(c => c.version === dismissed))
    : CHANGELOG;
  if (!unseen.length) return;

  const container = document.getElementById('update-log-content');
  let html = '';

  unseen.forEach((entry, idx) => {
    if (idx > 0) html += `<hr style="border:none;border-top:1px solid var(--border);margin:1.25rem 0">`;
    html += renderChangelogEntry(entry);
  });

  container.innerHTML = html;
  openModal('update-log-modal');
}

function dismissUpdateLog() {
  const latest = CHANGELOG[0];
  if (latest) {
    localStorage.setItem('rkk-changelog-dismissed-' + currentUser, latest.version);
  }
  closeModal('update-log-modal');
}

// ── Start ─────────────────────────────────────────────────────────────
init().catch(err => console.error('Init failed:', err));
