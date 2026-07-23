'use strict';

const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const { RATING_CATEGORIES } = require('../domain/surveys/surveyEnums');
const { validateDefinition, validateDraft, validateSubmission } = require('../domain/surveys/surveyValidation');
const { resolveEligibility } = require('./surveyEligibility.service');

function surveyError(code, message, status = 400, fields) {
  return Object.assign(new Error(message), { code, status, fields });
}

function surveyFilter(value) {
  const text = String(value || '');
  const choices = [{ surveyId: text }];
  if (ObjectId.isValid(text)) choices.push({ _id: new ObjectId(text) });
  return { $or: choices };
}

function responseFilter(tenantId, survey) {
  return { tenantId: String(tenantId), surveyId: survey._id };
}

function publicSurvey(survey, response, now = new Date()) {
  let tenantResponseStatus = response?.status === 'SUBMITTED'
    ? 'SUBMITTED'
    : response?.status === 'DRAFT' ? 'IN_PROGRESS' : 'NOT_STARTED';
  if (now > survey.availableUntil && tenantResponseStatus !== 'SUBMITTED') tenantResponseStatus = 'EXPIRED';
  return {
    surveyId: survey.surveyId,
    surveyType: survey.surveyType,
    title: survey.title,
    description: survey.description,
    periodStart: survey.periodStart,
    periodEnd: survey.periodEnd,
    availableFrom: survey.availableFrom,
    availableUntil: survey.availableUntil,
    status: survey.status,
    tenantResponseStatus,
  };
}

function defaultQuestions(type) {
  const labels = {
    OVERALL_SATISFACTION: 'Overall Satisfaction',
    ROOM_CONDITION: 'Room Condition',
    CLEANLINESS: 'Cleanliness',
    STAFF_ASSISTANCE: 'Staff Assistance',
    MAINTENANCE_RESPONSE: 'Maintenance Response',
    SECURITY: 'Security',
    INTERNET_CONNECTION: 'Internet Connection',
    FACILITIES_COMMON_AREAS: 'Facilities and Common Areas',
    VALUE_FOR_MONEY: 'Value for Money',
  };
  const questions = RATING_CATEGORIES.map((questionId, order) => ({
    questionId, type: 'RATING', category: questionId, prompt: labels[questionId],
    required: true, options: null, maxLength: null, order,
  }));
  questions.push({
    questionId: 'RECOMMENDATION', type: 'SINGLE_CHOICE', category: 'RECOMMENDATION',
    prompt: 'Would you recommend LilyCrest to others?', required: true,
    options: ['YES', 'NO', 'MAYBE'], maxLength: null, order: 9,
  }, {
    questionId: 'FEEDBACK', type: 'TEXT', category: 'FEEDBACK',
    prompt: 'Please tell us how we can improve your experience.', required: false,
    options: null, maxLength: 1000, order: 10,
  });
  if (type === 'MOVE_OUT') {
    questions.push(
      { questionId: 'MOVE_OUT_REASON', type: 'SINGLE_CHOICE', category: 'MOVE_OUT', prompt: 'Reason for Leaving', required: true, options: ['CONTRACT_COMPLETED', 'TRANSFERRED_LOCATION', 'WORK_OR_SCHOOL_CHANGE', 'FINANCIAL_REASON', 'ROOM_OR_FACILITY_CONCERN', 'SERVICE_CONCERN', 'PERSONAL_REASON', 'OTHER'], maxLength: null, order: 11 },
      { questionId: 'MOVE_OUT_REASON_OTHER', type: 'TEXT', category: 'MOVE_OUT', prompt: 'Please briefly explain.', required: false, options: null, maxLength: 300, order: 12 },
      { questionId: 'RETURN_INTENTION', type: 'SINGLE_CHOICE', category: 'MOVE_OUT', prompt: 'Would you consider staying with LilyCrest again?', required: true, options: ['YES', 'NO', 'MAYBE'], maxLength: null, order: 13 },
      { questionId: 'MOVE_OUT_EXPERIENCE', type: 'RATING', category: 'MOVE_OUT', prompt: 'How satisfied are you with the move-out process?', required: true, options: null, maxLength: null, order: 14 },
    );
  }
  return questions;
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection('survey_definitions').createIndex({ surveyId: 1 }, { unique: true }),
    db.collection('survey_responses').createIndex({ tenantId: 1, surveyId: 1 }, { unique: true }),
    db.collection('survey_responses').createIndex({ surveyId: 1, status: 1, branchId: 1 }),
  ]);
}

async function eligibleSurvey(db, user, id, options = {}) {
  const survey = await db.collection('survey_definitions').findOne(surveyFilter(id));
  if (!survey) throw surveyError('SURVEY_NOT_FOUND', 'This survey is not available right now.', 404);
  const eligibility = await resolveEligibility(db, user, survey);
  if (!eligibility.eligible) throw surveyError('SURVEY_NOT_ELIGIBLE', 'This survey is not available for your account.', 403);
  const now = options.now || new Date();
  if (survey.status !== 'ACTIVE') throw surveyError('SURVEY_UNAVAILABLE', 'This survey is not available right now.', 409);
  if (now < survey.availableFrom) throw surveyError('SURVEY_UNAVAILABLE', 'This survey is not available right now.', 409);
  if (now > survey.availableUntil) throw surveyError('SURVEY_CLOSED', 'The submission period has ended.', 409);
  return { survey, eligibility };
}

async function listForTenant(db, user, now = new Date()) {
  const definitions = await db.collection('survey_definitions').find({
    status: { $in: ['ACTIVE', 'CLOSED', 'ARCHIVED'] },
    availableFrom: { $lte: now },
  }).sort({ availableUntil: 1 }).toArray();
  const result = [];
  for (const survey of definitions) {
    const eligibility = await resolveEligibility(db, user, survey);
    if (!eligibility.eligible) continue;
    const response = await db.collection('survey_responses').findOne(responseFilter(eligibility.tenantId, survey));
    result.push(publicSurvey(survey, response, now));
  }
  return result;
}

