'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const BUCKET = 'lilycrest-test.appspot.com';
const databasePath = require.resolve('../config/database');
const firebasePath = require.resolve('../config/firebase');
const controllerPath = require.resolve('../controllers/chat.controller');

function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (value instanceof ObjectId) return value.toHexString();
  return value;
}

function fieldValue(doc, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], doc);
}

function equalValue(left, right) {
  if (Array.isArray(left)) return left.some((value) => equalValue(value, right));
  return comparable(left) === comparable(right);
}

function matchesValue(value, condition) {
  if (condition instanceof RegExp) return condition.test(String(value ?? ''));
  if (condition && typeof condition === 'object' && !(condition instanceof ObjectId) && !(condition instanceof Date)) {
    if ('$in' in condition) {
      const values = Array.isArray(value) ? value : [value];
      return values.some((entry) => condition.$in.some((allowed) => equalValue(entry, allowed)));
    }
    if ('$lt' in condition) return comparable(value) < comparable(condition.$lt);
    if ('$exists' in condition) return condition.$exists ? value !== undefined : value === undefined;
    return Object.entries(condition).every(([key, nested]) => matchesValue(value?.[key], nested));
  }
  if (condition === null) return value === null || value === undefined;
  return equalValue(value, condition);
}

function matches(doc, query = {}) {
  return Object.entries(query).every(([key, condition]) => {
    if (key === '$or') return condition.some((part) => matches(doc, part));
    if (key === '$and') return condition.every((part) => matches(doc, part));
    return matchesValue(fieldValue(doc, key), condition);
  });
}

function cursor(rows) {
  let result = [...rows];
  return {
    sort(spec = {}) {
      const entries = Object.entries(spec);
      result.sort((left, right) => {
        for (const [field, direction] of entries) {
          const a = comparable(fieldValue(left, field));
          const b = comparable(fieldValue(right, field));
          if (a < b) return -1 * direction;
          if (a > b) return 1 * direction;
        }
        return 0;
      });
      return this;
    },
    limit(amount) { result = result.slice(0, amount); return this; },
    async toArray() { return result; },
    async next() { return result[0] || null; },
    async *[Symbol.asyncIterator]() { for (const row of result) yield row; },
  };
}

function duplicateError() {
  const error = new Error('duplicate key');
  error.code = 11000;
  return error;
}

