'use strict';

// Confirms the human-support chat backend limit is aligned to 800 chars —
// the mobile UI composer's own cap — closing the drift where this used to
// be 1000 here while chatbot.controller.js (AI assistant) was already 800.

const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/chat.controller');

test('backend MAX_MESSAGE_CHARS matches the mobile UI cap of 800', () => {
  assert.equal(__test.MAX_MESSAGE_CHARS, 800);
});

test('a 799-character message is accepted', () => {
  const message = 'a'.repeat(799);
  assert.equal(__test.normalizeMessage(message), message);
});

test('an 800-character message is accepted (inclusive boundary)', () => {
  const message = 'a'.repeat(800);
  assert.equal(__test.normalizeMessage(message), message);
});

test('an 801-character message is rejected with MESSAGE_TOO_LONG', () => {
  const message = 'a'.repeat(801);
  assert.throws(
    () => __test.normalizeMessage(message),
    (error) => error.code === 'MESSAGE_TOO_LONG' && error.statusCode === 400,
  );
});

test('an empty or whitespace-only message is rejected with EMPTY_MESSAGE', () => {
  assert.throws(() => __test.normalizeMessage(''), (error) => error.code === 'EMPTY_MESSAGE');
  assert.throws(() => __test.normalizeMessage('   \n\t  '), (error) => error.code === 'EMPTY_MESSAGE');
});

test('a non-string message is rejected instead of coercing/crashing', () => {
  assert.throws(() => __test.normalizeMessage(12345), (error) => error.code === 'EMPTY_MESSAGE');
  assert.throws(() => __test.normalizeMessage(null), (error) => error.code === 'EMPTY_MESSAGE');
});
