'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const {
  IDENTITY_VALUE_TYPE, buildUserIdentityIndex, classifyIdentityValue,
  resolveIdentity, analyzeIdentityCrosswalk,
} = require('../migrations/identityCrosswalk');

function fixture() {
  const a = new ObjectId();
  const b = new ObjectId();
  const users = [
    { _id: a, user_id: 'user_a', firebaseUid: 'firebase_a', email: 'match@example.com', username: 'match', name: 'Match Name' },
    { _id: b, user_id: 'user_b', firebaseUid: 'firebase_b', email: 'other@example.com', username: 'other', name: 'Other Name' },
  ];
  return { a, b, users, index: buildUserIdentityIndex(users) };
}

test('classifies valid ObjectId, stringified ObjectId, user ID, Firebase UID, invalid and empty values', () => {
  const { a, index } = fixture();
  assert.equal(classifyIdentityValue(a, index), IDENTITY_VALUE_TYPE.OBJECT_ID);
  assert.equal(classifyIdentityValue(a.toHexString(), index), IDENTITY_VALUE_TYPE.OBJECT_ID);
  assert.equal(classifyIdentityValue('user_a', index), IDENTITY_VALUE_TYPE.USER_ID_STRING);
  assert.equal(classifyIdentityValue('firebase_a', index), IDENTITY_VALUE_TYPE.FIREBASE_UID);
  assert.equal(classifyIdentityValue('zzzzzzzzzzzzzzzzzzzzzzzz', index), IDENTITY_VALUE_TYPE.UNKNOWN);
  assert.equal(classifyIdentityValue(null, index), IDENTITY_VALUE_TYPE.UNKNOWN);
  assert.equal(classifyIdentityValue('', index), IDENTITY_VALUE_TYPE.UNKNOWN);
});

test('stringified ObjectId is resolved only when the user exists', () => {
  const { a, index } = fixture();
  assert.equal(resolveIdentity({
    value: a.toHexString(), sourceCollection: 'reservations', sourceRecordId: 'r1',
    sourceField: 'userId', migrationBatchId: 'batch', index,
  }).resolutionStatus, 'RESOLVED');
  assert.equal(resolveIdentity({
    value: new ObjectId().toHexString(), sourceCollection: 'reservations', sourceRecordId: 'r2',
    sourceField: 'userId', migrationBatchId: 'batch', index,
  }).resolutionStatus, 'UNRESOLVED');
});

test('email, username, and display name are never identity evidence', () => {
  const { index } = fixture();
  for (const forbidden of ['match@example.com', 'match', 'Match Name']) {
    const result = resolveIdentity({
      value: forbidden, sourceCollection: 'reservations', sourceRecordId: forbidden,
      sourceField: 'userId', migrationBatchId: 'batch', index,
    });
    assert.equal(result.resolutionStatus, 'UNRESOLVED');
    assert.equal(result.evidence.length, 0);
  }
});

test('conflicting exact identifiers are ambiguous and never marked resolved', () => {
  const { users } = fixture();
  users[0].user_id = 'collision';
  users[1].firebaseUid = 'collision';
  const index = buildUserIdentityIndex(users);
  const result = resolveIdentity({
    value: 'collision', sourceCollection: 'reservations', sourceRecordId: 'r1',
    sourceField: 'userId', migrationBatchId: 'batch', index,
  });
  assert.equal(result.resolutionStatus, 'AMBIGUOUS');
  assert.equal(result.resolvedUserObjectId, null);
  assert.deepEqual(result.blockerCodes, ['RESERVATION_OWNER_AMBIGUOUS']);
});

test('invalid ObjectId-like values do not throw', () => {
  const { index } = fixture();
  assert.doesNotThrow(() => resolveIdentity({
    value: 'xxxxxxxxxxxxxxxxxxxxxxxx', sourceCollection: 'reservations', sourceRecordId: 'r1',
    sourceField: 'userId', migrationBatchId: 'batch', index,
  }));
});

test('crosswalk is stable, classifies every record once, and does not mutate input', () => {
  const { users, a } = fixture();
  const reservations = [
    { _id: 'r2', userId: 'missing' },
    { _id: 'r1', userId: a },
  ];
  const snapshot = JSON.stringify({ users, reservations });
  const options = { users, reservations, migrationBatchId: 'stable-batch' };
  const first = analyzeIdentityCrosswalk(options);
  const second = analyzeIdentityCrosswalk(options);
  assert.deepEqual(first, second);
  assert.equal(first.summary.totalReservationsScanned, reservations.length);
  assert.equal(first.records.length, reservations.length);
  assert.equal(JSON.stringify({ users, reservations }), snapshot);
});
