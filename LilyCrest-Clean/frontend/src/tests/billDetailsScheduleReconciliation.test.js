/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../../app/bill-details.jsx'), 'utf8');

describe('Bill Details utility schedule reconciliation', () => {
  test('does not render standalone utility billing schedule cards', () => {
    expect(source).not.toContain('Electricity Billing Schedule');
    expect(source).not.toContain('Water Billing Schedule');
    expect(source).not.toContain('Utility Billing Schedule');
    expect(source).not.toContain('getRenderableUtilitySchedules');
  });

  test('keeps useful cycle and reading dates in the detailed breakdowns', () => {
    expect(source).toContain('Meter cycle');
    expect(source).toContain('Usage period');
    expect(source).toContain('Reading date');
    expect(source).toContain('reading_date_from');
    expect(source).toContain('reading_date_to');
  });
});
