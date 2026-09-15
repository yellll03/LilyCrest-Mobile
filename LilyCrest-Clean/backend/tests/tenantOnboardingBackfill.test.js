'use strict';

// Coverage for the one-time compatibility backfill that grandfathers
// existing active tenants so the server-authoritative mobile app guide
// field (`tenant_onboarding_seen_at`) does not make every pre-existing
// tenant look like a first-time tenant after this feature ships.

const test = require('node:test');
const assert = require('node:assert/strict');

const databasePath = require.resolve('../config/database');
const scriptPath = require.resolve('../scripts/backfillTenantOnboardingSeen');

function fakeDb(users, existingAuditLogs = []) {
  const updates = [];
  const auditLogs = [...existingAuditLogs];
  return {
    updates,
    auditLogs,
    collection(name) {
      if (name === 'users') {
        return {
          find(query) {
            const missingField = query.tenant_onboarding_seen_at?.$exists === false;
            const matched = users.filter((user) => missingField ? !('tenant_onboarding_seen_at' in user) : true);
            let index = 0;
            return {
              async hasNext() { return index < matched.length; },
              async next() { return matched[index++]; },
            };
          },
          async updateOne(filter, update) {
            const user = users.find((candidate) => candidate._id === filter._id);
            if (!user || 'tenant_onboarding_seen_at' in user) return { modifiedCount: 0 };
            Object.assign(user, update.$set);
            updates.push({ filter, update });
            return { modifiedCount: 1 };
          },
        };
      }
      if (name === 'audit_logs') {
        return {
          async findOne(query) {
            return auditLogs.find((doc) => doc.action === query.action) || null;
          },
          async insertOne(doc) { auditLogs.push(doc); return { insertedId: `audit-${auditLogs.length}` }; },
        };
      }
      return { findOne: async () => null };
    },
  };
}

function freshScript(db) {
  require(databasePath).getDb = () => db;
  delete require.cache[scriptPath];
  return require(scriptPath);
}

test('backfill only stamps currently-active tenant/resident accounts missing the field', async () => {
  const users = [
    { _id: 1, role: 'tenant', status: 'active', is_active: true },
    { _id: 2, role: 'resident', status: 'active' },
    { _id: 3, role: 'tenant', status: 'pending_approval', is_active: false },
    { _id: 4, role: 'admin', status: 'active' },
    { _id: 5, role: 'tenant', status: 'active', tenant_onboarding_seen_at: new Date('2026-01-01') },
  ];
  const db = fakeDb(users);
  const { run } = freshScript(db);

  const result = await run({ dryRun: false });

  assert.equal(result.scanned, 4); // user 5 already has the field, excluded by the query
  assert.equal(result.eligible, 2); // only users 1 and 2 are active tenant/resident
  assert.equal(result.modified, 2);
  assert.equal(result.skipped, 2); // admin (4) and pending (3)
  assert.equal(users.find((u) => u._id === 1).tenant_onboarding_seen_at instanceof Date, true);
  assert.equal(users.find((u) => u._id === 2).tenant_onboarding_seen_at instanceof Date, true);
  assert.equal(users.find((u) => u._id === 3).tenant_onboarding_seen_at, undefined); // pending, left alone
  assert.equal(users.find((u) => u._id === 4).tenant_onboarding_seen_at, undefined); // not a tenant role
  assert.equal(db.auditLogs.length, 1);
  assert.equal(db.auditLogs[0].eligible, 2);
  assert.equal(db.auditLogs[0].modified, 2);
});

test('dry run reports counts without writing and without recording an audit entry', async () => {
  const users = [{ _id: 1, role: 'tenant', status: 'active' }];
  const db = fakeDb(users);
  const { run } = freshScript(db);

  const result = await run({ dryRun: true });

  assert.equal(result.eligible, 1);
  assert.equal(result.modified, 0);
  assert.equal(users[0].tenant_onboarding_seen_at, undefined);
  assert.equal(db.auditLogs.length, 0);
});

test('a genuinely new tenant scanned during the original cutover run is grandfathered — that is the intended one-time behavior', async () => {
  const users = [{ _id: 1, role: 'tenant', status: 'active', last_login: new Date() }];
  const db = fakeDb(users);
  const { run } = freshScript(db);
  await run({ dryRun: false });
  assert.equal(users[0].tenant_onboarding_seen_at instanceof Date, true);
});

test('a second real run is refused once a prior backfill audit entry exists', async () => {
  const priorRun = { action: 'tenant_onboarding_seen_backfill', created_at: new Date('2026-01-01'), eligible: 10, modified: 10 };
  const users = [{ _id: 1, role: 'tenant', status: 'active' }]; // a genuinely new tenant who just hasn't logged in yet
  const db = fakeDb(users, [priorRun]);
  const { run } = freshScript(db);

  await assert.rejects(() => run({ dryRun: false }), /already ran/);
  // Refused before touching anything.
  assert.equal(users[0].tenant_onboarding_seen_at, undefined);
  assert.equal(db.auditLogs.length, 1);
});

test('a second real run is still allowed with an explicit forceRerun override', async () => {
  const priorRun = { action: 'tenant_onboarding_seen_backfill', created_at: new Date('2026-01-01'), eligible: 10, modified: 10 };
  const users = [{ _id: 1, role: 'tenant', status: 'active' }];
  const db = fakeDb(users, [priorRun]);
  const { run } = freshScript(db);

  const result = await run({ dryRun: false, forceRerun: true });
  assert.equal(result.modified, 1);
  assert.equal(users[0].tenant_onboarding_seen_at instanceof Date, true);
});

test('dry run is always allowed, even after a prior real run, and still writes nothing', async () => {
  const priorRun = { action: 'tenant_onboarding_seen_backfill', created_at: new Date('2026-01-01'), eligible: 10, modified: 10 };
  const users = [{ _id: 1, role: 'tenant', status: 'active' }];
  const db = fakeDb(users, [priorRun]);
  const { run } = freshScript(db);

  const result = await run({ dryRun: true });
  assert.equal(result.eligible, 1);
  assert.equal(users[0].tenant_onboarding_seen_at, undefined);
  assert.equal(db.auditLogs.length, 1); // unchanged — still just the prior run's entry
});
