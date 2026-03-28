const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { buildBrandedPdf, esc } = require('../utils/pdfBuilder');

function normalizeLine(line) {
  if (!line) return '';
  return String(line)
    .replace(/•/g, '-')
    .replace(/₱/g, 'PHP ')
    .replace(/✓/g, 'Yes')
    .replace(/[\u2013\u2014]/g, '-')
    .trimEnd();
}

// Get the most recent bill for the user (by due date, fallback to created_at)
async function getLatestBilling(req, res) {
  try {
    const db = getDb();
    const cursor = db.collection('billing')
      .find({ user_id: req.user.user_id })
      .sort({ due_date: -1, created_at: -1 })
      .limit(1);

    const latest = await cursor.next();
    if (!latest) {
      return res.status(404).json({ detail: 'No billing found' });
    }

    res.json({ ...latest, _id: undefined });
  } catch (error) {
    console.error('Get latest billing error:', error);
    res.status(500).json({ detail: 'Failed to fetch latest billing' });
  }
}

// Get user's billing
async function getMyBilling(req, res) {
  try {
    const db = getDb();
    const bills = await db.collection('billing')
      .find({ user_id: req.user.user_id })
      .sort({ due_date: -1 })
      .toArray();
    res.json(bills.map(b => ({ ...b, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch billing' });
  }
}

// Get paid history
async function getPaymentHistory(req, res) {
  try {
    const db = getDb();
    const bills = await db.collection('billing')
      .find({ user_id: req.user.user_id, status: 'paid' })
      .sort({ payment_date: -1 })
      .toArray();
    res.json(bills.map((b) => ({ ...b, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch payment history' });
  }
}

// Create billing (supports both simple and consolidated/itemized bills)
async function createBilling(req, res) {
  try {
    const {
      amount, description, billing_type, due_date,
      billing_period, release_date,
      rent, electricity, water, penalties,
      items,                    // [{label, amount, type}]
      electricity_breakdown,    // [{period_start, period_end, reading_from, reading_to, consumption, rate, segment_total, active_tenants, share_per_tenant}]
      water_breakdown,          // {reading_from, reading_to, consumption, rate, total, sharing_policy}
    } = req.body;

    // Auto-compute total from itemized fields if not given
    const computedTotal = (Number(rent) || 0) + (Number(electricity) || 0)
      + (Number(water) || 0) + (Number(penalties) || 0)
      + (Array.isArray(items) ? items.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0);
    const total = Number(amount) || computedTotal || 0;

    const newBill = {
      billing_id: `bill_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
      user_id: req.user.user_id,
      amount: total,
      total,
      description,
      billing_type: billing_type || (rent ? 'consolidated' : 'rent'),
      due_date: new Date(due_date),
      status: 'pending',
      payment_method: null,
      payment_date: null,
      proof: null,
      created_at: new Date(),
    };

    // Optional consolidated fields
    if (billing_period) newBill.billing_period = billing_period;
    if (release_date) newBill.release_date = new Date(release_date);
    if (rent != null) newBill.rent = Number(rent);
    if (electricity != null) newBill.electricity = Number(electricity);
    if (water != null) newBill.water = Number(water);
    if (penalties != null) newBill.penalties = Number(penalties);
    if (Array.isArray(items) && items.length) newBill.items = items;
    if (Array.isArray(electricity_breakdown) && electricity_breakdown.length) newBill.electricity_breakdown = electricity_breakdown;
    if (water_breakdown && typeof water_breakdown === 'object') newBill.water_breakdown = water_breakdown;

    const db = getDb();
    await db.collection('billing').insertOne(newBill);
    res.status(201).json({ ...newBill, _id: undefined });
  } catch (error) {
    console.error('Create billing error:', error);
    res.status(500).json({ detail: 'Failed to create bill' });
  }
}

// Update billing (e.g., mark paid, set payment details, add itemized charges)
async function updateBilling(req, res) {
  try {
    const { billingId } = req.params;
    const {
      status,
      payment_method,
      payment_date,
      notes,
      // Itemized charge fields
      billing_period, release_date, description,
      rent, electricity, water, penalties,
      items, electricity_breakdown, water_breakdown,
      amount, total,
    } = req.body || {};

    const updates = {};
    if (status) updates.status = status;
    if (payment_method) updates.payment_method = payment_method;
    if (payment_date) updates.payment_date = new Date(payment_date);
    if (notes) updates.notes = notes;
    if (description) updates.description = description;
    if (billing_period) updates.billing_period = billing_period;
    if (release_date) updates.release_date = new Date(release_date);

    // Itemized charges
    if (rent != null) updates.rent = Number(rent);
    if (electricity != null) updates.electricity = Number(electricity);
    if (water != null) updates.water = Number(water);
    if (penalties != null) updates.penalties = Number(penalties);
    if (Array.isArray(items)) updates.items = items;
    if (Array.isArray(electricity_breakdown)) updates.electricity_breakdown = electricity_breakdown;
    if (water_breakdown && typeof water_breakdown === 'object') updates.water_breakdown = water_breakdown;

    // Recompute total if itemized fields were updated
    if (rent != null || electricity != null || water != null || penalties != null) {
      const db = getDb();
      const existing = await db.collection('billing').findOne({ billing_id: billingId, user_id: req.user.user_id });
      if (!existing) return res.status(404).json({ detail: 'Bill not found' });
      const r = updates.rent ?? existing.rent ?? 0;
      const e = updates.electricity ?? existing.electricity ?? 0;
      const w = updates.water ?? existing.water ?? 0;
      const p = updates.penalties ?? existing.penalties ?? 0;
      const extraItems = updates.items ?? existing.items ?? [];
      const itemsTotal = Array.isArray(extraItems) ? extraItems.reduce((s, i) => s + (Number(i.amount) || 0), 0) : 0;
      const computed = Number(r) + Number(e) + Number(w) + Number(p) + itemsTotal;
      updates.total = computed;
      updates.amount = computed;
    } else if (amount != null || total != null) {
      if (total != null) { updates.total = Number(total); updates.amount = Number(total); }
      else if (amount != null) { updates.amount = Number(amount); updates.total = Number(amount); }
    }

    updates.updated_at = new Date();

    const db = getDb();
    const result = await db.collection('billing').findOneAndUpdate(
      { billing_id: billingId, user_id: req.user.user_id },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    res.json({ ...result.value, _id: undefined });
  } catch (error) {
    console.error('Update billing error:', error);
    res.status(500).json({ detail: 'Failed to update bill' });
  }
}

// Branded PDF download for a bill
async function downloadBillPdf(req, res) {
  try {
    const { billingId } = req.params;
    const db = getDb();
    const bill = await db.collection('billing').findOne({ billing_id: billingId, user_id: req.user.user_id });

    if (!bill) {
      return res.status(404).json({ detail: 'Bill not found' });
    }

    const formatMoney = (value) => `PHP ${(Number(value || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const formatDate = (value) => {
      if (!value) return '---';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '---';
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const shortDate = (value) => {
      if (!value) return '---';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '---';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // Info rows
    const infoRows = [
      { label: 'Tenant', value: normalizeLine(req.user?.name || 'Tenant') },
      { label: 'Email', value: normalizeLine(req.user?.email || '---') },
      { label: 'Status', value: (bill.status || 'pending').toUpperCase() },
    ];
    if (bill.billing_period) {
      infoRows.push({ label: 'Billing Period', value: normalizeLine(bill.billing_period) });
    }
    if (bill.release_date) {
      infoRows.push({ label: 'Release Date', value: formatDate(bill.release_date) });
    }
    infoRows.push({ label: 'Due Date', value: formatDate(bill.due_date) });

    // Payment info (only for paid bills)
    if (bill.status === 'paid') {
      if (bill.payment_method) {
        infoRows.push({ label: 'Payment Method', value: bill.payment_method === 'paymongo' ? 'PayMongo' : normalizeLine(bill.payment_method) });
      }
      if (bill.payment_date) {
        infoRows.push({ label: 'Payment Date', value: formatDate(bill.payment_date) });
      }
      if (bill.paymongo_reference) {
        infoRows.push({ label: 'Reference No.', value: normalizeLine(bill.paymongo_reference) });
      }
    }

    // Charge breakdown table
    const tableRows = [];
    if (bill.rent) tableRows.push({ label: 'Monthly Rent', value: formatMoney(bill.rent) });
    if (bill.electricity) tableRows.push({ label: 'Electricity', value: formatMoney(bill.electricity) });
    if (bill.water) tableRows.push({ label: 'Water', value: formatMoney(bill.water) });
    if (bill.penalties) tableRows.push({ label: 'Penalties / Late Fees', value: formatMoney(bill.penalties) });
    if (bill.items?.length) {
      bill.items.forEach((item) => {
        tableRows.push({ label: normalizeLine(item.label || item.description || 'Charge'), value: formatMoney(item.amount) });
      });
    }
    if (tableRows.length === 0) {
      tableRows.push({ label: 'Total Charges', value: formatMoney(bill.total || bill.amount || 0) });
    }

    // Auto-generate electricity breakdown for presentation if missing
    if (
      (!bill.electricity_breakdown || !bill.electricity_breakdown.length) &&
      ((bill.billing_type || '').toLowerCase() === 'electricity' || (bill.electricity && !bill.rent && !bill.water))
    ) {
      const elecAmount = bill.electricity || bill.total || bill.amount || 0;
      const rate = 16;
      const occupants = 4;
      const segTotal = elecAmount * occupants;
      const consumption = segTotal / rate;
      const baseReading = 1016.61;
      // Default to 15th-to-15th reading period
      const dueDate = bill.due_date ? new Date(bill.due_date) : new Date();
      const readingEnd = new Date(dueDate);
      readingEnd.setDate(15);
      const readingStart = new Date(readingEnd);
      readingStart.setMonth(readingStart.getMonth() - 1);
      bill.electricity_breakdown = [{
        occupants,
        reading_date_from: shortDate(bill.period_start || readingStart),
        reading_date_to: shortDate(bill.period_end || readingEnd),
        reading_from: baseReading,
        reading_to: +(baseReading + consumption).toFixed(2),
        consumption: +consumption.toFixed(2),
        rate,
        segment_total: +segTotal.toFixed(2),
        share_per_tenant: +elecAmount.toFixed(2),
      }];
    }

    // Auto-generate water breakdown for presentation if missing
    if (
      !bill.water_breakdown &&
      ((bill.billing_type || '').toLowerCase() === 'water' || (bill.water && !bill.rent && !bill.electricity))
    ) {
      const waterAmount = bill.water || bill.total || bill.amount || 0;
      const rate = 50;
      const consumption = waterAmount / rate;
      const baseReading = 15;
      bill.water_breakdown = {
        reading_from: baseReading,
        reading_to: +(baseReading + consumption).toFixed(1),
        consumption: +consumption.toFixed(1),
        rate,
        total: waterAmount,
        sharing_policy: 'Equal division among active tenants',
      };
    }

    // Computation breakdown sections
    const breakdownSections = [];
    if (bill.electricity_breakdown?.length) {
      breakdownSections.push({
        heading: 'Electricity Breakdown',
        type: 'electricity',
        segments: bill.electricity_breakdown.map((seg) => {
          const occupants = seg.occupants || seg.active_tenants?.length || 1;
          const consumption = seg.consumption ?? ((seg.reading_to || 0) - (seg.reading_from || 0));
          return {
            occupants,
            reading_date_from: shortDate(seg.reading_date_from || seg.period_start),
            reading_date_to: shortDate(seg.reading_date_to || seg.period_end),
            reading_from: seg.reading_from || 0,
            reading_to: seg.reading_to || 0,
            consumption: consumption.toFixed(2),
            rate: seg.rate || 0,
            share_per_tenant: formatMoney(seg.share_per_tenant || 0),
          };
        }),
      });
    }
    if (bill.water_breakdown) {
      const wb = bill.water_breakdown;
      const waterRows = [
        { label: 'Meter Reading', value: `${wb.reading_from || 0} -> ${wb.reading_to || 0}` },
        { label: 'Consumption', value: `${wb.consumption || 0} cu.m` },
        { label: 'Rate', value: `PHP ${wb.rate || 0}/cu.m` },
        { label: 'Total', value: formatMoney(wb.total || 0) },
      ];
      if (wb.sharing_policy) {
        waterRows.push({ label: 'Policy', value: normalizeLine(wb.sharing_policy) });
      }
      breakdownSections.push({
        heading: 'Water Computation Breakdown',
        type: 'water',
        segments: [{ rows: waterRows }],
      });
    }

    const refId = normalizeLine(bill.reference_no || bill.reference || bill.paymongo_reference || bill.txn_id || bill.transaction_id || billingId);
    const billingPeriod = bill.billing_period
      ? `Billing Period: ${bill.billing_period}`
      : `Billing Period: ${formatDate(bill.created_at)} - ${formatDate(bill.due_date)}`;

    const pdfBuffer = buildBrandedPdf({
      title: normalizeLine(bill.description || 'Billing Statement'),
      subtitle: billingPeriod,
      docType: 'BILLING STATEMENT',
      refNumber: refId,
      date: `Released: ${formatDate(bill.release_date || bill.created_at)}`,
      infoRows,
      tableRows,
      totalRow: { label: 'TOTAL AMOUNT DUE', value: formatMoney(bill.total || bill.amount || 0) },
      breakdownSections,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${billingId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Download bill PDF error:', error);
    res.status(500).json({ detail: 'Failed to generate bill PDF' });
  }
}


module.exports = {
  getLatestBilling,
  getMyBilling,
  getPaymentHistory,
  createBilling,
  updateBilling,
  downloadBillPdf
};
