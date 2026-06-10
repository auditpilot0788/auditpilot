/**
 * AuditPilot — Scan Limit Enforcement
 * Handles per-plan monthly limits for authenticated users and a daily
 * in-memory limit for anonymous (unauthenticated) visitors.
 */

const { query } = require('../db/connection');

// ── Plan limits ───────────────────────────────────────────────────────────────

const PLAN_LIMITS = {
  free:    3,
  starter: 20,
  agency:  Infinity
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthYear() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

// ── Authenticated user functions ──────────────────────────────────────────────

/**
 * Counts how many scans the user has run in the current calendar month.
 * @param {string} userId  UUID from users table
 * @returns {Promise<number>}
 */
async function getScansUsedThisMonth(userId) {
  const result = await query(
    `SELECT COUNT(*) AS count
       FROM scan_usage
      WHERE user_id = $1 AND month_year = $2`,
    [userId, currentMonthYear()]
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Checks whether a user is allowed to run another scan.
 * @param {string} userId
 * @returns {Promise<{ allowed: boolean, used: number, limit: number, plan: string }>}
 */
async function canUserScan(userId) {
  const subResult = await query(
    `SELECT plan FROM subscriptions
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  const plan  = subResult.rows[0]?.plan || 'free';
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const used  = await getScansUsedThisMonth(userId);

  return {
    allowed: limit === Infinity || used < limit,
    used,
    limit,
    plan
  };
}

/**
 * Records a completed scan in the scan_usage table.
 * Call this only after a scan succeeds — not before.
 * @param {string}      userId
 * @param {string}      url             The scanned URL
 * @param {string|null} reportFilename  Basename of the generated PDF (optional)
 */
async function recordScan(userId, url, reportFilename = null) {
  await query(
    `INSERT INTO scan_usage (user_id, scanned_url, month_year, report_filename)
     VALUES ($1, $2, $3, $4)`,
    [userId, url, currentMonthYear(), reportFilename]
  );
}

// ── Anonymous (IP-based) rate limiter ─────────────────────────────────────────
// Stored in-memory: resets on server restart.
// Anonymous users are limited to 1 scan per 24-hour rolling window per IP.

const ANON_LIMIT    = 1;
const ANON_WINDOW   = 24 * 60 * 60 * 1000; // 24 h in ms
const anonScanStore = new Map();             // ip → [timestamp, ...]

/**
 * Returns true if this IP is below its anonymous scan limit.
 * Cleans up expired entries before checking.
 * @param {string} ip
 * @returns {boolean}
 */
function checkAnonymousLimit(ip) {
  const now       = Date.now();
  const threshold = now - ANON_WINDOW;

  const recent = (anonScanStore.get(ip) || []).filter(t => t > threshold);
  anonScanStore.set(ip, recent);

  return recent.length < ANON_LIMIT;
}

/**
 * Records an anonymous scan for the given IP.
 * @param {string} ip
 */
function recordAnonymousScan(ip) {
  const existing = anonScanStore.get(ip) || [];
  anonScanStore.set(ip, [...existing, Date.now()]);
}

module.exports = {
  PLAN_LIMITS,
  getScansUsedThisMonth,
  canUserScan,
  recordScan,
  checkAnonymousLimit,
  recordAnonymousScan
};
