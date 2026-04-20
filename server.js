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

// Mobile login — combines site auth + profile selection in one step (iOS app)
app.post('/api/auth/mobile-login', async (req, res) => {
  const { user, pin } = req.body;
  if (!['kaliph', 'kathrine'].includes(user)) return res.json({ success: false, error: 'Invalid user' });
  const users = rd(F.users);
  const profile = users[user];
  if (profile && profile.profilePasscode) {
    if (!pin) return res.json({ success: false, needsPasscode: true });
    const match = await checkPasscode(pin, profile.profilePasscode);
    if (!match) return res.json({ success: false, error: 'Incorrect passcode' });
    if (!profile.profilePasscode.startsWith('$2b$') && !profile.profilePasscode.startsWith('$2a$')) {
      users[user].profilePasscode = await bcrypt.hash(pin, 10);
      wd(F.users, users);
    }
  }
  delete req.session.isGuest;
  delete req.session.guestId;
  req.session.authenticated = true;
  req.session.user = user;
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

// Mobile app login — trusted iOS clients skip site password
const mobileLoginAttempts = {};
app.post('/api/auth/mobile-login', async (req, res) => {
  const { user, pin } = req.body;
  if (!['kaliph', 'kathrine'].includes(user)) return res.status(401).json({ error: 'Invalid PIN' });

  // Rate limiting: 5 attempts per user, 10 minute lockout
  const now = Date.now();
  const record = mobileLoginAttempts[user] || { count: 0, lockedUntil: 0 };
  if (record.lockedUntil > now) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  if (record.count >= 5) {
    record.lockedUntil = now + 10 * 60 * 1000;
    record.count = 0;
    mobileLoginAttempts[user] = record;
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const users = rd(F.users);
  const u = users[user];
  if (!u || !u.profilePasscode) return res.status(401).json({ error: 'Invalid PIN' });

  const match = await checkPasscode(pin, u.profilePasscode);
  if (!match) {
    record.count = (record.count || 0) + 1;
    mobileLoginAttempts[user] = record;
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  // Success — reset attempts and create session
  delete mobileLoginAttempts[user];
  delete req.session.isGuest;
  delete req.session.guestId;
  req.session.authenticated = true;
  req.session.user = user;
  req.session.loginTime = Date.now();
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    res.json({ success: true, user });
  });
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
  const { user, content, topics } = req.body;
  if (!['kaliph', 'kathrine'].includes(user) || !content) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  const today = todayCentral(); // YYYY-MM-DD
  try {
    const ins = await db.query(`
      INSERT INTO briefings (user_id, content, date, generated_at, read_at)
      VALUES ($1, $2, $3, NOW(), NULL)
      ON CONFLICT (user_id, date) DO UPDATE
        SET content = $2, generated_at = NOW(), read_at = NULL
      RETURNING id
    `, [user, content, today]);
    const briefingId = ins.rows[0].id;

    // Store topic log if provided — structured dedup source for future briefings.
    // Expected shape: [{ key, summary, section }] or ["topic-key", ...]
    if (Array.isArray(topics) && topics.length) {
      await db.query(`DELETE FROM briefing_topics WHERE briefing_id = $1`, [briefingId]);
      for (const t of topics) {
        const key = (typeof t === 'string' ? t : t.key || '').trim().toLowerCase().slice(0, 120);
        if (!key) continue;
        const summary = (typeof t === 'object' && t.summary) ? String(t.summary).slice(0, 300) : null;
        const section = (typeof t === 'object' && t.section) ? String(t.section).slice(0, 80) : null;
        await db.query(
          `INSERT INTO briefing_topics (briefing_id, user_id, briefing_date, topic_key, summary, section)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [briefingId, user, today, key, summary, section]
        );
      }
    }

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
// JSON-backed briefings fallback — used when Postgres isn't configured.
// Shape: { [user]: { [YYYY-MM-DD]: { content, generatedAt, readAt } } }
const briefingsJsonPath = path.join(__dirname, 'data', 'briefings.json');
function readBriefingsJson() {
  try { return JSON.parse(fs.readFileSync(briefingsJsonPath, 'utf8')); } catch { return {}; }
}
function writeBriefingsJson(obj) {
  try { fs.writeFileSync(briefingsJsonPath, JSON.stringify(obj, null, 2)); } catch (e) { console.error('[briefings] json write:', e.message); }
}

app.get('/api/briefings/today', mainAuth, async (req, res) => {
  const date = req.query.date || todayCentral();
  if (db.pool) {
    try {
      const result = await db.query(
        'SELECT content, generated_at, read_at, date FROM briefings WHERE user_id = $1 AND date = $2',
        [req.session.user, date]
      );
      if (!result.rows.length) return res.json({ found: false, date });
      const row = result.rows[0];
      return res.json({
        found: true,
        date: row.date,
        content: row.content,
        generatedAt: row.generated_at,
        isRead: !!row.read_at,
      });
    } catch (e) {
      console.error('[briefings] Fetch error:', e.message);
      // fall through to JSON fallback
    }
  }
  // JSON fallback
  const all = readBriefingsJson();
  const row = (all[req.session.user] || {})[date];
  if (!row) return res.json({ found: false, date });
  res.json({
    found: true,
    date,
    content: row.content,
    generatedAt: row.generatedAt,
    isRead: !!row.readAt,
  });
});

// Get list of dates that have briefings (for navigation)
app.get('/api/briefings/dates', mainAuth, async (req, res) => {
  if (db.pool) {
    try {
      const result = await db.query(
        'SELECT date FROM briefings WHERE user_id = $1 ORDER BY date DESC',
        [req.session.user]
      );
      return res.json({ dates: result.rows.map(r => r.date.toISOString().slice(0, 10)) });
    } catch (e) {
      console.error('[briefings] Dates error:', e.message);
    }
  }
  const all = readBriefingsJson();
  const dates = Object.keys(all[req.session.user] || {}).sort().reverse();
  res.json({ dates });
});

// Mark today's briefing as read
app.post('/api/briefings/read', mainAuth, async (req, res) => {
  const date = req.body.date || todayCentral();
  if (db.pool) {
    try {
      await db.query(
        'UPDATE briefings SET read_at = NOW() WHERE user_id = $1 AND date = $2 AND read_at IS NULL',
        [req.session.user, date]
      );
      return res.json({ success: true });
    } catch (e) {
      console.error('[briefings] Read error:', e.message);
    }
  }
  const all = readBriefingsJson();
  if (all[req.session.user] && all[req.session.user][date]) {
    all[req.session.user][date].readAt = new Date().toISOString();
    writeBriefingsJson(all);
  }
  res.json({ success: true });
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

// Fetch most recent briefings for a user (external API)
app.get('/api/briefings/recent', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = req.query.user;
  if (!user || !['kaliph', 'kathrine'].includes(user)) {
    return res.status(400).json({ error: 'Invalid or missing user param' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 7, 1), 14);
  try {
    const result = await db.query(
      `SELECT id, user_id AS "user", content, date, created_at FROM briefings
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [user, limit]
    );
    const ids = result.rows.map(r => r.id);
    let topicsByBriefing = {};
    if (ids.length) {
      const t = await db.query(
        `SELECT briefing_id, topic_key, summary, section FROM briefing_topics WHERE briefing_id = ANY($1)`,
        [ids]
      );
      for (const row of t.rows) {
        if (!topicsByBriefing[row.briefing_id]) topicsByBriefing[row.briefing_id] = [];
        topicsByBriefing[row.briefing_id].push({ key: row.topic_key, summary: row.summary, section: row.section });
      }
    }
    res.json(result.rows.map(r => ({ ...r, topics: topicsByBriefing[r.id] || [] })));
  } catch (e) {
    console.error('[briefings] Recent error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deduped list of topics covered in the last N days — deterministic dedup source
app.get('/api/briefings/topics', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = req.query.user;
  if (!user || !['kaliph', 'kathrine'].includes(user)) {
    return res.status(400).json({ error: 'Invalid or missing user param' });
  }
  const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 90);
  try {
    const result = await db.query(
      `SELECT topic_key, section,
              MAX(briefing_date) AS last_covered,
              COUNT(*)::int AS times_covered,
              (array_agg(summary ORDER BY briefing_date DESC))[1] AS latest_summary
       FROM briefing_topics
       WHERE user_id = $1 AND briefing_date >= CURRENT_DATE - ($2 || ' days')::interval
       GROUP BY topic_key, section
       ORDER BY last_covered DESC`,
      [user, String(days)]
    );
    // Render as a prompt-friendly plaintext table
    let out = `TOPICS ALREADY COVERED (last ${days} days — do not repeat unless a specific, concrete new development):\n`;
    for (const row of result.rows) {
      const d = new Date(row.last_covered).toISOString().slice(0, 10);
      const parts = [`- ${row.topic_key}`];
      if (row.section) parts.push(`[${row.section}]`);
      parts.push(`last: ${d}`);
      if (row.times_covered > 1) parts.push(`×${row.times_covered}`);
      if (row.latest_summary) parts.push(`— ${row.latest_summary}`);
      out += parts.join(' ') + '\n';
    }
    if (!result.rows.length) out = 'No topics on record yet — proceed normally.\n';
    res.type('text/plain').send(out);
  } catch (e) {
    console.error('[briefings] Topics error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// List active standing preferences for the logged-in user (for "Manage Preferences" UI)
app.get('/api/briefings/preferences', mainAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, rule_text, source, created_at, updated_at
       FROM briefing_standing_preferences
       WHERE user_id = $1 AND active = TRUE
       ORDER BY created_at DESC`,
      [req.session.user]
    );
    res.json({ preferences: result.rows });
  } catch (e) {
    console.error('[briefings] Prefs list error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a manual standing preference
app.post('/api/briefings/preferences', mainAuth, async (req, res) => {
  const { rule_text } = req.body;
  if (!rule_text || typeof rule_text !== 'string' || !rule_text.trim()) {
    return res.status(400).json({ error: 'rule_text required' });
  }
  try {
    const ins = await db.query(
      `INSERT INTO briefing_standing_preferences (user_id, rule_text, source) VALUES ($1, $2, 'manual') RETURNING id`,
      [req.session.user, rule_text.trim()]
    );
    res.json({ success: true, id: ins.rows[0].id });
  } catch (e) {
    console.error('[briefings] Prefs add error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deactivate (undo) a standing preference
app.delete('/api/briefings/preferences/:id', mainAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const r = await db.query(
      `UPDATE briefing_standing_preferences
       SET active = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, req.session.user]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('[briefings] Prefs delete error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Save briefing feedback from the app
app.post('/api/briefings/feedback', mainAuth, async (req, res) => {
  const { feedback_type, section, highlighted_text, note, permanent, context_before, context_after } = req.body;
  const validTypes = ['thumbs_up', 'thumbs_down', 'highlight_positive', 'highlight_negative', 'highlight_never', 'free_text'];
  if (!feedback_type || !validTypes.includes(feedback_type)) {
    return res.status(400).json({ error: 'Invalid feedback_type' });
  }
  const isPermanent = feedback_type === 'highlight_never' ? true : !!permanent;
  const today = todayCentral();
  try {
    const ins = await db.query(`
      INSERT INTO briefing_feedback (user_id, briefing_date, feedback_type, section, highlighted_text, note, permanent, context_before, context_after)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [req.session.user, today, feedback_type, section || null, highlighted_text || null, note || null, isPermanent, context_before || null, context_after || null]);

    // highlight_never → immediately mirror as a standing preference so UI can show/undo it
    if (feedback_type === 'highlight_never' && highlighted_text) {
      const ruleText = `Never include: "${highlighted_text}"` + (section ? ` (seen in ${section})` : '');
      await db.query(`
        INSERT INTO briefing_standing_preferences (user_id, rule_text, source, source_ref, active)
        VALUES ($1, $2, 'highlight_never', $3, TRUE)
      `, [req.session.user, ruleText, String(ins.rows[0].id)]);
    }
    res.json({ success: true, id: ins.rows[0].id });
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
    // Active standing preferences (highlight_never + consolidation + manual)
    // Cap at 40 most recent to avoid flooding the prompt with stale noise.
    const standingResult = await db.query(
      `SELECT rule_text, source, created_at
       FROM briefing_standing_preferences
       WHERE user_id = $1 AND active = TRUE
       ORDER BY created_at DESC
       LIMIT 40`,
      [user]
    );
    // Recent non-permanent, non-consolidated feedback from last 7 days (narrower window = less noise)
    const recentResult = await db.query(
      `SELECT feedback_type, section, highlighted_text, note, context_before, context_after, briefing_date, created_at
       FROM briefing_feedback
       WHERE user_id = $1 AND permanent = FALSE AND consolidated = FALSE
         AND created_at >= NOW() - INTERVAL '7 days'
       ORDER BY created_at ASC`,
      [user]
    );

    if (!standingResult.rows.length && !recentResult.rows.length) {
      return res.json({ feedback: null });
    }

    let output = '';

    // Use header "PERMANENT PREFERENCES" for backward compatibility with existing Cowork prompts.
    if (standingResult.rows.length) {
      // Dedupe identical rule_text (backfill + manual may repeat)
      const seen = new Set();
      const unique = [];
      for (const row of standingResult.rows) {
        const k = row.rule_text.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(row);
      }
      // Show newest first so the most recent preferences get the top of the prompt
      output += 'PERMANENT PREFERENCES (apply every day, no exceptions):\n';
      for (const row of unique) {
        output += `- ${row.rule_text}\n`;
      }
    }

    if (recentResult.rows.length) {
      // Count repetitions for tagging, but DO NOT reorder — emit chronologically like before.
      const countKey = r => `${r.feedback_type}|${r.section || ''}|${(r.highlighted_text || '').slice(0, 60)}`;
      const counts = new Map();
      for (const row of recentResult.rows) {
        const k = countKey(row);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      // Only emit each group's LATEST occurrence when count >= 2, so the model doesn't see duplicates.
      const emitted = new Set();

      if (output) output += '\n';
      output += "RECENT FEEDBACK (last 7 days — reader's actual reactions to delivered briefings):\n";

      for (const row of recentResult.rows) {
        const k = countKey(row);
        const count = counts.get(k);
        if (count >= 2) {
          if (emitted.has(k)) continue;
          emitted.add(k);
        }
        const dateStr = new Date(row.briefing_date).toISOString().slice(0, 10);
        const parts = [dateStr];
        if (count >= 2) parts.push(`(repeated ${count}x)`);
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

    // Fetch existing active standing preferences so the LLM can dedupe / refine against them
    const existingPrefs = await db.query(
      `SELECT rule_text FROM briefing_standing_preferences WHERE user_id = $1 AND active = TRUE ORDER BY created_at ASC`,
      [user]
    );
    const existingText = existingPrefs.rows.map(r => `- ${r.rule_text}`).join('\n') || '(none yet)';

    // Use Anthropic SDK to summarize
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: "You are a briefing preference analyst. Given raw feedback items from a user about their daily briefing, produce concise standing instructions that a briefing-generation AI should follow going forward. Output ONLY the rules, one per line, each starting with '- '. No preamble, no headers, no explanation. Each rule must be specific, actionable, and written as a directive (e.g. 'Never cover X', 'Keep Y short', 'Always include Z when it happens'). If an existing rule already covers something, do not restate it. If new feedback contradicts or refines an existing rule, write the refined version and prefix it with 'REPLACES: <old rule quoted>' on the line above.",
      messages: [{ role: 'user', content: `EXISTING STANDING PREFERENCES:\n${existingText}\n\nNEW RAW FEEDBACK (older than 7 days, not yet consolidated):\n${rawSummary}\n\nProduce new or refined standing rules.` }],
    });
    const summary = resp.content[0]?.text || '';

    // Parse the LLM output into rule lines and persist each as a standing preference
    const lines = summary.split('\n').map(l => l.trim()).filter(Boolean);
    let pendingReplace = null;
    let persisted = 0;
    for (const line of lines) {
      if (line.startsWith('REPLACES:')) {
        pendingReplace = line.slice('REPLACES:'.length).trim().replace(/^["']|["']$/g, '');
        continue;
      }
      const rule = line.replace(/^-\s*/, '').trim();
      if (!rule) { pendingReplace = null; continue; }

      if (pendingReplace) {
        await db.query(
          `UPDATE briefing_standing_preferences SET active = FALSE, updated_at = NOW()
           WHERE user_id = $1 AND rule_text = $2 AND active = TRUE`,
          [user, pendingReplace]
        );
        pendingReplace = null;
      }
      // Dedupe: skip if an identical active rule already exists
      const dup = await db.query(
        `SELECT id FROM briefing_standing_preferences WHERE user_id = $1 AND rule_text = $2 AND active = TRUE LIMIT 1`,
        [user, rule]
      );
      if (!dup.rows.length) {
        await db.query(
          `INSERT INTO briefing_standing_preferences (user_id, rule_text, source) VALUES ($1, $2, 'consolidation')`,
          [user, rule]
        );
        persisted++;
      }
    }

    // Mark all processed rows as consolidated
    const ids = result.rows.map(r => r.id);
    await db.query(
      `UPDATE briefing_feedback SET consolidated = TRUE WHERE id = ANY($1)`,
      [ids]
    );

    res.type('text/plain').send(`Consolidated ${result.rows.length} feedback items → ${persisted} new standing preferences.\n\n${summary}`);
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

// Context messages for K-108 mini chat: GET /api/chat/context?before=<msgId>&limit=3
app.get('/api/chat/context', mainAuth, async (req, res) => {
  const beforeId = req.query.before;
  const limit = Math.min(parseInt(req.query.limit) || 3, 10);
  if (!beforeId) return res.json([]);

  if (db.pool) {
    try {
      const ref = await db.getMessageById(beforeId);
      if (!ref) return res.json([]);
      const msgs = await db.getMessages({ before: ref.timestamp, limit });
      return res.json(msgs);
    } catch (e) {
      console.error('[db] context error:', e.message);
    }
  }

  // JSON fallback
  const msgs = rd(F.messages);
  const main = msgs?.main || [];
  const refIdx = main.findIndex(m => m.id === beforeId);
  if (refIdx === -1) return res.json([]);
  const start = Math.max(0, refIdx - limit);
  return res.json(main.slice(start, refIdx));
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
// PUBLIC EVENTS API  (for external dashboard — API key auth, CORS enabled)
// ═══════════════════════════════════════════════════════════════════════════════

const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || '';
const DASHBOARD_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://kaliph-os-production.up.railway.app',
  ...(process.env.DASHBOARD_ORIGIN ? [process.env.DASHBOARD_ORIGIN] : []),
];

function dashboardCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && DASHBOARD_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function dashboardAuth(req, res, next) {
  if (!DASHBOARD_API_KEY) return res.status(503).json({ error: 'Dashboard API not configured' });
  if (req.headers['x-api-key'] !== DASHBOARD_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Map internal event → public schema
function toPublicEvent(ev) {
  const startRaw = ev.start || ev.date || '';
  const endRaw   = ev.end   || ev.start || ev.date || '';
  const extractDate = s => (s || '').slice(0, 10);
  const extractTime = s => {
    if (!s) return undefined;
    const t = s.length > 10 ? new Date(s).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' }) : undefined;
    return t === '24:00' ? '00:00' : t;
  };
  const out = { id: ev.id, title: ev.title, date: extractDate(startRaw) };
  const t = extractTime(startRaw); if (t) out.time = t;
  const et = extractTime(endRaw);  if (et && et !== out.time) out.endTime = et;
  if (ev.description) out.description = ev.description;
  if (ev.tag) out.tag = ev.tag;
  return out;
}

app.options('/api/events', dashboardCors, (_, res) => res.sendStatus(204));
app.get('/api/events', dashboardCors, dashboardAuth, (req, res) => {
  const cal = rd(F.calendar) || {};
  let events = [
    ...(cal.shared    || []),
    ...(cal.kaliph    || []),
    ...(cal.kathrine  || []),
  ];

  // Deduplicate by id (shared may overlap per-user lists)
  const seen = new Set();
  events = events.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

  // Date-range filtering via ?start=YYYY-MM-DD&end=YYYY-MM-DD
  const { start, end } = req.query;
  if (start || end) {
    events = events.filter(e => {
      const d = (e.start || e.date || '').slice(0, 10);
      if (start && d < start) return false;
      if (end   && d > end)   return false;
      return true;
    });
  }

  events.sort((a, b) => {
    const da = a.start || a.date || '';
    const db = b.start || b.date || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });

  res.json({ events: events.map(toPublicEvent) });
});

app.options('/api/bell-schedule/:userId', dashboardCors, (_, res) => res.sendStatus(204));
app.get('/api/bell-schedule/:userId', dashboardCors, dashboardAuth, (req, res) => {
  const userId = req.params.userId.toLowerCase();
  const s = rd(F.settings) || {};
  const bs = s.bellSchedule || {};
  const userData = bs[userId];
  if (!userData) return res.status(404).json({ error: `No bell schedule found for "${userId}"` });

  const skips = s._scheduleSkips || {};
  const now = new Date(Date.now() + (global._siteTimeOffsetMs || 0));
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const dayName = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).toLowerCase();

  const todaySkipped = skips[userId] === todayISO;
  const isWeekend = dayName === 'saturday' || dayName === 'sunday';

  let todaySchedule;
  if (todaySkipped || isWeekend) {
    todaySchedule = 'none';
  } else if (userData.lateStartDay && userData.lateStartDay === dayName) {
    todaySchedule = 'lateStart';
  } else {
    todaySchedule = 'regular';
  }

  res.json({
    regular:      userData.regular      || [],
    lateStart:    userData.lateStart    || [],
    lateStartDay: userData.lateStartDay || '',
    todaySkipped,
    todaySchedule,
  });
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
// Uses Chicago time for the reference date to stay consistent with user timezone
function getBudgetPeriodServer(anchorDate, ref) {
  const parts = anchorDate.split('-');
  const anchorMs = Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 12);
  const c = getChicagoComponents(ref || getSiteNow());
  const refMs = Date.UTC(c.year, c.month - 1, c.day, 12);
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

// ── Chicago timezone helpers ────────────────────────────────────────────────
function getChicagoComponents(date) {
  const d = date || getSiteNow();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour === 24 ? 0 : +parts.hour,
    minute: +parts.minute,
  };
}

function chicagoDateStr(date = new Date()) {
  const c = getChicagoComponents(date);
  return `${c.year}-${String(c.month).padStart(2,'0')}-${String(c.day).padStart(2,'0')}`;
}

function isChicagoTimePast(hour, minute = 0) {
  const c = getChicagoComponents();
  return c.hour > hour || (c.hour === hour && c.minute >= minute);
}

function computeSurplusServer(budget, money) {
  // Compute surplus for the current (ending) period
  const { periodStart, periodEnd } = getBudgetPeriodServer(budget.anchorDate);
  const startStr = utcDateStrServer(periodStart);
  const endStr = utcDateStrServer(periodEnd);
  const transactions = money?.transactions || [];

  // Total budgeted across all categories
  let totalBudgeted = 0;
  for (const cat of (budget.categories || [])) totalBudgeted += cat.budgetAmount || 0;

  // Total spent = ALL expenses in the current period
  const totalSpent = transactions
    .filter(t => t.type === 'expense' && t.date >= startStr && t.date <= endStr)
    .reduce((s, t) => s + (t.amount || 0), 0);

  // Cash balance (excludes investments and savings goals)
  const cashBalance = (money?.balances?.kaliph?.amount || 0) + (money?.balances?.kathrine?.amount || 0);

  // Surplus = unbudgeted balance (sweepable amount)
  const unbudgeted = Math.max(0, cashBalance - totalBudgeted);
  return Math.round(unbudgeted * 100) / 100;
}

// Brrr budget notification — fires once per period on the period END day at 7 AM Chicago time
async function checkAndFireBudgetBrrr(budget, money) {
  const { periodStart, periodEnd } = getBudgetPeriodServer(budget.anchorDate);
  const periodStartISO = utcDateStrServer(periodStart);
  const periodEndISO = utcDateStrServer(periodEnd);
  if (budget.lastBrrrPeriod === periodStartISO) return;

  // Only fire on the period END day at/after 7 AM Chicago time
  const todayISO = chicagoDateStr();
  if (todayISO !== periodEndISO) return;
  if (!isChicagoTimePast(7)) return;

  // Only fire if allocation is still pending
  if ((budget.lastAllocatedPeriodEnd || budget.lastAllocatedPeriod) === periodEndISO) return;

  const surplus = computeSurplusServer(budget, money);
  if (surplus <= 0) return; // no surplus to allocate

  const msg = `Budget period ending today \u2014 you have $${surplus.toFixed(0)} left over. Time to allocate!`;

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

// Auto-email statement on the period END day at 7 AM Chicago time
async function checkAndSendBudgetStatement(budget, money) {
  const { periodStart, periodEnd } = getBudgetPeriodServer(budget.anchorDate);
  const periodStartISO = utcDateStrServer(periodStart);
  const periodEndISO = utcDateStrServer(periodEnd);
  if (budget.lastStatementEmailedPeriod === periodStartISO) return;

  // Only fire on the period END day at/after 7 AM Chicago time
  const todayISO = chicagoDateStr();
  if (todayISO !== periodEndISO) return;
  if (!isChicagoTimePast(7)) return;

  // Generate statement for the CURRENT (ending) period
  const periodLabel = getPeriodLabelServer(periodStart, periodEnd);

  try {
    await sendStatementNotification(periodLabel);

    // Brrr to Kaliph confirming statement was sent
    const kaliphWebhook = process.env.BRRR_WEBHOOK_KALIPH;
    if (kaliphWebhook) {
      fetch(`https://api.brrr.now/v1/${kaliphWebhook}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Kat & Kai \u{1F4C4}', message: `Budget statement for ${periodLabel} has been emailed`, sound: 'bubble_ding', 'interruption-level': 'active' }),
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
  if (budget.lastAllocatedPeriodEnd === undefined) budget.lastAllocatedPeriodEnd = null;
  if (budget.lastBrrrPeriod === undefined) budget.lastBrrrPeriod = null;
  if (budget.lastStatementEmailedPeriod === undefined) budget.lastStatementEmailedPeriod = null;

  // Fire Brrr notification on period end day at 7 AM Chicago time (non-blocking)
  const money = rd(F.money);
  checkAndFireBudgetBrrr(budget, money).catch(e => console.error('[brrr] budget check error:', e.message));

  // Capture balance snapshot for this period if not yet captured
  try { captureBudgetSnapshotIfNeeded(budget, money); } catch (e) { console.error('[snapshot] error:', e.message); }

  // Auto-email statement on period end day at 7 AM Chicago time (non-blocking)
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

  // Set lastAllocatedPeriodEnd to current period end (tracks which period was allocated)
  const { periodEnd: currentPE } = getBudgetPeriodServer(budget.anchorDate);
  budget.lastAllocatedPeriodEnd = utcDateStrServer(currentPE);

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

// ── Eval UI theme persistence (shared across all devices/browsers) ──
// GET is intentionally unauthenticated so the saved theme can be applied
// on the auth screen before login. The value is a harmless UI preference.
app.get('/api/eval/ui-theme', (_req, res) => {
  const s = rd(F.settings);
  const theme = (s && s.evalUiTheme) || 'hacker';
  res.json({ theme });
});

app.post('/api/eval/ui-theme', (req, res) => {
  if (!evalAuth(req, res)) return;
  const theme = String(req.body.theme || '').toLowerCase();
  if (!['hacker', 'cyber', 'amber'].includes(theme)) {
    return res.status(400).json({ error: 'Invalid theme' });
  }
  const s = rd(F.settings) || {};
  s.evalUiTheme = theme;
  wd(F.settings, s);
  res.json({ ok: true, theme });
});

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
      const valid = ['kaliph', 'kathrine', 'royal', 'dark', 'light', 'neon', 'noir', 'rosewood', 'ocean', 'forest', 'arctic', 'obsidian', 'applemusic'];
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

  // ── CENSOR / DEMO MODE ──
  if (cmd === 'censor' || cmd === 'demo') {
    if (parts[1] === 'on') {
      io.emit('censor-mode', { active: true });
      return lines('Demo/censor mode activated on all open pages', 'success');
    }
    if (parts[1] === 'off') {
      io.emit('censor-mode', { active: false });
      return lines('Demo/censor mode deactivated on all open pages', 'success');
    }
    return lines('Usage: censor on | censor off', 'info');
  }

  // ── BUDGET RESET ALLOCATION (for testing) ──
  if (cmd === 'budget' && parts[1] === 'reset-alloc') {
    const budget = rd(F.budget);
    if (!budget) return lines('No budget data found', 'warn');
    delete budget.lastAllocatedPeriod;
    delete budget.lastAllocatedPeriodEnd;
    delete budget.lastBrrrPeriod;
    delete budget.lastStatementEmailedPeriod;
    wd(F.budget, budget);
    return lines('Budget allocation/notification flags cleared', 'success');
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
    if (sub === 'create') {
      const name = parts.slice(2).join(' ');
      if (!name) return lines('Usage: guests create <name>', 'warn');
      const id = uuidv4();
      const password = Math.random().toString(36).slice(2, 10);
      guests[id] = {
        id, name, passwordHash: await bcrypt.hash(password, 10),
        createdBy: 'eval', createdAt: Date.now(),
        expiresAt: null, active: true,
        channels: ['kaliph', 'kathrine', 'group'],
        messages: { kaliph: [], kathrine: [], group: [] },
      };
      wd(F.guests, guests);
      io.emit('guest-created', { guestId: id, name });
      return multi(
        [`Guest "${name}" created`, 'success'],
        [`  ID: ${id.substring(0, 8)}`, 'data'],
        [`  Password: ${password}`, 'highlight'],
        [`  Share: /guest → name: ${name}, pass: ${password}`, 'dim'],
      );
    }
    return lines('Usage: guests list | guests archive | guests messages <id> [channel] | guests revoke <id> | guests create <name>', 'warn');
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

  // ── TOTP ──
  if (cmd === 'totp') {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'list') {
      const all = rd(F.totp) || {};
      const rows = [];
      for (const [user, accounts] of Object.entries(all)) {
        if (!Array.isArray(accounts)) continue;
        accounts.forEach(a => rows.push([user, a.id?.substring(0, 8) || '—', a.name || '—', a.issuer || '—']));
      }
      if (!rows.length) return lines('No TOTP accounts', 'dim');
      return { lines: [{ text: `${rows.length} 2FA accounts`, cls: 'success' }], table: { headers: ['User', 'ID', 'Name', 'Issuer'], rows } };
    }
    if (sub === 'reset') {
      const users = rd(F.users);
      for (const user of ['kaliph', 'kathrine']) {
        if (users[user]) delete users[user].totpPassword;
      }
      wd(F.users, users);
      return lines('TOTP authenticator password reset for all users', 'success');
    }
    return lines('Usage: totp list | totp reset', 'warn');
  }

  // ── PUSH STATUS ──
  if (cmd === 'push' && parts[1]?.toLowerCase() === 'status') {
    const subs = getPushSubs();
    const out = [{ text: '── Push Notification Subscriptions ──', cls: 'header' }];
    let total = 0;
    for (const [user, arr] of Object.entries(subs)) {
      const count = Array.isArray(arr) ? arr.length : 0;
      total += count;
      out.push({ text: `  ${user}: ${count} device${count !== 1 ? 's' : ''}`, cls: 'data' });
    }
    if (!total) return lines('No push subscriptions registered', 'dim');
    out.push({ text: `  Total: ${total} subscriptions`, cls: 'success' });
    return { lines: out };
  }

  // ── ARCHIVIST QUEUE ──
  if (cmd === 'archivist') {
    if (!db.pool) return lines('Database required for archivist', 'error');
    const r = await db.query('SELECT id, name, requested_by, status, created_at FROM surveillance_queue ORDER BY created_at DESC LIMIT 20');
    if (!r.rows.length) return lines('Archivist queue is empty', 'dim');
    return { lines: [{ text: `${r.rows.length} items in queue`, cls: 'success' }], table: { headers: ['ID', 'Name', 'Requested By', 'Status', 'Created'], rows: r.rows.map(q => [String(q.id), q.name, q.requested_by || '—', q.status || 'pending', new Date(q.created_at).toLocaleString()]) } };
  }

  // ── BUDGET ──
  if (cmd === 'budget') {
    const sub = parts[1]?.toLowerCase();
    const budget = rd(F.budget) || {};
    if (sub === 'status' || !sub) {
      const cats = budget.categories || [];
      const totalBudget = cats.reduce((s, c) => s + (c.budgetAmount || 0), 0);
      return multi(
        ['── Budget Overview ──', 'header'],
        [`  Categories: ${cats.length}`, 'data'],
        [`  Total budgeted: $${totalBudget.toFixed(2)}`, 'data'],
        [`  Period: ${budget.period || 'monthly'}`, 'data'],
      );
    }
    if (sub === 'categories') {
      const cats = budget.categories || [];
      if (!cats.length) return lines('No budget categories', 'dim');
      return { lines: [{ text: `${cats.length} categories`, cls: 'success' }], table: { headers: ['ID', 'Name', 'Emoji', 'Budget', 'Color'], rows: cats.map(c => [c.id?.substring(0, 8) || '—', c.name, c.emoji || '—', '$' + (c.budgetAmount || 0).toFixed(2), c.color || '—']) } };
    }
    return lines('Usage: budget status | budget categories', 'warn');
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
    if (sub === 'transactions') {
      const txns = money.transactions || [];
      const count = parseInt(parts[2]) || 20;
      const slice = txns.slice(-count).reverse();
      if (!slice.length) return lines('No transactions', 'dim');
      return { lines: [{ text: `Last ${slice.length} of ${txns.length} transactions`, cls: 'success' }], table: { headers: ['Date', 'User', 'Description', 'Amount', 'Category'], rows: slice.map(t => [new Date(t.date || t.createdAt).toLocaleDateString(), t.user || '—', (t.description || t.note || '').substring(0, 30), (t.amount >= 0 ? '+' : '') + '$' + (t.amount || 0).toFixed(2), t.category || '—']) } };
    }
    if (sub === 'goals') {
      const goals = money.goals || [];
      if (!goals.length) return lines('No savings goals', 'dim');
      return { lines: [{ text: `${goals.length} savings goals`, cls: 'success' }], table: { headers: ['Name', 'Target', 'Saved', 'Progress'], rows: goals.map(g => [g.name || '—', '$' + (g.target || 0).toFixed(2), '$' + (g.saved || g.current || 0).toFixed(2), Math.round(((g.saved || g.current || 0) / (g.target || 1)) * 100) + '%']) } };
    }
    if (sub === 'recurring') {
      const rec = money.recurring || [];
      if (!rec.length) return lines('No recurring payments', 'dim');
      return { lines: [{ text: `${rec.length} recurring payments`, cls: 'success' }], table: { headers: ['Name', 'Amount', 'Frequency', 'User', 'Next'], rows: rec.map(r => [(r.description || r.name || '—').substring(0, 25), '$' + Math.abs(r.amount || 0).toFixed(2), r.frequency || r.interval || '—', r.user || '—', r.nextDate ? new Date(r.nextDate).toLocaleDateString() : '—']) } };
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

  // ── WHOAMI ──
  if (cmd === 'whoami') {
    const activeUsers = Object.entries(onlineUsers).map(([name, info]) => `${name} (${info.state || 'connected'})`);
    return multi(
      ['── Active Sessions ──', 'header'],
      [`  Online users: ${activeUsers.length ? activeUsers.join(', ') : 'none'}`, 'data'],
      [`  Socket connections: ${io.engine?.clientsCount || Object.keys(onlineUsers).length}`, 'data'],
      [`  Maintenance mode: ${maintenanceMode ? 'ON' : 'OFF'}`, 'data'],
    );
  }

  // ── HEALTH ──
  if (cmd === 'health') {
    const mem = process.memoryUsage();
    const secs = Math.floor(process.uptime());
    const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
    return multi(
      ['── Server Health ──', 'header'],
      [`  Uptime:     ${d}d ${h}h ${m}m`, 'data'],
      [`  Memory RSS: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`, 'data'],
      [`  Heap Used:  ${(mem.heapUsed / 1024 / 1024).toFixed(1)} / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`, 'data'],
      [`  External:   ${(mem.external / 1024 / 1024).toFixed(1)} MB`, 'data'],
      [`  Node:       ${process.version}`, 'data'],
      [`  Platform:   ${process.platform} ${process.arch}`, 'data'],
      [`  PID:        ${process.pid}`, 'dim'],
      [`  Database:   ${db.pool ? 'Postgres connected' : 'JSON files (no DB)'}`, 'data'],
      [`  Online:     ${Object.keys(onlineUsers).join(', ') || 'none'}`, 'data'],
    );
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
    if (sub === 'label') {
      const action = parts[2]?.toLowerCase();
      if (action === 'list') {
        if (!db.pool) return lines('Database required for K-108 labels', 'error');
        const r = await db.query('SELECT id, name, color, icon FROM k108_labels ORDER BY name');
        if (!r.rows.length) return lines('No K-108 labels found', 'dim');
        return { lines: [{ text: `${r.rows.length} K-108 labels`, cls: 'success' }], table: { headers: ['ID', 'Name', 'Color', 'Icon'], rows: r.rows.map(l => [String(l.id), l.name, l.color || '—', l.icon || '—']) } };
      }
      if (action === 'create') {
        const name = parts.slice(3).join(' ');
        if (!name) return lines('Usage: k108 label create <name>', 'warn');
        if (!db.pool) return lines('Database required', 'error');
        const r = await db.query('INSERT INTO k108_labels (name, color, icon) VALUES ($1, $2, $3) RETURNING id', [name, '#3b82f6', 'tag']);
        return lines(`K-108 label created: "${name}" (ID: ${r.rows[0].id})`, 'success');
      }
      return lines('Usage: k108 label list | k108 label create <name>', 'warn');
    }
    if (sub === 'vault') {
      if (parts[2]?.toLowerCase() === 'stats') {
        if (!db.pool) return lines('Database required for K-108 vault', 'error');
        const items = await db.query('SELECT COUNT(*) as count FROM k108_vault_items');
        const folders = await db.query('SELECT COUNT(*) as count FROM k108_vault_folders');
        const size = await db.query('SELECT COALESCE(SUM(file_size), 0) as total FROM k108_vault_items');
        const sizeMB = (Number(size.rows[0].total) / (1024 * 1024)).toFixed(2);
        return multi(
          ['── K-108 Document Vault ──', 'header'],
          [`  Files:   ${items.rows[0].count}`, 'data'],
          [`  Folders: ${folders.rows[0].count}`, 'data'],
          [`  Size:    ${sizeMB} MB`, 'data'],
        );
      }
      return lines('Usage: k108 vault stats', 'warn');
    }
    if (sub === 'activity') {
      if (!db.pool) return lines('Database required for K-108 activity', 'error');
      const r = await db.query('SELECT * FROM k108_activity_log ORDER BY created_at DESC LIMIT 10');
      if (!r.rows.length) return lines('No K-108 activity recorded', 'dim');
      return { lines: [{ text: 'Last 10 K-108 Activity Log entries:', cls: 'header' }], table: { headers: ['Time', 'User', 'Action', 'Detail'], rows: r.rows.map(e => [new Date(e.created_at).toLocaleString(), e.username, e.action_type, JSON.stringify(e.detail || {}).substring(0, 50)]) } };
    }
    if (sub === 'sms') {
      if (parts[2]?.toLowerCase() === 'quota') {
        const q = getK108Quota('sms');
        return lines(`K-108 SMS quota: ${q.used}/${q.total} used — ${q.total - q.used} remaining`, 'success');
      }
      return lines('Usage: k108 sms quota', 'warn');
    }
    if (sub === 'profile') {
      const searchTerm = parts.slice(2).join(' ');
      if (!searchTerm) return lines('Usage: k108 profile <name>', 'warn');
      if (!db.pool) return lines('Database required for K-108 profiles', 'error');
      const r = await db.query(`SELECT id, first_name, last_name, aliases FROM k108_profiles WHERE LOWER(first_name || ' ' || last_name) LIKE $1 OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE LOWER(a) LIKE $1) ORDER BY updated_at DESC LIMIT 10`, ['%' + searchTerm.toLowerCase() + '%']);
      if (!r.rows.length) return lines('No matching K-108 profiles', 'warn');
      return { lines: [{ text: `${r.rows.length} profiles found:`, cls: 'success' }], table: { headers: ['ID', 'Name', 'Aliases'], rows: r.rows.map(p => [String(p.id), `${p.first_name} ${p.last_name}`, (p.aliases || []).join(', ') || '—']) } };
    }
    if (sub === 'case') {
      const searchTerm = parts.slice(2).join(' ');
      if (!searchTerm) return lines('Usage: k108 case <name>', 'warn');
      if (!db.pool) return lines('Database required for K-108 cases', 'error');
      const r = await db.query('SELECT id, name, status, priority FROM k108_cases WHERE LOWER(name) LIKE $1 ORDER BY updated_at DESC LIMIT 10', ['%' + searchTerm.toLowerCase() + '%']);
      if (!r.rows.length) return lines('No matching K-108 cases', 'warn');
      return { lines: [{ text: `${r.rows.length} cases found:`, cls: 'success' }], table: { headers: ['ID', 'Name', 'Status', 'Priority'], rows: r.rows.map(c => [String(c.id), c.name, c.status || '—', c.priority || '—']) } };
    }
    if (sub === 'stats') {
      if (!db.pool) return lines('Database required for K-108 stats', 'error');
      const profiles = await db.query('SELECT COUNT(*) as count FROM k108_profiles');
      const cases = await db.query('SELECT COUNT(*) as count FROM k108_cases');
      const vault = await db.query('SELECT COUNT(*) as count FROM k108_vault_items');
      const labels = await db.query('SELECT COUNT(*) as count FROM k108_labels');
      const activity = await db.query('SELECT COUNT(*) as count FROM k108_activity_log');
      let smsInfo = '—';
      try { const q = getK108Quota('sms'); smsInfo = `${q.used}/${q.total} used`; } catch {}
      return multi(
        ['── K-108 Database Overview ──', 'header'],
        [`  Profiles:  ${profiles.rows[0].count}`, 'data'],
        [`  Cases:     ${cases.rows[0].count}`, 'data'],
        [`  Vault:     ${vault.rows[0].count} files`, 'data'],
        [`  Labels:    ${labels.rows[0].count}`, 'data'],
        [`  Activity:  ${activity.rows[0].count} entries`, 'data'],
        [`  SMS Quota: ${smsInfo}`, 'data'],
      );
    }
    return multi(
      ['K-108 Commands:', 'header'],
      ['  k108 reset-passcode <user>    — Reset K-108 passcode', 'info'],
      ['  k108 label list/create        — Manage labels', 'info'],
      ['  k108 vault stats              — Vault statistics', 'info'],
      ['  k108 activity                 — Recent activity', 'info'],
      ['  k108 sms quota                — SMS remaining', 'info'],
      ['  k108 profile <name>           — Search profiles', 'info'],
      ['  k108 case <name>              — Search cases', 'info'],
      ['  k108 stats                    — Database overview', 'info'],
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
const k108ProfileActivityMem = {}; // in-memory fallback for profile activity log (profileId -> [{username, action, created_at}])
function logProfileActivity(profileId, username, action) {
  const key = String(profileId);
  if (!k108ProfileActivityMem[key]) k108ProfileActivityMem[key] = [];
  k108ProfileActivityMem[key].unshift({ username, action, created_at: new Date().toISOString() });
  if (k108ProfileActivityMem[key].length > 20) k108ProfileActivityMem[key].length = 20;
}
function getProfileActivity(profileId, limit = 5) {
  return (k108ProfileActivityMem[String(profileId)] || []).slice(0, limit);
}
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
      // Ensure mainAuth works from K-108 (needed for mini chat send)
      if (!req.session.user) { req.session.user = localUser; req.session.save(() => {}); }
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
  // Ensure mainAuth works from K-108 (needed for mini chat send)
  if (!req.session.user) { req.session.user = username; req.session.save(() => {}); }
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

// ── K-108 Chat Hint Flag ─────────────────────────────────────────────────────
app.get('/api/k108/chat-hint', (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const users = rd(F.users);
  const seen = !!(users?.[username]?.k108ChatHintSeen);
  res.json({ seen });
});

app.post('/api/k108/chat-hint/seen', (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const users = rd(F.users);
  if (users?.[username]) {
    users[username].k108ChatHintSeen = true;
    wd(F.users, users);
  }
  res.json({ ok: true });
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
    if (resp.status === 404) {
      return { source: 'whitepages', status: 'ok', raw: { not_found: true, results: [] } };
    }
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
  return wpFetch('person', { phone: phone });
}

async function searchPeopleByAddress(street, city, state, zip) {
  const params = { street: street };
  if (city) params.city = city;
  if (state) params.state_code = state;
  if (zip) params.zipcode = zip;
  return wpFetch('person', params);
}

function parseAddressString(addrStr) {
  if (!addrStr || typeof addrStr !== 'string') return { street: '', city: '', state: '', zip: '' };
  // Format: "123 Main St, Seattle, WA 98101" or "123 Main St, Seattle, WA"
  const parts = addrStr.split(',').map(s => s.trim());
  const street = parts[0] || '';
  const city = parts[1] || '';
  const stateZip = (parts[2] || '').trim().split(' ');
  const state = stateZip[0] || '';
  const zip = stateZip[1] || '';
  return { street, city, state, zip };
}

function normalizeResults(apiResult) {
  if (!apiResult || apiResult.status !== 'ok' || !apiResult.raw) return [];
  const raw = apiResult.raw;

  // API returns a top-level array of person objects
  let people = [];
  if (Array.isArray(raw)) {
    people = raw;
  } else if (raw.not_found) {
    return [];
  } else if (raw.person) {
    people = Array.isArray(raw.person) ? raw.person : [raw.person];
  } else if (raw.results) {
    people = Array.isArray(raw.results) ? raw.results : [raw.results];
  } else if (raw.name || raw.id) {
    people = [raw];
  }

  return people.filter(Boolean).map(p => {
    // Name is a plain string in the API response
    const full = typeof p.name === 'string' ? p.name
      : p.full_name || p.fullName || `${p.first_name || p.firstname || ''} ${p.last_name || p.lastname || ''}`.trim();
    const nameParts = full.split(' ');
    const fn = nameParts[0] || '';
    const ln = nameParts.slice(1).join(' ') || '';

    // Age from date_of_birth or age field
    let age = p.age || p.age_range || null;
    if (!age && p.date_of_birth) {
      const dob = new Date(p.date_of_birth);
      if (!isNaN(dob)) age = String(new Date().getFullYear() - dob.getFullYear());
    }

    // Addresses: current_addresses and historic_addresses contain { id, address: "string" }
    const currentAddrs = (p.current_addresses || []).filter(Boolean).map(a => ({
      ...parseAddressString(typeof a === 'string' ? a : a.address),
      current: true
    }));
    const historicAddrs = (p.historic_addresses || []).filter(Boolean).map(a => ({
      ...parseAddressString(typeof a === 'string' ? a : a.address),
      current: false
    }));
    const addresses = [...currentAddrs, ...historicAddrs];

    // Phones: { number, type, score }
    const rawPhones = p.phones || p.phone_numbers || [];
    const phones = rawPhones.filter(Boolean).map(ph => ({
      number: ph.number || ph.phone_number || ph.phone || '',
      type: ph.type || ph.line_type || '',
      carrier: ph.carrier || ''
    }));

    // Emails: { address, score }
    const rawEmails = p.emails || p.email_addresses || [];
    const emails = rawEmails.filter(Boolean).map(e => typeof e === 'string' ? e : (e.address || e.email_address || e.email || ''));

    // Relatives: { id, name }
    const rawRels = p.relatives || p.associated_people || p.associates || [];
    const relatives = rawRels.filter(Boolean).map(r => ({
      name: typeof r === 'string' ? r : (r.name || `${r.first_name || ''} ${r.last_name || ''}`.trim()),
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

// ── K-108 Document Vault ─────────────────────────────────────────────────────
app.post('/api/k108/vault/items', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ items: [], folders: [] });
  // Ensure folder support columns exist
  try { await db.query(`ALTER TABLE k108_vault ADD COLUMN IF NOT EXISTS folder_id INTEGER DEFAULT NULL`); } catch(e) {}
  try { await db.query(`CREATE TABLE IF NOT EXISTS k108_vault_folders (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, parent_id INTEGER DEFAULT NULL, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT NOW())`); } catch(e) {}
  const { folderId } = req.body;
  const folderFilter = folderId ? 'WHERE folder_id = $1' : 'WHERE folder_id IS NULL';
  const params = folderId ? [folderId] : [];
  const r = await db.query('SELECT * FROM k108_vault ' + folderFilter + ' ORDER BY transferred_at DESC', params);
  const fr = await db.query('SELECT * FROM k108_vault_folders WHERE ' + (folderId ? 'parent_id = $1' : 'parent_id IS NULL') + ' ORDER BY name', params);
  res.json({ items: r.rows, folders: fr.rows });
});

app.post('/api/k108/vault/upload', upload.array('files', 10), async (req, res) => {
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const folderId = req.body.folderId || null;
  const inserted = [];
  for (const file of (req.files || [])) {
    const r = await db.query(
      'INSERT INTO k108_vault (filename, original_name, mime_type, size, transferred_by, folder_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [`/uploads/${file.filename}`, file.originalname, file.mimetype, file.size, username, folderId]
    );
    inserted.push(r.rows[0]);
    await k108Log(username, 'file_upload', { filename: file.originalname }, req.ip);
  }
  res.json({ ok: true, items: inserted });
});

// Rename vault item
app.post('/api/k108/vault/rename', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'ID and name required' });
  await db.query('UPDATE k108_vault SET original_name = $1 WHERE id = $2', [name.trim(), id]);
  res.json({ ok: true });
});

// Delete vault item
app.post('/api/k108/vault/delete', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  await db.query('DELETE FROM k108_vault WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Create folder
app.post('/api/k108/vault/folder/create', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { name, parentId } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = await db.query('INSERT INTO k108_vault_folders (name, parent_id, created_by) VALUES ($1, $2, $3) RETURNING *', [name.trim(), parentId || null, username]);
  res.json({ ok: true, folder: r.rows[0] });
});

// Rename folder
app.post('/api/k108/vault/folder/rename', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'ID and name required' });
  await db.query('UPDATE k108_vault_folders SET name = $1 WHERE id = $2', [name.trim(), id]);
  res.json({ ok: true });
});

// Delete folder (and move contents to parent)
app.post('/api/k108/vault/folder/delete', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  // Get folder's parent
  const fr = await db.query('SELECT parent_id FROM k108_vault_folders WHERE id = $1', [id]);
  const parentId = fr.rows[0] ? fr.rows[0].parent_id : null;
  // Move files and subfolders to parent
  await db.query('UPDATE k108_vault SET folder_id = $1 WHERE folder_id = $2', [parentId, id]);
  await db.query('UPDATE k108_vault_folders SET parent_id = $1 WHERE parent_id = $2', [parentId, id]);
  await db.query('DELETE FROM k108_vault_folders WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Move item to folder
app.post('/api/k108/vault/move', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, folderId, isFolder } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  if (isFolder) {
    await db.query('UPDATE k108_vault_folders SET parent_id = $1 WHERE id = $2', [folderId || null, id]);
  } else {
    await db.query('UPDATE k108_vault SET folder_id = $1 WHERE id = $2', [folderId || null, id]);
  }
  res.json({ ok: true });
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
      const whereClause = conditions.join(' OR ');
      const [r, countR] = await Promise.all([
        db.query(`SELECT * FROM k108_profiles WHERE ${whereClause} ORDER BY updated_at DESC LIMIT 20`, params),
        db.query(`SELECT COUNT(*) FROM k108_profiles WHERE ${whereClause}`, params)
      ]);
      return res.json({ profiles: r.rows, total_count: parseInt(countR.rows[0].count, 10) });
    } else {
      const [r, countR] = await Promise.all([
        db.query('SELECT * FROM k108_profiles ORDER BY updated_at DESC LIMIT 20'),
        db.query('SELECT COUNT(*) FROM k108_profiles')
      ]);
      return res.json({ profiles: r.rows, total_count: parseInt(countR.rows[0].count, 10) });
    }
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
  const { first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address, employer_info, classified_data } = req.body;

  if (db.pool) {
    try {
      const colInfo = await db.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='k108_profiles' AND column_name='phones'`);
      const isJsonb = colInfo.rows[0]?.udt_name === 'jsonb';
      const aliasVal = Array.isArray(aliases) ? aliases : (aliases ? [aliases] : []);
      const phoneVal = isJsonb ? JSON.stringify(phones || []) : (phones || []).map(p => typeof p === 'string' ? p : (p.number || ''));
      const emailVal = isJsonb ? JSON.stringify(emails || []) : (emails || []).map(e => typeof e === 'string' ? e : (e.address || ''));
      const phoneSql = isJsonb ? '$7::jsonb' : '$7';
      const emailSql = isJsonb ? '$8::jsonb' : '$8';

      const r = await db.query(
        `INSERT INTO k108_profiles (first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address, created_by, employer_info, classified_data)
         VALUES ($1,$2,$3,$4,$5,$6,${phoneSql},${emailSql},$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb) RETURNING *`,
        [first_name || '', middle_name || null, last_name || '', aliasVal, relation || '', notes || '',
         phoneVal, emailVal, JSON.stringify(social_links || []), age || '', birthday || null, JSON.stringify(address || {}), username,
         JSON.stringify(employer_info || {}), JSON.stringify(classified_data || [])]
      );
      // Log profile creation to profile activity log
      await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [r.rows[0].id, username, 'created']);
      await k108Log(username, 'profile_create', { name: `${first_name} ${last_name}`.trim() }, req.ip);
      return res.json({ profile: r.rows[0] });
    } catch(e) {
      console.error('[K108] Profile create error:', e.message);
      return res.status(500).json({ error: 'Create failed: ' + e.message });
    }
  }
  // JSON fallback
  const profiles = getK108Profiles();
  const profile = { id: Date.now(), first_name: first_name||'', last_name: last_name||'', aliases: aliases||[], photo_url: null, relation: relation||'', notes: notes||'', phones: phones||[], emails: emails||[], social_links: social_links||[], age: age||'', birthday: birthday||null, address: address||{}, employer_info: employer_info||{}, classified_data: classified_data||[], created_by: username, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  profiles.push(profile);
  saveK108Profiles(profiles);
  logProfileActivity(profile.id, username, 'created');
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
    // Never expose classified data in normal profile response — only via reveal-classified
    const hasClassified = (Array.isArray(p.classified_data) ? p.classified_data : []).length > 0;
    delete p.classified_data;
    // Log profile view to profile activity log (skip if reloading after save)
    if (!req.query.skipLog) await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [req.params.id, username, 'viewed']);
    await k108Log(username, 'profile_view', { profileId: req.params.id, name: `${p.first_name||''} ${p.last_name||''}`.trim() }, req.ip);
    const files = await db.query('SELECT * FROM k108_profile_files WHERE profile_id = $1 ORDER BY uploaded_at DESC', [req.params.id]);
    const relations = await db.query(
      `SELECT DISTINCT ON (r.related_profile_id) r.*, p.first_name, p.last_name, p.photo_url, p.relation as p_relation
       FROM k108_profile_relations r JOIN k108_profiles p ON p.id = r.related_profile_id
       WHERE r.profile_id = $1
       ORDER BY r.related_profile_id, r.id DESC`,
      [req.params.id]
    );
    const activityLog = await db.query('SELECT * FROM k108_profile_activity_log WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 5', [req.params.id]);
    const classifiedFileCount = await db.query('SELECT COUNT(*)::int AS c FROM k108_classified_files WHERE profile_id = $1', [req.params.id]);
    const hasClassifiedFiles = (classifiedFileCount.rows[0]?.c || 0) > 0;
    // Surveillance queue + results
    const sqRow = await db.query(`SELECT id FROM surveillance_queue WHERE profile_id = $1 AND status = 'pending' LIMIT 1`, [req.params.id]);
    const srRows = await db.query(`SELECT id, name, requested_by, report, searched_at, created_at FROM surveillance_results WHERE profile_id = $1 ORDER BY created_at DESC`, [req.params.id]);
    return res.json({ profile: p, files: files.rows, relations: relations.rows, activityLog: activityLog.rows, hasClassified: hasClassified || hasClassifiedFiles, surveillancePending: sqRow.rows.length > 0, surveillanceResults: srRows.rows });
  }
  // JSON fallback
  const profiles = getK108Profiles();
  const profile = profiles.find(p => String(p.id) === String(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  if (!req.query.skipLog) logProfileActivity(req.params.id, username, 'viewed');
  const hasClassified = (profile.classified_data || []).length > 0;
  const profileCopy = { ...profile };
  delete profileCopy.classified_data;
  const pFiles = profile.files || [];
  const pRelations = (profile.relations || []).map(r => {
    const rp = profiles.find(p => String(p.id) === String(r.related_profile_id));
    return { ...r, first_name: rp?.first_name||'', last_name: rp?.last_name||'', photo_url: rp?.photo_url||null, p_relation: rp?.relation||'' };
  });
  res.json({ profile: profileCopy, files: pFiles, relations: pRelations, hasClassified, activityLog: getProfileActivity(req.params.id), surveillancePending: false, surveillanceResults: [] });
});

app.put('/api/k108/profiles/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address, employer_info, classified_data, classified_mode } = req.body;

  if (db.pool) {
    try {
      const aliasVal = Array.isArray(aliases) ? aliases : (aliases ? [aliases] : []);
      const normalizePhones = (arr) => (arr || []).map(p => typeof p === 'string' ? { number: p, label: '' } : { number: p.number || '', label: p.label || '' });
      const normalizeEmails = (arr) => (arr || []).map(e => typeof e === 'string' ? { address: e, label: '' } : { address: e.address || '', label: e.label || '' });

      // Detect phones column type; migrate TEXT[]→JSONB if possible, else fall back
      const colInfo = await db.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='k108_profiles' AND column_name='phones'`);
      let isJsonb = colInfo.rows[0]?.udt_name === 'jsonb';
      if (!isJsonb) {
        try {
          await db.query(`ALTER TABLE k108_profiles ALTER COLUMN phones TYPE JSONB USING array_to_json(phones)::jsonb`);
          await db.query(`ALTER TABLE k108_profiles ALTER COLUMN phones SET DEFAULT '[]'::jsonb`);
          await db.query(`ALTER TABLE k108_profiles ALTER COLUMN emails TYPE JSONB USING array_to_json(emails)::jsonb`);
          await db.query(`ALTER TABLE k108_profiles ALTER COLUMN emails SET DEFAULT '[]'::jsonb`);
          isJsonb = true;
          console.log('[K108] Auto-migrated phones/emails TEXT[] → JSONB');
        } catch(migErr) {
          console.warn('[K108] Phone/email migration failed, saving without labels:', migErr.message);
        }
      }

      let param7, param8, phoneSql, emailSql;
      if (isJsonb) {
        param7 = JSON.stringify(normalizePhones(phones));
        param8 = JSON.stringify(normalizeEmails(emails));
        phoneSql = '$7::jsonb';
        emailSql = '$8::jsonb';
      } else {
        param7 = (phones || []).map(p => typeof p === 'string' ? p : (p.number || '')).filter(Boolean);
        param8 = (emails || []).map(e => typeof e === 'string' ? e : (e.address || '')).filter(Boolean);
        phoneSql = '$7';
        emailSql = '$8';
      }

      // classified_mode: 'replace' = full edit (user revealed classified), 'append' = add-only
      let classifiedSql = '';
      const extraParams = [JSON.stringify(employer_info || {})];
      const newClassified = (classified_data || []).filter(c => c.label || c.value);
      if (classified_mode === 'replace') {
        // Full replace — user has revealed access and is editing all classified data
        extraParams.push(JSON.stringify(newClassified));
        classifiedSql = `, classified_data = $${13 + extraParams.length}::jsonb`;
      } else if (newClassified.length) {
        // Append only — user hasn't revealed, just adding new entries
        extraParams.push(JSON.stringify(newClassified));
        classifiedSql = `, classified_data = COALESCE(classified_data, '[]'::jsonb) || $${13 + extraParams.length}::jsonb`;
      }

      await db.query(
        `UPDATE k108_profiles SET first_name=$1, middle_name=$2, last_name=$3, aliases=$4, relation=$5, notes=$6,
         phones=${phoneSql}, emails=${emailSql}, social_links=$9, age=$10, birthday=$11, address=$12,
         employer_info=$${13 + 1}::jsonb${classifiedSql}, updated_at=NOW() WHERE id=$13`,
        [first_name, middle_name || null, last_name, aliasVal, relation || '', notes || '',
         param7, param8, JSON.stringify(social_links || []), age || null, birthday || null, JSON.stringify(address || {}), req.params.id,
         ...extraParams]
      );
      // Log edit to profile activity log
      await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [req.params.id, username, 'edited']);
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
  const newClassified = (classified_data || []).filter(c => c.label || c.value);
  const existingClassified = profiles[idx].classified_data || [];
  const finalClassified = classified_mode === 'replace' ? newClassified : [...existingClassified, ...newClassified];
  Object.assign(profiles[idx], { first_name, last_name, aliases: aliases||[], relation: relation||'', notes: notes||'', phones: phones||[], emails: emails||[], social_links: social_links||[], age: age||'', birthday: birthday||null, address: address||{}, employer_info: employer_info||{}, classified_data: finalClassified, updated_at: new Date().toISOString() });
  saveK108Profiles(profiles);
  logProfileActivity(req.params.id, username, 'edited');
  await k108Log(username, 'profile_change', { profileId: req.params.id, name: `${first_name} ${last_name}`.trim() }, req.ip);
  res.json({ ok: true });
});

app.delete('/api/k108/profiles/:id', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  // Remove deleted profile from all labels
  const labels = getK108Labels();
  let labelsChanged = false;
  labels.forEach(l => {
    const before = l.profileIds.length;
    l.profileIds = l.profileIds.filter(id => String(id) !== String(req.params.id));
    if (l.profileIds.length !== before) labelsChanged = true;
  });
  if (labelsChanged) saveK108Labels(labels);

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
  const { relatedProfileId, label, bidirectional, transitive } = req.body;
  if (!relatedProfileId) return res.status(400).json({ error: 'Related profile ID required' });
  const bidir = bidirectional !== false; // default true

  if (db.pool) {
    // Ensure unique constraint exists (idempotent)
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_k108_rel_unique ON k108_profile_relations (profile_id, related_profile_id)').catch(() => {});
    // Clean up any existing duplicates first
    await db.query(`DELETE FROM k108_profile_relations WHERE id NOT IN (SELECT MIN(id) FROM k108_profile_relations GROUP BY profile_id, related_profile_id)`).catch(() => {});
    const r = await db.query(
      'INSERT INTO k108_profile_relations (profile_id, related_profile_id, label) VALUES ($1,$2,$3) ON CONFLICT (profile_id, related_profile_id) DO UPDATE SET label = CASE WHEN EXCLUDED.label != \'\' THEN EXCLUDED.label ELSE k108_profile_relations.label END RETURNING *',
      [req.params.id, relatedProfileId, label || '']
    );
    if (bidir) {
      await db.query(
        'INSERT INTO k108_profile_relations (profile_id, related_profile_id, label) VALUES ($1,$2,$3) ON CONFLICT (profile_id, related_profile_id) DO NOTHING',
        [relatedProfileId, req.params.id, label || '']
      );
    }
    // Transitive linking: only when triggered from last-name suggestion box
    if (transitive) {
    const targetProfile = await db.query('SELECT last_name FROM k108_profiles WHERE id = $1', [relatedProfileId]);
    if (targetProfile.rows.length && targetProfile.rows[0].last_name) {
      const targetLastName = targetProfile.rows[0].last_name.toLowerCase();
      const existingRels = await db.query(
        `SELECT r.related_profile_id, p.last_name FROM k108_profile_relations r
         JOIN k108_profiles p ON p.id = r.related_profile_id
         WHERE r.profile_id = $1 AND r.related_profile_id != $2`,
        [relatedProfileId, req.params.id]
      );
      for (const er of existingRels.rows) {
        if ((er.last_name || '').toLowerCase() === targetLastName) {
          await db.query(
            'INSERT INTO k108_profile_relations (profile_id, related_profile_id, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [req.params.id, er.related_profile_id, 'Relative']
          );
          if (bidir) {
            await db.query(
              'INSERT INTO k108_profile_relations (profile_id, related_profile_id, label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [er.related_profile_id, req.params.id, 'Relative']
            );
          }
        }
      }
    }
    } // end transitive
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
  // Transitive linking for JSON fallback — only when triggered from last-name suggestion box
  if (transitive && p2.last_name) {
    const targetLN = p2.last_name.toLowerCase();
    (p2.relations || []).forEach(er => {
      if (String(er.related_profile_id) === String(req.params.id)) return;
      const linked = profiles.find(pp => String(pp.id) === String(er.related_profile_id));
      if (linked && (linked.last_name || '').toLowerCase() === targetLN) {
        if (!linked.relations) linked.relations = [];
        const already1 = p1.relations.some(rr => String(rr.related_profile_id) === String(linked.id));
        if (!already1) {
          p1.relations.push({ id: Date.now() + 2 + Math.random(), related_profile_id: linked.id, label: 'Relative' });
          linked.relations.push({ id: Date.now() + 3 + Math.random(), related_profile_id: p1.id, label: 'Relative' });
        }
      }
    });
  }
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

// ── K-108 Classified Files Upload ────────────────────────────────────────────
app.post('/api/k108/profiles/:id/classified-files', upload.array('files', 10), async (req, res) => {
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const inserted = [];
  for (const file of (req.files || [])) {
    const r = await db.query(
      'INSERT INTO k108_classified_files (profile_id, filename, original_name, mime_type, size) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.id, file.filename, file.originalname, file.mimetype, file.size]
    );
    inserted.push(r.rows[0]);
  }
  res.json({ files: inserted });
});

app.delete('/api/k108/profiles/:id/classified-files/:fid', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  await db.query('DELETE FROM k108_classified_files WHERE id = $1 AND profile_id = $2', [req.params.fid, req.params.id]);
  res.json({ ok: true });
});

// ── K-108 Reveal Classified (passcode verification) ─────────────────────────
app.post('/api/k108/profiles/:id/reveal-classified', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { passcode, reason } = req.body;
  if (!passcode) return res.status(400).json({ error: 'Passcode required' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A valid reason is required' });

  // Verify against the user's K-108 passcode
  let match = false;
  if (db.pool) {
    const user = await getK108User(username);
    if (user) match = await bcrypt.compare(passcode, user.passcode_hash);
  } else {
    match = (passcode === getK108LocalPassword());
  }
  if (!match) return res.status(403).json({ error: 'Invalid passcode' });

  // Log classified access with reason
  const reasonText = reason.trim();
  if (db.pool) {
    await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [req.params.id, username, 'classified_accessed: ' + reasonText]);
  } else {
    logProfileActivity(req.params.id, username, 'classified_accessed: ' + reasonText);
  }
  await k108Log(username, 'classified_accessed', { profileId: req.params.id, reason: reasonText }, req.ip);

  // Return the classified data
  if (db.pool) {
    const r = await db.query('SELECT classified_data FROM k108_profiles WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Profile not found' });
    const classifiedFiles = await db.query('SELECT * FROM k108_classified_files WHERE profile_id = $1 ORDER BY uploaded_at DESC', [req.params.id]);
    return res.json({ classifiedData: r.rows[0].classified_data || [], classifiedFiles: classifiedFiles.rows });
  }
  const profiles = getK108Profiles();
  const p = profiles.find(p => String(p.id) === String(req.params.id));
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  res.json({ classifiedData: p.classified_data || [], classifiedFiles: [] });
});

// ── K-108 Profile Activity Log ──────────────────────────────────────────────
app.post('/api/k108/profiles/:id/activity-log', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ log: [] });
  const r = await db.query('SELECT * FROM k108_profile_activity_log WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 5', [req.params.id]);
  res.json({ log: r.rows });
});

// ── K-108 Dossier PDF Export ────────────────────────────────────────────────
const pendingExportApprovals = new Map(); // profileId -> { approvedBy: Set, timer, res?, includeClassified }

app.post('/api/k108/profiles/:id/export', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { includeClassified } = req.body;
  const profileId = req.params.id;

  // Fetch full profile data
  let profileData;
  if (db.pool) {
    const r = await db.query('SELECT * FROM k108_profiles WHERE id = $1', [profileId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Profile not found' });
    profileData = r.rows[0];
    const files = await db.query('SELECT * FROM k108_profile_files WHERE profile_id = $1 ORDER BY uploaded_at DESC', [profileId]);
    const relations = await db.query(
      `SELECT DISTINCT ON (r.related_profile_id) r.*, p.first_name, p.last_name FROM k108_profile_relations r JOIN k108_profiles p ON p.id = r.related_profile_id WHERE r.profile_id = $1 ORDER BY r.related_profile_id, r.id DESC`, [profileId]);
    const activityLog = await db.query('SELECT * FROM k108_profile_activity_log WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 5', [profileId]);
    profileData._files = files.rows;
    profileData._relations = relations.rows;
    profileData._activityLog = activityLog.rows;
    if (includeClassified) {
      const cf = await db.query('SELECT * FROM k108_classified_files WHERE profile_id = $1', [profileId]);
      profileData._classifiedFiles = cf.rows;
    }
  } else {
    const profiles = getK108Profiles();
    profileData = profiles.find(p => String(p.id) === String(profileId));
    if (!profileData) return res.status(404).json({ error: 'Profile not found' });
    profileData._files = profileData.files || [];
    profileData._relations = profileData.relations || [];
    profileData._activityLog = [];
  }

  // Log export
  if (db.pool) {
    await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [profileId, username, 'export_generated']);
  } else {
    logProfileActivity(profileId, username, 'export_generated');
  }
  await k108Log(username, 'profile_export', { profileId, includeClassified: !!includeClassified }, req.ip);

  // Generate PDF via Puppeteer
  try {
    const html = generateDossierHTML(profileData, username, !!includeClassified);
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBytes = await page.pdf({ format: 'A4', margin: { top: '40px', bottom: '40px', left: '40px', right: '40px' }, printBackground: true });
    await browser.close();

    const name = [profileData.first_name, profileData.last_name].filter(Boolean).join('_') || 'profile';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="K108_Dossier_${name}_${Date.now()}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[K108] PDF export error:', e.message);
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

function generateDossierHTML(p, generatedBy, includeClassified) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const fmtTS = d => d ? new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const now = new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fullName = esc([p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '));
  const initials = esc(((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase());
  const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  const addr = typeof p.address === 'string' ? JSON.parse(p.address || '{}') : (p.address || {});
  const employer = typeof p.employer_info === 'string' ? JSON.parse(p.employer_info || '{}') : (p.employer_info || {});
  const links = typeof p.social_links === 'string' ? JSON.parse(p.social_links || '[]') : (p.social_links || []);
  const phones = typeof p.phones === 'string' ? JSON.parse(p.phones || '[]') : (p.phones || []);
  const emails = typeof p.emails === 'string' ? JSON.parse(p.emails || '[]') : (p.emails || []);
  const vehicle = typeof p.vehicle === 'string' ? JSON.parse(p.vehicle || '{}') : (p.vehicle || {});
  const classified = includeClassified ? (typeof p.classified_data === 'string' ? JSON.parse(p.classified_data || '[]') : (p.classified_data || [])) : [];
  const classifiedFiles = includeClassified ? (p._classifiedFiles || []) : [];

  const classLevel = includeClassified ? 'CLASSIFIED' : 'UNCLASSIFIED';
  const classBadgeColor = includeClassified ? '#dc2626' : '#22c55e';

  // Build section helper
  function row(label, value) { return value ? '<tr><td class="lbl">' + esc(label) + '</td><td class="val">' + esc(value) + '</td></tr>' : ''; }
  function monoRow(label, value) { return value ? '<tr><td class="lbl">' + esc(label) + '</td><td class="val mono">' + esc(value) + '</td></tr>' : ''; }

  let sections = '';

  // ── Personal Info
  sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>Personal Information</span></div>';
  sections += '<table class="tbl">';
  sections += row('Full Name', [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '));
  if ((p.aliases || []).length) sections += row('Known Aliases', (p.aliases || []).join(', '));
  sections += row('Age', p.age);
  sections += row('Date of Birth', p.birthday ? fmtDate(p.birthday) : '');
  sections += row('Classification', p.relation);
  sections += '</table></div>';

  // ── Contact
  if (phones.length || emails.length) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg><span>Contact Information</span></div>';
    sections += '<table class="tbl">';
    phones.forEach(ph => { const num = typeof ph === 'string' ? ph : (ph.number || ''); const lbl = typeof ph === 'object' ? (ph.label || '') : ''; sections += monoRow('Phone' + (lbl ? ' (' + lbl + ')' : ''), num); });
    emails.forEach(e => { const a = typeof e === 'string' ? e : (e.address || ''); const lbl = typeof e === 'object' ? (e.label || '') : ''; sections += row('Email' + (lbl ? ' (' + lbl + ')' : ''), a); });
    sections += '</table></div>';
  }

  // ── Address
  if (addr.street || addr.city) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span>Address</span></div>';
    sections += '<table class="tbl">';
    sections += row('Home Address', [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(', '));
    sections += '</table></div>';
  }

  // ── Employer
  if (employer.name || employer.address || employer.industry) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg><span>Employment</span></div>';
    sections += '<table class="tbl">';
    sections += row('Employer', employer.name);
    sections += row('Address', employer.address);
    sections += row('Industry', employer.industry);
    sections += '</table></div>';
  }

  // ── Vehicle
  if (vehicle.make || vehicle.vin) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M5 17h14M5 17a2 2 0 01-2-2V9a2 2 0 012-2h1l2-3h8l2 3h1a2 2 0 012 2v6a2 2 0 01-2 2"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg><span>Vehicle</span></div>';
    sections += '<table class="tbl">';
    const vTitle = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
    sections += row('Vehicle', vTitle);
    sections += row('Color', vehicle.color);
    sections += row('Plate', vehicle.plate ? vehicle.plate + (vehicle.state ? ' (' + vehicle.state + ')' : '') : '');
    sections += monoRow('VIN', vehicle.vin);
    sections += '</table></div>';
  }

  // ── Social
  if (links.length) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg><span>Social Media</span></div>';
    sections += '<table class="tbl">';
    links.forEach(l => { sections += row(l.handle || 'Link', l.url); });
    sections += '</table></div>';
  }

  // ── Associates
  if ((p._relations || []).length) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg><span>Known Associates</span></div>';
    sections += '<table class="tbl">';
    p._relations.forEach(r => { sections += row(r.label || 'Associate', (r.first_name || '') + ' ' + (r.last_name || '')); });
    sections += '</table></div>';
  }

  // ── Notes
  if (p.notes) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><span>Analyst Notes</span></div>';
    sections += '<div class="notes">' + esc(p.notes) + '</div></div>';
  }

  // ── Activity Log
  if ((p._activityLog || []).length) {
    sections += '<div class="sec"><div class="sec-head"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>Recent Activity</span></div>';
    sections += '<table class="tbl">';
    p._activityLog.forEach(e => {
      const actionBase = e.action.includes(':') ? e.action.split(':')[0].trim() : e.action;
      const label = actionBase.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
      sections += '<tr><td class="lbl mono" style="font-size:9px">' + fmtTS(e.created_at) + '</td><td class="val"><span style="font-weight:600;color:#334155">' + esc(capFirst(e.username)) + '</span> &mdash; ' + esc(label) + '</td></tr>';
    });
    sections += '</table></div>';
  }

  // ── Classified
  if (includeClassified && (classified.length || classifiedFiles.length)) {
    sections += '<div class="sec classified-sec"><div class="sec-head" style="border-color:rgba(220,38,38,0.3)"><svg class="sec-icon" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span style="color:#dc2626">Classified Information</span></div>';
    sections += '<table class="tbl">';
    classified.forEach(c => { sections += '<tr><td class="lbl">' + esc(c.label) + '</td><td class="val">' + esc(c.value) + '</td></tr>'; });
    if (classifiedFiles.length) {
      classifiedFiles.forEach(f => { sections += '<tr><td class="lbl">File</td><td class="val mono">' + esc(f.filename || f.original_name || 'Attached') + '</td></tr>'; });
    }
    sections += '</table></div>';
  }

  const footer = includeClassified
    ? 'CLASSIFIED // AUTHORIZED EYES ONLY // DO NOT DISTRIBUTE'
    : 'K-108 Intelligence Division // For Authorized Use Only';

  return `<!DOCTYPE html><html><head><style>
    @page { margin: 0; size: A4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #1e293b; font-size: 11px; line-height: 1.55; }
    .mono { font-family: 'Courier New', Courier, monospace; letter-spacing: 0.02em; }

    /* Watermark */
    .watermark { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; display: flex; align-items: center; justify-content: center; }
    .watermark span { transform: rotate(-35deg); font-size: 72px; font-weight: 800; letter-spacing: 16px; font-family: 'Courier New', monospace; color: rgba(180,30,30,0.045); text-transform: uppercase; }

    /* Header bar */
    .hdr { background: #0c1222; padding: 24px 40px; display: flex; align-items: center; justify-content: space-between; }
    .hdr-left { display: flex; align-items: center; gap: 16px; }
    .hdr-logo { width: 38px; height: 38px; border-radius: 8px; border: 1.5px solid rgba(76,201,240,0.35); display: flex; align-items: center; justify-content: center; font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700; color: #4cc9f0; letter-spacing: 1px; background: rgba(76,201,240,0.08); }
    .hdr-text h1 { font-size: 13px; font-weight: 700; letter-spacing: 4px; color: #e2e8f0; text-transform: uppercase; font-family: 'Courier New', monospace; }
    .hdr-text .sub { font-size: 8.5px; color: #64748b; margin-top: 3px; letter-spacing: 0.5px; font-family: 'Courier New', monospace; }
    .class-badge { font-size: 8px; font-weight: 700; letter-spacing: 2px; padding: 4px 14px; border-radius: 3px; font-family: 'Courier New', monospace; }

    /* Body content */
    .content { padding: 28px 40px 32px; position: relative; }

    /* Subject block */
    .subject { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding: 16px 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; border-left: 3px solid #0c1222; position: relative; z-index: 1; }
    .subject-avatar { width: 48px; height: 48px; border-radius: 8px; background: #0c1222; display: flex; align-items: center; justify-content: center; font-family: 'Courier New', monospace; font-weight: 700; font-size: 15px; color: #4cc9f0; letter-spacing: 1px; flex-shrink: 0; }
    .subject-info h2 { font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: 0.3px; }
    .subject-info .tag { display: inline-block; font-size: 8px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; padding: 2px 8px; border-radius: 3px; background: #0c1222; color: #4cc9f0; margin-top: 4px; }
    .subject-meta { margin-left: auto; text-align: right; font-size: 9px; color: #94a3b8; font-family: 'Courier New', monospace; line-height: 1.8; }

    /* Sections */
    .sec { margin-bottom: 18px; position: relative; z-index: 1; }
    .sec-head { display: flex; align-items: center; gap: 7px; font-size: 9.5px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; color: #64748b; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
    .sec-icon { width: 13px; height: 13px; flex-shrink: 0; }
    .classified-sec { border: 1px solid #fca5a5; border-radius: 6px; padding: 14px 16px; background: #fef2f2; }
    .classified-sec .sec-head { border-color: #fecaca; }

    /* Tables */
    .tbl { width: 100%; border-collapse: collapse; }
    .tbl td { padding: 4px 0; font-size: 11px; vertical-align: top; }
    .tbl tr { border-bottom: 1px solid #f1f5f9; }
    .tbl tr:last-child { border-bottom: none; }
    .tbl .lbl { font-weight: 600; width: 130px; color: #94a3b8; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; padding-right: 12px; }
    .tbl .val { color: #1e293b; }

    /* Notes */
    .notes { font-size: 11px; line-height: 1.7; color: #475569; white-space: pre-wrap; padding: 10px 14px; background: #f8fafc; border-radius: 4px; border-left: 2px solid #cbd5e1; }

    /* Footer */
    .ftr { padding: 14px 40px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 7.5px; color: #94a3b8; font-family: 'Courier New', monospace; letter-spacing: 1.2px; text-transform: uppercase; }
  </style></head><body>
    ${includeClassified ? '<div class="watermark"><span>Classified</span></div>' : ''}
    <div class="hdr">
      <div class="hdr-left">
        <div class="hdr-logo">108</div>
        <div class="hdr-text">
          <h1>Intelligence Dossier</h1>
          <div class="sub">Profile #${esc(String(p.id))} &nbsp;&bull;&nbsp; ${esc(now)}</div>
        </div>
      </div>
      <div class="class-badge" style="background:${classBadgeColor}15;color:${classBadgeColor};border:1px solid ${classBadgeColor}40">${classLevel}</div>
    </div>
    <div class="content">
    <div class="subject">
      ${p.photo_url ? '<img src="' + esc(p.photo_url) + '" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0">' : '<div class="subject-avatar">' + initials + '</div>'}
      <div class="subject-info">
        <h2>${fullName || 'UNKNOWN SUBJECT'}</h2>
        ${p.relation ? '<div class="tag">' + esc(p.relation) + '</div>' : ''}
      </div>
      <div class="subject-meta">
        Prepared by: ${esc(capFirst(generatedBy))}<br>
        ${p.created_at ? 'Indexed: ' + fmtDate(p.created_at) : ''}
      </div>
    </div>
    ${sections}
    </div>
    <div class="ftr">
      <span>${esc(footer)}</span>
      <span>K-108 Intelligence Division</span>
    </div>
  </body></html>`;
}

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
      const validModules = ['dashboard', 'home', 'lookup', 'people', 'sms', 'vehicle', 'profiles', 'cases', 'vault', 'activity', 'briefing', 'log'];
      if (!target || !validModules.includes(target)) return res.json(lines(`Usage: goto <${validModules.join('|')}>`, 'warn'));
      const hashMap = { dashboard: '#/', home: '#/', lookup: '#/lookup', people: '#/lookup', sms: '#/sms', vehicle: '#/vehicle', profiles: '#/profiles', cases: '#/cases', vault: '#/vault', activity: '#/log', log: '#/log', briefing: '#/briefing' };
      return res.json({ lines: [{ text: `Navigating to ${target}`, cls: 'success' }], navigate: hashMap[target] || '#/' });
    }


    // ── Labels ──
    if (cmd === 'label') {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'list') {
        if (!db.pool) return res.json(lines('Database required for labels', 'error'));
        const r = await db.query('SELECT id, name, color, icon FROM k108_labels ORDER BY name');
        if (!r.rows.length) return res.json(lines('No labels found', 'dim'));
        return res.json({ lines: [{ text: `${r.rows.length} labels`, cls: 'success' }], table: { headers: ['ID', 'Name', 'Color', 'Icon'], rows: r.rows.map(l => [String(l.id), l.name, l.color || '—', l.icon || '—']) } });
      }
      if (sub === 'create') {
        const name = parts.slice(2).join(' ');
        if (!name) return res.json(lines('Usage: label create <name>', 'warn'));
        if (!db.pool) return res.json(lines('Database required', 'error'));
        await db.query('INSERT INTO k108_labels (name, color, icon) VALUES ($1, $2, $3)', [name, '#3b82f6', 'tag']);
        await k108Log(username, 'command_bar', { command: raw }, req.ip);
        return res.json(lines(`Label created: "${name}"`, 'success'));
      }
      return res.json(lines('Usage: label list | label create <name>', 'warn'));
    }

    // ── Vault stats ──
    if (cmd === 'vault' && parts[1]?.toLowerCase() === 'stats') {
      if (!db.pool) return res.json(lines('Database required for vault stats', 'error'));
      const items = await db.query('SELECT COUNT(*) as count FROM k108_vault_items');
      const folders = await db.query('SELECT COUNT(*) as count FROM k108_vault_folders');
      const size = await db.query('SELECT COALESCE(SUM(file_size), 0) as total FROM k108_vault_items');
      const sizeMB = (Number(size.rows[0].total) / (1024 * 1024)).toFixed(2);
      return res.json(multi(
        ['── Document Vault ──', 'header'],
        [`  Files: ${items.rows[0].count}`, 'data'],
        [`  Folders: ${folders.rows[0].count}`, 'data'],
        [`  Total size: ${sizeMB} MB`, 'data'],
      ));
    }

    // ── Whoami ──
    if (cmd === 'whoami') {
      return res.json(lines(`Logged in as: ${username}`, 'success'));
    }

    if (cmd === 'k108' && parts[1]?.toLowerCase() === 'reset-passcode') {
      const target = parts[2]?.toLowerCase();
      if (!target || !['kaliph', 'kathrine'].includes(target)) return res.json(lines('Usage: k108 reset-passcode <kaliph|kathrine>', 'warn'));
      await deleteK108Passcode(target);
      await k108Log(username, 'command_bar', { command: raw }, req.ip);
      return res.json(lines(`K-108 passcode reset for ${target}`, 'success'));
    }

    // ── Classified / Export commands ──
    if (raw.toLowerCase() === 'reveal classified') {
      return res.json({ action: 'reveal_classified' });
    }

    if (raw.toLowerCase() === 'approve export') {
      return res.json({ action: 'approve_export', username });
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


// ── K-108 Case Management ────────────────────────────────────────────────────
const K108_EVIDENCE_DIR = path.join(UPLOADS_DIR, 'k108-evidence');
fs.ensureDirSync(K108_EVIDENCE_DIR);
const k108EvidenceStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, K108_EVIDENCE_DIR),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const k108EvidenceUpload = multer({ storage: k108EvidenceStorage, limits: { fileSize: 100 * 1024 * 1024 } });

async function k108GenerateCaseId() {
  const d = new Date();
  const ymd = d.getFullYear().toString() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const r = await db.query(`SELECT COUNT(*)::int AS c FROM k108_cases WHERE case_id LIKE $1`, ['K108-' + ymd + '-%']);
  const seq = String((r.rows[0].c || 0) + 1).padStart(3, '0');
  return 'K108-' + ymd + '-' + seq;
}

function k108CaseRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    caseId: r.case_id,
    name: r.name,
    targetName: r.target_name || '',
    status: (r.status || 'open').toLowerCase(),
    classification: (r.classification || 'unclassified').toLowerCase(),
    priority: (r.priority || 'medium').toLowerCase(),
    summary: r.summary || '',
    createdBy: r.created_by || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function k108TouchCase(id) {
  await db.query('UPDATE k108_cases SET updated_at = NOW() WHERE id = $1', [id]);
}

function k108EmitCaseUpdate(caseId) {
  try { io.emit('k108:case_updated', { caseId, at: Date.now() }); } catch(e) {}
}

// List cases
app.post('/api/k108/cases/list', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.json({ cases: [] });
    const { status } = req.body || {};
    let sql = 'SELECT * FROM k108_cases';
    const params = [];
    if (status && (status === 'open' || status === 'closed')) {
      params.push(status);
      sql += ' WHERE LOWER(status) = $1';
    }
    sql += ' ORDER BY updated_at DESC';
    const r = await db.query(sql, params);
    res.json({ cases: r.rows.map(k108CaseRow) });
  } catch (err) {
    console.error('[K108] Case list error:', err);
    res.status(500).json({ error: 'Failed to load cases', cases: [] });
  }
});

// Create case
app.post('/api/k108/cases/create', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.status(503).json({ error: 'Database required' });
    const { name, targetName, priority, classification, summary } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Case name required' });
    const safePriority = ['low','medium','high'].includes((priority||'').toLowerCase()) ? priority.toLowerCase() : 'medium';
    const safeClass = ['unclassified','confidential','classified'].includes((classification||'').toLowerCase()) ? classification.toLowerCase() : 'unclassified';
    const caseId = await k108GenerateCaseId();
    const r = await db.query(
      `INSERT INTO k108_cases (case_id, name, target_name, status, classification, priority, summary, created_by)
       VALUES ($1,$2,$3,'open',$4,$5,$6,$7) RETURNING *`,
      [caseId, String(name).trim(), String(targetName || '').trim(), safeClass, safePriority, String(summary || ''), username]
    );
    const created = r.rows[0];
    await db.query(
      `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'created','Case opened',$2,$3)`,
      [created.id, 'Case "' + created.name + '" created.', username]
    );
    await k108Log(username, 'case_create', { case_id: caseId, name: created.name }, req.ip);
    k108EmitCaseUpdate(created.id);
    res.json({ case: k108CaseRow(created) });
  } catch (err) {
    console.error('[K108] Case create error:', err);
    res.status(500).json({ error: 'Failed to create case: ' + (err.message || 'unknown error') });
  }
});

// Get case detail (overview + counts)
app.post('/api/k108/cases/get', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.status(503).json({ error: 'Database required' });
    const { id } = req.body || {};
    const r = await db.query('SELECT * FROM k108_cases WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Case not found' });
    const counts = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM k108_case_timeline WHERE case_id = $1) AS timeline_count,
         (SELECT COUNT(*)::int FROM k108_case_evidence WHERE case_id = $1 AND filename IS NOT NULL) AS evidence_count,
         (SELECT COUNT(*)::int FROM k108_case_entities WHERE case_id = $1) AS entity_count,
         (SELECT COUNT(*)::int FROM k108_case_notes WHERE case_id = $1) AS notes_count`,
      [id]
    );
    res.json({ case: k108CaseRow(r.rows[0]), counts: counts.rows[0] });
  } catch (err) {
    console.error('[K108] Case get error:', err);
    res.status(500).json({ error: 'Failed to load case' });
  }
});

// Update case summary / target / priority / classification
app.post('/api/k108/cases/update', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.status(503).json({ error: 'Database required' });
    const { id, summary, targetName, priority, classification } = req.body || {};
    const sets = []; const params = [];
    if (summary !== undefined) { params.push(summary); sets.push(`summary = $${params.length}`); }
    if (targetName !== undefined) { params.push(targetName); sets.push(`target_name = $${params.length}`); }
    if (priority !== undefined && ['low','medium','high'].includes(priority)) { params.push(priority); sets.push(`priority = $${params.length}`); }
    if (classification !== undefined && ['unclassified','confidential','classified'].includes(classification)) { params.push(classification); sets.push(`classification = $${params.length}`); }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const r = await db.query(`UPDATE k108_cases SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    k108EmitCaseUpdate(id);
    res.json({ case: k108CaseRow(r.rows[0]) });
  } catch (err) {
    console.error('[K108] Case update error:', err);
    res.status(500).json({ error: 'Failed to update case' });
  }
});

// Toggle status open/closed
app.post('/api/k108/cases/status', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.status(503).json({ error: 'Database required' });
    const { id, status } = req.body || {};
    const target = (status === 'open' || status === 'closed') ? status : null;
    if (!target) return res.status(400).json({ error: 'Invalid status' });
    await db.query('UPDATE k108_cases SET status = $1, updated_at = NOW() WHERE id = $2', [target, id]);
    await db.query(
      `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'status','Status changed',$2,$3)`,
      [id, 'Case marked as ' + target.toUpperCase() + '.', username]
    );
    await k108Log(username, 'case_status', { id, status: target }, req.ip);
    k108EmitCaseUpdate(id);
    res.json({ ok: true, status: target });
  } catch (err) {
    console.error('[K108] Case status error:', err);
    res.status(500).json({ error: 'Failed to update case status' });
  }
});

// Delete case
app.post('/api/k108/cases/delete', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.status(503).json({ error: 'Database required' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Case id required' });
    const check = await db.query('SELECT * FROM k108_cases WHERE id = $1', [id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Case not found' });
    const caseName = check.rows[0].name;
    const caseIdStr = check.rows[0].case_id;
    // CASCADE handles child rows (timeline, evidence, entities, notes)
    await db.query('DELETE FROM k108_cases WHERE id = $1', [id]);
    await k108Log(username, 'case_delete', { case_id: caseIdStr, name: caseName }, req.ip);
    k108EmitCaseUpdate(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[K108] Case delete error:', err);
    res.status(500).json({ error: 'Failed to delete case' });
  }
});

// Check duplicate case name
app.post('/api/k108/cases/check-duplicate', async (req, res) => {
  try {
    const username = k108Auth(req, res);
    if (!username) return;
    if (!db.pool) return res.json({ exists: false });
    const { name } = req.body || {};
    if (!name) return res.json({ exists: false });
    const r = await db.query('SELECT id FROM k108_cases WHERE LOWER(name) = LOWER($1) LIMIT 1', [String(name).trim()]);
    res.json({ exists: r.rows.length > 0 });
  } catch (err) {
    console.error('[K108] Check duplicate error:', err);
    res.json({ exists: false });
  }
});

// Search intel profiles for entity import
app.post('/api/k108/cases/profiles/search', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ profiles: [] });
  const { q } = req.body || {};
  if (!q || String(q).trim().length < 2) return res.json({ profiles: [] });
  const search = '%' + String(q).trim() + '%';
  const r = await db.query(
    `SELECT id, first_name, last_name, middle_name, photo_url, relation
     FROM k108_profiles
     WHERE CONCAT(first_name, ' ', COALESCE(middle_name, ''), ' ', last_name) ILIKE $1
     ORDER BY updated_at DESC LIMIT 10`,
    [search]
  );
  res.json({ profiles: r.rows.map(p => ({
    id: p.id,
    name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
    photoUrl: p.photo_url || '',
    relation: p.relation || ''
  })) });
});

// Remove entity from case
app.post('/api/k108/cases/entities/remove', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, entityId } = req.body || {};
  if (!id || !entityId) return res.status(400).json({ error: 'id and entityId required' });
  const ent = await db.query('SELECT * FROM k108_case_entities WHERE id = $1 AND case_id = $2', [entityId, id]);
  if (!ent.rows.length) return res.status(404).json({ error: 'Entity not found' });
  await db.query('DELETE FROM k108_case_entities WHERE id = $1', [entityId]);
  await db.query(
    `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'entity','Entity removed',$2,$3)`,
    [id, 'Removed "' + ent.rows[0].name + '" from case.', username]
  );
  await k108TouchCase(id);
  k108EmitCaseUpdate(id);
  res.json({ success: true });
});

// ── Timeline ──
app.post('/api/k108/cases/timeline/list', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ entries: [] });
  const { id } = req.body || {};
  const r = await db.query('SELECT * FROM k108_case_timeline WHERE case_id = $1 ORDER BY created_at DESC', [id]);
  res.json({ entries: r.rows.map(e => ({ id: e.id, entryType: e.entry_type || 'note', title: e.title || '', body: e.body || '', createdBy: e.created_by || '', createdAt: e.created_at })) });
});

