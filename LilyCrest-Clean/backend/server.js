require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Import configurations
const { connectToMongo } = require('./config/database');
const { initializeFirebase } = require('./config/firebase');
const { cacheMiddleware } = require('./middleware/cache');

// Import routes
const apiRoutes = require('./routes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 8001;

// NOTE: For production, add your actual frontend domain(s) here or to FRONTEND_URL env var.
const defaultOrigins = [
  process.env.FRONTEND_URL,
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
  return false;
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

app.use(express.json());
app.use(cookieParser());

// Rate limiting — general API (100 requests per minute per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many requests. Please try again shortly.' },
});
app.use('/api', apiLimiter);

// Stricter rate limit for chatbot (30 requests per minute per IP)
const chatbotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Chatbot rate limit reached. Please wait a moment.' },
});
app.use('/api/chatbot', chatbotLimiter);

// ETag cache for frequently read endpoints (60s TTL)
app.use('/api/announcements', cacheMiddleware(120));
app.use('/api/dashboard', cacheMiddleware(60));
app.use('/api/faqs', cacheMiddleware(300));
app.use('/api/rooms', cacheMiddleware(120));

// Register API routes
app.use('/api', apiRoutes);

// Start server
async function startServer() {
  // Initialize Firebase
  initializeFirebase();
  
  // Connect to MongoDB
  await connectToMongo();

  // Fix firebaseUid index: must be sparse to allow multiple docs without the field
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const users = db.collection('users');
    // Drop the non-sparse unique index if it exists
    const indexes = await users.indexes();
    for (const idx of indexes) {
      if (idx.key?.firebaseUid && idx.unique && !idx.sparse) {
        console.log(`[Migration] Dropping non-sparse unique index: ${idx.name}`);
        await users.dropIndex(idx.name);
      }
    }
    // Recreate as sparse unique (allows multiple docs without firebaseUid)
    await users.createIndex(
      { firebaseUid: 1 },
      { unique: true, sparse: true, name: 'firebaseUid_1_sparse' }
    );
    // Also ensure firebase_uid has a sparse index if needed
    const existingFbUidIdx = indexes.find(i => i.key?.firebase_uid && i.unique && !i.sparse);
    if (existingFbUidIdx) {
      console.log(`[Migration] Dropping non-sparse unique index: ${existingFbUidIdx.name}`);
      await users.dropIndex(existingFbUidIdx.name);
      await users.createIndex(
        { firebase_uid: 1 },
        { unique: true, sparse: true, name: 'firebase_uid_1_sparse' }
      );
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
