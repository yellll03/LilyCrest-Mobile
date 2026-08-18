// Regression test: the survey feature was decommissioned server-side
// (GET /api/m/surveys/me now 404s permanently), so the surveys list screen
// must not show the generic "Unable to load surveys right now." error card
// with a Retry button that can never succeed. A 404 specifically should show
// a calm "not available" message instead; any other failure keeps the
// original error + Retry behavior.

import { render, waitFor } from '@testing-library/react-native';
import SurveysScreen from '../../app/surveys';

jest.mock('../config/features', () => ({ SURVEY_FEEDBACK_ENABLED: true }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb) => {
    const React = require('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(cb, []);
  },
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
  saveCachedSurveyDashboard: jest.fn().mockResolvedValue(),
}));

const mockGetMySurveys = jest.fn();

jest.mock('../services/api', () => ({
  apiService: { getMySurveys: (...args) => mockGetMySurveys(...args) },
}));

describe('surveys list — decommissioned-feature fallback (regression)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a calm "not available" message (no Retry) when the survey endpoint 404s', async () => {
    mockGetMySurveys.mockRejectedValue({ response: { status: 404 } });

    const { getByText, queryByText } = render(<SurveysScreen />);

    await waitFor(() => expect(queryByText('Surveys are not available at this time.')).toBeTruthy());
    expect(getByText('Surveys are not available at this time.')).toBeTruthy();
    expect(queryByText('Unable to load surveys right now.')).toBeNull();
    expect(queryByText('Retry')).toBeNull();
  });

  it('still shows the error card with Retry for a non-404 failure', async () => {
    mockGetMySurveys.mockRejectedValue({ response: { status: 500 } });

    const { getByText, queryByText } = render(<SurveysScreen />);

    await waitFor(() => expect(queryByText('Unable to load surveys right now.')).toBeTruthy());
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('Surveys are not available at this time.')).toBeNull();
  });
});
