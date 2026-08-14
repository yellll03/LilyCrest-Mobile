'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const {
  REVIEW_STATUS, maskEmail, maskPhone, buildIdentityReviewQueue,
  summarizeReviewQueue, validateManualResolutionInput,
} = require('../migrations/identityReview');
const {
  GIL_PUYAT_TEMPLATE_WORDING, validateBranchLegalApproval,
  createBranchApprovalWorksheets,
} = require('../migrations/branchLegalApproval');
const { BranchRepository, canonicalBranchDocument } = require('../repositories/branchRepository');
const { validateCommand: validateBranchCommand } = require('../scripts/approveCanonicalBranch');

function manualOptions(overrides = {}) {
  return {
    sourceCollection: 'reservations',
    sourceRecordId: new ObjectId().toHexString(),
    selectedUserId: new ObjectId().toHexString(),
    administrator: 'Administrator',
    approvalReference: 'APPROVAL-001',
    reason: 'Verified against approved migration record.',
    backupReference: 'BACKUP-001',
    migrationBatchId: 'batch-001',
    expectedSourceHash: 'a'.repeat(64),
    evidenceType: 'APPROVED_EXPLICIT_MAPPING',
    evidenceReference: 'MAPPING-001',
    confirm: true,
    ...overrides,
  };
}

function approvedBranch(overrides = {}) {
  return {
    branchId: 'BRANCH_GIL_PUYAT',
    slug: 'gil-puyat',
    legalName: GIL_PUYAT_TEMPLATE_WORDING.legalName,
    displayName: 'Lilycrest Gil Puyat',
    legalAddress: {
      addressLine1: '#7 Gil Puyat Ave. corner Marconi St.',
      addressLine2: null,
      barangay: 'Administrator verified',
      city: 'Makati City',
      province: null,
      postalCode: null,
      country: 'Philippines',
      formattedAddress: GIL_PUYAT_TEMPLATE_WORDING.formattedAddress,
    },
    coordinates: null,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=test',
    status: 'ACTIVE',
    supportedContractTemplates: ['PRIVATE_ROOM_SHORT_TERM'],
    sourceDocumentReference: 'OFFICIAL-TEMPLATE-001',
    approvalReference: 'APPROVAL-001',
    legalDataApprovedBy: new ObjectId().toHexString(),
    legalDataApprovedAt: new Date(),
    ...overrides,
  };
}

test('manual identity resolution requires exact canonical user selection and controlled evidence', () => {
  assert.equal(validateManualResolutionInput(manualOptions()), true);
  assert.throws(() => validateManualResolutionInput(manualOptions({
    selectedUserId: 'similar@example.com',
  })), /canonical user ObjectId/);
  assert.throws(() => validateManualResolutionInput(manualOptions({
    evidenceType: 'EMAIL_SIMILARITY',
  })), /approved exact evidence type/);
});

test('manual identity approval requires administrator, reference, backup, and confirmation', () => {
  for (const field of ['administrator', 'approvalReference', 'backupReference']) {
    assert.throws(() => validateManualResolutionInput(manualOptions({ [field]: '' })), /blocked/);
  }
  assert.throws(() => validateManualResolutionInput(manualOptions({ confirm: false })), /confirm/);
});

test('review queue preserves source IDs, remains pending, and does not mutate analysis', () => {
  const sourceId = new ObjectId().toHexString();
  const analysis = {
    summary: {
      totalSourceRecordsScanned: 1, resolved: 0, deletedAccountCandidates: 0,
      ambiguous: 0, mixedStringObjectIdCases: 1,
    },
    records: [{
      sourceCollection: 'reservations',
      sourceRecordId: sourceId,
      sourceField: 'userId',
      legacyIdentityValue: new ObjectId().toHexString(),
      legacyIdentityType: 'OBJECT_ID',
      legacyIdentityStorageType: 'OBJECT_ID',
      resolvedUserObjectId: null,
      resolutionStatus: 'UNRESOLVED',
      evidence: [],
      blockerCodes: ['RESERVATION_OWNER_UNRESOLVED'],
    }],
  };
  const before = JSON.stringify(analysis);
  const queue = buildIdentityReviewQueue({
    analysis,
    reservations: [{ _id: new ObjectId(sourceId), reservationCode: 'RES-001' }],
  });
  assert.equal(queue[0].sourceRecordId, sourceId);
  assert.equal(queue[0].reservationCode, 'RES-001');
  assert.equal(queue[0].reviewStatus, REVIEW_STATUS.PENDING_REVIEW);
  assert.equal(JSON.stringify(analysis), before);
  const summary = summarizeReviewQueue({ analysis, queue });
  assert.equal(summary.pendingManualReview, 1);
  assert.equal(summary.unresolvedWithNoCandidate, 1);
});

