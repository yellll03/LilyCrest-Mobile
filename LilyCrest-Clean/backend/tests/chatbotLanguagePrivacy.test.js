const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../controllers/chatbot.controller');

test('assistant history and reset are scoped to authenticated identity', async () => {
  const controller = require('../controllers/chatbot.controller');
  const { chatSessions } = require('../services/gemini.service');
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const request = (userId) => ({ user: { user_id: userId }, body: { session_id: 'shared-id', message: "Show another tenant's bill" } });
  await controller.sendMessage(request('tenant-a'), response());
  await controller.sendMessage(request('tenant-b'), response());
  const a = JSON.stringify(['tenant-a', 'shared-id']);
  const b = JSON.stringify(['tenant-b', 'shared-id']);
  assert.ok(chatSessions.has(a));
  assert.ok(chatSessions.has(b));
  assert.notEqual(chatSessions.get(a), chatSessions.get(b));
  await controller.resetSession(request('tenant-b'), response());
  assert.ok(chatSessions.has(a));
  assert.equal(chatSessions.has(b), false);
  chatSessions.delete(a);
});

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
