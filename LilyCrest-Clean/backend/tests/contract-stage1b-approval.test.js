'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { approveIdentityResolution } = require('../migrations/identityApproval');
const { hashRecord } = require('../migrations/migrationSafety');

function fakeDb({ sourceIdentity, selectedUser, existingDecision = null }) {
  const audit = [];
  const decisions = [];
  const sourceId = new ObjectId();
  const users = selectedUser ? [selectedUser] : [];
  const collections = {
    reservations: {
      async findOne() { return { _id: sourceId, userId: sourceIdentity }; },
    },
    users: {
      async findOne(query) {
        return selectedUser && String(query._id) === String(selectedUser._id) ? selectedUser : null;
      },
      find() { return { async toArray() { return users; } }; },
    },
    contract_identity_crosswalk: {
      async findOne() { return existingDecision; },
      async updateOne(filter, update) {
        decisions.push({ filter, update });
        return { upsertedCount: 1, upsertedId: new ObjectId() };
      },
    },
    auditLogs: {
      async insertOne(record) { audit.push(record); return { insertedId: new ObjectId() }; },
    },
  };
  return { db: { collection: (name) => collections[name] }, sourceId, audit, decisions };
}

function options(sourceId, sourceIdentity, selectedUserId, overrides = {}) {
  return {
    sourceCollection: 'reservations',
    sourceRecordId: sourceId.toHexString(),
    selectedUserId: selectedUserId.toHexString(),
    administrator: 'Administrator',
    approvalReference: 'APPROVAL-001',
    reason: 'Approved explicit mapping.',
    backupReference: 'BACKUP-001',
    migrationBatchId: 'batch-001',
    expectedSourceHash: hashRecord({
      sourceCollection: 'reservations',
      sourceRecordId: sourceId.toHexString(),
      sourceField: 'userId',
      rawIdentityValue: String(sourceIdentity),
    }),
    evidenceType: 'APPROVED_EXPLICIT_MAPPING',
    evidenceReference: 'MAPPING-001',
    confirm: true,
    ...overrides,
  };
}

test('stale identity review decisions are rejected before write', async () => {
  const user = { _id: new ObjectId(), isActive: true };
  const state = fakeDb({ sourceIdentity: new ObjectId(), selectedUser: user });
  await assert.rejects(
    approveIdentityResolution(state.db, options(state.sourceId, 'different', user._id)),
    /Stale review decision/,
  );
  assert.equal(state.audit.length, 0);
  assert.equal(state.decisions.length, 0);
});

test('inactive or deleted target users cannot be selected accidentally', async () => {
  const sourceIdentity = new ObjectId();
  const user = { _id: new ObjectId(), isActive: false };
  const state = fakeDb({ sourceIdentity, selectedUser: user });
  await assert.rejects(
    approveIdentityResolution(state.db, options(state.sourceId, sourceIdentity, user._id)),
    /Inactive or deleted users/,
  );
  assert.equal(state.decisions.length, 0);
});

test('approved manual resolution writes crosswalk and secret-free structured audit, not source', async () => {
  const sourceIdentity = new ObjectId();
  const user = { _id: new ObjectId(), user_id: 'different_exact_id', isActive: true };
  const state = fakeDb({ sourceIdentity, selectedUser: user });
  const result = await approveIdentityResolution(
    state.db,
    options(state.sourceId, sourceIdentity, user._id),
  );
  assert.equal(result.created, true);
  assert.equal(state.decisions.length, 1);
  assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0].action, 'IDENTITY_CROSSWALK_RESOLVED');
  assert.equal('legacyIdentityValue' in state.audit[0], false);
  assert.equal(JSON.stringify(state.audit[0]).includes('password'), false);
});

test('re-running the same approved identity decision is idempotent', async () => {
  const sourceIdentity = new ObjectId();
  const user = { _id: new ObjectId(), user_id: 'different_exact_id', isActive: true };
  const state = fakeDb({
    sourceIdentity,
    selectedUser: user,
    existingDecision: {
      _id: new ObjectId(),
      sourceCollection: 'reservations',
      sourceRecordId: 'unused',
      resolvedUserObjectId: user._id,
      reviewStatus: 'RESOLVED_APPROVED',
    },
  });
  const result = await approveIdentityResolution(
    state.db,
    options(state.sourceId, sourceIdentity, user._id),
  );
  assert.equal(result.idempotent, true);
  assert.equal(state.decisions.length, 0);
  assert.equal(state.audit.length, 0);
});
