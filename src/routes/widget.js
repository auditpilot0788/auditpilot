const express    = require('express');
const crypto     = require('crypto');
const { query }  = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { scanWebsite } = require('../../scanner');

const router = express.Router();

const SCAN_LIMIT_PER_DAY = 50;

function generateWidgetKey() {
  return 'wk_' + crypto.randomBytes(16).toString('hex');
}

function buildEmbedSnippet(widgetKey) {
  return `<div id="auditpilot-widget"\n     data-widget-key="${widgetKey}"\n     data-primary-color="#C9A84C"\n     data-label="Free Accessibility Check"\n     data-cta-url="https://getauditpilot.de">\n</div>\n<script src="https://getauditpilot.de/embed/widget.js"></script>`;
}

// ── GET /api/widget/key ───────────────────────────────────────────────────────
// Returns (or auto-generates) the agency's widget key.
router.get('/key', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT plan, status, widget_key
         FROM subscriptions WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [req.user.sub]
    );
    const row = result.rows[0];
    if (!row || row.plan !== 'agency') {
      return res.status(403).json({ error: 'Agency plan required.' });
    }

    let widgetKey = row.widget_key;
    if (!widgetKey) {
      widgetKey = generateWidgetKey();
      await query(
        `UPDATE subscriptions SET widget_key = $1 WHERE user_id = $2`,
        [widgetKey, req.user.sub]
      );
    }

    return res.json({ widgetKey, embedSnippet: buildEmbedSnippet(widgetKey) });
  } catch (err) {
    console.error('[widget] GET /key error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch widget key.' });
  }
});

// ── POST /api/widget/key/regenerate ──────────────────────────────────────────
// Replaces the widget key; old key is immediately invalidated.
router.post('/key/regenerate', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT plan FROM subscriptions WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [req.user.sub]
    );
    if (result.rows[0]?.plan !== 'agency') {
      return res.status(403).json({ error: 'Agency plan required.' });
    }

    const widgetKey = generateWidgetKey();
    await query(
      `UPDATE subscriptions SET widget_key = $1 WHERE user_id = $2`,
      [widgetKey, req.user.sub]
    );

    return res.json({ widgetKey, embedSnippet: buildEmbedSnippet(widgetKey) });
  } catch (err) {
    console.error('[widget] POST /key/regenerate error:', err.message);
    return res.status(500).json({ error: 'Failed to regenerate widget key.' });
  }
});

// ── POST /api/widget/scan ─────────────────────────────────────────────────────
// Public endpoint — authenticated by widget_key, not by user session.
// Called cross-origin from agency websites embedding the widget.
router.post('/scan', async (req, res) => {
  try {
    const { url, widget_key } = req.body;

    // Validate inputs
    if (!widget_key || typeof widget_key !== 'string' || !widget_key.trim()) {
      return res.status(400).json({ error: 'widget_key is required.' });
    }
    if (!url || typeof url !== 'string' || url.length > 2000) {
      return res.status(400).json({ error: 'A valid URL is required (max 2000 chars).' });
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }

    // Validate widget_key belongs to an active agency subscription
    const subResult = await query(
      `SELECT user_id FROM subscriptions
         WHERE widget_key = $1 AND status = 'active' AND plan = 'agency'
         LIMIT 1`,
      [widget_key.trim()]
    );
    if (!subResult.rows.length) {
      return res.status(401).json({ error: 'Invalid or inactive widget key.' });
    }

    // Rate limit: max 50 scans per calendar day (UTC) per widget_key
    const usageResult = await query(
      `SELECT COUNT(*)::int AS cnt FROM widget_scan_usage
         WHERE widget_key = $1 AND scanned_at >= CURRENT_DATE`,
      [widget_key.trim()]
    );
    if (usageResult.rows[0].cnt >= SCAN_LIMIT_PER_DAY) {
      return res.status(429).json({ error: 'Daily scan limit reached. Try again tomorrow.' });
    }

    // Run the scan
    const scanResults = await scanWebsite(url);

    // Record usage (fire-and-forget — don't block response on this)
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || null;
    query(
      `INSERT INTO widget_scan_usage (widget_key, scanned_url, ip_address)
         VALUES ($1, $2, $3::inet)`,
      [widget_key.trim(), url, ip]
    ).catch(e => console.error('[widget] usage insert error:', e.message));

    // Build sanitized response — top 3 issues sorted by severity
    const SEVERITY_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const allViolations = scanResults.violations || [];
    const topIssues = allViolations
      .slice()
      .sort((a, b) => (SEVERITY_ORDER[a.impact] ?? 9) - (SEVERITY_ORDER[b.impact] ?? 9))
      .slice(0, 3)
      .map(v => ({
        impact:      v.impact,
        description: v.description,
        helpUrl:     v.helpUrl
      }));

    return res.json({
      totalIssues: scanResults.totalIssues,
      counts:      scanResults.counts,
      eaaRisk:     scanResults.eaaRisk,
      topIssues
    });
  } catch (err) {
    console.error('[widget] POST /scan error:', err.message);
    return res.status(500).json({ error: 'Scan failed. Please try again.' });
  }
});

module.exports = router;
