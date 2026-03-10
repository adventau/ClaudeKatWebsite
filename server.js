require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer = require('multer');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// ── Directories ──────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(path.join(DATA_DIR, 'sessions'));

// ── Data file paths ───────────────────────────────────────────────────────────
const F = {
  messages:      path.join(DATA_DIR, 'messages.json'),
  users:         path.join(DATA_DIR, 'users.json'),
  notes:         path.join(DATA_DIR, 'notes.json'),
  contacts:      path.join(DATA_DIR, 'contacts.json'),
  vault:         path.join(DATA_DIR, 'vault.json'),
  calendar:      path.join(DATA_DIR, 'calendar.json'),
  brainstorm:    path.join(DATA_DIR, 'brainstorm.json'),
  guests:        path.join(DATA_DIR, 'guests.json'),
  announcements: path.join(DATA_DIR, 'announcements.json'),
  settings:      path.join(DATA_DIR, 'settings.json'),
  suggestions:   path.join(DATA_DIR, 'suggestions.json'),
};

function rd(file)       { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; } }
function wd(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ── Initialize default data ───────────────────────────────────────────────────
function initData() {
  if (!rd(F.settings)) {
    wd(F.settings, {
      sitePassword:  bcrypt.hashSync('KaiKat2024!', 10),
      emails:        { kaliph: '', kathrine: '', shared: 'royalkvault@gmail.com' },
      vaultPasscode: '0000',
    });
  }
  if (!rd(F.users)) {
    wd(F.users, {
      kaliph: {
        name: 'Kaliph', displayName: 'Kaliph', theme: 'kaliph',
        status: 'online', customStatus: '', avatar: null, email: '',
        nameStyle: { color: '#7c3aed', gradient: true, font: 'Orbitron' },
        gifEnabled: true, wallpaperEnabled: true, wallpaper: null,
        font: 'default', bio: '', dashboardLayout: [], pinnedNotes: [],
      },
      kathrine: {
        name: 'Kathrine', displayName: 'Kathrine', theme: 'kathrine',
        status: 'online', customStatus: '', avatar: null, email: '',
        nameStyle: { color: '#c084fc', gradient: true, font: 'Cormorant Garamond' },
        gifEnabled: true, wallpaperEnabled: true, wallpaper: null,
        font: 'default', bio: '', dashboardLayout: [], pinnedNotes: [],
      }
    });
  }
  const defaults = {
    messages:      { main: [], brainstorm: [] },
    notes:         { kaliph: [], kathrine: [] },
    contacts:      [],
    vault:         { kaliph: [], kathrine: [] },
    calendar:      { kaliph: [], kathrine: [], shared: [] },
    brainstorm:    [],
    guests:        {},
    announcements: [],
    suggestions:   [],
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!rd(F[k])) wd(F[k], v);
  }
}
initData();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploads from persistent volume when UPLOADS_DIR is external
if (process.env.UPLOADS_DIR) app.use('/uploads', express.static(UPLOADS_DIR));
app.use(session({
  store: new FileStore({ path: path.join(DATA_DIR, 'sessions'), ttl: 7200, retries: 0, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'royal-vault-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 2 * 60 * 60 * 1000 }
}));

// ── File upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename:    (_, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── Email ─────────────────────────────────────────────────────────────────────
// Uses Brevo HTTP API (works on Railway/cloud) if BREVO_API_KEY is set,
// otherwise falls back to nodemailer/Gmail SMTP (works locally).
let _transporter = null;

function getEmailProvider() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) return 'smtp';
  return null;
}

function mailer() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      pool: true,
      maxConnections: 3,
    });
  }
  return _transporter;
}

