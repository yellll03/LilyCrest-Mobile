const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { verifyFirebaseIdToken, verifyTenantInFirebase, admin } = require('../config/firebase');

// ─── HELPERS ────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

function firebaseApiKey() {
  return process.env.FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || null;
}

function generateUserId() {
  return `user_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

function generateSessionToken() {
  return `session_${uuidv4().replace(/-/g, '')}`;
}

function maskEmail(email = '') {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return user.length <= 2 ? `${user[0]}***@${domain}` : `${user.slice(0, 2)}***@${domain}`;
}

/** Case-insensitive regex for exact email match */
function emailRegex(email) {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

/** Create a new session and return { session_token, expires_at } */
async function createSession(db, userId) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Remove old sessions for this user (single-session model)
  await db.collection('user_sessions').deleteMany({ user_id: userId });
  await db.collection('user_sessions').insertOne({
    user_id: userId,
    session_token: token,
    expires_at: expiresAt,
    created_at: new Date(),
  });

  return { session_token: token, expires_at: expiresAt };
}

/** Non-blocking audit log */
async function logAttempt(db, email, success, reason, req) {
  try {
    await db.collection('login_attempts').insertOne({
      email: (email || '').toLowerCase(),
      success,
      reason,
      ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      user_agent: req.headers['user-agent'] || 'unknown',
      timestamp: new Date(),
    });
  } catch (_) {
    /* audit failure is non-critical */
  }
}

/** Look up a non-admin tenant by email */
async function findTenantByEmail(db, email) {
  return db.collection('users').findOne({
    $or: [
      { email: emailRegex(email) },
      { google_email: emailRegex(email) },
    ],
    role: { $nin: ['admin', 'superadmin'] },
  });
}

/** Normalize camelCase admin-panel fields to the snake_case the app expects */
function normalizeUser(doc) {
  if (!doc) return doc;
  const u = { ...doc };
  if (!u.name && u.fullName) u.name = u.fullName;
  if (!u.email && u.emailAddress) u.email = u.emailAddress;
  if (!u.phone && (u.contactNumber || u.phoneNumber)) u.phone = u.contactNumber || u.phoneNumber;
  if (!u.username && u.email) u.username = u.email.split('@')[0];
  return u;
}

/** Return user object without MongoDB _id */
async function getCleanUser(db, userId) {
  const doc = await db.collection('users').findOne(
    { user_id: userId },
    { projection: { _id: 0 } },
  );
  return normalizeUser(doc);
}

// ─── EMAIL / PASSWORD LOGIN ─────────────────────────────────────────────────

async function login(req, res) {
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  // Input validation
  if (!emailRaw || !password) {
    return res.status(400).json({ detail: 'Email and password are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) || emailRaw.length > 254) {
    return res.status(400).json({ detail: 'Please provide a valid email address' });
  }
  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ detail: 'Password must be 6 to 128 characters long' });
  }

  const apiKey = firebaseApiKey();
  if (!apiKey) {
    return res.status(500).json({ detail: 'Firebase API key not configured on backend' });
  }

  const db = getDb();
  let fbUid;

  // Step 1: Authenticate with Firebase
  try {
    const resp = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email: emailRaw, password, returnSecureToken: true },
    );
    fbUid = resp.data.localId;
  } catch (fbErr) {
    const msg = fbErr.response?.data?.error?.message || '';

    if (msg.includes('EMAIL_NOT_FOUND')) {
      // Tenant might exist in MongoDB but not Firebase (admin-provisioned)
      const mongoUser = await findTenantByEmail(db, emailRaw);
      if (mongoUser) {
        // Don't create Firebase accounts for inactive tenants
        if (mongoUser.is_active === false) {
          logAttempt(db, emailRaw, false, 'inactive', req);
          return res.status(403).json({ detail: 'Access denied. Your tenant account is inactive. Please contact admin.' });
        }
        console.log(`[Login] Auto-creating Firebase account for tenant: ${mongoUser.user_id}`);
        try {
          const createResp = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
            { email: emailRaw, password, returnSecureToken: true },
          );
          fbUid = createResp.data.localId;
        } catch (createErr) {
          const cMsg = createErr.response?.data?.error?.message || '';
          if (cMsg === 'EMAIL_EXISTS') {
            // Edge case: try sign-in again (casing difference)
            try {
              const retry = await axios.post(
                `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
                { email: emailRaw, password, returnSecureToken: true },
              );
              fbUid = retry.data.localId;
            } catch {
              logAttempt(db, emailRaw, false, 'firebase_retry_failed', req);
              return res.status(401).json({ detail: 'Invalid email or password' });
            }
          } else {
            logAttempt(db, emailRaw, false, 'firebase_create_failed', req);
            return res.status(401).json({ detail: 'Invalid email or password' });
          }
        }
      } else {
        logAttempt(db, emailRaw, false, 'not_tenant', req);
        return res.status(403).json({
          detail: 'Access denied. Your account is not registered as a verified tenant. Please contact the admin office.',
        });
      }
    } else if (msg.includes('INVALID_PASSWORD') || msg.includes('INVALID_LOGIN_CREDENTIALS')) {
      // Check MongoDB before responding — if the account is inactive or not a tenant,
      // return the correct 403 instead of a generic 401.
      // This also covers Google-only accounts attempting email/password login.
      const mongoUser = await findTenantByEmail(db, emailRaw);
      if (!mongoUser) {
        // Has a Firebase account but is not in our system as a tenant
        logAttempt(db, emailRaw, false, 'not_tenant', req);
        return res.status(403).json({
          detail: 'Access denied. Your account is not registered as a verified tenant. Please contact the admin office.',
        });
      }
      if (mongoUser.is_active === false) {
        logAttempt(db, emailRaw, false, 'inactive', req);
        return res.status(403).json({ detail: 'Access denied. Your tenant account is inactive. Please contact admin.' });
      }
      // User is an active tenant but the password is genuinely wrong
      logAttempt(db, emailRaw, false, 'invalid_password', req);
      return res.status(401).json({ detail: 'Invalid email or password' });
    } else if (msg.includes('USER_DISABLED')) {
      logAttempt(db, emailRaw, false, 'user_disabled', req);
      return res.status(403).json({ detail: 'This account has been disabled' });
    } else if (msg.includes('TOO_MANY_ATTEMPTS')) {
      logAttempt(db, emailRaw, false, 'too_many_attempts', req);
      return res.status(429).json({ detail: 'Too many failed attempts. Please try again later.' });
    } else {
      logAttempt(db, emailRaw, false, 'firebase_error', req);
      return res.status(401).json({ detail: 'Invalid email or password' });
    }
  }

  // Step 2: Find MongoDB tenant by exact email (NOT google_email — that's for Google sign-in only)
  const tenant = await db.collection('users').findOne({
    email: emailRegex(emailRaw),
    role: { $nin: ['admin', 'superadmin'] },
  });
  if (!tenant) {
    logAttempt(db, emailRaw, false, 'not_tenant', req);
    return res.status(403).json({
      detail: 'Access denied. Your account is not registered as a verified tenant. Please contact the admin office.',
    });
  }

  if (!tenant.user_id) {
    console.error(`[Login] CRITICAL: Tenant document missing user_id! email=${tenant.email} _id=${tenant._id}`);
    return res.status(500).json({ detail: 'Account configuration error. Please contact the admin office.' });
  }

  if (tenant.is_active === false) {
    logAttempt(db, emailRaw, false, 'inactive', req);
    return res.status(403).json({ detail: 'Access denied. Your tenant account is inactive. Please contact admin.' });
  }

  console.log(`[Login] Tenant found: user_id=${tenant.user_id} email=${tenant.email} name=${tenant.name}`);

  // Step 3: Link Firebase UID and update last_login
  // Clear stale firebase_uid from any OTHER user first (prevents E11000)
  await db.collection('users').updateMany(
    { firebase_uid: fbUid, user_id: { $ne: tenant.user_id } },
    { $unset: { firebase_uid: '' } },
  );
  try {
    await db.collection('users').updateOne(
      { user_id: tenant.user_id },
      { $set: { firebase_uid: fbUid, last_login: new Date() } },
    );
  } catch (updateErr) {
    if (updateErr.code === 11000) {
      console.warn('[Login] Duplicate key on firebase_uid, proceeding without update');
      await db.collection('users').updateOne(
        { user_id: tenant.user_id },
        { $set: { last_login: new Date() } },
      );
    } else {
      throw updateErr;
    }
  }

  // Step 4: Generate OTP and send to email
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const otpToken = uuidv4();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Clear any existing OTP for this user
  await db.collection('otp_store').deleteMany({ user_id: tenant.user_id });
  await db.collection('otp_store').insertOne({
    otp_token: otpToken,
    otp_code: otpCode,
    user_id: tenant.user_id,
    email: emailRaw,
    attempts: 0,
    expires_at: otpExpiry,
    created_at: new Date(),
  });

  const { sendLoginOtpEmail } = require('../services/emailService');
  const emailSent = await sendLoginOtpEmail(emailRaw, tenant.name || 'Tenant', otpCode);
  if (!emailSent) {
    console.warn(`[Login] OTP email failed for user_id=${tenant.user_id} — proceeding anyway`);
  }

  logAttempt(db, emailRaw, true, 'otp_sent', req);
  console.log(`[Login] OTP sent for user_id=${tenant.user_id} email=${maskEmail(emailRaw)}`);
  res.json({
    otp_required: true,
    otp_token: otpToken,
    masked_email: maskEmail(emailRaw),
  });
}