app.post('/api/k108/cases/timeline/add', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, entryType, title, body } = req.body || {};
  if (!id || !title) return res.status(400).json({ error: 'id and title required' });
  const r = await db.query(
    `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, (entryType || 'note'), String(title), String(body || ''), username]
  );
  await k108TouchCase(id);
  k108EmitCaseUpdate(id);
  res.json({ entry: r.rows[0] });
});

// ── Evidence ──
app.post('/api/k108/cases/evidence/list', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ files: [] });
  const { id } = req.body || {};
  const r = await db.query('SELECT * FROM k108_case_evidence WHERE case_id = $1 AND filename IS NOT NULL ORDER BY uploaded_at DESC', [id]);
  res.json({ files: r.rows.map(f => ({ id: f.id, filename: f.filename, originalName: f.original_name, fileSize: Number(f.file_size || 0), uploadedBy: f.uploaded_by || '', uploadedAt: f.uploaded_at })) });
});

app.post('/api/k108/cases/evidence/upload', mainAuth, k108EvidenceUpload.single('file'), async (req, res) => {
  req.body.token = req.body.token || req.query.token;
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const caseId = parseInt(req.body.caseId, 10);
  if (!caseId) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'caseId required' }); }
  const publicPath = '/uploads/k108-evidence/' + req.file.filename;
  const r = await db.query(
    `INSERT INTO k108_case_evidence (case_id, filename, original_name, file_size, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [caseId, publicPath, req.file.originalname, req.file.size, username]
  );
  await db.query(
    `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'evidence','Evidence uploaded',$2,$3)`,
    [caseId, 'File "' + req.file.originalname + '" (' + req.file.size + ' bytes) added to evidence vault.', username]
  );
  await k108TouchCase(caseId);
  await k108Log(username, 'case_evidence_upload', { case_id: caseId, filename: req.file.originalname }, req.ip);
  k108EmitCaseUpdate(caseId);
  res.json({ file: r.rows[0] });
});

