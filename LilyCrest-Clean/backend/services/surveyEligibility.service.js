'use strict';

const { ObjectId } = require('mongodb');
const { resolveTenantBranch } = require('./branchLocation.service');

const ACTIVE_STAY = /^(active|current|occupied|checked_in)$/i;
const COMPLETED_STAY = /^(completed|moved_out|checked_out)$/i;
const APPROVED = /^(approved|confirmed)$/i;
const ACTIVE_RESERVATION = /^(movein|move_in|active|checked_in)$/i;

function identityFilter(user = {}) {
  const raw = [user.user_id, user._id].filter(Boolean);
  const values = [...raw];
  raw.forEach((value) => { if (ObjectId.isValid(String(value))) values.push(new ObjectId(String(value))); });
  return { $or: ['user_id', 'userId', 'tenant_id', 'tenantId'].flatMap((key) => values.map((value) => ({ [key]: value }))) };
}

function ref(record = {}) {
  const value = record.branchId ?? record.branch_id ?? record.branchCode ?? record.branch;
  return value && typeof value === 'object' ? String(value.branchId || value._id || '') : String(value || '');
}

function overlaps(stay, survey) {
  const start = new Date(stay.leaseStartDate || stay.startDate || stay.moveInDate || 0);
  const end = new Date(stay.leaseEndDate || stay.endDate || stay.moveOutDate || Date.now());
  return start <= survey.periodEnd && end >= survey.periodStart;
}

async function resolveEligibility(db, user, survey) {
  const identity = identityFilter(user);
  if (!identity.$or.length) return { eligible: false, reason: 'TENANT_IDENTITY_UNRESOLVED' };

  const [stays, reservations, moveOutRequests] = await Promise.all([
    db.collection('stays').find(identity).sort({ updatedAt: -1 }).limit(20).toArray(),
    db.collection('reservations').find(identity).sort({ updatedAt: -1 }).limit(20).toArray(),
    db.collection('move_out_requests').find(identity).sort({ updatedAt: -1 }).limit(20).toArray(),
  ]);
  const active = stays.find((stay) => ACTIVE_STAY.test(String(stay.status || '')) || stay.isActive === true);
  const activeReservation = reservations.find((reservation) => ACTIVE_RESERVATION.test(String(
    reservation.status || reservation.occupancyStatus || reservation.applicationStatus || ''
  )));
  const completed = stays.find((stay) => COMPLETED_STAY.test(String(stay.status || '')));
  const completedCovering = stays.find((stay) => COMPLETED_STAY.test(String(stay.status || '')) && overlaps(stay, survey));
  const covering = stays.find((stay) => overlaps(stay, survey));
  const approvedMoveOut = moveOutRequests.some((request) => APPROVED.test(String(request.status || '')));
  const expiredContract = reservations.find((reservation) =>
    /^(expired|completed)$/i.test(String(reservation.contractStatus || reservation.leaseStatus || '')));
  const adminEnabled = survey.exitSurveyEnabled === true
    || (Array.isArray(survey.exitSurveyTenantIds) && survey.exitSurveyTenantIds.map(String).includes(String(user.user_id || user._id)));

  let source = null;
  if (survey.surveyType === 'QUARTERLY') source = active || activeReservation || completedCovering;
  if (survey.surveyType === 'MOVE_OUT' && (approvedMoveOut || expiredContract || completed || adminEnabled)) {
    source = active || completed || covering || expiredContract;
  }
  if (!source) return { eligible: false, reason: 'NO_ACTIVE_STAY' };

  const tenantId = source.tenantId || source.tenant_id || user.user_id || user._id;
  const userId = user.user_id || user._id;
  let branchId = ref(source);
  if (!branchId) {
    try {
      const resolved = await resolveTenantBranch(db, user);
      branchId = String(resolved?.branch?.branchId || '');
    } catch (_error) {
      branchId = '';
    }
  }
  if (survey.branchId && String(survey.branchId) !== branchId) return { eligible: false, reason: 'BRANCH_SCOPE_MISMATCH' };
  if (Array.isArray(survey.eligibleTestUserIds) && survey.eligibleTestUserIds.length
    && !survey.eligibleTestUserIds.map(String).includes(String(userId))) {
    return { eligible: false, reason: 'BRANCH_SCOPE_MISMATCH' };
  }
  if (Array.isArray(survey.eligibleTestTenantIds) && survey.eligibleTestTenantIds.length
    && !survey.eligibleTestTenantIds.map(String).includes(String(tenantId))) {
    return { eligible: false, reason: 'BRANCH_SCOPE_MISMATCH' };
  }
  return { eligible: true, tenantId, userId, branchId: branchId || null };
}

module.exports = { identityFilter, overlaps, resolveEligibility };
