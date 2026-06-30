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
  const previewPanel    = document.getElementById('preview-panel');
  const previewScoresEl = document.getElementById('preview-scores');
  const previewViolEl   = document.getElementById('preview-violations');
  const previewTotalEl  = document.getElementById('preview-total');
  const signupUpsell    = document.getElementById('signup-upsell');
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

  let stepTimer            = null;
  let currentBlobUrl       = null;
  let currentDownloadToken = null;
  let lastScannedUrl       = '';
  let lastScoreData        = null;
  let isAuthenticated      = false;

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

  // Authenticated-user success: blob PDF + direct download, no email gate.
  function goSuccess(blob, filename, scoreData) {
    clearInterval(stepTimer);

    progressSteps.forEach(s => {
      s.classList.remove('active');
      s.classList.add('done');
      const dot = s.querySelector('.p-dot');
      dot.className        = 'p-dot';
      dot.style.background = '#4ade80';
    });

    if (previewPanel)  previewPanel.hidden  = true;
    if (signupUpsell)  signupUpsell.hidden  = true;
    scoreStrip.hidden = false;

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

    lastScoreData = scoreData;
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);

    downloadLnk.href     = currentBlobUrl;
    downloadLnk.download = filename;

    emailGate.hidden       = true;
    leadThanks.hidden      = true;
    downloadSection.hidden = false;
    downloadLnk.removeEventListener('click', handleDownloadClick);
    downloadLnk.addEventListener('click', handleDownloadClick, { once: true });

    stateLoad.hidden = true;
    stateSucc.hidden = false;
  }

  function goForm() {
    clearInterval(stepTimer);
    clearError();
    stateSucc.hidden = true;
    stateLoad.hidden = true;
    stateForm.hidden = false;
    currentDownloadToken = null;
    if (previewPanel) previewPanel.hidden = true;
    if (signupUpsell) signupUpsell.hidden = true;
    scoreStrip.hidden       = true;
    emailGate.hidden        = false;
    leadThanks.hidden       = true;
    leadThanks.innerHTML    = '<p style="color:#4ade80;font-size:15px;font-weight:600;margin-bottom:4px;">✓ Your report is ready.</p>';
    downloadSection.hidden  = true;
    downloadLnk.removeEventListener('click', handleDownloadClick);
    leadEmailInput.value    = '';
    leadConsent.checked     = false;
    leadError.hidden        = true;
    leadError.textContent   = '';
    leadBtn.disabled        = false;
    leadBtn.textContent     = 'Download PDF →';
    urlInput.value = '';
    scanBtn.disabled = false;
    urlInput.focus();
  }

  // ── Anonymous success flow ───────────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderPreview(data) {
    const aScore = data.score;
    const aColor = aScore >= 80 ? '#4ade80' : aScore >= 60 ? '#fbbf24' : '#f87171';
    const eColor = data.eaaRisk === 'Low Risk'    ? '#4ade80'
                 : data.eaaRisk === 'Medium Risk'  ? '#fbbf24' : '#f87171';

    previewScoresEl.innerHTML = `
      <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:16px 18px;">
        <div style="font-size:30px;font-weight:800;color:${aColor};line-height:1;">${aScore}<span style="font-size:13px;color:rgba(255,255,255,0.35);font-weight:400;">/100</span></div>
        <div style="font-size:10px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.8px;margin-top:6px;">Accessibility Score</div>
      </div>
      <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:16px 18px;">
        <div style="font-size:30px;font-weight:800;color:${eColor};line-height:1;">${data.eaaScore}<span style="font-size:13px;color:rgba(255,255,255,0.35);font-weight:400;">/100</span></div>
        <div style="font-size:10px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.8px;margin-top:6px;">EAA Readiness · ${escHtml(data.eaaRisk)}</div>
      </div>`;

    previewTotalEl.textContent = `${data.totalIssues} issue${data.totalIssues !== 1 ? 's' : ''}`;

    const SEV = {
      critical: { bg: 'rgba(239,68,68,0.18)',   color: '#fca5a5', label: 'CRITICAL' },
      serious:  { bg: 'rgba(249,115,22,0.18)',   color: '#fdba74', label: 'SERIOUS'  },
      moderate: { bg: 'rgba(234,179,8,0.15)',    color: '#fde68a', label: 'MODERATE' },
      minor:    { bg: 'rgba(148,163,184,0.12)',  color: '#94a3b8', label: 'MINOR'    }
    };

    if (!data.violations || data.violations.length === 0) {
      previewViolEl.innerHTML = '<div style="padding:20px 16px;color:#4ade80;font-size:13px;text-align:center;">✓ No accessibility violations detected.</div>';
      return;
    }

    const shown = data.violations.slice(0, 8);
    const rest  = data.violations.length - shown.length;
    previewViolEl.innerHTML = shown.map((v, i) => {
      const s      = SEV[v.impact] || SEV.minor;
      const border = (i < shown.length - 1 || rest > 0) ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : '';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;${border}">
        <span style="background:${s.bg};color:${s.color};font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap;flex-shrink:0;">${s.label}</span>
        <span style="color:rgba(255,255,255,0.8);font-size:12px;flex:1;line-height:1.45;">${escHtml(v.help)}</span>
        <span style="color:rgba(255,255,255,0.3);font-size:11px;white-space:nowrap;flex-shrink:0;">${v.count}</span>
      </div>`;
    }).join('') + (rest > 0
      ? `<div style="padding:9px 16px;color:rgba(255,255,255,0.3);font-size:11px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);">+${rest} more issue${rest !== 1 ? 's' : ''} in the full PDF report</div>`
      : '');
  }

  function goSuccessAnon(data) {
    clearInterval(stepTimer);

    progressSteps.forEach(s => {
      s.classList.remove('active');
      s.classList.add('done');
      const dot = s.querySelector('.p-dot');
      dot.className        = 'p-dot';
      dot.style.background = '#4ade80';
    });

    scoreStrip.hidden = true;

    renderPreview(data);
    previewPanel.hidden = false;

    emailGate.hidden       = false;
    leadThanks.hidden      = true;
    downloadSection.hidden = true;
    if (signupUpsell) signupUpsell.hidden = true;
    leadEmailInput.value   = '';
    leadConsent.checked    = false;
    leadError.hidden       = true;
    leadError.textContent  = '';
    leadBtn.disabled       = false;
    leadBtn.textContent    = 'Download PDF →';

    stateLoad.hidden = true;
    stateSucc.hidden = false;

    leadEmailInput.focus();
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
          display: block; background: #C9A84C; color: #0A1F44;
          font-size: 15px; font-weight: 700;
          padding: 15px 24px; border-radius: 8px;
          text-decoration: none; margin-bottom: 14px;
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
          display: block; background: #C9A84C; color: #0A1F44;
          font-size: 15px; font-weight: 700;
          padding: 15px 24px; border-radius: 8px;
          text-decoration: none; margin-bottom: 14px;
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

    const handle403 = (data) => {
      clearInterval(stepTimer);
      stateLoad.hidden = true;
      stateForm.hidden = false;
      scanBtn.disabled = false;
      if (data?.error === 'scan_limit_reached') {
        showUpgradePrompt(data.plan || 'free', data.upgradeUrl || '/pricing');
      } else {
        showRegistrationPrompt();
      }
    };

    try {
      const fingerprint = await getBrowserFingerprint();
      const localId     = getOrCreateLocalId();

      if (isAuthenticated) {
        // ── Authenticated: stream PDF directly, no preview needed ──────────────
        const response = await fetch('/scan', {
          method:      'POST',
          headers:     { 'Content-Type': 'application/json', 'x-browser-fp': fingerprint, 'x-local-id': localId },
          credentials: 'include',
          body:        JSON.stringify({ url: normalized })
        });

        if (!response.ok) {
          let data = null;
          try { data = await response.json(); } catch {}
          if (response.status === 403) { handle403(data); return; }
          throw new Error(data?.error || 'The scan failed. Please try again.');
        }

        let scoreData = null;
        const scoreHeader = response.headers.get('X-Audit-Score');
        if (scoreHeader) { try { scoreData = JSON.parse(scoreHeader); } catch {} }

        let filename = 'auditpilot-report.pdf';
        const cd = response.headers.get('Content-Disposition');
        if (cd) { const m = cd.match(/filename="([^"]+)"/); if (m) filename = m[1]; }

        const blob = await response.blob();
        goSuccess(blob, filename, scoreData);

      } else {
        // ── Anonymous: JSON preview + token-based PDF download ─────────────────
        const response = await fetch('/api/scan/preview', {
          method:      'POST',
          headers:     { 'Content-Type': 'application/json', 'x-browser-fp': fingerprint, 'x-local-id': localId },
          credentials: 'include',
          body:        JSON.stringify({ url: normalized })
        });

        if (!response.ok) {
          let data = null;
          try { data = await response.json(); } catch {}
          if (response.status === 403) { handle403(data); return; }
          throw new Error(data?.error || 'The scan failed. Please try again.');
        }

        const previewData    = await response.json();
        currentDownloadToken = previewData.token;
        lastScoreData        = previewData.score;
        goSuccessAnon(previewData);
      }

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

    emailGate.hidden       = true;
    leadThanks.hidden      = false;
    downloadSection.hidden = false;

    if (currentDownloadToken) {
      // Anonymous path: token-based URL, no blob management needed
      downloadLnk.href     = '/api/scan/pdf/' + currentDownloadToken;
      downloadLnk.download = 'auditpilot-report.pdf';
      if (signupUpsell) signupUpsell.hidden = false;
    } else {
      // Authenticated path: blob URL (blob set in goSuccess)
      downloadLnk.removeEventListener('click', handleDownloadClick);
      downloadLnk.addEventListener('click', handleDownloadClick, { once: true });
    }
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
