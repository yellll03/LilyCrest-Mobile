export function toAnswerObject(list = []) {
  return Object.fromEntries((list || []).map((entry) => [entry.questionId, entry.value]));
}

export function visibleSurveyQuestions(survey, answers = {}) {
  return (survey?.questions || []).filter((question) => {
    if (survey?.surveyType !== 'MOVE_OUT' && ['MOVE_OUT_REASON', 'MOVE_OUT_REASON_OTHER', 'RETURN_INTENTION', 'MOVE_OUT_EXPERIENCE'].includes(question.questionId)) return false;
    if (question.questionId === 'MOVE_OUT_REASON_OTHER' && answers.MOVE_OUT_REASON !== 'OTHER') return false;
    return true;
  });
}

export function validateSurveyAnswers(survey, answers = {}) {
  const errors = {};
  visibleSurveyQuestions(survey, answers).forEach((question) => {
    const value = answers[question.questionId];
    if (question.required && (value === '' || value == null)) errors[question.questionId] = 'Please answer this question.';
    if (question.type === 'RATING' && value != null && (!Number.isInteger(value) || value < 1 || value > 5)) {
      errors[question.questionId] = 'Please choose a rating from 1 to 5.';
    }
  });
  if (survey?.surveyType === 'MOVE_OUT' && answers.MOVE_OUT_REASON === 'OTHER' && !String(answers.MOVE_OUT_REASON_OTHER || '').trim()) {
    errors.MOVE_OUT_REASON_OTHER = 'Please provide a reason.';
  }
  if (String(answers.FEEDBACK || '').length > 1000) errors.FEEDBACK = 'Your feedback must not exceed 1000 characters.';
  return errors;
}

export function firstInvalidQuestionId(survey, answers = {}) {
  const errors = validateSurveyAnswers(survey, answers);
  return visibleSurveyQuestions(survey, answers).find((question) => errors[question.questionId])?.questionId || null;
}

export function safeSurveyErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail !== 'string' || !detail.trim()) return fallback;
  if (/mongo|e11000|duplicate key|node\.?js|typeerror|referenceerror|stack trace|collection\(|objectid/i.test(detail)) return fallback;
  return detail.trim().slice(0, 240);
}
