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
const db = require('./db');
// nodemailer removed — using EmailJS HTTP API instead
let compression;
try { compression = require('compression'); } catch(e) { /* optional */ }
const webpush = require('web-push');
const crypto = require('crypto');

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
  pushSubs:      path.join(DATA_DIR, 'push-subscriptions.json'),
  reminders:     path.join(DATA_DIR, 'reminders.json'),
  totp:          path.join(DATA_DIR, 'totp.json'),
};

// ── Web Push (VAPID) ─────────────────────────────────────────────────────────
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BDcePE_uIcloJSjJJCKxgnwWKwSqkGGqdHzOWrI77Pe-FV9mrUBnvHrmQjTCJi1LxUSO7064hK9dkLgpctxs2do';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '2T0GU1HyXiA1qNsm6Rp-lpOjUTYMcPE_IkUe0flutKU';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:royalkvault@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
}

function getPushSubs() { return rd(F.pushSubs) || {}; }
function savePushSubs(subs) { wd(F.pushSubs, subs); }

async function sendPushToUser(targetUser, payload) {
  if (!VAPID_PUBLIC) return;
  const subs = getPushSubs();
  const userSubs = subs[targetUser] || [];
  if (!userSubs.length) return;
  const body = JSON.stringify(payload);
  const expired = [];
  for (let i = 0; i < userSubs.length; i++) {
    try {
      await webpush.sendNotification(userSubs[i], body);
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) expired.push(i);
      else console.error('Push error:', e.message);
    }
  }
  // Clean up expired subscriptions
  if (expired.length) {
    subs[targetUser] = userSubs.filter((_, i) => !expired.includes(i));
    savePushSubs(subs);
  }
}

// path → short key, e.g. '/data/users.json' → 'users'
const F_KEY = Object.fromEntries(Object.entries(F).map(([k, v]) => [v, k]));

// In-memory data cache — populated from Postgres on startup.
// All rd() calls check this first; all wd() calls update it and background-persist to Postgres.
const dataCache = {};

function rd(file) {
  const key = F_KEY[file];
  if (key && key in dataCache) return dataCache[key];
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}
function wd(file, data) {
  const key = F_KEY[file];
  if (key) dataCache[key] = data;
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {}
  if (db.pool && key) {
    db.write(key, data).catch(e => console.error('[db] write error:', e.message));
  }
}

// Load all data from Postgres into the in-memory cache (called once at startup).
async function loadDbCache() {
  if (!db.pool) return;
  try {
    await db.createSchema();
    // Migrate existing JSON messages into the SQL messages table (idempotent)
    await migrateMessages();
    // Fire all DB reads in parallel instead of sequentially
    const results = await Promise.all(
      Object.keys(F).map(key => db.read(key).then(data => [key, data]))
    );
    results.forEach(([key, data]) => {
      if (key === 'messages') return; // messages now live in their own SQL table
      if (data !== null) dataCache[key] = data;
    });
    console.log('[db] Cache loaded from Postgres');
  } catch (e) {
    console.error('[db] loadDbCache error:', e.message, '— continuing with JSON files');
  }
}

// One-time migration: copy messages from messages.json into the messages SQL table.
// Safe to run on every startup — ON CONFLICT DO NOTHING skips already-migrated rows.
async function migrateMessages() {
  if (!db.pool) return;
  try {
    const msgs = rd(F.messages);
    const list = msgs?.main || [];
    if (!list.length) return;
    let migrated = 0;
    for (const msg of list) {
      await db.insertMessage(msg);
      migrated++;
    }
    if (migrated) console.log(`[db] Migrated ${migrated} messages to SQL table`);
  } catch (e) {
    console.error('[db] migrateMessages error:', e.message);
  }
}

/**
 * Returns the current "site time" — if a time override is active via
 * `time set` eval command, returns that shifted time instead of real now.
 */
function getSiteNow() {
  const s = rd(F.settings);
  const offset = s?.timeOffset;
  if (!offset) return new Date();
  // Relative: +2h, -30m, +1d, +90s
  const rel = offset.match(/^([+-])(\d+(?:\.\d+)?)(h|m|s|d)$/i);
  if (rel) {
    const sign = rel[1] === '+' ? 1 : -1;
    const val  = parseFloat(rel[2]);
    const unit = rel[3].toLowerCase();
    const ms   = unit === 'h' ? val * 3600000
               : unit === 'm' ? val * 60000
               : unit === 's' ? val * 1000
               : val * 86400000;
    return new Date(Date.now() + sign * ms);
  }
  // Absolute ISO date
  const abs = new Date(offset);
  if (!isNaN(abs)) return abs;
  return new Date();
}

// ── Initialize default data ───────────────────────────────────────────────────
function initData() {
  if (!rd(F.settings)) {
    wd(F.settings, {
      sitePassword:  bcrypt.hashSync('KaiKat2024!', 10),
      emails:        { kaliph: '', kathrine: '', shared: 'royalkvault@gmail.com' },
      vaultPasscode: '0000',
      backdoorCode:  'Admin',
      evalPassword:  'Admin',
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
    totp:          { kaliph: [], kathrine: [] },
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!rd(F[k])) wd(F[k], v);
  }
}
initData();

// ── Middleware ────────────────────────────────────────────────────────────────
// Trust Railway's (and any other single) reverse proxy so req.secure = true
// when the upstream connection is HTTPS. Without this, express-session refuses
// to set the session cookie (cookie.secure:true) because it sees HTTP internally.
app.set('trust proxy', 1);
if (compression) app.use(compression());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// Serve uploads from persistent volume when UPLOADS_DIR is external
if (process.env.UPLOADS_DIR) app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
// Postgres-backed session store — used when DATABASE_URL is set so sessions
// survive deployments and don't depend on the ephemeral filesystem.
class PgStore extends session.Store {
  async get(sid, cb) {
    try {
      const r = await db.query(
        'SELECT data FROM sessions WHERE sid = $1 AND expires > $2',
        [sid, Date.now()]
      );
      if (!r.rows.length) return cb(null, null);
      const data = r.rows[0].data;
      cb(null, typeof data === 'string' ? JSON.parse(data) : data);
    } catch (e) { cb(e); }
  }
  async set(sid, sess, cb) {
    const ttl = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 2 * 60 * 60 * 1000;
    try {
      await db.query(
        'INSERT INTO sessions (sid, data, expires) VALUES ($1, $2::jsonb, $3) ' +
        'ON CONFLICT (sid) DO UPDATE SET data = $2::jsonb, expires = $3',
        [sid, JSON.stringify(sess), ttl]
      );
      cb(null);
    } catch (e) { cb(e); }
  }
  async destroy(sid, cb) {
    try { await db.query('DELETE FROM sessions WHERE sid = $1', [sid]); cb(null); }
    catch (e) { cb(e); }
  }
  async touch(sid, sess, cb) { return this.set(sid, sess, cb); }
}

const sessionStore = db.pool
  ? new PgStore()
  : new FileStore({ path: path.join(DATA_DIR, 'sessions'), ttl: 7200, retries: 0, logFn: () => {} });

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'fallback-dev-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { secure: true, sameSite: 'none', maxAge: 2 * 60 * 60 * 1000 }
}));

// ── File upload ───────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename:    (_, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── Email (EmailJS HTTP API) ─────────────────────────────────────────────────
const EMAILJS_SERVICE_ID   = 'service_b9w5l9r';
const EMAILJS_TEMPLATE_ID  = 'template_3r5tv4v';
const EMAILJS_PUBLIC_KEY   = 'LeXXDyvjvPYB_pG9r';
const EMAILJS_PRIVATE_KEY  = 'VBsWqAY8qB-yCCTogSyYl';

async function sendMail(to, subject, html, attachments = []) {
  if (!to) { console.error('Mail error: no recipient email configured'); return false; }
  // Extract plain text from html for the message field
  const plainText = html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  try {
    const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email: to,
          from_name: 'Royal Kat & Kai Vault',
          subject: subject,
          message: plainText,
          site_url: process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : `http://localhost:${process.env.PORT || 3000}`,
        },
      }),
    });
    if (resp.ok) {
      console.log(`Mail sent via EmailJS to ${to}`);
      return true;
    }
    const errText = await resp.text();
    console.error(`Mail error (${resp.status}): ${errText}`);
    return false;
  } catch (e) {
    console.error('Mail error:', e.message);
    return false;
  }
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
      // Clear any stale main-user session data so guest doesn't inherit it
      delete req.session.authenticated;
      delete req.session.user;
      delete req.session.loginTime;
      req.session.isGuest = true;
      req.session.guestId = id;
      return req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Session error' });
        res.json({ success: true, isGuest: true, guestName: g.name });
      });
    }
  }

  if (bcrypt.compareSync(password, settings.sitePassword)) {
    // Clear any stale guest session data so host doesn't inherit it
    delete req.session.isGuest;
    delete req.session.guestId;
    req.session.authenticated = true;
    return req.session.save(err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.json({ success: true });
    });
  }
  res.json({ success: false, error: 'Incorrect password' });
});

app.post('/api/auth/profile', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  const { profile, passcode } = req.body;
  if (!['kaliph', 'kathrine'].includes(profile)) return res.json({ success: false });
  const users = rd(F.users);
  const user = users[profile];
  if (user && user.profilePasscode) {
    if (!passcode) return res.json({ success: false, needsPasscode: true });
    const match = await checkPasscode(passcode, user.profilePasscode);
    if (!match) return res.json({ success: false, error: 'Incorrect passcode' });
    // Rehash legacy plaintext passcode on first successful login
    if (!user.profilePasscode.startsWith('$2b$') && !user.profilePasscode.startsWith('$2a$')) {
      users[profile].profilePasscode = await bcrypt.hash(passcode, 10);
      wd(F.users, users);
    }
  }
  // Clear any stale guest session so host messages use the correct sender
  delete req.session.isGuest;
  delete req.session.guestId;
  req.session.user = profile;
  req.session.loginTime = Date.now();
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ success: true });
  });
});

// Check which profiles have passcodes enabled (for login page)
app.get('/api/auth/profile-locks', (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  const users = rd(F.users);
  const locks = {};
  const needsReset = {};
  const resetHints = {};
  for (const [name, u] of Object.entries(users || {})) {
    locks[name] = !!u.profilePasscode;
    needsReset[name] = !!u.mustResetPasscode;
    if (u.mustResetPasscode) resetHints[name] = u.oldPasscodeHint || '';
  }
  res.json({ ...locks, needsReset, resetHints });
});

// Force-reset a profile passcode (set new pin)
app.post('/api/auth/profile-reset', async (req, res) => {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not authenticated' });
  const { profile, newPasscode } = req.body;
  if (!['kaliph', 'kathrine'].includes(profile)) return res.json({ success: false, error: 'Invalid profile' });
  const users = rd(F.users);
  const user = users[profile];
  if (!user?.mustResetPasscode) return res.json({ success: false, error: 'No reset pending for this profile' });
  if (!newPasscode || !/^\d{4}$/.test(newPasscode)) return res.json({ success: false, error: 'Passcode must be 4 digits' });
  user.profilePasscode = await bcrypt.hash(newPasscode, 10);
  delete user.mustResetPasscode;
  delete user.oldPasscodeHint;
  wd(F.users, users);
  delete req.session.isGuest;
  delete req.session.guestId;
  req.session.user = profile;
  req.session.loginTime = Date.now();
  res.json({ success: true });
});

