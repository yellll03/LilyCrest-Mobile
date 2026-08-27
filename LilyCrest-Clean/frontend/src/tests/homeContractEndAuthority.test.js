/* global __dirname, test */
import fs from 'fs';
import path from 'path';
import { buildContractEndSummary } from '../utils/contractPresentation';

const projectRoot = path.resolve(__dirname, '../..');
const homeSource = fs.readFileSync(path.join(projectRoot, 'app/(tabs)/home.jsx'), 'utf8');

describe('Home "Contract End" uses authoritative Contract state, not a date verdict', () => {
  test('no current Contract => no "expired N days ago" verdict, just "no current lease"', () => {
    const summary = buildContractEndSummary(null, 'NO_PUBLISHED_CONTRACT');
    expect(summary.meta).toBeNull();
    expect(summary.detail).toBe('No current lease contract on record.');
    expect(summary.modalType).toBe('info');
  });

  test('active Contract uses the backend displayStatus / displayLifecycle label', () => {
    const summary = buildContractEndSummary(
      { displayStatus: 'Active Contract', displayLifecycle: { key: 'active', label: 'Active' }, daysRemaining: 200, leaseEndDate: '2027-01-01' },
      'CONTRACT_AVAILABLE',
    );
    expect(summary.detail).toBe('Active Contract');
    expect(summary.meta).toBe('200d left');
    expect(summary.modalType).toBe('success');
  });

  test('expiring_soon: chip is a factual daysRemaining count, wording is the backend label', () => {
    const summary = buildContractEndSummary(
      { displayStatus: 'Contract Ending Soon', displayLifecycle: { key: 'expiring_soon', label: 'Expiring Soon' }, daysRemaining: 12 },
      'CONTRACT_AVAILABLE',
    );
    expect(summary.meta).toBe('12d left');
    expect(summary.detail).toBe('Contract Ending Soon');
    expect(summary.modalType).toBe('warning');
  });

  test('expired lifecycle => "Ended", error tone — never a locally computed "expired N days ago"', () => {
    const summary = buildContractEndSummary(
      { displayStatus: 'Contract Ended', displayLifecycle: { key: 'expired', label: 'Expired' }, daysRemaining: -5 },
      'CONTRACT_AVAILABLE',
    );
    expect(summary.meta).toBe('Ended');
    expect(summary.detail).toBe('Contract Ended');
    expect(summary.modalType).toBe('error');
    // The string that would come from a local Date.now() comparison must not appear.
    expect(summary.detail).not.toMatch(/\d+ days ago/);
  });

  test('published_future (renewal activated but lease not started) is not flattened to "active"', () => {
    const summary = buildContractEndSummary(
      { displayStatus: 'Active Contract', displayLifecycle: { key: 'published_future', label: 'Published — Lease Not Yet Started' }, daysRemaining: 400 },
      'CONTRACT_AVAILABLE',
    );
    expect(summary.meta).toBe('Not started');
  });
});

describe('home.jsx no longer derives lease lifecycle from assignment dates', () => {
  test('the "Contract End" tile no longer builds "expired N days ago / ends today" strings from Date.now()', () => {
    // The old implementation computed daysLeft = (endDate - now) and branched
    // into "Your contract expired N days ago" / "Your contract ends today!".
    expect(homeSource).not.toMatch(/Your contract expired \$\{Math\.abs\(daysLeft\)\} days ago/);
    expect(homeSource).not.toMatch(/Your contract ends today!/);
    expect(homeSource).not.toMatch(/Only \$\{daysLeft\} days remaining!/);
  });

  test('the "Contract End" tile presentation is sourced from contractEndSummary', () => {
    expect(homeSource).toContain('buildContractEndSummary(tenantContract, tenantContractState)');
    expect(homeSource).toContain('contractEndSummary.detail');
    expect(homeSource).toContain('contractEndSummary.modalType');
  });

  test('home subscribes to canonical lifecycle events and refetches the dashboard', () => {
    expect(homeSource).toContain('subscribeCanonicalNotifications');
    expect(homeSource).toMatch(/'move_out'[\s\S]{0,120}'transfer_complete'/);
    expect(homeSource).toContain("AppState.addEventListener('change'");
  });
});
