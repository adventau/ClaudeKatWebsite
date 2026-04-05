require('dotenv').config();

// Prevent server crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

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
const nodeFetch = require('node-fetch');
const db = require('./db');
const { sendMessageNotification } = require('./utils/notifications');
const { generateStatementPDF } = require('./utils/generate-statement-pdf');
let compression;
try { compression = require('compression'); } catch(e) { /* optional */ }
const webpush = require('web-push');
const crypto = require('crypto');

// Return today's date as YYYY-MM-DD in US Central time (CDT/CST)
function todayCentral() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// HEIC → JPEG conversion helper
let heicConvert;
try { heicConvert = require('heic-convert'); } catch(e) { console.warn('[heic-convert] not available:', e.message); }

// Sharp for resize + compression
let sharp;
try { sharp = require('sharp'); } catch(e) { console.warn('[sharp] not available:', e.message); }

async function convertHeicIfNeeded(filePath) {
  if (!heicConvert) return filePath;
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return filePath;
  try {
    const inputBuffer = await fs.readFile(filePath);
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 });
    const jpegPath = filePath.replace(/\.(heic|heif)$/i, '.jpg');
    await fs.writeFile(jpegPath, Buffer.from(outputBuffer));
    await fs.remove(filePath);
    return jpegPath;
  } catch (e) {
    console.error('[heic-convert] conversion failed:', e.message);
    return filePath;
  }
}

// Resize + compress any photo to max 1000px / JPEG 80% — keeps file size ~80-200 KB
async function optimisePhoto(filePath) {
  if (!sharp) return filePath;
  const ext = path.extname(filePath).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  if (!isImage) return filePath;
  const outPath = filePath.replace(/\.[^.]+$/, '.jpg');
  try {
    await sharp(filePath)
      .rotate()                        // auto-orient from EXIF
      .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(outPath + '.tmp');
    await fs.move(outPath + '.tmp', outPath, { overwrite: true });
    if (outPath !== filePath) await fs.remove(filePath).catch(() => {});
    return outPath;
  } catch (e) {
    console.error('[sharp] optimise failed:', e.message);
    return filePath;
  }
}

// Video transcoding — convert any uploaded video to web-optimised H.264 MP4
// Uses bundled ffmpeg binaries via @ffmpeg-installer so no system install needed.
let ffmpeg = null;
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  const fluentFfmpeg   = require('fluent-ffmpeg');
  fluentFfmpeg.setFfmpegPath(ffmpegInstaller.path);
  ffmpeg = fluentFfmpeg;
  console.log('[ffmpeg] available at', ffmpegInstaller.path);
} catch (e) {
  console.warn('[ffmpeg] not available — videos will be served raw:', e.message);
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.avi']);

async function transcodeVideo(inputPath) {
  if (!ffmpeg) return inputPath;
  const ext = path.extname(inputPath).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) return inputPath;

  const outputPath = inputPath.replace(/\.[^.]+$/, '_web.mp4');
  console.log(`[ffmpeg] transcoding ${path.basename(inputPath)} …`);

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v', 'libx264',        // H.264 — universally supported, hardware-decodable
        '-crf', '26',             // Quality: 0=lossless, 51=worst. 26 is visually near-lossless
        '-preset', 'ultrafast',   // Fastest encoding — slightly larger file but done quickly
        '-c:a', 'aac',            // AAC audio
        '-b:a', '128k',           // 128 kbps audio
        '-vf', 'scale=-2:min(720\\,ih)',  // Cap height at 720p, keep aspect ratio, width divisible by 2
        '-movflags', '+faststart', // Put moov atom at start so browser can play before fully downloaded
        '-pix_fmt', 'yuv420p',    // Maximum browser compatibility
      ])
      .on('start', cmd => console.log('[ffmpeg] cmd:', cmd))
      .on('end', () => { console.log(`[ffmpeg] done: ${path.basename(outputPath)}`); resolve(); })
      .on('error', (err) => { console.error('[ffmpeg] error:', err.message); reject(err); })
      .save(outputPath);
  });

  await fs.remove(inputPath).catch(() => {});
  return outputPath;
}

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
  money:         path.join(DATA_DIR, 'money.json'),
  budget:        path.join(DATA_DIR, 'budget.json'),
  budgetSnapshots: path.join(DATA_DIR, 'budget-snapshots.json'),
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
    money: { setup: false, balances: { kaliph: { amount: 0, updatedAt: null }, kathrine: { amount: 0, updatedAt: null } }, dailySnapshots: [], transactions: [], goals: [], recurring: [], investments: { holdings: [], snapshots: [] } },
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
  cookie: { secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge: 2 * 60 * 60 * 1000 }
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

