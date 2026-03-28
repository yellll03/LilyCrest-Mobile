const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { verifyFirebaseIdToken, verifyTenantInFirebase, admin } = require('../config/firebase');

const isProduction = process.env.NODE_ENV === 'production';

function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

const maskEmail = (email = '') => {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user.slice(0, 2)}***@${domain}`;
};

// Non-blocking audit: log every login attempt for security monitoring
async function logLoginAttempt(db, email, success, reason, req) {
  try {
    await db.collection('login_attempts').insertOne({
      email: (email || '').toLowerCase(),
      success,
      reason,
      ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      user_agent: req.headers['user-agent'] || 'unknown',
      timestamp: new Date(),
    });
  } catch (err) {
    console.warn('Failed to log login attempt:', err?.message);
  }
}

// Prefer explicit backend env var but allow a fallback to avoid silent failures.
function getFirebaseApiKey() {
  return process.env.FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || null;
}

// Firebase Google Sign-In
async function googleSignIn(req, res) {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ detail: 'Firebase ID token is required' });
    }

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseIdToken(idToken);
    } catch (error) {
      return res.status(401).json({ detail: 'Invalid Firebase ID token' });
    }

    const userEmail = decodedToken.email;
    const firebaseUid = decodedToken.uid;

    if (!userEmail) {
      return res.status(400).json({ detail: 'No email associated with this Google account' });
    }

    const db = getDb();
    const newSessionToken = `session_${uuidv4().replace(/-/g, '')}`;

    console.log(`[GoogleSignIn] Attempting login for Google email: ${userEmail}, Firebase UID: ${firebaseUid}`);

    // ── Lookup 1: by email or linked google_email (case-insensitive, non-admin) ──
    const emailRegexMatch = new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    let existingUser = await db.collection('users').findOne({
      $or: [
        { email: emailRegexMatch },
        { google_email: emailRegexMatch },
      ],
      role: { $nin: ['admin', 'superadmin'] },
    });

    if (existingUser) {
      console.log(`[GoogleSignIn] ✓ Found tenant by email/google_email match: ${existingUser.user_id}`);
    }

    // ── Lookup 2: by firebaseUid (non-admin) ──
    if (!existingUser) {
      existingUser = await db.collection('users').findOne({
        $or: [
          { firebaseUid },
          { firebase_uid: firebaseUid },
        ],
        role: { $nin: ['admin', 'superadmin'] },
      });
      if (existingUser) {
        console.log(`[GoogleSignIn] ✓ Found tenant by firebaseUid: ${existingUser.user_id}`);
      }
    }

    // ── Lookup 3: active session fallback ──
    // If the user has an active Bearer token (e.g., from a prior email/password login),
    // link their Google account to that existing tenant record.
    if (!existingUser) {
      const authHeader = req.headers.authorization;
      const cookieToken = req.cookies?.session_token;
      const bearerToken = (authHeader && authHeader.startsWith('Bearer '))
        ? authHeader.substring(7)
        : cookieToken;

      console.log(`[GoogleSignIn] No email/UID match. Checking for active session token: ${bearerToken ? 'present' : 'absent'}`);

      if (bearerToken) {
        const session = await db.collection('user_sessions').findOne({
          session_token: bearerToken,
          expires_at: { $gt: new Date() },
        });
        if (session) {
          const sessionUser = await db.collection('users').findOne({
            user_id: session.user_id,
            role: { $nin: ['admin', 'superadmin'] },
          });
          if (sessionUser) {
            console.log(`[GoogleSignIn] ✓ Linking Google account (${userEmail}) to tenant ${sessionUser.user_id} via active session`);
            existingUser = sessionUser;
          } else {
            console.log(`[GoogleSignIn] ✗ Session user ${session.user_id} is admin or not found`);
          }
        } else {
          console.log(`[GoogleSignIn] ✗ No valid session found for bearer token`);
        }
      }
    }


    // ── Not found — user is not a verified tenant ──
    if (!existingUser) {
      console.log(`[GoogleSignIn] ✗ All lookups failed for ${userEmail}. Returning 403.`);
      return res.status(403).json({
        detail: 'Access denied. Your Google account is not registered as a verified tenant. Please contact the admin office.',
      });
    }

    if (Object.prototype.hasOwnProperty.call(existingUser, 'is_active') && !existingUser.is_active) {
      return res.status(403).json({
        detail: 'Access denied. Your tenant account is inactive. Please contact admin.',
      });
    }

    const finalUserId = existingUser.user_id;

    // Remove firebaseUid from ALL documents globally to guarantee the unique index
    // is clear before we assign it to the current user.
    await db.collection('users').updateMany(
      { $or: [{ firebaseUid: firebaseUid }, { firebase_uid: firebaseUid }] },
      { $unset: { firebaseUid: '', firebase_uid: '' } }
    );

    // Determine the correct username for this tenant
    const tenantEmailPrefix = userEmail.split('@')[0];
    const resolvedUsername = existingUser.username || tenantEmailPrefix;

    // Update profile with Google identity data
    await db.collection('users').updateOne(
      { _id: existingUser._id },
      {
        $set: {
          email: userEmail,
          google_email: userEmail,
          name: decodedToken.name || existingUser.name || tenantEmailPrefix,
          picture: decodedToken.picture || existingUser.picture || null,
          phone: decodedToken.phoneNumber || existingUser.phone || null,
          role: existingUser.role || 'resident',
          last_login: new Date(),
          firebaseUid,
          firebase_uid: firebaseUid,
          username: resolvedUsername,
        },
      }
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.collection('user_sessions').deleteMany({ user_id: finalUserId });
    await db.collection('user_sessions').insertOne({
      user_id: finalUserId,
      session_token: newSessionToken,
      expires_at: expiresAt,
      created_at: new Date()
    });

    res.cookie('session_token', newSessionToken, buildSessionCookieOptions());

    const user = await db.collection('users').findOne({ user_id: finalUserId }, { projection: { _id: 0 } });
    res.json({ user, session_token: newSessionToken });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ detail: 'Authentication service error' });
  }
}

// Register new user with Email/Password
async function register(req, res) {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password) {
      return res.status(400).json({ detail: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ detail: 'Password must be at least 8 characters' });
    }

    // Create user in Firebase Auth via Identity Toolkit (avoids admin credential issues)
    const firebaseApiKey = getFirebaseApiKey();
    if (!firebaseApiKey) {
      return res.status(500).json({ detail: 'Firebase API key not configured on backend' });
    }

    let firebaseUid;
    try {
      const response = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseApiKey}`,
        {
          email,
          password,
          returnSecureToken: true,
        }
      );
      firebaseUid = response.data.localId;
    } catch (firebaseError) {
      const errorMessage = firebaseError.response?.data?.error?.message;
      if (errorMessage === 'EMAIL_EXISTS') {
        return res.status(400).json({ detail: 'Email already registered' });
      }
      console.error('Firebase user creation error:', firebaseError);
      return res.status(500).json({ detail: 'Failed to create user account' });
    }

    // Create user in MongoDB
    const db = getDb();
    const userId = `user_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const sessionToken = `session_${uuidv4().replace(/-/g, '')}`;

    const newUser = {
      user_id: userId,
      email,
      name: name || email.split('@')[0],
      phone: phone || null,
      picture: null,
      role: 'resident',
      // Store both casing variants to satisfy existing unique index on firebaseUid
      firebaseUid,
      firebase_uid: firebaseUid,
      created_at: new Date(),
      last_login: new Date(),
      username: email // Ensure username is unique and non-null
    };

    await db.collection('users').insertOne(newUser);

    // Create session
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.collection('user_sessions').insertOne({
      user_id: userId,
      session_token: sessionToken,
      expires_at: expiresAt,
      created_at: new Date()
    });

    res.cookie('session_token', sessionToken, buildSessionCookieOptions());

    const user = await db.collection('users').findOne({ user_id: userId }, { projection: { _id: 0 } });
    res.status(201).json({ user, session_token: sessionToken });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ detail: 'Registration failed' });
  }
}

// Email/Password Login via Firebase
async function login(req, res) {
  try {
    const emailInput = typeof req.body?.email === 'string' ? req.body.email : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const email = emailInput.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !password) {
      return res.status(400).json({ detail: 'Email and password are required' });
    }

    if (!emailRegex.test(email)) {
      return res.status(400).json({ detail: 'Please provide a valid email address' });
    }

    if (email.length > 254) {
      return res.status(400).json({ detail: 'Email address is too long' });
    }

    // Accept 6+ for login (backward compat with Firebase-reset passwords);
    // frontend enforces 8+ for new passwords/registrations.
    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({ detail: 'Password must be 6 to 128 characters long' });
    }

    // First, try to authenticate with Firebase
    const firebaseApiKey = getFirebaseApiKey();
    let firebaseUid;
    
    if (!firebaseApiKey) {
      return res.status(500).json({ detail: 'Firebase API key not configured on backend' });
    }

    try {
      const response = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
        { email, password, returnSecureToken: true }
      );
      firebaseUid = response.data.localId;
    } catch (firebaseError) {
      const errorMessage = firebaseError.response?.data?.error?.message || 'INVALID_CREDENTIALS';

      // If user not found in Firebase, check if they exist in MongoDB (admin-provisioned tenant)
      if (errorMessage.includes('EMAIL_NOT_FOUND')) {
        const db = getDb();
        const emailRegexMatch = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const mongoUser = await db.collection('users').findOne({ email: emailRegexMatch });

        if (mongoUser) {
          // Tenant exists in MongoDB but not in Firebase — auto-create Firebase account
          console.log(`[Login] Auto-creating Firebase account for existing tenant: ${mongoUser.user_id} (${email})`);
          try {
            // Create the Firebase Auth account with the password they entered
            const createResp = await axios.post(
              `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseApiKey}`,
              { email, password, returnSecureToken: true }
            );
            firebaseUid = createResp.data.localId;
            console.log(`[Login] ✓ Firebase account created for ${email}, UID: ${firebaseUid}`);
          } catch (createErr) {
            const createMsg = createErr.response?.data?.error?.message || '';
            if (createMsg === 'EMAIL_EXISTS') {
              // Race condition or email casing difference — try signing in again
              try {
                const retryResp = await axios.post(
                  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
                  { email, password, returnSecureToken: true }
                );
                firebaseUid = retryResp.data.localId;
              } catch {
                return res.status(401).json({ detail: 'Invalid email or password' });
              }
            } else {
              console.error('[Login] Failed to auto-create Firebase account:', createMsg);
              return res.status(401).json({ detail: 'Invalid email or password' });
            }
          }
        } else {
          // No MongoDB record either — genuinely not found
          logLoginAttempt(getDb(), email, false, 'user_not_found', req);
          return res.status(401).json({ detail: 'Invalid email or password' });
        }
      } else if (errorMessage.includes('INVALID_PASSWORD') || errorMessage.includes('INVALID_LOGIN_CREDENTIALS')) {
        logLoginAttempt(getDb(), email, false, 'invalid_password', req);
        return res.status(401).json({ detail: 'Invalid email or password' });
      } else if (errorMessage.includes('USER_DISABLED')) {
        logLoginAttempt(getDb(), email, false, 'user_disabled', req);
        return res.status(403).json({ detail: 'This account has been disabled' });
      } else if (errorMessage.includes('TOO_MANY_ATTEMPTS')) {
        logLoginAttempt(getDb(), email, false, 'too_many_attempts', req);
        return res.status(429).json({ detail: 'Too many failed attempts. Please try again later.' });
      } else {
        logLoginAttempt(getDb(), email, false, 'unknown_firebase_error', req);
        return res.status(401).json({ detail: 'Invalid email or password' });
      }
    }

    const db = getDb();
    const sessionToken = `session_${uuidv4().replace(/-/g, '')}`;
    // Case-insensitive email lookup to handle mixed-case records
    const emailRegexMatch = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    let existingUser = await db.collection('users').findOne({
      email: emailRegexMatch,
      role: { $nin: ['admin', 'superadmin'] },
    });

    // Not found — user is not a verified tenant
    if (!existingUser) {
      logLoginAttempt(db, email, false, 'not_tenant', req);
      return res.status(403).json({ detail: 'Access denied. Your account is not registered as a verified tenant. Please contact the admin office.' });
    }

    if (Object.prototype.hasOwnProperty.call(existingUser, 'is_active') && !existingUser.is_active) {
      logLoginAttempt(db, email, false, 'inactive_tenant', req);
      return res.status(403).json({ detail: 'Access denied. Your tenant account is inactive. Please contact admin.' });
    }

    const userId = existingUser.user_id;

    // Remove firebaseUid from ALL documents globally to guarantee the unique index
    // is clear before we assign it to the current user.
    if (firebaseUid) {
      await db.collection('users').updateMany(
        { $or: [{ firebaseUid: firebaseUid }, { firebase_uid: firebaseUid }] },
        { $unset: { firebaseUid: '', firebase_uid: '' } }
      );
    }

    await db.collection('users').updateOne(
      { user_id: userId },
      { $set: {
        firebase_uid: firebaseUid,
        firebaseUid,
        last_login: new Date(),
      }}
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.collection('user_sessions').deleteMany({ user_id: userId });
    await db.collection('user_sessions').insertOne({
      user_id: userId,
      session_token: sessionToken,
      expires_at: expiresAt,
      created_at: new Date()
    });

    res.cookie('session_token', sessionToken, buildSessionCookieOptions());

    const user = await db.collection('users').findOne({ user_id: userId }, { projection: { _id: 0 } });
    logLoginAttempt(db, email, true, 'success', req);
    res.json({ user, session_token: sessionToken });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Authentication service error' });
  }
}

// Get current user
async function getMe(req, res) {
  const { _id, ...user } = req.user;
  res.json(user);
}

// Logout
async function logout(req, res) {
  try {
    const db = getDb();
    await db.collection('user_sessions').deleteMany({ user_id: req.user.user_id });
    res.clearCookie('session_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/'
    });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ detail: 'Logout failed' });
  }
}

// Change Password
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body;
    const userEmail = req.user.email;

    if (!current_password || !new_password) {
      return res.status(400).json({ detail: 'Current password and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ detail: 'New password must be at least 8 characters' });
    }

    const firebaseApiKey = getFirebaseApiKey();
    try {
      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
        { email: userEmail, password: current_password, returnSecureToken: false }
      );
    } catch (error) {
      return res.status(401).json({ detail: 'Current password is incorrect' });
    }

    await admin.auth().updateUser(req.user.firebase_uid, { password: new_password });

    // Notify via email (uses Firebase's password reset template as a security alert)
    try {
      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseApiKey}`,
        { requestType: 'PASSWORD_RESET', email: userEmail }
      );
    } catch (notifyErr) {
      console.warn('Password change email alert failed:', notifyErr?.response?.data?.error?.message || notifyErr?.message);
    }

    // Add an in-app announcement/notification for audit visibility
    try {
      const db = getDb();
      const announcementId = `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      const masked = maskEmail(userEmail.trim().toLowerCase());
      await db.collection('announcements').insertOne({
        announcement_id: announcementId,
        title: 'Password changed',
        content: `Your password was updated for ${masked}. If this wasn\'t you, reset your password immediately or contact admin.`,
        category: 'Security',
        priority: 'high',
        author_id: 'system',
        user_id: req.user?.user_id,
        is_private: true,
        is_active: true,
        created_at: new Date(),
      });
    } catch (announceErr) {
      console.warn('Password change announcement not created:', announceErr?.message);
    }

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ detail: 'Failed to change password. Please try again.' });
  }
}

