'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeUsers, buildReplacementOptions, maskEmail, normalizeUsername } = require('../scripts/backfillUsernameNormalized');

test('normalizes usernames by trimming and lowercasing', () => {
  assert.equal(normalizeUsername(' Aya.Gregorio '), 'aya.gregorio');
});

test('reports duplicates, missing and invalid usernames without selecting conflicts for update', () => {
  const result = analyzeUsers([
    { _id: '1', user_id: 'u1', username: 'Aya.Gregorio' },
    { _id: '2', user_id: 'u2', username: ' aya.gregorio ' },
    { _id: '3', user_id: 'u3', username: '' },
    { _id: '4', user_id: 'u4', username: 'bad name' },
    { _id: '5', user_id: 'u5', username: 'Valid_123', username_normalized: 'valid_123' },
  ]);

  assert.equal(result.totalScanned, 5);
  assert.equal(result.alreadyValid, 1);
  assert.equal(result.missingUsernames.length, 1);
  assert.equal(result.invalidUsernames.length, 1);
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(result.safeUpdates.length, 0);
});

test('is idempotent for already normalized records', () => {
  const result = analyzeUsers([
    { _id: '1', user_id: 'u1', username: 'aya.gregorio', username_normalized: 'aya.gregorio' },
  ]);
  assert.equal(result.alreadyValid, 1);
  assert.equal(result.requiringUpdate, 0);
  assert.equal(result.safeUpdates.length, 0);
});

test('masks report email and recommends only available rule-compliant replacements', () => {
  assert.equal(maskEmail('legacy-user@example.com'), 'le*********@example.com');
  assert.deepEqual(buildReplacementOptions('legacy-user', new Set(['legacy.user'])), [
    { username: 'legacy_user', valid: true, available: true },
    { username: 'legacy.user', valid: true, available: false },
    { username: 'legacyuser', valid: true, available: true },
  ]);
});
