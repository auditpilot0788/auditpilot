const express = require('express');
const { query } = require('../db/connection');

const router   = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/lead — capture email + consent after anonymous scan
router.post('/lead', async (req, res) => {
  const { email, url, score, marketingConsent, source } = req.body;

  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const cleanEmail  = String(email).trim().toLowerCase();
  const consent     = marketingConsent === true || marketingConsent === 'true';
  const src         = source || 'free_scanner';
  const anonId      = req.cookies?.ap_anon_id || null;
  const ipAddress   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const fingerprint = req.headers['x-browser-fp'] || 'unknown';
  const monthYear   = new Date().toISOString().slice(0, 7);

  try {
    const updated = await query(`
      UPDATE anonymous_scans
         SET email             = $1,
             source            = $2,
             marketing_consent = $3,
             lead_captured_at  = NOW()
       WHERE id = (
         SELECT id FROM anonymous_scans
          WHERE (
            anon_id = $4
            OR ip_address = $5
            OR (browser_fingerprint = $6 AND browser_fingerprint != 'unknown')
          )
          ORDER BY scanned_at DESC
          LIMIT 1
       )
    `, [cleanEmail, src, consent, anonId, ipAddress, fingerprint]);

    if (updated.rowCount === 0) {
      await query(`
        INSERT INTO anonymous_scans
          (anon_id, ip_address, browser_fingerprint, scanned_url,
           month_year, email, source, marketing_consent, lead_captured_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `, [anonId, ipAddress, fingerprint, url || null,
          monthYear, cleanEmail, src, consent]);
    }
  } catch (err) {
    console.error('[lead] DB error (non-fatal):', err.message);
  }

  return res.json({ success: true });
});

module.exports = router;
