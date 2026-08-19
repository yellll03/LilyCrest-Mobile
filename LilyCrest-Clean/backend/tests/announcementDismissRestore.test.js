'use strict';

// Behavioral coverage for the per-tenant announcement dismiss/restore
// contract. The mobile News tab has always shipped an "Undo" toast wired to
// DELETE /announcements/:id/dismiss, but that route was never registered
// server-side — the call 404'd and the client silently reverted its own
// optimistic re-insert, so Undo appeared to work for a frame and then undid
// itself. These tests pin the completed contract:
//
//   POST   /announcements/:id/dismiss  -> add this tenant's dismissal row
//   DELETE /announcements/:id/dismiss  -> remove this tenant's dismissal row
//
// and, critically, that NEITHER verb ever mutates or deletes the shared
// `announcements` document — a tenant clearing their News tab must not be
// able to destroy canonical admin content for everyone else.
//
// Uses the same require.cache-seeding technique as
// announcementHandlerIntegration.test.js (node:test has no module mocking).

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function makeFakeMongo({ announcements = [] } = {}) {
  const announcementDocs = announcements.map((doc) => ({ ...doc }));
  const dismissals = [];
  const mutations = [];

  return {
    announcementDocs,
    dismissals,
    mutations,
    dismissalFor(userId, announcementId) {
      return dismissals.find((d) => d.user_id === userId && d.announcement_id === announcementId) || null;
    },
    db: {
      collection(name) {
        if (name === 'announcements') {
          return {
            async findOne(filter) {
              const candidates = filter.$or || [filter];
              return announcementDocs.find((doc) => candidates.some((c) => (
                (c.announcement_id !== undefined && c.announcement_id === doc.announcement_id)
                || (c._id !== undefined && String(c._id) === String(doc._id))
              ))) || null;
            },
            async countDocuments() { return announcementDocs.length; },
            // Any call to these would mean a tenant action is reaching the
            // shared admin content, which is exactly what must never happen.
            async updateOne() { mutations.push('announcements.updateOne'); return { matchedCount: 0 }; },
            async deleteOne() { mutations.push('announcements.deleteOne'); return { deletedCount: 0 }; },
            async deleteMany() { mutations.push('announcements.deleteMany'); return { deletedCount: 0 }; },
          };
        }
        if (name === 'announcement_dismissals') {
          return {
            async updateOne(filter, update, options) {
              const existing = dismissals.find((d) => (
                d.user_id === filter.user_id && d.announcement_id === filter.announcement_id
              ));
              if (existing) {
                Object.assign(existing, update.$set);
                return { matchedCount: 1, upsertedCount: 0 };
              }
              if (options?.upsert) {
                dismissals.push({ ...filter, ...update.$setOnInsert, ...update.$set });
                return { matchedCount: 0, upsertedCount: 1 };
              }
              return { matchedCount: 0, upsertedCount: 0 };
            },
            async deleteOne(filter) {
              const index = dismissals.findIndex((d) => (
                d.user_id === filter.user_id && d.announcement_id === filter.announcement_id
              ));
              if (index === -1) return { deletedCount: 0 };
              dismissals.splice(index, 1);
              return { deletedCount: 1 };
            },
          };
        }
        return { async findOne() { return null; } };
      },
    },
  };
}

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
    + 'run this file in isolation if it fails for this reason.',
  );
}

const {
  dismissAnnouncement,
  restoreAnnouncement,
} = require('../controllers/announcement.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function req(userId, announcementId) {
  return { user: { user_id: userId, role: 'tenant' }, params: { announcementId } };
}

const SEED = { announcements: [{ announcement_id: 'ann_abc123', title: 'Water interruption' }] };

test('dismiss writes a per-tenant row and restore removes exactly that row', async () => {
  const mongo = makeFakeMongo(SEED);
  currentDb = mongo.db;

  const dismissRes = fakeRes();
  await dismissAnnouncement(req('tenant-a', 'ann_abc123'), dismissRes);
  assert.equal(dismissRes.statusCode, 200);
  assert.equal(dismissRes.body.status, 'dismissed');
  assert.ok(mongo.dismissalFor('tenant-a', 'ann_abc123'));

  const restoreRes = fakeRes();
  await restoreAnnouncement(req('tenant-a', 'ann_abc123'), restoreRes);
  assert.equal(restoreRes.statusCode, 200);
  assert.equal(restoreRes.body.status, 'restored');
  assert.equal(restoreRes.body.restored, true);
  assert.equal(mongo.dismissalFor('tenant-a', 'ann_abc123'), null);
});

test('neither dismiss nor restore ever touches the shared announcement document', async () => {
  const mongo = makeFakeMongo(SEED);
  currentDb = mongo.db;

  await dismissAnnouncement(req('tenant-a', 'ann_abc123'), fakeRes());
  await restoreAnnouncement(req('tenant-a', 'ann_abc123'), fakeRes());

  assert.deepEqual(mongo.mutations, [], 'canonical admin content must survive any tenant dismiss/restore');
  assert.equal(mongo.announcementDocs.length, 1);
  assert.equal(mongo.announcementDocs[0].title, 'Water interruption');
});

test("one tenant's restore does not resurrect another tenant's dismissal", async () => {
  const mongo = makeFakeMongo(SEED);
  currentDb = mongo.db;

  await dismissAnnouncement(req('tenant-a', 'ann_abc123'), fakeRes());
  await dismissAnnouncement(req('tenant-b', 'ann_abc123'), fakeRes());
  await restoreAnnouncement(req('tenant-a', 'ann_abc123'), fakeRes());

  assert.equal(mongo.dismissalFor('tenant-a', 'ann_abc123'), null);
  assert.ok(mongo.dismissalFor('tenant-b', 'ann_abc123'), "tenant-b's own dismissal is untouched");
});

test('restoring something that was never dismissed is an idempotent success', async () => {
  const mongo = makeFakeMongo(SEED);
  currentDb = mongo.db;

  const res = fakeRes();
  await restoreAnnouncement(req('tenant-a', 'ann_abc123'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restored, false, 'reports that no row existed, but does not fail the Undo');
});

test('restore rejects an unknown announcement rather than writing a phantom row', async () => {
  const mongo = makeFakeMongo(SEED);
  currentDb = mongo.db;

  const res = fakeRes();
  await restoreAnnouncement(req('tenant-a', 'ann_nope'), res);
  assert.equal(res.statusCode, 404);
  assert.equal(mongo.dismissals.length, 0);
});

test('restore requires an announcement id', async () => {
  const mongo = makeFakeMongo(SEED);
  currentDb = mongo.db;

  const res = fakeRes();
  await restoreAnnouncement({ user: { user_id: 'tenant-a' }, params: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('the DELETE undo route is actually registered, tenant-gated, and paired with the POST', () => {
  const fs = require('node:fs');
  const routes = fs.readFileSync(require.resolve('../routes/announcement.routes.js'), 'utf8');
  assert.match(
    routes,
    /router\.delete\('\/:announcementId\/dismiss',\s*authMiddleware,\s*tenantMiddleware,\s*announcementController\.restoreAnnouncement\)/,
  );
  assert.match(
    routes,
    /router\.post\('\/:announcementId\/dismiss',\s*authMiddleware,\s*tenantMiddleware,\s*announcementController\.dismissAnnouncement\)/,
  );
});