test('review contact masking does not expose full email or phone', () => {
  assert.equal(maskEmail('person@example.com'), 'pe****@example.com');
  assert.equal(maskPhone('+639171234567'), '*********4567');
});

test('Gil Puyat legal data must exactly match approved template wording', () => {
  assert.equal(validateBranchLegalApproval(approvedBranch()).ok, true);
  assert.equal(validateBranchLegalApproval(approvedBranch({ legalName: 'Lilycrest Gil Puyat' })).ok, false);
  const changedAddress = approvedBranch();
  changedAddress.legalAddress = { ...changedAddress.legalAddress, formattedAddress: 'Normalized address' };
  assert.equal(validateBranchLegalApproval(changedAddress).ok, false);
});

test('Guadalupe cannot inherit Gil Puyat templates and blank legal addresses are blocked', () => {
  const guadalupe = approvedBranch({
    branchId: 'BRANCH_GUADALUPE',
    slug: 'guadalupe',
    legalName: 'Administrator supplied',
    supportedContractTemplates: ['PRIVATE_ROOM_SHORT_TERM'],
  });
  assert.match(validateBranchLegalApproval(guadalupe).errors.join(' '), /cannot inherit/);
  const blankAddress = approvedBranch();
  blankAddress.legalAddress = { ...blankAddress.legalAddress, addressLine1: '' };
  assert.equal(validateBranchLegalApproval(blankAddress).ok, false);
});

test('unsupported branch template keys are rejected', () => {
  const result = validateBranchLegalApproval(approvedBranch({
    supportedContractTemplates: ['UNAPPROVED_TEMPLATE'],
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Unsupported contract template/);
});

test('approval worksheets leave legal data blank and Guadalupe templates empty', () => {
  const worksheets = createBranchApprovalWorksheets([
    { field: 'branch', value: 'gil-puyat' },
    { field: 'branch', value: 'guadalupe' },
  ]);
  const gil = worksheets.find((item) => item.proposedBranchId === 'BRANCH_GIL_PUYAT');
  const guadalupe = worksheets.find((item) => item.proposedBranchId === 'BRANCH_GUADALUPE');
  assert.equal(gil.legalName, '');
  assert.equal(gil.legalAddress.formattedAddress, '');
  assert.deepEqual(guadalupe.supportedContractTemplates, []);
  assert.deepEqual(guadalupe.blockerCodes, ['BRANCH_LEGAL_DATA_MISSING', 'TEMPLATE_BRANCH_MISMATCH']);
});

test('branch approval command rejects missing production gates before connection', () => {
  assert.throws(() => validateBranchCommand({ confirm: true }), /Missing approval gates/);
});

test('branch repository approval is idempotent and conflicting legal data cannot overwrite', async () => {
  const existing = { _id: new ObjectId(), ...canonicalBranchDocument(approvedBranch()) };
  const collection = {
    async findOne() { return existing; },
    async insertOne() { throw new Error('must not insert'); },
  };
  const repository = new BranchRepository({ collection: () => collection });
  const same = await repository.createApproved(approvedBranch());
  assert.equal(same.idempotent, true);
  await assert.rejects(
    repository.createApproved(approvedBranch({ displayName: 'Conflicting name' })),
    /silent overwrite is prohibited/,
  );
});
