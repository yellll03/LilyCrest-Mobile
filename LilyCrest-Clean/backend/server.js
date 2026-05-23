require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const path = require('path');

// Import configurations
const { connectToMongo } = require('./config/database');
const { initializeFirebase } = require('./config/firebase');
const { cacheMiddleware } = require('./middleware/cache');

// Import routes
const apiRoutes = require('./routes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 8001;

function resolveTrustProxySetting() {
  const rawValue = String(
    process.env.TRUST_PROXY_HOPS
      ?? process.env.TRUST_PROXY
      ?? ''
  ).trim().toLowerCase();

  if (!rawValue) return null;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;

  const numericValue = Number.parseInt(rawValue, 10);
  if (Number.isInteger(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  return null;
}

// Only trust proxy headers when deployment explicitly opts in.
const trustProxySetting = resolveTrustProxySetting();
if (trustProxySetting !== null) {
  app.set('trust proxy', trustProxySetting);
}

// NOTE: For production, add your actual frontend domain(s) here or to FRONTEND_URL env var.
const defaultOrigins = [
  process.env.FRONTEND_URL,
  process.env.BACKEND_URL,
  'http://localhost:8081',
  'http://localhost:8083',
  'http://localhost:3000',
  'http://localhost:19006',
].filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
const privateNetworkOriginPattern = /^https?:\/\/(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)\d+\.\d+(?::\d+)?$/;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (defaultOrigins.includes(origin)) return true;
  if (!isProduction && privateNetworkOriginPattern.test(origin)) return true;
  // Allow same-server origin (browser pages served by this server making fetch calls back)
  const serverPort = process.env.PORT || 8001;
  if (origin === `http://localhost:${serverPort}` || origin === `https://localhost:${serverPort}`) return true;
  return false;
}

function oncePerRequest(middleware, flag) {
  return (req, res, next) => {
    if (req[flag]) return next();
    req[flag] = true;
    return middleware(req, res, next);
  };
}

function noStorePrivateApiResponses(_req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return next();
}

// Middleware - CORS Configuration
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'If-None-Match'],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'ETag', 'X-Cache'],
  maxAge: 86400
}));

// Allow base64-encoded maintenance progress photos in admin status updates.
// The `verify` callback preserves the raw body buffer so the PayMongo webhook
// handler can compute and verify the HMAC-SHA256 signature.
app.use(express.json({
  limit: '30mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(cookieParser());

// Rate limiting — general API (100 requests per minute per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many requests. Please try again shortly.' },
});
const apiLimiterOnce = oncePerRequest(apiLimiter, '__apiLimiterApplied');
app.use('/api', apiLimiterOnce);
app.use('/api/m', apiLimiterOnce);

// Stricter rate limit for chatbot (30 requests per minute per IP)
const chatbotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Chatbot rate limit reached. Please wait a moment.' },
});
const chatbotLimiterOnce = oncePerRequest(chatbotLimiter, '__chatbotLimiterApplied');
app.use('/api/chatbot', chatbotLimiterOnce);
app.use('/api/m/chatbot', chatbotLimiterOnce);

// Never cache authenticated tenant/private API responses before auth has run.
app.use([
  '/api/dashboard',
  '/api/m/dashboard',
  '/api/billing',
  '/api/m/billing',
  '/api/documents',
  '/api/m/documents',
  '/api/maintenance',
  '/api/m/maintenance',
  '/api/announcements',
  '/api/m/announcements',
], noStorePrivateApiResponses);

// ETag cache for public/frequently read endpoints.
app.use('/api/faqs', cacheMiddleware(300));
app.use('/api/rooms', cacheMiddleware(120));
app.use('/api/m/faqs', cacheMiddleware(300));
app.use('/api/m/rooms', cacheMiddleware(120));

// Register API routes — /api/m is the mobile-facing prefix (mirrors /api)
app.use('/api', apiRoutes);
app.use('/api/m', apiRoutes);

