export const PASSWORD_WHITESPACE_MESSAGE = 'Password must not contain spaces.';

const SPECIAL_CHARACTER_REGEX = /[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/;

export function passwordContainsWhitespace(password = '') {
  return /\s/.test(password);
}

export function blockPasswordWhitespaceInput(nextValue, previousValue = '') {
  if (passwordContainsWhitespace(nextValue)) {
    return { value: previousValue, blocked: true };
  }

  return { value: nextValue, blocked: false };
}

export function validateLoginPassword(password = '') {
  if (!password) return { valid: false, error: 'Password is required' };
  if (passwordContainsWhitespace(password)) {
    return { valid: false, error: PASSWORD_WHITESPACE_MESSAGE };
  }
  if (password.length > 128) return { valid: false, error: 'Password is too long' };
  if (password.length < 6) return { valid: false, error: 'Password must be at least 6 characters' };
  return { valid: true, error: '' };
}

export function getStrongPasswordChecks(password = '') {
  return {
    noWhitespace: !passwordContainsWhitespace(password),
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: SPECIAL_CHARACTER_REGEX.test(password),
  };
}

export function validateStrongPassword(password = '', { requiredMessage = 'Password is required' } = {}) {
  if (!password) return { valid: false, error: requiredMessage };

  const checks = getStrongPasswordChecks(password);
  if (!checks.noWhitespace) {
    return { valid: false, error: PASSWORD_WHITESPACE_MESSAGE, checks };
  }
  if (!checks.length) {
    return { valid: false, error: 'Password must be at least 8 characters', checks };
  }
  if (!checks.uppercase) {
    return { valid: false, error: 'Password must contain at least one uppercase letter', checks };
  }
  if (!checks.lowercase) {
    return { valid: false, error: 'Password must contain at least one lowercase letter', checks };
  }
  if (!checks.number) {
    return { valid: false, error: 'Password must contain at least one number', checks };
  }
  if (!checks.special) {
    return { valid: false, error: 'Password must contain at least one special character', checks };
  }

  return { valid: true, error: '', checks };
}
