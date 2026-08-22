'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterAnnouncementsForTenant,
  filterStoredNotificationsForTenant,
  isAnnouncementLifecycleVisible,
  resolveAnnouncementRecipientUsers,
} = require('../services/announcementAudience.service');
const { notifyNewAnnouncement } = require('../services/pushService');

const NOW = new Date('2026-08-22T12:00:00.000Z');
const BRANCH_A = 'gil-puyat';
const BRANCH_B = 'guadalupe';

const USERS = [
  { user_id: 'tenant-a-target', role: 'tenant', is_active: true },
  { user_id: 'tenant-a-other', role: 'tenant', is_active: true },
  { user_id: 'tenant-b', role: 'tenant', is_active: true },
  { user_id: 'tenant-unresolved', role: 'tenant', is_active: true },
  { user_id: 'tenant-conflict', role: 'tenant', is_active: true },
  { user_id: 'tenant-disabled', role: 'tenant', is_active: false },
  { user_id: 'applicant-user', role: 'applicant', is_active: true },
  { user_id: 'admin-user', role: 'admin', is_active: true },
];

const STAYS = [
  { user_id: 'tenant-a-target', branch: BRANCH_A, status: 'active' },
  { user_id: 'tenant-a-other', branch: BRANCH_A, status: 'active' },
  { user_id: 'tenant-b', branch: BRANCH_B, status: 'active' },
  { user_id: 'tenant-disabled', branch: BRANCH_A, status: 'active' },
  { user_id: 'tenant-conflict', branch: BRANCH_A, status: 'active' },
  { user_id: 'tenant-conflict', branch: BRANCH_B, status: 'active' },
];

const BRANCHES = [
  { branchId: 'BRANCH_GIL_PUYAT', branchCode: BRANCH_A, branchName: 'Gil Puyat', branchAddress: 'A', googleMapsUrl: 'https://maps/a', isActive: true },
  { branchId: 'BRANCH_GUADALUPE', branchCode: BRANCH_B, branchName: 'Guadalupe', branchAddress: 'B', googleMapsUrl: 'https://maps/b', isActive: true },
];

function comparable(value) {
  if (value instanceof RegExp) return value;
  if (value && typeof value === 'object' && value.constructor?.name === 'ObjectId') return String(value);
  return value;
}

function matchesQuery(doc, query) {
  if (!query || typeof query !== 'object') return true;
  if (Array.isArray(query.$and) && !query.$and.every((entry) => matchesQuery(doc, entry))) return false;
  if (Array.isArray(query.$or) && !query.$or.some((entry) => matchesQuery(doc, entry))) return false;

  return Object.entries(query).every(([field, condition]) => {
    if (field === '$and' || field === '$or') return true;
    const value = doc[field];
    if (condition instanceof RegExp) return condition.test(String(value || ''));
    if (condition && typeof condition === 'object' && condition.constructor?.name !== 'ObjectId') {
      if ('$ne' in condition && value === condition.$ne) return false;
      if ('$exists' in condition && condition.$exists !== (value !== undefined)) return false;
      if ('$in' in condition && !condition.$in.some((candidate) => String(comparable(candidate)) === String(comparable(value)))) return false;
      if ('$nin' in condition && condition.$nin.some((candidate) => String(comparable(candidate)) === String(comparable(value)))) return false;
      return true;
    }
    return String(comparable(value)) === String(comparable(condition));
  });
}

function cursor(records) {
  return {
    sort() { return this; },
    limit(value) { this.records = (this.records || records).slice(0, value); return this; },
    project() { return this; },
    async toArray() { return [...(this.records || records)]; },
  };
}

function fakeDb({ announcements = [], users = USERS, stays = STAYS } = {}) {
  const notificationRows = [];
  const fixtures = {
    announcements,
    users,
    stays,
    branches: BRANCHES,
    reservations: [],
    roomoccupancyhistories: [],
    room_assignments: [],
    bedhistories: [],
    rooms: [],
  };

  return {
    _notifications: notificationRows,
    collection(name) {
      if (name === 'notifications') {
        return {
          async updateOne(filter, update) {
            const existing = notificationRows.find((row) => matchesQuery(row, filter));
            if (existing) Object.assign(existing, update.$set || {});
            else notificationRows.push({ ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) });
          },
        };
      }
      const records = fixtures[name] || [];
      return {
        find(query) { return cursor(records.filter((record) => matchesQuery(record, query))); },
        async findOne(query) { return records.find((record) => matchesQuery(record, query)) || null; },
      };
    },
  };
}

const ANNOUNCEMENTS = [
  { announcement_id: 'ann_global', title: 'Global', is_active: true, publishedAt: new Date('2026-08-20T00:00:00Z') },
  { announcement_id: 'ann_a', title: 'Branch A', branch: BRANCH_A, is_active: true },
  { announcement_id: 'ann_b', title: 'Branch B', branch: BRANCH_B, is_active: true },
  { announcement_id: 'ann_private_a', title: 'Private A', is_private: true, user_id: 'tenant-a-target', is_active: true },
  { announcement_id: 'ann_private_a_branch', title: 'Private A branch', is_private: true, user_id: 'tenant-a-target', branch: BRANCH_A, is_active: true },
  { announcement_id: 'ann_private_wrong_branch', title: 'Private wrong branch', is_private: true, user_id: 'tenant-a-target', branch: BRANCH_B, is_active: true },
  { announcement_id: 'ann_future', title: 'Future', is_active: true, publishedAt: new Date('2026-08-23T00:00:00Z') },
  { announcement_id: 'ann_expired', title: 'Expired', is_active: true, expiresAt: new Date('2026-08-22T11:59:59Z') },
  { announcement_id: 'ann_archived', title: 'Archived', is_active: true, isArchived: true },
];

