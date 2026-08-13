import AsyncStorage from '@react-native-async-storage/async-storage';
const {
  clearSurveyDraft, loadCachedSurvey, loadCachedSurveyDashboard, loadSurveyDraft,
  saveCachedSurvey, saveCachedSurveyDashboard, saveSurveyDraftLocal, surveyDraftKey,
} = require('../services/surveyDrafts');

describe('tenant survey draft isolation', () => {
  beforeEach(() => AsyncStorage.clear());

  it('isolates drafts by authenticated tenant and survey', async () => {
    await saveSurveyDraftLocal('tenant-a', 'survey-1', { OVERALL_SATISFACTION: 5 });
    expect(await loadSurveyDraft('tenant-a', 'survey-1')).toEqual(expect.objectContaining({ answers: { OVERALL_SATISFACTION: 5 } }));
    expect(await loadSurveyDraft('tenant-b', 'survey-1')).toBeNull();
    expect(surveyDraftKey('tenant-a', 'survey-1')).not.toBe(surveyDraftKey('tenant-b', 'survey-1'));
  });

  it('clears the local draft after confirmed submission', async () => {
    await saveSurveyDraftLocal('tenant-a', 'survey-1', { RECOMMENDATION: 'YES' });
    await clearSurveyDraft('tenant-a', 'survey-1');
    expect(await loadSurveyDraft('tenant-a', 'survey-1')).toBeNull();
  });

  it('restores the cached form and dashboard only for the same tenant', async () => {
    await saveCachedSurvey('tenant-a', 'survey-1', { surveyId: 'survey-1', questions: [{ questionId: 'Q1' }] });
    await saveCachedSurveyDashboard('tenant-a', [{ surveyId: 'survey-1' }]);
    expect(await loadCachedSurvey('tenant-a', 'survey-1')).toEqual(expect.objectContaining({ surveyId: 'survey-1' }));
    expect(await loadCachedSurvey('tenant-b', 'survey-1')).toBeNull();
    expect(await loadCachedSurveyDashboard('tenant-a')).toEqual(expect.objectContaining({ surveys: [{ surveyId: 'survey-1' }] }));
    expect(await loadCachedSurveyDashboard('tenant-b')).toBeNull();
  });
});
