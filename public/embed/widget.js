(function () {
  'use strict';

  var API_URL = 'https://getauditpilot.de/api/widget/scan';

  var IMPACT_COLOR = {
    critical: '#dc2626',
    serious:  '#ea580c',
    moderate: '#d97706',
    minor:    '#2563eb'
  };

  var RISK_COLOR = {
    'Low Risk':      '#16a34a',
    'Medium Risk':   '#d97706',
    'High Risk':     '#dc2626',
    'Critical Risk': '#dc2626'
  };

  function getRiskColor(risk) {
    return RISK_COLOR[risk] || '#d97706';
  }

  function css(primary) {
    return [
      ':host { all: initial; display: block; font-family: system-ui, -apple-system, sans-serif; }',
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
      '.widget { border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; padding: 16px; background: #fff; max-width: 100%; }',
      '.row { display: flex; gap: 8px; }',
      '.url-input {',
      '  flex: 1; height: 42px; border: 1px solid rgba(0,0,0,0.18); border-radius: 6px;',
      '  padding: 0 12px; font-size: 14px; font-family: inherit; outline: none;',
      '  color: #111; background: #fafafa; min-width: 0;',
      '}',
      '.url-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0,0,0,0.06); }',
      '.scan-btn {',
      '  height: 42px; min-width: 110px; padding: 0 16px; border: none; border-radius: 6px;',
      '  background: var(--primary); color: #fff; font-size: 14px; font-weight: 700;',
      '  font-family: inherit; cursor: pointer; white-space: nowrap; flex-shrink: 0;',
      '  transition: opacity 0.15s;',
      '}',
      '.scan-btn:disabled { opacity: 0.55; cursor: not-allowed; }',
      '.msg { margin-top: 12px; font-size: 13px; }',
      '.msg.error { color: #dc2626; }',
      '.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 6px; }',
      '@keyframes spin { to { transform: rotate(360deg); } }',
      '.results { margin-top: 14px; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px; overflow: hidden; }',
      '.results-header { padding: 12px 14px; background: #f8f8f8; border-bottom: 1px solid rgba(0,0,0,0.07); }',
      '.issue-count { font-size: 15px; font-weight: 700; color: #111; }',
      '.risk-badge {',
      '  display: inline-block; margin-left: 10px; font-size: 11px; font-weight: 700;',
      '  padding: 2px 8px; border-radius: 20px; color: #fff; vertical-align: middle;',
      '}',
      '.issues-list { padding: 10px 0; }',
      '.issue-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 14px; border-bottom: 1px solid rgba(0,0,0,0.05); }',
      '.issue-item:last-child { border-bottom: none; }',
      '.impact-pill {',
      '  display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px;',
      '  border-radius: 20px; color: #fff; white-space: nowrap; flex-shrink: 0; margin-top: 1px;',
      '}',
      '.issue-desc { font-size: 13px; color: #333; line-height: 1.45; }',
      '.divider { height: 1px; background: rgba(0,0,0,0.07); margin: 0 14px; }',
      '.cta-area { padding: 12px 14px; }',
      '.cta-btn {',
      '  display: inline-block; background: var(--primary); color: #fff;',
      '  font-size: 13px; font-weight: 700; padding: 10px 18px; border-radius: 6px;',
      '  text-decoration: none; font-family: inherit; cursor: pointer;',
      '}',
      '.no-issues { padding: 14px; text-align: center; font-size: 14px; font-weight: 600; color: #16a34a; }',
      '@media (max-width: 380px) {',
      '  .row { flex-wrap: wrap; }',
      '  .scan-btn { width: 100%; min-width: 0; }',
      '}'
    ].join('\n');
  }

  function html(label) {
    return (
      '<div class="widget">' +
        '<div class="row">' +
          '<input class="url-input" type="url" placeholder="https://yourwebsite.com" aria-label="Website URL" />' +
          '<button class="scan-btn">' + escHtml(label) + '</button>' +
        '</div>' +
        '<div class="msg" style="display:none;"></div>' +
        '<div class="results" style="display:none;"></div>' +
      '</div>'
    );
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildResults(data, ctaUrl) {
    var total   = data.totalIssues || 0;
    var risk    = data.eaaRisk || '';
    var issues  = data.topIssues || [];
    var riskCol = getRiskColor(risk);

    if (total === 0) {
      return (
        '<div class="results-header">' +
          '<span class="issue-count" style="color:#16a34a;">✓ No accessibility issues found</span>' +
        '</div>' +
        '<div class="cta-area">' +
          '<a class="cta-btn" href="' + escHtml(ctaUrl) + '" target="_blank" rel="noopener">Get your full report →</a>' +
        '</div>'
      );
    }

    var issueWord = total === 1 ? 'issue' : 'issues';
    var header = (
      '<div class="results-header">' +
        '<span class="issue-count">' + total + ' ' + issueWord + ' found</span>' +
        '<span class="risk-badge" style="background:' + riskCol + ';">' + escHtml(risk) + '</span>' +
      '</div>'
    );

    var rows = '';
    for (var i = 0; i < issues.length; i++) {
      var v   = issues[i];
      var col = IMPACT_COLOR[v.impact] || '#6b7280';
      rows += (
        '<div class="issue-item">' +
          '<span class="impact-pill" style="background:' + col + ';">' + escHtml(v.impact) + '</span>' +
          '<span class="issue-desc">' + escHtml(v.description) + '</span>' +
        '</div>'
      );
    }

    return (
      header +
      '<div class="issues-list">' + rows + '</div>' +
      '<div class="divider"></div>' +
      '<div class="cta-area">' +
        '<a class="cta-btn" href="' + escHtml(ctaUrl) + '" target="_blank" rel="noopener">Get your full report →</a>' +
      '</div>'
    );
  }

  function init() {
    var host = document.getElementById('auditpilot-widget');
    if (!host) return;

    var widgetKey   = (host.dataset.widgetKey   || '').trim();
    var primaryColor = (host.dataset.primaryColor || '#C9A84C').trim();
    var label        = (host.dataset.label        || 'Free Accessibility Check').trim();
    var ctaUrl       = (host.dataset.ctaUrl       || 'https://getauditpilot.de').trim();

    if (!widgetKey) {
      console.warn('[AuditPilot widget] data-widget-key is missing.');
      return;
    }

    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = css(primaryColor);
    shadow.appendChild(style);

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html(label);
    shadow.appendChild(wrapper);

    // Apply CSS custom property for primary color
    var widget = shadow.querySelector('.widget');
    widget.style.setProperty('--primary', primaryColor);

    var input    = shadow.querySelector('.url-input');
    var btn      = shadow.querySelector('.scan-btn');
    var msgEl    = shadow.querySelector('.msg');
    var resultsEl = shadow.querySelector('.results');

    function showMsg(text, isError) {
      msgEl.textContent    = text;
      msgEl.style.display  = 'block';
      msgEl.className      = 'msg' + (isError ? ' error' : '');
      resultsEl.style.display = 'none';
    }

    function clearMsg() {
      msgEl.style.display  = 'none';
      msgEl.textContent    = '';
    }

    function setLoading(on) {
      btn.disabled = on;
      if (on) {
        btn.innerHTML = '<span class="spinner"></span>Scanning…';
      } else {
        btn.textContent = label;
      }
    }

    async function runScan() {
      var raw = input.value.trim();
      if (!raw) { showMsg('Please enter a website URL.', true); return; }

      // Auto-prepend https:// if no protocol given
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

      try { new URL(raw); } catch {
        showMsg('Please enter a valid URL (e.g. https://example.com).', true);
        return;
      }

      clearMsg();
      resultsEl.style.display = 'none';
      setLoading(true);

      try {
        var res = await fetch(API_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ url: raw, widget_key: widgetKey })
        });

        if (res.status === 429) {
          showMsg('Daily scan limit reached — try again tomorrow.', true);
          return;
        }
        if (res.status === 401) {
          showMsg('Widget configuration error — please contact the website owner.', true);
          return;
        }
        if (!res.ok) {
          showMsg('Scan failed — please check the URL and try again.', true);
          return;
        }

        var data = await res.json();
        resultsEl.innerHTML     = buildResults(data, ctaUrl);
        resultsEl.style.display = 'block';
      } catch {
        showMsg('Scan failed — please check the URL and try again.', true);
      } finally {
        setLoading(false);
      }
    }

    btn.addEventListener('click', runScan);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runScan();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
