/**
 * AuditPilot — Frontend
 * Handles scan submission, animated loading steps, error display, and PDF download.
 */

(function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────────────
  const urlInput        = document.getElementById('url-input');
  const scanBtn         = document.getElementById('scan-btn');
  const errorBox        = document.getElementById('error-box');
  const stateForm       = document.getElementById('state-form');
  const stateLoad       = document.getElementById('state-loading');
  const stateSucc       = document.getElementById('state-success');
  const loadingMsg      = document.getElementById('loading-msg');
  const downloadLnk     = document.getElementById('download-link');
  const resetBtn        = document.getElementById('reset-btn');
  const scoreStrip      = document.getElementById('score-strip');
  const emailGate       = document.getElementById('email-gate');
  const leadEmailInput  = document.getElementById('lead-email');
  const leadBtn         = document.getElementById('lead-btn');
  const leadError       = document.getElementById('lead-error');
  const leadConsent     = document.getElementById('lead-consent');
  const leadThanks      = document.getElementById('lead-thanks');
  const issueTeaserEl   = document.getElementById('issues-teaser');
  const downloadSection = document.getElementById('download-section');

  const progressSteps = [
    document.getElementById('ps-1'),
    document.getElementById('ps-2'),
    document.getElementById('ps-3'),
    document.getElementById('ps-4')
  ];

  const stepMessages = [
    'Launching browser and loading page…',
    'Running axe-core accessibility scan…',
    'Capturing full-page screenshot…',
    'Generating professional PDF report…'
  ];

  let stepTimer       = null;
  let currentBlobUrl  = null;
  let lastScannedUrl  = '';
  let lastScoreData   = null;
  let isAuthenticated = false;

  // ── Validation ──────────────────────────────────────────────────────────────

  function normalizeUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
  }

  function isValidUrl(url) {
    try { new URL(url); return true; }
    catch { return false; }
  }

  // ── Error display ───────────────────────────────────────────────────────────

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    scanBtn.disabled = false;
    urlInput.setAttribute('aria-invalid', 'true');
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
    urlInput.removeAttribute('aria-invalid');
  }

  // ── State transitions ───────────────────────────────────────────────────────

  function goLoading() {
    clearError();
    stateForm.hidden  = true;
    stateSucc.hidden  = true;
    stateLoad.hidden  = false;

    // Reset step indicators
    progressSteps.forEach(s => {
      s.classList.remove('active', 'done');
      s.querySelector('.p-dot').className = 'p-dot';
    });

    let current = 0;

    function activateStep(i) {
      if (i > 0) {
        progressSteps[i - 1].classList.remove('active');
        progressSteps[i - 1].classList.add('done');
        progressSteps[i - 1].querySelector('.p-dot').className = 'p-dot';
        progressSteps[i - 1].querySelector('.p-dot').style.background = '#4ade80';
      }
      if (i < progressSteps.length) {
        progressSteps[i].classList.add('active');
        progressSteps[i].querySelector('.p-dot').className = 'p-dot';
        loadingMsg.textContent = stepMessages[i];
      }
    }

    activateStep(0);
    stepTimer = setInterval(() => {
      current++;
      if (current < progressSteps.length) activateStep(current);
    }, 6000);
  }

  // ── One-time download handler (Bug 3) ───────────────────────────────────────

  function handleDownloadClick() {
    setTimeout(() => {
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
      }
      downloadSection.hidden = true;
      leadThanks.hidden      = false;
      leadThanks.innerHTML   =
        '<p style="color:#4ade80;font-size:15px;font-weight:600;">Report downloaded ✓</p>';
    }, 500); // small delay so browser has time to initiate the download
  }

  function goSuccess(blob, filename, scoreData) {
    clearInterval(stepTimer);

    // Mark all steps complete
    progressSteps.forEach(s => {
      s.classList.remove('active');
      s.classList.add('done');
      const dot = s.querySelector('.p-dot');
      dot.className = 'p-dot';
      dot.style.background = '#4ade80';
    });

    // Build score strip
    scoreStrip.innerHTML = '';
    if (scoreData) {
      const items = [
        { value: scoreData.score,    label: 'Score'    },
        { value: scoreData.total,    label: 'Issues'   },
        { value: scoreData.critical, label: 'Critical', color: '#fca5a5' },
        { value: scoreData.serious,  label: 'Serious',  color: '#fdba74' }
      ];
      scoreStrip.innerHTML = items.map(item => `
        <div class="strip-item">
          <strong ${item.color ? `style="color:${item.color}"` : ''}>${item.value}</strong>
          <span>${item.label}</span>
        </div>`).join('');
    }

    // Store blob and score for the lead-submit step
    lastScoreData = scoreData;
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);

    downloadLnk.href     = currentBlobUrl;
    downloadLnk.download = filename;

    stateLoad.hidden = true;
    stateSucc.hidden = false;

    // ── Bug 1: skip email gate for logged-in users ───────────────────────────
    if (isAuthenticated) {
      issueTeaserEl.innerHTML = '';
      emailGate.hidden        = true;
      leadThanks.hidden       = true;
      downloadSection.hidden  = false;
      downloadLnk.removeEventListener('click', handleDownloadClick);
      downloadLnk.addEventListener('click', handleDownloadClick, { once: true });
      return;
    }

    // ── Anonymous: show teaser + email gate ──────────────────────────────────
    issueTeaserEl.innerHTML = '';
    if (scoreData) {
      const bullets = [];
      if (scoreData.critical > 0)
        bullets.push(`<strong style="color:#fca5a5">${scoreData.critical}</strong> critical issue${scoreData.critical !== 1 ? 's' : ''} blocking screen reader access`);
      if (scoreData.serious > 0)
        bullets.push(`<strong style="color:#fdba74">${scoreData.serious}</strong> serious WCAG 2.1 AA violation${scoreData.serious !== 1 ? 's' : ''}`);
      if (scoreData.moderate > 0)
        bullets.push(`<strong style="color:#fde68a">${scoreData.moderate}</strong> moderate accessibility issue${scoreData.moderate !== 1 ? 's' : ''}`);
      if (bullets.length === 0 && scoreData.total > 0)
        bullets.push(`<strong style="color:#fdba74">${scoreData.total}</strong> accessibility issue${scoreData.total !== 1 ? 's' : ''} detected`);
      if (bullets.length === 0)
        bullets.push('No critical issues detected — full report includes details');
      bullets.push('Full report includes code-level fixes &amp; legal statement');
      issueTeaserEl.innerHTML = bullets.slice(0, 3).map(b =>
        `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;">
          <span style="color:#C9A84C;flex-shrink:0;margin-top:1px;">•</span>
          <span style="color:rgba(255,255,255,0.65);font-size:13px;line-height:1.5;">${b}</span>
        </div>`
      ).join('');
    }

    emailGate.hidden       = false;
    leadThanks.hidden      = true;
    downloadSection.hidden = true;
    leadEmailInput.value   = '';
    leadConsent.checked    = false;
    leadError.hidden       = true;
    leadError.textContent  = '';
    leadBtn.disabled       = false;
    leadBtn.textContent    = 'Email me the full report →';

    leadEmailInput.focus();
  }

  function goForm() {
    clearInterval(stepTimer);
    clearError();
    stateSucc.hidden = true;
    stateLoad.hidden = true;
    stateForm.hidden = false;
    // Reset lead-capture state for the next scan
    issueTeaserEl.innerHTML = '';
    emailGate.hidden        = false;
    leadThanks.hidden       = true;
    leadThanks.innerHTML    =
      '<p style="color:#4ade80;font-size:15px;font-weight:600;margin-bottom:4px;">Thanks! Your report is ready.</p>' +
      '<p style="color:rgba(255,255,255,0.65);font-size:12px;">Click below to download your PDF.</p>';
    downloadSection.hidden  = true;
    downloadLnk.removeEventListener('click', handleDownloadClick);
    leadEmailInput.value    = '';
    leadConsent.checked     = false;
    leadError.hidden        = true;
    leadError.textContent   = '';
    leadBtn.disabled        = false;
    leadBtn.textContent     = 'Email me the full report →';
    urlInput.value = '';
    scanBtn.disabled = false;
    urlInput.focus();
  }

  // ── Browser fingerprint ──────────────────────────────────────────────────────

  async function getBrowserFingerprint() {
    const signals = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform || 'unknown'
    ];
    const raw         = signals.join('|');
    const encoder     = new TextEncoder();
    const hashBuffer  = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
    const hashArray   = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }

  function getOrCreateLocalId() {
    let localId = localStorage.getItem('ap_uid');
    if (!localId) {
      localId = 'ls_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('ap_uid', localId);
    }
    return localId;
  }

  // ── Registration prompt modal ─────────────────────────────────────────────────

  function showRegistrationPrompt() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; font-family: Arial, sans-serif;
    `;
    modal.innerHTML = `
      <div style="
        background: #0D2352;
        border: 1px solid rgba(201,168,76,0.35);
        border-radius: 16px; padding: 40px;
        max-width: 460px; width: 90%;
        text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
        <h2 style="color:#fff; font-size:22px; font-weight:700; margin-bottom:12px;">
          You have used your free scan!
        </h2>
        <p style="color:rgba(255,255,255,0.6); font-size:14px; line-height:1.7; margin-bottom:28px;">
          Create a free account to get
          <strong style="color:#C9A84C;">3 scans every month</strong>
          — plus save your reports and track compliance over time.
        </p>
        <a href="/login" style="
          display: block; background: #C9A84C; color: #fff;
          font-size: 15px; font-weight: 700;
          padding: 15px 24px; border-radius: 8px;
          text-decoration: none; margin-bottom: 14px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        ">
          Create free account → 3 scans/month
        </a>
        <button onclick="this.closest('.ap-modal').remove()" style="
          background: none; border: none;
          color: rgba(255,255,255,0.65);
          font-size: 13px; cursor: pointer; padding: 8px;
        ">
          No thanks
        </button>
      </div>`;
    modal.classList.add('ap-modal');
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  // ── Upgrade prompt modal ──────────────────────────────────────────────────────

  function showUpgradePrompt(currentPlan, upgradeUrl) {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; font-family: Arial, sans-serif;
    `;
    modal.innerHTML = `
      <div style="
        background: #0D2352;
        border: 1px solid rgba(201,168,76,0.35);
        border-radius: 16px; padding: 40px;
        max-width: 460px; width: 90%;
        text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
        <h2 style="color:#fff; font-size:22px; font-weight:700; margin-bottom:12px;">
          Monthly scan limit reached
        </h2>
        <p style="color:rgba(255,255,255,0.6); font-size:14px; line-height:1.7; margin-bottom:28px;">
          You've used all your scans on the
          <strong style="color:#C9A84C;">${currentPlan}</strong> plan.
          Upgrade to Agency for unlimited scans.
        </p>
        <a href="${upgradeUrl}" style="
          display: block; background: #C9A84C; color: #fff;
          font-size: 15px; font-weight: 700;
          padding: 15px 24px; border-radius: 8px;
          text-decoration: none; margin-bottom: 14px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        ">
          Upgrade to Agency — €299/month
        </a>
        <button onclick="this.closest('.ap-modal').remove()" style="
          background: none; border: none;
          color: rgba(255,255,255,0.65);
          font-size: 13px; cursor: pointer; padding: 8px;
        ">
          Maybe later
        </button>
      </div>`;
    modal.classList.add('ap-modal');
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  // ── Scan limit error ─────────────────────────────────────────────────────────

  function showLimitError(used, limit, plan) {
    const planLabel = plan && plan !== 'anonymous' ? ` on the <strong>${plan}</strong> plan` : '';
    const limitNote = limit === 1 && plan === 'anonymous'
      ? 'Anonymous users can run 1 free scan per day.'
      : `You've used all ${used} scan${used !== 1 ? 's' : ''} this month${planLabel}.`;

    errorBox.innerHTML =
      `<strong>Scan limit reached</strong><br>${limitNote}<br>` +
      `<a href="/pricing.html" style="color:#C9A84C;font-weight:700;display:inline-block;margin-top:6px;">` +
      `Upgrade for more scans →</a>`;
    errorBox.hidden = false;
  }

  // ── Scan ────────────────────────────────────────────────────────────────────

  async function startScan() {
    clearError();

    const normalized = normalizeUrl(urlInput.value);

    if (!normalized) {
      showError('Please enter a URL before generating a report.');
      return;
    }
    if (!isValidUrl(normalized)) {
      showError('Please enter a valid URL — for example: https://example.com');
      return;
    }

    lastScannedUrl   = normalized;
    scanBtn.disabled = true;
    goLoading();

    try {
      const fingerprint = await getBrowserFingerprint();
      const localId     = getOrCreateLocalId();

      const response = await fetch('/scan', {
        method:      'POST',
        headers:     {
          'Content-Type': 'application/json',
          'x-browser-fp': fingerprint,
          'x-local-id':   localId
        },
        credentials: 'include',
        body:        JSON.stringify({ url: normalized })
      });

      if (!response.ok) {
        let data = null;
        try { data = await response.json(); } catch { /* body not JSON */ }

        // All 403s go to modals — never to inline error text
        if (response.status === 403) {
          clearInterval(stepTimer);
          stateLoad.hidden = true;
          stateForm.hidden = false;
          scanBtn.disabled = false;
          if (data?.error === 'scan_limit_reached') {
            showUpgradePrompt(data.plan || 'free', data.upgradeUrl || '/pricing');
          } else {
            // anonymous_limit_reached or any other 403
            showRegistrationPrompt();
          }
          return;
        }

        throw new Error(data?.error || 'The scan failed. Please try again.');
      }

      // Parse score metadata from the response header
      let scoreData = null;
      const scoreHeader = response.headers.get('X-Audit-Score');
      if (scoreHeader) {
        try { scoreData = JSON.parse(scoreHeader); } catch { /* ignore */ }
      }

      // Determine the download filename from Content-Disposition
      let filename = 'auditpilot-report.pdf';
      const cd = response.headers.get('Content-Disposition');
      if (cd) {
        const m = cd.match(/filename="([^"]+)"/);
        if (m) filename = m[1];
      }

      const blob = await response.blob();
      goSuccess(blob, filename, scoreData);

    } catch (err) {
      clearInterval(stepTimer);
      stateLoad.hidden = true;
      stateForm.hidden = false;
      scanBtn.disabled = false;
      showError(err.message || 'An unexpected error occurred. Please try again.');
    }
  }

  // ── Lead email submit ────────────────────────────────────────────────────────

  async function submitLeadEmail() {
    const email = leadEmailInput.value.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      leadError.textContent = 'Please enter a valid email address.';
      leadError.hidden = false;
      leadEmailInput.focus();
      return;
    }

    leadError.hidden    = true;
    leadBtn.disabled    = true;
    leadBtn.textContent = 'Sending…';

    const marketingConsent = leadConsent ? leadConsent.checked : false;

    try {
      await fetch('/api/lead', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({
          email,
          url:               lastScannedUrl,
          score:             lastScoreData,
          marketingConsent,
          source:            'free_scanner'
        })
      });
    } catch { /* non-fatal — never block the download */ }

    // Show thanks + reveal download button (no auto-click — user decides)
    emailGate.hidden       = true;
    leadThanks.hidden      = false;
    downloadSection.hidden = false;

    // Bug 3: one-time listener so blob is revoked after first download click
    downloadLnk.removeEventListener('click', handleDownloadClick);
    downloadLnk.addEventListener('click', handleDownloadClick, { once: true });
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  scanBtn.addEventListener('click', startScan);

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan();
  });

  urlInput.addEventListener('input', () => {
    if (!errorBox.hidden) clearError();
  });

  leadBtn.addEventListener('click', submitLeadEmail);
  leadEmailInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitLeadEmail(); });

  resetBtn.addEventListener('click', goForm);

  // ── Auth state check (Bug 1) — runs once on page load ────────────────────
  (async function checkAuthState() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (r.ok) isAuthenticated = true;
    } catch { /* offline or unauthenticated — leave false */ }
  })();

})();
