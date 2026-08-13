import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'lilycrest_survey_draft_v1';
const DEFINITION_PREFIX = 'lilycrest_survey_definition_v1';
const DASHBOARD_PREFIX = 'lilycrest_survey_dashboard_v1';

export function surveyDraftKey(userId, surveyId) {
  if (!userId || !surveyId) throw new Error('A tenant and survey are required for draft storage.');
  return `${PREFIX}:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(surveyId))}`;
}

export async function loadSurveyDraft(userId, surveyId) {
  const raw = await AsyncStorage.getItem(surveyDraftKey(userId, surveyId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    await AsyncStorage.removeItem(surveyDraftKey(userId, surveyId));
    return null;
  }
}

export function saveSurveyDraftLocal(userId, surveyId, answers) {
  return AsyncStorage.setItem(surveyDraftKey(userId, surveyId), JSON.stringify({ answers, updatedAt: new Date().toISOString() }));
}

export function clearSurveyDraft(userId, surveyId) {
  return AsyncStorage.removeItem(surveyDraftKey(userId, surveyId));
}

export function surveyDefinitionKey(userId, surveyId) {
  if (!userId || !surveyId) throw new Error('A tenant and survey are required for cached survey storage.');
  return `${DEFINITION_PREFIX}:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(surveyId))}`;
}

export async function loadCachedSurvey(userId, surveyId) {
  const raw = await AsyncStorage.getItem(surveyDefinitionKey(userId, surveyId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export function saveCachedSurvey(userId, surveyId, survey) {
  return AsyncStorage.setItem(surveyDefinitionKey(userId, surveyId), JSON.stringify(survey));
}

export function surveyDashboardKey(userId) {
  if (!userId) throw new Error('A tenant is required for survey dashboard storage.');
  return `${DASHBOARD_PREFIX}:${encodeURIComponent(String(userId))}`;
}

export async function loadCachedSurveyDashboard(userId) {
  const raw = await AsyncStorage.getItem(surveyDashboardKey(userId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export function saveCachedSurveyDashboard(userId, surveys) {
  return AsyncStorage.setItem(surveyDashboardKey(userId), JSON.stringify({ surveys, cachedAt: new Date().toISOString() }));
}

export function answersObjectToArray(answers = {}) {
  return Object.entries(answers)
    .filter(([, value]) => value !== '' && value != null)
    .map(([questionId, value]) => ({ questionId, value }));
}
