'use strict';

const { validateTemplateReadiness } = require('./templateRegistry');

const FORBIDDEN_PLACEHOLDERS = /\b(?:N\/A|TBD|Unknown|Sample|Guest)\b/i;
const REQUIRED_PRICING_FIELDS = Object.freeze([
  'regularMonthlyRental', 'promoMonthlyRental', 'approvedMonthlyRental',
  'reservationFee', 'advanceRent', 'securityDeposit', 'approvedBy',
  'approvedAt', 'approvalReference',
]);

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function validatePricing(pricing) {
  if (!pricing || REQUIRED_PRICING_FIELDS.some((field) => !present(pricing[field]))) {
    return 'PRICING_INCOMPLETE';
  }
  if (pricing.currency !== 'PHP' || pricing.reservationFeeApplication !== 'ADVANCE_RENT_ONLY') {
    return 'PRICING_CONFLICT';
  }
  if (pricing.approvalStatus !== 'APPROVED') return 'PRICING_APPROVAL_MISSING';
  return null;
}

function validateDraftSnapshot(snapshot) {
  const blockers = [];
  const add = (code) => { if (!blockers.includes(code)) blockers.push(code); };
  if (!present(snapshot?.reservationId) || snapshot?.reservationStatus !== 'APPROVED') add('APPROVED_RESERVATION_NOT_FOUND');
  if (!present(snapshot?.tenantId)) add('TENANT_RECORD_NOT_FOUND');
  if (!snapshot?.ownershipVerified) add('ACCOUNT_OWNERSHIP_MISMATCH');
  if (!present(snapshot?.tenantLegalName)) add('LEGAL_NAME_MISSING');
  if (!present(snapshot?.tenantResidentialAddress)) add('ADDRESS_MISSING');
  if (!present(snapshot?.branchId) || !present(snapshot?.branchCode)) add('BRANCH_NOT_FOUND');
  if (!present(snapshot?.roomId) || !present(snapshot?.roomNumber)) add('ROOM_ASSIGNMENT_MISSING');
  if (!present(snapshot?.roomType)) add('ROOM_TYPE_UNSUPPORTED');
  if (snapshot?.roomType === 'PRIVATE_ROOM') add('PRIVATE_ROOM_BED_SLOT_UNRESOLVED');
  else if (!present(snapshot?.bedId) || !present(snapshot?.bedSlotNumber)) add('BED_SLOT_MISSING');
  if (!present(snapshot?.contractStartDate) || !present(snapshot?.contractEndDate)) add('LEASE_DATES_MISSING');
  if (!present(snapshot?.leaseType)) add('LEASE_TYPE_MISMATCH');

  const pricingBlocker = validatePricing(snapshot?.pricing);
  if (pricingBlocker) add(pricingBlocker);

  const template = validateTemplateReadiness({
    roomType: snapshot?.roomType,
    leaseType: snapshot?.leaseType,
    branchCode: snapshot?.branchCode,
  });
  if (!template.ok) add(template.blockerCode);

  const renderedValues = [
    snapshot?.tenantLegalName, snapshot?.tenantResidentialAddress, snapshot?.roomNumber,
    snapshot?.bedSlotNumber, snapshot?.contractNumber,
  ].filter(present);
  if (renderedValues.some((value) => FORBIDDEN_PLACEHOLDERS.test(String(value)))) add('CONTRACT_DATA_INCOMPLETE');

  return { ok: blockers.length === 0, blockers, template: template.template || null };
}

module.exports = {
  FORBIDDEN_PLACEHOLDERS,
  REQUIRED_PRICING_FIELDS,
  validateDraftSnapshot,
  validatePricing,
};