// ── Guest auth guard ──────────────────────────────────────────────────────────
// Confirms the request belongs to an active, non-expired guest session.
// Returns { error, expired: true } with 401 if any check fails.
function isGuestExpired(g) {
  return !!(g.expiresAt && new Date() > new Date(g.expiresAt));
}
function guestAuth(req, res, next) {
  if (!req.session?.isGuest || !req.session?.guestId)
    return res.status(401).json({ error: 'Guest session expired', expired: true });
  const guests = rd(F.guests) || {};
  const g = guests[req.session.guestId];
  if (!g || !g.active || isGuestExpired(g))
    return res.status(401).json({ error: 'Guest session expired', expired: true });
  next();
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

app.get('/api/auth/session', async (req, res) => {
  let briefingUnread = false;
  if (req.session?.user && db.pool) {
    try {
      const today = todayCentral();
      const r = await db.query(
        'SELECT 1 FROM briefings WHERE user_id = $1 AND date = $2 AND read_at IS NULL',
        [req.session.user, today]
      );
      briefingUnread = r.rows.length > 0;
    } catch (_) { /* table may not exist yet */ }
  }
  res.json({
    authenticated: !!(req.session?.authenticated && req.session?.user),
    user: req.session?.user || null,
    isGuest: !!req.session?.isGuest,
    guestId: req.session?.guestId || null,
    briefingUnread,
  });
});

// Dedicated guest session check — no auth middleware required.
// Used by guest.html on init and reconnect instead of /api/auth/session.
app.get('/api/auth/guest-session', (req, res) => {
  if (!req.session?.isGuest || !req.session?.guestId)
    return res.json({ isGuest: false, expired: false });
  const guests = rd(F.guests) || {};
  const g = guests[req.session.guestId];
  if (!g || !g.active)
    return res.json({ isGuest: false, expired: true });
  if (isGuestExpired(g))
    return res.json({ isGuest: false, expired: true });
  res.json({
    isGuest: true,
    guestId: req.session.guestId,
    guestName: g.name,
    channels: g.channels || ['kaliph', 'kathrine', 'group'],
    expired: false,
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
// BRIEFINGS
// ═══════════════════════════════════════════════════════════════════════════════

// Submit endpoint (Cowork → Vault) — secured by shared secret, not session auth
app.post('/api/briefings/submit', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { user, content } = req.body;
  if (!['kaliph', 'kathrine'].includes(user) || !content) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const today = todayCentral(); // YYYY-MM-DD
  try {
    await db.query(`
      INSERT INTO briefings (user_id, content, date, generated_at, read_at)
      VALUES ($1, $2, $3, NOW(), NULL)
      ON CONFLICT (user_id, date) DO UPDATE
        SET content = $2, generated_at = NOW(), read_at = NULL
    `, [user, content, today]);

    // Push notification via existing Brrr system
    const users = rd(F.users) || {};
    const displayName = users[user]?.displayName || users[user]?.name || user;
    const isKathrine = user === 'kathrine';
    await sendPushToUser(user, {
      title: isKathrine ? 'Good Morning, Your Majesty 👑' : `Hi ${displayName}! ☀️`,
      body: 'Your morning briefing is ready.',
      tag: 'briefing-daily',
      url: '/app',
    });

    // Real-time notification via Socket.IO
    io.emit('briefing:new', { user });

    res.json({ success: true });
  } catch (e) {
    console.error('[briefings] Submit error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Fetch briefing for a specific date (defaults to today)
app.get('/api/briefings/today', mainAuth, async (req, res) => {
  const date = req.query.date || todayCentral();
  try {
    const result = await db.query(
      'SELECT content, generated_at, read_at, date FROM briefings WHERE user_id = $1 AND date = $2',
      [req.session.user, date]
    );
    if (!result.rows.length) return res.json({ found: false, date });
    const row = result.rows[0];
    res.json({
      found: true,
      date: row.date,
      content: row.content,
      generatedAt: row.generated_at,
      isRead: !!row.read_at,
    });
  } catch (e) {
    console.error('[briefings] Fetch error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get list of dates that have briefings (for navigation)
app.get('/api/briefings/dates', mainAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT date FROM briefings WHERE user_id = $1 ORDER BY date DESC',
      [req.session.user]
    );
    res.json({ dates: result.rows.map(r => r.date.toISOString().slice(0, 10)) });
  } catch (e) {
    console.error('[briefings] Dates error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark today's briefing as read
app.post('/api/briefings/read', mainAuth, async (req, res) => {
  const today = todayCentral();
  try {
    await db.query(
      'UPDATE briefings SET read_at = NOW() WHERE user_id = $1 AND date = $2 AND read_at IS NULL',
      [req.session.user, today]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('[briefings] Read error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Fetch the most recent briefing before today for a given user (Cowork → Vault)
app.get('/api/briefings/yesterday', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = req.query.user;
  if (!user || !['kaliph', 'kathrine'].includes(user)) {
    return res.status(400).json({ error: 'Invalid or missing user param' });
  }
  const today = todayCentral();
  try {
    const result = await db.query(
      `SELECT content, date FROM briefings
       WHERE user_id = $1 AND date < $2
       ORDER BY date DESC LIMIT 1`,
      [user, today]
    );
    if (!result.rows.length) return res.json({ content: null });
    const row = result.rows[0];
    res.json({ date: row.date.toISOString().slice(0, 10), content: row.content });
  } catch (e) {
    console.error('[briefings] Yesterday error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Save briefing feedback from the app
app.post('/api/briefings/feedback', mainAuth, async (req, res) => {
  const { feedback_type, section, highlighted_text, note, permanent } = req.body;
  const validTypes = ['thumbs_up', 'thumbs_down', 'highlight_positive', 'highlight_negative', 'highlight_never', 'free_text'];
  if (!feedback_type || !validTypes.includes(feedback_type)) {
    return res.status(400).json({ error: 'Invalid feedback_type' });
  }
  const isPermanent = feedback_type === 'highlight_never' ? true : !!permanent;
  const today = todayCentral();
  try {
    await db.query(`
      INSERT INTO briefing_feedback (user_id, briefing_date, feedback_type, section, highlighted_text, note, permanent)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [req.session.user, today, feedback_type, section || null, highlighted_text || null, note || null, isPermanent]);
    res.json({ success: true });
  } catch (e) {
    console.error('[briefings] Feedback save error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve feedback summary to Cowork each morning
app.get('/api/briefings/feedback', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = req.query.user;
  if (!user) return res.status(400).json({ error: 'Missing user param' });
  try {
    // Permanent preferences
    const permResult = await db.query(
      `SELECT feedback_type, section, highlighted_text, note, created_at
       FROM briefing_feedback WHERE user_id = $1 AND permanent = TRUE
       ORDER BY created_at ASC`,
      [user]
    );
    // Recent non-permanent, non-consolidated feedback from last 7 days
    const recentResult = await db.query(
      `SELECT feedback_type, section, highlighted_text, note, briefing_date, created_at
       FROM briefing_feedback
       WHERE user_id = $1 AND permanent = FALSE AND consolidated = FALSE
         AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at ASC`,
      [user]
    );

    if (!permResult.rows.length && !recentResult.rows.length) {
      return res.json({ feedback: null });
    }

    let output = '';

    if (permResult.rows.length) {
      output += 'PERMANENT PREFERENCES (apply every day, no exceptions):\n';
      for (const row of permResult.rows) {
        const parts = [];
        if (row.feedback_type === 'highlight_never' && row.highlighted_text) {
          parts.push(`Never include: "${row.highlighted_text}"`);
        } else {
          parts.push(row.feedback_type.replace(/_/g, ' '));
          if (row.section) parts.push(`[${row.section}]`);
          if (row.highlighted_text) parts.push(`"${row.highlighted_text}"`);
          if (row.note) parts.push(`- ${row.note}`);
        }
        output += `- ${parts.join(' ')}\n`;
      }
    }

    if (recentResult.rows.length) {
      if (output) output += '\n';
      output += 'RECENT FEEDBACK (last 7 days — reader\'s actual reactions to delivered briefings):\n';
      for (const row of recentResult.rows) {
        const dateStr = new Date(row.briefing_date).toISOString().slice(0, 10);
        const parts = [dateStr];
        if (row.section) parts.push(`[${row.section}]`);
        parts.push(row.feedback_type.replace(/_/g, ' '));
        if (row.highlighted_text) parts.push(`"${row.highlighted_text}"`);
        if (row.note) parts.push(`- ${row.note}`);
        output += `- ${parts.join(' ')}\n`;
      }
    }

    res.type('text/plain').send(output);
  } catch (e) {
    console.error('[briefings] Feedback fetch error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Weekly consolidation endpoint — summarize old feedback and mark as consolidated
app.post('/api/briefings/consolidate', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'Missing user' });
  try {
    // Fetch non-consolidated, non-permanent feedback older than 7 days
    const result = await db.query(
      `SELECT id, feedback_type, section, highlighted_text, note, briefing_date, created_at
       FROM briefing_feedback
       WHERE user_id = $1 AND consolidated = FALSE AND permanent = FALSE
         AND created_at < NOW() - INTERVAL '7 days'
       ORDER BY created_at ASC`,
      [user]
    );

    if (!result.rows.length) {
      return res.type('text/plain').send('No feedback to consolidate.');
    }

    // Build a summary of the raw feedback for the LLM
    let rawSummary = '';
    for (const row of result.rows) {
      const dateStr = new Date(row.briefing_date).toISOString().slice(0, 10);
      rawSummary += `- ${dateStr} ${row.feedback_type}`;
      if (row.section) rawSummary += ` [${row.section}]`;
      if (row.highlighted_text) rawSummary += ` "${row.highlighted_text}"`;
      if (row.note) rawSummary += ` — ${row.note}`;
      rawSummary += '\n';
    }

    // Use Anthropic SDK to summarize
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a briefing preference analyst. Given raw feedback items from a user about their daily briefing, produce concise standing instructions that a briefing-generation AI should follow going forward. Output only the instructions, one per line, as bullet points. Be specific and actionable.',
      messages: [{ role: 'user', content: `Summarize these feedback items into standing briefing preferences:\n\n${rawSummary}` }],
    });
    const summary = resp.content[0].text;

    // Mark all processed rows as consolidated
    const ids = result.rows.map(r => r.id);
    await db.query(
      `UPDATE briefing_feedback SET consolidated = TRUE WHERE id = ANY($1)`,
      [ids]
    );

    res.type('text/plain').send(summary);
  } catch (e) {
    console.error('[briefings] Consolidate error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/users', (req, res) => {
  if (!req.session?.user && !req.session?.isGuest && !req.session?.authenticated)
    return res.status(401).json({ error: 'Unauthorized' });
  const users = rd(F.users);
  if (!users) return res.json({});
  // Inject live presence: 'online' | 'idle' | 'offline'
  for (const name of Object.keys(users)) {
    users[name]._presence = onlineUsers[name]?.state || 'offline';
  }
  // Guests get only public profile fields — no sensitive auth data
  if (req.session?.isGuest && !req.session?.user) {
    const safe = {};
    for (const [name, u] of Object.entries(users)) {
      safe[name] = {
        displayName: u.displayName,
        avatar: u.avatar,
        banner: u.banner,
        customStatus: u.customStatus,
        lastSeen: u.lastSeen,
        _presence: u._presence,
        theme: u.theme,
      };
    }
    return res.json(safe);
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
  const around = parseInt(req.query.around) || null;
  const q      = req.query.q || null;

  if (db.pool) {
    try {
      if (around) {
        const rows = await db.getMessagesAround(around, Math.floor(limit / 2));
        return res.json(rows);
      }
      const rows = await db.getMessages({ limit, before, after, search: q });
      return res.json(rows);
    } catch (e) {
      console.error('[db] getMessages error:', e.message);
    }
  }

  // Legacy JSON fallback
  const msgs = rd(F.messages);
  let main = msgs?.main || [];
  if (around) {
    const half = Math.floor(limit / 2);
    const idx = main.findIndex(m => m.timestamp >= around);
    const start = Math.max(0, idx < 0 ? main.length - half : idx - half);
    main = main.slice(start, start + limit);
    return res.json(main);
  }
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

  // brrr webhook push notification (iOS) — skip if recipient is actively online
  if (onlineUsers[recipient]?.state !== 'online') {
    sendMessageNotification(sender, recipient, message.text || (message.files?.length ? 'Sent a file' : ''));
  }

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
// MONEY DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function applyTransaction(money, txn) {
  const amt = parseFloat(txn.amount) || 0;
  if (txn.type === 'deposit') {
    money.balances[txn.paidBy].amount += amt;
  } else {
    if (txn.split) {
      money.balances.kaliph.amount -= amt / 2;
      money.balances.kathrine.amount -= amt / 2;
    } else {
      money.balances[txn.paidBy].amount -= amt;
    }
  }
  money.balances.kaliph.amount = Math.round(money.balances.kaliph.amount * 100) / 100;
  money.balances.kathrine.amount = Math.round(money.balances.kathrine.amount * 100) / 100;
  money.balances.kaliph.updatedAt = Date.now();
  money.balances.kathrine.updatedAt = Date.now();
}

function reverseTransaction(money, txn) {
  const amt = parseFloat(txn.amount) || 0;
  if (txn.type === 'deposit') {
    money.balances[txn.paidBy].amount -= amt;
  } else {
    if (txn.split) {
      money.balances.kaliph.amount += amt / 2;
      money.balances.kathrine.amount += amt / 2;
    } else {
      money.balances[txn.paidBy].amount += amt;
    }
  }
  money.balances.kaliph.amount = Math.round(money.balances.kaliph.amount * 100) / 100;
  money.balances.kathrine.amount = Math.round(money.balances.kathrine.amount * 100) / 100;
  money.balances.kaliph.updatedAt = Date.now();
  money.balances.kathrine.updatedAt = Date.now();
}

function takeMoneySnapshot(money) {
  const today = todayCentral();
  if (money.dailySnapshots.some(s => s.date === today)) return;
  // Calculate invested value per user from holdings
  const holdings = money.investments?.holdings || [];
  const kInvested = holdings.filter(h => h.owner === 'kaliph').reduce((s, h) => s + h.costBasis, 0);
  const kaInvested = holdings.filter(h => h.owner === 'kathrine').reduce((s, h) => s + h.costBasis, 0);
  money.dailySnapshots.push({
    date: today,
    kaliph: money.balances.kaliph.amount,
    kathrine: money.balances.kathrine.amount,
    kaliphInvested: Math.round(kInvested * 100) / 100,
    kathrineInvested: Math.round(kaInvested * 100) / 100,
  });
  if (money.dailySnapshots.length > 60) money.dailySnapshots = money.dailySnapshots.slice(-60);
}

function advanceNextDate(rec) {
  const d = new Date(rec.nextDate);
  if (rec.frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (rec.frequency === 'biweekly') d.setDate(d.getDate() + 14);
  else if (rec.frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  rec.nextDate = d.toISOString().split('T')[0];
}

// ── Money: GET ──
app.get('/api/money', mainAuth, (req, res) => {
  res.json(rd(F.money) || {});
});

// ── Money: Setup ──
app.post('/api/money/setup', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const { kaliph, kathrine } = req.body;
  money.balances = {
    kaliph: { amount: parseFloat(kaliph) || 0, updatedAt: Date.now() },
    kathrine: { amount: parseFloat(kathrine) || 0, updatedAt: Date.now() },
  };
  money.setup = true;
  takeMoneySnapshot(money);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, money });
});

// ── Money: Create Transaction ──
app.post('/api/money/transactions', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const txn = {
    id: uuidv4(),
    type: req.body.type || 'expense',
    description: req.body.description || '',
    amount: parseFloat(req.body.amount) || 0,
    category: req.body.category || 'other',
    paidBy: req.body.paidBy || req.session.user,
    split: req.body.split === true || req.body.split === 'true',
    date: req.body.date || todayCentral(),
    createdAt: Date.now(),
    createdBy: req.session.user,
  };
  applyTransaction(money, txn);
  money.transactions.push(txn);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, transaction: txn });
});

// ── Money: Edit Transaction ──
app.put('/api/money/transactions/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const idx = money.transactions.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Transaction not found' });
  const old = money.transactions[idx];
  // Reverse the old transaction's balance effect
  reverseTransaction(money, old);
  // Update fields
  const updated = {
    ...old,
    type: req.body.type || old.type,
    description: req.body.description !== undefined ? req.body.description : old.description,
    amount: req.body.amount !== undefined ? parseFloat(req.body.amount) : old.amount,
    category: req.body.category || old.category,
    paidBy: req.body.paidBy || old.paidBy,
    split: req.body.split !== undefined ? (req.body.split === true || req.body.split === 'true') : old.split,
    date: req.body.date || old.date,
  };
  // Apply the new transaction's balance effect
  applyTransaction(money, updated);
  money.transactions[idx] = updated;
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, transaction: updated });
});

// ── Money: Delete Transaction ──
app.delete('/api/money/transactions/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const idx = money.transactions.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Transaction not found' });
  const [removed] = money.transactions.splice(idx, 1);
  reverseTransaction(money, removed);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true });
});

// ── Money: Create Goal ──
app.post('/api/money/goals', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const goal = {
    id: uuidv4(),
    name: req.body.name || 'Untitled Goal',
    targetAmount: parseFloat(req.body.targetAmount) || 100,
    currentAmount: 0,
    color: req.body.color || '#4f46e5',
    targetDate: req.body.targetDate || null,
    completedAt: null,
    contributions: [],
    createdAt: Date.now(),
  };
  money.goals.push(goal);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, goal });
});

// ── Money: Update Goal ──
app.put('/api/money/goals/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const goal = money.goals.find(g => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  if (req.body.name !== undefined) goal.name = req.body.name;
  if (req.body.targetAmount !== undefined) goal.targetAmount = parseFloat(req.body.targetAmount);
  if (req.body.color !== undefined) goal.color = req.body.color;
  if (req.body.targetDate !== undefined) goal.targetDate = req.body.targetDate;
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, goal });
});

// ── Money: Delete Goal ──
app.delete('/api/money/goals/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const goal = money.goals.find(g => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  // Refund currentAmount back to the deleting user's balance
  const user = req.session.user;
  if (goal.currentAmount > 0 && money.balances[user]) {
    money.balances[user].amount = Math.round((money.balances[user].amount + goal.currentAmount) * 100) / 100;
    money.balances[user].updatedAt = Date.now();
    // Create a deposit transaction for the refund
    const refundTxn = {
      id: uuidv4(), type: 'deposit', description: `${goal.name} (goal deleted)`,
      amount: goal.currentAmount, category: 'other', paidBy: user, split: false,
      date: todayCentral(), createdAt: Date.now(), createdBy: 'system',
    };
    money.transactions.push(refundTxn);
  }
  // Remove contribution expense logs for this goal
  money.transactions = money.transactions.filter(t => t._goalId !== goal.id);
  money.goals = money.goals.filter(g => g.id !== req.params.id);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true });
});

// ── Money: Contribute to Goal ──
app.post('/api/money/goals/:id/contribute', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const goal = money.goals.find(g => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const contrib = {
    id: uuidv4(),
    amount: parseFloat(req.body.amount) || 0,
    note: req.body.note || '',
    date: todayCentral(),
    createdAt: Date.now(),
  };
  goal.contributions.push(contrib);
  goal.currentAmount = Math.round((goal.currentAmount + contrib.amount) * 100) / 100;
  // Deduct from the contributing user's balance
  const user = req.session.user;
  if (money.balances[user]) {
    money.balances[user].amount = Math.round((money.balances[user].amount - contrib.amount) * 100) / 100;
    money.balances[user].updatedAt = Date.now();
  }
  // Create an expense transaction log for the contribution
  const txn = {
    id: uuidv4(), type: 'expense', description: `${goal.name} (savings)`,
    amount: contrib.amount, category: 'other', paidBy: user, split: false,
    date: contrib.date, createdAt: Date.now(), createdBy: user, _goalId: goal.id,
  };
  money.transactions.push(txn);
  if (goal.currentAmount >= goal.targetAmount && !goal.completedAt) {
    goal.completedAt = Date.now();
  }
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, goal, justCompleted: goal.completedAt && !req.body._wasCompleted });
});

// ── Money: Withdraw from Goal ──
app.post('/api/money/goals/:id/withdraw', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const goal = money.goals.find(g => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const amount = Math.min(parseFloat(req.body.amount) || 0, goal.currentAmount);
  if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  goal.currentAmount = Math.round((goal.currentAmount - amount) * 100) / 100;
  // Reset completed status if withdrawn below target
  if (goal.currentAmount < goal.targetAmount) goal.completedAt = null;
  // Add back to user's balance
  const user = req.session.user;
  if (money.balances[user]) {
    money.balances[user].amount = Math.round((money.balances[user].amount + amount) * 100) / 100;
    money.balances[user].updatedAt = Date.now();
  }
  // Create a deposit transaction for the withdrawal
  const txn = {
    id: uuidv4(), type: 'deposit', description: `${goal.name} (withdrawn)`,
    amount, category: 'other', paidBy: user, split: false,
    date: todayCentral(), createdAt: Date.now(), createdBy: user, _goalId: goal.id,
  };
  money.transactions.push(txn);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, goal });
});

// ── Money: Create Recurring ──
app.post('/api/money/recurring', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const rec = {
    id: uuidv4(),
    description: req.body.description || '',
    amount: parseFloat(req.body.amount) || 0,
    category: req.body.category || 'bills',
    paidBy: req.body.paidBy || 'shared',
    split: req.body.split === true || req.body.split === 'true',
    frequency: req.body.frequency || 'monthly',
    nextDate: req.body.nextDate || todayCentral(),
    createdAt: Date.now(),
  };
  money.recurring.push(rec);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, recurring: rec });
});

// ── Money: Delete Recurring ──
app.delete('/api/money/recurring/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  money.recurring = money.recurring.filter(r => r.id !== req.params.id);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true });
});

// ── Money: Log Recurring Now ──
app.post('/api/money/recurring/:id/log', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const rec = money.recurring.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recurring entry not found' });
  const txn = {
    id: uuidv4(),
    type: 'expense',
    description: rec.description + ' (recurring)',
    amount: rec.amount,
    category: rec.category,
    paidBy: rec.paidBy === 'shared' ? 'kaliph' : rec.paidBy,
    split: rec.split || rec.paidBy === 'shared',
    date: todayCentral(),
    createdAt: Date.now(),
    createdBy: req.session.user,
    recurringId: rec.id,
  };
  applyTransaction(money, txn);
  money.transactions.push(txn);
  advanceNextDate(rec);
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, transaction: txn });
});

// ── Money: Portfolio / Investments ──
const priceCache = {};
const PRICE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function fetchPrice(symbol) {
  const cached = priceCache[symbol];
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) return cached;
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { symbol, price: 0, change: 0, changePct: 0, ts: Date.now(), error: 'No API key' };
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
    const data = await res.json();
    if (!data.c) return { symbol, price: 0, change: 0, changePct: 0, ts: Date.now(), error: 'Invalid symbol' };
    const result = { symbol, price: data.c, change: data.d, changePct: data.dp, ts: Date.now() };
    priceCache[symbol] = result;
    return result;
  } catch (e) {
    console.error(`Finnhub fetch error for ${symbol}:`, e.message);
    return cached || { symbol, price: 0, change: 0, changePct: 0, ts: Date.now(), error: e.message };
  }
}

// Validate a symbol against Finnhub
async function validateSymbol(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${symbol}&token=${apiKey}`);
    const data = await res.json();
    const match = (data.result || []).find(r => r.symbol === symbol.toUpperCase());
    return match ? { symbol: match.symbol, name: match.description } : null;
  } catch { return null; }
}

app.get('/api/money/portfolio/prices', mainAuth, async (req, res) => {
  const money = rd(F.money) || {};
  const holdings = money.investments?.holdings || [];
  // Also allow validating a single symbol
  const validateSym = req.query.validate;
  if (validateSym) {
    const sym = validateSym.toUpperCase();
    const price = await fetchPrice(sym);
    if (price.error === 'No API key') {
      // No Finnhub key — allow adding with placeholder data
      return res.json({ [sym]: { symbol: sym, price: 0, change: 0, changePct: 0, name: sym, ts: Date.now(), noKey: true } });
    }
    const info = await validateSymbol(validateSym);
    return res.json({ [sym]: { ...price, name: info?.name || sym } });
  }
  const prices = {};
  for (const h of holdings) {
    prices[h.symbol] = await fetchPrice(h.symbol);
  }
  res.json(prices);
});

app.post('/api/money/investments', mainAuth, async (req, res) => {
  const money = rd(F.money) || {};
  if (!money.investments) money.investments = { holdings: [], snapshots: [] };
  const { symbol, name, shares, costBasis } = req.body;
  if (!symbol || !shares) return res.status(400).json({ error: 'Symbol and shares required' });
  const cost = parseFloat(costBasis) || 0;
  const user = req.session.user;
  const holding = {
    id: uuidv4(),
    symbol: symbol.toUpperCase(),
    name: name || symbol.toUpperCase(),
    shares: parseFloat(shares) || 0,
    costBasis: cost,
    owner: user,
    addedAt: Date.now(),
  };
  money.investments.holdings.push(holding);
  // Deduct costBasis from user's balance
  if (cost > 0 && money.balances[user]) {
    money.balances[user].amount = Math.round((money.balances[user].amount - cost) * 100) / 100;
    money.balances[user].updatedAt = Date.now();
    // Log as expense
    money.transactions.push({
      id: uuidv4(), type: 'expense', description: `${holding.symbol} (investment)`,
      amount: cost, category: 'other', paidBy: user, split: false,
      date: todayCentral(), createdAt: Date.now(), createdBy: user,
    });
  }
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, holding });
});

app.put('/api/money/investments/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const holding = (money.investments?.holdings || []).find(h => h.id === req.params.id);
  if (!holding) return res.status(404).json({ error: 'Holding not found' });
  if (req.body.shares !== undefined) holding.shares = parseFloat(req.body.shares);
  if (req.body.costBasis !== undefined) holding.costBasis = parseFloat(req.body.costBasis);
  if (req.body.name !== undefined) holding.name = req.body.name;
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, holding });
});

// Buy more shares of an existing holding
app.post('/api/money/investments/:id/buy', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const holding = (money.investments?.holdings || []).find(h => h.id === req.params.id);
  if (!holding) return res.status(404).json({ error: 'Holding not found' });
  const addShares = parseFloat(req.body.shares);
  const cost = parseFloat(req.body.cost) || 0;
  if (!addShares || addShares <= 0) return res.status(400).json({ error: 'Invalid shares amount' });
  const owner = holding.owner || req.session.user;
  if (cost > 0 && money.balances[owner]) {
    if (money.balances[owner].amount < cost) return res.status(400).json({ error: 'Insufficient balance' });
    money.balances[owner].amount = Math.round((money.balances[owner].amount - cost) * 100) / 100;
    money.balances[owner].updatedAt = Date.now();
    money.transactions.push({
      id: uuidv4(), type: 'expense', description: `${holding.symbol} (buy more)`,
      amount: cost, category: 'other', paidBy: owner, split: false,
      date: todayCentral(), createdAt: Date.now(), createdBy: req.session.user,
    });
  }
  holding.shares = Math.round((holding.shares + addShares) * 10000) / 10000;
  holding.costBasis = Math.round((holding.costBasis + cost) * 100) / 100;
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true, holding });
});

// Sell shares of an existing holding
app.post('/api/money/investments/:id/sell', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  const holding = (money.investments?.holdings || []).find(h => h.id === req.params.id);
  if (!holding) return res.status(404).json({ error: 'Holding not found' });
  const sellShares = parseFloat(req.body.shares);
  const proceeds = parseFloat(req.body.proceeds) || 0;
  if (!sellShares || sellShares <= 0) return res.status(400).json({ error: 'Invalid shares amount' });
  if (sellShares > holding.shares + 0.0001) return res.status(400).json({ error: 'Cannot sell more shares than you own' });
  const owner = holding.owner || req.session.user;
  // Credit proceeds to owner's balance
  if (proceeds > 0 && money.balances[owner]) {
    money.balances[owner].amount = Math.round((money.balances[owner].amount + proceeds) * 100) / 100;
    money.balances[owner].updatedAt = Date.now();
    money.transactions.push({
      id: uuidv4(), type: 'deposit', description: `${holding.symbol} (sold)`,
      amount: proceeds, category: 'other', paidBy: owner, split: false,
      date: todayCentral(), createdAt: Date.now(), createdBy: req.session.user,
    });
  }
  // Reduce cost basis proportionally
  const fraction = sellShares / holding.shares;
  const costReduction = Math.round(holding.costBasis * fraction * 100) / 100;
  holding.shares = Math.round((holding.shares - sellShares) * 10000) / 10000;
  holding.costBasis = Math.round((holding.costBasis - costReduction) * 100) / 100;
  // Remove holding entirely if no shares left
  if (holding.shares <= 0.0001) {
    const idx = money.investments.holdings.findIndex(h => h.id === holding.id);
    if (idx >= 0) money.investments.holdings.splice(idx, 1);
  }
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true });
});

app.delete('/api/money/investments/:id', mainAuth, (req, res) => {
  const money = rd(F.money) || {};
  if (!money.investments) return res.status(404).json({ error: 'Not found' });
  const idx = money.investments.holdings.findIndex(h => h.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Holding not found' });
  const [removed] = money.investments.holdings.splice(idx, 1);
  // Refund costBasis back to owner's balance
  const owner = removed.owner || req.session.user;
  if (removed.costBasis > 0 && money.balances[owner]) {
    money.balances[owner].amount = Math.round((money.balances[owner].amount + removed.costBasis) * 100) / 100;
    money.balances[owner].updatedAt = Date.now();
    money.transactions.push({
      id: uuidv4(), type: 'deposit', description: `${removed.symbol} (sold)`,
      amount: removed.costBasis, category: 'other', paidBy: owner, split: false,
      date: todayCentral(), createdAt: Date.now(), createdBy: 'system',
    });
  }
  wd(F.money, money);
  io.emit('money:updated', money);
  res.json({ success: true });
});

// ── Budget ──────────────────────────────────────────────────────────────────
function seedBudgetDefaults() {
  const entertainmentId = uuidv4();
  const shoppingId = uuidv4();
  return {
    anchorDate: '2025-01-03',
    categories: [
      { id: uuidv4(), name: 'Dining Out', emoji: '🍽️', budgetAmount: 0, color: '#f59e0b', pairedWith: null },
      { id: uuidv4(), name: 'Transport', emoji: '🚗', budgetAmount: 0, color: '#3b82f6', pairedWith: null },
      { id: entertainmentId, name: 'Activities', emoji: '🎬', budgetAmount: 0, color: '#8b5cf6', pairedWith: shoppingId },
      { id: shoppingId, name: 'Shopping', emoji: '🛍️', budgetAmount: 0, color: '#ec4899', pairedWith: entertainmentId },
      { id: uuidv4(), name: 'Miscellaneous', emoji: '📦', budgetAmount: 0, color: '#6b7280', pairedWith: null },
    ],
    overrides: [],
    lastAllocatedPeriod: null,
    lastBrrrPeriod: null,
    lastStatementEmailedPeriod: null,
    surplusLog: [],
    investments: [],
  };
}

// Budget period calculation (server-side mirror of client getBudgetPeriod)
function getBudgetPeriodServer(anchorDate, ref = new Date()) {
  const parts = anchorDate.split('-');
  const anchorMs = Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12);
  const refMs = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12);
  const diffDays = Math.floor((refMs - anchorMs) / 86400000);
  const periodIndex = Math.floor(diffDays / 14);
  const startMs = anchorMs + periodIndex * 14 * 86400000;
  const endMs = startMs + 13 * 86400000;
  return { periodStart: new Date(startMs), periodEnd: new Date(endMs) };
}

function getPrevPeriodServer(anchorDate) {
  const current = getBudgetPeriodServer(anchorDate);
  const prevRef = new Date(current.periodStart.getTime() - 14 * 86400000);
  return getBudgetPeriodServer(anchorDate, prevRef);
}

function utcDateStrServer(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function computeSurplusServer(budget, money) {
  const { periodStart, periodEnd } = getPrevPeriodServer(budget.anchorDate);
  const startStr = utcDateStrServer(periodStart);
  const endStr = utcDateStrServer(periodEnd);
  const transactions = money?.transactions || [];

  // Total budgeted across all categories
  let totalBudgeted = 0;
  for (const cat of (budget.categories || [])) totalBudgeted += cat.budgetAmount || 0;

  // Total spent = ALL expenses in the previous period
  const totalSpent = transactions
    .filter(t => t.type === 'expense' && t.date >= startStr && t.date <= endStr)
    .reduce((s, t) => s + (t.amount || 0), 0);

  // Cash balance (excludes investments and savings goals)
  const cashBalance = (money?.balances?.kaliph?.amount || 0) + (money?.balances?.kathrine?.amount || 0);

  // Total surplus = cashBalance - totalSpent (unspent budget + unbudgeted cash)
  return Math.max(0, Math.round((cashBalance - totalSpent) * 100) / 100);
}

// Brrr budget notification — fires once per period
async function checkAndFireBudgetBrrr(budget, money) {
  const { periodStart } = getBudgetPeriodServer(budget.anchorDate);
  const periodStartISO = utcDateStrServer(periodStart);
  if (budget.lastBrrrPeriod === periodStartISO) return;

  // Only fire on the exact period-start day (always a Friday)
  const todayISO = utcDateStrServer(new Date());
  if (todayISO !== periodStartISO) return;

  // Only fire if allocation is still pending
  if (budget.lastAllocatedPeriod === periodStartISO) return;

  const surplus = computeSurplusServer(budget, money);
  if (surplus <= 0) return; // no surplus to allocate

  const msg = `New budget period just started \u2014 you have $${surplus.toFixed(0)} left over from last period. Time to allocate!`;

  const BRRR_WEBHOOKS = {
    kaliph: process.env.BRRR_WEBHOOK_KALIPH,
    kathrine: process.env.BRRR_WEBHOOK_KATHRINE,
  };

  const promises = Object.values(BRRR_WEBHOOKS).filter(Boolean).map(secret =>
    fetch(`https://api.brrr.now/v1/${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Kat & Kai \u{1F48C}', message: msg, sound: 'bubble_ding', 'interruption-level': 'active' }),
    }).catch(err => console.error('[brrr] budget notification error:', err.message))
  );

  await Promise.all(promises);
  budget.lastBrrrPeriod = periodStartISO;
  wd(F.budget, budget);
}

function captureBudgetSnapshotIfNeeded(budget, money) {
  const { periodStart } = getBudgetPeriodServer(budget.anchorDate);
  const psISO = utcDateStrServer(periodStart);
  const snapshots = rd(F.budgetSnapshots) || {};
  if (snapshots[psISO]) return;
  const holdings = money?.investments?.holdings || [];
  const holdingSnaps = holdings.map(h => ({
    symbol: h.symbol, name: h.name, shares: h.shares, costBasis: h.costBasis || 0,
  }));
  const kalBal = money?.balances?.kaliph?.amount || 0;
  const katBal = money?.balances?.kathrine?.amount || 0;
  const goalTotal = (money?.goals || []).reduce((s, g) => s + (g.currentAmount || 0), 0);
  snapshots[psISO] = {
    periodStart: psISO,
    capturedAt: Date.now(),
    kaliph: { balance: kalBal },
    kathrine: { balance: katBal },
    netWorth: kalBal + katBal + goalTotal,
    holdings: holdingSnaps,
  };
  wd(F.budgetSnapshots, snapshots);
}

// ── Statement PDF: data assembly ─────────────────────────────────────────────
function normCatServer(name) { return (name || '').toLowerCase().replace(/[\s\-_]+/g, '-').trim(); }

function getPeriodLabelServer(ps, pe) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[ps.getUTCMonth()]} ${ps.getUTCDate()} – ${months[pe.getUTCMonth()]} ${pe.getUTCDate()}`;
}

function assembleStatementData(periodStartISO) {
  const budget = rd(F.budget);
  const money = rd(F.money) || {};
  const snapshots = rd(F.budgetSnapshots) || {};

  // Compute period
  const psParts = periodStartISO.split('-');
  const psDate = new Date(Date.UTC(+psParts[0], +psParts[1] - 1, +psParts[2], 12));
  const peDate = new Date(psDate.getTime() + 13 * 86400000);
  const peISO = utcDateStrServer(peDate);
  const periodLabel = getPeriodLabelServer(psDate, peDate);

  // Snapshots for start/end
  const startSnap = snapshots[periodStartISO] || {};
  const endSnap = snapshots[peISO] || {};
  const kaliphStart = startSnap.kaliph?.balance ?? (money.balances?.kaliph?.amount || 0);
  const kathrineStart = startSnap.kathrine?.balance ?? (money.balances?.kathrine?.amount || 0);
  const kaliphEnd = endSnap.kaliph?.balance ?? (money.balances?.kaliph?.amount || 0);
  const kathrineEnd = endSnap.kathrine?.balance ?? (money.balances?.kathrine?.amount || 0);
  const netWorthStart = startSnap.netWorth ?? (kaliphStart + kathrineStart);
  const goalTotal = (money.goals || []).reduce((s, g) => s + (g.currentAmount || 0), 0);
  const netWorthEnd = endSnap.netWorth ?? (kaliphEnd + kathrineEnd + goalTotal);

  // Transactions in this period
  const txns = (money.transactions || []).filter(t =>
    t.type === 'expense' && t.date >= periodStartISO && t.date <= peISO
  );

  // Budget totals
  const cats = budget?.categories || [];
  let totalBudgeted = 0;
  for (const c of cats) totalBudgeted += c.budgetAmount || 0;
  const totalSpent = txns.reduce((s, t) => s + (t.amount || 0), 0);
  const cashBalance = kaliphEnd + kathrineEnd;
  const totalUnbudgeted = Math.max(0, cashBalance - totalBudgeted);
  const surplus = Math.max(0, totalBudgeted - totalSpent);
  const overallPct = totalBudgeted > 0 ? Math.round(totalSpent / totalBudgeted * 100) : 0;

  // Category spends
  const overrides = budget?.overrides || [];
  const processedPairs = new Set();
  const categories = [];
  for (const cat of cats) {
    if (processedPairs.has(cat.id)) continue;
    const catKey = normCatServer(cat.name);
    const override = overrides.find(o => o.categoryId === cat.id && o.periodStart === periodStartISO);
    let spent;
    if (override) {
      spent = override.manualAmount;
    } else {
      spent = txns.filter(t => t.category && normCatServer(t.category) === catKey).reduce((s, t) => s + (t.amount || 0), 0);
    }

    if (cat.pairedWith) {
      const partner = cats.find(c => c.id === cat.pairedWith);
      if (partner && !processedPairs.has(partner.id)) {
        const partnerKey = normCatServer(partner.name);
        const pOverride = overrides.find(o => o.categoryId === partner.id && o.periodStart === periodStartISO);
        const partnerSpent = pOverride ? pOverride.manualAmount : txns.filter(t => t.category && normCatServer(t.category) === partnerKey).reduce((s, t) => s + (t.amount || 0), 0);
        const combinedBudget = (cat.budgetAmount || 0) + (partner.budgetAmount || 0);
        const combinedSpent = spent + partnerSpent;
        categories.push({
          emoji: cat.emoji + partner.emoji,
          name: cat.name, displayName: `${cat.name} + ${partner.name}`,
          color: cat.color, budgeted: combinedBudget, spent: combinedSpent,
          overUnder: combinedBudget - combinedSpent, pctUsed: combinedBudget > 0 ? Math.round(combinedSpent / combinedBudget * 100) : 0,
          paired: true, partnerName: partner.name, partnerSpent,
        });
        processedPairs.add(cat.id);
        processedPairs.add(partner.id);
        continue;
      }
    }
    categories.push({
      emoji: cat.emoji, name: cat.name, displayName: cat.name,
      color: cat.color, budgeted: cat.budgetAmount || 0, spent,
      overUnder: (cat.budgetAmount || 0) - spent, pctUsed: cat.budgetAmount > 0 ? Math.round(spent / cat.budgetAmount * 100) : 0,
      paired: false,
    });
    processedPairs.add(cat.id);
  }

  // Per person
  const kaliphSpent = txns.filter(t => t.paidBy === 'kaliph').reduce((s, t) => s + (t.amount || 0), 0);
  const kathrineSpent = txns.filter(t => t.paidBy === 'kathrine').reduce((s, t) => s + (t.amount || 0), 0);
  const kaliphTxnCount = txns.filter(t => t.paidBy === 'kaliph').length;
  const kathrineTxnCount = txns.filter(t => t.paidBy === 'kathrine').length;

  // Transactions for log
  const transactions = txns.sort((a, b) => a.date.localeCompare(b.date)).map(t => {
    const cat = cats.find(c => normCatServer(c.name) === normCatServer(t.category));
    return {
      date: t.date, who: t.paidBy || t.createdBy || '', description: t.description || '',
      category: t.category || 'other', categoryColor: cat?.color || '#6b7280', amount: t.amount || 0,
    };
  });

  // Previous period surplus allocation
  const prevPsDate = new Date(psDate.getTime() - 14 * 86400000);
  const prevPsISO = utcDateStrServer(prevPsDate);
  const prevPeDate = new Date(prevPsDate.getTime() + 13 * 86400000);
  const logEntry = (budget?.surplusLog || []).find(e => e.periodStart === prevPsISO);
  let prevAllocation = null;
  if (logEntry && logEntry.allocations?.length > 0) {
    prevAllocation = {
      periodLabel: getPeriodLabelServer(prevPsDate, prevPeDate),
      surplus: logEntry.surplusAmount || 0,
      allocations: logEntry.allocations.map(a => ({
        name: a.goalName || a.investmentName || 'Unknown',
        type: a.type === 'savings' ? 'Savings goal' : 'Investment',
        platform: a.holdingSymbol || '',
        amount: a.amount || 0,
      })),
    };
  }

  // Savings goals
  const goals = (money.goals || []).map(g => {
    const periodContribs = (g.contributions || []).filter(c => c.date >= periodStartISO && c.date <= peISO);
    const addedThisPeriod = periodContribs.reduce((s, c) => s + (c.amount || 0), 0);
    return {
      name: g.name, target: g.targetAmount || 0, current: g.currentAmount || 0,
      pctDone: g.targetAmount > 0 ? Math.round((g.currentAmount || 0) / g.targetAmount * 100) : 0,
      addedThisPeriod, color: g.color || '#8b5cf6',
    };
  });

  // Portfolio holdings
  const startHoldings = startSnap.holdings || [];
  const currentHoldings = money.investments?.holdings || [];
  const holdings = currentHoldings.map(h => {
    const sh = startHoldings.find(s => s.symbol === h.symbol);
    const startVal = sh?.costBasis || 0;
    const endVal = h.costBasis || 0;
    const change = startVal > 0 ? ((endVal - startVal) / startVal * 100) : 0;
    return {
      symbol: h.symbol, name: h.name, shares: h.shares || 0,
      startValue: startVal, endValue: endVal,
      changePct: Math.abs(Math.round(change * 10) / 10),
      changeDir: change >= 0 ? 'up' : 'down',
    };
  });
  const portfolioTotalEnd = holdings.reduce((s, h) => s + h.endValue, 0);
  const portfolioTotalStart = holdings.reduce((s, h) => s + h.startValue, 0);
  const portfolioChange = portfolioTotalStart > 0
    ? { val: Math.abs(Math.round((portfolioTotalEnd - portfolioTotalStart) / portfolioTotalStart * 1000) / 10), dir: portfolioTotalEnd >= portfolioTotalStart ? 'up' : 'down' }
    : { val: 0, dir: 'flat' };

  const now = new Date();
  return {
    periodLabel, periodStart: periodStartISO, periodEnd: peISO,
    generatedDate: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    netWorthStart, netWorthEnd, kaliphStart, kaliphEnd, kathrineStart, kathrineEnd,
    totalBudgeted, totalSpent, totalUnbudgeted, surplus, overallPct,
    prevAllocation, categories,
    kaliphSpent, kaliphTxnCount, kathrineSpent, kathrineTxnCount,
    transactions, goals, holdings, portfolioTotalEnd, portfolioChange,
  };
}

// ── Statement email notification ──────────────────────────────────────────────
async function sendStatementNotification(periodLabel) {
  const html = `<p>Your bi-weekly budget statement for <strong>${periodLabel}</strong> is ready. Open the Budget tab and navigate to the period to download it.</p>`;
  return sendMail('cyanbydesigner@gmail.com', `Kat & Kai Vault · Budget Statement · ${periodLabel}`, html);
}

// Auto-email + Brrr on period-start Friday
async function checkAndSendBudgetStatement(budget, money) {
  const { periodStart } = getBudgetPeriodServer(budget.anchorDate);
  const periodStartISO = utcDateStrServer(periodStart);
  if (budget.lastStatementEmailedPeriod === periodStartISO) return;
  const todayISO = utcDateStrServer(new Date());
  if (todayISO !== periodStartISO) return;

  // Generate PDF for the PREVIOUS period
  const prevPsDate = new Date(periodStart.getTime() - 14 * 86400000);
  const prevPsISO = utcDateStrServer(prevPsDate);
  const prevPeDate = new Date(prevPsDate.getTime() + 13 * 86400000);
  const prevLabel = getPeriodLabelServer(prevPsDate, prevPeDate);

  try {
    await sendStatementNotification(prevLabel);

    // Brrr to Kaliph confirming statement was sent
    const kaliphWebhook = process.env.BRRR_WEBHOOK_KALIPH;
    if (kaliphWebhook) {
      fetch(`https://api.brrr.now/v1/${kaliphWebhook}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Kat & Kai \u{1F4C4}', message: `Budget statement for ${prevLabel} has been emailed`, sound: 'bubble_ding', 'interruption-level': 'active' }),
      }).catch(() => {});
    }

    budget.lastStatementEmailedPeriod = periodStartISO;
    wd(F.budget, budget);
  } catch (e) {
    console.error('[statement] Failed to send statement:', e.message);
  }
}

app.get('/api/budget', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) {
    budget = seedBudgetDefaults();
    wd(F.budget, budget);
  }
  // Ensure new surplus fields exist on older data
  if (!budget.surplusLog) budget.surplusLog = [];
  if (!budget.investments) budget.investments = [];
  if (budget.lastAllocatedPeriod === undefined) budget.lastAllocatedPeriod = null;
  if (budget.lastBrrrPeriod === undefined) budget.lastBrrrPeriod = null;
  if (budget.lastStatementEmailedPeriod === undefined) budget.lastStatementEmailedPeriod = null;

  // Fire Brrr notification if new period (non-blocking)
  const money = rd(F.money);
  checkAndFireBudgetBrrr(budget, money).catch(e => console.error('[brrr] budget check error:', e.message));

  // Capture balance snapshot for this period if not yet captured
  try { captureBudgetSnapshotIfNeeded(budget, money); } catch (e) { console.error('[snapshot] error:', e.message); }

  // Auto-email statement for previous period (non-blocking)
  checkAndSendBudgetStatement(budget, money).catch(e => console.error('[statement] email error:', e.message));

  res.json(budget);
});

app.post('/api/budget/categories', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) { budget = seedBudgetDefaults(); }
  const { name, emoji, budgetAmount, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const cat = {
    id: uuidv4(),
    name: name.trim(),
    emoji: emoji || '📦',
    budgetAmount: parseFloat(budgetAmount) || 0,
    color: color || '#6b7280',
    pairedWith: null,
  };
  budget.categories.push(cat);
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

app.put('/api/budget/categories/:id', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const cat = budget.categories.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (req.body.name !== undefined) cat.name = req.body.name.trim();
  if (req.body.emoji !== undefined) cat.emoji = req.body.emoji;
  if (req.body.budgetAmount !== undefined) cat.budgetAmount = parseFloat(req.body.budgetAmount) || 0;
  if (req.body.color !== undefined) cat.color = req.body.color;
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

app.delete('/api/budget/categories/:id', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const idx = budget.categories.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Category not found' });
  const removed = budget.categories[idx];
  // Unlink paired category
  if (removed.pairedWith) {
    const paired = budget.categories.find(c => c.id === removed.pairedWith);
    if (paired) paired.pairedWith = null;
  }
  budget.categories.splice(idx, 1);
  budget.overrides = budget.overrides.filter(o => o.categoryId !== req.params.id);
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

app.post('/api/budget/overrides', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) { budget = seedBudgetDefaults(); }
  const { categoryId, periodStart, manualAmount, note } = req.body;
  if (!categoryId || !periodStart) return res.status(400).json({ error: 'categoryId and periodStart required' });
  // Upsert: find existing override for same category + period
  const existing = budget.overrides.findIndex(o => o.categoryId === categoryId && o.periodStart === periodStart);
  if (existing >= 0) {
    budget.overrides[existing].manualAmount = parseFloat(manualAmount) || 0;
    budget.overrides[existing].note = note || '';
  } else {
    budget.overrides.push({
      id: uuidv4(),
      categoryId,
      periodStart,
      manualAmount: parseFloat(manualAmount) || 0,
      note: note || '',
    });
  }
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

app.delete('/api/budget/overrides/:id', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const idx = budget.overrides.findIndex(o => o.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Override not found' });
  budget.overrides.splice(idx, 1);
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

app.put('/api/budget/reorder', mainAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  let budget = rd(F.budget);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const catMap = new Map(budget.categories.map(c => [c.id, c]));
  budget.categories = ids.map(id => catMap.get(id)).filter(Boolean);
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

// ── Budget: Surplus allocation ──
app.post('/api/budget/allocate', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const { periodStart, allocations } = req.body;
  if (!periodStart || !Array.isArray(allocations)) {
    return res.status(400).json({ error: 'periodStart and allocations[] required' });
  }

  // Compute period end from periodStart
  const psParts = periodStart.split('-');
  const psMs = Date.UTC(+psParts[0], +psParts[1] - 1, +psParts[2], 12);
  const peMs = psMs + 13 * 86400000;
  const periodEnd = utcDateStrServer(new Date(peMs));

  // Calculate surplus amount from allocations
  const surplusAmount = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

  // Append to surplusLog
  if (!budget.surplusLog) budget.surplusLog = [];
  budget.surplusLog.push({
    id: uuidv4(),
    periodStart,
    periodEnd,
    surplusAmount: Math.round(surplusAmount * 100) / 100,
    allocations: allocations.map(a => ({
      type: a.type,
      goalId: a.goalId || null,
      goalName: a.goalName || null,
      investmentId: a.investmentId || null,
      investmentName: a.investmentName || null,
      amount: Math.round((parseFloat(a.amount) || 0) * 100) / 100,
    })),
    loggedAt: Date.now(),
  });

  // Set lastAllocatedPeriod to current period start
  const { periodStart: currentPS } = getBudgetPeriodServer(budget.anchorDate);
  budget.lastAllocatedPeriod = utcDateStrServer(currentPS);

  // Update savings goal balances
  const money = rd(F.money);
  if (money && money.goals) {
    for (const alloc of allocations) {
      if (alloc.type === 'savings' && alloc.goalId) {
        const goal = money.goals.find(g => g.id === alloc.goalId);
        if (goal) {
          const amt = parseFloat(alloc.amount) || 0;
          goal.currentAmount = Math.round((goal.currentAmount + amt) * 100) / 100;
          if (!goal.contributions) goal.contributions = [];
          goal.contributions.push({
            id: uuidv4(),
            amount: amt,
            note: 'Budget surplus allocation',
            date: todayCentral(),
            createdAt: Date.now(),
          });
        }
      }
    }
    wd(F.money, money);
    io.emit('money:updated', money);
  }

  // Update portfolio holding costBasis for investment allocations
  const moneyForInv = money || rd(F.money);
  if (moneyForInv) {
    let moneyChanged = false;
    for (const alloc of allocations) {
      if (alloc.type === 'investment' && alloc.holdingId) {
        const holdings = moneyForInv?.investments?.holdings || [];
        const holding = holdings.find(h => h.id === alloc.holdingId);
        if (holding) {
          holding.costBasis = Math.round(((holding.costBasis || 0) + (parseFloat(alloc.amount) || 0)) * 100) / 100;
          moneyChanged = true;
        }
      }
    }
    if (moneyChanged) {
      wd(F.money, moneyForInv);
      io.emit('money:updated', moneyForInv);
    }
  }

  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

app.post('/api/budget/investments', mainAuth, (req, res) => {
  let budget = rd(F.budget);
  if (!budget) { budget = seedBudgetDefaults(); }
  const { name, platform } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (!budget.investments) budget.investments = [];
  const inv = {
    id: uuidv4(),
    name: name.trim(),
    platform: (platform || '').trim(),
    totalContributed: 0,
  };
  budget.investments.push(inv);
  wd(F.budget, budget);
  io.emit('budget:updated', budget);
  res.json({ success: true, budget });
});

// ── Statement PDF endpoints ──────────────────────────────────────────────────
app.get('/api/budget/statement/:periodStart', mainAuth, async (req, res) => {
  const ps = req.params.periodStart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ps)) return res.status(400).json({ error: 'Invalid date format' });
  try {
    const data = assembleStatementData(ps);
    const pdfBuffer = await generateStatementPDF(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vault-budget-${ps}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('[statement] PDF generation error:', e.message);
    res.status(500).json({ error: 'Failed to generate statement' });
  }
});

app.post('/api/budget/statement/email/:periodStart', mainAuth, async (req, res) => {
  const ps = req.params.periodStart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ps)) return res.status(400).json({ error: 'Invalid date format' });
  try {
    const data = assembleStatementData(ps);
    const ok = await sendStatementNotification(data.periodLabel);
    res.json({ success: ok });
  } catch (e) {
    console.error('[statement] Email error:', e.message);
    res.status(500).json({ error: 'Failed to email statement' });
  }
});

// ── Money: Daily snapshot + recurring auto-log intervals ──
function checkMoneyIntervals() {
  const money = rd(F.money);
  if (!money || !money.setup) return;
  let changed = false;
  // Daily snapshot
  const today = todayCentral();
  if (!money.dailySnapshots.some(s => s.date === today)) {
    takeMoneySnapshot(money);
    changed = true;
  }
  // Portfolio snapshot
  if (!money.investments) money.investments = { holdings: [], snapshots: [] };
  if (money.investments.holdings.length > 0 && !money.investments.snapshots.some(s => s.date === today)) {
    (async () => {
      try {
        let totalValue = 0;
        for (const h of money.investments.holdings) {
          const p = await fetchPrice(h.symbol);
          totalValue += h.shares * (p.price || 0);
        }
        money.investments.snapshots.push({ date: today, totalValue: Math.round(totalValue * 100) / 100 });
        if (money.investments.snapshots.length > 30) money.investments.snapshots = money.investments.snapshots.slice(-30);
        wd(F.money, money);
      } catch (e) { console.error('Portfolio snapshot error:', e.message); }
    })();
  }
  // Recurring auto-log
  for (const rec of (money.recurring || [])) {
    if (rec.nextDate && rec.nextDate <= today) {
      const txn = {
        id: uuidv4(),
        type: 'expense',
        description: rec.description + ' (auto)',
        amount: rec.amount,
        category: rec.category,
        paidBy: rec.paidBy === 'shared' ? 'kaliph' : rec.paidBy,
        split: rec.split || rec.paidBy === 'shared',
        date: today,
        createdAt: Date.now(),
        createdBy: 'system',
        recurringId: rec.id,
      };
      applyTransaction(money, txn);
      money.transactions.push(txn);
      advanceNextDate(rec);
      changed = true;
    }
  }
  if (changed) {
    wd(F.money, money);
    io.emit('money:updated', money);
  }
}
setInterval(checkMoneyIntervals, 3600000); // hourly
checkMoneyIntervals(); // run on startup

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
  let { name, password, expiresIn, expiresAt, channels } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required' });
  name = name.replace(/<[^>]*>/g, '').replace(/[&"'`]/g, c => ({'&':'&amp;','"':'&quot;',"'":'&#x27;','`':'&#x60;'}[c])).trim().substring(0, 50);
  if (!name) return res.status(400).json({ error: 'Invalid name' });
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
  const { channels, password } = req.body;
  let { name } = req.body;
  if (name) {
    name = name.replace(/<[^>]*>/g, '').replace(/[&"'`]/g, c => ({'&':'&amp;','"':'&quot;',"'":'&#x27;','`':'&#x60;'}[c])).trim().substring(0, 50);
    if (name) g.name = name;
  }
  if (Array.isArray(channels) && channels.length) g.channels = channels;
  if (password) g.passwordHash = require('bcryptjs').hashSync(password, 10);
  wd(F.guests, guests);
  io.emit('guest-updated', { guestId: req.params.id, name: g.name, channels: g.channels });
  res.json({ success: true });
});

// Guest avatar upload — guests may only update their own avatar
app.post('/api/guests/:id/avatar', (req, res, next) => {
  if (req.session?.isGuest) return guestAuth(req, res, next);
  return mainAuth(req, res, next);
}, upload.single('avatar'), (req, res) => {
  if (req.session?.isGuest && req.session.guestId !== req.params.id)
    return res.status(403).json({ error: 'Forbidden' });
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

app.get('/api/guests/:id', (req, res, next) => {
  // Route to the appropriate auth guard based on session type
  if (req.session?.isGuest) return guestAuth(req, res, next);
  return mainAuth(req, res, next);
}, (req, res) => {
  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });
  // Guests can only fetch their own record
  if (req.session?.isGuest && req.session.guestId !== req.params.id)
    return res.status(403).json({ error: 'Forbidden' });
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
    // Per-channel message counts so the UI can show a badge
    const messageCount = {};
    Object.keys(g.messages || {}).forEach(ch => {
      messageCount[ch] = (g.messages[ch] || []).length;
    });
    result.push({ id: g.id, name: g.name, avatar: g.avatar || null, channels, messageCount });
  });
  res.json(result);
});

// Guest message reactions
app.post('/api/guests/:guestId/messages/:msgId/react', (req, res, next) => {
  if (req.session?.isGuest) return guestAuth(req, res, next);
  return mainAuth(req, res, next);
}, (req, res) => {
  if (req.session?.isGuest && req.session.guestId !== req.params.guestId)
    return res.status(403).json({ error: 'Forbidden' });
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

// Guest file upload — session-based auth only
app.post('/api/guests/:id/upload', upload.array('files', 10), (req, res) => {
  const isGuestSession = req.session?.isGuest === true && req.session?.guestId === req.params.id;
  if (!isGuestSession && !req.session?.user)
    return res.status(401).json({ error: 'Unauthorized' });
  if (isGuestSession) {
    const gCheck = (rd(F.guests) || {})[req.session.guestId];
    if (!gCheck || !gCheck.active || isGuestExpired(gCheck))
      return res.status(401).json({ error: 'Guest session expired', expired: true });
  }
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
  // Determine whether this is a guest session or a main-user session.
  // The session is the sole authority — no X-Guest-Id header tricks.
  const isGuestSession = req.session?.isGuest === true && !!req.session?.guestId;
  const isMainUser    = !!req.session?.user;

  if (!isGuestSession && !isMainUser)
    return res.status(401).json({ error: 'Unauthorized' });

  // Guests may only post to their own conversation record
  if (isGuestSession) {
    if (req.session.guestId !== req.params.id)
      return res.status(403).json({ error: 'Forbidden' });
    // Live expiry check — do not rely solely on session age
    const gCheck = (rd(F.guests) || {})[req.session.guestId];
    if (!gCheck || !gCheck.active || isGuestExpired(gCheck))
      return res.status(401).json({ error: 'Guest session expired', expired: true });
  }

  const guests = rd(F.guests) || {};
  const g = guests[req.params.id];
  if (!g) return res.status(404).json({ error: 'Not found' });

  const { text, target, sender: clientSender, type, gifUrl, priority, replyTo } = req.body;

  // Validate channel access
  const allowed = g.channels || ['kaliph','kathrine','group'];
  if (isGuestSession && !allowed.includes(target))
    return res.status(403).json({ error: 'No access to this channel' });

  const sender = isGuestSession ? g.name : req.session.user;
  const msg = { id: uuidv4(), sender, text: text || '', timestamp: Date.now(), replyTo: replyTo || null };

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
  // Cap at 200 messages per channel — drop the oldest if over limit
  if (g.messages[target].length >= 200) g.messages[target].shift();
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
    ['money',       F.money],
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
    const result = await handleEvalCommand(raw, parts, cmd, mode, previewUser, req);
    res.json(result);
  } catch (e) {
    console.error('Eval error:', e);
    res.json({ lines: [{ text: `Error: ${e.message}`, cls: 'error' }] });
  }
});

async function handleEvalCommand(raw, parts, cmd, mode, previewUser, req) {
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
      const valid = ['kaliph', 'kathrine', 'royal', 'dark', 'light', 'heaven', 'neon', 'noir', 'rosewood', 'ocean', 'forest', 'arctic', 'aurora', 'sandstone'];
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
    // Ensure the session is authenticated for the app so stealth tab doesn't redirect to login
    // Keep session.user as the real user — stealth target is passed via URL param only
    req.session.authenticated = true;
    if (!req.session.user) req.session.user = 'kaliph'; // fallback — eval doesn't have a profile selected
    await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
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
    // brrr push notification to the recipient — skip if online
    const recipient = user === 'kaliph' ? 'kathrine' : 'kaliph';
    if (onlineUsers[recipient]?.state !== 'online') {
      sendMessageNotification(user, recipient, text);
    }
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

  // ── MONEY ──
  if (cmd === 'money') {
    const sub = parts[1]?.toLowerCase();
    const money = rd(F.money) || {};
    if (!sub || sub === 'status') {
      const k = money.balances?.kaliph?.amount ?? 0;
      const ka = money.balances?.kathrine?.amount ?? 0;
      return { lines: [
        { text: `Kaliph: $${k.toFixed(2)}  |  Kathrine: $${ka.toFixed(2)}  |  Combined: $${(k+ka).toFixed(2)}`, cls: 'success' },
        { text: `Transactions: ${(money.transactions||[]).length}  |  Goals: ${(money.goals||[]).length}  |  Snapshots: ${(money.dailySnapshots||[]).length}  |  Recurring: ${(money.recurring||[]).length}`, cls: 'dim' },
      ]};
    }
    if (sub === 'set') {
      const who = parts[2]?.toLowerCase();
      const amt = parseFloat(parts[3]);
      if (!who || isNaN(amt) || !['kaliph','kathrine'].includes(who)) return lines('Usage: money set <kaliph|kathrine> <amount>', 'warn');
      money.balances[who].amount = Math.round(amt * 100) / 100;
      money.balances[who].updatedAt = Date.now();
      wd(F.money, money);
      io.emit('money:updated', money);
      return lines(`Set ${who}'s balance to $${amt.toFixed(2)}`, 'success');
    }
    if (sub === 'clear') {
      const what = parts[2]?.toLowerCase();
      if (what === 'transactions') { money.transactions = []; wd(F.money, money); io.emit('money:updated', money); return lines('All transactions cleared', 'success'); }
      if (what === 'goals') { money.goals = []; wd(F.money, money); io.emit('money:updated', money); return lines('All goals cleared', 'success'); }
      return lines('Usage: money clear <transactions|goals>', 'warn');
    }
    if (sub === 'portfolio') {
      const psub = parts[2]?.toLowerCase();
      if (!money.investments) money.investments = { holdings: [], snapshots: [] };
      if (!psub) {
        const holdings = money.investments.holdings;
        if (!holdings.length) return lines('No holdings', 'dim');
        const rows = holdings.map(h => [h.symbol, h.name, h.shares.toFixed(4), '$' + h.costBasis.toFixed(2)]);
        return { table: { headers: ['Symbol', 'Name', 'Shares', 'Cost Basis'], rows } };
      }
      if (psub === 'add') {
        const sym = parts[3]?.toUpperCase();
        const shares = parseFloat(parts[4]);
        const cost = parseFloat(parts[5]);
        if (!sym || isNaN(shares)) return lines('Usage: money portfolio add <SYM> <shares> <cost>', 'warn');
        money.investments.holdings.push({ id: uuidv4(), symbol: sym, name: sym, shares, costBasis: cost || 0, addedAt: Date.now() });
        wd(F.money, money); io.emit('money:updated', money);
        return lines(`Added ${shares} shares of ${sym}`, 'success');
      }
      if (psub === 'remove') {
        const sym = parts[3]?.toUpperCase();
        if (!sym) return lines('Usage: money portfolio remove <SYM>', 'warn');
        const idx = money.investments.holdings.findIndex(h => h.symbol === sym);
        if (idx < 0) return lines(`No holding for ${sym}`, 'error');
        money.investments.holdings.splice(idx, 1);
        wd(F.money, money); io.emit('money:updated', money);
        return lines(`Removed ${sym}`, 'success');
      }
      if (psub === 'clear') {
        money.investments.holdings = [];
        money.investments.snapshots = [];
        wd(F.money, money); io.emit('money:updated', money);
        return lines('Portfolio cleared', 'success');
      }
      return lines('Usage: money portfolio [add|remove|clear]', 'warn');
    }
    if (sub === 'reset') {
      const defaultMoney = { setup: false, balances: { kaliph: { amount: 0, updatedAt: null }, kathrine: { amount: 0, updatedAt: null } }, dailySnapshots: [], transactions: [], goals: [], recurring: [], investments: { holdings: [], snapshots: [] } };
      wd(F.money, defaultMoney);
      io.emit('money:updated', defaultMoney);
      return lines('Money dashboard factory reset. Next open will show setup screen.', 'success');
    }
    if (sub === 'snapshots') {
      const snaps = (money.dailySnapshots || []).slice(-10);
      if (!snaps.length) return lines('No snapshots yet', 'dim');
      const rows = snaps.map(s => [s.date, '$' + s.kaliph.toFixed(2), '$' + s.kathrine.toFixed(2), '$' + (s.kaliph + s.kathrine).toFixed(2)]);
      return { table: { headers: ['Date', 'Kaliph', 'Kathrine', 'Combined'], rows } };
    }
    return lines('Usage: money [status|set|clear|snapshots|portfolio|reset]', 'warn');
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

  // ── BRIEFING FEEDBACK ──
  if (cmd === 'feedback') {
    const sub = parts[1]?.toLowerCase();

    if (sub === 'delete') {
      const id = parts[2];
      if (!id) return lines('Usage: feedback delete <id>', 'warn');
      if (!db.pool) return lines('No database configured', 'error');
      try {
        const result = await db.query('DELETE FROM briefing_feedback WHERE id = $1 RETURNING id, feedback_type, section, highlighted_text', [id]);
        if (!result.rows.length) return lines(`Feedback #${id} not found`, 'error');
        const r = result.rows[0];
        const desc = r.section || r.highlighted_text || r.feedback_type;
        return lines(`Deleted feedback #${r.id}: ${desc}`, 'success');
      } catch (e) {
        return lines('DB error: ' + e.message, 'error');
      }
    }

    if (sub === 'clear') {
      const who = parts[2]?.toLowerCase();
      if (!who || !['kaliph', 'kathrine', 'all'].includes(who)) return lines('Usage: feedback clear <kaliph|kathrine|all>', 'warn');
      if (!db.pool) return lines('No database configured', 'error');
      try {
        let result;
        if (who === 'all') {
          result = await db.query('DELETE FROM briefing_feedback RETURNING id');
        } else {
          result = await db.query('DELETE FROM briefing_feedback WHERE user_id = $1 RETURNING id', [who]);
        }
        return lines(`Deleted ${result.rowCount} feedback entries${who !== 'all' ? ' for ' + who : ''}`, 'success');
      } catch (e) {
        return lines('DB error: ' + e.message, 'error');
      }
    }

    // Default: list feedback — returns HTML for popup
    const who = sub?.toLowerCase();
    if (who && !['kaliph', 'kathrine'].includes(who)) return lines('Usage: feedback [kaliph|kathrine]', 'warn');
    if (!db.pool) return lines('No database configured', 'error');
    try {
      let result;
      if (who) {
        result = await db.query(
          `SELECT id, user_id, briefing_date, feedback_type, section, highlighted_text, note, permanent, consolidated, created_at
           FROM briefing_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [who]
        );
      } else {
        result = await db.query(
          `SELECT id, user_id, briefing_date, feedback_type, section, highlighted_text, note, permanent, consolidated, created_at
           FROM briefing_feedback ORDER BY created_at DESC LIMIT 100`
        );
      }
      if (!result.rows.length) return lines(who ? `No feedback for ${who}` : 'No feedback found', 'dim');

      // Build HTML popup content
      let rows = '';
      for (const r of result.rows) {
        const date = new Date(r.briefing_date).toISOString().slice(0, 10);
        const type = r.feedback_type.replace(/_/g, ' ');
        const flags = [];
        if (r.permanent) flags.push('PERM');
        if (r.consolidated) flags.push('CONS');
        const flagStr = flags.length ? `<span class="fb-flags">${flags.join(' ')}</span>` : '';
        const section = r.section ? `<span class="fb-section">[${r.section}]</span>` : '';
        const highlight = r.highlighted_text ? `<span class="fb-highlight">"${r.highlighted_text.length > 60 ? r.highlighted_text.slice(0, 60) + '...' : r.highlighted_text}"</span>` : '';
        const note = r.note ? `<span class="fb-note">${r.note.length > 80 ? r.note.slice(0, 80) + '...' : r.note}</span>` : '';
        rows += `<tr>
          <td class="fb-id">${r.id}</td>
          <td class="fb-user">${r.user_id}</td>
          <td class="fb-date">${date}</td>
          <td class="fb-type fb-type-${r.feedback_type}">${type}</td>
          <td>${section}${highlight}${note}</td>
          <td>${flagStr}</td>
          <td><button class="fb-del-btn" onclick="execFeedbackDelete(${r.id})">del</button></td>
        </tr>`;
      }

      const html = `__FEEDBACK_POPUP__${result.rows.length}|${who || 'all'}|${rows}`;
      return { html };
    } catch (e) {
      return lines('DB error: ' + e.message, 'error');
    }
  }

  // ── K-108 Commands ──
  if (cmd === 'k108') {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'reset-passcode') {
      const target = parts[2]?.toLowerCase();
      if (!target || !['kaliph', 'kathrine'].includes(target)) {
        return lines('Usage: k108 reset-passcode [kaliph|kathrine]', 'warn');
      }
      await deleteK108Passcode(target);
      return multi(
        [`K-108 passcode reset for ${target}`, 'success'],
        ['Next login will prompt for new passcode setup', 'info']
      );
    }
    return multi(
      ['K-108 Commands:', 'header'],
      ['  k108 reset-passcode [kaliph|kathrine]  — Reset K-108 passcode', 'info']
    );
  }

  return lines(`Unknown command: "${raw}". Type "help" for commands.`, 'error');
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEBRIEF — "My Year: A Debrief" presentation
// ═══════════════════════════════════════════════════════════════════════════════

const DEBRIEF_CONTENT_FILE = path.join(DATA_DIR, 'debrief-content.json');
const DEBRIEF_CONFIG_FILE  = path.join(DATA_DIR, 'debrief-config.json');
const DEBRIEF_UPLOADS_DIR  = path.join(__dirname, 'uploads', 'debrief');
fs.ensureDirSync(DEBRIEF_UPLOADS_DIR);
fs.ensureDirSync(path.join(DEBRIEF_UPLOADS_DIR, 'audio'));
fs.ensureDirSync(path.join(DEBRIEF_UPLOADS_DIR, 'covers'));

// One-time startup migration: recompress any existing photos larger than 300 KB
// Runs in background so it doesn't delay server startup
(async () => {
  if (!sharp) return;
  try {
    const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const SIZE_THRESHOLD = 300 * 1024; // only recompress if > 300 KB
    const dirs = await fs.readdir(DEBRIEF_UPLOADS_DIR);
    for (const dir of dirs) {
      if (dir === 'audio' || dir === 'covers') continue;
      const monthDir = path.join(DEBRIEF_UPLOADS_DIR, dir);
      const stat = await fs.stat(monthDir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const files = await fs.readdir(monthDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        const filePath = path.join(monthDir, file);
        const fstat = await fs.stat(filePath).catch(() => null);
        if (!fstat || fstat.size <= SIZE_THRESHOLD) continue;
        console.log(`[debrief] recompressing ${file} (${Math.round(fstat.size/1024)} KB)`);
        await optimisePhoto(filePath);
      }
    }
    console.log('[debrief] photo migration complete');
  } catch (e) {
    console.warn('[debrief] migration error:', e.message);
  }
})();

// Serve uploaded debrief photos — 7-day cache so repeat visits load instantly
app.use('/uploads/debrief', express.static(DEBRIEF_UPLOADS_DIR, { maxAge: '7d', immutable: false }));

// Debrief multer setup
const debriefStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const monthDir = path.join(DEBRIEF_UPLOADS_DIR, req.params.monthId);
    fs.ensureDirSync(monthDir);
    cb(null, monthDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const debriefUpload = multer({
  storage: debriefStorage,
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic|heif|mp4|mov|webm|m4v|avi|quicktime/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});

// In-memory cache for debrief data (loaded from DB on startup)
let _debriefContent = {};
let _debriefConfig = {};
let _debriefFilesCache = {}; // { 'audio/sep-2024.mp3': Buffer, ... }

function readDebriefContent() { return _debriefContent; }
function writeDebriefContent(data) {
  _debriefContent = data;
  // Persist to file (local dev) + DB (production)
  try { fs.writeFileSync(DEBRIEF_CONTENT_FILE, JSON.stringify(data, null, 2)); } catch {}
  db.write('debrief-content', data).catch(e => console.error('[debrief] db write content:', e.message));
}
function readDebriefConfig() { return _debriefConfig; }
function writeDebriefConfig(data) {
  _debriefConfig = data;
  try { fs.writeFileSync(DEBRIEF_CONFIG_FILE, JSON.stringify(data, null, 2)); } catch {}
  db.write('debrief-config', data).catch(e => console.error('[debrief] db write config:', e.message));
}

// Store a file in DB as base64 for persistence across deploys
// Store file to DB in chunks to avoid OOM on large files.
// Each chunk is ~1MB of raw data (~1.33MB as base64).
const DB_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks
const nodeFs = require('fs').promises; // Node native fs.promises for FileHandle API

async function storeDebriefFile(filePath, bufferOrPath) {
  if (typeof bufferOrPath === 'string') {
    // It's a file path — read in chunks from disk (never loads full file into RAM)
    const stat = await fs.stat(bufferOrPath);
    const totalChunks = Math.ceil(stat.size / DB_CHUNK_SIZE);

    // Delete old chunks/legacy entries
    try {
      await db.query("DELETE FROM data_store WHERE key = $1 OR key LIKE $2",
        [`debrief-file:${filePath}`, `debrief-file:${filePath}:chunk:%`]);
    } catch (e) { /* table might not exist yet */ }

    // Store metadata
    await db.write(`debrief-file:${filePath}`, { chunked: true, chunks: totalChunks, size: stat.size });

    // Read and store one chunk at a time using Node's FileHandle API
    const fh = await nodeFs.open(bufferOrPath, 'r');
    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunkBuf = Buffer.alloc(Math.min(DB_CHUNK_SIZE, stat.size - i * DB_CHUNK_SIZE));
        await fh.read(chunkBuf, 0, chunkBuf.length, i * DB_CHUNK_SIZE);
        await db.write(`debrief-file:${filePath}:chunk:${i}`, { data: chunkBuf.toString('base64') });
      }
    } finally {
      await fh.close();
    }
    console.log(`[debrief] Stored ${filePath} to DB (${totalChunks} chunks, ${Math.round(stat.size / 1024)}KB)`);
    return;
  }

  // Buffer passed directly (small files / legacy callers)
  const buffer = bufferOrPath;
  if (buffer.length <= DB_CHUNK_SIZE) {
    await db.write(`debrief-file:${filePath}`, { data: buffer.toString('base64'), size: buffer.length });
  } else {
    const totalChunks = Math.ceil(buffer.length / DB_CHUNK_SIZE);
    try {
      await db.query("DELETE FROM data_store WHERE key = $1 OR key LIKE $2",
        [`debrief-file:${filePath}`, `debrief-file:${filePath}:chunk:%`]);
    } catch (e) { /* ignore */ }
    await db.write(`debrief-file:${filePath}`, { chunked: true, chunks: totalChunks, size: buffer.length });
    for (let i = 0; i < totalChunks; i++) {
      const start = i * DB_CHUNK_SIZE;
      const chunk = buffer.slice(start, start + DB_CHUNK_SIZE);
      await db.write(`debrief-file:${filePath}:chunk:${i}`, { data: chunk.toString('base64') });
    }
    console.log(`[debrief] Stored ${filePath} to DB (${totalChunks} chunks, ${Math.round(buffer.length / 1024)}KB)`);
  }
}

// Restore all debrief files from DB to disk on startup
async function restoreDebriefFiles() {
  try {
    if (!db.pool) return;
    const result = await db.query(
      "SELECT key, value FROM data_store WHERE key LIKE 'debrief-file:%' AND key NOT LIKE '%:chunk:%'"
    );
    for (const row of result.rows) {
      const filePath = row.key.replace('debrief-file:', '');
      const fullPath = path.join(DEBRIEF_UPLOADS_DIR, filePath);
      fs.ensureDirSync(path.dirname(fullPath));
      const meta = JSON.parse(row.value);

      if (meta.chunked) {
        // Reassemble from chunks — write one chunk at a time to save memory
        const fh = await nodeFs.open(fullPath, 'w');
        try {
          for (let i = 0; i < meta.chunks; i++) {
            const chunkRow = await db.read(`debrief-file:${filePath}:chunk:${i}`);
            if (chunkRow && chunkRow.data) {
              await fh.write(Buffer.from(chunkRow.data, 'base64'));
            }
          }
        } finally {
          await fh.close();
        }
        console.log(`[debrief] Restored chunked file: ${filePath} (${meta.chunks} chunks)`);
      } else if (meta.data) {
        // Legacy single-row format
        fs.writeFileSync(fullPath, Buffer.from(meta.data, 'base64'));
        console.log(`[debrief] Restored file: ${filePath}`);
      }
    }
  } catch (e) {
    console.error('[debrief] Error restoring files:', e.message);
  }
}

// Load debrief data from DB on startup
async function initDebriefData() {
  try {
    if (db.pool) {
      const content = await db.read('debrief-content');
      if (content) _debriefContent = content;
      const config = await db.read('debrief-config');
      if (config) _debriefConfig = config;
      await restoreDebriefFiles();
      console.log('[debrief] Data loaded from database');
    } else {
      // Fallback to file
      _debriefContent = fs.existsSync(DEBRIEF_CONTENT_FILE) ? JSON.parse(fs.readFileSync(DEBRIEF_CONTENT_FILE, 'utf8')) : {};
      _debriefConfig = fs.existsSync(DEBRIEF_CONFIG_FILE) ? JSON.parse(fs.readFileSync(DEBRIEF_CONFIG_FILE, 'utf8')) : {};
    }
  } catch (e) {
    console.error('[debrief] Init error:', e.message);
  }
}
initDebriefData();

// Debrief passwords (env vars with hard-coded defaults)
const DEBRIEF_PASSWORDS = {
  presenter: process.env.DEBRIEF_PRESENTER_PASSWORD || 'presenting',
  viewer:    process.env.DEBRIEF_VIEWER_PASSWORD    || 'kat',
  editor:    process.env.DEBRIEF_EDITOR_PASSWORD    || 'editing'
};

// Debrief presenter state (in-memory)
let debriefPresenterState = { slideIndex: 0, revealStep: 0, connected: false, socketId: null };

// POST /api/debrief/auth — password check
app.post('/api/debrief/auth', (req, res) => {
  const { password } = req.body;
  if (!password) return res.json({ role: null });
  if (password === DEBRIEF_PASSWORDS.presenter) return res.json({ role: 'presenter' });
  if (password === DEBRIEF_PASSWORDS.viewer)    return res.json({ role: 'viewer' });
  if (password === DEBRIEF_PASSWORDS.editor)    return res.json({ role: 'editor' });
  return res.json({ role: null });
});

// GET /api/debrief/content — load saved content
app.get('/api/debrief/content', (_req, res) => {
  res.json(readDebriefContent());
});

// POST /api/debrief/content — save edited content
app.post('/api/debrief/content', (req, res) => {
  writeDebriefContent(req.body);
  res.json({ ok: true });
});

// GET /api/debrief/config — load config
app.get('/api/debrief/config', (_req, res) => {
  res.json(readDebriefConfig());
});

// POST /api/debrief/config — save config
app.post('/api/debrief/config', (req, res) => {
  writeDebriefConfig(req.body);
  res.json({ ok: true });
});

// POST /api/debrief/upload/:monthId — upload photos (HEIC auto-converted to JPEG)
// Processes one file per request for progress tracking; responds fast, DB store in background
app.post('/api/debrief/upload/:monthId', debriefUpload.array('photos', 50), async (req, res) => {
  try {
    const { monthId } = req.params;
    const content = readDebriefContent();
    if (!content.months) content.months = {};
    if (!content.months[monthId]) content.months[monthId] = {};
    if (!content.months[monthId].photos) content.months[monthId].photos = [];

    const newFiles = [];
    const videoFilesToTranscode = [];

    for (const f of (req.files || [])) {
      const isVideo = VIDEO_EXTS.has(path.extname(f.originalname).toLowerCase());
      if (isVideo) {
        // Save original filename immediately so the file exists and is playable right away.
        // After background transcoding completes, content is updated to the _web.mp4 name.
        const originalName = path.basename(f.path);
        const transcodedName = ffmpeg
          ? originalName.replace(/\.[^.]+$/, '_web.mp4')
          : null;
        newFiles.push(originalName);
        videoFilesToTranscode.push({ inputPath: f.path, originalName, transcodedName, monthId });
      } else {
        const heicPath = await convertHeicIfNeeded(f.path);
        const finalPath = await optimisePhoto(heicPath);
        const finalName = path.basename(finalPath);
        newFiles.push(finalName);
      }
    }

    content.months[monthId].photos.push(...newFiles);
    writeDebriefContent(content);

    // Respond immediately — persist to DB in background
    res.json({ ok: true, files: newFiles });

    // Background: transcode videos (avoids proxy timeout) — too large for DB storage.
    // On completion, swap the original filename in content for the transcoded _web.mp4 name.
    for (const { inputPath, originalName, transcodedName, monthId: mid } of videoFilesToTranscode) {
      if (!transcodedName) continue; // ffmpeg unavailable — original served as-is
      transcodeVideo(inputPath).then(() => {
        console.log(`[debrief] background transcode done: ${transcodedName}`);
        // Update content to point at the transcoded file
        const c = readDebriefContent();
        const photos = c.months?.[mid]?.photos;
        if (photos) {
          const idx = photos.indexOf(originalName);
          if (idx !== -1) photos[idx] = transcodedName;
          writeDebriefContent(c);
        }
      }).catch(e => console.error('[debrief] background transcode error:', e.message));
    }
    // Background: store photo files to DB (skip videos — handled above)
    for (let i = 0; i < (req.files || []).length; i++) {
      const f = req.files[i];
      if (VIDEO_EXTS.has(path.extname(f.originalname).toLowerCase())) continue;
      const finalName = newFiles[i];
      if (!finalName) continue;
      const finalPath = path.join(path.dirname(f.path), finalName);
      storeDebriefFile(`${monthId}/${finalName}`, finalPath).catch(e => console.error('[debrief] DB store photo:', e.message));
    }
  } catch (e) {
    console.error('[debrief] upload error:', e.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/debrief/upload-audio/:monthId — upload audio file for a month
const debriefAudioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(DEBRIEF_UPLOADS_DIR, 'audio'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Unique name so replacing audio always busts the browser cache
    cb(null, `${req.params.monthId}-${Date.now()}${ext}`);
  }
});
const debriefAudioUpload = multer({
  storage: debriefAudioStorage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

app.post('/api/debrief/upload-audio/:monthId', (req, res) => {
  try {
    debriefAudioUpload.single('audio')(req, res, (err) => {
      try {
        if (err) {
          console.error('Audio upload multer error:', err.message);
          return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'No audio file received. Supported: mp3, m4a, ogg, wav' });
        const { monthId } = req.params;
        console.log(`Audio uploaded: ${req.file.filename} for ${monthId} (${req.file.size} bytes)`);
        const content = readDebriefContent();
        if (!content.months) content.months = {};
        if (!content.months[monthId]) content.months[monthId] = {};
        // Delete old audio file so it doesn't accumulate
        const oldAudio = content.months[monthId].audioFile;
        if (oldAudio && oldAudio !== req.file.filename) {
          fs.remove(path.join(DEBRIEF_UPLOADS_DIR, 'audio', oldAudio)).catch(() => {});
        }
        content.months[monthId].audioFile = req.file.filename;
        writeDebriefContent(content);
        // Respond immediately — persist to DB in background only if small enough
        res.json({ ok: true, filename: req.file.filename });
        // Background: chunk-store to DB (streams from disk, no OOM)
        storeDebriefFile(`audio/${req.file.filename}`, req.file.path)
          .catch(e => console.error('[debrief] DB store audio:', e.message));
      } catch (innerErr) {
        console.error('Audio upload handler error:', innerErr);
        if (!res.headersSent) res.status(500).json({ error: 'Server error during upload' });
      }
    });
  } catch (outerErr) {
    console.error('Audio upload outer error:', outerErr);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/debrief/upload-gate-audio — upload gate screen song
app.post('/api/debrief/upload-gate-audio', (req, res) => {
  try {
    debriefAudioUpload.single('audio')(req, res, (err) => {
      try {
        // Override the filename to always be gate-song.*
        if (err) {
          console.error('Gate audio upload error:', err.message);
          return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'No audio file received' });
        // Use a unique filename so the 7-day browser cache never serves a stale file
        const ext = path.extname(req.file.originalname).toLowerCase();
        const newName = `gate-song-${uuidv4()}${ext}`;
        const oldPath = req.file.path;
        const newPath = path.join(path.dirname(oldPath), newName);
        fs.renameSync(oldPath, newPath);
        console.log(`Gate audio uploaded: ${newName} (${req.file.size} bytes)`);
        const cfg = readDebriefConfig();
        // Delete the previous gate song file to avoid accumulating old files
        if (cfg.gateSongFile && cfg.gateSongFile !== newName) {
          fs.remove(path.join(DEBRIEF_UPLOADS_DIR, 'audio', cfg.gateSongFile)).catch(() => {});
        }
        cfg.gateSongFile = newName;
        writeDebriefConfig(cfg);
        res.json({ ok: true, filename: newName });
        // Background DB store — skip if too large
        storeDebriefFile(`audio/${newName}`, newPath)
          .catch(e => console.error('[debrief] DB store gate audio:', e.message));
      } catch (innerErr) {
        console.error('Gate audio upload handler error:', innerErr);
        if (!res.headersSent) res.status(500).json({ error: 'Server error during upload' });
      }
    });
  } catch (outerErr) {
    console.error('Gate audio upload outer error:', outerErr);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/debrief/upload-cover/:monthId — upload cover art for a month
const debriefCoverStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(DEBRIEF_UPLOADS_DIR, 'covers'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.params.monthId}${ext}`);
  }
});
const debriefCoverUpload = multer({
  storage: debriefCoverStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

app.post('/api/debrief/upload-cover/:monthId', (req, res) => {
  try {
    debriefCoverUpload.single('cover')(req, res, async (err) => {
      try {
        if (err) {
          console.error('Cover upload multer error:', err.message);
          return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'No cover file received' });
        const { monthId } = req.params;
        const finalPath = await convertHeicIfNeeded(req.file.path);
        const finalName = path.basename(finalPath);
        console.log(`Cover uploaded: ${finalName} for ${monthId}`);
        const content = readDebriefContent();
        if (!content.months) content.months = {};
        if (!content.months[monthId]) content.months[monthId] = {};
        content.months[monthId].coverFile = finalName;
        writeDebriefContent(content);
        res.json({ ok: true, filename: finalName });
        storeDebriefFile(`covers/${finalName}`, finalPath)
          .catch(e => console.error('[debrief] DB store cover:', e.message));
      } catch (innerErr) {
        console.error('Cover upload handler error:', innerErr);
        if (!res.headersSent) res.status(500).json({ error: 'Server error during upload' });
      }
    });
  } catch (outerErr) {
    console.error('Cover upload outer error:', outerErr);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/debrief/photo — delete a specific photo
app.delete('/api/debrief/photo', (req, res) => {
  const { monthId, filename } = req.body;
  if (!monthId || !filename) return res.status(400).json({ error: 'Missing monthId or filename' });

  // Delete file from disk
  const filePath = path.join(DEBRIEF_UPLOADS_DIR, monthId, filename);
  try { fs.removeSync(filePath); } catch {}

  // Delete from DB
  db.query("DELETE FROM data_store WHERE key = $1", [`debrief-file:${monthId}/${filename}`]).catch(() => {});

  // Remove from content JSON
  const content = readDebriefContent();
  if (content.months && content.months[monthId] && content.months[monthId].photos) {
    content.months[monthId].photos = content.months[monthId].photos.filter(p => p !== filename);
    writeDebriefContent(content);
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// K-108 INTELLIGENCE PLATFORM
// ═══════════════════════════════════════════════════════════════════════════════

const PLATETOVIN_API_KEY = process.env.PLATETOVIN_API_KEY || '';
const AUTODEV_API_KEY = process.env.AUTODEV_API_KEY || '';

const k108Tokens = new Map(); // token -> username
const k108RateMap = new Map(); // token -> { count, resetAt }
const K108_USERS_FILE = path.join(DATA_DIR, 'k108-users.json');

// ── K-108 Quota helpers ──────────────────────────────────────────────────────
function getK108Quota(name) {
  const file = path.join(DATA_DIR, `k108-${name}-quota.json`);
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const defaults = { lookup: { total: 50, used: 0 }, sms: { total: 50, used: 0 } };
  return defaults[name] || { total: 50, used: 0 };
}

function saveK108Quota(name, q) {
  fs.writeFileSync(path.join(DATA_DIR, `k108-${name}-quota.json`), JSON.stringify(q, null, 2));
}

// Vehicle quota (PlateToVIN — 5 free/month, resets monthly)
const K108_VEHICLE_QUOTA_FILE = path.join(DATA_DIR, 'k108-vehicle-quota.json');
function getVehicleQuota() {
  const month = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  try {
    if (fs.existsSync(K108_VEHICLE_QUOTA_FILE)) {
      const q = JSON.parse(fs.readFileSync(K108_VEHICLE_QUOTA_FILE, 'utf8'));
      if (q.month === month) return q;
    }
  } catch(e) {}
  return { month, used: 0, total: 5 };
}
function saveVehicleQuota(q) { fs.writeFileSync(K108_VEHICLE_QUOTA_FILE, JSON.stringify(q, null, 2)); }
function useVehicleQuota() { const q = getVehicleQuota(); q.used++; saveVehicleQuota(q); return q; }

function useK108Quota(name) {
  const q = getK108Quota(name);
  if (q.used >= q.total) return false;
  q.used++;
  saveK108Quota(name, q);
  return true;
}

// ── K-108 Auth ───────────────────────────────────────────────────────────────
function getK108LocalPassword() {
  const s = rd(F.settings);
  return (s && s.k108Password) || 'Command';
}

async function getK108User(username) {
  if (db.pool) {
    const r = await db.query('SELECT * FROM k108_users WHERE username = $1', [username]);
    return r.rows[0] || null;
  }
  try {
    if (fs.existsSync(K108_USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(K108_USERS_FILE, 'utf8'));
      return data[username] ? { username, passcode_hash: data[username].passcode_hash } : null;
    }
  } catch (e) {}
  return null;
}

async function setK108Passcode(username, hash) {
  if (db.pool) {
    await db.query(
      `INSERT INTO k108_users (username, passcode_hash, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (username) DO UPDATE SET passcode_hash = $2, updated_at = NOW()`,
      [username, hash]
    );
  } else {
    let data = {};
    try { if (fs.existsSync(K108_USERS_FILE)) data = JSON.parse(fs.readFileSync(K108_USERS_FILE, 'utf8')); } catch (e) {}
    data[username] = { passcode_hash: hash, updated_at: Date.now() };
    fs.writeFileSync(K108_USERS_FILE, JSON.stringify(data, null, 2));
  }
}

async function deleteK108Passcode(username) {
  if (db.pool) {
    await db.query('DELETE FROM k108_users WHERE username = $1', [username]);
  } else {
    try {
      if (fs.existsSync(K108_USERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(K108_USERS_FILE, 'utf8'));
        delete data[username];
        fs.writeFileSync(K108_USERS_FILE, JSON.stringify(data, null, 2));
      }
    } catch (e) {}
  }
}

// Returns username string or null (sends 401 on failure)
function k108Auth(req, res) {
  const token = req.body.token;
  if (!k108Tokens.has(token)) {
    res.status(401).json({ error: 'Session expired', reauth: true });
    return null;
  }
  return k108Tokens.get(token);
}

function k108RateCheck(token) {
  const now = Date.now();
  let entry = k108RateMap.get(token);
  if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + 5 * 60 * 1000 }; }
  entry.count++;
  k108RateMap.set(token, entry);
  return entry.count <= 20;
}

// ── K-108 Activity Log ───────────────────────────────────────────────────────
const K108_LOG_FILE = path.join(DATA_DIR, 'k108-log.json');
function getK108LogEntries() {
  try { if (fs.existsSync(K108_LOG_FILE)) return JSON.parse(fs.readFileSync(K108_LOG_FILE, 'utf8')); } catch(e) {}
  return [];
}

async function k108Log(username, actionType, detail, ip) {
  if (db.pool) {
    try {
      await db.query(
        'INSERT INTO k108_activity_log (username, action_type, detail, ip) VALUES ($1, $2, $3, $4)',
        [username, actionType, JSON.stringify(detail || {}), ip || '']
      );
    } catch (e) { console.error('[k108] log error:', e.message); }
  } else {
    const entries = getK108LogEntries();
    entries.unshift({ id: Date.now(), username, action_type: actionType, detail: detail || {}, ip: ip || '', created_at: new Date().toISOString() });
    if (entries.length > 200) entries.length = 200;
    fs.writeFileSync(K108_LOG_FILE, JSON.stringify(entries, null, 2));
  }
}

// ── K-108 Auth Routes ────────────────────────────────────────────────────────
app.get('/api/k108/whoami', (req, res) => {
  res.json({ user: req.session && req.session.user || null });
});

// Check if user needs to set up a passcode (no passcode entered, just a status check)
app.get('/api/k108/auth-check', async (req, res) => {
  const username = req.session && req.session.user;
  if (!db.pool || !username) {
    // Local mode - passcode is always set (from settings), just needs entry
    return res.json({ needsSetup: false });
  }
  const user = await getK108User(username);
  res.json({ needsSetup: !user });
});

app.post('/api/k108/auth', async (req, res) => {
  const username = req.session && req.session.user;
  const { passcode } = req.body;

  // Local fallback (no database or no site session)
  if (!db.pool || !username) {
    const localUser = username || 'kaliph';
    if (passcode === getK108LocalPassword()) {
      const token = uuidv4();
      k108Tokens.set(token, localUser);
      await k108Log(localUser, 'session_entry', {}, req.ip);
      return res.json({ token, username: localUser });
    }
    return res.status(403).json({ error: 'ACCESS DENIED // Credentials do not match any authorized personnel' });
  }

  const user = await getK108User(username);
  if (!user) return res.json({ needsSetup: true });

  if (!passcode) return res.status(400).json({ error: 'Passcode required' });
  const match = await bcrypt.compare(passcode, user.passcode_hash);
  if (!match) return res.status(403).json({ error: 'ACCESS DENIED // Credentials do not match any authorized personnel' });

  const token = uuidv4();
  k108Tokens.set(token, username);
  await k108Log(username, 'session_entry', {}, req.ip);
  res.json({ token, username });
});

app.post('/api/k108/set-passcode', async (req, res) => {
  const username = req.session && req.session.user;
  if (!username && db.pool) return res.status(401).json({ error: 'Log in to the main vault first' });
  const { passcode, confirm } = req.body;
  if (!passcode || passcode.length < 1) return res.status(400).json({ error: 'Passcode required' });
  if (passcode !== confirm) return res.status(400).json({ error: 'Passcodes do not match' });

  const hash = await bcrypt.hash(passcode, 10);
  await setK108Passcode(username, hash);

  const token = uuidv4();
  k108Tokens.set(token, username);
  await k108Log(username, 'session_entry', { firstSetup: true }, req.ip);
  res.json({ token, username });
});

// ── K-108 Activity Log Route ─────────────────────────────────────────────────
app.post('/api/k108/log', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const page = parseInt(req.body.page) || 0;
  const limit = Math.min(parseInt(req.body.limit) || 50, 200);
  if (db.pool) {
    const r = await db.query(
      'SELECT * FROM k108_activity_log ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, page * limit]
    );
    return res.json({ entries: r.rows });
  }
  const all = getK108LogEntries();
  res.json({ entries: all.slice(page * limit, (page + 1) * limit) });
});

// ── Whitepages Pro API adapter ────────────────────────────────────────────────
const WP_API_KEY = process.env.WHITEPAGES_API_KEY || '';
const WP_BASE = 'https://api.whitepages.com/v2';

async function wpFetch(endpoint, params) {
  if (!WP_API_KEY) return { source: 'whitepages', status: 'not_configured', results: [] };
  try {
    const qs = new URLSearchParams(params).toString();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const resp = await nodeFetch(`${WP_BASE}/${endpoint}?${qs}`, {
      signal: ctrl.signal,
      headers: { 'X-Api-Key': WP_API_KEY }
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { source: 'whitepages', status: 'error', error: `HTTP ${resp.status}: ${errText}`, results: [] };
    }
    const data = await resp.json();
    return { source: 'whitepages', status: 'ok', raw: data };
  } catch (e) {
    return { source: 'whitepages', status: 'error', error: e.message, results: [] };
  }
}

async function searchPeopleByName(firstName, lastName, city, state) {
  const params = { name: `${firstName} ${lastName}`.trim() };
  if (city) params.city = city;
  if (state) params.state_code = state;
  return wpFetch('person', params);
}

async function searchPeopleByPhone(phone) {
  return wpFetch('phone', { phone: phone });
}

async function searchPeopleByAddress(street, city, state, zip) {
  const params = { street_line_1: street };
  if (city) params.city = city;
  if (state) params.state_code = state;
  if (zip) params.postal_code = zip;
  return wpFetch('address', params);
}

function normalizeResults(apiResult) {
  if (!apiResult || apiResult.status !== 'ok' || !apiResult.raw) return [];
  const raw = apiResult.raw;
  console.log('[K108] Whitepages raw keys:', Object.keys(raw));
  if (raw.person) console.log('[K108] raw.person type:', typeof raw.person, Array.isArray(raw.person) ? 'array len=' + raw.person.length : '');
  if (raw.results) console.log('[K108] raw.results type:', typeof raw.results, Array.isArray(raw.results) ? 'array len=' + raw.results.length : '');

  // Whitepages v3 returns person data in various structures depending on endpoint
  let people = [];

  // find_person returns { person: [...] } or { results: [...] }
  if (raw.person) people = Array.isArray(raw.person) ? raw.person : [raw.person];
  else if (raw.results) people = Array.isArray(raw.results) ? raw.results : [raw.results];
  else if (raw.people) people = raw.people;
  // reverse_phone returns { belongs_to: [...], current_addresses: [...] }
  else if (raw.belongs_to) {
    const owners = Array.isArray(raw.belongs_to) ? raw.belongs_to : [raw.belongs_to];
    people = owners.map(o => ({
      ...o,
      _addresses: raw.current_addresses || [],
      _phone: raw.phone_number || ''
    }));
  }
  // address lookup returns { current_residents: [...] }
  else if (raw.current_residents) {
    const residents = Array.isArray(raw.current_residents) ? raw.current_residents : [raw.current_residents];
    people = residents.map(r => ({
      ...r,
      _addresses: raw.address ? [raw.address] : []
    }));
  }
  // If the raw response itself looks like a single person record
  else if (raw.name || raw.firstname || raw.first_name) {
    people = [raw];
  }

  return people.filter(Boolean).map(p => {
    // Extract name
    const fn = p.firstname || p.first_name || p.FirstName || (p.name && typeof p.name === 'object' ? (p.name.first_name || p.name.first) : '') || '';
    const ln = p.lastname || p.last_name || p.LastName || (p.name && typeof p.name === 'object' ? (p.name.last_name || p.name.last) : '') || '';
    const full = p.name && typeof p.name === 'string' ? p.name
      : p.full_name || p.fullName || p.best_name || `${fn} ${ln}`.trim();

    // Extract age
    const age = p.age_range || p.age || p.Age || (p.found_at_address && p.found_at_address.age_range) || null;

    // Extract addresses
    const rawAddrs = p.current_addresses || p.addresses || p._addresses || p.found_at_address
      ? [].concat(p.current_addresses || p.addresses || p._addresses || (p.found_at_address ? [p.found_at_address] : []))
      : [];
    const addresses = rawAddrs.filter(Boolean).map((a, i) => ({
      street: a.street_line_1 || a.street || a.address || a.standard_address_line1 || '',
      city: a.city || a.City || '',
      state: a.state_code || a.state || a.State || '',
      zip: a.postal_code || a.zip || a.zip_code || '',
      current: i === 0 || !!(a.is_current || a.current)
    }));

    // Extract phones
    const rawPhones = p.phones || p.phone_numbers || (p._phone ? [{ phone_number: p._phone }] : []);
    const phones = rawPhones.filter(Boolean).map(ph => ({
      number: ph.phone_number || ph.number || ph.phone || '',
      type: ph.line_type || ph.type || '',
      carrier: ph.carrier || ''
    }));

    // Extract emails
    const rawEmails = p.emails || p.email_addresses || [];
    const emails = rawEmails.map(e => typeof e === 'string' ? e : (e.email_address || e.email || e.contact_type || ''));

    // Extract relatives/associates
    const rawRels = p.associated_people || p.relatives || p.associates || [];
    const relatives = rawRels.filter(Boolean).map(r => ({
      name: typeof r === 'string' ? r : (r.name || r.full_name || r.best_name || `${r.first_name || ''} ${r.last_name || ''}`.trim()),
      relation: r.relation || r.type || ''
    }));

    // Confidence scoring
    let conf = 40;
    if (addresses.some(a => a.current)) conf += 15;
    if (phones.length > 0) conf += 10;
    if (emails.length > 0) conf += 10;
    if (relatives.length > 0) conf += 10;
    if (age) conf += 5;
    if (addresses.length > 1 || phones.length > 1) conf += 10;
    conf = Math.min(conf, 100);

    return {
      id: uuidv4(),
      fullName: full,
      firstName: fn,
      lastName: ln,
      age,
      addresses,
      phones,
      emails: emails.filter(Boolean),
      relatives,
      confidence: conf,
      sources: [apiResult.source]
    };
  });
}

app.post('/api/k108/quota', (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const lookup = getK108Quota('lookup');
  const sms = getK108Quota('sms');
  res.json({
    total: lookup.total, used: lookup.used, remaining: lookup.total - lookup.used,
    lookup, sms
  });
});

app.post('/api/k108/search', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { token, type, query } = req.body;
  if (!k108RateCheck(token)) return res.status(429).json({ error: 'Rate limit exceeded. Try again in a few minutes.' });
  const q = getK108Quota('lookup');
  if (q.used >= q.total) return res.status(403).json({ error: 'Query quota exhausted. No searches remaining.' });
  if (!type || !query) return res.status(400).json({ error: 'Missing search type or query' });

  const start = Date.now();
  let apiResult;

  // Mock data for local testing without API key
  if (!WP_API_KEY) {
    const mockResults = [
      { id: uuidv4(), fullName: query.lastName ? (query.firstName||'John') + ' ' + query.lastName : 'John Doe', firstName: query.firstName||'John', lastName: query.lastName||'Doe', age: '35-40', addresses: [{ street: '1234 Oak Avenue', city: query.city||'Chicago', state: query.state||'IL', zip: '60614', current: true }, { street: '789 Pine St', city: 'Evanston', state: 'IL', zip: '60201', current: false }], phones: [{ number: '3125551234', type: 'Mobile', carrier: 'T-Mobile' }, { number: '7735559876', type: 'Landline', carrier: 'AT&T' }], emails: ['jdoe@email.com', 'john.doe@work.com'], relatives: [{ name: 'Jane Doe', relation: 'Spouse' }, { name: 'Robert Doe', relation: 'Parent' }], confidence: 87, sources: ['mock-data'] },
      { id: uuidv4(), fullName: query.lastName ? 'James ' + query.lastName : 'James Doe', firstName: 'James', lastName: query.lastName||'Doe', age: '28', addresses: [{ street: '456 Elm Street', city: query.city||'Springfield', state: query.state||'IL', zip: '62704', current: true }], phones: [{ number: '2175554321', type: 'Mobile', carrier: 'Verizon' }], emails: ['james.d@gmail.com'], relatives: [{ name: 'Robert Doe', relation: 'Parent' }], confidence: 62, sources: ['mock-data'] },
      { id: uuidv4(), fullName: query.lastName ? 'Jennifer ' + query.lastName : 'Jennifer Doe', firstName: 'Jennifer', lastName: query.lastName||'Doe', age: '45', addresses: [{ street: '321 Maple Dr', city: 'Naperville', state: 'IL', zip: '60540', current: true }], phones: [{ number: '6305557890', type: 'Mobile', carrier: 'Sprint' }], emails: [], relatives: [], confidence: 38, sources: ['mock-data'] }
    ];
    await k108Log(username, 'people_search', { type, resultCount: mockResults.length, mock: true }, req.ip);
    return res.json({ results: mockResults, meta: { searchType: type, resultCount: mockResults.length, duration: Date.now() - start, sources: [{ name: 'mock-data', status: 'ok' }], quota: getK108Quota('lookup') } });
  }

  try {
    if (type === 'name') {
      const { firstName, lastName, city, state } = query;
      if (!lastName || !lastName.trim()) return res.status(400).json({ error: 'Last name is required' });
      apiResult = await searchPeopleByName(
        (firstName || '').trim().substring(0, 50),
        lastName.trim().substring(0, 50),
        (city || '').trim().substring(0, 50),
        (state || '').trim().substring(0, 2).toUpperCase()
      );
    } else if (type === 'phone') {
      const phone = (query.phone || '').replace(/\D/g, '').slice(-10);
      if (phone.length < 10) return res.status(400).json({ error: 'Enter a valid 10-digit phone number' });
      apiResult = await searchPeopleByPhone(phone);
    } else if (type === 'address') {
      const { street, city, state, zip } = query;
      if (!street || !street.trim()) return res.status(400).json({ error: 'Street address is required' });
      apiResult = await searchPeopleByAddress(
        street.trim().substring(0, 100),
        (city || '').trim().substring(0, 50),
        (state || '').trim().substring(0, 2).toUpperCase(),
        (zip || '').trim().substring(0, 10)
      );
    } else {
      return res.status(400).json({ error: 'Invalid search type' });
    }

    console.log('[K108] API result status:', apiResult.status, apiResult.error || '');
    if (apiResult.raw) console.log('[K108] Raw response keys:', Object.keys(apiResult.raw), 'full:', JSON.stringify(apiResult.raw).substring(0, 500));

    // If the API returned an error, send it to the client
    if (apiResult.status === 'error') {
      return res.json({ error: apiResult.error || 'Whitepages API error', results: [], meta: { duration: Date.now() - start, sources: [{ name: 'whitepages', status: 'error' }] } });
    }
    if (apiResult.status === 'not_configured') {
      return res.json({ error: 'Whitepages API key not configured', results: [], meta: { duration: Date.now() - start } });
    }

    const results = normalizeResults(apiResult);
    console.log('[K108] Normalized results count:', results.length);
    results.sort((a, b) => b.confidence - a.confidence);

    if (apiResult.status === 'ok') useK108Quota('lookup');
    const quota = getK108Quota('lookup');

    await k108Log(username, 'people_search', { type, resultCount: results.length }, req.ip);

    res.json({
      results,
      meta: {
        searchType: type,
        resultCount: results.length,
        duration: Date.now() - start,
        sources: [{ name: apiResult.source, status: apiResult.status }],
        quota: { total: quota.total, used: quota.used, remaining: quota.total - quota.used }
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Search failed', detail: e.message });
  }
});

// ── K-108 Covert SMS ─────────────────────────────────────────────────────────
const TEXTBELT_KEY = process.env.TEXTBELT_API_KEY || '';
const K108_BASE_URL = process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');

app.post('/api/k108/sms/send', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' });

  const q = getK108Quota('sms');
  if (q.used >= q.total) return res.status(403).json({ error: 'SMS quota exhausted.' });
  if (!TEXTBELT_KEY) return res.status(503).json({ error: 'SMS not configured' });

  try {
    const cleaned = phone.replace(/\D/g, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await nodeFetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: cleaned,
        message,
        key: TEXTBELT_KEY,
        replyWebhookUrl: `${K108_BASE_URL}/api/k108/sms-reply`
      }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await resp.json();

    if (data.success) {
      useK108Quota('sms');
      if (db.pool) {
        await db.query(
          'INSERT INTO k108_sms (direction, phone, message, username, textbelt_id) VALUES ($1,$2,$3,$4,$5)',
          ['outbound', cleaned, message, username, data.textId || null]
        );
      }
      await k108Log(username, 'sms_sent', { phone: cleaned, preview: message.substring(0, 50) }, req.ip);
      // Emit so UI updates instantly
      io.emit('k108:sms-sent', { phone: cleaned, message, username, timestamp: Date.now() });
    }

    const quota = getK108Quota('sms');
    res.json({ success: data.success, error: data.error, quota: { total: quota.total, used: quota.used, remaining: quota.total - quota.used } });
  } catch (e) {
    res.status(500).json({ error: 'SMS send failed', detail: e.message });
  }
});

// Textbelt webhook — no auth required
app.post('/api/k108/sms-reply', async (req, res) => {
  const { fromNumber, text } = req.body;
  if (!fromNumber || !text) return res.status(400).json({ error: 'Invalid webhook data' });
  let phone = fromNumber.replace(/\D/g, '');
  // Strip leading country code 1 to match stored 10-digit format
  if (phone.length === 11 && phone.startsWith('1')) phone = phone.slice(1);
  if (db.pool) {
    await db.query(
      'INSERT INTO k108_sms (direction, phone, message, username) VALUES ($1,$2,$3,$4)',
      ['inbound', phone, text, null]
    );
  }
  io.emit('k108:sms-reply', { phone, message: text, timestamp: Date.now() });
  res.json({ ok: true });
});

const K108_SMS_NAMES_FILE = path.join(DATA_DIR, 'k108-sms-names.json');
function getSmsNames() { try { if (fs.existsSync(K108_SMS_NAMES_FILE)) return JSON.parse(fs.readFileSync(K108_SMS_NAMES_FILE, 'utf8')); } catch(e) {} return {}; }
function saveSmsNames(n) { fs.writeFileSync(K108_SMS_NAMES_FILE, JSON.stringify(n, null, 2)); }

app.post('/api/k108/sms/threads/rename', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { phone, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const names = getSmsNames();
  if (name && name.trim()) names[phone] = name.trim();
  else delete names[phone];
  saveSmsNames(names);
  res.json({ ok: true });
});

app.delete('/api/k108/sms/threads/:phone', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  let phone = req.params.phone.replace(/\D/g, '');
  if (phone.length === 11 && phone.startsWith('1')) phone = phone.slice(1);
  if (db.pool) {
    await db.query('DELETE FROM k108_sms WHERE phone = $1 OR phone = $2', [phone, '1' + phone]);
  }
  const names = getSmsNames();
  delete names[phone];
  saveSmsNames(names);
  res.json({ ok: true });
});

app.post('/api/k108/sms/names', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  res.json({ names: getSmsNames() });
});

app.post('/api/k108/sms/threads', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ threads: [] });
  // Normalize: treat 11-digit numbers starting with 1 as same as 10-digit
  const r = await db.query(
    `SELECT DISTINCT ON (normalized_phone)
       CASE WHEN length(phone) = 11 AND phone LIKE '1%' THEN substring(phone from 2) ELSE phone END as normalized_phone,
       message, direction, created_at, phone
     FROM k108_sms
     ORDER BY normalized_phone, created_at DESC`
  );
  // Return with normalized phone
  const threads = r.rows.map(row => ({ ...row, phone: row.normalized_phone }));
  res.json({ threads });
});

app.post('/api/k108/sms/thread', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ messages: [] });
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) cleaned = cleaned.slice(1);
  // Match both 10-digit and 11-digit (with leading 1) versions
  const r = await db.query(
    'SELECT * FROM k108_sms WHERE phone = $1 OR phone = $2 ORDER BY created_at ASC',
    [cleaned, '1' + cleaned]
  );
  res.json({ messages: r.rows });
});

// ── K-108 Metadata Extractor ─────────────────────────────────────────────────
let exiftool = null;
try { exiftool = require('exiftool-vendored').exiftool; } catch (e) {}

app.post('/api/k108/metadata/extract', mainAuth, upload.single('file'), async (req, res) => {
  // Token passed via form field for multipart uploads
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  if (!exiftool) return res.status(503).json({ error: 'Metadata extraction not available. Install exiftool-vendored.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const tags = await exiftool.read(req.file.path);
    // Group by category
    const groups = {};
    for (const [key, value] of Object.entries(tags)) {
      if (key === 'errors' || key === 'SourceFile') continue;
      const cat = key.includes(':') ? key.split(':')[0] : 'General';
      if (!groups[cat]) groups[cat] = {};
      groups[cat][key] = value;
    }

    // Extract GPS if present
    let gps = null;
    if (tags.GPSLatitude && tags.GPSLongitude) {
      gps = { lat: tags.GPSLatitude, lng: tags.GPSLongitude };
    }

    await k108Log(username, 'metadata_extract', { filename: req.file.originalname }, req.ip);

    // Cleanup uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({ groups, gps, filename: req.file.originalname });
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Extraction failed', detail: e.message });
  }
});

// ── K-108 Document Vault ─────────────────────────────────────────────────────
app.post('/api/k108/vault/items', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ items: [] });
  const r = await db.query('SELECT * FROM k108_vault ORDER BY transferred_at DESC');
  res.json({ items: r.rows });
});

app.post('/api/k108/vault/upload', upload.array('files', 10), async (req, res) => {
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const inserted = [];
  for (const file of (req.files || [])) {
    const r = await db.query(
      'INSERT INTO k108_vault (filename, original_name, mime_type, size, transferred_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [`/uploads/${file.filename}`, file.originalname, file.mimetype, file.size, username]
    );
    inserted.push(r.rows[0]);
    await k108Log(username, 'file_upload', { filename: file.originalname }, req.ip);
  }
  res.json({ ok: true, items: inserted });
});

app.post('/api/k108/vault/transfer', mainAuth, async (req, res) => {
  const username = req.session.user;
  if (!username) return res.status(401).json({ error: 'Not authenticated' });
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'File ID required' });

  const vaultData = rd(F.vault);
  const userFiles = vaultData[username] || [];
  const file = userFiles.find(f => f.id === fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  if (db.pool) {
    await db.query(
      'INSERT INTO k108_vault (filename, original_name, mime_type, size, transferred_by) VALUES ($1,$2,$3,$4,$5)',
      [file.url || file.name, file.name, file.mimeType || '', file.size || 0, username]
    );
  }
  await k108Log(username, 'file_transfer', { filename: file.name }, req.ip);
  res.json({ ok: true });
});

// ── K-108 Intel Profiles ─────────────────────────────────────────────────────
// ── K-108 Profiles JSON fallback ──
const K108_PROFILES_FILE = path.join(DATA_DIR, 'k108-profiles.json');
function getK108Profiles() {
  try { if (fs.existsSync(K108_PROFILES_FILE)) return JSON.parse(fs.readFileSync(K108_PROFILES_FILE, 'utf8')); } catch(e) {}
  return [];
}
function saveK108Profiles(p) { fs.writeFileSync(K108_PROFILES_FILE, JSON.stringify(p, null, 2)); }

app.post('/api/k108/profiles', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { search } = req.body;

  if (db.pool) {
    let r;
    if (search && search.trim()) {
      const prefix = `${search.trim()}%`;
      const term = search.trim();
      // Names always prefix match; aliases/handles at 2+ chars; never search notes
      let conditions = [`first_name ILIKE $1`, `last_name ILIKE $1`, `(first_name || ' ' || last_name) ILIKE $1`];
      const params = [prefix];
      if (term.length >= 2) {
        // Aliases prefix match
        params.push(prefix);
        conditions.push(`EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE $${params.length})`);
        // Social handles prefix match
        params.push(prefix);
        conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(social_links) s WHERE s->>'handle' ILIKE $${params.length})`);
      }
      r = await db.query(
        `SELECT * FROM k108_profiles WHERE ${conditions.join(' OR ')} ORDER BY updated_at DESC LIMIT 20`,
        params
      );
    } else {
      r = await db.query('SELECT * FROM k108_profiles ORDER BY updated_at DESC LIMIT 20');
    }
    return res.json({ profiles: r.rows });
  }
  // JSON fallback
  let profiles = getK108Profiles();
  if (search && search.trim()) {
    const t = search.trim().toLowerCase();
    const socials = p => { try { return typeof p.social_links === 'string' ? JSON.parse(p.social_links||'[]') : (p.social_links||[]); } catch(e) { return []; } };
    profiles = profiles.filter(p => (p.first_name||'').toLowerCase().startsWith(t) || (p.last_name||'').toLowerCase().startsWith(t) || ((p.first_name||'')+' '+(p.last_name||'')).toLowerCase().startsWith(t) || (t.length >= 2 && ((p.aliases||[]).some(a => a.toLowerCase().startsWith(t)) || socials(p).some(s => (s.handle||'').toLowerCase().startsWith(t)))));
  }
  res.json({ profiles });
});

app.post('/api/k108/profiles/create', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address } = req.body;

  if (db.pool) {
    try {
      const colInfo = await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name='k108_profiles' AND column_name='phones'`);
      const isJsonb = colInfo.rows[0] && colInfo.rows[0].data_type === 'jsonb';
      const aliasVal = Array.isArray(aliases) ? aliases : (aliases ? [aliases] : []);
      const phoneVal = isJsonb ? JSON.stringify(phones || []) : (phones || []).map(p => typeof p === 'string' ? p : (p.number || ''));
      const emailVal = isJsonb ? JSON.stringify(emails || []) : (emails || []).map(e => typeof e === 'string' ? e : (e.address || ''));

      const r = await db.query(
        `INSERT INTO k108_profiles (first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [first_name || '', middle_name || null, last_name || '', aliasVal, relation || '', notes || '',
         phoneVal, emailVal, JSON.stringify(social_links || []), age || '', birthday || null, JSON.stringify(address || {}), username]
      );
      await k108Log(username, 'profile_create', { name: `${first_name} ${last_name}`.trim() }, req.ip);
      return res.json({ profile: r.rows[0] });
    } catch(e) {
      console.error('[K108] Profile create error:', e.message);
      return res.status(500).json({ error: 'Create failed: ' + e.message });
    }
  }
  // JSON fallback
  const profiles = getK108Profiles();
  const profile = { id: Date.now(), first_name: first_name||'', last_name: last_name||'', aliases: aliases||[], photo_url: null, relation: relation||'', notes: notes||'', phones: phones||[], emails: emails||[], social_links: social_links||[], age: age||'', birthday: birthday||null, address: address||{}, created_by: username, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  profiles.push(profile);
  saveK108Profiles(profiles);
  await k108Log(username, 'profile_create', { name: `${first_name} ${last_name}`.trim() }, req.ip);
  res.json({ profile });
});

app.post('/api/k108/profiles/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;

  if (db.pool) {
    const r = await db.query('SELECT * FROM k108_profiles WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Profile not found' });
    const p = r.rows[0];
    await k108Log(username, 'profile_view', { profileId: req.params.id, name: `${p.first_name||''} ${p.last_name||''}`.trim() }, req.ip);
    const files = await db.query('SELECT * FROM k108_profile_files WHERE profile_id = $1 ORDER BY uploaded_at DESC', [req.params.id]);
    const relations = await db.query(
      `SELECT r.*, p.first_name, p.last_name, p.photo_url, p.relation as p_relation
       FROM k108_profile_relations r JOIN k108_profiles p ON p.id = r.related_profile_id
       WHERE r.profile_id = $1`,
      [req.params.id]
    );
    return res.json({ profile: p, files: files.rows, relations: relations.rows });
  }
  // JSON fallback
  const profiles = getK108Profiles();
  const profile = profiles.find(p => String(p.id) === String(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  const pFiles = profile.files || [];
  const pRelations = (profile.relations || []).map(r => {
    const rp = profiles.find(p => String(p.id) === String(r.related_profile_id));
    return { ...r, first_name: rp?.first_name||'', last_name: rp?.last_name||'', photo_url: rp?.photo_url||null, p_relation: rp?.relation||'' };
  });
  res.json({ profile, files: pFiles, relations: pRelations });
});

app.put('/api/k108/profiles/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address } = req.body;

  if (db.pool) {
    try {
      // Detect if phones column is TEXT[] or JSONB
      const colInfo = await db.query(`SELECT data_type FROM information_schema.columns WHERE table_name='k108_profiles' AND column_name='phones'`);
      const isJsonb = colInfo.rows[0] && colInfo.rows[0].data_type === 'jsonb';
      const aliasVal = Array.isArray(aliases) ? aliases : (aliases ? [aliases] : []);
      const phoneVal = isJsonb ? JSON.stringify(phones || []) : (phones || []).map(p => typeof p === 'string' ? p : (p.number || ''));
      const emailVal = isJsonb ? JSON.stringify(emails || []) : (emails || []).map(e => typeof e === 'string' ? e : (e.address || ''));

      await db.query(
        `UPDATE k108_profiles SET first_name=$1, middle_name=$2, last_name=$3, aliases=$4, relation=$5, notes=$6,
         phones=$7, emails=$8, social_links=$9, age=$10, birthday=$11, address=$12, updated_at=NOW() WHERE id=$13`,
        [first_name, middle_name || null, last_name, aliasVal, relation || '', notes || '',
         phoneVal, emailVal, JSON.stringify(social_links || []), age || null, birthday || null, JSON.stringify(address || {}), req.params.id]
      );
      await k108Log(username, 'profile_change', { profileId: req.params.id, name: `${first_name} ${last_name}`.trim() }, req.ip);
      return res.json({ ok: true });
    } catch(e) {
      console.error('[K108] Profile update error:', e.message);
      return res.status(500).json({ error: 'Save failed: ' + e.message });
    }
  }
  // JSON fallback
  const profiles = getK108Profiles();
  const idx = profiles.findIndex(p => String(p.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  Object.assign(profiles[idx], { first_name, last_name, aliases: aliases||[], relation: relation||'', notes: notes||'', phones: phones||[], emails: emails||[], social_links: social_links||[], age: age||'', birthday: birthday||null, address: address||{}, updated_at: new Date().toISOString() });
  saveK108Profiles(profiles);
  await k108Log(username, 'profile_change', { profileId: req.params.id, name: `${first_name} ${last_name}`.trim() }, req.ip);
  res.json({ ok: true });
});

app.delete('/api/k108/profiles/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) {
    await db.query('DELETE FROM k108_profiles WHERE id = $1', [req.params.id]);
    await k108Log(username, 'profile_delete', { profileId: req.params.id }, req.ip);
    return res.json({ ok: true });
  }
  // JSON fallback
  let profiles = getK108Profiles();
  profiles = profiles.filter(p => String(p.id) !== String(req.params.id));
  saveK108Profiles(profiles);
  await k108Log(username, 'profile_delete', { profileId: req.params.id }, req.ip);
  res.json({ ok: true });
});

app.post('/api/k108/profiles/:id/photo', upload.single('photo'), async (req, res) => {
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const url = `/uploads/${req.file.filename}`;
  if (db.pool) {
    await db.query('UPDATE k108_profiles SET photo_url = $1, updated_at = NOW() WHERE id = $2', [url, req.params.id]);
  } else {
    const profiles = getK108Profiles();
    const p = profiles.find(p => String(p.id) === String(req.params.id));
    if (p) { p.photo_url = url; p.updated_at = new Date().toISOString(); saveK108Profiles(profiles); }
  }
  res.json({ url });
});

app.post('/api/k108/profiles/:id/files', upload.array('files', 10), async (req, res) => {
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  const inserted = [];
  for (const file of (req.files || [])) {
    const fileObj = { id: Date.now() + Math.random(), profile_id: req.params.id, filename: file.filename, original_name: file.originalname, mime_type: file.mimetype, size: file.size, uploaded_at: new Date().toISOString() };
    if (db.pool) {
      const r = await db.query(
        'INSERT INTO k108_profile_files (profile_id, filename, original_name, mime_type, size) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.params.id, file.filename, file.originalname, file.mimetype, file.size]
      );
      inserted.push(r.rows[0]);
    } else {
      // JSON fallback — store file refs in the profile itself
      const profiles = getK108Profiles();
      const p = profiles.find(p => String(p.id) === String(req.params.id));
      if (p) { if (!p.files) p.files = []; p.files.push(fileObj); saveK108Profiles(profiles); }
      inserted.push(fileObj);
    }
    await k108Log(username, 'file_upload', { profileId: req.params.id, filename: file.originalname }, req.ip);
  }
  res.json({ files: inserted });
});

app.delete('/api/k108/profiles/:id/files/:fid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  await db.query('DELETE FROM k108_profile_files WHERE id = $1 AND profile_id = $2', [req.params.fid, req.params.id]);
  res.json({ ok: true });
});

app.post('/api/k108/profiles/:id/relations', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { relatedProfileId, label } = req.body;
  if (!relatedProfileId) return res.status(400).json({ error: 'Related profile ID required' });

  if (db.pool) {
    // Add both directions
    const r = await db.query(
      'INSERT INTO k108_profile_relations (profile_id, related_profile_id, label) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, relatedProfileId, label || '']
    );
    await db.query(
      'INSERT INTO k108_profile_relations (profile_id, related_profile_id, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [relatedProfileId, req.params.id, label || '']
    );
    return res.json({ relation: r.rows[0] });
  }
  // JSON fallback — bidirectional
  const profiles = getK108Profiles();
  const p1 = profiles.find(p => String(p.id) === String(req.params.id));
  const p2 = profiles.find(p => String(p.id) === String(relatedProfileId));
  if (!p1 || !p2) return res.status(404).json({ error: 'Profile not found' });
  if (!p1.relations) p1.relations = [];
  if (!p2.relations) p2.relations = [];
  const rel = { id: Date.now(), related_profile_id: relatedProfileId, label: label || '' };
  const relReverse = { id: Date.now() + 1, related_profile_id: req.params.id, label: label || '' };
  p1.relations.push(rel);
  p2.relations.push(relReverse);
  saveK108Profiles(profiles);
  res.json({ relation: rel });
});

app.delete('/api/k108/profiles/relations/:rid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) {
    await db.query('DELETE FROM k108_profile_relations WHERE id = $1', [req.params.rid]);
    return res.json({ ok: true });
  }
  // JSON fallback
  const profiles = getK108Profiles();
  profiles.forEach(p => { if (p.relations) p.relations = p.relations.filter(r => String(r.id) !== String(req.params.rid)); });
  saveK108Profiles(profiles);
  res.json({ ok: true });
});

app.put('/api/k108/profiles/relations/:rid/label', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { label } = req.body;
  if (db.pool) {
    await db.query('UPDATE k108_profile_relations SET label = $1 WHERE id = $2', [label || '', req.params.rid]);
    return res.json({ ok: true });
  }
  // JSON fallback
  const profiles = getK108Profiles();
  profiles.forEach(p => { if (p.relations) p.relations.forEach(r => { if (String(r.id) === String(req.params.rid)) r.label = label || ''; }); });
  saveK108Profiles(profiles);
  res.json({ ok: true });
});

// ── K-108 Instagram Photo Proxy ──────────────────────────────────────────────
app.post('/api/k108/instagram-photo', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { igUsername } = req.body;
  if (!igUsername || !/^[\w.]+$/.test(igUsername)) return res.status(400).json({ error: 'Invalid username' });
  try {
    // Use Instagram's internal web profile info API
    const r = await nodeFetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(igUsername)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-ig-app-id': '936619743392459',
        'Origin': 'https://www.instagram.com',
        'Referer': 'https://www.instagram.com/',
      },
      timeout: 8000,
    });
    if (!r.ok) return res.status(404).json({ error: 'Instagram profile not found' });
    const json = await r.json();
    const picUrl = json?.data?.user?.profile_pic_url_hd || json?.data?.user?.profile_pic_url;
    if (!picUrl) return res.status(404).json({ error: 'No profile photo found' });
    // Proxy the image through server to avoid CORS issues with Instagram CDN
    const imgRes = await nodeFetch(picUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' },
      timeout: 8000,
    });
    if (!imgRes.ok) return res.status(404).json({ error: 'Could not fetch profile image' });
    const buf = await imgRes.buffer();
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch(e) {
    res.status(502).json({ error: 'Failed to fetch Instagram profile' });
  }
});

// ── K-108 Vehicle Lookup ──────────────────────────────────────────────────────
app.post('/api/k108/vehicle/quota', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  res.json({ quota: getVehicleQuota() });
});

app.post('/api/k108/vehicle/plate', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { plate, state } = req.body;
  if (!plate || !state) return res.status(400).json({ error: 'Plate and state required' });
  if (!/^[A-Z0-9]{2,8}$/i.test(plate)) return res.status(400).json({ error: 'Invalid plate format' });
  if (!PLATETOVIN_API_KEY) return res.status(503).json({ error: 'Vehicle lookup not configured' });
  try {
    const ptv = await nodeFetch('https://platetovin.com/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': PLATETOVIN_API_KEY },
      body: JSON.stringify({ plate: plate.toUpperCase(), state: state.toUpperCase() }),
      timeout: 10000,
    });
    const ptvData = await ptv.json();
    if (!ptv.ok || !ptvData.vin) return res.status(404).json({ error: 'No vehicle found for this plate' });
    const quota = useVehicleQuota();
    const vin = ptvData.vin;
    let photos = [];
    if (AUTODEV_API_KEY) {
      try {
        const photoRes = await nodeFetch(`https://api.auto.dev/vin/${vin}/photos`, {
          headers: { 'apikey': AUTODEV_API_KEY },
          timeout: 8000,
        });
        if (photoRes.ok) {
          const pd = await photoRes.json();
          const raw = pd.photos || pd;
          photos = Array.isArray(raw) ? raw.map(p => typeof p === 'string' ? p : (p.url || p.src || '')).filter(Boolean) : [];
        }
      } catch(e) {}
    }
    await k108Log(username, 'vehicle_lookup', { type: 'plate', plate: plate.toUpperCase(), state, vin }, req.ip);
    res.json({ vin, make: ptvData.make||'', model: ptvData.model||'', year: ptvData.year||'', trim: ptvData.trim||'', plate: plate.toUpperCase(), state: state.toUpperCase(), photos, quota: { used: quota.used, total: quota.total } });
  } catch(e) {
    console.error('[K108] Vehicle plate lookup:', e.message);
    res.status(500).json({ error: 'Lookup failed. Please try again.' });
  }
});

app.post('/api/k108/vehicle/vin', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { vin } = req.body;
  if (!vin || vin.trim().length !== 17) return res.status(400).json({ error: 'VIN must be exactly 17 characters' });
  if (!AUTODEV_API_KEY) return res.status(503).json({ error: 'Vehicle lookup not configured' });
  try {
    const [decodeRes, photoRes] = await Promise.all([
      nodeFetch(`https://api.auto.dev/vin/${vin.trim()}`, { headers: { 'apikey': AUTODEV_API_KEY }, timeout: 10000 }),
      nodeFetch(`https://api.auto.dev/vin/${vin.trim()}/photos`, { headers: { 'apikey': AUTODEV_API_KEY }, timeout: 8000 }),
    ]);
    if (!decodeRes.ok) return res.status(404).json({ error: 'No vehicle found for this VIN' });
    const dec = await decodeRes.json();
    let photos = [];
    if (photoRes.ok) {
      const pd = await photoRes.json();
      const raw = pd.photos || pd;
      photos = Array.isArray(raw) ? raw.map(p => typeof p === 'string' ? p : (p.url || p.src || '')).filter(Boolean) : [];
    }
    await k108Log(username, 'vehicle_lookup', { type: 'vin', vin: vin.trim() }, req.ip);
    res.json({
      vin: vin.trim(),
      make: dec.make?.name || dec.make || '',
      model: dec.model?.name || dec.model || '',
      year: String(dec.years?.[0]?.year || dec.year || ''),
      trim: dec.trim || dec.years?.[0]?.styles?.[0]?.trim || '',
      engine: dec.engine?.name || dec.engine || '',
      drivetrain: dec.drivetrain?.name || dec.drivetrain || '',
      transmission: dec.transmission?.transmissionType || dec.transmission || '',
      photos,
    });
  } catch(e) {
    console.error('[K108] VIN lookup:', e.message);
    res.status(500).json({ error: 'Lookup failed. Please try again.' });
  }
});

app.post('/api/k108/vehicle/save', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { profileId, vehicle } = req.body;
  if (!profileId || !vehicle) return res.status(400).json({ error: 'Profile ID and vehicle data required' });
  if (db.pool) {
    const r = await db.query(`UPDATE k108_profiles SET vehicle = $1, updated_at = NOW() WHERE id = $2 RETURNING first_name, last_name`, [JSON.stringify(vehicle), profileId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Profile not found' });
    const p = r.rows[0];
    await k108Log(username, 'vehicle_save', { profileId, name: `${p.first_name} ${p.last_name}`.trim(), vin: vehicle.vin }, req.ip);
    return res.json({ ok: true, profileName: `${p.first_name} ${p.last_name}`.trim() });
  }
  const profiles = getK108Profiles();
  const idx = profiles.findIndex(p => String(p.id) === String(profileId));
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });
  profiles[idx].vehicle = vehicle;
  profiles[idx].updated_at = new Date().toISOString();
  saveK108Profiles(profiles);
  const p = profiles[idx];
  await k108Log(username, 'vehicle_save', { profileId, name: `${p.first_name} ${p.last_name}`.trim(), vin: vehicle.vin }, req.ip);
  res.json({ ok: true, profileName: `${p.first_name} ${p.last_name}`.trim() });
});

// ── K-108 Labels ─────────────────────────────────────────────────────────────
const K108_LABELS_FILE = path.join(DATA_DIR, 'k108-labels.json');
function getK108Labels() { try { if (fs.existsSync(K108_LABELS_FILE)) return JSON.parse(fs.readFileSync(K108_LABELS_FILE, 'utf8')); } catch(e) {} return []; }
function saveK108Labels(l) { fs.writeFileSync(K108_LABELS_FILE, JSON.stringify(l, null, 2)); }

app.post('/api/k108/labels', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  res.json({ labels: getK108Labels() });
});

app.post('/api/k108/labels/create', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { name, color, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Label name required' });
  const labels = getK108Labels();
  const label = { id: Date.now(), name, color: color || '#38bdf8', icon: icon || 'star', profileIds: [] };
  labels.push(label);
  saveK108Labels(labels);
  res.json({ label });
});

app.post('/api/k108/labels/:id/apply', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { profileId } = req.body;
  const labels = getK108Labels();
  const label = labels.find(l => String(l.id) === String(req.params.id));
  if (!label) return res.status(404).json({ error: 'Label not found' });
  if (!label.profileIds.includes(String(profileId))) label.profileIds.push(String(profileId));
  saveK108Labels(labels);
  res.json({ ok: true });
});

app.post('/api/k108/labels/:id/remove', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { profileId } = req.body;
  const labels = getK108Labels();
  const label = labels.find(l => String(l.id) === String(req.params.id));
  if (!label) return res.status(404).json({ error: 'Label not found' });
  label.profileIds = label.profileIds.filter(id => id !== String(profileId));
  saveK108Labels(labels);
  res.json({ ok: true });
});

app.put('/api/k108/labels/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { name, color, icon } = req.body;
  let labels = getK108Labels();
  const idx = labels.findIndex(l => String(l.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Label not found' });
  if (name) labels[idx].name = name;
  if (color) labels[idx].color = color;
  if (icon) labels[idx].icon = icon;
  saveK108Labels(labels);
  res.json({ ok: true, label: labels[idx] });
});

app.delete('/api/k108/labels/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  let labels = getK108Labels();
  labels = labels.filter(l => String(l.id) !== String(req.params.id));
  saveK108Labels(labels);
  res.json({ ok: true });
});

// ── K-108 Command Bar ────────────────────────────────────────────────────────
app.post('/api/k108/command', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { command } = req.body;
  if (!command || typeof command !== 'string') return res.status(400).json({ error: 'Command required' });
  const raw = command.trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  const lines = (text, cls = 'info') => ({ lines: [{ text, cls }] });
  const multi = (...arr) => ({ lines: arr.map(([text, cls]) => ({ text, cls: cls || 'info' })) });

  try {
    // ── Chat ──
    if (cmd === 'broadcast') {
      const text = parts.slice(1).join(' ');
      if (!text) return res.json(lines('Usage: broadcast <message>', 'warn'));
      const msg = { id: uuidv4(), sender: 'system', type: 'text', text, files: [], priority: false, replyTo: null, timestamp: Date.now(), edited: false, editedAt: null, reactions: {}, read: false, readAt: null, unsendable: false, aiGenerated: false, systemMessage: true };
      if (db.pool) await db.insertMessage(msg); else { const msgs = rd(F.messages); if (!Array.isArray(msgs.main)) msgs.main = []; msgs.main.push(msg); wd(F.messages, msgs); }
      io.emit('new-message', msg);
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`Broadcast sent: "${text}"`, 'success'));
    }

    // ── Announcements ──
    if (cmd === 'announcement') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'list') {
        const anns = rd(F.announcements) || [];
        if (!anns.length) return res.json(lines('No announcements', 'dim'));
        return res.json({ lines: [{ text: `${anns.length} announcements`, cls: 'success' }], table: { headers: ['ID', 'Title', 'Target', 'Created'], rows: anns.map(a => [a.id.substring(0, 8), (a.title || '').substring(0, 30), a.targetUser || 'both', new Date(a.createdAt).toLocaleDateString()]) } });
      }
      if (sub === 'delete') {
        const id = parts[2];
        if (!id) return res.json(lines('Usage: announcement delete <id>', 'warn'));
        let anns = rd(F.announcements) || [];
        const idx = anns.findIndex(a => a.id.startsWith(id));
        if (idx === -1) return res.json(lines('Announcement not found', 'error'));
        const removed = anns.splice(idx, 1)[0];
        wd(F.announcements, anns);
        io.emit('announcement-removed', removed.id);
        await k108Log(username, 'command_bar', { command: raw }, req.ip);
        return res.json(lines(`Deleted announcement: "${removed.title}"`, 'success'));
      }
      if (sub === 'new') {
        const title = parts.slice(2).join(' ');
        if (!title) return res.json(lines('Usage: announcement new <message>', 'warn'));
        const ann = { id: uuidv4(), title, content: '', createdBy: username, createdAt: Date.now(), active: true, targetUser: 'both' };
        const anns = rd(F.announcements) || [];
        anns.push(ann);
        wd(F.announcements, anns);
        io.emit('announcement', ann);
        await k108Log(username, 'command_bar', { command: raw }, req.ip);
        return res.json(lines(`Announcement created: "${title}"`, 'success'));
      }
      return res.json(lines('Usage: announcement list | announcement delete <id> | announcement new <message>', 'warn'));
    }

    // ── Settings ──
    if (cmd === 'settings') {
      const s = rd(F.settings);
      return res.json(multi(
        ['── Settings ──', 'header'],
        [`  Vault Passcode: ${s.vaultPasscode || '(not set)'}`, 'data'],
        [`  Emails: ${JSON.stringify(s.emails || {})}`, 'data'],
        [`  Maintenance: ${maintenanceMode ? 'ON' : 'OFF'}`, 'data'],
      ));
    }

    if (cmd === 'set') {
      const prop = parts[1]?.toLowerCase();
      if (prop === 'password') {
        const pw = parts.slice(2).join(' ');
        if (!pw) return res.json(lines('Usage: set password <new>', 'warn'));
        const s = rd(F.settings);
        s.sitePassword = bcrypt.hashSync(pw, 10);
        wd(F.settings, s);
        await k108Log(username, 'command_bar', { command: 'set password ***' }, req.ip);
        return res.json(lines('Site password updated', 'success'));
      }
      if (prop === 'eval-password') {
        const pw = parts.slice(2).join(' ');
        if (!pw) return res.json(lines('Usage: set eval-password <new>', 'warn'));
        const s = rd(F.settings);
        s.evalPassword = pw;
        wd(F.settings, s);
        await k108Log(username, 'command_bar', { command: 'set eval-password ***' }, req.ip);
        return res.json(lines('Eval password updated', 'success'));
      }
      if (prop === 'vault-code') {
        const code = parts[2];
        if (!code) return res.json(lines('Usage: set vault-code <code>', 'warn'));
        const s = rd(F.settings);
        s.vaultPasscode = code;
        wd(F.settings, s);
        await k108Log(username, 'command_bar', { command: 'set vault-code ***' }, req.ip);
        return res.json(lines('Vault passcode updated', 'success'));
      }
      if (prop === 'email') {
        const user = parts[2]?.toLowerCase();
        const emails = parts[3];
        if (!user || !emails) return res.json(lines('Usage: set email <user> <e1,e2>', 'warn'));
        const s = rd(F.settings);
        if (!s.emails) s.emails = {};
        s.emails[user] = emails;
        wd(F.settings, s);
        await k108Log(username, 'command_bar', { command: raw }, req.ip);
        return res.json(lines(`Email for ${user} set to: ${emails}`, 'success'));
      }
      return res.json(lines('Usage: set password|eval-password|vault-code|email', 'warn'));
    }

    if (cmd === 'reset' && parts[1]?.toLowerCase() === 'password') {
      const target = parts[2]?.toLowerCase();
      if (!target || !['kaliph', 'kathrine'].includes(target)) return res.json(lines('Usage: reset password <kaliph|kathrine>', 'warn'));
      const users = rd(F.users);
      if (users[target]) { delete users[target].profilePasscode; wd(F.users, users); }
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`${target} profile PIN reset — will be prompted on next login`, 'success'));
    }

    // ── Briefing ──
    if (cmd === 'feedback') {
      if (!db.pool) return res.json(lines('No database configured', 'error'));
      const result = await db.query('SELECT id, user_id, briefing_date, feedback_type, section, highlighted_text, note, permanent FROM briefing_feedback ORDER BY created_at DESC LIMIT 50');
      if (!result.rows.length) return res.json(lines('No feedback found', 'dim'));
      return res.json({ lines: [{ text: `${result.rows.length} feedback entries`, cls: 'success' }], table: { headers: ['ID', 'User', 'Date', 'Type', 'Detail'], rows: result.rows.map(r => [String(r.id), r.user_id, new Date(r.briefing_date).toISOString().slice(0, 10), r.feedback_type, (r.section || r.highlighted_text || r.note || '').substring(0, 40)]) } });
    }

    // ── System ──
    if (cmd === 'maintenance') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'on') { maintenanceMode = true; io.emit('force-logout'); await k108Log(username, 'command_bar', { command: raw }, req.ip); return res.json(multi(['Maintenance mode ON', 'warn'], ['All users force-logged out', 'data'])); }
      if (sub === 'off') { maintenanceMode = false; await k108Log(username, 'command_bar', { command: raw }, req.ip); return res.json(lines('Maintenance mode OFF', 'success')); }
      return res.json(lines('Usage: maintenance on | maintenance off', 'warn'));
    }

    if (raw.toLowerCase() === 'force logout') { io.emit('force-logout'); await k108Log(username, 'command_bar', { command: raw }, req.ip); return res.json(lines('Force logout sent to all clients', 'success')); }
    if (raw.toLowerCase() === 'force reload') { io.emit('force-reload'); await k108Log(username, 'command_bar', { command: raw }, req.ip); return res.json(lines('Force reload sent to all clients', 'success')); }

    if (cmd === 'uptime') {
      const secs = Math.floor(process.uptime());
      const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
      return res.json(lines(`Server uptime: ${d}d ${h}h ${m}m ${s}s`, 'success'));
    }

    if (cmd === 'backup') {
      const bundle = {};
      for (const [k, file] of Object.entries(F)) { bundle[k] = rd(file) || {}; }
      const sent = await sendMail('royalkvault@gmail.com', 'Manual Backup — K-108 Command Bar', '<p>Backup triggered from K-108 command bar.</p>', [{ filename: `vault-backup-${Date.now()}.json`, content: JSON.stringify(bundle, null, 2) }]);
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(sent ? 'Backup emailed' : 'Backup email failed', sent ? 'success' : 'error'));
    }

    if (raw.toLowerCase().startsWith('republish update-log')) {
      const target = parts[2]?.toLowerCase();
      if (target && target !== 'kaliph' && target !== 'kathrine') return res.json(lines('Usage: republish update-log [kaliph|kathrine]', 'warn'));
      io.emit('show-update-log', { target: target || 'both' });
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`Republished update log to ${target || 'both'}`, 'success'));
    }

    if (raw.toLowerCase().startsWith('custom update-log')) {
      const rest = raw.replace(/^custom\s+update-log\s+/i, '');
      const firstWord = rest.split(' ')[0]?.toLowerCase();
      let target = 'both', message = rest;
      if (firstWord === 'kaliph' || firstWord === 'kathrine') { target = firstWord; message = rest.slice(firstWord.length).trim(); }
      if (!message) return res.json(lines('Usage: custom update-log [kaliph|kathrine] <message>', 'warn'));
      io.emit('show-custom-update-log', { target, message });
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`Custom update log sent to ${target}`, 'success'));
    }

    if (cmd === 'emit') {
      const event = parts[1];
      if (!event) return res.json(lines('Usage: emit <event>', 'warn'));
      let data = {};
      const jsonPart = parts.slice(2).join(' ');
      if (jsonPart) { try { data = JSON.parse(jsonPart); } catch { data = jsonPart; } }
      io.emit(event, data);
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`Emitted "${event}"`, 'success'));
    }

    // ── K-108 Specific ──
    if (cmd === 'profile') {
      const searchTerm = parts.slice(1).join(' ');
      if (!searchTerm) return res.json(lines('Usage: profile <name>', 'warn'));
      if (db.pool) {
        const r = await db.query(`SELECT id, first_name, last_name, aliases FROM k108_profiles WHERE LOWER(first_name || ' ' || last_name) LIKE $1 OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE LOWER(a) LIKE $1) ORDER BY updated_at DESC LIMIT 5`, ['%' + searchTerm.toLowerCase() + '%']);
        if (!r.rows.length) return res.json(lines('No matching profiles found', 'warn'));
        if (r.rows.length === 1) return res.json({ lines: [{ text: `Opening profile: ${r.rows[0].first_name} ${r.rows[0].last_name}`, cls: 'success' }], navigate: `#/profiles/${r.rows[0].id}` });
        return res.json({ lines: [{ text: `${r.rows.length} profiles found:`, cls: 'info' }], profileResults: r.rows.map(p => ({ id: p.id, name: `${p.first_name} ${p.last_name}` })) });
      }
      return res.json(lines('Database required for profile search', 'error'));
    }

    if (cmd === 'case') {
      const searchTerm = parts.slice(1).join(' ');
      if (!searchTerm) return res.json(lines('Usage: case <name>', 'warn'));
      if (db.pool) {
        const r = await db.query('SELECT id, name, status FROM k108_cases WHERE LOWER(name) LIKE $1 ORDER BY updated_at DESC LIMIT 5', ['%' + searchTerm.toLowerCase() + '%']);
        if (!r.rows.length) return res.json(lines('No matching cases found', 'warn'));
        if (r.rows.length === 1) return res.json({ lines: [{ text: `Opening case: ${r.rows[0].name}`, cls: 'success' }], navigate: `#/cases/${r.rows[0].id}` });
        return res.json({ lines: [{ text: `${r.rows.length} cases found:`, cls: 'info' }], caseResults: r.rows.map(c => ({ id: c.id, name: c.name, status: c.status })) });
      }
      return res.json(lines('Database required for case search', 'error'));
    }

    if (cmd === 'sms' && parts[1]?.toLowerCase() === 'quota') {
      const q = getK108Quota('sms');
      return res.json(lines(`SMS quota: ${q.used}/${q.total} used — ${q.total - q.used} remaining`, 'success'));
    }

    if (cmd === 'activity') {
      if (db.pool) {
        const r = await db.query('SELECT * FROM k108_activity_log ORDER BY created_at DESC LIMIT 10');
        if (!r.rows.length) return res.json(lines('No activity recorded', 'dim'));
        return res.json({ lines: [{ text: 'Last 10 Activity Log entries:', cls: 'header' }], table: { headers: ['Time', 'User', 'Action', 'Detail'], rows: r.rows.map(e => [new Date(e.created_at).toLocaleString(), e.username, e.action_type, JSON.stringify(e.detail || {}).substring(0, 50)]) } });
      }
      const entries = getK108LogEntries().slice(0, 10);
      if (!entries.length) return res.json(lines('No activity recorded', 'dim'));
      return res.json({ lines: [{ text: 'Last 10 Activity Log entries:', cls: 'header' }], table: { headers: ['Time', 'User', 'Action', 'Detail'], rows: entries.map(e => [new Date(e.created_at).toLocaleString(), e.username, e.action_type, JSON.stringify(e.detail || {}).substring(0, 50)]) } });
    }

    if (cmd === 'goto') {
      const target = parts[1]?.toLowerCase();
      const validModules = ['people', 'sms', 'vehicle', 'profiles', 'cases', 'vault', 'metadata', 'activity', 'briefing', 'mailbox', 'log'];
      if (!target || !validModules.includes(target)) return res.json(lines(`Usage: goto <${validModules.join('|')}>`, 'warn'));
      const hashMap = { people: '#/lookup', sms: '#/sms', vehicle: '#/vehicle', profiles: '#/profiles', cases: '#/cases', vault: '#/vault', metadata: '#/metadata', activity: '#/log', log: '#/log', briefing: '#/briefing', mailbox: '#/mailbox' };
      return res.json({ lines: [{ text: `Navigating to ${target}`, cls: 'success' }], navigate: hashMap[target] || '#/' });
    }


    if (cmd === 'k108' && parts[1]?.toLowerCase() === 'reset-passcode') {
      const target = parts[2]?.toLowerCase();
      if (!target || !['kaliph', 'kathrine'].includes(target)) return res.json(lines('Usage: k108 reset-passcode <kaliph|kathrine>', 'warn'));
      await deleteK108Passcode(target);
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`K-108 passcode reset for ${target}`, 'success'));
    }

    if (cmd === 'help') {
      return res.json({ helpList: true });
    }

    if (cmd === 'clear') {
      return res.json({ clear: true });
    }

    return res.json(lines(`Unknown command: "${raw}". Type "help" for available commands.`, 'error'));
  } catch (e) {
    console.error('[k108 cmd]', e);
    return res.json(lines(`Error: ${e.message}`, 'error'));
  }
});

