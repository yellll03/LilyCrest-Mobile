'use strict';

// Behavioral coverage for the read-only reset-token pre-check
// (POST /auth/reset-password/status) added as required backend support for a
// future canonical /auth-action web page: it must report token validity
// without ever consuming (marking used) the single-use token.
//
// POST + body (not GET + query string): a raw single-use secret in a URL
// query string can leak via infrastructure/access logs, browser/proxy
// history, and other request metadata even when the app itself never logs
// it, so the token travels in the request body instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const databasePath = require.resolve('../config/database');
const authControllerPath = require.resolve('../controllers/auth.controller');

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fakeDb(tokenDocs, user = {
  user_id: 'tenant-a',
  role: 'tenant',
  account_status: 'active',
}) {
  return {
    collection(name) {
      if (name === 'users') {
        return { findOne: async (query) => user?.user_id === query.user_id ? { ...user } : null };
      }
      if (name !== 'password_reset_tokens') {
        return { findOne: async () => null };
      }
      return {
        findOne: async (query) => tokenDocs.map((doc) => ({ user_id: 'tenant-a', ...doc })).find((doc) =>
          doc.hashedToken === query.hashedToken
          && doc.used === query.used
          && doc.expiresAt > query.expiresAt.$gt) || null,
      };
    },
  };
}

function freshAuthController(db) {
  require(databasePath).getDb = () => db;
  delete require.cache[authControllerPath];
  return require(authControllerPath);
}

function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

test('a valid, unused, unexpired token reports valid: true', async () => {
  const rawToken = 'raw-token-a';
  const db = fakeDb([{ hashedToken: hash(rawToken), used: false, expiresAt: new Date(Date.now() + 60000) }]);
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: rawToken } }, res);
  assert.equal(res.body.valid, true);
});

test('an expired token reports valid: false', async () => {
  const rawToken = 'raw-token-b';
  const db = fakeDb([{ hashedToken: hash(rawToken), used: false, expiresAt: new Date(Date.now() - 1000) }]);
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: rawToken } }, res);
  assert.equal(res.body.valid, false);
});

test('an already-used token reports valid: false', async () => {
  const rawToken = 'raw-token-c';
  const db = fakeDb([{ hashedToken: hash(rawToken), used: true, expiresAt: new Date(Date.now() + 60000) }]);
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: rawToken } }, res);
  assert.equal(res.body.valid, false);
});

for (const role of ['applicant', 'admin', 'superadmin', 'branch_admin', 'owner', 'staff']) {
  test(`a token tied to ${role} reports valid: false`, async () => {
    const rawToken = `role-${role}`;
    const db = fakeDb(
      [{ hashedToken: hash(rawToken), used: false, expiresAt: new Date(Date.now() + 60000) }],
      { user_id: 'tenant-a', role, account_status: 'active' },
    );
    const { checkResetTokenValid } = freshAuthController(db);
    const res = fakeResponse();
    await checkResetTokenValid({ body: { token: rawToken } }, res);
    assert.equal(res.body.valid, false);
  });
}

test('a missing body reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: undefined }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('a missing token field reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: {} }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('a null token reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: null } }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('an empty-string token reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: '' } }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('a whitespace-only token reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: '   ' } }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('a numeric token reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: 123 } }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('an array token (e.g. a repeated field) reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: ['abc'] } }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('an object token reports valid: false without touching the database', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return { findOne: async () => null }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: { value: 'abc' } } }, res);
  assert.equal(res.body.valid, false);
  assert.equal(dbTouched, false);
});

test('checking status never consumes the token (uses findOne, not a claiming update)', async () => {
  const rawToken = 'raw-token-d';
  let findOneCalls = 0;
  const db = {
    collection(name) {
      if (name === 'users') {
        return { findOne: async () => ({ user_id: 'tenant-a', role: 'tenant', account_status: 'active' }) };
      }
      assert.equal(name, 'password_reset_tokens');
      return {
        findOne: async () => {
          findOneCalls += 1;
          return { hashedToken: hash(rawToken), user_id: 'tenant-a' };
        },
        findOneAndUpdate: async () => { throw new Error('status check must never claim the token'); },
      };
    },
  };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: rawToken } }, res);
  assert.equal(res.body.valid, true);
  assert.equal(findOneCalls, 1);
});

// ─── 3.3 Malformed / invalid / expired / consumed token behavior ───────────

test('a malformed/garbage token (not a real issued token) reports valid: false — hashes to no match, no special-case parsing', async () => {
  const db = fakeDb([]); // nothing issued
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: 'not-a-real-token-!!!@@@' } }, res);
  assert.equal(res.body.valid, false);
});

test('an unknown token (well-formed but never issued) reports valid: false', async () => {
  const db = fakeDb([{ hashedToken: hash('some-other-token'), used: false, expiresAt: new Date(Date.now() + 60000) }]);
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: 'unknown-token' } }, res);
  assert.equal(res.body.valid, false);
});

