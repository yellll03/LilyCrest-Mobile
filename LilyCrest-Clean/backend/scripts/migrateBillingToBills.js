require('dotenv').config();

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest-db';

function parseArgs(argv) {
  const args = {
    apply: false,
    archiveLegacy: false,
    help: false,
    limit: 0,
    userId: '',
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || '').trim();
    if (!value) continue;

    if (value === '--apply') args.apply = true;
    else if (value === '--archive-legacy') args.archiveLegacy = true;
    else if (value === '--verbose') args.verbose = true;
    else if (value === '--help' || value === '-h') args.help = true;
    else if (value.startsWith('--user=')) args.userId = value.slice('--user='.length).trim();
    else if (value === '--user' && argv[index + 1]) {
      args.userId = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--limit=')) {
      args.limit = Number.parseInt(value.slice('--limit='.length), 10) || 0;
    } else if (value === '--limit' && argv[index + 1]) {
      args.limit = Number.parseInt(String(argv[index + 1]), 10) || 0;
      index += 1;
    }
  }

  return args;
}

function printUsage() {
  console.log('Usage: npm run billing:migrate-to-bills -- [--apply] [--archive-legacy] [--user <user_id>] [--limit <n>] [--verbose]');
  console.log('');
  console.log('Defaults to dry-run. Use --apply to write canonical bills records.');
  console.log('Use --archive-legacy only after confirming canonical reads look correct.');
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDate(value, fallback = null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value === null || value === undefined || value === '') return fallback;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function statusIsPaid(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'paid' || normalized === 'settled';
}

function buildCharges(legacy = {}) {
  return {
    rent: toFiniteNumber(legacy.rent),
    electricity: toFiniteNumber(legacy.electricity),
    water: toFiniteNumber(legacy.water),
    penalty: toFiniteNumber(legacy.penalties ?? legacy.penalty),
    applianceFees: 0,
    corkageFees: 0,
  };
}

function buildCanonicalBill(legacy, userObjectId, now) {
  const billingId = String(legacy.billing_id || '').trim();
  const charges = buildCharges(legacy);
  const itemTotal = Array.isArray(legacy.items)
    ? legacy.items.reduce((sum, item) => sum + toFiniteNumber(item?.amount), 0)
    : 0;
  const computedTotal = Object.values(charges).reduce((sum, value) => sum + toFiniteNumber(value), 0) + itemTotal;
  const grossAmount = toFiniteNumber(legacy.gross_amount ?? legacy.original_total ?? legacy.total ?? legacy.amount, computedTotal);
  const paid = statusIsPaid(legacy.status);
  const remainingAmount = paid ? 0 : toFiniteNumber(legacy.remaining_amount ?? legacy.balance ?? grossAmount, grossAmount);
  const paymentDate = asDate(legacy.payment_date || legacy.paidAt || legacy.paymentDate, null);
  const createdAt = asDate(legacy.created_at || legacy.createdAt, now);
  const updatedAt = asDate(legacy.updated_at || legacy.updatedAt, now);

  return {
    billing_id: billingId,
    legacyBillingId: billingId,
    legacyCollection: 'billing',
    legacyCollectionId: legacy._id,
    userId: userObjectId,
    billingMonth: legacy.billing_period || legacy.billingMonth || legacy.description || null,
    billingCycleStart: asDate(legacy.release_date || legacy.releaseDate || createdAt, createdAt),
    dueDate: asDate(legacy.due_date || legacy.dueDate, null),
    description: legacy.description || legacy.billing_period || 'Billing Statement',
    status: paid ? 'paid' : (legacy.status || 'pending'),
    charges,
    additionalCharges: Array.isArray(legacy.items) ? legacy.items : [],
    rent: charges.rent,
    electricity: charges.electricity,
    water: charges.water,
    penalties: charges.penalty,
    totalAmount: grossAmount,
    grossAmount,
    remainingAmount,
    paymentMethod: legacy.payment_method || null,
    paymentDate,
    paidAt: paid ? paymentDate || updatedAt : null,
    paymongoReference: legacy.paymongo_reference || legacy.reference_no || legacy.reference || null,
    paymongoSessionId: legacy.paymongo_checkout_id || null,
    paymongoPaymentId: legacy.paymongo_payment_id || null,
    electricity_breakdown: Array.isArray(legacy.electricity_breakdown) ? legacy.electricity_breakdown : [],
    water_breakdown: legacy.water_breakdown && typeof legacy.water_breakdown === 'object' ? legacy.water_breakdown : null,
    notes: legacy.notes || null,
    isArchived: legacy.isArchived === true,
    isHidden: legacy.isHidden === true,
    isDeleted: legacy.isDeleted === true,
    migratedFromLegacyAt: now,
    createdAt,
    updatedAt,
  };
}

async function findExistingCanonical(bills, legacyBillingId, userObjectId) {
  const query = {
    userId: userObjectId,
    $or: [
      { billing_id: legacyBillingId },
      { legacyBillingId },
    ],
  };

  return bills.findOne(query, { projection: { _id: 1, billing_id: 1, legacyBillingId: 1 } });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const client = new MongoClient(MONGO_URL);
  const stats = {
    scanned: 0,
    missingBillingId: 0,
    missingUser: 0,
    wouldInsert: 0,
    inserted: 0,
    wouldUpdate: 0,
    updated: 0,
    wouldArchiveLegacy: 0,
    archivedLegacy: 0,
  };

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const legacyBilling = db.collection('billing');
    const bills = db.collection('bills');
    const users = db.collection('users');
    const now = new Date();

    const query = {
      ...(args.userId ? { user_id: args.userId } : {}),
      isArchived: { $ne: true },
      isDeleted: { $ne: true },
      hidden: { $ne: true },
      isHidden: { $ne: true },
    };
    const cursor = legacyBilling.find(query).sort({ created_at: 1, _id: 1 });
    if (args.limit > 0) cursor.limit(args.limit);

    while (await cursor.hasNext()) {
      const legacy = await cursor.next();
      stats.scanned += 1;

      const legacyBillingId = String(legacy.billing_id || '').trim();
      if (!legacyBillingId) {
        stats.missingBillingId += 1;
        if (args.verbose) console.warn(`[skip] legacy _id=${legacy._id} has no billing_id`);
        continue;
      }

      const user = await users.findOne(
        { user_id: legacy.user_id },
        { projection: { _id: 1, user_id: 1 } }
      );
      if (!user?._id) {
        stats.missingUser += 1;
        if (args.verbose) console.warn(`[skip] ${legacyBillingId} user not found: ${legacy.user_id}`);
        continue;
      }

      const canonical = buildCanonicalBill(legacy, user._id, now);
      const existing = await findExistingCanonical(bills, legacyBillingId, user._id);
      if (existing) {
        stats.wouldUpdate += 1;
        if (args.apply) {
          await bills.updateOne(
            { _id: existing._id },
            {
              $set: {
                billing_id: canonical.billing_id,
                legacyBillingId: canonical.legacyBillingId,
                legacyCollection: canonical.legacyCollection,
                legacyCollectionId: canonical.legacyCollectionId,
                migratedFromLegacyAt: canonical.migratedFromLegacyAt,
                updatedAt: now,
              },
            }
          );
          stats.updated += 1;
        }
      } else {
        stats.wouldInsert += 1;
        if (args.apply) {
          await bills.insertOne(canonical);
          stats.inserted += 1;
        }
      }

      if (args.archiveLegacy) {
        stats.wouldArchiveLegacy += 1;
        if (args.apply) {
          await legacyBilling.updateOne(
            { _id: legacy._id },
            {
              $set: {
                isArchived: true,
                archivedAt: now,
                migratedToBillsAt: now,
                migratedBillingId: legacyBillingId,
              },
            }
          );
          stats.archivedLegacy += 1;
        }
      }
    }

    console.log(args.apply ? '[apply] Billing migration complete.' : '[dry-run] Billing migration preview complete.');
    console.table(stats);
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error('[billing:migrate-to-bills] Failed:', error);
  process.exit(1);
});
