const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADMIN_HTML_PATH = path.join(__dirname, '..', 'public', 'admin', 'index.html');

function inlineAdminScriptHash() {
  try {
    const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
    const match = html.match(/<script>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    return `'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`;
  } catch (error) {
    console.error('[Security] Unable to hash the admin script; inline JavaScript will be blocked.', error.message);
    return null;
  }
}

const ADMIN_INLINE_SCRIPT_HASH = inlineAdminScriptHash();

function commonSecurityHeaders(_req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-XSS-Protection', '0');
  res.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return next();
}

function buildAdminContentSecurityPolicy() {
  const scriptSources = ["'self'", ADMIN_INLINE_SCRIPT_HASH].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function adminSecurityHeaders(_req, res, next) {
  res.set('Content-Security-Policy', buildAdminContentSecurityPolicy());
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Cache-Control', 'no-store');
  return next();
}

module.exports = {
  commonSecurityHeaders,
  adminSecurityHeaders,
  buildAdminContentSecurityPolicy,
  inlineAdminScriptHash,
};
