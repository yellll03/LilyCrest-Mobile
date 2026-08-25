'use strict';

// Regression tests for the random-logout root cause: createSession() used to
// unconditionally deleteMany({user_id}) on every login, silently revoking a
// still-open device's live session the moment the same account signed in
// anywhere else (another device, a reinstall, a retried OTP/Google flow).
// logout() had the mirror-image bug: it deleted every session for the
// account, so logging out on one device signed every other device out too.
// Both now scope to the single session actually being created/removed.
//
// Uses the same require.cache-seeding technique as sessionSecurityVersion.test.js.

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
    sessionExists(_id) {
      return sessions.has(_id);
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
              return [...sessions.values()].find((s) => s.session_token === query.session_token) || null;
            },
            async insertOne(doc) {
              const _id = `oid_${nextId++}`;
              sessions.set(_id, { ...doc, _id });
              return { insertedId: _id };
            },
            async deleteOne(filter) {
              if (filter._id) {
                const existed = sessions.has(filter._id);
                sessions.delete(filter._id);
                return { deletedCount: existed ? 1 : 0 };
              }
              let count = 0;
              for (const [id, session] of sessions) {
                if (filter.session_token && session.session_token === filter.session_token) {
                  sessions.delete(id);
                  count += 1;
                }
              }
              return { deletedCount: count };
            },
            async deleteMany(filter) {
              let count = 0;
              for (const [id, session] of sessions) {
                const matchesUser = !filter.user_id || session.user_id === filter.user_id;
                const matchesExpiry = !filter.expires_at?.$lte || session.expires_at <= filter.expires_at.$lte;
                if (matchesUser && matchesExpiry) {
                  sessions.delete(id);
                  count += 1;
                }
              }
              return { deletedCount: count };
            },
          };
        }
        return {
          async findOne() { return null; },
          async deleteMany() { return { deletedCount: 0 }; },
        };
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

const { createSession, logout } = require('../controllers/auth.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    cookiesCleared: [],
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    clearCookie(name) { this.cookiesCleared.push(name); return this; },
  };
}

test('a new login does not revoke a session already active on another device', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', securityVersion: 0 });
  const deviceAId = mongo.seedSession({
    user_id: 'tenant-a',
    session_token: 'device-a-token',
    security_version: 0,
    expires_at: new Date(Date.now() + 60_000),
  });

  await createSession(mongo.db, 'tenant-a');

  assert.equal(mongo.sessionExists(deviceAId), true, 'device A session must survive a login from device B');
  assert.equal(mongo.sessionCount('tenant-a'), 2, 'both the pre-existing and the newly created session should exist');
});

test('createSession still reaps genuinely expired sessions for the same user', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', securityVersion: 0 });
  const expiredId = mongo.seedSession({
    user_id: 'tenant-a',
    session_token: 'stale-token',
    security_version: 0,
    expires_at: new Date(Date.now() - 60_000),
  });

  await createSession(mongo.db, 'tenant-a');

  assert.equal(mongo.sessionExists(expiredId), false, 'an expired session row should be cleaned up, not left forever');
  assert.equal(mongo.sessionCount('tenant-a'), 1, 'only the freshly created session should remain');
});

test('logging out on one device does not sign out other devices for the same account', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser({ user_id: 'tenant-a', securityVersion: 0 });
  const deviceAId = mongo.seedSession({
    user_id: 'tenant-a',
    session_token: 'device-a-token',
    security_version: 0,
    expires_at: new Date(Date.now() + 60_000),
  });
  const deviceBId = mongo.seedSession({
    user_id: 'tenant-a',
    session_token: 'device-b-token',
    security_version: 0,
    expires_at: new Date(Date.now() + 60_000),
  });

  const req = {
    user: { user_id: 'tenant-a' },
    session: { _id: deviceBId },
    authToken: 'device-b-token',
  };
  const res = fakeRes();
  await logout(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(mongo.sessionExists(deviceBId), false, 'the logging-out device\'s own session must be removed');
  assert.equal(mongo.sessionExists(deviceAId), true, 'a different device\'s session must be untouched by this logout');
});
