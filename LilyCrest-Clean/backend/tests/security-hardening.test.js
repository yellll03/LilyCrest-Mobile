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

test('admin creates a bill for Tenant A using canonical tenant_id and separate created_by', async () => {
  let inserted;
  const db = { collection(name) { return {
    findOne: async () => name === 'users' ? { _id: 'tenant-object-id', user_id: 'tenant-a', role: 'tenant' } : null,
    insertOne: async (doc) => { inserted = doc; },
  }; } };
  const { createBilling } = loadWithDb('../controllers/billing.controller', db);
  const res = response();
  await createBilling({ body: { tenant_id: 'tenant-a', user_id: 'tenant-b', due_date: '2026-08-01', rent: 5000 }, user: { user_id: 'admin-1', role: 'admin' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(inserted.user_id, 'tenant-a');
  assert.equal(inserted.created_by, 'admin-1');
});

test('canonical tenant_id accepts the Mongo ObjectId format used by admin records', async () => {
  const adminTenantId = '507f1f77bcf86cd799439011';
  let lookup;
  const db = { collection(name) { return {
    findOne: async (query) => {
      if (name === 'users') { lookup = query; return { _id: adminTenantId, user_id: 'tenant-a', role: 'tenant' }; }
      return null;
    },
    insertOne: async () => {},
  }; } };
  const { createBilling } = loadWithDb('../controllers/billing.controller', db);
  const res = response();
  await createBilling({ body: { tenant_id: adminTenantId, due_date: '2026-08-01', rent: 5000 }, user: { user_id: 'admin-1', role: 'admin' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(String(lookup.$and[0].$or[1]._id), adminTenantId);
});

test('invalid bill totals and statuses are rejected', async () => {
  const db = { collection(name) { return { findOne: async () => name === 'users' ? { user_id: 'tenant-a', role: 'tenant' } : null }; } };
  const billing = loadWithDb('../controllers/billing.controller', db);
  const badTotal = response();
  await billing.createBilling({ body: { tenant_id: 'tenant-a', due_date: '2026-08-01', rent: -1 }, user: { user_id: 'admin-1', role: 'admin' } }, badTotal);
  assert.equal(badTotal.statusCode, 400);
  const badStatus = response();
  await billing.updateBilling({ params: { billingId: 'x' }, body: { status: 'invented' }, user: { user_id: 'admin-1', role: 'admin' } }, badStatus);
  assert.equal(badStatus.statusCode, 400);
});

test('demo billing is disabled by default', () => {
  delete process.env.ENABLE_DEMO_DATA;
  const billing = loadWithDb('../controllers/billing.controller', { collection() { return {}; } });
  assert.deepEqual(billing.DEMO_BILLS, {});
});

test('Tenant B cannot access Tenant A bill', async () => {
  const cursor = { sort() { return this; }, limit() { return this; }, toArray: async () => [] };
  const db = { collection() { return { find: () => cursor }; } };
  const { getBillingById } = loadWithDb('../controllers/billing.controller', db);
  const res = response();
  await getBillingById({ params: { billingId: 'bill-a' }, user: { user_id: 'tenant-b', role: 'tenant' } }, res);
  assert.equal(res.statusCode, 404);
});

test('Tenant B cannot poll Tenant A PayMongo checkout', async () => {
  const db = { collection(name) { return {
    findOne: async () => name === 'bills' ? { paymongoSessionId: 'checkout-a', userId: 'tenant-a' } : null,
  }; } };
  const axios = require('axios');
  const originalGet = axios.get;
  let paymongoCalled = false;
  axios.get = async () => { paymongoCalled = true; throw new Error('must not call PayMongo'); };
  try {
    const { getCheckoutStatus } = loadWithDb('../controllers/paymongo.controller', db);
    const res = response();
    await getCheckoutStatus({ params: { checkoutId: 'checkout-a' }, user: { user_id: 'tenant-b', role: 'tenant' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(paymongoCalled, false);
  } finally {
    axios.get = originalGet;
  }
});

test('maintenance transition policy rejects invalid admin and tenant transitions', () => {
  const { isMaintenanceTransitionAllowed } = require('../controllers/maintenance.controller');
  assert.equal(isMaintenanceTransitionAllowed('pending', 'resolved'), false);
  assert.equal(isMaintenanceTransitionAllowed('completed', 'pending', 'tenant', 'reopen'), false);
  assert.equal(isMaintenanceTransitionAllowed('resolved', 'completed', 'tenant', 'confirm_resolved'), true);
});

test('inactive tenant session is rejected', async () => {
  let deleted = false;
  const db = { collection(name) { return {
    findOne: async () => name === 'user_sessions' ? { user_id: 'tenant-a' } : { user_id: 'tenant-a', role: 'tenant', status: 'pending_approval' },
    deleteMany: async () => { deleted = true; },
  }; } };
  const { authMiddleware } = loadWithDb('../middleware/auth', db);
  const res = response();
  await authMiddleware({ headers: { authorization: 'Bearer valid' } }, res, () => assert.fail('must not authenticate'));
  assert.equal(res.statusCode, 403);
  assert.equal(deleted, true);
});

test('notification read ownership is enforced', async () => {
  let wrote = false;
  const emptyCursor = { sort() { return this; }, limit() { return this; }, toArray: async () => [] };
  const db = { collection(name) { return {
    find: () => emptyCursor,
    updateOne: async () => { wrote = true; },
  }; } };
  const { markNotificationRead } = loadWithDb('../controllers/notification.controller', db);
  const res = response();
  await markNotificationRead({ params: { notificationId: 'tenant-a-secret' }, user: { user_id: 'tenant-b', role: 'tenant' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(wrote, false);
});

test('public registration is disabled by default', async () => {
  delete process.env.ALLOW_PUBLIC_REGISTRATION;
  const { register } = loadWithDb('../controllers/auth.controller', { collection() { throw new Error('database must not be reached'); } });
  const res = response();
  await register({ body: {} }, res);
  assert.equal(res.statusCode, 403);
});
