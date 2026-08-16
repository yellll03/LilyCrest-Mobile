'use strict';

// Handler-level regression coverage for the "Talk to Admin" escalation chain
// (POST /chat/start -> shared branch resolver -> normalized admin matching).
// Mirrors the require.cache seeding technique in
// announcementHandlerIntegration.test.js: chat.controller.js calls getDb()
// internally (destructured from ../config/database at module load) rather
// than accepting db as a parameter, and this backend's test runner
// (node:test) has no jest.mock equivalent. Seeding require.cache with a fake
// { getDb } module before the controller is first required lets these tests
// exercise the real handlers — resolveTenantContext, autoAssignConversation,
// buildAdminConversationFilter — without a real MongoDB connection.
//
// This file must require the chat controller before any other test file in
// the same process does, or the cache-seed guard below throws.

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const dbModulePath = require.resolve('../config/database');

// ---------------------------------------------------------------------------
// Minimal in-memory Mongo-like store. Supports exactly the query shapes used
// by chat.controller.js and services/branchLocation.service.js: $or, $and,
// $in, $exists, RegExp field matchers (branchLocation.service.js's
// ACTIVE_STAY/APPROVED constants), and ObjectId-aware equality.
// ---------------------------------------------------------------------------

function testEq(a, b) {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
}

function matchValue(value, cond) {
  if (cond instanceof RegExp) return cond.test(String(value ?? ''));
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof ObjectId)) {
    if ('$in' in cond) return cond.$in.some((v) => testEq(value, v));
    if ('$exists' in cond) return cond.$exists ? value !== undefined : value === undefined;
    return false;
  }
  if (cond === null) return value === null || value === undefined;
  return testEq(value, cond);
}

function matchQuery(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matchQuery(doc, sub));
    if (key === '$and') return cond.every((sub) => matchQuery(doc, sub));
    return matchValue(doc[key], cond);
  });
}

function makeCursor(list) {
  let result = list;
  return {
    sort() { return this; },
    limit(n) { result = result.slice(0, n); return this; },
    async toArray() { return result; },
    async next() { return result[0] || null; },
  };
}

