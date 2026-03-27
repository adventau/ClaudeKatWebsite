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

// ── Site Time Override ────────────────────────────────────────────────
// When an eval "time set" command is active, _timeOffsetMs shifts all
// time-sensitive features (bell schedule, reminders, etc.) as if it
// were actually that time.
window._timeOffsetMs = 0;

function parseTimeOffset(offset) {
  if (!offset) return 0;
  // Relative: +2h, -30m, +1d, +90s
  const rel = offset.match(/^([+-])(\d+(?:\.\d+)?)(h|m|s|d)$/i);
  if (rel) {
    const sign = rel[1] === '+' ? 1 : -1;
    const val  = parseFloat(rel[2]);
    const unit = rel[3].toLowerCase();
    const ms   = unit === 'h' ? val * 3600000
               : unit === 'm' ? val * 60000
               : unit === 's' ? val * 1000
               : val * 86400000; // d
    return sign * ms;
  }
  // Absolute ISO date → compute delta from real now
  const abs = new Date(offset);
  if (!isNaN(abs)) return abs.getTime() - Date.now();
  return 0;
}

/** Returns the current site time, respecting any active time override. */
function getNow() {
  return new Date(Date.now() + window._timeOffsetMs);
}
/** Returns current site time as ms timestamp. */
function getNowMs() {
  return Date.now() + window._timeOffsetMs;
}

// ── Stealth preview mode ─────────────────────────────────────────────
let stealthMode = false;
let stealthRealUser = null;  // The actual logged-in user when in stealth

// ── Global state ─────────────────────────────────────────────────────
let currentUser = null;
let otherUser   = null;
let allMessages = [];
let hasMoreMessages = false;
let loadingMoreMessages = false;
const MSG_PAGE_SIZE = 50;
let _jumpMode = false;
let _jumpUnloadTimer = null;
let brainstormMessages = [];
let replyToId   = null;
let ctxMsgId    = null;
let vaultPasscode = null;
let calYear = getNow().getFullYear();
let calMonth = getNow().getMonth();
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
  { id: 'kaliph',   name: 'AVNT',              preview: 'linear-gradient(135deg,#080c1e,#4f46e5,#818cf8)' },
  { id: 'kathrine', name: 'Royal Violet',       preview: 'linear-gradient(135deg,#0d0716,#8b5cf6,#e9d5ff)' },
  { id: 'royal',    name: 'Crimson Throne',     preview: 'linear-gradient(135deg,#0c0606,#c41e3a,#d4a017)' },
  { id: 'light',    name: 'Pristine Light',     preview: 'linear-gradient(135deg,#f9f9f9,#d4d4d4,#e8e8e8)' },
  { id: 'dark',     name: 'Midnight Dark',      preview: 'linear-gradient(135deg,#141414,#404040,#242424)' },
  { id: 'heaven',   name: 'Celestial',          preview: 'linear-gradient(135deg,#faf8f2,#c8a96e,#d4b882)' },
  { id: 'neon',     name: 'Neon Tokyo',         preview: 'linear-gradient(135deg,#0a0a12,#ff2d7b,#00f0ff)' },
  { id: 'noir',     name: 'Velvet Noir',        preview: 'linear-gradient(135deg,#1a1a2e,#d4af37,#5c2a3e)' },
  { id: 'rosewood', name: 'Rose & Ember',       preview: 'linear-gradient(135deg,#0c0912,#c8967a,#7c3aed)' },
  { id: 'ocean',    name: 'Deep Tide',          preview: 'linear-gradient(135deg,#060d10,#14b8a6,#2dd4bf)' },
  { id: 'arctic',   name: 'Arctic',             preview: 'linear-gradient(135deg,#070e1a,#43e8b1,#a48efa)' },
  { id: 'aurora',   name: 'Arctic Aurora',      preview: 'linear-gradient(135deg,#f0f4f8,#06b6d4,#818cf8)' },
  { id: 'sandstone',name: 'Sandstone Dusk',     preview: 'linear-gradient(135deg,#f5ede0,#c2713a,#d4a870)' },
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

  // ── Phase 1: Auth + user data fetched in parallel ──
  const [sessionRes, usersRes] = await Promise.all([
    fetch('/api/auth/session').then(r => r.json()),
    fetch('/api/users').then(r => r.json())
  ]);

  if (!sessionRes.authenticated || !sessionRes.user) {
    window.location.href = '/';
    return;
  }

  // Stealth mode: view as another user without affecting their presence
  if (stealthTarget && ['kaliph', 'kathrine'].includes(stealthTarget)) {
    stealthMode = true;
    stealthRealUser = sessionRes.user;
    currentUser = stealthTarget;
    otherUser = stealthTarget === 'kaliph' ? 'kathrine' : 'kaliph';
    activateStealthBanner(stealthTarget);
  } else {
    currentUser = sessionRes.user;
    otherUser   = currentUser === 'kaliph' ? 'kathrine' : 'kaliph';
  }

  applyUserData(usersRes[currentUser], usersRes[otherUser]);
  applyTheme(usersRes[currentUser].theme || 'dark');
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
    const presence = usersRes[currentUser]?._presence || 'offline';
    setStatusDot('my-status-dot', presence);
    updateStatusText(presence);
  }

  // Load last-read timestamp for unread tracking
  chatLastReadTs = parseInt(localStorage.getItem('chatLastReadTs_' + currentUser) || '0', 10);

  // Init Lucide icons so UI is visible
  if (window.lucide) lucide.createIcons();

  // ── Phase 2: Load messages first so chat is visible ASAP ──
  await loadMessages();

  // Count initial unread messages (from other user, after last read time)
  if (chatLastReadTs) {
    unreadCount = allMessages.filter(m =>
      m.sender !== currentUser && m.sender !== 'ai' && m.timestamp > chatLastReadTs
    ).length;
    updateUnreadBadge();
  }
  // Mark as read since chat is the default section (skip in stealth)
  // Pass false to skip server-side flush on initial load — messages loaded fresh are already in DB state
  if (currentSection === 'chat' && !stealthMode) clearUnreadBadge(false);

  // Reveal chat immediately — don't wait for secondary data
  document.body.classList.add('app-loaded');

  // Load everything else in background — notes, contacts, guests, announcements
  Promise.all([loadAnnouncements(), loadNotes(), loadContacts(), loadGuestMessages()])
    .then(() => checkAndShowAnnouncements())
    .catch(console.error);
  if (!stealthMode) requestNotificationPermission();

  // Show update log if user hasn't dismissed the latest version
  if (!stealthMode) checkAndShowUpdateLog();

  // Load bell schedule and start class updater
  loadBellSchedule().then(() => {
    startClassUpdater();
    if (stealthMode) loadBellScheduleUI();
  });

  // Check for today's calendar events and reminders
  checkTodayEvents();

  // Load reminders and start checker
  loadReminders().then(() => startReminderChecker());

  // Show/hide authenticator nav based on user preference
  const totpNav = document.getElementById('nav-authenticator');
  const totpToggle = document.getElementById('toggle-totp');
  const totpDisabled = usersRes[currentUser]?.totpEnabled === false;
  if (totpNav) totpNav.style.display = totpDisabled ? 'none' : '';
  if (totpToggle) totpToggle.checked = !totpDisabled;

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
  setCustomSelectValue('stealth-user-select', target, target.charAt(0).toUpperCase() + target.slice(1));
}

function exitStealthMode() {
  window.location.href = '/app';
}

function switchStealthUser(user) {
  window.location.href = '/app?stealth=' + user;
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

function buildStatusText(presenceText, user) {
  let text = presenceText;
  const u = window._users?.[user];
  if (u?.customStatus) {
    const emoji = u.statusEmoji ? u.statusEmoji + ' ' : '';
    text += ' · ' + emoji + u.customStatus;
  }
  return text;
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
    document.getElementById('other-status-label').textContent = buildStatusText('Online', otherUser);
  } else if (presence === 'idle') {
    setStatusDot('other-status-dot', 'idle');
    document.getElementById('other-status-label').textContent = buildStatusText('Idle', otherUser);
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
    const bannerEl = document.getElementById('profile-edit-banner');
    if (bannerEl) { bannerEl.style.backgroundImage = `url(${me.banner})`; bannerEl.style.backgroundSize = 'cover'; }
  }
  const namePreview = document.getElementById('profile-edit-name-preview');
  if (namePreview) {
    namePreview.textContent = me.displayName || me.name;
    if (me.nameStyle?.color) namePreview.style.color = me.nameStyle.color;
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
  if (me.perfMode) {
    document.body.classList.add('perf-mode');
    const tog = document.getElementById('toggle-perf');
    if (tog) tog.checked = true;
  }
}

function applyTheme(themeId) {
  const body = document.body;
  // Fallback if saved theme no longer exists
  if (themeId && !THEMES.find(t => t.id === themeId)) themeId = 'dark';
  const id = themeId || 'dark';

  // Suppress per-element transitions so nothing animates piecemeal
  body.classList.add('theme-switching');
  // Instantly hide the page, swap everything while invisible, then fade back in
  body.style.transition = 'none';
  body.style.opacity = '0';

  requestAnimationFrame(() => {
    // All changes happen in one frame while body is invisible
    THEMES.forEach(t => body.classList.remove('theme-' + t.id));
    body.classList.add('theme-' + id);
    try { localStorage.setItem('rkk-theme', id); } catch {}
    SoundSystem.setTheme(id);
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('active', c.dataset.theme === id);
    });
    const footer = document.getElementById('avnt-footer');
    if (footer) footer.style.display = id === 'kaliph' ? 'flex' : 'none';
    repositionSearchForTheme();

    // Fade back in smoothly
    requestAnimationFrame(() => {
      body.style.transition = 'opacity 0.18s ease';
      body.style.opacity = '1';
      setTimeout(() => {
        body.style.transition = '';
        body.classList.remove('theme-switching');
      }, 200);
    });
  });
}

function repositionSearchForTheme() {
  const wrap = document.getElementById('search-wrap');
  if (!wrap) return;
  const body = document.body;
  const isDark  = body.classList.contains('theme-dark');
  const isLight = body.classList.contains('theme-light');

  if (isDark) {
    // Move search bar into chat header (between header-info and chat-actions)
    const chatActions = document.querySelector('.chat-header .chat-actions');
    if (chatActions && !chatActions.parentElement.contains(wrap)) {
      chatActions.parentElement.insertBefore(wrap, chatActions);
    }
  } else if (isLight) {
    // Light: app-header hidden; insert search BEFORE the nav in the sidebar
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const nav = sidebar.querySelector('.sidebar-nav');
      if (nav) sidebar.insertBefore(wrap, nav);
    }
  } else {
    // All other themes: search lives in the header-center
    const headerCenter = document.querySelector('.header-center');
    if (headerCenter && !headerCenter.contains(wrap)) headerCenter.appendChild(wrap);
  }
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
  SoundSystem.send(); // Preview the new theme sound
  await fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: themeId })
  });
  showToast('🎨 Theme updated!');
}

// ── Navigation ────────────────────────────────────────────────────────
let currentSection = 'chat';
function showSection(name, el) {
  SoundSystem.navigate();
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
  if (name === 'vault')     { if (!vaultPasscode) resetVault(); else refreshVault(); }
  if (name === 'announcements') loadAnnouncements();
  if (name === 'reminders') loadReminders();
  if (name === 'authenticator') initTotpSection();
  if (name === 'money') loadMoney();
  if (name === 'guest-messages') {
    loadGuestMessages();
    // Clear unread for active guest (keys are 'guestId:channel')
    if (activeGuestId) {
      Object.keys(guestUnread).forEach(k => { if (k.startsWith(activeGuestId + ':')) delete guestUnread[k]; });
      updateGuestNavBadge(); renderGuestList();
    }
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

function clearUnreadBadge(flushToServer = true) {
  unreadCount = 0;
  chatLastReadTs = Date.now();
  if (!stealthMode) localStorage.setItem('chatLastReadTs_' + currentUser, chatLastReadTs);
  updateUnreadBadge();
  // Remove the NEW marker if present
  const marker = document.querySelector('.new-msg-marker');
  if (marker) marker.remove();
  // Mark all pending unread messages as actually read on the server
  // (skipped on initial page load to avoid bulk-firing historical messages)
  if (flushToServer && !stealthMode) {
    allMessages.forEach(msg => {
      if (!msg.read && msg.sender !== currentUser && msg.sender !== 'ai') {
        markMessageRead(msg.id);
      }
    });
  }
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
  const data = await fetch(`/api/messages?limit=${MSG_PAGE_SIZE}`).then(r => r.json());
  allMessages = Array.isArray(data) ? data.filter(m => !(m.type === 'call-event' && m.callPeer && guestData.some(g => g.name === m.callPeer))) : [];
  hasMoreMessages = (Array.isArray(data) ? data.length : 0) >= MSG_PAGE_SIZE;
  renderMessages();
}

async function loadOlderMessages() {
  if (loadingMoreMessages || !hasMoreMessages || allMessages.length === 0) return;
  loadingMoreMessages = true;

  const sentinel = document.getElementById('load-more-top');
  if (sentinel) sentinel.classList.add('loading');

  try {
    const oldestTs = allMessages[0].timestamp;
    const data = await fetch(`/api/messages?limit=${MSG_PAGE_SIZE}&before=${oldestTs}`).then(r => r.json());
    const older = Array.isArray(data) ? data : [];

    if (older.length === 0) {
      hasMoreMessages = false;
      if (sentinel) sentinel.remove();
      return;
    }

    hasMoreMessages = older.length >= MSG_PAGE_SIZE;

    // Prepend to allMessages (deduplicate just in case)
    const existingIds = new Set(allMessages.map(m => m.id));
    const newOnes = older.filter(m => !existingIds.has(m.id));
    allMessages = [...newOnes, ...allMessages];

    // Preserve scroll position while inserting at top
    const area = document.getElementById('messages-area');
    const prevScrollHeight = area.scrollHeight;

    // Build a fragment of all older message elements in order
    const frag = document.createDocumentFragment();

    // Add updated sentinel first (or remove if no more)
    if (!hasMoreMessages) {
      if (sentinel) sentinel.remove();
    } else if (sentinel) {
      sentinel.classList.remove('loading');
    }

    // Determine the first existing msg element to insert before
    const firstExisting = area.querySelector('.msg-row[data-msg-id], .date-sep');

    let lastDate = null;
    let prevMsgSender = null;
    let prevMsgTs = null;
    let prevWasSystem = false;

    newOnes.forEach(msg => {
      const msgDate = new Date(msg.timestamp).toDateString();
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const sep = document.createElement('div');
        sep.className = 'date-sep';
        sep.textContent = formatDate(msg.timestamp);
        frag.appendChild(sep);
      }
      const isSystem = msg.type === 'call-event' || msg.type === 'pin-notice';
      const grouped = !isSystem
        && prevMsgSender === msg.sender
        && prevMsgTs !== null
        && (msg.timestamp - prevMsgTs) < 5 * 60 * 1000;
      prevMsgSender = msg.sender;
      prevMsgTs = msg.timestamp;
      prevWasSystem = isSystem;
      frag.appendChild(buildMsgElement(msg, grouped));
    });

    if (firstExisting) {
      area.insertBefore(frag, firstExisting);
    } else {
      area.appendChild(frag);
    }

    // Restore scroll position so the user stays where they were
    area.scrollTop += area.scrollHeight - prevScrollHeight;
  } catch (e) {
    console.error('loadOlderMessages error', e);
  } finally {
    loadingMoreMessages = false;
    const s = document.getElementById('load-more-top');
    if (s) s.classList.remove('loading');
  }
}

let _loadMoreObserver = null;
function setupLoadMoreObserver() {
  if (_loadMoreObserver) { _loadMoreObserver.disconnect(); _loadMoreObserver = null; }
  const sentinel = document.getElementById('load-more-top');
  if (!sentinel) return;
  _loadMoreObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadOlderMessages();
  }, { root: document.getElementById('messages-area'), threshold: 0 });
  _loadMoreObserver.observe(sentinel);
}

function renderMessages(filter = null) {
  const area = document.getElementById('messages-area');
  const msgs = filter ? allMessages.filter(m => m.text?.toLowerCase().includes(filter.toLowerCase())) : allMessages;

  // Remove old message elements (keep wallpaper overlay + empty state)
  const wallpaper = area.querySelector('.wallpaper-overlay');
  area.innerHTML = '';
  if (wallpaper) area.appendChild(wallpaper);

  // Sentinel for infinite-scroll upward (only when not in filter/search mode)
  if (!filter && hasMoreMessages) {
    const sentinel = document.createElement('div');
    sentinel.id = 'load-more-top';
    sentinel.className = 'load-more-sentinel';
    sentinel.innerHTML = '<span class="load-more-spinner"></span>';
    area.appendChild(sentinel);
  }

  const empty = document.getElementById('chat-empty') || (() => {
    const d = document.createElement('div');
    d.className = 'empty-state'; d.id = 'chat-empty';
    d.innerHTML = '<div class="empty-state-icon">💜</div><div class="empty-state-text">Start your conversation</div>';
    return d;
  })();

  if (msgs.length === 0) { area.appendChild(empty); return; }

  let lastDate = null;

  // Grouping state — consecutive messages from same sender within 5 min get grouped
  let prevMsgSender = null;
  let prevMsgTs = null;
  let prevWasSystem = false;
  let prevNewDay = false;

  msgs.forEach((msg, idx) => {
    const msgDate = new Date(msg.timestamp).toDateString();
    const newDay = msgDate !== lastDate;
    if (newDay) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = formatDate(msg.timestamp);
      area.appendChild(sep);
    }

    const isSystem = msg.type === 'call-event' || msg.type === 'pin-notice';
    const grouped = !isSystem && !newDay && !prevWasSystem
      && prevMsgSender === msg.sender
      && prevMsgTs !== null
      && (msg.timestamp - prevMsgTs) < 5 * 60 * 1000;

    prevMsgSender = msg.sender;
    prevMsgTs = msg.timestamp;
    prevWasSystem = isSystem;

    area.appendChild(buildMsgElement(msg, grouped));
  });

  // Scroll to bottom — always open at the latest message
  requestAnimationFrame(() => {
    area.scrollTop = area.scrollHeight;

    // Re-scroll after any images load so they don't push content below the view
    area.querySelectorAll('img').forEach(img => {
      if (!img.complete) {
        img.addEventListener('load',  () => { area.scrollTop = area.scrollHeight; }, { once: true });
        img.addEventListener('error', () => { area.scrollTop = area.scrollHeight; }, { once: true });
      }
    });

    updateJumpBtnState();
    setupLoadMoreObserver();
  });
}

/** Check if a newly-appended message should be visually grouped with the last rendered one. */
function shouldGroupWithPrev(msg) {
  if (!msg || msg.type === 'call-event' || msg.type === 'pin-notice') return false;
  const area = document.getElementById('messages-area');
  if (!area) return false;
  const rows = area.querySelectorAll('.msg-row[data-msg-id]');
  if (!rows.length) return false;
  const lastRow = rows[rows.length - 1];
  const lastMsgId = lastRow.dataset.msgId;
  const lastMsg = allMessages.find(m => m.id === lastMsgId);
  if (!lastMsg || lastMsg.type === 'call-event' || lastMsg.type === 'pin-notice') return false;
  if (lastMsg.sender !== msg.sender) return false;
  const diff = new Date(msg.timestamp) - new Date(lastMsg.timestamp);
  return diff >= 0 && diff < 5 * 60 * 1000;
}

function buildMsgElement(msg, grouped = false) {
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
      <span class="pin-notice-icon"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg></span>
      <span class="pin-notice-text"><a href="#" onclick="scrollToMessage('${msg.pinnedMsgId}');return false" class="pin-notice-link">New message pinned</a> by <strong>${escapeHtml(pinnerName)}</strong></span>
    </div>`;
    return row;
  }

  const isSelf = msg.sender === currentUser;
  const isAI   = msg.sender === 'ai' || msg.aiGenerated;

  const row = document.createElement('div');
  row.className = `msg-row ${isSelf ? 'self' : 'other'}${grouped ? ' grouped' : ''}`;
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

  // Sender label (hidden for grouped messages)
  const label = document.createElement('div');
  label.className = 'msg-sender-label';
  if (grouped) {
    label.style.display = 'none';
  } else if (isAI) {
    label.innerHTML = '<span class="ai-label">🤖 Claude</span>';
  } else {
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
    pb.innerHTML = '<i data-lucide="alert-triangle" style="width:11px;height:11px"></i> Priority';
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
      rp.setAttribute('data-reply-id', msg.replyTo);
      rp.textContent = (orig.text || '').substring(0, 80) + (orig.text?.length > 80 ? '…' : '');
      rp.onclick = (e) => { e.stopPropagation(); jumpToMessage(msg.replyTo); };
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
    // Discord-style markdown formatting
    t = t.replace(/\`([^`]+)\`/g, '<code style="background:rgba(0,0,0,0.2);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:0.9em">$1</code>');
    t = t.replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')" style="background:var(--text-primary);color:transparent;border-radius:4px;padding:0 4px;cursor:pointer;transition:all 0.2s">$1</span>');
    t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__(.+?)__/g, '<u>$1</u>');
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    t = t.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
    // Preserve newlines (Shift+Enter)
    t = t.replace(/\n/g, '<br>');
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
    pin.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg> Pinned';
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
  // Inline SVGs to avoid per-message lucide.createIcons() (major perf bottleneck)
  const _s = 'xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const svgSmile = `<svg ${_s}><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/></svg>`;
  const svgReply = `<svg ${_s}><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`;
  const svgPin = `<svg ${_s}><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
  const svgPinOff = `<svg ${_s}><line x1="2" x2="22" y1="2" y2="22"/><line x1="12" x2="12" y1="17" y2="22"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/><path d="M15 9.34V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0-1.4.58"/></svg>`;
  const svgCopy = `<svg ${_s}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
  const svgPencil = `<svg ${_s}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
  const svgTrash = `<svg ${_s}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;
  const unsendBtn = (isSelf && msg.unsendable) ? `<button class="msg-action-btn msg-unsend-btn" data-msg-id="${msg.id}" onclick="quickUnsend('${msg.id}')" title="Unsend">${svgTrash}</button>` : '';
  const pinBtn = msg.pinned
    ? `<button class="msg-action-btn" onclick="unpinMessage('${msg.id}')" title="Unpin">${svgPinOff}</button>`
    : `<button class="msg-action-btn" onclick="pinMessage('${msg.id}')" title="Pin">${svgPin}</button>`;
  actions.innerHTML = `
    <button class="msg-action-btn react-trigger" onclick="showQuickReact('${msg.id}', this)" title="React">${svgSmile}</button>
    <button class="msg-action-btn" onclick="setReply('${msg.id}')" title="Reply">${svgReply}</button>
    ${pinBtn}
    <button class="msg-action-btn" onclick="copyMsgText('${msg.id}')" title="Copy">${svgCopy}</button>
    ${isSelf ? `<button class="msg-action-btn" onclick="ctxMsgId='${msg.id}';ctxEdit()" title="Edit">${svgPencil}</button>` : ''}
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

