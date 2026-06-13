const nodemailer = require('nodemailer');

function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendReportEmail(to) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('[mailer] SMTP not configured — skipping email to', to);
    return;
  }

  try {
    const transporter = createTransporter();
    const from = process.env.SMTP_FROM || 'AuditPilot <noreply@auditpilot.de>';

    await transporter.sendMail({
      from,
      to,
      subject: 'Your AuditPilot Accessibility Report is ready',
      text: [
        'Hi,',
        '',
        'Your report is ready — click the Download button on the page to save your PDF.',
        '',
        'The report contains:',
        '  - WCAG 2.1 AA compliance score',
        '  - Critical and serious issue breakdown',
        '  - Code-level fix recommendations',
        '  - EAA readiness assessment',
        '  - Accessibility statement template',
        '',
        'Review the findings and forward to your developer or client.',
        '',
        '— AuditPilot Team',
        'https://auditpilot.de'
      ].join('\n')
    });

    console.log('[mailer] Report notification sent to', to);
  } catch (err) {
    console.error('[mailer] Failed to send email (non-fatal):', err.message);
  }
}

module.exports = { sendReportEmail };
