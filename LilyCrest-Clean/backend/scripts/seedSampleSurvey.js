#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');

'use strict';

require('dotenv').config();
const { ObjectId } = require('mongodb');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { defaultQuestions } = require('../services/survey.service');
const { resolveTenantBranch } = require('../services/branchLocation.service');

const SAMPLE_TITLE = 'Quarterly Tenant Satisfaction Survey';

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (['confirm', 'remove'].includes(key)) options[key] = true;
    else options[key] = args[index + 1], index += 1;
  }
  return options;
}

function required(options, key) {
  const value = String(options[key] || '').trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function validateOptions(options, { write = false } = {}) {
  const environment = required(options, 'environment');
  const administratorId = required(options, 'administratorId');
  const approvalReference = required(options, 'approvalReference');
  const branchId = required(options, 'branchId');
  const testUserId = required(options, 'testUserId');
  const availableFrom = new Date(required(options, 'availableFrom'));
  const availableUntil = new Date(required(options, 'availableUntil'));
  if (!ObjectId.isValid(administratorId)) throw new Error('administratorId must be a valid ObjectId.');
  if (Number.isNaN(availableFrom.getTime()) || Number.isNaN(availableUntil.getTime()) || availableFrom >= availableUntil) {
    throw new Error('A valid availability period is required.');
  }
  if (write && options.confirm !== true) throw new Error('Write mode requires --confirm.');
  if (write && environment !== (process.env.NODE_ENV || 'development')) {
    throw new Error('environment must exactly match NODE_ENV.');
  }
  return { environment, administratorId, approvalReference, branchId, testUserId, availableFrom, availableUntil };
}

function sampleSurveyId(scope) {
  const stable = `${scope.branchId}_${scope.testUserId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `survey_test_quarterly_${stable}`;
}

function buildSampleSurvey(scope, now = new Date()) {
  return {
    surveyId: sampleSurveyId(scope),
    title: SAMPLE_TITLE,
    description: 'Controlled tenant-mobile survey verification.',
    surveyType: 'QUARTERLY',
    status: 'ACTIVE',
    branchId: scope.branchId,
    eligibleTestUserIds: [scope.testUserId],
    eligibleTestTenantIds: [scope.testTenantId],
    periodStart: scope.availableFrom,
    periodEnd: scope.availableUntil,
    availableFrom: scope.availableFrom,
    availableUntil: scope.availableUntil,
    questions: defaultQuestions('QUARTERLY'),
    isControlledSample: true,
    approvalReference: scope.approvalReference,
    createdBy: scope.administratorId,
    createdAt: now,
    updatedAt: now,
  };
}

async function resolveScope(db, options) {
  const scope = validateOptions(options, { write: options.confirm === true });
  const user = await db.collection('users').findOne({
    $or: [{ user_id: scope.testUserId }, ...(ObjectId.isValid(scope.testUserId) ? [{ _id: new ObjectId(scope.testUserId) }] : [])],
    is_active: { $ne: false },
  });
  if (!user) throw new Error('TENANT_IDENTITY_UNRESOLVED');
  const identities = [scope.testUserId, user._id, user.user_id].filter(Boolean);
  let stay = await db.collection('stays').findOne({
    $and: [
      { $or: ['user_id', 'userId', 'tenant_id', 'tenantId'].flatMap((key) => identities.map((value) => ({ [key]: value }))) },
      { $or: [{ status: { $regex: '^(active|current|occupied|checked_in)$', $options: 'i' } }, { isActive: true }] },
    ],
  });
  if (!stay) {
    stay = await db.collection('reservations').findOne({
      $and: [
        { $or: ['user_id', 'userId', 'tenant_id', 'tenantId'].flatMap((key) => identities.map((value) => ({ [key]: value }))) },
        { $or: [
          { status: { $regex: '^(movein|move_in|active|checked_in)$', $options: 'i' } },
          { occupancyStatus: { $regex: '^(active|checked_in)$', $options: 'i' } },
        ] },
      ],
    });
  }
  if (!stay) throw new Error('NO_ACTIVE_STAY');
  let stayBranch = String(stay.branchId || stay.branch_id || stay.branchCode || stay.branch || '');
  if (!stayBranch) {
    try {
      const resolved = await resolveTenantBranch(db, user);
      stayBranch = String(resolved?.branch?.branchId || '');
    } catch (_error) {
      stayBranch = '';
    }
  }
  if (stayBranch !== scope.branchId) throw new Error('BRANCH_SCOPE_MISMATCH');
  return { ...scope, testTenantId: String(stay.tenantId || stay.tenant_id || user.user_id || user._id) };
}

async function run(options, db = getDb()) {
  const scope = await resolveScope(db, options);
  const survey = buildSampleSurvey(scope);
  if (!options.confirm) return { dryRun: true, action: options.remove ? 'REMOVE' : 'UPSERT', survey };

  if (options.remove) {
    const existing = await db.collection('survey_definitions').findOne({
      surveyId: survey.surveyId, isControlledSample: true, approvalReference: scope.approvalReference,
    });
    if (!existing) return { removed: false, alreadyAbsent: true, surveyId: survey.surveyId };
    await db.collection('survey_responses').deleteMany({ surveyId: existing._id, tenantId: scope.testTenantId });
    await db.collection('survey_definitions').deleteOne({ _id: existing._id, isControlledSample: true });
    return { removed: true, surveyId: survey.surveyId };
  }

  const { createdAt, ...updates } = survey;
  const result = await db.collection('survey_definitions').updateOne(
    { surveyId: survey.surveyId },
    { $set: updates, $setOnInsert: { createdAt } },
    { upsert: true },
  );
  return { seeded: true, idempotent: result.matchedCount > 0, surveyId: survey.surveyId };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options, { write: options.confirm === true });
  await connectToMongo();
  const result = await run(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  assertStagingWriteTarget(process.env, { toolName: 'seedSampleSurvey.js' });
  main().catch((error) => {
    console.error(`Sample survey operation blocked: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = {
  SAMPLE_TITLE, buildSampleSurvey, parseArgs, run, sampleSurveyId, validateOptions,
};
