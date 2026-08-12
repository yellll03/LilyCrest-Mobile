const { getDb } = require('../config/database');
const { normalizeUser } = require('../utils/normalizeUser');

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

    req.user = normalizeUser(user);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
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

module.exports = { authMiddleware, adminMiddleware, optionalAuthMiddleware, isAccountActive };
