'use strict';

// Handler-level test for the notification endpoints (GET /notifications,
// PATCH /notifications/:id/read, PATCH /notifications/read-all).
//
// Two things are under test that were NOT true before this phase:
//  1. getMyNotifications must apply the same branch-visibility rule
//     GET /announcements applies — otherwise a branch-restricted announcement
//     hidden from the Announcements screen could still leak through as a
//     "notification" for a tenant in a different branch.
//  2. Read state (single mark-read and mark-all-read) must be ownership-
//     scoped by the authenticated user, never a client-supplied id.
//
// Uses the same require.cache-seeding technique as
// announcementHandlerIntegration.test.js — see that file's header comment
// for why. Must run in isolation if config/database.js was already required
// by an earlier test in this process.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/database');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return records; } };
}

const GIL_PUYAT_RESERVATION = { user_id: 'tenant-gil', branch: 'gil-puyat', status: 'approved' };
const GUADALUPE_RESERVATION = { user_id: 'tenant-gu', branch: 'guadalupe', status: 'approved' };

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

function fakeDb({
  announcements = [], reservations = [], notifications = [],
  notificationReads = [], notificationReadState = [], requesterUserId = null,
} = {}) {
  const state = { notificationReads: [...notificationReads], notificationReadState: [...notificationReadState] };
  return {
    _state: state,
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
    + 'the require.cache seeding trick in notificationHandlerIntegration.test.js only works '
    + 'if this file requires the notification controller first. Run this file in isolation '
    + 'if it fails for this reason.',
  );
}

const { getMyNotifications, markNotificationRead, markAllNotificationsRead } = require('../controllers/notification.controller');

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
  await handler(req, res);
  return res;
}

test('getMyNotifications: hides a branch-restricted announcement from a tenant in a different branch', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-global', title: 'Global', content: 'x', created_at: new Date() },
      { announcement_id: 'a-gp', title: 'Gil Puyat only', content: 'x', branch: 'gil-puyat', created_at: new Date() },
    ],
    reservations: [GUADALUPE_RESERVATION],
    requesterUserId: 'tenant-gu',
  });
  const res = await run(getMyNotifications, db, { user: { user_id: 'tenant-gu' } });
  assert.equal(res.statusCode, 200);
  const ids = res.body.map((n) => n.announcement_id);
  assert.deepEqual(ids, ['a-global'], 'the gil-puyat-only announcement must not leak as a notification for a guadalupe tenant');
});

test('getMyNotifications: shows a branch-restricted announcement to a tenant in the matching branch', async () => {
  const db = fakeDb({
    announcements: [
      { announcement_id: 'a-gp', title: 'Gil Puyat only', content: 'x', branch: 'gil-puyat', created_at: new Date() },
    ],
    reservations: [GIL_PUYAT_RESERVATION],
    requesterUserId: 'tenant-gil',
  });
  const res = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.deepEqual(res.body.map((n) => n.announcement_id), ['a-gp']);
});

test('getMyNotifications: only returns the requesting user’s own stored notifications, never another user’s', async () => {
  const db = fakeDb({
    notifications: [
      { notification_id: 'n1', user_id: 'tenant-gil', title: 'Mine', created_at: new Date() },
      { notification_id: 'n2', user_id: 'tenant-other', title: 'Not mine', created_at: new Date() },
    ],
  });
  const res = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  const ids = res.body.map((n) => n.notification_id);
  assert.deepEqual(ids, ['n1']);
});

test('getMyNotifications: read state reflects a per-notification read receipt', async () => {
  // dedup_key (sourced from event_key) is the notification's dedup/read-receipt
  // key when present — seed the receipt under that same key, mirroring how
  // markNotificationRead actually persists it (buildNotificationKey(item),
  // not the raw notification_id).
  const db = fakeDb({
    notifications: [
      { notification_id: 'n1', event_key: 'evt-n1', user_id: 'tenant-gil', title: 'Read me', created_at: new Date() },
      { notification_id: 'n2', event_key: 'evt-n2', user_id: 'tenant-gil', title: 'Still unread', created_at: new Date() },
    ],
    notificationReads: [{ user_id: 'tenant-gil', notification_key: 'evt-n1' }],
  });
  const res = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  const byId = Object.fromEntries(res.body.map((n) => [n.notification_id, n.read]));
  assert.equal(byId.n1, true);
  assert.equal(byId.n2, false);
});

test('getMyNotifications: read state reflects an all_read_at cutoff for everything created before it', async () => {
  const now = new Date();
  const past = new Date(now.getTime() - 60 * 60 * 1000);
  const future = new Date(now.getTime() + 60 * 60 * 1000);
  const db = fakeDb({
    notifications: [
      { notification_id: 'old', user_id: 'tenant-gil', title: 'Old', created_at: past },
      { notification_id: 'new', user_id: 'tenant-gil', title: 'New', created_at: future },
    ],
    notificationReadState: [{ user_id: 'tenant-gil', all_read_at: now }],
  });
  const res = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  const byId = Object.fromEntries(res.body.map((n) => [n.notification_id, n.read]));
  assert.equal(byId.old, true, 'created before the all_read_at cutoff must be read');
  assert.equal(byId.new, false, 'created after the all_read_at cutoff must remain unread');
});

test('markNotificationRead: marks the caller’s own notification read and is idempotent', async () => {
  const db = fakeDb({
    notifications: [{ notification_id: 'n1', user_id: 'tenant-gil', title: 'Mine', created_at: new Date() }],
  });
  const res = await run(markNotificationRead, db, { user: { user_id: 'tenant-gil' }, params: { notificationId: 'n1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'read');

  const follow = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.equal(follow.body.find((n) => n.notification_id === 'n1').read, true);
});

test('markNotificationRead: 404s for a notification that does not belong to the caller (no cross-tenant marking by guessed id)', async () => {
  const db = fakeDb({
    notifications: [{ notification_id: 'n1', user_id: 'tenant-other', title: 'Not mine', created_at: new Date() }],
  });
  const res = await run(markNotificationRead, db, { user: { user_id: 'tenant-gil' }, params: { notificationId: 'n1' } });
  assert.equal(res.statusCode, 404);

  // Confirm the other tenant's notification was NOT mutated as a side effect.
  const asOwner = await run(getMyNotifications, db, { user: { user_id: 'tenant-other' } });
  assert.equal(asOwner.body.find((n) => n.notification_id === 'n1').read, false);
});

test('markAllNotificationsRead: marks only the caller’s own notifications read, leaves other users untouched', async () => {
  const db = fakeDb({
    notifications: [
      { notification_id: 'n1', user_id: 'tenant-gil', title: 'Mine 1', created_at: new Date() },
      { notification_id: 'n2', user_id: 'tenant-gil', title: 'Mine 2', created_at: new Date() },
      { notification_id: 'n3', user_id: 'tenant-other', title: 'Not mine', created_at: new Date() },
    ],
  });
  const res = await run(markAllNotificationsRead, db, { user: { user_id: 'tenant-gil' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'all_read');

  const mine = await run(getMyNotifications, db, { user: { user_id: 'tenant-gil' } });
  assert.ok(mine.body.every((n) => n.read === true));

  const theirs = await run(getMyNotifications, db, { user: { user_id: 'tenant-other' } });
  assert.equal(theirs.body.find((n) => n.notification_id === 'n3').read, false);
});
