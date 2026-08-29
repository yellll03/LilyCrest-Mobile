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
  filterNotificationsForTenantLifecycle,
  isApplicantLifecycleNotification,
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

test('tenant lifecycle filtering hides stamped applicant history without deleting it', () => {
  const applicantNotification = {
    notification_id: 'applicant-payment',
    type: 'payment_confirmed',
    billing_id: 'reservation-payment-1',
    role_at_creation: 'applicant',
  };
  const tenantNotification = {
    notification_id: 'tenant-payment',
    type: 'payment_confirmed',
    billing_id: 'monthly-bill-1',
    role_at_creation: 'tenant',
  };
  const stored = [applicantNotification, tenantNotification];

  const visible = filterNotificationsForTenantLifecycle({ role: 'tenant' }, stored);

  assert.deepEqual(visible.map((item) => item.notification_id), ['tenant-payment']);
  assert.equal(stored.length, 2, 'filtering must not mutate or delete notification history');
});

test('legacy reservation and reservation-payment records are hidden after applicant-to-tenant transition', () => {
  const notifications = [
    { notification_id: 'reservation', type: 'reservation_update', data: { screen: 'reservation' } },
    { notification_id: 'reservation-payment', type: 'payment', data: { reservation_id: 'r-1' } },
    { notification_id: 'tenant-payment', type: 'payment_confirmed', billing_id: 'bill-1' },
  ];

  const visible = filterNotificationsForTenantLifecycle({ role: 'resident' }, notifications);

  assert.deepEqual(visible.map((item) => item.notification_id), ['tenant-payment']);
  assert.equal(isApplicantLifecycleNotification(notifications[0]), true);
  assert.equal(isApplicantLifecycleNotification(notifications[2]), false);
});

test('a stamped tenant role overrides legacy-looking copy and non-tenant feeds are unchanged', () => {
  const notification = {
    notification_id: 'move-in-bill',
    type: 'payment_confirmed',
    category: 'Reservation payment',
    billing_id: 'bill-2',
    role_at_creation: 'tenant',
  };

  assert.equal(isApplicantLifecycleNotification(notification), false);
  assert.deepEqual(
    filterNotificationsForTenantLifecycle({ role: 'tenant' }, [notification]),
    [notification],
  );
  assert.deepEqual(
    filterNotificationsForTenantLifecycle({ role: 'applicant' }, [notification]),
    [notification],
  );
});
