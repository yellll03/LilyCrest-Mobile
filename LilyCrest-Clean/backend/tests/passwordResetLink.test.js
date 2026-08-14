'use strict';

// Regression coverage for the password-reset link domain. The mobile app's
// forgot-password screen used to bypass this backend entirely and call
// Firebase's client SDK directly, whose action link domain is controlled by
// Firebase Console settings (and was observed pointing at a stale vercel.app
// deployment). The fix routes the mobile app through this backend's own
// token flow.
//
// Canonical target architecture: the link should point at the tenant-facing
// website's own /auth-action page (a separate repository this codebase does
// not contain — see LILIORA_ACTUAL_SYSTEM_AUDIT_2026-07-19.md's "Evidence
// limits" section, and the absence of any such repo in `git worktree list`
// or any sibling directory). Until that page exists and PASSWORD_RESET_WEB_URL
// is configured to point at it, this falls back to this backend's own hosted
// reset page — asserted here to never resolve to vercel.app regardless of
// env configuration either way.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPasswordResetLink } = require('../controllers/auth.controller');

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const saved = {};
  for (const key of keys) saved[key] = process.env[key];
  try {
    for (const key of keys) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('reset link uses the production BACKEND_URL default and never vercel.app', () => {
  withEnv({ BACKEND_URL: undefined, PASSWORD_RESET_WEB_URL: undefined }, () => {
    const link = buildPasswordResetLink('sometoken');
    assert.match(link, /^https:\/\/api\.lilycrest\.space\/api\/auth\/reset-password\?token=sometoken$/);
    assert.doesNotMatch(link, /vercel\.app/i);
  });
});

test('reset link respects a configured BACKEND_URL and strips trailing slashes', () => {
  withEnv({ BACKEND_URL: 'https://api.lilycrest.space/', PASSWORD_RESET_WEB_URL: undefined }, () => {
    const link = buildPasswordResetLink('abc123');
    assert.equal(link, 'https://api.lilycrest.space/api/auth/reset-password?token=abc123');
    assert.doesNotMatch(link, /vercel\.app/i);
  });
});

test('PASSWORD_RESET_WEB_URL, when configured, takes precedence over the backend-hosted page', () => {
  withEnv({ PASSWORD_RESET_WEB_URL: 'https://www.lilycrest.space/auth-action', BACKEND_URL: 'https://api.lilycrest.space' }, () => {
    const link = buildPasswordResetLink('xyz789');
    assert.equal(link, 'https://www.lilycrest.space/auth-action?token=xyz789');
    assert.doesNotMatch(link, /api\.lilycrest\.space/);
    assert.doesNotMatch(link, /vercel\.app/i);
  });
});

test('PASSWORD_RESET_WEB_URL strips trailing slashes the same way BACKEND_URL does', () => {
  withEnv({ PASSWORD_RESET_WEB_URL: 'https://www.lilycrest.space/auth-action/', BACKEND_URL: undefined }, () => {
    const link = buildPasswordResetLink('abc');
    assert.equal(link, 'https://www.lilycrest.space/auth-action?token=abc');
  });
});

test('Mode A — PASSWORD_RESET_WEB_URL unset: generated URL uses the working api.lilycrest.space reset page and carries the token', () => {
  withEnv({ PASSWORD_RESET_WEB_URL: undefined, BACKEND_URL: undefined }, () => {
    const link = buildPasswordResetLink('mode-a-token');
    assert.equal(link, 'https://api.lilycrest.space/api/auth/reset-password?token=mode-a-token');
  });
});

test('Mode B — PASSWORD_RESET_WEB_URL=https://www.lilycrest.space/auth-action: generated URL uses that base and carries the token', () => {
  withEnv({ PASSWORD_RESET_WEB_URL: 'https://www.lilycrest.space/auth-action', BACKEND_URL: 'https://api.lilycrest.space' }, () => {
    const link = buildPasswordResetLink('mode-b-token');
    assert.equal(link, 'https://www.lilycrest.space/auth-action?token=mode-b-token');
  });
});

test('as currently deployed (PASSWORD_RESET_WEB_URL unset), the email still points at api.lilycrest.space, not www.lilycrest.space', () => {
  // Documents today's actual behavior honestly: the canonical www.lilycrest.space/auth-action
  // architecture requires the website repo (unavailable here) to ship that page and ops to set
  // PASSWORD_RESET_WEB_URL — neither has happened in this codebase, so this must not be
  // mistaken for already using the canonical web domain.
  withEnv({ PASSWORD_RESET_WEB_URL: undefined, BACKEND_URL: undefined }, () => {
    const link = buildPasswordResetLink('current-default-token');
    assert.match(link, /^https:\/\/api\.lilycrest\.space\//);
  });
});
