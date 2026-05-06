/**
 * LilyCrest Email Service
 * Sends transactional emails via Nodemailer (SMTP).
 *
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * All public functions are non-throwing — they log warnings and return false
 * on failure so callers never need try/catch.
 */

const nodemailer = require('nodemailer');

// ─── TRANSPORTER (lazily created) ───────────────────────────────────────────

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[Email] SMTP not configured — emails will be skipped. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  console.log(`[Email] SMTP transporter ready → ${host}:${port}`);
  return _transporter;
}

function senderAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@lilycrest.com';
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function maskEmail(email = '') {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return user.length <= 2 ? `${user[0]}***@${domain}` : `${user.slice(0, 2)}***@${domain}`;
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── HTML TEMPLATE ──────────────────────────────────────────────────────────

function brandedHtml({ title, heading, bodyHtml, footerNote }) {
  return `
<!DOCTYPE html>
<html lang="en" style="color-scheme:light;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${title}</title>
  <style>
    :root { color-scheme: light only; }
    @media (prefers-color-scheme: dark) {
      body { background-color: #EEF2F8 !important; }
      table { background-color: #EEF2F8 !important; }
      .email-card { background-color: #FFFFFF !important; }
      .email-header { background-color: #204b7e !important; }
      .email-heading-bar { background-color: #FAFBFD !important; }
      .email-body { background-color: #FFFFFF !important; }
      .email-footer { background-color: #FAFBFD !important; }
      .email-bottom { background-color: #204b7e !important; }
      .email-heading-text { color: #1a2744 !important; }
      .email-body-text { color: #1a2744 !important; }
      .email-muted { color: #6B7280 !important; }
      .info-table { background-color: #FAFBFD !important; border-color: #E4EAF2 !important; }
      .info-label { color: #8a97aa !important; }
      .info-value { color: #1a2744 !important; }
      .alert-box { background-color: #FFF8EC !important; }
      .note-box { background-color: #FAFBFD !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#EEF2F8;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color-scheme:light;">
  <table cellpadding="0" cellspacing="0" width="100%" style="background:#EEF2F8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table class="email-card" cellpadding="0" cellspacing="0" width="580" style="max-width:580px;background:#FFFFFF;border-radius:6px;overflow:hidden;box-shadow:0 2px 16px rgba(32,75,126,0.12);">

          <!-- Primary top stripe -->
          <tr>
            <td class="email-header" style="background:#204b7e;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td class="email-header" style="background:#204b7e;padding:36px 48px 32px;text-align:center;">
              <p style="margin:0 0 8px;color:#ff9000;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Dormitory Management System</p>
              <h1 style="margin:0;color:#FFFFFF;font-size:26px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">LilyCrest</h1>
            </td>
          </tr>

          <!-- Heading bar -->
          <tr>
            <td class="email-heading-bar" style="background:#FAFBFD;padding:28px 48px 20px;border-bottom:1px solid #E4EAF2;">
              <h2 class="email-heading-text" style="margin:0 0 10px;color:#1a2744;font-size:19px;font-weight:700;letter-spacing:-0.2px;">${heading}</h2>
              <div style="width:36px;height:3px;background:#ff9000;border-radius:2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-body" style="padding:28px 48px 32px;background:#FFFFFF;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-footer" style="background:#FAFBFD;padding:20px 48px;border-top:1px solid #E4EAF2;">
              ${footerNote ? `<p class="email-muted" style="margin:0 0 10px;color:#6B7280;font-size:12.5px;line-height:1.6;">${footerNote}</p>` : ''}
              <p class="email-muted" style="margin:0;color:#9CA3AF;font-size:11.5px;line-height:1.6;">
                This is an automated message from LilyCrest Dormitory Management System. Please do not reply to this email.
              </p>
            </td>
          </tr>

          <!-- Bottom stripe -->
          <tr>
            <td class="email-bottom" style="background:#204b7e;padding:16px 48px;text-align:center;">
              <p style="margin:0;color:rgba(255,255,255,0.50);font-size:11px;letter-spacing:0.3px;">
                &copy; ${new Date().getFullYear()} LilyCrest Dormitory. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── SHARED PARTIALS ────────────────────────────────────────────────────────

function infoTable(rows) {
  const rowsHtml = rows.map(([label, value, highlight = false]) => `
    <tr>
      <td style="padding:9px 0;color:#8a97aa;font-size:12.5px;font-weight:500;width:140px;vertical-align:top;border-bottom:1px solid #EEF2F8;">${label}</td>
      <td style="padding:9px 0;color:${highlight ? '#ff9000' : '#1a2744'};font-size:13.5px;font-weight:${highlight ? '700' : '600'};vertical-align:top;border-bottom:1px solid #EEF2F8;">${value}</td>
    </tr>
  `).join('');

  return `
    <table cellpadding="0" cellspacing="0" width="100%"
      style="background:#FAFBFD;border:1px solid #E4EAF2;border-radius:6px;margin-bottom:24px;">
      <tr><td style="padding:6px 20px 2px;">
        <table cellpadding="0" cellspacing="0" width="100%">
          ${rowsHtml}
        </table>
      </td></tr>
    </table>
  `;
}

function alertBox(title, body) {
  return `
    <div style="border-left:4px solid #ff9000;background:#FFF8EC;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:8px;">
      ${title ? `<p style="margin:0 0 5px;color:#1a2744;font-size:13.5px;font-weight:700;">${title}</p>` : ''}
      <p style="margin:0;color:#4a5568;font-size:13px;line-height:1.6;">${body}</p>
    </div>
  `;
}

function noteBox(body) {
  return `
    <div style="border-left:4px solid #D8E2F0;background:#FAFBFD;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:8px;">
      <p style="margin:0;color:#6B7280;font-size:13px;line-height:1.6;">${body}</p>
    </div>
  `;
}

// ─── PASSWORD CHANGED EMAIL ─────────────────────────────────────────────────

async function sendPasswordChangedEmail(toEmail, userName = 'Tenant', ip = 'Unknown') {
  const transporter = getTransporter();
  if (!transporter) return false;

  const now = new Date();
  const timestamp = now.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const maskedEmail = maskEmail(toEmail);

  const bodyHtml = `
    <p style="margin:0 0 6px;color:#1a2744;font-size:15px;line-height:1.7;">
      Dear <strong>${escapeHtml(userName)}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#4a5568;font-size:14.5px;line-height:1.7;">
      Your LilyCrest account password has been <strong style="color:#204b7e;">successfully changed</strong>.
      Please review the details below.
    </p>

    ${infoTable([
      ['Account', maskedEmail],
      ['Date &amp; Time', timestamp],
      ['IP Address', escapeHtml(ip)],
    ])}

    ${alertBox(
      'Did not make this change?',
      'If you did not change your password, your account may be compromised. Reset your password immediately through the LilyCrest app or contact the admin office without delay.',
    )}
  `;

  const html = brandedHtml({
    title: 'Password Changed — LilyCrest',
    heading: 'Password Changed Successfully',
    bodyHtml,
    footerNote: 'You are receiving this email because a password change was made on your LilyCrest tenant account.',
  });

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: toEmail,
      subject: 'LilyCrest Security Alert — Your Password Was Changed',
      html,
    });
    console.log(`[Email] Password-changed confirmation sent to ${maskedEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send password-changed email to ${maskedEmail}:`, err?.message);
    return false;
  }
}

// ─── LOGIN OTP EMAIL ────────────────────────────────────────────────────────

async function sendLoginOtpEmail(toEmail, userName = 'Tenant', otpCode) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const maskedEmail = maskEmail(toEmail);

  const bodyHtml = `
    <p style="margin:0 0 6px;color:#1a2744;font-size:15px;line-height:1.7;">
      Dear <strong>${escapeHtml(userName)}</strong>,
    </p>
    <p style="margin:0 0 28px;color:#4a5568;font-size:14.5px;line-height:1.7;">
      Use the verification code below to complete your sign-in to the LilyCrest Tenant Portal.
    </p>

    <div style="text-align:center;margin:0 0 28px;">
      <div style="display:inline-block;background:#204b7e;border-radius:8px;padding:32px 56px;">
        <p style="margin:0 0 12px;color:rgba(255,255,255,0.65);font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Verification Code</p>
        <p style="margin:0;color:#ff9000;font-size:48px;font-weight:700;letter-spacing:14px;font-family:'Courier New',Courier,monospace;">${escapeHtml(otpCode)}</p>
      </div>
    </div>

    ${noteBox('This code expires in <strong style="color:#204b7e;">10 minutes</strong>. Do not share it with anyone, including LilyCrest staff.')}

    <p style="margin:16px 0 0;color:#9CA3AF;font-size:13px;line-height:1.6;">
      If you did not attempt to sign in, you can safely ignore this email. Your account remains secure.
    </p>
  `;

  const html = brandedHtml({
    title: 'Log-In Verification — LilyCrest',
    heading: 'Your Verification Code',
    bodyHtml,
    footerNote: `You are receiving this because a sign-in was attempted on the LilyCrest Tenant Portal for ${maskedEmail}.`,
  });

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: toEmail,
      subject: `${otpCode} is your LilyCrest verification code`,
      html,
    });
    console.log(`[Email] Login OTP sent to ${maskedEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send OTP email to ${maskedEmail}:`, err?.message);
    return false;
  }
}

// ─── PAYMENT RECEIPT EMAIL ───────────────────────────────────────────────────

async function sendPaymentReceiptEmail(toEmail, userName = 'Tenant', receipt = {}) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const maskedEmail = maskEmail(toEmail);
  const billingId = receipt.billingId || 'N/A';
  const description = receipt.description || `Bill ${billingId}`;
  const amount = Number(receipt.amount || 0);
  const paymentMethod = receipt.paymentMethod || 'PayMongo';
  const referenceNumber = receipt.referenceNumber || receipt.paymentId || 'N/A';

  const paymentDate = (() => {
    const raw = receipt.paymentDate || new Date();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return new Date();
    return parsed;
  })();

  const paymentDateText = paymentDate.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const amountText = `PHP ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const bodyHtml = `
    <p style="margin:0 0 6px;color:#1a2744;font-size:15px;line-height:1.7;">
      Dear <strong>${escapeHtml(userName)}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#4a5568;font-size:14.5px;line-height:1.7;">
      Your payment has been confirmed. Thank you for settling your LilyCrest billing on time.
    </p>

    ${infoTable([
      ['Billing ID', escapeHtml(String(billingId))],
      ['Description', escapeHtml(String(description))],
      ['Amount Paid', escapeHtml(amountText), true],
      ['Payment Method', escapeHtml(String(paymentMethod))],
      ['Reference No.', escapeHtml(String(referenceNumber))],
      ['Paid On', escapeHtml(paymentDateText)],
    ])}

    <p style="margin:0;color:#6B7280;font-size:13px;line-height:1.6;">
      Please keep this email as your official payment receipt for future reference.
    </p>
  `;

  const html = brandedHtml({
    title: 'Payment Confirmed — LilyCrest',
    heading: 'Payment Confirmed',
    bodyHtml,
    footerNote: `Official receipt issued for ${maskedEmail}.`,
  });

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: toEmail,
      subject: `Payment Confirmed — Bill ${billingId}`,
      html,
    });
    console.log(`[Email] Payment receipt sent to ${maskedEmail} for bill ${billingId}`);
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send payment receipt to ${maskedEmail}:`, err?.message);
    return false;
  }
}

// ─── PASSWORD RESET EMAIL ────────────────────────────────────────────────────

async function sendPasswordResetEmail(toEmail, userName = 'Tenant', resetLink) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const maskedEmail = maskEmail(toEmail);

  const bodyHtml = `
    <p style="margin:0 0 6px;color:#1a2744;font-size:15px;line-height:1.7;">
      Dear <strong>${escapeHtml(userName)}</strong>,
    </p>
    <p style="margin:0 0 28px;color:#4a5568;font-size:14.5px;line-height:1.7;">
      We received a request to reset the password for your LilyCrest account.
      Tap the button below — it will open the LilyCrest app directly so you can set a new password.
    </p>

    <div style="text-align:center;margin:0 0 28px;">
      <a href="${resetLink}"
         style="display:inline-block;background:#204b7e;color:#FFFFFF;font-size:14.5px;
                font-weight:700;padding:16px 52px;border-radius:6px;text-decoration:none;
                letter-spacing:0.5px;text-transform:uppercase;">
        Reset My Password
      </a>
    </div>

    ${noteBox('This link expires in <strong style="color:#204b7e;">15 minutes</strong> and can only be used once.')}

    <p style="margin:16px 0 0;color:#9CA3AF;font-size:13px;line-height:1.6;">
      If you did not request a password reset, you can safely ignore this email. Your account remains secure and your password has not been changed.
    </p>
  `;

  const html = brandedHtml({
    title: 'Reset Your Password — LilyCrest',
    heading: 'Reset Your Password',
    bodyHtml,
    footerNote: `You are receiving this because a password reset was requested for ${maskedEmail}.`,
  });

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: toEmail,
      subject: 'Reset Your LilyCrest Password',
      html,
    });
    console.log(`[Email] Password reset link sent to ${maskedEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send password reset email to ${maskedEmail}:`, err?.message);
    return false;
  }
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  sendPasswordChangedEmail,
  sendLoginOtpEmail,
  sendPaymentReceiptEmail,
  sendPasswordResetEmail,
};
