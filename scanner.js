/**
 * AuditPilot — Scanner v1.1
 * Launches Playwright, runs axe-core, captures element + full-page screenshots,
 * and returns structured results including EAA readiness score and scan metadata.
 */

const { chromium } = require('playwright-core');
const { AxeBuilder } = require('@axe-core/playwright');
const path = require('path');

// ── Accessibility score ────────────────────────────────────────────────────────

const A11Y_WEIGHTS = { critical: 10, serious: 5, moderate: 2, minor: 1 };

function calculateAccessibilityScore(violations) {
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    if (v.impact in counts) counts[v.impact]++;
  }
  const score = Math.max(0, 100 - (
    counts.critical * A11Y_WEIGHTS.critical +
    counts.serious  * A11Y_WEIGHTS.serious  +
    counts.moderate * A11Y_WEIGHTS.moderate +
    counts.minor    * A11Y_WEIGHTS.minor
  ));
  return { score, counts };
}

// ── EAA Readiness score ────────────────────────────────────────────────────────
// Weighted more aggressively than the a11y score to reflect legal barrier severity.

const EAA_WEIGHTS = { critical: 15, serious: 8, moderate: 3, minor: 1 };

function calculateEaaScore(counts) {
  const score = Math.max(0, 100 - (
    counts.critical * EAA_WEIGHTS.critical +
    counts.serious  * EAA_WEIGHTS.serious  +
    counts.moderate * EAA_WEIGHTS.moderate +
    counts.minor    * EAA_WEIGHTS.minor
  ));
  const risk = score >= 90 ? 'Low Risk'
             : score >= 70 ? 'Medium Risk'
             : score >= 50 ? 'High Risk'
             :               'Critical Risk';
  return { score, risk };
}

// ── Violation grouping ─────────────────────────────────────────────────────────

function groupBySeverity(violations) {
  const groups = { critical: [], serious: [], moderate: [], minor: [] };
  for (const v of violations) {
    const impact = v.impact || 'minor';
    if (!(impact in groups)) continue;
    groups[impact].push({
      id:          v.id,
      impact:      v.impact,
      description: v.description,
      help:        v.help,
      helpUrl:     v.helpUrl,
      nodes:       v.nodes.map(n => ({
        html:           n.html,
        failureSummary: n.failureSummary,
        target:         n.target
      }))
    });
  }
  return groups;
}

// ── Element screenshots ────────────────────────────────────────────────────────

/**
 * Extracts a usable CSS selector from an axe-core node target.
 * axe returns an array of selector chains (to support frame contexts).
 * We take the last segment of the first chain for simple pages.
 */
function extractSelector(target) {
  if (!target || !target.length) return null;
  const chain = target[0];
  return Array.isArray(chain) ? chain[chain.length - 1] : chain;
}

/**
 * Screenshots the first affected element of each violation.
 * Capped at MAX_SHOTS violations; failures are skipped silently.
 */
async function captureElementScreenshots(page, violations, screenshotsDir) {
  const MAX_SHOTS = 20;
  const screenshots = {};

  for (const violation of violations.slice(0, MAX_SHOTS)) {
    if (!violation.nodes.length) continue;
    const selector = extractSelector(violation.nodes[0].target);
    if (!selector) continue;

    try {
      const locator = page.locator(selector).first();
      if (await locator.count() === 0) continue;

      await locator.scrollIntoViewIfNeeded({ timeout: 3000 });

      const filename = `elem-${violation.id}-${Date.now()}.png`;
      const filepath = path.join(screenshotsDir, filename);
      await locator.screenshot({ path: filepath, timeout: 5000 });

      screenshots[violation.id] = filepath;
    } catch {
      // Element not visible, in shadow DOM, or selector too complex — skip
    }
  }

  return screenshots;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Scans a URL for accessibility issues.
 *
 * @param {string} url  Fully-qualified URL to scan.
 * @returns {Promise<ScanResult>}
 */
async function scanWebsite(url) {
  let browser = null;
  const startTime = Date.now();

  try {
    console.log('[SCAN] Starting scan for:', url);
    console.log('[SCAN] Launching browser...');
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
        require('playwright-core').executablePath('chromium'),
      headless: true,
      timeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });
    console.log('[SCAN] Browser launched successfully');

    const context = await browser.newContext({
      viewport:  { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);

    // ── Axe-core scan ──────────────────────────────────────────────────────────
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();

    const screenshotsDir = path.join(__dirname, 'screenshots');

    // ── Element screenshots (per violation, while page is still open) ──────────
    const elementScreenshots = await captureElementScreenshots(
      page, axeResults.violations, screenshotsDir
    );

    // ── Full-page screenshot ───────────────────────────────────────────────────
    const screenshotPath = path.join(screenshotsDir, `audit-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await browser.close();
    browser = null;

    // ── Build return value ─────────────────────────────────────────────────────
    const { score, counts }    = calculateAccessibilityScore(axeResults.violations);
    const { score: eaaScore, risk: eaaRisk } = calculateEaaScore(counts);
    const groupedViolations    = groupBySeverity(axeResults.violations);
    const duration             = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      screenshotPath,
      elementScreenshots,
      violations:        axeResults.violations,
      groupedViolations,
      score,
      counts,
      eaaScore,
      eaaRisk,
      totalIssues:  axeResults.violations.length,
      passes:       axeResults.passes.length,
      incomplete:   axeResults.incomplete.length,
      duration,
      pagesScanned: 1
    };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}

module.exports = { scanWebsite };
