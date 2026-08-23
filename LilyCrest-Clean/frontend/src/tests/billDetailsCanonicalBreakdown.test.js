/* global test, __dirname */
// Regression coverage for the P0 tenant-mobile billing reconciliation:
//
// 1. bill-details.jsx used to reimplement its own "is this bill's utility
//    released" check (separate from billingStatus.js's
//    getUtilityReleaseSchedule, which billing-history.jsx already used),
//    so the same bill could show "Your utility bill has not been released
//    yet." on Bill Details while Billing History correctly showed it as
//    released. Bill Details must now derive that state from the single
//    shared function.
// 2. The canonical mobile billing bridge (mobileBillingBridge.js
//    toMobileBill()) returns extra line items as bill.additional_charges
//    (with { name, amount } items), not bill.items — Bill Details only read
//    bill.items, so a real adjustment (e.g. a waived-fee credit) silently
//    disappeared from the breakdown table.
// 3. bill.electricity_breakdown / bill.water_breakdown (per-reading segment
//    detail) are no longer produced by the canonical backend — a
//    permanently-shown "Breakdown unavailable." block for every electricity/
//    water bill reads as a broken feature, not an absent one. The flat
//    Billing Summary total already covers the amount either way.
const fs = require('fs');
const path = require('path');
const { getBillReleaseDate } = require('../utils/billingStatus');

const detailsPath = path.resolve(__dirname, '../../app/bill-details.jsx');
const details = fs.readFileSync(detailsPath, 'utf8');

describe('bill-details.jsx release state', () => {
  test('derives the "unreleased utility" banner from the shared getUtilityReleaseSchedule, not a local reimplementation', () => {
    expect(details).toContain('getUtilityReleaseSchedule');
    expect(details).toContain('releaseSchedule.unreleasedUtility');
    // The old duplicated condition variables must be gone, not just unused.
    expect(details).not.toContain('expectsElectricityBreakdown');
    expect(details).not.toContain('expectsWaterBreakdown');
  });

  test('the "Released" header value comes from the resolved schedule, never a raw created_at fallback', () => {
    expect(details).toContain('releaseSchedule.releaseDate');
    expect(details).not.toContain('bill.release_date || bill.created_at');
  });
});

describe('bill-details.jsx breakdown line items', () => {
  test('reads the canonical bill.additional_charges field, not only the legacy bill.items', () => {
    const breakdown = fs.readFileSync(path.resolve(__dirname, '../utils/billingBreakdown.js'), 'utf8');
    expect(details).toContain('getBillChargeRows(bill)');
    expect(breakdown).toContain('bill.additional_charges');
  });

  test('does not permanently render a "Breakdown unavailable." placeholder for electricity/water', () => {
    expect(details).not.toContain('Breakdown unavailable.');
  });

  test('the segmented electricity/water breakdown only renders when the backend actually supplies it', () => {
    expect(details).toContain('Array.isArray(bill.electricity_breakdown) && bill.electricity_breakdown.length > 0');
  });

  test('the displayed electricity total is the canonical bill field, never a client-side segment sum', () => {
    expect(details).toContain('safeCurrency(bill.electricity)');
    expect(details).not.toContain('bill.electricity_breakdown.reduce');
  });
});

describe('billingStatus.getBillReleaseDate', () => {
  test('does not fabricate a release date from created_at when no real release timestamp exists', () => {
    expect(getBillReleaseDate({ created_at: '2026-01-01T00:00:00.000Z' })).toBeNull();
    expect(getBillReleaseDate({ createdAt: '2026-01-01T00:00:00.000Z' })).toBeNull();
  });

  test('still returns the authoritative release_date when present', () => {
    expect(getBillReleaseDate({ release_date: '2026-02-03T00:00:00.000Z' })).toBe('2026-02-03T00:00:00.000Z');
  });
});