async function sendMailBrevo(to, subject, html, attachments = []) {
  const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'royalkvault@gmail.com';
  const fromName = process.env.EMAIL_FROM_NAME || 'Royal Vault';
  const toArr = Array.isArray(to) ? to : [to];

  const body = {
    sender: { name: fromName, email: fromEmail },
    to: toArr.map(email => ({ email })),
    subject,
    htmlContent: html,
  };
  if (attachments.length > 0) {
    body.attachment = attachments.map(a => ({
      name: a.filename,
      content: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, 'utf-8')).toString('base64'),
    }));
  }

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Brevo ${resp.status}: ${err}`);
  }
  const result = await resp.json();
  return result.messageId || true;
}

async function sendMail(to, subject, html, attachments = []) {
  if (!to) { console.error('Mail error: no recipient email configured'); return false; }

  // Prefer Brevo (HTTP API — works on Railway and other cloud platforms)
  if (process.env.BREVO_API_KEY) {
    try {
      const toArr = Array.isArray(to) ? to : [to];
      const msgId = await sendMailBrevo(toArr, subject, html, attachments);
      console.log(`Mail sent via Brevo to ${toArr.join(', ')} (messageId: ${msgId})`);
      return true;
    } catch (e) {
      console.error('Brevo error:', e.message);
      return false;
    }
  }

  // Fallback: nodemailer/Gmail SMTP (works locally, blocked on most cloud platforms)
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('Mail error: No email provider configured — set BREVO_API_KEY (recommended) or EMAIL_USER + EMAIL_PASS');
    return false;
  }
  try {
    await mailer().sendMail({ from: process.env.EMAIL_USER, to, subject, html, attachments });
    console.log(`Mail sent via SMTP to ${to}`);
    return true;
  } catch (e) {
    console.error('SMTP error:', e.message);
    if (e.code === 'EAUTH' || e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT') {
      _transporter = null;
    }
    return false;
  }
}

async function verifyEmail() {
  if (process.env.BREVO_API_KEY) {
    try {
      const resp = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Accept': 'application/json' },
      });
      return resp.ok;
    } catch { return false; }
  }
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    await mailer().verify();
    return true;
  }
  return false;
}

// ── Auth guard ────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  if (req.session?.user || req.session?.isGuest) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
function mainAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/password', async (req, res) => {
  if (maintenanceMode) return res.status(503).json({ error: 'Site is under maintenance. Please try again later.' });
  const { password } = req.body;
  const settings = rd(F.settings);
  const guests = rd(F.guests) || {};

  // Check guest passwords first
  for (const [id, g] of Object.entries(guests)) {
    if (!g.active) continue;
    if (g.expiresAt && new Date() > new Date(g.expiresAt)) continue;
    if (bcrypt.compareSync(password, g.passwordHash)) {
      req.session.isGuest = true;
      req.session.guestId = id;
      return res.json({ success: true, isGuest: true, guestName: g.name });
    }
  }

  if (bcrypt.compareSync(password, settings.sitePassword)) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.json({ success: false, error: 'Incorrect password' });
});

app.post('/api/auth/profile', (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  const { profile, passcode } = req.body;
  if (!['kaliph', 'kathrine'].includes(profile)) return res.json({ success: false });
  const users = rd(F.users);
  const user = users[profile];
  if (user && user.profilePasscode) {
    if (!passcode) return res.json({ success: false, needsPasscode: true });
    if (passcode !== user.profilePasscode) return res.json({ success: false, error: 'Incorrect passcode' });
  }
  req.session.user = profile;
  req.session.loginTime = Date.now();
  res.json({ success: true });
});

// Check which profiles have passcodes enabled (for login page)
app.get('/api/auth/profile-locks', (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  const users = rd(F.users);
  res.json({
    kaliph: !!(users?.kaliph?.profilePasscode),
    kathrine: !!(users?.kathrine?.profilePasscode),
  });
});

// Set or remove profile passcode
app.post('/api/auth/profile-passcode', mainAuth, (req, res) => {
  const { passcode } = req.body;
  const users = rd(F.users);
  if (passcode) {
    if (!/^\d{4}$/.test(passcode)) return res.json({ success: false, error: 'Passcode must be exactly 4 digits' });
    users[req.session.user].profilePasscode = passcode;
  } else {
    delete users[req.session.user].profilePasscode;
  }
  wd(F.users, users);
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/session', (req, res) => {
  res.json({
    authenticated: !!(req.session?.authenticated && req.session?.user),
    user: req.session?.user || null,
    isGuest: !!req.session?.isGuest,
    guestId: req.session?.guestId || null,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/users', (req, res) => {
  if (!req.session?.user && !req.session?.isGuest && !req.session?.authenticated)
    return res.status(401).json({ error: 'Unauthorized' });
  const users = rd(F.users);
  // Inject live presence: 'online' | 'idle' | 'offline'
  if (users) {
    for (const name of Object.keys(users)) {
      users[name]._presence = onlineUsers[name]?.state || 'offline';
    }
  }
  res.json(users);
});

// Save lastSeen (used by sendBeacon on tab close)
app.post('/api/users/:user/lastseen', (req, res) => {
  const users = rd(F.users);
  if (users && users[req.params.user]) {
    users[req.params.user].lastSeen = Date.now();
    wd(F.users, users);
  }
  res.json({ ok: true });
});

app.put('/api/users/:user', mainAuth, (req, res) => {
  if (req.session.user !== req.params.user) return res.status(403).json({ error: 'Forbidden' });
  const users = rd(F.users);
  users[req.params.user] = { ...users[req.params.user], ...req.body };
  wd(F.users, users);
  io.emit('user-updated', { user: req.params.user, data: users[req.params.user] });
  res.json({ success: true, user: users[req.params.user] });
});

app.post('/api/users/:user/avatar', mainAuth, upload.single('avatar'), (req, res) => {
  if (req.session.user !== req.params.user) return res.status(403).json({ error: 'Forbidden' });
  const users = rd(F.users);
  users[req.params.user].avatar = `/uploads/${req.file.filename}`;
  wd(F.users, users);
  io.emit('user-updated', { user: req.params.user, data: users[req.params.user] });
  res.json({ success: true, avatar: users[req.params.user].avatar });
});

app.post('/api/users/:user/banner', mainAuth, upload.single('banner'), (req, res) => {
  if (req.session.user !== req.params.user) return res.status(403).json({ error: 'Forbidden' });
  const users = rd(F.users);
  users[req.params.user].banner = `/uploads/${req.file.filename}`;
  wd(F.users, users);
  io.emit('user-updated', { user: req.params.user, data: users[req.params.user] });
  res.json({ success: true, banner: users[req.params.user].banner });
});

app.post('/api/users/:user/wallpaper', mainAuth, upload.single('wallpaper'), (req, res) => {
  if (req.session.user !== req.params.user) return res.status(403).json({ error: 'Forbidden' });
  const settings = rd(F.settings);
  settings.chatWallpaper = `/uploads/${req.file.filename}`;
  wd(F.settings, settings);
  // Enable wallpaper for both users
  const users = rd(F.users);
  for (const u of Object.keys(users)) users[u].wallpaperEnabled = true;
  wd(F.users, users);
  io.emit('wallpaper-changed', { wallpaper: settings.chatWallpaper });
  res.json({ success: true, wallpaper: settings.chatWallpaper });
});

app.get('/api/wallpaper', mainAuth, (_, res) => {
  const settings = rd(F.settings);
  res.json({ wallpaper: settings.chatWallpaper || null });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/messages', mainAuth, (_, res) => {
  const msgs = rd(F.messages);
  res.json(msgs?.main || []);
});

app.post('/api/messages', mainAuth, upload.array('files', 20), async (req, res) => {
  const msgs = rd(F.messages);
  const settings = rd(F.settings);

  const message = {
    id: uuidv4(),
    sender: req.session.user,
    type: req.body.type || 'text',
    text: req.body.text || '',
    files: (req.files || []).map(f => ({
      url: `/uploads/${f.filename}`, type: f.mimetype,
      name: f.originalname, size: f.size
    })),
    priority: req.body.priority === 'true',
    replyTo: req.body.replyTo || null,
    timestamp: Date.now(),
    edited: false, editedAt: null,
    reactions: {},
    read: false, readAt: null,
    unsendable: true,
    formatting: req.body.formatting ? JSON.parse(req.body.formatting) : null,
    aiGenerated: false,
  };

  if (!Array.isArray(msgs.main)) msgs.main = [];
  msgs.main.push(message);
  wd(F.messages, msgs);

  // Priority email (supports multiple emails per person)
  let emailStatus = null;
  if (message.priority) {
    const sender = req.session.user;
    const recipient = sender === 'kaliph' ? 'kathrine' : 'kaliph';
    const emailData = settings.emails?.[recipient];
    let emails = Array.isArray(emailData) ? emailData.filter(e => e) : (emailData ? [emailData] : []);
    // Fallback: if no per-user email, try shared email, then env EMAIL_USER
    if (emails.length === 0 && settings.emails?.shared) emails = [settings.emails.shared];
    if (emails.length === 0 && process.env.EMAIL_USER) emails = [process.env.EMAIL_USER];
    const senderName = sender.charAt(0).toUpperCase() + sender.slice(1);
    const subject = `🔴 Priority Message from ${senderName}`;
    const html = `<h2 style="color:#7c3aed">🔴 Priority Message</h2>
         <p><b>${senderName}</b> sent you a priority message:</p>
         <blockquote style="border-left:4px solid #7c3aed;padding:10px;margin:10px">${message.text}</blockquote>
         <p style="color:#888">${new Date(message.timestamp).toLocaleString()}</p>`;
    if (emails.length === 0) {
      console.log(`Priority email skipped: no email configured for ${recipient}`);
      emailStatus = 'no_recipient';
    } else {
      let anySuccess = false;
      for (const email of emails) {
        const sent = await sendMail(email, subject, html);
        if (sent) anySuccess = true;
        console.log(sent ? `Priority email sent to ${email}` : `Priority email FAILED to ${email}`);
      }
      emailStatus = anySuccess ? 'sent' : 'failed';
    }
  }

  // Auto-expire unsend window (3 min)
  setTimeout(() => {
    try {
      const m = rd(F.messages);
      const i = (m.main || []).findIndex(x => x.id === message.id);
      if (i !== -1) { m.main[i].unsendable = false; wd(F.messages, m); }
      io.emit('msg-unsend-expire', message.id);
    } catch {}
  }, 3 * 60 * 1000);

  // Check for @claude mention
  if (message.text.toLowerCase().includes('@claude') || message.text.toLowerCase().includes('@ai')) {
    handleAIMention(message, msgs);
  }

  io.emit('new-message', message);
  res.json({ success: true, message, emailStatus });
});

async function handleAIMention(triggerMsg, msgs) {
  io.emit('ai-typing', true);
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const history = (msgs.main || []).slice(-20).map(m => ({
      role: m.sender === 'ai' ? 'assistant' : 'user',
      content: `[${m.sender}]: ${m.text}`
    }));
    const resp = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: 'You are Claude, an AI assistant integrated into "The Royal Kat & Kai Vault" — a private messaging platform for best friends Kaliph and Kathrine. Be helpful, friendly, and concise. You were @mentioned in a conversation.',
      messages: history,
    });
    const aiMsg = {
      id: uuidv4(), sender: 'ai', type: 'text',
      text: resp.content[0].text, files: [],
      priority: false, replyTo: triggerMsg.id,
      timestamp: Date.now(), edited: false, reactions: {},
      read: false, readAt: null, unsendable: false, aiGenerated: true,
    };
    const m = rd(F.messages);
    if (!Array.isArray(m.main)) m.main = [];
    m.main.push(aiMsg);
    wd(F.messages, m);
    io.emit('new-message', aiMsg);
  } catch (e) {
    console.error('AI error:', e.message);
  } finally {
    io.emit('ai-typing', false);
  }
}

app.post('/api/messages/:id/read', mainAuth, (req, res) => {
  const msgs = rd(F.messages);
  const i = (msgs.main || []).findIndex(m => m.id === req.params.id);
  if (i !== -1 && msgs.main[i].sender !== req.session.user) {
    msgs.main[i].read = true; msgs.main[i].readAt = Date.now();
    wd(F.messages, msgs);
    io.emit('msg-read', { id: req.params.id, readAt: msgs.main[i].readAt });
  }
  res.json({ success: true });
});

app.post('/api/messages/:id/react', mainAuth, (req, res) => {
  const { emoji } = req.body;
  const msgs = rd(F.messages);
  const i = (msgs.main || []).findIndex(m => m.id === req.params.id);
  if (i !== -1) {
    if (!msgs.main[i].reactions) msgs.main[i].reactions = {};
    if (!msgs.main[i].reactions[emoji]) msgs.main[i].reactions[emoji] = [];
    const ui = msgs.main[i].reactions[emoji].indexOf(req.session.user);
    if (ui === -1) msgs.main[i].reactions[emoji].push(req.session.user);
    else msgs.main[i].reactions[emoji].splice(ui, 1);
    if (msgs.main[i].reactions[emoji].length === 0) delete msgs.main[i].reactions[emoji];
    wd(F.messages, msgs);
    io.emit('msg-reaction', { id: req.params.id, reactions: msgs.main[i].reactions });
  }
  res.json({ success: true });
});

app.delete('/api/messages/:id', mainAuth, (req, res) => {
  const msgs = rd(F.messages);
  const i = (msgs.main || []).findIndex(m => m.id === req.params.id);
  if (i === -1) return res.json({ success: true });
  if (msgs.main[i].sender !== req.session.user) return res.status(403).json({ error: 'Forbidden' });
  if (!msgs.main[i].unsendable) return res.status(403).json({ error: 'Unsend window expired' });
  msgs.main.splice(i, 1);
  wd(F.messages, msgs);
  io.emit('msg-unsent', req.params.id);
  res.json({ success: true });
});

app.put('/api/messages/:id', mainAuth, (req, res) => {
  const msgs = rd(F.messages);
  const i = (msgs.main || []).findIndex(m => m.id === req.params.id);
  if (i !== -1 && msgs.main[i].sender === req.session.user) {
    msgs.main[i].text = req.body.text;
    msgs.main[i].edited = true; msgs.main[i].editedAt = Date.now();
    wd(F.messages, msgs);
    io.emit('msg-edited', { id: req.params.id, text: req.body.text, editedAt: msgs.main[i].editedAt });
  }
  res.json({ success: true });
});

// ── Brainstorm ────────────────────────────────────────────────────────────────
app.get('/api/brainstorm', mainAuth, (_, res) => {
  const msgs = rd(F.messages);
  res.json(msgs?.brainstorm || []);
});

app.post('/api/brainstorm', mainAuth, (req, res) => {
  const msgs = rd(F.messages);
  const msg = { id: uuidv4(), sender: req.session.user, text: req.body.text, timestamp: Date.now() };
  if (!Array.isArray(msgs.brainstorm)) msgs.brainstorm = [];
  msgs.brainstorm.push(msg);
  wd(F.messages, msgs);
  io.emit('brainstorm-msg', msg);
  res.json({ success: true, message: msg });
});

// ── Direct AI chat (not @mention) ─────────────────────────────────────────────
app.post('/api/ai/message', mainAuth, async (req, res) => {
  const { message, history } = req.body;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msgs = (history || []).slice(-20).map(m => ({ role: m.role, content: m.content }));
    msgs.push({ role: 'user', content: message });
    const resp = await client.messages.create({
      model: 'claude-opus-4-6', max_tokens: 2048,
      system: 'You are Claude, a helpful AI assistant in "The Royal Kat & Kai Vault" — a private messaging app for best friends Kaliph and Kathrine. Be warm, helpful, and concise.',
      messages: msgs,
    });
    res.json({ success: true, content: resp.content[0].text });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/notes', mainAuth, (req, res) => {
  const notes = rd(F.notes);
  const other = req.session.user === 'kaliph' ? 'kathrine' : 'kaliph';
  res.json({
    mine:   notes[req.session.user] || [],
    shared: (notes[other] || []).filter(n => n.sharedWith?.includes(req.session.user)),
  });
});

app.post('/api/notes', mainAuth, (req, res) => {
  const notes = rd(F.notes); const u = req.session.user;
  const note = {
    id: uuidv4(), title: req.body.title || 'Untitled',
    content: req.body.content || '', type: req.body.type || 'note',
    todos: req.body.todos || [], sharedWith: [],
    archived: false, pinned: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (!Array.isArray(notes[u])) notes[u] = [];
  notes[u].push(note);
  wd(F.notes, notes);
  res.json({ success: true, note });
});

app.put('/api/notes/:id', mainAuth, (req, res) => {
  const notes = rd(F.notes); const u = req.session.user;
  const i = (notes[u] || []).findIndex(n => n.id === req.params.id);
  if (i !== -1) { notes[u][i] = { ...notes[u][i], ...req.body, updatedAt: Date.now() }; wd(F.notes, notes); }
  res.json({ success: true });
});

app.delete('/api/notes/:id', mainAuth, (req, res) => {
  const notes = rd(F.notes); const u = req.session.user;
  notes[u] = (notes[u] || []).filter(n => n.id !== req.params.id);
  wd(F.notes, notes); res.json({ success: true });
});

app.post('/api/notes/:id/share', mainAuth, (req, res) => {
  const notes = rd(F.notes); const u = req.session.user;
  const other = u === 'kaliph' ? 'kathrine' : 'kaliph';
  const i = (notes[u] || []).findIndex(n => n.id === req.params.id);
  if (i !== -1) {
    const sw = notes[u][i].sharedWith || [];
    const oi = sw.indexOf(other);
    if (oi === -1) sw.push(other); else sw.splice(oi, 1);
    notes[u][i].sharedWith = sw;
    wd(F.notes, notes);
    io.emit('note-share-update', { from: u });
  }
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTACTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/contacts', mainAuth, (_, res) => {
  res.json(rd(F.contacts) || []);
});

app.post('/api/contacts', mainAuth, upload.single('photo'), (req, res) => {
  let contacts = rd(F.contacts) || [];
  const contact = {
    id: uuidv4(), name: req.body.name, phone: req.body.phone || '',
    email: req.body.email || '', notes: req.body.notes || '',
    photo: req.file ? `/uploads/${req.file.filename}` : null,
    addedBy: req.session.user, createdAt: Date.now(),
  };
  contacts.push(contact);
  wd(F.contacts, contacts);
  res.json({ success: true, contact });
});

app.put('/api/contacts/:id', mainAuth, upload.single('photo'), (req, res) => {
  let contacts = rd(F.contacts) || [];
  const i = contacts.findIndex(c => c.id === req.params.id);
  if (i !== -1) {
    contacts[i] = { ...contacts[i], ...req.body, photo: req.file ? `/uploads/${req.file.filename}` : contacts[i].photo };
    wd(F.contacts, contacts);
  }
  res.json({ success: true });
});

app.delete('/api/contacts/:id', mainAuth, (req, res) => {
  let contacts = rd(F.contacts) || [];
  wd(F.contacts, contacts.filter(c => c.id !== req.params.id));
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VAULT
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/vault', mainAuth, (req, res) => {
  const s = rd(F.settings);
  if (req.query.passcode !== s.vaultPasscode) return res.status(403).json({ error: 'Invalid passcode' });
  res.json(rd(F.vault) || {});
});

app.post('/api/vault', mainAuth, upload.array('files', 20), (req, res) => {
  const s = rd(F.settings);
  if (req.body.passcode !== s.vaultPasscode) return res.status(403).json({ error: 'Invalid passcode' });
  const vault = rd(F.vault) || {}; const u = req.session.user;
  if (!Array.isArray(vault[u])) vault[u] = [];
  (req.files || []).forEach(f => vault[u].push({
    id: uuidv4(), type: 'file', name: f.originalname,
    url: `/uploads/${f.filename}`, mimeType: f.mimetype,
    size: f.size, uploadedAt: Date.now(), uploadedBy: u,
  }));
  if (req.body.link) vault[u].push({
    id: uuidv4(), type: 'link',
    name: req.body.linkName || req.body.link, url: req.body.link,
    uploadedAt: Date.now(), uploadedBy: u,
  });
  wd(F.vault, vault);
  res.json({ success: true });
});

app.delete('/api/vault/:id', mainAuth, (req, res) => {
  const s = rd(F.settings);
  if (req.body.passcode !== s.vaultPasscode) return res.status(403).json({ error: 'Invalid passcode' });
  const vault = rd(F.vault) || {};
  for (const u of Object.keys(vault)) vault[u] = vault[u].filter(i => i.id !== req.params.id);
  wd(F.vault, vault);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/calendar', mainAuth, (_, res) => res.json(rd(F.calendar) || {}));

app.post('/api/calendar', mainAuth, (req, res) => {
  const cal = rd(F.calendar); const u = req.session.user;
  const event = {
    id: uuidv4(), title: req.body.title,
    start: req.body.start, end: req.body.end,
    description: req.body.description || '',
    color: req.body.color || '#7c3aed',
    createdBy: u, shared: req.body.shared === true || req.body.shared === 'true',
  };
  if (!Array.isArray(cal[u])) cal[u] = [];
  cal[u].push(event);
  if (event.shared) { if (!Array.isArray(cal.shared)) cal.shared = []; cal.shared.push(event); }
  wd(F.calendar, cal);
  io.emit('calendar-event', { user: u, event });
  res.json({ success: true, event });
});

app.delete('/api/calendar/:id', mainAuth, (req, res) => {
  const cal = rd(F.calendar); const u = req.session.user;
  if (cal[u]) cal[u] = cal[u].filter(e => e.id !== req.params.id);
  if (cal.shared) cal.shared = cal.shared.filter(e => e.id !== req.params.id);
  wd(F.calendar, cal);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/announcements', auth, (_, res) => res.json(rd(F.announcements) || []));

app.post('/api/announcements', mainAuth, (req, res) => {
  let ann = rd(F.announcements) || [];
  const item = {
    id: uuidv4(), title: req.body.title, content: req.body.content,
    createdBy: req.session.user, createdAt: Date.now(), active: true,
    targetUser: req.body.targetUser || 'both',
  };
  ann.push(item);
  wd(F.announcements, ann);
  io.emit('announcement', item);
  res.json({ success: true, announcement: item });
});

app.delete('/api/announcements/:id', mainAuth, (req, res) => {
  let ann = rd(F.announcements) || [];
  wd(F.announcements, ann.filter(a => a.id !== req.params.id));
  io.emit('announcement-removed', req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/settings', mainAuth, (_, res) => {
  const s = rd(F.settings);
  res.json({ emails: s.emails, vaultPasscodeSet: !!s.vaultPasscode });
});

app.get('/api/settings/email-status', mainAuth, async (_, res) => {
  const provider = getEmailProvider();
  const configured = !!provider;
  let canConnect = false;
  if (configured) {
    try { canConnect = await verifyEmail(); } catch { canConnect = false; }
  }
  const s = rd(F.settings);
  const hasRecipients = !!(
    (s.emails?.kaliph && (Array.isArray(s.emails.kaliph) ? s.emails.kaliph.filter(e => e).length : s.emails.kaliph)) ||
    (s.emails?.kathrine && (Array.isArray(s.emails.kathrine) ? s.emails.kathrine.filter(e => e).length : s.emails.kathrine)) ||
    s.emails?.shared
  );
  res.json({ configured, canConnect, hasRecipients, provider: provider || 'none' });
});

app.post('/api/settings/test-email', mainAuth, async (req, res) => {
  const s = rd(F.settings);
  const user = req.session.user;
  // Gather ALL notification emails for the current user
  const emailData = s.emails?.[user];
  let emails = Array.isArray(emailData) ? emailData.filter(e => e) : (emailData ? [emailData] : []);
  if (emails.length === 0 && s.emails?.shared) emails = [s.emails.shared];
  if (emails.length === 0) return res.json({ success: false, error: 'No email address configured for your account' });
  // Send to ALL configured emails
  let anySuccess = false;
  const failures = [];
  for (const email of emails) {
    const sent = await sendMail(email, '✅ Test Email — Royal Vault',
      `<h2 style="color:#7c3aed">Email is working!</h2><p>Priority email notifications are configured correctly for <b>${email}</b>.</p>`);
    if (sent) anySuccess = true;
    else failures.push(email);
  }
  res.json({
    success: anySuccess,
    sentTo: emails.filter(e => !failures.includes(e)),
    error: failures.length > 0 ? `Failed to send to: ${failures.join(', ')}` : null,
  });
});

app.put('/api/settings', mainAuth, async (req, res) => {
  const s = rd(F.settings);
  if (req.body.newPassword) s.sitePassword = await bcrypt.hash(req.body.newPassword, 10);
  if (req.body.emails) s.emails = { ...s.emails, ...req.body.emails };
  if (req.body.vaultPasscode) s.vaultPasscode = req.body.vaultPasscode;
  wd(F.settings, s);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/suggestions', mainAuth, (req, res) => {
  let s = rd(F.suggestions) || [];
  s.push({ id: uuidv4(), from: req.session.user, type: req.body.type || 'suggestion', message: req.body.message, createdAt: Date.now(), reviewed: false });
  wd(F.suggestions, s);
  res.json({ success: true });
});

app.get('/api/suggestions', mainAuth, (_, res) => res.json(rd(F.suggestions) || []));

// ═══════════════════════════════════════════════════════════════════════════════
// GUESTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/guests', mainAuth, (_, res) => {
  const guests = rd(F.guests) || {};
  const safe = Object.fromEntries(Object.entries(guests).map(([id, g]) => [id, { ...g, passwordHash: undefined }]));
  res.json(safe);
});

app.post('/api/guests', mainAuth, async (req, res) => {
  const guests = rd(F.guests) || {};
  const { name, password, expiresIn, channels } = req.body;
  const id = uuidv4();
  const allowedChannels = Array.isArray(channels) && channels.length ? channels : ['kaliph', 'kathrine', 'group'];
  guests[id] = {
    id, name, passwordHash: await bcrypt.hash(password, 10),
    createdBy: req.session.user, createdAt: Date.now(),
    expiresAt: expiresIn ? new Date(Date.now() + parseInt(expiresIn) * 3600000).toISOString() : null,
    active: true, channels: allowedChannels,
    messages: { kaliph: [], kathrine: [], group: [] },
  };
  wd(F.guests, guests);
  res.json({ success: true, guestId: id, name });
});

app.delete('/api/guests/:id', mainAuth, (req, res) => {
  const guests = rd(F.guests) || {};
  if (guests[req.params.id]) {
    guests[req.params.id].active = false;
    wd(F.guests, guests);
    io.emit('guest-revoked', { guestId: req.params.id });
  }
  res.json({ success: true });
});

app.get('/api/guests/:id', auth, (req, res) => {
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  res.json({ id: g.id, name: g.name, messages: g.messages, active: g.active, channels: g.channels || ['kaliph','kathrine','group'], createdBy: g.createdBy });
});

// Get all guest messages for the current main user
app.get('/api/guest-messages', mainAuth, (req, res) => {
  const guests = rd(F.guests) || {};
  const user = req.session.user;
  const result = [];
  Object.values(guests).forEach(g => {
    if (!g.active) return;
    const channels = { group: g.messages?.group || [], [user]: g.messages?.[user] || [] };
    result.push({ id: g.id, name: g.name, channels });
  });
  res.json(result);
});

app.post('/api/guests/:id/message', (req, res) => {
  if (!req.session.isGuest && !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  const { text, target } = req.body;
  // Validate channel access for guests
  if (req.session.isGuest) {
    const allowed = g.channels || ['kaliph','kathrine','group'];
    if (!allowed.includes(target)) return res.status(403).json({ error: 'No access to this channel' });
  }
  const msg = { id: uuidv4(), sender: req.session.isGuest ? g.name : req.session.user, text, timestamp: Date.now() };
  if (!g.messages[target]) g.messages[target] = [];
  g.messages[target].push(msg);
  wd(F.guests, guests);
  io.emit(`guest-msg-${req.params.id}-${target}`, msg);
  res.json({ success: true, message: msg });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD (generic)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/upload', mainAuth, upload.array('files', 20), (req, res) => {
  const files = (req.files || []).map(f => ({
    url: `/uploads/${f.filename}`, type: f.mimetype, name: f.originalname, size: f.size
  }));
  res.json({ success: true, files });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BACKDOOR  —  POST /backdoor/destroy
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/backdoor/destroy', async (req, res) => {
  if (req.body.code !== 'Easywhitechoclate') {
    return res.status(403).json({ error: 'Invalid code' });
  }
  try {
    // Bundle all data
    const bundle = {};
    for (const [k, file] of Object.entries(F)) { bundle[k] = rd(file) || {}; }

    // Email backup
    await sendMail(
      'royalkvault@gmail.com',
      '🔒 Royal Kat & Kai Vault — Full Data Backup (Pre-Deletion)',
      '<h2>Data Backup</h2><p>All vault data is in the attached JSON file.</p>',
      [{ filename: `vault-backup-${Date.now()}.json`, content: JSON.stringify(bundle, null, 2) }]
    );

    // Wipe data files
    for (const file of Object.values(F)) { if (fs.existsSync(file)) fs.removeSync(file); }
    fs.emptyDirSync(UPLOADS_DIR);
    initData();
    io.emit('force-logout');
    res.json({ success: true, message: 'All data wiped and backed up.' });
  } catch (e) {
    console.error('Backdoor error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/backdoor/erase-messages', async (req, res) => {
  if (req.body.code !== 'Easywhitechoclate') {
    return res.status(403).json({ error: 'Invalid code' });
  }
  try {
    // Backup messages before erasing
    const messages = rd(F.messages) || [];
    if (messages.length > 0) {
      await sendMail(
        'royalkvault@gmail.com',
        '🔒 Royal Kat & Kai Vault — Chat History Backup (Pre-Erase)',
        `<h2>Chat History Backup</h2><p>${messages.length} messages backed up before erasure.</p>`,
        [{ filename: `chat-backup-${Date.now()}.json`, content: JSON.stringify(messages, null, 2) }]
      );
    }

    // Erase only messages
    wd(F.messages, []);
    io.emit('messages-cleared');
    res.json({ success: true, message: `${messages.length} messages erased.`, count: messages.length });
  } catch (e) {
    console.error('Erase messages error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVAL TERMINAL (Admin)
// ═══════════════════════════════════════════════════════════════════════════════

let evalPassword = 'Admin';
let maintenanceMode = false;
const evalTokens = new Set();

app.post('/api/eval/auth', (req, res) => {
  if (req.body.password !== evalPassword) return res.status(403).json({ error: 'Invalid password' });
  const token = uuidv4();
  evalTokens.add(token);
  res.json({ token });
});

function evalAuth(req, res) {
  if (!evalTokens.has(req.body.token)) { res.status(401).json({ error: 'Session expired', reauth: true }); return false; }
  return true;
}

app.post('/api/eval/exec', async (req, res) => {
  if (!evalAuth(req, res)) return;
  const { command, mode, previewUser } = req.body;
  const raw = command.trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  try {
    const result = await handleEvalCommand(raw, parts, cmd, mode, previewUser);
    res.json(result);
  } catch (e) {
    console.error('Eval error:', e);
    res.json({ lines: [{ text: `Error: ${e.message}`, cls: 'error' }] });
  }
});

async function handleEvalCommand(raw, parts, cmd, mode, previewUser) {
  const lines = (text, cls = 'info') => ({ lines: [{ text, cls }] });
  const multi = (...arr) => ({ lines: arr.map(([text, cls]) => ({ text, cls: cls || 'info' })) });

  // ── MESSAGES ──
  if (cmd === 'messages') {
    const sub = parts[1]?.toLowerCase();
    const msgs = rd(F.messages);
    const main = msgs?.main || [];

    if (!sub) {
      const kCount = main.filter(m => m.sender === 'kaliph').length;
      const keCount = main.filter(m => m.sender === 'kathrine').length;
      const aiCount = main.filter(m => m.sender === 'ai').length;
      const pCount = main.filter(m => m.priority).length;
      return multi(
        [`Total messages: ${main.length}`, 'success'],
        [`  Kaliph: ${kCount}  |  Kathrine: ${keCount}  |  AI: ${aiCount}`, 'data'],
        [`  Priority: ${pCount}  |  With files: ${main.filter(m => m.files?.length).length}`, 'data'],
      );
    }
    if (sub === 'list') {
      const count = parseInt(parts[2]) || 20;
      const slice = main.slice(-count);
      return { messages: slice };
    }
    if (sub === 'from') {
      const user = parts[2]?.toLowerCase();
      if (!user) return lines('Usage: messages from <user>', 'warn');
      const filtered = main.filter(m => m.sender === user);
      return {
        lines: [{ text: `${filtered.length} messages from ${user}`, cls: 'success' }],
        messages: filtered.slice(-30),
      };
    }
    if (sub === 'search') {
      const query = parts.slice(2).join(' ').toLowerCase();
      if (!query) return lines('Usage: messages search <text>', 'warn');
      const found = main.filter(m => m.text?.toLowerCase().includes(query));
      return {
        lines: [{ text: `${found.length} messages matching "${query}"`, cls: 'success' }],
        messages: found.slice(-30),
      };
    }
  }

  // ── DELETE MESSAGE (bypass time limit) ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'msg') {
    const id = parts[2];
    if (!id) return lines('Usage: delete msg <id>', 'warn');
    const msgs = rd(F.messages);
    const i = (msgs.main || []).findIndex(m => m.id === id);
    if (i === -1) return lines('Message not found', 'error');
    const removed = msgs.main.splice(i, 1)[0];
    wd(F.messages, msgs);
    io.emit('msg-unsent', id);
    return lines(`Deleted message from ${removed.sender}: "${(removed.text || '').substring(0, 60)}"`, 'success');
  }

  // ── EDIT MODE ──
  if (raw.toLowerCase() === 'edit mode') {
    const msgs = rd(F.messages);
    const main = (msgs?.main || []).slice(-50);
    return {
      setMode: 'edit', modeInfo: `${main.length} messages shown — click Delete to remove`,
      lines: [{ text: `Edit mode: showing last ${main.length} messages. Use "exit" to leave.`, cls: 'warn' }],
      messages: main,
    };
  }

  // ── BROADCAST ──
  if (cmd === 'broadcast') {
    const text = parts.slice(1).join(' ');
    if (!text) return lines('Usage: broadcast <message>', 'warn');
    const msgs = rd(F.messages);
    if (!Array.isArray(msgs.main)) msgs.main = [];
    const msg = {
      id: uuidv4(), sender: 'system', type: 'text', text,
      files: [], priority: false, replyTo: null,
      timestamp: Date.now(), edited: false, editedAt: null,
      reactions: {}, read: false, readAt: null, unsendable: false,
      aiGenerated: false, systemMessage: true,
    };
    msgs.main.push(msg);
    wd(F.messages, msgs);
    io.emit('new-message', msg);
    return lines(`Broadcast sent: "${text}"`, 'success');
  }

  // ── ANNOUNCEMENTS ──
  if (cmd === 'announce') {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'list') {
      const anns = rd(F.announcements) || [];
      if (!anns.length) return lines('No announcements', 'dim');
      return {
        lines: [{ text: `${anns.length} announcements`, cls: 'success' }],
        table: {
          headers: ['ID', 'Title', 'Target', 'Created'],
          rows: anns.map(a => [a.id.substring(0, 8), (a.title || '').substring(0, 30), a.targetUser || 'both', new Date(a.createdAt).toLocaleDateString()]),
        },
      };
    }
    if (sub === 'delete') {
      const id = parts[2];
      if (!id) return lines('Usage: announce delete <id>', 'warn');
      let anns = rd(F.announcements) || [];
      const idx = anns.findIndex(a => a.id.startsWith(id));
      if (idx === -1) return lines('Announcement not found', 'error');
      const removed = anns.splice(idx, 1)[0];
      wd(F.announcements, anns);
      io.emit('announcement-removed', removed.id);
      return lines(`Deleted announcement: "${removed.title}"`, 'success');
    }
    // announce [user] <text>
    let target = 'both';
    let title;
    if (sub === 'kaliph' || sub === 'kathrine') {
      target = sub;
      title = parts.slice(2).join(' ');
    } else {
      title = parts.slice(1).join(' ');
    }
    if (!title) return lines('Usage: announce [user] <text>', 'warn');
    const ann = {
      id: uuidv4(), title, content: '', createdBy: 'admin',
      createdAt: Date.now(), active: true, targetUser: target,
    };
    const anns = rd(F.announcements) || [];
    anns.push(ann);
    wd(F.announcements, anns);
    io.emit('announcement', ann);
    return lines(`Announcement created for ${target}: "${title}"`, 'success');
  }

  // ── USER INFO ──
  if (cmd === 'user' && parts[1]?.toLowerCase() === 'info') {
    const user = parts[2]?.toLowerCase();
    if (!user) return lines('Usage: user info <user>', 'warn');
    const users = rd(F.users);
    const u = users?.[user];
    if (!u) return lines(`User "${user}" not found`, 'error');
    const presence = onlineUsers[user]?.state || 'offline';
    return multi(
      [`── ${u.displayName || u.name} ──`, 'header'],
      [`  Status:    ${u.status || 'online'}  (presence: ${presence})`, 'data'],
      [`  Custom:    ${u.customStatus || '(none)'}`, 'data'],
      [`  Theme:     ${u.theme}`, 'data'],
      [`  Bio:       ${u.bio || '(none)'}`, 'data'],
      [`  Pronouns:  ${u.pronouns || '(none)'}`, 'data'],
      [`  Font:      ${u.font || 'default'}`, 'data'],
      [`  Avatar:    ${u.avatar ? 'set' : 'none'}`, 'data'],
      [`  Banner:    ${u.banner ? 'set' : 'none'}`, 'data'],
      [`  Email:     ${u.email || '(none)'}`, 'data'],
      [`  LastSeen:  ${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'never'}`, 'data'],
      [`  Passcode:  ${u.profilePasscode ? 'set' : 'none'}`, 'data'],
      [`  NameStyle: ${JSON.stringify(u.nameStyle || {})}`, 'dim'],
    );
  }

  // ── SET COMMANDS ──
  if (cmd === 'set') {
    const prop = parts[1]?.toLowerCase();

    if (prop === 'name') {
      const user = parts[2]?.toLowerCase();
      const name = parts.slice(3).join(' ');
      if (!user || !name) return lines('Usage: set name <user> <name>', 'warn');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].displayName = name;
      users[user].name = name;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} display name → "${name}"`, 'success');
    }

    if (prop === 'bio') {
      const user = parts[2]?.toLowerCase();
      const bio = parts.slice(3).join(' ');
      if (!user) return lines('Usage: set bio <user> <text>', 'warn');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].bio = bio;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} bio updated`, 'success');
    }

    if (prop === 'status') {
      const user = parts[2]?.toLowerCase();
      const status = parts[3]?.toLowerCase();
      if (!user || !status) return lines('Usage: set status <user> <online|idle|dnd|invisible>', 'warn');
      const valid = ['online', 'idle', 'dnd', 'invisible'];
      if (!valid.includes(status)) return lines(`Invalid status. Options: ${valid.join(', ')}`, 'error');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].status = status;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} status → ${status}`, 'success');
    }

    if (prop === 'custom-status') {
      const user = parts[2]?.toLowerCase();
      const msg = parts.slice(3).join(' ');
      if (!user) return lines('Usage: set custom-status <user> <message|clear>', 'warn');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].customStatus = msg === 'clear' ? '' : (msg || '');
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} custom status → ${msg === 'clear' || !msg ? '(cleared)' : `"${msg}"`}`, 'success');
    }

    if (prop === 'theme') {
      const user = parts[2]?.toLowerCase();
      const theme = parts[3]?.toLowerCase();
      if (!user || !theme) return lines('Usage: set theme <user> <theme>', 'warn');
      const valid = ['kaliph', 'kathrine', 'royal', 'dark', 'light', 'heaven'];
      if (!valid.includes(theme)) return lines(`Invalid theme. Options: ${valid.join(', ')}`, 'error');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].theme = theme;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} theme → ${theme}`, 'success');
    }

    if (prop === 'pronouns') {
      const user = parts[2]?.toLowerCase();
      const pronouns = parts.slice(3).join(' ');
      if (!user) return lines('Usage: set pronouns <user> <text>', 'warn');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].pronouns = pronouns;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} pronouns → "${pronouns}"`, 'success');
    }

    if (prop === 'avatar' && parts[3]?.toLowerCase() === 'clear') {
      const user = parts[2]?.toLowerCase();
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].avatar = null;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} avatar cleared`, 'success');
    }

    if (prop === 'password') {
      const pw = parts.slice(2).join(' ');
      if (!pw) return lines('Usage: set password <new password>', 'warn');
      const s = rd(F.settings);
      s.sitePassword = await bcrypt.hash(pw, 10);
      wd(F.settings, s);
      return lines(`Site password changed`, 'success');
    }

    if (prop === 'eval-password') {
      const pw = parts.slice(2).join(' ');
      if (!pw) return lines('Usage: set eval-password <new password>', 'warn');
      evalPassword = pw;
      return lines(`Eval password changed to "${pw}"`, 'success');
    }

    if (prop === 'vault-code') {
      const code = parts[2];
      if (!code) return lines('Usage: set vault-code <code>', 'warn');
      const s = rd(F.settings);
      s.vaultPasscode = code;
      wd(F.settings, s);
      return lines(`Vault passcode → ${code}`, 'success');
    }

    if (prop === 'email') {
      const user = parts[2]?.toLowerCase();
      const emails = parts.slice(3).join(' ').split(',').map(e => e.trim()).filter(Boolean);
      if (!user || !emails.length) return lines('Usage: set email <user> <email1,email2,...>', 'warn');
      const s = rd(F.settings);
      if (!s.emails) s.emails = {};
      s.emails[user] = emails;
      wd(F.settings, s);
      return lines(`${user} emails → ${emails.join(', ')}`, 'success');
    }

    if (prop === 'banner' && parts[3]?.toLowerCase() === 'clear') {
      const user = parts[2]?.toLowerCase();
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].banner = null;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} banner cleared`, 'success');
    }

    return lines('Unknown set command. Type "help" for options.', 'warn');
  }

  // ── FORCE PRESENCE ──
  if (cmd === 'force' && parts[1]?.toLowerCase() === 'presence') {
    const user = parts[2]?.toLowerCase();
    const state = parts[3]?.toLowerCase();
    if (!user || !state) return lines('Usage: force presence <user> <online|idle|offline>', 'warn');
    io.emit('user-presence', { user, state });
    if (state === 'online' || state === 'idle') {
      onlineUsers[user] = { socketId: 'eval', state };
    } else {
      delete onlineUsers[user];
    }
    return lines(`Forced ${user} presence → ${state}`, 'success');
  }

  // ── PREVIEW MODE ──
  if (cmd === 'preview') {
    const user = parts[1]?.toLowerCase();
    if (!user) return lines('Usage: preview <user>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    return {
      setMode: 'preview', modeInfo: `Acting as ${user} — type "exit" to leave`,
      previewUser: user,
      lines: [
        { text: `Preview mode: acting as ${users[user].displayName || user}`, cls: 'highlight' },
        { text: `Commands: send <text>, react <msgId> <emoji>, read <msgId>`, cls: 'dim' },
        { text: `Use "exit" to return to command mode`, cls: 'dim' },
      ],
    };
  }

  // ── PREVIEW MODE COMMANDS ──
  if (mode === 'preview' && previewUser) {
    if (cmd === 'send') {
      const text = parts.slice(1).join(' ');
      if (!text) return lines('Usage: send <message text>', 'warn');
      const msgs = rd(F.messages);
      if (!Array.isArray(msgs.main)) msgs.main = [];
      const msg = {
        id: uuidv4(), sender: previewUser, type: 'text', text,
        files: [], priority: false, replyTo: null,
        timestamp: Date.now(), edited: false, editedAt: null,
        reactions: {}, read: false, readAt: null, unsendable: false,
        formatting: null, aiGenerated: false,
      };
      msgs.main.push(msg);
      wd(F.messages, msgs);
      io.emit('new-message', msg);
      return lines(`Sent as ${previewUser}: "${text}"`, 'success');
    }
    if (cmd === 'react') {
      const msgId = parts[1];
      const emoji = parts[2];
      if (!msgId || !emoji) return lines('Usage: react <msgId> <emoji>', 'warn');
      const msgs = rd(F.messages);
      const msg = (msgs.main || []).find(m => m.id === msgId || m.id.startsWith(msgId));
      if (!msg) return lines('Message not found', 'error');
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const idx = msg.reactions[emoji].indexOf(previewUser);
      if (idx >= 0) msg.reactions[emoji].splice(idx, 1);
      else msg.reactions[emoji].push(previewUser);
      wd(F.messages, msgs);
      io.emit('msg-reaction', { id: msg.id, reactions: msg.reactions });
      return lines(`Reaction ${emoji} toggled on message`, 'success');
    }
    // Fallback: treat as regular command
  }

  // ── SETTINGS ──
  if (cmd === 'settings') {
    const s = rd(F.settings);
    return multi(
      ['── Settings ──', 'header'],
      [`  Site password:  (hashed)`, 'data'],
      [`  Vault passcode: ${s.vaultPasscode || '(not set)'}`, 'data'],
      [`  Eval password:  ${evalPassword}`, 'data'],
      [`  Emails:`, 'data'],
      [`    Kaliph:   ${JSON.stringify(s.emails?.kaliph || '(none)')}`, 'dim'],
      [`    Kathrine: ${JSON.stringify(s.emails?.kathrine || '(none)')}`, 'dim'],
      [`    Shared:   ${s.emails?.shared || '(none)'}`, 'dim'],
      [`  Wallpaper: ${s.chatWallpaper ? 'set' : 'none'}`, 'data'],
    );
  }

  // ── STATS ──
  if (cmd === 'stats') {
    const msgs = rd(F.messages);
    const notes = rd(F.notes);
    const contacts = rd(F.contacts);
    const calendar = rd(F.calendar);
    const vault = rd(F.vault);
    const guests = rd(F.guests);
    const anns = rd(F.announcements);
    const sugs = rd(F.suggestions);
    const mainMsgs = msgs?.main || [];
    return multi(
      ['── Site Statistics ──', 'header'],
      [`  Messages:      ${mainMsgs.length}`, 'data'],
      [`  Brainstorm:    ${(msgs?.brainstorm || []).length}`, 'data'],
      [`  Notes:         K: ${(notes?.kaliph || []).length}  Ke: ${(notes?.kathrine || []).length}`, 'data'],
      [`  Contacts:      ${(contacts || []).length}`, 'data'],
      [`  Calendar:      K: ${(calendar?.kaliph || []).length}  Ke: ${(calendar?.kathrine || []).length}  Shared: ${(calendar?.shared || []).length}`, 'data'],
      [`  Vault:         K: ${(vault?.kaliph || []).length}  Ke: ${(vault?.kathrine || []).length}`, 'data'],
      [`  Guests:        ${Object.keys(guests || {}).length}`, 'data'],
      [`  Announcements: ${(anns || []).length}`, 'data'],
      [`  Suggestions:   ${(sugs || []).length}`, 'data'],
      [`  Online:        ${Object.keys(onlineUsers).join(', ') || 'none'}`, 'data'],
    );
  }

  // ── NOTES ──
  if (cmd === 'notes' && parts[1]?.toLowerCase() === 'list') {
    const user = parts[2]?.toLowerCase();
    const notes = rd(F.notes) || {};
    const show = user ? { [user]: notes[user] || [] } : notes;
    const rows = [];
    for (const [u, arr] of Object.entries(show)) {
      if (!Array.isArray(arr)) continue;
      arr.forEach(n => rows.push([u, n.id?.substring(0, 8) || '-', (n.title || '').substring(0, 30), n.type || 'note', n.archived ? 'archived' : 'active']));
    }
    if (!rows.length) return lines('No notes found', 'dim');
    return { table: { headers: ['User', 'ID', 'Title', 'Type', 'Status'], rows } };
  }

  // ── CONTACTS ──
  if (cmd === 'contacts' && parts[1]?.toLowerCase() === 'list') {
    const contacts = rd(F.contacts) || [];
    if (!contacts.length) return lines('No contacts', 'dim');
    return { table: {
      headers: ['ID', 'Name', 'Phone', 'Email', 'Added By'],
      rows: contacts.map(c => [c.id?.substring(0, 8) || '-', c.name || '-', c.phone || '-', c.email || '-', c.addedBy || '-']),
    }};
  }

  // ── CALENDAR ──
  if (cmd === 'calendar' && parts[1]?.toLowerCase() === 'list') {
    const user = parts[2]?.toLowerCase();
    const cal = rd(F.calendar) || {};
    const rows = [];
    const show = user ? { [user]: cal[user] || [] } : cal;
    for (const [u, arr] of Object.entries(show)) {
      if (!Array.isArray(arr)) continue;
      arr.forEach(e => rows.push([u, e.id?.substring(0, 8) || '-', (e.title || '').substring(0, 25), e.start || '-', e.shared ? 'shared' : '']));
    }
    if (!rows.length) return lines('No calendar events', 'dim');
    return { table: { headers: ['User', 'ID', 'Title', 'Start', 'Shared'], rows } };
  }

  // ── VAULT ──
  if (cmd === 'vault' && parts[1]?.toLowerCase() === 'list') {
    const user = parts[2]?.toLowerCase();
    const vault = rd(F.vault) || {};
    const rows = [];
    const show = user ? { [user]: vault[user] || [] } : vault;
    for (const [u, arr] of Object.entries(show)) {
      if (!Array.isArray(arr)) continue;
      arr.forEach(v => rows.push([u, v.id?.substring(0, 8) || '-', (v.name || '').substring(0, 25), v.type || '-', v.uploadedBy || '-']));
    }
    if (!rows.length) return lines('No vault items', 'dim');
    return { table: { headers: ['User', 'ID', 'Name', 'Type', 'Uploaded By'], rows } };
  }

  // ── GUESTS ──
  if (cmd === 'guests') {
    const sub = parts[1]?.toLowerCase();
    const guests = rd(F.guests) || {};
    if (sub === 'list') {
      const entries = Object.entries(guests);
      if (!entries.length) return lines('No guests', 'dim');
      return { table: {
        headers: ['ID', 'Name', 'Created By', 'Active', 'Channels', 'Expires'],
        rows: entries.map(([id, g]) => [
          id.substring(0, 8), g.name || '-', g.createdBy || '-',
          g.active ? 'yes' : 'no', (g.channels || []).join(','),
          g.expiresAt ? new Date(g.expiresAt).toLocaleDateString() : 'never'
        ]),
      }};
    }
    if (sub === 'revoke') {
      const id = parts[2];
      if (!id) return lines('Usage: guests revoke <id>', 'warn');
      const fullId = Object.keys(guests).find(k => k.startsWith(id));
      if (!fullId) return lines('Guest not found', 'error');
      guests[fullId].active = false;
      wd(F.guests, guests);
      io.emit('guest-revoked', { guestId: fullId });
      return lines(`Guest "${guests[fullId].name}" revoked`, 'success');
    }
    return lines('Usage: guests list | guests revoke <id>', 'warn');
  }

  // ── SUGGESTIONS ──
  if (cmd === 'suggestions' && parts[1]?.toLowerCase() === 'list') {
    const sugs = rd(F.suggestions) || [];
    if (!sugs.length) return lines('No suggestions', 'dim');
    return { table: {
      headers: ['ID', 'From', 'Type', 'Message', 'Date'],
      rows: sugs.map(s => [s.id?.substring(0, 8), s.from, s.type || '-', (s.message || '').substring(0, 40), new Date(s.createdAt).toLocaleDateString()]),
    }};
  }

  // ── FORCE LOGOUT ──
  if (raw.toLowerCase() === 'force logout') {
    io.emit('force-logout');
    return lines('Force logout sent to all clients', 'success');
  }

  // ── FORCE RELOAD ──
  if (raw.toLowerCase() === 'force reload') {
    io.emit('force-reload');
    return lines('Force reload sent to all clients', 'success');
  }

  // ── EMIT ──
  if (cmd === 'emit') {
    const event = parts[1];
    if (!event) return lines('Usage: emit <event> [json-data]', 'warn');
    let data = {};
    const jsonPart = parts.slice(2).join(' ');
    if (jsonPart) { try { data = JSON.parse(jsonPart); } catch { data = jsonPart; } }
    io.emit(event, data);
    return lines(`Emitted "${event}" with data: ${JSON.stringify(data)}`, 'success');
  }

  // ── MODIFY MESSAGE ──
  if (cmd === 'modify' && parts[1]?.toLowerCase() === 'msg') {
    const id = parts[2];
    const newText = parts.slice(3).join(' ');
    if (!id || !newText) return lines('Usage: modify msg <id> <new text>', 'warn');
    const msgs = rd(F.messages);
    const msg = (msgs.main || []).find(m => m.id === id || m.id.startsWith(id));
    if (!msg) return lines('Message not found', 'error');
    const oldText = msg.text;
    msg.text = newText;
    msg.edited = true;
    msg.editedAt = Date.now();
    wd(F.messages, msgs);
    io.emit('msg-edited', { id: msg.id, text: newText, editedAt: msg.editedAt });
    return lines(`Modified message: "${(oldText || '').substring(0, 40)}" → "${newText.substring(0, 40)}"`, 'success');
  }

  // ── CLEAR REACTIONS ──
  if (raw.toLowerCase().startsWith('clear reactions')) {
    const id = parts[2];
    if (!id) return lines('Usage: clear reactions <id>', 'warn');
    const msgs = rd(F.messages);
    const msg = (msgs.main || []).find(m => m.id === id || m.id.startsWith(id));
    if (!msg) return lines('Message not found', 'error');
    const count = Object.keys(msg.reactions || {}).length;
    msg.reactions = {};
    wd(F.messages, msgs);
    io.emit('msg-reaction', { id: msg.id, reactions: {} });
    return lines(`Cleared ${count} reaction(s) from message`, 'success');
  }

  // ── SEND AS (quick one-liner) ──
  if (cmd === 'send' && parts[1]?.toLowerCase() === 'as') {
    const user = parts[2]?.toLowerCase();
    const text = parts.slice(3).join(' ');
    if (!user || !text) return lines('Usage: send as <user> <text>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    const msgs = rd(F.messages);
    if (!Array.isArray(msgs.main)) msgs.main = [];
    const msg = {
      id: uuidv4(), sender: user, type: 'text', text,
      files: [], priority: false, replyTo: null,
      timestamp: Date.now(), edited: false, editedAt: null,
      reactions: {}, read: false, readAt: null, unsendable: false,
      formatting: null, aiGenerated: false,
    };
    msgs.main.push(msg);
    wd(F.messages, msgs);
    io.emit('new-message', msg);
    return lines(`Sent as ${user}: "${text}"`, 'success');
  }

  // ── PURGE ──
  if (cmd === 'purge') {
    const sub = parts[1]?.toLowerCase();
    const msgs = rd(F.messages);
    const main = msgs?.main || [];
    let removed = 0;

    if (sub === 'from') {
      const user = parts[2]?.toLowerCase();
      if (!user) return lines('Usage: purge from <user>', 'warn');
      const before = main.length;
      msgs.main = main.filter(m => m.sender !== user);
      removed = before - msgs.main.length;
      wd(F.messages, msgs);
    } else if (sub === 'before') {
      const dateStr = parts[2];
      if (!dateStr) return lines('Usage: purge before <YYYY-MM-DD>', 'warn');
      const cutoff = new Date(dateStr).getTime();
      if (isNaN(cutoff)) return lines('Invalid date format. Use YYYY-MM-DD', 'error');
      const before = main.length;
      msgs.main = main.filter(m => m.timestamp >= cutoff);
      removed = before - msgs.main.length;
      wd(F.messages, msgs);
    } else if (sub === 'keyword') {
      const kw = parts.slice(2).join(' ').toLowerCase();
      if (!kw) return lines('Usage: purge keyword <text>', 'warn');
      const before = main.length;
      msgs.main = main.filter(m => !m.text?.toLowerCase().includes(kw));
      removed = before - msgs.main.length;
      wd(F.messages, msgs);
    } else {
      return lines('Usage: purge from <user> | purge before <date> | purge keyword <text>', 'warn');
    }
    if (removed > 0) io.emit('messages-updated');
    return lines(`Purged ${removed} messages`, removed > 0 ? 'success' : 'warn');
  }

  // ── BRAINSTORM ──
  if (cmd === 'brainstorm') {
    const sub = parts[1]?.toLowerCase();
    const msgs = rd(F.messages);
    const bs = msgs?.brainstorm || [];
    if (sub === 'list') {
      if (!bs.length) return lines('No brainstorm messages', 'dim');
      return {
        lines: [{ text: `${bs.length} brainstorm messages`, cls: 'success' }],
        messages: bs.slice(-30),
      };
    }
    if (sub === 'clear') {
      const count = bs.length;
      msgs.brainstorm = [];
      wd(F.messages, msgs);
      return lines(`Cleared ${count} brainstorm messages`, 'success');
    }
    return lines('Usage: brainstorm list | brainstorm clear', 'warn');
  }

  // ── WHO ──
  if (cmd === 'who') {
    const users = rd(F.users);
    const rows = [];
    for (const [name, u] of Object.entries(users || {})) {
      const presence = onlineUsers[name]?.state || 'offline';
      const lastSeen = u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'never';
      rows.push([u.displayName || name, presence, u.status || '-', lastSeen]);
    }
    return { table: { headers: ['User', 'Presence', 'Status', 'Last Seen'], rows } };
  }

  // ── RESET USER ──
  if (raw.toLowerCase().startsWith('reset user')) {
    const user = parts[2]?.toLowerCase();
    if (!user) return lines('Usage: reset user <user>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    const defaults = {
      kaliph: {
        name: 'Kaliph', displayName: 'Kaliph', theme: 'kaliph',
        status: 'online', customStatus: '', avatar: null, email: '',
        nameStyle: { color: '#7c3aed', gradient: true, font: 'Orbitron' },
        gifEnabled: true, wallpaperEnabled: true, wallpaper: null,
        font: 'default', bio: '', dashboardLayout: [], pinnedNotes: [],
      },
      kathrine: {
        name: 'Kathrine', displayName: 'Kathrine', theme: 'kathrine',
        status: 'online', customStatus: '', avatar: null, email: '',
        nameStyle: { color: '#c084fc', gradient: true, font: 'Cormorant Garamond' },
        gifEnabled: true, wallpaperEnabled: true, wallpaper: null,
        font: 'default', bio: '', dashboardLayout: [], pinnedNotes: [],
      },
    };
    if (!defaults[user]) return lines(`No defaults for "${user}"`, 'error');
    users[user] = defaults[user];
    wd(F.users, users);
    io.emit('user-updated', { user, data: users[user] });
    return lines(`${user} profile reset to defaults`, 'success');
  }

  // ── TOGGLE FEATURES ──
  if (cmd === 'toggle') {
    const feature = parts[1]?.toLowerCase();
    const user = parts[2]?.toLowerCase();
    if (!feature || !user) return lines('Usage: toggle <gif|wallpaper> <user>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    if (feature === 'gif') {
      users[user].gifEnabled = !users[user].gifEnabled;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} GIF → ${users[user].gifEnabled ? 'enabled' : 'disabled'}`, 'success');
    }
    if (feature === 'wallpaper') {
      users[user].wallpaperEnabled = !users[user].wallpaperEnabled;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      return lines(`${user} wallpaper → ${users[user].wallpaperEnabled ? 'enabled' : 'disabled'}`, 'success');
    }
    return lines('Unknown feature. Options: gif, wallpaper', 'error');
  }

  // ── DELETE NOTE ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'note') {
    const id = parts[2];
    if (!id) return lines('Usage: delete note <id>', 'warn');
    const notes = rd(F.notes) || {};
    for (const user of ['kaliph', 'kathrine']) {
      if (!Array.isArray(notes[user])) continue;
      const idx = notes[user].findIndex(n => n.id?.startsWith(id));
      if (idx !== -1) {
        const removed = notes[user].splice(idx, 1)[0];
        wd(F.notes, notes);
        return lines(`Deleted note "${removed.title}" from ${user}`, 'success');
      }
    }
    return lines('Note not found', 'error');
  }

  // ── DELETE CONTACT ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'contact') {
    const id = parts[2];
    if (!id) return lines('Usage: delete contact <id>', 'warn');
    let contacts = rd(F.contacts) || [];
    const idx = contacts.findIndex(c => c.id?.startsWith(id));
    if (idx === -1) return lines('Contact not found', 'error');
    const removed = contacts.splice(idx, 1)[0];
    wd(F.contacts, contacts);
    return lines(`Deleted contact "${removed.name}"`, 'success');
  }

  // ── DELETE EVENT ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'event') {
    const id = parts[2];
    if (!id) return lines('Usage: delete event <id>', 'warn');
    const cal = rd(F.calendar) || {};
    for (const key of ['kaliph', 'kathrine', 'shared']) {
      if (!Array.isArray(cal[key])) continue;
      const idx = cal[key].findIndex(e => e.id?.startsWith(id));
      if (idx !== -1) {
        const removed = cal[key].splice(idx, 1)[0];
        wd(F.calendar, cal);
        return lines(`Deleted event "${removed.title}" from ${key}`, 'success');
      }
    }
    return lines('Event not found', 'error');
  }

  // ── DELETE VAULT ITEM ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'vault-item') {
    const id = parts[2];
    if (!id) return lines('Usage: delete vault-item <id>', 'warn');
    const vault = rd(F.vault) || {};
    for (const user of ['kaliph', 'kathrine']) {
      if (!Array.isArray(vault[user])) continue;
      const idx = vault[user].findIndex(v => v.id?.startsWith(id));
      if (idx !== -1) {
        const removed = vault[user].splice(idx, 1)[0];
        wd(F.vault, vault);
        return lines(`Deleted vault item "${removed.name}" from ${user}`, 'success');
      }
    }
    return lines('Vault item not found', 'error');
  }

  // ── DELETE SUGGESTION ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'suggestion') {
    const id = parts[2];
    if (!id) return lines('Usage: delete suggestion <id>', 'warn');
    let sugs = rd(F.suggestions) || [];
    const idx = sugs.findIndex(s => s.id?.startsWith(id));
    if (idx === -1) return lines('Suggestion not found', 'error');
    const removed = sugs.splice(idx, 1)[0];
    wd(F.suggestions, sugs);
    return lines(`Deleted suggestion from ${removed.from}: "${(removed.message || '').substring(0, 40)}"`, 'success');
  }

  // ── BACKUP (without destroying) ──
  if (cmd === 'backup') {
    const bundle = {};
    for (const [k, file] of Object.entries(F)) { bundle[k] = rd(file) || {}; }
    const sent = await sendMail(
      'royalkvault@gmail.com',
      '🔒 Royal Kat & Kai Vault — Manual Backup',
      '<h2>Manual Backup</h2><p>Full data backup triggered from eval terminal.</p>',
      [{ filename: `vault-backup-${Date.now()}.json`, content: JSON.stringify(bundle, null, 2) }]
    );
    return lines(sent ? 'Backup emailed to royalkvault@gmail.com' : 'Backup email failed — check server logs', sent ? 'success' : 'error');
  }

  // ── MAINTENANCE MODE ──
  if (cmd === 'maintenance') {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'on') {
      maintenanceMode = true;
      io.emit('force-logout');
      return multi(
        ['Maintenance mode ON', 'warn'],
        ['All users force-logged out. New logins blocked.', 'data'],
        ['Use "maintenance off" to re-enable access.', 'dim'],
      );
    }
    if (sub === 'off') {
      maintenanceMode = false;
      return lines('Maintenance mode OFF — site accessible again', 'success');
    }
    return lines('Usage: maintenance on | maintenance off', 'warn');
  }

  // ── UPTIME ──
  if (cmd === 'uptime') {
    const secs = Math.floor(process.uptime());
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return lines(`Server uptime: ${d}d ${h}h ${m}m ${s}s`, 'success');
  }

  // ── DISK ──
  if (cmd === 'disk') {
    const rows = [];
    for (const [k, file] of Object.entries(F)) {
      try {
        const stat = fs.statSync(file);
        const kb = (stat.size / 1024).toFixed(1);
        rows.push([k, `${kb} KB`, new Date(stat.mtime).toLocaleString()]);
      } catch { rows.push([k, 'missing', '-']); }
    }
    // Uploads directory
    try {
      let totalSize = 0;
      let fileCount = 0;
      const walkDir = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          if (st.isDirectory()) walkDir(full);
          else { totalSize += st.size; fileCount++; }
        }
      };
      walkDir(UPLOADS_DIR);
      rows.push(['uploads/', `${(totalSize / 1024 / 1024).toFixed(2)} MB (${fileCount} files)`, '-']);
    } catch { rows.push(['uploads/', 'error', '-']); }
    return { table: { headers: ['File', 'Size', 'Modified'], rows } };
  }

  // ── EXPORT ──
  if (cmd === 'export') {
    const bundle = {};
    for (const [k, file] of Object.entries(F)) { bundle[k] = rd(file) || {}; }
    return multi(
      ['Data exported. Copy from below:', 'success'],
      [JSON.stringify(bundle, null, 2), 'dim'],
    );
  }

  return lines(`Unknown command: "${raw}". Type "help" for commands.`, 'error');
}

