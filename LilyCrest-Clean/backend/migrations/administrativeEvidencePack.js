'use strict';

const crypto = require('node:crypto');
const { APPROVED_TEMPLATE_KEYS } = require('../domain/contracts/templateRegistry');
const { GIL_PUYAT_TEMPLATE_WORDING } = require('./branchLegalApproval');
const { maskEmail, maskPhone } = require('./identityReview');

const IDENTITY_DISPOSITION = Object.freeze({
  LINK_TO_EXISTING_USER: 'LINK_TO_EXISTING_USER',
  CREATE_ACCOUNT_MAPPING: 'CREATE_ACCOUNT_MAPPING',
  DELETED_ACCOUNT_CONFIRMED: 'DELETED_ACCOUNT_CONFIRMED',
  HISTORICAL_RECORD_EXCLUDED: 'HISTORICAL_RECORD_EXCLUDED',
  INVALID_RECORD_EXCLUDED: 'INVALID_RECORD_EXCLUDED',
  REQUIRES_FURTHER_INVESTIGATION: 'REQUIRES_FURTHER_INVESTIGATION',
});

const FINAL_REVIEW_STATUS = Object.freeze({
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
  NEEDS_MORE_EVIDENCE: 'NEEDS_MORE_EVIDENCE',
});

const MIGRATION_ELIGIBILITY = Object.freeze({
  ELIGIBLE_FOR_CANONICAL_MIGRATION: 'ELIGIBLE_FOR_CANONICAL_MIGRATION',
  EXCLUDED_WITH_APPROVAL: 'EXCLUDED_WITH_APPROVAL',
  BLOCKED_PENDING_EVIDENCE: 'BLOCKED_PENDING_EVIDENCE',
});

const DISPOSITION_EVIDENCE = Object.freeze({
  LINK_TO_EXISTING_USER: [
    'Exact canonical users._id',
    'Evidence that the source record belongs to that user',
    'Administrator name',
    'Approval reference',
    'Review date',
  ],
  CREATE_ACCOUNT_MAPPING: [
    'Confirmation that the person is a valid tenant or applicant',
    'Approved account creation or mapping plan',
    'Stable identifier to be assigned',
    'Administrator approval',
  ],
  DELETED_ACCOUNT_CONFIRMED: [
    'Evidence that the former account was deleted',
    'Confirmation that the historical source record remains preserved',
    'Approval to exclude the record from active canonical migration',
  ],
  HISTORICAL_RECORD_EXCLUDED: [
    'Confirmation that the record is historical',
    'Reason a current user relationship is not required',
    'Approval to exclude it from canonical tenant creation',
  ],
  INVALID_RECORD_EXCLUDED: [
    'Documented invalid, duplicate, test, or corruption reason',
    'Approval reference',
    'Confirmation that the source record will not be silently deleted',
  ],
  REQUIRES_FURTHER_INVESTIGATION: [
    'Description of missing evidence',
    'Assigned reviewer',
    'Next review action',
  ],
});

const CURRENT_STATUSES = new Set(['moveIn', 'active', 'reserved', 'approved_for_payment']);
const HISTORICAL_STATUSES = new Set(['moveOut', 'completed', 'archived']);
const CANCELLED_STATUSES = new Set(['cancelled', 'rejected', 'declined']);

function reviewItemId(sourceCollection, sourceRecordId) {
  const digest = crypto.createHash('sha256')
    .update(`${sourceCollection}:${sourceRecordId}`)
    .digest('hex').slice(0, 12).toUpperCase();
  return `IDREV-${digest}`;
}

