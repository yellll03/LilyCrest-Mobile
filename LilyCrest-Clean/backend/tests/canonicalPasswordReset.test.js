const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const axios = require('axios');
const database = require('../config/database');
const controller = require('../controllers/canonicalPasswordReset.controller');

// The mobile forgot-password proxy is enumeration-safe: a registered eligible
// tenant and an unknown / ineligible / non-tenant email receive exactly the
// same generic 200. The proxy only forwards to the canonical upstream for an
// eligible tenant, never creates or stores a reset credential, and never POSTs
// back into itself.

function dbForUser(user) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return { findOne: async () => user };
    },
  };
}

function dbForRole(role = 'tenant', overrides = {}) {
  return dbForUser({ user_id: 'tenant-1', email: 'tenant@example.com', role, is_active: true, status: 'active', ...overrides });
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    });
}

test('an eligible tenant is forwarded to the canonical Firebase reset request API and gets the generic 200', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  const calls = [];
  axios.post = async (...args) => { calls.push(args); return { status: 200 }; };
  database.getDb = () => dbForRole('tenant');
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space/', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: ' Tenant@Example.com ' } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'https://api.lilycrest.space/api/m/auth/forgot-password');
      assert.deepEqual(calls[0][1], { email: 'tenant@example.com' });
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('a legacy resident role is also treated as an eligible tenant', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; return { status: 200 }; };
  database.getDb = () => dbForRole('resident');
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'resident@example.com' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(called, true);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('malformed email is rejected locally (400) without a DB or canonical call', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let posted = false;
  let dbTouched = false;
  axios.post = async () => { posted = true; };
  database.getDb = () => { dbTouched = true; return dbForRole('tenant'); };
  try {
    const res = response();
    await controller.requestPasswordReset({ body: { email: 'not-an-email' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(posted, false);
    assert.equal(dbTouched, false);
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('an unknown email gets the identical generic 200 and never reaches the canonical API', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; };
  database.getDb = () => dbForUser(null);
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'unknown@example.com' } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
      assert.equal(called, false);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

for (const role of ['applicant', 'admin', 'superadmin', 'branch_admin', 'owner', 'staff']) {
  test(`a ${role} account gets the identical generic 200 and triggers no upstream reset`, async () => {
    const originalPost = axios.post;
    const originalGetDb = database.getDb;
    let called = false;
    axios.post = async () => { called = true; };
    database.getDb = () => dbForRole(role);
    try {
      await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
        const res = response();
        await controller.requestPasswordReset({ body: { email: 'person@example.com' } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
        assert.equal(called, false);
      });
    } finally {
      axios.post = originalPost;
      database.getDb = originalGetDb;
    }
  });
}

test('an inactive tenant gets the identical generic 200 and triggers no upstream reset', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; };
  database.getDb = () => dbForRole('tenant', { is_active: false, status: 'inactive' });
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
      assert.equal(called, false);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('the eligible-tenant response is byte-identical to the unknown-email response (no enumeration)', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  axios.post = async () => ({ status: 200 });
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      database.getDb = () => dbForRole('tenant');
      const eligibleRes = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, eligibleRes);

      database.getDb = () => dbForUser(null);
      const unknownRes = response();
      await controller.requestPasswordReset({ body: { email: 'nobody@example.com' } }, unknownRes);

      assert.equal(eligibleRes.statusCode, unknownRes.statusCode);
      assert.deepEqual(eligibleRes.body, unknownRes.body);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('a canonical upstream outage for an eligible tenant does NOT change the externally visible response', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  const originalError = console.error;
  const logged = [];
  axios.post = async () => { throw Object.assign(new Error('private provider detail'), { code: 'ECONNRESET' }); };
  console.error = (...args) => { logged.push(args.join(' ')); };
  database.getDb = () => dbForRole('tenant');
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
      // Wait a tick for the fire-and-forget .catch() to run.
      await new Promise((r) => setImmediate(r));
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
      // The failure is observable only server-side, and never leaks detail.
      assert.ok(logged.some((line) => /Upstream forward failed/.test(line)));
      assert.doesNotMatch(logged.join('\n'), /private provider detail/);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
    console.error = originalError;
  }
});

test('ENUMERATION ORACLE GUARD: during an upstream outage, an eligible tenant and an unknown email get an identical externally visible response', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  const originalError = console.error;
  // Simulate a full canonical outage: every forward attempt fails.
  axios.post = async () => { throw Object.assign(new Error('canonical down'), { code: 'ECONNREFUSED' }); };
  console.error = () => {};
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      database.getDb = () => dbForRole('tenant');
      const eligibleRes = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, eligibleRes);

      database.getDb = () => dbForUser(null);
      const unknownRes = response();
      await controller.requestPasswordReset({ body: { email: 'nobody@example.com' } }, unknownRes);

      await new Promise((r) => setImmediate(r));

      // Status, body, and shape must be indistinguishable — no existence oracle.
      assert.equal(eligibleRes.statusCode, unknownRes.statusCode);
      assert.equal(eligibleRes.statusCode, 200);
      assert.deepEqual(eligibleRes.body, unknownRes.body);
      assert.deepEqual(eligibleRes.body, { message: controller.GENERIC_RESPONSE });
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
    console.error = originalError;
  }
});

test('the forward is fire-and-forget: the 200 is returned before the upstream call settles', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let resolveUpstream;
  let settledBeforeResponse = null;
  // Never resolves during the handler call — if the handler awaited it, the
  // test would hang / the response would not be set yet.
  axios.post = () => new Promise((resolve) => { resolveUpstream = resolve; });
  database.getDb = () => dbForRole('tenant');
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
      settledBeforeResponse = res.body;
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
    });
  } finally {
    if (resolveUpstream) resolveUpstream({ status: 200 });
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
  assert.deepEqual(settledBeforeResponse, { message: controller.GENERIC_RESPONSE });
});

test('resolveCanonicalApiUrl: self-recursion guard — no forward when CANONICAL_API_URL equals BACKEND_URL', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; };
  database.getDb = () => dbForRole('tenant');
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space/', BACKEND_URL: 'https://api.lilycrest.space' }, async () => {
      assert.equal(controller.resolveCanonicalApiUrl(), null);
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { message: controller.GENERIC_RESPONSE });
      assert.equal(called, false);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('resolveCanonicalApiUrl: no forward when CANONICAL_API_URL is unset', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; };
  database.getDb = () => dbForRole('tenant');
  try {
    await withEnv({ CANONICAL_API_URL: undefined, BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      assert.equal(controller.resolveCanonicalApiUrl(), null);
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(called, false);
    });
  } finally {
    axios.post = originalPost;
    database.getDb = originalGetDb;
  }
});

test('the OAuth/provider of an eligible tenant does not change the outcome (provider ≠ tenancy)', async () => {
  const originalPost = axios.post;
  const originalGetDb = database.getDb;
  let called = false;
  axios.post = async () => { called = true; return { status: 200 }; };
  database.getDb = () => dbForRole('tenant', { provider: 'google', google_email: 'tenant@gmail.com' });
  try {
    await withEnv({ CANONICAL_API_URL: 'https://api.lilycrest.space', BACKEND_URL: 'https://mobile-proxy.example.com' }, async () => {
      const res = response();
      await controller.requestPasswordReset({ body: { email: 'tenant@example.com' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(called, true);
    });
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
  assert.match(proxy, /isTenantResetEligible/);
  assert.match(proxy, /resolveCanonicalApiUrl/);
  assert.match(proxy, /\/api\/m\/auth\/forgot-password/);
  assert.doesNotMatch(proxy, /\/api\/auth\/request-password-reset/);
});
