/* global test */
import {
  AUTH_MESSAGES,
  classifyAuthError,
  createRequestLock,
  authErrorTypeForUi,
  validateLoginInput,
} from '../utils/authStability';

describe('authentication stability', () => {
  test('invalid email blocks login', () => {
    expect(validateLoginInput('not-an-email', 'password').valid).toBe(false);
    expect(validateLoginInput('not-an-email', 'password').message).toBe(AUTH_MESSAGES.invalidEmail);
  });

  test('empty password blocks login', () => {
    expect(validateLoginInput('tenant@example.com', '').message).toBe(AUTH_MESSAGES.emptyFields);
  });

  test('password characters are preserved exactly', () => {
    const password = '  exact password  ';
    expect(validateLoginInput(' Tenant@Example.com ', password)).toMatchObject({
      valid: true,
      email: 'tenant@example.com',
      password,
    });
  });

  test('rapid submissions produce one request', async () => {
    const lock = createRequestLock();
    let resolveRequest;
    const request = jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));

    const first = lock.run(request);
    const second = lock.run(request);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toEqual({ skipped: true });
    resolveRequest({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
  });

  test.each([
    [{ code: 'auth/invalid-credential' }, AUTH_MESSAGES.invalidCredentials],
    [{ code: 'auth/network-request-failed', request: {}, message: 'Firebase: network request failed' }, AUTH_MESSAGES.offline],
    [{ code: 'auth/operation-not-allowed' }, AUTH_MESSAGES.providerUnavailable],
    [{ code: 'auth/user-disabled' }, AUTH_MESSAGES.accountDisabled],
    [{ request: {}, message: 'Network Error' }, AUTH_MESSAGES.offline],
    [{ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }, AUTH_MESSAGES.timeout],
    [{ response: { status: 503 }, message: 'Request failed' }, AUTH_MESSAGES.backendUnavailable],
    [{ response: { status: 503, data: { code: 'OTP_DELIVERY_UNAVAILABLE' } } }, AUTH_MESSAGES.otpDeliveryUnavailable],
    [{ response: { status: 401, data: { detail: 'Firebase: secret raw error' } } }, AUTH_MESSAGES.invalidCredentials],
    [{ response: { status: 429, data: { detail: 'Axios raw error' } } }, AUTH_MESSAGES.tooManyRequests],
  ])('maps provider/network errors without leaking raw details', (error, expected) => {
    expect(classifyAuthError(error).message).toBe(expected);
  });

  test('backend access and missing-profile responses are not network failures', () => {
    expect(classifyAuthError({ response: { status: 403 } }).type).toBe('access');
    expect(classifyAuthError({ response: { status: 404 } }).type).toBe('profile');
  });

  test('email verification has a distinct non-network message', () => {
    expect(AUTH_MESSAGES.verifyEmail).not.toBe(AUTH_MESSAGES.offline);
  });

  test('only real connectivity/server classes use network presentation', () => {
    expect(authErrorTypeForUi('offline')).toBe('network');
    expect(authErrorTypeForUi('profile')).toBe('access');
    expect(authErrorTypeForUi('configuration')).toBe('unexpected');
    expect(authErrorTypeForUi('credentials')).toBe('credentials');
  });

  test('forgot-password success message is enumeration safe', () => {
    expect(AUTH_MESSAGES.forgotSuccess)
      .toBe('If an account exists for this email, a password reset link has been sent.');
  });
});
