const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'migrateMaintenanceToPrimary.js' });

require('dotenv').config();

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest-db';
const PRIMARY_COLLECTION = 'maintenance_requests';
const LEGACY_COLLECTION = 'maintenancerequests';

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
  console.log('Usage: npm run maintenance:migrate-to-primary -- [--apply] [--archive-legacy] [--user <user_id>] [--limit <n>] [--verbose]');
  console.log('');
  console.log('Defaults to dry-run. Use --apply to upsert legacy requests into maintenance_requests.');
  console.log('Use --archive-legacy only after confirming canonical reads look correct.');
}

function asDate(value, fallback = null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value === null || value === undefined || value === '') return fallback;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
}

async function resolveTenantContext(db, legacy) {
  const context = {
    userId: asObjectId(legacy.userId),
    branch: legacy.branch || legacy.branchId || null,
    reservationId: legacy.reservationId || null,
    roomId: legacy.roomId || null,
  };

  if (!context.userId && legacy.user_id) {
    const user = await db.collection('users').findOne(
      { user_id: legacy.user_id },
      { projection: { _id: 1, branch: 1, branchId: 1 } }
    );
    if (user?._id) {
      context.userId = user._id;
      context.branch = context.branch || user.branch || user.branchId || null;
    }
  }

  return context;
}

async function buildPrimaryRequest(db, legacy, now) {
  const requestId = String(legacy.request_id || legacy._id || '').trim();
  const context = await resolveTenantContext(db, legacy);
  const createdAt = asDate(legacy.created_at || legacy.createdAt, now);
  const updatedAt = asDate(legacy.updated_at || legacy.updatedAt, now);

  return {
    ...legacy,
    _id: undefined,
    request_id: requestId,
    user_id: legacy.user_id || null,
    userId: context.userId || legacy.userId || null,
    request_type: legacy.request_type || legacy.type || 'other',
    description: legacy.description || '',
    urgency: legacy.urgency || 'normal',
    status: legacy.status || 'pending',
    branch: context.branch,
    reservationId: context.reservationId,
    roomId: context.roomId,
    attachments: Array.isArray(legacy.attachments) ? legacy.attachments : [],
    reopen_history: Array.isArray(legacy.reopen_history) ? legacy.reopen_history : [],
    statusHistory: Array.isArray(legacy.statusHistory) ? legacy.statusHistory : [],
    isArchived: legacy.isArchived === true,
    legacyCollection: LEGACY_COLLECTION,
    legacyCollectionId: legacy._id,
    migratedFromLegacyAt: now,
    created_at: createdAt,
    updated_at: updatedAt,
    createdAt,
    updatedAt,
  };
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
    missingRequestId: 0,
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
    const primary = db.collection(PRIMARY_COLLECTION);
    const legacyCollection = db.collection(LEGACY_COLLECTION);
    const now = new Date();

    const query = {
      ...(args.userId ? { user_id: args.userId } : {}),
      isArchived: { $ne: true },
    };
    const cursor = legacyCollection.find(query).sort({ created_at: 1, _id: 1 });
    if (args.limit > 0) cursor.limit(args.limit);

    while (await cursor.hasNext()) {
      const legacy = await cursor.next();
      stats.scanned += 1;

      const requestId = String(legacy.request_id || legacy._id || '').trim();
      if (!requestId) {
        stats.missingRequestId += 1;
        if (args.verbose) console.warn(`[skip] legacy _id=${legacy._id} has no request_id`);
        continue;
      }

      const normalized = await buildPrimaryRequest(db, legacy, now);
      const existing = await primary.findOne(
        { request_id: requestId },
        { projection: { _id: 1, request_id: 1 } }
      );

      if (existing) {
        stats.wouldUpdate += 1;
        if (args.apply) {
          await primary.updateOne(
            { _id: existing._id },
            {
              $set: {
                legacyCollection: LEGACY_COLLECTION,
                legacyCollectionId: legacy._id,
                migratedFromLegacyAt: now,
                updatedAt: now,
                updated_at: now,
              },
            }
          );
          stats.updated += 1;
        }
      } else {
        stats.wouldInsert += 1;
        if (args.apply) {
          delete normalized._id;
          await primary.insertOne(normalized);
          stats.inserted += 1;
        }
      }

      if (args.archiveLegacy) {
        stats.wouldArchiveLegacy += 1;
        if (args.apply) {
          await legacyCollection.updateOne(
            { _id: legacy._id },
            {
              $set: {
                isArchived: true,
                archivedAt: now,
                migratedToPrimaryAt: now,
                migratedRequestId: requestId,
              },
            }
          );
          stats.archivedLegacy += 1;
        }
      }
    }

    console.log(args.apply ? '[apply] Maintenance migration complete.' : '[dry-run] Maintenance migration preview complete.');
    console.table(stats);
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error('[maintenance:migrate-to-primary] Failed:', error);
  process.exit(1);
});