function lifecycleGroup(sourceCollection, lifecycleStatus) {
  if (sourceCollection === 'bedhistories') return 'BED_HISTORY_ONLY';
  if (sourceCollection === 'rooms') return 'EMBEDDED_ROOM_BED_IDENTITY';
  if (CURRENT_STATUSES.has(lifecycleStatus)) return 'ACTIVE_OR_CURRENT';
  if (HISTORICAL_STATUSES.has(lifecycleStatus)) return 'COMPLETED_OR_HISTORICAL';
  if (CANCELLED_STATUSES.has(lifecycleStatus)) return 'CANCELLED_OR_REJECTED';
  return 'UNKNOWN_LIFECYCLE';
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildAdministratorReviewItems({ queue, contextBySource }) {
  return queue.map((item) => {
    const context = contextBySource.get(`${item.sourceCollection}:${item.sourceRecordId}`) || {};
    const currentLifecycleStatus = context.lifecycleStatus || null;
    return {
      reviewItemId: reviewItemId(item.sourceCollection, item.sourceRecordId),
      sourceCollection: item.sourceCollection,
      sourceRecordId: item.sourceRecordId,
      reservationCode: context.reservationCode || item.reservationCode || null,
      currentLifecycleStatus,
      lifecycleGroup: lifecycleGroup(item.sourceCollection, currentLifecycleStatus),
      moveInDate: safeDate(context.moveInDate),
      roomNumber: context.roomNumber || null,
      bedOrSlot: context.bedOrSlot || null,
      branchSlug: context.branchSlug || null,
      maskedEmail: maskEmail(context.email),
      maskedPhone: maskPhone(context.phone),
      rawLegacyIdentityValue: item.rawIdentityValue,
      rawIdentityType: item.rawIdentityType,
      sourceStateHash: item.sourceStateHash,
      exactResolutionFailureReason: 'No exact match was found in users._id, users.user_id, stored Firebase UID, or an approved imported mapping.',
      requiredAdministratorDecision: Object.values(IDENTITY_DISPOSITION),
      currentResolutionStatus: item.currentResolutionStatus,
      blockerCodes: [...item.blockerCodes],
      proposedDisposition: '',
      finalStatus: FINAL_REVIEW_STATUS.PENDING,
    };
  }).sort((a, b) => (
    `${a.lifecycleGroup}:${a.sourceCollection}:${a.sourceRecordId}`
      .localeCompare(`${b.lifecycleGroup}:${b.sourceCollection}:${b.sourceRecordId}`)
  ));
}

function buildDecisionWorksheet(items) {
  return items.map((item) => ({
    reviewItemId: item.reviewItemId,
    sourceRecord: `${item.sourceCollection}:${item.sourceRecordId}`,
    reservationCode: item.reservationCode,
    proposedDisposition: '',
    existingUserId: '',
    stableIdentifierToAssign: '',
    evidenceReference: '',
    reason: '',
    administrator: '',
    approvalReference: '',
    reviewDate: '',
    finalStatus: FINAL_REVIEW_STATUS.PENDING,
  }));
}

function explicitTestIndicators(context = {}) {
  const indicators = [];
  const email = String(context.email || '').toLowerCase();
  if (/@mailinator\.com$/.test(email)) indicators.push('MAILINATOR_DOMAIN');
  if (context.isTest === true || context.testData === true || context.metadata?.isTest === true) {
    indicators.push('EXPLICIT_TEST_METADATA');
  }
  if (typeof context.seedIdentifier === 'string' && context.seedIdentifier.trim()) {
    indicators.push('KNOWN_SEED_IDENTIFIER');
  }
  if (typeof context.reservationCode === 'string' && /^TEST[-_]/i.test(context.reservationCode)) {
    indicators.push('DOCUMENTED_TEST_RESERVATION_PREFIX');
  }
  return indicators;
}

function buildPossibleTestRecordReport(items, contextBySource) {
  return items.flatMap((item) => {
    const context = contextBySource.get(`${item.sourceCollection}:${item.sourceRecordId}`) || {};
    const indicators = explicitTestIndicators(context);
    if (!indicators.length) return [];
    return [{
      reviewItemId: item.reviewItemId,
      sourceCollection: item.sourceCollection,
      sourceRecordId: item.sourceRecordId,
      reservationCode: item.reservationCode,
      label: 'POSSIBLE_TEST_RECORD — ADMIN REVIEW REQUIRED',
      explicitIndicators: indicators,
      maskedEmail: maskEmail(context.email),
      requestedDecision: '',
      allowedDecisions: [
        'KEEP_AS_VALID_RECORD',
        'EXCLUDE_AS_TEST_RECORD',
        'DELETE_LATER_UNDER_SEPARATE_APPROVAL',
      ],
      approvalReference: '',
    }];
  });
}

function buildBranchApprovalForms() {
  return {
    gilPuyat: {
      branchKey: 'gil-puyat',
      canonicalBranchId: '',
      officialLegalName: '',
      officialLegalAddress: '',
      displayName: '',
      branchSlug: 'gil-puyat',
      coordinates: { latitude: '', longitude: '' },
      activeStatus: '',
      authorizedContractTemplates: [],
      proposedTemplateCombinations: [
        'PRIVATE_ROOM + SHORT_TERM',
        'PRIVATE_ROOM + LONG_TERM',
        'DOUBLE_SHARING + SHORT_TERM',
        'DOUBLE_SHARING + LONG_TERM',
        'QUADRUPLE_SHARING + SHORT_TERM',
        'QUADRUPLE_SHARING + LONG_TERM',
      ],
      proposedTemplateKeys: [...APPROVED_TEMPLATE_KEYS],
      templateWordingReference: {
        legalName: GIL_PUYAT_TEMPLATE_WORDING.legalName,
        legalAddress: GIL_PUYAT_TEMPLATE_WORDING.formattedAddress,
        status: 'PROPOSED LEGAL REFERENCE — AUTHORIZED CONFIRMATION REQUIRED',
      },
      sourceDocument: '',
      approver: '',
      approvalReference: '',
      approvalDate: '',
      finalStatus: FINAL_REVIEW_STATUS.PENDING,
    },
    guadalupe: {
      branchKey: 'guadalupe',
      canonicalBranchId: '',
      officialLegalName: '',
      officialLegalAddress: '',
      displayName: '',
      branchSlug: 'guadalupe',
      coordinates: { latitude: '', longitude: '' },
      activeStatus: '',
      supportedContractTemplates: [],
      templateStatus: 'NONE PENDING APPROVAL',
      sourceDocument: '',
      approver: '',
      approvalReference: '',
      approvalDate: '',
      exclusionFromContractGenerationApproved: '',
      finalStatus: FINAL_REVIEW_STATUS.PENDING,
      blockerCodes: ['BRANCH_LEGAL_DATA_MISSING', 'TEMPLATE_BRANCH_MISMATCH'],
    },
  };
}

function buildPrivateRoomDecisionForm() {
  return {
    decisionKey: 'PRIVATE_ROOM_BED_SLOT_POLICY',
    currentTemplateField: 'Bed/Slot No. ________',
    selectedOption: '',
    options: {
      A: {
        decision: 'Private rooms have a real assigned bed/slot number.',
        sourceOfIdentifier: '',
        storageField: '',
        assignmentWorkflow: '',
        legalCorrectnessConfirmed: '',
      },
      B: {
        decision: 'Official private-room templates will be revised to remove the field.',
        revisedApprovedTemplates: [],
        templateVersion: '',
        approvalDate: '',
        approver: '',
      },
      C: {
        decision: 'Another approved value or rule will be used.',
        exactApprovedWording: '',
        legalProductJustification: '',
        updatedTemplateApproval: '',
      },
    },
    approver: '',
    approvalReference: '',
    approvalDate: '',
    finalStatus: FINAL_REVIEW_STATUS.PENDING,
    blockerCodeUntilApproved: 'PRIVATE_ROOM_BED_SLOT_UNRESOLVED',
  };
}

function buildPricingApprovalMatrix() {
  const proposed = [
    ['PRIVATE_ROOM', 'SHORT_TERM', '16000.00', '14400.00', '14400.00', '14400.00', '14400.00', '2000.00'],
    ['PRIVATE_ROOM', 'LONG_TERM', '15000.00', '13500.00', '13500.00', '13500.00', '13500.00', '2000.00'],
    ['DOUBLE_SHARING', 'SHORT_TERM', '10000.00', '8000.00', '8000.00', '8000.00', '8000.00', '2000.00'],
    ['DOUBLE_SHARING', 'LONG_TERM', '9000.00', '7200.00', '7200.00', '7200.00', '7200.00', '2000.00'],
    ['QUADRUPLE_SHARING', 'SHORT_TERM', '7000.00', '6300.00', '6300.00', '6300.00', '6300.00', '2000.00'],
    ['QUADRUPLE_SHARING', 'LONG_TERM', '6000.00', '5400.00', '5400.00', '5400.00', '5400.00', '2000.00'],
  ];
  return {
    currency: 'PHP',
    status: 'PROPOSED FROM OFFICIAL TEMPLATE — ADMIN CONFIRMATION REQUIRED',
    rows: proposed.map(([
      roomType, leaseType, regularRental, promoRental, approvedMonthlyRental,
      securityDeposit, advanceRent, reservationFee,
    ]) => ({
      roomType, leaseType, regularRental, promoRental, approvedMonthlyRental,
      securityDeposit, advanceRent, reservationFee,
      effectiveDate: '', approvedBy: '', reference: '', finalStatus: FINAL_REVIEW_STATUS.PENDING,
    })),
    exceptions: [{
      exceptionType: '',
      allowedTypes: ['CUSTOM_TENANT_RATE', 'SPECIAL_PROMOTION', 'WAIVED_OR_ADJUSTED_FEES', 'LEGACY_CONTRACT_RATE'],
      tenantOrContractReference: '',
      approvedAmounts: '',
      reason: '',
      approvedBy: '',
      approvalReference: '',
      approvalDate: '',
      finalStatus: FINAL_REVIEW_STATUS.PENDING,
    }],
  };
}

function buildContractDatePolicyForm() {
  return {
    moveInDateEqualsContractStartDate: '',
    contractEndDateDetermination: '',
    storageRepresentation: '',
    philippinesTimezoneHandling: '',
    startDateInclusive: '',
    endDateInclusive: '',
    monthCalculationMethod: '',
    renewalDateHandling: '',
    currentTechnicalProposalReference: {
      storageRepresentation: 'Date-only value encoded as BSON Date at 00:00:00.000Z',
      displayTimezone: 'Asia/Manila',
      inclusivity: 'Start and end inclusive',
      status: 'TECHNICAL PROPOSAL — LEGAL/ADMIN APPROVAL REQUIRED',
    },
    explicitWarning: 'Existing moveInDate is not automatically the legal contract start date.',
    approver: '',
    approvalReference: '',
    approvalDate: '',
    finalStatus: FINAL_REVIEW_STATUS.PENDING,
  };
}

function classifyMigrationEligibility(decision, lifecycleCategory) {
  if (!decision || decision.finalStatus !== FINAL_REVIEW_STATUS.APPROVED) {
    return MIGRATION_ELIGIBILITY.BLOCKED_PENDING_EVIDENCE;
  }
  if (decision.proposedDisposition === IDENTITY_DISPOSITION.LINK_TO_EXISTING_USER && decision.existingUserId) {
    return MIGRATION_ELIGIBILITY.ELIGIBLE_FOR_CANONICAL_MIGRATION;
  }
  if (decision.proposedDisposition === IDENTITY_DISPOSITION.CREATE_ACCOUNT_MAPPING) {
    return MIGRATION_ELIGIBILITY.BLOCKED_PENDING_EVIDENCE;
  }
  if ([
    IDENTITY_DISPOSITION.DELETED_ACCOUNT_CONFIRMED,
    IDENTITY_DISPOSITION.HISTORICAL_RECORD_EXCLUDED,
    IDENTITY_DISPOSITION.INVALID_RECORD_EXCLUDED,
  ].includes(decision.proposedDisposition)) {
    if (lifecycleCategory === 'ACTIVE_OR_CURRENT') {
      return MIGRATION_ELIGIBILITY.BLOCKED_PENDING_EVIDENCE;
    }
    return MIGRATION_ELIGIBILITY.EXCLUDED_WITH_APPROVAL;
  }
  return MIGRATION_ELIGIBILITY.BLOCKED_PENDING_EVIDENCE;
}

function buildApprovalImportTemplate(items) {
  return {
    schemaVersion: 'phase2a-stage1c-approvals-v1',
    identityDecisions: items.map((item) => ({
      reviewItemId: item.reviewItemId,
      sourceCollection: item.sourceCollection,
      sourceRecordId: item.sourceRecordId,
      sourceStateHash: item.sourceStateHash,
      proposedDisposition: '',
      existingUserId: '',
      stableIdentifierToAssign: '',
      evidenceReferences: [],
      reason: '',
      administrator: '',
      approvalReference: '',
      reviewDate: '',
      finalStatus: FINAL_REVIEW_STATUS.PENDING,
    })),
    branchDecisions: buildBranchApprovalForms(),
    privateRoomBedSlotDecision: buildPrivateRoomDecisionForm(),
    pricingDecision: buildPricingApprovalMatrix(),
    contractDatePolicyDecision: buildContractDatePolicyForm(),
    backupAuthorization: {
      method: '',
      backupReference: '',
      verifiedBy: '',
      verifiedAt: '',
      authorizedForProductionWrite: false,
    },
  };
}

function renderClientRequestSummary(identityCount) {
  return [
    '# Information and Approvals Required Before Phase 2A Stage 2',
    '',
    `Please review and provide an authorized decision for the ${identityCount} unresolved identity records in the attached worksheet.`,
    '',
    'Please also provide:',
    '',
    '1. Official Gil Puyat branch ID, legal name, legal address, display name, coordinates, source document, approver, and approval reference.',
    '2. Written confirmation that the six Gil Puyat lease templates are authorized for that verified branch.',
    '3. Official Guadalupe branch information.',
    '4. Guadalupe-specific approved lease templates, or written approval to keep contract generation disabled for Guadalupe.',
    '5. An approved decision for the private-room Bed/Slot field.',
    '6. Confirmation of the proposed contract pricing matrix and any approved exceptions.',
    '7. Approval of the contract-date policy, including start/end dates, inclusivity, timezone, month calculation, and renewals.',
    '8. Administrator names, approval references, and review dates for every decision.',
    '9. Verified backup evidence and separate authorization before any production write.',
    '',
    'No production data will be changed from this review package alone.',
    '',
  ].join('\n');
}

module.exports = {
  IDENTITY_DISPOSITION,
  FINAL_REVIEW_STATUS,
  MIGRATION_ELIGIBILITY,
  DISPOSITION_EVIDENCE,
  reviewItemId,
  lifecycleGroup,
  buildAdministratorReviewItems,
  buildDecisionWorksheet,
  explicitTestIndicators,
  buildPossibleTestRecordReport,
  buildBranchApprovalForms,
  buildPrivateRoomDecisionForm,
  buildPricingApprovalMatrix,
  buildContractDatePolicyForm,
  classifyMigrationEligibility,
  buildApprovalImportTemplate,
  renderClientRequestSummary,
};
