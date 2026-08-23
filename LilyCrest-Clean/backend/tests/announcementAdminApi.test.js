'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const dbPath = require.resolve('../config/database');
const deliveryPath = require.resolve('../services/announcementDelivery.service');
const announcements = [];
const users = [];
const reservations = [];
let deliveryCalls = 0;

function cursor(records) {
  return {
    records: [...records],
    offset: 0,
    maximum: records.length,
    sort() { return this; },
    skip(value) { this.offset = value; return this; },
    limit(value) { this.maximum = value; return this; },
    project() { return this; },
    async toArray() { return this.records.slice(this.offset, this.offset + this.maximum); },
  };
}

function simpleMatch(doc, filter = {}) {
  if (filter.$or) return filter.$or.some((part) => simpleMatch(doc, part));
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((part) => simpleMatch(doc, part));
    if (value instanceof ObjectId) return String(doc[key]) === String(value);
    return String(doc[key] || '') === String(value || '');
  });
}

function setPath(doc, dottedPath, value) {
  const parts = dottedPath.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((current, key) => {
    current[key] = current[key] && typeof current[key] === 'object' ? current[key] : {};
    return current[key];
  }, doc);
  parent[leaf] = value;
}

const db = {
  collection(name) {
    if (name === 'announcements') {
      return {
        async insertOne(doc) {
          doc._id = doc._id || new ObjectId();
          announcements.push(doc);
          return { insertedId: doc._id };
        },
        async findOne(filter) {
          return announcements.find((doc) => simpleMatch(doc, filter)) || null;
        },
        find() { return cursor(announcements); },
        async countDocuments() { return announcements.length; },
        async updateOne(filter, update) {
          const found = announcements.find((doc) => simpleMatch(doc, filter));
          if (!found) return { matchedCount: 0 };
          for (const [key, value] of Object.entries(update.$set || {})) setPath(found, key, value);
          for (const key of Object.keys(update.$unset || {})) {
            const parts = key.split('.');
            const leaf = parts.pop();
            const parent = parts.reduce((value, part) => value?.[part], found);
            if (parent) delete parent[leaf];
          }
          return { matchedCount: 1 };
        },
      };
    }
    if (name === 'users') {
      return {
        async findOne(filter) { return users.find((doc) => simpleMatch(doc, filter)) || null; },
        find() { return cursor(users); },
      };
    }
    if (name === 'reservations') return { find() { return cursor(reservations); }, async findOne() { return null; } };
    return { find() { return cursor([]); }, async findOne() { return null; } };
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { getDb: () => db, connectToMongo: async () => db, closeConnection: async () => {} },
};
require.cache[deliveryPath] = {
  id: deliveryPath,
  filename: deliveryPath,
  loaded: true,
  exports: {
    deliverAnnouncementById: async (_db, announcementId) => {
      deliveryCalls += 1;
      const found = announcements.find((item) => item.announcement_id === announcementId);
      found.delivery.status = 'delivered';
      found.delivery.recipientCount = 2;
      found.delivery.completedAt = new Date();
      return { status: 'delivered', recipientCount: 2 };
    },
  },
};

const {
  createAnnouncement,
  getAdminAnnouncements,
  setAnnouncementLifecycle,
} = require('../controllers/announcement.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test.beforeEach(() => {
  announcements.splice(0, announcements.length);
  users.splice(0, users.length, {
    _id: new ObjectId(),
    user_id: 'tenant-gil',
    name: 'Gil Tenant',
    role: 'tenant',
    is_active: true,
  });
  reservations.splice(0, reservations.length, {
    user_id: 'tenant-gil',
    branch: 'gil-puyat',
    status: 'approved',
  });
  deliveryCalls = 0;
});