// Set or remove profile passcode
app.post('/api/auth/profile-passcode', mainAuth, async (req, res) => {
  const { passcode } = req.body;
  const users = rd(F.users);
  if (passcode) {
    if (!/^\d{4}$/.test(passcode)) return res.json({ success: false, error: 'Passcode must be exactly 4 digits' });
    users[req.session.user].profilePasscode = await bcrypt.hash(passcode, 10);
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

// Stealth preview — view as another user without affecting their presence/lastSeen/unread
app.get('/api/auth/stealth', (req, res) => {
  if (!req.session?.authenticated || !req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  const target = req.query.target?.toLowerCase();
  if (!target || !['kaliph', 'kathrine'].includes(target)) return res.status(400).json({ error: 'Invalid target user' });
  // Return session info with the stealth target — does NOT modify the actual session
  res.json({
    authenticated: true,
    user: target,
    realUser: req.session.user,
    stealth: true,
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

// ── Update Status (status + customStatus from profile) ──────────────────────
app.post('/api/users/:user/status', mainAuth, (req, res) => {
  if (req.session.user !== req.params.user) return res.status(403).json({ error: 'Forbidden' });
  const users = rd(F.users);
  const u = users[req.params.user];
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (req.body.status) u.status = req.body.status;
  if (req.body.customStatus !== undefined) u.customStatus = req.body.customStatus;
  if (req.body.statusEmoji !== undefined) u.statusEmoji = req.body.statusEmoji;
  wd(F.users, users);
  io.emit('user-updated', { user: req.params.user, data: users[req.params.user] });
  io.emit('status-changed', { user: req.params.user, status: u.status, customStatus: u.customStatus || '', statusEmoji: u.statusEmoji || '' });
  res.json({ success: true, user: u });
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

app.get('/api/messages', mainAuth, async (req, res) => {
  const limit  = parseInt(req.query.limit)  || 50;
  const before = parseInt(req.query.before) || null;
  const after  = parseInt(req.query.after)  || null;
  const q      = req.query.q || null;

  if (db.pool) {
    try {
      const rows = await db.getMessages({ limit, before, after, search: q });
      return res.json(rows);
    } catch (e) {
      console.error('[db] getMessages error:', e.message);
    }
  }

  // Legacy JSON fallback
  const msgs = rd(F.messages);
  let main = msgs?.main || [];
  if (after)  main = main.filter(m => m.timestamp > after);
  if (before) main = main.filter(m => m.timestamp < before);
  if (q)      main = main.filter(m => m.text?.toLowerCase().includes(q.toLowerCase()));
  if (limit && !q) main = main.slice(-limit);
  else if (limit)  main = main.slice(0, limit);
  res.json(main);
});

app.post('/api/messages', mainAuth, upload.array('files', 20), async (req, res) => {
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

  if (db.pool) {
    try {
      await db.insertMessage(message);
    } catch (e) {
      console.error('[db] insertMessage error:', e.message);
      // Fall through to legacy path on DB error
      const msgs2 = rd(F.messages);
      if (!Array.isArray(msgs2.main)) msgs2.main = [];
      msgs2.main.push(message);
      wd(F.messages, msgs2);
    }
  } else {
    const msgs2 = rd(F.messages);
    if (!Array.isArray(msgs2.main)) msgs2.main = [];
    msgs2.main.push(message);
    wd(F.messages, msgs2);
  }

  // Priority email (supports multiple emails per person)
  let emailStatus = null;
  if (message.priority) {
    const sender = req.session.user;
    const recipient = sender === 'kaliph' ? 'kathrine' : 'kaliph';
    const emailData = settings.emails?.[recipient];
    let emails = Array.isArray(emailData) ? emailData.filter(e => e) : (emailData ? [emailData] : []);
    // Fallback: if no per-user email, try shared email, then env EMAIL_USER
    if (emails.length === 0 && settings.emails?.shared) emails = [settings.emails.shared];
    if (emails.length === 0) emails = ['royalkvault@gmail.com'];
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
  setTimeout(async () => {
    try {
      if (db.pool) {
        await db.updateMessage(message.id, { unsendable: false });
      } else {
        const m = rd(F.messages);
        const i = (m.main || []).findIndex(x => x.id === message.id);
        if (i !== -1) { m.main[i].unsendable = false; wd(F.messages, m); }
      }
      io.emit('msg-unsend-expire', message.id);
    } catch {}
  }, 3 * 60 * 1000);

  io.emit('new-message', message);

  // Push notification to the other user
  const sender = req.session.user;
  const recipient = sender === 'kaliph' ? 'kathrine' : 'kaliph';
  const senderName = sender.charAt(0).toUpperCase() + sender.slice(1);
  sendPushToUser(recipient, {
    title: message.priority ? `🔴 Priority from ${senderName}` : `${senderName}`,
    body: message.text?.substring(0, 120) || (message.files?.length ? '📎 Sent a file' : 'New message'),
    icon: '/favicon.ico',
    tag: 'msg-' + message.id,
    url: '/app',
    priority: message.priority,
  }).catch(() => {});

  res.json({ success: true, message, emailStatus });
});

// Call event messages (missed call, call ended)
app.post('/api/messages/call-event', mainAuth, async (req, res) => {
  const event = {
    id: req.body.id || uuidv4(),
    sender: 'system',
    type: 'call-event',
    text: req.body.text,
    files: [],
    priority: false,
    replyTo: null,
    timestamp: req.body.timestamp || Date.now(),
    callType: req.body.callType,
    callStatus: req.body.callStatus,
    callPeer: req.body.callPeer,
    read: true,
    reactions: {},
  };
  if (db.pool) {
    try { await db.insertMessage(event); } catch (e) { console.error('[db] insertMessage error:', e.message); }
  } else {
    const msgs = rd(F.messages);
    if (!Array.isArray(msgs.main)) msgs.main = [];
    msgs.main.push(event);
    wd(F.messages, msgs);
  }
  io.emit('new-message', event);
  res.json({ success: true });
});

app.post('/api/messages/:id/read', mainAuth, async (req, res) => {
  if (db.pool) {
    try {
      const msg = await db.getMessageById(req.params.id);
      if (msg && msg.sender !== req.session.user) {
        const readAt = Date.now();
        await db.updateMessage(req.params.id, { read: true, readAt });
        io.emit('msg-read', { id: req.params.id, readAt });
      }
    } catch (e) { console.error('[db] read-receipt error:', e.message); }
    return res.json({ success: true });
  }
  // Legacy JSON fallback
  const msgs = rd(F.messages);
  const i = (msgs.main || []).findIndex(m => m.id === req.params.id);
  if (i !== -1 && msgs.main[i].sender !== req.session.user) {
    msgs.main[i].read = true; msgs.main[i].readAt = Date.now();
    wd(F.messages, msgs);
    io.emit('msg-read', { id: req.params.id, readAt: msgs.main[i].readAt });
  }
  res.json({ success: true });
});

app.post('/api/messages/:id/react', mainAuth, async (req, res) => {
  const { emoji } = req.body;
  if (db.pool) {
    try {
      const msg = await db.getMessageById(req.params.id);
      if (msg) {
        const reactions = msg.reactions || {};
        if (!reactions[emoji]) reactions[emoji] = [];
        const ui = reactions[emoji].indexOf(req.session.user);
        if (ui === -1) reactions[emoji].push(req.session.user);
        else reactions[emoji].splice(ui, 1);
        if (reactions[emoji].length === 0) delete reactions[emoji];
        await db.updateMessage(req.params.id, { reactions });
        io.emit('msg-reaction', { id: req.params.id, reactions });
      }
    } catch (e) { console.error('[db] react error:', e.message); }
    return res.json({ success: true });
  }
  // Legacy JSON fallback
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

app.delete('/api/messages/:id', mainAuth, async (req, res) => {
  if (db.pool) {
    try {
      const msg = await db.getMessageById(req.params.id);
      if (!msg) return res.json({ success: true });
      if (msg.sender !== req.session.user) return res.status(403).json({ error: 'Forbidden' });
      if (!msg.unsendable) return res.status(403).json({ error: 'Unsend window expired' });
      await db.deleteMessage(req.params.id);
      io.emit('msg-unsent', req.params.id);
      return res.json({ success: true });
    } catch (e) { console.error('[db] delete error:', e.message); return res.status(500).json({ error: 'DB error' }); }
  }
  // Legacy JSON fallback
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

app.put('/api/messages/:id', mainAuth, async (req, res) => {
  if (db.pool) {
    try {
      const msg = await db.getMessageById(req.params.id);
      if (msg && msg.sender === req.session.user) {
        const editedAt = Date.now();
        await db.updateMessage(req.params.id, { text: req.body.text, edited: true, editedAt });
        io.emit('msg-edited', { id: req.params.id, text: req.body.text, editedAt });
      }
    } catch (e) { console.error('[db] edit error:', e.message); }
    return res.json({ success: true });
  }
  // Legacy JSON fallback
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

// ── Pin / Unpin Messages ────────────────────────────────────────────────────
app.post('/api/messages/:id/pin', mainAuth, async (req, res) => {
  if (db.pool) {
    try {
      const msg = await db.getMessageById(req.params.id);
      if (!msg) return res.status(404).json({ error: 'Message not found' });
      const pinnedAt = Date.now();
      await db.updateMessage(req.params.id, { pinned: true, pinnedBy: req.session.user, pinnedAt });
      const pinNotice = {
        id: uuidv4(), sender: 'system', type: 'pin-notice', text: '',
        files: [], priority: false, replyTo: null,
        timestamp: pinnedAt, edited: false, editedAt: null,
        reactions: {}, read: true, readAt: null, unsendable: false,
        aiGenerated: false, systemMessage: true,
        pinnedMsgId: msg.id, pinnedBy: req.session.user,
      };
      await db.insertMessage(pinNotice);
      io.emit('msg-pinned', { id: msg.id, pinnedBy: req.session.user, pinnedAt });
      io.emit('new-message', pinNotice);
      return res.json({ success: true });
    } catch (e) { console.error('[db] pin error:', e.message); return res.status(500).json({ error: 'DB error' }); }
  }
  // Legacy JSON fallback
  const msgs = rd(F.messages);
  const msg = (msgs.main || []).find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.pinned = true;
  msg.pinnedBy = req.session.user;
  msg.pinnedAt = Date.now();
  wd(F.messages, msgs);
  const pinNotice = {
    id: uuidv4(), sender: 'system', type: 'pin-notice', text: '',
    files: [], priority: false, replyTo: null,
    timestamp: Date.now(), edited: false, editedAt: null,
    reactions: {}, read: true, readAt: null, unsendable: false,
    aiGenerated: false, systemMessage: true,
    pinnedMsgId: msg.id, pinnedBy: req.session.user,
  };
  msgs.main.push(pinNotice);
  wd(F.messages, msgs);
  io.emit('msg-pinned', { id: msg.id, pinnedBy: req.session.user, pinnedAt: msg.pinnedAt });
  io.emit('new-message', pinNotice);
  res.json({ success: true });
});

app.post('/api/messages/:id/unpin', mainAuth, async (req, res) => {
  if (db.pool) {
    try {
      const msg = await db.getMessageById(req.params.id);
      if (!msg) return res.status(404).json({ error: 'Message not found' });
      await db.updateMessage(req.params.id, { pinned: false, pinnedBy: null, pinnedAt: null });
      io.emit('msg-unpinned', { id: msg.id });
      return res.json({ success: true });
    } catch (e) { console.error('[db] unpin error:', e.message); return res.status(500).json({ error: 'DB error' }); }
  }
  // Legacy JSON fallback
  const msgs = rd(F.messages);
  const msg = (msgs.main || []).find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.pinned = false;
  delete msg.pinnedBy;
  delete msg.pinnedAt;
  wd(F.messages, msgs);
  io.emit('msg-unpinned', { id: msg.id });
  res.json({ success: true });
});

app.get('/api/messages/pinned', mainAuth, async (_, res) => {
  if (db.pool) {
    try {
      const pinned = await db.getPinnedMessages();
      return res.json(pinned);
    } catch (e) { console.error('[db] getPinned error:', e.message); }
  }
  // Legacy JSON fallback
  const msgs = rd(F.messages);
  const pinned = (msgs.main || []).filter(m => m.pinned);
  res.json(pinned);
});

// ── Link Preview (OpenGraph) ──────────────────────────────────────────────────
const linkPreviewCache = new Map();

function fetchPage(targetUrl) {
  return new Promise((resolve, reject) => {
    const httpsMod = require('https');
    const httpMod = require('http');
    const mod = targetUrl.startsWith('https') ? httpsMod : httpMod;
    const timer = setTimeout(() => { reject(new Error('Timeout')); }, 4000);

    const r = mod.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 4000,
    }, resp => {
      // Follow one redirect
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume(); // drain
        clearTimeout(timer);
        let loc = resp.headers.location;
        if (loc.startsWith('/')) { const u = new URL(targetUrl); loc = u.origin + loc; }
        return fetchPage(loc).then(resolve).catch(reject);
      }
      let d = ''; resp.setEncoding('utf8');
      resp.on('data', c => { d += c; if (d.length > 50000) { resp.destroy(); clearTimeout(timer); resolve(d); } });
      resp.on('end', () => { clearTimeout(timer); resolve(d); });
      resp.on('error', () => { clearTimeout(timer); reject(new Error('Response error')); });
    });
    r.on('error', (e) => { clearTimeout(timer); reject(e); });
    r.on('timeout', () => { r.destroy(); clearTimeout(timer); reject(new Error('Timeout')); });
  });
}

app.get('/api/link-preview', auth, async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'No URL' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  if (linkPreviewCache.has(url)) return res.json(linkPreviewCache.get(url));

  try {
    const html = await fetchPage(url);

    const meta = (name) => {
      const re = new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*?)["']`, 'i');
      const re2 = new RegExp(`<meta[^>]*content=["']([^"']*?)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
      return (html.match(re) || html.match(re2) || [])[1] || '';
    };
    const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';

    const data = {
      title: meta('og:title') || meta('twitter:title') || titleTag,
      description: meta('og:description') || meta('twitter:description') || meta('description'),
      image: meta('og:image') || meta('twitter:image'),
      siteName: meta('og:site_name') || new URL(url).hostname.replace('www.', ''),
      url,
    };

    // Make relative image URLs absolute
    if (data.image && !data.image.startsWith('http')) {
      const u = new URL(url);
      data.image = data.image.startsWith('/') ? u.origin + data.image : u.origin + '/' + data.image;
    }

    if (data.title || data.description || data.image) {
      linkPreviewCache.set(url, data);
      if (linkPreviewCache.size > 200) linkPreviewCache.delete(linkPreviewCache.keys().next().value);
      res.json(data);
    } else {
      res.json({ error: 'No metadata found' });
    }
  } catch (err) {
    res.json({ error: 'Failed to fetch' });
  }
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
  // Allow stealth mode to view target user's notes
  const viewAs = req.query.viewAs && ['kaliph', 'kathrine'].includes(req.query.viewAs) ? req.query.viewAs : req.session.user;
  const other = viewAs === 'kaliph' ? 'kathrine' : 'kaliph';
  res.json({
    mine:   notes[viewAs] || [],
    shared: (notes[other] || []).filter(n => n.sharedWith?.includes(viewAs)),
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

app.get('/api/vault', mainAuth, async (req, res) => {
  const s = rd(F.settings);
  if (!await checkVaultPasscode(req.query.passcode, s.vaultPasscode)) return res.status(403).json({ error: 'Invalid passcode' });
  res.json(rd(F.vault) || {});
});

app.post('/api/vault', mainAuth, upload.array('files', 20), async (req, res) => {
  const s = rd(F.settings);
  if (!await checkVaultPasscode(req.body.passcode, s.vaultPasscode)) return res.status(403).json({ error: 'Invalid passcode' });
  const vault = rd(F.vault) || {}; const u = req.session.user;
  if (!Array.isArray(vault[u])) vault[u] = [];
  const parentFolder = req.body.folder || null;
  // Folder creation
  if (req.body.folderName) {
    vault[u].push({
      id: uuidv4(), type: 'folder', name: req.body.folderName,
      folder: parentFolder, uploadedAt: Date.now(), uploadedBy: u,
    });
    wd(F.vault, vault);
    return res.json({ success: true });
  }
  (req.files || []).forEach(f => vault[u].push({
    id: uuidv4(), type: 'file', name: f.originalname,
    url: `/uploads/${f.filename}`, mimeType: f.mimetype,
    size: f.size, uploadedAt: Date.now(), uploadedBy: u,
    folder: parentFolder,
  }));
  if (req.body.link) vault[u].push({
    id: uuidv4(), type: 'link',
    name: req.body.linkName || req.body.link, url: req.body.link,
    uploadedAt: Date.now(), uploadedBy: u,
    folder: parentFolder,
  });
  wd(F.vault, vault);
  res.json({ success: true });
});

app.post('/api/vault-reorder', mainAuth, async (req, res) => {
  const s = rd(F.settings);
  if (!await checkVaultPasscode(req.body.passcode, s.vaultPasscode)) return res.status(403).json({ error: 'Invalid passcode' });
  const vault = rd(F.vault) || {};
  const u = req.session.user;
  const items = vault[u] || [];
  const order = req.body.order || [];
  const reordered = order.map(id => items.find(i => i.id === id)).filter(Boolean);
  const untouched = items.filter(i => !order.includes(i.id));
  vault[u] = [...untouched, ...reordered];
  wd(F.vault, vault);
  res.json({ success: true });
});

app.put('/api/vault/:id', mainAuth, async (req, res) => {
  const s = rd(F.settings);
  if (!await checkVaultPasscode(req.body.passcode, s.vaultPasscode)) return res.status(403).json({ error: 'Invalid passcode' });
  const vault = rd(F.vault) || {};
  let found = false;
  for (const u of Object.keys(vault)) {
    const item = (vault[u] || []).find(i => i.id === req.params.id);
    if (item) {
      if (req.body.name !== undefined) item.name = req.body.name;
      if (req.body.folder !== undefined) item.folder = req.body.folder || null;
      found = true; break;
    }
  }
  if (!found) return res.status(404).json({ error: 'Item not found' });
  wd(F.vault, vault);
  res.json({ success: true });
});

app.delete('/api/vault/:id', mainAuth, async (req, res) => {
  const s = rd(F.settings);
  if (!await checkVaultPasscode(req.body.passcode, s.vaultPasscode)) return res.status(403).json({ error: 'Invalid passcode' });
  const vault = rd(F.vault) || {};
  for (const u of Object.keys(vault)) vault[u] = vault[u].filter(i => i.id !== req.params.id);
  wd(F.vault, vault);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GIF SEARCH (GIPHY proxy)
// ═══════════════════════════════════════════════════════════════════════════════

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';

app.get('/api/gif-search', mainAuth, async (req, res) => {
  const q = req.query.q;
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 25;
  if (!q) return res.json({ data: [] });
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&rating=pg-13&lang=en`;
    const resp = await fetch(url);
    const data = await resp.json();
    const results = (data.data || []).map(g => ({
      id: g.id,
      url: g.images?.fixed_height?.url || g.images?.original?.url,
      preview: g.images?.fixed_height_small?.url || g.images?.preview_gif?.url,
      width: g.images?.fixed_height?.width,
      height: g.images?.fixed_height?.height,
    }));
    res.json({ results, pagination: { offset, count: results.length, total: data.pagination?.total_count || 0 } });
  } catch (e) {
    console.error('GIF search error:', e.message);
    res.json({ results: [], error: 'GIF search failed' });
  }
});

app.get('/api/gif-trending', mainAuth, async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit = parseInt(req.query.limit) || 25;
  try {
    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&offset=${offset}&rating=pg-13`;
    const resp = await fetch(url);
    const data = await resp.json();
    const results = (data.data || []).map(g => ({
      id: g.id,
      url: g.images?.fixed_height?.url || g.images?.original?.url,
      preview: g.images?.fixed_height_small?.url || g.images?.preview_gif?.url,
      width: g.images?.fixed_height?.width,
      height: g.images?.fixed_height?.height,
    }));
    res.json({ results, pagination: { offset, count: results.length, total: data.pagination?.total_count || 0 } });
  } catch (e) {
    res.json({ results: [] });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/calendar', mainAuth, (_, res) => res.json(rd(F.calendar) || {}));

app.post('/api/calendar', mainAuth, (req, res) => {
  const cal = rd(F.calendar); const u = req.session.user;
  const startDate = req.body.start || req.body.date;
  const endDate = req.body.end || startDate;
  const event = {
    id: uuidv4(), title: req.body.title,
    start: startDate,
    end: endDate,
    date: startDate, // backward compat
    description: req.body.description || '',
    color: req.body.color || '#7c3aed',
    reminder: req.body.reminder !== undefined && req.body.reminder !== '' ? parseInt(req.body.reminder) : null,
    createdBy: u,
  };
  if (!Array.isArray(cal.shared)) cal.shared = [];
  cal.shared.push(event);
  wd(F.calendar, cal);
  io.emit('calendar-updated');
  res.json({ success: true, event });
});

app.put('/api/calendar/:id', mainAuth, (req, res) => {
  const cal = rd(F.calendar);
  const idx = (cal.shared || []).findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const ev = cal.shared[idx];
  if (req.body.title !== undefined) ev.title = req.body.title;
  if (req.body.start !== undefined) { ev.start = req.body.start; ev.date = req.body.start; }
  if (req.body.end !== undefined) ev.end = req.body.end;
  if (req.body.description !== undefined) ev.description = req.body.description;
  if (req.body.color !== undefined) ev.color = req.body.color;
  ev.reminder = req.body.reminder !== undefined && req.body.reminder !== '' ? parseInt(req.body.reminder) : null;
  wd(F.calendar, cal);
  io.emit('calendar-updated');
  res.json({ success: true, event: ev });
});

app.delete('/api/calendar/:id', mainAuth, (req, res) => {
  const cal = rd(F.calendar);
  if (cal.shared) cal.shared = cal.shared.filter(e => e.id !== req.params.id);
  // Also clean up legacy per-user entries
  for (const key of ['kaliph', 'kathrine']) {
    if (cal[key]) cal[key] = cal[key].filter(e => e.id !== req.params.id);
  }
  wd(F.calendar, cal);
  io.emit('calendar-updated');
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
  res.json({ emails: s.emails, vaultPasscodeSet: !!s.vaultPasscode, bellSchedule: s.bellSchedule || null, preferences: s.preferences || {}, _scheduleSkips: s._scheduleSkips || {} });
});

app.get('/api/settings/email-status', mainAuth, async (_, res) => {
  const configured = !!(EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY);
  const canConnect = configured; // EmailJS uses HTTPS, always reachable
  const s = rd(F.settings);
  const hasRecipients = !!(
    (s.emails?.kaliph && (Array.isArray(s.emails.kaliph) ? s.emails.kaliph.filter(e => e).length : s.emails.kaliph)) ||
    (s.emails?.kathrine && (Array.isArray(s.emails.kathrine) ? s.emails.kathrine.filter(e => e).length : s.emails.kathrine)) ||
    s.emails?.shared
  );
  res.json({ configured, canConnect, hasRecipients, provider: configured ? 'emailjs' : 'none' });
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
  if (req.body.vaultPasscode) s.vaultPasscode = await bcrypt.hash(req.body.vaultPasscode, 10);
  if (req.body.bellSchedule) s.bellSchedule = req.body.bellSchedule;
  if (typeof req.body.countdownEnabled === 'boolean') {
    if (!s.preferences) s.preferences = {};
    if (!s.preferences[req.session.user]) s.preferences[req.session.user] = {};
    s.preferences[req.session.user].countdownEnabled = req.body.countdownEnabled;
  }
  wd(F.settings, s);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/push/vapid-key', mainAuth, (_, res) => {
  res.json({ publicKey: VAPID_PUBLIC || null });
});

app.post('/api/push/subscribe', mainAuth, (req, res) => {
  const user = req.session.user;
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const subs = getPushSubs();
  if (!subs[user]) subs[user] = [];
  // Avoid duplicates
  if (!subs[user].find(s => s.endpoint === sub.endpoint)) {
    subs[user].push(sub);
    savePushSubs(subs);
  }
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', mainAuth, (req, res) => {
  const user = req.session.user;
  const endpoint = req.body.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'No endpoint' });
  const subs = getPushSubs();
  if (subs[user]) {
    subs[user] = subs[user].filter(s => s.endpoint !== endpoint);
    savePushSubs(subs);
  }
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/reminders', mainAuth, (req, res) => {
  const all = rd(F.reminders) || [];
  const user = req.session.user;
  res.json(all.filter(r => r.createdBy === user || r.forUser === 'both'));
});

app.post('/api/reminders', mainAuth, (req, res) => {
  const all = rd(F.reminders) || [];
  const reminder = {
    id: uuidv4(),
    title: req.body.title,
    description: req.body.description || '',
    datetime: req.body.datetime,
    repeat: req.body.repeat || '',
    notify: req.body.notify || { site: true, push: false, email: false },
    priority: req.body.priority || 'normal',
    completed: false,
    snoozedUntil: null,
    createdBy: req.session.user,
    forUser: req.body.forUser || req.session.user,
    createdAt: Date.now(),
    lastNotified: null,
  };
  all.push(reminder);
  wd(F.reminders, all);
  io.emit('reminder-updated');
  res.json({ success: true, reminder });
});

app.put('/api/reminders/:id', mainAuth, (req, res) => {
  const all = rd(F.reminders) || [];
  const idx = all.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  Object.assign(all[idx], req.body, { id: req.params.id });
  wd(F.reminders, all);
  io.emit('reminder-updated');
  res.json({ success: true, reminder: all[idx] });
});

app.delete('/api/reminders/:id', mainAuth, (req, res) => {
  let all = rd(F.reminders) || [];
  all = all.filter(r => r.id !== req.params.id);
  wd(F.reminders, all);
  io.emit('reminder-updated');
  res.json({ success: true });
});

// Check and fire due reminders (called by setInterval on server)
async function checkDueReminders() {
  const all = rd(F.reminders) || [];
  const siteNow = getSiteNow();
  const now = siteNow.getTime();
  let changed = false;

  for (const r of all) {
    if (r.completed) continue;
    if (r.snoozedUntil && now < new Date(r.snoozedUntil).getTime()) continue;
    const rTime = new Date(r.datetime).getTime();
    if (isNaN(rTime) || rTime > now) continue;
    // Already notified within the last 5 minutes? Skip
    if (r.lastNotified && now - r.lastNotified < 300000) continue;

    r.lastNotified = now;
    changed = true;

    const user = r.createdBy;

    // Push notification
    if (r.notify?.push) {
      await sendPushToUser(user, {
        title: '🔔 Reminder: ' + r.title,
        body: r.description || 'Your reminder is due!',
        tag: 'reminder-' + r.id,
        url: '/app',
      });
    }

    // Email notification
    if (r.notify?.email) {
      const s = rd(F.settings);
      const emailData = s.emails?.[user];
      let emails = Array.isArray(emailData) ? emailData.filter(e => e) : (emailData ? [emailData] : []);
      if (!emails.length && s.emails?.shared) emails = [s.emails.shared];
      for (const email of emails) {
        await sendMail(email, '🔔 Reminder: ' + r.title,
          `<h2 style="color:#7c3aed">🔔 ${r.title}</h2>` +
          (r.description ? `<p>${r.description}</p>` : '') +
          `<p style="color:#666;font-size:0.85rem">From Royal Kat &amp; Kai Vault</p>`
        );
      }
    }

    // Site notification via socket
    if (r.notify?.site) {
      io.emit('reminder-due', { id: r.id, title: r.title, description: r.description, user });
    }

    // Handle repeat
    if (r.repeat) {
      const d = new Date(r.datetime);
      if (r.repeat === 'daily') d.setDate(d.getDate() + 1);
      else if (r.repeat === 'weekly') d.setDate(d.getDate() + 7);
      else if (r.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
      r.datetime = d.toISOString();
      r.lastNotified = null;
    }
  }

  if (changed) wd(F.reminders, all);
}

// Check reminders every 30 seconds
setInterval(checkDueReminders, 30000);

// ═══════════════════════════════════════════════════════════════════════════════
// TOTP AUTHENTICATOR
// ═══════════════════════════════════════════════════════════════════════════════

// Encryption helpers for TOTP secrets — never stored as plain text
const TOTP_ENC_KEY = process.env.TOTP_ENC_KEY || 'RoyalKatKaiVaultTOTPKey2024!!@@';
function totpEncrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(TOTP_ENC_KEY, 'totp-salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
function totpDecrypt(data) {
  const [ivHex, enc] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(TOTP_ENC_KEY, 'totp-salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(enc, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// TOTP password per user (separate from site password)
app.post('/api/totp/auth', mainAuth, async (req, res) => {
  const user = req.session.user;
  const { password } = req.body;
  const users = rd(F.users);
  const u = users[user];
  if (!u?.totpPassword) return res.status(400).json({ error: 'No TOTP password set. Please set one first.' });
  const match = await bcrypt.compare(password, u.totpPassword);
  if (!match) return res.status(401).json({ error: 'Incorrect password' });
  req.session.totpUnlocked = true;
  res.json({ success: true });
});

app.post('/api/totp/set-password', mainAuth, async (req, res) => {
  const user = req.session.user;
  const { password, currentPassword } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const users = rd(F.users);
  // If password already set, require current password
  if (users[user]?.totpPassword) {
    if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
    const match = await bcrypt.compare(currentPassword, users[user].totpPassword);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
  }
  users[user].totpPassword = await bcrypt.hash(password, 10);
  wd(F.users, users);
  req.session.totpUnlocked = true;
  res.json({ success: true });
});

app.get('/api/totp/status', mainAuth, (req, res) => {
  const users = rd(F.users);
  const u = users[req.session.user];
  res.json({
    hasPassword: !!u?.totpPassword,
    unlocked: !!req.session.totpUnlocked,
    enabled: u?.totpEnabled !== false,
  });
});

// Guard: require TOTP session unlock
function totpAuth(req, res, next) {
  if (!req.session.totpUnlocked) return res.status(403).json({ error: 'TOTP locked' });
  next();
}

app.get('/api/totp/accounts', mainAuth, totpAuth, (req, res) => {
  const all = rd(F.totp) || { kaliph: [], kathrine: [] };
  const user = req.session.user;
  // Decrypt secrets before sending (they'll be used client-side for code generation)
  const accounts = (all[user] || []).map(a => ({
    ...a,
    secret: totpDecrypt(a.secret),
  }));
  res.json(accounts);
});

app.post('/api/totp/accounts', mainAuth, totpAuth, (req, res) => {
  const { name, secret, issuer } = req.body;
  if (!name || !secret) return res.status(400).json({ error: 'Name and secret are required' });
  // Validate secret is valid base32
  const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(cleanSecret)) return res.status(400).json({ error: 'Invalid TOTP secret (must be base32)' });
  const all = rd(F.totp) || { kaliph: [], kathrine: [] };
  const user = req.session.user;
  if (!all[user]) all[user] = [];
  const account = {
    id: uuidv4(),
    name,
    issuer: issuer || '',
    secret: totpEncrypt(cleanSecret),
    createdAt: Date.now(),
  };
  all[user].push(account);
  wd(F.totp, all);
  res.json({ success: true, account: { ...account, secret: cleanSecret } });
});

app.put('/api/totp/accounts/:id', mainAuth, totpAuth, (req, res) => {
  const all = rd(F.totp) || { kaliph: [], kathrine: [] };
  const user = req.session.user;
  const idx = (all[user] || []).findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Account not found' });
  if (req.body.name !== undefined) all[user][idx].name = req.body.name;
  if (req.body.issuer !== undefined) all[user][idx].issuer = req.body.issuer;
  wd(F.totp, all);
  res.json({ success: true, account: { ...all[user][idx], secret: totpDecrypt(all[user][idx].secret) } });
});

app.delete('/api/totp/accounts/:id', mainAuth, totpAuth, (req, res) => {
  const all = rd(F.totp) || { kaliph: [], kathrine: [] };
  const user = req.session.user;
  all[user] = (all[user] || []).filter(a => a.id !== req.params.id);
  wd(F.totp, all);
  res.json({ success: true });
});

app.post('/api/totp/lock', mainAuth, (req, res) => {
  req.session.totpUnlocked = false;
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
  const { name, password, expiresIn, expiresAt, channels } = req.body;
  const id = uuidv4();
  const allowedChannels = Array.isArray(channels) && channels.length ? channels : ['kaliph', 'kathrine', 'group'];
  let expiry = null;
  if (expiresAt) { expiry = expiresAt; }
  else if (expiresIn) { expiry = new Date(Date.now() + parseInt(expiresIn) * 3600000).toISOString(); }
  guests[id] = {
    id, name, passwordHash: await bcrypt.hash(password, 10),
    createdBy: req.session.user, createdAt: Date.now(),
    expiresAt: expiry,
    active: true, channels: allowedChannels,
    messages: { kaliph: [], kathrine: [], group: [] },
  };
  wd(F.guests, guests);
  io.emit('guest-created', { guestId: id, name });
  res.json({ success: true, guestId: id, name });
});

// Update guest name and/or channel permissions
app.put('/api/guests/:id', mainAuth, (req, res) => {
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  const { name, channels, password } = req.body;
  if (name) g.name = name;
  if (Array.isArray(channels) && channels.length) g.channels = channels;
  if (password) g.passwordHash = require('bcryptjs').hashSync(password, 10);
  wd(F.guests, guests);
  io.emit('guest-updated', { guestId: req.params.id, name: g.name, channels: g.channels });
  res.json({ success: true });
});

// Guest avatar upload (authenticated as guest)
app.post('/api/guests/:id/avatar', auth, upload.single('avatar'), (req, res) => {
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });
  g.avatar = `/uploads/${req.file.filename}`;
  wd(F.guests, guests);
  res.json({ success: true, avatar: g.avatar });
});

app.delete('/api/guests/:id/avatar', mainAuth, (req, res) => {
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  g.avatar = null;
  wd(F.guests, guests);
  res.json({ success: true });
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
  res.json({ id: g.id, name: g.name, messages: g.messages, active: g.active, channels: g.channels || ['kaliph','kathrine','group'], createdBy: g.createdBy, avatar: g.avatar || null });
});

// Get all guest messages for the current main user
app.get('/api/guest-messages', mainAuth, (req, res) => {
  const guests = rd(F.guests) || {};
  const user = req.session.user;
  const result = [];
  Object.values(guests).forEach(g => {
    if (!g.active) return;
    const channels = { group: g.messages?.group || [], [user]: g.messages?.[user] || [] };
    result.push({ id: g.id, name: g.name, avatar: g.avatar || null, channels });
  });
  res.json(result);
});

// Guest message reactions
app.post('/api/guests/:guestId/messages/:msgId/react', auth, (req, res) => {
  const { emoji, sender } = req.body;
  const guests = rd(F.guests) || {};
  const g = guests[req.params.guestId];
  if (!g) return res.status(404).json({ error: 'Not found' });
  let found = false;
  const user = req.session.user || sender || 'guest';
  for (const ch of Object.keys(g.messages || {})) {
    const msg = (g.messages[ch] || []).find(m => m.id === req.params.msgId);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const idx = msg.reactions[emoji].indexOf(user);
      if (idx === -1) msg.reactions[emoji].push(user);
      else msg.reactions[emoji].splice(idx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      wd(F.guests, guests);
      io.emit(`guest-msg-reaction-${req.params.guestId}`, { msgId: req.params.msgId, reactions: msg.reactions });
      found = true;
      break;
    }
  }
  res.json({ success: found });
});

// Guest file upload
app.post('/api/guests/:id/upload', upload.array('files', 10), (req, res) => {
  const xGuestId = req.headers['x-guest-id'];
  if (!xGuestId && !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const files = (req.files || []).map(f => ({
    url: `/uploads/${f.filename}`, type: f.mimetype, name: f.originalname, size: f.size
  }));
  res.json({ success: true, files });
});

// GIF search for guests
app.get('/api/guest-gif-search', (req, res) => {
  // Proxy to the existing GIF search logic
  const { q, limit } = req.query;
  fetch(`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${process.env.TENOR_KEY || 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ'}&limit=${limit || 20}&media_filter=gif`)
    .then(r => r.json()).then(data => res.json(data)).catch(() => res.json({ results: [] }));
});

app.post('/api/guests/:id/message', upload.array('files', 10), (req, res) => {
  // Use X-Guest-Id header (sent only by guest.html) to identify guest senders.
  // This avoids session cross-contamination when a main-user tab and a guest tab
  // are open in the same browser simultaneously (they share the same session cookie).
  const xGuestId = req.headers['x-guest-id'];
  const isGuestRequest = !!(xGuestId && xGuestId === req.params.id);
  if (!isGuestRequest && !req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  const { text, target, sender: clientSender, type, gifUrl, priority, replyTo } = req.body;
  // Validate channel access for guests
  if (isGuestRequest) {
    const allowed = g.channels || ['kaliph','kathrine','group'];
    if (!allowed.includes(target)) return res.status(403).json({ error: 'No access to this channel' });
  }
  // Guest portal sends X-Guest-Id header → use client-sent name (supports renames);
  // Main users never send that header → always use their authenticated profile name.
  const sender = isGuestRequest ? (clientSender || g.name) : req.session.user;
  const msg = { id: uuidv4(), sender, text: text || '', timestamp: Date.now(), replyTo: replyTo || null };
  // Handle different message types
  if (type === 'gif' && gifUrl) { msg.type = 'gif'; msg.gifUrl = gifUrl; }
  if (type === 'voice' && req.files?.length) {
    msg.type = 'voice';
    msg.voiceUrl = `/uploads/${req.files[0].filename}`;
  }
  if (req.files?.length && type !== 'voice') {
    msg.files = req.files.map(f => ({ url: `/uploads/${f.filename}`, type: f.mimetype, name: f.originalname, size: f.size }));
  }
  if (priority === 'true') msg.priority = true;
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
  if (req.body.code !== getBackdoorCode()) {
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

    // Wipe data files and SQL messages table
    for (const file of Object.values(F)) { if (fs.existsSync(file)) fs.removeSync(file); }
    if (db.pool) { try { await db.clearMessages(); } catch {} }
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
  if (req.body.code !== getBackdoorCode()) {
    return res.status(403).json({ error: 'Invalid code' });
  }
  try {
    let msgCount = 0;
    if (db.pool) {
      const r = await db.query('SELECT COUNT(*) FROM messages');
      msgCount = parseInt(r.rows[0].count);
      await db.clearMessages();
    } else {
      const messages = rd(F.messages) || [];
      msgCount = messages.length;
      wd(F.messages, []);
    }
    io.emit('messages-cleared');
    res.json({ success: true, message: `${msgCount} messages erased.`, count: msgCount });
  } catch (e) {
    console.error('Erase messages error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BACKDOOR IMPORT / RESTORE
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/backdoor/import', express.json({ limit: '50mb' }), async (req, res) => {
  if (req.body.code !== getBackdoorCode()) return res.status(403).json({ error: 'Invalid code' });

  let backup;
  try {
    backup = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
    if (typeof backup !== 'object' || backup === null) throw new Error('Not an object');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON backup data' });
  }

  const mode = req.body.mode === 'replace' ? 'replace' : 'merge';
  const report = {};

  function mergeArr(current, incoming) {
    if (!Array.isArray(incoming)) return Array.isArray(current) ? current : [];
    const ids = new Set((current || []).map(i => i.id).filter(Boolean));
    return [...(current || []), ...incoming.filter(i => i.id && !ids.has(i.id))];
  }

  // ── Handle messages table separately ──────────────────────────────────────
  if (backup.messages !== undefined && db.pool) {
    const incomingMsgs = backup.messages?.main || (Array.isArray(backup.messages) ? backup.messages : []);
    if (mode === 'replace') {
      await db.clearMessages();
    }
    let imported = 0;
    for (const msg of incomingMsgs) {
      try { await db.insertMessage(msg); imported++; } catch {}
    }
    report.messages = mode === 'replace' ? `replaced (${imported} rows)` : `merged (${imported} rows, duplicates skipped)`;
  } else if (backup.messages !== undefined && !db.pool) {
    // Legacy JSON path for messages
    if (mode === 'replace') {
      wd(F.messages, backup.messages);
      report.messages = 'replaced';
    } else {
      const current = rd(F.messages);
      const merged = { main: mergeArr(current?.main, backup.messages?.main), brainstorm: mergeArr(current?.brainstorm, backup.messages?.brainstorm) };
      wd(F.messages, merged);
      report.messages = 'merged';
    }
  }

  const fileMap = [
    ['users',         F.users],
    ['notes',         F.notes],
    ['contacts',      F.contacts],
    ['vault',         F.vault],
    ['calendar',      F.calendar],
    ['guests',        F.guests],
    ['announcements', F.announcements],
    ['suggestions',   F.suggestions],
    ['reminders',     F.reminders],
    ['pushSubs',      F.pushSubs],
  ];

  for (const [key, filePath] of fileMap) {
    const incoming = backup[key];
    if (incoming === undefined) continue;

    if (mode === 'replace') {
      wd(filePath, incoming);
      report[key] = 'replaced';
    } else {
      const current = rd(filePath);
      let merged;
      if (key === 'notes' || key === 'vault') {
        merged = { ...(current || {}) };
        for (const u of ['kaliph', 'kathrine']) merged[u] = mergeArr(merged[u], incoming?.[u]);
      } else if (key === 'calendar') {
        merged = { ...(current || {}) };
        for (const k of ['kaliph', 'kathrine', 'shared']) merged[k] = mergeArr(merged[k], incoming?.[k]);
      } else if (key === 'users') {
        merged = { ...(current || {}) };
        for (const [user, data] of Object.entries(incoming || {})) {
          if (!merged[user]) { merged[user] = data; }
          else { for (const [f, v] of Object.entries(data)) { if (merged[user][f] == null) merged[user][f] = v; } }
        }
      } else if (key === 'guests') {
        merged = { ...(current || {}) };
        for (const [id, g] of Object.entries(incoming || {})) { if (!merged[id]) merged[id] = g; }
      } else if (key === 'pushSubs') {
        merged = { ...(current || {}) };
        for (const [user, subs] of Object.entries(incoming || {})) {
          if (!merged[user]) merged[user] = [];
          const eps = new Set(merged[user].map(s => s.endpoint));
          for (const s of subs || []) { if (!eps.has(s.endpoint)) merged[user].push(s); }
        }
      } else if (Array.isArray(incoming)) {
        merged = mergeArr(current, incoming);
      } else {
        merged = incoming;
      }
      wd(filePath, merged);
      report[key] = 'merged';
    }
  }

  // Settings only in replace mode (risky to merge)
  if (backup.settings && mode === 'replace') {
    wd(F.settings, backup.settings);
    report.settings = 'replaced';
  }

  io.emit('force-reload');
  res.json({ success: true, mode, report });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVAL TERMINAL (Admin)
// ═══════════════════════════════════════════════════════════════════════════════

function getEvalPassword() {
  const s = rd(F.settings);
  return (s && s.evalPassword) || 'Admin';
}

function getBackdoorCode() {
  const s = rd(F.settings);
  return (s && s.backdoorCode) || 'Admin';
}

// Migration-safe passcode check: supports legacy plaintext and bcrypt hashes.
// If a plaintext match is found, caller is responsible for rehashing and saving.
async function checkPasscode(input, stored) {
  if (!stored) return true;
  if (!input) return false;
  if (stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    return bcrypt.compare(input, stored);
  }
  return input === stored;
}

async function checkVaultPasscode(input, stored) {
  const effective = stored || '0000';
  if (effective.startsWith('$2b$') || effective.startsWith('$2a$')) {
    return bcrypt.compare(input, effective);
  }
  return input === effective;
}

let maintenanceMode = false;
const evalTokens = new Set();

app.post('/api/eval/auth', (req, res) => {
  if (req.body.password !== getEvalPassword()) return res.status(403).json({ error: 'Invalid password' });
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

    if (!sub) {
      if (db.pool) {
        const total = (await db.query('SELECT COUNT(*) FROM messages')).rows[0].count;
        const kCount = (await db.query("SELECT COUNT(*) FROM messages WHERE sender='kaliph'")).rows[0].count;
        const keCount = (await db.query("SELECT COUNT(*) FROM messages WHERE sender='kathrine'")).rows[0].count;
        const aiCount = (await db.query("SELECT COUNT(*) FROM messages WHERE sender='ai'")).rows[0].count;
        const pCount = (await db.query('SELECT COUNT(*) FROM messages WHERE priority=true')).rows[0].count;
        const fCount = (await db.query("SELECT COUNT(*) FROM messages WHERE files != '[]'")).rows[0].count;
        return multi(
          [`Total messages: ${total}`, 'success'],
          [`  Kaliph: ${kCount}  |  Kathrine: ${keCount}  |  AI: ${aiCount}`, 'data'],
          [`  Priority: ${pCount}  |  With files: ${fCount}`, 'data'],
        );
      }
      const main = rd(F.messages)?.main || [];
      return multi(
        [`Total messages: ${main.length}`, 'success'],
        [`  Kaliph: ${main.filter(m => m.sender === 'kaliph').length}  |  Kathrine: ${main.filter(m => m.sender === 'kathrine').length}  |  AI: ${main.filter(m => m.sender === 'ai').length}`, 'data'],
        [`  Priority: ${main.filter(m => m.priority).length}  |  With files: ${main.filter(m => m.files?.length).length}`, 'data'],
      );
    }
    if (sub === 'list') {
      const count = parseInt(parts[2]) || 20;
      if (db.pool) {
        const slice = await db.getMessages({ limit: count });
        return { messages: slice };
      }
      return { messages: (rd(F.messages)?.main || []).slice(-count) };
    }
    if (sub === 'from') {
      const user = parts[2]?.toLowerCase();
      if (!user) return lines('Usage: messages from <user>', 'warn');
      if (db.pool) {
        const filtered = await db.getMessages({ limit: 30, sender: user });
        return { lines: [{ text: `${filtered.length} messages from ${user} (last 30)`, cls: 'success' }], messages: filtered };
      }
      const filtered = (rd(F.messages)?.main || []).filter(m => m.sender === user);
      return { lines: [{ text: `${filtered.length} messages from ${user}`, cls: 'success' }], messages: filtered.slice(-30) };
    }
    if (sub === 'search') {
      const searchQ = parts.slice(2).join(' ');
      if (!searchQ) return lines('Usage: messages search <text>', 'warn');
      if (db.pool) {
        const found = await db.getMessages({ limit: 30, search: searchQ });
        return { lines: [{ text: `${found.length} messages matching "${searchQ}" (last 30)`, cls: 'success' }], messages: found };
      }
      const found = (rd(F.messages)?.main || []).filter(m => m.text?.toLowerCase().includes(searchQ.toLowerCase()));
      return { lines: [{ text: `${found.length} messages matching "${searchQ}"`, cls: 'success' }], messages: found.slice(-30) };
    }
  }

  // ── DELETE MESSAGE (bypass time limit) ──
  if (cmd === 'delete' && parts[1]?.toLowerCase() === 'msg') {
    const id = parts[2];
    if (!id) return lines('Usage: delete msg <id>', 'warn');
    if (db.pool) {
      const msg = await db.getMessageById(id);
      if (!msg) return lines('Message not found', 'error');
      await db.deleteMessage(id);
      io.emit('msg-unsent', id);
      return lines(`Deleted message from ${msg.sender}: "${(msg.text || '').substring(0, 60)}"`, 'success');
    }
    const msgs = rd(F.messages);
    const i = (msgs.main || []).findIndex(m => m.id === id);
    if (i === -1) return lines('Message not found', 'error');
    const removed = msgs.main.splice(i, 1)[0];
    wd(F.messages, msgs);
    io.emit('msg-unsent', id);
    return lines(`Deleted message from ${removed.sender}: "${(removed.text || '').substring(0, 60)}"`, 'success');
  }

  // ── UNSEND (allow user to unsend — bypasses time limit) ──
  if (cmd === 'unsend') {
    const id = parts[1];
    if (!id) return lines('Usage: unsend <message-id>', 'warn');
    if (db.pool) {
      const msg = await db.getMessageById(id);
      if (!msg) {
        // Try prefix match via query
        const r = await db.query('SELECT * FROM messages WHERE id LIKE $1 LIMIT 1', [id + '%']);
        if (!r.rows.length) return lines('Message not found', 'error');
        const found = db.rowToMsg ? db.rowToMsg(r.rows[0]) : r.rows[0];
        await db.updateMessage(found.id, { unsendable: true });
        io.emit('msg-unsend-allowed', { id: found.id });
        return lines(`Marked message from ${found.sender} as unsendable: "${(found.text || found.content || '').substring(0, 60)}"`, 'success');
      }
      await db.updateMessage(msg.id, { unsendable: true });
      io.emit('msg-unsend-allowed', { id: msg.id });
      return lines(`Marked message from ${msg.sender} as unsendable (bypasses time limit): "${(msg.text || '').substring(0, 60)}"`, 'success');
    }
    const msgs = rd(F.messages);
    const i = (msgs.main || []).findIndex(m => m.id === id || m.id.startsWith(id));
    if (i === -1) return lines('Message not found', 'error');
    msgs.main[i].unsendable = true;
    wd(F.messages, msgs);
    io.emit('msg-unsend-allowed', { id: msgs.main[i].id });
    return lines(`Marked message from ${msgs.main[i].sender} as unsendable (bypasses time limit): "${(msgs.main[i].text || '').substring(0, 60)}"`, 'success');
  }

  // ── EDIT MODE ──
  if (raw.toLowerCase() === 'edit mode') {
    let main;
    if (db.pool) {
      main = await db.getMessages({ limit: 50 });
    } else {
      main = (rd(F.messages)?.main || []).slice(-50);
    }
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
    const msg = {
      id: uuidv4(), sender: 'system', type: 'text', text,
      files: [], priority: false, replyTo: null,
      timestamp: Date.now(), edited: false, editedAt: null,
      reactions: {}, read: false, readAt: null, unsendable: false,
      aiGenerated: false, systemMessage: true,
    };
    if (db.pool) {
      await db.insertMessage(msg);
    } else {
      const msgs = rd(F.messages);
      if (!Array.isArray(msgs.main)) msgs.main = [];
      msgs.main.push(msg);
      wd(F.messages, msgs);
    }
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
      const valid = ['kaliph', 'kathrine', 'royal', 'dark', 'light', 'neon', 'noir', 'rosewood', 'ocean', 'forest'];
      if (!valid.includes(theme)) return lines(`Invalid theme. Options: ${valid.join(', ')}`, 'error');
      const users = rd(F.users);
      if (!users[user]) return lines(`User "${user}" not found`, 'error');
      users[user].theme = theme;
      wd(F.users, users);
      io.emit('user-updated', { user, data: users[user] });
      io.emit('force-reload');
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
      const s = rd(F.settings);
      s.evalPassword = pw;
      wd(F.settings, s);
      return lines(`Eval password changed`, 'success');
    }

    if (prop === 'backdoor-code') {
      const code = parts.slice(2).join(' ');
      if (!code) return lines('Usage: set backdoor-code <new code>', 'warn');
      const s = rd(F.settings);
      s.backdoorCode = code;
      wd(F.settings, s);
      return lines(`Backdoor code changed`, 'success');
    }

    if (prop === 'vault-code') {
      const code = parts[2];
      if (!code) return lines('Usage: set vault-code <code>', 'warn');
      const s = rd(F.settings);
      s.vaultPasscode = await bcrypt.hash(code, 10);
      wd(F.settings, s);
      return lines(`Locker passcode updated`, 'success');
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
    return lines('Preview command has been removed', 'warn');
  }

  // ── RESET PROFILE PASSWORD ──
  if (cmd === 'reset' && parts[1] === 'password') {
    const user = parts[2]?.toLowerCase();
    if (!user || !['kaliph', 'kathrine'].includes(user)) {
      return lines('Usage: reset password <kaliph|kathrine>', 'warn');
    }
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    const old = users[user].profilePasscode || '(none set)';
    users[user].mustResetPasscode = true;
    users[user].oldPasscodeHint = users[user].profilePasscode || '';
    wd(F.users, users);
    return {
      lines: [
        { text: '🔑 Profile Password Reset Queued', cls: 'success' },
        { text: `User: ${user.charAt(0).toUpperCase() + user.slice(1)}`, cls: 'info' },
        { text: `Old passcode: ${old}`, cls: 'warn' },
        { text: `Next login: ${user} will see their old password and must set a new one before entering.`, cls: 'dim' },
      ],
    };
  }

  // ── THEME BUILDER ──
  if (cmd === 'theme' && parts[1] === 'builder') {
    // Fetch current custom themes for both users
    const users = rd(F.users);
    const themeData = {};
    for (const u of Object.keys(users)) {
      themeData[u] = users[u].customTheme || {};
    }
    return {
      openThemeBuilder: true,
      themeData,
      lines: [
        { text: 'Opening Theme Builder UI...', cls: 'success' },
      ],
    };
  }
  if (cmd === 'theme' && parts[1] === 'set') {
    const user = parts[2]?.toLowerCase();
    const prop = parts[3];
    const val = parts.slice(4).join(' ');
    if (!user || !prop || !val) return lines('Usage: theme set <user> <property> <value>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    if (!users[user].customTheme) users[user].customTheme = {};
    users[user].customTheme[prop] = val;
    wd(F.users, users);
    io.emit('force-reload');
    return lines(`Set ${prop} = ${val} for ${user}`, 'success');
  }
  if (cmd === 'theme' && parts[1] === 'preview') {
    const user = parts[2]?.toLowerCase();
    if (!user) return lines('Usage: theme preview <user>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    const ct = users[user].customTheme || {};
    if (!Object.keys(ct).length) return lines(`No custom theme set for ${user}`, 'info');
    return {
      lines: [
        { text: `Custom theme for ${user}:`, cls: 'header' },
        ...Object.entries(ct).map(([k, v]) => ({ text: `  ${k}: ${v}`, cls: 'data' })),
      ],
    };
  }
  if (cmd === 'theme' && parts[1] === 'reset') {
    const user = parts[2]?.toLowerCase();
    if (!user) return lines('Usage: theme reset <user>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    delete users[user].customTheme;
    wd(F.users, users);
    io.emit('force-reload');
    return lines(`Custom theme reset for ${user}`, 'success');
  }

  // ── TIME SET/RESET ──
  if (cmd === 'time') {
    if (parts[1] === 'set') {
      const offset = parts.slice(2).join(' ');
      if (!offset) return lines('Usage: time set <ISO date or offset like +2h, -30m>', 'warn');
      const s = rd(F.settings);
      s.timeOffset = offset;
      wd(F.settings, s);
      io.emit('time-offset', { offset });
      return lines(`Time offset set to: ${offset}`, 'success');
    }
    if (parts[1] === 'reset') {
      const s = rd(F.settings);
      delete s.timeOffset;
      wd(F.settings, s);
      io.emit('time-offset', { offset: null });
      return lines('Time reset to normal', 'success');
    }
    return lines('Usage: time set <offset> | time reset', 'info');
  }

  // ── STEALTH VISUAL MODE (opens app in stealth preview) ──
  if (cmd === 'stealth') {
    const user = parts[1]?.toLowerCase();
    if (!user) return lines('Usage: stealth <user> — opens the app in visual stealth mode', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    return {
      lines: [
        { text: `Opening visual stealth preview as ${users[user].displayName || user}...`, cls: 'highlight' },
        { text: `The app will open in a new tab with the stealth banner.`, cls: 'dim' },
      ],
      openUrl: `/app?stealth=${user}`,
    };
  }

  // ── SKIP SCHEDULE (abandon bell schedule for today) ──
  if (cmd === 'skipclass' || cmd === 'skipschedule') {
    const user = parts[1]?.toLowerCase();
    if (!user) return lines('Usage: skipclass <user> — skip bell schedule for today', 'warn');
    const s = rd(F.settings);
    if (!s.bellSchedule || !s.bellSchedule[user]) return lines(`No bell schedule found for "${user}"`, 'error');
    if (!s._scheduleSkips) s._scheduleSkips = {};
    const today = getSiteNow().toISOString().split('T')[0];
    s._scheduleSkips[user] = today;
    wd(F.settings, s);
    io.emit('schedule-skip', { user, date: today });
    return lines(`Schedule skipped for ${user} today (${today}). Will resume tomorrow.`, 'success');
  }

  if (cmd === 'unskipclass' || cmd === 'unskipschedule') {
    const user = parts[1]?.toLowerCase();
    if (!user) return lines('Usage: unskipclass <user> — restore bell schedule for today', 'warn');
    const s = rd(F.settings);
    if (s._scheduleSkips) { delete s._scheduleSkips[user]; wd(F.settings, s); }
    io.emit('schedule-skip', { user, date: null });
    return lines(`Schedule restored for ${user}.`, 'success');
  }

  // ── SET TIME (override site time for testing) ──
  if (cmd === 'settime') {
    const timeStr = parts.slice(1).join(' ');
    if (!timeStr) {
      // Clear override
      io.emit('time-override', { time: null });
      return lines('Time override cleared — using real time.', 'success');
    }
    const parsed = new Date(timeStr);
    if (isNaN(parsed.getTime())) return lines(`Invalid date/time: "${timeStr}". Use format like "2026-03-15 14:30" or "Mar 15, 2026 2:30 PM"`, 'error');
    io.emit('time-override', { time: parsed.toISOString() });
    return lines(`Time override set to: ${parsed.toLocaleString()}. Use "settime" with no args to clear.`, 'success');
  }

  // ── BROWSE MODE (stealth read-only profile access) ──
  if (cmd === 'browse') {
    const user = parts[1]?.toLowerCase();
    if (!user) return lines('Usage: browse <user> — stealth read-only profile access', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    const u = users[user];
    const presence = onlineUsers[user]?.state || 'offline';
    return {
      setMode: 'browse', modeInfo: `Browsing ${u.displayName || user} (stealth read-only) — type "exit" to leave`,
      previewUser: user,
      lines: [
        { text: `🔍 Stealth browse: ${u.displayName || user}`, cls: 'highlight' },
        { text: `  Status: ${presence} | LastSeen: ${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'never'}`, cls: 'data' },
        { text: `  Theme: ${u.theme || 'default'} | Bio: ${u.bio || '(none)'}`, cls: 'data' },
        { text: ``, cls: 'dim' },
        { text: `Commands: messages [n], notes, locker, contacts, calendar, status, profile`, cls: 'dim' },
        { text: `Read-only — no presence/read changes. Type "exit" to leave.`, cls: 'dim' },
      ],
    };
  }

  // ── BROWSE MODE COMMANDS ──
  if (mode === 'browse' && previewUser) {
    const browseUser = previewUser;

    if (cmd === 'messages') {
      const count = parseInt(parts[1]) || 20;
      const userMsgs = db.pool
        ? await db.getMessages({ limit: count, sender: browseUser })
        : (rd(F.messages)?.main || []).filter(m => m.sender === browseUser).slice(-count);
      if (!userMsgs.length) return lines(`No messages from ${browseUser}`, 'dim');
      const out = [{ text: `── Last ${userMsgs.length} messages from ${browseUser} ──`, cls: 'header' }];
      userMsgs.forEach(m => {
        const time = new Date(m.timestamp).toLocaleString();
        const text = (m.text || '(media)').substring(0, 100);
        const flags = [];
        if (m.edited) flags.push('edited');
        if (m.unsendable) flags.push('unsendable');
        if (m.read) flags.push('read');
        if (m.priority) flags.push('priority');
        out.push({ text: `  [${time}] ${text}${flags.length ? ' (' + flags.join(', ') + ')' : ''}`, cls: 'data' });
        out.push({ text: `    id: ${m.id}`, cls: 'dim' });
      });
      return { lines: out };
    }

    if (cmd === 'notes') {
      const notes = rd(F.notes) || {};
      const userNotes = notes[browseUser] || [];
      if (!userNotes.length) return lines(`No notes for ${browseUser}`, 'dim');
      const out = [{ text: `── ${browseUser}'s Notes (${userNotes.length}) ──`, cls: 'header' }];
      userNotes.forEach(n => {
        out.push({ text: `  ${n.title || '(untitled)'} — ${(n.content || '').substring(0, 80)}`, cls: 'data' });
        out.push({ text: `    id: ${n.id} | ${new Date(n.updatedAt || n.createdAt).toLocaleString()}`, cls: 'dim' });
      });
      return { lines: out };
    }

    if (cmd === 'vault') {
      const vault = rd(F.vault) || {};
      const userVault = vault[browseUser] || [];
      if (!userVault.length) return lines(`No locker items for ${browseUser}`, 'dim');
      const out = [{ text: `── ${browseUser}'s Locker (${userVault.length}) ──`, cls: 'header' }];
      userVault.forEach(v => {
        out.push({ text: `  ${v.type || 'file'}: ${v.name || v.filename || '(unnamed)'}`, cls: 'data' });
        out.push({ text: `    id: ${v.id} | ${new Date(v.uploadedAt || v.createdAt).toLocaleString()}`, cls: 'dim' });
      });
      return { lines: out };
    }

    if (cmd === 'contacts') {
      const contacts = rd(F.contacts) || {};
      const userContacts = contacts[browseUser] || [];
      if (!userContacts.length) return lines(`No contacts for ${browseUser}`, 'dim');
      const out = [{ text: `── ${browseUser}'s Contacts (${userContacts.length}) ──`, cls: 'header' }];
      userContacts.forEach(c => {
        out.push({ text: `  ${c.name} — ${c.phone || ''} ${c.email || ''}`, cls: 'data' });
      });
      return { lines: out };
    }

    if (cmd === 'calendar') {
      const cal = rd(F.calendar) || {};
      const sharedEvents = (cal.shared || []).filter(e => e.createdBy === browseUser);
      const out = [{ text: `── Events created by ${browseUser} (${sharedEvents.length}) ──`, cls: 'header' }];
      sharedEvents.forEach(e => {
        const dateStr = e.start && e.end && e.start !== e.end ? `${e.start} → ${e.end}` : (e.date || e.start || '?');
        out.push({ text: `  ${e.title} — ${dateStr}`, cls: 'data' });
        out.push({ text: `    id: ${e.id}`, cls: 'dim' });
      });
      return { lines: out };
    }

    if (cmd === 'status') {
      const users = rd(F.users);
      const u = users[browseUser];
      const presence = onlineUsers[browseUser]?.state || 'offline';
      let unread = 0;
      if (db.pool) {
        const r = await db.query('SELECT COUNT(*) FROM messages WHERE sender != $1 AND is_read = false', [browseUser]);
        unread = parseInt(r.rows[0].count);
      } else {
        unread = (rd(F.messages)?.main || []).filter(m => m.sender !== browseUser && !m.read).length;
      }
      return multi(
        [`── ${u.displayName || browseUser} Status ──`, 'header'],
        [`  Presence:  ${presence}`, 'data'],
        [`  LastSeen:  ${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'never'}`, 'data'],
        [`  Unread:    ${unread} messages`, 'data'],
        [`  Theme:     ${u.theme || 'default'}`, 'data'],
        [`  Bio:       ${u.bio || '(none)'}`, 'data'],
      );
    }

    if (cmd === 'profile') {
      const users = rd(F.users);
      const u = users[browseUser];
      if (!u) return lines('User data not found', 'error');
      return multi(
        [`── ${u.displayName || browseUser} Profile ──`, 'header'],
        [`  Display:   ${u.displayName || browseUser}`, 'data'],
        [`  Bio:       ${u.bio || '(none)'}`, 'data'],
        [`  Theme:     ${u.theme || 'default'}`, 'data'],
        [`  Avatar:    ${u.avatar ? 'set' : 'none'}`, 'data'],
        [`  Banner:    ${u.banner ? 'set' : 'none'}`, 'data'],
        [`  Email:     ${u.email || '(none)'}`, 'data'],
        [`  NameColor: ${u.nameStyle?.color || 'default'}`, 'data'],
        [`  Passcode:  ${u.profilePasscode ? 'set' : 'none'}`, 'data'],
      );
    }

    // Unknown browse command
    return multi(
      ['Unknown browse command', 'warn'],
      ['Available: messages [n], notes, vault, contacts, calendar, status, profile', 'dim'],
    );
  }

  // ── MIGRATE ──
  if (cmd === 'migrate') {
    const sub = parts[1]?.toLowerCase();

    if (sub === 'status') {
      if (!db.pool) return lines('No DATABASE_URL configured — Postgres not connected.', 'error');
      try {
        await db.createSchema();
        const r = await db.query('SELECT key, LENGTH(value) as bytes FROM data_store ORDER BY key');
        if (!r.rows.length) return lines('data_store is empty. Run "migrate run" to populate it.', 'warn');
        return {
          lines: [{ text: `Postgres data_store (${r.rows.length} keys)`, cls: 'success' }],
          table: {
            headers: ['Key', 'Size'],
            rows: r.rows.map(row => [row.key, `${Math.round(row.bytes / 1024)} KB`]),
          },
        };
      } catch (e) {
        return lines(`DB error: ${e.message}`, 'error');
      }
    }

    if (sub === 'run') {
      if (!db.pool) return lines('No DATABASE_URL configured — add it in Railway first.', 'error');
      try {
        await db.createSchema();
        const migrated = [];
        const skipped = [];
        for (const [key, file] of Object.entries(F)) {
          const data = rd(file);
          if (data === null) { skipped.push(key); continue; }
          await db.write(key, data);
          dataCache[key] = data;
          migrated.push(key);
        }
        const out = [
          { text: '✓ Schema created', cls: 'success' },
          { text: `✓ Migrated: ${migrated.join(', ')}`, cls: 'success' },
        ];
        if (skipped.length) out.push({ text: `  Skipped (no file): ${skipped.join(', ')}`, cls: 'dim' });
        out.push({ text: 'Migration complete. JSON files kept as backup on volume.', cls: 'success' });
        return { lines: out };
      } catch (e) {
        return lines(`Migration error: ${e.message}`, 'error');
      }
    }

    return lines('Usage: migrate run | migrate status', 'warn');
  }

  // ── SETTINGS ──
  if (cmd === 'settings') {
    const s = rd(F.settings);
    return multi(
      ['── Settings ──', 'header'],
      [`  Site password:  (hashed)`, 'data'],
      [`  Locker passcode: ${s.vaultPasscode || '(not set)'}`, 'data'],
      [`  Eval password:  ${getEvalPassword()}`, 'data'],
      [`  Emails:`, 'data'],
      [`    Kaliph:   ${JSON.stringify(s.emails?.kaliph || '(none)')}`, 'dim'],
      [`    Kathrine: ${JSON.stringify(s.emails?.kathrine || '(none)')}`, 'dim'],
      [`    Shared:   ${s.emails?.shared || '(none)'}`, 'dim'],
      [`  Wallpaper: ${s.chatWallpaper ? 'set' : 'none'}`, 'data'],
    );
  }

  // ── STATS ──
  if (cmd === 'stats') {
    const notes = rd(F.notes);
    const contacts = rd(F.contacts);
    const calendar = rd(F.calendar);
    const vault = rd(F.vault);
    const guests = rd(F.guests);
    const anns = rd(F.announcements);
    const sugs = rd(F.suggestions);
    let msgCount = 0;
    if (db.pool) {
      const r = await db.query('SELECT COUNT(*) FROM messages');
      msgCount = parseInt(r.rows[0].count);
    } else {
      msgCount = (rd(F.messages)?.main || []).length;
    }
    const bsCount = (rd(F.messages)?.brainstorm || []).length;
    return multi(
      ['── Site Statistics ──', 'header'],
      [`  Messages:      ${msgCount}`, 'data'],
      [`  Brainstorm:    ${bsCount}`, 'data'],
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
    const cal = rd(F.calendar) || {};
    const events = cal.shared || [];
    if (!events.length) return lines('No calendar events', 'dim');
    const rows = events.map(e => [
      e.id?.substring(0, 8) || '-',
      (e.title || '').substring(0, 30),
      e.date || e.start || '-',
      e.createdBy || '-',
    ]);
    return { table: { headers: ['ID', 'Title', 'Date', 'Created By'], rows } };
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
    if (!rows.length) return lines('No locker items', 'dim');
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
    if (sub === 'archive' || sub === 'threads') {
      const entries = Object.entries(guests);
      if (!entries.length) return lines('No guests', 'dim');
      const out = [{ text: `── Guest Message Archive (${entries.length} guests) ──`, cls: 'header' }];
      entries.forEach(([id, g]) => {
        const totalMsgs = Object.values(g.messages || {}).reduce((s, ch) => s + ch.length, 0);
        if (!totalMsgs) return;
        out.push({ text: `\n  ${g.name} (${id.substring(0, 8)}) — ${g.active ? 'active' : 'revoked'} — ${totalMsgs} total messages`, cls: 'highlight' });
        Object.entries(g.messages || {}).forEach(([ch, msgs]) => {
          if (!msgs.length) return;
          out.push({ text: `    #${ch} (${msgs.length})`, cls: 'dim' });
          msgs.slice(-5).forEach(m => {
            const time = new Date(m.timestamp).toLocaleString();
            out.push({ text: `      [${time}] ${m.sender}: ${(m.text || '').substring(0, 100)}`, cls: 'data' });
          });
          if (msgs.length > 5) out.push({ text: `      ... ${msgs.length - 5} older`, cls: 'dim' });
        });
      });
      return { lines: out };
    }
    if (sub === 'messages' || sub === 'msgs') {
      const id = parts[2];
      if (!id) return lines('Usage: guests messages <id> [channel]', 'warn');
      const fullId = Object.keys(guests).find(k => k.startsWith(id));
      if (!fullId) return lines('Guest not found', 'error');
      const g = guests[fullId];
      const ch = parts[3]?.toLowerCase();
      const channels = ch ? [ch] : Object.keys(g.messages || {});
      const out = [{ text: `── Messages for ${g.name} (${fullId.substring(0, 8)}) ──`, cls: 'header' }];
      channels.forEach(channel => {
        const msgs = (g.messages || {})[channel] || [];
        out.push({ text: `\n  #${channel} (${msgs.length} messages)`, cls: 'highlight' });
        if (!msgs.length) { out.push({ text: '    (empty)', cls: 'dim' }); return; }
        msgs.slice(-30).forEach(m => {
          const time = new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const sender = m.sender || '?';
          out.push({ text: `    [${time}] ${sender}: ${(m.text || '').substring(0, 120)}`, cls: 'data' });
        });
        if (msgs.length > 30) out.push({ text: `    ... ${msgs.length - 30} older messages not shown`, cls: 'dim' });
      });
      return { lines: out };
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
    if (sub === 'archive') {
      const archived = Object.values(guests).filter(g => !g.active);
      if (!archived.length) return lines('No archived guests', 'info');
      return {
        lines: [
          { text: `Archived guests: ${archived.length}`, cls: 'header' },
          ...archived.map(g => {
            const totalMsgs = Object.values(g.messages || {}).reduce((sum, ch) => sum + (ch?.length || 0), 0);
            return { text: `  ${g.name} — ${totalMsgs} messages — revoked by ${g.createdBy || 'unknown'}`, cls: 'info' };
          }),
        ],
      };
    }
    return lines('Usage: guests list | guests archive | guests messages <id> [channel] | guests revoke <id>', 'warn');
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
    if (db.pool) {
      const msg = await db.getMessageById(id);
      if (!msg) return lines('Message not found', 'error');
      const editedAt = Date.now();
      await db.updateMessage(id, { text: newText, edited: true, editedAt });
      io.emit('msg-edited', { id: msg.id, text: newText, editedAt });
      return lines(`Modified message: "${(msg.text || '').substring(0, 40)}" → "${newText.substring(0, 40)}"`, 'success');
    }
    const msgs = rd(F.messages);
    const msg = (msgs.main || []).find(m => m.id === id || m.id.startsWith(id));
    if (!msg) return lines('Message not found', 'error');
    const oldText = msg.text;
    msg.text = newText; msg.edited = true; msg.editedAt = Date.now();
    wd(F.messages, msgs);
    io.emit('msg-edited', { id: msg.id, text: newText, editedAt: msg.editedAt });
    return lines(`Modified message: "${(oldText || '').substring(0, 40)}" → "${newText.substring(0, 40)}"`, 'success');
  }

  // ── CLEAR REACTIONS ──
  if (raw.toLowerCase().startsWith('clear reactions')) {
    const id = parts[2];
    if (!id) return lines('Usage: clear reactions <id>', 'warn');
    if (db.pool) {
      const msg = await db.getMessageById(id);
      if (!msg) return lines('Message not found', 'error');
      const count = Object.keys(msg.reactions || {}).length;
      await db.updateMessage(id, { reactions: {} });
      io.emit('msg-reaction', { id: msg.id, reactions: {} });
      return lines(`Cleared ${count} reaction(s) from message`, 'success');
    }
    const msgs = rd(F.messages);
    const msg = (msgs.main || []).find(m => m.id === id || m.id.startsWith(id));
    if (!msg) return lines('Message not found', 'error');
    const count = Object.keys(msg.reactions || {}).length;
    msg.reactions = {};
    wd(F.messages, msgs);
    io.emit('msg-reaction', { id: msg.id, reactions: {} });
    return lines(`Cleared ${count} reaction(s) from message`, 'success');
  }

  // ── CLEAR EDITED (remove edited indicator) ──
  if (raw.toLowerCase().startsWith('clear edited')) {
    const id = parts[2];
    if (!id) return lines('Usage: clear edited <message-id>', 'warn');
    if (db.pool) {
      const msg = await db.getMessageById(id);
      if (!msg) return lines('Message not found', 'error');
      if (!msg.edited) return lines('Message is not marked as edited', 'warn');
      await db.updateMessage(id, { edited: false, editedAt: null });
      io.emit('msg-edit-cleared', { id: msg.id });
      return lines(`Cleared edited indicator from message by ${msg.sender}`, 'success');
    }
    const msgs = rd(F.messages);
    const msg = (msgs.main || []).find(m => m.id === id || m.id.startsWith(id));
    if (!msg) return lines('Message not found', 'error');
    if (!msg.edited) return lines('Message is not marked as edited', 'warn');
    msg.edited = false; msg.editedAt = null;
    wd(F.messages, msgs);
    io.emit('msg-edit-cleared', { id: msg.id });
    return lines(`Cleared edited indicator from message by ${msg.sender}`, 'success');
  }

  // ── SEND AS (quick one-liner) ──
  if (cmd === 'send' && parts[1]?.toLowerCase() === 'as') {
    const user = parts[2]?.toLowerCase();
    const text = parts.slice(3).join(' ');
    if (!user || !text) return lines('Usage: send as <user> <text>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    const msg = {
      id: uuidv4(), sender: user, type: 'text', text,
      files: [], priority: false, replyTo: null,
      timestamp: Date.now(), edited: false, editedAt: null,
      reactions: {}, read: false, readAt: null, unsendable: false,
      formatting: null, aiGenerated: false,
    };
    if (db.pool) {
      await db.insertMessage(msg);
    } else {
      const msgs = rd(F.messages);
      if (!Array.isArray(msgs.main)) msgs.main = [];
      msgs.main.push(msg);
      wd(F.messages, msgs);
    }
    io.emit('new-message', msg);
    return lines(`Sent as ${user}: "${text}"`, 'success');
  }

  // ── PURGE ──
  if (cmd === 'purge') {
    const sub = parts[1]?.toLowerCase();
    let removed = 0;

    if (sub === 'from') {
      const user = parts[2]?.toLowerCase();
      if (!user) return lines('Usage: purge from <user>', 'warn');
      if (db.pool) {
        const r = await db.query('DELETE FROM messages WHERE sender = $1', [user]);
        removed = r.rowCount;
      } else {
        const msgs = rd(F.messages);
        const before = (msgs?.main || []).length;
        msgs.main = (msgs?.main || []).filter(m => m.sender !== user);
        removed = before - msgs.main.length;
        wd(F.messages, msgs);
      }
    } else if (sub === 'before') {
      const dateStr = parts[2];
      if (!dateStr) return lines('Usage: purge before <YYYY-MM-DD>', 'warn');
      const cutoff = new Date(dateStr).getTime();
      if (isNaN(cutoff)) return lines('Invalid date format. Use YYYY-MM-DD', 'error');
      if (db.pool) {
        const r = await db.query('DELETE FROM messages WHERE timestamp < $1', [cutoff]);
        removed = r.rowCount;
      } else {
        const msgs = rd(F.messages);
        const before = (msgs?.main || []).length;
        msgs.main = (msgs?.main || []).filter(m => m.timestamp >= cutoff);
        removed = before - msgs.main.length;
        wd(F.messages, msgs);
      }
    } else if (sub === 'keyword') {
      const kw = parts.slice(2).join(' ');
      if (!kw) return lines('Usage: purge keyword <text>', 'warn');
      if (db.pool) {
        const r = await db.query('DELETE FROM messages WHERE content ILIKE $1', [`%${kw}%`]);
        removed = r.rowCount;
      } else {
        const msgs = rd(F.messages);
        const before = (msgs?.main || []).length;
        msgs.main = (msgs?.main || []).filter(m => !m.text?.toLowerCase().includes(kw.toLowerCase()));
        removed = before - msgs.main.length;
        wd(F.messages, msgs);
      }
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

  // ── REPUBLISH UPDATE LOG ──
  if (raw.toLowerCase().startsWith('republish update-log') || raw.toLowerCase().startsWith('republish updatelog')) {
    const target = parts[2]?.toLowerCase();
    if (target && target !== 'kaliph' && target !== 'kathrine' && target !== 'both') {
      return lines('Usage: republish update-log [kaliph|kathrine|both]', 'warn');
    }
    const user = target || 'both';
    io.emit('show-update-log', { target: user });
    return lines(`Republished update log to ${user}`, 'success');
  }

  // ── CUSTOM UPDATE LOG ──
  if (raw.toLowerCase().startsWith('custom update-log ') || raw.toLowerCase().startsWith('custom updatelog ')) {
    const rest = raw.replace(/^custom\s+update-?log\s+/i, '');
    // Parse: [kaliph|kathrine|both] <message>
    const firstWord = rest.split(' ')[0]?.toLowerCase();
    let target = 'both';
    let message = rest;
    if (firstWord === 'kaliph' || firstWord === 'kathrine' || firstWord === 'both') {
      target = firstWord;
      message = rest.slice(firstWord.length).trim();
    }
    if (!message) return lines('Usage: custom update-log [kaliph|kathrine|both] <message>', 'warn');
    io.emit('show-custom-update-log', { target, message });
    return lines(`Custom update log sent to ${target}: "${message.substring(0, 60)}"`, 'success');
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

  // ── REMINDERS ──
  if (cmd === 'reminders') {
    const sub = parts[1]?.toLowerCase();
    const allRem = rd(F.reminders) || [];
    const userFilter = (sub === 'list' ? parts[2] : sub)?.toLowerCase();
    const list = userFilter ? allRem.filter(r => r.user?.toLowerCase() === userFilter) : allRem;
    if (!list.length) return lines(userFilter ? `No reminders for ${userFilter}` : 'No reminders found', 'dim');
    const rows = list.map(r => [
      r.id.slice(-6),
      r.user || '-',
      r.title || '-',
      r.datetime ? new Date(r.datetime).toLocaleString() : '-',
      r.completed ? '✓' : (new Date(r.datetime) < new Date() ? 'OVERDUE' : 'pending'),
    ]);
    return { table: { headers: ['ID (last 6)', 'User', 'Title', 'When', 'Status'], rows } };
  }

  // ── DELETE REMINDER ──
  if (raw.toLowerCase().startsWith('delete reminder')) {
    const id = parts[2];
    if (!id) return lines('Usage: delete reminder <id>', 'warn');
    const all = rd(F.reminders) || [];
    const idx = all.findIndex(r => r.id === id || r.id.endsWith(id));
    if (idx < 0) return lines(`Reminder "${id}" not found`, 'error');
    const [removed] = all.splice(idx, 1);
    wd(F.reminders, all);
    return lines(`Deleted reminder: "${removed.title}" (${removed.id})`, 'success');
  }

  // ── PINNED LIST ──
  if (raw.toLowerCase() === 'pinned list') {
    let pinned;
    if (db.pool) {
      pinned = await db.getPinnedMessages();
    } else {
      pinned = (rd(F.messages)?.main || []).filter(m => m.pinned);
    }
    if (!pinned.length) return lines('No pinned messages', 'dim');
    const rows = pinned.map(m => ['main', m.id.slice(-6), m.sender || '-', (m.text || '').substring(0, 60)]);
    return { table: { headers: ['Channel', 'Msg ID', 'Sender', 'Text'], rows } };
  }

  // ── TOGGLE PERF ──
  if (raw.toLowerCase().startsWith('toggle perf')) {
    const user = parts[2]?.toLowerCase();
    if (!user) return lines('Usage: toggle perf <user>', 'warn');
    const users = rd(F.users);
    if (!users[user]) return lines(`User "${user}" not found`, 'error');
    users[user].perfMode = !users[user].perfMode;
    wd(F.users, users);
    return lines(`Performance mode for ${user}: ${users[user].perfMode ? 'ON' : 'OFF'}`, 'success');
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
  socket.on('call-ice-candidate',  d => socket.broadcast.emit('call-ice-candidate', d));
  socket.on('call-end',            d => socket.broadcast.emit('call-ended',         d));
  socket.on('call-camera-toggle',  d => socket.broadcast.emit('call-camera-toggle', d));
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

// Create schema (including sessions table) BEFORE accepting connections so the
// PgStore can save sessions for the very first request after a cold start.
(async () => {
  if (db.pool) {
    try { await db.createSchema(); } catch (e) { console.error('[db] Early schema error:', e.message); }
  }
  server.listen(PORT, async () => {
    // Load all app data from Postgres into the in-memory cache (if DATABASE_URL is set)
    await loadDbCache();

  console.log(`\n🏰 ══════════════════════════════════════════ 🏰`);
  console.log(`   The Royal Kat & Kai Vault`);
  console.log(`   Running on → http://localhost:${PORT}`);
  console.log(`   Backdoor   → http://localhost:${PORT}/backdoor`);
  if (db.pool) console.log(`   Database   → ✅ Postgres connected`);
  // Email status check
  if (EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && EMAILJS_PUBLIC_KEY) {
    console.log(`   Email      → ✅ EmailJS configured (${EMAILJS_SERVICE_ID})`);
  } else {
    console.log(`   Email      → ❌ EmailJS not configured`);
  }
  console.log(`🏰 ══════════════════════════════════════════ 🏰\n`);
  });
})();