// Touch handler for message quick actions on iPad
if ('ontouchstart' in window) {
  document.addEventListener('touchstart', (e) => {
    const msgRow = e.target.closest('.msg-row');
    document.querySelectorAll('.msg-row.actions-visible').forEach(r => {
      if (r !== msgRow) r.classList.remove('actions-visible');
    });
    if (msgRow && !msgRow.classList.contains('call-event-row') && !msgRow.classList.contains('pin-notice-row')) {
      msgRow.classList.toggle('actions-visible');
    }
  });
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
  setCustomSelectValue('font-select', 'default', 'Default');
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
      area.appendChild(buildMsgElement(result.message, shouldGroupWithPrev(result.message)));
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
    const _ps = 'xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    pinBtn.innerHTML = msg.pinned
      ? `<svg ${_ps}><line x1="2" x2="22" y1="2" y2="22"/><line x1="12" x2="12" y1="17" y2="22"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/><path d="M15 9.34V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0-1.4.58"/></svg> Unpin Message`
      : `<svg ${_ps}><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg> Pin Message`;
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

function buildPinnedPreviewHtml(m) {
  if (m.type === 'gif' && m.text) {
    return `<div class="pinned-item-text">
      <img src="${escapeHtml(m.text)}" style="max-height:120px;max-width:100%;border-radius:8px;object-fit:cover;display:block;margin-top:4px" loading="lazy">
    </div>`;
  }
  if (m.files?.length) {
    const images = m.files.filter(f => f.type?.startsWith('image'));
    const others = m.files.filter(f => !f.type?.startsWith('image'));
    let html = '<div class="pinned-item-text">';
    if (m.text) html += `<div style="margin-bottom:4px">${escapeHtml(m.text)}</div>`;
    if (images.length) {
      html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">` +
        images.map(f => `<img src="${escapeHtml(f.url)}" style="height:90px;max-width:130px;border-radius:6px;object-fit:cover" loading="lazy">`).join('') +
        `</div>`;
    }
    if (others.length) {
      html += others.map(f => `<div style="display:flex;align-items:center;gap:5px;color:var(--text-muted);font-size:0.8rem;margin-top:4px">📄 ${escapeHtml(f.name)}</div>`).join('');
    }
    html += '</div>';
    return html;
  }
  if (m.voiceUrl) return `<div class="pinned-item-text" style="color:var(--text-muted)">🎙️ Voice message</div>`;
  return `<div class="pinned-item-text">${escapeHtml(m.text || '(no content)')}</div>`;
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
    const time = new Date(m.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const pinnedPreview = buildPinnedPreviewHtml(m);
    return `<div class="pinned-item" onclick="scrollToMessage('${m.id}')">
      <div class="pinned-item-header">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="msg-avatar-sm" style="width:24px;height:24px;min-width:24px;font-size:0.6rem;background:${chatColor};display:flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;color:#fff">${avatarHtml}</div>
          <strong>${escapeHtml(sender)}</strong>
        </div>
        <span class="pinned-item-time">${time}</span>
      </div>
      ${pinnedPreview}
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
let activeGifTab = 'trending';
let gifFavorites = JSON.parse(localStorage.getItem('rkk-gif-favorites') || '[]');

function openGifSearch() {
  openModal('gif-modal');
  const input = document.getElementById('gif-search-input');
  if (input) input.value = '';
  switchGifTab(activeGifTab, true);
}

function switchGifTab(tab, force = false) {
  if (activeGifTab === tab && !force) return;
  activeGifTab = tab;
  document.querySelectorAll('.gif-tab').forEach(b => {
    b.classList.toggle('gif-tab-active', b.dataset.tab === tab);
  });
  // Clear search input when switching tabs
  const input = document.getElementById('gif-search-input');
  if (input) input.value = '';
  const categoryQueries = { scandal: ['scandal olivia pope', 'eli pope scandal', 'scandal abc', 'scandal tv show'] };
  if (tab === 'trending') {
    loadTrendingGifs();
  } else if (tab === 'favorites') {
    loadGifFavorites();
  } else {
    loadGifCategory(categoryQueries[tab] || tab);
  }
}

let gifTimeout = null;
let gifOffset = 0;
let gifLoading = false;
let gifHasMore = true;
let gifCurrentQuery = '';
let gifCurrentMode = ''; // 'trending', 'category', 'search'

async function loadTrendingGifs(append) {
  const grid = document.getElementById('gif-grid');
  if (!append) { grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Loading…</p>'; gifOffset = 0; gifHasMore = true; }
  gifCurrentMode = 'trending';
  gifCurrentQuery = '';
  gifLoading = true;
  try {
    const r = await fetch(`/api/gif-trending?offset=${gifOffset}&limit=25`);
    const d = await r.json();
    const results = d.results || [];
    gifOffset += results.length;
    gifHasMore = results.length >= 25;
    renderGifResults(results, append);
  } catch {
    if (!append) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Could not load GIFs</p>';
  }
  gifLoading = false;
}

async function loadGifCategory(cat, append) {
  const grid = document.getElementById('gif-grid');
  if (!append) { grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Loading…</p>'; gifOffset = 0; gifHasMore = true; }
  gifCurrentMode = 'category';
  // Multi-query support: if array, combine results from all queries
  if (Array.isArray(cat)) {
    gifLoading = true;
    const perQuery = Math.ceil(25 / cat.length);
    const perOffset = Math.floor(gifOffset / cat.length);
    try {
      const fetches = cat.map(q => fetch(`/api/gif-search?q=${encodeURIComponent(q)}&offset=${perOffset}&limit=${perQuery}`).then(r => r.json()));
      const allData = await Promise.all(fetches);
      let combined = [];
      allData.forEach(d => combined.push(...(d.results || [])));
      // Deduplicate by id
      const seen = new Set();
      combined = combined.filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; });
      gifOffset += combined.length;
      gifHasMore = combined.length >= 10;
      gifCurrentQuery = cat;
      renderGifResults(combined, append);
    } catch {
      if (!append) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Could not load GIFs</p>';
    }
    gifLoading = false;
    return;
  }
  gifCurrentQuery = cat;
  gifLoading = true;
  try {
    const r = await fetch(`/api/gif-search?q=${encodeURIComponent(cat)}&offset=${gifOffset}&limit=25`);
    const d = await r.json();
    const results = d.results || [];
    gifOffset += results.length;
    gifHasMore = results.length >= 25;
    renderGifResults(results, append);
  } catch {
    if (!append) grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Could not load GIFs</p>';
  }
  gifLoading = false;
}

function loadGifFavorites() {
  gifFavorites = JSON.parse(localStorage.getItem('rkk-gif-favorites') || '[]');
  if (!gifFavorites.length) {
    document.getElementById('gif-grid').innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No favorites yet — hover a GIF and click ♥ to save it</p>';
    return;
  }
  renderGifResults(gifFavorites);
}

function searchGifs(q) {
  clearTimeout(gifTimeout);
  if (!q.trim()) {
    // Restore current tab on clear
    if (activeGifTab === 'trending') loadTrendingGifs();
    else if (activeGifTab === 'favorites') loadGifFavorites();
    else { const cq = { scandal: ['scandal olivia pope', 'eli pope scandal', 'scandal abc', 'scandal tv show'] }; loadGifCategory(cq[activeGifTab] || activeGifTab); }
    return;
  }
  gifTimeout = setTimeout(async () => {
    const grid = document.getElementById('gif-grid');
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Searching…</p>';
    gifOffset = 0; gifHasMore = true; gifCurrentMode = 'search'; gifCurrentQuery = q;
    gifLoading = true;
    try {
      const r = await fetch(`/api/gif-search?q=${encodeURIComponent(q)}&offset=0&limit=25`);
      const d = await r.json();
      const results = d.results || [];
      gifOffset = results.length;
      gifHasMore = results.length >= 25;
      renderGifResults(results);
    } catch {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">GIF search failed</p>';
    }
    gifLoading = false;
  }, 350);
}

function renderGifResults(results, append) {
  const grid = document.getElementById('gif-grid');
  if (!results.length && !append) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">No GIFs found</p>';
    return;
  }
  gifFavorites = JSON.parse(localStorage.getItem('rkk-gif-favorites') || '[]');
  const html = results.map(g => {
    const isFav = gifFavorites.some(f => f.url === g.url);
    const safeUrl = g.url.replace(/'/g, '%27');
    const safePreview = (g.preview || g.url).replace(/'/g, '%27');
    return `<div class="gif-item" style="position:relative;border-radius:8px;overflow:hidden;cursor:pointer" onclick="sendGif('${safeUrl}')">
      <img src="${safePreview}" data-full="${safeUrl}" style="width:100%;display:block;aspect-ratio:${g.width || 200}/${g.height || 200};object-fit:cover" loading="lazy">
      <button class="gif-fav-btn ${isFav ? 'gif-fav-active' : ''}" onclick="toggleGifFavorite(event,'${safeUrl}','${safePreview}',${g.width||200},${g.height||200})" title="${isFav ? 'Remove favorite' : 'Add to favorites'}">♥</button>
    </div>`;
  }).join('');
  if (append) grid.insertAdjacentHTML('beforeend', html);
  else grid.innerHTML = html;
}

// Infinite scroll for GIF grid (the grid itself is scrollable with overflow-y:auto)
(function initGifScroll() {
  // Use event delegation since the grid exists in the DOM
  document.addEventListener('scroll', function(e) {
    const grid = document.getElementById('gif-grid');
    if (!grid || e.target !== grid) return;
    if (gifLoading || !gifHasMore) return;
    if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
      loadMoreGifs();
    }
  }, true);
})();

function loadMoreGifs() {
  if (gifLoading || !gifHasMore) return;
  const cq = { scandal: ['scandal olivia pope', 'eli pope scandal', 'scandal abc', 'scandal tv show'] };
  if (gifCurrentMode === 'trending') loadTrendingGifs(true);
  else if (gifCurrentMode === 'category') loadGifCategory(gifCurrentQuery || cq[activeGifTab] || activeGifTab, true);
  else if (gifCurrentMode === 'search') {
    gifLoading = true;
    fetch(`/api/gif-search?q=${encodeURIComponent(gifCurrentQuery)}&offset=${gifOffset}&limit=25`)
      .then(r => r.json()).then(d => {
        const results = d.results || [];
        gifOffset += results.length;
        gifHasMore = results.length >= 25;
        renderGifResults(results, true);
      }).catch(() => {}).finally(() => { gifLoading = false; });
  }
}

function toggleGifFavorite(e, url, preview, width, height) {
  e.stopPropagation();
  gifFavorites = JSON.parse(localStorage.getItem('rkk-gif-favorites') || '[]');
  const idx = gifFavorites.findIndex(f => f.url === url);
  if (idx >= 0) {
    gifFavorites.splice(idx, 1);
  } else {
    gifFavorites.unshift({ url, preview, width, height });
  }
  localStorage.setItem('rkk-gif-favorites', JSON.stringify(gifFavorites));
  // Update just this button
  const btn = e.currentTarget;
  const isFav = idx < 0; // was added
  btn.classList.toggle('gif-fav-active', isFav);
  btn.title = isFav ? 'Remove favorite' : 'Add to favorites';
  // If on favorites tab, re-render to reflect removal
  if (activeGifTab === 'favorites') loadGifFavorites();
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
    // Skip guest call events from main chat entirely
    if (msg.type === 'call-event' && msg.callPeer && guestData.some(g => g.name === msg.callPeer)) return;
    allMessages.push(msg);
    const area = document.getElementById('messages-area');
    const empty = document.getElementById('chat-empty');
    if (empty) empty.remove();
    area.appendChild(buildMsgElement(msg, shouldGroupWithPrev(msg)));
    // Don't auto-scroll if user jumped to an old message — let them stay in context
    if (!_jumpMode) area.scrollTop = area.scrollHeight;
    if (msg.sender !== currentUser && msg.sender !== 'ai' && msg.type !== 'call-event') {
      SoundSystem.receive();
      // Only mark read if the user is actively looking at chat (tab visible + chat section open)
      if (currentSection === 'chat' && !document.hidden) {
        markMessageRead(msg.id);
      } else {
        unreadCount++;
        updateUnreadBadge();
        showMsgNotif(msg.sender, msg.text?.substring(0, 80) || 'Sent a file');
      }
      sendDesktopNotif(`New message from ${capitalize(msg.sender)}`, msg.text?.substring(0, 80) || 'New file');
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
        pin.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg> Pinned';
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

  socket.on('status-changed', ({ user, status, customStatus, statusEmoji }) => {
    if (user === otherUser) {
      // Update cached user data for buildStatusText
      if (window._users?.[user]) {
        if (customStatus !== undefined) window._users[user].customStatus = customStatus;
        if (statusEmoji !== undefined) window._users[user].statusEmoji = statusEmoji;
      }
      setStatusDot('other-status-dot', status);
      const sLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
      document.getElementById('other-status-label').textContent = buildStatusText(sLabels[status] || 'Online', otherUser);
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
        document.getElementById('other-status-label').textContent = buildStatusText('Online', otherUser);
      } else if (state === 'idle') {
        stopLastSeenUpdater();
        setStatusDot('other-status-dot', 'idle');
        document.getElementById('other-status-label').textContent = buildStatusText('Idle', otherUser);
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
    // Update cached user data
    if (window._users?.[user]) Object.assign(window._users[user], data);
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
      // Refresh status text with custom status
      if (data.customStatus !== undefined || data.statusEmoji !== undefined) {
        const label = document.getElementById('other-status-label');
        const dot = document.getElementById('other-status-dot');
        if (label && dot) {
          const isOnline = dot.classList.contains('online');
          const isIdle = dot.classList.contains('idle');
          if (isOnline) label.textContent = buildStatusText('Online', otherUser);
          else if (isIdle) label.textContent = buildStatusText('Idle', otherUser);
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

  socket.on('reminder-updated', () => {
    loadReminders();
  });

  socket.on('reminder-due', (data) => {
    showReminderNotification(data);
    loadReminders();
  });

  socket.on('money:updated', (data) => {
    const oldData = _moneyData;
    _moneyData = data;
    if (currentSection === 'money') renderMoneyUpdate(oldData, data);
  });

  socket.on('time-offset', ({ offset }) => {
    if (offset) {
      window._timeOffsetMs = parseTimeOffset(offset);
      const fakeTime = getNow();
      showToast(`⏰ Time override: ${fakeTime.toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}`);
    } else {
      window._timeOffsetMs = 0;
      showToast('⏰ Time reset — using real time.');
    }
    // Jump calendar to the (possibly shifted) current month
    const now = getNow();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    // Refresh all time-dependent displays
    updateClassDisplays();
    renderCalendar();
    checkTodayEvents();
    updateReminderBadge();
    if (currentSection === 'reminders') renderReminders();
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
  socket.on('call-ended', (data) => {
    // Only process if we're actually in a call (prevents ghost call-end events from guest calls)
    if (!inCall && !callPeer) return;
    // If callId provided, only end if it matches our active call
    if (data?.callId && window._activeCallId && data.callId !== window._activeCallId) return;
    endCall(true);
  });
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
  const url = stealthMode ? `/api/notes?viewAs=${currentUser}` : '/api/notes';
  const data = await fetch(url).then(r => r.json());
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
  notes.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  if (!notes.length) {
    list.innerHTML = '<div class="empty-state" style="height:200px"><div class="empty-state-icon"><i data-lucide="file-text" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">No notes here</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-item ${n.id === activeNoteId ? 'active' : ''}" onclick="openNote('${n.id}')">
      <div class="note-item-title">${n.title}</div>
      <div class="note-item-preview">${n.type === 'todo' ? 'Todo list' : (n.content?.substring(0,60) || '…')}</div>
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
            ${isOwn ? `<button class="todo-item-edit" onclick="event.stopPropagation();editTodoItem('${id}',${i})" title="Edit"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>` : ''}
            ${isOwn ? `<button class="todo-item-del" onclick="event.stopPropagation();removeTodoItem('${id}',${i})" title="Remove">✕</button>` : ''}
          </div>`).join('')}
        ${isOwn ? `<div style="margin-top:8px;display:flex;gap:6px">
          <input type="text" id="new-todo-item" placeholder="Add a task…" style="flex:1" onkeydown="if(event.key==='Enter'){addTodoItemToNote('${id}');event.preventDefault()}">
          <button class="btn-primary" onclick="addTodoItemToNote('${id}')" style="border-radius:10px;padding:8px 16px">Add</button>
        </div>` : ''}
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    // Auto-save title changes for todos
    const todoTitleEl = document.getElementById('edit-note-title');
    if (todoTitleEl && isOwn) todoTitleEl.addEventListener('input', scheduleAutoSave);
    // Setup drag to reorder for todo items
    if (isOwn) setupTodoDragReorder(id);
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
      <textarea id="edit-note-content" rows="20" style="width:100%;border-radius:10px;line-height:1.75" ${isOwn?'':'readonly'}>${note.content||''}</textarea>`;
    if (window.lucide) lucide.createIcons();
    // Auto-save on title and content changes
    const noteTitleEl = document.getElementById('edit-note-title');
    const noteContentEl = document.getElementById('edit-note-content');
    if (isOwn) {
      if (noteTitleEl) noteTitleEl.addEventListener('input', scheduleAutoSave);
      if (noteContentEl) noteContentEl.addEventListener('input', scheduleAutoSave);
    }
  }
}

let _noteAutoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(_noteAutoSaveTimer);
  _noteAutoSaveTimer = setTimeout(() => saveCurrentNote(true), 800);
}

async function saveCurrentNote(silent) {
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
  if (activeNoteId) renderNotesList();
  if (!silent) showToast('📝 Note saved!');
}

async function createBlankNote() {
  const res = await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled', content: '', type: 'note' })
  });
  const data = await res.json();
  await loadNotes();
  if (data.note) openNote(data.note.id);
}

async function createBlankTodo() {
  const res = await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Untitled', todos: [], type: 'todo' })
  });
  const data = await res.json();
  await loadNotes();
  if (data.note) openNote(data.note.id);
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

function setupTodoDragReorder(noteId) {
  const container = document.getElementById('todo-list-editor');
  if (!container) return;
  let dragIdx = null;
  container.querySelectorAll('.todo-item').forEach((item, i) => {
    item.draggable = true;
    item.dataset.idx = i;
    item.addEventListener('dragstart', (e) => {
      dragIdx = i;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      const dropIdx = parseInt(item.dataset.idx);
      if (dragIdx === null || dragIdx === dropIdx) return;
      const note = (allNotes.mine || []).find(n => n.id === noteId);
      if (!note || !note.todos) return;
      const moved = note.todos.splice(dragIdx, 1)[0];
      note.todos.splice(dropIdx, 0, moved);
      await fetch(`/api/notes/${noteId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: note.todos })
      });
      openNote(noteId);
    });
  });
}

function editTodoItem(noteId, idx) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note || !note.todos[idx]) return;
  const items = document.querySelectorAll('#todo-list-editor .todo-item');
  const item = items[idx];
  if (!item) return;
  const textEl = item.querySelector('.todo-item-text');
  if (!textEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = note.todos[idx].text;
  input.style.cssText = 'flex:1;font-size:inherit;background:var(--bg-card);border:1px solid var(--accent);border-radius:6px;padding:4px 8px;color:var(--text-primary);outline:none';
  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const newText = input.value.trim();
    if (newText && newText !== note.todos[idx].text) {
      note.todos[idx].text = newText;
      await fetch(`/api/notes/${noteId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ todos: note.todos }) });
      await loadNotes();
    }
    openNote(noteId);
  };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') openNote(noteId); };
  input.onblur = save;
  textEl.replaceWith(input);
  input.focus();
  input.select();
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
  const today = getNow();

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
        titleSpan.textContent = (ev.emoji || '') + ' ' + ev.title;
        el.appendChild(titleSpan);
        const btns = document.createElement('span');
        btns.className = 'cal-event-btns';
        const editBtn = document.createElement('button');
        editBtn.className = 'cal-event-edit';
        editBtn.innerHTML = '✎';
        editBtn.title = 'Edit event';
        editBtn.onclick = (e) => { e.stopPropagation(); editCalEvent(ev.id); };
        btns.appendChild(editBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'cal-event-del';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete event';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteCalEvent(ev.id); };
        btns.appendChild(delBtn);
        el.appendChild(btns);
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
            titleSpan.textContent = isEventStart || rowStart.getDate() === 1 ? (ev.emoji || '') + ' ' + ev.title : '';
            bar.appendChild(titleSpan);

            // Edit & delete buttons only on first segment
            if (isEventStart) {
              const btns = document.createElement('span');
              btns.className = 'cal-event-btns';
              const editBtn = document.createElement('button');
              editBtn.className = 'cal-event-edit';
              editBtn.innerHTML = '✎';
              editBtn.title = 'Edit event';
              editBtn.onclick = (e) => { e.stopPropagation(); editCalEvent(ev.id); };
              btns.appendChild(editBtn);
              const delBtn = document.createElement('button');
              delBtn.className = 'cal-event-del';
              delBtn.textContent = '✕';
              delBtn.title = 'Delete event';
              delBtn.onclick = (e) => { e.stopPropagation(); deleteCalEvent(ev.id); };
              btns.appendChild(delBtn);
              bar.appendChild(btns);
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
    const today = getNow();
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
  const today = getNow();

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
  const reminderVal = getCustomSelectValue('event-reminder') || '';
  await fetch('/api/calendar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      start,
      end,
      description: document.getElementById('event-desc').value,
      color: document.getElementById('event-color').value,
      emoji: document.getElementById('event-emoji')?.value.trim() || '',
      reminder: reminderVal !== '' ? parseInt(reminderVal) : null,
    })
  });
  // Reset form
  document.getElementById('event-title').value = '';
  document.getElementById('event-start-date').value = '';
  document.getElementById('event-end-date').value = '';
  document.getElementById('event-desc').value = '';
  if (document.getElementById('event-emoji')) document.getElementById('event-emoji').value = '';
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
  SoundSystem.deleteSnd();
  showToast('Event deleted');
}

// ── Edit Event Date Picker (EEDP) ─────────────────────────────────────
let eedpYear, eedpMonth, eedpSelectStart = null, eedpSelectEnd = null, eedpPickerOpen = false;

function toggleEditEventDatePicker() {
  const picker = document.getElementById('edit-event-date-picker');
  eedpPickerOpen = !eedpPickerOpen;
  picker.style.display = eedpPickerOpen ? '' : 'none';
  if (eedpPickerOpen) {
    const today = getNow();
    if (!eedpYear) { eedpYear = today.getFullYear(); eedpMonth = today.getMonth(); }
    renderEedpGrid();
  }
}

function eedpPrev() { eedpMonth--; if (eedpMonth < 0) { eedpMonth = 11; eedpYear--; } renderEedpGrid(); }
function eedpNext() { eedpMonth++; if (eedpMonth > 11) { eedpMonth = 0; eedpYear++; } renderEedpGrid(); }

function renderEedpGrid() {
  document.getElementById('eedp-month-label').textContent =
    new Date(eedpYear, eedpMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const grid = document.getElementById('eedp-grid');
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(eedpYear, eedpMonth, 1).getDay();
  const daysInMonth = new Date(eedpYear, eedpMonth + 1, 0).getDate();
  const today = getNow();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'edp-day edp-day-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'edp-day';
    const dateStr = `${eedpYear}-${String(eedpMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    if (d === today.getDate() && eedpMonth === today.getMonth() && eedpYear === today.getFullYear()) {
      cell.classList.add('edp-today');
    }

    if (eedpSelectStart && eedpSelectEnd) {
      const s = eedpSelectStart <= eedpSelectEnd ? eedpSelectStart : eedpSelectEnd;
      const e = eedpSelectStart <= eedpSelectEnd ? eedpSelectEnd : eedpSelectStart;
      if (dateStr === s && dateStr === e) cell.classList.add('edp-selected-single');
      else if (dateStr === s) cell.classList.add('edp-range-start');
      else if (dateStr === e) cell.classList.add('edp-range-end');
      else if (dateStr > s && dateStr < e) cell.classList.add('edp-range-mid');
    } else if (eedpSelectStart && dateStr === eedpSelectStart) {
      cell.classList.add('edp-selected-single');
    }

    cell.textContent = d;
    cell.onclick = () => eedpSelectDate(dateStr);
    grid.appendChild(cell);
  }
}

function eedpSelectDate(dateStr) {
  if (!eedpSelectStart || eedpSelectEnd) {
    eedpSelectStart = dateStr;
    eedpSelectEnd = null;
  } else {
    if (dateStr === eedpSelectStart) {
      eedpSelectEnd = dateStr;
    } else if (dateStr < eedpSelectStart) {
      eedpSelectEnd = eedpSelectStart;
      eedpSelectStart = dateStr;
    } else {
      eedpSelectEnd = dateStr;
    }
  }
  document.getElementById('edit-event-start-date').value = eedpSelectStart;
  document.getElementById('edit-event-end-date').value = eedpSelectEnd || eedpSelectStart;
  updateEditEventDateDisplay();
  renderEedpGrid();
}

function updateEditEventDateDisplay() {
  const display = document.getElementById('edit-event-date-display');
  const start = eedpSelectStart;
  const end = eedpSelectEnd || eedpSelectStart;
  if (!start) { display.textContent = 'Select date(s)...'; display.classList.remove('has-value'); return; }
  const fmt = (ds) => {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  display.textContent = (start === end || !end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  display.classList.add('has-value');
}

// ── Edit & Update Calendar Events ─────────────────────────────────────
async function editCalEvent(eventId) {
  const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
  const events = calData.shared || [];
  const ev = events.find(e => e.id === eventId);
  if (!ev) return showToast('Event not found');

  document.getElementById('edit-event-id').value = ev.id;
  document.getElementById('edit-event-title').value = ev.title || '';
  document.getElementById('edit-event-desc').value = ev.description || '';
  document.getElementById('edit-event-color').value = ev.color || '#7c3aed';

  const reminderLabels = { '': 'No reminder', '0': 'Day of event', '1': '1 day before', '2': '2 days before', '3': '3 days before', '7': '1 week before' };
  const rVal = ev.reminder != null ? String(ev.reminder) : '';
  setCustomSelectValue('edit-event-reminder', rVal, reminderLabels[rVal] || 'No reminder');

  // Set up edit date picker state
  eedpSelectStart = ev.start || ev.date;
  eedpSelectEnd = ev.end || eedpSelectStart;
  document.getElementById('edit-event-start-date').value = eedpSelectStart;
  document.getElementById('edit-event-end-date').value = eedpSelectEnd;
  updateEditEventDateDisplay();

  const d = new Date(eedpSelectStart + 'T00:00:00');
  eedpYear = d.getFullYear();
  eedpMonth = d.getMonth();

  openModal('edit-event-modal');
  document.getElementById('edit-event-date-picker').style.display = 'none';
  eedpPickerOpen = false;
}

async function updateCalEvent() {
  const id = document.getElementById('edit-event-id').value;
  const title = document.getElementById('edit-event-title').value.trim();
  const start = document.getElementById('edit-event-start-date').value;
  const end = document.getElementById('edit-event-end-date').value || start;
  if (!title) return showToast('Event title required');
  if (!start) return showToast('Date required');

  const reminderVal = getCustomSelectValue('edit-event-reminder') || '';
  await fetch(`/api/calendar/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      start,
      end,
      description: document.getElementById('edit-event-desc').value,
      color: document.getElementById('edit-event-color').value,
      reminder: reminderVal !== '' ? parseInt(reminderVal) : null,
    })
  });

  closeModal('edit-event-modal');
  renderCalendar();
  showToast('Event updated!');
}

// ── Calendar Event Banner & Reminders ──────────────────────────────────
let _eventBannerDismissed = false;

async function checkTodayEvents() {
  try {
    const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
    const events = calData.shared || [];
    if (!events.length) return;

    const _n = getNow();
    const today = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
    const todayEvents = events.filter(ev => {
      const start = ev.start || ev.date;
      const end = ev.end || start;
      return start <= today && today <= end;
    });

    // Show today's events banner
    const banner = document.getElementById('event-today-banner');
    const textEl = document.getElementById('event-today-text');
    if (banner && textEl && todayEvents.length > 0 && !_eventBannerDismissed) {
      const names = todayEvents.map(e => e.title).join(', ');
      textEl.textContent = 'Today: ' + names;
      banner.style.display = '';
    }

    // Check reminders — show toast for events with reminders matching today (once per session)
    const todayDate = new Date(today + 'T00:00:00');
    events.forEach(ev => {
      if (ev.reminder == null) return;
      const evStart = new Date((ev.start || ev.date) + 'T00:00:00');
      const daysUntil = Math.round((evStart - todayDate) / 86400000);
      if (daysUntil === ev.reminder) {
        const shownKey = 'rkk-event-reminder-shown-' + ev.id;
        if (sessionStorage.getItem(shownKey)) return;
        sessionStorage.setItem(shownKey, '1');
        const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
        showToast(`📅 Reminder: "${ev.title}" is ${when}!`);
      }
    });
  } catch {}
}

function dismissEventBanner() {
  _eventBannerDismissed = true;
  const banner = document.getElementById('event-today-banner');
  if (banner) banner.style.display = 'none';
}

// ── Vault ──────────────────────────────────────────────────────────────
let vaultTab = 'mine';
let vaultDragId = null;
let vaultDragOccurred = false;
let currentPreviewItemId = null;
let currentVaultFolder = null;
let vaultFolderPath = [];  // [{id, name}, ...]
let lastVaultData = null;

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

function lockVault() { resetVault(); vaultPasscode = null; currentVaultFolder = null; vaultFolderPath = []; lastVaultData = null; }

async function refreshVault() {
  if (!vaultPasscode) return;
  try {
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
  } catch(e) { console.error('Failed to refresh locker:', e); }
}

function switchVaultTab(tab, el) {
  vaultTab = tab;
  currentVaultFolder = null;
  vaultFolderPath = [];
  document.querySelectorAll('#vault-content .section-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json()).then(renderVault);
}

function renderVault(data) {
  lastVaultData = data;
  const allItems = vaultTab === 'mine' ? (data[currentUser] || []) : (data[otherUser] || []);
  // Filter to current folder
  const items = allItems.filter(i => (i.folder || null) === currentVaultFolder);
  const grid = document.getElementById('vault-grid');
  const isMine = vaultTab === 'mine';

  // Render breadcrumb
  renderVaultBreadcrumb();

  if (!items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon"><i data-lucide="folder-lock" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">' + (currentVaultFolder ? 'This folder is empty' : 'No files yet') + '</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }

  // Folders first, then files/links
  const folders = items.filter(i => i.type === 'folder');
  const files = items.filter(i => i.type !== 'folder');

  let html = '';

  // Render folders
  folders.forEach(item => {
    const escapedName = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    html += `
      <div class="vault-item vault-folder" data-id="${item.id}" draggable="true"
        onclick="if(!vaultDragOccurred)navigateVaultFolder('${item.id}','${escapedName}')"
        ondragstart="vaultDragStart(event,'${item.id}')"
        ondragend="vaultDragEnd(event)"
        ondragover="vaultDragOver(event,'${item.id}','folder')"
        ondragleave="vaultDragLeave(event)"
        ondrop="vaultDrop(event,'${item.id}','folder')">
        <div class="vault-item-icon"><i data-lucide="folder" style="width:32px;height:32px;color:var(--accent)"></i></div>
        <div class="vault-item-name">${item.name}</div>
        <div class="vault-item-meta">${formatDate(item.uploadedAt)}</div>
        ${isMine ? `<div class="vault-item-actions">
          <button class="vault-action-btn" onclick="event.stopPropagation();renameVaultItem('${item.id}','${escapedName}')" title="Rename"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="vault-action-btn vault-action-del" onclick="event.stopPropagation();deleteVaultItem('${item.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>` : ''}
      </div>`;
  });

  // Render files/links
  files.forEach(item => {
    const icon = item.type === 'link' ? '<i data-lucide="link" style="width:22px;height:22px;color:var(--accent)"></i>' : getFileIcon(item.mimeType);
    const mime = item.mimeType || '';
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
      : `openVaultPreview('${escapedUrl}','${escapedName}','${mime}','${item.id}')`;
    html += `
      <div class="vault-item" data-id="${item.id}" draggable="true"
        onclick="if(!vaultDragOccurred)${clickAction}"
        ondragstart="vaultDragStart(event,'${item.id}')"
        ondragend="vaultDragEnd(event)"
        ondragover="vaultDragOver(event,'${item.id}','file')"
        ondragleave="vaultDragLeave(event)"
        ondrop="vaultDrop(event,'${item.id}','file')">
        ${thumbHtml}
        <div class="vault-item-name">${item.name}</div>
        <div class="vault-item-meta">${formatDate(item.uploadedAt)}</div>
        ${isMine ? `<div class="vault-item-actions">
          <button class="vault-action-btn" onclick="event.stopPropagation();renameVaultItem('${item.id}','${escapedName}')" title="Rename"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="vault-action-btn" onclick="event.stopPropagation();moveVaultItem('${item.id}')" title="Move to folder"><i data-lucide="folder-input" style="width:14px;height:14px"></i></button>
          <button class="vault-action-btn vault-action-del" onclick="event.stopPropagation();deleteVaultItem('${item.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>` : ''}
      </div>`;
  });

  grid.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderVaultBreadcrumb() {
  const bc = document.getElementById('vault-breadcrumb');
  if (!bc) return;
  if (!currentVaultFolder) { bc.style.display = 'none'; return; }
  bc.style.display = 'flex';
  let html = `<span class="vault-bc-item" onclick="navigateVaultBreadcrumb(-1)"><i data-lucide="home" style="width:14px;height:14px"></i></span>`;
  vaultFolderPath.forEach((f, i) => {
    html += `<span class="vault-bc-sep">/</span><span class="vault-bc-item" onclick="navigateVaultBreadcrumb(${i})">${f.name}</span>`;
  });
  bc.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function navigateVaultFolder(id, name) {
  currentVaultFolder = id;
  vaultFolderPath.push({ id, name });
  if (lastVaultData) renderVault(lastVaultData);
}

function navigateVaultBreadcrumb(index) {
  if (index < 0) {
    currentVaultFolder = null;
    vaultFolderPath = [];
  } else {
    vaultFolderPath = vaultFolderPath.slice(0, index + 1);
    currentVaultFolder = vaultFolderPath[index].id;
  }
  if (lastVaultData) renderVault(lastVaultData);
}

function showVaultNameModal(title, defaultValue, onConfirm) {
  const modal = document.getElementById('vault-name-modal');
  const input = document.getElementById('vault-name-input');
  const confirmBtn = document.getElementById('vault-name-confirm');
  document.getElementById('vault-name-modal-title').textContent = title;
  input.value = defaultValue || '';
  openModal('vault-name-modal');
  setTimeout(() => { input.focus(); input.select(); }, 50);
  const handler = async () => {
    const val = input.value.trim();
    if (!val) return;
    confirmBtn.removeEventListener('click', handler);
    input.removeEventListener('keydown', keyHandler);
    closeModal('vault-name-modal');
    await onConfirm(val);
  };
  const keyHandler = (e) => { if (e.key === 'Enter') handler(); };
  confirmBtn.replaceWith(confirmBtn.cloneNode(true)); // clear old listeners
  const freshBtn = document.getElementById('vault-name-confirm');
  freshBtn.addEventListener('click', handler);
  input.addEventListener('keydown', keyHandler, { once: false });
  modal._keyHandler = keyHandler;
}

function vaultNameConflict(newName, excludeId) {
  if (!lastVaultData) return false;
  const items = (lastVaultData[currentUser] || []).filter(i => (i.folder || null) === currentVaultFolder);
  return items.some(i => i.id !== excludeId && i.name.toLowerCase() === newName.toLowerCase());
}

async function renameVaultItem(id, currentName) {
  showVaultNameModal('Rename', currentName, async (newName) => {
    if (newName === currentName) return;
    if (vaultNameConflict(newName, id)) {
      showToast('A file with that name already exists in this folder');
      return;
    }
    await fetch(`/api/vault/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, name: newName })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Renamed!');
  });
}

async function createVaultFolder() {
  showVaultNameModal('New Folder', '', async (name) => {
    if (vaultNameConflict(name, null)) {
      showToast('A folder with that name already exists here');
      return;
    }
    const fd = new FormData();
    fd.append('passcode', vaultPasscode);
    fd.append('folderName', name);
    if (currentVaultFolder) fd.append('folder', currentVaultFolder);
    await fetch('/api/vault', { method: 'POST', body: fd });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Folder created!');
  });
}

// ── Vault drag-and-drop ──────────────────────────────────────────────
function vaultDragStart(e, id) {
  vaultDragId = id;
  vaultDragOccurred = false;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => {
    const el = document.querySelector(`.vault-item[data-id="${id}"]`);
    if (el) el.classList.add('vault-dragging');
  }, 0);
}

function vaultDragEnd(e) {
  vaultDragOccurred = vaultDragId !== null;
  vaultDragId = null;
  document.querySelectorAll('.vault-item').forEach(el => {
    el.classList.remove('vault-dragging', 'vault-drop-target', 'vault-drop-before', 'vault-drop-after');
  });
  setTimeout(() => { vaultDragOccurred = false; }, 100);
}

function vaultDragOver(e, targetId, targetType) {
  if (!vaultDragId || vaultDragId === targetId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const el = e.currentTarget;
  el.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-drop-target');
  if (targetType === 'folder') {
    el.classList.add('vault-drop-target');
  } else {
    const rect = el.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) el.classList.add('vault-drop-before');
    else el.classList.add('vault-drop-after');
  }
}

function vaultDragLeave(e) {
  e.currentTarget.classList.remove('vault-drop-target', 'vault-drop-before', 'vault-drop-after');
}

async function vaultDrop(e, targetId, targetType) {
  e.preventDefault();
  const draggedId = vaultDragId;
  if (!draggedId || draggedId === targetId) return;
  document.querySelectorAll('.vault-item').forEach(el =>
    el.classList.remove('vault-dragging', 'vault-drop-target', 'vault-drop-before', 'vault-drop-after'));
  vaultDragId = null;

  if (targetType === 'folder') {
    await fetch(`/api/vault/${draggedId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, folder: targetId })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Moved into folder!');
  } else {
    const grid = document.getElementById('vault-grid');
    const els = [...grid.querySelectorAll('.vault-item[data-id]')];
    const ids = els.map(el => el.dataset.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const el = grid.querySelector(`.vault-item[data-id="${targetId}"]`);
    const rect = el.getBoundingClientRect();
    const insertAfter = e.clientX >= rect.left + rect.width / 2;
    ids.splice(fromIdx, 1);
    const newTo = ids.indexOf(targetId);
    ids.splice(insertAfter ? newTo + 1 : newTo, 0, draggedId);
    await fetch('/api/vault-reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, order: ids })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
  }
}

// ── Move to folder picker ────────────────────────────────────────────
async function moveVaultItem(id) {
  if (!lastVaultData) return;
  const allItems = lastVaultData[currentUser] || [];
  const folders = allItems.filter(i => i.type === 'folder' && i.id !== id);
  const list = document.getElementById('vault-move-folder-list');
  if (!list) return;
  list.innerHTML = '';

  const doMove = async (folderId, label) => {
    closeModal('vault-move-modal');
    await fetch(`/api/vault/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, folder: folderId })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Moved to ' + label + '!');
  };

  if (currentVaultFolder) {
    const btn = document.createElement('button');
    btn.className = 'vault-move-folder-btn';
    btn.innerHTML = '<i data-lucide="home" style="width:15px;height:15px"></i><span>Root folder</span>';
    btn.onclick = () => doMove(null, 'root');
    list.appendChild(btn);
  }

  if (!folders.length && !currentVaultFolder) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:4px 0">No folders yet — create one first.</div>';
  } else {
    folders.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'vault-move-folder-btn';
      btn.innerHTML = `<i data-lucide="folder" style="width:15px;height:15px;color:var(--accent)"></i><span>${f.name}</span>`;
      btn.onclick = () => doMove(f.id, f.name);
      list.appendChild(btn);
    });
  }

  openModal('vault-move-modal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openVaultPreview(url, name, mime, itemId) {
  const body = document.getElementById('vault-preview-body');
  const titleEl = document.getElementById('vault-preview-name');
  const openBtn = document.getElementById('vault-preview-open');
  const dlBtn = document.getElementById('vault-preview-download');
  const renameBtn = document.getElementById('vault-preview-rename');
  currentPreviewItemId = itemId || null;
  titleEl.textContent = name || 'File';
  openBtn.onclick = () => window.open(url, '_blank');
  dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url; a.download = name || 'file'; a.click();
  };
  if (renameBtn) {
    renameBtn.style.display = itemId ? '' : 'none';
    renameBtn.onclick = () => {
      closeModal('vault-preview-modal');
      renameVaultItem(itemId, name);
    };
  }

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
  if (currentVaultFolder) fd.append('folder', currentVaultFolder);
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
  if (currentVaultFolder) fd.append('folder', currentVaultFolder);
  Array.from(input.files).forEach(f => fd.append('files', f));
  await fetch('/api/vault', { method: 'POST', body: fd });
  closeModal('vault-upload-modal');
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
  showToast('Files added to locker!');
}