// ── Serve HTML pages ──────────────────────────────────────────────────────────
app.get('/app',      (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/guest',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'guest.html')));
app.get('/backdoor', (_, res) => res.sendFile(path.join(__dirname, 'public', 'backdoor.html')));
app.get('/eval',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'eval.html')));

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════

// Presence: maps user → { socketId, state: 'online'|'idle' }
const onlineUsers = {};

io.on('connection', socket => {
  socket.on('user-online', ({ user }) => {
    onlineUsers[user] = { socketId: socket.id, state: 'online' };
    socket.broadcast.emit('user-presence', { user, state: 'online' });
  });
  socket.on('user-active', ({ user }) => {
    // User came back from idle
    onlineUsers[user] = { socketId: socket.id, state: 'online' };
    socket.broadcast.emit('user-presence', { user, state: 'online' });
  });
  socket.on('user-idle', ({ user }) => {
    // User went idle (inactivity or tab hidden) — still connected, just idle
    if (onlineUsers[user]) onlineUsers[user].state = 'idle';
    else onlineUsers[user] = { socketId: socket.id, state: 'idle' };
    socket.broadcast.emit('user-presence', { user, state: 'idle' });
  });
  socket.on('user-invisible', ({ user }) => {
    // User idle 5+ min — treat as offline, save lastSeen
    const users = rd(F.users);
    if (users && users[user]) { users[user].lastSeen = Date.now(); wd(F.users, users); }
    delete onlineUsers[user];
    socket.broadcast.emit('user-presence', { user, state: 'offline' });
  });
  socket.on('typing',       d => socket.broadcast.emit('user-typing',   d));
  socket.on('stop-typing',  d => socket.broadcast.emit('user-stop-typing', d));
  socket.on('status-change', d => { socket.broadcast.emit('status-changed', d); });
  // WebRTC signaling
  socket.on('call-offer',         d => socket.broadcast.emit('call-offer',         d));
  socket.on('call-answer',        d => socket.broadcast.emit('call-answer',        d));
  socket.on('call-ice-candidate', d => socket.broadcast.emit('call-ice-candidate', d));
  socket.on('call-end',           d => socket.broadcast.emit('call-ended',         d));
  socket.on('heartbeat', ({ user }) => {
    // Update lastSeen on every heartbeat (sent every ~60s while active)
    const users = rd(F.users);
    if (users && users[user]) {
      users[user].lastSeen = Date.now();
      wd(F.users, users);
    }
  });
  socket.on('disconnect', () => {
    const user = Object.keys(onlineUsers).find(u => onlineUsers[u]?.socketId === socket.id);
    if (user) {
      // Save lastSeen timestamp on disconnect — user is truly offline now
      const users = rd(F.users);
      if (users && users[user]) { users[user].lastSeen = Date.now(); wd(F.users, users); }
      delete onlineUsers[user];
      socket.broadcast.emit('user-presence', { user, state: 'offline' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`\n🏰 ══════════════════════════════════════════ 🏰`);
  console.log(`   The Royal Kat & Kai Vault`);
  console.log(`   Running on → http://localhost:${PORT}`);
  console.log(`   Backdoor   → http://localhost:${PORT}/backdoor`);
  // Email status check
  const emailProvider = getEmailProvider();
  if (!emailProvider) {
    console.log(`   Email      → ❌ NOT configured (set BREVO_API_KEY or EMAIL_USER+EMAIL_PASS)`);
  } else {
    try {
      const ok = await verifyEmail();
      if (ok) {
        console.log(`   Email      → ✅ ${emailProvider === 'brevo' ? 'Brevo (HTTP)' : 'Gmail SMTP'} ready`);
      } else {
        console.log(`   Email      → ⚠️  ${emailProvider} configured but verification failed`);
      }
    } catch (e) {
      console.log(`   Email      → ⚠️  ${emailProvider} configured but connection failed: ${e.message}`);
      _transporter = null;
    }
  }
  console.log(`🏰 ══════════════════════════════════════════ 🏰\n`);
});
