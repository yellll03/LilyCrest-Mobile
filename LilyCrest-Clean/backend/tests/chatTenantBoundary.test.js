// Phase 3.1 closure: chat.routes.js and chatbot.routes.js were previously
// flagged as "not included in the tenant-only middleware pass, not
// independently re-audited". This file closes that gap: verifies
// tenantMiddleware is wired on every tenant-facing chat/chatbot route
// (blocking admin/superadmin sessions), and that cross-tenant conversation
// access in chat.controller.js is rejected with the project's standard 404
// IDOR convention.
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

function middlewareNames(router, path, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} must exist`);
  return layer.route.stack.map((s) => s.handle.name);
}

// ── Route-level tenant boundary ─────────────────────────────────────────────

test('chat.routes.js: tenant support-chat routes require tenantMiddleware', () => {
  delete require.cache[require.resolve('../routes/chat.routes')];
  const router = require('../routes/chat.routes');
  for (const [path, method] of [
    ['/start', 'post'],
    ['/me', 'get'],
    ['/:conversationId/messages', 'get'],
    ['/:conversationId/messages', 'post'],
    ['/:conversationId/close', 'patch'],
  ]) {
    const names = middlewareNames(router, path, method);
    assert.ok(names.includes('tenantMiddleware'), `${method.toUpperCase()} ${path} must enforce tenantMiddleware, got: ${names.join(', ')}`);
  }
});

test('chat.routes.js: admin support-chat routes stay adminMiddleware-gated, not tenantMiddleware', () => {
  delete require.cache[require.resolve('../routes/chat.routes')];
  const router = require('../routes/chat.routes');
  for (const [path, method] of [
    ['/admin/conversations', 'get'],
    ['/admin/:conversationId/messages', 'get'],
    ['/admin/:conversationId/messages', 'post'],
    ['/admin/:conversationId/status', 'patch'],
  ]) {
    const names = middlewareNames(router, path, method);
    assert.ok(names.includes('adminMiddleware'), `${method.toUpperCase()} ${path} must enforce adminMiddleware, got: ${names.join(', ')}`);
    assert.ok(!names.includes('tenantMiddleware'), `${method.toUpperCase()} ${path} must not be tenant-restricted`);
  }
});

test('chatbot.routes.js: tenant chatbot routes require tenantMiddleware', () => {
  delete require.cache[require.resolve('../routes/chatbot.routes')];
  const router = require('../routes/chatbot.routes');
  for (const [path, method] of [
    ['/message', 'post'],
    ['/request-admin', 'post'],
    ['/reset', 'post'],
    ['/live-status/:sessionId', 'get'],
    ['/history', 'get'],
  ]) {
    const names = middlewareNames(router, path, method);
    assert.ok(names.includes('tenantMiddleware'), `${method.toUpperCase()} ${path} must enforce tenantMiddleware, got: ${names.join(', ')}`);
  }
});

test('chatbot.routes.js: admin live-chat routes stay adminMiddleware-gated', () => {
  delete require.cache[require.resolve('../routes/chatbot.routes')];
  const router = require('../routes/chatbot.routes');
  for (const [path, method] of [
    ['/admin/live-chats', 'get'],
    ['/admin/live-chat/accept', 'post'],
    ['/admin/live-chat/message', 'post'],
  ]) {
    const names = middlewareNames(router, path, method);
    assert.ok(names.includes('adminMiddleware'), `${method.toUpperCase()} ${path} must enforce adminMiddleware, got: ${names.join(', ')}`);
  }
});

// ── tenantMiddleware behavior itself (admin/superadmin rejected, tenant allowed) ──

test('tenantMiddleware rejects admin and superadmin, allows a plain tenant role', () => {
  delete require.cache[require.resolve('../middleware/auth')];
  const { tenantMiddleware } = require('../middleware/auth');

  for (const role of ['admin', 'superadmin', 'ADMIN', 'SuperAdmin']) {
    const res = response();
    let nextCalled = false;
    tenantMiddleware({ user: { role } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403, `role=${role} must be rejected`);
    assert.equal(nextCalled, false);
  }

  for (const role of ['resident', 'tenant', '', undefined]) {
    const res = response();
    let nextCalled = false;
    tenantMiddleware({ user: { role } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `role=${role} must be allowed through`);
  }
});

// ── Cross-tenant conversation ownership (chat.controller.js) ───────────────

function buildConversationDb(conversationDoc) {
  return {
    collection(name) {
      if (name === 'chat_conversations') {
        return {
          async findOne(filter) {
            if (String(filter._id) !== String(conversationDoc._id)) return null;
            const or = filter.$or || [];
            const ownedByRequester = or.some((clause) => {
              if (clause.tenantUserId) return clause.tenantUserId === conversationDoc.tenantUserId;
              if (clause.user_id) return clause.user_id === conversationDoc.tenantUserId;
              return false;
            });
            return ownedByRequester ? conversationDoc : null;
          },
          async updateOne() { return { acknowledged: true }; },
        };
      }
      if (name === 'chat_messages') {
        return {
          find() { return { sort() { return { toArray: async () => [] }; } }; },
          async updateMany() { return { acknowledged: true }; },
        };
      }
      return {};
    },
  };
}

test('tenant A cannot read tenant B conversation messages (cross-tenant IDOR -> 404)', async () => {
  const conversation = { _id: '507f1f77bcf86cd799439011', tenantUserId: 'tenant-b', status: 'open', statusHistory: [] };
  const db = buildConversationDb(conversation);
  const { getConversationMessages } = loadWithDb('../controllers/chat.controller', db);

  const res = response();
  await getConversationMessages({ params: { conversationId: '507f1f77bcf86cd799439011' }, user: { user_id: 'tenant-a', _id: 'tenant-a' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'CONVERSATION_NOT_FOUND');
});

test('tenant B can read their own conversation messages', async () => {
  const conversation = { _id: '507f1f77bcf86cd799439011', tenantUserId: 'tenant-b', status: 'open', statusHistory: [] };
  const db = buildConversationDb(conversation);
  const { getConversationMessages } = loadWithDb('../controllers/chat.controller', db);

  const res = response();
  await getConversationMessages({ params: { conversationId: '507f1f77bcf86cd799439011' }, user: { user_id: 'tenant-b', _id: 'tenant-b' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.conversation);
});

test('tenant A cannot send a message into tenant B conversation (cross-tenant IDOR -> 404)', async () => {
  const conversation = { _id: '507f1f77bcf86cd799439011', tenantUserId: 'tenant-b', status: 'open', statusHistory: [] };
  const db = buildConversationDb(conversation);
  const { sendTenantMessage } = loadWithDb('../controllers/chat.controller', db);

  const res = response();
  await sendTenantMessage({ params: { conversationId: '507f1f77bcf86cd799439011' }, body: { message: 'hi' }, user: { user_id: 'tenant-a', _id: 'tenant-a' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'CONVERSATION_NOT_FOUND');
});

test('a malformed conversation id fails safely (404, not a crash)', async () => {
  const conversation = { _id: '507f1f77bcf86cd799439011', tenantUserId: 'tenant-b', status: 'open', statusHistory: [] };
  const db = buildConversationDb(conversation);
  const { getConversationMessages } = loadWithDb('../controllers/chat.controller', db);

  const res = response();
  await getConversationMessages({ params: { conversationId: 'not-an-object-id' }, user: { user_id: 'tenant-a', _id: 'tenant-a' } }, res);
  assert.equal(res.statusCode, 404);
});