// Vault dropzone drag-and-drop
function setupVaultDropzone() {
  const dropzone = document.getElementById('vault-dropzone');
  if (!dropzone) return;
  let dragCounter = 0;
  dropzone.addEventListener('dragenter', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter++;
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropzone.classList.remove('drag-over'); }
  });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  dropzone.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    if (!vaultPasscode) { showToast('Please unlock the locker first.'); return; }
    const fd = new FormData();
    fd.append('passcode', vaultPasscode);
    Array.from(files).forEach(f => fd.append('files', f));
    await fetch('/api/vault', { method: 'POST', body: fd });
    closeModal('vault-upload-modal');
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Files added to locker!');
  });
}
document.addEventListener('DOMContentLoaded', setupVaultDropzone);

async function deleteVaultItem(id) {
  const ok = await showConfirmDialog({ icon: '🔒', title: 'Remove from locker?', msg: 'This file will be permanently removed.', okText: 'Remove' });
  if (!ok) return;
  await fetch(`/api/vault/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: vaultPasscode })
  });
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
}

function getFileIcon(mime = '') {
  const s = 'width:22px;height:22px;color:var(--accent)';
  if (mime.startsWith('image')) return `<i data-lucide="image" style="${s}"></i>`;
  if (mime.startsWith('video')) return `<i data-lucide="film" style="${s}"></i>`;
  if (mime.startsWith('audio')) return `<i data-lucide="music" style="${s}"></i>`;
  if (mime.includes('pdf')) return `<i data-lucide="file-text" style="${s}"></i>`;
  if (mime.includes('word') || mime.includes('document')) return `<i data-lucide="file-pen" style="${s}"></i>`;
  return `<i data-lucide="file" style="${s}"></i>`;
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
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="contact" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">No contacts found</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }

  // Sort
  const sortBy = getCustomSelectValue('contacts-sort') || 'name-asc';
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
      <button class="btn-primary" onclick="editContact('${c.id}')" style="flex:1;border-radius:10px"><i data-lucide="pencil"></i> Edit</button>
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
  const modal = document.getElementById('new-contact-modal');
  const editId = modal.dataset.editId;
  try {
    const url = editId ? `/api/contacts/${editId}` : '/api/contacts';
    const method = editId ? 'PUT' : 'POST';
    const resp = await fetch(url, { method, body: fd });
    const result = await resp.json();
    if (!result.success) { showToast('Failed to save contact'); return; }
    // Clear form
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-email').value = '';
    document.getElementById('contact-notes').value = '';
    document.getElementById('contact-photo-input').value = '';
    closeModal('new-contact-modal');
    delete modal.dataset.editId;
    modal.querySelector('.modal-title').innerHTML = '<i data-lucide="user-plus" style="width:16px;height:16px"></i> New Contact';
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

async function editContact(id) {
  const c = allContactsCache.find(x => x.id === id);
  if (!c) return;
  closeModal('contact-detail-modal');
  // Populate the new contact modal with existing data for editing
  setTimeout(() => {
    document.getElementById('contact-name').value = c.name || '';
    document.getElementById('contact-phone').value = c.phone || '';
    document.getElementById('contact-email').value = c.email || '';
    document.getElementById('contact-notes').value = c.notes || '';
    // Change modal to edit mode
    const modal = document.getElementById('new-contact-modal');
    modal.dataset.editId = id;
    modal.querySelector('.modal-title').innerHTML = '<i data-lucide="pencil" style="width:16px;height:16px"></i> Edit Contact';
    if (window.lucide) lucide.createIcons();
    openModal('new-contact-modal');
  }, 200);
}

// ── Announcements ─────────────────────────────────────────────────────
async function loadAnnouncements() {
  const anns = await fetch('/api/announcements').then(r => r.json());
  const list = document.getElementById('announcements-list');
  if (!list) return;
  if (!anns.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="megaphone" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">No announcements</div></div>';if(window.lucide)lucide.createIcons();
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
    if (relevant.length > 0) {
      showBanner(relevant[0]);
      SoundSystem.notify();
    }
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
    body: JSON.stringify({ title, content, targetUser: getCustomSelectValue('ann-target') || 'both' })
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
let activeGuestChannel = null; // 'group', 'kaliph', 'kathrine', or a guest-* channel
let guestData = [];
// { 'guestId:channel': count } — persisted in sessionStorage across section switches
let guestUnread = JSON.parse(sessionStorage.getItem('guestUnread') || '{}');
// Track which guest IDs have had socket listeners registered
const _guestListenersRegistered = new Set();

function _persistGuestUnread() {
  sessionStorage.setItem('guestUnread', JSON.stringify(guestUnread));
}

async function loadGuestMessages() {
  const prevActiveId = activeGuestId;
  const prevActiveCh = activeGuestChannel;
  try {
    const res = await fetch('/api/guest-messages');
    if (!res.ok) return;
    guestData = await res.json();
  } catch { guestData = []; }
  // Restore active selection if the guest is still present
  if (prevActiveId && !guestData.find(g => g.id === prevActiveId)) {
    activeGuestId = null;
    activeGuestChannel = null;
  }
  renderGuestList();
  setupGuestSocketListeners();
}

function setupGuestSocketListeners() {
  // Remove listeners for guests that are no longer in guestData
  const currentIds = new Set(guestData.map(g => g.id));
  for (const id of _guestListenersRegistered) {
    if (!currentIds.has(id)) {
      socket.off(`guest-msg-${id}-group`);
      socket.off(`guest-msg-${id}-${currentUser}`);
      _guestListenersRegistered.delete(id);
    }
  }

  // Register master events only once (they are not per-guest so always safe to re-register)
  socket.off('guest-created');
  socket.on('guest-created', async () => {
    await loadGuestMessages();
  });

  socket.off('guest-revoked');
  socket.on('guest-revoked', ({ guestId }) => {
    guestData = guestData.filter(g => g.id !== guestId);
    _guestListenersRegistered.delete(guestId);
    socket.off(`guest-msg-${guestId}-group`);
    socket.off(`guest-msg-${guestId}-${currentUser}`);
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

  // Add listeners only for guests not yet registered
  guestData.forEach(g => {
    if (_guestListenersRegistered.has(g.id)) return;
    _guestListenersRegistered.add(g.id);

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
        _persistGuestUnread();
        renderGuestList();
      }
      if (msg.sender !== currentUser) {
        updateGuestNavBadge();
        if (currentSection !== 'guest-messages' || activeGuestId !== g.id || activeGuestChannel !== channel) {
          const chLabel = channel === 'group' ? 'Group' : 'DM';
          sendDesktopNotif(`${msg.sender} (${chLabel})`, msg.text?.substring(0, 80) || 'New message');
          SoundSystem.receive();
          const gId = g.id, gCh = channel;
          showMsgNotif(`${msg.sender} · ${chLabel}`, msg.text?.substring(0, 80) || 'New message', guest?.avatar, () => {
            showSection('guest-messages', document.querySelector('.nav-item[data-section="guest-messages"]'));
            selectGuest(gId, gCh);
          });
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

// Delegated click handler for #guest-list — wired up once in DOMContentLoaded
function _initGuestListDelegate() {
  const list = document.getElementById('guest-list');
  if (!list || list._delegateReady) return;
  list._delegateReady = true;
  list.addEventListener('click', e => {
    const item = e.target.closest('[data-guest-id]');
    if (!item) return;
    selectGuest(item.dataset.guestId, item.dataset.guestChannel);
  });
}

function renderGuestList() {
  const list = document.getElementById('guest-list');
  const badge = document.getElementById('guest-count-badge');
  if (!list) return;
  _initGuestListDelegate();
  if (badge) badge.textContent = guestData.length;
  if (!guestData.length) {
    list.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;height:auto"><div class="empty-state-icon"><i data-lucide="user-x" style="width:32px;height:32px;opacity:0.4"></i></div><div class="empty-state-text" style="font-size:0.82rem">No active guests</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Build separate entries per channel, sort by most recent message
  const entries = [];
  guestData.forEach(g => {
    const channels = g.channels || {};
    const channelIds = ['group', currentUser].filter(ch => {
      const msgs = channels[ch];
      return msgs && msgs.length > 0;
    });
    if (!channelIds.length) channelIds.push('group');
    channelIds.forEach(ch => {
      const msgs = channels[ch] || [];
      const lastMsg = msgs[msgs.length - 1];
      const lastTs = lastMsg ? lastMsg.timestamp : 0;
      entries.push({ g, ch, lastMsg, lastTs });
    });
  });

  entries.sort((a, b) => b.lastTs - a.lastTs);

  let html = '';
  entries.forEach(({ g, ch, lastMsg }) => {
    const rawPreview = lastMsg ? (lastMsg.text || '') : '';
    const preview = rawPreview.length > 30 ? rawPreview.slice(0, 30) + '…' : (rawPreview || 'No messages yet');
    const time = lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const unreadKey = g.id + ':' + ch;
    const unread = guestUnread[unreadKey] || 0;
    const isActive = activeGuestId === g.id && activeGuestChannel === ch;
    const chLabel = ch === 'group' ? 'Group' : 'DM';
    // data-* attributes instead of inline onclick to avoid XSS from names
    html += `<div class="guest-list-item ${isActive ? 'active' : ''}" data-guest-id="${escapeHtml(g.id)}" data-guest-channel="${escapeHtml(ch)}" role="button" tabindex="0">
      <div class="guest-item-avatar">${g.avatar ? `<img src="${escapeHtml(g.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : escapeHtml(g.name[0].toUpperCase())}</div>
      <div class="guest-item-info">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="guest-item-name">${escapeHtml(g.name)} <span style="font-size:0.65rem;color:var(--text-muted);font-weight:400">· ${escapeHtml(chLabel)}</span></div>
          ${time ? `<span style="font-size:0.65rem;color:var(--text-muted);flex-shrink:0">${escapeHtml(time)}</span>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <div class="guest-item-meta">${escapeHtml(preview)}</div>
          ${unread ? `<span class="guest-unread-badge">${unread}</span>` : ''}
        </div>
      </div>
    </div>`;
  });
  list.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function selectGuest(guestId, channel) {
  activeGuestId = guestId;
  activeGuestChannel = channel || 'group';
  // Clear unread for this specific guest+channel and persist
  delete guestUnread[guestId + ':' + activeGuestChannel];
  _persistGuestUnread();
  updateGuestNavBadge();
  renderGuestList();
  renderGuestChat();
  document.getElementById('guest-chat-header').style.display = '';
  document.getElementById('guest-reply-bar').style.display = '';
  if (window.lucide) lucide.createIcons();
}

function _updateGuestChannelTabs() {
  const guest = guestData.find(g => g.id === activeGuestId);
  const tabsEl = document.getElementById('guest-channel-tabs');
  if (!tabsEl || !guest) return;
  // Build available channels for this guest (group + DM channels)
  const availableChannels = ['group', currentUser].filter(ch =>
    (guest.channels && (ch === 'group' || guest.channels[ch] !== undefined)) || ch === 'group'
  );
  tabsEl.innerHTML = availableChannels.map(ch => {
    const label = ch === 'group' ? 'Group' : 'DM';
    const isActive = activeGuestChannel === ch;
    return `<button class="guest-ch-tab${isActive ? ' active' : ''}" data-channel="${escapeHtml(ch)}">${escapeHtml(label)}</button>`;
  }).join('');
  tabsEl.querySelectorAll('.guest-ch-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      selectGuest(activeGuestId, btn.dataset.channel);
    });
  });
}

function renderGuestChat() {
  const area = document.getElementById('guest-messages-area');
  if (!area || !activeGuestId || !activeGuestChannel) return;
  const guest = guestData.find(g => g.id === activeGuestId);
  if (!guest) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-text">Guest not found</div></div>';
    return;
  }

  // Update header
  document.getElementById('guest-chat-name').textContent = escapeHtml(guest.name);
  const gciEl = document.getElementById('guest-chat-initial');
  if (guest.avatar) gciEl.innerHTML = `<img src="${escapeHtml(guest.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  else gciEl.textContent = guest.name[0].toUpperCase();
  _updateGuestChannelTabs();

  // Show only the selected channel's messages
  const msgs = (guest.channels || {})[activeGuestChannel] || [];

  if (!msgs.length) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-circle" style="width:36px;height:36px;opacity:0.35"></i></div><div class="empty-state-text">No messages yet</div><div class="empty-state-sub">Send a message to start the conversation</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Scroll-preservation: if user is near bottom, auto-scroll; otherwise show nudge
  const wasNearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 60;

  area.innerHTML = msgs.map((m, i) => {
    const isSelf = m.sender === currentUser;
    const isHost = m.sender === 'kaliph' || m.sender === 'kathrine';
    const senderName = isHost ? capitalize(m.sender) : escapeHtml(m.sender);
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const prev = msgs[i - 1];
    const sameSender = prev && prev.sender === m.sender && (m.timestamp - prev.timestamp < 120000);
    const chatColor = m.sender === 'kaliph' ? 'var(--kaliph-color, #7c3aed)' : m.sender === 'kathrine' ? 'var(--kathrine-color, #c084fc)' : 'var(--accent)';
    const userData = isHost && window._users ? window._users[m.sender] : null;
    const gAvatar = !isHost && !isSelf && guest?.avatar ? guest.avatar : null;
    const avatarInner = userData?.avatar
      ? `<img src="${escapeHtml(userData.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : gAvatar
        ? `<img src="${escapeHtml(gAvatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : escapeHtml((m.sender || 'G')[0].toUpperCase());

    return `<div class="guest-msg-row ${isSelf ? 'self' : ''}${sameSender ? ' same-sender' : ''}">
      ${!isSelf ? `<div class="guest-msg-avatar" style="${sameSender ? 'visibility:hidden' : ''};background:${chatColor}">${avatarInner}</div>` : ''}
      <div class="guest-msg-content">
        ${!sameSender ? `<div class="guest-msg-sender ${isSelf ? 'self' : ''}" style="color:${chatColor}">${senderName}</div>` : ''}
        <div class="guest-msg-bubble ${isSelf ? 'self' : 'other'}">
          <span>${escapeHtml(m.text)}</span>
          <span class="guest-msg-time">${escapeHtml(time)}</span>
        </div>
      </div>
      ${isSelf ? `<div class="guest-msg-avatar" style="${sameSender ? 'visibility:hidden' : ''};background:${chatColor}">${avatarInner}</div>` : ''}
    </div>`;
  }).join('');

  if (wasNearBottom) {
    area.scrollTop = area.scrollHeight;
    // Remove any existing nudge
    const existingNudge = area.parentElement?.querySelector('.guest-msg-nudge');
    if (existingNudge) existingNudge.remove();
  } else {
    // Show a nudge button so the user can scroll to new messages
    const parent = area.parentElement;
    if (parent && !parent.querySelector('.guest-msg-nudge')) {
      const nudge = document.createElement('button');
      nudge.className = 'guest-msg-nudge';
      nudge.textContent = '↓ New message';
      nudge.addEventListener('click', () => {
        area.scrollTop = area.scrollHeight;
        nudge.remove();
      });
      parent.appendChild(nudge);
    }
  }
  if (window.lucide) lucide.createIcons();
}

let _guestReplySending = false;
async function sendGuestReply() {
  if (_guestReplySending) return;
  const input = document.getElementById('guest-reply-input');
  const sendBtn = document.querySelector('.guest-send-btn');
  const text = input.value.trim();
  if (!text || !activeGuestId || !activeGuestChannel) return;
  _guestReplySending = true;
  if (sendBtn) sendBtn.disabled = true;
  input.value = '';
  try {
    const res = await fetch(`/api/guests/${activeGuestId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target: activeGuestChannel, sender: currentUser })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to send');
    }
  } catch (e) {
    showToast('Failed to send');
  } finally {
    _guestReplySending = false;
    if (sendBtn) sendBtn.disabled = false;
    input.focus();
  }
}

// ── Settings ──────────────────────────────────────────────────────────
function openSettingsModal() {
  SoundSystem.modalOpen();
  const modal = document.getElementById('settings-modal');
  modal.classList.add('open');
  loadSettings();
  loadGuests();
  loadSuggestions();
  loadBellSchedule().then(() => loadBellScheduleUI());
  // Load TOTP password status for security tab
  fetch('/api/totp/status').then(r => r.json()).then(s => updateTotpSettingsUI(s.hasPassword)).catch(() => {});
  if (window.lucide) lucide.createIcons();
  // Close mobile sidebar when opening settings on tablet
  if (window.innerWidth <= 834) closeMobileSidebar();
}

function switchSettingsTab(tab, el) {
  SoundSystem.navigate();
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

// ── BELL SCHEDULE ──────────────────────────────────────────────────────────
window._bellSchedule = null;
window._scheduleSkips = {};
window._countdownEnabled = true;
let _classInterval = null;

async function loadBellSchedule() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    window._bellSchedule = s.bellSchedule || { kaliph: { regular: [], lateStart: [], lateStartDay: '' }, kathrine: { regular: [], lateStart: [], lateStartDay: '' } };
    window._scheduleSkips = s._scheduleSkips || {};
    if (s.preferences && s.preferences[currentUser]) {
      window._countdownEnabled = s.preferences[currentUser].countdownEnabled !== false;
    }
    const toggle = document.getElementById('toggle-countdown');
    if (toggle) toggle.checked = window._countdownEnabled;
    // Apply any active time override
    if (s.timeOffset) {
      window._timeOffsetMs = parseTimeOffset(s.timeOffset);
    }
    return window._bellSchedule;
  } catch { return null; }
}

function loadBellScheduleUI() {
  const bs = window._bellSchedule;
  if (!bs) return;
  const person = currentUser; // only show current user's schedule
  const data = bs[person] || { regular: [], lateStart: [], lateStartDay: '' };
  const label = document.getElementById('my-schedule-label');
  if (label) label.textContent = (person === 'kaliph' ? "Kaliph's" : "Kathrine's") + ' Schedule';
  // Set late day via custom select
  const dayVal = data.lateStartDay || '';
  setCustomSelectValue('late-day-mine', dayVal, dayVal ? dayVal.charAt(0).toUpperCase() + dayVal.slice(1) : 'None');
  renderScheduleList('mine', 'regular', data.regular || []);
  renderScheduleList('mine', 'lateStart', data.lateStart || []);
}

function renderScheduleList(person, type, periods) {
  const list = document.getElementById(`schedule-list-${person}-${type}`);
  if (!list) return;
  if (!periods.length) { list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">No periods added yet.</div>'; return; }
  list.innerHTML = periods.map((p, i) => `
    <div class="schedule-row">
      <input type="text" value="${escapeHtml(p.label || '')}" placeholder="Period name" data-field="label">
      <div class="custom-time-input" data-field="start" data-value="${p.start || ''}">
        <button type="button" class="custom-time-btn" onclick="openTimePicker(this)">${p.start ? formatTime12(p.start) : 'Start'}</button>
      </div>
      <div class="custom-time-input" data-field="end" data-value="${p.end || ''}">
        <button type="button" class="custom-time-btn" onclick="openTimePicker(this)">${p.end ? formatTime12(p.end) : 'End'}</button>
      </div>
      <button class="email-remove-btn" onclick="removePeriodRow('${person}','${type}',${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `).join('');
}

function switchScheduleType(person, type, btn) {
  const group = btn.closest('.schedule-person-group');
  group.querySelectorAll('.schedule-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  group.querySelectorAll('.schedule-list').forEach(l => l.style.display = 'none');
  const target = document.getElementById(`schedule-list-${person}-${type}`);
  if (target) target.style.display = '';
}

function getActiveScheduleType(person) {
  const group = document.getElementById(`schedule-list-${person}-regular`)?.closest('.schedule-person-group');
  if (!group) return 'regular';
  const activeBtn = group.querySelector('.schedule-type-btn.active');
  return activeBtn?.textContent.trim() === 'Late Start' ? 'lateStart' : 'regular';
}

function addPeriodRow(person) {
  const type = getActiveScheduleType(person);
  const periods = getScheduleValues(person, type);
  periods.push({ label: '', start: '', end: '' });
  renderScheduleList(person, type, periods);
  const list = document.getElementById(`schedule-list-${person}-${type}`);
  const inputs = list?.querySelectorAll('input[type="text"]');
  if (inputs?.length) inputs[inputs.length - 1].focus();
}

function removePeriodRow(person, type, index) {
  const periods = getScheduleValues(person, type);
  periods.splice(index, 1);
  renderScheduleList(person, type, periods);
}

function getScheduleValues(person, type) {
  const list = document.getElementById(`schedule-list-${person}-${type}`);
  if (!list) return [];
  return Array.from(list.querySelectorAll('.schedule-row')).map(row => ({
    label: row.querySelector('[data-field="label"]')?.value.trim() || '',
    start: row.querySelector('.custom-time-input[data-field="start"]')?.dataset.value || '',
    end: row.querySelector('.custom-time-input[data-field="end"]')?.dataset.value || '',
  }));
}

async function saveBellSchedule() {
  // Merge with existing schedule so we don't overwrite the other user's data
  const existing = window._bellSchedule || { kaliph: { regular: [], lateStart: [], lateStartDay: '' }, kathrine: { regular: [], lateStart: [], lateStartDay: '' } };
  const me = currentUser;
  const lateDayVal = getCustomSelectValue('late-day-mine');
  existing[me] = {
    regular: getScheduleValues('mine', 'regular'),
    lateStart: getScheduleValues('mine', 'lateStart'),
    lateStartDay: lateDayVal,
  };
  const resp = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bellSchedule: existing }) });
  if (!resp.ok) { SoundSystem.error(); showToast('Failed to save schedule'); return; }
  window._bellSchedule = existing;
  updateClassDisplays();
  SoundSystem.success();
  showToast('Bell schedule saved!');
}

function toggleCountdown(el) {
  SoundSystem.toggle();
  window._countdownEnabled = el.checked;
  fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countdownEnabled: el.checked }) });
  updateClassDisplays();
}

