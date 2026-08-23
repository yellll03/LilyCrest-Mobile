'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditAnnouncementNotificationAudience } = require('../scripts/auditAnnouncementNotificationAudience');

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, project() { return this; }, async toArray() { return [...records]; } };
}

function fakeDb() {
  const state = {
    notifications: [
      { _id: 'n1', user_id: 'tenant-b', source: 'announcement', type: 'announcement', announcement_id: 'ann-a' },
      { _id: 'n2', user_id: 'tenant-a-other', source: 'announcement', type: 'announcement', announcement_id: 'ann-private-a' },
      { _id: 'n3', user_id: 'tenant-b', source: 'announcement', type: 'announcement', announcement_id: 'ann-b' },
    ],
  };
  const announcements = [
    { announcement_id: 'ann-a', branch: 'gil-puyat', is_active: true },
    { announcement_id: 'ann-private-a', branch: 'gil-puyat', is_private: true, user_id: 'tenant-a-target', is_active: true },
    { announcement_id: 'ann-b', branch: 'guadalupe', is_active: true },
  ];
  const users = [
    { user_id: 'tenant-a-target', role: 'tenant', is_active: true },
    { user_id: 'tenant-a-other', role: 'tenant', is_active: true },
    { user_id: 'tenant-b', role: 'tenant', is_active: true },
  ];
  const stays = [
    { user_id: 'tenant-a-target', branch: 'gil-puyat', status: 'active' },
    { user_id: 'tenant-a-other', branch: 'gil-puyat', status: 'active' },
    { user_id: 'tenant-b', branch: 'guadalupe', status: 'active' },
  ];

  return {
    _state: state,
    collection(name) {
      if (name === 'notifications') {
        return {
          find() { return cursor(state.notifications); },
          async deleteMany(query) {
            const ids = new Set((query?._id?.$in || []).map(String));
            const before = state.notifications.length;
            state.notifications = state.notifications.filter((row) => !ids.has(String(row._id)));
            return { deletedCount: before - state.notifications.length };
          },
        };
      }
      if (name === 'announcements') return { find() { return cursor(announcements); } };
      if (name === 'users') return { find() { return cursor(users); } };
      if (name === 'stays') {
        return {
          find(query) {
            const serialized = JSON.stringify(query);
            return cursor(stays.filter((stay) => serialized.includes(stay.user_id)));
          },
        };
      }
      if (name === 'branches') return { async findOne() { return null; } };
      return { find() { return cursor([]); }, async findOne() { return null; } };
    },
  };
}

test('notification audience audit is dry-run by default and explicit apply is idempotent', async () => {
  const db = fakeDb();
  const now = new Date('2026-08-22T12:00:00Z');

  const dryRun = await auditAnnouncementNotificationAudience(db, { now });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.scannedAnnouncementNotificationRows, 3);
  assert.equal(dryRun.affectedRows, 2);
  assert.equal(dryRun.deletedRows, 0);
  assert.equal(db._state.notifications.length, 3);

  const apply = await auditAnnouncementNotificationAudience(db, { now, apply: true });
  assert.equal(apply.affectedRows, 2);
  assert.equal(apply.deletedRows, 2);
  assert.deepEqual(db._state.notifications.map((row) => row._id), ['n3']);

  const repeated = await auditAnnouncementNotificationAudience(db, { now, apply: true });
  assert.equal(repeated.affectedRows, 0);
  assert.equal(repeated.deletedRows, 0);
});
