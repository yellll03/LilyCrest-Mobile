'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pushPath = require.resolve('../services/pushService');
let deliveryCalls = 0;
let deliveryFailure = null;
require.cache[pushPath] = {
  id: pushPath,
  filename: pushPath,
  loaded: true,
  exports: {
    notifyNewAnnouncement: async () => {
      deliveryCalls += 1;
      if (deliveryFailure) throw deliveryFailure;
      return 3;
    },
  },
};

const {
  deliverAnnouncementById,
  runAnnouncementDeliverySweep,
} = require('../services/announcementDelivery.service');

function getPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, dottedPath, value) {
  const parts = dottedPath.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((current, part) => {
    current[part] = current[part] && typeof current[part] === 'object' ? current[part] : {};
    return current[part];
  }, object);
  parent[leaf] = value;
}

function unsetPath(object, dottedPath) {
  const parts = dottedPath.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((value, key) => value?.[key], object);
  if (parent) delete parent[leaf];
}

function equals(left, right) {
  if (left instanceof Date || right instanceof Date) return new Date(left).getTime() === new Date(right).getTime();
  return String(left) === String(right);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((entry) => matches(doc, entry));
    if (key === '$or') return condition.some((entry) => matches(doc, entry));
    const value = getPath(doc, key);
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$in' in condition && !condition.$in.some((entry) => equals(value, entry))) return false;
      if ('$ne' in condition && equals(value, condition.$ne)) return false;
      if ('$exists' in condition) {
        const exists = value !== undefined;
        if (exists !== condition.$exists) return false;
      }
      if ('$lt' in condition && !(value instanceof Date && value < condition.$lt)) return false;
      if ('$lte' in condition && !(value instanceof Date && value <= condition.$lte)) return false;
      if ('$gt' in condition && !(value instanceof Date && value > condition.$gt)) return false;
      return true;
    }
    return equals(value, condition);
  });
}

function applyUpdate(doc, update) {
  for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
  for (const [key, amount] of Object.entries(update.$inc || {})) {
    setPath(doc, key, Number(getPath(doc, key) || 0) + Number(amount));
  }
  for (const key of Object.keys(update.$unset || {})) unsetPath(doc, key);
}

function fakeDb(documents) {
  const collection = {
    async findOne(filter) {
      const found = documents.find((doc) => matches(doc, filter));
      return found ? { ...found, delivery: found.delivery ? { ...found.delivery } : undefined } : null;
    },
    async findOneAndUpdate(filter, update) {
      const found = documents.find((doc) => matches(doc, filter));
      if (!found) return null;
      applyUpdate(found, update);
      return { ...found, delivery: { ...found.delivery } };
    },
    async updateOne(filter, update) {
      const found = documents.find((doc) => matches(doc, filter));
      if (!found) return { matchedCount: 0 };
      applyUpdate(found, update);
      return { matchedCount: 1 };
    },
    find(filter) {
      const found = documents.filter((doc) => matches(doc, filter));
      return {
        sort() { return this; },
        limit(max) { this.max = max; return this; },
        async toArray() { return found.slice(0, this.max || found.length).map((doc) => ({ ...doc })); },
      };
    },
  };
  return { collection: () => collection };
}

function announcement(overrides = {}) {
  return {
    announcement_id: 'ann_delivery_1',
    title: 'Scheduled notice',
    content: 'Message',
    is_active: true,
    publishedAt: new Date('2026-08-22T10:00:00Z'),
    expiresAt: new Date('2026-08-23T10:00:00Z'),
    delivery: { status: 'scheduled', attempts: 0 },
    ...overrides,
  };
}

test.beforeEach(() => {
  deliveryCalls = 0;
  deliveryFailure = null;
});

test('a future announcement is not delivered before its publish time', async () => {
  const docs = [announcement()];
  const result = await deliverAnnouncementById(fakeDb(docs), 'ann_delivery_1', {
    now: new Date('2026-08-22T09:59:59Z'),
  });
  assert.equal(result.claimed, false);
  assert.equal(deliveryCalls, 0);
  assert.equal(docs[0].delivery.status, 'scheduled');
});

test('a due announcement is delivered once and a duplicate sweep is idempotent', async () => {
  const docs = [announcement()];
  const db = fakeDb(docs);
  const now = new Date('2026-08-22T10:00:00Z');
  const first = await deliverAnnouncementById(db, 'ann_delivery_1', { now });
  const duplicate = await deliverAnnouncementById(db, 'ann_delivery_1', { now });

  assert.equal(first.status, 'delivered');
  assert.equal(first.recipientCount, 3);
  assert.equal(duplicate.claimed, false);
  assert.equal(deliveryCalls, 1);
  assert.equal(docs[0].delivery.status, 'delivered');
  assert.equal(docs[0].delivery.attempts, 1);
});

test('a durable notification failure remains failed and can be retried safely', async () => {
  const docs = [announcement()];
  const db = fakeDb(docs);
  const now = new Date('2026-08-22T10:00:00Z');
  deliveryFailure = new Error('notification database unavailable');
  await assert.rejects(
    deliverAnnouncementById(db, 'ann_delivery_1', { now }),
    /notification database unavailable/,
  );
  assert.equal(docs[0].delivery.status, 'failed');
  assert.equal(docs[0].delivery.attempts, 1);

  deliveryFailure = null;
  const retry = await deliverAnnouncementById(db, 'ann_delivery_1', { now: new Date(now.getTime() + 1000) });
  assert.equal(retry.status, 'delivered');
  assert.equal(docs[0].delivery.attempts, 2);
  assert.equal(deliveryCalls, 2);
});

test('the sweep processes due rows but skips expired and future rows', async () => {
  const docs = [
    announcement({ announcement_id: 'ann_due' }),
    announcement({ announcement_id: 'ann_future', publishedAt: new Date('2026-08-22T11:00:00Z') }),
    announcement({ announcement_id: 'ann_expired', expiresAt: new Date('2026-08-22T09:00:00Z') }),
  ];
  const result = await runAnnouncementDeliverySweep(fakeDb(docs), {
    now: new Date('2026-08-22T10:00:00Z'),
  });
  assert.deepEqual(result.map((entry) => entry.announcementId), ['ann_due']);
  assert.equal(deliveryCalls, 1);
});
