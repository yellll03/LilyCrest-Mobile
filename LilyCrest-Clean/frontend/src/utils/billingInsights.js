const EXCLUDED_STATUSES = new Set(['cancelled', 'rejected', 'void', 'verification', 'duplicate', 'archived', 'refunded']);
const PAID_STATUSES = new Set(['paid', 'settled']);
const UTILITY_ORDER = ['electricity', 'water'];
const DAY_MS = 86400000;
const DUE_SOON_DAYS = 7;
const RECENT_AVERAGE_WINDOW = 3;
const PAYMENT_HEALTH_WINDOW = 6;

function getBillStatus(bill) {
  return String(bill?.status || '').toLowerCase();
}

function isExcludedBill(bill) {
  return EXCLUDED_STATUSES.has(getBillStatus(bill));
}

function isPaidBill(bill) {
  return PAID_STATUSES.has(getBillStatus(bill));
}

function toFiniteAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(amount) {
  return `\u20b1${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatShortDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatPercent(value) {
  return `${Math.round(Math.abs(value) * 100)}%`;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getStartOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDaysUntil(value) {
  if (!value) return null;
  const target = getStartOfDay(value);
  const today = getStartOfDay();
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

function describeDueTiming(daysUntilDue) {
  if (daysUntilDue === null || daysUntilDue === undefined) return 'No due date';
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'} overdue`;
  if (daysUntilDue === 0) return 'Due today';
  return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
}

function getBillPaymentDate(bill) {
  return (
    bill?.payment_date ||
    bill?.paymentDate ||
    bill?.paidAt ||
    bill?.paid_at ||
    null
  );
}

