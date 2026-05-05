require('dotenv').config();

const { MongoClient } = require('mongodb');
const {
  buildBillVisibilitySignature,
  getEffectiveBillStatus,
  getBillFreshnessTimestamp,
  getBillPreferenceScore,
  getBillTimestamp,
  isPaidBill,
  isTenantVisibleBill,
  mapRealBill,
  normalizeBillId,
} = require('../controllers/billing.controller');
const {
  fetchCheckoutSessionRecord,
  getCheckoutSessionPaymentDate,
  getCheckoutSessionPaymentState,
} = require('../controllers/paymongo.controller');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest_db';
const SCRIPT_NAME = 'reconcileBillingDuplicates';

function parseArgs(argv) {
  const args = { apply: false, help: false, userId: '', verbose: false };

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || '').trim();
    if (!value) continue;

    if (value === '--apply') {
      args.apply = true;
      continue;
    }

    if (value === '--verbose') {
      args.verbose = true;
      continue;
    }

    if (value === '--help' || value === '-h') {
      args.help = true;
      continue;
    }

    if (value.startsWith('--user=')) {
      args.userId = value.slice('--user='.length).trim();
      continue;
    }

    if (value === '--user' && argv[index + 1]) {
      args.userId = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log('Usage: npm run billing:reconcile -- [--apply] [--user <tenant_user_id>] [--verbose]');
  console.log('');
  console.log('Examples:');
  console.log('  npm run billing:reconcile');
  console.log('  npm run billing:reconcile -- --verbose');
  console.log('  npm run billing:reconcile -- --user tenant_001');
  console.log('  npm run billing:reconcile -- --user tenant_001 --apply');
}

function normalizeLegacyBill(bill = {}) {
  return { ...bill, _id: undefined, __source: 'legacy' };
}

function toSourceRank(record) {
  return record?.source === 'real' ? 1 : 0;
}

function compareBillRecords(left, right) {
  const scoreDiff = getBillPreferenceScore(right.normalized) - getBillPreferenceScore(left.normalized);
  if (scoreDiff !== 0) return scoreDiff;

  const freshnessDiff = getBillFreshnessTimestamp(right.normalized) - getBillFreshnessTimestamp(left.normalized);
  if (freshnessDiff !== 0) return freshnessDiff;

  const sourceDiff = toSourceRank(right) - toSourceRank(left);
  if (sourceDiff !== 0) return sourceDiff;

  return getBillTimestamp(right.normalized) - getBillTimestamp(left.normalized);
}

