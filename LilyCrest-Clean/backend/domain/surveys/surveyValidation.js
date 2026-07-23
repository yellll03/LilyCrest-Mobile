'use strict';

const {
  MOVE_OUT_REASONS, RATING_CATEGORIES, RECOMMENDATION_VALUES, SURVEY_TYPES,
} = require('./surveyEnums');

const MOVE_OUT_FIELDS = Object.freeze(['MOVE_OUT_REASON', 'RETURN_INTENTION', 'MOVE_OUT_EXPERIENCE']);

function validationError(message, fields = {}) {
  return Object.assign(new Error(message), { code: 'SURVEY_VALIDATION_FAILED', status: 422, fields });
}

function answersToMap(answers) {
  if (!Array.isArray(answers)) throw validationError('Please complete all required survey questions.');
  const map = new Map();
  for (const answer of answers) {
    const questionId = String(answer?.questionId || '').trim();
    if (!questionId || map.has(questionId)) throw validationError('Survey answers contain an invalid question.');
    map.set(questionId, answer.value);
  }
  return map;
}

function validateSubmission(survey, answers) {
  const map = answersToMap(answers);
  const fields = {};
  const normalized = [];

  for (const category of RATING_CATEGORIES) {
    const value = map.get(category);
    if (!Number.isInteger(value) || value < 1 || value > 5) fields[category] = 'Select a rating from 1 to 5.';
    else normalized.push({ questionId: category, value });
  }

  const recommendation = map.get('RECOMMENDATION');
  if (!RECOMMENDATION_VALUES.includes(recommendation)) fields.RECOMMENDATION = 'Select Yes, No, or Maybe.';
  else normalized.push({ questionId: 'RECOMMENDATION', value: recommendation });

  const rawFeedback = map.get('FEEDBACK');
  if (rawFeedback != null && typeof rawFeedback !== 'string') fields.FEEDBACK = 'Enter valid feedback.';
  else {
    const feedback = String(rawFeedback || '').trim();
    if (feedback.length > 1000) fields.FEEDBACK = 'Feedback must be 1000 characters or less.';
    else if (feedback) normalized.push({ questionId: 'FEEDBACK', value: feedback });
  }

  if (survey.surveyType === 'MOVE_OUT') {
    const reason = map.get('MOVE_OUT_REASON');
    if (!MOVE_OUT_REASONS.includes(reason)) fields.MOVE_OUT_REASON = 'Select a reason for leaving.';
    else normalized.push({ questionId: 'MOVE_OUT_REASON', value: reason });

    const explanation = String(map.get('MOVE_OUT_REASON_OTHER') || '').trim();
    if (reason === 'OTHER' && !explanation) fields.MOVE_OUT_REASON_OTHER = 'Please briefly explain your reason.';
    if (explanation.length > 300) fields.MOVE_OUT_REASON_OTHER = 'Explanation must be 300 characters or less.';
    if (explanation) normalized.push({ questionId: 'MOVE_OUT_REASON_OTHER', value: explanation });

    const returnIntention = map.get('RETURN_INTENTION');
    if (!RECOMMENDATION_VALUES.includes(returnIntention)) fields.RETURN_INTENTION = 'Select Yes, No, or Maybe.';
    else normalized.push({ questionId: 'RETURN_INTENTION', value: returnIntention });

    const experience = map.get('MOVE_OUT_EXPERIENCE');
    if (!Number.isInteger(experience) || experience < 1 || experience > 5) {
      fields.MOVE_OUT_EXPERIENCE = 'Select a rating from 1 to 5.';
    } else normalized.push({ questionId: 'MOVE_OUT_EXPERIENCE', value: experience });
  }

  if (Object.keys(fields).length) throw validationError('Please review the highlighted questions.', fields);
  return normalized;
}

function validateDraft(survey, answers) {
  const map = answersToMap(answers);
  if (map.size > 20) throw validationError('Survey draft contains too many answers.');
  const questions = new Map((survey.questions || []).map((question) => [question.questionId, question]));
  const normalized = [];
  for (const [questionId, value] of map) {
    const question = questions.get(questionId);
    if (!question) throw validationError('Survey draft contains an invalid question.');
    if (question.type === 'RATING' && (!Number.isInteger(value) || value < 1 || value > 5)) {
      throw validationError('Draft ratings must be from 1 to 5.', { [questionId]: 'Select a rating from 1 to 5.' });
    }
    if (question.type === 'SINGLE_CHOICE' && !question.options?.includes(value)) {
      throw validationError('Survey draft contains an invalid choice.', { [questionId]: 'Select one of the available choices.' });
    }
    if (question.type === 'TEXT') {
      if (typeof value !== 'string' || value.trim().length > (question.maxLength || 1000)) {
        throw validationError('Survey draft text is too long.', { [questionId]: `Use ${question.maxLength || 1000} characters or less.` });
      }
      normalized.push({ questionId, value: value.trim() });
    } else normalized.push({ questionId, value });
  }
  return normalized;
}

function validateDefinition(input = {}, existing = null) {
  const surveyType = String(input.surveyType || existing?.surveyType || '').toUpperCase();
  if (!SURVEY_TYPES.includes(surveyType)) throw validationError('Survey type must be QUARTERLY or MOVE_OUT.');
  const dateFields = ['periodStart', 'periodEnd', 'availableFrom', 'availableUntil'];
  const dates = {};
  dateFields.forEach((field) => {
    dates[field] = new Date(input[field] || existing?.[field]);
    if (Number.isNaN(dates[field].getTime())) throw validationError(`${field} must be a valid date.`);
  });
  if (dates.periodStart > dates.periodEnd || dates.availableFrom > dates.availableUntil) {
    throw validationError('Survey date ranges are invalid.');
  }
  const title = String(input.title ?? existing?.title ?? '').trim();
  const description = String(input.description ?? existing?.description ?? '').trim();
  if (!title || title.length > 160) throw validationError('Survey title is required and must be 160 characters or less.');
  return { surveyType, title, description, ...dates, branchId: input.branchId ?? existing?.branchId ?? null };
}

module.exports = { MOVE_OUT_FIELDS, answersToMap, validateDefinition, validateDraft, validateSubmission, validationError };
