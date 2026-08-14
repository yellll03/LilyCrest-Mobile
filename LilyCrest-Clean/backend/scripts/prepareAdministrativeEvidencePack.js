#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { analyzeIdentityCrosswalk } = require('../migrations/identityCrosswalk');
const { buildIdentityReviewQueue } = require('../migrations/identityReview');
const { readInputs } = require('./identityCrosswalk');
const {
  IDENTITY_DISPOSITION, FINAL_REVIEW_STATUS, MIGRATION_ELIGIBILITY, DISPOSITION_EVIDENCE,
  buildAdministratorReviewItems, buildDecisionWorksheet, buildPossibleTestRecordReport,
  buildBranchApprovalForms, buildPrivateRoomDecisionForm, buildPricingApprovalMatrix,
  buildContractDatePolicyForm, buildApprovalImportTemplate, renderClientRequestSummary,
} = require('../migrations/administrativeEvidencePack');
const { parseCliArgs, writeJson, writeCsv, ensureOutputDirectory } = require('../migrations/reportUtils');

function objectIdCandidate(value) {
  if (value instanceof ObjectId) return value;
  return typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : null;
}

function renderIdentityPackMarkdown(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.lifecycleGroup)) groups.set(item.lifecycleGroup, []);
    groups.get(item.lifecycleGroup).push(item);
  }
  const lines = [
    '# Phase 2A Stage 1C Unresolved Identity Administrator Review Pack',
    '',
    `Pending records: **${items.length}**`,
    '',
    'No record is approved or excluded by this package.',
    '',
  ];
  for (const [group, records] of groups) {
    lines.push(`## ${group}`, '');
    lines.push('| Review item | Source | Reservation | Lifecycle | Move-in | Room | Bed/Slot | Branch | Email | Phone | Raw legacy identity | Required decision |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const item of records) {
      lines.push(`| ${item.reviewItemId} | ${item.sourceCollection}:${item.sourceRecordId} | `
        + `${item.reservationCode || ''} | ${item.currentLifecycleStatus || ''} | ${item.moveInDate || ''} | `
        + `${item.roomNumber || ''} | ${item.bedOrSlot || ''} | ${item.branchSlug || ''} | `
        + `${item.maskedEmail || ''} | ${item.maskedPhone || ''} | ${item.rawLegacyIdentityValue} | `
        + 'Select one authorized disposition |');
    }
    lines.push('');
  }
  lines.push('## Exact resolution failure', '');
  lines.push('Each listed record failed exact matching against `users._id`, `users.user_id`, stored Firebase UID, and approved imported mappings.');
  lines.push('No fuzzy, email, username, name, phone, room, or branch matching was used.', '');
  return lines.join('\n');
}

