const { getDb } = require('../config/database');
const { normalizeUser } = require('../utils/normalizeUser');
const { isAccountActive, isTenantMobileRole } = require('../utils/tenantEligibility');
const {
  clearAdminBrowserCookies,
  extractRequestCredential,
  verifyAdminBrowserCsrf,
} = require('../utils/adminBrowserSession');

const AUTH_ERROR_CODES = Object.freeze({
  TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  SESSION_INVALID: 'SESSION_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  ACCOUNT_NOT_FOUND: 'AUTH_ACCOUNT_NOT_FOUND',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  TENANT_ACCESS_REQUIRED: 'TENANT_ACCESS_REQUIRED',
  SERVICE_UNAVAILABLE: 'AUTH_SERVICE_UNAVAILABLE',
  ADMIN_COOKIE_FORBIDDEN: 'ADMIN_COOKIE_FORBIDDEN',
  CSRF_INVALID: 'CSRF_INVALID',
});

function authenticationError(res, status, code, detail, retryable = false) {
  return res.status(status).json({ code, detail, retryable });
}

function invalidatingAuthenticationError(req, res, status, code, detail) {
  if (req.authTransport === 'admin_cookie') {
    clearAdminBrowserCookies(res);
  }
  return authenticationError(res, status, code, detail, false);
}

function sessionHasExpired(session, now = new Date()) {
  const expiresAt = session?.expires_at instanceof Date
    ? session.expires_at
    : new Date(session?.expires_at);
  return Number.isNaN(expiresAt.getTime()) || expiresAt <= now;
}

// Authentication middleware
async function authMiddleware(req, res, next) {
  const credential = extractRequestCredential(req);
  const { token } = credential;
  req.authTransport = credential.transport;
  req.authToken = token;

  if (!token) {
    return authenticationError(res, 401, AUTH_ERROR_CODES.TOKEN_MISSING, 'Not authenticated');
  }

  try {
    const db = getDb();
    const session = await db.collection('user_sessions').findOne({ session_token: token });

    if (!session) {
      return invalidatingAuthenticationError(req, res, 401, AUTH_ERROR_CODES.SESSION_INVALID, 'Invalid session. Please sign in again.');
    }

    if (sessionHasExpired(session)) {
      return invalidatingAuthenticationError(req, res, 401, AUTH_ERROR_CODES.SESSION_EXPIRED, 'Your session has expired. Please sign in again.');
    }

    // Guard against sessions created with missing user_id
    if (!session.user_id) {
      // Delete the broken session so the client gets a clean 401 and re-authenticates
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return invalidatingAuthenticationError(req, res, 401, AUTH_ERROR_CODES.SESSION_INVALID, 'Invalid session. Please sign in again.');
    }

    const user = await db.collection('users').findOne({ user_id: session.user_id });
    if (!user) {
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return invalidatingAuthenticationError(req, res, 401, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND, 'User not found. Please sign in again.');
    }
    if (!isAccountActive(user)) {
      await db.collection('user_sessions').deleteMany({ user_id: session.user_id }).catch(() => {});
      return invalidatingAuthenticationError(req, res, 403, AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 'Access denied. Your account is inactive. Please contact admin.');
    }

    // Session security-version gate. createSession() (auth.controller.js)
    // stamps the account's securityVersion onto every session it mints, and a
    // password change advances that version (finalizePasswordSessions). Any
    // session whose stamped version no longer matches the account is revoked
    // here, so a stolen/pre-change token cannot outlive the credential it was
    // issued against even if physical session deletion failed. This mirrors
    // Capstone-Website's mobileTenantAuth, which already enforces the same
    // rule on the shared user_sessions/users collections — without this check
    // the two halves of the platform disagreed about what "revoked" means.
    const sessionSecurityVersion = Number(session.security_version ?? 0);
    const userSecurityVersion = Number(user.securityVersion ?? user.security_version ?? 0);
    if (!Number.isSafeInteger(sessionSecurityVersion)
      || !Number.isSafeInteger(userSecurityVersion)
      || sessionSecurityVersion !== userSecurityVersion) {
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return invalidatingAuthenticationError(req, res, 401, AUTH_ERROR_CODES.SESSION_REVOKED, 'Your session has been revoked. Please sign in again.');
    }

    if (req.authTransport === 'admin_cookie'
      && !['admin', 'superadmin'].includes(String(user.role || '').toLowerCase())) {
      return invalidatingAuthenticationError(
        req,
        res,
        403,
        AUTH_ERROR_CODES.ADMIN_COOKIE_FORBIDDEN,
        'Admin browser access requires an administrator account.',
      );
    }

    req.user = normalizeUser(user);
    req.session = session;
    if (!verifyAdminBrowserCsrf(req)) {
      return authenticationError(
        res,
        403,
        AUTH_ERROR_CODES.CSRF_INVALID,
        'The admin request could not be verified. Refresh the page and try again.',
      );
    }
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return authenticationError(
      res,
      503,
      AUTH_ERROR_CODES.SERVICE_UNAVAILABLE,
      'Authentication service is temporarily unavailable. Please try again.',
      true,
    );
  }
}

// A session token is normally rejected the instant it passes expires_at, which
// means a client that just received a 401 from authMiddleware can never use
// that same token to authenticate a follow-up "disable my push token on this
// device" cleanup call — the server would reject it for the exact same reason.
// This narrow variant accepts a session that expired within the last
// TEARDOWN_GRACE_PERIOD_MS, but still requires the token to exactly match a
// real, previously-issued session record for that user — it does not accept
// arbitrary or guessed tokens, and it is not mounted on any route that reads
// or mutates tenant data other than the device's own push-token association.
// Use ONLY for narrowly-scoped, idempotent teardown actions.
const TEARDOWN_GRACE_PERIOD_MS = 5 * 60 * 1000;

