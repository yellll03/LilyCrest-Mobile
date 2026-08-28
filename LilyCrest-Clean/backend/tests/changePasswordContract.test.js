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
  const userPatches = [];
  return {
    _deletedSessionsFor: deletedSessionsFor,
    _userPatches: userPatches,
    collection(name) {
      if (name === 'user_sessions') {
        return { deleteMany: async (query) => {
          order.push('sessions-delete');
          deletedSessionsFor.push(query.user_id);
          return { deletedCount: 1 };
        } };
      }
      if (name === 'users') {
        return {
          findOne: async () => ({ user_id: 'tenant-a', securityVersion: 2 }),
          updateMany: async () => ({ modifiedCount: 0 }),
          updateOne: async (_filter, update) => {
            if (update.$set?.securityVersion !== undefined) {
              order.push('security-version-bump');
              userPatches.push(update.$set);
            }
            return { matchedCount: 1, modifiedCount: 1 };
          },
          insertOne: async () => ({ insertedId: 'fake-id' }),
          deleteMany: async () => ({ deletedCount: 0 }),
        };
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
function patchAdminAuth(updateUserImpl, revokedUids = []) {
  const { admin } = require(firebasePath);
  const proto = Object.getPrototypeOf(admin);
  const original = Object.getOwnPropertyDescriptor(proto, 'auth');
  Object.defineProperty(proto, 'auth', {
    configurable: true,
    value: () => ({
      updateUser: updateUserImpl || (async () => {}),
      // Provider-side revocation remains defense in depth alongside the
      // backend session security-version gate.
      revokeRefreshTokens: async (uid) => { revokedUids.push(uid); },
    }),
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
async function withChangePassword({ db, updateUserImpl, axiosImpl, revokedUids }, fn) {
  process.env.FIREBASE_API_KEY = 'test-firebase-api-key';
  require(databasePath).getDb = () => db;
  const restoreAdminAuth = patchAdminAuth(updateUserImpl, revokedUids);
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

test('whitespace in the current password is rejected before Firebase verification', async () => {
  const db = fakeDb();
  let firebaseCalled = false;
  await withChangePassword({
    db,
    axiosImpl: async () => { firebaseCalled = true; return { data: { localId: 'firebase-uid-a' } }; },
  }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({ body: { current_password: ' Legacy Pass1! ', new_password: 'NewStrong1!' } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'PASSWORD_WHITESPACE_NOT_ALLOWED');
  });
  assert.equal(firebaseCalled, false);
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
      axiosImpl: async () => ({ data: { localId: 'firebase-uid-a' } }),
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
  const revokedUids = [];
  let updatedUid = null;
  let updatedPassword = null;
  await withChangePassword({
    db,
    revokedUids,
    updateUserImpl: async (uid, patch) => {
      order.push('provider-update');
      updatedUid = uid;
      updatedPassword = patch.password;
    },
    axiosImpl: async () => ({ data: { localId: 'firebase-uid-a' } }),
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
  assert.deepEqual(order, ['provider-update', 'security-version-bump', 'sessions-delete']);
  // Session revocation is belt-and-braces: the account's securityVersion is
  // advanced (authMiddleware refuses any session stamped with the old one)
  // *and* the session rows are deleted. Either alone is sufficient, so a
  // partial infrastructure failure can't leave a pre-change session usable.
  assert.equal(db._userPatches.length, 1);
  assert.equal(db._userPatches[0].securityVersion, 3);
  assert.equal(db._userPatches[0].security_version, 3);
  assert.ok(db._userPatches[0].password_changed_at instanceof Date);
  // The provider-side refresh token dies with the old password too.
  assert.deepEqual(revokedUids, ['firebase-uid-a']);
});

test('a verified Firebase UID repairs a missing Mongo link and still completes the password change', async () => {
  const db = fakeDb();
  let updatedUid = null;
  await withChangePassword({
    db,
    updateUserImpl: async (uid) => { updatedUid = uid; },
    axiosImpl: async () => ({ data: { localId: 'verified-firebase-uid' } }),
  }, async (changePassword) => {
    const res = fakeResponse();
    await changePassword(baseReq({
      user: { user_id: 'tenant-a', email: 'ana@example.com', name: 'Ana' },
      body: { current_password: 'CurrentStrong1!', new_password: 'NewStrong1!' },
    }), res);
    assert.equal(res.statusCode, 200);
  });
  assert.equal(updatedUid, 'verified-firebase-uid');
});

test('a change is reported as failed if sessions cannot be invalidated at all', async () => {
  const brokenDb = {
    collection() {
      return {
        findOne: async () => { throw new Error('mongo down'); },
        updateOne: async () => { throw new Error('mongo down'); },
        deleteMany: async () => { throw new Error('mongo down'); },
        insertOne: async () => ({ insertedId: 'fake-id' }),
      };
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await withChangePassword({
      db: brokenDb,
      updateUserImpl: async () => {},
      axiosImpl: async () => ({ data: { localId: 'firebase-uid-a' } }),
    }, async (changePassword) => {
      const res = fakeResponse();
      await changePassword(baseReq({ body: { current_password: 'CurrentStrong1!', new_password: 'NewStrong1!' } }), res);
      // The credential really did change, but old sessions may still be live.
      // Returning 200 here would be a silent security lie.
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.code, 'SESSION_FINALIZATION_FAILED');
      assert.equal(res.body.sessionCleanupComplete, false);
    });
  } finally {
    console.error = originalError;
  }
});
