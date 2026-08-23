const { assertStagingWriteTarget } = require('./stagingWriteGuard');

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const {
  MIGRATION_NAME,
  canonicalFinancialSnapshot,
  compareFinancialSnapshots,
  legacyFinancialSnapshot,
  planBillingMigration,
  publicMigrationReport,
} = require('../domain/billing/canonicalBillingMigration');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest_db';

function parseArgs(argv) {
  const args = {
    apply: false,
    archiveLegacy: false,
    confirm: '',
    help: false,
    reportPath: '',
    userId: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || '').trim();
    if (!value) continue;
    if (value === '--apply') args.apply = true;
    else if (value === '--archive-legacy') args.archiveLegacy = true;
    else if (value === '--help' || value === '-h') args.help = true;
    else if (value.startsWith('--confirm=')) args.confirm = value.slice('--confirm='.length).trim();
    else if (value === '--confirm' && argv[index + 1]) {
      args.confirm = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--user=')) args.userId = value.slice('--user='.length).trim();
    else if (value === '--user' && argv[index + 1]) {
      args.userId = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (value.startsWith('--report=')) args.reportPath = value.slice('--report='.length).trim();
    else if (value === '--report' && argv[index + 1]) {
      args.reportPath = String(argv[index + 1] || '').trim();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (args.archiveLegacy && !args.apply) {
    throw new Error('--archive-legacy is allowed only with --apply and an exact --confirm plan ID.');
  }
  if (args.apply && args.userId) {
    throw new Error('--user is dry-run only. Apply must use a full-system plan so cross-tenant identifier and PayMongo conflicts cannot be hidden.');
  }
  return args;
}

function printUsage() {
  console.log('Dry run and conflict report (default):');
  console.log('  npm run billing:migrate-to-bills -- [--user <user_id>] [--report <path>]');
  console.log('');
  console.log('Explicit apply after reviewing the exact dry-run plan:');
  console.log('  npm run billing:migrate-to-bills -- --apply --confirm <plan_id> [--archive-legacy]');
  console.log('');
  console.log('Apply is refused when any ownership, amount, status, identifier, or PayMongo conflict exists.');
  console.log('Financial fields on an existing canonical bill are never overwritten by this migration.');
}

function isInactiveLegacy(doc = {}) {
  return doc.isArchived === true
    || doc.archived === true
    || doc.isDeleted === true
    || doc.deleted === true
    || doc.isHidden === true
    || doc.hidden === true;
}

function filterInventoryForUser({ legacyDocs, canonicalDocs, users }, userId) {
  if (!userId) return { legacyDocs, canonicalDocs, users };
  const selectedUsers = users.filter((user) => String(user.user_id || '').trim() === userId);
  const ownerIds = new Set(selectedUsers.map((user) => String(user._id)));
  return {
    users: selectedUsers,
    legacyDocs: legacyDocs.filter((doc) => String(doc.user_id || '').trim() === userId),
    canonicalDocs: canonicalDocs.filter((doc) => (
      String(doc.tenantUserId || doc.user_id || '').trim() === userId
      || ownerIds.has(String(doc.userId || doc.tenantId || ''))
    )),
  };
}

function addInventoryToReport(report, inventory, eligibleLegacyDocs) {
  return {
    ...report,
    database: DB_NAME,
    mode: 'dry-run',
    inventory: {
      users: inventory.users.length,
      legacy_total: inventory.legacyDocs.length,
      legacy_eligible: eligibleLegacyDocs.length,
      legacy_inactive: inventory.legacyDocs.length - eligibleLegacyDocs.length,
      canonical_total: inventory.canonicalDocs.length,
    },
  };
}

function writeReport(reportPath, report) {
  if (!reportPath) return;
  const resolved = path.resolve(reportPath);
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(`Billing migration report written to ${resolved}`);
}

async function ensureMigrationIndex(bills) {
  await bills.createIndex(
    { 'migration.name': 1, 'migration.sourceId': 1 },
    {
      unique: true,
      partialFilterExpression: {
        'migration.name': MIGRATION_NAME,
        'migration.sourceId': { $type: 'string' },
      },
      name: 'bills_migration_source_unique',
    },
  );

  for (const [field, name] of [
    ['billing_id', 'bills_billing_id_unique'],
    ['legacyBillingId', 'bills_legacyBillingId_unique'],
    ['paymongoSessionId', 'bills_paymongoSessionId_unique'],
  ]) {
    await bills.createIndex(
      { [field]: 1 },
      {
        unique: true,
        partialFilterExpression: { [field]: { $type: 'string', $gt: '' } },
        name,
      },
    );
  }
}

async function findCanonicalForAction(bills, action) {
  if (action.existing?._id) return bills.findOne({ _id: action.existing._id });
  return bills.findOne({
    'migration.name': MIGRATION_NAME,
    'migration.sourceId': action.sourceId,
  });
}

function assertCanonicalMatchesAction(action, canonical) {
  if (!canonical) throw new Error(`Canonical bill was not persisted for source ${action.sourceId}`);
  const differences = compareFinancialSnapshots(
    legacyFinancialSnapshot(action.legacy),
    canonicalFinancialSnapshot(canonical, action.ownerUserId),
  );
  if (differences.length) {
    const error = new Error(`Post-write financial invariant failed for ${action.billingId}`);
    error.differences = differences;
    throw error;
  }
  if (String(canonical.migration?.sourceFingerprint || '') !== action.sourceFingerprint) {
    throw new Error(`Post-write source fingerprint failed for ${action.billingId}`);
  }
}

async function applyMigrationPlan(db, plan, { archiveLegacy = false } = {}) {
  if (plan.conflicts.length) throw new Error('Cannot apply a billing migration plan that contains conflicts.');
  const bills = db.collection('bills');
  const legacyBilling = db.collection('billing');
  await ensureMigrationIndex(bills);

  const result = { inserted: 0, linked: 0, unchanged: 0, archivedLegacy: 0 };
  for (const action of plan.actions) {
    if (action.type === 'insert') {
      const upsert = await bills.updateOne(
        { 'migration.name': MIGRATION_NAME, 'migration.sourceId': action.sourceId },
        { $setOnInsert: action.canonicalDocument },
        { upsert: true },
      );
      if (upsert.upsertedCount === 1 || upsert.upsertedId) result.inserted += 1;
      else result.unchanged += 1;
    } else if (action.type === 'link') {
      const update = await bills.updateOne(
        { _id: action.existing._id },
        {
          $set: {
            legacyBillingId: action.billingId,
            legacyCollection: 'billing',
            legacyCollectionId: action.legacy._id,
            tenantUserId: action.ownerUserId,
            migration: action.canonicalDocument.migration,
            migratedFromLegacyAt: action.canonicalDocument.migratedFromLegacyAt,
          },
        },
      );
      if (update.matchedCount !== 1) throw new Error(`Canonical link target disappeared for ${action.billingId}`);
      result.linked += 1;
    } else {
      result.unchanged += 1;
    }

    const canonical = await findCanonicalForAction(bills, action);
    assertCanonicalMatchesAction(action, canonical);

    if (archiveLegacy) {
      const archived = await legacyBilling.updateOne(
        { _id: action.legacy._id, isArchived: { $ne: true } },
        {
          $set: {
            isArchived: true,
            archivedAt: new Date(),
            migratedToBillsAt: new Date(),
            migratedCanonicalId: canonical._id,
            migrationPlanId: plan.planId,
          },
        },
      );
      if (archived.modifiedCount === 1) result.archivedLegacy += 1;
    }
  }
  return result;
}

async function loadInventory(db) {
  const [legacyDocs, canonicalDocs, users] = await Promise.all([
    db.collection('billing').find({}).toArray(),
    db.collection('bills').find({}).toArray(),
    db.collection('users').find({}, { projection: { _id: 1, user_id: 1 } }).toArray(),
  ]);
  return { legacyDocs, canonicalDocs, users };
}

async function run({ argv = process.argv.slice(2), clientFactory = () => new MongoClient(MONGO_URL) } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return { help: true };
  }

  const client = clientFactory();
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const fullInventory = await loadInventory(db);
    const inventory = filterInventoryForUser(fullInventory, args.userId);
    const eligibleLegacyDocs = inventory.legacyDocs.filter((doc) => !isInactiveLegacy(doc));
    const plan = planBillingMigration({
      legacyDocs: eligibleLegacyDocs,
      canonicalDocs: inventory.canonicalDocs,
      users: inventory.users,
    });
    const report = addInventoryToReport(publicMigrationReport(plan), inventory, eligibleLegacyDocs);
    report.tenant_filter = args.userId || null;

    if (!args.apply) {
      writeReport(args.reportPath, report);
      console.log(JSON.stringify(report, null, 2));
      return { report, applied: null };
    }

    if (!args.confirm || args.confirm !== plan.planId) {
      throw new Error(`Apply refused. Re-run the dry-run and pass its exact plan_id with --confirm ${plan.planId}`);
    }
    if (plan.conflicts.length) {
      throw new Error(`Apply refused: ${plan.conflicts.length} migration conflict(s) require explicit remediation.`);
    }

    const applied = await applyMigrationPlan(db, plan, { archiveLegacy: args.archiveLegacy });
    const appliedReport = { ...report, mode: 'apply', applied };
    writeReport(args.reportPath, appliedReport);
    console.log(JSON.stringify(appliedReport, null, 2));
    return { report: appliedReport, applied };
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  assertStagingWriteTarget(process.env, { toolName: 'migrateBillingToBills.js' });
  run().catch((error) => {
    console.error('[billing:migrate-to-bills] Failed:', error.message);
    if (error.differences) console.error(JSON.stringify(error.differences, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  addInventoryToReport,
  applyMigrationPlan,
  filterInventoryForUser,
  isInactiveLegacy,
  parseArgs,
  run,
};
