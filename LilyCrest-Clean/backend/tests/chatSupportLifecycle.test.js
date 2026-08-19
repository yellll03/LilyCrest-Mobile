'use strict';

// Coverage for the three tenant support-chat endpoints the mobile app has
// always called but the backend never registered — resolution confirmation,
// same-thread reopen, and attachment registration — plus the attachment
// round-trip through chat_messages (sendTenantMessage previously accepted an
// `attachments` array from the client and silently discarded it, and
// serializeMessage never returned one, so an attached file could never be
// seen by anyone).
//
// Typing indicators are deliberately NOT covered: no screen ever called
// apiService.sendSupportTyping, so the client shim was removed rather than a
// backend built for it.

const test = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('../config/database');
const firebasePath = require.resolve('../config/firebase');
const chatControllerPath = require.resolve('../controllers/chat.controller');

const BUCKET = 'lilycrest-test.appspot.com';
const TENANT_ID = 'tenant-a';

// Exactly the shape POST /upload/firebase-storage issues (see
// routes/upload.routes.js) — the storagePath's tenant segment is derived
// server-side there, which is what makes the authorization check below
// meaningful rather than decorative.
function storedAttachment(overrides = {}) {
  const storagePath = overrides.storagePath
    || `support-attachments/${TENANT_ID}/conv-1/1700000000000-photo.jpg`;
  return {
    storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(storagePath)}?alt=media&token=tok`,
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    provider: 'firebase-storage',
    ...overrides,
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function objectIdLike(value) {
  return { toString: () => value, _value: value };
}

function fakeDb({ conversation }) {
  const conversations = [conversation];
  const messages = [];
  return {
    messages,
    current() { return conversations[0]; },
    collection(name) {
      if (name === 'chat_conversations') {
        return {
          async findOne(filter) {
            const wanted = filter._id ? String(filter._id) : null;
            const found = conversations.find((c) => !wanted || String(c._id) === wanted);
            if (!found) return null;
            // Model the tenant-ownership clause the real filter applies.
            if (filter.tenantUserId && filter.tenantUserId !== found.tenantUserId) return null;
            if (filter.$or && !filter.$or.some((clause) => (
              (clause.tenantUserId && clause.tenantUserId === found.tenantUserId)
              || (clause.tenantId && String(clause.tenantId) === String(found.tenantId))
            ))) return null;
            return found;
          },
          async updateOne(_filter, update) {
            Object.assign(conversations[0], update.$set || {});
            for (const key of Object.keys(update.$unset || {})) delete conversations[0][key];
            return { matchedCount: 1 };
          },
        };
      }
      if (name === 'chat_messages') {
        return {
          async insertOne(doc) { messages.push(doc); return { insertedId: objectIdLike(`msg-${messages.length}`) }; },
          async updateMany() { return { modifiedCount: 0 }; },
        };
      }
      return { async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };
    },
  };
}

function loadController(db) {
  require(databasePath).getDb = () => db;
  const firebase = require(firebasePath);
  firebase.resolveStorageBucket = () => BUCKET;
  delete require.cache[chatControllerPath];
  return require(chatControllerPath);
}

function conversationDoc(overrides = {}) {
  return {
    _id: objectIdLike('507f1f77bcf86cd799439011'),
    tenantUserId: TENANT_ID,
    tenantId: objectIdLike('507f1f77bcf86cd799439012'),
    tenantName: 'Ana',
    branch: 'gil-puyat',
    status: 'waiting_tenant',
    statusHistory: [],
    unreadAdminCount: 0,
    unreadTenantCount: 0,
    ...overrides,
  };
}

function tenantReq(body = {}, conversationId = '507f1f77bcf86cd799439011') {
  return {
    user: { user_id: TENANT_ID, role: 'tenant', name: 'Ana', _id: objectIdLike('507f1f77bcf86cd799439012') },
    params: { conversationId },
    body,
  };
}

// ── Resolution confirmation ─────────────────────────────────────────────────

test('confirming resolution settles the conversation at resolved and records satisfaction', async () => {
  const db = fakeDb({ conversation: conversationDoc() });
  const { confirmConversationResolution } = loadController(db);

  const res = fakeResponse();
  await confirmConversationResolution(tenantReq({ resolved: true, rating: 5, feedback: 'Fast fix' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.conversation.status, 'resolved');
  assert.equal(db.current().satisfactionRating, 5);
  assert.equal(db.current().satisfactionFeedback, 'Fast fix');
  assert.equal(db.current().tenantResolutionConfirmed, true);
  assert.equal(db.current().statusHistory.at(-1).status, 'resolved');
});

test('declining resolution returns the conversation to admin support rather than closing it', async () => {
  const db = fakeDb({ conversation: conversationDoc() });
  const { confirmConversationResolution } = loadController(db);

  const res = fakeResponse();
  await confirmConversationResolution(tenantReq({ resolved: false }), res);

  assert.equal(res.body.conversation.status, 'open');
  assert.equal(db.current().tenantResolutionConfirmed, false);
});

test('an out-of-range satisfaction rating is dropped, not stored', async () => {
  const db = fakeDb({ conversation: conversationDoc() });
  const { confirmConversationResolution } = loadController(db);

  await confirmConversationResolution(tenantReq({ resolved: true, rating: 99 }), fakeResponse());
  assert.equal(db.current().satisfactionRating, undefined);
});

test('resolution requires an explicit boolean choice', async () => {
  const db = fakeDb({ conversation: conversationDoc() });
  const { confirmConversationResolution } = loadController(db);

  const res = fakeResponse();
  await confirmConversationResolution(tenantReq({}), res);
  assert.equal(res.statusCode, 400);
});

test('another tenant cannot confirm resolution on this conversation', async () => {
  const db = fakeDb({ conversation: conversationDoc() });
  const { confirmConversationResolution } = loadController(db);

  const res = fakeResponse();
  const req = tenantReq({ resolved: true });
  req.user = { user_id: 'tenant-b', role: 'tenant', _id: objectIdLike('507f1f77bcf86cd7994390ff') };
  await confirmConversationResolution(req, res);

  assert.equal(res.statusCode, 404, 'cross-tenant access uses the 404 IDOR convention');
});

// ── Reopen ──────────────────────────────────────────────────────────────────

test('reopening a resolved concern reuses the same thread and keeps branch routing', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'resolved', closedAt: new Date(), closingNote: 'done' }) });
  const { reopenConversation } = loadController(db);

  const res = fakeResponse();
  await reopenConversation(tenantReq({ note: 'Still leaking' }), res);

  assert.equal(res.body.conversation.status, 'open');
  assert.equal(res.body.conversation.branch, 'gil-puyat', 'reopen must not re-route the concern to another branch');
  assert.equal(db.current().closedAt, undefined);
  assert.equal(db.current().statusHistory.at(-1).note, 'Still leaking');
});

test('reopening an already-open conversation is rejected instead of duplicating history', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { reopenConversation } = loadController(db);

  const res = fakeResponse();
  await reopenConversation(tenantReq({}), res);
  assert.equal(res.statusCode, 400);
});

// ── Attachments ─────────────────────────────────────────────────────────────

test('an attachment uploaded under this tenant own prefix is accepted', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  const res = fakeResponse();
  await uploadConversationAttachment(tenantReq({ attachment: storedAttachment() }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.attachment.originalName, 'photo.jpg');
  assert.equal(res.body.attachment.provider, 'firebase-storage');
});

test("an attachment pointing at another tenant's storage object is refused", async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  const res = fakeResponse();
  await uploadConversationAttachment(tenantReq({
    attachment: storedAttachment({ storagePath: 'support-attachments/tenant-b/conv-1/secret.jpg' }),
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'ATTACHMENT_UNAUTHORIZED');
});

test('an attachment whose downloadUrl does not match its storagePath is refused', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  const attachment = storedAttachment();
  attachment.downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent('support-attachments/tenant-b/conv-1/other.jpg')}?alt=media&token=tok`;

  const res = fakeResponse();
  await uploadConversationAttachment(tenantReq({ attachment }), res);
  assert.equal(res.statusCode, 400);
});

