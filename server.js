/**
 * AuditPilot — Express server
 * Orchestrates scanning and report generation; serves the static frontend.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { scanWebsite } = require('./scanner');
const { generateReport } = require('./report');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Ensure storage directories exist ─────────────────────────────────────────
['reports', 'screenshots'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ── POST /scan ────────────────────────────────────────────────────────────────
app.post('/scan', async (req, res) => {
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

  console.log(`[AuditPilot] Scan started → ${normalizedUrl}`);

  try {
    // Step 1: Scan the page with Playwright + axe-core
    const scanResults = await scanWebsite(normalizedUrl);
    console.log(`[AuditPilot] Scan complete — score: ${scanResults.score}, issues: ${scanResults.totalIssues}`);

    // Step 2: Generate the PDF report with Puppeteer
    const pdfPath = await generateReport(normalizedUrl, scanResults);
    console.log(`[AuditPilot] PDF ready → ${path.basename(pdfPath)}`);

    // Step 3: Stream the PDF back to the client
    const filename = path.basename(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Expose score metadata so the frontend can show a summary without parsing the PDF
    res.setHeader('X-Audit-Score', JSON.stringify({
      score: scanResults.score,
      total: scanResults.totalIssues,
      critical: scanResults.counts.critical,
      serious: scanResults.counts.serious,
      moderate: scanResults.counts.moderate,
      minor: scanResults.counts.minor
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
    console.error('[AuditPilot] Scan error:', error.message);

    // Map known error patterns to friendly messages
    if (/timeout/i.test(error.message)) {
      return res.status(408).json({
        error: 'The website took too long to load (30 s limit). Please try again.'
      });
    }
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_NAME_RESOLUTION/i.test(error.message)) {
      return res.status(502).json({
        error: 'Could not reach the website. Please check the URL and try again.'
      });
    }
    if (/ERR_CERT|SSL|certificate/i.test(error.message)) {
      return res.status(502).json({
        error: 'The website has an SSL/certificate issue that prevented scanning.'
      });
    }
    if (/PDF generation failed/i.test(error.message)) {
      return res.status(500).json({
        error: 'Report generation failed. Please try again.'
      });
    }

    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ██████  AuditPilot running at http://localhost:${PORT}\n`);
});
