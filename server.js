/**
 * AuditPilot — Express server
 * Orchestrates scanning and report generation; serves the static frontend.
 */

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');

const { scanWebsite }  = require('./scanner');
const { generateReport } = require('./report');
const authRouter       = require('./src/routes/auth');
const billingRouter    = require('./src/routes/billing');
const leadRouter       = require('./src/routes/lead');
const brandingRouter   = require('./src/routes/branding');
const { requireAuth, optionalAuth } = require('./src/middleware/auth');
const { canUserScan, recordScan }                = require('./src/lib/scanLimits');
const { getAnonId }                              = require('./src/middleware/anonymousTracker');
const { checkAnonLimit, recordAnonScan }         = require('./src/lib/anonLimits');
const { query } = require('./src/db/connection');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));

// Stripe requires the raw request body to verify webhook signatures.
// This MUST be registered before express.json() so the stream is not consumed first.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRouter);
app.use('/api/billing', billingRouter);
app.use('/api',         leadRouter);
app.use('/api',         brandingRouter);

// ── Static page routes (extensionless URLs) ───────────────────────────────────
app.get('/pricing',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));
app.get('/login',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/agencies',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'agencies.html')));
app.get('/impressum', (req, res) => res.sendFile(path.join(__dirname, 'public', 'impressum.html')));
app.get('/privacy',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// ── Ensure storage directories exist ─────────────────────────────────────────
['reports', 'screenshots'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ── Preview download tokens (in-memory, 30-min TTL) ──────────────────────────
const pendingDownloads = new Map();
function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [t, e] of pendingDownloads) {
    if (now > e.expiresAt) pendingDownloads.delete(t);
  }
}

// ── POST /api/scan/preview ────────────────────────────────────────────────────
// Homepage anonymous flow: runs full scan, returns JSON preview + stores PDF
// with a short-lived token. Token-based download avoids sending PDF as blob.
app.post('/api/scan/preview', optionalAuth, async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'A URL is required.' });
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl;
  try { new URL(normalizedUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL format.' });
  }

  const ipAddress   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const fingerprint = req.headers['x-browser-fp'] || 'unknown';
  let   anonId      = null;

  if (req.user) {
    try {
      const { allowed, used, limit, plan } = await canUserScan(req.user.sub);
      if (!allowed) {
        return res.status(403).json({ error: 'scan_limit_reached', used, limit, plan, upgradeUrl: '/pricing' });
      }
    } catch (dbErr) {
      console.error('[preview] DB limit check — allowing scan:', dbErr.message);
    }
  } else {
    try {
      anonId = getAnonId(req, res);
      const anonCheck = await checkAnonLimit(anonId, ipAddress, fingerprint);
      if (!anonCheck.allowed) {
        return res.status(403).json({
          error:       'anonymous_limit_reached',
          message:     'You have used your free scan.',
          scansUsed:   anonCheck.scansUsed,
          limit:       anonCheck.limit,
          action:      'register',
          registerUrl: '/login',
          benefit:     'Create a free account to get 3 scans per month'
        });
      }
    } catch (dbErr) {
      console.error('[preview] Anon limit check — allowing scan:', dbErr.message);
    }
  }

  try {
    const scanResults = await scanWebsite(normalizedUrl);
    const pdfPath     = await generateReport(normalizedUrl, scanResults, null);
    const filename    = path.basename(pdfPath);

    if (req.user) {
      try { await recordScan(req.user.sub, normalizedUrl, filename); } catch (e) { console.error('[preview] recordScan:', e.message); }
    } else {
      try { await recordAnonScan(anonId, ipAddress, fingerprint, normalizedUrl); } catch (e) { console.error('[preview] recordAnonScan:', e.message); }
    }

    cleanupExpiredTokens();
    const token = crypto.randomBytes(16).toString('hex');
    pendingDownloads.set(token, { pdfPath, filename, expiresAt: Date.now() + 30 * 60 * 1000 });

    // Slim violation list — only what the frontend preview needs
    const violations = [];
    for (const sev of ['critical', 'serious', 'moderate', 'minor']) {
      for (const v of (scanResults.groupedViolations[sev] || [])) {
        violations.push({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length });
      }
    }

    return res.json({
      token,
      filename,
      score:        scanResults.score,
      eaaScore:     scanResults.eaaScore,
      eaaRisk:      scanResults.eaaRisk,
      counts:       scanResults.counts,
      totalIssues:  scanResults.totalIssues,
      pagesScanned: scanResults.pagesScanned,
      duration:     scanResults.duration,
      violations
    });

  } catch (error) {
    console.error('[preview] Scan error:', error.message);
    if (/timeout/i.test(error.message))
      return res.status(408).json({ error: 'The website took too long to load. Please try again.' });
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED/i.test(error.message))
      return res.status(502).json({ error: 'Could not reach the website. Please check the URL.' });
    if (/ERR_CERT|SSL|certificate/i.test(error.message))
      return res.status(502).json({ error: 'The website has an SSL issue that prevented scanning.' });
    return res.status(500).json({ error: 'Scan failed. Please try again.' });
  }
});

