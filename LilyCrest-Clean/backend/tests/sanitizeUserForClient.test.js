'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeUserForClient, sanitizeUserForAdminList, normalizeUser } = require('../utils/normalizeUser');

const RAW_LEGACY_USER = {
  _id: 'mongo-object-id',
  user_id: 'user_abc123',
  email: 'tenant@example.com',
  name: 'Tenant Example',
  role: 'resident',
  is_active: true,
  // Legacy fields that predate Firebase-only auth / OTP-based lockout, or are
  // otherwise internal bookkeeping — none of these should ever reach a client.
  password: 'plaintext-should-never-exist',
  password_hash: '$2b$10$legacyhashfromoldschema',
  firebase_uid: 'fb-uid-123',
  login_lock_until: new Date().toISOString(),
  failed_login_attempts: 3,
  otp_code_hash: 'otp-code-hash',
  otp_token_hash: 'otp-token-hash',
  reset_token: 'reset-token-value',
  // Hypothetical field a separate (unaudited) admin/web codebase might write
  // to the same `users` collection — the whole point of an allowlist is that
  // this is dropped without anyone needing to have anticipated its name.
  internal_admin_note: 'flagged for manual review by admin panel',
};

test('sanitizeUserForClient strips all sensitive/internal fields', () => {
  const safe = sanitizeUserForClient(RAW_LEGACY_USER);

  assert.equal(safe._id, undefined);
  assert.equal(safe.password, undefined);
  assert.equal(safe.password_hash, undefined);
  assert.equal(safe.firebase_uid, undefined);
  assert.equal(safe.login_lock_until, undefined);
  assert.equal(safe.failed_login_attempts, undefined);
  assert.equal(safe.otp_code_hash, undefined);
  assert.equal(safe.otp_token_hash, undefined);
  assert.equal(safe.reset_token, undefined);
});

test('sanitizeUserForClient drops fields it does not explicitly recognize, not just ones it knows are sensitive', () => {
  const safe = sanitizeUserForClient(RAW_LEGACY_USER);
  assert.equal(safe.internal_admin_note, undefined);
  assert.equal(safe.is_active, undefined); // internal moderation flag, not client-facing
});

test('sanitizeUserForClient preserves tenant-facing fields', () => {
  const safe = sanitizeUserForClient(RAW_LEGACY_USER);

  assert.equal(safe.user_id, 'user_abc123');
  assert.equal(safe.email, 'tenant@example.com');
  assert.equal(safe.name, 'Tenant Example');
  assert.equal(safe.role, 'resident');
});

test('sanitizeUserForClient does not mutate the input object', () => {
  const copy = { ...RAW_LEGACY_USER };
  sanitizeUserForClient(copy);
  assert.equal(copy.password_hash, RAW_LEGACY_USER.password_hash);
});

test('sanitizeUserForClient is safe to call after normalizeUser', () => {
  const normalized = normalizeUser(RAW_LEGACY_USER);
  const safe = sanitizeUserForClient(normalized);
  assert.equal(safe.password_hash, undefined);
  assert.equal(safe.name, 'Tenant Example');
});

test('sanitizeUserForClient handles null/undefined input', () => {
  assert.equal(sanitizeUserForClient(null), null);
  assert.equal(sanitizeUserForClient(undefined), undefined);
});

test('admin user lists use an allowlist and never expose authentication or internal fields', () => {
  const safe = sanitizeUserForAdminList({
    ...RAW_LEGACY_USER,
    room_number: '204',
    refresh_token_hash: 'refresh-secret-hash',
    securityVersion: 7,
  });

  assert.equal(safe.user_id, 'user_abc123');
  assert.equal(safe.email, 'tenant@example.com');
  assert.equal(safe.room_number, '204');
  assert.equal(safe.password_hash, undefined);
  assert.equal(safe.refresh_token_hash, undefined);
  assert.equal(safe.securityVersion, undefined);
  assert.equal(safe.internal_admin_note, undefined);
});