// ── CUSTOM UI COMPONENTS ──────────────────────────────────────────────────

// ── Custom Select Dropdown ────────────────────────────────────────────────
function toggleCustomSelect(id) {
  const dropdown = document.getElementById(id + '-dropdown');
  if (!dropdown) return;
  const isOpen = dropdown.style.display !== 'none';
  closeAllCustomSelects();
  if (!isOpen) dropdown.style.display = '';
}
function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select-dropdown').forEach(d => d.style.display = 'none');
}
function selectCustomOption(id, value, label) {
  const btn = document.getElementById(id + '-btn');
  if (btn) btn.querySelector('.custom-select-text').textContent = label;
  const dropdown = document.getElementById(id + '-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
    dropdown.style.display = 'none';
  }
  // Store value on the wrap
  const wrap = document.getElementById(id + '-wrap');
  if (wrap) wrap.dataset.value = value;
}
function getCustomSelectValue(id) {
  // Try id-wrap first, then find wrap as parent of dropdown
  let wrap = document.getElementById(id + '-wrap');
  if (!wrap) {
    const dd = document.getElementById(id + '-dropdown');
    if (dd) wrap = dd.parentElement;
  }
  return wrap?.dataset.value ?? '';
}
function setCustomSelectValue(id, value, label) {
  // Find wrap
  let wrap = document.getElementById(id + '-wrap');
  if (!wrap) {
    const dd = document.getElementById(id + '-dropdown');
    if (dd) wrap = dd.parentElement;
  }
  if (wrap) {
    wrap.dataset.value = value;
    const btn = wrap.querySelector('.custom-select-btn');
    if (btn) {
      const txt = btn.querySelector('.custom-select-text');
      if (txt) txt.textContent = label;
    }
  }
  // Also try explicit btn id
  const explicitBtn = document.getElementById(id + '-btn');
  if (explicitBtn) {
    const txt = explicitBtn.querySelector('.custom-select-text');
    if (txt) txt.textContent = label;
  }
  const dropdown = document.getElementById(id + '-dropdown');
  if (dropdown) dropdown.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select-wrap')) closeAllCustomSelects();
  if (!e.target.closest('.custom-time-picker-popup') && !e.target.closest('.custom-time-btn')) closeTimePicker();
});