// ── K-108 Command Bar — autocomplete data ────────────────────────────────────
app.post('/api/k108/command/autocomplete', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { type, query: q } = req.body;
  try {
    if (type === 'profiles' && db.pool) {
      const r = await db.query(`SELECT id, first_name, last_name, aliases FROM k108_profiles WHERE LOWER(first_name || ' ' || last_name) LIKE $1 OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE LOWER(a) LIKE $1) ORDER BY updated_at DESC LIMIT 10`, ['%' + (q || '').toLowerCase() + '%']);
      return res.json({ items: r.rows.map(p => ({ id: p.id, label: `${p.first_name} ${p.last_name}` })) });
    }
    if (type === 'cases' && db.pool) {
      const r = await db.query('SELECT id, name, status FROM k108_cases WHERE LOWER(name) LIKE $1 ORDER BY updated_at DESC LIMIT 10', ['%' + (q || '').toLowerCase() + '%']);
      return res.json({ items: r.rows.map(c => ({ id: c.id, label: c.name, status: c.status })) });
    }

    res.json({ items: [] });
  } catch (e) { res.json({ items: [] }); }
});

// ── K-108 Case Files — JSON fallback store ───────────────────────────────────
const K108_CASES_FILE = path.join(DATA_DIR, 'k108-cases.json');
function getCaseStore() {
  try { if (fs.existsSync(K108_CASES_FILE)) return JSON.parse(fs.readFileSync(K108_CASES_FILE, 'utf8')); } catch(e) {}
  return { cases: [], subjects: [], evidence: [], findings: [], questions: [], timeline: [], nodes: [], edges: [], _nextId: 1 };
}
function saveCaseStore(store) { fs.writeFileSync(K108_CASES_FILE, JSON.stringify(store, null, 2)); }
function caseNextId(store) { return store._nextId++; }

