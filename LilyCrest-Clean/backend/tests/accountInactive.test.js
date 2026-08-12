'use strict';

// Behavioral tests for the ACCOUNT_INACTIVE classification added to
// authMiddleware: once an admin deactivates a tenant, the next authenticated
// request must fail with a distinct, client-recognizable code (rather than a
// generic 401), and the tenant's live sessions must be torn down so a forced
// logout actually sticks instead of the stale token continuing to half-work.
//
// Uses the same require.cache-seeding technique as sessionTeardown.test.js /
// announcementHandlerIntegration.test.js, since this backend's test runner
// (node:test) has no module-mocking framework.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function makeFakeMongo() {
  const users = new Map();
  const sessions = new Map();
  let nextId = 1;

  return {
    seedUser(user) {
      users.set(user.user_id, { ...user });
    },
    seedSession(session) {
      const _id = session._id || `oid_${nextId++}`;
      sessions.set(_id, { ...session, _id });
      return _id;
    },
    sessionCount(userId) {
      return [...sessions.values()].filter((s) => s.user_id === userId).length;
    },
    db: {
      collection(name) {
        if (name === 'users') {
          return {
            async findOne(query) {
              return [...users.values()].find((u) => u.user_id === query.user_id) || null;
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
            async deleteMany(filter) {
              let count = 0;
              for (const [id, session] of sessions) {
                if (session.user_id === filter.user_id) {
                  sessions.delete(id);
                  count += 1;
                }
              }
              return { deletedCount: count };
            },
          };
        }
        return { async findOne() { return null; }, async deleteMany() { return { deletedCount: 0 }; } };
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
    + 'run this file in isolation if it fails for this reason (see sessionTeardown.test.js).',
  );
}

const { authMiddleware } = require('../middleware/auth');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function runMiddleware(req) {
  const res = fakeRes();
  let nextCalled = false;
  await authMiddleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('an active tenant session authenticates normally', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', is_active: true, status: 'active' });
  mongo.seedSession({ session_token: 'good-token', user_id: 'tenant-a', expires_at: new Date(Date.now() + 60000) });

  const { res, nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer good-token' } });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('a deactivated account is rejected with ACCOUNT_INACTIVE and its sessions are torn down', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-b', is_active: false, status: 'inactive' });
  mongo.seedSession({ session_token: 'stale-token', user_id: 'tenant-b', expires_at: new Date(Date.now() + 60000) });
  mongo.seedSession({ session_token: 'stale-token-2', user_id: 'tenant-b', expires_at: new Date(Date.now() + 60000) });

  const { res, nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer stale-token' } });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ACCOUNT_INACTIVE');
  // All of the deactivated tenant's sessions are removed, not just the one used for this request.
  assert.equal(mongo.sessionCount('tenant-b'), 0);
});

test('a second concurrent request with an already-torn-down session gets a clean 401, not a crash', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-c', is_active: false });
  mongo.seedSession({ session_token: 'race-token', user_id: 'tenant-c', expires_at: new Date(Date.now() + 60000) });

  const first = await runMiddleware({ headers: { authorization: 'Bearer race-token' } });
  assert.equal(first.res.statusCode, 403);
  assert.equal(first.res.body.code, 'ACCOUNT_INACTIVE');

  // Session row is already gone; a second in-flight request with the same
  // stale token must fail cleanly rather than throwing.
  const second = await runMiddleware({ headers: { authorization: 'Bearer race-token' } });
  assert.equal(second.res.statusCode, 401);
  assert.equal(second.nextCalled, false);
});

test('account-status variants (disabled/suspended/deleted flags) are all treated as inactive', async () => {
  const cases = [
    { is_active: false },
    { status: 'suspended' },
    { account_status: 'blocked' },
    { deleted_at: new Date() },
    { disabled: true },
  ];
  for (const [index, overrides] of cases.entries()) {
    const mongo = makeFakeMongo();
    currentDb = mongo.db;
    const userId = `tenant-variant-${index}`;
    mongo.seedUser({ user_id: userId, ...overrides });
    mongo.seedSession({ session_token: `token-${index}`, user_id: userId, expires_at: new Date(Date.now() + 60000) });

    const { res } = await runMiddleware({ headers: { authorization: `Bearer token-${index}` } });
    assert.equal(res.statusCode, 403, `case ${index} (${JSON.stringify(overrides)}) should be inactive`);
    assert.equal(res.body.code, 'ACCOUNT_INACTIVE');
  }
});
