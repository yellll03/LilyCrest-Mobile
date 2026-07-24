'use strict';

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { admin, resolveStorageBucket } = require('../config/firebase');
const { resolveTenantBranch } = require('./branchLocation.service');
const { extractOfficialLegalText } = require('../domain/contracts/officialLegalText');
const { renderOfficialLease } = require('../domain/contracts/longBondRenderer');
const { createDraftRecord, publishPreReleaseRecord } = require('../domain/contracts/generatedContractRecord');
const { calculateMoveInFinancials, RESERVATION_FEE_APPLICATION } = require('../domain/billing/moveInFinancials');

const ELIGIBLE_RESERVATION_STATUS = /^(approved|confirmed|active|completed|checked_in|movein)$/i;

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function fullLegalName(reservation) {
  return [reservation?.firstName, reservation?.middleName, reservation?.lastName]
    .map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

function residentialAddress(reservation) {
  const address = reservation?.address || {};
  return [
    address.unitHouseNo, address.street, address.barangay, address.city,
    address.province, address.region,
  ].map((part) => String(part || '').trim()).filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index).join(', ');
}

function roomType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('quadruple')) return 'QUADRUPLE_SHARING';
  if (normalized.includes('double')) return 'DOUBLE_SHARING';
  if (normalized.includes('private')) return 'PRIVATE_ROOM';
  return null;
}

function addMonths(value, months) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setMonth(date.getMonth() + months);
  return date;
}

