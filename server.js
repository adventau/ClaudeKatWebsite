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

// ── Email (Gmail SMTP) ───────────────────────────────────────────────────────
function mailer() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
}
async function sendMail(to, subject, html, attachments = []) {
  if (!to) { console.error('Mail error: no recipient email configured'); return false; }
  if (!process.env.EMAIL_PASS) {
    console.error('Mail error: EMAIL_PASS not configured in .env');
    return false;
  }
  try {
    await mailer().sendMail({ from: process.env.EMAIL_USER, to, subject, html, attachments });
    return true;
  } catch (e) { console.error('Mail error:', e.message); return false; }
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
  if (message.priority) {
    const sender = req.session.user;
    const recipient = sender === 'kaliph' ? 'kathrine' : 'kaliph';
    const emailData = settings.emails[recipient];
    let emails = Array.isArray(emailData) ? emailData.filter(e => e) : (emailData ? [emailData] : []);
    // Fallback: if no per-user email, try shared email, then env EMAIL_FROM
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
    }
    for (const email of emails) {
      const sent = await sendMail(email, subject, html);
      console.log(sent ? `Priority email sent to ${email}` : `Priority email FAILED to ${email}`);
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
  res.json({ success: true, message });
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

// ── Serve HTML pages ──────────────────────────────────────────────────────────
app.get('/app',      (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/guest',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'guest.html')));
app.get('/backdoor', (_, res) => res.sendFile(path.join(__dirname, 'public', 'backdoor.html')));

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════

// Presence: maps user → { socketId, state: 'online'|'idle' }
const onlineUsers = {};

io.on('connection', socket => {
  socket.on('user-online', ({ user }) => {
    // Main app users join private-chat room (guests don't emit user-online)
    socket.join('private-chat');
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
  socket.on('typing',       d => socket.to('private-chat').emit('user-typing',   d));
  socket.on('stop-typing',  d => socket.to('private-chat').emit('user-stop-typing', d));
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
server.listen(PORT, () => {
  console.log(`\n🏰 ══════════════════════════════════════════ 🏰`);
  console.log(`   The Royal Kat & Kai Vault`);
  console.log(`   Running on → http://localhost:${PORT}`);
  console.log(`   Backdoor   → http://localhost:${PORT}/backdoor`);
  console.log(`🏰 ══════════════════════════════════════════ 🏰\n`);
});
