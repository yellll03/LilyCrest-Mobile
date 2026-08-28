'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const axios = require('axios');

const databasePath = require.resolve('../config/database');
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

function applicantDb() {
  const applicant = {
    user_id: 'applicant-a', email: 'applicant@example.com', role: 'applicant', status: 'active', is_active: true,
  };
  return {
    collection(name) {
      if (name === 'users') {
        return {
          async findOne(query) {
            const allowedRoles = query.role?.$in;
            return Array.isArray(allowedRoles) && allowedRoles.includes(applicant.role) ? applicant : null;
          },
        };
      }
      return {
        async insertOne() { return { insertedId: 'audit' }; },
        async deleteMany() { return { deletedCount: 0 }; },
      };
    },
  };
}

test('a Firebase-authenticated applicant cannot proceed through tenant email login', async () => {
  const originalPost = axios.post;
  const originalApiKey = process.env.FIREBASE_API_KEY;
  process.env.FIREBASE_API_KEY = 'test-api-key';
  axios.post = async () => ({ data: { localId: 'firebase-applicant-a' } });
  require(databasePath).getDb = () => applicantDb();
  delete require.cache[controllerPath];
  const { login } = require(controllerPath);
  try {
    const res = response();
    await login({
      body: { email: 'applicant@example.com', password: 'ValidPassword1!' },
      headers: {},
      ip: '127.0.0.1',
    }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'TENANT_NOT_REGISTERED');
    assert.match(res.body.detail, /not registered as an active tenant/i);
  } finally {
    axios.post = originalPost;
    if (originalApiKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalApiKey;
  }
});

test('email, Google, OTP, and refresh paths all use strict tenant/resident authorization', () => {
  const source = fs.readFileSync(controllerPath, 'utf8');
  const strictRoleQueries = source.match(/role:\s*\{\s*\$in:\s*\['tenant', 'resident'\]\s*\}/g) || [];
  assert.ok(strictRoleQueries.length >= 5, `expected strict database role filters across auth paths; saw ${strictRoleQueries.length}`);
  assert.match(source, /verifyOtp[\s\S]*?isTenantMobileRole\(tenant\.role\)/);
  assert.match(source, /refreshSession[\s\S]*?isTenantMobileRole\(user\.role\)/);
});
