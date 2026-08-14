'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IDENTITY_DISPOSITION, FINAL_REVIEW_STATUS, MIGRATION_ELIGIBILITY,
  reviewItemId, lifecycleGroup, buildAdministratorReviewItems, buildDecisionWorksheet,
  explicitTestIndicators, buildPossibleTestRecordReport, buildBranchApprovalForms,
  buildPrivateRoomDecisionForm, buildPricingApprovalMatrix, buildContractDatePolicyForm,
  classifyMigrationEligibility, buildApprovalImportTemplate,
} = require('../migrations/administrativeEvidencePack');

function queueItem(overrides = {}) {
  return {
    sourceCollection: 'reservations',
    sourceRecordId: '64b000000000000000000001',
    reservationCode: 'RES-001',
    rawIdentityValue: '64c000000000000000000001',
    rawIdentityType: 'OBJECT_ID',
    currentResolutionStatus: 'UNRESOLVED',
    blockerCodes: ['RESERVATION_OWNER_UNRESOLVED'],
    ...overrides,
  };
}

test('review item IDs are stable and preserve original source IDs', () => {
  const first = reviewItemId('reservations', 'source-1');
  assert.equal(first, reviewItemId('reservations', 'source-1'));
  assert.notEqual(first, reviewItemId('reservations', 'source-2'));
  const context = new Map([['reservations:64b000000000000000000001', {
    lifecycleStatus: 'cancelled',
    email: 'person@example.com',
    phone: '+639171234567',
  }]]);
  const items = buildAdministratorReviewItems({ queue: [queueItem()], contextBySource: context });
  assert.equal(items[0].sourceRecordId, '64b000000000000000000001');
  assert.equal(items[0].rawLegacyIdentityValue, '64c000000000000000000001');
  assert.equal(items[0].maskedEmail, 'pe****@example.com');
  assert.equal(items[0].maskedPhone, '*********4567');
});

test('lifecycle grouping uses explicit source and controlled status rules', () => {
  assert.equal(lifecycleGroup('reservations', 'moveIn'), 'ACTIVE_OR_CURRENT');
  assert.equal(lifecycleGroup('reservations', 'moveOut'), 'COMPLETED_OR_HISTORICAL');
  assert.equal(lifecycleGroup('reservations', 'cancelled'), 'CANCELLED_OR_REJECTED');
  assert.equal(lifecycleGroup('bedhistories', 'active'), 'BED_HISTORY_ONLY');
  assert.equal(lifecycleGroup('rooms', 'occupied'), 'EMBEDDED_ROOM_BED_IDENTITY');
  assert.equal(lifecycleGroup('reservations', 'visit_pending'), 'UNKNOWN_LIFECYCLE');
});

test('identity worksheets and import templates contain no prefilled approval', () => {
  const items = buildAdministratorReviewItems({ queue: [queueItem()], contextBySource: new Map() });
  const worksheet = buildDecisionWorksheet(items);
  assert.equal(worksheet[0].proposedDisposition, '');
  assert.equal(worksheet[0].administrator, '');
  assert.equal(worksheet[0].approvalReference, '');
  assert.equal(worksheet[0].finalStatus, 'PENDING');
  const template = buildApprovalImportTemplate(items);
  assert.equal(template.identityDecisions[0].proposedDisposition, '');
  assert.equal(template.identityDecisions[0].finalStatus, 'PENDING');
  assert.equal(template.backupAuthorization.authorizedForProductionWrite, false);
});

test('possible test records require explicit indicators, not names or unusual data', () => {
  assert.deepEqual(explicitTestIndicators({ name: 'Odd Test-Looking Name' }), []);
  assert.deepEqual(explicitTestIndicators({ email: 'qa@mailinator.com' }), ['MAILINATOR_DOMAIN']);
  assert.deepEqual(explicitTestIndicators({ isTest: true }), ['EXPLICIT_TEST_METADATA']);
  assert.deepEqual(explicitTestIndicators({ reservationCode: 'TEST-001' }), ['DOCUMENTED_TEST_RESERVATION_PREFIX']);
  const item = buildAdministratorReviewItems({ queue: [queueItem()], contextBySource: new Map() })[0];
  const context = new Map([[`reservations:${item.sourceRecordId}`, { email: 'qa@mailinator.com' }]]);
  const candidates = buildPossibleTestRecordReport([item], context);
  assert.equal(candidates[0].label, 'POSSIBLE_TEST_RECORD — ADMIN REVIEW REQUIRED');
  assert.equal(candidates[0].requestedDecision, '');
});

