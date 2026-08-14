'use strict';

const { ObjectId } = require('mongodb');
const { IDENTITY_RESOLUTION_STATUS } = require('../domain/contracts/canonicalEnums');

const IDENTITY_VALUE_TYPE = Object.freeze({
  OBJECT_ID: 'OBJECT_ID',
  USER_ID_STRING: 'USER_ID_STRING',
  FIREBASE_UID: 'FIREBASE_UID',
  UNKNOWN: 'UNKNOWN',
});

function valueKey(value) {
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === 'string') return value;
  return '';
}

function identityStorageType(value) {
  if (value instanceof ObjectId) return 'OBJECT_ID';
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value) && ObjectId.isValid(value)) {
    return 'STRINGIFIED_OBJECT_ID';
  }
  if (typeof value === 'string') return 'STRING';
  if (value === null || value === undefined) return 'EMPTY';
  return 'OTHER';
}

function buildUserIdentityIndex(users, explicitMappings = []) {
  const byObjectId = new Map();
  const byUserId = new Map();
  const byFirebaseUid = new Map();
  const explicit = new Map();

  function add(map, key, userId) {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(String(userId));
  }

  for (const user of users) {
    const objectId = valueKey(user._id);
    add(byObjectId, objectId, objectId);
    add(byUserId, typeof user.user_id === 'string' ? user.user_id : '', objectId);
    add(byFirebaseUid, typeof user.firebaseUid === 'string' ? user.firebaseUid : '', objectId);
    add(byFirebaseUid, typeof user.firebase_uid === 'string' ? user.firebase_uid : '', objectId);
  }
  for (const mapping of explicitMappings) {
    if (typeof mapping.legacyIdentityValue === 'string' && ObjectId.isValid(String(mapping.resolvedUserObjectId))) {
      add(explicit, mapping.legacyIdentityValue, String(mapping.resolvedUserObjectId));
    }
  }
  return { byObjectId, byUserId, byFirebaseUid, explicit };
}

function classifyIdentityValue(value, index) {
  if (value === null || value === undefined || value === '') return IDENTITY_VALUE_TYPE.UNKNOWN;
  if (value instanceof ObjectId) return IDENTITY_VALUE_TYPE.OBJECT_ID;
  if (typeof value !== 'string') return IDENTITY_VALUE_TYPE.UNKNOWN;
  if (index.byUserId.has(value)) return IDENTITY_VALUE_TYPE.USER_ID_STRING;
  if (index.byFirebaseUid.has(value)) return IDENTITY_VALUE_TYPE.FIREBASE_UID;
  if (/^[a-fA-F0-9]{24}$/.test(value) && ObjectId.isValid(value)) return IDENTITY_VALUE_TYPE.OBJECT_ID;
  return IDENTITY_VALUE_TYPE.UNKNOWN;
}

function gatherCandidates(value, index) {
  const raw = valueKey(value);
  const evidence = [];
  const candidates = new Set();
  function collect(map, type) {
    const matches = map.get(raw);
    if (!matches) return;
    for (const candidate of matches) candidates.add(candidate);
    evidence.push({ type, sourceField: type });
  }

  if (value instanceof ObjectId || (/^[a-fA-F0-9]{24}$/.test(raw) && ObjectId.isValid(raw))) {
    collect(index.byObjectId, 'EXACT_USERS_OBJECT_ID');
  }
  collect(index.byUserId, 'EXACT_USERS_USER_ID');
  collect(index.byFirebaseUid, 'EXACT_FIREBASE_UID');
  collect(index.explicit, 'APPROVED_EXPLICIT_MAPPING');
  return { candidates: [...candidates].sort(), evidence };
}

