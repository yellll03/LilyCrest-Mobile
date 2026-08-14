'use strict';

const { ObjectId } = require('mongodb');
const { buildUserIdentityIndex, resolveIdentity, valueKey } = require('./identityCrosswalk');
const { hashRecord } = require('./migrationSafety');
const { REVIEW_STATUS, isInactiveUser, validateManualResolutionInput } = require('./identityReview');

const SOURCE_FIELDS = Object.freeze({
  reservations: 'userId',
  bedhistories: 'tenantId',
  stays: 'tenantId',
});

async function readSourceIdentity(db, sourceCollection, sourceRecordId) {
  if (SOURCE_FIELDS[sourceCollection]) {
    if (!ObjectId.isValid(sourceRecordId)) throw new Error('Source record ID is invalid.');
    const sourceField = SOURCE_FIELDS[sourceCollection];
    const document = await db.collection(sourceCollection).findOne(
      { _id: new ObjectId(sourceRecordId) },
      { projection: { [sourceField]: 1 } },
    );
    if (!document) throw new Error('Source record was not found.');
    return { sourceField, identityValue: document[sourceField] };
  }
  if (sourceCollection === 'rooms') {
    const match = /^([a-fA-F0-9]{24}):bed:(.+)$/.exec(sourceRecordId);
    if (!match) throw new Error('Room-bed source record ID is invalid.');
    const room = await db.collection('rooms').findOne(
      { _id: new ObjectId(match[1]) },
      { projection: { beds: 1 } },
    );
    const bed = room?.beds?.find((item) => String(item.id || item._id) === match[2]);
    if (!bed) throw new Error('Source room bed was not found.');
    return { sourceField: 'beds.occupiedBy.userId', identityValue: bed.occupiedBy?.userId };
  }
  throw new Error('Source collection is not approved for identity review.');
}

async function approveIdentityResolution(db, options) {
  validateManualResolutionInput(options);
  const source = await readSourceIdentity(db, options.sourceCollection, options.sourceRecordId);
  const currentHash = hashRecord({
    sourceCollection: options.sourceCollection,
    sourceRecordId: options.sourceRecordId,
    sourceField: source.sourceField,
    rawIdentityValue: valueKey(source.identityValue),
  });
  if (currentHash !== options.expectedSourceHash) throw new Error('Stale review decision: the source identity changed.');

  const selectedUser = await db.collection('users').findOne({ _id: new ObjectId(options.selectedUserId) });
  if (!selectedUser) throw new Error('Selected canonical user does not exist.');
  if (isInactiveUser(selectedUser) && options.allowInactive !== true) {
    throw new Error('Inactive or deleted users require explicit --allow-inactive approval.');
  }

  const users = await db.collection('users').find({}, {
    projection: { _id: 1, user_id: 1, firebaseUid: 1, firebase_uid: 1 },
  }).toArray();
  const automatic = resolveIdentity({
    value: source.identityValue,
    sourceCollection: options.sourceCollection,
    sourceRecordId: options.sourceRecordId,
    sourceField: source.sourceField,
    migrationBatchId: options.migrationBatchId,
    index: buildUserIdentityIndex(users),
  });
  if (automatic.resolutionStatus === 'RESOLVED') {
    throw new Error('Review is stale: the source now resolves automatically.');
  }

  const collection = db.collection('contract_identity_crosswalk');
  const key = { sourceCollection: options.sourceCollection, sourceRecordId: options.sourceRecordId };
  const existing = await collection.findOne(key);
  const evidence = [{
    type: options.evidenceType,
    reference: options.evidenceReference,
    selectedUserId: options.selectedUserId,
  }];
  if (existing?.reviewStatus === REVIEW_STATUS.RESOLVED_APPROVED) {
    if (String(existing.resolvedUserObjectId) !== options.selectedUserId) {
      throw new Error('A conflicting approved identity resolution already exists.');
    }
    return { created: false, idempotent: true, recordId: existing._id };
  }
  if (existing && existing.sourceStateHash !== currentHash) {
    throw new Error('Stale review decision: stored crosswalk state differs from the source.');
  }

  const now = new Date();
  const decision = {
    ...key,
    sourceField: source.sourceField,
    sourceStateHash: currentHash,
    legacyIdentityValue: valueKey(source.identityValue),
    resolvedUserObjectId: selectedUser._id,
    resolutionStatus: 'RESOLVED',
    reviewStatus: REVIEW_STATUS.RESOLVED_APPROVED,
    evidence,
    blockerCodes: [],
    administrator: options.administrator,
    approvalReference: options.approvalReference,
    reason: options.reason,
    migrationBatchId: options.migrationBatchId,
    reviewedAt: now,
    updatedAt: now,
  };
  const result = await collection.updateOne(
    { ...key, reviewStatus: { $ne: REVIEW_STATUS.RESOLVED_APPROVED } },
    { $set: decision, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );

  await db.collection('auditLogs').insertOne({
    action: 'IDENTITY_CROSSWALK_RESOLVED',
    sourceCollection: options.sourceCollection,
    sourceRecordId: options.sourceRecordId,
    selectedUserId: selectedUser._id,
    administrator: options.administrator,
    approvalReference: options.approvalReference,
    reason: options.reason,
    evidence,
    beforeStatus: existing?.reviewStatus || REVIEW_STATUS.PENDING_REVIEW,
    afterStatus: REVIEW_STATUS.RESOLVED_APPROVED,
    migrationBatchId: options.migrationBatchId,
    sourceStateHash: currentHash,
    createdAt: now,
  });
  return {
    created: result.upsertedCount === 1,
    idempotent: false,
    recordId: result.upsertedId || existing?._id,
  };
}

module.exports = { SOURCE_FIELDS, readSourceIdentity, approveIdentityResolution };