// ── POST /scan ────────────────────────────────────────────────────────────────
// optionalAuth populates req.user when a valid JWT is present; null otherwise.
app.post('/scan', optionalAuth, async (req, res) => {
  const { url } = req.body;

  // Validate presence
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'A URL is required.' });
  }

  // Normalise — prepend https:// if scheme is missing
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  // Validate structure
  try {
    new URL(normalizedUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format. Please enter a valid website URL.' });
  }

  // ── Scan limit check ────────────────────────────────────────────────────────
  const ipAddress   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const fingerprint = req.headers['x-browser-fp'] || 'unknown';
  let   anonId      = null;

  if (req.user) {
    // Authenticated — enforce monthly plan limit (skip if DB is unavailable)
    try {
      const { allowed, used, limit, plan } = await canUserScan(req.user.sub);
      if (!allowed) {
        return res.status(403).json({
          error:      'scan_limit_reached',
          used,
          limit,
          plan,
          upgradeUrl: '/pricing'
        });
      }
    } catch (dbErr) {
      console.error('[AuditPilot] DB error during user limit check — allowing scan:', dbErr.message);
    }
  } else {
    // Anonymous — enforce 1 scan per 30 days by cookie + IP + fingerprint
    // If DB is unavailable, allow the scan to proceed
    try {
      anonId = getAnonId(req, res);
      const anonCheck = await checkAnonLimit(anonId, ipAddress, fingerprint);
      if (!anonCheck.allowed) {
        return res.status(403).json({
          error:       'anonymous_limit_reached',
          message:     'You have used your free scan.',
          scansUsed:   anonCheck.scansUsed,
          limit:       anonCheck.limit,
          action:      'register',
          registerUrl: '/login',
          benefit:     'Create a free account to get 3 scans per month'
        });
      }
    } catch (dbErr) {
      console.error('[AuditPilot] DB error during anon limit check — allowing scan:', dbErr.message);
    }
  }

  console.log(`[AuditPilot] Scan started → ${normalizedUrl}`);

  try {
    // Step 1: Scan the page with Playwright + axe-core
    const scanResults = await scanWebsite(normalizedUrl);
    console.log(`[AuditPilot] Scan complete — score: ${scanResults.score}, issues: ${scanResults.totalIssues}`);

    // Step 2: Fetch agency branding (agency plan users only)
    let agencyBranding = null;
    if (req.user) {
      const brandingRow = await query(
        `SELECT agency_name, agency_tagline, agency_logo_b64, agency_logo_mime, plan
           FROM subscriptions WHERE user_id = $1 AND status = 'active'
           ORDER BY created_at DESC LIMIT 1`,
        [req.user.sub]
      ).catch(() => ({ rows: [] }));
      const b = brandingRow.rows[0];
      if (b?.plan === 'agency' && b?.agency_name) {
        agencyBranding = {
          name:     b.agency_name,
          tagline:  b.agency_tagline || '',
          logoB64:  b.agency_logo_b64  || null,
          logoMime: b.agency_logo_mime || null
        };
      }
    }

    // Step 2b: Generate the PDF report
    const pdfPath = await generateReport(normalizedUrl, scanResults, agencyBranding);
    console.log(`[AuditPilot] PDF ready → ${path.basename(pdfPath)}`);

    // Step 3: Record usage — awaited before streaming so the DB write
    // completes while the request context is still alive on Railway.
    if (req.user) {
      try {
        await recordScan(req.user.sub, normalizedUrl, path.basename(pdfPath));
      } catch (err) {
        console.error('[AuditPilot] Failed to record scan usage:', err.message);
      }
    } else {
      try {
        await recordAnonScan(anonId, ipAddress, fingerprint, normalizedUrl);
      } catch (err) {
        console.error('[AuditPilot] Failed to record anonymous scan:', err.message);
      }
    }

    // Step 4: Stream the PDF back to the client
    const filename = path.basename(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Audit-Score', JSON.stringify({
      score:    scanResults.score,
      total:    scanResults.totalIssues,
      critical: scanResults.counts.critical,
      serious:  scanResults.counts.serious,
      moderate: scanResults.counts.moderate,
      minor:    scanResults.counts.minor
    }));

    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

    fileStream.on('error', err => {
      console.error('[AuditPilot] Error streaming PDF:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to send the report file.' });
      }
    });

  } catch (error) {
    console.error('[SCAN FAILED] Error name:', error.name);
    console.error('[SCAN FAILED] Error message:', error.message);
    console.error('[SCAN FAILED] Stack:', error.stack);

    if (/timeout/i.test(error.message)) {
      return res.status(408).json({ error: 'The website took too long to load (30 s limit). Please try again.' });
    }
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_NAME_RESOLUTION/i.test(error.message)) {
      return res.status(502).json({ error: 'Could not reach the website. Please check the URL and try again.' });
    }
    if (/ERR_CERT|SSL|certificate/i.test(error.message)) {
      return res.status(502).json({ error: 'The website has an SSL/certificate issue that prevented scanning.' });
    }
    if (/PDF generation failed/i.test(error.message)) {
      return res.status(500).json({ error: 'Report generation failed. Please try again.' });
    }

    res.status(500).json({
      error:   'scan_failed',
      message: error.message,
      details: error.stack
    });
  }
});

