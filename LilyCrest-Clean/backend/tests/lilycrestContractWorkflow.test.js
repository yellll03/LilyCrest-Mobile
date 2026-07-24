'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOfficialLegalText } = require('../domain/contracts/officialLegalText');
const { personalizeDefinition } = require('../domain/contracts/longBondRenderer');
const {
  addMonths, fullLegalName, pricingFromOfficialTemplate, residentialAddress, roomType,
} = require('../services/contractPublication.service');

test('existing reservation fields resolve without a duplicate stay or approval entity', async () => {
  const official = await extractOfficialLegalText('QUADRUPLE_SHARING', 'SHORT_TERM');
  const pricing = pricingFromOfficialTemplate(official.definition);
  assert.equal(roomType('quadruple-sharing'), 'QUADRUPLE_SHARING');
  assert.equal(fullLegalName({ firstName: 'Verified', lastName: 'Tenant' }), 'Verified Tenant');
  assert.equal(residentialAddress({ address: { unitHouseNo: '7', street: 'Main', city: 'Makati' } }), '7, Main, Makati');
  assert.equal(addMonths('2026-07-20T00:00:00.000Z', 4).toISOString(), '2026-11-20T00:00:00.000Z');
  assert.deepEqual(pricing, {
    regularMonthlyRental: 7000,
    approvedMonthlyRental: 6300,
    advanceRent: 6300,
    securityDeposit: 6300,
    reservationFee: 2000,
  });
});

test('official contract text is populated only with verified snapshot fields', async () => {
  const official = await extractOfficialLegalText('QUADRUPLE_SHARING', 'SHORT_TERM');
  const personalized = personalizeDefinition(official.definition, {
    tenantLegalName: 'Verified Tenant',
    tenantResidentialAddress: '7 Main Street, Makati',
    roomNumber: 'GP-205',
    bedSlotNumber: 'upper',
    leaseDurationMonths: 4,
    contractStartDate: '2026-07-20T00:00:00.000Z',
    contractEndDate: '2026-11-20T00:00:00.000Z',
    generatedAt: '2026-07-24T00:00:00.000Z',
  });
  assert.match(personalized.introductoryClauses, /Verified Tenant/);
  assert.match(personalized.introductoryClauses, /Room GP-205, Bed\/Slot No\. upper/);
  assert.match(personalized.numberedSections[1].text, /period of 4 \(4\) months/);
  assert.doesNotMatch(personalized.numberedSections[1].text, /_{4,}/);
});
