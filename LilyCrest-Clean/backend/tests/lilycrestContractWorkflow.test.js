'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOfficialLegalText } = require('../domain/contracts/officialLegalText');
const { overlayOfficialTemplate } = require('../domain/contracts/officialTemplateOverlay');
const { selectTemplate } = require('../domain/contracts/templateRegistry');
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

test('official PDF remains the base and only verified fields are overlaid', async () => {
  const rendered = await overlayOfficialTemplate(selectTemplate('QUADRUPLE_SHARING', 'SHORT_TERM'), {
    tenantLegalName: 'Verified Tenant',
    tenantResidentialAddress: '7 Main Street, Makati',
    roomNumber: 'GP-205',
    bedSlotNumber: 'upper',
    leaseDurationMonths: 4,
    contractStartDate: '2026-07-20T00:00:00.000Z',
    contractEndDate: '2026-11-20T00:00:00.000Z',
    generatedAt: '2026-07-24T00:00:00.000Z',
  });
  assert.equal(rendered.bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal(rendered.comparison.baseTemplatePreserved, true);
  assert.equal(rendered.comparison.legalTextRecreated, false);
  assert.equal(rendered.comparison.dimensionsMatch, true);
  assert.equal(rendered.comparison.allFieldsFit, true);
  assert.equal(rendered.comparison.overlayFieldCount, 12);
});
