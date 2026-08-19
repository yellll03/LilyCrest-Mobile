'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/user.controller');
const { sanitizeUserForClient } = require('../utils/normalizeUser');
const fs = require('node:fs');
const path = require('node:path');

test('structured approved-application address is formatted without object coercion', () => {
  const address = __test.completeAddress({
    address: {
      addressLine1: 'Blk 2 Lot 4',
      barangay: 'Barangay Palanan',
      city: 'Makati City',
      province: 'Metro Manila',
    },
  });
  assert.equal(address, 'Blk 2 Lot 4, Barangay Palanan, Makati City, Metro Manila');
  assert.doesNotMatch(address, /\[object Object\]/);
});

test('missing username timestamp allows first change', () => {
  assert.deepEqual(__test.usernameCooldownState(null), { active: false, nextAllowedAt: null });
});

test('username cooldown uses server timestamp and allows exactly seven days', () => {
  const changedAt = new Date('2026-07-01T00:00:00.000Z');
  assert.equal(__test.usernameCooldownState(changedAt, new Date('2026-07-07T23:59:59.999Z')).active, true);
  assert.equal(__test.usernameCooldownState(changedAt, new Date('2026-07-08T00:00:00.000Z')).active, false);
});

test('profile keeps Mongo identity for ownership lookup but never returns it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../controllers/user.controller.js'), 'utf8');
  assert.match(source, /findOne\(\{ user_id: req\.user\.user_id \}\)/);
  assert.match(source, /sanitizeUserForClient\(normalized\)/);
  assert.doesNotMatch(source, /user_id: req\.user\.user_id \},\s*\{ projection: \{ _id: 0 \}/);

  // The profile response is routed through the shared sanitizer, which strips
  // _id (and other sensitive/internal fields) regardless of how buildTenantProfile
  // constructed its output — this is the actual guarantee this test protects.
  const safe = sanitizeUserForClient({ _id: 'mongo-id', user_id: 'user_1', name: 'Tenant' });
  assert.equal(safe._id, undefined);
  assert.equal(safe.user_id, 'user_1');
});

test('production moveIn lifecycle counts as an approved current application', () => {
  const statusPattern = __test.approvedReservationFilter.$or[0].status.$regex;
  assert.equal(statusPattern.test('moveIn'), true);
});

test('phone is hydrated from structured approved application fields', () => {
  assert.equal(__test.applicationPhone({
    applicantDetails: { contactNumber: '+639171234567' },
  }), '+639171234567');
  assert.equal(__test.applicationPhone({}), '');
});

test('Philippine local mobile number is normalized to canonical +63 format', () => {
  assert.equal(__test.normalizePhilippinePhone('0928 318 2050'), '+639283182050');
  assert.equal(__test.normalizePhilippinePhone('+639283182050'), '+639283182050');
  assert.equal(__test.normalizePhilippinePhone('invalid'), 'invalid');
});

// GET /users/me used to compute a `contract` field from this backend's own
// `generatedContracts` collection — the QA-only publishTenantTestContract
// pipeline with no production trigger. No screen read it (profile.jsx uses
// useTenantContract()/the canonical Capstone-Website bridge), but leaving it
// in the response invited a future screen to bind to the non-authoritative
// contract data this codebase is explicit about never duplicating.
test('the profile response no longer carries a legacy generatedContracts contract field', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'user.controller.js'), 'utf8');
  const profileBody = source.slice(
    source.indexOf('async function buildTenantProfile'),
    source.indexOf('// Get current user profile'),
  );
  assert.ok(profileBody.length > 0, 'buildTenantProfile must still be present');
  assert.doesNotMatch(profileBody, /normalized\.contract\s*=/);
  assert.doesNotMatch(profileBody, /findTenantVisibleContract\(/);
  assert.doesNotMatch(profileBody, /tenantContractDocument\(/);
});

test('the canonical contract bridge is still the only contract source mobile consumes', () => {
  const hook = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'hooks', 'useTenantContract.js'),
    'utf8',
  );
  assert.match(hook, /getCurrentContract\(/);
  const profileScreen = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'app', '(tabs)', 'profile.jsx'),
    'utf8',
  );
  assert.match(profileScreen, /useTenantContract\(\)/);
  assert.doesNotMatch(profileScreen, /profile\.contract|user\.contract/);
});
