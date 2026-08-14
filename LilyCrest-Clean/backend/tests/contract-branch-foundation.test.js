'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { validateBranchRecord } = require('../repositories/branchRepository');
const { analyzeBranchSeed, analyzeBranchIndexSafety } = require('../migrations/branchMigration');
const { assertWriteGates, buildAuditRecord } = require('../migrations/migrationSafety');

function validBranch(overrides = {}) {
  return {
    branchId: 'BRANCH_GIL_PUYAT',
    slug: 'gil-puyat',
    legalName: 'Administrator Verified Legal Name',
    displayName: 'Verified Display Name',
    legalAddress: {
      addressLine1: 'Verified address line',
      addressLine2: null,
      barangay: 'Verified barangay',
      city: 'Makati City',
      province: null,
      postalCode: null,
      country: 'Philippines',
      formattedAddress: 'Verified formatted address',
    },
    coordinates: null,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=test',
    status: 'ACTIVE',
    supportedContractTemplates: ['PRIVATE_ROOM_SHORT_TERM'],
    approvalReference: 'APPROVAL-TEST-001',
    legalDataApprovedBy: new ObjectId().toHexString(),
    legalDataApprovedAt: new Date(),
    ...overrides,
  };
}

test('complete administrator-approved branch data passes validation', () => {
  assert.deepEqual(validateBranchRecord(validBranch()), { ok: true, errors: [] });
});

test('missing legal address blocks branch creation', () => {
  const result = validateBranchRecord(validBranch({ legalAddress: null }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /legalAddress/);
});

test('room slug alone cannot create a legal branch', () => {
  const result = validateBranchRecord({ slug: 'gil-puyat' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /approvalReference/);
  assert.match(result.errors.join(' '), /legalName/);
});

test('coordinates require both valid latitude and longitude', () => {
  assert.equal(validateBranchRecord(validBranch({ coordinates: { latitude: 14.5 } })).ok, false);
  assert.equal(validateBranchRecord(validBranch({ coordinates: { latitude: 91, longitude: 121 } })).ok, false);
  assert.equal(validateBranchRecord(validBranch({ coordinates: { latitude: 14.5, longitude: 121 } })).ok, true);
});

test('unsupported template keys are rejected', () => {
  const result = validateBranchRecord(validBranch({ supportedContractTemplates: ['UNKNOWN_TEMPLATE'] }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /Unsupported contract template/);
});

test('observed branch values without approved legal records are reported, not proposed', () => {
  const report = analyzeBranchSeed([
    { collection: 'rooms', field: 'branch', value: 'gil-puyat' },
    { collection: 'rooms', field: 'branch', value: 'guadalupe' },
  ], []);
  assert.equal(report.proposedRecords.length, 0);
  assert.equal(report.readyToApply, false);
  assert.equal(report.conflicts.filter((item) => item.blockerCode === 'BRANCH_LEGAL_DATA_MISSING').length, 2);
});

test('duplicate canonical branch values block index creation and unrelated indexes are only reported', () => {
  const unrelated = { name: 'unrelated_index', key: { displayName: 1 } };
  const report = analyzeBranchIndexSafety([
    { _id: '1', branchId: 'BRANCH_A', slug: 'a' },
    { _id: '2', branchId: 'BRANCH_A', slug: 'b' },
  ], [unrelated]);
  assert.equal(report.safeToCreate, false);
  assert.equal(report.existingIndexes[0].name, 'unrelated_index');
  assert.equal(report.requiredIndexes.some((item) => item.name === 'unrelated_index'), false);
});

test('write mode requires every approval and backup gate', () => {
  assert.throws(() => assertWriteGates({ confirm: true }), /actorId/);
  assert.equal(assertWriteGates({
    confirm: true,
    actorId: 'actor',
    actorName: 'Admin',
    approvalReference: 'approval',
    backupReference: 'backup',
    migrationBatchId: 'batch',
  }), true);
});

test('audit records contain hashes rather than sensitive before/after records', () => {
  const audit = buildAuditRecord({
    action: 'TEST',
    actorId: 'actor',
    actorName: 'Admin',
    approvalReference: 'approval',
    migrationBatchId: 'batch',
    environment: 'test',
    targetCollection: 'branches',
    affectedRecordIds: [],
    before: { password: 'secret' },
    after: { token: 'secret' },
  });
  assert.equal('before' in audit, false);
  assert.equal('after' in audit, false);
  assert.equal(JSON.stringify(audit).includes('secret'), false);
  assert.match(audit.beforeHash, /^[a-f0-9]{64}$/);
});
