'use strict';

// Behavioral tests for the recently-expired-session teardown path added to
// close the HIGH push-token finding from the pre-Phase-3 hardening review:
// a client whose session just 401'd under the strict authMiddleware can still
// authenticate ONE narrow teardown call (disable push token, delete the dead
// session row) via authMiddlewareRecentSession, which accepts the exact same
// token for a short grace window after expiry — never an arbitrary token.
//
// Uses the same require.cache-seeding technique as
// announcementHandlerIntegration.test.js to exercise the real middleware/
// controller code against an in-memory fake Mongo, since this backend's test
// runner (node:test) has no module-mocking framework.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function makeFakeMongo() {
  const users = new Map();
  const sessions = new Map();
  let nextId = 1;

  function objectIdLike() {
    return `oid_${nextId++}`;
  }

  return {
    seedUser(user) {
      users.set(user.user_id, { ...user });
    },
    seedSession(session) {
      const _id = session._id || objectIdLike();
      sessions.set(_id, { ...session, _id });
      return _id;
    },
    getUser(userId) {
      return users.get(userId);
    },
    sessionExists(id) {
      return sessions.has(id);
    },
    db: {
      collection(name) {
        if (name === 'users') {
          return {
            async findOne(query) {
              return [...users.values()].find((u) => u.user_id === query.user_id) || null;
            },
            async updateOne(filter, update) {
              const existing = users.get(filter.user_id);
              if (!existing) return { matchedCount: 0 };
              if (update.$set) Object.assign(existing, update.$set);
              return { matchedCount: 1 };
            },
          };
        }
        if (name === 'user_sessions') {
          return {
            async findOne(query) {
              const match = [...sessions.values()].find((s) => (
                s.session_token === query.session_token
                && (!query.expires_at?.$gt || s.expires_at > query.expires_at.$gt)
              ));
              return match || null;
            },
            async deleteOne(filter) {
              const existed = sessions.has(filter._id);
              sessions.delete(filter._id);
              return { deletedCount: existed ? 1 : 0 };
            },
            async deleteMany() { return { deletedCount: 0 }; },
          };
        }
        return { async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };
      },
    },
  };
}

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
  throw new Error(
    'config/database.js was already required by an earlier test in this process — '
    + 'run this file in isolation if it fails for this reason (see announcementHandlerIntegration.test.js).',
  );
}

const { authMiddlewareRecentSession, TEARDOWN_GRACE_PERIOD_MS } = require('../middleware/auth');
const { sessionTeardown } = require('../controllers/auth.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function runMiddleware(middleware, req) {
  const res = fakeRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('authMiddlewareRecentSession accepts a session that expired moments ago', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', email: 'a@example.com', is_active: true });
  mongo.seedSession({ session_token: 'dead-token', user_id: 'tenant-a', expires_at: new Date(Date.now() - 1000) });

  const req = { headers: { authorization: 'Bearer dead-token' } };
  const { res, nextCalled } = await runMiddleware(authMiddlewareRecentSession, req);

  assert.equal(nextCalled, true);
  assert.equal(req.user.user_id, 'tenant-a');
  assert.equal(res.statusCode, 200); // unchanged, next() was called instead of a rejection
});