async function authMiddlewareRecentSession(req, res, next) {
  const authHeader = req.headers.authorization;

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return authenticationError(res, 401, AUTH_ERROR_CODES.TOKEN_MISSING, 'Not authenticated');
  }

  try {
    const db = getDb();
    const session = await db.collection('user_sessions').findOne({
      session_token: token,
      expires_at: { $gt: new Date(Date.now() - TEARDOWN_GRACE_PERIOD_MS) },
    });

    if (!session || !session.user_id) {
      return authenticationError(res, 401, AUTH_ERROR_CODES.SESSION_INVALID, 'Invalid or expired session');
    }

    const user = await db.collection('users').findOne({ user_id: session.user_id });
    if (!user) {
      return authenticationError(res, 401, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND, 'User not found');
    }
    if (!isAccountActive(user)) {
      await db.collection('user_sessions').deleteMany({ user_id: session.user_id }).catch(() => {});
      return authenticationError(res, 403, AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 'Access denied. Your account is inactive. Please contact admin.');
    }

    const sessionSecurityVersion = Number(session.security_version ?? 0);
    const userSecurityVersion = Number(user.securityVersion ?? user.security_version ?? 0);
    if (!Number.isSafeInteger(sessionSecurityVersion)
      || !Number.isSafeInteger(userSecurityVersion)
      || sessionSecurityVersion !== userSecurityVersion) {
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return authenticationError(res, 401, AUTH_ERROR_CODES.SESSION_REVOKED, 'Your session has been revoked. Please sign in again.');
    }

    req.user = normalizeUser(user);
    req.session = session;
    next();
  } catch (error) {
    console.error('Auth middleware (recent-session) error:', error);
    return authenticationError(
      res,
      503,
      AUTH_ERROR_CODES.SERVICE_UNAVAILABLE,
      'Authentication service is temporarily unavailable. Please try again.',
      true,
    );
  }
}

function adminMiddleware(req, res, next) {
  const role = (req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ detail: 'Admin access required' });
  }
  return next();
}

// The mobile app is tenant-only. Fail closed to the canonical tenant/resident
// roles on every tenant route; merely being a non-admin (for example an
// applicant, staff member, or owner) is not tenant registration.
function tenantMiddleware(req, res, next) {
  if (!isTenantMobileRole(req.user?.role)) {
    return authenticationError(
      res,
      403,
      AUTH_ERROR_CODES.TENANT_ACCESS_REQUIRED,
      'Access denied. This account is not registered as an active tenant.',
    );
  }
  return next();
}

// Password recovery/change is stricter than the older general tenant-app
// middleware: only an authoritative tenant/resident role may mutate a mobile
// credential. Applicant/admin/owner/staff identities fail closed.
function tenantPasswordMiddleware(req, res, next) {
  if (!isTenantMobileRole(req.user?.role)) {
    return authenticationError(
      res,
      403,
      AUTH_ERROR_CODES.TENANT_ACCESS_REQUIRED,
      'Tenant access is required.',
    );
  }
  return next();
}

// Like authMiddleware but doesn't block unauthenticated requests.
// Attaches req.user if a valid session is found; sets req.user = null otherwise.
async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const db = getDb();
    const session = await db.collection('user_sessions').findOne({ session_token: token });
    if (!session) {
      return authenticationError(res, 401, AUTH_ERROR_CODES.SESSION_INVALID, 'Invalid session. Please sign in again.');
    }
    if (sessionHasExpired(session)) {
      return authenticationError(res, 401, AUTH_ERROR_CODES.SESSION_EXPIRED, 'Your session has expired. Please sign in again.');
    }
    if (!session.user_id) {
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return authenticationError(res, 401, AUTH_ERROR_CODES.SESSION_INVALID, 'Invalid session. Please sign in again.');
    }

    const user = await db.collection('users').findOne({ user_id: session.user_id });
    if (!user) {
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return authenticationError(res, 401, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND, 'User not found. Please sign in again.');
    }
    if (!isAccountActive(user)) {
      await db.collection('user_sessions').deleteMany({ user_id: session.user_id }).catch(() => {});
      return authenticationError(res, 403, AUTH_ERROR_CODES.ACCOUNT_INACTIVE, 'Access denied. Your account is inactive. Please contact admin.');
    }

    const sessionSecurityVersion = Number(session.security_version ?? 0);
    const userSecurityVersion = Number(user.securityVersion ?? user.security_version ?? 0);
    if (!Number.isSafeInteger(sessionSecurityVersion)
      || !Number.isSafeInteger(userSecurityVersion)
      || sessionSecurityVersion !== userSecurityVersion) {
      await db.collection('user_sessions').deleteOne({ _id: session._id }).catch(() => {});
      return authenticationError(res, 401, AUTH_ERROR_CODES.SESSION_REVOKED, 'Your session has been revoked. Please sign in again.');
    }

    req.user = normalizeUser(user);
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    return authenticationError(
      res,
      503,
      AUTH_ERROR_CODES.SERVICE_UNAVAILABLE,
      'Authentication service is temporarily unavailable. Please try again.',
      true,
    );
  }

  return next();
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  tenantMiddleware,
  tenantPasswordMiddleware,
  optionalAuthMiddleware,
  authMiddlewareRecentSession,
  isAccountActive,
  TEARDOWN_GRACE_PERIOD_MS,
  AUTH_ERROR_CODES,
  sessionHasExpired,
};
