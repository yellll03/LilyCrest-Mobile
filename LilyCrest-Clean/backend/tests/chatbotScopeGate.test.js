// Regression coverage for the LilyCrest AI Assistant domain guard rewrite:
// the chatbot must be broad inside the LilyCrest domain (answer genuine
// tenant questions even when no regex/knowledge trigger was pre-written for
// that exact phrasing) and restricted only for genuinely unrelated topics.
// See __test.shouldRefuseAsOutOfScope in controllers/chatbot.controller.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../controllers/chatbot.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

// ── Unit tests: shouldRefuseAsOutOfScope, no DB/network involved ──────────

test('paraphrased in-scope LilyCrest questions are never refused, even with no matching regex trigger', () => {
  const cases = [
    'When will my contract expire?',
    'Is it okay if my cousin stays the night?',
    'Can I still get my deposit back if I leave early?',
    'What happens to my room assignment after my contract ends?',
    'Do I have a grace period before penalties kick in?',
  ];
  for (const message of cases) {
    assert.equal(__test.shouldRefuseAsOutOfScope(message, { history: [] }), false, `should NOT refuse: "${message}"`);
  }
});

test('genuine out-of-scope topics are refused', () => {
  const cases = [
    '2+2?',
    'Tell me a joke',
    'What is the capital of France?',
    'Can you help me with my homework?',
    "What's the weather forecast today?",
  ];
  for (const message of cases) {
    assert.equal(__test.shouldRefuseAsOutOfScope(message, { history: [] }), true, `should refuse: "${message}"`);
  }
});

test('admin-escalation phrasing is never refused, even if it coincidentally reads like small talk', () => {
  assert.equal(__test.shouldRefuseAsOutOfScope('Can I talk to the admin please', { history: [] }), false);
  assert.equal(__test.isAdminEscalationRequest('Can I talk to the admin please'), true);
});

test('dormitory follow-ups after prior context are never refused', () => {
  const session = { history: [{ role: 'user', content: 'What is the visitor policy?' }, { role: 'assistant', content: 'Visitors are allowed until 9pm.' }] };
  assert.equal(__test.shouldRefuseAsOutOfScope('how about weekends?', session), false);
  assert.equal(__test.isDormitoryFollowUp('how about weekends?', session), true);
});

test('a message with no scope signal at all (not dormitory, not high-signal-off-topic) defaults to answering, not refusing', () => {
  // No dormitory keyword, no OUT_OF_SCOPE_PATTERNS hit either — the old
  // "routedIntent stayed GENERAL" gate would have refused this; the new gate
  // must not, since it only refuses on a genuine negative signal.
  assert.equal(__test.hasHighSignalOutOfScopeTopic('What happens next for me?'), false);
  assert.equal(__test.shouldRefuseAsOutOfScope('What happens next for me?', { history: [] }), false);
});

// ── Full sendMessage()-level test: the refusal must short-circuit before ──
// ── ever reaching the AI, and the AI must never be invoked for it. ────────

function stubGeminiService() {
  const geminiPath = require.resolve('../services/gemini.service');
  const originalEntry = require.cache[geminiPath];
  let sendGeminiMessageCalls = 0;
  const stub = {
    classifyIntent: async () => ({ intent: 'general', confidence: 0.4 }),
    sendGeminiMessage: async () => {
      sendGeminiMessageCalls += 1;
      return { text: 'STUBBED AI RESPONSE — should not appear for out-of-scope messages' };
    },
    liveChatQueue: new Map(),
    chatSessions: new Map(),
    isQuotaError: () => false,
  };
  require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: stub };
  const controllerPath = require.resolve('../controllers/chatbot.controller');
  delete require.cache[controllerPath];
  const chatbotController = require(controllerPath);
  return {
    chatbotController,
    getSendGeminiMessageCallCount: () => sendGeminiMessageCalls,
    restore() {
      if (originalEntry) require.cache[geminiPath] = originalEntry;
      else delete require.cache[geminiPath];
      delete require.cache[controllerPath];
    },
  };
}

test('sendMessage refuses a genuine out-of-scope question without ever calling the AI', async () => {
  const { chatbotController, getSendGeminiMessageCallCount, restore } = stubGeminiService();
  try {
    const req = {
      body: { message: 'Can you help me with my homework?', session_id: null, attachments: [] },
      user: { user_id: 'tenant-a', email: 'tenant-a@example.com', name: 'Tenant A', role: 'tenant', _id: 'objid-a' },
      headers: {},
    };
    const res = response();
    await chatbotController.sendMessage(req, res);
    assert.equal(res.statusCode === 200 || res.statusCode === null, true, `expected 200, got ${res.statusCode}`);
    assert.match(res.body.message, /LilyCrest dormitory and tenant app concerns/i);
    assert.equal(res.body.meta.source, 'scope_guard');
    assert.equal(getSendGeminiMessageCallCount(), 0, 'the AI must never be called for a refused out-of-scope message');
  } finally {
    restore();
  }
});
