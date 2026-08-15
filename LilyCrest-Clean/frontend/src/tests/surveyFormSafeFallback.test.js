// Regression test for the device-proven "Survey missing safe fallback"
// finding: a 200 response whose body has no usable `survey` object (malformed
// upstream payload, not a network error) used to leave `survey` falsy with an
// empty `message`, so the `!survey` branch in survey-form.jsx rendered a
// blank screen instead of a safe error state. Renders the real screen with
// only its data dependencies mocked — not a source-string assertion.

import { render, waitFor } from '@testing-library/react-native';
import SurveyFormScreen from '../../app/survey-form';

jest.mock('../config/features', () => ({ SURVEY_FEEDBACK_ENABLED: true }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({ surveyId: 'survey-1', responseStatus: undefined }),
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { user_id: 'tenant-a' } }),
}));

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999',
      surface: '#f5f5f5', border: '#ddd', accent: '#204B7E',
    },
  }),
}));

jest.mock('../services/surveyDrafts', () => ({
  loadSurveyDraft: jest.fn().mockResolvedValue(null),
  loadCachedSurvey: jest.fn().mockResolvedValue(null),
  saveCachedSurvey: jest.fn().mockResolvedValue(),
  saveSurveyDraftLocal: jest.fn().mockResolvedValue(),
  clearSurveyDraft: jest.fn().mockResolvedValue(),
  answersObjectToArray: (answers) => Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
}));

const mockGetMySurvey = jest.fn();

jest.mock('../services/api', () => ({
  apiService: {
    getMySurvey: (...args) => mockGetMySurvey(...args),
    getMySurveyResponse: jest.fn(),
    saveSurveyDraft: jest.fn(),
    submitSurvey: jest.fn(),
  },
  isNetworkOrColdStartError: () => false,
}));

describe('survey-form safe fallback for malformed payloads (regression)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a safe error message instead of a blank screen when the survey body is missing', async () => {
    mockGetMySurvey.mockResolvedValue({ data: {} });

    const { getByText, queryByText } = render(<SurveyFormScreen />);

    await waitFor(() => expect(queryByText('This survey is not available right now.')).toBeTruthy());
    expect(getByText('This survey is not available right now.')).toBeTruthy();
  });

  it('shows a safe error message when the API resolves with a null body', async () => {
    mockGetMySurvey.mockResolvedValue({ data: null });

    const { queryByText } = render(<SurveyFormScreen />);

    await waitFor(() => expect(queryByText('This survey is not available right now.')).toBeTruthy());
  });

  it('renders normally when the survey payload is well-formed', async () => {
    mockGetMySurvey.mockResolvedValue({
      data: {
        surveyId: 'survey-1',
        title: 'Quarterly Satisfaction',
        description: 'Tell us how we are doing.',
        surveyType: 'QUARTERLY',
        questions: [],
        response: { answers: [] },
      },
    });

    const { queryByText } = render(<SurveyFormScreen />);

    await waitFor(() => expect(queryByText('Tell us how we are doing.')).toBeTruthy());
  });
});
