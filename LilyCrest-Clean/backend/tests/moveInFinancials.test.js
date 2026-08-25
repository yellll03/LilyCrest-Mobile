'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESERVATION_FEE_APPLICATION,
  calculateMoveInFinancials,
  extractMoveInFinancials,
} = require('../domain/billing/moveInFinancials');
const { validatePricing } = require('../domain/contracts/contractDraftValidation');
const {
  applyMoveInFinancials,
  isMoveInFinancialBill,
  mapRealBill,
  normalizeLegacyBill,
} = require('../controllers/billing.controller');
const { canonicalizeSnapshotPricing } = require('../domain/contracts/generatedContractRecord');

const expected = {
  advanceRent: 7200,
  securityDeposit: 7200,
  reservationFeeAlreadyPaid: 2000,
  totalDueBeforeMoveIn: 14400,
  remainingBalance: 12400,
  reservationFeeApplication: RESERVATION_FEE_APPLICATION,
};

test('Section 4 credits the reservation fee against advance plus security deposit', () => {
  assert.deepEqual(calculateMoveInFinancials({
    advanceRent: 7200,
    securityDeposit: 7200,
    reservationFeeAlreadyPaid: 2000,
  }), expected);
});

test('calculation uses integer cents and preserves the exact legal subtraction', () => {
  assert.deepEqual(calculateMoveInFinancials({
    advanceRent: '7200.10',
    securityDeposit: '7200.20',
    reservationFeeAlreadyPaid: '2000.05',
  }), {
    ...expected,
    advanceRent: 7200.1,
    securityDeposit: 7200.2,
    reservationFeeAlreadyPaid: 2000.05,
    totalDueBeforeMoveIn: 14400.3,
    remainingBalance: 12400.25,
  });
});

test('extractor requires all three authoritative monetary inputs', () => {
  assert.equal(extractMoveInFinancials({ advanceRent: 7200, securityDeposit: 7200 }), null);
  assert.deepEqual(extractMoveInFinancials({
    pricing: { advanceRent: 7200, securityDeposit: 7200, reservationFee: 2000 },
  }), expected);
});

test('contract pricing rejects the former advance-only allocation', () => {
  const base = {
    regularMonthlyRental: 7200,
    promoMonthlyRental: 7200,
    approvedMonthlyRental: 7200,
    reservationFee: 2000,
    advanceRent: 7200,
    securityDeposit: 7200,
    totalDueBeforeMoveIn: 14400,
    remainingBalance: 12400,
    currency: 'PHP',
    approvalStatus: 'APPROVED',
    approvedBy: 'admin-1',
    approvedAt: '2026-07-24T00:00:00Z',
    approvalReference: 'section-4',
  };
  assert.equal(validatePricing({
    ...base,
    reservationFeeApplication: 'ADVANCE_RENT_ONLY',
  }), 'PRICING_CONFLICT');
  assert.equal(validatePricing({
    ...base,
    reservationFeeApplication: RESERVATION_FEE_APPLICATION,
  }), null);
});

test('contract generation snapshots canonicalize Section 4 totals', () => {
  const snapshot = canonicalizeSnapshotPricing({
    pricing: {
      advanceRent: 7200,
      securityDeposit: 7200,
      reservationFee: 2000,
      reservationFeeApplication: 'ADVANCE_RENT_ONLY',
    },
  });
  assert.deepEqual(snapshot.pricing, {
    advanceRent: 7200,
    securityDeposit: 7200,
    reservationFee: 2000,
    reservationFeeApplication: RESERVATION_FEE_APPLICATION,
    totalDueBeforeMoveIn: 14400,
    remainingBalance: 12400,
  });
});