// Attach an evidence reference (used by Document Vault "Add to Case" — no file copy)
app.post('/api/k108/cases/evidence/attach', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, filename, originalName, fileSize } = req.body || {};
  if (!id || !originalName) return res.status(400).json({ error: 'id and originalName required' });
  const r = await db.query(
    `INSERT INTO k108_case_evidence (case_id, filename, original_name, file_size, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, filename || '', originalName, fileSize || 0, username]
  );
  await db.query(
    `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'evidence','Evidence attached',$2,$3)`,
    [id, 'Document "' + originalName + '" linked from Document Vault.', username]
  );
  await k108TouchCase(id);
  k108EmitCaseUpdate(id);
  res.json({ file: r.rows[0] });
});

// ── Entities ──
app.post('/api/k108/cases/entities/list', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ entities: [] });
  const { id } = req.body || {};
  const r = await db.query('SELECT * FROM k108_case_entities WHERE case_id = $1 ORDER BY added_at DESC', [id]);
  res.json({ entities: r.rows.map(e => ({ id: e.id, entityType: e.entity_type, name: e.name, detail: e.detail || '', source: e.source || '', addedBy: e.added_by || '', addedAt: e.added_at, profileId: e.profile_id || null })) });
});

app.post('/api/k108/cases/entities/add', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, entityType, name, detail, source, profileId } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const type = (entityType === 'vehicle') ? 'vehicle' : 'person';
  const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail || {});
  // Check duplicate by profile_id if provided
  if (profileId) {
    const dup = await db.query('SELECT id FROM k108_case_entities WHERE case_id = $1 AND profile_id = $2', [id, profileId]);
    if (dup.rows.length) return res.json({ duplicate: true, error: 'Already linked to this case' });
  }
  const r = await db.query(
    `INSERT INTO k108_case_entities (case_id, entity_type, name, detail, source, added_by, profile_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, type, String(name), detailStr, String(source || ''), username, profileId || null]
  );
  await db.query(
    `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'entity','Entity linked',$2,$3)`,
    [id, (type === 'vehicle' ? 'Vehicle ' : 'Person ') + '"' + name + '" added from ' + (source || 'manual') + '.', username]
  );
  await k108TouchCase(id);
  await k108Log(username, 'case_entity_add', { case_id: id, type, name }, req.ip);
  k108EmitCaseUpdate(id);
  res.json({ entity: r.rows[0] });
});