function makeCollection(store, name) {
  if (!store[name]) store[name] = [];
  return {
    find(query) { return makeCursor(store[name].filter((doc) => matchQuery(doc, query))); },
    async findOne(query) { return store[name].find((doc) => matchQuery(doc, query)) || null; },
    async insertOne(doc) {
      const record = { ...doc, _id: doc._id || new ObjectId() };
      store[name].push(record);
      return { insertedId: record._id };
    },
    async updateOne(filter, update) {
      const doc = store[name].find((d) => matchQuery(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    async updateMany(filter, update) {
      const docs = store[name].filter((d) => matchQuery(d, filter));
      docs.forEach((doc) => { if (update.$set) Object.assign(doc, update.$set); });
      return { matchedCount: docs.length };
    },
    aggregate(pipeline) {
      let data = store[name];
      for (const stage of pipeline) {
        if (stage.$match) data = data.filter((doc) => matchQuery(doc, stage.$match));
        if (stage.$group) {
          const field = String(stage.$group._id).replace(/^\$/, '');
          const groups = new Map();
          for (const doc of data) {
            const key = String(doc[field]);
            groups.set(key, (groups.get(key) || 0) + 1);
          }
          data = [...groups.entries()].map(([_id, count]) => ({ _id, count }));
        }
      }
      return { async toArray() { return data; } };
    },
  };
}

function fakeDb(seed = {}) {
  const store = { ...seed };
  return { collection(name) { return makeCollection(store, name); } };
}

// ---------------------------------------------------------------------------
// require.cache seed — see file header.
// ---------------------------------------------------------------------------

let currentDb = null;

if (!require.cache[dbModulePath]) {
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getDb: () => currentDb,
      connectToMongo: async () => currentDb,
      closeConnection: async () => {},
    },
  };
} else {
  throw new Error(
    'config/database.js was already required by an earlier test in this process — '
    + 'the require.cache seeding trick in chatSupportEscalation.test.js only works '
    + 'if this file requires the chat controller first. Run this file in isolation '
    + 'if it fails for this reason.',
  );
}

const { startConversation, getAdminConversations } = require('../controllers/chat.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function callStart(db, user, body = {}) {
  currentDb = db;
  const res = fakeRes();
  await startConversation({ user, body }, res);
  return res;
}

async function callAdminList(db, user, status) {
  currentDb = db;
  const res = fakeRes();
  await getAdminConversations({ user, query: { status } }, res);
  return res;
}

function tenant(overrides = {}) {
  return { _id: new ObjectId(), user_id: `tenant-${new ObjectId()}`, role: 'tenant', email: 't@example.com', ...overrides };
}

function admin(branch, overrides = {}) {
  return { _id: new ObjectId(), user_id: `admin-${new ObjectId()}`, role: 'admin', branch, ...overrides };
}

// ---------------------------------------------------------------------------
// A. Shared branch resolution — a case the OLD narrow reservation/bed-history
// lookup in resolveTenantContext could not resolve (status outside its exact
// $in list) but the shared four-tier resolveTenantBranch resolver can, via
// the approved_contract tier.
// ---------------------------------------------------------------------------

test('A. shared resolver succeeds where the narrow legacy reservation lookup would 400', async () => {
  const user = tenant();
  const db = fakeDb({
    // status is intentionally NOT in the old narrow $in list
    // ['moveIn','active','completed','payment_pending','confirmed','paid'],
    // but contractStatus 'signed' matches branchLocation.service.js's
    // APPROVED regex for the approved_contract tier.
    reservations: [{ userId: user._id, status: 'under_review', contractStatus: 'signed', branch: 'gil-puyat' }],
  });

  const res = await callStart(db, user, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.conversation.branch, 'gil-puyat');
});

// ---------------------------------------------------------------------------
// B. Guadalupe normalization — admin.branch stored in varying casing must
// still receive auto-assignment.
// ---------------------------------------------------------------------------

for (const form of ['Guadalupe', 'guadalupe', 'GUADALUPE']) {
  test(`B. tenant resolves to guadalupe, admin stored as "${form}" is assigned`, async () => {
    const user = tenant();
    const gAdmin = admin(form);
    const db = fakeDb({
      reservations: [{ userId: user._id, status: 'approved', branch: 'guadalupe' }],
      users: [gAdmin],
    });

    const res = await callStart(db, user, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.conversation.branch, 'guadalupe');
    assert.equal(res.body.conversation.assignedAdminId, String(gAdmin._id));
  });
}

// ---------------------------------------------------------------------------
// C. Gil Puyat normalization — representative forms the normalization
// service already supports (normalizedBranchReference lowercases, folds
// whitespace/underscores to hyphens, and specifically recognizes
// "gil puyat"/"gil-puyat" variants).
// ---------------------------------------------------------------------------

for (const form of ['Gil Puyat', 'gil-puyat', 'gil puyat']) {
  test(`C. tenant resolves to gil-puyat, admin stored as "${form}" is assigned`, async () => {
    const user = tenant();
    const gpAdmin = admin(form);
    const db = fakeDb({
      reservations: [{ userId: user._id, status: 'approved', branch: 'gil-puyat' }],
      users: [gpAdmin],
    });

    const res = await callStart(db, user, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.conversation.branch, 'gil-puyat');
    assert.equal(res.body.conversation.assignedAdminId, String(gpAdmin._id));
  });
}

// ---------------------------------------------------------------------------
// D. Admin conversation visibility — a conversation stored under the
// canonical normalized branch must be listed for an admin whose own branch
// field uses a different supported casing.
// ---------------------------------------------------------------------------

test('D. admin sees a conversation even when their branch field casing differs from the stored canonical branch', async () => {
  const user = tenant();
  const gAdmin = admin('GUADALUPE');
  const db = fakeDb({
    reservations: [{ userId: user._id, status: 'approved', branch: 'Guadalupe' }],
    users: [gAdmin],
  });

  const startRes = await callStart(db, user, {});
  assert.equal(startRes.statusCode, 200);

  const listRes = await callAdminList(db, gAdmin);
  assert.equal(listRes.statusCode, 200);
  const ids = listRes.body.conversations.map((c) => c.id);
  assert.deepEqual(ids, [startRes.body.conversation.id]);
});

// ---------------------------------------------------------------------------
// E. Unresolved tenant — no reservation, stay, occupancy, or bed history
// anywhere. Must fail explicitly, never silently default to a branch.
// ---------------------------------------------------------------------------

test('E. tenant with no resolvable branch gets 400 BRANCH_REQUIRED, not a silent fallback', async () => {
  const user = tenant();
  const db = fakeDb({});

  const res = await callStart(db, user, {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'BRANCH_REQUIRED');
});

// ---------------------------------------------------------------------------
// F. Branch resolves, but no eligible admin exists for it — conversation
// must still be created (existing product behavior), with no crash and no
// cross-branch assignment.
// ---------------------------------------------------------------------------

test('F. branch resolves but no eligible admin exists: conversation created, unassigned, no crash', async () => {
  const user = tenant();
  const otherBranchAdmin = admin('guadalupe'); // wrong branch — must not be picked
  const db = fakeDb({
    reservations: [{ userId: user._id, status: 'approved', branch: 'gil-puyat' }],
    users: [otherBranchAdmin],
  });

  const res = await callStart(db, user, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.conversation.branch, 'gil-puyat');
  assert.equal(res.body.conversation.assignedAdminId, '');
});

// ---------------------------------------------------------------------------
// G. Tenant isolation — a tenant in branch A must never be assigned to an
// admin restricted to branch B, even when a branch-B admin is the only other
// admin present and would otherwise be the sole aggregate candidate.
// ---------------------------------------------------------------------------

test('G. tenant in gil-puyat is never assigned to a guadalupe-only admin', async () => {
  const user = tenant();
  const gpAdmin = admin('gil-puyat');
  const guAdmin = admin('guadalupe');
  const db = fakeDb({
    reservations: [{ userId: user._id, status: 'approved', branch: 'gil-puyat' }],
    users: [gpAdmin, guAdmin],
  });

  const res = await callStart(db, user, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.conversation.assignedAdminId, String(gpAdmin._id));
  assert.notEqual(res.body.conversation.assignedAdminId, String(guAdmin._id));
});

// A superadmin is eligible for every branch regardless of casing/format —
// confirms the fix didn't accidentally narrow superadmin's cross-branch reach.
test('superadmin remains eligible across branches after normalization change', async () => {
  const user = tenant();
  const owner = admin('', { role: 'superadmin', branch: '' });
  const db = fakeDb({
    reservations: [{ userId: user._id, status: 'approved', branch: 'gil-puyat' }],
    users: [owner],
  });

  const res = await callStart(db, user, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.conversation.assignedAdminId, String(owner._id));
});