async function visibleIds(db, user) {
  const visible = await filterAnnouncementsForTenant(db, user, ANNOUNCEMENTS, { now: NOW });
  return visible.map((announcement) => announcement.announcement_id).sort();
}

test('canonical visibility matrix enforces identity, branch, private recipient, schedule, expiry, and lifecycle together', async () => {
  const db = fakeDb({ announcements: ANNOUNCEMENTS });

  assert.deepEqual(await visibleIds(db, USERS[0]), [
    'ann_a', 'ann_global', 'ann_private_a', 'ann_private_a_branch',
  ].sort());
  assert.deepEqual(await visibleIds(db, USERS[1]), ['ann_a', 'ann_global'].sort());
  assert.deepEqual(await visibleIds(db, USERS[2]), ['ann_b', 'ann_global'].sort());
  assert.deepEqual(await visibleIds(db, USERS[3]), ['ann_global']);
  assert.deepEqual(await visibleIds(db, USERS[4]), ['ann_global']);
  assert.deepEqual(await visibleIds(db, USERS[6]), []);
  assert.deepEqual(await visibleIds(db, null), []);
});

test('invalid or conflicting lifecycle/branch metadata fails closed', async () => {
  const db = fakeDb();
  const invalid = [
    { announcement_id: 'bad-date', publishedAt: 'not-a-date' },
    { announcement_id: 'conflicting-branch', branch: BRANCH_A, branchId: BRANCH_B },
    { announcement_id: 'conflicting-private-target', is_private: true, user_id: 'tenant-a-target', userId: 'tenant-a-other' },
    { announcement_id: 'inactive', is_active: false },
    { announcement_id: 'legacy-string-inactive', isActive: 'false' },
    { announcement_id: 'legacy-string-archived', isArchived: 'true' },
    { announcement_id: 'archived-at', archivedAt: NOW },
  ];
  assert.equal(isAnnouncementLifecycleVisible(invalid[0], NOW), false);
  assert.deepEqual(await filterAnnouncementsForTenant(db, USERS[0], invalid, { now: NOW }), []);
});

test('push-recipient resolution selects only eligible active tenants', async () => {
  const db = fakeDb();
  const byTitle = Object.fromEntries(ANNOUNCEMENTS.map((announcement) => [announcement.title, announcement]));
  const ids = async (announcement) => (await resolveAnnouncementRecipientUsers(db, announcement, { now: NOW }))
    .map((user) => user.user_id).sort();

  assert.deepEqual(await ids(byTitle['Branch A']), ['tenant-a-other', 'tenant-a-target']);
  assert.deepEqual(await ids(byTitle['Branch B']), ['tenant-b']);
  assert.deepEqual(await ids(byTitle['Private A']), ['tenant-a-target']);
  assert.deepEqual(await ids(byTitle['Private A branch']), ['tenant-a-target']);
  assert.deepEqual(await ids(byTitle['Private wrong branch']), []);
  assert.deepEqual(await ids(byTitle.Future), []);
  assert.deepEqual(await ids(byTitle.Expired), []);
});

test('stored announcement notifications are hidden unless their source is currently visible', async () => {
  const db = fakeDb({ announcements: ANNOUNCEMENTS });
  const rows = [
    { notification_id: 'system', user_id: 'tenant-b', source: 'system', type: 'billing' },
    ...ANNOUNCEMENTS.map((announcement) => ({
      notification_id: `n-${announcement.announcement_id}`,
      user_id: 'tenant-b',
      source: 'announcement',
      type: 'announcement',
      announcement_id: announcement.announcement_id,
    })),
    { notification_id: 'orphan', user_id: 'tenant-b', source: 'announcement', type: 'announcement', announcement_id: 'missing' },
  ];
  const filtered = await filterStoredNotificationsForTenant(db, USERS[2], rows, { now: NOW });
  assert.deepEqual(filtered.map((row) => row.notification_id).sort(), [
    'n-ann_b', 'n-ann_global', 'system',
  ].sort());
});

test('announcement delivery persists rows only for the same canonical recipient set used by push', async () => {
  const db = fakeDb();
  await notifyNewAnnouncement(db, ANNOUNCEMENTS.find((announcement) => announcement.announcement_id === 'ann_a'));
  assert.deepEqual(db._notifications.map((row) => row.user_id).sort(), ['tenant-a-other', 'tenant-a-target']);
  assert.ok(db._notifications.every((row) => row.announcement_id === 'ann_a'));

  const before = db._notifications.length;
  await notifyNewAnnouncement(db, { announcement_id: 'ann_future_delivery', title: 'Future delivery', publishedAt: new Date('2099-01-01T00:00:00Z') });
  assert.equal(db._notifications.length, before, 'future content must not create stored notifications or push recipients');
});
