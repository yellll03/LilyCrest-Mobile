'use strict';

// MOB-P0-02 adversarial coverage for the canonical announcement-visibility
// predicate (getVisibleAnnouncementsForTenant / isAnnouncementWithinPublicationWindow
// in announcement.controller.js). This is the single function News,
// notifications, mark-read, and the chatbot's Gemini context all now share —
// see announcementVisibilitySecurity + chatbotAnnouncementIsolation for the
// full MOB-P0-02 closure. Uses the same require.cache-seeding technique as
// announcementHandlerIntegration.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return records; } };
}

const GIL_PUYAT_RESERVATION = { user_id: 'tenant-gil', branch: 'gil-puyat', status: 'approved' };

// Mirrors the exact query-level filter built by buildAnnouncementBaseQuery in
// announcement.controller.js, so this fake actually enforces the same
// query-level private-ownership/active/archived exclusion the real MongoDB
// query does — not just the branch/window post-filters under test.
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
        return { find() { return cursor(announcements.filter((doc) => matchesAnnouncementQuery(doc, requesterUserId))); } };
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
    + 'the require.cache seeding trick in announcementVisibilitySecurity.test.js only works '
    + 'if this file requires the announcement controller first. Run this file in isolation '
    + 'if it fails for this reason.',
  );
}

const {
  getVisibleAnnouncementsForTenant,
  isAnnouncementWithinPublicationWindow,
} = require('../controllers/announcement.controller');

async function visibleIds(db, user, options) {
  const docs = await getVisibleAnnouncementsForTenant(db, user, options);
  return docs.map((doc) => doc.announcement_id).sort();
}

// ── Publication window unit tests (exact boundaries) ────────────────────

test('publication window: publishedAt exactly now is visible (inclusive)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(isAnnouncementWithinPublicationWindow({ publishedAt: now }, now), true);
});

test('publication window: publishedAt one second in the future is hidden', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const future = new Date(now.getTime() + 1000);
  assert.equal(isAnnouncementWithinPublicationWindow({ publishedAt: future }, now), false);
});

test('publication window: expiresAt exactly now is hidden (exclusive)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(isAnnouncementWithinPublicationWindow({ expiresAt: now }, now), false);
});

test('publication window: expiresAt one second in the future is still visible', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const soon = new Date(now.getTime() + 1000);
  assert.equal(isAnnouncementWithinPublicationWindow({ expiresAt: soon }, now), true);
});

test('publication window: no expiresAt never expires', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(isAnnouncementWithinPublicationWindow({ publishedAt: new Date(0) }, now), true);
});

test('publication window: no publishedAt/expiresAt at all is visible (legacy announcements)', () => {
  assert.equal(isAnnouncementWithinPublicationWindow({}), true);
});

// ── Full-stack visibility matrix through getVisibleAnnouncementsForTenant ─

const NOW = new Date('2026-08-16T12:00:00.000Z');
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000);
const FUTURE = new Date(NOW.getTime() + 60 * 60 * 1000);

function fixtureSet() {
  return [
    { announcement_id: 'a-global', title: 'Global', content: 'x', publishedAt: PAST },
    { announcement_id: 'a-branch-a', title: 'Branch A only', content: 'x', branch: 'gil-puyat', publishedAt: PAST },
    { announcement_id: 'a-branch-b', title: 'Branch B only', content: 'x', branch: 'guadalupe', publishedAt: PAST },
    { announcement_id: 'a-private-mine', title: 'Private mine', content: 'x', is_private: true, user_id: 'tenant-gil', publishedAt: PAST },
    { announcement_id: 'a-private-other', title: 'Private other', content: 'x', is_private: true, user_id: 'tenant-other', publishedAt: PAST },
    { announcement_id: 'a-future', title: 'Future', content: 'x', publishedAt: FUTURE },
    { announcement_id: 'a-expired', title: 'Expired', content: 'x', publishedAt: PAST, expiresAt: PAST },
    { announcement_id: 'a-archived', title: 'Archived', content: 'x', isArchived: true, publishedAt: PAST },
  ];
}

test('tenant in Branch A sees only global, own-branch, and own-private — never other-branch, other-private, future, expired, or archived', async () => {
  const db = fakeDb({
    announcements: fixtureSet(),
    reservations: [GIL_PUYAT_RESERVATION],
    requesterUserId: 'tenant-gil',
  });
  const ids = await visibleIds(db, { user_id: 'tenant-gil' }, { now: NOW });
  assert.deepEqual(ids, ['a-branch-a', 'a-global', 'a-private-mine'].sort());
});

test('unauthenticated request sees only the global announcement', async () => {
  const db = fakeDb({ announcements: fixtureSet() });
  const ids = await visibleIds(db, null, { now: NOW });
  assert.deepEqual(ids, ['a-global']);
});

test('limit returns the newest N visible announcements, not the newest N pre-filter', async () => {
  // The most-recently-sorted docs (by find() ordering here) include several
  // that must be filtered out; limit must apply AFTER visibility filtering.
  const docs = [
    { announcement_id: 'a-future-1', title: 'f1', content: 'x', publishedAt: FUTURE },
    { announcement_id: 'a-future-2', title: 'f2', content: 'x', publishedAt: FUTURE },
    { announcement_id: 'a-visible-1', title: 'v1', content: 'x', publishedAt: PAST },
    { announcement_id: 'a-visible-2', title: 'v2', content: 'x', publishedAt: PAST },
    { announcement_id: 'a-visible-3', title: 'v3', content: 'x', publishedAt: PAST },
  ];
  const db = fakeDb({ announcements: docs, requesterUserId: 'tenant-x' });
  const result = await getVisibleAnnouncementsForTenant(db, { user_id: 'tenant-x' }, { limit: 2, fetchCap: 50, now: NOW });
  assert.equal(result.length, 2);
  assert.ok(result.every((doc) => doc.announcement_id.startsWith('a-visible')));
});
