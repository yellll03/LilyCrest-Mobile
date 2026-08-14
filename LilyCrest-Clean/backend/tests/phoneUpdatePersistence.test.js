'use strict';

// Runtime regression test for the QA report "Save succeeds but the new phone
// number is not reflected." A prior investigation pass concluded the update
// path was fine by inspecting updateMe's allowedFields and AuthContext's
// merge logic — but never traced all the way through buildTenantProfile,
// which is the function BOTH updateMe's response AND a fresh getMe()
// (/auth/me) call route through.
//
// That trace found a real bug: buildTenantProfile computed
//   normalized.phone = applicationPhone(reservation) || normalizePhilippinePhone(normalized.phone) || ''
// i.e. the tenant's approved-application phone always won over their own
// saved phone whenever the reservation had ANY phone-like field set — which
// is the common case for most approved tenants. So editing your phone in the
// app would persist correctly to the users collection, but every profile
// read (including the PUT /users/me response itself, and any later
// GET /users/me) would keep showing the stale application phone forever.
//
// Fixed by making the tenant's own saved phone win once set, with the
// application phone only used as a hydration fallback before the tenant has
// set one. This test exercises the full runtime path — updateMe (the Save
// action) followed by a separate getMe call (a fresh /auth/me fetch) — using
// an in-memory fake `users` collection, so it proves the persisted value
// really does flow back out, rather than asserting on inspection alone.

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

// A minimal but faithful in-memory Mongo-shaped fake: every collection not
// explicitly overridden below resolves to "nothing found," so branch/contract
// resolution (which touch many auxiliary collections) harmlessly no-op
// instead of throwing, matching real behavior for a tenant with no branch
// assignment on record.
function emptyChain() {
  const chain = {
    sort() { return chain; },
    limit() { return chain; },
    toArray: async () => [],
  };
  return chain;
}

function fakeDb({ usersStore, reservation }) {
  return {
    collection(name) {
      if (name === 'users') {
        return {
          findOne: async (query) => usersStore.find((u) => u.user_id === query.user_id) || null,
          updateOne: async (filter, update) => {
            const doc = usersStore.find((u) => u.user_id === filter.user_id);
            if (!doc) return { modifiedCount: 0 };
            Object.assign(doc, update.$set);
            return { modifiedCount: 1 };
          },
        };
      }
      if (name === 'reservations') {
        return {
          findOne: async () => reservation || null,
          find: () => emptyChain(),
        };
      }
      return {
        findOne: async () => null,
        find: () => emptyChain(),
        updateOne: async () => ({ modifiedCount: 0 }),
        insertOne: async () => ({ insertedId: 'fake-id' }),
      };
    },
  };
}

function freshUserController(db) {
  require(databasePath).getDb = () => db;
  delete require.cache[userControllerPath];
  return require(userControllerPath);
}

test('phone update persists and is reflected in the same response and a subsequent fresh profile fetch', async () => {
  const usersStore = [
    {
      user_id: 'tenant-a',
      _id: 'mongo-id-a',
      name: 'Ana Reyes',
      email: 'ana@example.com',
      username: 'ana',
      phone: '+639170000001',
    },
  ];
  // The tenant has an approved reservation whose application phone differs
  // from what they're about to set — this is the exact condition that
  // triggered the bug (application phone silently winning forever).
  const reservation = {
    status: 'approved',
    user_id: 'tenant-a',
    applicantDetails: { contactNumber: '+639170000001' },
  };

  const db = fakeDb({ usersStore, reservation });
  const { updateMe, getMe } = freshUserController(db);

  const req = { user: { user_id: 'tenant-a', _id: 'mongo-id-a' }, body: { phone: '+639281234567' } };
  const updateRes = fakeResponse();
  await updateMe(req, updateRes);

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.phone, '+639281234567', 'the PUT /users/me response itself must reflect the new phone');

  // The underlying record was actually persisted, independent of what the
  // response computed.
  assert.equal(usersStore[0].phone, '+639281234567');

  // A fresh /auth/me-equivalent fetch (getMe), simulating the app reloading
  // the profile after Save, must also show the new number — not revert to
  // the application-derived one.
  const meRes = fakeResponse();
  await getMe({ user: { user_id: 'tenant-a' } }, meRes);
  assert.equal(meRes.statusCode, 200);
  assert.equal(meRes.body.phone, '+639281234567', 'a fresh /auth/me fetch must reflect the updated phone, not the stale application phone');
  assert.equal(meRes.body.phoneSource, 'verified_tenant');
});

test('a tenant who has never set their own phone still gets it hydrated from the approved application', async () => {
  const usersStore = [
    { user_id: 'tenant-b', _id: 'mongo-id-b', name: 'Bea Cruz', email: 'bea@example.com', username: 'bea', phone: '' },
  ];
  const reservation = {
    status: 'approved',
    user_id: 'tenant-b',
    applicantDetails: { contactNumber: '+639171112222' },
  };

  const db = fakeDb({ usersStore, reservation });
  const { getMe } = freshUserController(db);

  const res = fakeResponse();
  await getMe({ user: { user_id: 'tenant-b' } }, res);
  assert.equal(res.body.phone, '+639171112222');
  assert.equal(res.body.phoneSource, 'approved_application');
});