function renderDecisionRequirementsMarkdown() {
  const lines = ['# Identity Disposition Evidence Requirements', ''];
  for (const disposition of Object.values(IDENTITY_DISPOSITION)) {
    lines.push(`## ${disposition}`, '');
    for (const requirement of DISPOSITION_EVIDENCE[disposition]) lines.push(`- ${requirement}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderFormMarkdown(title, value) {
  return `# ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

async function buildContext(db, queue) {
  const [reservations, rooms, bedhistories, stays] = await Promise.all([
    db.collection('reservations').find({}, {
      projection: {
        _id: 1, reservationCode: 1, status: 1, moveInDate: 1, roomId: 1,
        selectedBed: 1, billingEmail: 1, mobileNumber: 1, email: 1, phone: 1,
        isTest: 1, testData: 1, metadata: 1, seedIdentifier: 1,
      },
    }).toArray(),
    db.collection('rooms').find({}, {
      projection: { _id: 1, roomNumber: 1, branch: 1, beds: 1 },
    }).toArray(),
    db.collection('bedhistories').find({}, {
      projection: {
        _id: 1, reservationId: 1, status: 1, moveInDate: 1, roomId: 1, bedId: 1, branch: 1,
      },
    }).toArray(),
    db.collection('stays').find({}, {
      projection: {
        _id: 1, reservationId: 1, status: 1, leaseStartDate: 1, roomId: 1, bedId: 1, branch: 1,
      },
    }).toArray(),
  ]);
  const reservationMap = new Map(reservations.map((item) => [String(item._id), item]));
  const roomMap = new Map(rooms.map((item) => [String(item._id), item]));
  const bedHistoryMap = new Map(bedhistories.map((item) => [String(item._id), item]));
  const stayMap = new Map(stays.map((item) => [String(item._id), item]));
  const contextBySource = new Map();

  function roomFor(value) {
    return roomMap.get(String(value)) || null;
  }
  function reservationContext(reservation, assignment = {}) {
    const room = roomFor(assignment.roomId || reservation?.roomId);
    return {
      reservationCode: reservation?.reservationCode || null,
      lifecycleStatus: assignment.status || reservation?.status || null,
      moveInDate: assignment.moveInDate || assignment.leaseStartDate || reservation?.moveInDate || null,
      roomNumber: room?.roomNumber || null,
      bedOrSlot: assignment.bedId || reservation?.selectedBed?.id || null,
      branchSlug: assignment.branch || room?.branch || null,
      email: reservation?.billingEmail || reservation?.email || null,
      phone: reservation?.mobileNumber || reservation?.phone || null,
      isTest: reservation?.isTest,
      testData: reservation?.testData,
      metadata: reservation?.metadata,
      seedIdentifier: reservation?.seedIdentifier,
    };
  }

  for (const item of queue) {
    let context = {};
    if (item.sourceCollection === 'reservations') {
      context = reservationContext(reservationMap.get(item.sourceRecordId));
    } else if (item.sourceCollection === 'bedhistories') {
      const history = bedHistoryMap.get(item.sourceRecordId);
      context = reservationContext(reservationMap.get(String(history?.reservationId)), history);
    } else if (item.sourceCollection === 'stays') {
      const stay = stayMap.get(item.sourceRecordId);
      context = reservationContext(reservationMap.get(String(stay?.reservationId)), stay);
    } else if (item.sourceCollection === 'rooms') {
      const match = /^([a-fA-F0-9]{24}):bed:(.+)$/.exec(item.sourceRecordId);
      const room = match ? roomMap.get(match[1]) : null;
      const bed = room?.beds?.find((entry) => String(entry.id || entry._id) === match?.[2]);
      const reservation = reservationMap.get(String(bed?.occupiedBy?.reservationId));
      context = {
        ...reservationContext(reservation, {
          status: bed?.status,
          moveInDate: bed?.occupiedBy?.occupiedSince,
          roomId: room?._id,
          bedId: bed?.id || bed?._id,
          branch: room?.branch,
        }),
      };
    }
    contextBySource.set(`${item.sourceCollection}:${item.sourceRecordId}`, context);
  }
  return { contextBySource, reservations };
}

async function run(options = parseCliArgs(process.argv.slice(2))) {
  if (options.export !== true && options.dryRun !== true) {
    throw new Error('Administrative evidence preparation supports only --dry-run or --export.');
  }
  const migrationBatchId = options.batchId || `admin-evidence-${new Date().toISOString().slice(0, 10)}`;
  await connectToMongo();
  const db = getDb();
  const input = await readInputs(db);
  const analysis = analyzeIdentityCrosswalk({ ...input, migrationBatchId });
  const approvedResolutions = await db.collection('contract_identity_crosswalk').find({}, {
    projection: { sourceCollection: 1, sourceRecordId: 1, reviewStatus: 1, resolvedUserObjectId: 1 },
  }).toArray();
  const baseQueue = buildIdentityReviewQueue({
    analysis, approvedResolutions, reservations: [], users: [],
  });
  const { contextBySource } = await buildContext(db, baseQueue);
  const reviewItems = buildAdministratorReviewItems({ queue: baseQueue, contextBySource });
  const worksheet = buildDecisionWorksheet(reviewItems);
  const possibleTests = buildPossibleTestRecordReport(reviewItems, contextBySource);
  const branchForms = buildBranchApprovalForms();
  const privateRoomForm = buildPrivateRoomDecisionForm();
  const pricingMatrix = buildPricingApprovalMatrix();
  const datePolicyForm = buildContractDatePolicyForm();
  const importTemplate = buildApprovalImportTemplate(reviewItems);
  const outputDirectory = path.resolve(options.outputDir || path.join('reports', 'phase2a-stage1c'));
  ensureOutputDirectory(outputDirectory);

  const paths = {
    identityReviewJson: path.join(outputDirectory, 'administrator-identity-review-pack.json'),
    identityReviewMarkdown: path.join(outputDirectory, 'administrator-identity-review-pack.md'),
    decisionWorksheetCsv: path.join(outputDirectory, 'identity-decision-worksheet.csv'),
    decisionRequirements: path.join(outputDirectory, 'identity-disposition-evidence-requirements.md'),
    testCandidatesJson: path.join(outputDirectory, 'possible-test-records.json'),
    testCandidatesCsv: path.join(outputDirectory, 'possible-test-records.csv'),
    gilPuyatForm: path.join(outputDirectory, 'gil-puyat-branch-approval-form.json'),
    guadalupeForm: path.join(outputDirectory, 'guadalupe-branch-approval-form.json'),
    branchFormsMarkdown: path.join(outputDirectory, 'branch-legal-approval-forms.md'),
    privateRoomForm: path.join(outputDirectory, 'private-room-bed-slot-decision-form.json'),
    privateRoomMarkdown: path.join(outputDirectory, 'private-room-bed-slot-decision-form.md'),
    pricingMatrix: path.join(outputDirectory, 'pricing-approval-matrix.csv'),
    pricingJson: path.join(outputDirectory, 'pricing-approval-matrix.json'),
    datePolicyForm: path.join(outputDirectory, 'contract-date-policy-decision-form.json'),
    datePolicyMarkdown: path.join(outputDirectory, 'contract-date-policy-decision-form.md'),
    clientRequest: path.join(outputDirectory, 'client-administrator-request-summary.md'),
    importTemplate: path.join(outputDirectory, 'completed-approvals-import-template.json'),
    importFormat: path.join(outputDirectory, 'completed-approvals-import-format.md'),
    eligibilityRules: path.join(outputDirectory, 'stage2-eligibility-rules.json'),
  };

  writeJson(paths.identityReviewJson, {
    migrationBatchId, generatedAt: new Date().toISOString(), writesPerformed: false,
    totalPending: reviewItems.length, records: reviewItems,
  });
  fs.writeFileSync(paths.identityReviewMarkdown, renderIdentityPackMarkdown(reviewItems), 'utf8');
  writeCsv(paths.decisionWorksheetCsv, worksheet, Object.keys(worksheet[0] || {}));
  fs.writeFileSync(paths.decisionRequirements, renderDecisionRequirementsMarkdown(), 'utf8');
  writeJson(paths.testCandidatesJson, {
    label: 'POSSIBLE_TEST_RECORD — ADMIN REVIEW REQUIRED',
    generatedAt: new Date().toISOString(), writesPerformed: false, candidates: possibleTests,
  });
  writeCsv(paths.testCandidatesCsv, possibleTests.map((item) => ({
    ...item,
    explicitIndicators: item.explicitIndicators.join('|'),
    allowedDecisions: item.allowedDecisions.join('|'),
  })), [
    'reviewItemId', 'sourceCollection', 'sourceRecordId', 'reservationCode', 'label',
    'explicitIndicators', 'maskedEmail', 'requestedDecision', 'allowedDecisions', 'approvalReference',
  ]);
  writeJson(paths.gilPuyatForm, branchForms.gilPuyat);
  writeJson(paths.guadalupeForm, branchForms.guadalupe);
  fs.writeFileSync(paths.branchFormsMarkdown, renderFormMarkdown('Branch Legal Approval Forms', branchForms), 'utf8');
  writeJson(paths.privateRoomForm, privateRoomForm);
  fs.writeFileSync(paths.privateRoomMarkdown, renderFormMarkdown('Private-Room Bed/Slot Decision Form', privateRoomForm), 'utf8');
  writeJson(paths.pricingJson, pricingMatrix);
  writeCsv(paths.pricingMatrix, pricingMatrix.rows, Object.keys(pricingMatrix.rows[0]));
  writeJson(paths.datePolicyForm, datePolicyForm);
  fs.writeFileSync(paths.datePolicyMarkdown, renderFormMarkdown('Contract Date Policy Decision Form', datePolicyForm), 'utf8');
  fs.writeFileSync(paths.clientRequest, renderClientRequestSummary(reviewItems.length), 'utf8');
  writeJson(paths.importTemplate, importTemplate);
  fs.writeFileSync(paths.importFormat, renderFormMarkdown('Completed Approvals Import Format', {
    schemaVersion: importTemplate.schemaVersion,
    allowedIdentityDispositions: Object.values(IDENTITY_DISPOSITION),
    allowedFinalStatuses: Object.values(FINAL_REVIEW_STATUS),
    rules: [
      'Source IDs and review item IDs must match the exported review pack.',
      'No approval is accepted without administrator, evidence, approval reference, and review date.',
      'Import validation must rerun stale-source checks before any future write.',
      'This template is a preparation artifact and does not itself authorize production writes.',
    ],
  }), 'utf8');
  writeJson(paths.eligibilityRules, {
    classifications: Object.values(MIGRATION_ELIGIBILITY),
    rules: {
      eligible: 'Approved LINK_TO_EXISTING_USER with an exact existingUserId.',
      excluded: 'Approved historical, deleted-account, or invalid exclusion on a non-active record.',
      blocked: 'Pending/rejected/insufficient evidence, account mapping not yet created, or attempted active-record exclusion.',
    },
    stage2GlobalGates: [
      'Every identity has an authorized disposition.',
      'No ambiguous identity remains.',
      'All active/current identities resolve to canonical users.',
      'Historical/invalid exclusions are documented.',
      'Gil Puyat branch is approved.',
      'Guadalupe is approved or formally excluded from contract generation.',
      'Private-room policy is approved or private-room records are excluded.',
      'Pricing and date policies are approved.',
    ],
  });

  console.log(JSON.stringify({
    outputDirectory,
    identityRecords: reviewItems.length,
    possibleTestCandidates: possibleTests.length,
    lifecycleGroups: reviewItems.reduce((result, item) => {
      result[item.lifecycleGroup] = (result[item.lifecycleGroup] || 0) + 1;
      return result;
    }, {}),
    paths,
    writesPerformed: false,
  }, null, 2));
  return { reviewItems, worksheet, possibleTests, paths };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Administrative evidence pack failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { objectIdCandidate, buildContext, run };
