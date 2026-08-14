'use strict';

const { ObjectId } = require('mongodb');
const { hashRecord } = require('./migrationSafety');

const REVIEW_STATUS = Object.freeze({
  PENDING_REVIEW: 'PENDING_REVIEW',
  RESOLVED_APPROVED: 'RESOLVED_APPROVED',
  UNRESOLVED_CONFIRMED: 'UNRESOLVED_CONFIRMED',
  DELETED_ACCOUNT_CONFIRMED: 'DELETED_ACCOUNT_CONFIRMED',
  REJECTED: 'REJECTED',
});

const MANUAL_EVIDENCE_TYPE = Object.freeze({
  APPROVED_EXPLICIT_MAPPING: 'APPROVED_EXPLICIT_MAPPING',
  VERIFIED_RESERVATION_USER_MIGRATION: 'VERIFIED_RESERVATION_USER_MIGRATION',
});

function maskEmail(value) {
  const [local = '', domain = ''] = String(value || '').split('@');
  if (!domain) return null;
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(3, local.length - 2))}@${domain}`;
}

function maskPhone(value) {
  const text = String(value || '').replace(/\s/g, '');
  if (!text) return null;
  return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}

function recommendedAction(status) {
  if (status === 'AMBIGUOUS') return 'Review conflicting exact identifiers and approve one target only with authoritative evidence.';
  if (status === 'DELETED_ACCOUNT') return 'Confirm the deleted-account disposition or provide an approved explicit mapping.';
  return 'Provide an approved explicit mapping, confirm unresolved, or confirm deleted-account disposition.';
}

function buildIdentityReviewQueue({
  analysis, reservations = [], approvedResolutions = [], users = [], reservationCodeBySource = new Map(),
}) {
  const reservationCodes = new Map(reservations.map((item) => [String(item._id), item.reservationCode || null]));
  const approvals = new Map(approvedResolutions.map((item) => [
    `${item.sourceCollection}:${item.sourceRecordId}`, item,
  ]));
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  return analysis.records
    .filter((record) => record.resolutionStatus !== 'RESOLVED')
    .map((record) => {
      const approval = approvals.get(`${record.sourceCollection}:${record.sourceRecordId}`);
      const candidateUserIds = record.resolvedUserObjectId ? [record.resolvedUserObjectId] : [];
      return {
        sourceCollection: record.sourceCollection,
        sourceRecordId: record.sourceRecordId,
        reservationCode: record.sourceCollection === 'reservations'
          ? reservationCodes.get(record.sourceRecordId) || null
          : reservationCodeBySource.get(`${record.sourceCollection}:${record.sourceRecordId}`) || null,
        rawIdentityValue: record.legacyIdentityValue,
        rawIdentityType: record.legacyIdentityType,
        rawIdentityStorageType: record.legacyIdentityStorageType,
        sourceStateHash: hashRecord({
          sourceCollection: record.sourceCollection,
          sourceRecordId: record.sourceRecordId,
          sourceField: record.sourceField,
          rawIdentityValue: record.legacyIdentityValue,
        }),
        candidateUserIds,
        candidateEvidence: record.evidence,
        candidateContacts: candidateUserIds.map((id) => {
          const user = userMap.get(id) || {};
          return { userId: id, email: maskEmail(user.email), phone: maskPhone(user.phone) };
        }),
        currentResolutionStatus: record.resolutionStatus,
        blockerCodes: record.blockerCodes,
        recommendedAction: recommendedAction(record.resolutionStatus),
        reviewStatus: approval?.reviewStatus || REVIEW_STATUS.PENDING_REVIEW,
      };
    })
    .sort((a, b) => `${a.sourceCollection}:${a.sourceRecordId}`.localeCompare(`${b.sourceCollection}:${b.sourceRecordId}`));
}

function summarizeReviewQueue({ analysis, queue, approvedResolutions = [] }) {
  const groupBy = (values, getKeys) => {
    const result = {};
    for (const value of values) {
      for (const key of getKeys(value)) result[key] = (result[key] || 0) + 1;
    }
    return result;
  };
  return {
    totalIdentityRecords: analysis.summary.totalSourceRecordsScanned,
    resolvedAutomatically: analysis.summary.resolved,
    pendingManualReview: queue.filter((item) => item.reviewStatus === REVIEW_STATUS.PENDING_REVIEW).length,
    unresolvedWithNoCandidate: queue.filter((item) => (
      item.currentResolutionStatus === 'UNRESOLVED' && item.candidateUserIds.length === 0
    )).length,
    deletedAccountCandidates: analysis.summary.deletedAccountCandidates,
    ambiguous: analysis.summary.ambiguous,
    approvedManualResolutions: approvedResolutions.filter((item) => item.reviewStatus === REVIEW_STATUS.RESOLVED_APPROVED).length,
    mixedIdTypeCases: analysis.summary.mixedStringObjectIdCases,
    groupedBySourceCollection: groupBy(queue, (item) => [item.sourceCollection]),
    groupedByBlockerCode: groupBy(queue, (item) => item.blockerCodes),
    remainingBlockers: queue.filter((item) => (
      ![REVIEW_STATUS.RESOLVED_APPROVED, REVIEW_STATUS.UNRESOLVED_CONFIRMED,
        REVIEW_STATUS.DELETED_ACCOUNT_CONFIRMED, REVIEW_STATUS.REJECTED].includes(item.reviewStatus)
    )).length,
  };
}

function renderIdentityReviewMarkdown(summary, queue) {
  const lines = [
    '# Phase 2A Stage 1B Identity Review Summary',
    '',
    '| Metric | Count |',
    '|---|---:|',
    ...Object.entries(summary)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Pending records by source collection',
    '',
    '| Source | Count |',
    '|---|---:|',
    ...Object.entries(summary.groupedBySourceCollection).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Pending records by blocker',
    '',
    '| Blocker | Count |',
    '|---|---:|',
    ...Object.entries(summary.groupedByBlockerCode).map(([key, value]) => `| ${key} | ${value} |`),
    '',
    '## Review queue',
    '',
    '| Source | Record ID | Reservation code | Identity type | Status | Review status | Blockers |',
    '|---|---|---|---|---|---|---|',
    ...queue.map((item) => (
      `| ${item.sourceCollection} | ${item.sourceRecordId} | ${item.reservationCode || ''} | `
      + `${item.rawIdentityType} | ${item.currentResolutionStatus} | ${item.reviewStatus} | ${item.blockerCodes.join(', ')} |`
    )),
    '',
    'Raw identity values and contact details are intentionally excluded from this Markdown summary.',
    '',
  ];
  return lines.join('\n');
}

function isInactiveUser(user) {
  return !user || user.isArchived === true || user.isActive === false || user.is_active === false
    || ['inactive', 'disabled', 'archived'].includes(String(user.accountStatus || user.status || '').toLowerCase());
}

function validateManualResolutionInput(options) {
  const required = [
    'sourceCollection', 'sourceRecordId', 'selectedUserId', 'administrator',
    'approvalReference', 'reason', 'backupReference', 'migrationBatchId',
    'expectedSourceHash', 'evidenceType', 'evidenceReference',
  ];
  const missing = required.filter((key) => typeof options[key] !== 'string' || !options[key].trim());
  if (options.confirm !== true) missing.push('confirm');
  if (missing.length) throw new Error(`Identity approval blocked. Missing inputs: ${[...new Set(missing)].join(', ')}`);
  if (!ObjectId.isValid(options.selectedUserId)) throw new Error('selectedUserId must be a valid canonical user ObjectId.');
  if (!Object.values(MANUAL_EVIDENCE_TYPE).includes(options.evidenceType)) {
    throw new Error('Identity approval requires an approved exact evidence type.');
  }
  return true;
}

module.exports = {
  REVIEW_STATUS,
  MANUAL_EVIDENCE_TYPE,
  maskEmail,
  maskPhone,
  buildIdentityReviewQueue,
  summarizeReviewQueue,
  renderIdentityReviewMarkdown,
  isInactiveUser,
  validateManualResolutionInput,
};
