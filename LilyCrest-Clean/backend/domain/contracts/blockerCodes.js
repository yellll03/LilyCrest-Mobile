'use strict';

const SEVERITY = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
});

const definitions = [
  ['APPROVED_RESERVATION_NOT_FOUND', 'RESERVATION', 'An approved reservation could not be verified.', 'CRITICAL', true],
  ['TENANT_RECORD_NOT_FOUND', 'IDENTITY', 'The canonical tenant record could not be verified.', 'CRITICAL', true],
  ['LEGAL_NAME_MISSING', 'IDENTITY', 'The approved tenant legal name is missing.', 'CRITICAL', true],
  ['ADDRESS_MISSING', 'IDENTITY', 'The approved tenant residential address is missing.', 'CRITICAL', true],
  ['ROOM_TYPE_UNSUPPORTED', 'ROOM', 'The assigned room type is not supported.', 'ERROR', true],
  ['LEASE_DATES_MISSING', 'LEASE', 'Approved lease dates are incomplete.', 'ERROR', true],
  ['LEASE_DATE_INVALID', 'LEASE', 'An approved lease date is invalid.', 'ERROR', true],
  ['LEASE_DURATION_MISMATCH', 'LEASE', 'The lease duration does not agree with the approved dates.', 'ERROR', true],
  ['LEASE_TYPE_MISMATCH', 'LEASE', 'The lease type does not agree with the approved dates.', 'ERROR', true],
  ['RESERVATION_OWNER_UNRESOLVED', 'IDENTITY', 'The reservation owner could not be verified.', 'CRITICAL', true],
  ['RESERVATION_OWNER_AMBIGUOUS', 'IDENTITY', 'The reservation owner is ambiguous and requires review.', 'CRITICAL', true],
  ['TENANT_IDENTITY_UNRESOLVED', 'IDENTITY', 'The tenant identity could not be verified.', 'CRITICAL', true],
  ['BRANCH_NOT_FOUND', 'BRANCH', 'The assigned branch is not registered.', 'ERROR', true],
  ['BRANCH_LEGAL_DATA_MISSING', 'BRANCH', 'Verified legal branch information is incomplete.', 'CRITICAL', true],
  ['TEMPLATE_BRANCH_MISMATCH', 'TEMPLATE', 'The selected contract template is not approved for this branch.', 'CRITICAL', true],
  ['TEMPLATE_NOT_FOUND', 'TEMPLATE', 'The required approved contract template is unavailable.', 'CRITICAL', true],
  ['TEMPLATE_INTEGRITY_MISMATCH', 'TEMPLATE', 'The approved contract template failed integrity verification.', 'CRITICAL', true],
  ['TEMPLATE_OVERLAY_SPEC_MISSING', 'TEMPLATE', 'Approved field coordinates and matching font assets are required before generation.', 'CRITICAL', true],
  ['PRICING_APPROVAL_MISSING', 'PRICING', 'Contract pricing has not received final administrative approval.', 'CRITICAL', true],
  ['PRIVATE_ROOM_BED_SLOT_UNRESOLVED', 'ASSIGNMENT', 'Private-room bed or slot policy is not yet approved.', 'ERROR', true],
  ['ROOM_ASSIGNMENT_MISSING', 'ASSIGNMENT', 'A verified room assignment is missing.', 'ERROR', true],
  ['BED_SLOT_MISSING', 'ASSIGNMENT', 'A required bed or slot assignment is missing.', 'ERROR', true],
  ['PRICING_INCOMPLETE', 'PRICING', 'Approved contract pricing is incomplete.', 'ERROR', true],
  ['PRICING_CONFLICT', 'PRICING', 'Approved pricing sources conflict and require review.', 'CRITICAL', true],
  ['CONTRACT_DATA_INCOMPLETE', 'CONTRACT', 'Required contract information is incomplete.', 'ERROR', true],
  ['ACCOUNT_OWNERSHIP_MISMATCH', 'AUTHORIZATION', 'The requested contract information is not available for this account.', 'CRITICAL', true],
];

const BLOCKER_CODES = Object.freeze(Object.fromEntries(definitions.map(
  ([code, category, defaultMessage, severity, blocksContractReadiness]) => [
    code,
    Object.freeze({ code, category, defaultMessage, severity, blocksContractReadiness }),
  ],
)));

function getBlockerDefinition(code) {
  const definition = BLOCKER_CODES[code];
  if (!definition) throw new TypeError('Unknown blocker code.');
  return definition;
}

function isKnownBlockerCode(code) {
  return Object.prototype.hasOwnProperty.call(BLOCKER_CODES, code);
}

module.exports = {
  SEVERITY,
  BLOCKER_CODES,
  getBlockerDefinition,
  isKnownBlockerCode,
};
