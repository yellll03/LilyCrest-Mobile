export const AUTH_MESSAGES = Object.freeze({
  emptyFields: 'Please enter your email and password.',
  invalidEmail: 'Please enter a valid email address.',
  invalidCredentials: 'Incorrect email or password.',
  offline: 'No internet connection. Please check your network and try again.',
  timeout: 'The request took too long. Please try again.',
  backendUnavailable: 'Unable to connect to the server. Please try again later.',
  providerUnavailable: 'Email and password sign-in is not available. Please contact support.',
  accountDisabled: 'This account has been disabled. Please contact the admin office.',
  profileMissing: 'Your tenant profile could not be found. Please contact the admin office.',
  accessDenied: 'Access denied. Please contact the admin office.',
  verifyEmail: 'Please verify your email before logging in.',
  tooManyRequests: 'Too many attempts. Please wait before trying again.',
  otpDeliveryUnavailable: 'Unable to send verification code right now. Please try again.',
  unexpected: 'Something went wrong. Please try again.',
  forgotSuccess: 'If an account exists for this email, a password reset link has been sent.',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateEmail(value) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    return { valid: false, email: normalized, message: AUTH_MESSAGES.invalidEmail };
  }
  return { valid: true, email: normalized, message: '' };
}

export function validateLoginInput(email, password) {
  if (!normalizeEmail(email) || typeof password !== 'string' || password.length === 0) {
    return { valid: false, message: AUTH_MESSAGES.emptyFields };
  }
  const emailResult = validateEmail(email);
  if (!emailResult.valid) return emailResult;
  return { valid: true, email: emailResult.email, password, message: '' };
}

export function classifyAuthError(error) {
  const status = error?.response?.status;
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '');

  if (status === 401 || ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) {
    return { type: 'credentials', status: status || 401, message: AUTH_MESSAGES.invalidCredentials };
  }
  if (status === 403) return { type: 'access', status, message: AUTH_MESSAGES.accessDenied };
  if (status === 404) return { type: 'profile', status, message: AUTH_MESSAGES.profileMissing };
  if (code === 'auth/user-disabled') return { type: 'disabled', status: 403, message: AUTH_MESSAGES.accountDisabled };
  if (code === 'auth/operation-not-allowed') return { type: 'configuration', status: 503, message: AUTH_MESSAGES.providerUnavailable };
  if (code === 'auth/invalid-email') return { type: 'validation', status: 400, message: AUTH_MESSAGES.invalidEmail };
  if (status === 429 || code === 'auth/too-many-requests') {
    return { type: 'rate-limit', status: status || 429, message: AUTH_MESSAGES.tooManyRequests };
  }
  if (status === 503 && String(error?.response?.data?.code || '').toUpperCase() === 'OTP_DELIVERY_UNAVAILABLE') {
    return { type: 'otp-delivery', status, message: AUTH_MESSAGES.otpDeliveryUnavailable };
  }
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout|timed out/i.test(message)) {
    return { type: 'timeout', status: status || 0, message: AUTH_MESSAGES.timeout };
  }
  if (!error?.response && (error?.request || /network error|failed to fetch|network request failed/i.test(message))) {
    return { type: 'offline', status: 0, message: AUTH_MESSAGES.offline };
  }
  if ([502, 503, 504].includes(status)) {
    return { type: 'server', status, message: AUTH_MESSAGES.backendUnavailable };
  }
  return { type: 'unexpected', status: status || 0, message: AUTH_MESSAGES.unexpected };
}

export function createRequestLock() {
  let locked = false;
  return {
    isLocked: () => locked,
    run: async (request) => {
      if (locked) return { skipped: true };
      locked = true;
      try {
        return await request();
      } finally {
        locked = false;
      }
    },
  };
}

export function authErrorTypeForUi(type) {
  if (type === 'credentials' || type === 'validation') return 'credentials';
  if (type === 'access' || type === 'disabled' || type === 'profile') return 'access';
  if (type === 'rate-limit') return 'ratelimit';
  if (type === 'offline' || type === 'timeout' || type === 'server' || type === 'otp-delivery') return 'network';
  return 'unexpected';
}
