'use strict';

// Attempts a real handler-level behavioral test for getAllAnnouncements (not
// just the extracted helper functions in announcementBranchVisibility.test.js).
//
// announcement.controller.js calls `getDb()` internally (destructured from
// ../config/database at module load), rather than accepting `db` as a
// parameter the way branchLocation.service.js does. The backend test suite
// uses Node's built-in `node:test` runner, which has no module-mocking
// framework (no jest.mock equivalent). To exercise the real handler without
// making a real MongoDB connection, this test pre-seeds Node's own
// require.cache for '../config/database' with a fake { getDb } BEFORE the
// controller is first required in this process, so the controller's internal
// `require('../config/database')` resolves to the fake module.
//
// This is a one-off, test-file-local technique — not a change to production
// code or module structure, and not general dependency injection. If a future
// refactor moves the backend to Jest or introduces a DI seam, this file can be
// simplified.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, project() { return this; }, async toArray() { return records; } };
}

const GIL_PUYAT_RESERVATION = { user_id: 'tenant-gil', branch: 'gil-puyat', status: 'approved' };

// Mirrors the exact activeFilter/notArchivedFilter/visibilityFilter query
// built in announcement.controller.js's getAllAnnouncements, so this in-memory
// fake actually enforces the same query-level private-ownership exclusion the
// real MongoDB query does — not just the branch post-filter under test.
function matchesAnnouncementQuery(doc, userId) {
  const isActive = doc.is_active === true || doc.isActive === true
    || (doc.is_active === undefined && doc.isActive === undefined);
  if (!isActive) return false;
  if (doc.isArchived === true) return false;
  const isPrivate = doc.is_private === true || doc.isPrivate === true;
  if (!isPrivate) return true;
  if (!userId) return false;
  return (doc.is_private === true && doc.user_id === userId)
    || (doc.isPrivate === true && doc.userId === userId);
}

function fakeDb({ announcements = [], reservations = [], requesterUserId = null } = {}) {
  return {
    collection(name) {
      if (name === 'announcements') {
        return {
          find() {
            return cursor(announcements.filter((doc) => matchesAnnouncementQuery(doc, requesterUserId)));
          },
        };
      }
      if (name === 'reservations') {
        return {
          find(query) {
            const contractTier = JSON.stringify(query).includes('contractStatus');
            return cursor(reservations.filter((record) => contractTier
              ? Boolean(record.contractStatus || record.leaseStatus || record.contractApproved)
              : Boolean(record.status || record.applicationStatus || record.approvalStatus || record.isApproved)));
          },
        };
      }
      return { find() { return cursor([]); }, async findOne() { return null; } };
    },
  };
}

let currentDb = null;

// Seed the cache for '../config/database' with a fake module before the
// controller (or anything else) requires it for the first time in this process.
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
    + 'the require.cache seeding trick in announcementHandlerIntegration.test.js only works '
    + 'if this file requires the announcement controller first. Run this file in isolation '
    + 'if it fails for this reason.',
  );
}

const { getAllAnnouncements } = require('../controllers/announcement.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function run(db, req) {
  currentDb = db;
  const res = fakeRes();
  const request = req.user ? { ...req, user: { role: 'tenant', ...req.user } } : req;
  await getAllAnnouncements(request, res);
  return res;
}

test('handler: unauthenticated request fails closed without returning announcement content', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-global', title: 'Global', content: 'x' },
      { announcement_id: 'a-private', title: 'Private', content: 'x', is_private: true, user_id: 'tenant-gil' },
      { announcement_id: 'a-branch', title: 'Gil Puyat only', content: 'x', branch: 'gil-puyat' },
    ],
  });
  const res = await run(db, { user: null });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { detail: 'Authentication is required.' });
});

test('handler: Gil Puyat tenant sees global, own-branch, and own-private announcements, not other-branch or other-tenant-private', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-global', title: 'Global', content: 'x' },
      { announcement_id: 'a-gp', title: 'Gil Puyat only', content: 'x', branch: 'gil-puyat' },
      { announcement_id: 'a-gu', title: 'Guadalupe only', content: 'x', branch: 'guadalupe' },
      { announcement_id: 'a-mine', title: 'Mine', content: 'x', is_private: true, user_id: 'tenant-gil' },
      { announcement_id: 'a-theirs', title: 'Not mine', content: 'x', is_private: true, user_id: 'tenant-other' },
    ],
    reservations: [GIL_PUYAT_RESERVATION],
    requesterUserId: 'tenant-gil',
  });
  const res = await run(db, { user: { user_id: 'tenant-gil' } });
  const ids = res.body.map((a) => a.announcement_id).sort();
  assert.deepEqual(ids, ['a-mine', 'a-global', 'a-gp'].sort());
});

test('handler: another tenant in the same branch sees branch content but not the private target content', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-gp', title: 'Gil Puyat only', content: 'x', branch: 'gil-puyat' },
      { announcement_id: 'a-private-target', title: 'Target only', content: 'secret', is_private: true, user_id: 'tenant-gil', branch: 'gil-puyat' },
    ],
    reservations: [{ user_id: 'tenant-gil-other', branch: 'gil-puyat', status: 'approved' }],
    requesterUserId: 'tenant-gil-other',
  });
  const res = await run(db, { user: { user_id: 'tenant-gil-other' } });
  assert.deepEqual(res.body.map((a) => a.announcement_id), ['a-gp']);
});

test('handler: future and expired announcements return no content', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-future', title: 'Future', content: 'not yet', publishedAt: new Date('2099-01-01T00:00:00Z') },
      { announcement_id: 'a-expired', title: 'Expired', content: 'too late', expiresAt: new Date('2000-01-01T00:00:00Z') },
    ],
    requesterUserId: 'tenant-gil',
  });
  const res = await run(db, { user: { user_id: 'tenant-gil' } });
  assert.deepEqual(res.body, []);
});

test('handler: tenant with no resolvable occupancy sees global announcements but not branch-restricted ones', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-global', title: 'Global', content: 'x' },
      { announcement_id: 'a-branch', title: 'Branch only', content: 'x', branch: 'gil-puyat' },
    ],
    reservations: [],
    requesterUserId: 'tenant-no-occupancy',
  });
  const res = await run(db, { user: { user_id: 'tenant-no-occupancy' } });
  const ids = res.body.map((a) => a.announcement_id);
  assert.deepEqual(ids, ['a-global']);
});

test('handler: a private announcement with a mismatched branch fails closed for its intended recipient', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-private-wrong-branch', title: 'Private+stale branch', content: 'x', is_private: true, user_id: 'tenant-gil', branch: 'guadalupe' },
    ],
    reservations: [GIL_PUYAT_RESERVATION],
    requesterUserId: 'tenant-gil',
  });
  const res = await run(db, { user: { user_id: 'tenant-gil' } });
  assert.equal(res.body.length, 0);
});

test('handler: legacy announcement with missing branch field is treated as global', async () => {
  const db = fakeDb({
    announcements: [{ announcement_id: 'a-legacy', title: 'Legacy', content: 'x' }],
    reservations: [GIL_PUYAT_RESERVATION],
    requesterUserId: 'tenant-gil',
  });
  const res = await run(db, { user: { user_id: 'tenant-gil' } });
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].announcement_id, 'a-legacy');
});
