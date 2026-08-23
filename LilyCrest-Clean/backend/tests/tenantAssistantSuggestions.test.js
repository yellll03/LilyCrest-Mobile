const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyTenantAssistantState,
  getTenantAssistantSuggestions,
} = require('../services/tenantAssistantSuggestions.service');

test('active occupancy produces resident suggestions without onboarding prompts', () => {
  const result = getTenantAssistantSuggestions({ occupancyStatus: 'active' });

  assert.equal(result.state, 'resident');
  assert.equal(result.suggestions.length, 4);
  assert.match(result.suggestions.join(' '), /billing|pay/i);
  assert.doesNotMatch(result.suggestions.join(' '), /move-in requirements|documents are still required/i);
});

test('pre-move-in state offers account-specific onboarding questions', () => {
  const result = getTenantAssistantSuggestions({ occupancyStatus: 'awaiting-move-in' });

  assert.equal(result.state, 'pre_move_in');
  assert.match(result.suggestions.join(' '), /move-in date/i);
  assert.match(result.suggestions.join(' '), /documents are still required/i);
});

test('unknown or conflicting-looking values stay unresolved and do not assume onboarding', () => {
  assert.equal(classifyTenantAssistantState({ occupancyStatus: 'unknown' }), 'unresolved');
  assert.equal(classifyTenantAssistantState({}), 'unresolved');

  const result = getTenantAssistantSuggestions({ occupancyStatus: 'unknown' });
  assert.doesNotMatch(result.suggestions.join(' '), /move-in requirements|move-in date|still required/i);
});

test('an explicit resident signal wins over a stale pending lease label', () => {
  assert.equal(classifyTenantAssistantState({
    occupancyStatus: 'checked-in',
    leaseStatus: 'pending',
  }), 'resident');
});