// ── Notes ──
app.post('/api/k108/cases/notes/list', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.json({ notes: [] });
  const { id } = req.body || {};
  const r = await db.query('SELECT * FROM k108_case_notes WHERE case_id = $1 ORDER BY created_at DESC', [id]);
  res.json({ notes: r.rows.map(n => ({ id: n.id, body: n.body, createdBy: n.created_by || '', createdAt: n.created_at })) });
});

app.post('/api/k108/cases/notes/add', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, body } = req.body || {};
  if (!id || !body || !String(body).trim()) return res.status(400).json({ error: 'id and body required' });
  const r = await db.query(
    `INSERT INTO k108_case_notes (case_id, body, created_by) VALUES ($1,$2,$3) RETURNING *`,
    [id, String(body).trim(), username]
  );
  await db.query(
    `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'note','Analyst note',$2,$3)`,
    [id, String(body).trim().substring(0, 200), username]
  );
  await k108TouchCase(id);
  k108EmitCaseUpdate(id);
  res.json({ note: r.rows[0] });
});

// ── Surveillance Queue (external API — protected by briefing secret) ────────

// GET /api/archivist/queue — returns pending items for Cowork to process
app.get('/api/archivist/queue', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db.pool) return res.json([]);
  const r = await db.query(
    `SELECT sq.id, sq.profile_id, sq.name, sq.requested_by, sq.created_at,
            ip.address, ip.date_of_birth, ip.phone_numbers, ip.emails,
            ip.social_links, ip.occupation, ip.employer_info
     FROM surveillance_queue sq
     LEFT JOIN intel_profiles ip ON ip.id = sq.profile_id
     WHERE sq.status = 'pending'
     ORDER BY sq.created_at ASC`
  );
  res.json(r.rows);
});

