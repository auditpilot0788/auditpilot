const express       = require('express');
const { query }     = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function stripHtml(str) {
  return String(str).replace(/<[^>]*>/g, '').trim();
}

// GET /api/branding — return current agency settings (no logo data)
router.get('/branding', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT plan, agency_name, agency_tagline, agency_logo_b64
         FROM subscriptions WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [req.user.sub]
    );
    const row = result.rows[0];
    return res.json({
      plan:          row?.plan || 'free',
      agencyName:    row?.agency_name    || '',
      agencyTagline: row?.agency_tagline || '',
      hasLogo:       !!(row?.agency_logo_b64)
    });
  } catch (err) {
    console.error('[branding] GET error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch branding.' });
  }
});

// POST /api/branding — save agency branding (agency plan only)
router.post('/branding', requireAuth, async (req, res) => {
  try {
    // Plan check
    const subResult = await query(
      `SELECT plan FROM subscriptions WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [req.user.sub]
    );
    if (subResult.rows[0]?.plan !== 'agency') {
      return res.status(403).json({ error: 'agency_plan_required' });
    }

    const { agencyName, agencyTagline, logoBase64, logoMime } = req.body;

    // Validate name
    if (!agencyName || !agencyName.trim()) {
      return res.status(400).json({ error: 'Agency name is required.' });
    }
    const cleanName    = stripHtml(agencyName).slice(0, 100);
    const cleanTagline = agencyTagline ? stripHtml(agencyTagline).slice(0, 150) : null;

    // Validate logo if provided
    let cleanLogoB64  = null;
    let cleanLogoMime = null;
    if (logoBase64) {
      if (!['image/png', 'image/jpeg'].includes(logoMime)) {
        return res.status(400).json({ error: 'Logo must be PNG or JPEG.' });
      }
      // Strip data-URI prefix if frontend included it
      const b64 = logoBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (buf.byteLength > 500 * 1024) {
        return res.status(400).json({ error: 'Logo must be under 500KB.' });
      }
      cleanLogoB64  = b64;
      cleanLogoMime = logoMime;
    }

    await query(
      `UPDATE subscriptions
          SET agency_name = $1, agency_tagline = $2,
              agency_logo_b64 = COALESCE($3, agency_logo_b64),
              agency_logo_mime = COALESCE($4, agency_logo_mime)
        WHERE user_id = $5`,
      [cleanName, cleanTagline, cleanLogoB64, cleanLogoMime, req.user.sub]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('[branding] POST error:', err.message);
    return res.status(500).json({ error: 'Failed to save branding.' });
  }
});

// DELETE /api/branding/logo — remove logo only
router.delete('/branding/logo', requireAuth, async (req, res) => {
  try {
    await query(
      `UPDATE subscriptions SET agency_logo_b64 = NULL, agency_logo_mime = NULL
        WHERE user_id = $1`,
      [req.user.sub]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[branding] DELETE logo error:', err.message);
    return res.status(500).json({ error: 'Failed to remove logo.' });
  }
});

module.exports = router;