// ── K-108 Case Files ─────────────────────────────────────────────────────────
app.post('/api/k108/cases', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { status } = req.body;
  if (db.pool) {
    let sql = 'SELECT c.*, (SELECT COUNT(*) FROM k108_case_subjects WHERE case_id=c.id) AS subject_count, (SELECT COUNT(*) FROM k108_case_evidence WHERE case_id=c.id) AS evidence_count FROM k108_cases c';
    const params = [];
    if (status && ['OPEN', 'COLD', 'CLOSED'].includes(status)) { sql += ' WHERE c.status = $1'; params.push(status); }
    sql += ' ORDER BY c.updated_at DESC';
    const r = await db.query(sql, params);
    return res.json({ cases: r.rows });
  }
  const store = getCaseStore();
  let cases = store.cases;
  if (status) cases = cases.filter(c => c.status === status);
  cases = cases.map(c => ({ ...c, subject_count: store.subjects.filter(s => s.case_id === c.id).length, evidence_count: store.evidence.filter(e => e.case_id === c.id).length }));
  cases.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  res.json({ cases });
});

app.post('/api/k108/cases/create', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { name, summary, classification } = req.body;
  if (!name) return res.status(400).json({ error: 'Case name required' });
  if (db.pool) {
    const r = await db.query('INSERT INTO k108_cases (name, summary, classification, last_edited_by) VALUES ($1, $2, $3, $4) RETURNING *', [name, summary || '', classification || 'CONFIDENTIAL', username]);
    await k108Log(username, 'case_create', { name, caseId: r.rows[0].id }, req.ip);
    return res.json({ case: r.rows[0] });
  }
  const store = getCaseStore();
  const now = new Date().toISOString();
  const c = { id: caseNextId(store), name, status: 'OPEN', classification: classification || 'CONFIDENTIAL', summary: summary || '', created_at: now, updated_at: now, last_edited_by: username };
  store.cases.push(c);
  saveCaseStore(store);
  await k108Log(username, 'case_create', { name, caseId: c.id }, req.ip);
  res.json({ case: c });
});

