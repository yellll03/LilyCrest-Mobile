'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROOM_TYPE, LEASE_TYPE, CONTRACT_STATUS, BRANCH_STATUS,
  IDENTITY_RESOLUTION_STATUS, isEnumValue, assertEnumValue, mapLegacyRoomType,
} = require('../domain/contracts/canonicalEnums');

test('canonical enum validators accept every approved value', () => {
  for (const enumObject of [ROOM_TYPE, LEASE_TYPE, CONTRACT_STATUS, BRANCH_STATUS, IDENTITY_RESOLUTION_STATUS]) {
    for (const value of Object.values(enumObject)) {
      assert.equal(isEnumValue(enumObject, value), true);
      assert.equal(assertEnumValue(enumObject, value), value);
    }
  }
});

test('canonical enum validators reject unknown, normalized, blank, and non-string values', () => {
  for (const value of ['private', ' private ', 'short_term', '', null, undefined, 1]) {
    assert.equal(isEnumValue(ROOM_TYPE, value), false);
  }
  assert.throws(() => assertEnumValue(ROOM_TYPE, 'private'), /unsupported/);
});

test('legacy room mapping is exact and returns a structured blocker for unknown values', () => {
  assert.deepEqual(mapLegacyRoomType('private'), { ok: true, value: 'PRIVATE_ROOM', blockerCode: null });
  assert.deepEqual(mapLegacyRoomType('double-sharing'), { ok: true, value: 'DOUBLE_SHARING', blockerCode: null });
  assert.deepEqual(mapLegacyRoomType('quadruple-sharing'), { ok: true, value: 'QUADRUPLE_SHARING', blockerCode: null });
  for (const value of ['Private', 'private ', 'double sharing', null]) {
    assert.deepEqual(mapLegacyRoomType(value), {
      ok: false, value: null, blockerCode: 'ROOM_TYPE_UNSUPPORTED',
    });
  }
});