test('billing serializers use the same remaining move-in balance', () => {
  const legacy = normalizeLegacyBill({
    billing_id: 'move-in-legacy',
    status: 'unpaid',
    advance_rent: 7200,
    security_deposit: 7200,
    reservation_fee: 2000,
    total: 7200,
  });
  assert.equal(legacy.total, 12400);
  assert.deepEqual(legacy.move_in_financials, expected);

  const real = mapRealBill({
    _id: { toString: () => 'move-in-real' },
    status: 'unpaid',
    advanceRent: 7200,
    securityDeposit: 7200,
    reservationFeeAlreadyPaid: 2000,
    totalAmount: 7200,
  }, 'tenant-1');
  assert.equal(real.total, 12400);
  assert.equal(real.remaining_amount, 12400);
  assert.deepEqual(real.move_in_financials, expected);
});

test('settled move-in bill never displays ₱0 when the reservation fee fully covered advance rent + deposit', () => {
  const fullyCreditedFinancials = calculateMoveInFinancials({
    advanceRent: 3600,
    securityDeposit: 3600,
    reservationFeeAlreadyPaid: 7200,
  });
  assert.equal(fullyCreditedFinancials.remainingBalance, 0);

  const settledBill = applyMoveInFinancials({
    billing_id: 'move-in-settled',
    description: 'Advance Rent and Security Deposit',
    status: 'paid',
    total: 7200,
  }, fullyCreditedFinancials);
  assert.equal(settledBill.total, 7200);
  assert.equal(settledBill.amount, 7200);
  assert.equal(settledBill.remaining_amount, 0);

  const settledReal = mapRealBill({
    _id: { toString: () => 'move-in-settled-real' },
    status: 'paid',
    advanceRent: 3600,
    securityDeposit: 3600,
    reservationFeeAlreadyPaid: 7200,
    totalAmount: 7200,
  }, 'tenant-1');
  assert.equal(settledReal.total, 7200);
  assert.equal(settledReal.amount, 7200);
  assert.equal(settledReal.remaining_amount, 0);

  const settledLegacy = normalizeLegacyBill({
    billing_id: 'move-in-settled-legacy',
    status: 'paid',
    advance_rent: 3600,
    security_deposit: 3600,
    reservation_fee: 7200,
    total: 7200,
  });
  assert.equal(settledLegacy.total, 7200);
  assert.equal(settledLegacy.amount, 7200);
  assert.equal(settledLegacy.remaining_amount, 0);
});

test('settled move-in bill with a genuine remaining balance still shows what was actually paid, not the pre-credit total', () => {
  const partialCreditFinancials = calculateMoveInFinancials({
    advanceRent: 6300,
    securityDeposit: 6300,
    reservationFeeAlreadyPaid: 2000,
  });
  assert.equal(partialCreditFinancials.remainingBalance, 10600);
  assert.equal(partialCreditFinancials.totalDueBeforeMoveIn, 12600);

  const settledBill = applyMoveInFinancials({
    billing_id: 'move-in-partial-settled',
    description: 'Advance Rent and Security Deposit',
    status: 'paid',
    total: 6300,
  }, partialCreditFinancials);
  // Must show the ₱10,600 actually collected at move-in, not the ₱12,600
  // pre-credit total and not ₱0.
  assert.equal(settledBill.total, 10600);
  assert.equal(settledBill.amount, 10600);
});

test('approved reservation financials only enrich explicit move-in bills', () => {
  assert.equal(isMoveInFinancialBill({ description: 'Move-in Charges' }), true);
  assert.equal(isMoveInFinancialBill({ description: 'August 2026 Billing Statement' }), false);
  assert.deepEqual(
    applyMoveInFinancials({ billing_id: 'monthly', description: 'August 2026 Billing Statement', total: 7200 }, expected),
    { billing_id: 'monthly', description: 'August 2026 Billing Statement', total: 7200 },
  );
  const moveInBill = applyMoveInFinancials({
    billing_id: 'move-in',
    description: 'Advance Rent and Security Deposit',
    status: 'unpaid',
    total: 7200,
  }, expected);
  assert.equal(moveInBill.total, 12400);
  assert.deepEqual(moveInBill.move_in_financials, expected);
});