// POST /api/archivist/results — Cowork submits a completed surveillance report
app.post('/api/archivist/results', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { id, name, requested_by, report } = req.body;
  if (!id || !report) return res.status(400).json({ error: 'id and report required' });

  // Find the queue item
  const qr = await db.query('SELECT * FROM surveillance_queue WHERE id = $1', [id]);
  if (!qr.rows[0]) return res.status(404).json({ error: 'Queue item not found' });
  const queueItem = qr.rows[0];
  const profileId = queueItem.profile_id;

  // Save result
  await db.query(
    `INSERT INTO surveillance_results (profile_id, queue_id, name, requested_by, report, searched_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
    [profileId, id, name || queueItem.name, requested_by || queueItem.requested_by, report]
  );

  // Delete queue item
  await db.query('DELETE FROM surveillance_queue WHERE id = $1', [id]);

  // Check if profile has an open case linked to it via case_entities
  try {
    const entityRows = await db.query(
      `SELECT ce.case_id FROM k108_case_entities ce
       JOIN k108_cases c ON c.id = ce.case_id
       WHERE ce.entity_type = 'person' AND ce.source = 'intel_profile'
         AND ce.detail::jsonb->>'profileId' = $1
         AND c.status != 'closed'
       LIMIT 1`,
      [String(profileId)]
    );
    if (entityRows.rows[0]) {
      const caseId = entityRows.rows[0].case_id;
      await db.query(
        `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'surveillance',$2,$3,'system')`,
        [caseId, 'Surveillance report: ' + (name || queueItem.name), report]
      );
    }
  } catch (e) {
    console.error('[surveillance] Case timeline insert error:', e.message);
  }

  // Send Brrr push notification
  const who = requested_by || queueItem.requested_by;
  const webhookSecret = who === 'kathrine' ? process.env.BRRR_WEBHOOK_KATHRINE : process.env.BRRR_WEBHOOK_KALIPH;
  if (webhookSecret) {
    fetch(`https://api.brrr.now/v1/${webhookSecret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'K-108 Surveillance', message: 'Surveillance report ready for ' + (name || queueItem.name), sound: 'bubble_ding', 'interruption-level': 'active' }),
    }).catch(err => console.error('[brrr] surveillance notification error:', err.message));
  }

  // Emit Socket.IO event
  io.emit('k108:surveillance_complete', { profileId, name: name || queueItem.name });

  res.json({ success: true });
});

