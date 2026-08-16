'use strict';

// Handler-level adversarial tests for MOB-P0-01: POST/GET/DELETE
// /api/m/users/documents... must never trust a client-supplied storagePath
// as authorization by itself. Uses the same require.cache-seeding technique
// as announcementHandlerIntegration.test.js to exercise the real
// user.controller.js handlers (which call getDb()/admin.storage()
// internally) against fakes, without a real MongoDB/Firebase connection.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');
const firebaseModulePath = require.resolve('../config/firebase');

const BUCKET = 'lilycrest-test.firebasestorage.app';

function downloadUrlFor(path, bucket = BUCKET) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media&token=test-token`;
}

// ── Minimal in-memory `users` collection ────────────────────────────────
// Only implements the exact operations user.controller.js's document
// handlers issue (findOne with a doc_id filter/projection, $push, the
// $elemMatch/$set pending-deletion marker, $unset, $pull) — not a general
// Mongo emulation.
function makeUsersCollection(usersById) {
  function findUploadedDoc(user, docId) {
    return (user?.uploaded_documents || []).find((entry) => entry.doc_id === docId);
  }

  return {
    async findOne(query = {}) {
      const user = usersById[query.user_id];
      if (!user) return null;
      const requiredDocId = query['uploaded_documents.doc_id'];
      if (requiredDocId && !findUploadedDoc(user, requiredDocId)) return null;
      return structuredClone(user);
    },
    async updateOne(query = {}, update = {}) {
      const user = usersById[query.user_id];
      if (!user) return { matchedCount: 0, modifiedCount: 0 };

      if (update.$push) {
        for (const [key, value] of Object.entries(update.$push)) {
          user[key] = user[key] || [];
          user[key].push(structuredClone(value));
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }

      if (update.$set && query.uploaded_documents?.$elemMatch) {
        const { doc_id: docId, deletion_pending: excludePending } = query.uploaded_documents.$elemMatch;
        const doc = findUploadedDoc(user, docId);
        if (!doc || (excludePending?.$ne === true && doc.deletion_pending === true)) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        for (const [key, value] of Object.entries(update.$set)) {
          doc[key.replace('uploaded_documents.$.', '')] = value;
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }

      if (update.$unset && query['uploaded_documents.doc_id']) {
        const doc = findUploadedDoc(user, query['uploaded_documents.doc_id']);
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        for (const key of Object.keys(update.$unset)) {
          delete doc[key.replace('uploaded_documents.$.', '')];
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }

      if (update.$pull && query['uploaded_documents.doc_id']) {
        const docId = update.$pull.uploaded_documents.doc_id;
        const before = (user.uploaded_documents || []).length;
        user.uploaded_documents = (user.uploaded_documents || []).filter((entry) => entry.doc_id !== docId);
        return { matchedCount: 1, modifiedCount: user.uploaded_documents.length < before ? 1 : 0 };
      }

      return { matchedCount: 1, modifiedCount: 0 };
    },
  };
}

function emptyCursor() {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return []; } };
}

function fakeDb(usersById) {
  return {
    collection(name) {
      if (name === 'users') return makeUsersCollection(usersById);
      return { find() { return emptyCursor(); }, async findOne() { return null; } };
    },
  };
}

// ── Minimal in-memory Firebase Admin Storage fake ───────────────────────
function fakeFirebaseModule(objectStore) {
  return {
    admin: {
      storage: () => ({
        bucket: (bucketName) => ({
          file: (path) => ({
            async download() {
              const key = `${bucketName}::${path}`;
              const bytes = objectStore[key];
              if (!bytes) {
                const error = new Error('No such object');
                error.code = 404;
                throw error;
              }
              return [bytes];
            },
            async delete() {
              const key = `${bucketName}::${path}`;
              delete objectStore[key];
            },
          }),
        }),
      }),
      credential: { cert: () => ({}) },
    },
    resolveStorageBucket: () => BUCKET,
    initializeFirebase: () => {},
    verifyFirebaseIdToken: async () => null,
    verifyTenantInFirebase: async () => null,
    getFirebaseApp: () => null,
  };
}

const objectStore = {};
const usersById = {};

if (!require.cache[dbModulePath] && !require.cache[firebaseModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getDb: () => fakeDb(usersById),
      connectToMongo: async () => fakeDb(usersById),
      closeConnection: async () => {},
    },
  };
  require.cache[firebaseModulePath] = {
    id: firebaseModulePath,
    filename: firebaseModulePath,
    loaded: true,
    exports: fakeFirebaseModule(objectStore),
  };
} else {
  throw new Error(
    'config/database.js or config/firebase.js was already required by an earlier test in this process — '
    + 'this require.cache seeding trick only works if this file requires the user controller first. '
    + 'Run this file in isolation if it fails for this reason.',
  );
}

const userController = require('../controllers/user.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    send(payload) { this.body = payload; return this; },
  };
}

function pdfBytes() {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('fixture content'.repeat(4))]);
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const TENANT_A_PREFIX = `tenant-documents/${TENANT_A}/`;
const TENANT_B_PREFIX = `tenant-documents/${TENANT_B}/`;

test.beforeEach(() => {
  for (const key of Object.keys(usersById)) delete usersById[key];
  for (const key of Object.keys(objectStore)) delete objectStore[key];
  usersById[TENANT_A] = { user_id: TENANT_A, uploaded_documents: [] };
  usersById[TENANT_B] = { user_id: TENANT_B, uploaded_documents: [] };
});

// ── Upload / metadata registration ──────────────────────────────────────

test('upload: accepts a document whose storagePath is genuinely the tenant own object', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const req = {
    user: { user_id: TENANT_A },
    body: {
      type: 'government_id',
      downloadUrl: downloadUrlFor(path),
      storagePath: path,
      mimeType: 'image/jpeg',
      size: 100,
    },
  };
  const res = fakeRes();
  await userController.uploadDocument(req, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(usersById[TENANT_A].uploaded_documents.length, 1);
  assert.equal(usersById[TENANT_A].uploaded_documents[0].storagePath, path);
});

test('upload: rejects metadata registration when storagePath belongs to another tenant', async () => {
  const foreignPath = `${TENANT_B_PREFIX}government_id/1700-id.jpg`;
  const req = {
    user: { user_id: TENANT_A },
    body: {
      type: 'government_id',
      downloadUrl: downloadUrlFor(foreignPath),
      storagePath: foreignPath,
      mimeType: 'image/jpeg',
      size: 100,
    },
  };
  const res = fakeRes();
  await userController.uploadDocument(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(usersById[TENANT_A].uploaded_documents.length, 0);
});

test('upload: rejects own-URL-with-foreign-storagePath substitution attack', async () => {
  const ownPath = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  const foreignPath = `${TENANT_B_PREFIX}government_id/1700-id.jpg`;
  const req = {
    user: { user_id: TENANT_A },
    body: {
      type: 'government_id',
      downloadUrl: downloadUrlFor(ownPath), // tenant A's own genuinely valid URL
      storagePath: foreignPath, // but claims a different (tenant B's) object path
      mimeType: 'image/jpeg',
      size: 100,
    },
  };
  const res = fakeRes();
  await userController.uploadDocument(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(usersById[TENANT_A].uploaded_documents.length, 0);
});

test('upload: rejects a download URL pointing at a different bucket', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  const req = {
    user: { user_id: TENANT_A },
    body: {
      type: 'government_id',
      downloadUrl: downloadUrlFor(path, 'attacker-bucket.firebasestorage.app'),
      storagePath: path,
      mimeType: 'image/jpeg',
      size: 100,
    },
  };
  const res = fakeRes();
  await userController.uploadDocument(req, res);
  assert.equal(res.statusCode, 400);
});

test('upload: rejects encoded path traversal tricks', async () => {
  const traversal = `${TENANT_A_PREFIX}../${TENANT_B_PREFIX}secret.jpg`;
  const req = {
    user: { user_id: TENANT_A },
    body: {
      type: 'government_id',
      downloadUrl: downloadUrlFor(traversal),
      storagePath: traversal,
      mimeType: 'image/jpeg',
      size: 100,
    },
  };
  const res = fakeRes();
  await userController.uploadDocument(req, res);
  assert.equal(res.statusCode, 400);
});

// ── Content read ─────────────────────────────────────────────────────────

test('content read: owner can read their own authorized document', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = pdfBytes();
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_own', type: 'government_id', storagePath: path,
    downloadUrl: downloadUrlFor(path), mimeType: 'application/pdf',
  });
  const req = { user: { user_id: TENANT_A }, params: { docId: 'doc_own' } };
  const res = fakeRes();
  await userController.getDocumentContent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
});

test('content read: fails closed on unsafe/legacy metadata pointing at another tenant path', async () => {
  const foreignPath = `${TENANT_B_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${foreignPath}`] = pdfBytes();
  // Simulates metadata written before the authorization invariant existed.
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_legacy_unsafe', type: 'government_id', storagePath: foreignPath,
    downloadUrl: downloadUrlFor(foreignPath), mimeType: 'application/pdf',
  });
  const req = { user: { user_id: TENANT_A }, params: { docId: 'doc_legacy_unsafe' } };
  const res = fakeRes();
  await userController.getDocumentContent(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.detail?.includes('re-upload'), true);
});

test('content read: tenant B cannot read tenant A document metadata (owner scoping)', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = pdfBytes();
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_own', type: 'government_id', storagePath: path,
    downloadUrl: downloadUrlFor(path), mimeType: 'application/pdf',
  });
  const req = { user: { user_id: TENANT_B }, params: { docId: 'doc_own' } };
  const res = fakeRes();
  await userController.getDocumentContent(req, res);
  assert.equal(res.statusCode, 404);
});

test('content read: validates image MIME by magic bytes instead of forcing PDF', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_image', type: 'government_id', storagePath: path,
    downloadUrl: downloadUrlFor(path), mimeType: 'image/jpeg',
  });
  const req = { user: { user_id: TENANT_A }, params: { docId: 'doc_image' } };
  const res = fakeRes();
  await userController.getDocumentContent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/jpeg');
});

test('content read: rejects when declared MIME does not match the actual file magic bytes', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = Buffer.from('<html>not an image</html>');
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_spoofed', type: 'government_id', storagePath: path,
    downloadUrl: downloadUrlFor(path), mimeType: 'image/jpeg',
  });
  const req = { user: { user_id: TENANT_A }, params: { docId: 'doc_spoofed' } };
  const res = fakeRes();
  await userController.getDocumentContent(req, res);
  assert.equal(res.statusCode, 422);
});

// ── Delete ────────────────────────────────────────────────────────────────

test('delete: owner can delete their own authorized document', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = pdfBytes();
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_own', type: 'government_id', storagePath: path,
    downloadUrl: downloadUrlFor(path), mimeType: 'application/pdf',
  });
  const req = { user: { user_id: TENANT_A }, params: { docId: 'doc_own' } };
  const res = fakeRes();
  await userController.deleteDocument(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(usersById[TENANT_A].uploaded_documents.length, 0);
  assert.equal(objectStore[`${BUCKET}::${path}`], undefined);
});

test('delete: fails closed on unsafe/legacy metadata and does not touch the foreign storage object', async () => {
  const foreignPath = `${TENANT_B_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${foreignPath}`] = pdfBytes();
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_legacy_unsafe', type: 'government_id', storagePath: foreignPath,
    downloadUrl: downloadUrlFor(foreignPath), mimeType: 'application/pdf',
  });
  const req = { user: { user_id: TENANT_A }, params: { docId: 'doc_legacy_unsafe' } };
  const res = fakeRes();
  await userController.deleteDocument(req, res);
  assert.equal(res.statusCode, 409);
  // The foreign object must survive — no privileged delete was ever issued.
  assert.notEqual(objectStore[`${BUCKET}::${foreignPath}`], undefined);
  // The metadata record itself is preserved (not silently discarded) for review.
  assert.equal(usersById[TENANT_A].uploaded_documents.length, 1);
  assert.equal(usersById[TENANT_A].uploaded_documents[0].deletion_pending, undefined);
});

test('delete: tenant B cannot delete tenant A document (owner scoping)', async () => {
  const path = `${TENANT_A_PREFIX}government_id/1700-id.jpg`;
  objectStore[`${BUCKET}::${path}`] = pdfBytes();
  usersById[TENANT_A].uploaded_documents.push({
    doc_id: 'doc_own', type: 'government_id', storagePath: path,
    downloadUrl: downloadUrlFor(path), mimeType: 'application/pdf',
  });
  const req = { user: { user_id: TENANT_B }, params: { docId: 'doc_own' } };
  const res = fakeRes();
  await userController.deleteDocument(req, res);
  assert.equal(res.statusCode, 404);
  assert.notEqual(objectStore[`${BUCKET}::${path}`], undefined);
  assert.equal(usersById[TENANT_A].uploaded_documents.length, 1);
});