// Serve admin panel static files
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Validate required environment variables before anything else starts
function validateEnv() {
  const required = [
    'MONGO_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'PAYMONGO_SECRET_KEY',
  ];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(`[Config] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const optionalFeatureWarnings = [
    {
      name: 'PAYMONGO_WEBHOOK_SECRET',
      detail: 'Webhook signature verification is disabled outside production and will reject production calls until this is configured.',
    },
    {
      name: 'IMAGEKIT_PRIVATE_KEY',
      detail: 'ImageKit uploads will return a configuration error until this is configured.',
    },
  ];

  optionalFeatureWarnings.forEach(({ name, detail }) => {
    if (!process.env[name]) {
      console.warn(`[Config] ${name} is not set. ${detail}`);
    }
  });
}

async function ensureNotificationIndexes(notifications) {
  await notifications.createIndex(
    { user_id: 1, created_at: -1 },
    { name: 'user_id_created_at_desc' },
  );

  await notifications.updateMany(
    { event_key: '' },
    { $unset: { event_key: '' } },
  );
  await notifications.updateMany(
    {
      event_key: { $exists: true },
      $or: [
        { user_id: { $exists: false } },
        { user_id: null },
        { user_id: '' },
      ],
    },
    { $unset: { event_key: '' } },
  );

  const duplicateEventKeys = await notifications.aggregate([
    {
      $match: {
        user_id: { $exists: true, $nin: [null, ''] },
        event_key: { $exists: true, $type: 'string', $ne: '' },
      },
    },
    { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
    {
      $group: {
        _id: { user_id: '$user_id', event_key: '$event_key' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  for (const dupe of duplicateEventKeys) {
    const staleIds = dupe.ids.slice(1);
    if (!staleIds.length) continue;
    await notifications.updateMany(
      { _id: { $in: staleIds } },
      { $unset: { event_key: '' }, $set: { updated_at: new Date() } },
    );
  }

  const indexName = 'user_id_event_key_unique';
  const indexes = await notifications.indexes();
  const existingIndex = indexes.find((idx) => idx.name === indexName);
  const existingUserFilter = existingIndex?.partialFilterExpression?.user_id || {};
  const existingFilter = existingIndex?.partialFilterExpression?.event_key || {};
  const hasSupportedFilter = existingUserFilter.$exists === true
    && existingUserFilter.$type === 'string'
    && existingFilter.$exists === true
    && existingFilter.$type === 'string'
    && !Object.prototype.hasOwnProperty.call(existingFilter, '$ne');

  if (existingIndex && (!existingIndex.unique || !hasSupportedFilter)) {
    await notifications.dropIndex(indexName);
  }

  await notifications.createIndex(
    { user_id: 1, event_key: 1 },
    {
      unique: true,
      partialFilterExpression: {
        user_id: { $exists: true, $type: 'string' },
        event_key: { $exists: true, $type: 'string' },
      },
      name: indexName,
    },
  );
}

// Start server
async function startServer() {
  validateEnv();

  // Initialize Firebase
  initializeFirebase();
  
  // Connect to MongoDB
  await connectToMongo();

  // ── Index migration: fix unique indexes that cause E11000 crashes ──
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const users = db.collection('users');
    const notifications = db.collection('notifications');
    const migrationsCol = db.collection('migrations');

    // Always ensure the sparse unique index — createIndex is idempotent and fast.
    await users.createIndex(
      { firebase_uid: 1 },
      { unique: true, sparse: true, name: 'firebase_uid_1_sparse' },
    );
    await ensureNotificationIndexes(notifications);

    // Billing collection indexes (frequently queried)
    const billing = db.collection('billing');
    await billing.createIndex({ user_id: 1, created_at: -1 }, { name: 'billing_user_id_created_at' });
    await billing.createIndex({ user_id: 1, status: 1, due_date: -1 }, { name: 'billing_user_status_due_date' });
    await billing.createIndex({ billing_id: 1 }, { unique: true, sparse: true, name: 'billing_id_unique' });
    await billing.createIndex({ paymongo_checkout_id: 1 }, { sparse: true, name: 'billing_paymongo_checkout_id' });

    // Bills collection indexes
    const bills = db.collection('bills');
    await bills.createIndex({ userId: 1, createdAt: -1 }, { name: 'bills_userId_createdAt' });
    await bills.createIndex({ userId: 1, status: 1, dueDate: -1 }, { name: 'bills_userId_status_dueDate' });
    await bills.createIndex({ billing_id: 1 }, { sparse: true, name: 'bills_billing_id' });
    await bills.createIndex({ legacyBillingId: 1 }, { sparse: true, name: 'bills_legacyBillingId' });
    await bills.createIndex({ paymongoSessionId: 1 }, { sparse: true, name: 'bills_paymongoSessionId' });

    // Maintenance indexes for the canonical + legacy dual-read migration window.
    for (const collectionName of ['maintenance_requests', 'maintenancerequests']) {
      const maintenance = db.collection(collectionName);
      await maintenance.createIndex({ request_id: 1 }, { sparse: true, name: `${collectionName}_request_id` });
      await maintenance.createIndex({ user_id: 1, status: 1, created_at: -1 }, { name: `${collectionName}_user_status_created_at` });
      await maintenance.createIndex({ userId: 1, status: 1, createdAt: -1 }, { name: `${collectionName}_userId_status_createdAt` });
      await maintenance.createIndex({ user_id: 1, lastActivityAt: -1 }, { name: `${collectionName}_user_last_activity` });
      await maintenance.createIndex({ userId: 1, lastActivityAt: -1 }, { name: `${collectionName}_userId_last_activity` });
    }

    // TTL index: auto-expire OTP records after expires_at
    const otpStore = db.collection('otp_store');
    await otpStore.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'otp_ttl' });

    // TTL index: auto-expire sessions after expires_at
    const userSessions = db.collection('user_sessions');
    await userSessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'sessions_ttl' });
    await userSessions.createIndex({ user_id: 1 }, { name: 'sessions_user_id' });

    const migrationDone = await migrationsCol.findOne({ name: 'v1_index_migration', completed: true });
    if (migrationDone) {
      console.log('[Migration] Already completed — skipping heavy migration.');
    } else {
      console.log('[Migration] Running first-time migration...');

      const indexes = await users.indexes();
      for (const idx of indexes) {
        // Drop unique indexes on email/username — enforce uniqueness in app code instead
        if ((idx.key?.email || idx.key?.username) && idx.unique) {
          console.log(`[Migration] Dropping unique index: ${idx.name}`);
          try { await users.dropIndex(idx.name); } catch (_) {}
        }

        // Drop any legacy non-sparse unique indexes on firebaseUid or firebase_uid
        const isFirebaseIdx = idx.key?.firebaseUid || idx.key?.firebase_uid;
        if (isFirebaseIdx && idx.unique && !idx.sparse) {
          console.log(`[Migration] Dropping non-sparse index: ${idx.name}`);
          try { await users.dropIndex(idx.name); } catch (_) {}
        }
      }

      // Clear duplicate firebase_uid values before relying on the sparse unique index
      const dupes = await users.aggregate([
        { $match: { firebase_uid: { $exists: true, $ne: null } } },
        { $group: { _id: '$firebase_uid', count: { $sum: 1 }, ids: { $push: '$user_id' } } },
        { $match: { count: { $gt: 1 } } },
      ]).toArray();

      for (const dupe of dupes) {
        const relatedUsers = await users
          .find({ firebase_uid: dupe._id })
          .sort({ last_login: -1 })
          .toArray();
        for (let i = 1; i < relatedUsers.length; i++) {
          console.log(`[Migration] Clearing stale firebase_uid from ${relatedUsers[i].user_id}`);
          await users.updateOne(
            { user_id: relatedUsers[i].user_id },
            { $unset: { firebase_uid: '' } },
          );
        }
      }

      // Auto-generate user_id for any documents that don't have one
      // (Web admin may create tenants without user_id — mobile app requires it)
      const { v4: uuidv4 } = require('uuid');
      const missingUserIds = await users.find({
        $or: [
          { user_id: { $exists: false } },
          { user_id: null },
          { user_id: '' },
        ],
      }).toArray();

      for (const doc of missingUserIds) {
        const newUserId = `user_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
        await users.updateOne(
          { _id: doc._id },
          { $set: { user_id: newUserId } },
        );
        console.log(`[Migration] Generated user_id=${newUserId} for ${doc.email || doc.name || doc._id}`);
      }

      if (missingUserIds.length > 0) {
        console.log(`[Migration] Fixed ${missingUserIds.length} documents with missing user_id`);
      }

      await migrationsCol.insertOne({ name: 'v1_index_migration', completed: true, completedAt: new Date() });
      console.log('[Migration] Complete — flag saved to DB.');
    }
  } catch (idxErr) {
    console.warn('[Migration] Index migration warning:', idxErr?.message);
  }

  // Register PayMongo webhook (non-blocking)
  const { registerWebhook } = require('./controllers/paymongo.controller');
  registerWebhook().catch((err) => console.error('[PayMongo] Webhook setup error:', err.message));
  
  // Start Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('Backend: Node.js/Express');
    console.log('Auth: Firebase-only (Google + Email/Password)');
  });
}

startServer().catch(console.error);