// ── Custom Time Picker (for bell schedule) ────────────────────────────────
let _activeTimePicker = null;
function formatTime12(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function parseTime12(h, m, ampm) {
  let hour = parseInt(h) || 0;
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(parseInt(m) || 0).padStart(2, '0')}`;
}

function openTimePicker(btnEl) {
  closeTimePicker();
  const wrap = btnEl.closest('.custom-time-input');
  const currentVal = wrap.dataset.value || '';
  let h = 12, m = 0, ampm = 'AM';
  if (currentVal) {
    const [hh, mm] = currentVal.split(':').map(Number);
    ampm = hh >= 12 ? 'PM' : 'AM';
    h = hh % 12 || 12;
    m = mm;
  }
  const popup = document.createElement('div');
  popup.className = 'custom-time-picker-popup';
  popup.innerHTML = `
    <div class="ctp-row">
      <div class="ctp-spinbox">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'hour',1)">&#9650;</button>
        <input type="text" class="ctp-input" data-role="hour" value="${h}" maxlength="2" onclick="this.select()">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'hour',-1)">&#9660;</button>
      </div>
      <span class="ctp-colon">:</span>
      <div class="ctp-spinbox">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'minute',1)">&#9650;</button>
        <input type="text" class="ctp-input" data-role="minute" value="${String(m).padStart(2,'0')}" maxlength="2" onclick="this.select()">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'minute',-1)">&#9660;</button>
      </div>
      <button type="button" class="ctp-ampm" onclick="ctpToggleAmPm(this)">${ampm}</button>
    </div>
    <button type="button" class="btn-ghost btn-sm ctp-done" onclick="ctpDone(this)">Done</button>
  `;
  wrap.appendChild(popup);
  _activeTimePicker = { popup, wrap, btnEl };
}
function closeTimePicker() {
  if (_activeTimePicker) {
    _activeTimePicker.popup.remove();
    _activeTimePicker = null;
  }
}
function ctpSpin(el, role, dir) {
  const popup = el.closest('.custom-time-picker-popup');
  const input = popup.querySelector(`[data-role="${role}"]`);
  let val = parseInt(input.value) || 0;
  if (role === 'hour') { val += dir; if (val > 12) val = 1; if (val < 1) val = 12; input.value = val; }
  else { val += dir * 5; if (val >= 60) val = 0; if (val < 0) val = 55; input.value = String(val).padStart(2, '0'); }
}
function ctpToggleAmPm(el) { el.textContent = el.textContent === 'AM' ? 'PM' : 'AM'; }
function ctpDone(el) {
  if (!_activeTimePicker) return;
  const popup = el.closest('.custom-time-picker-popup');
  const h = popup.querySelector('[data-role="hour"]').value;
  const m = popup.querySelector('[data-role="minute"]').value;
  const ampm = popup.querySelector('.ctp-ampm').textContent;
  const time24 = parseTime12(h, m, ampm);
  _activeTimePicker.wrap.dataset.value = time24;
  _activeTimePicker.btnEl.textContent = formatTime12(time24);
  _activeTimePicker.btnEl.classList.add('has-value');
  closeTimePicker();
}

// ── Custom DateTime Picker (for reminders) ────────────────────────────────
const _cdtpState = {};
function initCdtp(id) {
  if (!_cdtpState[id]) _cdtpState[id] = { year: getNow().getFullYear(), month: getNow().getMonth(), selectedDate: null };
}
function toggleDatetimePicker(id) {
  initCdtp(id);
  const picker = document.getElementById(id + '-picker');
  if (!picker) return;
  const isOpen = picker.style.display !== 'none';
  if (isOpen) { picker.style.display = 'none'; return; }
  picker.style.display = '';
  renderCdtpCalendar(id);
}
function closeDatetimePicker(id) {
  const picker = document.getElementById(id + '-picker');
  if (picker) picker.style.display = 'none';
  // Commit value
  commitDatetimeValue(id);
}
function commitDatetimeValue(id) {
  initCdtp(id);
  const st = _cdtpState[id];
  if (!st.selectedDate) return;
  const hEl = document.getElementById(id + '-hour');
  const mEl = document.getElementById(id + '-minute');
  const apEl = document.getElementById(id + '-ampm');
  let hour = parseInt(hEl?.value) || 12;
  const minute = parseInt(mEl?.value) || 0;
  const ampm = apEl?.textContent || 'AM';
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const dt = new Date(st.selectedDate);
  dt.setHours(hour, minute, 0, 0);
  // Set the hidden input value in ISO-like format for submission
  const isoLocal = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0') + 'T' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
  document.getElementById(id).value = isoLocal;
  // Update button text
  const btn = document.getElementById(id + '-btn');
  if (btn) {
    const h12 = dt.getHours() % 12 || 12;
    const ap = dt.getHours() >= 12 ? 'PM' : 'AM';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    btn.querySelector('.custom-datetime-text').textContent = `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()} at ${h12}:${String(dt.getMinutes()).padStart(2,'0')} ${ap}`;
  }
}
function renderCdtpCalendar(id) {
  const st = _cdtpState[id];
  const grid = document.getElementById(id + '-grid');
  const label = document.getElementById(id + '-month');
  if (!grid || !label) return;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = months[st.month] + ' ' + st.year;
  // Clear day cells (keep headers)
  const headers = grid.querySelectorAll('.cdtp-day-header');
  grid.innerHTML = '';
  headers.forEach(h => grid.appendChild(h));
  const firstDay = new Date(st.year, st.month, 1).getDay();
  const daysInMonth = new Date(st.year, st.month + 1, 0).getDate();
  const today = getNow(); today.setHours(0,0,0,0);
  for (let i = 0; i < firstDay; i++) { const empty = document.createElement('div'); empty.className = 'cdtp-day cdtp-day-empty'; grid.appendChild(empty); }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cdtp-day';
    cell.textContent = d;
    const cellDate = new Date(st.year, st.month, d);
    if (cellDate.getTime() === today.getTime()) cell.classList.add('cdtp-today');
    if (st.selectedDate && cellDate.toDateString() === st.selectedDate.toDateString()) cell.classList.add('cdtp-selected');
    cell.onclick = () => { st.selectedDate = cellDate; renderCdtpCalendar(id); commitDatetimeValue(id); };
    grid.appendChild(cell);
  }
}
function cdtpPrev(id) { initCdtp(id); const st = _cdtpState[id]; st.month--; if (st.month < 0) { st.month = 11; st.year--; } renderCdtpCalendar(id); }
function cdtpNext(id) { initCdtp(id); const st = _cdtpState[id]; st.month++; if (st.month > 11) { st.month = 0; st.year++; } renderCdtpCalendar(id); }
function cdtpSpinHour(id, dir) {
  const el = document.getElementById(id + '-hour');
  let v = parseInt(el.value) || 12;
  v += dir; if (v > 12) v = 1; if (v < 1) v = 12;
  el.value = v;
  commitDatetimeValue(id);
}
function cdtpSpinMinute(id, dir) {
  const el = document.getElementById(id + '-minute');
  let v = parseInt(el.value) || 0;
  v += dir * 5; if (v >= 60) v = 0; if (v < 0) v = 55;
  el.value = String(v).padStart(2, '0');
  commitDatetimeValue(id);
}
function cdtpToggleAmPm(id) {
  const el = document.getElementById(id + '-ampm');
  el.textContent = el.textContent === 'AM' ? 'PM' : 'AM';
  commitDatetimeValue(id);
}
function cdtpClampHour(id) {
  const el = document.getElementById(id + '-hour');
  let v = parseInt(el.value) || 12;
  if (v < 1) v = 1; if (v > 12) v = 12;
  el.value = v;
  commitDatetimeValue(id);
}
function cdtpClampMinute(id) {
  const el = document.getElementById(id + '-minute');
  let v = parseInt(el.value) || 0;
  if (v < 0) v = 0; if (v > 59) v = 59;
  el.value = String(v).padStart(2, '0');
  commitDatetimeValue(id);
}
function setDatetimePickerValue(id, date) {
  initCdtp(id);
  const st = _cdtpState[id];
  st.selectedDate = new Date(date);
  st.year = st.selectedDate.getFullYear();
  st.month = st.selectedDate.getMonth();
  const h = st.selectedDate.getHours();
  const m = st.selectedDate.getMinutes();
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hEl = document.getElementById(id + '-hour');
  const mEl = document.getElementById(id + '-minute');
  const apEl = document.getElementById(id + '-ampm');
  if (hEl) hEl.value = h12;
  if (mEl) mEl.value = String(m).padStart(2, '0');
  if (apEl) apEl.textContent = ampm;
  commitDatetimeValue(id);
}
function resetDatetimePicker(id) {
  _cdtpState[id] = { year: getNow().getFullYear(), month: getNow().getMonth(), selectedDate: null };
  document.getElementById(id).value = '';
  const btn = document.getElementById(id + '-btn');
  if (btn) btn.querySelector('.custom-datetime-text').textContent = 'Select date & time...';
  const hEl = document.getElementById(id + '-hour');
  const mEl = document.getElementById(id + '-minute');
  const apEl = document.getElementById(id + '-ampm');
  if (hEl) hEl.value = '12';
  if (mEl) mEl.value = '00';
  if (apEl) apEl.textContent = 'AM';
}

// ── Custom Priority Selector ──────────────────────────────────────────────
function selectPriority(id, value) {
  const wrap = document.getElementById(id + '-wrap');
  if (wrap) wrap.querySelectorAll('.custom-priority-btn').forEach(b => b.classList.toggle('active', b.dataset.value === value));
  const hidden = document.getElementById(id);
  if (hidden) hidden.value = value;
}

// ── GET CURRENT CLASS ──────────────────────────────────────────────────────
function getCurrentClass(username) {
  const bs = window._bellSchedule;
  if (!bs || !bs[username]) return null;
  // Check if schedule is skipped today (use site time)
  const siteNow = getNow();
  const today = siteNow.toISOString().split('T')[0];
  if (window._scheduleSkips[username] === today) return null;
  const data = bs[username];
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[siteNow.getDay()];
  // Weekend — no class
  if (dayName === 'sunday' || dayName === 'saturday') return null;
  const schedule = (data.lateStartDay && data.lateStartDay === dayName) ? (data.lateStart || []) : (data.regular || []);
  if (!schedule.length) return null;
  const nowMins = siteNow.getHours() * 60 + siteNow.getMinutes();
  for (const period of schedule) {
    if (!period.start || !period.end) continue;
    const [sh, sm] = period.start.split(':').map(Number);
    const [eh, em] = period.end.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (nowMins >= startMins && nowMins < endMins) {
      return { label: period.label, start: period.start, end: period.end, endMins };
    }
  }
  return null;
}

function formatCountdown(endMins) {
  const siteNow = getNow();
  const nowMins = siteNow.getHours() * 60 + siteNow.getMinutes();
  const nowSecs = siteNow.getSeconds();
  const totalSecsLeft = (endMins - nowMins) * 60 - nowSecs;
  if (totalSecsLeft <= 0) return '0:00';
  const m = Math.floor(totalSecsLeft / 60);
  const s = totalSecsLeft % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function updateClassDisplays() {
  // Other user — chat header + profile
  const otherClass = getCurrentClass(otherUser);
  const otherLabel = document.getElementById('other-class-label');
  if (otherLabel) otherLabel.textContent = otherClass ? '📚 ' + otherClass.label : '';

  // Current user — sidebar
  const myClass = getCurrentClass(currentUser);
  const myLabel = document.getElementById('my-class-label');
  if (myLabel) myLabel.textContent = myClass ? '📚 ' + myClass.label : '';

  // Countdown bar — only for current user
  const bar = document.getElementById('class-countdown-bar');
  const textEl = document.getElementById('class-countdown-text');
  const timerEl = document.getElementById('class-countdown-timer');
  if (bar && textEl && timerEl) {
    if (myClass && window._countdownEnabled) {
      bar.style.display = '';
      textEl.textContent = myClass.label + ' ends in';
      timerEl.textContent = formatCountdown(myClass.endMins);
    } else {
      bar.style.display = 'none';
    }
  }
}

function startClassUpdater() {
  updateClassDisplays();
  if (_classInterval) clearInterval(_classInterval);
  // Update every second for smooth countdown
  _classInterval = setInterval(updateClassDisplays, 1000);
}

// Listen for schedule skip from eval
if (typeof socket !== 'undefined') {
  socket?.on('schedule-skip', data => {
    if (data.date) window._scheduleSkips[data.user] = data.date;
    else delete window._scheduleSkips[data.user];
    updateClassDisplays();
  });
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
  SoundSystem.success();
  document.getElementById('my-name').textContent = displayName;
  nameColors[currentUser] = color;
  renderMessages();
  showToast('✅ Profile saved!');
}

async function saveEmails() {
  const email = document.getElementById('my-email-input').value;
  const body = { emails: { [currentUser]: email } };
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  SoundSystem.success();
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
  SoundSystem.success();
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
    SoundSystem.success();
    showToast('🖼️ Avatar updated!');
  }
}

async function uploadBanner(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('banner', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/banner`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.banner) {
    const bannerEl = document.getElementById('profile-edit-banner');
    if (bannerEl) { bannerEl.style.backgroundImage = `url(${d.banner})`; bannerEl.style.backgroundSize = 'cover'; }
    SoundSystem.success();
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
    avatarEl.style.cursor = 'pointer';
    avatarEl.onclick = () => {
      document.getElementById('enlarged-avatar-img').src = u.avatar;
      openModal('enlarged-avatar-modal');
    };
  } else {
    avatarEl.innerHTML = `<span>${(u.displayName || u.name)[0].toUpperCase()}</span>`;
    avatarEl.onclick = null;
    avatarEl.style.cursor = '';
  }
  // Status — use live _presence from server
  const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
  const pvPresence = u._presence || 'offline';
  const pvStatus = pvPresence === 'online' ? 'online' : pvPresence === 'idle' ? 'idle' : 'invisible';
  const pvDot = document.getElementById('pv-status-dot');
  pvDot.style.background = statusColors[pvStatus] || '#22c55e';
  pvDot.className = 'pc-status-dot' + (pvStatus === 'online' ? ' online' : '');
  // Names
  const nameEl = document.getElementById('pv-name');
  nameEl.textContent = u.displayName || capitalize(u.name);
  nameEl.style.color = u.nameStyle?.color || '';
  document.getElementById('pv-username').textContent = u.name + (u.pronouns ? ' \u2022 ' + u.pronouns : '');
  // Status display (Discord style — icon + label)
  const statusSection = document.getElementById('pv-status-section');
  if (statusSection) {
    const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
    const statusLucide = { online: 'circle', idle: 'moon', dnd: 'minus-circle', invisible: 'eye-off' };
    const statusLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
    // Use live presence unless user explicitly set DND/invisible
    const userStatus = (u.status === 'dnd' || u.status === 'invisible') ? u.status : pvStatus;
    const sColor = statusColors[userStatus] || '#22c55e';
    const sIcon = statusLucide[userStatus] || 'circle';
    statusSection.innerHTML = `
      <div class="pc-section-title">STATUS</div>
      <div class="pv-status-row">
        <span class="pv-status-icon" style="color:${sColor};display:inline-flex;align-items:center"><i data-lucide="${sIcon}" style="width:14px;height:14px;fill:${userStatus === 'online' ? sColor : 'none'}"></i></span>
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
  // Current class
  const classSec = document.getElementById('pv-class-section');
  const classText = document.getElementById('pv-class-text');
  if (classSec && classText) {
    const cls = getCurrentClass(username);
    if (cls) { classSec.style.display = ''; classText.textContent = '📚 ' + cls.label + ' (' + formatTime12(cls.start) + ' – ' + formatTime12(cls.end) + ')'; }
    else classSec.style.display = 'none';
  }
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
  document.getElementById('pv-schedule-btn').style.display = 'flex';
  window._lastViewedProfileUser = username;
  openModal('profile-viewer-modal');
  if (window.lucide) lucide.createIcons();
}

// ── Schedule Viewer Modal ─────────────────────────────────────────────
function openScheduleModal() {
  const user = window._lastViewedProfileUser || currentUser;
  const bs = window._bellSchedule;
  if (!bs || !bs[user]) {
    showToast('No schedule data available.');
    return;
  }
  closeModal('profile-viewer-modal');
  const data = bs[user];
  const displayName = user === 'kaliph' ? 'Kaliph' : 'Kathrine';
  document.getElementById('schedule-viewer-title').textContent = displayName + "'s Schedule";
  const regular = data.regular || [];
  const lateStart = data.lateStart || [];
  const lateDay = data.lateStartDay || '';

  let html = '';
  // Regular schedule
  html += '<div style="margin-bottom:16px"><div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary);margin-bottom:8px">Regular Schedule</div>';
  if (regular.length) {
    html += '<div class="schedule-view-table">';
    regular.forEach(p => {
      html += `<div class="schedule-view-row">
        <span class="schedule-view-label">${escapeHtml(p.label || 'Period')}</span>
        <span class="schedule-view-time">${p.start ? formatTime12(p.start) : '—'} – ${p.end ? formatTime12(p.end) : '—'}</span>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:0.82rem;color:var(--text-muted);padding:8px 0">No regular periods set.</div>';
  }
  html += '</div>';

  // Late start schedule
  if (lateStart.length || lateDay) {
    html += '<div><div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary);margin-bottom:8px">Late Start Schedule';
    if (lateDay) html += ` <span style="font-weight:400;text-transform:capitalize;color:var(--text-muted)">— ${lateDay}s</span>`;
    html += '</div>';
    if (lateStart.length) {
      html += '<div class="schedule-view-table">';
      lateStart.forEach(p => {
        html += `<div class="schedule-view-row">
          <span class="schedule-view-label">${escapeHtml(p.label || 'Period')}</span>
          <span class="schedule-view-time">${p.start ? formatTime12(p.start) : '—'} – ${p.end ? formatTime12(p.end) : '—'}</span>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:0.82rem;color:var(--text-muted);padding:8px 0">No late start periods set.</div>';
    }
    html += '</div>';
  }

  document.getElementById('schedule-viewer-content').innerHTML = html;
  setTimeout(() => { openModal('schedule-viewer-modal'); if (window.lucide) lucide.createIcons(); }, 150);
}

// ── Status Editor (editable from profile) ─────────────────────────────
function openStatusEditor() {
  closeModal('profile-viewer-modal');
  setTimeout(() => openModal('status-editor-modal'), 150);
  // Populate with current values
  const users = window._users || {};
  const u = users[currentUser] || {};
  const statusVal = u.status || 'online';
  const statusLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
  const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
  setCustomSelectValue('se-status-select', statusVal, statusLabels[statusVal] || 'Online');
  // Update the dot color in the button
  const dot = document.querySelector('#se-status-select-wrap .se-status-dot');
  if (dot) dot.style.background = statusColors[statusVal] || '#22c55e';
  document.getElementById('se-custom-status').value = u.customStatus || '';
  document.getElementById('se-status-emoji').value = u.statusEmoji || '';
  if (window.lucide) lucide.createIcons({ node: document.getElementById('se-status-select-wrap') });
}

function selectStatus(value, label, color) {
  setCustomSelectValue('se-status-select', value, label);
  const dot = document.querySelector('#se-status-select-wrap .se-status-dot');
  if (dot) dot.style.background = color;
  closeAllCustomSelects();
}

async function saveStatus() {
  const status = getCustomSelectValue('se-status-select');
  const customStatus = document.getElementById('se-custom-status').value.trim();
  const statusEmoji = document.getElementById('se-status-emoji').value.trim() || '';
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
  showToast('Status updated!');
  // Also emit to socket so header updates
  socket.emit('status-change', { user: currentUser, status, customStatus, statusEmoji });
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

function togglePerfMode(el) {
  const enabled = el.checked;
  document.body.classList.toggle('perf-mode', enabled);
  const tog = document.getElementById('toggle-perf');
  if (tog) tog.checked = enabled;
  fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ perfMode: enabled })
  });
  showToast(enabled ? '⚡ Performance mode on' : '✨ Performance mode off');
}

function toggleSound(el) { SoundSystem.setEnabled(el.checked); if (el.checked) SoundSystem.toggle(); }

async function changeSitePassword() {
  showToast('Use the Eval terminal to change the site password');
}

async function changeVaultPasscode() {
  const p = document.getElementById('new-vault-passcode').value;
  if (p.length !== 4) return showToast('⚠️ Must be 4 digits');
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaultPasscode: p }) });
  showToast('Locker passcode updated!');
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
    SoundSystem.success();
    showToast('Profile passcode saved');
    document.getElementById('profile-passcode-input').value = '';
    document.getElementById('profile-passcode-confirm').value = '';
  } else {
    SoundSystem.error();
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
      const diff = new Date(g.expiresAt) - getNowMs();
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
      <div class="guest-pass-avatar"><i data-lucide="user" style="width:20px;height:20px"></i></div>
      <div class="guest-pass-info">
        <div class="guest-pass-name">${escapeHtml(g.name)}</div>
        <div class="guest-pass-meta">${expiryInfo}${g.createdBy ? ' · Created by ' + capitalize(g.createdBy) : ''}</div>
        <div class="guest-pass-channels">${badges}</div>
      </div>
      <div class="guest-pass-actions">
        <button class="btn-ghost guest-pass-action-btn" onclick="editGuest('${g.id}')" title="Edit"><i data-lucide="pencil" style="width:15px;height:15px;color:var(--accent)"></i></button>
        <button class="btn-ghost guest-pass-action-btn" onclick="revokeGuest('${g.id}','${escapeHtml(g.name)}')" title="Revoke"><i data-lucide="trash-2" style="width:15px;height:15px;color:#ef4444"></i></button>
      </div>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
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
      const diff = expires - getNowMs();
      if (diff <= 0) {
        el.innerHTML = '<span style="color:#ef4444">Expired</span>';
      } else {
        const days = Math.floor(diff / 86400000);
        const hrs = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        el.textContent = days > 0 ? `⏱ ${days}d ${hrs}h ${mins}m ${secs}s` : `⏱ ${hrs}h ${mins}m ${secs}s`;
      }
    });
  }, 1000);
}

async function editGuest(guestId) {
  if (!guestId) return;
  const guests = await fetch('/api/guests').then(r => r.json());
  const g = guests[guestId];
  if (!g) return showToast('Guest not found');
  const channels = g.channels || ['kaliph','kathrine','group'];
  const avatarPreview = g.avatar
    ? `<img src="${escapeHtml(g.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<span style="font-size:1.4rem;color:var(--text-primary,#fff)">${escapeHtml(g.name[0].toUpperCase())}</span>`;
  let overlay = document.getElementById('edit-guest-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'edit-guest-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--bg-card,var(--surface,#1e1e2e));border:1px solid var(--border);border-radius:16px;padding:1.5rem;width:380px;max-width:90vw;box-shadow:0 12px 40px rgba(0,0,0,0.4)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem">
        <h3 style="margin:0;font-size:1rem;color:var(--text-primary,#fff)">Edit Guest</h3>
        <button onclick="this.closest('#edit-guest-overlay').remove()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem">&times;</button>
      </div>
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.2rem">
        <div id="edit-guest-avatar-preview" style="width:56px;height:56px;min-width:56px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;position:relative" onclick="document.getElementById('edit-guest-avatar-input').click()">
          ${avatarPreview}
          <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);opacity:0;transition:opacity 0.2s;display:flex;align-items:center;justify-content:center;border-radius:50%" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0"><i data-lucide="camera" style="width:20px;height:20px;color:#fff"></i></div>
        </div>
        <div style="flex:1">
          <div style="font-size:0.72rem;color:var(--text-muted,#888);margin-bottom:4px">Click avatar to change photo</div>
          ${g.avatar ? `<button class="btn-ghost" onclick="removeGuestAvatarHost('${guestId}')" style="font-size:0.72rem;padding:2px 8px">Remove photo</button>` : ''}
        </div>
        <input type="file" id="edit-guest-avatar-input" accept="image/*" style="display:none" onchange="uploadGuestAvatarHost('${guestId}',this)">
      </div>
      <div class="form-row" style="margin-bottom:1rem"><label style="font-size:0.78rem;color:var(--text-secondary,#aaa);margin-bottom:4px;display:block">Guest Name</label><input type="text" id="edit-guest-name" value="${escapeHtml(g.name)}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input,rgba(255,255,255,0.06));color:var(--text-primary,#fff);font-size:0.85rem"></div>
      <div style="margin-bottom:1rem">
        <label style="font-size:0.78rem;color:var(--text-secondary,#aaa);margin-bottom:8px;display:block">Channel Permissions</label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="channel-perm-check"><div class="toggle-switch"><input type="checkbox" id="edit-perm-kaliph" ${channels.includes('kaliph') ? 'checked' : ''}><span class="toggle-slider"></span></div><span style="font-size:0.82rem">Speak with Kaliph</span></label>
          <label class="channel-perm-check"><div class="toggle-switch"><input type="checkbox" id="edit-perm-kathrine" ${channels.includes('kathrine') ? 'checked' : ''}><span class="toggle-slider"></span></div><span style="font-size:0.82rem">Speak with Kathrine</span></label>
          <label class="channel-perm-check"><div class="toggle-switch"><input type="checkbox" id="edit-perm-group" ${channels.includes('group') ? 'checked' : ''}><span class="toggle-slider"></span></div><span style="font-size:0.82rem">Speak in Group Chat</span></label>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn-ghost" onclick="this.closest('#edit-guest-overlay').remove()" style="padding:6px 16px;font-size:0.82rem">Cancel</button>
        <button class="btn-primary" onclick="saveGuestEdit('${guestId}')" style="padding:6px 16px;font-size:0.82rem">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();
}

async function uploadGuestAvatarHost(guestId, input) {
  const file = input.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('avatar', file);
  const res = await fetch(`/api/guests/${guestId}/avatar`, { method: 'POST', body: fd });
  const data = await res.json();
  if (data.avatar) {
    const preview = document.getElementById('edit-guest-avatar-preview');
    if (preview) preview.innerHTML = `<img src="${escapeHtml(data.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"><div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);opacity:0;transition:opacity 0.2s;display:flex;align-items:center;justify-content:center;border-radius:50%" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0"><i data-lucide="camera" style="width:20px;height:20px;color:#fff"></i></div>`;
    if (window.lucide) lucide.createIcons();
    showToast('Avatar updated');
    await loadGuestMessages();
    renderGuestChat();
  }
}

async function removeGuestAvatarHost(guestId) {
  await fetch(`/api/guests/${guestId}/avatar`, { method: 'DELETE' });
  showToast('Avatar removed');
  await loadGuestMessages();
  editGuest(guestId); // Refresh modal
}

async function saveGuestEdit(guestId) {
  const name = document.getElementById('edit-guest-name').value.trim();
  if (!name) return showToast('Name is required');
  const channels = [];
  if (document.getElementById('edit-perm-kaliph').checked) channels.push('kaliph');
  if (document.getElementById('edit-perm-kathrine').checked) channels.push('kathrine');
  if (document.getElementById('edit-perm-group').checked) channels.push('group');
  if (!channels.length) return showToast('Select at least one channel');
  await fetch(`/api/guests/${guestId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, channels })
  });
  document.getElementById('edit-guest-overlay')?.remove();
  await loadGuests();
  await loadGuestMessages();
  showToast('Guest updated');
}

function updateGuestChannelOptions(activeGuests) {
  // Add/remove guest-to-guest channel checkboxes dynamically
  const container = document.getElementById('guest-to-guest-perms');
  if (!container) return;
  container.innerHTML = '';
  activeGuests.forEach(g => {
    container.innerHTML += `<label class="channel-perm-check"><div class="toggle-switch"><input type="checkbox" data-guest-channel="${g.id}"><span class="toggle-slider"></span></div><i data-lucide="user" style="width:14px;height:14px;color:var(--accent)"></i> <span>Chat with ${escapeHtml(g.name)} (guest)</span></label>`;
  });
}

function toggleGuestExpiryMode() {
  const mode = getCustomSelectValue('guest-expires-mode');
  const durEl = document.getElementById('guest-expiry-duration');
  const dtEl = document.getElementById('guest-expiry-datetime');
  durEl.style.display = mode === 'duration' ? 'flex' : 'none';
  dtEl.style.display = mode === 'datetime' ? 'block' : 'none';
}

async function createGuest() {
  const name = document.getElementById('guest-name').value.trim();
  const pw   = document.getElementById('guest-pw').value;
  if (!name || !pw) return showToast('⚠️ Name and password required');
  const mode = getCustomSelectValue('guest-expires-mode');
  let expiresAt = null;
  if (mode === 'duration') {
    const hrs = parseInt(document.getElementById('guest-expires-hours').value) || 0;
    const mins = parseInt(document.getElementById('guest-expires-minutes').value) || 0;
    if (hrs || mins) expiresAt = new Date(getNowMs() + hrs * 3600000 + mins * 60000).toISOString();
  } else if (mode === 'datetime') {
    const dt = document.getElementById('guest-expires-at').value;
    if (dt) expiresAt = new Date(dt).toISOString();
  }
  const channels = [];
  if (document.getElementById('guest-perm-kaliph').checked) channels.push('kaliph');
  if (document.getElementById('guest-perm-kathrine').checked) channels.push('kathrine');
  if (document.getElementById('guest-perm-group').checked) channels.push('group');
  document.querySelectorAll('#guest-to-guest-perms input[data-guest-channel]').forEach(cb => {
    if (cb.checked) channels.push('guest-' + cb.dataset.guestChannel);
  });
  if (!channels.length) return showToast('⚠️ Select at least one channel');

  let result;
  try {
    const resp = await fetch('/api/guests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: pw, expiresAt, channels })
    });
    result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Server error');
  } catch (e) {
    showToast(`❌ Failed to create guest: ${e.message}`);
    return;
  }

  // Reset form
  document.getElementById('guest-name').value = '';
  document.getElementById('guest-pw').value = '';
  setCustomSelectValue('guest-expires-mode', 'never', 'Never expires');
  toggleGuestExpiryMode();
  document.getElementById('guest-perm-kaliph').checked = true;
  document.getElementById('guest-perm-kathrine').checked = true;
  document.getElementById('guest-perm-group').checked = true;

  await loadGuests();

  // Show password confirmation overlay with copy button
  _showGuestCreatedModal(name, pw, result.guestId, channels);
}

function _showGuestCreatedModal(name, pw, guestId, channels) {
  let overlay = document.getElementById('guest-created-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'guest-created-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-card,var(--surface,#1e1e2e));border:1px solid var(--border);border-radius:16px;padding:1.75rem;width:360px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,0.45);text-align:center">
      <div style="font-size:2rem;margin-bottom:0.5rem">🌟</div>
      <div style="font-size:1rem;font-weight:700;color:var(--text-primary,#fff);margin-bottom:0.3rem">Guest Pass Created!</div>
      <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1.25rem">Share your site URL and this password with <strong>${escapeHtml(name)}</strong>.</div>
      <div style="background:var(--bg-primary,#0c0912);border:1px solid var(--border);border-radius:10px;padding:0.85rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:8px;justify-content:space-between">
        <code id="guest-pw-display" style="font-size:1rem;font-weight:700;color:var(--accent);letter-spacing:0.04em;word-break:break-all">${escapeHtml(pw)}</code>
        <button id="guest-pw-copy-btn" style="flex-shrink:0;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:0.75rem;cursor:pointer;white-space:nowrap">Copy</button>
      </div>
      <div style="font-size:0.74rem;color:var(--text-muted);margin-bottom:1.25rem">This password won't be shown again — copy it now.</div>
      <button id="guest-created-dismiss" style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:9px 28px;font-size:0.88rem;font-weight:600;cursor:pointer;width:100%">Done</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#guest-pw-copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pw);
      const btn = overlay.querySelector('#guest-pw-copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
    } catch { showToast('Copy failed — please copy manually'); }
  });

  const dismiss = overlay.querySelector('#guest-created-dismiss');
  dismiss.addEventListener('click', async () => {
    overlay.remove();
    if (guestId) {
      await loadGuestMessages();
      const defaultCh = channels.includes('group') ? 'group' : channels[0];
      showSection('guest-messages', document.querySelector('.nav-item[data-section="guest-messages"]'));
      selectGuest(guestId, defaultCh);
    }
    showToast(`🌟 Guest pass created for ${escapeHtml(name)}!`);
  });
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
  // Wire up guest list delegated click handler
  _initGuestListDelegate();
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
    body: JSON.stringify({ type: getCustomSelectValue('suggestion-type') || 'suggestion', message: msg })
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
  SoundSystem.toggle();
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
const ICE_CONFIG = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
] };
let callPeer = null;          // who we're in a call with
let iceCandidateQueue = [];   // buffer ICE candidates before peerConnection exists
let callTimer = null;
let callSeconds = 0;
let inCall = false;
let callAnswered = false;      // track if call was answered
let callIsGuest = false;       // track if current call is with a guest

// Post a call event (missed/ended) as a system message in chat
async function postCallEvent(type, peer, cType, isGuestCall) {
  // Never post call events for guest calls to main chat
  if (isGuestCall) return;
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
  iceCandidateQueue = [];
  window._activeCallId = uuidv4();
  const videoConstraints = type === 'video' ? { width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 }, frameRate: { ideal: 30, min: 15 }, facingMode: 'user' } : false;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoConstraints }).catch(() => null);
  if (!localStream) { showToast('Media device access denied'); return; }

  peerConnection = new RTCPeerConnection(ICE_CONFIG);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('call-ice-candidate', { candidate: e.candidate, callId: window._activeCallId }); };
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
  socket.emit('call-offer', { offer, type, from: currentUser, to: callPeer, callId: window._activeCallId });
  inCall = true;
  SoundSystem.startRingtone('outgoing');
  showCallOverlay('Calling ' + capitalize(callPeer) + '...', type);
}

async function handleCallOffer({ offer, type, from, to, callId, isGuest }) {
  // Only accept calls addressed to us (or unaddressed calls from the other main user)
  if (to && to !== currentUser) return;
  if (inCall) return; // already in a call
  callType = type;
  callPeer = from;
  callIsGuest = !!isGuest;
  window._activeCallId = callId || null;
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
  peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('call-ice-candidate', { candidate: e.candidate, callId: window._activeCallId }); };
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
  socket.emit('call-answer', { answer, callId: window._activeCallId });
  inCall = true;
  startCallTimer();
  showCallOverlay(capitalize(callPeer), callType);
}

async function handleCallAnswer({ answer, callId }) {
  SoundSystem.stopRingtone();
  callAnswered = true;
  if (callId) window._activeCallId = callId;
  if (peerConnection) {
    await peerConnection.setRemoteDescription(answer);
    // Drain any ICE candidates that arrived before the answer
    for (const c of iceCandidateQueue) await peerConnection.addIceCandidate(c);
    iceCandidateQueue = [];
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
  postCallEvent('missed', callPeer, callType, callIsGuest);
  callPeer = null;
  callIsGuest = false;
  window._pendingOffer = null;
  iceCandidateQueue = [];
  socket.emit('call-end', { callId: window._activeCallId });
}

function endCall(remote = false) {
  SoundSystem.stopRingtone();
  SoundSystem.callSound('hangup');
  if (!remote) socket.emit('call-end', { callId: window._activeCallId });
  // Post call event to chat (skip for guest calls)
  const peer = callPeer;
  const cType = callType;
  const wasGuestCall = callIsGuest;
  if (callAnswered) {
    postCallEvent('ended', peer, cType, wasGuestCall);
  } else if (remote && !callAnswered) {
    postCallEvent('missed', peer, cType, wasGuestCall);
  }
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  stopCallTimer();
  stopCallControlsAutoHide();
  inCall = false;
  callAnswered = false;
  callIsGuest = false;
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
function showMsgNotif(sender, text, overrideAvatar, onClick) {
  const container = document.getElementById('msg-notif-container');
  const users = window._users || {};
  const senderData = users[sender];
  const el = document.createElement('div');
  el.className = 'msg-notif';
  const avatarUrl = overrideAvatar || senderData?.avatar;
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}">`
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
    if (onClick) {
      onClick();
    } else {
      showSection('chat', document.querySelector('.nav-item[data-section=chat]'));
    }
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
    const today = getNow().toISOString().split('T')[0];
    const week = new Date(getNowMs() - 7 * 86400000).toISOString().split('T')[0];
    const month = new Date(getNowMs() - 30 * 86400000).toISOString().split('T')[0];
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

function buildMsgPreviewHtml(m, textQuery) {
  // GIF message
  if (m.type === 'gif' && m.text) {
    return `<div class="search-result-media">
      <img src="${escapeHtml(m.text)}" style="max-height:100px;max-width:160px;border-radius:6px;object-fit:cover;display:block" loading="lazy">
    </div>`;
  }
  // File attachments
  if (m.files?.length) {
    const images = m.files.filter(f => f.type?.startsWith('image'));
    const others = m.files.filter(f => !f.type?.startsWith('image'));
    let html = '';
    if (images.length) {
      html += `<div class="search-result-media" style="display:flex;flex-wrap:wrap;gap:4px">` +
        images.map(f => `<img src="${escapeHtml(f.url)}" style="height:80px;max-width:120px;border-radius:6px;object-fit:cover" loading="lazy">`).join('') +
        `</div>`;
    }
    if (others.length) {
      html += others.map(f =>
        `<div class="search-result-text" style="display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span>${escapeHtml(f.name)}</span>
        </div>`
      ).join('');
    }
    if (m.text) html += `<div class="search-result-text">${highlight(m.text, textQuery)}</div>`;
    return html;
  }
  // Plain text
  if (m.text) return `<div class="search-result-text">${highlight(m.text, textQuery)}</div>`;
  // Voice message
  if (m.voiceUrl) return `<div class="search-result-text" style="color:var(--text-muted)">🎙️ Voice message</div>`;
  return `<div class="search-result-text" style="color:var(--text-muted)">(no content)</div>`;
}

async function executeSearch() {
  const dropdown = document.getElementById('search-results');
  const bar = document.getElementById('search-bar');
  const textQuery = bar.value.trim().toLowerCase();

  // Show no-search state
  if (!textQuery && !searchFilters.length) { showSearchFilters(); return; }

  // For text queries: fetch from server so we search full history (not just loaded page)
  let hits;
  if (textQuery) {
    dropdown.innerHTML = '<div class="search-result-item"><div class="search-result-text" style="color:var(--text-muted);text-align:center">Searching…</div></div>';
    dropdown.classList.add('open');
    document.getElementById('search-clear-btn').style.display = '';
    try {
      hits = await fetch(`/api/messages?q=${encodeURIComponent(textQuery)}&limit=50`).then(r => r.json());
      if (!Array.isArray(hits)) hits = [];
    } catch { hits = []; }
  } else {
    hits = [...allMessages];
  }

  // Apply structural filters (from:, has:, before:, after:) — these work client-side on whatever hits we have
  searchFilters.forEach(f => {
    const ft = f.type;
    const v = f.value.toLowerCase();
    if (ft === 'from') {
      hits = hits.filter(m => m.sender?.toLowerCase().includes(v));
    } else if (ft === 'has') {
      if (v === 'link') hits = hits.filter(m => m.text && /https?:\/\//.test(m.text));
      else if (v === 'image' || v === 'img') hits = hits.filter(m => m.type === 'gif' || m.files?.some(f => f.type?.startsWith('image')));
      else if (v === 'gif') hits = hits.filter(m => m.type === 'gif');
      else if (v === 'file') hits = hits.filter(m => m.files?.length > 0 || m.type === 'gif');
    } else if (ft === 'before') {
      const d = new Date(v); if (!isNaN(d)) hits = hits.filter(m => new Date(m.timestamp) < d);
    } else if (ft === 'after') {
      const d = new Date(v); if (!isNaN(d)) hits = hits.filter(m => new Date(m.timestamp) > d);
    }
  });

  // Sort by newest first
  hits.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Store hits for load-more pagination
  window._searchHits = hits;
  window._searchQuery = textQuery;
  renderSearchResults(hits, textQuery, 25);
}

function renderSearchResults(hits, textQuery, displayLimit) {
  const dropdown = document.getElementById('search-results');
  const count = hits.length;
  let html = `<div class="search-results-header">
    <span class="search-results-count">${count} result${count !== 1 ? 's' : ''}</span>
  </div>`;

  if (!count) {
    html += '<div class="search-result-item"><div class="search-result-text" style="color:var(--text-muted);text-align:center">No messages found</div></div>';
  } else {
    html += hits.slice(0, displayLimit).map(m => {
      const time = formatSearchTime(m.timestamp);
      const preview = buildMsgPreviewHtml(m, textQuery);
      return `<div class="search-result-item" onclick="clickSearchResult('${m.id}', ${m.timestamp})">
        <div class="search-result-top">
          <span class="search-result-sender">${capitalize(m.sender)}</span>
          <span class="search-result-time">${time}</span>
        </div>
        ${preview}
      </div>`;
    }).join('');
    if (hits.length > displayLimit) {
      const remaining = hits.length - displayLimit;
      html += `<div class="search-load-more" onclick="loadMoreSearchResults(${displayLimit})">
        Show ${Math.min(25, remaining)} more result${remaining > 1 ? 's' : ''}
      </div>`;
    }
  }

  dropdown.innerHTML = html;
  dropdown.classList.add('open');
  document.getElementById('search-clear-btn').style.display = '';
}

function loadMoreSearchResults(currentLimit) {
  const hits = window._searchHits || [];
  const textQuery = window._searchQuery || '';
  renderSearchResults(hits, textQuery, currentLimit + 25);
}

function clickSearchResult(id, timestamp) {
  document.getElementById('search-results').classList.remove('open');
  scrollToMessage(id, timestamp);
}

async function scrollToMessage(id, timestamp) {
  showSection('chat', document.querySelector('.nav-item[data-section=chat]'));
  await new Promise(r => setTimeout(r, 100));

  let el = document.getElementById('msg-' + id);
  let loadedNewBatch = false;

  if (!el && timestamp) {
    // Load messages around the target timestamp — much faster than backward paging
    try {
      const data = await fetch(`/api/messages?around=${timestamp}&limit=60`).then(r => r.json());
      if (Array.isArray(data) && data.length) {
        // Replace current messages with the "around" batch
        allMessages = data.filter(m => !(m.type === 'call-event' && m.callPeer && guestData.some(g => g.name === m.callPeer)));
        hasMoreMessages = true; // assume there are older msgs beyond this batch
        renderMessages();
        setupLoadMoreObserver();
        el = document.getElementById('msg-' + id);
        loadedNewBatch = true;
      }
    } catch (e) {
      console.error('scrollToMessage fetch error', e);
    }
  }

  if (el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    el.classList.add('msg-highlight');
    setTimeout(() => el.classList.remove('msg-highlight'), 2500);
    // Only enter jump mode if we loaded a fresh batch of old messages
    if (loadedNewBatch) _enterJumpMode();
  }
}

function _enterJumpMode() {
  if (_jumpMode) return;
  _jumpMode = true;

  const banner = document.getElementById('jump-mode-banner');
  if (banner) {
    banner.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  // Auto-exit after 90s of being in jump mode (user likely forgot)
  clearTimeout(_jumpUnloadTimer);
  _jumpUnloadTimer = setTimeout(() => exitJumpMode(), 90000);

  // Also exit when user scrolls to very bottom of current view
  const area = document.getElementById('messages-area');
  if (area) {
    const onScroll = () => {
      const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
      if (distFromBottom < 80) {
        area.removeEventListener('scroll', onScroll);
        exitJumpMode();
      }
    };
    area._jumpScrollListener = onScroll;
    area.addEventListener('scroll', onScroll, { passive: true });
  }
}

async function exitJumpMode() {
  if (!_jumpMode) return;
  _jumpMode = false;
  clearTimeout(_jumpUnloadTimer);

  // Remove scroll listener
  const area = document.getElementById('messages-area');
  if (area?._jumpScrollListener) {
    area.removeEventListener('scroll', area._jumpScrollListener);
    area._jumpScrollListener = null;
  }

  // Hide banner
  const banner = document.getElementById('jump-mode-banner');
  if (banner) banner.style.display = 'none';

  // Reload latest messages cleanly (no DOM bloat from old jump batch)
  await loadMessages();
  if (area) area.scrollTop = area.scrollHeight;
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
    const anyInputFocused = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable);
    if (noMod && !anyInputFocused) {
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
  let emojiACTimeout;
  document.getElementById('msg-input')?.addEventListener('input', (e) => {
    socket.emit('typing', { user: currentUser });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop-typing', { user: currentUser }), 1500);
    autoResizeInput();
    // Debounce emoji autocomplete slightly to avoid searching on every keystroke
    clearTimeout(emojiACTimeout);
    const target = e.target;
    emojiACTimeout = setTimeout(() => showEmojiAutocomplete(target), 80);
  }, { passive: true });

  // Jump-to-latest scroll detection (passive for better performance)
  const msgArea = document.getElementById('messages-area');
  const jumpBtn = document.getElementById('jump-to-latest');
  if (msgArea && jumpBtn) {
    msgArea.addEventListener('scroll', () => updateJumpBtnState(), { passive: true });
    // Check state on load too (in case we loaded at a non-bottom position)
    setTimeout(() => updateJumpBtnState(), 1000);
    setTimeout(() => updateJumpBtnState(), 2500);
  }

  setupSearch();
}

function updateJumpBtnState() {
  const msgArea = document.getElementById('messages-area');
  const jumpBtn = document.getElementById('jump-to-latest');
  if (!msgArea || !jumpBtn) return;
  const distFromBottom = msgArea.scrollHeight - msgArea.scrollTop - msgArea.clientHeight;
  jumpBtn.classList.toggle('show', distFromBottom > 300);
}

function jumpToLatest() {
  const area = document.getElementById('messages-area');
  if (area) area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
}

let _autoResizeRAF = null;
function autoResizeInput() {
  if (_autoResizeRAF) return;
  _autoResizeRAF = requestAnimationFrame(() => {
    _autoResizeRAF = null;
    const t = document.getElementById('msg-input');
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  });
}

function resetInputHeight() {
  const t = document.getElementById('msg-input');
  t.style.height = '36px';
}

// ── Last Seen helpers ─────────────────────────────────────────────────
function formatLastSeen(ts) {
  if (!ts) return 'Offline';
  const date = new Date(ts);
  const now = getNow();
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
    syncMissedMessages().then(() => {
      // If user is on chat, mark all pending unread as read now that they're back
      if (currentSection === 'chat' && !stealthMode) clearUnreadBadge();
    });
  }
});

// ── Electron: window blur/focus → idle/active (browser visibilitychange doesn't fire when switching apps)
if (window.electron?.onWindowFocusChange) {
  window.electron.onWindowFocusChange((focused) => {
    if (stealthMode) return;
    if (!focused) {
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
      syncMissedMessages().then(() => {
        if (currentSection === 'chat' && !stealthMode) clearUnreadBadge();
      });
    }
  });
}

async function syncMissedMessages() {
  try {
    const latestTs = allMessages.length > 0 ? allMessages[allMessages.length - 1].timestamp : 0;
    const missed = await fetch(`/api/messages?after=${latestTs}`).then(r => r.json());
    if (!Array.isArray(missed) || missed.length === 0) return;
    const existingIds = new Set(allMessages.map(m => m.id));
    const area = document.getElementById('messages-area');
    missed.forEach(msg => {
      if (existingIds.has(msg.id)) return;
      allMessages.push(msg);
      area.appendChild(buildMsgElement(msg, shouldGroupWithPrev(msg)));
    });
    area.scrollTop = area.scrollHeight;
  } catch {}
}

// ── Modal helpers ─────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); SoundSystem.modalOpen(); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); SoundSystem.modalClose(); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); SoundSystem.modalClose(); }

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
  if (!('Notification' in window)) {
    showToast('Your browser does not support notifications');
    return;
  }
  if (Notification.permission === 'denied') {
    showToast('Notifications are blocked. Please enable them in your browser settings.');
    return;
  }
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      await registerPushSubscription();
      showToast('🔔 Desktop notifications enabled!');
    } else {
      showToast('Notification permission was denied.');
    }
  } else if (Notification.permission === 'granted') {
    await registerPushSubscription();
    showToast('🔔 Desktop notifications are already enabled!');
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
function formatSearchTime(ts) {
  const d = new Date(ts);
  const now = getNow();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday ' + time;
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${time}`;
}
function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = getNow(); const yest = new Date(today); yest.setDate(yest.getDate()-1);
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

// ── Jump to Message (Reply click) ─────────────────────────────────────
function jumpToMessage(msgId) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  const msgEl = area.querySelector(`[data-msg-id="${msgId}"]`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const bubble = msgEl.querySelector('.msg-bubble');
    if (bubble) {
      bubble.classList.remove('highlight-jump');
      void bubble.offsetWidth;
      bubble.classList.add('highlight-jump');
      setTimeout(() => bubble.classList.remove('highlight-jump'), 1600);
    }
  }
}

// ── Reminders ─────────────────────────────────────────────────────────
let _reminders = [];
let _remindersTab = 'upcoming';
let _reminderCheckInterval = null;
let _remindersLoading = false;

async function loadReminders() {
  if (_remindersLoading) return;
  _remindersLoading = true;
  try {
    const resp = await fetch('/api/reminders');
    _reminders = await resp.json();
  } catch { _reminders = []; }
  _remindersLoading = false;
  renderReminders();
  updateReminderBadge();
}

function updateReminderBadge() {
  const now = getNowMs();
  const due = _reminders.filter(r => !r.completed && new Date(r.datetime).getTime() <= now).length;
  const badge = document.getElementById('reminders-badge');
  if (badge) {
    badge.textContent = due;
    badge.style.display = due > 0 ? '' : 'none';
  }
}

function switchRemindersTab(tab, el) {
  _remindersTab = tab;
  document.querySelectorAll('#section-reminders .section-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderReminders();
}

function renderReminders() {
  const container = document.getElementById('reminders-list');
  if (!container) return;

  const now = getNowMs();
  let filtered = _reminders;

  if (_remindersTab === 'upcoming') {
    filtered = _reminders.filter(r => !r.completed).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  } else if (_remindersTab === 'completed') {
    filtered = _reminders.filter(r => r.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  } else {
    filtered = [..._reminders].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  }

  if (!filtered.length) {
    const msg = _remindersTab === 'upcoming' ? 'No upcoming reminders' :
                _remindersTab === 'completed' ? 'No completed reminders' : 'No reminders yet';
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><i data-lucide="bell-ring" style="width:48px;height:48px;opacity:0.4"></i></div>
      <div class="empty-state-text">${msg}</div>
      <div class="empty-state-sub">Create a reminder to get notified via push, email, or on-site.</div>
    </div>`;
    if (window.lucide) lucide.createIcons({ target: container });
    return;
  }

  container.innerHTML = filtered.map(r => {
    const rTime = new Date(r.datetime);
    const isOverdue = !r.completed && rTime.getTime() <= now;
    const timeStr = formatReminderTime(r.datetime);
    const priorityClass = r.priority === 'high' ? ' priority-high' : r.priority === 'low' ? ' priority-low' : '';
    const completedClass = r.completed ? ' completed' : '';

    const notifyIcons = [];
    if (r.notify?.site) notifyIcons.push('<i data-lucide="monitor" style="width:12px;height:12px"></i>');
    if (r.notify?.push) notifyIcons.push('<i data-lucide="smartphone" style="width:12px;height:12px"></i>');
    if (r.notify?.email) notifyIcons.push('<i data-lucide="mail" style="width:12px;height:12px"></i>');

    return `<div class="reminder-card${priorityClass}${completedClass}" data-id="${r.id}">
      <div class="reminder-check${r.completed ? ' checked' : ''}" onclick="toggleReminderComplete('${r.id}')" title="${r.completed ? 'Mark incomplete' : 'Mark complete'}">
        ${r.completed ? '<i data-lucide="check" style="width:14px;height:14px"></i>' : ''}
      </div>
      <div class="reminder-body">
        <div class="reminder-title">${escapeHtml(r.title)}</div>
        ${r.description ? `<div class="reminder-desc">${escapeHtml(r.description)}</div>` : ''}
        <div class="reminder-meta">
          <span class="reminder-meta-item${isOverdue ? ' overdue' : ''}">
            <i data-lucide="${isOverdue ? 'alert-circle' : 'clock'}" style="width:12px;height:12px"></i>
            ${isOverdue && !r.completed ? 'Overdue · ' : ''}${timeStr}
          </span>
          ${r.repeat ? `<span class="reminder-meta-item"><i data-lucide="repeat" style="width:12px;height:12px"></i> ${capitalize(r.repeat)}</span>` : ''}
          ${notifyIcons.length ? `<span class="reminder-meta-item">${notifyIcons.join(' ')}</span>` : ''}
        </div>
      </div>
      <div class="reminder-actions">
        ${!r.completed ? `<button class="reminder-action-btn" onclick="snoozeReminder('${r.id}')" title="Snooze 1 hour"><i data-lucide="alarm-clock" style="width:14px;height:14px"></i></button>` : ''}
        <button class="reminder-action-btn" onclick="editReminder('${r.id}')" title="Edit"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
        <button class="reminder-action-btn" onclick="deleteReminder('${r.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
      </div>
    </div>`;
  }).join('');

  if (window.lucide) lucide.createIcons({ target: container });
}

function formatReminderTime(dt) {
  const d = new Date(dt);
  const now = getNow();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Today ' + time;
  const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
  if (d.toDateString() === tmrw.toDateString()) return 'Tomorrow ' + time;
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday ' + time;
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${time}`;
}

async function saveReminder() {
  const title = document.getElementById('reminder-title').value.trim();
  const datetime = document.getElementById('reminder-datetime').value;
  if (!title) return showToast('Reminder title required');
  if (!datetime) return showToast('Date & time required');

  await fetch('/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description: document.getElementById('reminder-desc').value.trim(),
      datetime: new Date(datetime).toISOString(),
      repeat: getCustomSelectValue('reminder-repeat'),
      notify: {
        site: document.getElementById('reminder-notify-site').checked,
        push: false,
        email: document.getElementById('reminder-notify-email').checked,
      },
      priority: document.getElementById('reminder-priority').value,
    }),
  });

  // Reset form
  document.getElementById('reminder-title').value = '';
  document.getElementById('reminder-desc').value = '';
  document.getElementById('reminder-datetime').value = '';
  resetDatetimePicker('reminder-datetime');
  setCustomSelectValue('reminder-repeat', '', 'No repeat');
  document.getElementById('reminder-notify-site').checked = true;
  document.getElementById('reminder-notify-email').checked = false;
  selectPriority('reminder-priority', 'normal');

  closeModal('new-reminder-modal');
  showToast('🔔 Reminder created!');
  await loadReminders();
}

function editReminder(id) {
  const r = _reminders.find(x => x.id === id);
  if (!r) return;
  document.getElementById('edit-reminder-id').value = r.id;
  document.getElementById('edit-reminder-title').value = r.title;
  document.getElementById('edit-reminder-desc').value = r.description || '';
  // Set datetime via custom picker
  const dt = new Date(r.datetime);
  setDatetimePickerValue('edit-reminder-datetime', dt);
  // Set repeat via custom select
  const repeatVal = r.repeat || '';
  const repeatLabels = { '': 'No repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
  setCustomSelectValue('edit-reminder-repeat', repeatVal, repeatLabels[repeatVal] || 'No repeat');
  document.getElementById('edit-reminder-notify-site').checked = r.notify?.site ?? true;
  document.getElementById('edit-reminder-notify-email').checked = r.notify?.email ?? false;
  // Set priority via custom buttons
  selectPriority('edit-reminder-priority', r.priority || 'normal');
  openModal('edit-reminder-modal');
}

async function updateReminder() {
  const id = document.getElementById('edit-reminder-id').value;
  const title = document.getElementById('edit-reminder-title').value.trim();
  const datetime = document.getElementById('edit-reminder-datetime').value;
  if (!title) return showToast('Title required');
  if (!datetime) return showToast('Date & time required');

  await fetch(`/api/reminders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description: document.getElementById('edit-reminder-desc').value.trim(),
      datetime: new Date(datetime).toISOString(),
      repeat: getCustomSelectValue('edit-reminder-repeat'),
      notify: {
        site: document.getElementById('edit-reminder-notify-site').checked,
        push: false,
        email: document.getElementById('edit-reminder-notify-email').checked,
      },
      priority: document.getElementById('edit-reminder-priority').value,
    }),
  });

  closeModal('edit-reminder-modal');
  showToast('🔔 Reminder updated!');
  await loadReminders();
}

async function toggleReminderComplete(id) {
  const r = _reminders.find(x => x.id === id);
  if (!r) return;
  await fetch(`/api/reminders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: !r.completed, completedAt: !r.completed ? getNowMs() : null }),
  });
  await loadReminders();
  showToast(r.completed ? '🔔 Reminder reopened' : '✅ Reminder completed!');
}

async function snoozeReminder(id) {
  const snoozeUntil = new Date(getNowMs() + 3600000).toISOString(); // 1 hour
  await fetch(`/api/reminders/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snoozedUntil: snoozeUntil, lastNotified: null }),
  });
  showToast('⏰ Snoozed for 1 hour');
  await loadReminders();
}

