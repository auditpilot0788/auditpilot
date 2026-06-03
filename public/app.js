/**
 * AuditPilot — Frontend
 * Handles scan submission, animated loading steps, error display, and PDF download.
 */

(function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────────────
  const urlInput    = document.getElementById('url-input');
  const scanBtn     = document.getElementById('scan-btn');
  const errorBox    = document.getElementById('error-box');
  const stateForm   = document.getElementById('state-form');
  const stateLoad   = document.getElementById('state-loading');
  const stateSucc   = document.getElementById('state-success');
  const loadingMsg  = document.getElementById('loading-msg');
  const downloadLnk = document.getElementById('download-link');
  const resetBtn    = document.getElementById('reset-btn');
  const scoreStrip  = document.getElementById('score-strip');

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

  let stepTimer = null;
  let currentBlobUrl = null;

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

    // Revoke previous blob URL to free memory
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);

    downloadLnk.href     = currentBlobUrl;
    downloadLnk.download = filename;

    stateLoad.hidden = true;
    stateSucc.hidden = false;
  }

  function goForm() {
    clearInterval(stepTimer);
    clearError();
    stateSucc.hidden = true;
    stateLoad.hidden = true;
    stateForm.hidden = false;
    urlInput.value = '';
    scanBtn.disabled = false;
    urlInput.focus();
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

    scanBtn.disabled = true;
    goLoading();

    try {
      const response = await fetch('/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized })
      });

      if (!response.ok) {
        let msg = 'The scan failed. Please try again.';
        try {
          const data = await response.json();
          if (data && data.error) msg = data.error;
        } catch { /* body not JSON */ }
        throw new Error(msg);
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

  // ── Event listeners ─────────────────────────────────────────────────────────

  scanBtn.addEventListener('click', startScan);

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan();
  });

  urlInput.addEventListener('input', () => {
    if (!errorBox.hidden) clearError();
  });

  resetBtn.addEventListener('click', goForm);

})();
