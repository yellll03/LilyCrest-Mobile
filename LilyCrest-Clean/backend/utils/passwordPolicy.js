'use strict';

const NEW_PASSWORD_MIN_LENGTH = 8;
const NEW_PASSWORD_MAX_LENGTH = 128;
const PASSWORD_WHITESPACE_MESSAGE = 'Password must not contain whitespace.';

function evaluateNewPassword(password = '') {
  const value = typeof password === 'string' ? password : '';
  const checks = {
    minLength: value.length >= NEW_PASSWORD_MIN_LENGTH,
    maxLength: value.length <= NEW_PASSWORD_MAX_LENGTH,
    uppercase: /[A-Z]/u.test(value),
    lowercase: /[a-z]/u.test(value),
    number: /[0-9]/u.test(value),
    special: /[^A-Za-z0-9\s]/u.test(value),
    noWhitespace: !/\s/u.test(value),
  };
  return { ...checks, valid: Boolean(value) && Object.values(checks).every(Boolean) };
}

function validateNewPassword(password, { requiredMessage = 'New password is required' } = {}) {
  if (typeof password !== 'string' || password.length === 0) return [requiredMessage];
  const checks = evaluateNewPassword(password);
  const errors = [];
  if (!checks.noWhitespace) errors.push(PASSWORD_WHITESPACE_MESSAGE);
  if (!checks.minLength) errors.push(`Password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters`);
  if (!checks.maxLength) errors.push(`Password must be at most ${NEW_PASSWORD_MAX_LENGTH} characters`);
  if (!checks.uppercase) errors.push('Password must contain at least one uppercase letter');
  if (!checks.lowercase) errors.push('Password must contain at least one lowercase letter');
  if (!checks.number) errors.push('Password must contain at least one number');
  if (!checks.special) errors.push('Password must contain at least one special character');
  return errors;
}

module.exports = {
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_MAX_LENGTH,
  PASSWORD_WHITESPACE_MESSAGE,
  evaluateNewPassword,
  validateNewPassword,
};