// ── GET /api/usage ────────────────────────────────────────────────────────────
app.get('/api/usage', requireAuth, async (req, res) => {
  try {
    const { allowed, used, limit, plan } = await canUserScan(req.user.sub);

    const subResult = await query(
      `SELECT plan AS sub_plan, current_period_end FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      [req.user.sub]
    );

    // For free plans, current_period_end is +100 years (never-expires sentinel).
    // Show the 1st of next calendar month instead — that's when scan counts reset.
    // For paid plans, show the actual Stripe billing renewal date.
    const now = new Date();
    const nextCalendarMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    const periodEnd = plan === 'free'
      ? nextCalendarMonthStart
      : (subResult.rows[0]?.current_period_end ?? nextCalendarMonthStart);

    return res.json({
      plan,
      scansUsed:  used,
      scansLimit: limit === Infinity ? 999999 : limit,
      periodEnd,
      canScan:    allowed
    });
  } catch (err) {
    console.error('[usage] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch usage data.' });
  }
});

// ── GET /api/scans/history ────────────────────────────────────────────────────
app.get('/api/scans/history', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, scanned_url, scanned_at, report_filename
         FROM scan_usage
        WHERE user_id = $1
        ORDER BY scanned_at DESC
        LIMIT 10`,
      [req.user.sub]
    );

    // Annotate each row with whether the PDF file still exists on disk
    const scans = result.rows.map(row => ({
      id:              row.id,
      scannedUrl:      row.scanned_url,
      scannedAt:       row.scanned_at,
      reportFilename:  row.report_filename,
      reportAvailable: row.report_filename
        ? fs.existsSync(path.join(__dirname, 'reports', row.report_filename))
        : false
    }));

    return res.json({ scans });
  } catch (err) {
    console.error('[history] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch scan history.' });
  }
});

// ── GET /reports/:filename — authenticated PDF download ───────────────────────
app.get('/reports/:filename', requireAuth, (req, res) => {
  // path.basename prevents directory-traversal attacks (e.g. ../../etc/passwd)
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, 'reports', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Report not found or has been removed.' });
  }
  res.download(filePath);
});

// ── GET /api/scan/pdf/:token — serve preview PDF by short-lived token ─────────
app.get('/api/scan/pdf/:token', (req, res) => {
  const entry = pendingDownloads.get(req.params.token);
  if (!entry || Date.now() > entry.expiresAt) {
    return res.status(410).json({ error: 'Download link has expired. Please scan again.' });
  }
  if (!fs.existsSync(entry.pdfPath)) {
    return res.status(404).json({ error: 'Report file not found.' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
  fs.createReadStream(entry.pdfPath).pipe(res);
});

// ── GET /api/scan/pdf/:token/view — inline PDF preview, no download prompt ────
// Same token as the download route; Content-Disposition: inline so browser
// renders the PDF rather than saving it.
app.get('/api/scan/pdf/:token/view', (req, res) => {
  const entry = pendingDownloads.get(req.params.token);
  if (!entry || Date.now() > entry.expiresAt) {
    return res.status(410).type('html').send(
      '<!doctype html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0A1F44;color:rgba(255,255,255,0.55);">' +
      '<p>Preview expired — please run a new scan.</p></body>'
    );
  }
  if (!fs.existsSync(entry.pdfPath)) {
    return res.status(404).type('html').send(
      '<!doctype html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0A1F44;color:rgba(255,255,255,0.55);">' +
      '<p>Report file not found.</p></body>'
    );
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${entry.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(entry.pdfPath).pipe(res);
});

// ── DEBUG: find Chromium path inside Docker container ─────────────────────────
app.get('/debug-browser', async (req, res) => {
  const { execSync } = require('child_process');
  try {
    const results = {};

    try {
      results.which_chromium = execSync('which chromium || which chromium-browser || which google-chrome || echo "not found"').toString().trim();
    } catch(e) { results.which_chromium = e.message; }

    try {
      results.find_chrome = execSync('find /ms-playwright -name "chrome*" -type f 2>/dev/null | head -5').toString().trim();
    } catch(e) { results.find_chrome = e.message; }

    try {
      results.find_chromium = execSync('find / -name "chromium*" -type f 2>/dev/null | head -5').toString().trim();
    } catch(e) { results.find_chromium = e.message; }

    try {
      results.playwright_path = require('playwright-core').executablePath('chromium');
    } catch(e) { results.playwright_path = e.message; }

    try {
      results.ls_ms_playwright = execSync('ls /ms-playwright/ 2>/dev/null || echo "directory not found"').toString().trim();
    } catch(e) { results.ls_ms_playwright = e.message; }

    res.json(results);
  } catch(e) {
    res.json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ██████  AuditPilot running at http://localhost:${PORT}\n`);
});
