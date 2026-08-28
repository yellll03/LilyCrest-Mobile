'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');
const databasePath = require.resolve('../config/database');
const firebasePath = require.resolve('../config/firebase');
const controllerPath = require.resolve('../controllers/auth.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie() { return this; },
  };
}

function fakeDb(user = null) {
  return {
    collection(name) {
      if (name === 'users') {
        return {
          findOne: async () => user,
          updateOne: async () => ({ matchedCount: user ? 1 : 0, modifiedCount: user ? 1 : 0 }),
          updateMany: async () => ({ modifiedCount: 0 }),
        };
      }
      return {
        insertOne: async () => ({ insertedId: 'audit' }),
        deleteMany: async () => ({ deletedCount: 0 }),
      };
    },
  };
}

function firebaseError(message) {
  const error = new Error(message);
  error.response = { data: { error: { message } } };
  return error;
}

async function withEmailLogin({ user, axiosImpl }, run) {
  const originalPost = axios.post;
  const originalApiKey = process.env.FIREBASE_API_KEY;
  process.env.FIREBASE_API_KEY = 'test-api-key';
  require(databasePath).getDb = () => fakeDb(user);
  axios.post = axiosImpl;
  delete require.cache[controllerPath];
  try {
    await run(require(controllerPath).login);
  } finally {
    axios.post = originalPost;
    if (originalApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalApiKey;
  }
}

function loginRequest(email = 'tenant@example.com', password = 'ValidPassword1!') {
  return { body: { email, password }, headers: {}, ip: '127.0.0.1' };
}

test('active registered tenant plus incorrect password returns INVALID_CREDENTIALS', async () => {
  const tenant = { user_id: 'tenant-a', email: 'tenant@example.com', role: 'tenant', status: 'active', is_active: true };
  await withEmailLogin({
    user: tenant,
    axiosImpl: async () => { throw firebaseError('INVALID_LOGIN_CREDENTIALS'); },
  }, async (login) => {
    const res = response();
    await login(loginRequest(), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'INVALID_CREDENTIALS');
    assert.match(res.body.detail, /invalid email or password/i);
  });
});

test('email that is not an authorized tenant returns TENANT_NOT_REGISTERED', async () => {
  await withEmailLogin({
    user: null,
    axiosImpl: async () => { throw firebaseError('EMAIL_NOT_FOUND'); },
  }, async (login) => {
    const res = response();
    await login(loginRequest('missing@example.com'), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'TENANT_NOT_REGISTERED');
    assert.equal(res.body.detail, 'This account is not registered as an active tenant.');
  });
});

test('inactive tenant returns TENANT_INACTIVE even when Firebase reports invalid credentials', async () => {
  const tenant = { user_id: 'tenant-inactive', email: 'tenant@example.com', role: 'tenant', status: 'inactive', is_active: false };
  await withEmailLogin({
    user: tenant,
    axiosImpl: async () => { throw firebaseError('INVALID_LOGIN_CREDENTIALS'); },
  }, async (login) => {
    const res = response();
    await login(loginRequest(), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'TENANT_INACTIVE');
    assert.match(res.body.detail, /inactive/i);
  });
});

test('login rejects whitespace before calling the password provider', async () => {
  let providerCalled = false;
  await withEmailLogin({
    user: null,
    axiosImpl: async () => { providerCalled = true; return { data: { localId: 'unused' } }; },
  }, async (login) => {
    const res = response();
    await login(loginRequest('tenant@example.com', 'Has Space1!'), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'PASSWORD_WHITESPACE_NOT_ALLOWED');
  });
  assert.equal(providerCalled, false);
});

test('Google and email/password authorization share the canonical tenant codes', () => {
  const source = require('node:fs').readFileSync(controllerPath, 'utf8');
  assert.match(source, /googleSignIn[\s\S]*?LOGIN_ERROR_CODES\.TENANT_NOT_REGISTERED/);
  assert.match(source, /googleSignIn[\s\S]*?LOGIN_ERROR_CODES\.TENANT_INACTIVE/);
});
