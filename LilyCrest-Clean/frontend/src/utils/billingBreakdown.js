import { getBillOwedAmount, isBillOutstanding } from './billingStatus';

const MONEY_EPSILON = 0.005;

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function charge(label, amount, icon = 'receipt-outline', metadata = {}) {
  const colorByIcon = {
    'home-outline': '#1E40AF',
    'shield-checkmark-outline': '#2563EB',
    'flash-outline': '#92400E',
    'water-outline': '#2563EB',
    'warning-outline': '#991B1B',
    'remove-circle-outline': '#065F46',
    'checkmark-circle-outline': '#065F46',
  };
  return {
    label,
    amount: roundMoney(amount),
    icon,
    color: colorByIcon[icon] || '#6B7280',
    ...metadata,
  };
}

function getBillId(bill) {
  return bill?.billing_id || bill?.id || bill?._id || bill?.billingId || bill?.billId || bill?.reference_id || null;
}

function getMoveInBillingSummary(bill) {
  const moveIn = bill?.move_in_financials || bill?.moveInFinancials || null;
  if (!moveIn) return null;

  const advanceRent = roundMoney(moveIn.advanceRent);
  const securityDeposit = roundMoney(moveIn.securityDeposit);
  const reservationFeeCredit = roundMoney(moveIn.reservationFeeAlreadyPaid);
  const calculatedRequirementsTotal = roundMoney(advanceRent + securityDeposit);
  const hasSuppliedRequirementsTotal = moveIn.totalDueBeforeMoveIn !== null
    && moveIn.totalDueBeforeMoveIn !== undefined
    && String(moveIn.totalDueBeforeMoveIn).trim() !== '';
  const suppliedRequirementsTotal = Number(moveIn.totalDueBeforeMoveIn);
  const totalMoveInRequirements = hasSuppliedRequirementsTotal && Number.isFinite(suppliedRequirementsTotal)
    ? roundMoney(suppliedRequirementsTotal)
    : calculatedRequirementsTotal;

  return {
    financials: moveIn,
    requirementRows: [
      charge('1-Month Advance Rent', advanceRent, 'home-outline', {
        detail: 'Month 1 Rent',
        kind: 'move_in_requirement',
      }),
      charge('1-Month Security Deposit', securityDeposit, 'shield-checkmark-outline', {
        detail: 'Refundable',
        kind: 'move_in_requirement',
      }),
    ],
    reservationCreditRow: reservationFeeCredit === 0 ? null : charge(
      'Less: Slot Reservation Fee Credit',
      -reservationFeeCredit,
      'remove-circle-outline',
      { detail: 'Online', kind: 'move_in_credit' },
    ),
    totalMoveInRequirements,
    remainingBalance: roundMoney(totalMoveInRequirements - reservationFeeCredit),
  };
}

function getBillChargeRows(bill) {
  if (!bill) return [];
  const owedAmount = roundMoney(getBillOwedAmount(bill));
  const moveIn = bill.move_in_financials || bill.moveInFinancials || null;
  const rows = [];

  if (moveIn) {
    const moveInSummary = getMoveInBillingSummary(bill);
    rows.push(...moveInSummary.requirementRows);
    if (moveInSummary.reservationCreditRow) rows.push(moveInSummary.reservationCreditRow);
  } else {
    if (roundMoney(bill.rent) !== 0) rows.push(charge('Rent', bill.rent, 'home-outline'));
    if (roundMoney(bill.electricity) !== 0) rows.push(charge('Electricity', bill.electricity, 'flash-outline'));
    if (roundMoney(bill.water) !== 0) rows.push(charge('Water', bill.water, 'water-outline'));

    const additional = Array.isArray(bill.additional_charges)
      ? bill.additional_charges
      : Array.isArray(bill.items) ? bill.items : [];
    let namedAdditionalTotal = 0;
    additional.forEach((item) => {
      const amount = roundMoney(item?.amount);
      if (amount === 0) return;
      namedAdditionalTotal = roundMoney(namedAdditionalTotal + amount);
      rows.push(charge(
        item?.name || item?.label || item?.description || 'Other Charge',
        amount,
        'receipt-outline',
      ));
    });

    // The canonical mobile DTO's `penalties` field includes penalty,
    // appliance fees, and corkage fees. `additional_charges` names those
    // ancillary fees, so only render the remainder as Penalty to avoid
    // counting the same fee twice in the tenant breakdown.
    const unnamedPenalty = roundMoney(Number(bill.penalties || 0) - namedAdditionalTotal);
    if (unnamedPenalty !== 0) rows.push(charge('Penalty', unnamedPenalty, 'warning-outline'));
  }

  if (rows.length === 0 && owedAmount !== 0) {
    const rawLabel = String(bill.billing_type || bill.description || bill.billing_period || 'Other Charge').trim();
    rows.push(charge(rawLabel || 'Other Charge', owedAmount));
  }

  const grossRows = roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
  const reconciliation = roundMoney(owedAmount - grossRows);
  if (Math.abs(reconciliation) >= MONEY_EPSILON) {
    rows.push(charge(
      reconciliation < 0 ? 'Payments and Credits Applied' : 'Other Outstanding Balance',
      reconciliation,
      reconciliation < 0 ? 'checkmark-circle-outline' : 'add-circle-outline',
    ));
  }

  return rows;
}

function getOutstandingBreakdown(bills = []) {
  const outstandingBills = (Array.isArray(bills) ? bills : [])
    .filter((bill) => isBillOutstanding(bill) && getBillOwedAmount(bill) > 0);
  const grouped = new Map();

  outstandingBills.forEach((bill) => {
    getBillChargeRows(bill).forEach((row) => {
      const key = String(row.label || 'Other Charge').trim().toLocaleLowerCase('en');
      const current = grouped.get(key);
      grouped.set(key, {
        label: current?.label || row.label,
        icon: current?.icon || row.icon,
        amount: roundMoney((current?.amount || 0) + row.amount),
      });
    });
  });

  const total = roundMoney(outstandingBills.reduce((sum, bill) => sum + getBillOwedAmount(bill), 0));
  const items = Array.from(grouped.values()).filter((item) => Math.abs(item.amount) >= MONEY_EPSILON);
  const itemTotal = roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
  const difference = roundMoney(total - itemTotal);
  if (Math.abs(difference) >= MONEY_EPSILON) {
    items.push(charge('Balance Reconciliation', difference, 'calculator-outline'));
  }

  return {
    bills: outstandingBills,
    billIds: outstandingBills.map(getBillId).filter(Boolean).map(String),
    items,
    total,
    itemTotal: roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
  };
}

export { getBillChargeRows, getBillId, getMoveInBillingSummary, getOutstandingBreakdown, roundMoney };
