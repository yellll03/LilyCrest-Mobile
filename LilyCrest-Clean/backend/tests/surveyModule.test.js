'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { validateSubmission } = require('../domain/surveys/surveyValidation');
const { resolveEligibility } = require('../services/surveyEligibility.service');
const { submit } = require('../services/survey.service');
const { surveyAdminMiddleware, authorizedBranch } = require('../middleware/surveyAccess');

const now = new Date('2026-07-24T00:00:00.000Z');
const survey = (overrides = {}) => ({
  _id: new ObjectId(), surveyId: 'survey_q3', surveyType: 'QUARTERLY', status: 'ACTIVE',
  periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30'),
  availableFrom: new Date('2026-07-01'), availableUntil: new Date('2026-09-30'),
  ...overrides,
});
const completeAnswers = (extra = []) => [
  'OVERALL_SATISFACTION', 'ROOM_CONDITION', 'CLEANLINESS', 'STAFF_ASSISTANCE',
  'MAINTENANCE_RESPONSE', 'SECURITY', 'INTERNET_CONNECTION',
  'FACILITIES_COMMON_AREAS', 'VALUE_FOR_MONEY',
].map((questionId) => ({ questionId, value: 4 })).concat([{ questionId: 'RECOMMENDATION', value: 'YES' }], extra);

function cursor(records) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return records; } };
}
function eligibilityDb({ stays = [], reservations = [], requests = [] } = {}) {
  return { collection(name) {
    const records = name === 'stays' ? stays : name === 'reservations' ? reservations : requests;
    return { find() { return cursor(records); } };
  } };
}

