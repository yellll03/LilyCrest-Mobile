'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/user.controller');
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
  assert.match(source, /delete normalized\._id/);
  assert.doesNotMatch(source, /user_id: req\.user\.user_id \},\s*\{ projection: \{ _id: 0 \}/);
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
