const test = require('node:test');
const assert = require('node:assert/strict');

function stub(name, exports) {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const cursor = { sort() { return this; }, limit() { return this; }, async toArray() { return []; } };
stub('../config/database', { getDb: () => ({ collection: () => ({ find: () => cursor, findOne: async () => null }) }) });
stub('../controllers/billing.controller', { fetchUserBills: async () => [] });
stub('../controllers/maintenance.controller', { buildUserMaintenanceFilter: () => ({ $or: [] }) });
stub('../services/announcementAudience.service', { loadVisibleAnnouncementsForTenant: async () => [] });
stub('../services/branchLocation.service', { resolveTenantBranch: async () => ({ branch: { branchName: 'Test branch' } }) });
stub('../routes/contracts.routes', { fetchCurrentContractForRequest: async () => ({ ok: true, data: {} }) });
const gemini = require('../services/gemini.service');
const calls = [];
stub('../services/gemini.service', { ...gemini, sendGeminiMessage: async (key) => {
  calls.push(key);
  return { text: 'Hello! How can I help with your stay?' };
} });
const controller = require('../controllers/chatbot.controller');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('normal assistant generation and reset keep shared client session IDs account-scoped', async () => {
  for (const userId of ['tenant-a', 'tenant-b']) {
    const res = response();
    await controller.sendMessage({ user: { user_id: userId, name: userId, role: 'tenant' }, body: { session_id: 'same-id', message: 'Hello' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.session_id, 'same-id');
  }
  const a = JSON.stringify(['tenant-a', 'same-id']);
  const b = JSON.stringify(['tenant-b', 'same-id']);
  assert.deepEqual(calls, [a, b]);
  assert.notEqual(gemini.chatSessions.get(a), gemini.chatSessions.get(b));
  await controller.resetSession({ user: { user_id: 'tenant-b' }, body: { session_id: 'same-id' } }, response());
  assert.ok(gemini.chatSessions.has(a));
  assert.equal(gemini.chatSessions.has(b), false);
});
