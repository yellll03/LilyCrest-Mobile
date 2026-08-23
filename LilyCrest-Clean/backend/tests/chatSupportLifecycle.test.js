'use strict';

// Coverage for the three tenant support-chat endpoints the mobile app has
// always called but the backend never registered — resolution confirmation,
// same-thread reopen, and attachment registration — plus the canonical
// attachment contract: registration mints an immutable `chat_attachments`
// record, a message embeds only that record's id plus presentation fields, and
// the bytes are reachable exclusively through the protected, conversation-
// bound route GET /chat/:conversationId/attachments/:attachmentId.
//
// Typing indicators are deliberately NOT covered: no screen ever called
// apiService.sendSupportTyping, so the client shim was removed rather than a
// backend built for it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Readable } = require('node:stream');

const databasePath = require.resolve('../config/database');
const firebasePath = require.resolve('../config/firebase');
const chatControllerPath = require.resolve('../controllers/chat.controller');
const chatAttachmentServicePath = require.resolve('../services/chatAttachment.service');

const BUCKET = 'lilycrest-test.appspot.com';
const TENANT_ID = 'tenant-a';
const CONVERSATION_ID = '507f1f77bcf86cd799439011';
const OTHER_CONVERSATION_ID = '507f1f77bcf86cd7994390aa';
const TENANT_OBJECT_ID = '507f1f77bcf86cd799439012';

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

function storedPdf(overrides = {}) {
  return storedAttachment({
    storagePath: `support-attachments/${TENANT_ID}/conv-1/1700000000001-receipt.pdf`,
    originalName: 'receipt.pdf',
    mimeType: 'application/pdf',
    size: 4096,
    ...overrides,
  });
}

function fakeResponse() {
  const res = new PassThrough();
  res.statusCode = 200;
  res.body = null;
  res.headers = {};
  res.chunks = [];
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.setHeader = (key, value) => { res.headers[String(key).toLowerCase()] = value; };
  res.on('data', (chunk) => res.chunks.push(chunk));
  return res;
}

function objectIdLike(value) {
  return { toString: () => value, _value: value };
}

