'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');
let currentDb = null;

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getDb: () => currentDb,
      connectToMongo: async () => currentDb,
      closeConnection: async () => {},
    },
  };
} else {
  throw new Error('config/database.js was loaded before authSessionClassification.test.js');
}

const {
  authMiddleware,
  optionalAuthMiddleware,
} = require('../middleware/auth');
const {
  createSession,
  hashAuthSecret,
  refreshSession,
  SESSION_LIFETIME_MS,
} = require('../controllers/auth.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(...args) { this.cookies.push(args); return this; },
  };
}

async function invoke(middleware, req) {
  const res = response();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

function activeUser(overrides = {}) {
  return { user_id: 'tenant-a', role: 'tenant', status: 'active', is_active: true, securityVersion: 3, ...overrides };
}

test('a Mongo failure is retryable AUTH_SERVICE_UNAVAILABLE, never a 401', async () => {
  let deleteAttempted = false;
  currentDb = {
    collection() {
      return {
        async findOne() { throw new Error('MongoNetworkError: connection interrupted'); },
        async deleteOne() { deleteAttempted = true; },
        async deleteMany() { deleteAttempted = true; },
      };
    },
  };

  const { res, nextCalled } = await invoke(authMiddleware, {
    headers: { authorization: 'Bearer still-valid-locally' },
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    code: 'AUTH_SERVICE_UNAVAILABLE',
    detail: 'Authentication service is temporarily unavailable. Please try again.',
    retryable: true,
  });
  assert.equal(deleteAttempted, false, 'a database outage must not revoke credentials');
});

test('optional authentication also fails closed with retryable 503 on Mongo failure', async () => {
  currentDb = {
    collection() {
      return { async findOne() { throw new Error('database timeout'); } };
    },
  };

  const { res, nextCalled } = await invoke(optionalAuthMiddleware, {
    headers: { authorization: 'Bearer valid-looking-token' },
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'AUTH_SERVICE_UNAVAILABLE');
  assert.equal(res.body.retryable, true);
});

test('terminal auth states have distinct stable codes', async () => {
  const cases = [
    {
      name: 'missing token',
      req: { headers: {} },
      session: null,
      expectedCode: 'AUTH_TOKEN_MISSING',
    },
    {
      name: 'unknown token',
      req: { headers: { authorization: 'Bearer unknown' } },
      session: null,
      expectedCode: 'SESSION_INVALID',
    },
    {
      name: 'expired session',
      req: { headers: { authorization: 'Bearer expired' } },
      session: { _id: 's1', user_id: 'tenant-a', session_token: 'expired', expires_at: new Date(Date.now() - 1000), security_version: 3 },
      expectedCode: 'SESSION_EXPIRED',
    },
    {
      name: 'revoked session',
      req: { headers: { authorization: 'Bearer revoked' } },
      session: { _id: 's2', user_id: 'tenant-a', session_token: 'revoked', expires_at: new Date(Date.now() + 60000), security_version: 2 },
      expectedCode: 'SESSION_REVOKED',
    },
  ];

  for (const item of cases) {
    currentDb = {
      collection(name) {
        return {
          async findOne() { return name === 'user_sessions' ? item.session : activeUser(); },
          async deleteOne() { return { deletedCount: 1 }; },
          async deleteMany() { return { deletedCount: 1 }; },
        };
      },
    };
    const { res } = await invoke(authMiddleware, item.req);
    assert.equal(res.statusCode, 401, item.name);
    assert.equal(res.body.code, item.expectedCode, item.name);
    assert.equal(res.body.retryable, false, item.name);
  }
});

test('createSession issues a hashed method-neutral refresh credential with a seven-day window', async () => {
  let inserted = null;
  currentDb = {
    collection(name) {
      if (name === 'users') return { async findOne() { return activeUser(); } };
      return {
        async deleteMany() { return { deletedCount: 0 }; },
        async insertOne(document) { inserted = document; return { insertedId: 's1' }; },
      };
    },
  };

  const before = Date.now();
  const session = await createSession(currentDb, 'tenant-a');
  const after = Date.now();

  assert.match(session.session_token, /^session_/);
  assert.match(session.refresh_token, /^refresh_/);
  assert.equal(inserted.refresh_token_hash, hashAuthSecret(session.refresh_token));
  assert.notEqual(inserted.refresh_token_hash, session.refresh_token);
  assert.equal(inserted.security_version, 3);
  assert.ok(session.expires_at.getTime() >= before + SESSION_LIFETIME_MS);
  assert.ok(session.expires_at.getTime() <= after + SESSION_LIFETIME_MS);
  assert.equal(session.refresh_expires_at.getTime(), session.expires_at.getTime());
});

test('method-neutral refresh rotates the bearer token and renews the seven-day idle window', async () => {
  const refreshToken = 'refresh_test_value';
  const stored = {
    _id: 'session-row',
    user_id: 'tenant-a',
    session_token: 'old-access',
    refresh_token_hash: hashAuthSecret(refreshToken),
    expires_at: new Date(Date.now() + 60000),
    refresh_expires_at: new Date(Date.now() + 60000),
    security_version: 3,
  };

  currentDb = {
    collection(name) {
      if (name === 'users') return { async findOne() { return activeUser(); } };
      return {
        async findOne(query) {
          return query.refresh_token_hash === stored.refresh_token_hash ? stored : null;
        },
        async updateOne(_filter, update) {
          Object.assign(stored, update.$set);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async deleteOne() { return { deletedCount: 1 }; },
        async deleteMany() { return { deletedCount: 1 }; },
      };
    },
  };

  const res = response();
  await refreshSession({ body: { refresh_token: refreshToken } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.session_token, /^session_/);
  assert.notEqual(res.body.session_token, 'old-access');
  assert.equal(stored.session_token, res.body.session_token);
  assert.ok(new Date(res.body.expires_at).getTime() > Date.now() + SESSION_LIFETIME_MS - 5000);
  assert.equal(res.body.refresh_token, undefined, 'the stable refresh secret is not echoed');
});

test('a refresh Mongo failure is retryable and leaves the local invalidation decision open', async () => {
  currentDb = {
    collection() {
      return { async findOne() { throw new Error('MongoServerSelectionError'); } };
    },
  };
  const res = response();
  await refreshSession({ body: { refresh_token: 'refresh_still_saved_on_device' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'AUTH_SERVICE_UNAVAILABLE');
  assert.equal(res.body.retryable, true);
});

test('a refresh credential cannot restore an applicant/non-tenant session', async () => {
  const refreshToken = 'refresh_applicant_value';
  const stored = {
    _id: 'applicant-session',
    user_id: 'applicant-a',
    refresh_token_hash: hashAuthSecret(refreshToken),
    refresh_expires_at: new Date(Date.now() + 60000),
  };
  let deletedFor = null;
  currentDb = {
    collection(name) {
      if (name === 'users') {
        return { async findOne() { return { user_id: 'applicant-a', role: 'applicant', status: 'active', is_active: true }; } };
      }
      return {
        async findOne() { return stored; },
        async deleteOne() { return { deletedCount: 1 }; },
        async deleteMany(filter) { deletedFor = filter.user_id; return { deletedCount: 1 }; },
      };
    },
  };

  const res = response();
  await refreshSession({ body: { refresh_token: refreshToken } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'TENANT_ACCESS_REQUIRED');
  assert.equal(deletedFor, 'applicant-a');
});
