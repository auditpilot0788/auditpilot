const { query } = require('../db/connection');

const ANON_LIMIT = 1;

async function checkAnonLimit(anonId, ipAddress, fingerprint) {
  const result = await query(`
    SELECT COUNT(*) AS count
    FROM anonymous_scans
    WHERE (
      anon_id = $1
      OR ip_address = $2
      OR (browser_fingerprint = $3 AND browser_fingerprint != 'unknown')
    )
    AND scanned_at > NOW() - INTERVAL '30 days'
  `, [anonId, ipAddress, fingerprint]);

  const scansUsed = parseInt(result.rows[0].count, 10);
  return {
    allowed: scansUsed < ANON_LIMIT,
    scansUsed,
    limit: ANON_LIMIT
  };
}

async function recordAnonScan(anonId, ipAddress, fingerprint, url) {
  const monthYear = new Date().toISOString().slice(0, 7);
  await query(`
    INSERT INTO anonymous_scans
      (anon_id, ip_address, browser_fingerprint, scanned_url, month_year)
    VALUES ($1, $2, $3, $4, $5)
  `, [anonId, ipAddress, fingerprint, url, monthYear]);
}

module.exports = { checkAnonLimit, recordAnonScan };
