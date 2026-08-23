import { classifyGoogleAuthError } from '../utils/googleAuthError';

const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

describe('Google authentication error classification', () => {
  it('treats user cancellation as a non-fatal cancelled state', () => {
    expect(classifyGoogleAuthError({ code: 'SIGN_IN_CANCELLED' }, statusCodes, 'account-selection')).toEqual({
      cancelled: true,
      type: 'cancelled',
      stage: 'account-selection',
      code: 'SIGN_IN_CANCELLED',
      message: 'Sign-in cancelled',
    });
  });

  it('distinguishes missing iOS OAuth configuration from credentials', () => {
    expect(classifyGoogleAuthError(
      { code: '-1', message: 'No active configuration. Make sure GIDClientID and URL scheme are present.' },
      statusCodes,
      'native-configuration',
    )).toMatchObject({
      cancelled: false,
      type: 'configuration',
      stage: 'native-configuration',
    });
  });

  it('maps Firebase connectivity failure without exposing its raw message', () => {
    const result = classifyGoogleAuthError(
      { code: 'auth/network-request-failed', message: 'provider internals' },
      statusCodes,
      'firebase-credential',
    );
    expect(result.type).toBe('network');
    expect(result.message).toBe('Unable to connect. Please check your internet connection.');
    expect(result.message).not.toContain('provider internals');
  });

  it('keeps unknown native errors generic but retains a stable diagnostic code and stage', () => {
    expect(classifyGoogleAuthError({ code: 'mystery-native-code' }, statusCodes, 'token-retrieval')).toEqual({
      cancelled: false,
      type: 'unknown',
      stage: 'token-retrieval',
      code: 'mystery-native-code',
      message: 'Unable to sign in with Google. Please try again.',
    });
  });
});
