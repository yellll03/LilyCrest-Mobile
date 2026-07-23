'use strict';

const ROOM_TYPE = Object.freeze({
  PRIVATE_ROOM: 'PRIVATE_ROOM',
  DOUBLE_SHARING: 'DOUBLE_SHARING',
  QUADRUPLE_SHARING: 'QUADRUPLE_SHARING',
});

const LEASE_TYPE = Object.freeze({
  SHORT_TERM: 'SHORT_TERM',
  LONG_TERM: 'LONG_TERM',
});

const CONTRACT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED',
  VOID: 'VOID',
});

const BRANCH_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

const IDENTITY_RESOLUTION_STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  UNRESOLVED: 'UNRESOLVED',
  AMBIGUOUS: 'AMBIGUOUS',
  DELETED_ACCOUNT: 'DELETED_ACCOUNT',
});

const LEGACY_ROOM_TYPE_MAPPING = Object.freeze({
  private: ROOM_TYPE.PRIVATE_ROOM,
  'double-sharing': ROOM_TYPE.DOUBLE_SHARING,
  'quadruple-sharing': ROOM_TYPE.QUADRUPLE_SHARING,
});

function enumValues(enumObject) {
  return Object.freeze(Object.values(enumObject));
}

function isEnumValue(enumObject, value) {
  return typeof value === 'string' && enumValues(enumObject).includes(value);
}

function assertEnumValue(enumObject, value, label = 'value') {
  if (!isEnumValue(enumObject, value)) {
    throw new TypeError(`${label} is unsupported.`);
  }
  return value;
}

function mapLegacyRoomType(value) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(LEGACY_ROOM_TYPE_MAPPING, value)) {
    return { ok: false, value: null, blockerCode: 'ROOM_TYPE_UNSUPPORTED' };
  }
  return { ok: true, value: LEGACY_ROOM_TYPE_MAPPING[value], blockerCode: null };
}

module.exports = {
  ROOM_TYPE,
  LEASE_TYPE,
  CONTRACT_STATUS,
  BRANCH_STATUS,
  IDENTITY_RESOLUTION_STATUS,
  LEGACY_ROOM_TYPE_MAPPING,
  enumValues,
  isEnumValue,
  assertEnumValue,
  mapLegacyRoomType,
};