app.post('/api/k108/cases/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const id = db.pool ? req.params.id : parseInt(req.params.id);
  if (db.pool) {
    const c = await db.query('SELECT * FROM k108_cases WHERE id = $1', [id]);
    if (!c.rows.length) return res.status(404).json({ error: 'Case not found' });
    const subjects = await db.query(`SELECT cs.*, p.first_name, p.last_name, p.photo_url FROM k108_case_subjects cs JOIN k108_profiles p ON cs.profile_id = p.id WHERE cs.case_id = $1 ORDER BY cs.created_at`, [id]);
    const evidence = await db.query('SELECT * FROM k108_case_evidence WHERE case_id = $1 ORDER BY created_at DESC', [id]);
    const findings = await db.query('SELECT * FROM k108_case_findings WHERE case_id = $1 ORDER BY order_index ASC, created_at ASC', [id]);
    const questions = await db.query('SELECT * FROM k108_case_questions WHERE case_id = $1 ORDER BY created_at ASC', [id]);
    const timeline = await db.query('SELECT * FROM k108_case_timeline WHERE case_id = $1 ORDER BY event_date ASC', [id]);
    const nodes = await db.query('SELECT * FROM k108_case_canvas_nodes WHERE case_id = $1', [id]);
    const edges = await db.query('SELECT * FROM k108_case_canvas_edges WHERE case_id = $1', [id]);
    return res.json({ case: c.rows[0], subjects: subjects.rows, evidence: evidence.rows, findings: findings.rows, questions: questions.rows, timeline: timeline.rows, nodes: nodes.rows, edges: edges.rows });
  }
  const store = getCaseStore();
  const c = store.cases.find(c => c.id === id);
  if (!c) return res.status(404).json({ error: 'Case not found' });
  // Enrich subjects with profile data from JSON profiles store
  const profiles = getK108Profiles();
  const enrichedSubjects = store.subjects.filter(s => s.case_id === id).map(s => {
    const p = profiles.find(p => String(p.id) === String(s.profile_id));
    return { ...s, first_name: p?.first_name || 'Unknown', last_name: p?.last_name || '', photo_url: p?.photo_url || null };
  });
  res.json({ case: c, subjects: enrichedSubjects, evidence: store.evidence.filter(e => e.case_id === id), findings: store.findings.filter(f => f.case_id === id).sort((a,b) => (a.order_index||0) - (b.order_index||0)), questions: store.questions.filter(q => q.case_id === id), timeline: store.timeline.filter(t => t.case_id === id), nodes: store.nodes.filter(n => n.case_id === id), edges: store.edges.filter(e => e.case_id === id) });
});

