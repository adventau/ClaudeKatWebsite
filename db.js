'use strict';
let { Pool } = require('pg');

// Only create pool if DATABASE_URL is configured
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => console.error('[db] Pool error:', err.message));
} else if (process.env.LOCAL_DB === '1') {
  // Local dev fallback: real Postgres compiled to WASM via PGlite.
  // Persists to ./.local-pgdata so data survives restarts.
  try {
    const path = require('path');
    const { PGlite } = require('@electric-sql/pglite');
    const dbDir = path.join(__dirname, '.local-pgdata');
    const pg = new PGlite(dbDir);
    const ready = pg.waitReady;
    // Minimal pg.Pool shim: connect()→client with query()+release(), and pool.query()
    const makeClient = () => ({
      async query(sql, params) {
        await ready;
        // Convert $1,$2… to PGlite's expected form (it already accepts $n)
        const res = await pg.query(sql, params || []);
        return { rows: res.rows || [], rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0), fields: res.fields || [] };
      },
      release() {}
    });
    pool = {
      async connect() { await ready; return makeClient(); },
      async query(sql, params) { return makeClient().query(sql, params); },
      on() {},
      end: async () => { await pg.close(); }
    };
    console.log('[db] Using local PGlite at', dbDir, '(LOCAL_DB=1)');
  } catch (e) {
    console.error('[db] PGlite fallback failed:', e.message);
  }
}

async function query(sql, params = []) {
  if (!pool) throw new Error('No DATABASE_URL configured');
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ── data_store: single key-value table for all app data ──────────────────────
async function read(key) {
  if (!pool) return null;
  const r = await query('SELECT value FROM data_store WHERE key = $1', [key]);
  if (!r.rows.length) return null;
  return JSON.parse(r.rows[0].value);
}

async function write(key, data) {
  if (!pool) return;
  await query(
    'INSERT INTO data_store (key, value, updated_at) VALUES ($1, $2, $3) ' +
    'ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3',
    [key, JSON.stringify(data), Date.now()]
  );
}

// ── Schema (idempotent) ───────────────────────────────────────────────────────
async function createSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS data_store (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT         NOT NULL,
      updated_at BIGINT
    )
  `);
  await createSessionsTable();
  await createMessagesTable();
  await createBriefingsTable();
  await createK108Tables();
}

// ── Sessions table (for Postgres-backed express-session store) ────────────────
async function createSessionsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT   PRIMARY KEY,
      data    JSONB  NOT NULL,
      expires BIGINT NOT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires)`);
}

