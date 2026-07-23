'use strict';

const RESERVATION_FEE_APPLICATION = 'COMBINED_ADVANCE_AND_SECURITY';

function toCents(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${fieldName} is required.`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`${fieldName} must be a non-negative amount.`);
  }
  return Math.round(amount * 100);
}

function calculateMoveInFinancials({ advanceRent, securityDeposit, reservationFeeAlreadyPaid }) {
  const advanceRentCents = toCents(advanceRent, 'advanceRent');
  const securityDepositCents = toCents(securityDeposit, 'securityDeposit');
  const reservationFeeCents = toCents(reservationFeeAlreadyPaid, 'reservationFeeAlreadyPaid');
  const totalDueBeforeMoveInCents = advanceRentCents + securityDepositCents;
  const remainingBalanceCents = totalDueBeforeMoveInCents - reservationFeeCents;

  return Object.freeze({
    advanceRent: advanceRentCents / 100,
    securityDeposit: securityDepositCents / 100,
    reservationFeeAlreadyPaid: reservationFeeCents / 100,
    totalDueBeforeMoveIn: totalDueBeforeMoveInCents / 100,
    remainingBalance: remainingBalanceCents / 100,
    reservationFeeApplication: RESERVATION_FEE_APPLICATION,
  });
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function extractMoveInFinancials(source = {}) {
  const pricing = source.pricing || {};
  const charges = source.charges || {};
  const advanceRent = firstPresent(
    source.advanceRent, source.advance_rent, pricing.advanceRent, pricing.advance_rent,
    charges.advanceRent, charges.advance_rent,
  );
  const securityDeposit = firstPresent(
    source.securityDeposit, source.security_deposit, pricing.securityDeposit, pricing.security_deposit,
    charges.securityDeposit, charges.security_deposit,
  );
  const reservationFeeAlreadyPaid = firstPresent(
    source.reservationFeeAlreadyPaid, source.reservation_fee_already_paid,
    source.reservationFee, source.reservation_fee,
    pricing.reservationFeeAlreadyPaid, pricing.reservationFee,
    charges.reservationFeeAlreadyPaid, charges.reservationFee,
  );

  if ([advanceRent, securityDeposit, reservationFeeAlreadyPaid].some((value) => value === undefined)) {
    return null;
  }
  return calculateMoveInFinancials({ advanceRent, securityDeposit, reservationFeeAlreadyPaid });
}

module.exports = {
  RESERVATION_FEE_APPLICATION,
  calculateMoveInFinancials,
  extractMoveInFinancials,
};
