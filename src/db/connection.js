/**
 * AuditPilot — PostgreSQL connection pool
 * Provides a single shared pool and a reusable query() helper.
 * Uses DATABASE_URL from environment variables (set by Railway automatically).
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway PostgreSQL requires SSL in production; allow self-signed certs
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

// Verify the connection at startup so misconfiguration fails fast
pool.connect((err, client, release) => {
  if (err) {
    console.error('[DB] Failed to connect to PostgreSQL:', err.message);
    return;
  }
  client.query('SELECT NOW()', (queryErr, result) => {
    release();
    if (queryErr) {
      console.error('[DB] Test query failed:', queryErr.message);
    } else {
      console.log('[DB] PostgreSQL connected —', result.rows[0].now);
    }
  });
});

/**
 * Runs a parameterised SQL query against the shared pool.
 *
 * @param {string}  text    SQL query string with $1, $2 … placeholders
 * @param {Array}   [params] Query parameters (optional)
 * @returns {Promise<import('pg').QueryResult>}
 *
 * @example
 * const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    // Log slow queries (>200 ms) to aid debugging without polluting normal logs
    if (duration > 200) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.slice(0, 120));
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nQuery:', text.slice(0, 200));
    throw err;
  }
}

module.exports = { query, pool };