test('branch forms leave legal approvals blank and isolate Guadalupe templates', () => {
  const forms = buildBranchApprovalForms();
  assert.equal(forms.gilPuyat.officialLegalName, '');
  assert.equal(forms.gilPuyat.finalStatus, 'PENDING');
  assert.equal(forms.gilPuyat.authorizedContractTemplates.length, 0);
  assert.equal(forms.guadalupe.officialLegalAddress, '');
  assert.deepEqual(forms.guadalupe.supportedContractTemplates, []);
  assert.equal(forms.guadalupe.templateStatus, 'NONE PENDING APPROVAL');
});

test('private-room decision remains unresolved and has no selected option', () => {
  const form = buildPrivateRoomDecisionForm();
  assert.equal(form.selectedOption, '');
  assert.equal(form.finalStatus, 'PENDING');
  assert.equal(form.blockerCodeUntilApproved, 'PRIVATE_ROOM_BED_SLOT_UNRESOLVED');
});

test('pricing matrix contains only six template proposals and no approvals', () => {
  const matrix = buildPricingApprovalMatrix();
  assert.equal(matrix.rows.length, 6);
  assert.match(matrix.status, /ADMIN CONFIRMATION REQUIRED/);
  assert.equal(matrix.rows.every((row) => row.approvedBy === '' && row.finalStatus === 'PENDING'), true);
  const privateShort = matrix.rows.find((row) => (
    row.roomType === 'PRIVATE_ROOM' && row.leaseType === 'SHORT_TERM'
  ));
  assert.equal(privateShort.regularRental, '16000.00');
  assert.equal(privateShort.promoRental, '14400.00');
  assert.equal(privateShort.reservationFee, '2000.00');
});

test('contract date form does not assume move-in is contract start', () => {
  const form = buildContractDatePolicyForm();
  assert.equal(form.moveInDateEqualsContractStartDate, '');
  assert.match(form.explicitWarning, /not automatically/);
  assert.equal(form.finalStatus, FINAL_REVIEW_STATUS.PENDING);
});

test('eligibility requires approved exact link and blocks active exclusions', () => {
  assert.equal(classifyMigrationEligibility({
    finalStatus: 'APPROVED',
    proposedDisposition: 'LINK_TO_EXISTING_USER',
    existingUserId: '64b000000000000000000001',
  }, 'ACTIVE_OR_CURRENT'), MIGRATION_ELIGIBILITY.ELIGIBLE_FOR_CANONICAL_MIGRATION);
  assert.equal(classifyMigrationEligibility({
    finalStatus: 'APPROVED',
    proposedDisposition: 'HISTORICAL_RECORD_EXCLUDED',
  }, 'COMPLETED_OR_HISTORICAL'), MIGRATION_ELIGIBILITY.EXCLUDED_WITH_APPROVAL);
  assert.equal(classifyMigrationEligibility({
    finalStatus: 'APPROVED',
    proposedDisposition: 'HISTORICAL_RECORD_EXCLUDED',
  }, 'ACTIVE_OR_CURRENT'), MIGRATION_ELIGIBILITY.BLOCKED_PENDING_EVIDENCE);
  assert.equal(classifyMigrationEligibility({
    finalStatus: 'PENDING',
    proposedDisposition: IDENTITY_DISPOSITION.LINK_TO_EXISTING_USER,
  }, 'ACTIVE_OR_CURRENT'), MIGRATION_ELIGIBILITY.BLOCKED_PENDING_EVIDENCE);
});
