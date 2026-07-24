'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUtilityDeadline } = require('../domain/billing/utilityBillingPolicy');

test('release on the 18th with a ten-day window is due on the 28th', () => {
  const result = resolveUtilityDeadline({
    meterReadingDate: '2026-08-15T00:00:00.000Z',
    billReleaseDate: '2026-08-18T00:00:00.000Z',
  });
  assert.equal(result.finalDueDate, '2026-08-28T00:00:00.000Z');
  assert.equal(result.dueDateSource, 'CONFIGURED_WINDOW');
});

test('provider due date overrides the configured fallback', () => {
  const result = resolveUtilityDeadline({
    billReleaseDate: '2026-08-18T00:00:00.000Z',
    providerDueDate: '2026-08-25T00:00:00.000Z',
  });
  assert.equal(result.computedFallbackDueDate, '2026-08-28T00:00:00.000Z');
  assert.equal(result.finalDueDate, '2026-08-25T00:00:00.000Z');
  assert.equal(result.dueDateSource, 'PROVIDER_BILL');
});

test('meter reading without a release date never starts a countdown', () => {
  const result = resolveUtilityDeadline({ meterReadingDate: '2026-08-15T00:00:00.000Z' });
  assert.equal(result.billReleaseDate, null);
  assert.equal(result.computedFallbackDueDate, null);
  assert.equal(result.finalDueDate, null);
  assert.equal(result.dueDateSource, null);
});
