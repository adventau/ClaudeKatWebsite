'use strict';
const { Pool } = require('pg');

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
  pool, query, read, write, createSchema, rowToMsg,
  insertMessage, getMessages, getMessagesAround, getMessageById, updateMessage,
  deleteMessage, getPinnedMessages, clearMessages,
};
