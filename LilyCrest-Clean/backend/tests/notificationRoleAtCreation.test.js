'use strict';

// Applicant and tenant share the same user_id, so a notification created
// while someone was still an applicant remains attached to the same account
// after approval with nothing distinguishing it. This stamps the account's
// role at creation time so future lifecycle-aware notification handling
// (Phase 12/13 of the mobile audit) has real data instead of nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNotificationDocument,
  sanitizeStoredNotification,
  saveNotificationForUser,
} = require('../services/notificationService');

test('buildNotificationDocument stamps role_at_creation when explicitly supplied', () => {
  const doc = buildNotificationDocument('user-1', {
    title: 'Application approved',
    role_at_creation: 'applicant',
  });
  assert.equal(doc.role_at_creation, 'applicant');
});

test('buildNotificationDocument omits role_at_creation when not supplied', () => {
  const doc = buildNotificationDocument('user-1', { title: 'Rent due' });
  assert.equal('role_at_creation' in doc, false);
});

test('sanitizeStoredNotification surfaces role_at_creation to the client', () => {
  const sanitized = sanitizeStoredNotification({
    notification_id: 'n1',
    title: 'Application approved',
    role_at_creation: 'applicant',
  });
  assert.equal(sanitized.role_at_creation, 'applicant');
});

test('sanitizeStoredNotification defaults role_at_creation to empty string for older records', () => {
  const sanitized = sanitizeStoredNotification({ notification_id: 'n1', title: 'Rent due' });
  assert.equal(sanitized.role_at_creation, '');
});

test('saveNotificationForUser looks up and stamps the account role when the caller does not supply one', async () => {
  const stored = [];
  const fakeDb = {
    collection(name) {
      if (name === 'users') {
        return {
          async findOne() { return { role: 'tenant' }; },
        };
      }
      if (name === 'notifications') {
        return {
          async insertOne(doc) { stored.push(doc); return { insertedId: 'x' }; },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  const doc = await saveNotificationForUser('user-1', { title: 'Rent due' }, { db: fakeDb });

  assert.equal(doc.role_at_creation, 'tenant');
  assert.equal(stored[0].role_at_creation, 'tenant');
});

test('saveNotificationForUser still saves the notification if the role lookup fails', async () => {
  const stored = [];
  const fakeDb = {
    collection(name) {
      if (name === 'users') {
        return {
          async findOne() { throw new Error('mongo unavailable'); },
        };
      }
      if (name === 'notifications') {
        return {
          async insertOne(doc) { stored.push(doc); return { insertedId: 'x' }; },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  const doc = await saveNotificationForUser('user-1', { title: 'Rent due' }, { db: fakeDb });

  assert.equal('role_at_creation' in doc, false);
  assert.equal(stored.length, 1, 'the notification must still be saved despite the failed role lookup');
});