function createDb(seed = {}) {
  const store = {};
  for (const [name, docs] of Object.entries(seed)) store[name] = [...docs];

  function collection(name) {
    if (!store[name]) store[name] = [];
    return {
      find(query = {}) { return cursor(store[name].filter((doc) => matches(doc, query))); },
      async findOne(query = {}) { return store[name].find((doc) => matches(doc, query)) || null; },
      async countDocuments(query = {}) { return store[name].filter((doc) => matches(doc, query)).length; },
      async insertOne(doc) {
        if (name === 'chat_conversations' && doc.startRequestIds?.length) {
          const duplicate = store[name].some((row) => (
            row.tenantUserId === doc.tenantUserId
            && (row.startRequestIds || []).some((key) => doc.startRequestIds.includes(key))
          ));
          if (duplicate) throw duplicateError();
        }
        if (name === 'chat_messages' && doc.clientMessageId) {
          const duplicate = store[name].some((row) => (
            equalValue(row.conversationId, doc.conversationId)
            && row.senderUserId === doc.senderUserId
            && row.clientMessageId === doc.clientMessageId
          ));
          if (duplicate) throw duplicateError();
        }
        if (name === 'chat_attachments' && doc.clientAttachmentId) {
          const duplicate = store[name].some((row) => (
            equalValue(row.conversationId, doc.conversationId)
            && equalValue(row.uploadedBy, doc.uploadedBy)
            && row.clientAttachmentId === doc.clientAttachmentId
          ));
          if (duplicate) throw duplicateError();
        }
        const record = { ...doc, _id: doc._id || new ObjectId() };
        store[name].push(record);
        return { insertedId: record._id };
      },
      async updateOne(filter, update) {
        const doc = store[name].find((row) => matches(row, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$unset) Object.keys(update.$unset).forEach((field) => { delete doc[field]; });
        if (update.$inc) Object.entries(update.$inc).forEach(([field, amount]) => {
          doc[field] = Number(doc[field] || 0) + amount;
        });
        if (update.$addToSet) Object.entries(update.$addToSet).forEach(([field, value]) => {
          if (!Array.isArray(doc[field])) doc[field] = [];
          if (!doc[field].some((entry) => equalValue(entry, value))) doc[field].push(value);
        });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      async updateMany(filter, update) {
        const docs = store[name].filter((row) => matches(row, filter));
        docs.forEach((doc) => { if (update.$set) Object.assign(doc, update.$set); });
        return { matchedCount: docs.length, modifiedCount: docs.length };
      },
      async deleteOne(filter) {
        const index = store[name].findIndex((row) => matches(row, filter));
        if (index < 0) return { deletedCount: 0 };
        store[name].splice(index, 1);
        return { deletedCount: 1 };
      },
      aggregate() { return cursor([]); },
    };
  }

  return { store, collection };
}

let currentDb;
const deletedStoragePaths = [];
require(databasePath).getDb = () => currentDb;
const firebase = require(firebasePath);
firebase.resolveStorageBucket = () => BUCKET;
firebase.admin = {
  apps: [{}],
  storage: () => ({
    bucket: () => ({
      file: (storagePath) => ({
        async delete() { deletedStoragePaths.push(storagePath); },
      }),
    }),
  }),
};
delete require.cache[controllerPath];
const controller = require(controllerPath);

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function tenant() {
  return {
    _id: new ObjectId('507f1f77bcf86cd799439012'),
    user_id: 'tenant-a',
    role: 'tenant',
    name: 'Ana Tenant',
    email: 'ana@example.com',
    branch: 'gil-puyat',
  };
}

function admin(branch = 'gil-puyat') {
  return {
    _id: new ObjectId(branch === 'gil-puyat' ? '507f1f77bcf86cd799439013' : '507f1f77bcf86cd799439014'),
    user_id: branch === 'gil-puyat' ? 'admin-gp' : 'admin-guadalupe',
    role: 'admin',
    name: 'Branch Admin',
    branch,
  };
}

function attachment(path) {
  return {
    storagePath: path,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=test`,
    originalName: 'proof.jpg',
    mimeType: 'image/jpeg',
    size: 1000,
  };
}

async function start(db, user, body) {
  currentDb = db;
  const res = response();
  await controller.startConversation({ user, body }, res);
  return res;
}

test('rapid duplicate start and lost-response replay create one conversation and one initial message', async () => {
  const db = createDb();
  const user = tenant();
  const body = { clientRequestId: 'start:stable-1', initialMessage: 'Please help', category: 'general_inquiry' };

  const [first, second] = await Promise.all([start(db, user, body), start(db, user, body)]);
  const replay = await start(db, user, body);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(db.store.chat_conversations.length, 1);
  assert.equal(db.store.chat_messages.length, 1);
  assert.equal(db.store.chat_messages[0].clientMessageId, 'start:start:stable-1');
});

test('tenant and admin message retries preserve stable identity and unread counts', async () => {
  const db = createDb();
  const user = tenant();
  const started = await start(db, user, { clientRequestId: 'start:messages' });
  const conversationId = started.body.conversation.id;

  const tenantReq = {
    user,
    params: { conversationId },
    body: { message: 'Same delivery', clientMessageId: 'message:tenant-1' },
  };
  const first = response();
  const retry = response();
  await controller.sendTenantMessage(tenantReq, first);
  await controller.sendTenantMessage(tenantReq, retry);
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(db.store.chat_messages.length, 1);
  assert.equal(db.store.chat_conversations[0].unreadAdminCount, 1);

  const adminReq = {
    user: admin(),
    params: { conversationId },
    body: { message: 'Admin reply', clientMessageId: 'message:admin-1' },
  };
  const adminFirst = response();
  const adminRetry = response();
  await controller.sendAdminMessage(adminReq, adminFirst);
  await controller.sendAdminMessage(adminReq, adminRetry);
  assert.equal(adminRetry.body.idempotentReplay, true);
  assert.equal(db.store.chat_messages.length, 2);
  assert.equal(db.store.chat_conversations[0].unreadTenantCount, 1);
});

test('attachment retry reuses one record and removes a second uploaded object after a lost response', async () => {
  deletedStoragePaths.length = 0;
  const db = createDb();
  const user = tenant();
  const started = await start(db, user, { clientRequestId: 'start:attachment' });
  const conversationId = started.body.conversation.id;
  const key = 'attachment:stable-1';

  const first = response();
  await controller.uploadConversationAttachment({
    user,
    params: { conversationId },
    body: { clientAttachmentId: key, attachment: attachment('support-attachments/tenant-a/first.jpg') },
  }, first);
  const retry = response();
  await controller.uploadConversationAttachment({
    user,
    params: { conversationId },
    body: { clientAttachmentId: key, attachment: attachment('support-attachments/tenant-a/retry.jpg') },
  }, retry);

  assert.equal(first.statusCode, 201);
  assert.equal(retry.body.idempotentReplay, true);
  assert.equal(retry.body.attachment.attachmentId, first.body.attachment.attachmentId);
  assert.equal(db.store.chat_attachments.length, 1);
  assert.deepEqual(deletedStoragePaths, ['support-attachments/tenant-a/retry.jpg']);
});

test('long conversations page newest-first at the database and return chronological stable pages', async () => {
  const user = tenant();
  const conversationId = new ObjectId('507f1f77bcf86cd799439099');
  const messages = Array.from({ length: 125 }, (_, index) => ({
    _id: new ObjectId((index + 1).toString(16).padStart(24, '0')),
    conversationId,
    senderId: user._id,
    senderUserId: user.user_id,
    senderName: user.name,
    senderRole: 'tenant',
    message: `Message ${index + 1}`,
    readAt: null,
    createdAt: new Date(1700000000000 + index),
  }));
  const db = createDb({
    chat_conversations: [{
      _id: conversationId,
      tenantId: user._id,
      tenantUserId: user.user_id,
      branch: user.branch,
      status: 'open',
      unreadTenantCount: 0,
      unreadAdminCount: 125,
    }],
    chat_messages: messages,
  });
  currentDb = db;

  async function page(query) {
    const res = response();
    await controller.getConversationMessages({ user, params: { conversationId: String(conversationId) }, query }, res);
    return res.body;
  }

  const latest = await page({ limit: '50' });
  const middle = await page({ limit: '50', before: latest.pageInfo.nextCursor });
  const oldest = await page({ limit: '50', before: middle.pageInfo.nextCursor });

  assert.equal(latest.messages[0].message, 'Message 76');
  assert.equal(latest.messages.at(-1).message, 'Message 125');
  assert.equal(middle.messages[0].message, 'Message 26');
  assert.equal(middle.messages.at(-1).message, 'Message 75');
  assert.equal(oldest.messages[0].message, 'Message 1');
  assert.equal(oldest.messages.length, 25);
  assert.equal(oldest.pageInfo.hasMore, false);
});

test('admin read/send remains branch-scoped and read receipts update the correct side', async () => {
  const user = tenant();
  const conversationId = new ObjectId('507f1f77bcf86cd799439088');
  const tenantMessageId = new ObjectId('507f1f77bcf86cd799439089');
  const db = createDb({
    chat_conversations: [{
      _id: conversationId,
      tenantId: user._id,
      tenantUserId: user.user_id,
      tenantName: user.name,
      branch: 'gil-puyat',
      status: 'open',
      statusHistory: [],
      unreadAdminCount: 1,
      unreadTenantCount: 0,
    }],
    chat_messages: [{
      _id: tenantMessageId,
      conversationId,
      senderId: user._id,
      senderUserId: user.user_id,
      senderRole: 'tenant',
      senderName: user.name,
      message: 'Tenant concern',
      readAt: null,
      createdAt: new Date(),
    }],
  });
  currentDb = db;

  const wrongRead = response();
  await controller.getAdminConversationMessages({
    user: admin('guadalupe'), params: { conversationId: String(conversationId) }, query: {},
  }, wrongRead);
  assert.equal(wrongRead.statusCode, 404);

  const wrongSend = response();
  await controller.sendAdminMessage({
    user: admin('guadalupe'), params: { conversationId: String(conversationId) }, body: { message: 'Nope' },
  }, wrongSend);
  assert.equal(wrongSend.statusCode, 404);

  const read = response();
  await controller.getAdminConversationMessages({
    user: admin(), params: { conversationId: String(conversationId) }, query: {},
  }, read);
  assert.equal(read.statusCode, 200);
  assert.ok(db.store.chat_messages[0].readAt instanceof Date);
  assert.equal(db.store.chat_conversations[0].unreadAdminCount, 0);

  const sent = response();
  await controller.sendAdminMessage({
    user: admin(),
    params: { conversationId: String(conversationId) },
    body: { message: 'Branch reply', clientMessageId: 'message:branch-admin' },
  }, sent);
  assert.equal(sent.statusCode, 200);
  assert.equal(db.store.chat_conversations[0].unreadTenantCount, 1);

  const tenantRead = response();
  await controller.getConversationMessages({
    user, params: { conversationId: String(conversationId) }, query: {},
  }, tenantRead);
  assert.equal(tenantRead.statusCode, 200);
  assert.ok(db.store.chat_messages.at(-1).readAt instanceof Date);
  assert.equal(db.store.chat_conversations[0].unreadTenantCount, 0);
});

test('legacy request-admin writes only the canonical support model', async () => {
  const user = tenant();
  const db = createDb({ users: [user] });
  currentDb = db;
  const chatbotPath = require.resolve('../controllers/chatbot.controller');
  delete require.cache[chatbotPath];
  const chatbot = require(chatbotPath);
  const res = response();

  await chatbot.requestAdmin({
    user,
    body: { session_id: 'tenant-a-chat-stable', reason: 'Please connect me' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.conversation_id);
  assert.equal(db.store.chat_conversations.length, 1);
  assert.equal(db.store.chat_messages.length, 1);
  assert.equal((db.store.live_chat_requests || []).length, 0);
  assert.equal((db.store.tickets || []).length, 0);
});