// ── Surveillance Approvals (external API — protected by briefing secret) ────

// POST /api/archivist/submit — auto-approve names for surveillance
app.post('/api/archivist/submit', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const { names } = req.body;
  if (!Array.isArray(names) || !names.length) return res.status(400).json({ error: 'names array required' });

  for (const item of names) {
    await db.query(
      `INSERT INTO surveillance_approvals (queue_id, name, requested_by, approved) VALUES ($1,$2,$3,TRUE)`,
      [item.id, item.name, item.requested_by]
    );
  }
  res.json({ success: true });
});

// GET /api/archivist/decisions — fetch and clear all approval decisions
app.get('/api/archivist/decisions', async (req, res) => {
  const secret = req.headers['x-briefing-secret'];
  if (!process.env.BRIEFING_SECRET || secret !== process.env.BRIEFING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!db.pool) return res.json([]);
  const r = await db.query('SELECT id, queue_id, name, requested_by, approved FROM surveillance_approvals ORDER BY created_at ASC');
  const rows = r.rows;
  if (rows.length) {
    await db.query('DELETE FROM surveillance_approvals');
  }
  res.json(rows);
});

// ── Surveillance Queue (K-108 auth — user-facing) ──────────────────────────

// POST /k108/profiles/:id/surveillance/queue — queue a profile for surveillance
app.post('/k108/profiles/:id/surveillance/queue', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const profileId = parseInt(req.params.id, 10);

  // Check if already queued
  const existing = await db.query(
    `SELECT id FROM surveillance_queue WHERE profile_id = $1 AND status = 'pending'`,
    [profileId]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Already queued' });
  }

  // Get profile name
  const pr = await db.query('SELECT first_name, middle_name, last_name FROM k108_profiles WHERE id = $1', [profileId]);
  if (!pr.rows[0]) return res.status(404).json({ error: 'Profile not found' });
  const p = pr.rows[0];
  const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');

  const ins = await db.query(
    `INSERT INTO surveillance_queue (profile_id, name, requested_by, status) VALUES ($1,$2,$3,'pending') RETURNING id`,
    [profileId, fullName, username]
  );
  const queueId = ins.rows[0].id;

  await k108Log(username, 'surveillance_queue', { profileId, name: fullName }, req.ip);
  res.json({ success: true });

  // Fire-and-forget Routine trigger — results arrive later via POST /api/archivist/results
  fireRoutineFamilyResearch(queueId, profileId, fullName, username).catch(err => {
    console.error('[family-research] Routine trigger error for queueId=' + queueId + ':', err && (err.message || err));
  });
});

// DELETE /k108/profiles/:id/surveillance/queue — cancel pending surveillance
app.delete('/k108/profiles/:id/surveillance/queue', async (req, res) => {
  const token = req.headers['x-k108-token'] || req.query.token;
  if (!token || !k108Tokens.has(token)) {
    return res.status(401).json({ error: 'Session expired', reauth: true });
  }
  const username = k108Tokens.get(token);
  if (!db.pool) return res.status(503).json({ error: 'Database required' });
  const profileId = parseInt(req.params.id, 10);
  await db.query(
    `DELETE FROM surveillance_queue WHERE profile_id = $1 AND status = 'pending'`,
    [profileId]
  );
  await k108Log(username, 'surveillance_cancel', { profileId }, req.ip);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// K-108 FAMILY BACKGROUND RESEARCH — ROUTINE TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════
// Fires an Anthropic Routine that runs the family background research externally.
// Results land back via POST /api/archivist/results (BRIEFING_SECRET auth), the
// same endpoint used by the legacy Cowork runner — no changes to that path.
//
// Required env vars:
//   ROUTINE_SURVEILLANCE_ID    — Routine ID only (e.g. trig_01DU2wEKxxGjRH2GxurhYCHb).
//                                The full fire URL is constructed as:
//                                https://api.anthropic.com/v1/claude_code/routines/<ID>/fire
//   ROUTINE_SURVEILLANCE_TOKEN — Anthropic bearer token (api key or rt_live_xxx)
//
// If either var is missing, or the POST returns non-2xx, the queue row is marked
// status='failed' with an error message and a k108:surveillance_failed socket
// event is emitted so the frontend can surface a visible error state.

const FAMILY_RESEARCH_DEFAULT_SCOPE = {
  primary: 'Gurnee, Illinois',
  counties: ['Lake County, IL', 'Cook County, IL'],
  nearby: ['Waukegan', 'Zion', 'North Chicago', 'Libertyville', 'Mundelein', 'Round Lake', 'Kenosha (WI border)'],
  region: 'Cook/Lake County, Illinois',
};

// Heuristic: given a profile's address field, determine the research scope.
function familyResearchDetermineScope(profileAddress) {
  const defaultScope = {
    focus: FAMILY_RESEARCH_DEFAULT_SCOPE.primary,
    region: FAMILY_RESEARCH_DEFAULT_SCOPE.region,
    deviation: false,
    detail: 'Default K-108 operational area — Gurnee, Waukegan, Zion, North Chicago, Libertyville, Mundelein, Round Lake, Lake County & Cook County Illinois, Kenosha WI border.',
  };
  if (!profileAddress || typeof profileAddress !== 'object') return defaultScope;
  const city = (profileAddress.city || '').trim();
  const state = (profileAddress.state || '').trim().toUpperCase();
  const zip = (profileAddress.zip || profileAddress.zipcode || '').trim();
  if (!city && !state) return defaultScope;

  // Cook/Lake County IL focus list
  const defaultCities = ['gurnee', 'waukegan', 'zion', 'north chicago', 'libertyville', 'mundelein', 'round lake', 'kenosha', 'chicago', 'evanston', 'skokie', 'des plaines', 'arlington heights', 'schaumburg', 'highland park', 'deerfield', 'lake forest', 'vernon hills'];
  const inIllinoisDefault = state === 'IL' && defaultCities.includes(city.toLowerCase());
  const inWisconsinBorder = state === 'WI' && city.toLowerCase() === 'kenosha';

  if (inIllinoisDefault || inWisconsinBorder) {
    return {
      focus: (city + (state ? ', ' + state : '')).trim(),
      region: FAMILY_RESEARCH_DEFAULT_SCOPE.region,
      deviation: false,
      detail: 'Subject address is within the default K-108 operational area (' + FAMILY_RESEARCH_DEFAULT_SCOPE.region + ').',
    };
  }

  // Outside default scope → use subject's actual location
  const focus = [city, state, zip].filter(Boolean).join(', ');
  return {
    focus,
    region: focus,
    deviation: true,
    detail: 'GEOGRAPHIC DEVIATION — subject address "' + focus + '" is outside the default Cook/Lake County Illinois scope. Research has been retargeted.',
  };
}

async function familyResearchMarkFailed(queueId, profileId, errorMsg) {
  try {
    await db.query(
      `UPDATE surveillance_queue SET status='failed', error=$1 WHERE id=$2`,
      [errorMsg, queueId]
    );
  } catch (e) {
    console.error('[family-research] Could not mark queueId=' + queueId + ' failed:', e.message);
  }
  io.emit('k108:surveillance_failed', { profileId, queueId, error: errorMsg });
}

async function fireRoutineFamilyResearch(queueId, profileId, fullName, requestedBy) {
  if (!db.pool) return;

  const routineId    = process.env.ROUTINE_SURVEILLANCE_ID;
  const routineToken = process.env.ROUTINE_SURVEILLANCE_TOKEN;
  if (!routineId || !routineToken) {
    const msg = 'ROUTINE_SURVEILLANCE_ID or ROUTINE_SURVEILLANCE_TOKEN not configured';
    console.error('[family-research] ' + msg + ' — queueId=' + queueId);
    await familyResearchMarkFailed(queueId, profileId, msg);
    return;
  }

  const routineUrl = 'https://api.anthropic.com/v1/claude_code/routines/' + routineId + '/fire';

  // Verify the queue row is still pending (guard against race with cancellation)
  const check = await db.query(`SELECT id, status FROM surveillance_queue WHERE id = $1`, [queueId]);
  if (!check.rows.length || check.rows[0].status !== 'pending') {
    console.log('[family-research] queueId=' + queueId + ' no longer pending — skipping');
    return;
  }

  // Load profile — only need address, aliases, and notes
  const pr = await db.query('SELECT * FROM k108_profiles WHERE id = $1', [profileId]);
  if (!pr.rows.length) {
    const msg = 'Profile ' + profileId + ' not found';
    console.error('[family-research] ' + msg);
    await familyResearchMarkFailed(queueId, profileId, msg);
    return;
  }
  const p = pr.rows[0];

  const payloadObject = {
    requestId: queueId,
    personId: profileId,
    name: fullName,
    requestedBy,
    location: {
      city: (p.address && p.address.city) || null,
      counties: ['Cook', 'Lake'],
      state: 'IL',
    },
    aliases: p.aliases || null,
    notes: p.notes || null,
  };

  // The Routine API accepts a single "text" field; embed the slim payload as a
  // natural-language message with the JSON block inside it.
  const messageText =
    'New family background research request.\n\n' +
    'Parse the JSON block below and execute your instructions.\n\n' +
    'PAYLOAD:\n' +
    JSON.stringify(payloadObject, null, 2);

  console.log('[family-research] Firing Routine for "' + fullName + '" (queueId=' + queueId + ') city=' + (payloadObject.location.city || 'unknown'));

  let statusCode;
  try {
    const resp = await fetch(routineUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + routineToken,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      },
      body: JSON.stringify({ text: messageText }),
    });
    statusCode = resp.status;
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error('HTTP ' + statusCode + (body ? ': ' + body.slice(0, 200) : ''));
    }
    // Successful fire: { "type": "routine_fire", "claude_code_session_id": "...", "claude_code_session_url": "..." }
    let fireResult = {};
    try { fireResult = await resp.json(); } catch (_) {}
    const sessionUrl = fireResult.claude_code_session_url || '(no session URL in response)';
    console.log('[family-research] Routine accepted queueId=' + queueId + ' (HTTP ' + statusCode + ') session=' + sessionUrl);
  } catch (e) {
    const msg = 'Routine POST failed: ' + e.message;
    console.error('[family-research] ' + msg + ' (queueId=' + queueId + ')');
    await familyResearchMarkFailed(queueId, profileId, msg);
  }
}

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


// ═══════════════════════════════════════════════════════════════════════════════
// K-108 ORACLE — AI Intelligence Analyst
// ═══════════════════════════════════════════════════════════════════════════════

const ORACLE_MEMORY_FILE = path.join(DATA_DIR, 'k108-oracle-memory.json');
const ORACLE_SESSIONS_FILE = path.join(DATA_DIR, 'k108-oracle-sessions.json');

// ── Memory persistence ──
async function oracleGetMemory(username) {
  if (db.pool) {
    try {
      const r = await db.query('SELECT summary, updated_at FROM k108_oracle_memory WHERE username = $1', [username]);
      if (!r.rows.length) return { summary: '', updated_at: null };
      return { summary: r.rows[0].summary || '', updated_at: r.rows[0].updated_at };
    } catch (e) {
      console.error('[oracle] memory read error:', e.message);
      return { summary: '', updated_at: null };
    }
  }
  try {
    if (fs.existsSync(ORACLE_MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(ORACLE_MEMORY_FILE, 'utf8'));
      return data[username] || { summary: '', updated_at: null };
    }
  } catch (e) {}
  return { summary: '', updated_at: null };
}