function fakeDb({ conversation, attachments = [] }) {
  const conversations = [conversation];
  const messages = [];
  const attachmentDocs = [...attachments];
  let attachmentSeq = attachmentDocs.length;

  const matchesConversationScope = (found, filter) => {
    if (filter.tenantUserId && filter.tenantUserId !== found.tenantUserId) return false;
    if (filter.$or && !filter.$or.some((clause) => (
      (clause.tenantUserId && clause.tenantUserId === found.tenantUserId)
      || (clause.tenantId && String(clause.tenantId) === String(found.tenantId))
      || (clause.branch && clause.branch === found.branch)
      || (clause.assignedAdminId && String(clause.assignedAdminId) === String(found.assignedAdminId))
    ))) return false;
    return true;
  };

  return {
    messages,
    attachments: attachmentDocs,
    current() { return conversations[0]; },
    collection(name) {
      if (name === 'chat_conversations') {
        return {
          async findOne(filter) {
            const wanted = filter._id ? String(filter._id) : null;
            const found = conversations.find((c) => !wanted || String(c._id) === wanted);
            if (!found) return null;
            // Model the tenant/admin scope clause the real filters apply.
            return matchesConversationScope(found, filter) ? found : null;
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
          async countDocuments(filter = {}) {
            const wantedAttachment = filter['attachments.attachmentId']
              ? String(filter['attachments.attachmentId'])
              : null;
            const conversationId = filter.conversationId ? String(filter.conversationId) : null;
            return messages.filter((doc) => (
              (!conversationId || String(doc.conversationId) === conversationId)
              && (!wantedAttachment || (doc.attachments || []).some(
                (entry) => String(entry.attachmentId) === wantedAttachment,
              ))
            )).length;
          },
        };
      }
      if (name === 'chat_attachments') {
        return {
          async insertOne(doc) {
            attachmentSeq += 1;
            const _id = objectIdLike(`507f1f77bcf86cd7994391${String(attachmentSeq).padStart(2, '0')}`);
            attachmentDocs.push({ ...doc, _id });
            return { insertedId: _id };
          },
          find(filter) {
            const wanted = new Set((filter?._id?.$in || []).map(String));
            const conversationId = filter?.conversationId ? String(filter.conversationId) : null;
            const rows = attachmentDocs.filter((doc) => wanted.has(String(doc._id))
              && (!conversationId || String(doc.conversationId) === conversationId));
            return { async toArray() { return rows; } };
          },
          async findOne(filter) {
            const wanted = filter?._id ? String(filter._id) : null;
            const conversationId = filter?.conversationId ? String(filter.conversationId) : null;
            return attachmentDocs.find((doc) => String(doc._id) === wanted
              && (!conversationId || String(doc.conversationId) === conversationId)) || null;
          },
          async deleteOne(filter) {
            const wanted = filter?._id ? String(filter._id) : null;
            const index = attachmentDocs.findIndex((doc) => String(doc._id) === wanted);
            if (index === -1) return { deletedCount: 0 };
            attachmentDocs.splice(index, 1);
            return { deletedCount: 1 };
          },
        };
      }
      return { async findOne() { return null; }, async updateOne() { return { matchedCount: 0 }; } };
    },
  };
}

// Minimal stand-in for firebase-admin's storage surface. `readStream` decides
// whether the object exists, so a missing storage object can be exercised as a
// controlled response rather than only as a happy path.
function fakeFirebaseAdmin({ configured = true, readStream, deleted } = {}) {
  return {
    apps: configured ? [{}] : [],
    storage: () => ({
      bucket: () => ({
        file: (storagePath) => ({
          createReadStream: () => (readStream ? readStream(storagePath) : Readable.from([Buffer.from('bytes')])),
          async delete() { if (deleted) deleted.push(storagePath); },
        }),
      }),
    }),
  };
}

function loadController(db, firebaseAdmin = fakeFirebaseAdmin()) {
  require(databasePath).getDb = () => db;
  const firebase = require(firebasePath);
  firebase.resolveStorageBucket = () => BUCKET;
  firebase.admin = firebaseAdmin;
  delete require.cache[chatControllerPath];
  delete require.cache[chatAttachmentServicePath];
  return require(chatControllerPath);
}

function conversationDoc(overrides = {}) {
  return {
    _id: objectIdLike(CONVERSATION_ID),
    tenantUserId: TENANT_ID,
    tenantId: objectIdLike(TENANT_OBJECT_ID),
    tenantName: 'Ana',
    branch: 'gil-puyat',
    status: 'waiting_tenant',
    statusHistory: [],
    unreadAdminCount: 0,
    unreadTenantCount: 0,
    ...overrides,
  };
}

function tenantReq(body = {}, conversationId = CONVERSATION_ID) {
  return {
    user: { user_id: TENANT_ID, role: 'tenant', name: 'Ana', _id: objectIdLike(TENANT_OBJECT_ID) },
    params: { conversationId },
    body,
  };
}

function adminReq({ branch = 'gil-puyat', role = 'admin', params = {}, body = {} } = {}) {
  return {
    user: { user_id: 'admin-1', role, name: 'Rita', branch, _id: objectIdLike('507f1f77bcf86cd7994390bb') },
    params: { conversationId: CONVERSATION_ID, ...params },
    body,
  };
}

// Registers one attachment through the real endpoint and returns the canonical
// resource the composer would hand back to POST /chat/:id/messages.
async function registerAttachment(controller, attachment = storedAttachment()) {
  const res = fakeResponse();
  await controller.uploadConversationAttachment(tenantReq({ attachment }), res);
  return res;
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

// ── Attachment registration ─────────────────────────────────────────────────

test('a tenant image registered under their own prefix becomes a canonical attachment with an id', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);

  const res = await registerAttachment(controller);

  assert.equal(res.statusCode, 201);
  assert.ok(res.body.attachment.attachmentId, 'registration must mint an immutable id');
  assert.equal(res.body.attachment.id, res.body.attachment.attachmentId);
  assert.equal(res.body.attachment.name, 'photo.jpg');
  assert.equal(res.body.attachment.mimeType, 'image/jpeg');
  assert.equal(
    res.body.attachment.url,
    `/chat/${CONVERSATION_ID}/attachments/${res.body.attachment.attachmentId}`,
    'the client-facing url is the protected app route',
  );
  assert.equal(db.attachments.length, 1, 'the canonical record is persisted, not just echoed');
  assert.equal(db.attachments[0].branch, 'gil-puyat');
  assert.equal(db.attachments[0].uploaderRole, 'tenant');
});

