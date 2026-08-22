const test = require('node:test');
const assert = require('node:assert/strict');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('tenant reply shows Sent until lastAdminSeenAt passes its timestamp', () => {
  const { buildTenantRequestResponse } = require('../controllers/maintenance.controller');
  const detail = buildTenantRequestResponse({
    request_id: 'request-seen', user_id: 'tenant-a', status: 'in_progress',
    lastAdminSeenAt: new Date('2026-08-20T10:00:00.000Z'),
    updates: [
      { update_id: 'reply-before', type: 'tenant_reply', sender_role: 'tenant', actor_role: 'tenant', message: 'Still broken', created_at: new Date('2026-08-20T09:00:00.000Z') },
      { update_id: 'reply-after', type: 'tenant_reply', sender_role: 'tenant', actor_role: 'tenant', message: 'Any update?', created_at: new Date('2026-08-20T11:00:00.000Z') },
    ],
  }, { includeThread: true });

  const before = detail.thread.find((entry) => entry.update_id === 'reply-before');
  const after = detail.thread.find((entry) => entry.update_id === 'reply-after');
  assert.equal(before.seenByAdmin, true);
  assert.equal(after.seenByAdmin, false);
});

test('an explicit readByAdmin flag wins even if lastAdminSeenAt predates the message', () => {
  const { buildTenantRequestResponse } = require('../controllers/maintenance.controller');
  const detail = buildTenantRequestResponse({
    request_id: 'request-explicit', user_id: 'tenant-a', status: 'in_progress',
    lastAdminSeenAt: new Date('2026-08-19T00:00:00.000Z'),
    updates: [
      { update_id: 'reply-1', type: 'tenant_reply', sender_role: 'tenant', actor_role: 'tenant', message: 'Hello', readByAdmin: true, created_at: new Date('2026-08-20T09:00:00.000Z') },
    ],
  }, { includeThread: true });

  assert.equal(detail.thread.find((entry) => entry.update_id === 'reply-1').seenByAdmin, true);
});

test('admin-authored entries do not carry a seenByAdmin receipt', () => {
  const { buildTenantRequestResponse } = require('../controllers/maintenance.controller');
  const detail = buildTenantRequestResponse({
    request_id: 'request-admin', user_id: 'tenant-a', status: 'in_progress',
    updates: [
      { update_id: 'admin-1', type: 'admin_update', sender_role: 'admin', actor_role: 'admin', message: 'We are on it', created_at: new Date() },
    ],
  }, { includeThread: true });

  assert.equal(detail.thread.find((entry) => entry.update_id === 'admin-1').seenByAdmin, null);
});

test('adminMarkRead marks tenant-authored updates read and records lastAdminSeenAt', async () => {
  const databasePath = require.resolve('../config/database');
  const updateCalls = [];
  const storedRequest = {
    request_id: 'request-mark',
    user_id: 'tenant-a',
    updates: [
      { update_id: 'reply-1', type: 'tenant_reply', sender_role: 'tenant', actor_role: 'tenant', message: 'Hello' },
      { update_id: 'admin-1', type: 'admin_update', sender_role: 'admin', actor_role: 'admin', message: 'Noted' },
    ],
  };
  require(databasePath).getDb = () => ({
    collection: () => ({
      findOne: async () => storedRequest,
      updateOne: async (_filter, update) => { updateCalls.push(update.$set); return { matchedCount: 1 }; },
    }),
  });
  delete require.cache[require.resolve('../controllers/maintenance.controller')];
  const { adminMarkRead } = require('../controllers/maintenance.controller');
  const res = response();
  await adminMarkRead({ params: { requestId: 'request-mark' }, user: { user_id: 'admin-a', role: 'admin' } }, res);

  assert.equal(res.statusCode, 200);
  const setPayload = updateCalls[0];
  assert.ok(setPayload.lastAdminSeenAt instanceof Date);
  const markedReply = setPayload.updates.find((entry) => entry.update_id === 'reply-1');
  const untouchedAdminEntry = setPayload.updates.find((entry) => entry.update_id === 'admin-1');
  assert.equal(markedReply.readByAdmin, true);
  assert.ok(markedReply.readByAdminAt instanceof Date);
  assert.equal(untouchedAdminEntry.readByAdmin, undefined);
});

test('adminMarkRead 404s when the request does not exist', async () => {
  const databasePath = require.resolve('../config/database');
  require(databasePath).getDb = () => ({ collection: () => ({ findOne: async () => null }) });
  delete require.cache[require.resolve('../controllers/maintenance.controller')];
  const { adminMarkRead } = require('../controllers/maintenance.controller');
  const res = response();
  await adminMarkRead({ params: { requestId: 'missing' }, user: { user_id: 'admin-a', role: 'admin' } }, res);
  assert.equal(res.statusCode, 404);
});