function pickPreferredRecord(records = []) {
  return [...records].sort(compareBillRecords)[0] || null;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRecordCheckoutId(record = {}) {
  if (record.source === 'real') {
    return String(record.raw?.paymongoSessionId || '').trim();
  }

  return String(record.raw?.paymongo_checkout_id || '').trim();
}

function buildRecordSummary(record) {
  return {
    source: record.source,
    documentId: String(record.mongoId),
    billingId: record.billingId,
    tenantUserId: record.tenantUserId,
    status: getEffectiveBillStatus(record.normalized) || 'unknown',
    total: record.normalized.original_total
      ?? record.normalized.gross_amount
      ?? record.normalized.total
      ?? record.normalized.amount
      ?? 0,
    remaining: record.source === 'real'
      ? record.raw.remainingAmount ?? null
      : record.raw.remaining_amount ?? null,
  };
}

function buildPaymongoSessionUpdate(record, session, now) {
  const checkoutId = getRecordCheckoutId(record) || String(session?.id || '').trim();
  const paymentState = getCheckoutSessionPaymentState(session || {});
  const paymentId = String(paymentState.payments?.[0]?.id || '').trim();
  const referenceNumber = String(session?.attributes?.reference_number || '').trim();
  const paymentDate = getCheckoutSessionPaymentDate(session) || now;

  if (record.source === 'real') {
    return {
      updatedAt: now,
      status: 'paid',
      remainingAmount: 0,
      paymentMethod: 'paymongo',
      paidAt: paymentDate,
      paymentDate,
      ...(checkoutId ? { paymongoSessionId: checkoutId } : {}),
      ...(paymentId ? { paymongoPaymentId: paymentId } : {}),
      ...(referenceNumber ? { paymongoReference: referenceNumber } : {}),
    };
  }

  return {
    updated_at: now,
    status: 'paid',
    remaining_amount: 0,
    payment_method: 'paymongo',
    payment_date: paymentDate,
    ...(checkoutId ? { paymongo_checkout_id: checkoutId } : {}),
    ...(paymentId ? { paymongo_payment_id: paymentId } : {}),
    ...(referenceNumber ? { paymongo_reference: referenceNumber } : {}),
  };
}

function buildLegacyCanonicalSync(canonical, now) {
  const update = { updated_at: now };
  const canonicalBill = canonical.normalized;
  const effectiveStatus = getEffectiveBillStatus(canonicalBill);

  if (isPaidBill(canonicalBill)) {
    update.status = effectiveStatus || 'paid';
    update.remaining_amount = 0;

    if (canonicalBill.payment_method) update.payment_method = canonicalBill.payment_method;
    if (canonicalBill.payment_date) update.payment_date = new Date(canonicalBill.payment_date);
    if (canonicalBill.paymongo_reference) update.paymongo_reference = canonicalBill.paymongo_reference;
    if (canonicalBill.paymongo_payment_id) update.paymongo_payment_id = canonicalBill.paymongo_payment_id;
  }

  return update;
}

function buildRealCanonicalSync(canonical, now) {
  const update = { updatedAt: now };
  const canonicalBill = canonical.normalized;
  const effectiveStatus = getEffectiveBillStatus(canonicalBill);

  if (isPaidBill(canonicalBill)) {
    update.status = effectiveStatus || 'paid';
    update.remainingAmount = 0;

    if (canonicalBill.payment_method) update.paymentMethod = canonicalBill.payment_method;
    if (canonicalBill.payment_date) {
      const paymentDate = new Date(canonicalBill.payment_date);
      update.paymentDate = paymentDate;
      update.paidAt = paymentDate;
    }
    if (canonicalBill.paymongo_reference) update.paymongoReference = canonicalBill.paymongo_reference;
    if (canonicalBill.paymongo_payment_id) update.paymongoPaymentId = canonicalBill.paymongo_payment_id;
  }

  return update;
}

function buildDuplicateUpdate(record, canonical, now) {
  const canonicalBill = canonical.normalized;
  const effectiveStatus = getEffectiveBillStatus(canonicalBill);
  const baseMeta = {
    duplicateOfBillingId: canonical.billingId,
    duplicateOfSource: canonical.source,
    reconciledAt: now,
    reconciledBy: SCRIPT_NAME,
    reconciliationReason: 'duplicate-billing-record',
  };

  if (record.source === 'real') {
    const update = {
      ...baseMeta,
      updatedAt: now,
      isArchived: true,
      archivedAt: record.raw.archivedAt || now,
      isHidden: true,
      hidden: true,
      hiddenAt: record.raw.hiddenAt || now,
    };

    if (isPaidBill(canonicalBill)) {
      update.status = effectiveStatus || 'paid';
      update.remainingAmount = 0;
      if (canonicalBill.payment_method) update.paymentMethod = canonicalBill.payment_method;
      if (canonicalBill.payment_date) {
        const paymentDate = new Date(canonicalBill.payment_date);
        update.paymentDate = paymentDate;
        update.paidAt = paymentDate;
      }
      if (canonicalBill.paymongo_reference) update.paymongoReference = canonicalBill.paymongo_reference;
      if (canonicalBill.paymongo_payment_id) update.paymongoPaymentId = canonicalBill.paymongo_payment_id;
    }

    return update;
  }

  const update = {
    ...baseMeta,
    updated_at: now,
    isArchived: true,
    archivedAt: record.raw.archivedAt || now,
    isHidden: true,
    hidden: true,
    hiddenAt: record.raw.hiddenAt || now,
  };

  if (isPaidBill(canonicalBill)) {
    update.status = effectiveStatus || 'paid';
    update.remaining_amount = 0;
    if (canonicalBill.payment_method) update.payment_method = canonicalBill.payment_method;
    if (canonicalBill.payment_date) update.payment_date = new Date(canonicalBill.payment_date);
    if (canonicalBill.paymongo_reference) update.paymongo_reference = canonicalBill.paymongo_reference;
    if (canonicalBill.paymongo_payment_id) update.paymongo_payment_id = canonicalBill.paymongo_payment_id;
  }

  return update;
}

function createRecordFromLegacy(doc) {
  const normalized = normalizeLegacyBill(doc);
  return {
    source: 'legacy',
    collectionName: 'billing',
    mongoId: doc._id,
    billingId: normalizeBillId(normalized),
    tenantUserId: String(doc.user_id || '').trim(),
    tenantKey: String(doc.user_id || '').trim() || `legacy:${String(doc._id)}`,
    normalized,
    raw: doc,
  };
}

function createRecordFromReal(doc, tenantUserId) {
  const normalized = { ...mapRealBill(doc, tenantUserId), __source: 'real' };
  return {
    source: 'real',
    collectionName: 'bills',
    mongoId: doc._id,
    billingId: normalizeBillId(normalized),
    tenantUserId,
    tenantKey: tenantUserId || `mongo:${String(doc.userId || '')}`,
    normalized,
    raw: doc,
  };
}

async function loadUsers(db) {
  const users = await db.collection('users')
    .find({}, { projection: { _id: 1, user_id: 1 } })
    .toArray();

  const usersByMongoId = new Map();
  const usersByUserId = new Map();

  users.forEach((user) => {
    const mongoId = String(user._id);
    const userId = String(user.user_id || '').trim();
    usersByMongoId.set(mongoId, userId);
    if (userId) usersByUserId.set(userId, user);
  });

  return { usersByMongoId, usersByUserId };
}

function planCanonicalRepairs(records = [], plans, stats) {
  records.forEach((record) => {
    if (!isPaidBill(record.normalized)) return;
    const effectiveStatus = getEffectiveBillStatus(record.normalized);

    if (record.source === 'real') {
      const needsStatusFix = String(record.raw.status || '').trim().toLowerCase() !== effectiveStatus;
      if (needsStatusFix || toFiniteNumber(record.raw.remainingAmount) !== 0) {
        plans.push({
          type: 'normalize-paid-state',
          record,
          update: buildRealCanonicalSync(record, new Date()),
        });
        stats.paidBalanceFixes += 1;
      }
      return;
    }

    const needsStatusFix = String(record.raw.status || '').trim().toLowerCase() !== effectiveStatus;
    if (needsStatusFix || toFiniteNumber(record.raw.remaining_amount) !== 0) {
      plans.push({
        type: 'normalize-paid-state',
        record,
        update: buildLegacyCanonicalSync(record, new Date()),
      });
      stats.paidBalanceFixes += 1;
    }
  });
}

function planDuplicateRepairs(records = [], plans, stats, verboseEntries) {
  const visibleRecords = records.filter((record) => isTenantVisibleBill(record.normalized));
  if (!visibleRecords.length) return;

  const groupedByBillId = new Map();
  visibleRecords.forEach((record) => {
    if (!record.billingId) return;
    if (!groupedByBillId.has(record.billingId)) groupedByBillId.set(record.billingId, []);
    groupedByBillId.get(record.billingId).push(record);
  });

  const winnersByBillId = [];

  groupedByBillId.forEach((group) => {
    const canonical = pickPreferredRecord(group);
    if (canonical) winnersByBillId.push(canonical);

    if (group.length > 1) {
      stats.sameIdDuplicateGroups += 1;
    }
  });

  const groupedBySignature = new Map();
  winnersByBillId.forEach((record) => {
    const signature = buildBillVisibilitySignature(record.normalized);
    if (!groupedBySignature.has(signature)) groupedBySignature.set(signature, []);
    groupedBySignature.get(signature).push(record);
  });

  groupedBySignature.forEach((group) => {
    if (group.length <= 1) return;

    const canonical = pickPreferredRecord(group);
    stats.signatureDuplicateGroups += 1;
    stats.duplicateRecords += group.length - 1;

    const groupSummary = {
      tenantUserId: canonical?.tenantUserId || '',
      signature: buildBillVisibilitySignature(canonical?.normalized || {}),
      canonical: buildRecordSummary(canonical),
      duplicates: [],
    };

    group.forEach((record) => {
      if (record === canonical) return;
      groupSummary.duplicates.push(buildRecordSummary(record));

      plans.push({
        type: 'archive-duplicate',
        record,
        canonical,
        update: buildDuplicateUpdate(record, canonical, new Date()),
      });
    });

    if (groupSummary.duplicates.length > 0) {
      verboseEntries.push(groupSummary);
    }
  });

  groupedByBillId.forEach((group) => {
    if (group.length <= 1) return;
    const canonical = pickPreferredRecord(group);

    group.forEach((record) => {
      if (record === canonical) return;
      stats.duplicateRecords += 1;

      plans.push({
        type: 'archive-duplicate',
        record,
        canonical,
        update: buildDuplicateUpdate(record, canonical, new Date()),
      });
    });
  });
}

async function planPaymongoSessionRepairs(records = [], plans, stats, verboseEntries) {
  const candidates = records.filter((record) => {
    if (!isTenantVisibleBill(record.normalized)) return false;
    if (isPaidBill(record.normalized)) return false;
    return Boolean(getRecordCheckoutId(record));
  });

  if (!candidates.length) return;

  const sessionCache = new Map();

  for (const record of candidates) {
    const checkoutId = getRecordCheckoutId(record);
    if (!checkoutId) continue;

    if (!sessionCache.has(checkoutId)) {
      try {
        const session = await fetchCheckoutSessionRecord(checkoutId);
        const paymentState = getCheckoutSessionPaymentState(session || {});
        sessionCache.set(checkoutId, { session, paymentState, error: null });
        stats.paymongoSessionsChecked += 1;
      } catch (error) {
        sessionCache.set(checkoutId, { session: null, paymentState: null, error });
        stats.paymongoSessionErrors += 1;
      }
    }

    const cached = sessionCache.get(checkoutId);
    if (!cached || cached.error || !cached.session || !cached.paymentState?.paymentConfirmed) {
      continue;
    }

    plans.push({
      type: 'reconcile-paymongo-session',
      record,
      update: buildPaymongoSessionUpdate(record, cached.session, new Date()),
    });
    stats.paymongoSessionFixes += 1;

    if (verboseEntries.length < 20) {
      verboseEntries.push({
        tenantUserId: record.tenantUserId,
        sessionRepair: {
          billingId: record.billingId,
          source: record.source,
          checkoutId,
          paymentStatus: cached.paymentState.paymentStatus,
        },
      });
    }
  }
}

async function applyPlan(db, plans, apply) {
  if (!apply || plans.length === 0) return { applied: 0 };

  let applied = 0;
  for (const plan of plans) {
    const collection = db.collection(plan.record.collectionName);
    const filter = { _id: plan.record.mongoId };
    const result = await collection.updateOne(filter, { $set: plan.update });
    if (result.matchedCount > 0) applied += 1;
  }

  return { applied };
}

function printPlanSummary({ stats, plans, verboseEntries, apply, userId }) {
  console.log('');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Database: ${DB_NAME}`);
  if (userId) console.log(`Tenant filter: ${userId}`);
  console.log(`Tenants scanned: ${stats.tenantsScanned}`);
  console.log(`Legacy bills scanned: ${stats.legacyBillsScanned}`);
  console.log(`Real bills scanned: ${stats.realBillsScanned}`);
  console.log(`Visible bills scanned: ${stats.visibleBillsScanned}`);
  console.log(`Duplicate groups by billing ID: ${stats.sameIdDuplicateGroups}`);
  console.log(`Duplicate groups by logical signature: ${stats.signatureDuplicateGroups}`);
  console.log(`Duplicate records to archive: ${plans.filter((plan) => plan.type === 'archive-duplicate').length}`);
  console.log(`Paid balance fixes: ${stats.paidBalanceFixes}`);
  console.log(`PayMongo sessions checked: ${stats.paymongoSessionsChecked}`);
  console.log(`PayMongo session fixes: ${stats.paymongoSessionFixes}`);
  console.log(`PayMongo session check errors: ${stats.paymongoSessionErrors}`);

  if (verboseEntries.length > 0) {
    console.log('');
    console.log('Sample reconciliation entries:');
    verboseEntries.slice(0, 20).forEach((entry, index) => {
      if (entry.sessionRepair) {
        console.log(`  ${index + 1}. tenant=${entry.tenantUserId || 'unknown'} bill=${entry.sessionRepair.billingId} (${entry.sessionRepair.source}) checkout=${entry.sessionRepair.checkoutId} status=${entry.sessionRepair.paymentStatus}`);
        return;
      }
      console.log(`  ${index + 1}. tenant=${entry.tenantUserId || 'unknown'} canonical=${entry.canonical.billingId} (${entry.canonical.source}/${entry.canonical.status})`);
      entry.duplicates.forEach((duplicate) => {
        console.log(`     duplicate=${duplicate.billingId} (${duplicate.source}/${duplicate.status}) remaining=${duplicate.remaining ?? 'n/a'}`);
      });
    });
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const client = new MongoClient(MONGO_URL);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const { usersByMongoId, usersByUserId } = await loadUsers(db);

    if (args.userId && !usersByUserId.has(args.userId)) {
      console.error(`User ${args.userId} was not found.`);
      process.exitCode = 1;
      return;
    }

    const legacyQuery = args.userId ? { user_id: args.userId } : {};
    const realQuery = {};

    if (args.userId) {
      realQuery.userId = usersByUserId.get(args.userId)._id;
    }

    const [legacyDocs, realDocs] = await Promise.all([
      db.collection('billing').find(legacyQuery).toArray(),
      db.collection('bills').find(realQuery).toArray(),
    ]);

    const records = [
      ...legacyDocs.map(createRecordFromLegacy),
      ...realDocs.map((doc) => createRecordFromReal(doc, usersByMongoId.get(String(doc.userId)) || '')),
    ];

    const recordsByTenant = new Map();
    records.forEach((record) => {
      if (!recordsByTenant.has(record.tenantKey)) recordsByTenant.set(record.tenantKey, []);
      recordsByTenant.get(record.tenantKey).push(record);
    });

    const plans = [];
    const verboseEntries = [];
    const stats = {
      tenantsScanned: recordsByTenant.size,
      legacyBillsScanned: legacyDocs.length,
      realBillsScanned: realDocs.length,
      visibleBillsScanned: records.filter((record) => isTenantVisibleBill(record.normalized)).length,
      sameIdDuplicateGroups: 0,
      signatureDuplicateGroups: 0,
      duplicateRecords: 0,
      paidBalanceFixes: 0,
      paymongoSessionsChecked: 0,
      paymongoSessionFixes: 0,
      paymongoSessionErrors: 0,
    };

    planCanonicalRepairs(records, plans, stats);
    await planPaymongoSessionRepairs(records, plans, stats, verboseEntries);

    recordsByTenant.forEach((tenantRecords) => {
      planDuplicateRepairs(tenantRecords, plans, stats, verboseEntries);
    });

    const dedupedPlans = new Map();
    plans.forEach((plan) => {
      const key = `${plan.record.collectionName}:${String(plan.record.mongoId)}`;
      const existing = dedupedPlans.get(key);

      if (!existing) {
        dedupedPlans.set(key, plan);
        return;
      }

      if (plan.type === 'archive-duplicate') {
        dedupedPlans.set(key, plan);
        return;
      }

      const mergedUpdate = { ...existing.update, ...plan.update };
      dedupedPlans.set(key, { ...existing, update: mergedUpdate });
    });

    const finalPlans = Array.from(dedupedPlans.values());
    printPlanSummary({
      stats,
      plans: finalPlans,
      verboseEntries: args.verbose ? verboseEntries : [],
      apply: args.apply,
      userId: args.userId,
    });

    const result = await applyPlan(db, finalPlans, args.apply);

    if (args.apply) {
      console.log('');
      console.log(`Applied updates: ${result.applied}`);
    } else {
      console.log('');
      console.log('No database changes were written. Re-run with --apply to persist the reconciliation.');
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('Billing reconciliation failed:', error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  run,
};