test('a tenant PDF registers the same way and keeps its document mime type', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);

  const res = await registerAttachment(controller, storedPdf());

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.attachment.mimeType, 'application/pdf');
  assert.equal(res.body.attachment.name, 'receipt.pdf');
  assert.ok(res.body.attachment.url.startsWith('/chat/'));
});

test('a registered attachment never leaks storage internals to the client', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);

  const res = await registerAttachment(controller);
  const keys = Object.keys(res.body.attachment);

  for (const forbidden of ['storagePath', 'storageUrl', 'downloadUrl', 'uri', 'bucket']) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must not be serialized to a client`);
  }
  assert.equal(db.attachments[0].storagePath, `support-attachments/${TENANT_ID}/conv-1/1700000000000-photo.jpg`);
  assert.ok(db.attachments[0].storageUrl, 'the provider URL stays server-side on the record');
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
  assert.equal(db.attachments.length, 0, 'a refused attachment must not create a record');
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

test('a tenant cannot register an attachment against another tenant conversation', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  const req = tenantReq({ attachment: storedAttachment() });
  req.user = { user_id: 'tenant-b', role: 'tenant', _id: objectIdLike('507f1f77bcf86cd7994390ff') };

  const res = fakeResponse();
  await uploadConversationAttachment(req, res);
  assert.equal(res.statusCode, 404);
});

// ── Attachments on messages ─────────────────────────────────────────────────

test('attachments survive the message round-trip as an id plus protected url', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const res = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: 'See photo', attachments: [registered] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.attachments.length, 1);
  const [serialized] = res.body.message.attachments;
  assert.equal(serialized.attachmentId, registered.attachmentId);
  assert.equal(serialized.url, `/chat/${CONVERSATION_ID}/attachments/${registered.attachmentId}`);
  assert.equal(serialized.name, 'photo.jpg');

  assert.equal(db.messages[0].attachments.length, 1, 'the attachment is persisted, not just echoed back');
  const [embedded] = db.messages[0].attachments;
  assert.ok(embedded.attachmentId, 'the message embeds the id');
  assert.equal(embedded.storagePath, undefined, 'the message must not duplicate storage facts');
  assert.equal(embedded.downloadUrl, undefined);
});

test('an attachment-only message is allowed and gets a meaningful conversation preview', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const res = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: '', attachments: [registered] }), res);

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

// The canonical per-message cap is 5 and it is a cap on the *total*, not a
// per-type quota — the three-vs-five split against the admin repo is the exact
// mismatch this pass exists to close.
test('a mixed set of exactly five attachments (3 images + 2 PDFs) is accepted', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);

  const registered = [];
  for (let index = 0; index < 3; index += 1) {
    const stored = storedAttachment({
      storagePath: `support-attachments/${TENANT_ID}/conv-1/image-${index}.jpg`,
    });
    registered.push((await registerAttachment(controller, stored)).body.attachment);
  }
  for (let index = 0; index < 2; index += 1) {
    const stored = storedPdf({
      storagePath: `support-attachments/${TENANT_ID}/conv-1/doc-${index}.pdf`,
    });
    registered.push((await registerAttachment(controller, stored)).body.attachment);
  }
  assert.equal(registered.length, 5);

  const res = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: 'five files', attachments: registered }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message.attachments.length, 5);
  assert.equal(db.messages[0].attachments.length, 5);
  assert.equal(
    res.body.message.attachments.filter((entry) => entry.mimeType === 'application/pdf').length,
    2,
    'the cap counts every type against the same allowance',
  );
});

test('a sixth attachment on one message is refused with a clean 400', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);

  const registered = [];
  for (let index = 0; index < 6; index += 1) {
    const stored = storedAttachment({
      storagePath: `support-attachments/${TENANT_ID}/conv-1/file-${index}.jpg`,
    });
    registered.push((await registerAttachment(controller, stored)).body.attachment);
  }

  const res = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: 'too many', attachments: registered }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'ATTACHMENT_LIMIT');
  assert.match(res.body.error || res.body.detail || '', /5 files/);
  // The frontend is never trusted: a payload that bypassed the compose UI must
  // leave nothing half-created behind.
  assert.equal(db.messages.length, 0, 'no partial or corrupted message is created');
});

test('the enforced cap is the shared constant, not a local literal', () => {
  const { MAX_SUPPORT_ATTACHMENTS } = require('../constants/supportAttachments');
  assert.equal(MAX_SUPPORT_ATTACHMENTS, 5);
  assert.equal(
    require('../controllers/chat.controller').__test.MAX_SUPPORT_ATTACHMENTS,
    MAX_SUPPORT_ATTACHMENTS,
    'the controller must not carry its own copy of the number',
  );
});

test('a message referencing an unregistered attachment is rejected', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { sendTenantMessage } = loadController(db);

  const noId = fakeResponse();
  await sendTenantMessage(tenantReq({ message: 'hi', attachments: [storedAttachment()] }), noId);
  assert.equal(noId.body.code, 'INVALID_CHAT_ATTACHMENT', 'raw storage metadata is no longer accepted');

  const unknownId = fakeResponse();
  await sendTenantMessage(tenantReq({
    message: 'hi',
    attachments: [{ attachmentId: '507f1f77bcf86cd7994390cc' }],
  }), unknownId);
  assert.equal(unknownId.body.code, 'ATTACHMENT_ACCESS_DENIED');
});

test("an attachment from another conversation cannot be substituted into this one", async () => {
  const foreign = {
    _id: objectIdLike('507f1f77bcf86cd7994390dd'),
    conversationId: objectIdLike(OTHER_CONVERSATION_ID),
    branch: 'guadalupe',
    uploadedBy: objectIdLike('507f1f77bcf86cd7994390ee'),
    uploaderRole: 'tenant',
    originalName: 'other.jpg',
    mimeType: 'image/jpeg',
    size: 10,
    provider: 'firebase-storage',
    storagePath: 'support-attachments/tenant-b/conv-2/other.jpg',
    storageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y',
  };
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }), attachments: [foreign] });
  const { sendTenantMessage } = loadController(db);

  const res = fakeResponse();
  await sendTenantMessage(tenantReq({
    message: 'sneaky',
    attachments: [{ attachmentId: '507f1f77bcf86cd7994390dd' }],
  }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ATTACHMENT_ACCESS_DENIED');
});

// ── Protected download ──────────────────────────────────────────────────────

test('a tenant can stream their own attachment through the protected route', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = tenantReq({});
  req.params.attachmentId = registered.attachmentId;

  const streamRes = fakeResponse();
  await controller.downloadConversationAttachment(req, streamRes);
  await new Promise((resolve) => streamRes.on('end', resolve).on('finish', resolve));

  assert.equal(streamRes.headers['content-type'], 'image/jpeg');
  assert.match(streamRes.headers['content-disposition'], /photo\.jpg/);
  assert.equal(streamRes.headers['cache-control'], 'private, max-age=300');
  assert.equal(Buffer.concat(streamRes.chunks).toString(), 'bytes');
});

test("tenant B cannot stream tenant A's attachment", async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = tenantReq({});
  req.params.attachmentId = registered.attachmentId;
  req.user = { user_id: 'tenant-b', role: 'tenant', _id: objectIdLike('507f1f77bcf86cd7994390ff') };

  const res = fakeResponse();
  await controller.downloadConversationAttachment(req, res);
  assert.equal(res.statusCode, 404, 'cross-tenant reads use the 404 IDOR convention');
});

test('an invalid or unknown attachment id is a controlled 404, never a hang', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);

  for (const attachmentId of ['not-an-id', '507f1f77bcf86cd7994390cc']) {
    const req = tenantReq({});
    req.params.attachmentId = attachmentId;
    const res = fakeResponse();
    await controller.downloadConversationAttachment(req, res);
    assert.equal(res.statusCode, 404, `${attachmentId} must resolve to a definite 404`);
    assert.equal(res.body.code, 'ATTACHMENT_NOT_FOUND');
  }
});

test('a missing storage object returns a controlled 404 rather than an open socket', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db, fakeFirebaseAdmin({
    readStream: () => {
      const stream = new PassThrough();
      process.nextTick(() => stream.emit('error', new Error('No such object')));
      return stream;
    },
  }));
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = tenantReq({});
  req.params.attachmentId = registered.attachmentId;
  const res = fakeResponse();
  await controller.downloadConversationAttachment(req, res);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'ATTACHMENT_NOT_FOUND');
});

test('unconfigured storage returns a controlled 503', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db, fakeFirebaseAdmin({ configured: false }));
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = tenantReq({});
  req.params.attachmentId = registered.attachmentId;
  const res = fakeResponse();
  await controller.downloadConversationAttachment(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'ATTACHMENT_STORAGE_UNAVAILABLE');
});

test('an admin in the conversation branch can stream the attachment', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = adminReq({ branch: 'gil-puyat', params: { attachmentId: registered.attachmentId } });
  const res = fakeResponse();
  await controller.downloadAdminConversationAttachment(req, res);
  await new Promise((resolve) => res.on('end', resolve).on('finish', resolve));

  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.equal(Buffer.concat(res.chunks).toString(), 'bytes');
});

test('an admin from another branch cannot reach the attachment', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = adminReq({ branch: 'guadalupe', params: { attachmentId: registered.attachmentId } });
  const res = fakeResponse();
  await controller.downloadAdminConversationAttachment(req, res);

  assert.equal(res.statusCode, 404, 'branch scoping reuses the existing conversation filter');
});

test('a superadmin keeps their existing unrestricted reach', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = adminReq({ branch: 'guadalupe', role: 'superadmin', params: { attachmentId: registered.attachmentId } });
  const res = fakeResponse();
  await controller.downloadAdminConversationAttachment(req, res);
  await new Promise((resolve) => res.on('end', resolve).on('finish', resolve));

  assert.equal(Buffer.concat(res.chunks).toString(), 'bytes');
});

// ── Cross-repo canonical contract ───────────────────────────────────────────
//
// The mirror of Capstone-Website's
// `server/models/chatAttachmentCrossRepoContract.test.js`, which runs these
// same two shapes through the real Mongoose schemas. Pinned here as explicit
// field sets so a drift on the mobile side fails in this repo too, rather than
// only surfacing as an attachment the admin console cannot open.

// server/models/ChatAttachment.js
const CANONICAL_RECORD_FIELDS = [
  'conversationId', 'branch', 'uploadedBy', 'uploaderRole', 'originalName',
  'mimeType', 'size', 'provider', 'storagePath', 'storageUrl',
];

// The `attachments` sub-schema on server/models/ChatMessage.js
const CANONICAL_EMBED_FIELDS = [
  'attachmentId', 'url', 'fileUrl', 'name', 'fileName', 'type', 'mimeType', 'size',
];

test('the persisted attachment record carries exactly the canonical fields', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  await registerAttachment(controller);

  const [record] = db.attachments;
  for (const field of CANONICAL_RECORD_FIELDS) {
    assert.ok(field in record, `the canonical schema requires ${field}`);
    assert.notEqual(record[field], undefined, `${field} must not be undefined`);
  }
  assert.ok(['tenant', 'admin', 'owner'].includes(record.uploaderRole),
    'uploaderRole must be inside the canonical enum');
  assert.ok(record.size <= 5 * 1024 * 1024, 'size must respect the canonical 5MB ceiling');
});

test('the message embed matches the canonical sub-schema and owns no storage facts', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const res = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: 'x', attachments: [registered] }), res);

  const [embedded] = db.messages[0].attachments;
  assert.deepEqual(
    Object.keys(embedded).sort(),
    [...CANONICAL_EMBED_FIELDS].sort(),
    'the embed must be exactly the canonical ChatMessage.attachments shape',
  );
  for (const forbidden of ['storagePath', 'storageUrl', 'provider', 'bucket', 'downloadUrl']) {
    assert.ok(!(forbidden in embedded), `${forbidden} belongs to the record, not the embed`);
  }
  for (const value of [embedded.url, embedded.fileUrl]) {
    assert.ok(value.startsWith('/chat/'), 'the embed url must be the protected app route');
    assert.ok(!/^https?:/.test(value), 'the embed url must never be a provider URL');
  }
});

test('no serialized attachment anywhere exposes a storage provider URL', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const res = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: 'x', attachments: [registered] }), res);

  const payload = JSON.stringify(res.body);
  assert.ok(!/firebasestorage|googleapis|storage\.cloud/.test(payload),
    'a client payload must never contain a storage provider URL');
  assert.ok(!payload.includes('support-attachments/'),
    'a client payload must never contain a storage path');
});

// ── MIME allow-list parity with the admin repository ────────────────────────

test('the support MIME allow-list is exactly the admin repository set', () => {
  const { SUPPORT_ATTACHMENT_MIME_TYPES } = require('../constants/supportAttachments');
  // Capstone-Website server/routes/chatRoutes.js CHAT_ATTACHMENT_MIME_TYPES,
  // plus the `image/jpg` alias some Android pickers report for a JPEG.
  assert.deepEqual(
    [...SUPPORT_ATTACHMENT_MIME_TYPES].sort(),
    [
      'application/pdf',
      'image/heic',
      'image/heif',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ],
  );
});

test('document and text types the admin console cannot render are refused', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  for (const mimeType of [
    'text/plain',
    'text/csv',
    'image/gif',
    'image/bmp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]) {
    const res = fakeResponse();
    await uploadConversationAttachment(tenantReq({ attachment: storedAttachment({ mimeType }) }), res);
    assert.equal(res.body.code, 'ATTACHMENT_UNSUPPORTED_TYPE', `${mimeType} must not be accepted`);
    assert.equal(db.attachments.length, 0, 'a refused type must not create a record');
  }
});

test('an executable renamed to a permitted extension cannot claim a permitted type', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const { uploadConversationAttachment } = loadController(db);

  // The declared mimeType is what this layer validates, so the registration
  // path refuses the honest declaration...
  const declared = fakeResponse();
  await uploadConversationAttachment(tenantReq({
    attachment: storedAttachment({ originalName: 'invoice.pdf', mimeType: 'application/x-msdownload' }),
  }), declared);
  assert.equal(declared.body.code, 'ATTACHMENT_UNSUPPORTED_TYPE');

  // ...and the *bytes* are what routes/upload.routes.js validates, so a lie
  // about the type is caught before the storage object ever exists.
  const { matchesDeclaredContent } = require('../routes/upload.routes').__test;
  assert.equal(matchesDeclaredContent(Buffer.from('MZ executable'), 'application/pdf'), false);
});

// ── Partial-upload rollback ─────────────────────────────────────────────────

test('an unsent attachment can be discarded, removing both the record and the object', async () => {
  const deleted = [];
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db, fakeFirebaseAdmin({ deleted }));
  const registered = (await registerAttachment(controller)).body.attachment;
  assert.equal(db.attachments.length, 1);

  const req = tenantReq({});
  req.params.attachmentId = registered.attachmentId;
  const res = fakeResponse();
  await controller.deleteConversationAttachment(req, res);

  assert.equal(res.body.discarded, true);
  assert.equal(db.attachments.length, 0, 'no orphaned record survives a failed send');
  assert.deepEqual(
    deleted,
    [`support-attachments/${TENANT_ID}/conv-1/1700000000000-photo.jpg`],
    'the storage object written before the failure is cleaned up too',
  );
});

test('an attachment already referenced by a message cannot be discarded', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const sent = fakeResponse();
  await controller.sendTenantMessage(tenantReq({ message: 'sent', attachments: [registered] }), sent);
  assert.equal(sent.statusCode, 200);

  const req = tenantReq({});
  req.params.attachmentId = registered.attachmentId;
  const res = fakeResponse();
  await controller.deleteConversationAttachment(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ATTACHMENT_ALREADY_SENT');
  assert.equal(db.attachments.length, 1, 'sent chat history is never deleted by rollback');
});

test('a caller who did not upload the attachment cannot discard it', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  // A same-branch admin can *read* this attachment but is not its uploader.
  const req = adminReq({ params: { attachmentId: registered.attachmentId } });
  const res = fakeResponse();
  await controller.deleteAdminConversationAttachment(req, res);

  assert.equal(res.statusCode, 404, 'non-uploaders get the same 404 as non-existent');
  assert.equal(db.attachments.length, 1);
});

// ── IDOR / cross-branch negatives ───────────────────────────────────────────

test('a guessed attachment id or tampered conversation id resolves to nothing', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  // Real attachment id, but pointed at a conversation this tenant does not own.
  const req = tenantReq({}, OTHER_CONVERSATION_ID);
  req.params.attachmentId = registered.attachmentId;
  const res = fakeResponse();
  await controller.downloadConversationAttachment(req, res);
  assert.equal(res.statusCode, 404, 'a tampered conversationId must not widen reach');

  // Correct conversation, fabricated attachment id.
  const guessed = tenantReq({});
  guessed.params.attachmentId = '507f1f77bcf86cd799439999';
  const guessedRes = fakeResponse();
  await controller.downloadConversationAttachment(guessed, guessedRes);
  assert.equal(guessedRes.statusCode, 404);
});

test('a wrong-branch admin gains nothing from knowing the id, conversation or filename', async () => {
  const db = fakeDb({ conversation: conversationDoc({ status: 'open' }) });
  const controller = loadController(db);
  const registered = (await registerAttachment(controller)).body.attachment;

  const req = adminReq({ branch: 'guadalupe', params: { attachmentId: registered.attachmentId } });
  // Everything a leaked payload could hand them, supplied deliberately.
  req.body = {
    storagePath: `support-attachments/${TENANT_ID}/conv-1/1700000000000-photo.jpg`,
    url: registered.url,
    fileName: registered.name,
  };

  const res = fakeResponse();
  await controller.downloadAdminConversationAttachment(req, res);
  assert.equal(res.statusCode, 404);
  assert.ok(
    !JSON.stringify(res.body).includes('support-attachments'),
    'the refusal must not echo a storage path back',
  );
});

test('every attachment route is role-gated and the only reads are the two protected ones', () => {
  const routes = require('../routes/chat.routes');
  const layers = routes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.length,
    }))
    .filter((entry) => entry.path.includes('attachments'));

  assert.equal(layers.length, 6, 'tenant + admin upload, download and discard — nothing else');
  for (const layer of layers) {
    // Each attachment route carries its own tenant/admin guard on top of the
    // router-level authMiddleware, so none is reachable unauthenticated.
    assert.ok(layer.handlers >= 2, `${layer.path} must be gated by role middleware`);
  }
  const reads = layers
    .filter((entry) => entry.methods.includes('get'))
    .map((entry) => entry.path)
    .sort();
  assert.deepEqual(reads, [
    '/:conversationId/attachments/:attachmentId',
    '/admin/:conversationId/attachments/:attachmentId',
  ]);
});