function resolveIdentity({
  value,
  sourceCollection,
  sourceRecordId,
  sourceField,
  migrationBatchId,
  index,
  deletedIdentityValues = new Set(),
}) {
  const legacyIdentityType = classifyIdentityValue(value, index);
  const raw = valueKey(value);
  const { candidates, evidence } = gatherCandidates(value, index);
  let resolutionStatus;
  let blockerCodes = [];

  if (candidates.length === 1) {
    resolutionStatus = IDENTITY_RESOLUTION_STATUS.RESOLVED;
  } else if (candidates.length > 1) {
    resolutionStatus = IDENTITY_RESOLUTION_STATUS.AMBIGUOUS;
    blockerCodes = [
      sourceCollection === 'reservations' ? 'RESERVATION_OWNER_AMBIGUOUS' : 'TENANT_IDENTITY_UNRESOLVED',
    ];
  } else if (deletedIdentityValues.has(raw)) {
    resolutionStatus = IDENTITY_RESOLUTION_STATUS.DELETED_ACCOUNT;
    blockerCodes = [
      sourceCollection === 'reservations' ? 'RESERVATION_OWNER_UNRESOLVED' : 'TENANT_IDENTITY_UNRESOLVED',
    ];
  } else {
    resolutionStatus = IDENTITY_RESOLUTION_STATUS.UNRESOLVED;
    blockerCodes = [
      sourceCollection === 'reservations' ? 'RESERVATION_OWNER_UNRESOLVED' : 'TENANT_IDENTITY_UNRESOLVED',
    ];
  }

  return {
    migrationBatchId,
    sourceCollection,
    sourceRecordId: String(sourceRecordId),
    sourceField,
    legacyIdentityValue: raw,
    legacyIdentityType,
    legacyIdentityStorageType: identityStorageType(value),
    resolvedUserObjectId: candidates.length === 1 ? candidates[0] : null,
    resolutionStatus,
    evidence,
    blockerCodes,
    reviewedBy: null,
    reviewedAt: null,
  };
}

function analyzeIdentityCrosswalk({
  users,
  reservations,
  assignmentRecords = [],
  migrationBatchId,
  explicitMappings = [],
  deletedIdentityValues = new Set(),
}) {
  const index = buildUserIdentityIndex(users, explicitMappings);
  const records = [];
  for (const reservation of reservations) {
    records.push(resolveIdentity({
      value: reservation.userId,
      sourceCollection: 'reservations',
      sourceRecordId: reservation._id,
      sourceField: 'userId',
      migrationBatchId,
      index,
      deletedIdentityValues,
    }));
  }
  for (const source of assignmentRecords) {
    records.push(resolveIdentity({
      value: source.identityValue,
      sourceCollection: source.sourceCollection,
      sourceRecordId: source.sourceRecordId,
      sourceField: source.sourceField,
      migrationBatchId,
      index,
      deletedIdentityValues,
    }));
  }

  const reservationRecords = records.filter((record) => record.sourceCollection === 'reservations');
  const count = (status, source = records) => source.filter((record) => record.resolutionStatus === status).length;
  const storageTypesByField = new Map();
  for (const record of records) {
    const key = `${record.sourceCollection}:${record.sourceField}`;
    if (!storageTypesByField.has(key)) storageTypesByField.set(key, new Set());
    storageTypesByField.get(key).add(record.legacyIdentityStorageType);
  }
  const storageTypeCounts = {};
  for (const record of records) {
    storageTypeCounts[record.legacyIdentityStorageType] = (storageTypeCounts[record.legacyIdentityStorageType] || 0) + 1;
  }
  return {
    migrationBatchId,
    summary: {
      totalReservationsScanned: reservationRecords.length,
      totalAssignmentRecordsScanned: records.length - reservationRecords.length,
      totalSourceRecordsScanned: records.length,
      resolved: count(IDENTITY_RESOLUTION_STATUS.RESOLVED),
      unresolved: count(IDENTITY_RESOLUTION_STATUS.UNRESOLVED),
      ambiguous: count(IDENTITY_RESOLUTION_STATUS.AMBIGUOUS),
      deletedAccountCandidates: count(IDENTITY_RESOLUTION_STATUS.DELETED_ACCOUNT),
      mixedStringObjectIdCases: records.filter((record) => (
        storageTypesByField.get(`${record.sourceCollection}:${record.sourceField}`).size > 1
      )).length,
      identityStorageTypeCounts: storageTypeCounts,
      reservationClassifications: {
        resolved: count(IDENTITY_RESOLUTION_STATUS.RESOLVED, reservationRecords),
        unresolved: count(IDENTITY_RESOLUTION_STATUS.UNRESOLVED, reservationRecords),
        ambiguous: count(IDENTITY_RESOLUTION_STATUS.AMBIGUOUS, reservationRecords),
        deletedAccountCandidates: count(IDENTITY_RESOLUTION_STATUS.DELETED_ACCOUNT, reservationRecords),
      },
      recordsRequiringManualReview: records.filter((record) => (
        record.resolutionStatus !== IDENTITY_RESOLUTION_STATUS.RESOLVED
      )).length,
    },
    records,
  };
}

module.exports = {
  IDENTITY_VALUE_TYPE,
  valueKey,
  identityStorageType,
  buildUserIdentityIndex,
  classifyIdentityValue,
  gatherCandidates,
  resolveIdentity,
  analyzeIdentityCrosswalk,
};
