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

// ─── HTML TEMPLATE ──────────────────────────────────────────────────────────

function brandedHtml({ title, heading, bodyHtml, footerNote }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" width="100%" style="background:#F3F4F6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1E3A5F 0%,#2D5A8E 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#FFFFFF;font-size:22px;font-weight:700;letter-spacing:0.5px;">🏠 LilyCrest Dormitory</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Tenant Portal — Security Notification</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h2 style="margin:0 0 16px;color:#1E3A5F;font-size:20px;font-weight:700;">${heading}</h2>
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;padding:24px 40px;border-top:1px solid #E5E7EB;">
              ${footerNote ? `<p style="margin:0 0 12px;color:#6B7280;font-size:13px;line-height:1.5;">${footerNote}</p>` : ''}
              <p style="margin:0;color:#9CA3AF;font-size:12px;">
                This is an automated message from LilyCrest Dormitory Management System.<br/>
                Please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:24px 0 0;color:#9CA3AF;font-size:11px;">
          © ${new Date().getFullYear()} LilyCrest Dormitory. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── PASSWORD CHANGED EMAIL ─────────────────────────────────────────────────

/**
 * Send a "your password was changed" confirmation email.
 *
 * @param {string} toEmail   Recipient email
 * @param {string} userName  Display name (for greeting)
 * @param {string} ip        IP address of the request
 * @returns {Promise<boolean>}
 */
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
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hi <strong>${escapeHtml(userName)}</strong>,
    </p>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Your LilyCrest account password was <strong>successfully changed</strong>.
    </p>

    <table cellpadding="0" cellspacing="0" width="100%" style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:24px;">
      <tr>
        <td style="padding:16px 20px;">
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:6px 0;color:#6B7280;font-size:13px;width:100px;">Account</td>
              <td style="padding:6px 0;color:#1F2937;font-size:14px;font-weight:600;">${maskedEmail}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6B7280;font-size:13px;">Date & Time</td>
              <td style="padding:6px 0;color:#1F2937;font-size:14px;font-weight:600;">${timestamp}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6B7280;font-size:13px;">IP Address</td>
              <td style="padding:6px 0;color:#1F2937;font-size:14px;font-weight:600;">${escapeHtml(ip)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:16px 20px;margin-bottom:8px;">
      <p style="margin:0;color:#991B1B;font-size:14px;font-weight:600;">⚠️ Didn't make this change?</p>
      <p style="margin:6px 0 0;color:#B91C1C;font-size:13px;line-height:1.5;">
        If you did not change your password, your account may be compromised. 
        Please reset your password immediately through the app or contact the LilyCrest admin office right away.
      </p>
    </div>
  `;

  const html = brandedHtml({
    title: 'Password Changed — LilyCrest',
    heading: '🔒 Password Changed Successfully',
    bodyHtml,
    footerNote: 'You\'re receiving this email because a password change was made on your LilyCrest tenant account.',
  });

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: toEmail,
      subject: '🔒 LilyCrest Security Alert — Your Password Was Changed',
      html,
    });
    console.log(`[Email] Password-changed confirmation sent to ${maskedEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send password-changed email to ${maskedEmail}:`, err?.message);
    return false;
  }
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

// ─── LOGIN OTP EMAIL ────────────────────────────────────────────────────────

/**
 * Send a login OTP verification email.
 *
 * @param {string} toEmail   Recipient email
 * @param {string} userName  Display name
 * @param {string} otpCode   6-digit OTP code
 * @returns {Promise<boolean>}
 */
async function sendLoginOtpEmail(toEmail, userName = 'Tenant', otpCode) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const maskedEmail = maskEmail(toEmail);

  const bodyHtml = `
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      Hi <strong>${escapeHtml(userName)}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      Use the verification code below to complete your sign-in to LilyCrest Tenant Portal.
    </p>

    <div style="text-align:center;margin:0 0 24px;">
      <div style="display:inline-block;background:#1E3A5F;border-radius:16px;padding:24px 40px;">
        <p style="margin:0 0 6px;color:rgba(255,255,255,0.7);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Verification Code</p>
        <p style="margin:0;color:#FFFFFF;font-size:40px;font-weight:700;letter-spacing:10px;">${escapeHtml(otpCode)}</p>
      </div>
    </div>

    <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;padding:14px 20px;margin-bottom:8px;">
      <p style="margin:0;color:#92400E;font-size:13px;line-height:1.5;">
        ⏱ This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
      </p>
    </div>

    <p style="margin:16px 0 0;color:#6B7280;font-size:13px;line-height:1.5;">
      If you did not attempt to sign in, you can safely ignore this email. Your account remains secure.
    </p>
  `;

  const html = brandedHtml({
    title: 'Log-In Verification — LilyCrest',
    heading: '🔐 Your Log-In Code',
    bodyHtml,
    footerNote: `You're receiving this because a log-in was attempted on the LilyCrest Tenant Portal for ${maskedEmail}.`,
  });

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: toEmail,
      subject: `${otpCode} is your LilyCrest log-in code`,
      html,
    });
    console.log(`[Email] Login OTP sent to ${maskedEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Email] Failed to send OTP email to ${maskedEmail}:`, err?.message);
    return false;
  }
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  sendPasswordChangedEmail,
  sendLoginOtpEmail,
};
