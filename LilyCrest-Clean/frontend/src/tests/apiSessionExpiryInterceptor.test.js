jest.mock('../services/secureCredentials', () => ({
  getSessionCredentials: jest.fn().mockResolvedValue(null),
  getSessionToken: jest.fn().mockResolvedValue(null),
  removeSessionToken: jest.fn().mockResolvedValue(),
  setSessionToken: jest.fn().mockResolvedValue(),
}));

jest.mock('../services/sessionEvents', () => ({
  emitSessionExpired: jest.fn(),
  emitSessionRecovered: jest.fn(),
}));

const axios = require('axios');
const AsyncStorage = require('@react-native-async-storage/async-storage');
const { api } = require('../services/api');
const {
  getSessionCredentials,
  removeSessionToken,
  setSessionToken,
} = require('../services/secureCredentials');
const { emitSessionExpired, emitSessionRecovered } = require('../services/sessionEvents');

function getResponseFulfilledHandler() {
  const handlers = api.interceptors.response.handlers.filter(Boolean);
  return handlers[handlers.length - 1].fulfilled;
}

function getResponseRejectedHandler() {
  const handlers = api.interceptors.response.handlers.filter(Boolean);
  return handlers[handlers.length - 1].rejected;
}

function makeError({ status, url, headers = {}, code, data = {} }) {
  return {
    response: { status, data: { ...data, ...(code ? { code } : {}) } },
    config: { url, headers, _retry: false },
  };
}

const sessionCredentials = {
  sessionToken: 'old-session-token',
  refreshToken: 'method-neutral-refresh',
  expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
};