test('unsupported MIME types and oversized files are refused', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  const badType = fakeResponse();
  await uploadConversationAttachment(tenantReq({
    attachment: storedAttachment({ mimeType: 'application/x-msdownload' }),
  }), badType);
  assert.equal(badType.body.code, 'ATTACHMENT_UNSUPPORTED_TYPE');

  const tooBig = fakeResponse();
  await uploadConversationAttachment(tenantReq({
    attachment: storedAttachment({ size: 6 * 1024 * 1024 }),
  }), tooBig);
  assert.equal(tooBig.body.code, 'ATTACHMENT_TOO_LARGE');

  const noSize = fakeResponse();
  await uploadConversationAttachment(tenantReq({
    attachment: storedAttachment({ size: undefined }),
  }), noSize);
  assert.equal(noSize.body.code, 'ATTACHMENT_TOO_LARGE', 'omitting size must not bypass the cap');
});

test('attachments survive the message round-trip instead of being silently dropped', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { sendTenantMessage } = loadController(db);

  const res = fakeResponse();
  await sendTenantMessage(tenantReq({ message: 'See photo', attachments: [storedAttachment()] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.attachments.length, 1);
  assert.equal(res.body.message.attachments[0].storagePath, `support-attachments/${TENANT_ID}/conv-1/1700000000000-photo.jpg`);
  assert.equal(db.messages[0].attachments.length, 1, 'the attachment is persisted, not just echoed back');
});

test('an attachment-only message is allowed and gets a meaningful conversation preview', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { sendTenantMessage } = loadController(db);

  const res = fakeResponse();
  await sendTenantMessage(tenantReq({ message: '', attachments: [storedAttachment()] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.message, '');
  assert.match(db.current().lastMessage, /1 attachment/);
});

test('a message with no text and no attachments is still rejected', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { sendTenantMessage } = loadController(db);

  const res = fakeResponse();
  await sendTenantMessage(tenantReq({ message: '   ' }), res);
  assert.equal(res.statusCode, 400);
});

test('more attachments than the per-message cap are refused', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { sendTenantMessage } = loadController(db);

  const res = fakeResponse();
  await sendTenantMessage(tenantReq({
    message: 'many',
    attachments: [storedAttachment(), storedAttachment(), storedAttachment(), storedAttachment()],
  }), res);
  assert.equal(res.body.code, 'ATTACHMENT_LIMIT');
});