test('authMiddlewareRecentSession rejects a session expired beyond the grace window', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', is_active: true });
  mongo.seedSession({
    session_token: 'ancient-token',
    user_id: 'tenant-a',
    expires_at: new Date(Date.now() - TEARDOWN_GRACE_PERIOD_MS - 60000),
  });

  const req = { headers: { authorization: 'Bearer ancient-token' } };
  const { res, nextCalled } = await runMiddleware(authMiddlewareRecentSession, req);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('authMiddlewareRecentSession rejects a token that never matches any session record', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;

  const req = { headers: { authorization: 'Bearer never-issued-token' } };
  const { res, nextCalled } = await runMiddleware(authMiddlewareRecentSession, req);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('authMiddlewareRecentSession rejects a missing Authorization header', async () => {
  const req = { headers: {} };
  const { res, nextCalled } = await runMiddleware(authMiddlewareRecentSession, { headers: {} });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('sessionTeardown disables the push token for the session\'s own account and deletes the dead session row', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({
    user_id: 'tenant-a',
    push_token: 'device-token-123',
    push_provider: 'expo',
    push_platform: 'android',
  });
  const sessionId = mongo.seedSession({
    session_token: 'dead-token', user_id: 'tenant-a', expires_at: new Date(Date.now() - 1000),
  });

  const req = { user: { user_id: 'tenant-a' }, session: { _id: sessionId }, body: { push_token: 'device-token-123' } };
  const res = fakeRes();
  await sessionTeardown(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');

  const updatedUser = mongo.getUser('tenant-a');
  assert.equal(updatedUser.push_token, null); // no other enabled entry remains
  const disabledEntry = updatedUser.push_tokens.find((e) => e.token === 'device-token-123');
  assert.equal(disabledEntry.enabled, false);

  assert.equal(mongo.sessionExists(sessionId), false);
});

test('sessionTeardown never mutates another account\'s push-token entry, even if the same physical token string is passed', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', push_token: 'shared-device-token' });
  mongo.seedUser({ user_id: 'tenant-b', push_token: 'shared-device-token' });
  const sessionId = mongo.seedSession({
    session_token: 'dead-token-a', user_id: 'tenant-a', expires_at: new Date(Date.now() - 1000),
  });

  // req.user is derived exclusively from the validated (recently-expired) session
  // token for tenant-a — the request body's push_token is only used to identify
  // *which entry* to disable within that already-authenticated account, never to
  // select whose account to mutate.
  const req = { user: { user_id: 'tenant-a' }, session: { _id: sessionId }, body: { push_token: 'shared-device-token' } };
  await sessionTeardown(req, fakeRes());

  const tenantA = mongo.getUser('tenant-a');
  const tenantB = mongo.getUser('tenant-b');
  assert.equal(tenantA.push_token, null);
  assert.equal(tenantB.push_token, 'shared-device-token'); // untouched
});

test('sessionTeardown is a no-op-safe when called with no push_token (still deletes the dead session)', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a' });
  const sessionId = mongo.seedSession({
    session_token: 'dead-token', user_id: 'tenant-a', expires_at: new Date(Date.now() - 1000),
  });

  const req = { user: { user_id: 'tenant-a' }, session: { _id: sessionId }, body: {} };
  const res = fakeRes();
  await sessionTeardown(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(mongo.sessionExists(sessionId), false);
});

test('replay: a second /auth/session-teardown request with the same already-consumed token is rejected harmlessly by the grace middleware', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', push_token: 'device-token-123' });
  mongo.seedSession({
    session_token: 'dead-token', user_id: 'tenant-a', expires_at: new Date(Date.now() - 1000),
  });

  // First request: the real end-to-end flow — grace middleware accepts the
  // recently-expired token, then the controller tears down and deletes the
  // session row (mirrors what actually happens behind POST /auth/session-teardown).
  const firstReq = { headers: { authorization: 'Bearer dead-token' }, body: { push_token: 'device-token-123' } };
  const { res: firstMiddlewareRes, nextCalled: firstNextCalled } = await runMiddleware(authMiddlewareRecentSession, firstReq);
  assert.equal(firstNextCalled, true);
  const firstControllerRes = fakeRes();
  await sessionTeardown(firstReq, firstControllerRes);
  assert.equal(firstControllerRes.statusCode, 200);
  assert.equal(mongo.getUser('tenant-a').push_token, null); // teardown actually ran

  // Replay: the exact same token, same request shape, sent again. The session
  // row is gone, so the middleware itself must reject it before the controller
  // ever runs again — it cannot "restore" the token or re-run any side effect.
  const replayReq = { headers: { authorization: 'Bearer dead-token' }, body: { push_token: 'device-token-123' } };
  const { res: replayRes, nextCalled: replayNextCalled } = await runMiddleware(authMiddlewareRecentSession, replayReq);

  assert.equal(replayNextCalled, false);
  assert.equal(replayRes.statusCode, 401);
  assert.equal(mongo.getUser('tenant-a').push_token, null); // unchanged, still disabled
});