// ── Messages table ────────────────────────────────────────────────────────────
async function createMessagesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id             TEXT    PRIMARY KEY,
      sender         TEXT    NOT NULL,
      type           TEXT    NOT NULL DEFAULT 'text',
      content        TEXT    NOT NULL DEFAULT '',
      files          JSONB   NOT NULL DEFAULT '[]',
      priority       BOOLEAN NOT NULL DEFAULT false,
      reply_to       TEXT,
      timestamp      BIGINT  NOT NULL,
      edited         BOOLEAN NOT NULL DEFAULT false,
      edited_at      BIGINT,
      reactions      JSONB   NOT NULL DEFAULT '{}',
      is_read        BOOLEAN NOT NULL DEFAULT false,
      read_at        BIGINT,
      unsendable     BOOLEAN NOT NULL DEFAULT false,
      formatting     JSONB,
      ai_generated   BOOLEAN NOT NULL DEFAULT false,
      pinned         BOOLEAN NOT NULL DEFAULT false,
      pinned_by      TEXT,
      pinned_at      BIGINT,
      system_message BOOLEAN NOT NULL DEFAULT false,
      pinned_msg_id  TEXT,
      call_type      TEXT,
      call_status    TEXT,
      call_peer      TEXT
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages (timestamp)`);
}

// ── Briefings table ─────────────────────────────────────────────────────────
async function createBriefingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS briefings (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT      NOT NULL,
      content      TEXT      NOT NULL,
      date         DATE      NOT NULL,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      read_at      TIMESTAMP,
      UNIQUE (user_id, date)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS briefing_feedback (
      id              SERIAL PRIMARY KEY,
      user_id         TEXT      NOT NULL,
      briefing_date   DATE      NOT NULL,
      feedback_type   TEXT      NOT NULL,
      section         TEXT,
      highlighted_text TEXT,
      note            TEXT,
      permanent       BOOLEAN   NOT NULL DEFAULT FALSE,
      consolidated    BOOLEAN   NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  // Migration: add context + topic classification columns
  await query(`ALTER TABLE briefing_feedback ADD COLUMN IF NOT EXISTS context_before TEXT`);
  await query(`ALTER TABLE briefing_feedback ADD COLUMN IF NOT EXISTS context_after TEXT`);
  await query(`ALTER TABLE briefing_feedback ADD COLUMN IF NOT EXISTS topic_key TEXT`);

  // Standing preferences: persisted distilled rules that briefing generator must follow.
  // Sources: 'highlight_never' (immediate), 'consolidation' (weekly LLM pass), 'manual'.
  await query(`
    CREATE TABLE IF NOT EXISTS briefing_standing_preferences (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT      NOT NULL,
      rule_text    TEXT      NOT NULL,
      source       TEXT      NOT NULL DEFAULT 'consolidation',
      source_ref   TEXT,
      active       BOOLEAN   NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_briefing_std_prefs_user ON briefing_standing_preferences (user_id, active)`);

  // Topic log per briefing: deterministic dedup across days.
  await query(`
    CREATE TABLE IF NOT EXISTS briefing_topics (
      id            SERIAL PRIMARY KEY,
      briefing_id   INT       REFERENCES briefings(id) ON DELETE CASCADE,
      user_id       TEXT      NOT NULL,
      briefing_date DATE      NOT NULL,
      topic_key     TEXT      NOT NULL,
      summary       TEXT,
      section       TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_briefing_topics_user_date ON briefing_topics (user_id, briefing_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_briefing_topics_key ON briefing_topics (user_id, topic_key)`);
}

// ── K-108 tables ─────────────────────────────────────────────────────────────
async function createK108Tables() {
  await query(`
    CREATE TABLE IF NOT EXISTS k108_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(20) NOT NULL UNIQUE,
      passcode_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS k108_activity_log (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      action_type TEXT NOT NULL,
      detail JSONB DEFAULT '{}',
      ip TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_k108_log_created ON k108_activity_log (created_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS k108_sms (
      id SERIAL PRIMARY KEY,
      direction TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      username TEXT,
      textbelt_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_k108_sms_phone ON k108_sms (phone)`);
  await query(`
    CREATE TABLE IF NOT EXISTS k108_vault (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size BIGINT,
      transferred_by TEXT NOT NULL,
      transferred_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS k108_profiles (
      id SERIAL PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      aliases TEXT[] DEFAULT '{}',
      photo_url TEXT,
      relation TEXT,
      notes TEXT,
      phones JSONB DEFAULT '[]',
      emails JSONB DEFAULT '[]',
      social_links JSONB DEFAULT '[]',
      age TEXT,
      birthday DATE,
      address JSONB DEFAULT '{}',
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migration: add new columns if missing
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS age TEXT`);
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS birthday DATE`);
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS address JSONB DEFAULT '{}'`);
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS middle_name TEXT`);
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS vehicle JSONB DEFAULT '{}'`);
  // Migration: normalize SMS phone numbers (strip leading country code 1)
  await query(`UPDATE k108_sms SET phone = substring(phone from 2) WHERE length(phone) = 11 AND phone LIKE '1%'`);
  // Migration: convert phones/emails from TEXT[] to JSONB for labels support
  try {
    const colCheck = await query(`SELECT data_type, udt_name FROM information_schema.columns WHERE table_name='k108_profiles' AND column_name='phones'`);
    const phoneDataType = (colCheck.rows[0]?.data_type || '').toLowerCase();
    const phoneUdtName = (colCheck.rows[0]?.udt_name || '').toLowerCase();
    if (phoneDataType === 'array' || phoneUdtName === '_text') {
      await query(`ALTER TABLE k108_profiles ALTER COLUMN phones TYPE JSONB USING array_to_json(phones)::jsonb`);
      await query(`ALTER TABLE k108_profiles ALTER COLUMN phones SET DEFAULT '[]'::jsonb`);
      await query(`ALTER TABLE k108_profiles ALTER COLUMN emails TYPE JSONB USING array_to_json(emails)::jsonb`);
      await query(`ALTER TABLE k108_profiles ALTER COLUMN emails SET DEFAULT '[]'::jsonb`);
      console.log('[K108] Migrated phones/emails TEXT[] → JSONB');
    }
  } catch(e) { console.log('[K108] phones/emails migration:', e.message); }
  await query(`
    CREATE TABLE IF NOT EXISTS k108_profile_files (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size BIGINT,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS k108_profile_relations (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      related_profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      label TEXT
    )
  `);

  // ── Surveillance (legacy column kept for compat) ──
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS surveillance_active BOOLEAN DEFAULT FALSE`);

  // ── Employer info + Classified data columns ──
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS employer_info JSONB DEFAULT '{}'`);
  await query(`ALTER TABLE k108_profiles ADD COLUMN IF NOT EXISTS classified_data JSONB DEFAULT '[]'`);

  // ── Profile Activity Log (per-profile audit trail) ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_profile_activity_log (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      action VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_k108_profile_activity ON k108_profile_activity_log (profile_id, created_at DESC)`);

  // ── Classified files table ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_classified_files (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size BIGINT,
      uploaded_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Case Management tables ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_cases (
      id SERIAL PRIMARY KEY,
      case_id VARCHAR(50) UNIQUE,
      name VARCHAR(200) NOT NULL,
      target_name VARCHAR(200) DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      classification VARCHAR(30) NOT NULL DEFAULT 'unclassified',
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      summary TEXT DEFAULT '',
      created_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migrations for legacy k108_cases
  await query(`ALTER TABLE k108_cases ADD COLUMN IF NOT EXISTS case_id VARCHAR(50)`);
  await query(`ALTER TABLE k108_cases ADD COLUMN IF NOT EXISTS target_name VARCHAR(200) DEFAULT ''`);
  await query(`ALTER TABLE k108_cases ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`);
  await query(`ALTER TABLE k108_cases ADD COLUMN IF NOT EXISTS created_by VARCHAR(50)`);
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS k108_cases_case_id_uniq ON k108_cases (case_id) WHERE case_id IS NOT NULL`); } catch(e) {}
  // Normalize legacy status values
  await query(`UPDATE k108_cases SET status = LOWER(status) WHERE status IN ('OPEN','CLOSED')`);
  await query(`UPDATE k108_cases SET classification = LOWER(classification) WHERE classification IN ('UNCLASSIFIED','CONFIDENTIAL','CLASSIFIED')`);

  await query(`
    CREATE TABLE IF NOT EXISTS k108_case_timeline (
      id SERIAL PRIMARY KEY,
      case_id INT REFERENCES k108_cases(id) ON DELETE CASCADE,
      entry_type VARCHAR(50) NOT NULL DEFAULT 'note',
      title VARCHAR(200) DEFAULT '',
      body TEXT DEFAULT '',
      created_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE k108_case_timeline ADD COLUMN IF NOT EXISTS entry_type VARCHAR(50) DEFAULT 'note'`);
  await query(`ALTER TABLE k108_case_timeline ADD COLUMN IF NOT EXISTS title VARCHAR(200) DEFAULT ''`);
  await query(`ALTER TABLE k108_case_timeline ADD COLUMN IF NOT EXISTS body TEXT DEFAULT ''`);
  await query(`ALTER TABLE k108_case_timeline ADD COLUMN IF NOT EXISTS created_by VARCHAR(50)`);
  // Migration: drop legacy 'description' column (replaced by title + body)
  try {
    const descCol = await query(`SELECT column_name FROM information_schema.columns WHERE table_name='k108_case_timeline' AND column_name='description'`);
    if (descCol.rows.length > 0) {
      // Copy any existing description data into body before dropping
      await query(`UPDATE k108_case_timeline SET body = description WHERE (body IS NULL OR body = '') AND description IS NOT NULL AND description != ''`);
      await query(`ALTER TABLE k108_case_timeline DROP COLUMN description`);
      console.log('[K108] Migrated k108_case_timeline: dropped legacy description column');
    }
  } catch(e) { console.log('[K108] timeline description migration:', e.message); }

  await query(`
    CREATE TABLE IF NOT EXISTS k108_case_evidence (
      id SERIAL PRIMARY KEY,
      case_id INT REFERENCES k108_cases(id) ON DELETE CASCADE,
      filename VARCHAR(500),
      original_name VARCHAR(500),
      file_size BIGINT DEFAULT 0,
      uploaded_by VARCHAR(50),
      uploaded_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE k108_case_evidence ADD COLUMN IF NOT EXISTS filename VARCHAR(500)`);
  await query(`ALTER TABLE k108_case_evidence ADD COLUMN IF NOT EXISTS original_name VARCHAR(500)`);
  await query(`ALTER TABLE k108_case_evidence ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0`);
  await query(`ALTER TABLE k108_case_evidence ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(50)`);
  await query(`ALTER TABLE k108_case_evidence ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT NOW()`);

  await query(`
    CREATE TABLE IF NOT EXISTS k108_case_entities (
      id SERIAL PRIMARY KEY,
      case_id INT REFERENCES k108_cases(id) ON DELETE CASCADE,
      entity_type VARCHAR(30) NOT NULL,
      name VARCHAR(200) NOT NULL,
      detail TEXT DEFAULT '',
      source VARCHAR(50),
      added_by VARCHAR(50),
      added_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE k108_case_entities ADD COLUMN IF NOT EXISTS profile_id INT`);

  await query(`
    CREATE TABLE IF NOT EXISTS k108_case_notes (
      id SERIAL PRIMARY KEY,
      case_id INT REFERENCES k108_cases(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Drop unused legacy case sub-tables (they were never wired to any UI)
  try { await query(`DROP TABLE IF EXISTS k108_case_canvas_edges`); } catch(e) {}
  try { await query(`DROP TABLE IF EXISTS k108_case_canvas_nodes`); } catch(e) {}
  try { await query(`DROP TABLE IF EXISTS k108_case_findings`); } catch(e) {}
  try { await query(`DROP TABLE IF EXISTS k108_case_questions`); } catch(e) {}
  try { await query(`DROP TABLE IF EXISTS k108_case_subjects`); } catch(e) {}

  // Backfill case_id for any existing rows missing one
  const missing = await query(`SELECT id, created_at FROM k108_cases WHERE case_id IS NULL ORDER BY id ASC`);
  for (const row of missing.rows) {
    const d = new Date(row.created_at || Date.now());
    const ymd = d.getFullYear().toString() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    const cnt = await query(`SELECT COUNT(*)::int AS c FROM k108_cases WHERE case_id LIKE $1`, ['K108-' + ymd + '-%']);
    const seq = String((cnt.rows[0].c || 0) + 1).padStart(3, '0');
    await query(`UPDATE k108_cases SET case_id = $1 WHERE id = $2`, ['K108-' + ymd + '-' + seq, row.id]);
  }

  // Seed a few fake cases if the table is empty (local/testing convenience)
  const existing = await query(`SELECT COUNT(*)::int AS c FROM k108_cases`);
  if ((existing.rows[0].c || 0) === 0) {
    const today = new Date();
    const ymd = today.getFullYear().toString() + String(today.getMonth()+1).padStart(2,'0') + String(today.getDate()).padStart(2,'0');
    const seeds = [
      { name: 'Operation Nightshade', target: 'Marcus Voss', status: 'open', classification: 'classified', priority: 'high', summary: 'Suspected asset exfiltration via shell companies in Luxembourg. Surveillance ongoing.', by: 'kaliph' },
      { name: 'Cascade Incident', target: 'Elena Petrov', status: 'open', classification: 'confidential', priority: 'medium', summary: 'Anomalous wire transfers flagged by mailbox scanner. Subject under passive watch.', by: 'kathrine' },
      { name: 'Harborlight Inquiry', target: 'Daniel Reyes', status: 'open', classification: 'unclassified', priority: 'low', summary: 'Background verification requested by external counsel. No red flags yet.', by: 'kaliph' },
      { name: 'Violet Drift', target: 'Unknown Subject', status: 'closed', classification: 'confidential', priority: 'medium', summary: 'Trail cold. Closed pending new intel.', by: 'kathrine' },
    ];
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const cid = 'K108-' + ymd + '-' + String(i + 1).padStart(3, '0');
      const ins = await query(
        `INSERT INTO k108_cases (case_id, name, target_name, status, classification, priority, summary, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [cid, s.name, s.target, s.status, s.classification, s.priority, s.summary, s.by]
      );
      const newId = ins.rows[0].id;
      await query(
        `INSERT INTO k108_case_timeline (case_id, entry_type, title, body, created_by) VALUES ($1,'created','Case opened',$2,$3)`,
        [newId, 'Case "' + s.name + '" created with target ' + s.target + '.', s.by]
      );
    }
    console.log('[K108] Seeded ' + seeds.length + ' demo cases');
  }

  // ── Surveillance jobs ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_surveillance_jobs (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      profile_payload JSONB DEFAULT '{}',
      finding_count INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    )
  `);

  // ── Surveillance results ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_surveillance_results (
      id SERIAL PRIMARY KEY,
      job_id INT REFERENCES k108_surveillance_jobs(id) ON DELETE CASCADE,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      headline TEXT,
      source_url TEXT,
      source_name TEXT,
      summary TEXT,
      confidence TEXT DEFAULT 'unverified',
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migration: add columns if upgrading from old schema
  try { await query(`ALTER TABLE k108_surveillance_results ADD COLUMN IF NOT EXISTS job_id INT`); } catch(e) {}
  try { await query(`ALTER TABLE k108_surveillance_results ADD COLUMN IF NOT EXISTS source_name TEXT`); } catch(e) {}
  try { await query(`ALTER TABLE k108_surveillance_results ADD COLUMN IF NOT EXISTS confidence TEXT DEFAULT 'unverified'`); } catch(e) {}
  try { await query(`ALTER TABLE k108_surveillance_results ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT FALSE`); } catch(e) {}

  // ── Surveillance Queue (external Cowork integration) ──
  await query(`
    CREATE TABLE IF NOT EXISTS surveillance_queue (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      name VARCHAR(255),
      requested_by VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Surveillance Results ──
  await query(`
    CREATE TABLE IF NOT EXISTS surveillance_results (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES k108_profiles(id) ON DELETE CASCADE,
      queue_id INT,
      name VARCHAR(255),
      requested_by VARCHAR(50),
      report TEXT,
      searched_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Surveillance Approvals ──
  await query(`
    CREATE TABLE IF NOT EXISTS surveillance_approvals (
      id SERIAL PRIMARY KEY,
      queue_id INT,
      name VARCHAR(255),
      requested_by VARCHAR(50),
      approved BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── K-108 Briefings ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_briefings (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── K-108 Oracle session memory ──
  await query(`
    CREATE TABLE IF NOT EXISTS k108_oracle_memory (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      summary TEXT DEFAULT '',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// Convert a DB row to the camelCase message object shape the frontend expects
function rowToMsg(row) {
  return {
    id:            row.id,
    sender:        row.sender,
    type:          row.type,
    text:          row.content,
    files:         row.files || [],
    priority:      row.priority,
    replyTo:       row.reply_to,
    timestamp:     Number(row.timestamp),
    edited:        row.edited,
    editedAt:      row.edited_at != null ? Number(row.edited_at) : null,
    reactions:     row.reactions || {},
    read:          row.is_read,
    readAt:        row.read_at != null ? Number(row.read_at) : null,
    unsendable:    row.unsendable,
    formatting:    row.formatting || null,
    aiGenerated:   row.ai_generated,
    pinned:        row.pinned,
    pinnedBy:      row.pinned_by || null,
    pinnedAt:      row.pinned_at != null ? Number(row.pinned_at) : null,
    systemMessage: row.system_message,
    pinnedMsgId:   row.pinned_msg_id || null,
    callType:      row.call_type || null,
    callStatus:    row.call_status || null,
    callPeer:      row.call_peer || null,
  };
}

// Insert a message object. ON CONFLICT DO NOTHING makes it safe to call for migration.
async function insertMessage(msg) {
  await query(`
    INSERT INTO messages (
      id, sender, type, content, files, priority, reply_to,
      timestamp, edited, edited_at, reactions, is_read, read_at,
      unsendable, formatting, ai_generated, pinned, pinned_by, pinned_at,
      system_message, pinned_msg_id, call_type, call_status, call_peer
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19,
      $20, $21, $22, $23, $24
    ) ON CONFLICT (id) DO NOTHING
  `, [
    msg.id,
    msg.sender,
    msg.type || 'text',
    msg.text || '',
    JSON.stringify(msg.files || []),
    msg.priority || false,
    msg.replyTo || null,
    msg.timestamp,
    msg.edited || false,
    msg.editedAt || null,
    JSON.stringify(msg.reactions || {}),
    msg.read || false,
    msg.readAt || null,
    msg.unsendable || false,
    msg.formatting ? JSON.stringify(msg.formatting) : null,
    msg.aiGenerated || false,
    msg.pinned || false,
    msg.pinnedBy || null,
    msg.pinnedAt || null,
    msg.systemMessage || false,
    msg.pinnedMsgId || null,
    msg.callType || null,
    msg.callStatus || null,
    msg.callPeer || null,
  ]);
}

// Fetch messages. Results always returned in chronological order (oldest → newest).
// opts: { limit, before, after, search, sender }
async function getMessages(opts = {}) {
  const { limit = 50, before = null, after = null, search = null, sender = null } = opts;
  const conditions = [];
  const params = [];

  if (before) {
    params.push(before);
    conditions.push(`timestamp < $${params.length}`);
  }
  if (after) {
    params.push(after);
    conditions.push(`timestamp > $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`content ILIKE $${params.length}`);
  }
  if (sender) {
    params.push(sender);
    conditions.push(`sender = $${params.length}`);
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  // For search/after: return oldest-first. For before/default: fetch newest then reverse.
  const desc = !search && !after;
  const order = desc ? ' ORDER BY timestamp DESC' : ' ORDER BY timestamp ASC';

  params.push(limit);
  const sql = `SELECT * FROM messages${where}${order} LIMIT $${params.length}`;

  const result = await query(sql, params);
  const rows = result.rows;
  if (desc) rows.reverse(); // flip to chronological
  return rows.map(rowToMsg);
}

// Fetch messages centered around a timestamp (half before, half after)
async function getMessagesAround(timestamp, half = 25) {
  const before = await query(
    'SELECT * FROM messages WHERE timestamp <= $1 ORDER BY timestamp DESC LIMIT $2',
    [timestamp, half]
  );
  const after = await query(
    'SELECT * FROM messages WHERE timestamp > $1 ORDER BY timestamp ASC LIMIT $2',
    [timestamp, half]
  );
  const rows = [...before.rows.reverse(), ...after.rows];
  return rows.map(rowToMsg);
}

// Fetch a single message by id
async function getMessageById(id) {
  const result = await query('SELECT * FROM messages WHERE id = $1', [id]);
  if (!result.rows.length) return null;
  return rowToMsg(result.rows[0]);
}

// Update arbitrary fields on a message. Fields is a plain object of JS-side keys.
// Supported keys: text, edited, editedAt, reactions, read, readAt, unsendable,
//                 pinned, pinnedBy, pinnedAt
async function updateMessage(id, fields) {
  const colMap = {
    text:      'content',
    edited:    'edited',
    editedAt:  'edited_at',
    reactions: 'reactions',
    read:      'is_read',
    readAt:    'read_at',
    unsendable:'unsendable',
    pinned:    'pinned',
    pinnedBy:  'pinned_by',
    pinnedAt:  'pinned_at',
  };

  const sets = [];
  const params = [];

  for (const [jsKey, col] of Object.entries(colMap)) {
    if (!(jsKey in fields)) continue;
    let val = fields[jsKey];
    if (jsKey === 'reactions' && val !== null && typeof val === 'object') {
      val = JSON.stringify(val);
    }
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }

  if (!sets.length) return;
  params.push(id);
  await query(`UPDATE messages SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
}

// Delete a message row by id
async function deleteMessage(id) {
  await query('DELETE FROM messages WHERE id = $1', [id]);
}

// Return all pinned messages in the order they were pinned
async function getPinnedMessages() {
  const result = await query(
    'SELECT * FROM messages WHERE pinned = true ORDER BY pinned_at ASC'
  );
  return result.rows.map(rowToMsg);
}

// Delete all messages (used by backdoor clear / replace import)
async function clearMessages() {
  await query('DELETE FROM messages');
}

module.exports = {
  pool, query, read, write, createSchema, createBriefingsTable, createK108Tables, rowToMsg,
  insertMessage, getMessages, getMessagesAround, getMessageById, updateMessage,
  deleteMessage, getPinnedMessages, clearMessages,
};
