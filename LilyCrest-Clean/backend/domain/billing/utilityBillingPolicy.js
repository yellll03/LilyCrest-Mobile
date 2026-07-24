'use strict';

const { utilityBilling } = require('../../config/billing.settings');

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value) {
  const date = validDate(value);
  return date ? date.toISOString() : null;
}

function addCalendarDays(value, days) {
  const date = validDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date;
}

function resolveUtilityDeadline(record = {}, settings = utilityBilling) {
  const billReleaseDate = validDate(record.billReleaseDate ?? record.releaseDate);
  const providerDueDate = validDate(record.providerDueDate);
  const computedFallbackDueDate = billReleaseDate
    ? addCalendarDays(billReleaseDate, settings.paymentWindowDays)
    : null;
  const finalDueDate = providerDueDate || computedFallbackDueDate;

  return {
    billingPeriodStart: iso(record.billingPeriodStart),
    billingPeriodEnd: iso(record.billingPeriodEnd),
    meterReadingDate: iso(record.meterReadingDate),
    billReleaseDate: iso(billReleaseDate),
    providerDueDate: iso(providerDueDate),
    computedFallbackDueDate: iso(computedFallbackDueDate),
    finalDueDate: iso(finalDueDate),
    dueDateSource: providerDueDate
      ? 'PROVIDER_BILL'
      : (computedFallbackDueDate ? 'CONFIGURED_WINDOW' : null),
  };
}

module.exports = { addCalendarDays, resolveUtilityDeadline };