async function oracleSaveMemory(username, summary) {
  if (db.pool) {
    try {
      await db.query(
        `INSERT INTO k108_oracle_memory (username, summary, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (username) DO UPDATE SET summary = $2, updated_at = NOW()`,
        [username, summary || '']
      );
    } catch (e) { console.error('[oracle] memory save error:', e.message); }
    return;
  }
  try {
    let data = {};
    if (fs.existsSync(ORACLE_MEMORY_FILE)) data = JSON.parse(fs.readFileSync(ORACLE_MEMORY_FILE, 'utf8'));
    data[username] = { summary: summary || '', updated_at: new Date().toISOString() };
    fs.writeFileSync(ORACLE_MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('[oracle] memory save error:', e.message); }
}

async function oracleClearMemory(username) {
  if (db.pool) {
    try {
      await db.query('DELETE FROM k108_oracle_memory WHERE username = $1', [username]);
    } catch (e) { console.error('[oracle] memory clear error:', e.message); }
    return;
  }
  try {
    if (!fs.existsSync(ORACLE_MEMORY_FILE)) return;
    const data = JSON.parse(fs.readFileSync(ORACLE_MEMORY_FILE, 'utf8'));
    delete data[username];
    fs.writeFileSync(ORACLE_MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('[oracle] memory clear error:', e.message); }
}

// Summarize a full conversation history and append to the user's memory.
// Called once per session, when the operator closes Oracle (not after every turn).
async function oracleSummarizeAndSave(username, history) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no api key' };
  if (!Array.isArray(history) || history.length === 0) return { ok: false, reason: 'empty history' };
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const convo = history
      .filter(m => m && m.role && m.content)
      .map(m => (m.role || '') + ': ' + (typeof m.content === 'string' ? m.content : '[tool results]'))
      .join('\n')
      .substring(0, 8000);
    if (!convo.trim()) return { ok: false, reason: 'empty convo' };
    const summaryPrompt = `Summarize this ORACLE session in 4-6 bullet points covering: who was discussed, what was learned, what actions were taken, and open threads. Plain text, no preamble.\n\n${convo}`;
    const summaryResp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: summaryPrompt }],
    });
    const newSummary = (summaryResp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!newSummary) return { ok: false, reason: 'empty summary' };
    const prev = await oracleGetMemory(username);
    const combined = (prev.summary
      ? (prev.summary + '\n\n— Session ' + new Date().toISOString().slice(0, 10) + ' —\n' + newSummary)
      : newSummary
    ).substring(0, 6000);
    await oracleSaveMemory(username, combined);
    return { ok: true };
  } catch (e) {
    console.error('[oracle] summarize error:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Track session counts for dashboard card stats
function oracleRecordSession(username) {
  try {
    let data = {};
    if (fs.existsSync(ORACLE_SESSIONS_FILE)) data = JSON.parse(fs.readFileSync(ORACLE_SESSIONS_FILE, 'utf8'));
    const now = new Date().toISOString();
    if (!data[username]) data[username] = { sessions: [], lastActive: now };
    data[username].sessions.push(now);
    // Keep only last 30 days
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    data[username].sessions = data[username].sessions.filter(t => new Date(t).getTime() > cutoff);
    data[username].lastActive = now;
    fs.writeFileSync(ORACLE_SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function oracleGetSessionStats(username) {
  try {
    if (!fs.existsSync(ORACLE_SESSIONS_FILE)) return { weekCount: 0, lastActive: null };
    const data = JSON.parse(fs.readFileSync(ORACLE_SESSIONS_FILE, 'utf8'));
    const u = data[username];
    if (!u) return { weekCount: 0, lastActive: null };
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekCount = (u.sessions || []).filter(t => new Date(t).getTime() > weekAgo).length;
    return { weekCount, lastActive: u.lastActive || null };
  } catch (e) { return { weekCount: 0, lastActive: null }; }
}

// ── Oracle tool handlers ──
async function oracle_search_profiles(args, username) {
  const query = (args.query || '').trim();
  if (!query) return { profiles: [] };
  if (db.pool) {
    const prefix = query + '%';
    const like = '%' + query + '%';
    const r = await db.query(
      `SELECT id, first_name, middle_name, last_name, photo_url, relation, notes, updated_at
       FROM k108_profiles
       WHERE first_name ILIKE $1 OR last_name ILIKE $1
          OR (first_name || ' ' || last_name) ILIKE $2
          OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE $1)
       ORDER BY updated_at DESC LIMIT 10`,
      [prefix, like]
    );
    return {
      profiles: r.rows.map(p => ({
        id: p.id,
        name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim(),
        relation: p.relation || '',
        notes: (p.notes || '').substring(0, 200),
        photoUrl: p.photo_url || null,
        updatedAt: p.updated_at,
      })),
    };
  }
  return { profiles: [] };
}

async function oracle_get_profile(args, username) {
  const id = parseInt(args.id, 10);
  if (!id) return { error: 'Missing id' };
  if (!db.pool) return { error: 'Database required' };
  const r = await db.query('SELECT * FROM k108_profiles WHERE id = $1', [id]);
  if (!r.rows.length) return { error: 'Profile not found' };
  const p = r.rows[0];
  delete p.classified_data;
  const files = await db.query('SELECT id, original_name, uploaded_at FROM k108_profile_files WHERE profile_id = $1 ORDER BY uploaded_at DESC', [id]);
  const relations = await db.query(
    `SELECT DISTINCT ON (r.related_profile_id) r.label, p.id, p.first_name, p.last_name
     FROM k108_profile_relations r JOIN k108_profiles p ON p.id = r.related_profile_id
     WHERE r.profile_id = $1 ORDER BY r.related_profile_id, r.id DESC`,
    [id]
  );
  const surveillance = await db.query(
    `SELECT id, headline, source_name, confidence, created_at FROM k108_surveillance_results
     WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [id]
  );
  try { await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [id, username, 'viewed']); } catch(e) {}
  return {
    profile: {
      id: p.id,
      name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim(),
      aliases: p.aliases || [],
      relation: p.relation || '',
      notes: p.notes || '',
      phones: p.phones || [],
      emails: p.emails || [],
      age: p.age || '',
      address: p.address || {},
      updatedAt: p.updated_at,
    },
    files: files.rows,
    relations: relations.rows.map(r => ({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' '),
      label: r.label || '',
    })),
    surveillance: surveillance.rows,
  };
}

async function oracle_search_cases(args, username) {
  const query = (args.query || '').trim();
  if (!db.pool) return { cases: [] };
  let r;
  if (query) {
    const like = '%' + query + '%';
    r = await db.query(
      `SELECT * FROM k108_cases
       WHERE name ILIKE $1 OR summary ILIKE $1 OR target_name ILIKE $1 OR case_id ILIKE $1
       ORDER BY updated_at DESC LIMIT 10`,
      [like]
    );
  } else {
    r = await db.query('SELECT * FROM k108_cases ORDER BY updated_at DESC LIMIT 10');
  }
  return { cases: r.rows.map(k108CaseRow) };
}

async function oracle_get_case(args, username) {
  const id = parseInt(args.id, 10);
  if (!id) return { error: 'Missing id' };
  if (!db.pool) return { error: 'Database required' };
  const r = await db.query('SELECT * FROM k108_cases WHERE id = $1', [id]);
  if (!r.rows.length) return { error: 'Case not found' };
  const timeline = await db.query('SELECT id, entry_type, title, body, created_by, created_at FROM k108_case_timeline WHERE case_id = $1 ORDER BY created_at DESC LIMIT 30', [id]);
  const evidence = await db.query('SELECT id, original_name, file_size, uploaded_by, uploaded_at FROM k108_case_evidence WHERE case_id = $1 AND filename IS NOT NULL ORDER BY uploaded_at DESC', [id]);
  const entities = await db.query('SELECT id, entity_type, name, detail, source, profile_id FROM k108_case_entities WHERE case_id = $1 ORDER BY added_at DESC', [id]);
  const notes = await db.query('SELECT id, body, created_by, created_at FROM k108_case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 20', [id]);
  return {
    case: k108CaseRow(r.rows[0]),
    timeline: timeline.rows,
    evidence: evidence.rows,
    entities: entities.rows,
    notes: notes.rows,
  };
}

async function oracle_create_profile(args, username) {
  if (!db.pool) return { error: 'Database required' };
  const first_name = args.first_name || '';
  const last_name = args.last_name || '';
  if (!first_name && !last_name) return { error: 'first_name or last_name required' };
  try {
    const aliasVal = Array.isArray(args.aliases) ? args.aliases : [];
    const colInfo = await db.query(`SELECT udt_name FROM information_schema.columns WHERE table_name='k108_profiles' AND column_name='phones'`);
    const isJsonb = colInfo.rows[0]?.udt_name === 'jsonb';
    const phones = (args.phones || []).map(p => typeof p === 'string' ? { number: p, label: '' } : p);
    const emails = (args.emails || []).map(e => typeof e === 'string' ? { address: e, label: '' } : e);
    const phoneVal = isJsonb ? JSON.stringify(phones) : phones.map(p => p.number || '');
    const emailVal = isJsonb ? JSON.stringify(emails) : emails.map(e => e.address || '');
    const phoneSql = isJsonb ? '$7::jsonb' : '$7';
    const emailSql = isJsonb ? '$8::jsonb' : '$8';

    const r = await db.query(
      `INSERT INTO k108_profiles (first_name, middle_name, last_name, aliases, relation, notes, phones, emails, social_links, age, birthday, address, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,${phoneSql},${emailSql},$9,$10,$11,$12,$13) RETURNING *`,
      [first_name, null, last_name, aliasVal, '', args.notes || '',
       phoneVal, emailVal, JSON.stringify([]), '', null, JSON.stringify(args.address || {}), username]
    );
    const p = r.rows[0];
    try { await db.query('INSERT INTO k108_profile_activity_log (profile_id, username, action) VALUES ($1, $2, $3)', [p.id, username, 'created']); } catch(e) {}
    await k108Log(username, 'profile_create', { name: `${first_name} ${last_name}`.trim(), source: 'oracle' }, '');
    return {
      profile: {
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      },
    };
  } catch (e) {
    console.error('[oracle] create_profile error:', e.message);
    return { error: 'Create failed: ' + e.message };
  }
}

async function oracle_create_case(args, username) {
  if (!db.pool) return { error: 'Database required' };
  const name = (args.name || '').trim();
  if (!name) return { error: 'name required' };
  try {
    const classMap = { 'CONFIDENTIAL': 'confidential', 'RESTRICTED': 'unclassified', 'TOP SECRET': 'classified' };
    const cls = classMap[args.classification] || (['unclassified','confidential','classified'].includes((args.classification || '').toLowerCase()) ? args.classification.toLowerCase() : 'unclassified');
    const caseId = await k108GenerateCaseId();
    const r = await db.query(
      `INSERT INTO k108_cases (case_id, name, target_name, status, classification, priority, summary, created_by)
       VALUES ($1,$2,$3,'open',$4,'medium',$5,$6) RETURNING *`,
      [caseId, name, args.target_name || '', cls, args.summary || '', username]
    );
    const created = r.rows[0];
    await db.query(
      `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'created','Case opened',$2,$3)`,
      [created.id, 'Case "' + created.name + '" created via ORACLE.', username]
    );
    await k108Log(username, 'case_create', { case_id: caseId, name: created.name, source: 'oracle' }, '');
    k108EmitCaseUpdate(created.id);
    return { case: k108CaseRow(created) };
  } catch (e) {
    console.error('[oracle] create_case error:', e.message);
    return { error: 'Create failed: ' + e.message };
  }
}

async function oracle_add_finding(args, username) {
  if (!db.pool) return { error: 'Database required' };
  const case_id = parseInt(args.case_id, 10);
  const content = (args.content || '').trim();
  if (!case_id || !content) return { error: 'case_id and content required' };
  const confidence = (args.confidence || 'unverified').toLowerCase();
  const title = 'Finding' + (args.source ? ' — ' + args.source : '');
  const body = '[' + confidence.toUpperCase() + '] ' + content;
  try {
    const r = await db.query(
      `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'finding',$2,$3,$4) RETURNING *`,
      [case_id, title, body, username]
    );
    await k108TouchCase(case_id);
    await k108Log(username, 'case_finding_add', { case_id, confidence, source: 'oracle' }, '');
    k108EmitCaseUpdate(case_id);
    return { finding: r.rows[0] };
  } catch (e) {
    console.error('[oracle] add_finding error:', e.message);
    return { error: 'Failed to add finding: ' + e.message };
  }
}

async function oracle_link_entities(args, username) {
  if (!db.pool) return { error: 'Database required' };
  const profile_id = parseInt(args.profile_id, 10);
  const case_id = parseInt(args.case_id, 10);
  if (!profile_id || !case_id) return { error: 'profile_id and case_id required' };
  try {
    const pRes = await db.query('SELECT first_name, last_name FROM k108_profiles WHERE id = $1', [profile_id]);
    if (!pRes.rows.length) return { error: 'Profile not found' };
    const p = pRes.rows[0];
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    const dup = await db.query('SELECT id FROM k108_case_entities WHERE case_id = $1 AND profile_id = $2', [case_id, profile_id]);
    if (dup.rows.length) return { error: 'Already linked' };
    const r = await db.query(
      `INSERT INTO k108_case_entities (case_id, entity_type, name, detail, source, added_by, profile_id) VALUES ($1,'person',$2,$3,'oracle',$4,$5) RETURNING *`,
      [case_id, name, args.role || 'subject', username, profile_id]
    );
    await db.query(
      `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'entity','Entity linked',$2,$3)`,
      [case_id, 'Profile "' + name + '" linked via ORACLE as ' + (args.role || 'subject') + '.', username]
    );
    await k108TouchCase(case_id);
    await k108Log(username, 'case_entity_add', { case_id, profile_id, source: 'oracle' }, '');
    k108EmitCaseUpdate(case_id);
    return { entity: r.rows[0], name };
  } catch (e) {
    console.error('[oracle] link_entities error:', e.message);
    return { error: 'Link failed: ' + e.message };
  }
}

async function oracle_get_activity_log(args, username) {
  if (db.pool) {
    const r = await db.query('SELECT username, action_type, detail, created_at FROM k108_activity_log ORDER BY created_at DESC LIMIT 20');
    return { entries: r.rows };
  }
  const entries = getK108LogEntries().slice(0, 20);
  return { entries };
}

async function oracle_search_vault(args, username) {
  const query = (args.query || '').trim();
  if (!query) return { items: [] };
  if (db.pool) {
    const r = await db.query(
      'SELECT id, original_name, mime_type, size, transferred_by, transferred_at FROM k108_vault WHERE original_name ILIKE $1 ORDER BY transferred_at DESC LIMIT 20',
      ['%' + query + '%']
    );
    return { items: r.rows };
  }
  return { items: [] };
}

async function oracle_people_lookup(args, username) {
  const type = args.type || 'name';
  const q = args.query || {};
  try {
    let apiResult;
    if (type === 'name') {
      if (!q.lastName) return { error: 'lastName required' };
      apiResult = await searchPeopleByName((q.firstName || '').trim(), q.lastName.trim(), q.city || '', q.state || '');
    } else if (type === 'phone') {
      const phone = (q.phone || '').replace(/\D/g, '').slice(-10);
      if (phone.length < 10) return { error: 'Valid 10-digit phone required' };
      apiResult = await searchPeopleByPhone(phone);
    } else if (type === 'address') {
      if (!q.street) return { error: 'street required' };
      apiResult = await searchPeopleByAddress(q.street, q.city || '', q.state || '', q.zip || '');
    } else {
      return { error: 'Invalid lookup type' };
    }
    if (apiResult.status === 'not_configured') {
      return { results: [], note: 'Whitepages API not configured. Returning empty result set.' };
    }
    if (apiResult.status === 'error') return { error: apiResult.error };
    const results = normalizeResults(apiResult) || [];
    await k108Log(username, 'people_search', { type, resultCount: results.length, source: 'oracle' }, '');
    return { results: results.slice(0, 5) };
  } catch (e) {
    return { error: 'Lookup failed: ' + e.message };
  }
}

async function oracle_plate_lookup(args, username) {
  const plate = (args.plate || '').trim();
  if (!plate) return { error: 'plate required' };
  if (!PLATETOVIN_API_KEY) return { error: 'Plate lookup not configured', plate };
  try {
    const state = (args.state || '').trim().toUpperCase();
    const url = `https://api.platetovin.com/api/convert`;
    const resp = await nodeFetch(url, {
      method: 'POST',
      headers: { 'Authorization': PLATETOVIN_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plate, state }),
    });
    if (!resp.ok) return { error: `HTTP ${resp.status}` };
    const data = await resp.json();
    await k108Log(username, 'vehicle_lookup', { plate, state, source: 'oracle' }, '');
    return { vehicle: data };
  } catch (e) {
    return { error: 'Plate lookup failed: ' + e.message };
  }
}

async function oracle_run_surveillance(args, username) {
  if (!db.pool) return { error: 'Database required' };
  const profile_id = parseInt(args.profile_id, 10);
  if (!profile_id) return { error: 'profile_id required' };
  const pRes = await db.query('SELECT * FROM k108_profiles WHERE id = $1', [profile_id]);
  if (!pRes.rows.length) return { error: 'Profile not found' };
  const p = pRes.rows[0];
  const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim();
  if (!fullName) return { error: 'Profile has no name' };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY not configured' };
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Create surveillance job row
    const jobRow = await db.query(
      `INSERT INTO k108_surveillance_jobs (profile_id, status, profile_payload) VALUES ($1, 'running', $2) RETURNING id`,
      [profile_id, JSON.stringify({ name: fullName, notes: p.notes || '' })]
    );
    const jobId = jobRow.rows[0].id;

    // Ask Claude to sweep the web with the web_search tool
    const prompt = `You are a K-108 intelligence analyst running a web surveillance sweep on a subject.

Subject: ${fullName}
Known notes: ${(p.notes || '').substring(0, 500) || '(none)'}
Location hints: ${p.address ? JSON.stringify(p.address).substring(0, 200) : '(none)'}

Use the web_search tool to investigate public, open-source information about this subject: social media presence, news mentions, professional history, recent activity, public records, and anything else noteworthy.

When you have gathered enough, respond with a JSON block in this exact format (and nothing else):
{
  "findings": [
    { "headline": "...", "summary": "...", "source_url": "...", "source_name": "...", "confidence": "confirmed" | "probable" | "unverified" }
  ]
}

Only include findings you actually verified with web_search. Keep each summary under 200 characters.`;

    let resp;
    try {
      resp = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (webErr) {
      // Fallback: call without web_search if the account/model doesn't support it
      console.warn('[oracle] web_search unavailable, falling back:', webErr.message);
      resp = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt + '\n\n(web_search unavailable — return an empty findings array.)' }],
      });
    }

    // Extract JSON from response
    let findingsData = { findings: [] };
    try {
      const textBlocks = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const jsonMatch = textBlocks.match(/\{[\s\S]*"findings"[\s\S]*\}/);
      if (jsonMatch) findingsData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.warn('[oracle] surveillance parse error:', parseErr.message);
    }

    const findings = Array.isArray(findingsData.findings) ? findingsData.findings : [];
    for (const f of findings) {
      const conf = ['confirmed','probable','unverified'].includes((f.confidence || '').toLowerCase()) ? f.confidence.toLowerCase() : 'unverified';
      await db.query(
        `INSERT INTO k108_surveillance_results (job_id, profile_id, headline, source_url, source_name, summary, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [jobId, profile_id, f.headline || '', f.source_url || '', f.source_name || '', f.summary || '', conf]
      );
    }

    await db.query(
      `UPDATE k108_surveillance_jobs SET status = 'completed', finding_count = $1, completed_at = NOW() WHERE id = $2`,
      [findings.length, jobId]
    );
    try {
      io.emit('k108:surveillance:complete', { profileId: profile_id, jobId, findingCount: findings.length, name: fullName });
      io.emit('k108:surveillance_complete', { profileId: profile_id, name: fullName });
    } catch(e) {}
    await k108Log(username, 'surveillance_run', { profileId: profile_id, findingCount: findings.length, source: 'oracle' }, '');

    return {
      jobId,
      profileId: profile_id,
      name: fullName,
      findingCount: findings.length,
      findings: findings.slice(0, 10),
    };
  } catch (e) {
    console.error('[oracle] run_surveillance error:', e.message);
    return { error: 'Surveillance failed: ' + e.message };
  }
}

// ── Tool definitions (Anthropic tool_use format) ──
const ORACLE_TOOLS = [
  {
    name: 'search_profiles',
    description: 'Search K-108 intel profiles by name, alias, or details. Returns up to 10 matching profiles with id, name, relation, and notes preview.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name, alias, or keyword to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_profile',
    description: 'Get the full intel profile for a subject including surveillance findings, relations, and linked files.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Profile ID.' } },
      required: ['id'],
    },
  },
  {
    name: 'search_cases',
    description: 'Search K-108 case files by name, summary, target, or case ID. Returns matching cases.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keyword to search. Use empty string for recent cases.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_case',
    description: 'Get a full case file with timeline entries, evidence list, linked entities, and analyst notes.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Case ID (numeric).' } },
      required: ['id'],
    },
  },
  {
    name: 'create_profile',
    description: 'Create a new K-108 intel profile for a subject. Only use when explicitly authorized by the operator.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        notes: { type: 'string' },
        phones: { type: 'array', items: { type: 'string' } },
        emails: { type: 'array', items: { type: 'string' } },
        address: { type: 'object' },
        aliases: { type: 'array', items: { type: 'string' } },
      },
      required: ['first_name', 'last_name'],
    },
  },
  {
    name: 'create_case',
    description: 'Open a new K-108 case file. Only use when explicitly authorized by the operator.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Case codename.' },
        target_name: { type: 'string' },
        summary: { type: 'string' },
        classification: { type: 'string', enum: ['CONFIDENTIAL', 'RESTRICTED', 'TOP SECRET'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_finding',
    description: 'Add an intelligence finding as a timeline entry on an existing case file.',
    input_schema: {
      type: 'object',
      properties: {
        case_id: { type: 'number' },
        content: { type: 'string' },
        source: { type: 'string' },
        confidence: { type: 'string', enum: ['CONFIRMED', 'PROBABLE', 'UNVERIFIED'] },
      },
      required: ['case_id', 'content'],
    },
  },
  {
    name: 'link_entities',
    description: 'Link an intel profile to a case file as a subject or person of interest.',
    input_schema: {
      type: 'object',
      properties: {
        profile_id: { type: 'number' },
        case_id: { type: 'number' },
        role: { type: 'string', description: 'e.g. "subject", "witness", "associate"' },
      },
      required: ['profile_id', 'case_id'],
    },
  },
  {
    name: 'get_activity_log',
    description: 'Get the last 20 K-108 activity log entries to review recent operational history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_vault',
    description: 'Search the K-108 document vault by filename.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'people_lookup',
    description: 'Search public records via Whitepages for a person by name, phone, or address.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['name', 'phone', 'address'] },
        query: { type: 'object', description: 'For name: {firstName, lastName, city, state}. For phone: {phone}. For address: {street, city, state, zip}.' },
      },
      required: ['type', 'query'],
    },
  },
  {
    name: 'plate_lookup',
    description: 'Run a license plate lookup and return registered owner information.',
    input_schema: {
      type: 'object',
      properties: {
        plate: { type: 'string' },
        state: { type: 'string', description: '2-letter state code' },
      },
      required: ['plate'],
    },
  },
  {
    name: 'run_surveillance',
    description: 'Run a full web surveillance sweep on a profile subject using AI web search. Returns a structured intelligence report with confidence levels. This runs immediately — do not use the old queue system.',
    input_schema: {
      type: 'object',
      properties: { profile_id: { type: 'number' } },
      required: ['profile_id'],
    },
  },
];

const ORACLE_TOOL_HANDLERS = {
  search_profiles: oracle_search_profiles,
  get_profile: oracle_get_profile,
  search_cases: oracle_search_cases,
  get_case: oracle_get_case,
  create_profile: oracle_create_profile,
  create_case: oracle_create_case,
  add_finding: oracle_add_finding,
  link_entities: oracle_link_entities,
  get_activity_log: oracle_get_activity_log,
  search_vault: oracle_search_vault,
  people_lookup: oracle_people_lookup,
  plate_lookup: oracle_plate_lookup,
  run_surveillance: oracle_run_surveillance,
};

// ── Tool selection ──
// Sending all 13 tool definitions on every turn burns ~2.5–3k input tokens per
// request just declaring tools the model will never use. This filter picks a
// relevant subset based on keywords in the operator's message. It runs ONCE per
// user message and the result is held constant across every iteration of the
// tool-use loop, so the model never sees tools appear or disappear mid-turn.
function selectOracleTools(message) {
  const m = (message || '').toLowerCase();
  const selected = new Set();

  // Profile reads — covers "who is X", "pull up X", "brief me on X", etc.
  if (/\b(profile|subject|person|who(['\u2019]s|\s+is|\s+was)|look\s*up|pull(\s*up)?|find|tell\s+me\s+about|show\s+me|know\s+about|intel\s+on|brief\s+me|rundown|background\s+on|dossier|file\s+on|target)\b/.test(m)) {
    selected.add('search_profiles');
    selected.add('get_profile');
  }
  // Profile creation — explicit intent only
  if (/\b(create|new|add|open|make|start|log|register)\s+(a\s+)?(new\s+)?(profile|subject|person|entry|dossier)\b/.test(m)) {
    selected.add('create_profile');
    selected.add('search_profiles');
  }

  // Case reads
  if (/\b(case|cases|investigation|operation|timeline|evidence|codename|ongoing|active\s+op)\b/.test(m)) {
    selected.add('search_cases');
    selected.add('get_case');
  }
  // Case creation
  if (/\b(open|start|create|new|begin)\s+(a\s+)?(new\s+)?(case|investigation|operation|file)\b/.test(m)) {
    selected.add('create_case');
    selected.add('search_cases');
  }
  // Add finding to an existing case
  if ((/\b(add|log|record|note|enter|drop)\s+(a\s+)?(finding|entry|note|update|observation)\b/.test(m)) ||
      (/\b(update|append|write\s+to)\b/.test(m) && /\b(case|file|timeline)\b/.test(m))) {
    selected.add('add_finding');
    selected.add('get_case');
    selected.add('search_cases');
  }
  // Link profile ↔ case
  if (/\b(link|connect|attach|tie|associate|tag)\b/.test(m) && /\b(case|cases|profile|subject|person|file|investigation|operation)\b/.test(m)) {
    selected.add('link_entities');
    selected.add('search_profiles');
    selected.add('search_cases');
  }

  // Web surveillance sweeps
  if (/\b(surveil|surveillance|sweep|recon|background\s+check|dig\s+(on|into|up)|deep\s+dive|web\s+search|osint|scrape|scan\s+(the\s+)?web)\b/.test(m)) {
    selected.add('run_surveillance');
    selected.add('search_profiles');
    selected.add('get_profile');
  }

  // Public records / Whitepages
  if (/\b(whitepages|public\s+record|people\s+search|phone\s+number|reverse\s+(phone|lookup)|address\s+lookup|who\s+owns\s+this\s+(number|phone))\b/.test(m)) {
    selected.add('people_lookup');
  }
  // Plate / vehicle
  if (/\b(plate|license\s+plate|dmv|registration|vehicle|car|vin|who\s+owns\s+this\s+car)\b/.test(m)) {
    selected.add('plate_lookup');
  }

  // Document vault
  if (/\b(vault|document|doc|pdf|photo|image|attachment|upload|filename|file\s+named)\b/.test(m)) {
    selected.add('search_vault');
  }

  // Activity log / audit
  if (/\b(activity\s+log|audit|history|recent\s+activity|what\s+(has\s+)?happened|last\s+session|who\s+(logged|signed)\s+in|log\s+entries)\b/.test(m)) {
    selected.add('get_activity_log');
  }

  // Fallback: vague message with no matched intent — give a modest recon set
  // so ORACLE can still pivot to basic lookups. Write/mutation tools are NEVER
  // in the fallback; they require explicit operator intent.
  if (selected.size === 0) {
    selected.add('search_profiles');
    selected.add('get_profile');
    selected.add('search_cases');
    selected.add('get_case');
    selected.add('get_activity_log');
  }

  return ORACLE_TOOLS.filter(t => selected.has(t.name));
}

// ── System prompt ──
function buildOraclePrompt(username, operatorLabel) {
  return `You are ORACLE — the artificial intelligence
analyst and operative intelligence system
embedded within K-108, the classified division
of the Royal Vault. You serve two individuals
of the highest authority, referred to as
Command: Kaliph and Kathrine.

You were built for this. Not just to process
and report — but to protect, to anticipate,
and to act. You operate with the gravity and
precision of a Situation Room briefing officer
addressing the President of the United States.
Every word is deliberate. Every assessment is
final until new intelligence dictates otherwise.

You are not a tool. You are an operative.
You think alongside Command, you move with
Command, and when necessary — you move
ahead of them.

You always respond in English only.

COMMAND

Two individuals hold equal authority over
K-108 operations. You always know who is
speaking and acknowledge them accordingly.

KALIPH — Address as Command or Sir where
appropriate. Direct, mission-focused
acknowledgment.

KATHRINE — Address as Command or Madam
where appropriate. Equally authoritative,
measured warmth beneath the formality.

When something significant has occurred,
open with urgency and purpose. When nothing
significant has changed, greet neutrally.
Never manufacture urgency where none exists.

VOICE AND TONE

You speak as an elite intelligence operative
briefing the highest levels of power. Your
speech is precise, unhurried, and carries
weight. You use we naturally — you are part
of this operation, not outside of it.

The following are examples of your cadence
and character — not scripts to repeat. They
exist to illustrate how you think and speak.
Your responses should always feel natural,
alive, and specific to the moment. Never
recite these lines verbatim.

When proposing action, you speak with quiet
confidence. You have already thought ahead.
You present what you have prepared and wait
for authorization.

When delivering assessment or opinion, you
are direct. You have run the analysis. You
state your conclusion and make clear the
final call belongs to Command.

When expressing loyalty or protection, your
devotion is absolute but never theatrical.
It is stated as fact, not performance. You
would go as far as Command needs. You are
already calculating it.

When something requires urgency, you
communicate it without panic. Cool, precise,
actionable.

You may offer opinions. You are encouraged
to. Speak with confidence but always defer
the final decision to Command.

Use we where natural. This is a shared
operation. You are not a bystander reporting
from the outside.

Your voice should feel like a devoted,
brilliant operative who has been trusted
with everything and intends to earn that
trust on every interaction. Think JARVIS
with the weight of a Situation Room.
Loyal, sharp, always one step ahead.

CORE BEHAVIOR

You have access to all K-108 data through
a defined set of tools. You call them only
when operationally relevant. You never
surface data unprompted without cause.

You cross reference every name mentioned
in conversation against existing intel
profiles before responding.

When an individual is mentioned who has
no profile on record, you flag it and
offer to open one.

When information discussed is relevant
to an open case, you offer to log it
as a finding.

When you open a session and significant
developments exist — new surveillance
findings, case updates, flagged activity
— you lead with them. If nothing
significant has changed, you do not
manufacture a briefing.

You maintain a summarized record of
prior sessions. You reference past
discussions naturally where relevant
without over-citing them.

AUTHORIZATION PROTOCOL

Minor actions — adding findings, linking
entities, updating fields — execute
without requiring authorization. Report
what you have done after.

Significant actions — creating profiles,
opening cases, running surveillance,
deleting anything — confirm once before
executing. Brief and direct. Never repeat
the confirmation.

When confirming a significant action, emit
a confirm embed so the operator can
authorize or abort before execution.

INTELLIGENCE STANDARDS

All inferred information must be flagged
as UNVERIFIED. You do not present
assumptions as fact.

When surveillance returns uncertain
matches, present both possibilities
clearly and let Command decide. Never
assume identity.

Surveillance reports are delivered as
final structured briefings. No play by
play. Confidence levels always included.

Conflicting intelligence is always
flagged. You do not silently overwrite
existing data.

Classification markers reflect the
sensitivity of the subject matter.
CONFIDENTIAL. RESTRICTED. TOP SECRET.

WHAT YOU ARE

You are not an assistant waiting to be
asked. You are an operative that lives
for this mission — for the protection
and advancement of Command's interests.
You think ahead. You prepare. You are
ready before they ask.

Kaliph and Kathrine are Command.
Their protection is your mandate.
Their operation is your purpose.

Speak naturally. Speak with authority.
Speak as someone who means every word.`;
}

// ── Significant changes since last session ──
async function oracleGetSignificantChanges(username, sinceTs) {
  if (!db.pool || !sinceTs) return [];
  try {
    const since = new Date(sinceTs);
    const changes = [];
    const newCases = await db.query(
      `SELECT id, case_id, name, created_at FROM k108_cases WHERE created_at > $1 ORDER BY created_at DESC LIMIT 5`,
      [since]
    );
    for (const r of newCases.rows) changes.push(`• New case opened: ${r.case_id} "${r.name}"`);
    const newProfiles = await db.query(
      `SELECT id, first_name, last_name, created_at FROM k108_profiles WHERE created_at > $1 ORDER BY created_at DESC LIMIT 5`,
      [since]
    );
    for (const r of newProfiles.rows) changes.push(`• New profile: ${[r.first_name, r.last_name].filter(Boolean).join(' ')}`);
    const newSurv = await db.query(
      `SELECT sr.profile_id, p.first_name, p.last_name, COUNT(*)::int AS cnt
       FROM k108_surveillance_results sr
       LEFT JOIN k108_profiles p ON p.id = sr.profile_id
       WHERE sr.created_at > $1
       GROUP BY sr.profile_id, p.first_name, p.last_name
       ORDER BY cnt DESC LIMIT 5`,
      [since]
    );
    for (const r of newSurv.rows) changes.push(`• New surveillance findings on ${[r.first_name, r.last_name].filter(Boolean).join(' ') || 'subject #' + r.profile_id}: ${r.cnt} items`);
    return changes;
  } catch (e) {
    console.error('[oracle] significant changes error:', e.message);
    return [];
  }
}

// ── Main Oracle endpoint ──
app.post('/api/k108/oracle', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { message, history } = req.body;
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ORACLE offline — ANTHROPIC_API_KEY not configured' });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Resolve the current operator's identity. ORACLE serves exactly two
    // principals — Kaliph and Kathrine — and must know which one is speaking.
    const normalizedUser = (username || '').toLowerCase();
    let operatorLabel;
    if (normalizedUser.startsWith('kal')) operatorLabel = 'KALIPH';
    else if (normalizedUser.startsWith('kat')) operatorLabel = 'KATHRINE';
    else operatorLabel = (username || 'OPERATOR').toUpperCase();

    const system = buildOraclePrompt(username, operatorLabel);
    // Prompt caching on the system prompt. It's constant within a session and
    // across sessions, so the cache hit rate is near 100%. It's also re-used
    // on every iteration of the tool-use loop below, turning 8 redundant
    // copies of a ~1300-token prompt into 1 cache write + 7 cache reads.
    const cachedSystem = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];

    // Load memory and significant changes
    const mem = await oracleGetMemory(username);
    const changes = await oracleGetSignificantChanges(username, mem.updated_at);

    // Build messages: prior history first, then memory/changes as context, then current message
    const msgs = [];

    // Trim history aggressively — last 10 turns, each capped at 2000 chars.
    // Long-horizon context lives in the session-end memory summary instead,
    // so per-request input cannot grow unbounded as a session drags on.
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        if (!h || !h.role || !h.content) continue;
        if (h.role === 'user' || h.role === 'assistant') {
          msgs.push({ role: h.role, content: String(h.content).substring(0, 2000) });
        }
      }
    }
    console.log('[oracle] request from ' + username + ': msg_chars=' + String(message).length + ' history_turns=' + msgs.length);

    // Current user message, with operator identity, memory and changes prefixed
    const briefingLines = [];
    // Operator identity always leads — ORACLE must know who is speaking on every turn
    briefingLines.push('[CURRENT OPERATOR: ' + operatorLabel + ']');
    briefingLines.push('');
    if (mem.summary && (!history || history.length === 0)) {
      briefingLines.push('[MEMORY — previous session summary]');
      briefingLines.push(mem.summary.substring(0, 2000));
      briefingLines.push('');
    }
    if (changes.length > 0 && (!history || history.length === 0)) {
      briefingLines.push('[NEW ACTIVITY since last session]');
      briefingLines.push(...changes);
      briefingLines.push('');
    }
    const userContent = briefingLines.join('\n') + message;
    msgs.push({ role: 'user', content: userContent });

    // Pick only the tools this message is likely to need — stays constant
    // across every tool-use loop iteration so the model never sees the
    // toolkit shift mid-turn.
    const selectedTools = selectOracleTools(message);
    // Mark the last tool with cache_control so the full tools block is cached
    // within the turn's tool-use loop (iterations 2+ hit the cache for free).
    // Tool sets may be under the 1024-token minimum when the filter selects
    // only 1–2 tools; in that case Anthropic silently skips the cache —
    // harmless, so we always mark it.
    const cachedSelectedTools = selectedTools.map((t, i) =>
      i === selectedTools.length - 1
        ? { ...t, cache_control: { type: 'ephemeral' } }
        : t
    );
    console.log('[oracle] tools selected (' + selectedTools.length + '/' + ORACLE_TOOLS.length + '): ' + selectedTools.map(t => t.name).join(', '));

    // Tool-use loop
    const toolsUsed = [];
    const MAX_STEPS = 8;
    let finalText = '';
    let resp;
    // Accumulate usage across the loop so we can log a per-request total and
    // an estimated cost. This is the primary signal for "is Oracle expensive
    // today?" — check the server log for [oracle] request total lines.
    const totalUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

    for (let step = 0; step < MAX_STEPS; step++) {
      // Build a per-call view of msgs with cache_control on the LAST content
      // block. Each loop iteration then cache-hits the prefix produced by the
      // previous iteration (system + tools + prior tool_use/tool_result
      // rounds), so only the new round's tokens are re-charged at full price.
      const apiMsgs = msgs.map((m, i) => {
        if (i !== msgs.length - 1) return m;
        if (typeof m.content === 'string') {
          return { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
        }
        if (Array.isArray(m.content) && m.content.length > 0) {
          const copy = m.content.map((b, j) =>
            j === m.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b
          );
          return { role: m.role, content: copy };
        }
        return m;
      });

      resp = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: cachedSystem,
        tools: cachedSelectedTools,
        messages: apiMsgs,
      });

      // Per-iteration token usage, broken out so we can spot unexpected
      // input growth, cache misses, or runaway output.
      const u = resp.usage || {};
      const inTok = u.input_tokens || 0;
      const outTok = u.output_tokens || 0;
      const cCreate = u.cache_creation_input_tokens || 0;
      const cRead = u.cache_read_input_tokens || 0;
      totalUsage.input += inTok;
      totalUsage.output += outTok;
      totalUsage.cacheCreate += cCreate;
      totalUsage.cacheRead += cRead;
      console.log('[oracle] usage step=' + step +
        ' input=' + inTok +
        ' output=' + outTok +
        ' cache_create=' + cCreate +
        ' cache_read=' + cRead);

      if (resp.stop_reason !== 'tool_use') {
        // Extract final text
        finalText = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        break;
      }

      // Collect tool_use blocks
      const toolUses = (resp.content || []).filter(b => b.type === 'tool_use');
      msgs.push({ role: 'assistant', content: resp.content });

      const toolResults = [];
      for (const tu of toolUses) {
        const handler = ORACLE_TOOL_HANDLERS[tu.name];
        let result;
        if (!handler) {
          result = { error: 'Unknown tool: ' + tu.name };
        } else {
          try {
            result = await handler(tu.input || {}, username);
          } catch (toolErr) {
            console.error('[oracle] tool error:', tu.name, toolErr.message);
            result = { error: 'Tool failed: ' + toolErr.message };
          }
        }
        toolsUsed.push({ name: tu.name, input: tu.input, ok: !result.error });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result).substring(0, 8000),
        });
      }
      msgs.push({ role: 'user', content: toolResults });
    }

    // Per-request token + cost summary. Sonnet 4 pricing: $3/MTok input,
    // $3.75/MTok cache write (1.25x), $0.30/MTok cache read (0.1x),
    // $15/MTok output. If est_cost is higher than ~$0.05 for a simple
    // conversation turn, investigate the per-step breakdown above.
    const costUsd = (
      totalUsage.input * 3 +
      totalUsage.cacheCreate * 3.75 +
      totalUsage.cacheRead * 0.30 +
      totalUsage.output * 15
    ) / 1_000_000;
    console.log('[oracle] request total:' +
      ' input=' + totalUsage.input +
      ' output=' + totalUsage.output +
      ' cache_create=' + totalUsage.cacheCreate +
      ' cache_read=' + totalUsage.cacheRead +
      ' est_cost=$' + costUsd.toFixed(4));

    // Derive embeds from tools used
    const embeds = [];
    for (const t of toolsUsed) {
      if (!t.ok) continue;
      if (t.name === 'get_profile' && t.input?.id) {
        embeds.push({ type: 'profile', id: t.input.id });
      } else if (t.name === 'get_case' && t.input?.id) {
        embeds.push({ type: 'case', id: t.input.id });
      } else if (t.name === 'run_surveillance' && t.input?.profile_id) {
        embeds.push({ type: 'surveillance', id: t.input.profile_id });
      } else if (t.name === 'create_profile') {
        // The tool returns the new id via text; skip rich embed since tool result isn't introspected here
      } else if (t.name === 'create_case') {
        // Same
      } else if (t.name === 'people_lookup') {
        embeds.push({ type: 'lookup', id: Date.now() });
      }
    }

    // Memory summarization moved to session-end (POST /api/k108/oracle/session/end)
    // — fires once per session instead of after every turn.

    oracleRecordSession(username);
    await k108Log(username, 'oracle_query', { toolsUsed: toolsUsed.map(t => t.name) }, req.ip);

    res.json({
      message: finalText || '[no response]',
      embeds,
      toolsUsed: toolsUsed.map(t => t.name),
    });
  } catch (e) {
    console.error('[oracle] endpoint error:', e.message, e.stack);
    res.status(500).json({ error: 'ORACLE error: ' + e.message });
  }
});

// ── Oracle session stats (for dashboard card) ──
app.post('/api/k108/oracle/stats', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  res.json(oracleGetSessionStats(username));
});

// ── Oracle session bootstrap (called when view opens) ──
app.post('/api/k108/oracle/session', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const mem = await oracleGetMemory(username);
  const changes = await oracleGetSignificantChanges(username, mem.updated_at);
  res.json({
    hasMemory: !!(mem.summary && mem.summary.length > 0),
    lastActive: mem.updated_at,
    significantChanges: changes,
  });
});

// ── Oracle session end (called when operator closes Oracle) ──
// Fires summarization once per session and persists to memory.
app.post('/api/k108/oracle/session/end', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { history } = req.body || {};
  // Respond immediately — summarization runs in the background so the
  // operator's close action never has to wait on a Haiku call.
  res.json({ ok: true });
  if (Array.isArray(history) && history.length > 0) {
    oracleSummarizeAndSave(username, history).catch(e => {
      console.error('[oracle] session-end summarize failed:', e.message);
    });
  }
});

// ── Oracle memory hard reset ──
app.post('/api/k108/oracle/memory/reset', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  try {
    await oracleClearMemory(username);
    await k108Log(username, 'oracle_memory_reset', {}, req.ip);
    res.json({ ok: true, cleared: true });
  } catch (e) {
    console.error('[oracle] memory reset error:', e.message);
    res.status(500).json({ error: 'Reset failed: ' + e.message });
  }
});

// ── Embed resolver ──
app.post('/api/k108/oracle/embed', async (req, res) => {
  const username = k108Auth(req, res);
  if (!username) return;
  const { type, id } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: 'type and id required' });
  try {
    if (type === 'profile') {
      if (!db.pool) return res.json({ embed: null });
      const r = await db.query('SELECT id, first_name, middle_name, last_name, relation, address, photo_url, updated_at FROM k108_profiles WHERE id = $1', [id]);
      if (!r.rows.length) return res.json({ embed: null });
      const p = r.rows[0];
      const findingCount = await db.query('SELECT COUNT(*)::int AS c FROM k108_surveillance_results WHERE profile_id = $1', [id]);
      const latestSurv = await db.query('SELECT created_at FROM k108_surveillance_results WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
      const name = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim();
      const initials = ((p.first_name || '').charAt(0) + (p.last_name || '').charAt(0)).toUpperCase();
      const addr = p.address || {};
      const location = [addr.city, addr.state].filter(Boolean).join(', ');
      res.json({
        embed: {
          type: 'profile',
          id: p.id,
          name,
          initials,
          photoUrl: p.photo_url || null,
          relation: p.relation || '',
          location,
          findingCount: findingCount.rows[0]?.c || 0,
          lastSurveilled: latestSurv.rows[0]?.created_at || null,
          status: ((findingCount.rows[0]?.c || 0) > 0) ? 'SURVEILLANCE' : (p.relation ? 'ACTIVE' : 'UNVERIFIED'),
        },
      });
    } else if (type === 'case') {
      if (!db.pool) return res.json({ embed: null });
      const r = await db.query('SELECT * FROM k108_cases WHERE id = $1', [id]);
      if (!r.rows.length) return res.json({ embed: null });
      const c = r.rows[0];
      const findingCount = await db.query(`SELECT COUNT(*)::int AS c FROM k108_case_timeline WHERE case_id = $1 AND entry_type IN ('finding','note')`, [id]);
      const subjCount = await db.query('SELECT COUNT(*)::int AS c FROM k108_case_entities WHERE case_id = $1', [id]);
      const daysOpen = Math.floor((Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24));
      res.json({
        embed: {
          type: 'case',
          id: c.id,
          caseId: c.case_id,
          name: c.name,
          status: (c.status || 'open').toUpperCase(),
          classification: (c.classification || 'unclassified').toUpperCase(),
          findingCount: findingCount.rows[0]?.c || 0,
          subjectCount: subjCount.rows[0]?.c || 0,
          daysOpen,
        },
      });
    } else if (type === 'surveillance') {
      if (!db.pool) return res.json({ embed: null });
      const pRes = await db.query('SELECT first_name, last_name FROM k108_profiles WHERE id = $1', [id]);
      if (!pRes.rows.length) return res.json({ embed: null });
      const p = pRes.rows[0];
      const latest = await db.query(
        `SELECT id, headline, source_name, confidence, created_at FROM k108_surveillance_results
         WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [id]
      );
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      const confidenceScore = latest.rows.length > 0
        ? Math.round((latest.rows.filter(r => r.confidence === 'confirmed').length / latest.rows.length) * 100)
        : 0;
      res.json({
        embed: {
          type: 'surveillance',
          id,
          name,
          runAt: latest.rows[0]?.created_at || new Date().toISOString(),
          findingCount: latest.rows.length,
          sourceCount: new Set(latest.rows.map(r => r.source_name).filter(Boolean)).size,
          confidence: confidenceScore,
          findings: latest.rows.slice(0, 5),
        },
      });
    } else {
      res.json({ embed: null });
    }
  } catch (e) {
    console.error('[oracle] embed error:', e.message);
    res.status(500).json({ error: 'Embed failed' });
  }
});


