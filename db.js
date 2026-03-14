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
}

module.exports = { pool, query, read, write, createSchema };
