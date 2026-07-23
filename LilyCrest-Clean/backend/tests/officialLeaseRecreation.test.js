'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFParse } = require('pdf-parse');
const { APPROVED_TEMPLATE_KEYS, LONG_BOND } = require('../domain/contracts/templateRegistry');
const {
  SECTION_MARKERS, extractOfficialLegalText, singleLineLegalText,
} = require('../domain/contracts/officialLegalText');
const { renderOfficialLease } = require('../domain/contracts/longBondRenderer');
const { validateDraftSnapshot } = require('../domain/contracts/contractDraftValidation');
const {
  approveRecord, assertImmutableApprovedRecord, createDraftRecord,
} = require('../domain/contracts/generatedContractRecord');

function keyParts(key) {
  const match = key.match(/^(PRIVATE_ROOM|DOUBLE_SHARING|QUADRUPLE_SHARING)_(SHORT_TERM|LONG_TERM)$/);
  return [match[1], match[2]];
}

test('all six sources produce exact ordered legal structures', async () => {
  for (const key of APPROVED_TEMPLATE_KEYS) {
    const result = await extractOfficialLegalText(...keyParts(key));
    assert.equal(result.ok, true, key);
    assert.equal(result.definition.templateKey, key);
    assert.equal(result.definition.numberedSections.length, 7);
    assert.deepEqual(result.definition.numberedSections.map((section) => section.marker), SECTION_MARKERS);
    assert.equal(result.definition.sourceText.includes('LILYCREST GIL PUYAT'), true);
    assert.equal(result.definition.sourceText.includes('ACKNOWLEDGMENT'), true);
  }
});

test('recreated comparison PDF uses long-bond dimensions and preserves source wording', async () => {
  const source = await extractOfficialLegalText('DOUBLE_SHARING', 'LONG_TERM');
  const pdf = await renderOfficialLease(source.definition);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  const parser = new PDFParse({ data: pdf });
  try {
    const info = await parser.getInfo({ parsePageInfo: true });
    for (const page of info.pages) {
      assert.equal(Math.round(page.width), LONG_BOND.widthPoints);
      assert.equal(Math.round(page.height), LONG_BOND.heightPoints);
    }
    const text = await parser.getText();
    const generated = singleLineLegalText(text.text);
    assert.equal(generated, source.definition.sourceText);
  } finally {
    await parser.destroy();
  }
});

test('draft validation fails closed for branch, pricing, private-room and identity gaps', () => {
  const result = validateDraftSnapshot({
    roomType: 'PRIVATE_ROOM',
    leaseType: 'LONG_TERM',
    branchCode: 'GUADALUPE',
    pricing: { currency: 'PHP' },
  });
  for (const expected of [
    'APPROVED_RESERVATION_NOT_FOUND', 'TENANT_RECORD_NOT_FOUND', 'ACCOUNT_OWNERSHIP_MISMATCH',
    'LEGAL_NAME_MISSING', 'ADDRESS_MISSING', 'BRANCH_NOT_FOUND', 'ROOM_ASSIGNMENT_MISSING',
    'PRIVATE_ROOM_BED_SLOT_UNRESOLVED', 'LEASE_DATES_MISSING', 'PRICING_INCOMPLETE',
    'TEMPLATE_BRANCH_MISMATCH',
  ]) assert.equal(result.blockers.includes(expected), true, expected);
});

test('approved snapshots remain immutable and renewal creates a separate record', () => {
  const draft = createDraftRecord({
    contractId: 'contract-v1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    reservationId: 'reservation-1',
    stayId: 'stay-1',
    branchId: 'gil-puyat',
    roomId: 'room-1',
    bedId: 'bed-1',
    templateKey: 'DOUBLE_SHARING_LONG_TERM',
    sourceTemplateSha256: 'source-hash',
    version: 1,
    snapshot: { tenantLegalName: 'María Dela Cruz', approvedMonthlyRental: 7200 },
    generatedBy: 'admin-1',
  }, new Date('2026-07-24T00:00:00Z'));
  const approved = approveRecord(draft, {
    approvedBy: 'admin-2',
    approvedAt: '2026-07-25T00:00:00Z',
    finalFileUrl: 'private-contracts/contract-v1.pdf',
    activate: true,
  });
  assert.equal(assertImmutableApprovedRecord(approved, structuredClone(approved)), true);

  const changed = structuredClone(approved);
  changed.snapshot.approvedMonthlyRental = 1;
  assert.throws(() => assertImmutableApprovedRecord(approved, changed), /snapshot is immutable/);

  const renewal = createDraftRecord({
    ...draft,
    contractId: 'contract-v2',
    previousContractId: approved.contractId,
    version: 2,
    snapshot: { ...draft.snapshot, approvedMonthlyRental: 7400 },
  });
  assert.notEqual(renewal.contractId, approved.contractId);
  assert.equal(renewal.previousContractId, approved.contractId);
  assert.equal(approved.snapshot.approvedMonthlyRental, 7200);
});
