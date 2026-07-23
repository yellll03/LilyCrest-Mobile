'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/user.controller');

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