async function deleteReminder(id) {
  await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
  SoundSystem.deleteSnd();
  showToast('🗑️ Reminder deleted');
  await loadReminders();
}

function showReminderNotification(data) {
  if (data.user !== currentUser) return;
  // Only show once per session to prevent popup spam on reload
  const shownKey = 'rkk-reminder-toast-' + data.id;
  if (sessionStorage.getItem(shownKey)) return;
  sessionStorage.setItem(shownKey, '1');
  // Create rich notification toast
  const c = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'reminder-toast';
  toast.innerHTML = `
    <div class="reminder-toast-icon">🔔</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(data.title)}</div>
      ${data.description ? `<div class="reminder-toast-desc">${escapeHtml(data.description)}</div>` : ''}
      <div class="reminder-toast-actions">
        <button class="reminder-toast-btn" onclick="snoozeReminder('${data.id}');this.closest('.reminder-toast').remove()">Snooze</button>
        <button class="reminder-toast-btn" onclick="toggleReminderComplete('${data.id}');this.closest('.reminder-toast').remove()">Done</button>
        <button class="reminder-toast-btn dismiss" onclick="this.closest('.reminder-toast').remove()">Dismiss</button>
      </div>
    </div>
  `;
  c.appendChild(toast);
  // Auto-dismiss after 30 seconds
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 30000);

  // Also send desktop notification
  sendDesktopNotif('🔔 Reminder: ' + data.title, data.description || 'Your reminder is due!');
}

function startReminderChecker() {
  if (_reminderCheckInterval) clearInterval(_reminderCheckInterval);
  _reminderCheckInterval = setInterval(() => {
    updateReminderBadge();
    // Re-render if on reminders tab to update overdue status
    if (currentSection === 'reminders') renderReminders();
  }, 30000);
}

// ── Update / Changelog Log ────────────────────────────────────────────
const CHANGELOG = [
  {
    version: '3.9.0',
    date: 'Mar 26 2026',
    intro: 'A brand-new Money Dashboard for tracking balances, expenses, deposits, savings goals, and recurring bills — plus search improvements, theme fixes, and under-the-hood polish.',
    sections: [
      { icon: '💰', title: 'Money Dashboard', items: [
        { name: 'Balance Tracking', desc: 'Combined and individual balance cards with daily snapshots and trend tickers.' },
        { name: 'Expense & Deposit Logging', desc: 'Quick-add floating button with category pills, split 50/50 toggle, and custom date picker.' },
        { name: 'Savings Goals', desc: 'Circular SVG arc progress, color-coded goals, contribute button, and confetti on completion.' },
        { name: 'Recurring Bills', desc: 'Auto-logged monthly/weekly/yearly bills with manual "Log Now" option.' },
        { name: 'Animated Dashboard', desc: 'Staggered fade-in, skeleton loading, number counting animation, balance flash on change, ticker bounce, and smooth arc transitions.' },
      ]},
      { icon: '🔍', title: 'Search', items: [
        { name: 'Jump to Message', desc: 'Clicking a search result instantly loads messages around that timestamp instead of backward-paging.' },
        { name: 'Load More Results', desc: 'Search dropdown now shows a "Show more" button when there are additional results.' },
        { name: 'Smart Unloading', desc: 'After jumping to an old message, a "Back to latest" banner appears. Messages auto-unload after 90 seconds or when scrolling to the bottom.' },
      ]},
      { icon: '🎨', title: 'Themes', items: [
        { name: 'Enchanted Forest Removed', desc: 'The Enchanted Forest theme has been retired from the theme picker.' },
        { name: 'Arctic Redesigned', desc: 'New Space Grotesk font, larger text, clean single-color nav border, tighter spacing, and profile picture overflow fix.' },
      ]},
      { icon: '🔔', title: 'Reminders', items: [
        { name: 'Priority Card Colors', desc: 'High and low priority reminder cards now use subtle background tints instead of full vivid colors.' },
      ]},
      { icon: '⚙️', title: 'System', items: [
        { name: 'Update Log Persistence', desc: 'Dismissed update log state now syncs to the server so it persists across devices.' },
        { name: 'brrr Push Notifications', desc: 'New messages now send iOS push notifications via brrr webhooks.' },
      ]},
    ],
  },
  {
    version: '3.8.0',
    date: 'Mar 16 2026',
    intro: 'Two brand-new premium themes — Arctic Aurora and Sandstone Dusk. Each brings unique animations, layout changes, and a full sound profile.',
    sections: [
      { icon: '🧊', title: 'Arctic Aurora', items: [
        { name: 'Living Aurora Borealis', desc: 'The sidebar has a slow-moving gradient animation that shifts through green, teal, and violet — like real northern lights.' },
        { name: 'Frosted Crystal Cards', desc: 'Cards and modals use heavy glass blur with a pulsing ice-refraction border that shifts between aurora colors.' },
        { name: 'Centered Chat Layout', desc: 'Messages are displayed in a focused 720px column centered in the chat area — a unique layout no other theme has.' },
        { name: 'Ice-Crack Nav Borders', desc: 'Active nav items have a segmented multi-color border that looks like fracturing ice.' },
        { name: 'Breathing Input Glow', desc: 'The message input pulses with a soft teal glow when focused, like breath in cold air.' },
        { name: 'Crystalline Sound Profile', desc: 'High-pitched sine tones that shimmer like tapping crystal glasses — clean, precise, and icy.' },
      ]},
      { icon: '🏜️', title: 'Sandstone Dusk', items: [
        { name: 'Heat Shimmer Effect', desc: 'A subtle mirage-like distortion at the top of the chat area, like desert heat haze rising off warm sand.' },
        { name: 'Moroccan Pattern Borders', desc: 'Cards and profile cards have ornamental geometric borders built from repeating diagonal CSS gradients — rich and ornate.' },
        { name: 'Golden Hour Header', desc: 'The app header has a warm animated gradient that slowly shifts from amber to sienna, like a frozen desert sunset.' },
        { name: 'Warm Firelight Sidebar', desc: 'A faint warm radial glow emanates from the bottom of the sidebar, like ambient firelight.' },
        { name: 'Carved Stone Bubbles', desc: 'Message bubbles have warm inset shadows and asymmetric rounding for a hand-carved sandstone feel.' },
        { name: 'Singing Bowl Sounds', desc: 'Deep, warm triangle waves with rich resonance — like distant singing bowls in a desert courtyard.' },
      ]},
    ],
  },
  {
    version: '3.7.0',
    date: 'Mar 13 2026',
    intro: 'Message grouping, performance mode for Chromebook, admin profile PIN reset, vault drag-and-drop, Neon Tokyo & Velvet Noir themes, and comprehensive eval upgrades.',
    sections: [
      { icon: '💬', title: 'Chat', items: [
        { name: 'Message Grouping', desc: 'Consecutive messages from the same person now group together — no repeated name or avatar for a cleaner look.' },
      ]},
      { icon: '⚡', title: 'Performance Mode', items: [
        { name: 'Chromebook Mode', desc: 'New "Performance Mode" toggle in Settings → Chat disables all animations, blur effects, and box shadows for dramatically faster rendering on low-end devices.' },
        { name: 'Eval Toggle', desc: 'Admins can toggle performance mode per user via eval: toggle perf kaliph / kathrine.' },
      ]},
      { icon: '🔑', title: 'Profile Security', items: [
        { name: 'Admin PIN Reset', desc: 'Admins can force a PIN reset with eval "reset password <user>" — the user sees their old password and must set a new one before entering their profile.' },
        { name: 'Themed Reset UI', desc: 'The reset screen is fully styled to each user\'s personal theme with a modern two-step flow.' },
      ]},
      { icon: '📁', title: 'Document Locker', items: [
        { name: 'Drag to Reorder', desc: 'Drag files to reorder them or drop them into folders.' },
        { name: 'Move to Folder Button', desc: 'New folder icon on each file to move it into any folder.' },
        { name: 'Rename in Preview', desc: 'Pencil icon in the file preview header lets you rename without closing the preview.' },
        { name: 'No Duplicate Names', desc: 'Renaming a file to an already-taken name is blocked with a toast.' },
      ]},
      { icon: '🎨', title: 'New Themes', items: [
        { name: 'Neon Tokyo', desc: 'High-contrast cyberpunk theme with pink-to-cyan gradients, scanline effects, and a pixel grid overlay.' },
        { name: 'Velvet Noir', desc: 'Luxurious dark theme with champagne gold accents, art deco shimmer, and Cormorant Garamond serif typography.' },
      ]},
      { icon: '🖥️', title: 'Eval', items: [
        { name: 'Reminders Commands', desc: 'New: reminders list, reminders list kaliph/kathrine, delete reminder <id>.' },
        { name: 'Pinned List', desc: 'New: pinned list — shows all pinned messages across all channels.' },
        { name: 'Autocomplete Fixes', desc: 'time set/reset, skipclass, theme builder, reset password, and more are now in autocomplete.' },
      ]},
      { icon: '⏰', title: 'Time Override', items: [
        { name: 'Calendar Jumps to Time', desc: 'When time set is used, the calendar immediately jumps to the simulated month and re-highlights today.' },
        { name: 'Events & All Dates', desc: 'All event date pickers, todo dates, reminder countdowns, search filters, and guest expiry now respect the time offset.' },
      ]},
    ],
  },
  {
    version: '3.6.0',
    date: 'Mar 12 2026',
    intro: 'GIF categories, hover favorites, Chromebook typing speed improvements, real time override, and a cleaner update log.',
    sections: [
      { icon: '🎬', title: 'GIFs', items: [
        { name: 'GIF Categories', desc: 'GIF picker now has tabs — Trending, Favorites, Reactions, Scandal, Memes, and Gaming.' },
        { name: 'Hover to Favorite', desc: 'Hover over any GIF and click the ♥ button to save it to your Favorites tab.' },
        { name: 'Favorites Tab', desc: 'Access all your saved GIFs instantly from the Favorites tab.' },
        { name: 'Search Results Show Media', desc: 'has:file and has:image in search now show actual image thumbnails and GIF previews.' },
        { name: 'Pinned Messages Show Media', desc: 'Pinned messages panel now shows images and GIFs inline instead of a placeholder.' },
      ]},
      { icon: '⏰', title: 'Time Override', items: [
        { name: 'Real Time Simulation', desc: 'Eval "time set" now fully simulates the site at that time — bell schedule, reminders, and countdowns all respond as if it were actually that time.' },
      ]},
      { icon: '⚡', title: 'Performance', items: [
        { name: 'Faster Typing', desc: 'Input box resize is now deferred with requestAnimationFrame — no more layout jank while typing on Chromebook.' },
        { name: 'Passive Scroll', desc: 'Scroll listeners are now passive, reducing stutter when scrolling through messages.' },
        { name: 'Emoji Autocomplete Debounce', desc: 'Emoji autocomplete search is debounced so it no longer runs on every single keystroke.' },
      ]},
      { icon: '🗒️', title: 'Update Log', items: [
        { name: 'Latest Only', desc: 'Update log on login now shows only the most recent update instead of stacking all unseen ones.' },
      ]},
    ],
  },
  {
    version: '3.5.0',
    date: 'Mar 12 2026',
    intro: 'A huge polish & power update — Discord-style text formatting, enchanted profile cards, drag-to-reorder todos, theme builder eval commands, editable contacts, and 30+ refinements across the entire app.',
    sections: [
      { icon: '💬', title: 'Chat', items: [
        { name: 'Discord Formatting', desc: 'Use **bold**, __underline__, ~~strikethrough~~, ||spoiler||, `code`, and ```code blocks```.' },
        { name: 'Reliable Scroll', desc: 'Chat now reliably scrolls to your last read position on open.' },
        { name: 'Bigger Header Icons', desc: 'Pin, call, video & wallpaper icons are larger and cleaner.' },
      ]},
      { icon: '🎨', title: 'Themes & Sounds', items: [
        { name: 'Theme Sound Preview', desc: 'Changing your theme plays a preview of its sound profile.' },
        { name: 'Rosewood & Ocean Sounds', desc: 'New acoustic profiles for Rose & Ember and Deep Tide themes.' },
        { name: 'Reminder Colors', desc: 'Priority popup colors optimized per theme — no more harsh brightness.' },
        { name: 'Notification Sounds', desc: 'Announcements and reminders now trigger a gentle chime.' },
      ]},
      { icon: '👤', title: 'Profiles & Cards', items: [
        { name: 'Enchanted Forest', desc: 'Kathrine profile card has floating flower animations.' },
        { name: 'Profile Pic Zoom', desc: 'Click any profile picture to view it enlarged.' },
        { name: 'View Schedule', desc: 'Button on profile viewer to see someone\'s schedule.' },
        { name: 'Larger Avatars', desc: 'Profile card avatars bumped to 90px for better visibility.' },
      ]},
      { icon: '📱', title: 'Apps & Tools', items: [
        { name: 'Editable Contacts', desc: 'Edit existing contacts via pencil icon — no need to delete and re-add.' },
        { name: 'Drag Reorder Todos', desc: 'Drag todo items to rearrange their order.' },
        { name: 'iPad Todo Editing', desc: 'Larger input box for editing long todo items on tablets.' },
        { name: 'Calendar Event Emoji', desc: 'Choose a custom emoji per event, or get a random school-themed one.' },
        { name: 'Document Locker', desc: 'File Vault renamed to Document Locker everywhere.' },
      ]},
      { icon: '🛠️', title: 'Admin & Eval', items: [
        { name: 'Theme Builder', desc: 'Build custom themes via eval: theme builder, set, preview, reset.' },
        { name: 'Reset Password', desc: 'Reset the site password from eval terminal.' },
        { name: 'Time Override', desc: 'Set/reset the site clock for testing schedules: time set/reset.' },
        { name: 'Guests Archive', desc: 'Archive command now works correctly in eval.' },
      ]},
      { icon: '🧹', title: 'Cleanup', items: [
        { name: 'Icons Over Emojis', desc: 'All empty states now use Lucide icons instead of emojis.' },
        { name: 'No Browser UI', desc: 'Password change removed from settings — eval only.' },
        { name: 'Preview Cmd Removed', desc: 'Deprecated preview eval command cleaned up.' },
        { name: 'iPad Quick Actions', desc: 'Message hover actions no longer stick on iPad — tap to toggle.' },
      ]},
    ],
    fixes: [
      'Chat scroll no longer jumps to random positions on open',
      'iPad zoom prevention via touch-action and viewport meta',
      'Guest archive eval command now returns proper data',
      'Dark theme sizing fixed to fill browser with 100dvh',
    ],
  },
  {
    version: '3.4.0',
    date: 'Mar 11 2026',
    intro: 'Massive update — event editing, reminder fixes, modernized UI across the board, theme refinements, guest pass overhaul, and more.',
    sections: [
      { icon: '📅', title: 'Calendar & Events', items: [
        { name: 'Edit Events', desc: 'Click the pencil icon on any calendar event to edit its title, dates, description, color, and reminder.' },
        { name: 'Eval Time Override', desc: 'Set the site\'s time via eval for testing calendar events and reminders.' },
      ]},
      { icon: '🔔', title: 'Reminders', items: [
        { name: 'No More Popup Spam', desc: 'Reminder and event notifications no longer re-show every time you load the site.' },
        { name: 'Duplication Fix', desc: 'Fixed a bug where reminders could appear duplicated in the list.' },
        { name: 'Modern Notify Toggles', desc: 'The "Notify via" checkboxes are now sleek toggle switches matching the site design.' },
      ]},
      { icon: '🎨', title: 'UI & Themes', items: [
        { name: 'Priority Badge Refresh', desc: 'Priority message indicator redesigned with a clean icon-based pill instead of emoji.' },
        { name: 'Priority Notifications UI', desc: 'Priority notification styling now matches the site\'s native design language.' },
        { name: 'Dark Theme Chat Fix', desc: 'Main chat area on dark theme optimized for smaller screens — no more needing to zoom out on Chromebook.' },
        { name: 'Dark Theme Chat Tab Centered', desc: 'Chat tab now properly centered on dark theme.' },
        { name: 'Text & Font Optimization', desc: 'Optimized all text, fonts, and buttons across every theme so nothing is too bright or too dark to see.' },
        { name: 'Kaliph\'s Theme Revamp', desc: 'Kaliph\'s AVNT theme has been visually revamped with a fresh modern look.' },
        { name: 'Celestial Heaven Replaced', desc: 'Celestial Heaven theme has been redone with an improved design.' },
        { name: 'Enchanted Forest Text Size', desc: 'Increased text size on the Enchanted Forest theme for better readability.' },
        { name: 'Royal K&K Logo Sizing', desc: 'Royal K&K header logo is now bigger and more prominent on each theme.' },
      ]},
      { icon: '💬', title: 'Chat & Messaging', items: [
        { name: 'Slash Commands Everywhere', desc: 'Slash key now works in all text boxes across the site, not just the main chat input.' },
        { name: 'More Sound Effects', desc: 'Added more sound effects throughout the site for a richer audio experience.' },
      ]},
      { icon: '📝', title: 'Notes & Todos', items: [
        { name: 'Stealth Mode Notes Fix', desc: 'In stealth mode, notes and todos now correctly use "My Notes" instead of the other user\'s.' },
        { name: 'Editable Todo Items', desc: 'Todo list items can now be edited after being added — clicking opens edit mode instead of just toggling done.' },
      ]},
      { icon: '🔒', title: 'Settings & Security', items: [
        { name: 'Desktop Notifications Fixed', desc: 'Desktop notifications button in settings now properly requests and enables browser notifications.' },
        { name: 'Channel Permissions Revamp', desc: 'Revamped the channel permissions tab in guest settings with a cleaner layout.' },
        { name: 'Guest Pass Expiration Revamp', desc: 'Guest pass expiration now allows more specific countdowns — down to minutes or a set time.' },
        { name: 'Guest Passes Page Revamp', desc: 'Guest passes page modernized with updated UI and improved workflow.' },
      ]},
      { icon: '👤', title: 'Profiles & Login', items: [
        { name: 'Profile UI Revamp', desc: 'Profile change UI has been slightly revamped for a cleaner look.' },
        { name: 'Profile Animations', desc: 'Opening profiles now has smooth animations and a modern layout inspired by Discord.' },
        { name: 'New Login Screen', desc: 'Fresh new login screen design.' },
      ]},
    ],
  },
  {
    version: '3.3.0',
    date: 'Mar 11 2026',
    intro: 'Full reminders system with multi-channel notifications, plus click-to-jump on replied messages.',
    sections: [
      { icon: '🔔', title: 'Reminders', items: [
        { name: 'Reminders Tab', desc: 'New dedicated Reminders section in the sidebar — create, edit, and manage reminders with priority levels.' },
        { name: 'Multi-Channel Notifications', desc: 'Get notified via on-site toast, push notification, and/or email — choose per reminder.' },
        { name: 'Snooze & Repeat', desc: 'Snooze reminders for 1 hour, or set them to repeat daily, weekly, or monthly.' },
        { name: 'Smart Badge', desc: 'Sidebar badge shows count of overdue reminders at a glance.' },
        { name: 'Rich Toast Notifications', desc: 'On-site reminders show as rich toasts with Snooze, Done, and Dismiss actions.' },
      ]},
      { icon: '💬', title: 'Chat', items: [
        { name: 'Click to Jump on Replies', desc: 'Click a replied message preview to jump to and highlight the original message.' },
      ]},
    ],
  },
  {
    version: '3.2.0',
    date: 'Mar 11 2026',
    intro: 'Bell schedules, smarter search, calendar reminders, and a bunch of quality-of-life fixes.',
    sections: [
      { icon: '🔔', title: 'Bell Schedule', items: [
        { name: 'Schedule Builder', desc: 'Add your class schedule in Settings with period names and times.' },
        { name: 'Late Start Support', desc: 'Configure a separate late-start schedule and pick your late-start day.' },
        { name: 'Current Class Display', desc: 'Your current class shows automatically in the chat header, sidebar, and profile.' },
        { name: 'Class Countdown Timer', desc: 'Countdown until your current class ends, shown in a bar above the chat. Toggle it off in Chat settings.' },
        { name: 'Skip Schedule (Eval)', desc: 'Use "skipclass <user>" in eval to skip the bell schedule for a day.' },
      ]},
      { icon: '💬', title: 'Chat & Search', items: [
        { name: 'Custom Status in Header', desc: 'Custom status text and emoji now show inline with presence in the chat header.' },
        { name: 'Search: Newest First', desc: 'Search results now show latest messages at the top.' },
        { name: 'Search: Better Times', desc: 'Search results show "Yesterday 3:30 PM" or "3/10/2026 3:30 PM" for older messages.' },
        { name: 'Pinned Messages: Full Text', desc: 'Pinned messages panel now shows the complete message instead of truncating.' },
        { name: 'Chat Layout: Full Width', desc: 'Chat messages now fill the full screen width in light and dark themes.' },
        { name: 'Scroll to Last Read', desc: 'Fixed unreliable scroll position when opening the site — now reliably jumps to your last read message.' },
      ]},
      { icon: '📅', title: 'Calendar', items: [
        { name: 'Event Reminders', desc: 'Set a reminder when creating events — get notified 0-7 days before.' },
        { name: 'Today\'s Events Banner', desc: 'A subtle banner shows at the top of chat when you have events today.' },
      ]},
      { icon: '🎨', title: 'Dark Theme', items: [
        { name: 'Search Bar Restored', desc: 'Search bar now appears in the dark theme horizontal top bar.' },
      ]},
    ],
  },
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
  // Primary: server-side per-user dismissed version (persists across devices)
  const serverDismissed = window._users?.[currentUser]?.dismissedChangelogVersion;
  // Fallback: localStorage for same-device fast check
  const localDismissed = localStorage.getItem('rkk-changelog-dismissed-' + currentUser);
  const dismissed = serverDismissed || localDismissed;
  if (dismissed === CHANGELOG[0].version) return;

  const container = document.getElementById('update-log-content');
  container.innerHTML = renderChangelogEntry(CHANGELOG[0]);
  openModal('update-log-modal');
}

