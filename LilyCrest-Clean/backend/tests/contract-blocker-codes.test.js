'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SEVERITY, BLOCKER_CODES, getBlockerDefinition, isKnownBlockerCode,
} = require('../domain/contracts/blockerCodes');

test('blocker codes are unique, structured, and use controlled severity values', () => {
  const definitions = Object.values(BLOCKER_CODES);
  assert.equal(new Set(definitions.map((item) => item.code)).size, definitions.length);
  for (const item of definitions) {
    assert.equal(typeof item.code, 'string');
    assert.equal(typeof item.category, 'string');
    assert.equal(typeof item.defaultMessage, 'string');
    assert.ok(item.defaultMessage.length > 0);
    assert.ok(Object.values(SEVERITY).includes(item.severity));
    assert.equal(typeof item.blocksContractReadiness, 'boolean');
  }
});

test('required Stage 1 blocker codes are registered', () => {
  for (const code of [
    'ROOM_TYPE_UNSUPPORTED', 'LEASE_DATES_MISSING', 'LEASE_DATE_INVALID',
    'LEASE_DURATION_MISMATCH', 'LEASE_TYPE_MISMATCH', 'RESERVATION_OWNER_UNRESOLVED',
    'RESERVATION_OWNER_AMBIGUOUS', 'TENANT_IDENTITY_UNRESOLVED', 'BRANCH_NOT_FOUND',
    'BRANCH_LEGAL_DATA_MISSING', 'TEMPLATE_BRANCH_MISMATCH',
    'PRIVATE_ROOM_BED_SLOT_UNRESOLVED', 'ROOM_ASSIGNMENT_MISSING', 'BED_SLOT_MISSING',
    'PRICING_INCOMPLETE', 'PRICING_CONFLICT', 'CONTRACT_DATA_INCOMPLETE',
    'ACCOUNT_OWNERSHIP_MISMATCH',
  ]) assert.equal(isKnownBlockerCode(code), true, code);
});

test('unknown blocker codes are rejected without reflecting sensitive input', () => {
  assert.throws(() => getBlockerDefinition('SECRET_TOKEN_VALUE'), /^TypeError: Unknown blocker code\.$/);
});
