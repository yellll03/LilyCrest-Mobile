// Phase 3.1 closure: a network timeout after the backend already committed a
// maintenance ticket previously let a tenant retry and create a duplicate.
// This covers the fix: a tenant-scoped, client-generated idempotency key
// (client_request_id) that returns the original ticket on retry instead of
// creating a second one, including the near-simultaneous-request race.
const test = require('node:test');
const assert = require('node:assert/strict');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function loadWithDb(db) {
  const databasePath = require.resolve('../config/database');
  require(databasePath).getDb = () => db;
  delete require.cache[require.resolve('../controllers/maintenance.controller')];
  return require('../controllers/maintenance.controller');
}

const TENANT_USER = { user_id: 'tenant-a', role: 'resident', name: 'Tenant A' };
const VALID_DESCRIPTION_1000 = 'x'.repeat(1000);
const TOO_LONG_DESCRIPTION_1001 = 'x'.repeat(1001);

function buildStore() {
  const docs = [];
  return {
    docs,
    collection(name) {
      if (name === 'maintenance_requests') {
        return {
          async findOne(filter) {
            return docs.find((d) =>
              d.user_id === filter.user_id
              && (!filter.client_request_id || d.client_request_id === filter.client_request_id)
            ) || null;
          },
          async insertOne(doc) {
            // Simulate the unique(user_id, client_request_id) index from server.js.
            if (doc.client_request_id) {
              const clash = docs.find((d) => d.user_id === doc.user_id && d.client_request_id === doc.client_request_id);
              if (clash) {
                const err = new Error('E11000 duplicate key error');
                err.code = 11000;
                throw err;
              }
            }
            docs.push(doc);
            return { insertedId: doc.request_id };
          },
        };
      }
      // reservations/bedhistories are never reached because TENANT_USER has no _id.
      return { findOne: async () => null };
    },
  };
}

test('retrying the exact same submission (same client_request_id) does not create a second ticket', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);

  const body = { request_type: 'plumbing', description: 'Leaky faucet in the shared bathroom.', urgency: 'normal', client_request_id: 'a1b2c3d4-e5f6-idempotent-key' };

  const res1 = response();
  await createMaintenance({ user: TENANT_USER, body }, res1);
  assert.equal(res1.statusCode, 201);
  const firstRequestId = res1.body.request_id;

  const res2 = response();
  await createMaintenance({ user: TENANT_USER, body }, res2);
  assert.equal(res2.statusCode, 200, 'retry must return 200, not create a new 201 ticket');
  assert.equal(res2.body.request_id, firstRequestId, 'retry must return the original ticket');
  assert.equal(store.docs.length, 1, 'only one ticket must exist after the retry');
});

test('near-simultaneous duplicate submissions resolve to exactly one ticket (race safety)', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);

  const body = { request_type: 'electrical', description: 'Flickering light in the hallway near room 204.', urgency: 'high', client_request_id: 'race-condition-key-001' };

  // Both requests pass the findOne fast-path check before either inserts —
  // this simulates the true race, not just a sequential retry.
  const res1 = response();
  const res2 = response();
  await Promise.all([
    createMaintenance({ user: TENANT_USER, body }, res1),
    createMaintenance({ user: TENANT_USER, body }, res2),
  ]);

  assert.equal(store.docs.length, 1, 'exactly one ticket must exist after a simultaneous duplicate submit');
  const statuses = [res1, res2].map((r) => r.statusCode).sort();
  // One request wins the insert (201), the other hits the unique-index
  // collision and returns the winner's ticket (200) — never a 500 or a
  // second ticket.
  assert.deepEqual(statuses, [200, 201]);
  assert.equal(res1.body.request_id, res2.body.request_id);
});

test('a different client_request_id for the same tenant creates a distinct ticket', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);

  const res1 = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: 'First distinct issue report today.', urgency: 'normal', client_request_id: 'key-one' } }, res1);

  const res2 = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'electrical', description: 'Second distinct issue report today.', urgency: 'normal', client_request_id: 'key-two' } }, res2);

  assert.equal(store.docs.length, 2);
  assert.notEqual(res1.body.request_id, res2.body.request_id);
});

test('submitting without a client_request_id still works (older app builds)', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);

  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: 'No idempotency key sent with this request.', urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(store.docs.length, 1);
  assert.equal(store.docs[0].client_request_id, undefined);
});

// ── Description length validation (min preserved, max = 1000, matches backend) ──

test('description exactly at the 1000-character maximum is accepted', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);

  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: VALID_DESCRIPTION_1000, urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 201);
});

test('description of 1001 characters is rejected (backend remains authoritative)', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);

  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: TOO_LONG_DESCRIPTION_1001, urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.errors.description, /1000 characters or fewer/);
});

test('blank description is rejected', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);
  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: '', urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 400);
});

test('whitespace-only description is rejected', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);
  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: '     \n\t  ', urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 400);
});

test('description below the 10-character minimum is rejected', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);
  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: 'too short', urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 400);
});

test('description at exactly the 10-character minimum is accepted', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);
  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: '1234567890', urgency: 'normal' } }, res);
  assert.equal(res.statusCode, 201);
});

// ── client_request_id format defense ────────────────────────────────────────

test('a malformed client_request_id is treated as absent rather than trusted verbatim', async () => {
  const store = buildStore();
  const { createMaintenance } = loadWithDb(store);
  const res = response();
  await createMaintenance({ user: TENANT_USER, body: { request_type: 'plumbing', description: 'A valid description of the issue here.', urgency: 'normal', client_request_id: '../../etc/passwd' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(store.docs[0].client_request_id, undefined);
});
