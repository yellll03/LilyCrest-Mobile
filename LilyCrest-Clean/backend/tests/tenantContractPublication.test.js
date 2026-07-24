'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/user.controller');
const { createDraftRecord, publishPreReleaseRecord } = require('../domain/contracts/generatedContractRecord');

test('tenant contract query is owner scoped and only returns published states', async () => {
  let captured;
  const expected = { status: 'PRE_RELEASE_TEST' };
  const db = { collection: () => ({ findOne: async (query) => { captured = query; return expected; } }) };
  assert.equal(await __test.findTenantVisibleContract(db, { _id: 'mongo-a', user_id: 'tenant-a' }), expected);
  assert.deepEqual(captured.status.$in, ['PRE_RELEASE_TEST', 'APPROVED', 'ACTIVE']);
  assert.ok(captured.$or.some((condition) => condition.userId === 'tenant-a'));
  assert.ok(!JSON.stringify(captured).includes('tenant-b'));
});

test('pre-release contract uses a tenant-safe label and hides internal metadata', () => {
  const document = __test.tenantContractDocument({
    status: 'PRE_RELEASE_TEST',
    publicDocumentId: 'public-random-id',
    testFileUrl: 'https://files.example.test/owned.pdf',
    snapshot: {
      contractStartDate: '2026-08-01',
      contractEndDate: '2026-12-01',
      roomNumber: 'GP-205',
      branchName: 'LilyCrest Residences – Gil Puyat',
      leaseType: 'SHORT_TERM',
    },
  });
  assert.equal(document.status, 'Pre-release Test Contract');
  assert.equal(document.label, 'Lease Contract');
  assert.equal(document.leaseType, 'Short-term');
  assert.equal(document.templateKey, undefined);
  assert.equal(document.generatorVersion, undefined);
  assert.equal(document.contractId, undefined);
});

test('controlled publication preserves snapshot immutability and never claims approval', () => {
  const draft = createDraftRecord({
    userId: 'tenant-a', tenantId: 'tenant-a', reservationId: 'reservation-a',
    snapshot: { tenantLegalName: 'Verified Legal Name' },
  }, new Date('2026-07-24T00:00:00.000Z'));
  const published = publishPreReleaseRecord(draft, {
    testFileUrl: 'https://files.example.test/owned.pdf',
    publishedBy: 'qa-admin',
    publishedAt: '2026-07-24T01:00:00.000Z',
  });
  assert.equal(published.status, 'PRE_RELEASE_TEST');
  assert.equal(published.finalFileUrl, null);
  assert.equal(published.snapshotSha256, draft.snapshotSha256);
});
