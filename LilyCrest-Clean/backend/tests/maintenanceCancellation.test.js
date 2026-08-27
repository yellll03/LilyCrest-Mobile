'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('../config/database');
const controllerPath = require.resolve('../controllers/maintenance.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function queryOwns(doc, query) {
  if (!doc || doc.request_id !== query.request_id) return false;
  if (!query.$or) return true;
  return query.$or.some((clause) => clause.user_id && clause.user_id === doc.user_id);
}

function buildDb(seed, { advanceBeforeUpdate = false } = {}) {
  let doc = { ...seed };
  return {
    get doc() { return doc; },
    collection(name) {
      if (name === 'maintenance_requests') {
        return {
          async findOne(query) {
            return queryOwns(doc, query) ? { ...doc } : null;
          },
          async updateOne(filter, update) {
            if (advanceBeforeUpdate && filter.status === 'pending') {
              doc = { ...doc, status: 'in_progress' };
            }
            if (!doc || doc.request_id !== filter.request_id) return { matchedCount: 0 };
            if (filter.status && doc.status !== filter.status) return { matchedCount: 0 };
            doc = { ...doc, ...(update.$set || {}) };
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === 'maintenance_inquiries') {
        return { findOne: async () => null };
      }
      return { findOne: async () => null, updateOne: async () => ({ matchedCount: 0 }) };
    },
  };
}

function loadController(db) {
  require(databasePath).getDb = () => db;
  delete require.cache[controllerPath];
  return require(controllerPath);
}

const baseRequest = {
  request_id: 'maint-stage-one',
  user_id: 'tenant-a',
  request_type: 'plumbing',
  description: 'The bathroom faucet is leaking.',
  urgency: 'normal',
  status: 'pending',
  created_at: new Date('2026-08-27T01:00:00.000Z'),
  updates: [{ update_id: 'created-1', type: 'tenant_submitted', visibility: 'tenant', message: 'Request submitted.' }],
  statusHistory: [{ event: 'created', status: 'pending' }],
};

test('only the canonical Stage 1 pending transition is cancellable by a tenant', () => {
  const { isMaintenanceTransitionAllowed } = loadController(buildDb(baseRequest));
  assert.equal(isMaintenanceTransitionAllowed('pending', 'cancelled', 'tenant', 'cancel'), true);
  for (const later of ['viewed', 'assigned', 'scheduled', 'in_progress', 'resolved', 'completed']) {
    assert.equal(isMaintenanceTransitionAllowed(later, 'cancelled', 'tenant', 'cancel'), false, later);
  }
});

test('owner can cancel a Stage 1 request and the audit history is preserved', async () => {
  const db = buildDb(baseRequest);
  const { cancelMaintenance } = loadController(db);
  const res = response();

  await cancelMaintenance({
    params: { requestId: baseRequest.request_id },
    user: { user_id: 'tenant-a', role: 'tenant', name: 'Tenant A' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(db.doc.status, 'cancelled');
  assert.equal(db.doc.updates.length, 2);
  assert.equal(db.doc.updates.at(-1).type, 'tenant_cancelled');
  assert.equal(db.doc.statusHistory.length, 2);
  assert.equal(db.doc.statusHistory.at(-1).event, 'cancelled');
});

test('tenant cannot cancel another tenant request', async () => {
  const db = buildDb(baseRequest);
  const { cancelMaintenance } = loadController(db);
  const res = response();

  await cancelMaintenance({
    params: { requestId: baseRequest.request_id },
    user: { user_id: 'tenant-b', role: 'tenant', name: 'Tenant B' },
  }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(db.doc.status, 'pending');
});

test('later-stage and concurrent advancement both reject cancellation', async () => {
  const laterDb = buildDb({ ...baseRequest, status: 'in_progress' });
  const laterController = loadController(laterDb);
  const laterRes = response();
  await laterController.cancelMaintenance({
    params: { requestId: baseRequest.request_id },
    user: { user_id: 'tenant-a', role: 'tenant' },
  }, laterRes);
  assert.equal(laterRes.statusCode, 409);

  const raceDb = buildDb(baseRequest, { advanceBeforeUpdate: true });
  const raceController = loadController(raceDb);
  const raceRes = response();
  await raceController.cancelMaintenance({
    params: { requestId: baseRequest.request_id },
    user: { user_id: 'tenant-a', role: 'tenant' },
  }, raceRes);
  assert.equal(raceRes.statusCode, 409);
  assert.match(raceRes.body.detail, /status changed/i);
  assert.equal(raceDb.doc.status, 'in_progress');
});
