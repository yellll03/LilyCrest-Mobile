const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/chatbot.controller');

test('detects English, Tagalog, and Taglish tenant questions', () => {
  assert.equal(__test.detectLanguageStyle('How much is my rent?'), 'english');
  assert.equal(__test.detectLanguageStyle('Magkano ang bayarin ko?'), 'tagalog');
  assert.equal(__test.detectLanguageStyle('Hi, magkano bill ko this month?'), 'taglish');
});

test('contract questions fail closed when no approved tenant PDF exists', () => {
  assert.equal(__test.detectSystemIntent('What are my contract dates?'), 'contract');
  const result = __test.buildContractResponse({ contractStart: '2026-07-20T00:00:00.000Z', contractFileAvailable: false }, 'What are my contract dates?');
  assert.match(result.message, /No approved lease contract is available yet/);
  assert.match(result.message, /no approved contract end date/i);
  assert.doesNotMatch(result.message, /download a PDF/i);
});

test('document questions report contract availability from authenticated context', () => {
  const unavailable = __test.buildDocumentsResponse({ contractFileAvailable: false });
  assert.match(unavailable.message, /No approved lease contract is available yet/);
  const available = __test.buildDocumentsResponse({ contractFileAvailable: true });
  assert.match(available.message, /approved lease contract is also available/);
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