app.put('/api/k108/cases/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { name, status, classification, summary } = req.body;
  if (db.pool) {
    const sets = []; const params = [];
    if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status = $${params.length}`); }
    if (classification !== undefined) { params.push(classification); sets.push(`classification = $${params.length}`); }
    if (summary !== undefined) { params.push(summary); sets.push(`summary = $${params.length}`); }
    params.push(username); sets.push(`last_edited_by = $${params.length}`);
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    await db.query(`UPDATE k108_cases SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  } else {
    const store = getCaseStore();
    const c = store.cases.find(c => c.id === parseInt(req.params.id));
    if (c) { if (name !== undefined) c.name = name; if (status !== undefined) c.status = status; if (classification !== undefined) c.classification = classification; if (summary !== undefined) c.summary = summary; c.last_edited_by = username; c.updated_at = new Date().toISOString(); saveCaseStore(store); }
  }
  const detail = {};
  if (name !== undefined) detail.name = name;
  if (status !== undefined) detail.status = status;
  await k108Log(username, 'case_update', { caseId: req.params.id, ...detail }, req.ip);
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) {
    const c = await db.query('SELECT name FROM k108_cases WHERE id = $1', [req.params.id]);
    await db.query('DELETE FROM k108_cases WHERE id = $1', [req.params.id]);
    await k108Log(username, 'case_delete', { caseId: req.params.id, name: c.rows[0]?.name }, req.ip);
  } else {
    const store = getCaseStore(); const id = parseInt(req.params.id);
    const c = store.cases.find(c => c.id === id);
    store.cases = store.cases.filter(c => c.id !== id);
    store.subjects = store.subjects.filter(s => s.case_id !== id);
    store.evidence = store.evidence.filter(e => e.case_id !== id);
    store.findings = store.findings.filter(f => f.case_id !== id);
    store.questions = store.questions.filter(q => q.case_id !== id);
    store.timeline = store.timeline.filter(t => t.case_id !== id);
    store.nodes = store.nodes.filter(n => n.case_id !== id);
    store.edges = store.edges.filter(e => e.case_id !== id);
    saveCaseStore(store);
    await k108Log(username, 'case_delete', { caseId: req.params.id, name: c?.name }, req.ip);
  }
  res.json({ ok: true });
});

