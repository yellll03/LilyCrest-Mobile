const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CHATBOT_SYSTEM_PROMPT,
  KNOWLEDGE_BASE,
} = require('../config/chatbot.presets');

const controllerSource = fs.readFileSync(
  path.resolve(__dirname, '../controllers/chatbot.controller.js'),
  'utf8',
);
const routeSource = fs.readFileSync(
  path.resolve(__dirname, '../routes/chatbot.routes.js'),
  'utf8',
);

test('assistant prompts contain no placeholder contact, payment-account, or room-rate facts', () => {
  const promptMaterial = `${CHATBOT_SYSTEM_PROMPT}\n${JSON.stringify(KNOWLEDGE_BASE)}`;

  assert.doesNotMatch(promptMaterial, /\+63 912 345 67(?:89|90)|0912 345 6789/);
  assert.doesNotMatch(promptMaterial, /1234-5678-9012|9876-5432-1098/);
  assert.doesNotMatch(promptMaterial, /₱(?:5,400|7,200|9,000)/);
  assert.doesNotMatch(promptMaterial, /Scheduled within 24-48 hours/i);
});

test('assistant explicitly limits mutable facts to approved current context', () => {
  assert.match(CHATBOT_SYSTEM_PROMPT, /mutable operational facts/i);
  assert.match(CHATBOT_SYSTEM_PROMPT, /Never fill a missing operational fact/i);
  assert.match(CHATBOT_SYSTEM_PROMPT, /canonical Admin Support conversation/i);
  assert.match(KNOWLEDGE_BASE.house_rules.knowledge, /approved current tenant-visible policy context/i);
  assert.match(KNOWLEDGE_BASE.payment_methods.knowledge, /currently offered by the authenticated Billing flow/i);
});

test('error and escalation fallbacks do not expose unverified contact details', () => {
  assert.doesNotMatch(controllerSource, /\+63 912 345 67(?:89|90)|0912 345 6789/);
  assert.match(controllerSource, /open Admin Support|flagged it in Admin Support/i);
});

test('tenant suggestion endpoint is protected by both authentication and tenant role gates', () => {
  assert.match(
    routeSource,
    /router\.get\('\/suggestions', authMiddleware, tenantMiddleware, chatbotController\.getSuggestions\)/,
  );
});

test('mutable policy and pricing questions use deterministic grounding responses', () => {
  const { buildOperationalGroundingResponse } = require('../controllers/chatbot.controller').__test;

  const rules = buildOperationalGroundingResponse([KNOWLEDGE_BASE.house_rules]);
  assert.match(rules, /cannot confirm current rule schedules/i);
  assert.match(rules, /Documents|Admin Support/i);

  const unknownRate = buildOperationalGroundingResponse([KNOWLEDGE_BASE.room_types], {});
  assert.match(unknownRate, /cannot confirm current room prices/i);
  assert.doesNotMatch(unknownRate, /\b\d{4,}\b/);

  const ownRate = buildOperationalGroundingResponse(
    [KNOWLEDGE_BASE.room_types],
    { monthlyRent: 8123.45 },
  );
  assert.match(ownRate, /P8,123\.45/);
  assert.match(ownRate, /current contract/i);
});

test('confirmed residents are not sent back through move-in onboarding', () => {
  const { buildOperationalGroundingResponse } = require('../controllers/chatbot.controller').__test;
  const response = buildOperationalGroundingResponse(
    [KNOWLEDGE_BASE.move_in_requirements],
    { occupancyStatus: 'active' },
  );

  assert.match(response, /already recorded as a current resident/i);
  assert.match(response, /will not assume move-in onboarding/i);
});

test('payment-channel questions are answered from the authenticated Billing flow, not remembered account details', async () => {
  const { buildBillingResponse } = require('../controllers/chatbot.controller').__test;
  const db = {
    collection() {
      return {
        find() {
          return {
            sort() { return this; },
            limit() { return this; },
            async toArray() { return []; },
          };
        },
      };
    },
  };

  const result = await buildBillingResponse(
    db,
    { user_id: 'tenant-a' },
    'What payment methods can I use?',
  );
  assert.match(result.message, /Billing will show the channels enabled/i);
  assert.match(result.message, /cannot safely provide a bank account/i);
  assert.doesNotMatch(result.message, /BDO|BPI|\b09\d{9}\b/);
});