test('admin can schedule a private Emergency announcement for a canonically eligible branch tenant', async () => {
  const res = response();
  await createAnnouncement({
    user: { user_id: 'admin-1', name: 'Admin' },
    body: {
      title: 'Scheduled maintenance emergency',
      content: 'Water interruption notice',
      category: 'Emergency',
      priority: 'high',
      is_urgent: true,
      is_private: true,
      user_id: 'tenant-gil',
      branch: 'Gil Puyat',
      publish_at: '2099-01-01T00:00:00.000Z',
      expires_at: '2099-01-02T00:00:00.000Z',
      client_request_id: 'announcement-request-001',
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.category, 'Emergency');
  assert.equal(res.body.branch, 'gil-puyat');
  assert.equal(res.body.lifecycle_status, 'scheduled');
  assert.equal(res.body.delivery.status, 'scheduled');
  assert.equal(res.body.notification_sent, false);
  assert.equal(deliveryCalls, 0);
  assert.equal(announcements.length, 1);
});

test('a lost-response retry with the same admin request ID returns the original announcement', async () => {
  const request = {
    user: { user_id: 'admin-1', name: 'Admin' },
    body: {
      title: 'Immediate notice',
      content: 'Please read',
      category: 'General',
      client_request_id: 'announcement-request-002',
    },
  };
  const first = response();
  const retry = response();
  await createAnnouncement(request, first);
  await createAnnouncement(request, retry);

  assert.equal(first.statusCode, 201);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.idempotent_replay, true);
  assert.equal(retry.body.announcement_id, first.body.announcement_id);
  assert.equal(announcements.length, 1);
  assert.equal(deliveryCalls, 1);
});

test('unknown branch input is rejected instead of creating a zero-recipient announcement', async () => {
  const res = response();
  await createAnnouncement({
    user: { user_id: 'admin-1' },
    body: { title: 'Unknown', content: 'No broadcast', branch: 'mystery-branch' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.detail, /canonical LilyCrest branch/);
  assert.equal(announcements.length, 0);
});

test('admin list is paginated and includes lifecycle/audience/delivery state', async () => {
  for (let index = 0; index < 5; index += 1) {
    announcements.push({
      _id: new ObjectId(),
      announcement_id: `ann_${index}`,
      title: `Announcement ${index}`,
      content: 'Message',
      is_active: true,
      is_private: index === 2,
      user_id: index === 2 ? 'tenant-gil' : null,
      branch: index === 2 ? 'gil-puyat' : null,
      publishedAt: new Date(),
      delivery: { status: 'delivered', attempts: 1, recipientCount: index },
    });
  }
  const res = response();
  await getAdminAnnouncements({ query: { page: '2', limit: '2' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 2);
  assert.deepEqual(res.body.pagination, { page: 2, limit: 2, total: 5, total_pages: 3 });
  assert.equal(res.body.items[0].announcement_id, 'ann_2');
  assert.equal(res.body.items[0].is_private, true);
  assert.equal(res.body.items[0].delivery.status, 'delivered');
});

test('archive is non-destructive and removes the announcement from active lifecycle', async () => {
  const doc = {
    _id: new ObjectId(),
    announcement_id: 'ann_archive',
    title: 'Archive me',
    content: 'Message',
    is_active: true,
    delivery: { status: 'delivered', completedAt: new Date() },
  };
  announcements.push(doc);
  const res = response();
  await setAnnouncementLifecycle({
    params: { announcementId: 'ann_archive' },
    body: { action: 'archive' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.lifecycle_status, 'archived');
  assert.equal(doc.is_active, false);
  assert.equal(doc.isArchived, true);
  assert.equal(announcements.length, 1);
});

test('admin routes expose management endpoints without weakening the tenant feed middleware', () => {
  const router = require('../routes/announcement.routes');
  const route = (method, path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
  for (const [method, path] of [
    ['get', '/admin'],
    ['get', '/admin/options'],
    ['patch', '/admin/:announcementId/lifecycle'],
  ]) {
    const layer = route(method, path);
    assert.ok(layer, `${method.toUpperCase()} ${path} must be registered`);
    assert.ok(layer.route.stack.some((entry) => entry.handle.name === 'adminMiddleware'));
  }
  const tenantFeed = route('get', '/');
  assert.ok(tenantFeed.route.stack.some((entry) => entry.handle.name === 'tenantMiddleware'));
});
