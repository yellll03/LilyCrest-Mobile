const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const axios = require('axios');
const database = require('../config/database');
const controller = require('../controllers/canonicalPasswordReset.controller');

function dbForRole(role = 'tenant', overrides = {}) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return { findOne: async () => ({ user_id: 'tenant-1', email: 'tenant@example.com', role, is_active: true, status: 'active', ...overrides }) };
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('standalone mobile forgot-password proxies to the canonical Firebase reset request API', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  const calls = [];
  axios.post = async (...args) => { calls.push(args); return { status: 200 }; };
  process.env.CANONICAL_API_URL = 'https://api.lilycrest.space/';
  database.getDb = () => dbForRole('tenant');
  try {
    const res = response();
    await controller.requestPasswordReset({ body: { email: ' Tenant@Example.com ' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'https://api.lilycrest.space/api/m/auth/forgot-password');
    assert.deepEqual(calls[0][1], { email: 'tenant@example.com' });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
    delete process.env.CANONICAL_API_URL;
  }
});

test('canonical provider failure is reported truthfully without exposing provider details', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  const originalError = console.error;
  axios.post = async () => { throw Object.assign(new Error('private provider detail'), { code: 'ECONNRESET' }); };
  console.error = () => {};
  database.getDb = () => dbForRole('tenant');
  try {
    const res = response();
    await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'PASSWORD_RESET_UNAVAILABLE');
    assert.match(res.body.detail, /temporarily unavailable/i);
    assert.doesNotMatch(JSON.stringify(res.body), /provider|ECONNRESET/i);
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
    console.error = originalError;
  }
});

test('malformed email is rejected locally without calling the canonical service', async () => {
  const originalPost = axios.post;
  let called = false;
  axios.post = async () => { called = true; };
  try {
    const res = response();
    await controller.requestPasswordReset({ body: { email: 'not-an-email' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
  }
});

for (const role of ['applicant', 'admin', 'superadmin', 'branch_admin', 'owner', 'staff']) {
  test(`${role} receives the safe tenant-reset rejection without reaching the canonical reset API`, async () => {
    const originalPost = axios.post;
    const originalGetDb = database.getDb;
    let called = false;
    axios.post = async () => { called = true; };
    database.getDb = () => dbForRole(role);
    try {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com', role: 'tenant' } }, res);
      assert.equal(res.statusCode, 422);
      assert.equal(res.body.code, 'TENANT_RESET_NOT_AVAILABLE');
      assert.equal(res.body.detail, controller.RESET_NOT_AVAILABLE);
      assert.equal(called, false);
    } finally {
      axios.post = originalPost;
      database.getDb = originalGetDb;
    }
  });
}

test('unknown email receives a safe deliberate rejection and does not reach the canonical reset API', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; };
  database.getDb = () => ({ collection: () => ({ findOne: async () => null }) });
  try {
    const res = response();
    await controller.requestPasswordReset({ body: { email: 'unknown@example.com', role: 'tenant' } }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'TENANT_RESET_NOT_AVAILABLE');
    assert.equal(res.body.detail, controller.RESET_NOT_AVAILABLE);
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('inactive tenant cannot enter the reset flow', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; };
  database.getDb = () => dbForRole('tenant', { is_active: false, status: 'inactive' });
  try {
    const res = response();
    await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.code, 'TENANT_RESET_NOT_AVAILABLE');
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('the HTTP route has no custom-token generator and the proxy source stores no reset credential', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.routes.js'), 'utf8');
  const proxy = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'canonicalPasswordReset.controller.js'), 'utf8');
  assert.match(routes, /router\.post\('\/forgot-password', authLimiter, canonicalPasswordResetController\.requestPasswordReset\)/);
  assert.doesNotMatch(routes, /router\.post\('\/forgot-password', authLimiter, authController\.forgotPassword\)/);
  assert.doesNotMatch(proxy, /password_reset_tokens|randomBytes|insertOne/);
  assert.match(proxy, /isTenantMobileRole\(user\.role\)/);
  assert.match(proxy, /\/api\/m\/auth\/forgot-password/);
  assert.doesNotMatch(proxy, /\/api\/auth\/request-password-reset/);
});
