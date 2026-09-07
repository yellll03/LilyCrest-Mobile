'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const tenant = { user_id: 'tenant-a', role: 'tenant', name: 'Tenant A' };
const seed = { request_id: 'reopen-a', user_id: tenant.user_id, status: 'resolved', request_type: 'plumbing', description: 'The bathroom faucet is leaking.', updates: [], statusHistory: [] };
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => key === '$or'
    ? value.some((clause) => matches(doc, clause)) : doc[key] === value);
}
function setup(initial = seed, { failUpdate = false } = {}) {
  let doc = initial ? structuredClone(initial) : null;
  const notifications = [];
  const db = {
    get doc() { return doc; },
    collection(name) {
      const primary = name === 'maintenance_requests';
      return {
        async findOne(filter) { return primary && doc && matches(doc, filter) ? structuredClone(doc) : null; },
        find(filter) {
          const cursor = { sort() { return cursor; }, async toArray() { return primary && doc && matches(doc, filter) ? [structuredClone(doc)] : []; } };
          return cursor;
        },
        async insertOne(value) { doc = structuredClone(value); return { insertedId: value.request_id }; },
        async updateOne(filter, update) {
          if (failUpdate && filter.status) throw new Error('Simulated database failure');
          if (!primary || !doc || !matches(doc, filter)) return { matchedCount: 0 };
          doc = { ...doc, ...structuredClone(update.$set || {}) };
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  };
  require('../config/database').getDb = () => db;
  const push = require('../services/pushService');
  push.notifyMaintenanceStatusChange = async (...args) => { notifications.push(args); };
  push.notifyMaintenanceTenantUpdate = async (...args) => { notifications.push(args); };
  delete require.cache[require.resolve('../controllers/maintenance.controller')];
  const controller = require('../controllers/maintenance.controller');
  async function call(method, body = {}, user = tenant) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await controller[method]({ params: { requestId: doc?.request_id || seed.request_id }, body, user, query: {} }, res);
    return res;
  }
  return { db, call, notifications };
}

test('reopen preserves the thread, returns Pending, refreshes list/detail, and adds no new push behavior', async () => {
  const { db, call, notifications } = setup();
  const result = await call('reopenMaintenance', { reopen_note: '  Still leaking  ' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, 'pending');
  assert.equal(db.doc.reopen_note, 'Still leaking');
  assert.equal(db.doc.reopen_history.length, 1);
  assert.equal(db.doc.reopen_history[0].previous_status, 'resolved');
  assert.equal(db.doc.updates.at(-1).type, 'tenant_reopened');
  assert.equal(db.doc.statusHistory.at(-1).event, 'reopened');
  assert.equal((await call('getMaintenanceDetail')).body.status, 'pending');
  assert.equal((await call('getMyMaintenance')).body[0].status, 'pending');
  assert.equal(notifications.length, 0);
});

test('simultaneous reopen requests commit exactly one history entry', async () => {
  const { db, call } = setup();
  const responses = await Promise.all([call('reopenMaintenance'), call('reopenMaintenance')]);
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal(db.doc.reopen_history.length, 1);
  assert.equal(db.doc.updates.length, 1);
});

test('reopen rejects non-owners and preserves resolved status', async () => {
  const { db, call } = setup();
  assert.equal((await call('reopenMaintenance', {}, { ...tenant, user_id: 'other' })).statusCode, 404);
  assert.equal(db.doc.status, 'resolved');
  assert.equal(db.doc.updates.length, 0);
});

for (const status of ['pending', 'viewed', 'assigned', 'scheduled', 'in_progress', 'completed', 'closed', 'cancelled', 'rejected']) {
  test(`reopen preserves the existing rejection of ${status}`, async () => {
    const { db, call } = setup({ ...seed, status });
    assert.equal((await call('reopenMaintenance')).statusCode, 409);
    assert.equal(db.doc.status, status);
    assert.equal(db.doc.updates.length, 0);
  });
}

test('failed reopen returns the existing error without a status mutation', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { db, call } = setup(seed, { failUpdate: true });
  const result = await call('reopenMaintenance');
  assert.equal(result.statusCode, 500);
  assert.equal(result.body.detail, 'Failed to reopen maintenance request');
  assert.equal(db.doc.status, 'resolved');
  assert.equal(db.doc.updates.length, 0);
});

test('create, view, edit, admin progression, reopen, re-resolve and tenant completion retain the lifecycle', async () => {
  const { db, call, notifications } = setup(null);
  const created = await call('createMaintenance', { request_type: 'plumbing', description: seed.description, urgency: 'normal' });
  assert.equal(created.statusCode, 201);
  assert.equal((await call('getMaintenanceDetail')).body.status, 'pending');
  assert.equal((await call('updateMaintenance', { description: 'The kitchen faucet is also leaking.' })).statusCode, 200);
  assert.equal(db.doc.description, 'The kitchen faucet is also leaking.');
  const admin = { user_id: 'admin-a', role: 'admin' };
  for (const status of ['viewed', 'assigned', 'in_progress', 'resolved']) {
    assert.equal((await call('adminUpdateStatus', { status, notes: 'Repair progress' }, admin)).statusCode, 200, status);
    assert.equal(db.doc.status, status);
  }
  assert.equal(notifications.length, 4);
  assert.equal((await call('reopenMaintenance')).statusCode, 200);
  assert.equal(notifications.length, 4, 'Reopening itself does not currently send a push');
  for (const status of ['viewed', 'assigned', 'in_progress', 'resolved']) {
    assert.equal((await call('adminUpdateStatus', { status }, admin)).statusCode, 200);
  }
  assert.equal((await call('confirmMaintenanceResolved', { rating: 5, confirmed: true })).statusCode, 200);
  assert.equal(db.doc.status, 'completed');
  assert.equal((await call('reopenMaintenance')).statusCode, 409);
  assert.equal((await call('adminUpdateStatus', { status: 'pending' }, admin)).statusCode, 409);
});
