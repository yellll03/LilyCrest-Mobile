'use strict';

// Security/persistence coverage for the four destructive routes added for
// the Home-bell/News-tab split:
//   DELETE /notifications            (clearAllNotifications)
//   DELETE /notifications/:id        (dismissNotification)
//   POST   /announcements/:id/dismiss        (dismissAnnouncement)
//   POST   /announcements/dismiss-bulk       (dismissAnnouncementsBulk)
//
// Three properties matter most for routes like these: (1) tenant A can never
// affect tenant B's data, (2) a dismiss/clear never mutates or deletes the
// underlying shared record, (3) the per-tenant hide is written server-side
// so it survives a fresh install (no client-only state to lose).
//
// Uses the same require.cache-seeding technique as
// announcementHandlerIntegration.test.js / notificationHandlerIntegration.test.js
// — see those files' header comments for why. Must run in isolation if
// config/database.js was already required by an earlier test in this process.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, project() { return this; }, async toArray() { return records; } };
}

function matchesAnnouncementQuery(doc) {
  const isActive = doc.is_active === true || doc.isActive === true
    || (doc.is_active === undefined && doc.isActive === undefined);
  if (!isActive) return false;
  if (doc.isArchived === true) return false;
  return true;
}

function fakeDb({
  announcements = [], notifications = [],
  notificationReads = [], notificationReadState = [],
  notificationDismissals = [], notificationClearedState = [],
  announcementDismissals = [],
} = {}) {
  const state = {
    notificationReads: [...notificationReads],
    notificationReadState: [...notificationReadState],
    notificationDismissals: [...notificationDismissals],
    notificationClearedState: [...notificationClearedState],
    announcementDismissals: [...announcementDismissals],
  };
  return {
    _state: state,
    _announcements: announcements,
    collection(name) {
      if (name === 'announcements') {
        return {
          find() { return cursor(announcements.filter(matchesAnnouncementQuery)); },
          findOne(query) {
            const orClauses = query?.$or || [query];
            return Promise.resolve(announcements.find((doc) => orClauses.some((clause) => (
              (clause.announcement_id !== undefined && doc.announcement_id === clause.announcement_id)
              || (clause._id !== undefined && String(doc._id) === String(clause._id))
            ))) || null);
          },
          countDocuments(query) {
            const orClauses = query?.$or || [];
            const matched = new Set();
            announcements.forEach((doc, index) => {
              if (orClauses.some((clause) => (
                (clause.announcement_id !== undefined && doc.announcement_id === clause.announcement_id)
                || (clause._id !== undefined && String(doc._id) === String(clause._id))
              ))) matched.add(index);
            });
            return Promise.resolve(matched.size);
          },
        };
      }
      if (name === 'reservations') {
        return { find() { return cursor([]); } };
      }
      if (name === 'notifications') {
        return {
          find(query) { return cursor(notifications.filter((doc) => doc.user_id === query.user_id)); },
          async updateMany(query, update) {
            notifications.forEach((doc) => {
              if (doc.user_id === query.user_id) Object.assign(doc, update.$set);
            });
          },
        };
      }
      if (name === 'notification_reads') {
        return {
          find(query) { return { project() { return this; }, async toArray() { return state.notificationReads.filter((r) => r.user_id === query.user_id); } }; },
          async updateOne(filter, update) {
            const existing = state.notificationReads.find((r) => r.user_id === filter.user_id && r.notification_key === filter.notification_key);
            if (existing) Object.assign(existing, update.$set);
            else state.notificationReads.push({ ...filter, ...update.$set });
          },
        };
      }
      if (name === 'notification_read_state') {
        return {
          async findOne(query) { return state.notificationReadState.find((r) => r.user_id === query.user_id) || null; },
          async updateOne(filter, update) {
            const existing = state.notificationReadState.find((r) => r.user_id === filter.user_id);
            if (existing) Object.assign(existing, update.$set);
            else state.notificationReadState.push({ ...filter, ...update.$set });
          },
        };
      }
      if (name === 'notification_dismissals') {
        return {
          find(query) { return { project() { return this; }, async toArray() { return state.notificationDismissals.filter((r) => r.user_id === query.user_id); } }; },
          async updateOne(filter, update) {
            const existing = state.notificationDismissals.find((r) => r.user_id === filter.user_id && r.notification_key === filter.notification_key);
            if (existing) Object.assign(existing, update.$set);
            else state.notificationDismissals.push({ ...filter, ...update.$set });
          },
        };
      }
      if (name === 'notification_cleared_state') {
        return {
          async findOne(query) { return state.notificationClearedState.find((r) => r.user_id === query.user_id) || null; },
          async updateOne(filter, update) {
            const existing = state.notificationClearedState.find((r) => r.user_id === filter.user_id);
            if (existing) Object.assign(existing, update.$set);
            else state.notificationClearedState.push({ ...filter, ...update.$set });
          },
        };
      }
      if (name === 'announcement_dismissals') {
        return {
          find(query) { return { project() { return this; }, async toArray() { return state.announcementDismissals.filter((r) => r.user_id === query.user_id); } }; },
          async updateOne(filter, update) {
            const existing = state.announcementDismissals.find((r) => r.user_id === filter.user_id && r.announcement_id === filter.announcement_id);
            if (existing) { Object.assign(existing, update.$set); return { upsertedCount: 0 }; }
            state.announcementDismissals.push({ ...filter, ...update.$set, ...(update.$setOnInsert || {}) });
            return { upsertedCount: 1 };
          },
          async bulkWrite(operations) {
            operations.forEach(({ updateOne: { filter, update } }) => {
              const existing = state.announcementDismissals.find((r) => r.user_id === filter.user_id && r.announcement_id === filter.announcement_id);
              if (existing) Object.assign(existing, update.$set);
              else state.announcementDismissals.push({ ...filter, ...update.$set, ...(update.$setOnInsert || {}) });
            });
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
    + 'run this file in isolation if it fails for this reason.',
  );
}

const {
  getMyNotifications, dismissNotification, clearAllNotifications,
} = require('../controllers/notification.controller');
const {
  getAllAnnouncements, dismissAnnouncement, dismissAnnouncementsBulk,
} = require('../controllers/announcement.controller');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function run(handler, db, req) {
  currentDb = db;
  const res = fakeRes();
  const request = req.user ? { ...req, user: { role: 'tenant', ...req.user } } : req;
  await handler(request, res);
  return res;
}

// ── DELETE /notifications/:id — cross-tenant protection ──

test('dismissNotification: 404s for a notification that does not belong to the caller, and does not remove it from the real owner\'s feed', async () => {
  const db = fakeDb({
    notifications: [{ notification_id: 'n1', user_id: 'tenant-other', title: 'Not mine', created_at: new Date() }],
  });
  const res = await run(dismissNotification, db, { user: { user_id: 'tenant-attacker' }, params: { notificationId: 'n1' } });
  assert.equal(res.statusCode, 404);

  const asOwner = await run(getMyNotifications, db, { user: { user_id: 'tenant-other' } });
  assert.deepEqual(asOwner.body.map((n) => n.notification_id), ['n1'], 'the real owner must still see their notification untouched');
});

test('dismissNotification: hides only the caller\'s own notification, scoped from req.user (never a body/query field)', async () => {
  const db = fakeDb({
    notifications: [
      { notification_id: 'n1', user_id: 'tenant-gil', title: 'Mine', created_at: new Date() },
    ],
  });
  // Even if a malicious client tried to smuggle a different user_id in, the
  // handler never reads req.body/req.query — only req.params.notificationId
  // and req.user.user_id (the authenticated identity) are consulted.
  const res = await run(dismissNotification, db, {
    user: { user_id: 'tenant-gil' },
    params: { notificationId: 'n1' },
    body: { user_id: 'tenant-other' },
    query: { user_id: 'tenant-other' },
  });
  assert.equal(res.statusCode, 200);

  const follow = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.deepEqual(follow.body, [], 'dismissed notification must no longer appear for the caller');
});

// ── DELETE /notifications — clear-all scope ──

test('clearAllNotifications: clears only the authenticated tenant\'s feed, leaves other tenants untouched', async () => {
  const now = new Date();
  const db = fakeDb({
    notifications: [
      { notification_id: 'a1', user_id: 'tenant-gil', title: 'Mine', created_at: now },
      { notification_id: 'b1', user_id: 'tenant-other', title: 'Not mine', created_at: now },
    ],
  });
  const res = await run(clearAllNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.equal(res.statusCode, 200);

  const mine = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.deepEqual(mine.body, [], 'clear-all must remove everything from the caller\'s own feed');

  const theirs = await run(getMyNotifications, db, { user: { user_id: 'tenant-other' } });
  assert.deepEqual(theirs.body.map((n) => n.notification_id), ['b1'], 'another tenant\'s feed must be completely unaffected');
});

// ── Reinstall / fresh-login persistence ──

test('notification_cleared_state persists server-side: a fresh GET after "reinstall" (no client state) still reflects the clear', async () => {
  const now = new Date();
  const db = fakeDb({
    notifications: [{ notification_id: 'n1', user_id: 'tenant-gil', title: 'Mine', created_at: now }],
  });
  await run(clearAllNotifications, db, { user: { user_id: 'tenant-gil' } });

  // Simulate a fresh install + login: a brand new request carrying nothing
  // but the authenticated identity, no prior client-side state at all.
  const freshInstall = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.deepEqual(freshInstall.body, [], 'clear-all must survive a stateless re-fetch, proving it is server-persisted');
});

// ── POST /announcements/:id/dismiss — content safety + idempotency ──

test('dismissAnnouncement: never mutates or deletes the shared announcement, and other tenants still see it', async () => {
  const announcement = { announcement_id: 'ann_1', title: 'Fire drill', content: 'Friday 3pm', is_active: true, created_at: new Date() };
  const db = fakeDb({ announcements: [announcement] });
  const before = JSON.stringify(announcement);

  const res = await run(dismissAnnouncement, db, { user: { user_id: 'tenant-gil' }, params: { announcementId: 'ann_1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(announcement), before, 'the shared announcement document must be byte-for-byte unchanged');

  const asOtherTenant = await run(getAllAnnouncements, db, { user: { user_id: 'tenant-other' } });
  assert.deepEqual(asOtherTenant.body.map((a) => a.announcement_id), ['ann_1'], 'a different tenant must still see the announcement');

  const asDismisser = await run(getAllAnnouncements, db, { user: { user_id: 'tenant-gil' } });
  assert.deepEqual(asDismisser.body, [], 'the dismissing tenant must no longer see it');
});

test('dismissAnnouncement: idempotent — dismissing an already-dismissed announcement does not error or duplicate', async () => {
  const db = fakeDb({ announcements: [{ announcement_id: 'ann_1', title: 'x', content: 'x', is_active: true, created_at: new Date() }] });

  const first = await run(dismissAnnouncement, db, { user: { user_id: 'tenant-gil' }, params: { announcementId: 'ann_1' } });
  assert.equal(first.statusCode, 200);
  const second = await run(dismissAnnouncement, db, { user: { user_id: 'tenant-gil' }, params: { announcementId: 'ann_1' } });
  assert.equal(second.statusCode, 200);

  assert.equal(db._state.announcementDismissals.length, 1, 'must not create a duplicate dismissal row');
});

test('dismissAnnouncement: 404s for an announcement that does not exist (no dismissal row written)', async () => {
  const db = fakeDb({ announcements: [] });
  const res = await run(dismissAnnouncement, db, { user: { user_id: 'tenant-gil' }, params: { announcementId: 'ann_ghost' } });
  assert.equal(res.statusCode, 404);
  assert.equal(db._state.announcementDismissals.length, 0);
});

// ── POST /announcements/dismiss-bulk — validation + idempotency ──

test('dismissAnnouncementsBulk: rejects the whole batch on one malformed id (no partial writes)', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'ann_aaaaaaaaaaaa', title: 'Valid', content: 'x', is_active: true, created_at: new Date() },
    ],
  });
  const res = await run(dismissAnnouncementsBulk, db, {
    user: { user_id: 'tenant-gil' },
    body: { ids: ['ann_aaaaaaaaaaaa', '<script>alert(1)</script>'] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(db._state.announcementDismissals.length, 0, 'the well-formed id must not have been partially applied');
});

test('dismissAnnouncementsBulk: rejects ids that don\'t match an existing announcement', async () => {
  const db = fakeDb({ announcements: [] });
  const res = await run(dismissAnnouncementsBulk, db, {
    user: { user_id: 'tenant-gil' },
    body: { ids: ['ann_aaaaaaaaaaaa'] },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(db._state.announcementDismissals.length, 0);
});

test('dismissAnnouncementsBulk: caps at 100 ids', async () => {
  const db = fakeDb({ announcements: [] });
  const ids = Array.from({ length: 101 }, (_, i) => `ann_${String(i).padStart(12, '0')}`);
  const res = await run(dismissAnnouncementsBulk, db, { user: { user_id: 'tenant-gil' }, body: { ids } });
  assert.equal(res.statusCode, 400);
});

test('dismissAnnouncementsBulk: idempotent and scoped to the caller only', async () => {
  const announcements = [
    { announcement_id: 'ann_aaaaaaaaaaaa', title: 'A', content: 'x', is_active: true, created_at: new Date() },
    { announcement_id: 'ann_bbbbbbbbbbbb', title: 'B', content: 'x', is_active: true, created_at: new Date() },
  ];
  const db = fakeDb({ announcements });
  const ids = ['ann_aaaaaaaaaaaa', 'ann_bbbbbbbbbbbb'];

  const first = await run(dismissAnnouncementsBulk, db, { user: { user_id: 'tenant-gil' }, body: { ids } });
  assert.equal(first.statusCode, 200);
  const second = await run(dismissAnnouncementsBulk, db, { user: { user_id: 'tenant-gil' }, body: { ids } });
  assert.equal(second.statusCode, 200);
  assert.equal(db._state.announcementDismissals.length, 2, 'repeating the same bulk dismiss must not duplicate rows');

  const asOtherTenant = await run(getAllAnnouncements, db, { user: { user_id: 'tenant-other' } });
  assert.equal(asOtherTenant.body.length, 2, 'another tenant must still see both announcements');
});

// ── Route registration: auth middleware must be present on every new route ──

test('route registration: all four new routes require authMiddleware (and tenantMiddleware where applicable)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const notificationRoutesSrc = fs.readFileSync(path.join(__dirname, '../routes/notification.routes.js'), 'utf8');
  const announcementRoutesSrc = fs.readFileSync(path.join(__dirname, '../routes/announcement.routes.js'), 'utf8');

  assert.match(
    announcementRoutesSrc,
    /router\.get\(\s*'\/'\s*,\s*authMiddleware\s*,\s*tenantMiddleware\s*,\s*announcementController\.getAllAnnouncements\s*\)/,
    'GET /announcements must require an authenticated tenant identity',
  );

  assert.match(
    notificationRoutesSrc,
    /router\.delete\(\s*'\/'\s*,\s*authMiddleware\s*,\s*tenantMiddleware\s*,\s*notificationController\.clearAllNotifications\s*\)/,
    'DELETE /notifications must require authMiddleware + tenantMiddleware',
  );
  assert.match(
    notificationRoutesSrc,
    /router\.delete\(\s*'\/:notificationId'\s*,\s*authMiddleware\s*,\s*tenantMiddleware\s*,\s*notificationController\.dismissNotification\s*\)/,
    'DELETE /notifications/:notificationId must require authMiddleware + tenantMiddleware',
  );
  assert.match(
    announcementRoutesSrc,
    /router\.post\(\s*'\/dismiss-bulk'\s*,\s*authMiddleware\s*,\s*tenantMiddleware\s*,\s*announcementController\.dismissAnnouncementsBulk\s*\)/,
    'POST /announcements/dismiss-bulk must require authMiddleware + tenantMiddleware',
  );
  assert.match(
    announcementRoutesSrc,
    /router\.post\(\s*'\/:announcementId\/dismiss'\s*,\s*authMiddleware\s*,\s*tenantMiddleware\s*,\s*announcementController\.dismissAnnouncement\s*\)/,
    'POST /announcements/:announcementId/dismiss must require authMiddleware + tenantMiddleware',
  );
});