async function dismissUpdateLog() {
  const latest = CHANGELOG[0];
  if (latest) {
    // Save to server so it persists across devices
    fetch('/api/users/' + currentUser, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissedChangelogVersion: latest.version })
    }).catch(console.error);
    // Also save locally as a fast-path cache
    localStorage.setItem('rkk-changelog-dismissed-' + currentUser, latest.version);
    // Update cached user data so re-checks in same session work
    if (window._users?.[currentUser]) {
      window._users[currentUser].dismissedChangelogVersion = latest.version;
    }
  }
  closeModal('update-log-modal');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MONEY DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

let _moneyData = null;
let _moneyTab = 'week';
let _moneyFeedPage = 1;
let _moneyDateState = { year: getNow().getFullYear(), month: getNow().getMonth(), selectedDate: null };
let _moneyRecurringView = false;

const MONEY_CATEGORIES = {
  food: { icon: 'utensils', label: 'Food' },
  groceries: { icon: 'shopping-basket', label: 'Groceries' },
  transport: { icon: 'car', label: 'Transport' },
  bills: { icon: 'receipt', label: 'Bills' },
  entertainment: { icon: 'tv', label: 'Fun' },
  health: { icon: 'heart-pulse', label: 'Health' },
  shopping: { icon: 'shopping-bag', label: 'Shopping' },
  other: { icon: 'circle-dot', label: 'Other' },
};

async function loadMoney() {
  // Show skeletons
  const setup = document.getElementById('money-setup');
  const dash = document.getElementById('money-dashboard');
  setup.style.display = 'none';
  dash.style.display = 'none';

  try {
    _moneyData = await fetch('/api/money').then(r => r.json());
  } catch { _moneyData = {}; }

  if (!_moneyData.setup) {
    setup.style.display = '';
    dash.style.display = 'none';
  } else {
    setup.style.display = 'none';
    dash.style.display = 'flex';
    _moneyRecurringView = false;
    document.getElementById('money-recurring-view').style.display = 'none';
    document.getElementById('money-grid').style.display = '';
    renderMoney(_moneyData);
  }
  if (window.lucide) lucide.createIcons();
}

async function submitMoneySetup() {
  const k = parseFloat(document.getElementById('money-setup-kaliph').value) || 0;
  const ka = parseFloat(document.getElementById('money-setup-kathrine').value) || 0;
  try {
    const res = await fetch('/api/money/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kaliph: k, kathrine: ka }),
    }).then(r => r.json());
    if (res.success) {
      _moneyData = res.money;
      document.getElementById('money-setup').style.display = 'none';
      document.getElementById('money-dashboard').style.display = 'flex';
      renderMoney(_moneyData);
      showToast('Money dashboard is ready!');
    }
  } catch (e) { showToast('Setup failed'); }
}

function renderMoney(data) {
  // Re-trigger animations
  document.querySelectorAll('.money-anim').forEach(el => {
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = '';
  });
  renderSnapshot(data);
  renderFeed(data);
  renderGoals(data);
  updateMoneyTabIndicator();
  if (window.lucide) lucide.createIcons();
}

function renderMoneyUpdate(oldData, newData) {
  // Flash balances on change
  if (oldData?.balances) {
    const kOld = oldData.balances.kaliph?.amount ?? 0;
    const kaOld = oldData.balances.kathrine?.amount ?? 0;
    const kNew = newData.balances.kaliph?.amount ?? 0;
    const kaNew = newData.balances.kathrine?.amount ?? 0;
    const kEl = document.getElementById('money-bal-kaliph');
    const kaEl = document.getElementById('money-bal-kathrine');
    if (kEl && kNew !== kOld) {
      kEl.classList.add(kNew > kOld ? 'balance-flash-green' : 'balance-flash-red');
      kEl.addEventListener('animationend', () => kEl.classList.remove('balance-flash-green', 'balance-flash-red'), { once: true });
    }
    if (kaEl && kaNew !== kaOld) {
      kaEl.classList.add(kaNew > kaOld ? 'balance-flash-green' : 'balance-flash-red');
      kaEl.addEventListener('animationend', () => kaEl.classList.remove('balance-flash-green', 'balance-flash-red'), { once: true });
    }
  }
  renderSnapshot(newData);
  renderFeed(newData);
  renderGoals(newData);
}