test('all required ratings and canonical recommendation are accepted', () => {
  assert.equal(validateSubmission(survey(), completeAnswers()).length, 10);
});
test('missing required rating is rejected', () => {
  assert.throws(() => validateSubmission(survey(), completeAnswers().slice(1)), /highlighted/);
});
test('ratings outside 1 to 5 are rejected', () => {
  const answers = completeAnswers(); answers[0].value = 6;
  assert.throws(() => validateSubmission(survey(), answers), /highlighted/);
});
test('recommendation must use a canonical value', () => {
  const answers = completeAnswers(); answers.at(-1).value = 'Oo';
  assert.throws(() => validateSubmission(survey(), answers), /highlighted/);
});
test('feedback over 1000 characters is rejected', () => {
  assert.throws(() => validateSubmission(survey(), completeAnswers([{ questionId: 'FEEDBACK', value: 'x'.repeat(1001) }])), /highlighted/);
});
test('feedback wording is preserved except leading and trailing whitespace', () => {
  const result = validateSubmission(survey(), completeAnswers([{ questionId: 'FEEDBACK', value: '  Keep MY wording!  ' }]));
  assert.equal(result.find((answer) => answer.questionId === 'FEEDBACK').value, 'Keep MY wording!');
});
test('OTHER move-out reason requires an explanation', () => {
  const moveOut = survey({ surveyType: 'MOVE_OUT' });
  const answers = completeAnswers([
    { questionId: 'MOVE_OUT_REASON', value: 'OTHER' },
    { questionId: 'RETURN_INTENTION', value: 'MAYBE' },
    { questionId: 'MOVE_OUT_EXPERIENCE', value: 3 },
  ]);
  assert.throws(() => validateSubmission(moveOut, answers), /highlighted/);
});
test('active tenant can view quarterly survey', async () => {
  const result = await resolveEligibility(eligibilityDb({ stays: [{ tenantId: 'tenant-1', branchId: 'b1', status: 'active' }] }), { user_id: 'u1' }, survey());
  assert.equal(result.eligible, true);
});
test('ineligible applicant cannot view quarterly survey', async () => {
  const result = await resolveEligibility(eligibilityDb({ reservations: [{ status: 'pending' }] }), { user_id: 'u1' }, survey());
  assert.equal(result.eligible, false);
});
test('moved-out tenant is eligible for a quarterly period that covers the stay', async () => {
  const result = await resolveEligibility(eligibilityDb({ stays: [{ status: 'completed', startDate: '2026-06-01', endDate: '2026-07-10' }] }), { user_id: 'u1' }, survey());
  assert.equal(result.eligible, true);
});
test('completed stay outside quarterly period is not eligible', async () => {
  const result = await resolveEligibility(eligibilityDb({ stays: [{ status: 'completed', startDate: '2025-01-01', endDate: '2025-03-01' }] }), { user_id: 'u1' }, survey());
  assert.equal(result.eligible, false);
});
test('move-out survey requires approved eligibility condition', async () => {
  const db = eligibilityDb({ stays: [{ status: 'active', tenantId: 't1' }], requests: [{ status: 'pending' }] });
  assert.equal((await resolveEligibility(db, { user_id: 'u1' }, survey({ surveyType: 'MOVE_OUT' }))).eligible, false);
});
test('approved move-out request enables move-out survey for verified tenant', async () => {
  const db = eligibilityDb({ stays: [{ status: 'active', tenantId: 't1' }], requests: [{ status: 'approved' }] });
  assert.equal((await resolveEligibility(db, { user_id: 'u1' }, survey({ surveyType: 'MOVE_OUT' }))).eligible, true);
});
test('branch-scoped survey rejects a tenant in another branch', async () => {
  const db = eligibilityDb({ stays: [{ status: 'active', tenantId: 't1', branchId: 'b2' }] });
  assert.equal((await resolveEligibility(db, { user_id: 'u1' }, survey({ branchId: 'b1' }))).eligible, false);
});
test('controlled sample survey is hidden from tenants outside its exact test scope', async () => {
  const db = eligibilityDb({ stays: [{ status: 'active', tenantId: 't1', branchId: 'b1' }] });
  const result = await resolveEligibility(db, { user_id: 'u2' }, survey({
    branchId: 'b1',
    eligibleTestUserIds: ['u1'],
    eligibleTestTenantIds: ['t1'],
  }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'BRANCH_SCOPE_MISMATCH');
});
test('survey management requires an explicit permission for admin', () => {
  let status;
  surveyAdminMiddleware({ user: { role: 'admin', permissions: [] } }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('must not continue'));
  assert.equal(status, 403);
});
test('survey-management admin is restricted to their branch', () => {
  assert.equal(authorizedBranch({ user: { role: 'admin', branchId: 'b1' } }), 'b1');
});
test('owner can request cross-branch aggregate results', () => {
  assert.equal(authorizedBranch({ user: { role: 'owner' } }), null);
});

function submitDb(definition) {
  let stored = null;
  const stay = { tenantId: 'tenant-1', userId: 'u1', branchId: 'b1', status: 'active' };
  return {
    collection(name) {
      if (name === 'survey_definitions') return { async findOne() { return definition; } };
      if (name === 'stays') return { find() { return cursor([stay]); } };
      if (name === 'reservations' || name === 'move_out_requests') return { find() { return cursor([]); } };
      if (name === 'survey_responses') return {
        async findOneAndUpdate(filter, update) {
          if (stored?.status === 'SUBMITTED') {
            const error = new Error('duplicate'); error.code = 11000; throw error;
          }
          stored = { ...(stored || update.$setOnInsert), ...update.$set };
          return stored;
        },
      };
      throw new Error(`Unexpected collection ${name}`);
    },
  };
}
test('duplicate submission and rapid retry produce one submitted response', async () => {
  const definition = survey({ availableFrom: new Date('2026-01-01'), availableUntil: new Date('2026-12-31') });
  const db = submitDb(definition);
  assert.equal((await submit(db, { user_id: 'u1' }, definition.surveyId, completeAnswers())).status, 'SUBMITTED');
  await assert.rejects(() => submit(db, { user_id: 'u1' }, definition.surveyId, completeAnswers()), /already been submitted/);
});
test('closed survey rejects submission', async () => {
  const definition = survey({ status: 'CLOSED' });
  await assert.rejects(() => submit(submitDb(definition), { user_id: 'u1' }, definition.surveyId, completeAnswers()), /not available/);
});
test('expired survey rejects submission', async () => {
  const definition = survey({ availableUntil: new Date('2020-01-01') });
  await assert.rejects(() => submit(submitDb(definition), { user_id: 'u1' }, definition.surveyId, completeAnswers()), /period has ended/);
});
