const { getDb } = require('../config/database');

// Authentication middleware
async function authMiddleware(req, res, next) {

  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.session_token;
  const queryToken = req.query?.token;

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (cookieToken) {
    token = cookieToken;
  } else if (queryToken) {
    token = queryToken;
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

    req.user = user;
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

module.exports = { authMiddleware, adminMiddleware };