// ── Number Animation ──
function animateNumber(el, from, to, duration = 600, prefix = '$') {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = from + (to - from) * eased;
    el.textContent = prefix + current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// ── Ticker Calc ──
function calcTicker(current, previous) {
  if (previous == null || previous === 0) return null;
  const delta = current - previous;
  const pct = Math.round(Math.abs(delta / previous) * 100);
  const absDelta = Math.abs(delta).toFixed(2);
  const sign = delta >= 0 ? '+' : '-';
  const direction = delta >= 0 ? 'up' : 'down';
  return { direction, pct, absDelta, sign };
}

function renderSnapshot(data) {
  const container = document.getElementById('money-snapshot');
  const k = data.balances?.kaliph?.amount ?? 0;
  const ka = data.balances?.kathrine?.amount ?? 0;
  const combined = k + ka;

  // Find previous snapshot for tickers
  const snaps = data.dailySnapshots || [];
  const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
  const kTick = prev ? calcTicker(k, prev.kaliph) : null;
  const kaTick = prev ? calcTicker(ka, prev.kathrine) : null;

  // Weekly/monthly spend calcs
  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const twoWeeksAgo = now - 14 * 86400000;
  const txns = data.transactions || [];
  const thisWeekSpend = txns.filter(t => t.type === 'expense' && t.createdAt >= weekAgo).reduce((s, t) => s + t.amount, 0);
  const lastWeekSpend = txns.filter(t => t.type === 'expense' && t.createdAt >= twoWeeksAgo && t.createdAt < weekAgo).reduce((s, t) => s + t.amount, 0);
  const weekTick = calcTicker(thisWeekSpend, lastWeekSpend);

  function tickerHtml(tick, label, invertColor) {
    if (!tick) return `<div class="ticker"><span class="ticker-label">${label}</span> —</div>`;
    const cls = invertColor ? (tick.direction === 'up' ? 'ticker-down' : 'ticker-up') : (tick.direction === 'up' ? 'ticker-up' : 'ticker-down');
    const arrow = tick.direction === 'up' ? '↑' : '↓';
    return `<div class="ticker ${cls}">
      <span class="ticker-label">${label}</span>
      <span class="ticker-arrow">${arrow}</span> ${tick.pct}%
      <span class="tick-delta">(${tick.sign}$${tick.absDelta})</span>
    </div>`;
  }

  function balTickerHtml(tick) {
    if (!tick) return '';
    const cls = tick.direction === 'up' ? 'ticker-up' : 'ticker-down';
    const arrow = tick.direction === 'up' ? '↑' : '↓';
    return `<span class="ticker ${cls}" style="font-size:0.75rem;margin-left:8px">
      <span class="ticker-arrow">${arrow}</span> ${tick.pct}%
      <span class="tick-delta">(${tick.sign}$${tick.absDelta})</span>
    </span>`;
  }

  container.innerHTML = `
    <div class="money-combined" id="money-combined">$${combined.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
    <div class="money-balances">
      <div class="money-bal-card">
        <div class="money-bal-name">Kaliph</div>
        <div style="display:flex;align-items:center">
          <span class="money-bal-amount" id="money-bal-kaliph">$${k.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          ${balTickerHtml(kTick)}
        </div>
      </div>
      <div class="money-bal-card kathrine">
        <div class="money-bal-name">Kathrine</div>
        <div style="display:flex;align-items:center">
          <span class="money-bal-amount" id="money-bal-kathrine">$${ka.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          ${balTickerHtml(kaTick)}
        </div>
      </div>
    </div>
    <div class="money-tickers">
      ${tickerHtml(weekTick, 'Spent this week', true)}
    </div>
  `;
}

function renderFeed(data) {
  const container = document.getElementById('money-feed');
  const txns = [...(data.transactions || [])].sort((a, b) => b.createdAt - a.createdAt);

  // Filter by tab
  const now = Date.now();
  let filtered = txns;
  if (_moneyTab === 'week') filtered = txns.filter(t => t.createdAt >= now - 7 * 86400000);
  else if (_moneyTab === 'month') filtered = txns.filter(t => t.createdAt >= now - 30 * 86400000);

  const page = filtered.slice(0, _moneyFeedPage * 20);
  const hasMore = filtered.length > page.length;

  if (!page.length) {
    container.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="empty-state-icon">📊</div><div class="empty-state-text">No transactions yet</div></div>';
    return;
  }

  let html = '<div class="money-feed-list">';
  page.forEach(t => {
    const isDeposit = t.type === 'deposit';
    const cat = MONEY_CATEGORIES[t.category] || MONEY_CATEGORIES.other;
    const avatarClass = t.split ? 'feed-avatar-s' : (t.paidBy === 'kaliph' ? 'feed-avatar-k' : 'feed-avatar-ka');
    const avatarText = t.split ? 'S' : (t.paidBy === 'kaliph' ? 'K' : 'Ka');
    const dateStr = formatMoneyDate(t.date || t.createdAt);
    const amtStr = (isDeposit ? '+' : '-') + '$' + t.amount.toFixed(2);

    html += `<div class="feed-item">
      <div class="feed-avatar ${avatarClass}">${avatarText}</div>
      <div class="feed-body">
        <div class="feed-desc">${isDeposit ? 'Deposit' : escapeHtml(t.description || 'Expense')}</div>
        <div class="feed-meta">
          ${!isDeposit ? `<span class="feed-cat"><i data-lucide="${cat.icon}" style="width:10px;height:10px"></i> ${cat.label}</span>` : ''}
          <span>${dateStr}</span>
        </div>
      </div>
      <span class="feed-amount ${isDeposit ? 'deposit' : 'expense'}">${amtStr}</span>
      <button class="feed-delete" onclick="deleteTransaction('${t.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
    </div>`;
  });
  html += '</div>';
  if (hasMore) html += `<div class="feed-load-more" onclick="_moneyFeedPage++;renderFeed(_moneyData)">Load more</div>`;
  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function formatMoneyDate(d) {
  const date = typeof d === 'number' ? new Date(d) : new Date(d + 'T12:00:00');
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now - 86400000).toDateString();
  if (date.toDateString() === today) return 'Today';
  if (date.toDateString() === yesterday) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function switchMoneyTab(tab, el) {
  _moneyTab = tab;
  _moneyFeedPage = 1;
  document.querySelectorAll('.money-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  updateMoneyTabIndicator();
  if (_moneyData) renderFeed(_moneyData);
}

function updateMoneyTabIndicator() {
  const bar = document.getElementById('money-tab-bar');
  const indicator = document.getElementById('money-tab-indicator');
  const active = bar?.querySelector('.money-tab.active');
  if (!bar || !indicator || !active) return;
  indicator.style.left = active.offsetLeft + 'px';
  indicator.style.width = active.offsetWidth + 'px';
}

// ── Goals ──
function renderGoals(data) {
  const container = document.getElementById('money-goals');
  const goals = data.goals || [];
  const R = 38; // radius for 90px arc
  const circ = 2 * Math.PI * R;

  let html = '';
  goals.forEach((g, i) => {
    const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
    const offset = circ - (circ * pct / 100);
    const completed = g.completedAt != null;
    const daysLeft = g.targetDate ? Math.max(0, Math.ceil((new Date(g.targetDate) - new Date()) / 86400000)) : null;

    html += `<div class="goal-card${completed ? ' completed' : ''}">
      <div class="goal-arc-wrap">
        <svg viewBox="0 0 90 90">
          <circle class="goal-arc-track" cx="45" cy="45" r="${R}"/>
          <circle class="goal-arc" cx="45" cy="45" r="${R}"
            stroke="${g.color}" stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
            data-target-offset="${offset}" style="transition-delay:${i * 120}ms"/>
        </svg>
        <div class="goal-pct">${completed ? '✓' : pct + '%'}</div>
      </div>
      <div class="goal-name">${escapeHtml(g.name)}</div>
      <div class="goal-progress-text">$${g.currentAmount.toFixed(2)} / $${g.targetAmount.toFixed(2)}</div>
      ${daysLeft !== null && !completed ? `<div class="goal-countdown">in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</div>` : ''}
      <div class="goal-actions">
        ${!completed ? `<button class="goal-action-btn" onclick="openContribute('${g.id}')">+ Contribute</button>` : ''}
        <button class="goal-action-btn" onclick="editGoal('${g.id}')"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>
        <button class="goal-action-btn" onclick="deleteGoal('${g.id}')"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
      </div>
    </div>`;
  });

  html += `<div class="goal-new" onclick="openNewGoal()"><i data-lucide="plus" style="width:24px;height:24px"></i> New Goal</div>`;
  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();

  // Animate arcs after render
  requestAnimationFrame(() => {
    document.querySelectorAll('.goal-arc[data-target-offset]').forEach(arc => {
      arc.style.strokeDashoffset = arc.dataset.targetOffset;
    });
  });
}

// ── FAB + Quick Add ──
function openQuickAdd() {
  const fab = document.getElementById('money-fab');
  const modal = document.getElementById('money-add-modal');
  if (modal.classList.contains('open')) {
    closeQuickAdd();
    return;
  }
  fab.classList.add('open');
  openModal('money-add-modal');
  // Reset form
  document.getElementById('money-txn-type').value = 'expense';
  document.getElementById('money-txn-amount').value = '';
  document.getElementById('money-txn-desc').value = '';
  document.getElementById('money-txn-split').checked = false;
  document.getElementById('money-txn-date').value = '';
  document.getElementById('money-date-text').textContent = 'Today';
  document.querySelectorAll('#money-add-modal .money-modal-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  document.querySelectorAll('#money-add-modal .category-pill').forEach((p, i) => p.classList.toggle('selected', i === 0));
  document.querySelectorAll('#money-paidby-seg .seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.getElementById('money-category-section').style.display = '';
  document.getElementById('money-split-row').style.display = '';
  document.getElementById('money-paidby-label').textContent = 'Paid by';
  updateMoneyModalTabIndicator();
  setTimeout(() => document.getElementById('money-txn-amount')?.focus(), 100);
}

function closeQuickAdd() {
  document.getElementById('money-fab')?.classList.remove('open');
  closeModal('money-add-modal');
}

function switchMoneyModalTab(type, el) {
  document.getElementById('money-txn-type').value = type;
  document.querySelectorAll('.money-modal-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const isDeposit = type === 'deposit';
  document.getElementById('money-category-section').style.display = isDeposit ? 'none' : '';
  document.getElementById('money-split-row').style.display = isDeposit ? 'none' : '';
  document.getElementById('money-paidby-label').textContent = isDeposit ? 'Received by' : 'Paid by';
  updateMoneyModalTabIndicator();
}

function updateMoneyModalTabIndicator() {
  const tabs = document.querySelector('.money-modal-tabs');
  const indicator = document.getElementById('money-modal-tab-indicator');
  const active = tabs?.querySelector('.money-modal-tab.active');
  if (!tabs || !indicator || !active) return;
  indicator.style.left = active.offsetLeft + 'px';
  indicator.style.width = active.offsetWidth + 'px';
}

function selectCategory(el) {
  document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

function selectSeg(el) {
  el.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

async function submitTransaction() {
  const type = document.getElementById('money-txn-type').value;
  const amount = parseFloat(document.getElementById('money-txn-amount').value);
  if (!amount || amount <= 0) { showToast('Enter an amount'); return; }
  const description = document.getElementById('money-txn-desc').value.trim();
  const category = document.querySelector('.category-pill.selected')?.dataset.cat || 'other';
  const paidBy = document.querySelector('#money-paidby-seg .seg-btn.active')?.dataset.val || 'kaliph';
  const split = document.getElementById('money-txn-split').checked;
  const date = document.getElementById('money-txn-date').value || new Date().toISOString().split('T')[0];

  try {
    await fetch('/api/money/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, amount, description, category, paidBy, split, date }),
    });
    closeQuickAdd();
    showToast(type === 'deposit' ? 'Deposit added!' : 'Expense logged!');
  } catch { showToast('Failed to add transaction'); }
}

async function deleteTransaction(id) {
  const ok = await showConfirmDialog({ title: 'Delete transaction?', msg: 'This will reverse the balance effect.', icon: '🗑️' });
  if (!ok) return;
  try {
    await fetch('/api/money/transactions/' + id, { method: 'DELETE' });
    showToast('Transaction deleted');
  } catch { showToast('Failed to delete'); }
}

// ── Goals CRUD ──
function openNewGoal() {
  document.getElementById('money-goal-edit-id').value = '';
  document.getElementById('money-goal-name').value = '';
  document.getElementById('money-goal-target').value = '';
  document.getElementById('money-goal-date').value = '';
  document.querySelectorAll('.color-swatch').forEach((s, i) => s.classList.toggle('active', i === 0));
  document.getElementById('money-goal-modal-title').textContent = 'New Savings Goal';
  document.getElementById('money-goal-save-btn').textContent = 'Create Goal';
  openModal('money-goal-modal');
}

function editGoal(id) {
  const goal = (_moneyData?.goals || []).find(g => g.id === id);
  if (!goal) return;
  document.getElementById('money-goal-edit-id').value = id;
  document.getElementById('money-goal-name').value = goal.name;
  document.getElementById('money-goal-target').value = goal.targetAmount;
  document.getElementById('money-goal-date').value = goal.targetDate || '';
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === goal.color));
  document.getElementById('money-goal-modal-title').textContent = 'Edit Goal';
  document.getElementById('money-goal-save-btn').textContent = 'Save Changes';
  openModal('money-goal-modal');
}

function selectGoalColor(el) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

async function saveGoal() {
  const editId = document.getElementById('money-goal-edit-id').value;
  const name = document.getElementById('money-goal-name').value.trim();
  const targetAmount = parseFloat(document.getElementById('money-goal-target').value);
  const color = document.querySelector('.color-swatch.active')?.dataset.color || '#4f46e5';
  const targetDate = document.getElementById('money-goal-date').value || null;
  if (!name) { showToast('Enter a goal name'); return; }
  if (!targetAmount || targetAmount <= 0) { showToast('Enter a target amount'); return; }

  const url = editId ? `/api/money/goals/${editId}` : '/api/money/goals';
  const method = editId ? 'PUT' : 'POST';
  try {
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, targetAmount, color, targetDate }) });
    closeModal('money-goal-modal');
    showToast(editId ? 'Goal updated!' : 'Goal created!');
  } catch { showToast('Failed to save goal'); }
}

async function deleteGoal(id) {
  const ok = await showConfirmDialog({ title: 'Delete goal?', msg: 'This cannot be undone.', icon: '🗑️' });
  if (!ok) return;
  try {
    await fetch('/api/money/goals/' + id, { method: 'DELETE' });
    showToast('Goal deleted');
  } catch { showToast('Failed to delete'); }
}

function openContribute(goalId) {
  document.getElementById('money-contrib-goal-id').value = goalId;
  document.getElementById('money-contrib-amount').value = '';
  document.getElementById('money-contrib-note').value = '';
  openModal('money-contribute-modal');
  setTimeout(() => document.getElementById('money-contrib-amount')?.focus(), 100);
}

async function submitContribution() {
  const goalId = document.getElementById('money-contrib-goal-id').value;
  const amount = parseFloat(document.getElementById('money-contrib-amount').value);
  const note = document.getElementById('money-contrib-note').value.trim();
  if (!amount || amount <= 0) { showToast('Enter an amount'); return; }

  const goal = (_moneyData?.goals || []).find(g => g.id === goalId);
  const wasDone = goal?.completedAt != null;

  try {
    const res = await fetch(`/api/money/goals/${goalId}/contribute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, note, _wasCompleted: wasDone }),
    }).then(r => r.json());
    closeModal('money-contribute-modal');
    showToast('Contribution added!');
    if (res.justCompleted) {
      // Confetti!
      if (typeof confetti === 'function') {
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      }
      showToast('🎉 Goal reached! ' + (res.goal?.name || '') + ' complete!');
    }
  } catch { showToast('Failed to contribute'); }
}

// ── Recurring ──
function toggleRecurringView() {
  _moneyRecurringView = !_moneyRecurringView;
  document.getElementById('money-grid').style.display = _moneyRecurringView ? 'none' : '';
  document.getElementById('money-recurring-view').style.display = _moneyRecurringView ? '' : 'none';
  document.getElementById('money-fab').style.display = _moneyRecurringView ? 'none' : '';
  if (_moneyRecurringView) renderRecurring();
}

function renderRecurring() {
  const list = document.getElementById('money-recurring-list');
  const recs = _moneyData?.recurring || [];
  if (!recs.length) {
    list.innerHTML = '<div class="empty-state" style="padding:2rem"><div class="empty-state-icon">📋</div><div class="empty-state-text">No recurring bills</div></div>';
    return;
  }
  list.innerHTML = recs.map(r => {
    const cat = MONEY_CATEGORIES[r.category] || MONEY_CATEGORIES.other;
    return `<div class="rec-item">
      <div class="feed-avatar feed-avatar-s" style="width:32px;height:32px;font-size:0.65rem"><i data-lucide="repeat" style="width:14px;height:14px"></i></div>
      <div class="rec-body">
        <div class="rec-desc">${escapeHtml(r.description)}</div>
        <div class="rec-meta">${capitalize(r.frequency)} · $${r.amount.toFixed(2)} · Next: ${r.nextDate}</div>
      </div>
      <div class="rec-actions">
        <button class="btn-ghost btn-sm" onclick="logRecurringNow('${r.id}')" style="font-size:0.72rem">Log Now</button>
        <button class="btn-icon" onclick="deleteRecurring('${r.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
      </div>
    </div>`;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

async function submitRecurring() {
  const description = document.getElementById('money-rec-desc').value.trim();
  const amount = parseFloat(document.getElementById('money-rec-amount').value);
  if (!description) { showToast('Enter a description'); return; }
  if (!amount || amount <= 0) { showToast('Enter an amount'); return; }
  const frequency = document.querySelector('#money-recurring-modal .seg-btn.active')?.dataset.val || 'monthly';
  const paidBy = document.querySelector('#money-rec-paidby .seg-btn.active')?.dataset.val || 'shared';
  const nextDate = document.getElementById('money-rec-next').value || new Date().toISOString().split('T')[0];

  try {
    await fetch('/api/money/recurring', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, amount, category: 'bills', paidBy, split: paidBy === 'shared', frequency, nextDate }),
    });
    closeModal('money-recurring-modal');
    showToast('Recurring bill added!');
    if (_moneyRecurringView) renderRecurring();
  } catch { showToast('Failed to add'); }
}

async function logRecurringNow(id) {
  try {
    await fetch(`/api/money/recurring/${id}/log`, { method: 'POST' });
    showToast('Logged!');
  } catch { showToast('Failed'); }
}

async function deleteRecurring(id) {
  const ok = await showConfirmDialog({ title: 'Delete recurring bill?', msg: 'This cannot be undone.', icon: '🗑️' });
  if (!ok) return;
  try {
    await fetch('/api/money/recurring/' + id, { method: 'DELETE' });
    showToast('Removed');
  } catch { showToast('Failed'); }
}

// ── Money Date Picker (simplified, date only) ──
function toggleMoneyDatePicker() {
  const picker = document.getElementById('money-date-picker');
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
  picker.style.display = '';
  renderMoneyDateGrid();
}
function closeMoneyDatePicker() {
  document.getElementById('money-date-picker').style.display = 'none';
}
function moneyDateNav(dir) {
  _moneyDateState.month += dir;
  if (_moneyDateState.month > 11) { _moneyDateState.month = 0; _moneyDateState.year++; }
  if (_moneyDateState.month < 0) { _moneyDateState.month = 11; _moneyDateState.year--; }
  renderMoneyDateGrid();
}
function renderMoneyDateGrid() {
  const { year, month } = _moneyDateState;
  document.getElementById('money-date-month').textContent = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' });
  const grid = document.getElementById('money-date-grid');
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];
  let html = '<div class="cdtp-day-header">S</div><div class="cdtp-day-header">M</div><div class="cdtp-day-header">T</div><div class="cdtp-day-header">W</div><div class="cdtp-day-header">T</div><div class="cdtp-day-header">F</div><div class="cdtp-day-header">S</div>';
  for (let i = 0; i < firstDay; i++) html += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const sel = _moneyDateState.selectedDate === dateStr ? ' cdtp-selected' : '';
    const isToday = dateStr === today ? ' style="font-weight:700"' : '';
    html += `<div class="cdtp-day${sel}"${isToday} onclick="selectMoneyDate('${dateStr}')">${d}</div>`;
  }
  grid.innerHTML = html;
}
function selectMoneyDate(dateStr) {
  _moneyDateState.selectedDate = dateStr;
  document.getElementById('money-txn-date').value = dateStr;
  const d = new Date(dateStr + 'T12:00:00');
  document.getElementById('money-date-text').textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  renderMoneyDateGrid();
  closeMoneyDatePicker();
}

// ── Load confetti from CDN ──
(function loadConfetti() {
  if (typeof confetti !== 'undefined') return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
  s.async = true;
  document.head.appendChild(s);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// TOTP AUTHENTICATOR
// ═══════════════════════════════════════════════════════════════════════════════

let totpAccounts = [];
let totpTimerInterval = null;
let totpQrParsedData = null; // { name, secret, issuer } from QR scan

// ── Base32 decode ──
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const c of str) {
    const val = alphabet.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

// ── HMAC-SHA1 (Web Crypto) ──
async function hmacSha1(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}

// ── Generate TOTP code ──
async function generateTOTP(secret, timeStep = 30, digits = 6) {
  const keyBytes = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / timeStep);
  const counterBytes = new Uint8Array(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  const hmac = await hmacSha1(keyBytes, counterBytes);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % (10 ** digits);
  return code.toString().padStart(digits, '0');
}

function getTotpTimeRemaining() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

// ── Settings toggle ──
function toggleTotpFeature(el) {
  const enabled = el.checked;
  const nav = document.getElementById('nav-authenticator');
  if (nav) nav.style.display = enabled ? '' : 'none';
  fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totpEnabled: enabled })
  });
  if (!enabled && currentSection === 'authenticator') {
    showSection('chat', document.querySelector('[data-section="chat"]'));
  }
}

// ── Init TOTP when section is shown ──
async function initTotpSection() {
  try {
    const resp = await fetch('/api/totp/status');
    if (!resp.ok) throw new Error('Status check failed: ' + resp.status);
    const res = await resp.json();
    const loginScreen = document.getElementById('totp-login-screen');
    const mainUI = document.getElementById('totp-main');

    // Update security settings tab too
    updateTotpSettingsUI(res.hasPassword);

    if (res.unlocked) {
      loginScreen.style.display = 'none';
      mainUI.style.display = 'flex';
      await loadTotpAccounts();
      startTotpTimer();
    } else {
      loginScreen.style.display = 'flex';
      mainUI.style.display = 'none';
      // Show setup or login
      const loginFields = document.getElementById('totp-login-fields');
      const setupFields = document.getElementById('totp-setup-fields');
      const sub = document.getElementById('totp-login-sub');
      if (res.hasPassword) {
        loginFields.style.display = 'flex';
        setupFields.style.display = 'none';
        sub.textContent = 'Enter your authenticator password to unlock';
        document.getElementById('totp-password-input').value = '';
        setTimeout(function() { document.getElementById('totp-password-input').focus(); }, 100);
      } else {
        loginFields.style.display = 'none';
        setupFields.style.display = 'flex';
        sub.textContent = 'First time? Set up your authenticator password';
        document.getElementById('totp-new-password').value = '';
        document.getElementById('totp-confirm-password').value = '';
        setTimeout(function() { document.getElementById('totp-new-password').focus(); }, 100);
      }
    }
    // Wire up button handlers (use addEventListener to survive DOM changes)
    const unlockBtn = document.getElementById('totp-unlock-btn');
    if (unlockBtn) {
      unlockBtn.onclick = function(e) { e.preventDefault(); totpLogin(); };
    }
    const setPwBtn = document.getElementById('totp-setpw-btn');
    if (setPwBtn) {
      setPwBtn.onclick = function(e) { e.preventDefault(); totpSetPassword(); };
    }
    const pwInput = document.getElementById('totp-password-input');
    if (pwInput) {
      pwInput.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); totpLogin(); } };
    }
    const confirmInput = document.getElementById('totp-confirm-password');
    if (confirmInput) {
      confirmInput.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); totpSetPassword(); } };
    }
    // Re-init icons after showing the section
    if (window.lucide) lucide.createIcons();
  } catch(e) {
    console.error('initTotpSection error:', e);
  }
}

function updateTotpSettingsUI(hasPassword) {
  const changeDiv = document.getElementById('totp-pw-change');
  const setupDiv = document.getElementById('totp-pw-setup');
  if (hasPassword) {
    changeDiv.style.display = '';
    setupDiv.style.display = 'none';
  } else {
    changeDiv.style.display = 'none';
    setupDiv.style.display = '';
  }
}

async function totpChangePasswordFromSettings() {
  const current = document.getElementById('totp-settings-current-pw').value;
  const newPw = document.getElementById('totp-settings-new-pw').value;
  const confirmPw = document.getElementById('totp-settings-confirm-pw').value;
  if (!current) { showToast('Please enter your current password'); return; }
  if (newPw.length < 4) { showToast('New password must be at least 4 characters'); return; }
  if (newPw !== confirmPw) { showToast('Passwords do not match'); return; }
  try {
    const res = await fetch('/api/totp/set-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPw, currentPassword: current })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to change password'); return; }
    showToast('Authenticator password updated!');
    document.getElementById('totp-settings-current-pw').value = '';
    document.getElementById('totp-settings-new-pw').value = '';
    document.getElementById('totp-settings-confirm-pw').value = '';
  } catch(e) { console.error('TOTP change pw error:', e); showToast('Failed to change password'); }
}

async function totpSetupPasswordFromSettings() {
  const pw = document.getElementById('totp-settings-setup-pw').value;
  const confirmPw = document.getElementById('totp-settings-setup-confirm').value;
  if (pw.length < 4) { showToast('Password must be at least 4 characters'); return; }
  if (pw !== confirmPw) { showToast('Passwords do not match'); return; }
  try {
    const res = await fetch('/api/totp/set-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to set password'); return; }
    showToast('Authenticator password set!');
    updateTotpSettingsUI(true);
    document.getElementById('totp-settings-setup-pw').value = '';
    document.getElementById('totp-settings-setup-confirm').value = '';
  } catch(e) { console.error('TOTP setup pw error:', e); showToast('Failed to set password'); }
}

async function totpLogin() {
  const input = document.getElementById('totp-password-input');
  const pw = input.value;
  if (!pw) {
    totpShakeCard();
    showToast('Please enter your password');
    return;
  }
  try {
    const res = await fetch('/api/totp/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (!res.ok) {
      totpShakeCard();
      input.value = '';
      input.focus();
      showToast(data.error || 'Incorrect password');
      return;
    }
    document.getElementById('totp-login-screen').style.display = 'none';
    document.getElementById('totp-main').style.display = 'flex';
    showToast('Authenticator unlocked!');
    await loadTotpAccounts();
    startTotpTimer();
  } catch(e) {
    console.error('TOTP login error:', e);
    totpShakeCard();
    showToast('Failed to authenticate');
  }
}

async function totpSetPassword() {
  const pw = document.getElementById('totp-new-password').value;
  const confirmVal = document.getElementById('totp-confirm-password').value;
  if (pw.length < 4) { totpShakeCard(); showToast('Password must be at least 4 characters'); return; }
  if (pw !== confirmVal) { totpShakeCard(); showToast('Passwords do not match'); return; }
  try {
    const res = await fetch('/api/totp/set-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const data = await res.json();
    if (!res.ok) { totpShakeCard(); showToast(data.error || 'Failed to set password'); return; }
    showToast('Authenticator password set!');
    document.getElementById('totp-login-screen').style.display = 'none';
    document.getElementById('totp-main').style.display = 'flex';
    await loadTotpAccounts();
    startTotpTimer();
  } catch(e) {
    console.error('TOTP set password error:', e);
    totpShakeCard();
    showToast('Failed to set password');
  }
}

function totpShakeCard() {
  const card = document.querySelector('.totp-login-card');
  if (!card) return;
  card.style.animation = 'none';
  card.offsetHeight; // force reflow
  card.style.animation = 'totpShake 0.5s ease';
}

async function totpLock() {
  await fetch('/api/totp/lock', { method: 'POST' });
  stopTotpTimer();
  totpAccounts = [];
  document.getElementById('totp-main').style.display = 'none';
  document.getElementById('totp-login-screen').style.display = '';
  initTotpSection();
  showToast('Authenticator locked');
}

async function loadTotpAccounts() {
  try {
    const res = await fetch('/api/totp/accounts');
    if (!res.ok) { totpAccounts = []; renderTotpGrid(); return; }
    totpAccounts = await res.json();
    renderTotpGrid();
  } catch { totpAccounts = []; renderTotpGrid(); }
}

async function renderTotpGrid() {
  const grid = document.getElementById('totp-grid');
  const empty = document.getElementById('totp-empty');
  const countEl = document.getElementById('totp-account-count');
  countEl.textContent = totpAccounts.length + ' account' + (totpAccounts.length !== 1 ? 's' : '');

  if (!totpAccounts.length) {
    grid.innerHTML = '';
    grid.appendChild(empty.cloneNode ? createTotpEmpty() : empty);
    // Ensure empty state is visible
    const emptyState = grid.querySelector('.totp-empty-state');
    if (emptyState) emptyState.style.display = '';
    return;
  }

  grid.innerHTML = '';
  const remaining = getTotpTimeRemaining();
  const R = 17;
  const C = 2 * Math.PI * R;

  for (const account of totpAccounts) {
    const code = await generateTOTP(account.secret);
    const formattedCode = code.slice(0, 3) + ' ' + code.slice(3);
    const isUrgent = remaining <= 5;

    const card = document.createElement('div');
    card.className = 'totp-card';
    card.dataset.id = account.id;

    const issuerHtml = account.issuer
      ? `<a class="totp-card-issuer" href="https://${encodeURI(account.issuer)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escapeHtml(account.issuer)}</a>`
      : '';

    card.innerHTML = `
      <div class="totp-card-top">
        <div class="totp-card-info">
          <div class="totp-card-name">${escapeHtml(account.name)}</div>
          ${issuerHtml}
        </div>
        <div class="totp-card-actions">
          <button class="totp-card-btn" onclick="event.stopPropagation(); openTotpEdit('${account.id}')" title="Edit"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="totp-card-btn totp-card-btn-danger" onclick="event.stopPropagation(); openTotpDelete('${account.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </div>
      <div class="totp-card-bottom">
        <div class="totp-card-code">
          <span class="totp-code-digits">${formattedCode}</span>
          <span class="totp-code-copied" style="display:none">Copied!</span>
        </div>
        <div class="totp-card-ring${isUrgent ? ' urgent' : ''}">
          <svg viewBox="0 0 40 40" class="totp-ring-svg">
            <circle cx="20" cy="20" r="${R}" fill="none" stroke="var(--border)" stroke-width="3" opacity="0.2"/>
            <circle cx="20" cy="20" r="${R}" fill="none" stroke="${isUrgent ? '#ef4444' : 'var(--accent)'}" stroke-width="3"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - remaining / 30)}"
              stroke-linecap="round" class="totp-ring-progress" style="transition:stroke-dashoffset 1s linear"/>
          </svg>
          <span class="totp-ring-time">${remaining}s</span>
        </div>
      </div>
    `;

    card.style.cursor = 'pointer';
    card.title = 'Click to copy code';
    card.addEventListener('click', () => {
      const codeEl = card.querySelector('.totp-card-code');
      totpCopyCode(codeEl, code);
    });
    grid.appendChild(card);
  }
  if (window.lucide) lucide.createIcons();
}

function createTotpEmpty() {
  const div = document.createElement('div');
  div.className = 'totp-empty-state';
  div.innerHTML = `
    <div class="totp-empty-icon"><i data-lucide="shield-check" style="width:56px;height:56px;opacity:0.3"></i></div>
    <div class="totp-empty-text">No accounts yet</div>
    <div class="totp-empty-sub">Add your first 2FA account to get started</div>
    <button class="btn-primary" onclick="openTotpAddModal()" style="margin-top:12px;display:inline-flex;align-items:center;gap:6px"><i data-lucide="plus" style="width:15px;height:15px"></i> Add Account</button>
  `;
  return div;
}

function startTotpTimer() {
  stopTotpTimer();
  updateTotpTimerBar();
  totpTimerInterval = setInterval(async () => {
    const remaining = getTotpTimeRemaining();
    updateTotpTimerBar();
    // Update ring timers
    document.querySelectorAll('.totp-ring-progress').forEach(ring => {
      ring.setAttribute('stroke-dashoffset', 2 * Math.PI * 17 * (1 - remaining / 30));
      ring.setAttribute('stroke', remaining <= 5 ? '#ef4444' : 'var(--accent)');
    });
    document.querySelectorAll('.totp-ring-time').forEach(el => {
      el.textContent = remaining + 's';
    });
    document.querySelectorAll('.totp-card-ring').forEach(el => {
      el.classList.toggle('urgent', remaining <= 5);
    });
    // Refresh codes when they rotate
    if (remaining === 30 || remaining === 29) {
      await renderTotpGrid();
    }
  }, 1000);
}

function stopTotpTimer() {
  if (totpTimerInterval) { clearInterval(totpTimerInterval); totpTimerInterval = null; }
}

function updateTotpTimerBar() {
  const remaining = getTotpTimeRemaining();
  const fill = document.getElementById('totp-timer-fill');
  if (fill) {
    fill.style.width = (remaining / 30 * 100) + '%';
    fill.style.background = remaining <= 5 ? '#ef4444' : 'var(--accent)';
  }
}

// ── Copy code to clipboard ──
function totpCopyCode(el, code) {
  navigator.clipboard.writeText(code).then(() => {
    const digits = el.querySelector('.totp-code-digits');
    const copied = el.querySelector('.totp-code-copied');
    digits.style.display = 'none';
    copied.style.display = '';
    el.classList.add('copied');
    setTimeout(() => {
      digits.style.display = '';
      copied.style.display = 'none';
      el.classList.remove('copied');
    }, 1500);
  });
}

// ── Add Account Modal ──
function openTotpAddModal() {
  totpQrParsedData = null;
  document.getElementById('totp-add-name').value = '';
  document.getElementById('totp-add-issuer').value = '';
  document.getElementById('totp-add-secret').value = '';
  resetTotpQr();
  switchTotpAddTab('manual', document.querySelector('.totp-add-tab'));
  openModal('totp-add-modal');
  setTimeout(() => document.getElementById('totp-add-name').focus(), 100);
}

function switchTotpAddTab(tab, btn) {
  document.querySelectorAll('.totp-add-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('totp-add-manual').style.display = tab === 'manual' ? '' : 'none';
  document.getElementById('totp-add-qr').style.display = tab === 'qr' ? '' : 'none';
}

async function totpAddAccount() {
  let name, secret, issuer;
  if (totpQrParsedData) {
    name = totpQrParsedData.name || document.getElementById('totp-add-name').value;
    secret = totpQrParsedData.secret;
    issuer = totpQrParsedData.issuer || '';
  } else {
    name = document.getElementById('totp-add-name').value.trim();
    secret = document.getElementById('totp-add-secret').value.trim().replace(/\s+/g, '');
    issuer = document.getElementById('totp-add-issuer').value.trim();
  }
  if (!name) { showToast('Please enter an account name'); return; }
  if (!secret) { showToast('Please enter a secret key'); return; }
  try {
    const res = await fetch('/api/totp/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, secret, issuer })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Failed to add account'); return; }
    closeModal('totp-add-modal');
    showToast('2FA account added!');
    await loadTotpAccounts();
  } catch { showToast('Failed to add account'); }
}

// ── QR Code Upload & Parse ──
function handleTotpQrUpload(input) {
  const file = input.files[0];
  if (!file) return;
  parseTotpQrImage(file);
}

// Set up drag & drop and paste for QR dropzone
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('totp-qr-dropzone');
  if (!dropzone) return;
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) parseTotpQrImage(file);
  });

  // Paste support — listen on the whole document, only act when QR tab is visible
  document.addEventListener('paste', e => {
    const qrTab = document.getElementById('totp-add-qr');
    if (!qrTab || qrTab.style.display === 'none') return;
    // Also check the modal is open
    const modal = document.getElementById('totp-add-modal');
    if (!modal || !modal.classList.contains('open')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) parseTotpQrImage(file);
        return;
      }
    }
  });
});

async function parseTotpQrImage(file) {
  const statusEl = document.getElementById('totp-qr-result-status');
  const previewEl = document.getElementById('totp-qr-preview');
  const dropzone = document.getElementById('totp-qr-dropzone');
  const imgEl = document.getElementById('totp-qr-preview-img');
  const nameEl = document.getElementById('totp-qr-result-name');
  const issuerEl = document.getElementById('totp-qr-result-issuer');

  // Show image preview
  const reader = new FileReader();
  reader.onload = async function(e) {
    imgEl.src = e.target.result;
    dropzone.style.display = 'none';
    previewEl.style.display = '';
    statusEl.textContent = 'Scanning QR code...';

    try {
      // Use jsQR library (loaded dynamically)
      await loadJsQR();
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
        if (qrCode && qrCode.data) {
          console.log('QR code data:', qrCode.data);
          const parsed = parseTotpUri(qrCode.data);
          if (parsed) {
            totpQrParsedData = parsed;
            nameEl.textContent = parsed.name || 'Unknown';
            issuerEl.textContent = parsed.issuer || '';
            statusEl.textContent = 'QR code scanned successfully!';
            statusEl.style.color = '#22c55e';
            // Pre-fill manual fields too
            document.getElementById('totp-add-name').value = parsed.name || '';
            document.getElementById('totp-add-issuer').value = parsed.issuer || '';
            document.getElementById('totp-add-secret').value = parsed.secret || '';
          } else {
            statusEl.textContent = 'QR code found but not a valid TOTP URI';
            statusEl.style.color = '#ef4444';
          }
        } else {
          statusEl.textContent = 'Could not detect a QR code in the image';
          statusEl.style.color = '#ef4444';
        }
      };
      img.src = e.target.result;
    } catch (err) {
      statusEl.textContent = 'Failed to scan QR code';
      statusEl.style.color = '#ef4444';
    }
  };
  reader.readAsDataURL(file);
}

function parseTotpUri(uri) {
  // otpauth://totp/Label?secret=XXX&issuer=YYY
  // Manual parsing because new URL() doesn't handle otpauth:// reliably across browsers
  try {
    if (!uri) return null;
    const str = uri.trim();
    // Match otpauth://totp/ pattern (case insensitive)
    const match = str.match(/^otpauth:\/\/totp\/([^?]+)\?(.+)$/i);
    if (!match) {
      // Also try without label (some services omit it)
      const match2 = str.match(/^otpauth:\/\/totp\/?(\?(.+))$/i);
      if (!match2) return null;
      // Parse params only
      const params = new URLSearchParams(match2[2] || match2[1]);
      const secret = params.get('secret');
      if (!secret) return null;
      return { name: params.get('issuer') || 'Unknown', secret: secret.toUpperCase(), issuer: params.get('issuer') || '' };
    }
    const label = decodeURIComponent(match[1]);
    const params = new URLSearchParams(match[2]);
    const secret = params.get('secret');
    if (!secret) return null;
    const issuer = params.get('issuer') || '';
    // Label might be "Issuer:account" or just "account"
    let name = label;
    let parsedIssuer = issuer;
    if (label.includes(':')) {
      const parts = label.split(':');
      parsedIssuer = parsedIssuer || parts[0].trim();
      name = parts.slice(1).join(':').trim();
    }
    return { name: name || 'Unknown', secret: secret.toUpperCase(), issuer: parsedIssuer };
  } catch(e) { console.error('parseTotpUri error:', e, uri); return null; }
}

let jsQRLoaded = false;
function loadJsQR() {
  if (jsQRLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.onload = () => { jsQRLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function resetTotpQr() {
  totpQrParsedData = null;
  document.getElementById('totp-qr-dropzone').style.display = '';
  document.getElementById('totp-qr-preview').style.display = 'none';
  document.getElementById('totp-qr-result-status').style.color = 'var(--accent)';
  document.getElementById('totp-qr-file').value = '';
}

// ── Edit Account ──
function openTotpEdit(id) {
  const account = totpAccounts.find(a => a.id === id);
  if (!account) return;
  document.getElementById('totp-edit-id').value = id;
  document.getElementById('totp-edit-name').value = account.name;
  document.getElementById('totp-edit-issuer').value = account.issuer || '';
  openModal('totp-edit-modal');
}

async function totpSaveEdit() {
  const id = document.getElementById('totp-edit-id').value;
  const name = document.getElementById('totp-edit-name').value.trim();
  const issuer = document.getElementById('totp-edit-issuer').value.trim();
  if (!name) { showToast('Name cannot be empty'); return; }
  try {
    const res = await fetch(`/api/totp/accounts/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, issuer })
    });
    if (!res.ok) { showToast('Failed to update'); return; }
    closeModal('totp-edit-modal');
    showToast('Account updated!');
    await loadTotpAccounts();
  } catch { showToast('Failed to update'); }
}

// ── Delete Account ──
let totpDeleteId = null;
function openTotpDelete(id) {
  const account = totpAccounts.find(a => a.id === id);
  if (!account) return;
  totpDeleteId = id;
  document.getElementById('totp-delete-name').textContent = account.name;
  openModal('totp-delete-modal');
}

async function totpConfirmDelete() {
  if (!totpDeleteId) return;
  try {
    const res = await fetch(`/api/totp/accounts/${totpDeleteId}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Failed to delete'); return; }
    closeModal('totp-delete-modal');
    showToast('Account deleted');
    totpDeleteId = null;
    await loadTotpAccounts();
  } catch { showToast('Failed to delete'); }
}

// ── Start ─────────────────────────────────────────────────────────────
init().catch(err => console.error('Init failed:', err));