function getBillDueDate(bill) {
  const raw = bill?.due_date || bill?.dueDate || null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getBillDateValue(bill) {
  return (
    bill?.due_date ||
    bill?.dueDate ||
    bill?.release_date ||
    bill?.releaseDate ||
    bill?.created_at ||
    bill?.createdAt ||
    null
  );
}

function getBillTimestamp(bill) {
  const value = getBillDateValue(bill);
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortBillsNewestFirst(bills) {
  return [...bills].sort((left, right) => getBillTimestamp(right) - getBillTimestamp(left));
}

function getBillTotalAmount(bill) {
  const candidates = [
    bill?.original_total,
    bill?.gross_amount,
    bill?.grossAmount,
    bill?.total,
    bill?.amount,
    bill?.remaining_amount,
  ];

  for (const value of candidates) {
    const parsed = toFiniteAmount(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function getUnpaidAmount(bill) {
  const candidates = [bill?.remaining_amount, bill?.total, bill?.amount];
  for (const value of candidates) {
    const parsed = toFiniteAmount(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeBreakdown(bill) {
  const parts = [];
  if (toFiniteAmount(bill?.water) !== null) parts.push({ type: 'water', amount: bill.water });
  if (toFiniteAmount(bill?.electricity) !== null) parts.push({ type: 'electricity', amount: bill.electricity });
  if (Array.isArray(bill?.items)) {
    bill.items.forEach((item) => {
      const type = String(item?.type || '').toLowerCase();
      const amount = toFiniteAmount(item?.amount);
      if (!type || amount === null) return;
      parts.push({ type, amount });
    });
  }
  return parts;
}

function getUtilityAmountForTrend(bill, utility) {
  const directAmount = toFiniteAmount(bill?.[utility]);
  if (directAmount !== null) return directAmount;

  const matchingBreakdownItems = normalizeBreakdown(bill).filter((item) => item.type === utility);
  if (matchingBreakdownItems.length > 0) {
    const breakdownAmount = matchingBreakdownItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (Number.isFinite(breakdownAmount)) return breakdownAmount;
  }

  const billType = String(bill?.billing_type || bill?.type || '').toLowerCase();
  if (billType === utility) return getBillTotalAmount(bill);

  return null;
}

function getInsightBills(bills) {
  if (!Array.isArray(bills)) return [];
  return sortBillsNewestFirst(bills.filter((bill) => bill && !isExcludedBill(bill)));
}

function getOutstandingBills(bills) {
  return bills.filter((bill) => {
    if (isPaidBill(bill)) return false;
    const amount = getUnpaidAmount(bill);
    return amount !== null && amount > 0;
  });
}

function getRecentBillLabel(bill) {
  if (!bill) return 'No billing period';
  return bill?.billing_period || formatShortDate(getBillDateValue(bill)) || 'Recent bill';
}

function buildOutstandingSnapshot(bills) {
  const outstandingBills = getOutstandingBills(bills);
  const outstandingTotal = outstandingBills.reduce((sum, bill) => sum + (getUnpaidAmount(bill) || 0), 0);
  const dueBills = outstandingBills
    .map((bill) => ({ bill, dueDate: getBillDueDate(bill) }))
    .filter((entry) => entry.dueDate)
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());

  const overdueBills = dueBills.filter((entry) => getDaysUntil(entry.dueDate) < 0);
  const nextDue = dueBills[0] || null;

  return {
    outstandingBills,
    outstandingTotal,
    outstandingCount: outstandingBills.length,
    overdueCount: overdueBills.length,
    overdueBill: overdueBills[0]?.bill || null,
    nextDueBill: nextDue?.bill || null,
    nextDueDate: nextDue?.dueDate || null,
    nextDueDays: nextDue ? getDaysUntil(nextDue.dueDate) : null,
  };
}

function buildUtilityComparison(bills, utility) {
  const comparableBills = bills.filter((bill) => toFiniteAmount(getUtilityAmountForTrend(bill, utility)) !== null);
  if (comparableBills.length < 2) return null;

  const currentAmount = getUtilityAmountForTrend(comparableBills[0], utility);
  const previousAmount = getUtilityAmountForTrend(comparableBills[1], utility);
  if (currentAmount === null || previousAmount === null) return null;

  return {
    utility,
    currentAmount,
    previousAmount,
    difference: currentAmount - previousAmount,
  };
}

function buildUtilityInsight(bills, utility) {
  const comparison = buildUtilityComparison(bills, utility);
  if (!comparison) return null;

  const label = utility === 'electricity' ? 'Electricity' : 'Water';
  const difference = comparison.difference;
  const baseline = comparison.previousAmount || 0;
  const percentChange = baseline > 0 ? difference / baseline : 0;

  if (difference > 0) {
    return {
      id: `utility-${utility}`,
      kind: 'utility',
      utility,
      label,
      tone: 'increase',
      icon: 'trending-up',
      title: `${label} change`,
      message: `${label} is ${formatCurrency(difference)} higher than your last recorded ${utility} bill${baseline > 0 ? ` (${formatPercent(percentChange)} up)` : ''}.`,
    };
  }

  if (difference < 0) {
    return {
      id: `utility-${utility}`,
      kind: 'utility',
      utility,
      label,
      tone: 'decrease',
      icon: 'trending-down',
      title: `${label} change`,
      message: `${label} is ${formatCurrency(Math.abs(difference))} lower than your last recorded ${utility} bill${baseline > 0 ? ` (${formatPercent(percentChange)} down)` : ''}.`,
    };
  }

  return {
    id: `utility-${utility}`,
    kind: 'utility',
    utility,
    label,
    tone: 'neutral',
    icon: 'remove',
    title: `${label} change`,
    message: `${label} matched your last recorded ${utility} bill.`,
  };
}

function buildAverageComparisonInsight(bills) {
  const comparableBills = bills.filter((bill) => {
    const total = getBillTotalAmount(bill);
    return total !== null && total > 0;
  });

  if (comparableBills.length < 2) return null;

  const latestBill = comparableBills[0];
  const comparisonBills = comparableBills.slice(1, RECENT_AVERAGE_WINDOW + 1);
  if (!comparisonBills.length) return null;

  const latestAmount = getBillTotalAmount(latestBill);
  const averageAmount = comparisonBills.reduce((sum, bill) => sum + (getBillTotalAmount(bill) || 0), 0) / comparisonBills.length;
  if (!Number.isFinite(latestAmount) || !Number.isFinite(averageAmount) || averageAmount <= 0) return null;

  const difference = latestAmount - averageAmount;
  const percentChange = difference / averageAmount;
  const direction = Math.abs(percentChange) < 0.05 ? 'steady' : difference > 0 ? 'increase' : 'decrease';

  let message = `Your latest bill is close to your recent average of ${formatCurrency(averageAmount)}.`;
  if (direction === 'increase') {
    message = `Your latest bill is ${formatPercent(percentChange)} higher than your recent average of ${formatCurrency(averageAmount)}.`;
  } else if (direction === 'decrease') {
    message = `Your latest bill is ${formatPercent(percentChange)} lower than your recent average of ${formatCurrency(averageAmount)}.`;
  }

  return {
    id: 'average-comparison',
    kind: 'comparison',
    tone: direction === 'steady' ? 'neutral' : direction,
    icon: direction === 'increase' ? 'stats-chart' : direction === 'decrease' ? 'trending-down' : 'remove',
    title: 'Recent comparison',
    message,
    latestAmount,
    averageAmount,
    percentChange,
    sampleCount: comparisonBills.length,
    latestBill,
  };
}

function buildPaymentHealthInsight(bills) {
  const recentBills = bills.filter((bill) => {
    const total = getBillTotalAmount(bill);
    return total !== null && total > 0;
  }).slice(0, PAYMENT_HEALTH_WINDOW);

  if (recentBills.length < 2) return null;

  const paidCount = recentBills.filter(isPaidBill).length;
  const openCount = recentBills.length - paidCount;
  const onTimeCount = recentBills.filter((bill) => {
    if (!isPaidBill(bill)) return false;
    const paymentDate = getBillPaymentDate(bill);
    const dueDate = getBillDueDate(bill);
    if (!paymentDate || !dueDate) return false;
    return new Date(paymentDate).getTime() <= dueDate.getTime();
  }).length;

  let tone = 'positive';
  let icon = 'checkmark-done';
  let message = `${paidCount} of your last ${recentBills.length} recorded bills are marked paid.`;

  if (openCount > 0) {
    tone = openCount >= Math.ceil(recentBills.length / 2) ? 'warning' : 'neutral';
    icon = openCount >= Math.ceil(recentBills.length / 2) ? 'alert-circle' : 'checkmark-done';
    message = `${paidCount} of your last ${recentBills.length} recorded bills are paid, and ${openCount} are still open.`;
  } else if (onTimeCount === recentBills.length) {
    message = `All of your last ${recentBills.length} recorded bills are marked paid on time.`;
  } else if (onTimeCount > 0) {
    message = `All of your last ${recentBills.length} recorded bills are marked paid, with ${onTimeCount} paid on or before the due date.`;
  }

  return {
    id: 'payment-health',
    kind: 'health',
    tone,
    icon,
    title: 'Payment record',
    message,
    paidCount,
    recentCount: recentBills.length,
    onTimeCount,
  };
}

function buildUtilityShareInsight(latestBill) {
  if (!latestBill) return null;

  const totalAmount = getBillTotalAmount(latestBill);
  const electricity = toFiniteAmount(latestBill?.electricity) || 0;
  const water = toFiniteAmount(latestBill?.water) || 0;
  const utilityTotal = electricity + water;

  if (!totalAmount || utilityTotal <= 0) return null;

  const utilityShare = utilityTotal / totalAmount;
  return {
    id: 'utility-share',
    kind: 'composition',
    tone: utilityShare >= 0.4 ? 'warning' : 'neutral',
    icon: 'flash',
    title: 'Latest bill mix',
    message: `Utilities make up ${formatCurrency(utilityTotal)} of your latest bill${utilityShare > 0 ? ` (${formatPercent(utilityShare)})` : ''}.`,
  };
}

function buildHeadline(snapshot, comparisonInsight, paymentHealthInsight, latestBill, utilityInsights) {
  if (snapshot.overdueCount > 0) {
    return {
      sourceId: 'outstanding',
      tone: 'critical',
      title: 'Payment needed',
      message: `You have ${pluralize(snapshot.overdueCount, 'overdue bill')} totaling ${formatCurrency(snapshot.outstandingTotal)}.`,
    };
  }

  if (snapshot.outstandingCount > 0) {
    const dueLabel = snapshot.nextDueDate ? formatShortDate(snapshot.nextDueDate) : null;
    return {
      sourceId: 'outstanding',
      tone: snapshot.nextDueDays !== null && snapshot.nextDueDays <= DUE_SOON_DAYS ? 'warning' : 'neutral',
      title: snapshot.nextDueDays !== null && snapshot.nextDueDays <= DUE_SOON_DAYS ? 'Due soon' : 'Outstanding balance',
      message: `You have ${pluralize(snapshot.outstandingCount, 'unpaid bill')} totaling ${formatCurrency(snapshot.outstandingTotal)}${dueLabel ? `, with the next due date on ${dueLabel}` : ''}.`,
    };
  }

  if (comparisonInsight && Math.abs(comparisonInsight.percentChange) >= 0.1) {
    return {
      sourceId: comparisonInsight.id,
      tone: comparisonInsight.tone === 'decrease' ? 'positive' : 'neutral',
      title: 'Spending trend',
      message: comparisonInsight.message,
    };
  }

  if (paymentHealthInsight && paymentHealthInsight.paidCount === paymentHealthInsight.recentCount) {
    return {
      sourceId: paymentHealthInsight.id,
      tone: 'positive',
      title: 'Recent bills are settled',
      message: paymentHealthInsight.message,
    };
  }

  if (utilityInsights.length > 0) {
    return {
      sourceId: utilityInsights[0].id,
      tone: utilityInsights[0].tone === 'decrease' ? 'positive' : 'neutral',
      title: 'Usage signal',
      message: utilityInsights[0].message,
    };
  }

  if (latestBill) {
    const latestAmount = getBillTotalAmount(latestBill);
    return {
      sourceId: 'latest-recorded',
      tone: 'neutral',
      title: 'Latest bill recorded',
      message: latestAmount !== null
        ? `Your latest recorded bill, ${getRecentBillLabel(latestBill)}, came in at ${formatCurrency(latestAmount)}.`
        : `${getRecentBillLabel(latestBill)} is available in your billing history.`,
    };
  }

  return null;
}

function buildStats({ snapshot, comparisonInsight, paymentHealthInsight, latestBill }) {
  const stats = [];

  if (snapshot.outstandingCount > 0) {
    stats.push({
      id: 'outstanding',
      label: 'Open balance',
      value: formatCurrency(snapshot.outstandingTotal),
      helper: `${pluralize(snapshot.outstandingCount, 'unpaid bill')}`,
      tone: snapshot.overdueCount > 0 ? 'critical' : 'warning',
    });
  } else if (latestBill) {
    const latestAmount = getBillTotalAmount(latestBill);
    if (latestAmount !== null) {
      stats.push({
        id: 'latest-bill',
        label: 'Latest bill',
        value: formatCurrency(latestAmount),
        helper: getRecentBillLabel(latestBill),
        tone: 'neutral',
      });
    }
  }

  if (snapshot.nextDueBill && snapshot.nextDueDate) {
    stats.push({
      id: 'next-due',
      label: 'Next deadline',
      value: formatShortDate(snapshot.nextDueDate),
      helper: describeDueTiming(snapshot.nextDueDays),
      tone: snapshot.nextDueDays !== null && snapshot.nextDueDays < 0 ? 'critical' : snapshot.nextDueDays !== null && snapshot.nextDueDays <= DUE_SOON_DAYS ? 'warning' : 'neutral',
    });
  } else if (latestBill && isPaidBill(latestBill) && getBillPaymentDate(latestBill)) {
    stats.push({
      id: 'last-paid',
      label: 'Last paid',
      value: formatShortDate(getBillPaymentDate(latestBill)),
      helper: getRecentBillLabel(latestBill),
      tone: 'positive',
    });
  }

  if (comparisonInsight) {
    stats.push({
      id: 'recent-average',
      label: 'Recent average',
      value: formatCurrency(comparisonInsight.averageAmount),
      helper: `Last ${comparisonInsight.sampleCount} comparable bill${comparisonInsight.sampleCount === 1 ? '' : 's'}`,
      tone: comparisonInsight.tone === 'decrease' ? 'positive' : comparisonInsight.tone === 'increase' ? 'warning' : 'neutral',
    });
  }

  if (paymentHealthInsight) {
    stats.push({
      id: 'paid-rate',
      label: 'Bills paid',
      value: `${paymentHealthInsight.paidCount}/${paymentHealthInsight.recentCount}`,
      helper: paymentHealthInsight.onTimeCount > 0
        ? `${paymentHealthInsight.onTimeCount} on time`
        : 'Recorded in billing history',
      tone: paymentHealthInsight.tone,
    });
  }

  return stats.slice(0, 4);
}

function buildSignals({ headline, comparisonInsight, paymentHealthInsight, utilityInsights, compositionInsight }) {
  const signals = [];
  const headlineSourceId = headline?.sourceId || '';

  utilityInsights.forEach((insight) => {
    if (insight.id === headlineSourceId) return;
    signals.push(insight);
  });

  if (comparisonInsight && comparisonInsight.id !== headlineSourceId) {
    signals.push(comparisonInsight);
  }

  if (paymentHealthInsight && paymentHealthInsight.id !== headlineSourceId && paymentHealthInsight.recentCount > paymentHealthInsight.paidCount) {
    signals.push(paymentHealthInsight);
  }

  if (compositionInsight) {
    signals.push(compositionInsight);
  }

  return signals.slice(0, 4);
}

export function getBillingInsightPanel(bills) {
  try {
    const insightBills = getInsightBills(bills);
    if (!insightBills.length) return null;

    const snapshot = buildOutstandingSnapshot(insightBills);
    const comparisonInsight = buildAverageComparisonInsight(insightBills);
    const paymentHealthInsight = buildPaymentHealthInsight(insightBills);
    const utilityInsights = UTILITY_ORDER
      .map((utility) => buildUtilityInsight(insightBills, utility))
      .filter(Boolean);
    const latestBill = insightBills[0] || null;
    const compositionInsight = buildUtilityShareInsight(latestBill);
    const headline = buildHeadline(snapshot, comparisonInsight, paymentHealthInsight, latestBill, utilityInsights);
    const stats = buildStats({ snapshot, comparisonInsight, paymentHealthInsight, latestBill });
    const signals = buildSignals({
      headline,
      comparisonInsight,
      paymentHealthInsight,
      utilityInsights,
      compositionInsight,
    });

    if (!headline && signals.length === 0 && stats.length === 0) return null;

    return {
      headline,
      stats,
      signals,
      meta: {
        recordCount: insightBills.length,
        latestLabel: getRecentBillLabel(latestBill),
        latestAmount: latestBill ? getBillTotalAmount(latestBill) : null,
        latestStatus: latestBill ? getBillStatus(latestBill) : '',
        openCount: snapshot.outstandingCount,
        nextDueLabel: snapshot.nextDueDate ? formatShortDate(snapshot.nextDueDate) : null,
      },
    };
  } catch (error) {
    console.error('getBillingInsightPanel failed:', error);
    return null;
  }
}

export function getSmartBillingInsight(bills) {
  return getBillingInsightPanel(bills)?.headline || null;
}

export function getMonthlyUsageInsights(bills) {
  const panel = getBillingInsightPanel(bills);
  return panel?.signals.filter((signal) => signal.kind === 'utility') || [];
}
