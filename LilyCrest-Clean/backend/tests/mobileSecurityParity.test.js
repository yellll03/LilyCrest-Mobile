// Regression coverage for the mobile-backend security-parity patch:
//   1. PayMongo webhook signature verification fails closed.
//   2. POST /billing and PUT /billing/:billingId remain admin-gated (tenant
//      cannot create bills or mutate bill status).
//   3. GET /chatbot/live-status/:sessionId enforces session ownership
//      (cross-tenant IDOR).
const test = require('node:test');
const assert = require('node:assert/strict');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function loadWithDb(modulePath, db) {
  const databasePath = require.resolve('../config/database');
  require(databasePath).getDb = () => db;
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

// ── PayMongo webhook fail-closed ────────────────────────────────────────────

test('mobile PayMongo webhook rejects unsigned requests when PAYMONGO_WEBHOOK_SECRET is unset', async () => {
  const previousSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  const previousEnv = process.env.NODE_ENV;
  delete process.env.PAYMONGO_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'development'; // the fail-open bug only triggered outside 'production'
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return {}; } };
  try {
    const { handleWebhook } = loadWithDb('../controllers/paymongo.controller', db);
    const res = response();
    await handleWebhook({
      headers: {},
      body: { data: { attributes: { type: 'checkout_session.payment.paid', data: { attributes: { metadata: { billing_id: 'BILL-1', user_id: 'tenant-a' } } } } } },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(dbTouched, false, 'an unsigned webhook must never reach the database');
  } finally {
    if (previousSecret === undefined) delete process.env.PAYMONGO_WEBHOOK_SECRET;
    else process.env.PAYMONGO_WEBHOOK_SECRET = previousSecret;
    process.env.NODE_ENV = previousEnv;
  }
});

test('mobile PayMongo webhook rejects an invalid signature even when the secret is configured', async () => {
  const previousSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
  process.env.PAYMONGO_WEBHOOK_SECRET = 'test-secret';
  let dbTouched = false;
  const db = { collection() { dbTouched = true; return {}; } };
  try {
    const { handleWebhook } = loadWithDb('../controllers/paymongo.controller', db);
    const res = response();
    await handleWebhook({
      headers: { 'paymongo-signature': 't=1700000000,te=deadbeef' },
      body: { data: { attributes: { type: 'checkout_session.payment.paid', data: { attributes: { metadata: { billing_id: 'BILL-1', user_id: 'tenant-a' } } } } } },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(dbTouched, false);
  } finally {
    if (previousSecret === undefined) delete process.env.PAYMONGO_WEBHOOK_SECRET;
    else process.env.PAYMONGO_WEBHOOK_SECRET = previousSecret;
  }
});

// ── Billing create/status-mutation stay admin-gated ─────────────────────────

test('POST /billing route enforces adminMiddleware (tenants cannot create bills)', () => {
  delete require.cache[require.resolve('../routes/billing.routes')];
  const router = require('../routes/billing.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.post);
  assert.ok(layer, 'POST /billing route must exist');
  const handlerNames = layer.route.stack.map((s) => s.handle.name);
  assert.ok(handlerNames.includes('adminMiddleware'), `POST /billing must enforce adminMiddleware, got: ${handlerNames.join(', ')}`);
});

test('PUT /billing/:billingId route enforces adminMiddleware (tenants cannot mutate bill status)', () => {
  delete require.cache[require.resolve('../routes/billing.routes')];
  const router = require('../routes/billing.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/:billingId' && l.route.methods.put);
  assert.ok(layer, 'PUT /billing/:billingId route must exist');
  const handlerNames = layer.route.stack.map((s) => s.handle.name);
  assert.ok(handlerNames.includes('adminMiddleware'), `PUT /billing/:billingId must enforce adminMiddleware, got: ${handlerNames.join(', ')}`);
});

// ── Live-chat cross-tenant IDOR ─────────────────────────────────────────────

test('GET /chatbot/live-status/:sessionId route requires authentication', () => {
  delete require.cache[require.resolve('../routes/chatbot.routes')];
  const router = require('../routes/chatbot.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/live-status/:sessionId' && l.route.methods.get);
  assert.ok(layer, 'GET /chatbot/live-status/:sessionId route must exist');
  const handlerNames = layer.route.stack.map((s) => s.handle.name);
  assert.ok(handlerNames.includes('authMiddleware'), `live-status route must require authMiddleware, got: ${handlerNames.join(', ')}`);
});

test('tenant can read their own live-chat status', async () => {
  const { getLiveStatus, __test } = require('../controllers/chatbot.controller');
  __test.liveChatQueue.set('tenant-a_own', {
    user_id: 'tenant-a', status: 'active', position: 1, admin_name: 'Admin', messages: [{ sender: 'admin', content: 'hi tenant-a' }],
  });
  try {
    const res = response();
    await getLiveStatus({ params: { sessionId: 'tenant-a_own' }, user: { user_id: 'tenant-a' } }, res);
    assert.equal(res.body.active, true);
    assert.equal(res.body.admin_name, 'Admin');
    assert.equal(res.body.messages.length, 1);
  } finally {
    __test.liveChatQueue.delete('tenant-a_own');
  }
});

test('tenant cannot read another tenant live-chat status/messages (cross-tenant IDOR)', async () => {
  const { getLiveStatus, __test } = require('../controllers/chatbot.controller');
  __test.liveChatQueue.set('tenant-b_secret', {
    user_id: 'tenant-b', status: 'active', position: 1, admin_name: 'Admin B', messages: [{ sender: 'admin', content: 'confidential to tenant-b' }],
  });
  try {
    const res = response();
    await getLiveStatus({ params: { sessionId: 'tenant-b_secret' }, user: { user_id: 'tenant-a' } }, res);
    assert.deepEqual(res.body, { active: false, in_queue: false });
    assert.equal(res.body.messages, undefined);
    assert.equal(res.body.admin_name, undefined);
  } finally {
    __test.liveChatQueue.delete('tenant-b_secret');
  }
});

test('nonexistent live-chat session returns the normal not-found shape', async () => {
  const { getLiveStatus } = require('../controllers/chatbot.controller');
  const res = response();
  await getLiveStatus({ params: { sessionId: 'nobody_000' }, user: { user_id: 'tenant-a' } }, res);
  assert.deepEqual(res.body, { active: false, in_queue: false });
});

test('getOwnedLiveChat only resolves sessions owned by the requesting user', () => {
  const { __test } = require('../controllers/chatbot.controller');
  __test.liveChatQueue.set('owner-check_1', { user_id: 'tenant-a', status: 'waiting' });
  try {
    assert.ok(__test.getOwnedLiveChat('owner-check_1', 'tenant-a'));
    assert.equal(__test.getOwnedLiveChat('owner-check_1', 'tenant-b'), null);
    assert.equal(__test.getOwnedLiveChat('missing-session', 'tenant-a'), null);
  } finally {
    __test.liveChatQueue.delete('owner-check_1');
  }
});
