/* global test */
const {
  getBillChargeRows,
  getOutstandingBreakdown,
} = require('../utils/billingBreakdown');

describe('outstanding balance aggregation', () => {
  test('combines every unpaid bill and preserves the dashboard/payment invariant', () => {
    const result = getOutstandingBreakdown([
      { _id: '1', status: 'unpaid', remaining_amount: 3000, rent: 3000 },
      { _id: '2', status: 'overdue', remaining_amount: 750, electricity: 750 },
      { _id: '3', status: 'unpaid', remaining_amount: 300, water: 300 },
      { _id: '4', status: 'paid', remaining_amount: 0, rent: 9999 },
    ]);

    expect(result.billIds).toEqual(['1', '2', '3']);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Rent', amount: 3000 }),
      expect.objectContaining({ label: 'Electricity', amount: 750 }),
      expect.objectContaining({ label: 'Water', amount: 300 }),
    ]));
    expect(result.total).toBe(4050);
    expect(result.itemTotal).toBe(result.total);
  });

  test('does not double count named additional charges inside the combined penalties DTO field', () => {
    const rows = getBillChargeRows({
      status: 'unpaid',
      remaining_amount: 650,
      rent: 500,
      penalties: 150,
      additional_charges: [{ name: 'Appliance Fee', amount: 100 }],
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Rent', amount: 500 }),
      expect.objectContaining({ label: 'Appliance Fee', amount: 100 }),
      expect.objectContaining({ label: 'Penalty', amount: 50 }),
    ]));
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(650);
  });

  test('shows partial-payment credit while keeping itemized total equal to amount still owed', () => {
    const result = getOutstandingBreakdown([{
      _id: 'partial',
      status: 'partially_paid',
      remaining_amount: 600,
      rent: 1000,
    }]);

    expect(result.items).toContainEqual(expect.objectContaining({
      label: 'Payments and Credits Applied',
      amount: -400,
    }));
    expect(result.itemTotal).toBe(600);
  });

  test('supports arbitrary backend-provided charge names without hardcoded categories', () => {
    const result = getOutstandingBreakdown([{
      _id: 'custom',
      status: 'unpaid',
      remaining_amount: 275,
      penalties: 275,
      additional_charges: [{ name: 'Key Replacement', amount: 275 }],
    }]);

    expect(result.items).toContainEqual(expect.objectContaining({ label: 'Key Replacement', amount: 275 }));
    expect(result.itemTotal).toBe(result.total);
  });
});