// Forgot Password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ detail: 'Email is required' });
    }

    // Always perform the same work regardless of user existence to prevent timing side-channel
    const tenantData = await verifyTenantInFirebase(email);

    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    if (tenantData && firebaseApiKey) {
      try {
        await axios.post(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseApiKey}`,
          { requestType: 'PASSWORD_RESET', email }
        );
      } catch (resetErr) {
        console.warn('Password reset email not sent:', resetErr?.message);
      }
    }

    // Always create announcement (with masked email) to normalize response time
    try {
      const db = getDb();
      const announcementId = `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
      const masked = maskEmail(email.trim().toLowerCase());
      await db.collection('announcements').insertOne({
        announcement_id: announcementId,
        title: 'Password reset requested',
        content: `We received a password reset request for ${masked}. If this was you, please check your email for the reset link. If not, ignore this notice or contact admin immediately.`,
        category: 'Account',
        priority: 'normal',
        author_id: 'system',
        is_active: tenantData ? true : false,
        created_at: new Date(),
      });
    } catch (announceErr) {
      console.warn('Forgot password announcement not created:', announceErr?.message);
    }

    res.json({ message: 'If your email is registered, you will receive a password reset link.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.json({ message: 'If your email is registered, you will receive a password reset link.' });
  }
}

module.exports = {
  googleSignIn,
  register,
  login,
  getMe,
  logout,
  changePassword,
  forgotPassword
};
