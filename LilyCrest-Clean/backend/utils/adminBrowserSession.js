const crypto = require('crypto');

const ADMIN_BROWSER_HEADER = 'x-lilycrest-admin';
const ADMIN_BROWSER_HEADER_VALUE = 'browser';
const ADMIN_CSRF_HEADER = 'x-csrf-token';
const ADMIN_CSRF_COOKIE = 'lc_admin_csrf';
const SESSION_COOKIE = 'session_token';
const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function isAdminBrowserRequest(req = {}) {
  return String(req.headers?.[ADMIN_BROWSER_HEADER] || '').trim().toLowerCase()
    === ADMIN_BROWSER_HEADER_VALUE;
}

function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_MS,
  };
}

function adminCsrfCookieOptions() {
  return {
    httpOnly: false,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_MS,
  };
}

function clearAdminCookieOptions({ httpOnly }) {
  return {
    httpOnly,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
  };
}

function generateAdminCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashAdminCsrfToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function issueAdminBrowserCookies(res, { sessionToken, csrfToken }) {
  res.cookie(SESSION_COOKIE, sessionToken, adminSessionCookieOptions());
  res.cookie(ADMIN_CSRF_COOKIE, csrfToken, adminCsrfCookieOptions());
}

function clearAdminBrowserCookies(res) {
  res.clearCookie(SESSION_COOKIE, clearAdminCookieOptions({ httpOnly: true }));
  res.clearCookie(ADMIN_CSRF_COOKIE, clearAdminCookieOptions({ httpOnly: false }));
}

function extractRequestCredential(req = {}) {
  const authorization = String(req.headers?.authorization || '');
  if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    return token ? { token, transport: 'bearer' } : { token: null, transport: null };
  }

  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (cookieToken && isAdminBrowserRequest(req)) {
    return { token: String(cookieToken), transport: 'admin_cookie' };
  }

  return { token: null, transport: null };
}

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function adminCsrfTokenMatchesHash(token, expectedHash) {
  return Boolean(token && expectedHash)
    && timingSafeTextEqual(hashAdminCsrfToken(token), expectedHash);
}

function verifyAdminBrowserCsrf(req = {}) {
  if (req.authTransport !== 'admin_cookie' || SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) {
    return true;
  }

  if (!isAdminBrowserRequest(req)) return false;

  const headerToken = req.headers?.[ADMIN_CSRF_HEADER];
  const cookieToken = req.cookies?.[ADMIN_CSRF_COOKIE];
  const expectedHash = req.session?.admin_csrf_hash;
  if (!headerToken || !cookieToken || !expectedHash) return false;

  return timingSafeTextEqual(headerToken, cookieToken)
    && adminCsrfTokenMatchesHash(headerToken, expectedHash);
}

module.exports = {
  ADMIN_BROWSER_HEADER,
  ADMIN_BROWSER_HEADER_VALUE,
  ADMIN_CSRF_COOKIE,
  ADMIN_CSRF_HEADER,
  SESSION_COOKIE,
  isAdminBrowserRequest,
  adminSessionCookieOptions,
  adminCsrfCookieOptions,
  generateAdminCsrfToken,
  hashAdminCsrfToken,
  adminCsrfTokenMatchesHash,
  issueAdminBrowserCookies,
  clearAdminBrowserCookies,
  extractRequestCredential,
  verifyAdminBrowserCsrf,
};
