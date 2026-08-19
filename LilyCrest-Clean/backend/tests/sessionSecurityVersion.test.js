'use strict';

// Behavioral tests for the session security-version contract.
//
// createSession() (auth.controller.js) stamps the account's current
// securityVersion onto every session it mints; finalizePasswordSessions()
// advances that version whenever a credential changes; authMiddleware refuses
// any session whose stamped version no longer matches the account.
//
// Together these three points are what make "changing your password signs out
// every other device" actually true even when the physical user_sessions
// delete fails — and they are what keep this backend's notion of "revoked" in
// step with Capstone-Website's mobileTenantAuth, which reads the same shared
// users/user_sessions collections and has always enforced this rule.
//
// Uses the same require.cache-seeding technique as accountInactive.test.js /
// sessionTeardown.test.js, since this backend's test runner (node:test) has no
// module-mocking framework.

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
    getUser(userId) {
      return users.get(userId) || null;
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
            async updateOne(filter, update) {
              const existing = users.get(filter.user_id);
              if (!existing) return { matchedCount: 0, modifiedCount: 0 };
              users.set(filter.user_id, { ...existing, ...(update.$set || {}) });
              return { matchedCount: 1, modifiedCount: 1 };
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
        return {
          async findOne() { return null; },
          async updateOne() { return { matchedCount: 0 }; },
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

const { authMiddleware } = require('../middleware/auth');
const { finalizePasswordSessions } = require('../controllers/auth.controller');

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

const activeUser = (overrides = {}) => ({ user_id: 'tenant-a', is_active: true, status: 'active', role: 'tenant', ...overrides });
const liveSession = (overrides = {}) => ({ session_token: 'tok', user_id: 'tenant-a', expires_at: new Date(Date.now() + 60000), ...overrides });

test('a session whose security_version matches the account authenticates normally', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser(activeUser({ securityVersion: 4 }));
  mongo.seedSession(liveSession({ security_version: 4 }));

  const { res, nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer tok' } });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('legacy sessions and accounts with no version at all are both treated as version 0 and still work', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser(activeUser());
  mongo.seedSession(liveSession());

  const { nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer tok' } });
  assert.equal(nextCalled, true, 'pre-existing sessions must not be mass-invalidated by introducing this check');
});

test('a session stamped with a stale security_version is rejected and deleted', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser(activeUser({ securityVersion: 5 }));
  mongo.seedSession(liveSession({ security_version: 4 }));

  const { res, nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer tok' } });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(mongo.sessionCount('tenant-a'), 0, 'the revoked session row must not survive the rejection');
});

test('the snake_case security_version field on the user document is honoured too', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser(activeUser({ security_version: 7 }));
  mongo.seedSession(liveSession({ security_version: 7 }));

  const { nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer tok' } });
  assert.equal(nextCalled, true);
});

test('finalizePasswordSessions advances the account version and deletes every session', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser(activeUser({ securityVersion: 2 }));
  mongo.seedSession(liveSession({ session_token: 'a', security_version: 2 }));
  mongo.seedSession(liveSession({ session_token: 'b', security_version: 2 }));

  const result = await finalizePasswordSessions(mongo.db, 'tenant-a');

  assert.equal(result.nextVersion, 3);
  assert.equal(result.versionAdvanced, true);
  assert.equal(result.sessionsDeleted, true);
  assert.equal(mongo.getUser('tenant-a').securityVersion, 3);
  assert.equal(mongo.getUser('tenant-a').security_version, 3, 'both field spellings are written for cross-deployment parity');
  assert.ok(mongo.getUser('tenant-a').password_changed_at instanceof Date);
  assert.equal(mongo.sessionCount('tenant-a'), 0);
});

test('a surviving session is still revoked by the version bump when physical deletion fails', async () => {
  const mongo = makeFakeMongo();
  currentDb = mongo.db;
  mongo.seedUser(activeUser({ securityVersion: 1 }));
  mongo.seedSession(liveSession({ security_version: 1 }));

  // Simulate the delete half of finalization failing (replica lag, transient
  // Mongo error) while the version bump succeeds.
  const brokenDb = {
    collection(name) {
      if (name === 'user_sessions') {
        return {
          async deleteMany() { throw new Error('transient mongo failure'); },
        };
      }
      return mongo.db.collection(name);
    },
  };

  const result = await finalizePasswordSessions(brokenDb, 'tenant-a');
  assert.equal(result.versionAdvanced, true);
  assert.equal(result.sessionsDeleted, false);
  assert.equal(mongo.sessionCount('tenant-a'), 1, 'the row deliberately survives in this scenario');

  // The still-present session must nonetheless be refused, because its stamped
  // version is now behind the account's.
  const { res, nextCalled } = await runMiddleware({ headers: { authorization: 'Bearer tok' } });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('finalizePasswordSessions throws when neither revocation mechanism succeeds', async () => {
  const brokenDb = {
    collection() {
      return {
        async findOne() { return null; },
        async updateOne() { throw new Error('down'); },
        async deleteMany() { throw new Error('down'); },
      };
    },
  };
  await assert.rejects(
    () => finalizePasswordSessions(brokenDb, 'tenant-a'),
    /Unable to finalize password sessions/,
  );
});

test('finalizePasswordSessions refuses to run without a user identity', async () => {
  await assert.rejects(
    () => finalizePasswordSessions(makeFakeMongo().db, null),
    /Missing user identity/,
  );
});
