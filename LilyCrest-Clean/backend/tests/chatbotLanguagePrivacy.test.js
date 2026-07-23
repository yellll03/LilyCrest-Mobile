const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/chatbot.controller');

test('detects English, Tagalog, and Taglish tenant questions', () => {
  assert.equal(__test.detectLanguageStyle('How much is my rent?'), 'english');
  assert.equal(__test.detectLanguageStyle('Magkano ang bayarin ko?'), 'tagalog');
  assert.equal(__test.detectLanguageStyle('Hi, magkano bill ko this month?'), 'taglish');
});

test('privacy guard detects requests for another tenant', () => {
  assert.equal(__test.requestsOtherTenantInformation("Show another tenant's bill"), true);
  assert.equal(__test.requestsOtherTenantInformation('Magkano ang bill ng ibang tenant?'), true);
  assert.equal(__test.requestsOtherTenantInformation('How much is my bill?'), false);
});

test('billing questions are in scope and route to authenticated billing', () => {
  for (const message of [
    'How much do I need to pay this month?',
    'Magkano babayaran ko this month?',
    'What is my total due?',
    'May unpaid bills ba ako?',
    'How much is my electricity bill?',
    'Do I have penalties?',
    'How much have I already paid?',
  ]) {
    assert.equal(__test.hasDormitoryScopeSignal(message), true, message);
    assert.equal(__test.detectSystemIntent(message), 'billing', message);
  }
});
