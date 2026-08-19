const { getDb } = require('../config/database');
const { normalizeUser } = require('../utils/normalizeUser');
const { isTenantMobileRole } = require('../utils/tenantEligibility');

function isAccountActive(user = {}) {
  if (user.deleted_at || user.deletedAt || user.is_deleted === true || user.isDeleted === true) return false;
  if (user.is_active === false || user.isActive === false || user.disabled === true || user.is_disabled === true) return false;
  const status = String(user.status || user.account_status || '').trim().toLowerCase();
  return !['inactive', 'disabled', 'deleted', 'suspended', 'blocked', 'terminated', 'pending', 'pending_approval'].includes(status);
}

// Authentication middleware
async function authMiddleware(req, res, next) {

  const authHeader = req.headers.authorization;

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  try {
    const db = getDb();
    const session = await db.collection('user_sessions').findOne({
      session_token: token,
      expires_at: { $gt: new Date() }
    });

    if (!session) {
      return res.status(401).json({ detail: 'Invalid or expired session' });
    }

    // Guard against sessions created with missing user_id
    if (!session.user_id) {
      // Delete the broken session so the client gets a clean 401 and re-authenticates
      await db.collection('user_sessions').deleteOne({ _id: session._id });
      return res.status(401).json({ detail: 'Invalid session. Please sign in again.' });
    }

    const user = await db.collection('users').findOne({ user_id: session.user_id });
    if (!user) {
      return res.status(401).json({ detail: 'User not found' });
    }
    if (!isAccountActive(user)) {
      await db.collection('user_sessions').deleteMany({ user_id: session.user_id });
      return res.status(403).json({ code: 'ACCOUNT_INACTIVE', detail: 'Access denied. Your account is inactive. Please contact admin.' });
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
      return res.status(401).json({ detail: 'Your session has expired. Please sign in again.' });
    }

    req.user = normalizeUser(user);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ detail: 'Authentication error' });
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
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  try {
    const db = getDb();
    const session = await db.collection('user_sessions').findOne({
      session_token: token,
      expires_at: { $gt: new Date(Date.now() - TEARDOWN_GRACE_PERIOD_MS) },
    });

    if (!session || !session.user_id) {
      return res.status(401).json({ detail: 'Invalid or expired session' });
    }

    const user = await db.collection('users').findOne({ user_id: session.user_id });
    if (!user) {
      return res.status(401).json({ detail: 'User not found' });
    }

    req.user = normalizeUser(user);
    req.session = session;
    next();
  } catch (error) {
    console.error('Auth middleware (recent-session) error:', error);
    return res.status(401).json({ detail: 'Authentication error' });
  }
}

function adminMiddleware(req, res, next) {
  const role = (req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ detail: 'Admin access required' });
  }
  return next();
}

// The mobile app is tenant-only: it must never let an authenticated admin
// account reach tenant-scoped data/actions just because they hold a valid
// session. /auth/login and /auth/google intentionally still authenticate
// admin accounts (the web admin panel shares that same endpoint), so the
// tenant-only guarantee has to be enforced here, on every tenant-facing
// route, rather than at login time. Mirrors the role check auth.controller.js
// already uses to keep admins out of the tenant *login* path (role: {$nin:
// ['admin','superadmin']}) — this applies the same rule to every subsequent
// tenant request, not just the initial login.
function tenantMiddleware(req, res, next) {
  const role = (req.user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'superadmin') {
    return res.status(403).json({ detail: 'This account cannot access the tenant app. Please use the admin panel.' });
  }
  return next();
}

// Password recovery/change is stricter than the older general tenant-app
// middleware: only an authoritative tenant/resident role may mutate a mobile
// credential. Applicant/admin/owner/staff identities fail closed.
function tenantPasswordMiddleware(req, res, next) {
  if (!isTenantMobileRole(req.user?.role)) {
    return res.status(403).json({ detail: 'Tenant access is required.' });
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
    const session = await db.collection('user_sessions').findOne({
      session_token: token,
      expires_at: { $gt: new Date() },
    });

    if (session?.user_id) {
      const user = await db.collection('users').findOne({ user_id: session.user_id });
      req.user = user && isAccountActive(user) ? normalizeUser(user) : null;
    } else {
      req.user = null;
    }
  } catch (_) {
    req.user = null;
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
};