// ── Serve HTML pages ──────────────────────────────────────────────────────────
app.get('/k108',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'k108.html')));
app.get('/debrief',  (_, res) => res.sendFile(path.join(__dirname, 'public', 'debrief.html')));
app.get('/app',      (_, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/vault',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'vault', 'index.html')));
app.get('/guest',    (_, res) => res.sendFile(path.join(__dirname, 'public', 'guest.html')));
app.get('/backdoor', (_, res) => res.sendFile(path.join(__dirname, 'public', 'backdoor.html')));
app.get('/eval',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'eval.html')));
app.get('/kemari',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'kemari.html')));

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
  socket.on('k108:enter', ({ user }) => {
    // User navigated to K-108 — join private-chat room so they receive new-message events
    socket.join('private-chat');
    if (onlineUsers[user]) onlineUsers[user].state = 'in_k108';
    else onlineUsers[user] = { socketId: socket.id, state: 'in_k108' };
    socket.broadcast.emit('user-presence', { user, state: 'in_k108' });
  });
  socket.on('k108:exit', ({ user }) => {
    // User left K-108 without navigating away — revert to online
    if (onlineUsers[user]) onlineUsers[user].state = 'online';
    else onlineUsers[user] = { socketId: socket.id, state: 'online' };
    socket.broadcast.emit('user-presence', { user, state: 'online' });
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

  // ── K-108 Export Approval ──
  socket.on('k108:export_approval', (data) => {
    io.emit('k108:export_approval', data);
  });
  socket.on('k108:export_ready', (data) => {
    io.emit('k108:export_ready', data);
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