// Case subjects
app.post('/api/k108/cases/:id/subjects', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { profileId, role } = req.body;
  if (!profileId) return res.status(400).json({ error: 'Profile ID required' });
  if (db.pool) {
    try {
      const r = await db.query('INSERT INTO k108_case_subjects (case_id, profile_id, role) VALUES ($1, $2, $3) ON CONFLICT (case_id, profile_id) DO UPDATE SET role = $3 RETURNING *', [req.params.id, profileId, role || 'Associate']);
      await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]);
      const p = await db.query('SELECT first_name, last_name FROM k108_profiles WHERE id = $1', [profileId]);
      await k108Log(username, 'case_subject_add', { caseId: req.params.id, profileId, name: p.rows[0] ? `${p.rows[0].first_name} ${p.rows[0].last_name}` : '' }, req.ip);
      return res.json({ subject: r.rows[0] });
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const store = getCaseStore(); const caseId = parseInt(req.params.id);
  const existing = store.subjects.find(s => s.case_id === caseId && s.profile_id === parseInt(profileId));
  if (existing) { existing.role = role || 'Associate'; } else { store.subjects.push({ id: caseNextId(store), case_id: caseId, profile_id: parseInt(profileId), role: role || 'Associate', created_at: new Date().toISOString() }); }
  saveCaseStore(store);
  await k108Log(username, 'case_subject_add', { caseId: req.params.id, profileId }, req.ip);
  res.json({ subject: store.subjects[store.subjects.length - 1] });
});

