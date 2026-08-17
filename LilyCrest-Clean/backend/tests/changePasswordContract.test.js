'use strict';

// Runtime contract coverage for Change Password (backend). Confirms — by
// actually exercising changePassword(), not by inspection — that: current
// password is re-verified against Firebase before anything changes, new
// password is server-side validated, the new password can't equal the old
// one, a successful change updates Firebase and forces re-login everywhere
// by invalidating all existing sessions server-side.

const test = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('../config/database');
const firebasePath = require.resolve('../config/firebase');
const authControllerPath = require.resolve('../controllers/auth.controller');

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fakeDb(order = []) {
  const deletedSessionsFor = [];
  return {
    _deletedSessionsFor: deletedSessionsFor,
    collection(name) {
      if (name === 'user_sessions') {
        return { deleteMany: async (query) => {
          order.push('sessions-delete');
          deletedSessionsFor.push(query.user_id);
          return { deletedCount: 1 };
        } };
      }
      return {
        insertOne: async () => ({ insertedId: 'fake-id' }),
        deleteMany: async () => ({ deletedCount: 0 }),
      };
    },
  };
}

// firebase-admin exposes `auth` as a configurable getter on
// FirebaseNamespace.prototype (not an own, directly-assignable property), so
// overriding it requires defineProperty on the prototype — always restored
// via the returned restore function since this patches the shared,
// module-cached firebase-admin singleton.
function patchAdminAuth(updateUserImpl) {
  const { admin } = require(firebasePath);
  const proto = Object.getPrototypeOf(admin);
  const original = Object.getOwnPropertyDescriptor(proto, 'auth');
  Object.defineProperty(proto, 'auth', {
    configurable: true,
    value: () => ({ updateUser: updateUserImpl || (async () => {}) }),
  });
  return () => Object.defineProperty(proto, 'auth', original);
}

function withMockedAxiosPost(impl, fn) {
  const axios = require('axios');
  const original = axios.post;
  axios.post = impl;
  return Promise.resolve(fn()).finally(() => { axios.post = original; });
}

function baseReq(overrides = {}) {
  return {
    ip: '127.0.0.1',
    headers: {},
    user: { user_id: 'tenant-a', email: 'ana@example.com', name: 'Ana', firebase_uid: 'firebase-uid-a' },
    body: {},
    ...overrides,
  };
}

// Runs `fn(changePassword)` with a fresh auth.controller module, the given
// fake db, and firebase-admin's auth().updateUser mocked — always restoring
// the patched admin.auth afterward, regardless of outcome.
async function withChangePassword({ db, updateUserImpl, axiosImpl }, fn) {
  process.env.FIREBASE_API_KEY = 'test-firebase-api-key';
  require(databasePath).getDb = () => db;
  const restoreAdminAuth = patchAdminAuth(updateUserImpl);
  try {
    delete require.cache[authControllerPath];
    const { changePassword } = require(authControllerPath);
    await withMockedAxiosPost(axiosImpl, () => fn(changePassword));
  } finally {
    restoreAdminAuth();
  }
}

test('missing current or new password is rejected before any Firebase call', async () => {
  const db = fakeDb();
  let axiosCalled = false;
  await withChangePassword({ db, axiosImpl: async () => { axiosCalled = true; return {}; } }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: '', new_password: 'NewStrong1!' } }), res);
    assert.equal(res.statusCode, 400);
  });
  assert.equal(axiosCalled, false);
});

test('wrong current password is rejected with 401 and the password is never updated', async () => {
  const db = fakeDb();
  let updateCalled = false;
  await withChangePassword({
    db,
    updateUserImpl: async () => { updateCalled = true; },
    axiosImpl: async () => {
      const err = new Error('Firebase auth failed');
      err.response = { data: { error: { message: 'INVALID_PASSWORD' } } };
      throw err;
    },
  }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: 'WrongOld1!', new_password: 'NewStrong1!' } }), res);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.detail, /incorrect/i);
  });
  assert.equal(updateCalled, false);
  assert.equal(db._deletedSessionsFor.length, 0);
});

test('the exact current password, including legacy whitespace, is sent to Firebase unchanged', async () => {
  const db = fakeDb();
  let verifiedPassword = null;
  await withChangePassword({
    db,
    axiosImpl: async (_url, body) => {
      verifiedPassword = body.password;
      const err = new Error('Firebase auth failed');
      err.response = { data: { error: { message: 'INVALID_PASSWORD' } } };
      throw err;
    },
  }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: ' Legacy Pass1! ', new_password: 'NewStrong1!' } }), res);
    assert.equal(res.statusCode, 401);
  });
  assert.equal(verifiedPassword, ' Legacy Pass1! ');
});

test('a Firebase verification network failure is not mislabeled as a wrong password', async () => {
  const db = fakeDb();
  await withChangePassword({
    db,
    axiosImpl: async () => {
      throw Object.assign(new Error('network timeout'), { code: 'ECONNABORTED', request: {} });
    },
  }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: 'CurrentStrong1!', new_password: 'NewStrong1!' } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'CURRENT_PASSWORD_VERIFICATION_UNAVAILABLE');
    assert.doesNotMatch(res.body.detail, /incorrect/i);
  });
});

test('a Firebase password-update failure is truthful and leaves sessions intact', async () => {
  const db = fakeDb();
  const originalError = console.error;
  console.error = () => {};
  try {
    await withChangePassword({
      db,
      updateUserImpl: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'auth/internal-error' }); },
      axiosImpl: async () => ({ data: {} }),
    }, async (changePassword) => {
      const res = fakeResponse();
      await changePassword(baseReq({ body: { current_password: 'CurrentStrong1!', new_password: 'NewStrong1!' } }), res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.code, 'PASSWORD_PROVIDER_FAILURE');
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(db._deletedSessionsFor.length, 0);
});

test('a weak new password is rejected server-side even if the client somehow skipped its own validation', async () => {
  const db = fakeDb();
  await withChangePassword({ db, axiosImpl: async () => ({ data: {} }) }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: 'CurrentStrong1!', new_password: 'weak' } }), res);
    assert.equal(res.statusCode, 400);
  });
});

test('the new password cannot be identical to the current password', async () => {
  const db = fakeDb();
  await withChangePassword({ db, axiosImpl: async () => ({ data: {} }) }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: 'SamePassword1!', new_password: 'SamePassword1!' } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.detail, /different/i);
  });
});

test('a successful change updates Firebase and invalidates every existing session (forces re-login everywhere)', async () => {
  const order = [];
  const db = fakeDb(order);
  let updatedUid = null;
  let updatedPassword = null;
  await withChangePassword({
    db,
    updateUserImpl: async (uid, patch) => {
      order.push('provider-update');
      updatedUid = uid;
      updatedPassword = patch.password;
    },
    axiosImpl: async () => ({ data: {} }),
  }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: 'CurrentStrong1!', new_password: 'NewStrong1!' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sessionCleanupComplete, true);
  });
  assert.equal(updatedUid, 'firebase-uid-a');
  assert.equal(updatedPassword, 'NewStrong1!');
  // Every active session for this user is deleted server-side — the mobile
  // client's own forced local logout (see change-password.jsx) is backed by
  // an equivalent server-side guarantee, not just client-side trust.
  assert.deepEqual(db._deletedSessionsFor, ['tenant-a']);
  assert.deepEqual(order, ['provider-update', 'sessions-delete']);
});
