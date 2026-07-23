'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateLatePenalty, dueDateForBillingMonth, firstRegularBillingDueDate } = require('../domain/billing/billingPolicy');

test('regular billing begins on the same day number in month two', () => {
  assert.equal(firstRegularBillingDueDate('2026-01-15').toISOString(), '2026-02-15T00:00:00.000Z');
});
test('short billing months clamp the move-in day safely', () => {
  assert.equal(firstRegularBillingDueDate('2026-01-31').toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(dueDateForBillingMonth('2024-01-31', '2024-02-01').toISOString(), '2024-02-29T00:00:00.000Z');
});
test('due date and one-day grace boundary have no penalty', () => {
  assert.equal(calculateLatePenalty('2026-08-15', '2026-08-15').amount, 0);
  assert.equal(calculateLatePenalty('2026-08-15', '2026-08-16').amount, 0);
});
test('PHP 50 per day begins on day two after due date', () => {
  assert.deepEqual(calculateLatePenalty('2026-08-15', '2026-08-17'), { daysAfterDue: 2, graceDays: 1, penaltyDays: 1, amount: 50 });
  assert.equal(calculateLatePenalty('2026-08-15', '2026-08-20').amount, 200);
});
