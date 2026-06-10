/**
 * AuditPilot — Database Migration Runner
 * Reads schema.sql and applies it to the connected PostgreSQL database.
 * Safe to run multiple times — all DDL statements use IF NOT EXISTS.
 *
 * Usage:
 *   npm run db:migrate
 *   node src/db/migrate.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[migrate] ERROR: DATABASE_URL is not set. Add it to your .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.error('[migrate] schema.sql not found at', schemaPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[migrate] Connecting to PostgreSQL…');
  const client = await pool.connect();

  try {
    console.log('[migrate] Running schema.sql…');
    await client.query(sql);
    console.log('[migrate] ✓ Migration complete — all tables are up to date.');
  } catch (err) {
    console.error('[migrate] ✗ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