// ─── VERIFY LOGIN OTP ───────────────────────────────────────────────────────

async function verifyOtp(req, res) {
  const { otp_token, otp_code } = req.body;

  if (!otp_token || !otp_code) {
    return res.status(400).json({ detail: 'Verification token and code are required.' });
  }

  const db = getDb();
  const record = await db.collection('otp_store').findOne({ otp_token });

  if (!record) {
    return res.status(400).json({ detail: 'Invalid or expired session. Please log in again.' });
  }

  if (new Date() > record.expires_at) {
    await db.collection('otp_store').deleteOne({ otp_token });
    return res.status(400).json({ detail: 'Verification code has expired. Please log in again.' });
  }

  if (record.attempts >= 3) {
    await db.collection('otp_store').deleteOne({ otp_token });
    return res.status(400).json({ detail: 'Too many incorrect attempts. Please log in again.' });
  }

  if (record.otp_code !== otp_code.trim()) {
    await db.collection('otp_store').updateOne({ otp_token }, { $inc: { attempts: 1 } });
    const remaining = 3 - (record.attempts + 1);
    const detail = remaining > 0
      ? `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      : 'Too many incorrect attempts. Please log in again.';
    if (remaining <= 0) await db.collection('otp_store').deleteOne({ otp_token });
    return res.status(400).json({ detail, attempts_remaining: remaining });
  }

  // Valid — delete OTP and create session
  await db.collection('otp_store').deleteOne({ otp_token });

  const session = await createSession(db, record.user_id);
  res.cookie('session_token', session.session_token, cookieOptions());

  const user = await getCleanUser(db, record.user_id);
  logAttempt(db, record.email, true, 'success', req);
  console.log(`[VerifyOtp] ✓ user_id=${record.user_id}`);
  res.json({ user, session_token: session.session_token });
}

// ─── RESEND LOGIN OTP ───────────────────────────────────────────────────────

async function resendOtp(req, res) {
  const { otp_token } = req.body;

  if (!otp_token) {
    return res.status(400).json({ detail: 'OTP token is required.' });
  }

  const db = getDb();
  const record = await db.collection('otp_store').findOne({ otp_token });

  if (!record || new Date() > record.expires_at) {
    return res.status(400).json({ detail: 'Session expired. Please log in again.' });
  }

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  const newExpiry = new Date(Date.now() + 10 * 60 * 1000);

  await db.collection('otp_store').updateOne(
    { otp_token },
    { $set: { otp_code: newCode, attempts: 0, expires_at: newExpiry } },
  );

  const { sendLoginOtpEmail } = require('../services/emailService');
  const sent = await sendLoginOtpEmail(record.email, 'Tenant', newCode);
  if (!sent) {
    return res.status(500).json({ detail: 'Failed to send verification code. Please try again.' });
  }

  console.log(`[ResendOtp] New OTP sent for user_id=${record.user_id}`);
  res.json({ message: 'A new verification code has been sent to your email.' });
}

// ─── GOOGLE SIGN-IN ─────────────────────────────────────────────────────────

async function googleSignIn(req, res) {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ detail: 'Firebase ID token is required' });
    }

    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(idToken);
    } catch {
      return res.status(401).json({ detail: 'Invalid Firebase ID token' });
    }

    const email = decoded.email;
    const fbUid = decoded.uid;
    if (!email) {
      return res.status(400).json({ detail: 'No email associated with this Google account' });
    }

    const db = getDb();
    console.log(`[GoogleSignIn] Login attempt: ${email}`);

    // Lookup — ordered by precision to avoid cross-user contamination
    // 1. Exact email match (most reliable)
    let tenant = await db.collection('users').findOne({
      email: emailRegex(email),
      role: { $nin: ['admin', 'superadmin'] },
    });
    if (tenant) {
      console.log(`[GoogleSignIn] Found by email: ${tenant.user_id} (${tenant.email})`);
    }

    // 2. google_email match (secondary)
    if (!tenant) {
      tenant = await db.collection('users').findOne({
        google_email: emailRegex(email),
        role: { $nin: ['admin', 'superadmin'] },
      });
      if (tenant) console.log(`[GoogleSignIn] Found by google_email: ${tenant.user_id} (${tenant.email})`);
    }

    // 3. firebase_uid match (last resort)
    if (!tenant) {
      tenant = await db.collection('users').findOne({
        firebase_uid: fbUid,
        role: { $nin: ['admin', 'superadmin'] },
      });
      if (tenant) console.log(`[GoogleSignIn] Found by firebase_uid: ${tenant.user_id} (${tenant.email})`);
    }

    // Not found → not a registered tenant
    if (!tenant) {
      console.log(`[GoogleSignIn] Not found: ${email}`);
      return res.status(403).json({
        detail: 'Access denied. Your Google account is not registered as a verified tenant. Please contact the admin office.',
      });
    }

    if (tenant.is_active === false) {
      return res.status(403).json({
        detail: 'Access denied. Your tenant account is inactive. Please contact admin.',
      });
    }

    if (!tenant.user_id) {
      console.error(`[GoogleSignIn] CRITICAL: Tenant document missing user_id! email=${tenant.email} _id=${tenant._id}`);
      return res.status(500).json({ detail: 'Account configuration error. Please contact the admin office.' });
    }

    // Clear stale firebase_uid from any OTHER user first (prevents E11000)
    await db.collection('users').updateMany(
      { firebase_uid: fbUid, user_id: { $ne: tenant.user_id } },
      { $unset: { firebase_uid: '' } },
    );

    // Build update — only set email if it won't conflict with another user
    const updateFields = {
      google_email: email,
      name: decoded.name || tenant.name || email.split('@')[0],
      picture: decoded.picture || tenant.picture || null,
      firebase_uid: fbUid,
      last_login: new Date(),
    };

    // Only update email if this tenant already owns it (was found by email match)
    const tenantEmail = (tenant.email || '').toLowerCase();
    if (tenantEmail === email.toLowerCase()) {
      updateFields.email = email;
    }

    try {
      await db.collection('users').updateOne(
        { user_id: tenant.user_id },
        { $set: updateFields },
      );
    } catch (updateErr) {
      if (updateErr.code === 11000) {
        // Duplicate key — strip conflicting fields and retry
        console.warn('[GoogleSignIn] Duplicate key, retrying without email/firebase_uid');
        delete updateFields.email;
        delete updateFields.firebase_uid;
        await db.collection('users').updateOne(
          { user_id: tenant.user_id },
          { $set: updateFields },
        );
      } else {
        throw updateErr;
      }
    }

    // Create session
    const session = await createSession(db, tenant.user_id);
    res.cookie('session_token', session.session_token, cookieOptions());

    const user = await getCleanUser(db, tenant.user_id);
    console.log(`[GoogleSignIn] ✓ user_id=${tenant.user_id} email=${user?.email} name=${user?.name}`);
    res.json({ user, session_token: session.session_token });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ detail: 'Authentication service error' });
  }
}

// ─── REGISTER ───────────────────────────────────────────────────────────────

async function register(req, res) {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password) {
      return res.status(400).json({ detail: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ detail: 'Password must be at least 8 characters' });
    }

    const apiKey = firebaseApiKey();
    if (!apiKey) {
      return res.status(500).json({ detail: 'Firebase API key not configured on backend' });
    }

    // Create Firebase account
    let fbUid;
    try {
      const resp = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
        { email, password, returnSecureToken: true },
      );
      fbUid = resp.data.localId;
    } catch (fbErr) {
      const msg = fbErr.response?.data?.error?.message;
      if (msg === 'EMAIL_EXISTS') {
        return res.status(400).json({ detail: 'Email already registered' });
      }
      console.error('Firebase registration error:', fbErr);
      return res.status(500).json({ detail: 'Failed to create user account' });
    }

    // Create MongoDB user
    const db = getDb();
    const userId = generateUserId();

    await db.collection('users').insertOne({
      user_id: userId,
      email,
      name: name || email.split('@')[0],
      phone: phone || null,
      picture: null,
      role: 'resident',
      firebase_uid: fbUid,
      username: email,
      created_at: new Date(),
      last_login: new Date(),
    });

    // Create session
    const session = await createSession(db, userId);
    res.cookie('session_token', session.session_token, cookieOptions());

    const user = await getCleanUser(db, userId);
    res.status(201).json({ user, session_token: session.session_token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ detail: 'Registration failed' });
  }
}

// ─── GET CURRENT USER ───────────────────────────────────────────────────────

async function getMe(req, res) {
  const { _id, ...user } = req.user;
  res.json(user);
}

// ─── LOGOUT ─────────────────────────────────────────────────────────────────

async function logout(req, res) {
  try {
    const db = getDb();
    await db.collection('user_sessions').deleteMany({ user_id: req.user.user_id });
    res.clearCookie('session_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ detail: 'Logout failed' });
  }
}

// ─── CHANGE PASSWORD ────────────────────────────────────────────────────────

// Common weak passwords to reject (top offenders)
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  '1234567890', 'qwerty123', 'abc12345', 'iloveyou', 'sunshine',
  'princess', 'football', 'charlie', 'access14', 'trustno1',
  'letmein1', 'baseball', 'dragon12', 'master12', 'monkey12',
  'lilycrest', 'lilycrest1', 'lilycrest123', 'dormitory', 'tenant123',
]);

function validateNewPassword(password) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return ['New password is required'];
  }
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (password.length > 128) {
    errors.push('Password must be 128 characters or fewer');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/.test(password)) {
    errors.push('Password must contain at least one special character (e.g. !@#$%^&*)');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password is too common. Please choose a stronger one');
  }

  return errors;
}

async function changePassword(req, res) {
  try {
    const { current_password, new_password, notify_email, notify_app } = req.body;
    const userEmail = req.user.email;
    const userId = req.user.user_id;
    const userName = req.user.name || 'Tenant';
    const requestIp = req.ip || req.headers['x-forwarded-for'] || 'Unknown';

    // ── Input validation ──────────────────────────────────────────────────
    if (!current_password || !new_password) {
      return res.status(400).json({ detail: 'Current password and new password are required' });
    }

    // Server-side complexity checks (mirrors frontend rules)
    const validationErrors = validateNewPassword(new_password);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        detail: validationErrors[0],
        errors: validationErrors,
      });
    }

    // Prevent reusing the same password
    if (current_password === new_password) {
      return res.status(400).json({ detail: 'New password must be different from your current password' });
    }

    // ── Verify current password via Firebase ──────────────────────────────
    const apiKey = firebaseApiKey();
    if (!apiKey) {
      return res.status(500).json({ detail: 'Firebase API key not configured' });
    }

    try {
      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        { email: userEmail, password: current_password, returnSecureToken: false },
      );
    } catch (fbErr) {
      const msg = fbErr.response?.data?.error?.message || '';
      if (msg.includes('TOO_MANY_ATTEMPTS')) {
        return res.status(429).json({ detail: 'Too many attempts. Please try again later.' });
      }
      return res.status(401).json({ detail: 'Current password is incorrect' });
    }

    // ── Update password in Firebase ───────────────────────────────────────
    const uid = req.user.firebase_uid;
    if (!uid) {
      return res.status(400).json({ detail: 'No Firebase account linked. Cannot change password.' });
    }
    await admin.auth().updateUser(uid, { password: new_password });

    console.log(`[ChangePassword] ✓ Password updated for user_id=${userId} email=${maskEmail(userEmail)}`);

    const db = getDb();
    const changeTimestamp = new Date();

    // ── In-app audit announcement ─────────────────────────────────────────
    if (notify_app !== false) {
      try {
        await db.collection('announcements').insertOne({
          announcement_id: `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
          title: 'Password changed',
          content: `Your password was updated for ${maskEmail(userEmail)} on ${changeTimestamp.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' })}. If this wasn't you, reset your password immediately or contact admin.`,
          category: 'Security',
          priority: 'high',
          author_id: 'system',
          user_id: userId,
          is_private: true,
          is_active: true,
          created_at: changeTimestamp,
        });
      } catch (annErr) {
        console.warn('[ChangePassword] Announcement insert failed:', annErr?.message);
      }
    }

    // ── Email confirmation (non-blocking) ─────────────────────────────────
    if (notify_email !== false) {
      const { sendPasswordChangedEmail } = require('../services/emailService');
      sendPasswordChangedEmail(userEmail, userName, requestIp)
        .catch(err => console.warn('[ChangePassword] Email failed:', err?.message));
    }

    // ── Push notification (non-blocking) ──────────────────────────────────
    try {
      const { sendPushToUser } = require('../services/pushService');
      sendPushToUser(userId, {
        title: '🔒 Password Changed',
        body: 'Your LilyCrest account password was just updated. If this wasn\'t you, contact admin immediately.',
        data: { type: 'security_alert', action: 'password_changed' },
      }).catch(() => {});
    } catch (_) { /* push service may not be available */ }

    // ── Invalidate all existing sessions (force re-login with new password) ──
    try {
      await db.collection('user_sessions').deleteMany({ user_id: userId });
      console.log(`[ChangePassword] Sessions cleared for user_id=${userId}`);
    } catch (_) { /* non-critical */ }

    // ── Audit log entry ───────────────────────────────────────────────────
    try {
      await db.collection('login_attempts').insertOne({
        email: userEmail.toLowerCase(),
        success: true,
        reason: 'password_changed',
        ip: requestIp,
        user_agent: req.headers['user-agent'] || 'unknown',
        timestamp: changeTimestamp,
      });
    } catch (_) { /* non-critical */ }

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ detail: 'Failed to change password. Please try again.' });
  }
}

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────