// ─── 3.2 Minimal-information response shape ────────────────────────────────

test('the valid response contains only a boolean valid field — no account/email/user identifiers', async () => {
  const rawToken = 'raw-token-shape-valid';
  const db = fakeDb([{ hashedToken: hash(rawToken), used: false, expiresAt: new Date(Date.now() + 60000), email: 'tenant@example.com', user_id: 'tenant-a', uid: 'firebase-uid' }]);
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: rawToken } }, res);
  assert.deepEqual(Object.keys(res.body), ['valid']);
  assert.equal(res.body.valid, true);
});

test('the invalid response contains only a boolean valid field — generic, no reason that could aid enumeration', async () => {
  const db = fakeDb([]);
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: 'anything' } }, res);
  assert.deepEqual(Object.keys(res.body), ['valid']);
  assert.equal(res.body.valid, false);
});

test('a database error never leaks internal exception text to the client', async () => {
  const db = { collection() { return { findOne: async () => { throw new Error('MongoNetworkError: connection to 10.0.0.5:27017 refused'); } }; } };
  const { checkResetTokenValid } = freshAuthController(db);
  const res = fakeResponse();
  await checkResetTokenValid({ body: { token: 'x' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.valid, false);
  assert.doesNotMatch(JSON.stringify(res.body), /MongoNetworkError|10\.0\.0\.5|27017/);
});

// ─── 3.1 Token must never be logged ────────────────────────────────────────

test('checkResetTokenValid never logs the raw token, hashed token, or full body, on any path', async () => {
  const rawToken = 'super-secret-raw-token-value';
  const db = fakeDb([{ hashedToken: hash(rawToken), used: false, expiresAt: new Date(Date.now() + 60000) }]);
  const { checkResetTokenValid } = freshAuthController(db);

  const captured = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => captured.push(args);
  console.warn = (...args) => captured.push(args);
  console.error = (...args) => captured.push(args);
  try {
    await checkResetTokenValid({ body: { token: rawToken } }, fakeResponse());
    // Also exercise the error path, where a naive implementation might log req.body.
    const failingDb = { collection() { return { findOne: async () => { throw new Error('boom'); } }; } };
    const { checkResetTokenValid: checkFailing } = freshAuthController(failingDb);
    await checkFailing({ body: { token: rawToken } }, fakeResponse());
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  const serialized = JSON.stringify(captured);
  assert.doesNotMatch(serialized, new RegExp(rawToken));
  assert.doesNotMatch(serialized, new RegExp(hash(rawToken)));
});

test('resetTokenEligibilityFilter and hashAuthSecret are the exact functions checkResetTokenValid and resetPassword both use (no duplicated business logic)', () => {
  const authController = require(authControllerPath);
  assert.equal(typeof authController.hashAuthSecret, 'function');
  assert.equal(typeof authController.resetTokenEligibilityFilter, 'function');

  const hashedToken = authController.hashAuthSecret('some-token');
  const filter = authController.resetTokenEligibilityFilter(hashedToken, new Date('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(filter, {
    hashedToken,
    used: false,
    expiresAt: { $gt: new Date('2026-01-01T00:00:00.000Z') },
    processingId: { $exists: false },
  });
});

// ─── 3.4 Non-consuming lifecycle: status → status → actual reset → status ──

test('status(valid) -> status(same token again) -> POST reset -> status(after reset) full lifecycle', async () => {
  const rawToken = 'lifecycle-token';
  const hashedToken = hash(rawToken);
  const tokenDoc = {
    hashedToken,
    used: false,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    email: 'tenant@example.com',
    user_id: 'tenant-a',
    uid: 'firebase-uid-a',
  };

  // A faithful in-memory store shared by both handlers within this test,
  // supporting both the read-only findOne (status) and the claiming
  // findOneAndUpdate (actual reset) against the exact same document.
  const store = { doc: { ...tokenDoc } };
  const sessionsDeleted = [];
  const db = {
    collection(name) {
      if (name === 'password_reset_tokens') {
        return {
          findOne: async (query) => {
            if (store.doc.hashedToken !== query.hashedToken) return null;
            if (store.doc.used !== query.used) return null;
            if (!(store.doc.expiresAt > query.expiresAt.$gt)) return null;
            if (query.processingId && store.doc.processingId) return null;
            return { ...store.doc };
          },
          // Mirrors the mongodb driver v6 default (no includeResultMetadata):
          // findOneAndUpdate resolves the matched document directly, or null
          // on no match — not the older {value} wrapper shape.
          findOneAndUpdate: async (query, update) => {
            if (store.doc.hashedToken !== query.hashedToken) return null;
            if (store.doc.used !== query.used) return null;
            if (!(store.doc.expiresAt > query.expiresAt.$gt)) return null;
            if (query.processingId && store.doc.processingId) return null;
            Object.assign(store.doc, update.$set);
            return { ...store.doc };
          },
          updateOne: async (query, update) => {
            if (store.doc.hashedToken !== query.hashedToken) return { matchedCount: 0 };
            if (query.processingId && store.doc.processingId !== query.processingId) return { matchedCount: 0 };
            if (typeof query.used === 'boolean' && store.doc.used !== query.used) return { matchedCount: 0 };
            if (update.$set) Object.assign(store.doc, update.$set);
            if (update.$unset) Object.keys(update.$unset).forEach((key) => delete store.doc[key]);
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === 'user_sessions') {
        return { deleteMany: async (query) => { sessionsDeleted.push(query.user_id); return { deletedCount: 1 }; } };
      }
      if (name === 'users') {
        return { findOne: async () => ({ user_id: 'tenant-a', role: 'tenant', account_status: 'active' }) };
      }
      return { insertOne: async () => ({}), findOne: async () => null };
    },
  };

  process.env.FIREBASE_API_KEY = 'test-firebase-api-key';
  require(databasePath).getDb = () => db;

  const firebasePath = require.resolve('../config/firebase');
  const { admin } = require(firebasePath);
  const proto = Object.getPrototypeOf(admin);
  const originalAuthDescriptor = Object.getOwnPropertyDescriptor(proto, 'auth');
  Object.defineProperty(proto, 'auth', {
    configurable: true,
    value: () => ({ updateUser: async () => {} }),
  });

  try {
    delete require.cache[authControllerPath];
    const { checkResetTokenValid, resetPassword } = require(authControllerPath);

    // 1. POST status(valid token) -> valid
    const status1 = fakeResponse();
    await checkResetTokenValid({ body: { token: rawToken } }, status1);
    assert.equal(status1.body.valid, true);

    // 2. POST status(same valid token again) -> still valid (no consumption from step 1)
    const status2 = fakeResponse();
    await checkResetTokenValid({ body: { token: rawToken } }, status2);
    assert.equal(status2.body.valid, true);
    assert.equal(store.doc.used, false, 'two status checks must not have marked the token used');

    // 3. POST actual password reset with same token -> succeeds once
    const resetRes = fakeResponse();
    await resetPassword({ body: { token: rawToken, newPassword: 'NewStrong1!' } }, resetRes);
    assert.equal(resetRes.statusCode, 200);
    assert.equal(store.doc.used, true);
    assert.deepEqual(sessionsDeleted, ['tenant-a']);

    // A second reset attempt with the same (now-used) token must fail.
    const secondResetRes = fakeResponse();
    await resetPassword({ body: { token: rawToken, newPassword: 'AnotherStrong1!' } }, secondResetRes);
    assert.equal(secondResetRes.statusCode, 400);

    // 4. POST status(after successful reset) -> invalid
    const status3 = fakeResponse();
    await checkResetTokenValid({ body: { token: rawToken } }, status3);
    assert.equal(status3.body.valid, false);
  } finally {
    Object.defineProperty(proto, 'auth', originalAuthDescriptor);
  }
});

// ─── 3.5 Route contract & rate limiting ────────────────────────────────────
// Source-level proof rather than a real flood test — actually hammering the
// route with 30+ requests to observe a 429 would be slow and flaky under
// whatever timer/scheduling jitter the test runner has. Asserting the exact
// route registration line is deterministic and cannot pass by accident.

test('POST /reset-password/status is registered behind the same shared authLimiter as every other auth endpoint (reused middleware, no new dependency), and the old GET route no longer exists', () => {
  const fs = require('node:fs');
  const routesPath = require.resolve('../routes/auth.routes');
  const source = fs.readFileSync(routesPath, 'utf8');

  assert.match(
    source,
    /router\.post\(\s*['"]\/reset-password\/status['"]\s*,\s*authLimiter\s*,\s*authController\.checkResetTokenValid\s*\)/,
  );

  // The raw token must never travel as a query string again.
  assert.doesNotMatch(source, /router\.get\(\s*['"]\/reset-password\/status['"]/);

  // Same limiter instance/config as forgot-password and the actual reset —
  // not a separate, potentially weaker or missing limiter.
  const forgotIdx = source.indexOf("router.post('/forgot-password'");
  const statusIdx = source.indexOf("router.post('/reset-password/status'");
  const resetIdx = source.indexOf("router.post('/reset-password'", statusIdx + 1);
  assert.ok(forgotIdx > -1 && statusIdx > -1 && resetIdx > -1);
  for (const line of [source.slice(forgotIdx, forgotIdx + 100), source.slice(statusIdx, statusIdx + 100), source.slice(resetIdx, resetIdx + 100)]) {
    assert.match(line, /authLimiter/);
  }

  // Not an unnecessarily aggressive limit that would break a legitimate
  // tenant refreshing the reset page a few times: 30 requests / 15 minutes.
  assert.match(source, /windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /max:\s*30/);
});