function pesoFromText(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function pricingFromOfficialTemplate(definition) {
  const rental = definition.numberedSections.find((section) => section.marker.startsWith('SECTION 3'))?.text;
  const deposits = definition.numberedSections.find((section) => section.marker.startsWith('SECTION 4'))?.text;
  return {
    regularMonthlyRental: pesoFromText(rental, /regular and basic monthly rental fee is Php ([\d,]+\.\d{2})/i),
    approvedMonthlyRental: pesoFromText(rental, /basic monthly rental fee to Php ([\d,]+\.\d{2})/i),
    advanceRent: pesoFromText(deposits, /advance rent in the amount of Php ([\d,]+\.\d{2})/i),
    securityDeposit: pesoFromText(deposits, /security deposit in the amount of Php ([\d,]+\.\d{2})/i),
    reservationFee: pesoFromText(deposits, /reservation fee of Php ([\d,]+\.\d{2})/i),
  };
}

async function resolveContractSnapshot(db, userId) {
  const user = await db.collection('users').findOne({ user_id: userId });
  if (!user) return { ok: false, blockers: ['TENANT_RECORD_NOT_FOUND'] };
  const owner = [{ userId: user._id }, { tenantId: user._id }, { user_id: userId }, { tenant_id: userId }];
  const reservation = await db.collection('reservations').findOne(
    { $and: [{ $or: owner }, { status: ELIGIBLE_RESERVATION_STATUS }] },
    { sort: { moveInDate: -1, updatedAt: -1, createdAt: -1 } },
  );
  if (!reservation) return { ok: false, blockers: ['APPROVED_RESERVATION_NOT_FOUND'] };

  const roomId = first(reservation.roomId);
  const room = roomId && ObjectId.isValid(String(roomId))
    ? await db.collection('rooms').findOne({ _id: new ObjectId(String(roomId)) })
    : null;
  let branch = null;
  try { branch = (await resolveTenantBranch(db, user)).branch; } catch (_) {}

  const duration = Number(reservation.leaseDuration);
  const startDate = first(reservation.moveInDate, reservation.targetMoveInDate);
  const endDate = Number.isInteger(duration) && duration > 0 && startDate ? addMonths(startDate, duration) : null;
  const leaseType = Number.isInteger(duration) && duration > 0 ? (duration < 6 ? 'SHORT_TERM' : 'LONG_TERM') : null;
  const normalizedRoomType = roomType(room?.type || reservation.preferredRoomType);
  const official = normalizedRoomType && leaseType
    ? await extractOfficialLegalText(normalizedRoomType, leaseType)
    : null;
  const pricing = official?.ok ? pricingFromOfficialTemplate(official.definition) : {};
  const reservationFee = Number(reservation.reservationFeeAmount);
  const legalName = fullLegalName(reservation);
  const address = residentialAddress(reservation);
  const bedId = first(reservation.selectedBed?.id, reservation.bedId);
  const blockers = [];
  if (!legalName) blockers.push('LEGAL_NAME_MISSING');
  if (!address) blockers.push('ADDRESS_MISSING');
  if (!room?._id || !room?.roomNumber) blockers.push('ROOM_ASSIGNMENT_MISSING');
  if (!bedId) blockers.push('BED_SLOT_MISSING');
  if (!branch?.branchId || !branch?.branchCode) blockers.push('BRANCH_NOT_FOUND');
  if (!startDate || !endDate) blockers.push('LEASE_DATES_MISSING');
  if (!leaseType || !official?.ok) blockers.push('TEMPLATE_NOT_FOUND');
  if (
    !Number.isFinite(pricing.approvedMonthlyRental)
    || Number(reservation.monthlyRent) !== pricing.approvedMonthlyRental
    || !Number.isFinite(reservationFee)
    || reservationFee !== pricing.reservationFee
  ) blockers.push('PRICING_CONFLICT');
  if (blockers.length) return { ok: false, blockers };

  const financials = calculateMoveInFinancials({
    advanceRent: pricing.advanceRent,
    securityDeposit: pricing.securityDeposit,
    reservationFeeAlreadyPaid: reservationFee,
  });
  const now = new Date();
  return {
    ok: true,
    user,
    reservation,
    room,
    official,
    snapshot: {
      reservationId: String(reservation._id),
      reservationStatus: 'APPROVED',
      tenantId: userId,
      ownershipVerified: true,
      tenantLegalName: legalName,
      tenantResidentialAddress: address,
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
      roomId: String(room._id),
      roomNumber: room.roomNumber,
      roomType: normalizedRoomType,
      bedId,
      bedSlotNumber: reservation.selectedBed?.position || bedId,
      contractStartDate: new Date(startDate).toISOString(),
      contractEndDate: endDate.toISOString(),
      leaseDurationMonths: duration,
      leaseType,
      generatedAt: now.toISOString(),
      pricing: {
        ...pricing,
        promoMonthlyRental: pricing.approvedMonthlyRental,
        reservationFee,
        currency: 'PHP',
        reservationFeeApplication: RESERVATION_FEE_APPLICATION,
        totalDueBeforeMoveIn: financials.totalDueBeforeMoveIn,
        remainingBalance: financials.remainingBalance,
      },
    },
  };
}

async function publishTenantTestContract(db, userId, publishedBy) {
  const existing = await db.collection('generatedContracts').findOne({
    userId,
    status: { $in: ['PRE_RELEASE_TEST', 'APPROVED', 'ACTIVE'] },
  }, { sort: { generatedAt: -1 } });
  if (existing) return { ok: true, existing: true, record: existing };

  const resolved = await resolveContractSnapshot(db, userId);
  if (!resolved.ok) return resolved;
  const draft = createDraftRecord({
    userId,
    tenantId: userId,
    reservationId: String(resolved.reservation._id),
    branchId: resolved.snapshot.branchId,
    roomId: resolved.snapshot.roomId,
    bedId: resolved.snapshot.bedId,
    templateKey: resolved.official.template.key,
    sourceTemplateSha256: resolved.official.integrity.actualSha256,
    version: 1,
    snapshot: resolved.snapshot,
    generatedBy: publishedBy,
  });
  const pdf = await renderOfficialLease(resolved.official.definition, { generatorVersion: 'lilycrest-workflow-v1' }, resolved.snapshot);
  const bucketName = resolveStorageBucket();
  if (!bucketName) return { ok: false, blockers: ['DOCUMENT_STORAGE_NOT_CONFIGURED'] };
  const storagePath = `tenant-contracts/${userId}/${draft.publicDocumentId}.pdf`;
  await admin.storage().bucket(bucketName).file(storagePath).save(pdf, {
    resumable: false,
    contentType: 'application/pdf',
    metadata: { cacheControl: 'private, no-store', metadata: { sha256: crypto.createHash('sha256').update(pdf).digest('hex') } },
  });
  const published = publishPreReleaseRecord(draft, {
    testStoragePath: storagePath,
    publishedBy,
    publishedAt: new Date(),
  });
  await db.collection('generatedContracts').insertOne(published);
  return { ok: true, existing: false, record: published };
}

module.exports = {
  addMonths,
  fullLegalName,
  pricingFromOfficialTemplate,
  publishTenantTestContract,
  residentialAddress,
  resolveContractSnapshot,
  roomType,
};
