'use strict';

// Regression test for the "committed auth code calls sanitizeUserForClient,
// but the committed normalizeUser.js doesn't export it" bug: at a clean
// checkout of a commit like 40c086e8 without the sanitizeUserForClient
// addition, getCleanUser()/getMe() throw `TypeError: sanitizeUserForClient
// is not a function`, breaking Google sign-in, registration, OTP-verify
// login completion, and GET /auth/me for any rollback client hitting a
// fresh deploy of this backend. This proves the shared serialization step
// those flows depend on no longer throws, and still returns the fields old
// mobile clients expect while stripping sensitive/internal ones.
//
// Uses the same require.cache-seeding technique as sessionTeardown.test.js
// since this backend's test runner (node:test) has no module-mocking
// framework.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function makeFakeMongo(users = []) {
  const byUserId = new Map(users.map((u) => [u.user_id, { ...u }]));
  return {
    collection(name) {
      if (name === 'users') {
        return {
          async findOne(query) {
            return byUserId.get(query.user_id) || null;
          },
        };
      }
      return { async findOne() { return null; } };
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

const { getMe, getCleanUser } = require('../controllers/auth.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const RAW_USER = {
  user_id: 'user_abc123',
  email: 'tenant@example.com',
  name: 'Tenant Example',
  role: 'resident',
  branch: { branchName: 'LilyCrest Residences – Guadalupe' },
  password_hash: '$2b$10$shouldneverleak',
  firebase_uid: 'fb-uid-should-never-leak',
  otp_code_hash: 'should-never-leak',
};

test('getCleanUser (googleSignIn/register/verifyOtp\'s shared serialization step) does not throw and strips sensitive fields', async () => {
  currentDb = makeFakeMongo([RAW_USER]);
  const clean = await getCleanUser(currentDb, 'user_abc123');
  assert.equal(clean.user_id, 'user_abc123');
  assert.equal(clean.email, 'tenant@example.com');
  assert.deepEqual(clean.accountStatus, { code: 'active', label: 'Active Tenant' });
  assert.equal(clean.branch?.branchName, 'LilyCrest Residences – Guadalupe');
  assert.equal(clean.password_hash, undefined);
  assert.equal(clean.firebase_uid, undefined);
  assert.equal(clean.otp_code_hash, undefined);
});

test('GET /auth/me (getMe) does not throw and returns a sanitized profile from req.user', async () => {
  const req = { user: { ...RAW_USER } };
  const res = fakeRes();
  await getMe(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user_id, 'user_abc123');
  assert.equal(res.body.name, 'Tenant Example');
  assert.deepEqual(res.body.accountStatus, { code: 'active', label: 'Active Tenant' });
  assert.equal(res.body.password_hash, undefined);
  assert.equal(res.body.firebase_uid, undefined);
});

test('getCleanUser returns null-shaped output (never throws) when the user document is missing', async () => {
  currentDb = makeFakeMongo([]);
  const clean = await getCleanUser(currentDb, 'ghost-user');
  assert.equal(clean, null);
});
