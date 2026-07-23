'use strict';

const MS_PER_DAY = 86400000;
const DAILY_LATE_PENALTY = 50;
const GRACE_DAYS = 1;

function dateOnlyUtc(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('A valid date is required.');
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function sameDayInMonth(moveInDate, year, month) {
  const moveIn = dateOnlyUtc(moveInDate);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(moveIn.getUTCDate(), lastDay)));
}

function firstRegularBillingDueDate(moveInDate) {
  const moveIn = dateOnlyUtc(moveInDate);
  const next = new Date(Date.UTC(moveIn.getUTCFullYear(), moveIn.getUTCMonth() + 1, 1));
  return sameDayInMonth(moveIn, next.getUTCFullYear(), next.getUTCMonth());
}

function dueDateForBillingMonth(moveInDate, billingMonth) {
  const month = dateOnlyUtc(billingMonth);
  return sameDayInMonth(moveInDate, month.getUTCFullYear(), month.getUTCMonth());
}

function calculateLatePenalty(dueDate, asOfDate, dailyRate = DAILY_LATE_PENALTY) {
  const daysAfterDue = Math.max(0, Math.floor((dateOnlyUtc(asOfDate) - dateOnlyUtc(dueDate)) / MS_PER_DAY));
  const penaltyDays = Math.max(0, daysAfterDue - GRACE_DAYS);
  return { daysAfterDue, graceDays: GRACE_DAYS, penaltyDays, amount: penaltyDays * dailyRate };
}

module.exports = {
  DAILY_LATE_PENALTY, GRACE_DAYS, calculateLatePenalty, dueDateForBillingMonth,
  firstRegularBillingDueDate, sameDayInMonth,
};
