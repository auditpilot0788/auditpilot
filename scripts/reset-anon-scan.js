#!/usr/bin/env node
/**
 * Dev-only script: inspect or delete rows from anonymous_scans.
 * Requires DATABASE_URL in .env (or environment).
 *
 * Usage:
 *   node scripts/reset-anon-scan.js                     show last 20 records
 *   node scripts/reset-anon-scan.js --all               delete ALL anon records
 *   node scripts/reset-anon-scan.js --anon-id <value>   delete by cookie value
 *   node scripts/reset-anon-scan.js --fingerprint <val> delete by browser fingerprint
 *   node scripts/reset-anon-scan.js --ip <value>        delete by IP address
 *
 * The anon_id value is stored in the ap_anon_id cookie — find it in
 * DevTools → Application → Cookies → ap_anon_id.
 * The fingerprint is shown by GET /api/admin/anon-record (see server.js).
 */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Check your .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function main() {
  const anonId      = arg('--anon-id');
  const fingerprint = arg('--fingerprint');
  const ip          = arg('--ip');
  const all         = process.argv.includes('--all');

  const client = await pool.connect();
  try {
    if (!anonId && !fingerprint && !ip && !all) {
      // ── List mode ──────────────────────────────────────────────────────────
      const { rows } = await client.query(`
        SELECT id, anon_id, ip_address,
               LEFT(browser_fingerprint, 20) AS fingerprint_prefix,
               scanned_url, scanned_at
          FROM anonymous_scans
         ORDER BY scanned_at DESC
         LIMIT 20
      `);
      if (rows.length === 0) {
        console.log('No anonymous scan records found.');
      } else {
        console.log(`Last ${rows.length} anonymous scan records:\n`);
        console.table(rows);
      }
      console.log('\nTo delete, pass one of:');
      console.log('  --anon-id <value>       (cookie ap_anon_id value)');
      console.log('  --fingerprint <value>   (browser_fingerprint column value)');
      console.log('  --ip <value>            (ip_address column value)');
      console.log('  --all                   (delete every row — full reset)');
      return;
    }

    let result;

    if (all) {
      result = await client.query(
        'DELETE FROM anonymous_scans RETURNING id, anon_id, scanned_url, scanned_at'
      );
      console.log(`Deleted ALL ${result.rowCount} anonymous scan record(s).`);
    } else if (anonId) {
      result = await client.query(
        'DELETE FROM anonymous_scans WHERE anon_id = $1 RETURNING id, anon_id, scanned_url, scanned_at',
        [anonId]
      );
      console.log(`Deleted ${result.rowCount} record(s) with anon_id = "${anonId}"`);
    } else if (fingerprint) {
      result = await client.query(
        'DELETE FROM anonymous_scans WHERE browser_fingerprint = $1 RETURNING id, anon_id, scanned_url, scanned_at',
        [fingerprint]
      );
      console.log(`Deleted ${result.rowCount} record(s) with fingerprint = "${fingerprint}"`);
    } else if (ip) {
      result = await client.query(
        'DELETE FROM anonymous_scans WHERE ip_address = $1 RETURNING id, anon_id, scanned_url, scanned_at',
        [ip]
      );
      console.log(`Deleted ${result.rowCount} record(s) with ip = "${ip}"`);
    }

    if (result?.rows?.length) {
      console.table(result.rows);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
