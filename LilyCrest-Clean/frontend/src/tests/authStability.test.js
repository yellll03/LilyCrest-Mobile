/* global test */
import {
  AUTH_MESSAGES,
  classifyAuthError,
  classifyChangePasswordError,
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

describe('change password error classification (regression)', () => {
  // Regression: change-password.jsx used to read error.response?.data?.detail
  // and data.errors directly, trusting whatever the backend sent for ANY
  // status code. classifyChangePasswordError now decides what's safe to show
  // per status, so a future backend change to an unvetted error path can't
  // reach the tenant as raw implementation text.

  test('401 always means the current password was wrong — never trusts backend wording for this status', () => {
    const result = classifyChangePasswordError({
      response: { status: 401, data: { detail: 'Firebase: INVALID_LOGIN_CREDENTIALS raw provider error' } },
    });
    expect(result.type).toBe('credentials');
    expect(result.message).toBe(AUTH_MESSAGES.wrongCurrentPassword);
    expect(result.message).not.toMatch(/Firebase/i);
  });

  // SESSION_FINALIZATION_FAILED is a 500 the backend returns *after* the
  // password credential has already been updated. Telling the tenant the
  // change failed would invite them to redo a change that already succeeded.
  test('SESSION_FINALIZATION_FAILED tells the tenant the password did change', () => {
    const result = classifyChangePasswordError({
      response: { status: 500, data: { code: 'SESSION_FINALIZATION_FAILED' } },
    });

    expect(result.type).toBe('password-changed');
    expect(result.message).toBe(AUTH_MESSAGES.passwordChangedSessionsNotCleared);
    // It must not read as a failed change or a retry instruction.
    expect(result.message).not.toMatch(/failed/i);
    expect(result.message).not.toMatch(/try again/i);
    expect(result.message).toMatch(/has been changed/i);
    // ...and it must not leak internals.
    expect(result.message).not.toMatch(/session|token|securityVersion|SESSION_FINALIZATION/i);
  });

  test('SESSION_FINALIZATION_FAILED is not swallowed by the generic 500 handling', () => {
    const generic = classifyChangePasswordError({ response: { status: 500, data: {} } });
    const finalization = classifyChangePasswordError({
      response: { status: 500, data: { code: 'SESSION_FINALIZATION_FAILED' } },
    });

    expect(finalization.type).not.toBe(generic.type);
    expect(finalization.message).not.toBe(generic.message);
  });

  test('400 with a single curated backend detail is shown verbatim (backend validation stays authoritative)', () => {
    const result = classifyChangePasswordError({
      response: { status: 400, data: { detail: 'New password must be different from your current password' } },
    });
    expect(result.type).toBe('validation');
    expect(result.message).toBe('New password must be different from your current password');
  });

  test('400 with multiple validation errors joins them for display', () => {
    const result = classifyChangePasswordError({
      response: {
        status: 400,
        data: {
          detail: 'Password must contain at least one uppercase letter',
          errors: [
            'Password must contain at least one uppercase letter',
            'Password must contain at least one number',
          ],
        },
      },
    });
    expect(result.type).toBe('validation');
    expect(result.message).toBe('Password must contain at least one uppercase letter\nPassword must contain at least one number');
  });

  test('400 with no detail at all falls back to a safe generic message', () => {
    const result = classifyChangePasswordError({ response: { status: 400, data: {} } });
    expect(result.message).toBe(AUTH_MESSAGES.passwordChangeUnexpected);
  });

  test('429 maps to the shared rate-limit message', () => {
    expect(classifyChangePasswordError({ response: { status: 429 } }).type).toBe('rate-limit');
  });

  test('offline/timeout/server failures use the same safe network messages as login', () => {
    expect(classifyChangePasswordError({ request: {}, message: 'Network Error' }).type).toBe('offline');
    expect(classifyChangePasswordError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }).type).toBe('timeout');
    expect(classifyChangePasswordError({ response: { status: 503 } }).type).toBe('server');
  });

  test('an unrecognized/unvetted status never leaks its raw detail text', () => {
    const result = classifyChangePasswordError({
      response: { status: 500, data: { detail: 'MongoServerError: E11000 duplicate key at collection users' } },
    });
    expect(result.message).toBe(AUTH_MESSAGES.passwordChangeUnexpected);
    expect(result.message).not.toMatch(/Mongo|E11000|collection/i);
  });
});