async function forgotPassword(req, res) {
  // Always return same message to prevent email enumeration
  const successMsg = 'If your email is registered, you will receive a password reset link.';
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ detail: 'Email is required' });
    }

    const tenantData = await verifyTenantInFirebase(email);
    const apiKey = process.env.FIREBASE_API_KEY;

    if (tenantData && apiKey) {
      try {
        await axios.post(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
          { requestType: 'PASSWORD_RESET', email },
        );
      } catch (resetErr) {
        console.warn('Password reset email not sent:', resetErr?.message);
      }
    }

    // Audit log
    try {
      const db = getDb();
      await db.collection('announcements').insertOne({
        announcement_id: `ann_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
        title: 'Password reset requested',
        content: `We received a password reset request for ${maskEmail(email.trim().toLowerCase())}. If this was you, please check your email for the reset link.`,
        category: 'Account',
        priority: 'normal',
        author_id: 'system',
        user_id: tenantData?.user_id || null,
        is_private: true,
        is_active: !!tenantData,
        created_at: new Date(),
      });
    } catch (_) { /* non-critical */ }

    res.json({ message: successMsg });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.json({ message: successMsg });
  }
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  googleSignIn,
  register,
  login,
  verifyOtp,
  resendOtp,
  getMe,
  logout,
  changePassword,
  forgotPassword,
};
