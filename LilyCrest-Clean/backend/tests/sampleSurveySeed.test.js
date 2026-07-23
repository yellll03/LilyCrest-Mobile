'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const {
  SAMPLE_TITLE, buildSampleSurvey, run, validateOptions,
} = require('../scripts/seedSampleSurvey');

const OPTIONS = {
  environment: process.env.NODE_ENV || 'development',
  administratorId: new ObjectId().toString(),
  approvalReference: 'QA-2026-07-24',
  branchId: 'gil-puyat',
  testUserId: 'user-test-1',
  availableFrom: '2026-07-24T00:00:00Z',
  availableUntil: '2026-08-24T00:00:00Z',
};

function fakeDb() {
  const definitions = [];
  const responses = [];
  const user = { _id: new ObjectId(), user_id: OPTIONS.testUserId, is_active: true };
  const stay = { user_id: OPTIONS.testUserId, tenantId: 'tenant-test-1', branchId: OPTIONS.branchId, status: 'active' };
  return {
    definitions,
    responses,
    collection(name) {
      if (name === 'users') return { findOne: async () => user };
      if (name === 'stays') return { findOne: async () => stay };
      if (name === 'survey_definitions') return {
        findOne: async (filter) => definitions.find((item) => item.surveyId === filter.surveyId) || null,
        updateOne: async (filter, update) => {
          const existing = definitions.find((item) => item.surveyId === filter.surveyId);
          if (existing) {
            Object.assign(existing, update.$set);
            return { matchedCount: 1, upsertedCount: 0 };
          }
          definitions.push({ _id: new ObjectId(), surveyId: filter.surveyId, ...update.$setOnInsert, ...update.$set });
          return { matchedCount: 0, upsertedCount: 1 };
        },
        deleteOne: async (filter) => {
          const index = definitions.findIndex((item) => String(item._id) === String(filter._id));
          if (index >= 0) definitions.splice(index, 1);
          return { deletedCount: index >= 0 ? 1 : 0 };
        },
      };
      if (name === 'survey_responses') return {
        deleteMany: async () => { responses.splice(0); return { deletedCount: 0 }; },
      };
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

test('sample definition uses approved questions and exact test scope', () => {
  const survey = buildSampleSurvey({
    ...OPTIONS,
    testTenantId: 'tenant-test-1',
    availableFrom: new Date(OPTIONS.availableFrom),
    availableUntil: new Date(OPTIONS.availableUntil),
  });
  assert.equal(survey.title, SAMPLE_TITLE);
  assert.equal(survey.status, 'ACTIVE');
  assert.deepEqual(survey.eligibleTestUserIds, [OPTIONS.testUserId]);
  assert.deepEqual(survey.eligibleTestTenantIds, ['tenant-test-1']);
  assert.equal(survey.questions.filter((question) => question.type === 'RATING').length, 9);
  assert.deepEqual(survey.questions.find((question) => question.questionId === 'RECOMMENDATION').options, ['YES', 'NO', 'MAYBE']);
  assert.equal(survey.questions.find((question) => question.questionId === 'FEEDBACK').maxLength, 1000);
});

test('write gates require explicit confirmation and matching environment', () => {
  assert.throws(() => validateOptions(OPTIONS, { write: true }), /--confirm/);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.throws(() => validateOptions({ ...OPTIONS, environment: 'development', confirm: true }, { write: true }), /exactly match/);
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
});

test('seed is idempotent and controlled removal is safe', async () => {
  const db = fakeDb();
  const write = { ...OPTIONS, confirm: true };
  const first = await run(write, db);
  const second = await run(write, db);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(db.definitions.length, 1);
  const removed = await run({ ...write, remove: true }, db);
  const removedAgain = await run({ ...write, remove: true }, db);
  assert.equal(removed.removed, true);
  assert.equal(removedAgain.alreadyAbsent, true);
});