describe('api.js confirmed-session-invalidation interceptor', () => {
  let rejectedHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.removeItem = jest.fn().mockResolvedValue();
    getSessionCredentials.mockResolvedValue(sessionCredentials);
    rejectedHandler = getResponseRejectedHandler();
  });

  it('emits recovery only after a successful authenticated API response', () => {
    const fulfilledHandler = getResponseFulfilledHandler();
    const response = {
      data: { tenant: 'current' },
      config: { url: '/dashboard/me', headers: { Authorization: 'Bearer current-token' } },
    };

    expect(fulfilledHandler(response)).toBe(response);
    expect(emitSessionRecovered).toHaveBeenCalledWith({ url: '/dashboard/me' });
  });

  it('does not clear retryable state from a public unauthenticated success', () => {
    const fulfilledHandler = getResponseFulfilledHandler();
    const response = { data: { ok: true }, config: { url: '/health', headers: {} } };

    expect(fulfilledHandler(response)).toBe(response);
    expect(emitSessionRecovered).not.toHaveBeenCalled();
  });

  it('wrong-password 401 on /auth/login never clears a current session', async () => {
    await rejectedHandler(makeError({
      status: 401,
      url: '/auth/login',
      headers: { Authorization: 'Bearer current-token' },
    })).catch(() => {});
    expect(emitSessionExpired).not.toHaveBeenCalled();
    expect(removeSessionToken).not.toHaveBeenCalled();
  });

  it('unclassified 401 is retained instead of guessed to be an expired session', async () => {
    await rejectedHandler(makeError({
      status: 401,
      url: '/billing/me',
      headers: { Authorization: 'Bearer current-token' },
    })).catch(() => {});
    expect(emitSessionExpired).not.toHaveBeenCalled();
    expect(removeSessionToken).not.toHaveBeenCalled();
  });

  it('500, 503, timeout, and network errors retain credentials', async () => {
    await rejectedHandler(makeError({ status: 500, url: '/billing/me' })).catch(() => {});
    await rejectedHandler(makeError({ status: 503, url: '/billing/me', code: 'AUTH_SERVICE_UNAVAILABLE' })).catch(() => {});
    await rejectedHandler({ config: { url: '/billing/me', headers: {} }, code: 'ECONNABORTED', message: 'timeout' }).catch(() => {});
    await rejectedHandler({ config: { url: '/billing/me', headers: {} }, request: {}, message: 'Network Error' }).catch(() => {});
    expect(removeSessionToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('SESSION_EXPIRED rotates through the backend refresh credential and retries the request', async () => {
    const nextExpiry = new Date(Date.now() + 7 * 86400000).toISOString();
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        session_token: 'rotated-session-token',
        expires_at: nextExpiry,
        refresh_expires_at: nextExpiry,
      },
    });
    const originalAdapter = api.defaults.adapter;
    api.defaults.adapter = jest.fn().mockResolvedValue({
      data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config: {},
    });

    try {
      await rejectedHandler(makeError({
        status: 401,
        code: 'SESSION_EXPIRED',
        url: '/billing/me',
        headers: { Authorization: 'Bearer old-session-token' },
      }));
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/auth/session/refresh'),
        { refresh_token: 'method-neutral-refresh' },
        { timeout: 15000 },
      );
      expect(setSessionToken).toHaveBeenCalledWith('rotated-session-token', {
        refreshToken: 'method-neutral-refresh',
        expiresAt: nextExpiry,
        refreshExpiresAt: nextExpiry,
      });
      expect(removeSessionToken).not.toHaveBeenCalled();
      expect(emitSessionExpired).not.toHaveBeenCalled();
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });

  it('temporary refresh network failure keeps the persisted session for retry', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({ request: {}, message: 'Network Error' });

    const error = makeError({
      status: 401,
      code: 'SESSION_EXPIRED',
      url: '/billing/me',
      headers: { Authorization: 'Bearer old-session-token' },
    });
    await rejectedHandler(error).catch(() => {});

    expect(error.sessionRetained).toBe(true);
    expect(removeSessionToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('temporary refresh 503 keeps the persisted session for retry', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue(makeError({
      status: 503,
      code: 'AUTH_SERVICE_UNAVAILABLE',
      url: '/auth/session/refresh',
      data: { retryable: true },
    }));

    await rejectedHandler(makeError({
      status: 401,
      code: 'SESSION_EXPIRED',
      url: '/profile',
      headers: { Authorization: 'Bearer old-session-token' },
    })).catch(() => {});

    expect(removeSessionToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('confirmed expired session with no refresh credential clears and emits once', async () => {
    getSessionCredentials.mockResolvedValue({ ...sessionCredentials, refreshToken: '' });

    await rejectedHandler(makeError({
      status: 401,
      code: 'SESSION_EXPIRED',
      url: '/billing/me',
      headers: { Authorization: 'Bearer dead-token' },
    })).catch(() => {});

    expect(removeSessionToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledWith('session_expired', { expiredToken: 'dead-token' });
  });

  it('confirmed revoked session clears without attempting refresh', async () => {
    const postSpy = jest.spyOn(axios, 'post');
    await rejectedHandler(makeError({
      status: 401,
      code: 'SESSION_REVOKED',
      url: '/maintenance/me',
      headers: { Authorization: 'Bearer revoked-token' },
    })).catch(() => {});

    expect(postSpy).not.toHaveBeenCalled();
    expect(removeSessionToken).toHaveBeenCalledTimes(1);
    expect(emitSessionExpired).toHaveBeenCalledWith('session_invalid', { expiredToken: 'revoked-token' });
  });

  it('ACCOUNT_INACTIVE clears, while unrelated 403 does not', async () => {
    await rejectedHandler(makeError({
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      url: '/billing/me',
      headers: { Authorization: 'Bearer disabled-token' },
    })).catch(() => {});
    expect(emitSessionExpired).toHaveBeenCalledWith('account_inactive', { expiredToken: 'disabled-token' });

    jest.clearAllMocks();
    await rejectedHandler(makeError({
      status: 403,
      url: '/some/admin/route',
      headers: { Authorization: 'Bearer still-valid-token' },
    })).catch(() => {});
    expect(removeSessionToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });

  it('a terminal 401 without a request bearer does not mutate local auth state', async () => {
    await rejectedHandler(makeError({
      status: 401,
      code: 'AUTH_TOKEN_MISSING',
      url: '/billing/me',
      headers: {},
    })).catch(() => {});
    expect(removeSessionToken).not.toHaveBeenCalled();
    expect(emitSessionExpired).not.toHaveBeenCalled();
  });
});
