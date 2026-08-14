// Behavioral tests for the axios response interceptor's forced-session-expiry
// path in src/services/api.js — NOT source-text grepping. These invoke the
// real registered interceptor rejection handler with synthetic errors and
// assert on actual calls to the mocked collaborators.

jest.mock('../config/firebase', () => ({
  getFreshIdToken: jest.fn(),
}));

jest.mock('../services/secureCredentials', () => ({
  getSessionToken: jest.fn().mockResolvedValue(null),
  removeSessionToken: jest.fn().mockResolvedValue(),
  setSessionToken: jest.fn().mockResolvedValue(),
  isCurrentSessionRemembered: jest.fn().mockReturnValue(true),
}));

jest.mock('../services/sessionEvents', () => ({
  emitSessionExpired: jest.fn(),
}));

const axios = require('axios');
const AsyncStorage = require('@react-native-async-storage/async-storage');
const { api } = require('../services/api');
const { getFreshIdToken } = require('../config/firebase');
const { removeSessionToken } = require('../services/secureCredentials');
const { emitSessionExpired } = require('../services/sessionEvents');

function getResponseRejectedHandler() {
  const handlers = api.interceptors.response.handlers.filter(Boolean);
  return handlers[handlers.length - 1].rejected;
}

function makeError({ status, url, headers = {}, data }) {
  return {
    response: { status, data },
    config: { url, headers, _retry: false },
  };
}

describe('api.js forced-session-expiry interceptor', () => {
  let rejectedHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.removeItem = jest.fn().mockResolvedValue();
    rejectedHandler = getResponseRejectedHandler();
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('no google refresh in this test'));
  });

  it('wrong-password 401 on /auth/login does not emit session-expired', async () => {
    await rejectedHandler(makeError({ status: 401, url: '/auth/login', headers: { Authorization: 'Bearer dead-token' } })).catch(() => {});
    expect(emitSessionExpired).not.toHaveBeenCalled();
    expect(removeSessionToken).not.toHaveBeenCalled();
  });

  it('wrong-OTP 401 on /auth/login/verify-otp does not emit session-expired', async () => {
    await rejectedHandler(makeError({ status: 401, url: '/auth/login/verify-otp' })).catch(() => {});
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('non-401 errors never emit session-expired', async () => {
    await rejectedHandler(makeError({ status: 500, url: '/billing/me' })).catch(() => {});
    await rejectedHandler({ config: { url: '/billing/me', headers: {} }, message: 'Network Error' }).catch(() => {});
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('401 on a protected endpoint with a recoverable Google refresh does NOT emit session-expired', async () => {
    getFreshIdToken.mockResolvedValue('fresh-id-token');
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { session_token: 'new-session-token' } });
    // The retried request (`return api(originalRequest)`) goes through axios's real
    // dispatch pipeline, not a mockable method property — stub the adapter so the
    // retry resolves immediately instead of making a real network call.
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = jest.fn().mockResolvedValue({
      data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config: {},
    });

    try {
      await rejectedHandler(makeError({ status: 401, url: '/billing/me', headers: { Authorization: 'Bearer dead-token' } }));
      expect(emitSessionExpired).not.toHaveBeenCalled();
      expect(removeSessionToken).not.toHaveBeenCalled();
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });

  it('401 on a protected endpoint with no recoverable refresh emits session-expired exactly once, carrying the dying token', async () => {
    getFreshIdToken.mockResolvedValue(null); // no Firebase user available (e.g. password-login tenant)

    await rejectedHandler(makeError({ status: 401, url: '/billing/me', headers: { Authorization: 'Bearer dead-token-123' } })).catch(() => {});

    expect(removeSessionToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledWith('refresh_failed', { expiredToken: 'dead-token-123' });
  });

  it('403 with ACCOUNT_INACTIVE code clears the session and emits account_inactive, not the generic expired reason', async () => {
    await rejectedHandler(makeError({
      status: 403,
      url: '/billing/me',
      headers: { Authorization: 'Bearer dead-token-456' },
      data: { code: 'ACCOUNT_INACTIVE', detail: 'Access denied. Your account is inactive. Please contact admin.' },
    })).catch(() => {});

    expect(removeSessionToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledWith('account_inactive', { expiredToken: 'dead-token-456' });
  });

  it('a 403 without ACCOUNT_INACTIVE code (e.g. hitting an admin-only route) never emits session-expired', async () => {
    await rejectedHandler(makeError({
      status: 403,
      url: '/some/admin/route',
      headers: { Authorization: 'Bearer still-valid-token' },
      data: { detail: 'Admin access required' },
    })).catch(() => {});

    expect(emitSessionExpired).not.toHaveBeenCalled();
    expect(removeSessionToken).not.toHaveBeenCalled();
  });

  it('a 401 on a request that never carried a session token does not attempt a silent Google/Firebase refresh', async () => {
    // Regression test: "Remember Me" off + app kill means getSessionToken()
    // returns null, so no request carries an Authorization header — but
    // Firebase's own client session persists independently (see
    // config/firebase.js's getReactNativePersistence(AsyncStorage)) and
    // would happily hand back a fresh ID token here if asked. The interceptor
    // must never ask in this case, or a cold start with "Remember Me" off
    // could silently mint a brand-new backend session anyway.
    getFreshIdToken.mockResolvedValue('fresh-id-token-from-persisted-firebase-session');
    const axiosPostSpy = jest.spyOn(axios, 'post').mockResolvedValue({ data: { session_token: 'should-never-be-minted' } });

    await rejectedHandler(makeError({ status: 401, url: '/billing/me', headers: {} })).catch(() => {});

    expect(getFreshIdToken).not.toHaveBeenCalled();
    expect(axiosPostSpy).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
    expect(removeSessionToken).not.toHaveBeenCalled();
  });

  it('five parallel genuinely-expired 401s each emit once (dedup is AuthContext\'s job, not the interceptor\'s)', async () => {
    getFreshIdToken.mockResolvedValue(null);

    await Promise.all(Array.from({ length: 5 }, (_, i) => rejectedHandler(
      makeError({ status: 401, url: `/billing/me?i=${i}`, headers: { Authorization: 'Bearer dead-token' } }),
    ).catch(() => {})));

    expect(emitSessionExpired).toHaveBeenCalledTimes(5);
  });
});