app.put('/api/k108/cases/:id/subjects/:sid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { role } = req.body;
  if (db.pool) { await db.query('UPDATE k108_case_subjects SET role = $1 WHERE id = $2', [role, req.params.sid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); const s = store.subjects.find(s => s.id === parseInt(req.params.sid)); if (s) s.role = role; saveCaseStore(store); }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/subjects/:sid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_subjects WHERE id = $1', [req.params.sid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); store.subjects = store.subjects.filter(s => s.id !== parseInt(req.params.sid)); saveCaseStore(store); }
  await k108Log(username, 'case_subject_remove', { caseId: req.params.id, subjectId: req.params.sid }, req.ip);
  res.json({ ok: true });
});

// Case evidence
app.post('/api/k108/cases/:id/evidence', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { type, title, metadata, sourceId, notes } = req.body;
  if (!type || !title) return res.status(400).json({ error: 'Type and title required' });
  if (db.pool) {
    const r = await db.query('INSERT INTO k108_case_evidence (case_id, type, title, metadata, source_id, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [req.params.id, type, title, JSON.stringify(metadata || {}), sourceId || null, notes || '']);
    await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]);
    await k108Log(username, 'case_evidence_add', { caseId: req.params.id, type, title }, req.ip);
    return res.json({ evidence: r.rows[0] });
  }
  const store = getCaseStore();
  const ev = { id: caseNextId(store), case_id: parseInt(req.params.id), type, title, metadata: metadata || {}, source_id: sourceId || null, notes: notes || '', created_at: new Date().toISOString() };
  store.evidence.push(ev);
  saveCaseStore(store);
  await k108Log(username, 'case_evidence_add', { caseId: req.params.id, type, title }, req.ip);
  res.json({ evidence: ev });
});

app.put('/api/k108/cases/:id/evidence/:eid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { title, notes, metadata } = req.body;
  if (db.pool) {
    const sets = []; const params = [];
    if (title !== undefined) { params.push(title); sets.push(`title = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); sets.push(`notes = $${params.length}`); }
    if (metadata !== undefined) { params.push(JSON.stringify(metadata)); sets.push(`metadata = $${params.length}`); }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.params.eid);
    await db.query(`UPDATE k108_case_evidence SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]);
  } else {
    const store = getCaseStore(); const ev = store.evidence.find(e => e.id === parseInt(req.params.eid));
    if (ev) { if (title !== undefined) ev.title = title; if (notes !== undefined) ev.notes = notes; if (metadata !== undefined) ev.metadata = metadata; saveCaseStore(store); }
  }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/evidence/:eid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_evidence WHERE id = $1', [req.params.eid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); store.evidence = store.evidence.filter(e => e.id !== parseInt(req.params.eid)); saveCaseStore(store); }
  await k108Log(username, 'case_evidence_remove', { caseId: req.params.id, evidenceId: req.params.eid }, req.ip);
  res.json({ ok: true });
});

// Case findings
app.post('/api/k108/cases/:id/findings', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  if (db.pool) {
    const maxIdx = await db.query('SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM k108_case_findings WHERE case_id = $1', [req.params.id]);
    const r = await db.query('INSERT INTO k108_case_findings (case_id, text, order_index) VALUES ($1, $2, $3) RETURNING *', [req.params.id, text, maxIdx.rows[0].next]);
    await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]);
    await k108Log(username, 'case_finding_add', { caseId: req.params.id }, req.ip);
    return res.json({ finding: r.rows[0] });
  }
  const store = getCaseStore(); const caseId = parseInt(req.params.id);
  const existing = store.findings.filter(f => f.case_id === caseId);
  const nextIdx = existing.length ? Math.max(...existing.map(f => f.order_index || 0)) + 1 : 0;
  const f = { id: caseNextId(store), case_id: caseId, text, resolved: false, order_index: nextIdx, created_at: new Date().toISOString() };
  store.findings.push(f);
  saveCaseStore(store);
  await k108Log(username, 'case_finding_add', { caseId: req.params.id }, req.ip);
  res.json({ finding: f });
});

app.put('/api/k108/cases/:id/findings/:fid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { text, resolved, order_index } = req.body;
  if (db.pool) {
    const sets = []; const params = [];
    if (text !== undefined) { params.push(text); sets.push(`text = $${params.length}`); }
    if (resolved !== undefined) { params.push(resolved); sets.push(`resolved = $${params.length}`); }
    if (order_index !== undefined) { params.push(order_index); sets.push(`order_index = $${params.length}`); }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.params.fid);
    await db.query(`UPDATE k108_case_findings SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]);
  } else {
    const store = getCaseStore(); const f = store.findings.find(f => f.id === parseInt(req.params.fid));
    if (f) { if (text !== undefined) f.text = text; if (resolved !== undefined) f.resolved = resolved; if (order_index !== undefined) f.order_index = order_index; saveCaseStore(store); }
  }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/findings/:fid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_findings WHERE id = $1', [req.params.fid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); store.findings = store.findings.filter(f => f.id !== parseInt(req.params.fid)); saveCaseStore(store); }
  await k108Log(username, 'case_finding_delete', { caseId: req.params.id }, req.ip);
  res.json({ ok: true });
});

// Case questions
app.post('/api/k108/cases/:id/questions', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  if (db.pool) {
    const r = await db.query('INSERT INTO k108_case_questions (case_id, text) VALUES ($1, $2) RETURNING *', [req.params.id, text]);
    await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]);
    return res.json({ question: r.rows[0] });
  }
  const store = getCaseStore();
  const q = { id: caseNextId(store), case_id: parseInt(req.params.id), text, resolved: false, created_at: new Date().toISOString() };
  store.questions.push(q);
  saveCaseStore(store);
  res.json({ question: q });
});

app.put('/api/k108/cases/:id/questions/:qid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { text, resolved } = req.body;
  if (db.pool) { const sets = []; const params = []; if (text !== undefined) { params.push(text); sets.push(`text = $${params.length}`); } if (resolved !== undefined) { params.push(resolved); sets.push(`resolved = $${params.length}`); } if (!sets.length) return res.json({ ok: true }); params.push(req.params.qid); await db.query(`UPDATE k108_case_questions SET ${sets.join(', ')} WHERE id = $${params.length}`, params); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); const q = store.questions.find(q => q.id === parseInt(req.params.qid)); if (q) { if (text !== undefined) q.text = text; if (resolved !== undefined) q.resolved = resolved; saveCaseStore(store); } }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/questions/:qid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_questions WHERE id = $1', [req.params.qid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); store.questions = store.questions.filter(q => q.id !== parseInt(req.params.qid)); saveCaseStore(store); }
  res.json({ ok: true });
});

// Case timeline
app.post('/api/k108/cases/:id/timeline', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { event_date, event_type, description, evidence_ids } = req.body;
  if (!description) return res.status(400).json({ error: 'Description required' });
  if (db.pool) { const r = await db.query('INSERT INTO k108_case_timeline (case_id, event_date, event_type, description, evidence_ids) VALUES ($1, $2, $3, $4, $5) RETURNING *', [req.params.id, event_date || null, event_type || 'Incident', description, JSON.stringify(evidence_ids || [])]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); await k108Log(username, 'case_timeline_add', { caseId: req.params.id }, req.ip); return res.json({ event: r.rows[0] }); }
  const store = getCaseStore();
  const t = { id: caseNextId(store), case_id: parseInt(req.params.id), event_date: event_date || null, event_type: event_type || 'Incident', description, evidence_ids: evidence_ids || [], created_at: new Date().toISOString() };
  store.timeline.push(t); saveCaseStore(store);
  await k108Log(username, 'case_timeline_add', { caseId: req.params.id }, req.ip);
  res.json({ event: t });
});

app.put('/api/k108/cases/:id/timeline/:tid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { event_date, event_type, description, evidence_ids } = req.body;
  if (db.pool) { const sets = []; const params = []; if (event_date !== undefined) { params.push(event_date); sets.push(`event_date = $${params.length}`); } if (event_type !== undefined) { params.push(event_type); sets.push(`event_type = $${params.length}`); } if (description !== undefined) { params.push(description); sets.push(`description = $${params.length}`); } if (evidence_ids !== undefined) { params.push(JSON.stringify(evidence_ids)); sets.push(`evidence_ids = $${params.length}`); } if (!sets.length) return res.json({ ok: true }); params.push(req.params.tid); await db.query(`UPDATE k108_case_timeline SET ${sets.join(', ')} WHERE id = $${params.length}`, params); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); const t = store.timeline.find(t => t.id === parseInt(req.params.tid)); if (t) { if (event_date !== undefined) t.event_date = event_date; if (event_type !== undefined) t.event_type = event_type; if (description !== undefined) t.description = description; if (evidence_ids !== undefined) t.evidence_ids = evidence_ids; saveCaseStore(store); } }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/timeline/:tid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_timeline WHERE id = $1', [req.params.tid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); store.timeline = store.timeline.filter(t => t.id !== parseInt(req.params.tid)); saveCaseStore(store); }
  await k108Log(username, 'case_timeline_delete', { caseId: req.params.id }, req.ip);
  res.json({ ok: true });
});

// Canvas nodes
app.post('/api/k108/cases/:id/nodes', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { type, label, x, y, metadata } = req.body;
  if (db.pool) { const r = await db.query('INSERT INTO k108_case_canvas_nodes (case_id, type, label, x, y, metadata) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [req.params.id, type || 'Note', label || '', x || 200, y || 200, JSON.stringify(metadata || {})]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); await k108Log(username, 'case_canvas_node_add', { caseId: req.params.id, type, label }, req.ip); return res.json({ node: r.rows[0] }); }
  const store = getCaseStore();
  const n = { id: caseNextId(store), case_id: parseInt(req.params.id), type: type || 'Note', label: label || '', x: x || 200, y: y || 200, metadata: metadata || {}, created_at: new Date().toISOString() };
  store.nodes.push(n); saveCaseStore(store);
  await k108Log(username, 'case_canvas_node_add', { caseId: req.params.id, type, label }, req.ip);
  res.json({ node: n });
});

app.put('/api/k108/cases/:id/nodes/:nid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { type, label, x, y, metadata } = req.body;
  if (db.pool) { const sets = []; const params = []; if (type !== undefined) { params.push(type); sets.push(`type = $${params.length}`); } if (label !== undefined) { params.push(label); sets.push(`label = $${params.length}`); } if (x !== undefined) { params.push(x); sets.push(`x = $${params.length}`); } if (y !== undefined) { params.push(y); sets.push(`y = $${params.length}`); } if (metadata !== undefined) { params.push(JSON.stringify(metadata)); sets.push(`metadata = $${params.length}`); } if (!sets.length) return res.json({ ok: true }); params.push(req.params.nid); await db.query(`UPDATE k108_case_canvas_nodes SET ${sets.join(', ')} WHERE id = $${params.length}`, params); }
  else { const store = getCaseStore(); const n = store.nodes.find(n => n.id === parseInt(req.params.nid)); if (n) { if (type !== undefined) n.type = type; if (label !== undefined) n.label = label; if (x !== undefined) n.x = x; if (y !== undefined) n.y = y; if (metadata !== undefined) n.metadata = metadata; saveCaseStore(store); } }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/nodes/:nid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_canvas_nodes WHERE id = $1', [req.params.nid]); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); }
  else { const store = getCaseStore(); const nid = parseInt(req.params.nid); store.nodes = store.nodes.filter(n => n.id !== nid); store.edges = store.edges.filter(e => e.from_node_id !== nid && e.to_node_id !== nid); saveCaseStore(store); }
  await k108Log(username, 'case_canvas_node_delete', { caseId: req.params.id }, req.ip);
  res.json({ ok: true });
});

// Canvas edges
app.post('/api/k108/cases/:id/edges', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { from_node_id, to_node_id, label } = req.body;
  if (!from_node_id || !to_node_id) return res.status(400).json({ error: 'From and to node IDs required' });
  if (db.pool) { const r = await db.query('INSERT INTO k108_case_canvas_edges (case_id, from_node_id, to_node_id, label) VALUES ($1, $2, $3, $4) RETURNING *', [req.params.id, from_node_id, to_node_id, label || '']); await db.query('UPDATE k108_cases SET updated_at = NOW(), last_edited_by = $1 WHERE id = $2', [username, req.params.id]); return res.json({ edge: r.rows[0] }); }
  const store = getCaseStore();
  const e = { id: caseNextId(store), case_id: parseInt(req.params.id), from_node_id, to_node_id, label: label || '', created_at: new Date().toISOString() };
  store.edges.push(e); saveCaseStore(store);
  res.json({ edge: e });
});

app.put('/api/k108/cases/:id/edges/:eid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { label } = req.body;
  if (db.pool) { await db.query('UPDATE k108_case_canvas_edges SET label = $1 WHERE id = $2', [label || '', req.params.eid]); }
  else { const store = getCaseStore(); const e = store.edges.find(e => e.id === parseInt(req.params.eid)); if (e) { e.label = label || ''; saveCaseStore(store); } }
  res.json({ ok: true });
});

app.delete('/api/k108/cases/:id/edges/:eid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) { await db.query('DELETE FROM k108_case_canvas_edges WHERE id = $1', [req.params.eid]); }
  else { const store = getCaseStore(); store.edges = store.edges.filter(e => e.id !== parseInt(req.params.eid)); saveCaseStore(store); }
  res.json({ ok: true });
});

// ── Profile case files lookup (for bidirectional link) ───────────────────────
app.post('/api/k108/profiles/:id/cases', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (db.pool) {
    const r = await db.query(`SELECT c.id, c.name, c.status, c.created_at, cs.role FROM k108_case_subjects cs JOIN k108_cases c ON cs.case_id = c.id WHERE cs.profile_id = $1 ORDER BY c.updated_at DESC`, [req.params.id]);
    return res.json({ cases: r.rows });
  }
  // JSON fallback
  const store = getCaseStore();
  const profileId = parseInt(req.params.id);
  const subjectEntries = store.subjects.filter(s => s.profile_id === profileId);
  const cases = subjectEntries.map(s => {
    const c = store.cases.find(c => c.id === s.case_id);
    return c ? { id: c.id, name: c.name, status: c.status, created_at: c.created_at, role: s.role } : null;
  }).filter(Boolean);
  res.json({ cases });
});

// ── K-108 Daily Briefing ─────────────────────────────────────────────────────
app.post('/api/k108/briefing/submit', async (req, res) => {
  const secret = req.headers['x-briefing-secret'] || req.body.secret;
  if (secret !== process.env.BRIEFING_SECRET) return res.status(403).json({ error: 'Invalid secret' });
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  await db.query('INSERT INTO k108_briefings (content) VALUES ($1)', [content]);
  io.emit('k108:briefing:new', { timestamp: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/api/k108/briefing/latest', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ briefings: [] });
  const r = await db.query('SELECT * FROM k108_briefings ORDER BY created_at DESC LIMIT 10');
  res.json({ briefings: r.rows });
});

app.get('/api/k108/briefing/yesterday', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (secret !== process.env.BRIEFING_SECRET) return res.status(403).json({ error: 'Invalid secret' });
  if (!db.pool) return res.json({ content: '' });
  const r = await db.query(`SELECT content FROM k108_briefings WHERE created_at >= NOW() - INTERVAL '2 days' ORDER BY created_at DESC LIMIT 1`);
  res.json({ content: r.rows[0]?.content || '' });
});


// ── Serve HTML pages ──────────────────────────────────────────────────────────
app.get('/k108',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'k108.html')));
app.get('/debrief',  (_, res) => res.sendFile(path.join(__dirname, 'public', 'debrief.html')));
app.get('/app',      (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/guest',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'guest.html')));
app.get('/backdoor', (_, res) => res.sendFile(path.join(__dirname, 'public', 'backdoor.html')));
app.get('/eval',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'eval.html')));
app.get('/kemari',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'kemari.html')));
app.get('/kaliph',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'bingo-kaliph.html')));
app.get('/naomi',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'bingo-naomi.html')));

// ═══════════════════════════════════════════════════════════════════════════════
// BINGO DAY (temporary — remove after Monday)
// ═══════════════════════════════════════════════════════════════════════════════

const BINGO_SQUARES = [
  "Andy pisses Kaliph off",
  "Allison trickin' on everyone",
  "Zari says she misses Kaliph so much",
  "Security guards tell us to go back",
  "Martin says shut up",
  "Kaliph steals food from Culinary",
  "Andy caresses one of us",
  "We get Dunkin'",
  "Noah flirts with Kaliph",
  '"You got yo phone back" — Jzirah',
  "Brian says the N word",
  "Brian pisses off Naomi",
  "Jzirah or Zari catches an attitude",
  "Zari plays What I Say — Queen Key",
  "Zari doesn't come to school",
  "Security questions where we're going",
  "Martini pulls Kaliph's hair",
  "Noah says you look tea",
  "Canon cries",
  "One of David's friends comes to the table",
  "Naomi's mom comes late",
  "Someone gets an ice cream sandwich",
  "Noah touches Naomi",
  "Jzirah pisses Naomi off",
  "Andy talks about Androfsky",
];

function shuffleBingoSquares() {
  const pool = [...BINGO_SQUARES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, 24);
  picked.splice(12, 0, 'FREE');
  return picked;
}

const BINGO_LINES = [
  [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
  [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
  [0,6,12,18,24],[4,8,12,16,20],
];

function countBingoLines(marked) {
  return BINGO_LINES.filter(line => line.every(i => marked[i])).length;
}

async function getBingoCounts() {
  const r = await db.query('SELECT user_id, bingo_count FROM bingo_state');
  const counts = { kaliph: 0, naomi: 0 };
  for (const row of r.rows) counts[row.user_id] = row.bingo_count;
  return counts;
}

async function getOrCreateBingoState(user) {
  let r = await db.query('SELECT squares, marked, bingo_count FROM bingo_state WHERE user_id = $1', [user]);
  if (r.rows.length === 0) {
    const squares = shuffleBingoSquares();
    const marked = Array(25).fill(false);
    marked[12] = true; // FREE
    await db.query(
      'INSERT INTO bingo_state (user_id, squares, marked, bingo_count) VALUES ($1, $2, $3, 0)',
      [user, JSON.stringify(squares), JSON.stringify(marked)]
    );
    return { squares, marked, bingoCount: 0 };
  }
  const row = r.rows[0];
  return { squares: row.squares, marked: row.marked, bingoCount: row.bingo_count };
}

app.get('/api/bingo/state/:user', async (req, res) => {
  const user = req.params.user;
  if (user !== 'kaliph' && user !== 'naomi') return res.status(400).json({ error: 'Invalid user' });
  try {
    const state = await getOrCreateBingoState(user);
    const counts = await getBingoCounts();
    res.json({ squares: state.squares, marked: state.marked, kaliphCount: counts.kaliph, naomiCount: counts.naomi });
  } catch (err) {
    console.error('[bingo] state error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bingo/mark', async (req, res) => {
  const { user, index, marked: isMarked } = req.body;
  if (user !== 'kaliph' && user !== 'naomi') return res.status(400).json({ error: 'Invalid user' });
  if (typeof index !== 'number' || index < 0 || index > 24 || index === 12) return res.status(400).json({ error: 'Invalid index' });
  try {
    const state = await getOrCreateBingoState(user);
    state.marked[index] = !!isMarked;
    const newLines = countBingoLines(state.marked);
    let newBingo = false;
    if (newLines > state.bingoCount) {
      await db.query('UPDATE bingo_state SET marked = $1, bingo_count = $2 WHERE user_id = $3',
        [JSON.stringify(state.marked), newLines, user]);
      newBingo = true;
    } else {
      await db.query('UPDATE bingo_state SET marked = $1, bingo_count = $2 WHERE user_id = $3',
        [JSON.stringify(state.marked), newLines, user]);
    }
    const counts = await getBingoCounts();
    const payload = { user, marked: state.marked, kaliphCount: counts.kaliph, naomiCount: counts.naomi };
    io.emit('bingo:state', payload);
    if (newBingo) io.emit('bingo:hit', { user, kaliphCount: counts.kaliph, naomiCount: counts.naomi });
    res.json(payload);
  } catch (err) {
    console.error('[bingo] mark error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Kemari — request more slides (sends brrr notification to Kaliph)
app.post('/api/kemari/request-slides', async (req, res) => {
  const secret = process.env.BRRR_WEBHOOK_KALIPH;
  if (!secret) return res.status(500).json({ error: 'Webhook not configured' });
  try {
    const r = await fetch(`https://api.brrr.now/v1/${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Kemari needs more slides! \u{1F3AD}',
        message: 'Kemari finished all 20 slides and is requesting more annunciation practice material.',
        sound: 'bubble_ding',
        'interruption-level': 'active',
      }),
    });
    if (!r.ok) throw new Error(`brrr responded ${r.status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[kemari] brrr notification failed:', err.message);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

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
  // ── Debrief presentation sync ──
  socket.on('debrief:presenter-join', () => {
    debriefPresenterState.connected = true;
    debriefPresenterState.socketId = socket.id;
    debriefPresenterState.slideIndex = 0;
    debriefPresenterState.revealStep = 0;
    socket.broadcast.emit('debrief:presenter-join');
  });
  socket.on('debrief:slide-change', (data) => {
    debriefPresenterState.slideIndex = data.slideIndex;
    debriefPresenterState.revealStep = 0;
    socket.broadcast.emit('debrief:slide-change', data);
  });
  socket.on('debrief:reveal', (data) => {
    debriefPresenterState.slideIndex = data.slideIndex;
    debriefPresenterState.revealStep = data.revealStep;
    socket.broadcast.emit('debrief:reveal', data);
  });
  socket.on('debrief:lightbox-open', (data) => {
    socket.broadcast.emit('debrief:lightbox-open', data);
  });
  socket.on('debrief:lightbox-close', () => {
    socket.broadcast.emit('debrief:lightbox-close');
  });
  socket.on('debrief:volume-change', (data) => {
    socket.broadcast.emit('debrief:volume-change', data);
  });
  socket.on('debrief:request-state', () => {
    if (debriefPresenterState.connected) {
      socket.emit('debrief:state', {
        slideIndex: debriefPresenterState.slideIndex,
        revealStep: debriefPresenterState.revealStep
      });
    }
  });

  socket.on('disconnect', () => {
    // Check if disconnected socket was debrief presenter
    if (debriefPresenterState.socketId === socket.id) {
      debriefPresenterState.connected = false;
      debriefPresenterState.socketId = null;
      io.emit('debrief:presenter-leave');
    }

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
    try { await db.query(`CREATE TABLE IF NOT EXISTS bingo_state (
      id SERIAL PRIMARY KEY, user_id VARCHAR(20) NOT NULL UNIQUE,
      squares JSONB NOT NULL, marked JSONB NOT NULL,
      bingo_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    )`); } catch (e) { console.error('[bingo] table error:', e.message); }
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
