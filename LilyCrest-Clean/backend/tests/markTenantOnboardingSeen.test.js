'use strict';

// POST /users/me/manual-guide-seen is the authoritative write path for the
// tenant mobile app guide: it must persist to the user's own document only,
// independent of whatever the device has cached locally.

const test = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('../config/database');
const userControllerPath = require.resolve('../controllers/user.controller');

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// buildTenantProfile (invoked after the write, to return a canonical
// profile) also touches reservations/branch/contract lookups. `reservations`
// resolves to `{}` rather than `null` — every real active tenant has an
// approved reservation, and buildTenantProfile's phone-fallback helper
// (applicationPhone, unrelated to this feature) does not accept a literal
// null there. Every other collection only needs "nothing found".
function genericEmptyCollection(name) {
  return {
    findOne: async () => (name === 'reservations' ? {} : null),
    find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
  };
}

function fakeDb(users) {
  return {
    collection(name) {
      if (name !== 'users') return genericEmptyCollection(name);
      return {
        findOne: async (query) => users.find((user) => user.user_id === query.user_id) || null,
        updateOne: async (filter, update) => {
          const user = users.find((candidate) => candidate.user_id === filter.user_id);
          if (!user) return { modifiedCount: 0 };
          Object.assign(user, update.$set);
          return { modifiedCount: 1 };
        },
      };
    },
  };
}

function freshUserController(db) {
  require(databasePath).getDb = () => db;
  delete require.cache[userControllerPath];
  return require(userControllerPath);
}

test('marks only the requesting account as having seen the guide', async () => {
  const users = [
    { user_id: 'tenant-a', role: 'tenant', status: 'active' },
    { user_id: 'tenant-b', role: 'tenant', status: 'active' },
  ];
  const db = fakeDb(users);
  const userController = freshUserController(db);
  const res = fakeResponse();

  await userController.markTenantOnboardingSeen({ user: { user_id: 'tenant-a' } }, res);

  assert.equal(res.body.tenantOnboardingSeen, true);
  assert.equal(users[0].tenant_onboarding_seen_at instanceof Date, true);
  assert.equal(users[1].tenant_onboarding_seen_at, undefined);
});

test('replaying/re-confirming an already-seen guide does not error', async () => {
  const first = new Date('2026-01-01T00:00:00Z');
  const users = [{ user_id: 'tenant-a', role: 'tenant', status: 'active', tenant_onboarding_seen_at: first }];
  const db = fakeDb(users);
  const userController = freshUserController(db);
  const res = fakeResponse();

  await userController.markTenantOnboardingSeen({ user: { user_id: 'tenant-a' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tenantOnboardingSeen, true);
});
