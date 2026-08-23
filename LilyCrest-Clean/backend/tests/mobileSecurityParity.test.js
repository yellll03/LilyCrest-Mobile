// Regression coverage for the mobile-backend security-parity patch:
//   1. PayMongo webhook signature verification fails closed.
//   2. POST /billing and PUT /billing/:billingId remain admin-gated (tenant
//      cannot create bills or mutate bill status).
//   3. Retired live-chat paths cannot expose or mutate legacy support data.
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

// ── Legacy live-chat retirement ─────────────────────────────────────────────

test('GET /chatbot/live-status/:sessionId route requires authentication', () => {
  delete require.cache[require.resolve('../routes/chatbot.routes')];
  const router = require('../routes/chatbot.routes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/live-status/:sessionId' && l.route.methods.get);
  assert.ok(layer, 'GET /chatbot/live-status/:sessionId route must exist');
  const handlerNames = layer.route.stack.map((s) => s.handle.name);
  assert.ok(handlerNames.includes('authMiddleware'), `live-status route must require authMiddleware, got: ${handlerNames.join(', ')}`);
});

test('every retired live-chat handler fails closed without touching legacy data', async () => {
  let dbTouched = false;
  const db = { collection() { dbTouched = true; throw new Error('legacy database access is forbidden'); } };
  const controller = loadWithDb('../controllers/chatbot.controller', db);
  const handlers = [
    controller.getLiveStatus,
    controller.getLiveChats,
    controller.acceptLiveChat,
    controller.sendAdminMessage,
    controller.closeLiveChat,
    controller.getChatHistory,
  ];

  for (const handler of handlers) {
    const res = response();
    await handler({ params: {}, body: {}, user: { user_id: 'tenant-a', role: 'tenant' } }, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.code, 'LEGACY_SUPPORT_RETIRED');
    assert.equal(res.body.canonical.tenant, '/api/chat/me');
    assert.equal(res.body.canonical.admin, '/api/chat/admin/conversations');
  }

  assert.equal(dbTouched, false, 'retired handlers must never read or mutate legacy support collections');
});
