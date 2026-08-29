import fs from 'node:fs';
import path from 'node:path';

jest.mock('../config/firebase', () => ({ getFreshIdToken: jest.fn() }));

const { resolveNotificationRoute } = require('../services/notifications');
const {
  firstInvalidQuestionId, safeSurveyErrorMessage, validateSurveyAnswers, visibleSurveyQuestions,
} = require('../utils/surveyForm');

const ratingQuestions = [
  'OVERALL_SATISFACTION', 'ROOM_CONDITION', 'CLEANLINESS', 'STAFF_ASSISTANCE',
  'MAINTENANCE_RESPONSE', 'SECURITY', 'INTERNET_CONNECTION',
  'FACILITIES_COMMON_AREAS', 'VALUE_FOR_MONEY',
].map((questionId, order) => ({ questionId, order, type: 'RATING', required: true, prompt: questionId }));
const common = [
  ...ratingQuestions,
  { questionId: 'RECOMMENDATION', order: 10, type: 'SINGLE_CHOICE', required: true, options: ['YES', 'NO', 'MAYBE'] },
  { questionId: 'FEEDBACK', order: 11, type: 'TEXT', required: false, maxLength: 1000 },
];
const moveOut = [
  { questionId: 'MOVE_OUT_REASON', order: 12, type: 'SINGLE_CHOICE', required: true },
  { questionId: 'MOVE_OUT_REASON_OTHER', order: 13, type: 'TEXT', required: false },
  { questionId: 'RETURN_INTENTION', order: 14, type: 'SINGLE_CHOICE', required: true },
  { questionId: 'MOVE_OUT_EXPERIENCE', order: 15, type: 'RATING', required: true },
];
const complete = Object.fromEntries(ratingQuestions.map(({ questionId }) => [questionId, 4]));
complete.RECOMMENDATION = 'YES';

describe('tenant survey mobile validation and visibility', () => {
  it('quarterly form excludes every move-out question', () => {
    const ids = visibleSurveyQuestions({ surveyType: 'QUARTERLY', questions: [...common, ...moveOut] }, {}).map((q) => q.questionId);
    moveOut.forEach(({ questionId }) => expect(ids).not.toContain(questionId));
  });

  it('move-out form includes required exit questions but hides OTHER explanation until selected', () => {
    const survey = { surveyType: 'MOVE_OUT', questions: [...common, ...moveOut] };
    expect(visibleSurveyQuestions(survey, {}).map((q) => q.questionId)).toEqual(expect.arrayContaining(['MOVE_OUT_REASON', 'RETURN_INTENTION', 'MOVE_OUT_EXPERIENCE']));
    expect(visibleSurveyQuestions(survey, {}).map((q) => q.questionId)).not.toContain('MOVE_OUT_REASON_OTHER');
    expect(visibleSurveyQuestions(survey, { MOVE_OUT_REASON: 'OTHER' }).map((q) => q.questionId)).toContain('MOVE_OUT_REASON_OTHER');
  });

  it('blocks a missing and invalid rating and identifies the first invalid field', () => {
    const survey = { surveyType: 'QUARTERLY', questions: common };
    expect(validateSurveyAnswers(survey, complete)).toEqual({});
    const missing = { ...complete }; delete missing.OVERALL_SATISFACTION;
    expect(validateSurveyAnswers(survey, missing).OVERALL_SATISFACTION).toBe('Please answer this question.');
    expect(firstInvalidQuestionId(survey, missing)).toBe('OVERALL_SATISFACTION');
    expect(validateSurveyAnswers(survey, { ...complete, ROOM_CONDITION: 6 }).ROOM_CONDITION).toMatch(/1 to 5/);
  });

  it('requires OTHER explanation and rejects feedback over 1000 characters', () => {
    const survey = { surveyType: 'MOVE_OUT', questions: [...common, ...moveOut] };
    const answers = { ...complete, MOVE_OUT_REASON: 'OTHER', RETURN_INTENTION: 'MAYBE', MOVE_OUT_EXPERIENCE: 4 };
    expect(validateSurveyAnswers(survey, answers).MOVE_OUT_REASON_OTHER).toBe('Please provide a reason.');
    expect(validateSurveyAnswers({ surveyType: 'QUARTERLY', questions: common }, { ...complete, FEEDBACK: 'x'.repeat(1001) }).FEEDBACK).toBe('Your feedback must not exceed 1000 characters.');
  });

  it('hides raw backend implementation errors', () => {
    const error = { response: { data: { detail: 'MongoServerError E11000 duplicate key collection survey_responses' } } };
    expect(safeSurveyErrorMessage(error, 'Safe fallback')).toBe('Safe fallback');
    expect(safeSurveyErrorMessage({ response: { data: { detail: 'This survey has already been submitted.' } } }, 'fallback')).toBe('This survey has already been submitted.');
  });
});

describe('survey notification navigation — feature hidden for deployment testing', () => {
  it('never routes a survey notification into the (hidden) survey screens', () => {
    expect(resolveNotificationRoute({ url: '/surveys/survey_q3' })).toBe('/notifications');
    expect(resolveNotificationRoute({ type: 'survey', surveyId: 'move-out-1' })).toBe('/notifications');
    expect(resolveNotificationRoute({ type: 'surveys' })).toBe('/notifications');
  });
});

describe('survey notification navigation — feature re-enabled', () => {
  beforeEach(() => jest.resetModules());

  it('opens the correct survey form from a survey URL or survey ID once SURVEY_FEEDBACK_ENABLED is flipped back on', () => {
    jest.doMock('../config/features', () => ({ SURVEY_FEEDBACK_ENABLED: true }));
    jest.doMock('../config/firebase', () => ({ getFreshIdToken: jest.fn() }));
    const { resolveNotificationRoute: resolveWhenEnabled } = require('../services/notifications');
    expect(resolveWhenEnabled({ url: '/surveys/survey_q3' })).toEqual({ pathname: '/survey-form', params: { surveyId: 'survey_q3' } });
    expect(resolveWhenEnabled({ type: 'survey', surveyId: 'move-out-1' })).toEqual({ pathname: '/survey-form', params: { surveyId: 'move-out-1' } });
  });
});

describe('survey mobile source contracts', () => {
  const appRoot = path.resolve(process.cwd(), 'app');
  const dashboard = fs.readFileSync(path.join(appRoot, 'surveys.jsx'), 'utf8');
  const form = fs.readFileSync(path.join(appRoot, 'survey-form.jsx'), 'utf8');

  it('renders the required dashboard sections and empty states', () => {
    ['Available', 'In Progress', 'Submitted', 'History', 'No survey is available right now.', 'You have no submitted surveys yet.'].forEach((text) => expect(dashboard).toContain(text));
  });

  it('keeps failed answers, prevents repeat processing, scrolls to validation, and supports small screens', () => {
    expect(form).toContain('if (saving || confirmationOpen.current) return');
    expect(form).toContain('scrollRef.current?.scrollTo');
    expect(form).toContain('minWidth: 44');
    expect(form).toContain('KeyboardAvoidingView');
    expect(form).not.toMatch(/setAnswers\(\{\}\).*catch/s);
  });

  it('marks history read-only and displays its submission date without backend metadata', () => {
    expect(form).toContain('Submitted responses are read-only.');
    expect(form).toContain('submittedAt');
    expect(form).not.toContain('Tenant ID');
    expect(form).not.toContain('responseId');
  });
});