async function getForTenant(db, user, id) {
  const { survey, eligibility } = await eligibleSurvey(db, user, id);
  const response = await db.collection('survey_responses').findOne(responseFilter(eligibility.tenantId, survey));
  return { ...publicSurvey(survey, response), questions: survey.questions || defaultQuestions(survey.surveyType), response: response ? { status: response.status, answers: response.answers || [], submittedAt: response.submittedAt } : null };
}

async function saveDraft(db, user, id, answers) {
  const { survey, eligibility } = await eligibleSurvey(db, user, id);
  const filter = responseFilter(eligibility.tenantId, survey);
  const existing = await db.collection('survey_responses').findOne(filter);
  if (existing?.status === 'SUBMITTED') throw surveyError('SURVEY_ALREADY_SUBMITTED', 'This survey has already been submitted.', 409);
  const normalizedAnswers = validateDraft({ ...survey, questions: survey.questions || defaultQuestions(survey.surveyType) }, answers);
  const now = new Date();
  await db.collection('survey_responses').updateOne(filter, {
    $set: { answers: normalizedAnswers, updatedAt: now },
    $setOnInsert: {
      responseId: `response_${uuidv4()}`, surveyId: survey._id,
      tenantId: String(eligibility.tenantId), userId: String(eligibility.userId),
      branchId: eligibility.branchId, status: 'DRAFT', submittedAt: null, createdAt: now,
    },
  }, { upsert: true });
  return { status: 'IN_PROGRESS', updatedAt: now };
}

async function submit(db, user, id, answers) {
  const { survey, eligibility } = await eligibleSurvey(db, user, id);
  const normalizedAnswers = validateSubmission(survey, answers);
  const filter = responseFilter(eligibility.tenantId, survey);
  const now = new Date();
  try {
    const result = await db.collection('survey_responses').findOneAndUpdate(
      { ...filter, status: { $ne: 'SUBMITTED' } },
      {
        $set: { answers: normalizedAnswers, status: 'SUBMITTED', submittedAt: now, updatedAt: now },
        $setOnInsert: {
          responseId: `response_${uuidv4()}`, surveyId: survey._id,
          tenantId: String(eligibility.tenantId), userId: String(eligibility.userId),
          branchId: eligibility.branchId, createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!result) throw surveyError('SURVEY_ALREADY_SUBMITTED', 'This survey has already been submitted.', 409);
    return { status: 'SUBMITTED', submittedAt: now };
  } catch (error) {
    if (error.code === 11000 || error.code === 'SURVEY_ALREADY_SUBMITTED') {
      throw surveyError('SURVEY_ALREADY_SUBMITTED', 'This survey has already been submitted.', 409);
    }
    throw error;
  }
}

async function responseForTenant(db, user, id) {
  const survey = await db.collection('survey_definitions').findOne(surveyFilter(id));
  if (!survey) throw surveyError('SURVEY_NOT_FOUND', 'This survey is not available right now.', 404);
  const eligibility = await resolveEligibility(db, user, survey);
  if (!eligibility.eligible) throw surveyError('SURVEY_NOT_ELIGIBLE', 'This survey is not available for your account.', 403);
  const response = await db.collection('survey_responses').findOne(responseFilter(eligibility.tenantId, survey));
  if (!response) throw surveyError('RESPONSE_NOT_FOUND', 'No survey response was found.', 404);
  return {
    survey: { ...publicSurvey(survey, response), questions: survey.questions || defaultQuestions(survey.surveyType) },
    response: { status: response.status, answers: response.answers || [], submittedAt: response.submittedAt },
  };
}

async function createDefinition(db, input, actor) {
  const value = validateDefinition(input);
  const now = new Date();
  const doc = {
    surveyId: `survey_${uuidv4()}`, ...value, status: 'DRAFT',
    questions: defaultQuestions(value.surveyType), exitSurveyEnabled: input.exitSurveyEnabled === true,
    createdBy: actor.user_id || actor._id, createdAt: now, updatedAt: now,
  };
  await db.collection('survey_definitions').insertOne(doc);
  return doc;
}

async function analytics(db, survey, branchId = null) {
  const filter = { surveyId: survey._id, status: 'SUBMITTED' };
  if (branchId) filter.branchId = String(branchId);
  const responses = await db.collection('survey_responses').find(filter).toArray();
  const sums = {}; const counts = {}; const recommendation = { YES: 0, NO: 0, MAYBE: 0 }; const moveOutReasons = {};
  responses.forEach((response) => response.answers.forEach(({ questionId, value }) => {
    if (typeof value === 'number') { sums[questionId] = (sums[questionId] || 0) + value; counts[questionId] = (counts[questionId] || 0) + 1; }
    if (questionId === 'RECOMMENDATION') recommendation[value] = (recommendation[value] || 0) + 1;
    if (questionId === 'MOVE_OUT_REASON') moveOutReasons[value] = (moveOutReasons[value] || 0) + 1;
  }));
  const averages = Object.fromEntries(Object.keys(sums).map((key) => [key, Number((sums[key] / counts[key]).toFixed(2))]));
  return { submittedResponses: responses.length, averages, recommendationBreakdown: recommendation, moveOutReasonBreakdown: moveOutReasons, smallSample: responses.length < 10 };
}

module.exports = {
  analytics, createDefinition, defaultQuestions, eligibleSurvey, ensureIndexes,
  getForTenant, listForTenant, publicSurvey, responseForTenant, saveDraft, submit, surveyError,
};
