#!/usr/bin/env node
'use strict';

// One-time compatibility backfill for the tenant mobile app guide.
//
// The mobile app now decides whether to auto-show the "Manual Guide" using
// the server-side field `tenant_onboarding_seen_at` instead of on-device
// storage. That field does not exist on any pre-existing user document, so
// without this backfill every already-active tenant/resident would look
// like a brand-new tenant the next time they log in and be shown the guide
// again. This script grandfathers every account that is ALREADY an active
// tenant at run time by stamping `tenant_onboarding_seen_at`, so only
// accounts that become active tenants after this runs are treated as
// first-time tenants.
//
// Safe to re-run in --dry-run mode any time — it never writes. A real
// (--confirm) run, however, is intended to execute exactly ONCE: it refuses
// to run a second time (see the priorRun guard below) unless explicitly
// forced, because "now" is what this script treats as the grandfather
// cutover. A second real run at a later date would otherwise sweep up any
// active tenant who simply had not logged in yet — a genuinely new tenant —
// and wrongly grandfather them out of their first-time guide.
//
// Usage:
//   node backend/scripts/backfillTenantOnboardingSeen.js
//   node backend/scripts/backfillTenantOnboardingSeen.js --confirm
//   node backend/scripts/backfillTenantOnboardingSeen.js --confirm --force-rerun   (see warning above)

require('dotenv').config();
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { isTenantMobileRole, isAccountActive } = require('../utils/tenantEligibility');

const AUDIT_ACTION = 'tenant_onboarding_seen_backfill';

async function run({ dryRun = true, forceRerun = false } = {}) {
  const db = getDb();
  const users = db.collection('users');
  const auditLogs = db.collection('audit_logs');
  const seenAt = new Date();

  if (!dryRun && !forceRerun) {
    const priorRun = await auditLogs.findOne({ action: AUDIT_ACTION });
    if (priorRun) {
      throw new Error(
        `This backfill already ran on ${new Date(priorRun.created_at || priorRun.seen_at).toISOString()} `
        + '(grandfathering the active tenants at that time). Running it again would incorrectly grandfather '
        + 'any tenant who became active after that cutover and simply has not logged in yet, robbing them of '
        + 'their real first-time guide. Pass forceRerun (or --force-rerun on the CLI) only if you have '
        + 'independently confirmed every newly-matched account is not a genuinely new tenant.',
      );
    }
  }

  const cursor = users.find(
    { tenant_onboarding_seen_at: { $exists: false } },
    { projection: { _id: 1, user_id: 1, role: 1, status: 1, account_status: 1, is_active: 1, isActive: 1, disabled: 1, is_disabled: 1, deleted_at: 1, deletedAt: 1, is_deleted: 1, isDeleted: 1 } },
  );

  let scanned = 0;
  let eligible = 0;
  let modified = 0;
  while (await cursor.hasNext()) {
    const user = await cursor.next();
    scanned += 1;
    if (!isTenantMobileRole(user.role) || !isAccountActive(user)) continue;
    eligible += 1;
    if (!dryRun) {
      const result = await users.updateOne(
        { _id: user._id, tenant_onboarding_seen_at: { $exists: false } },
        { $set: { tenant_onboarding_seen_at: seenAt } },
      );
      modified += result.modifiedCount || 0;
    }
  }
  const skipped = scanned - eligible;

  if (!dryRun && eligible > 0) {
    // Not swallowed on failure: this record is what the priorRun guard above
    // relies on to block an accidental second real run, so a failed write
    // here must surface as a script failure, not a silent gap in that guard.
    await auditLogs.insertOne({
      action: AUDIT_ACTION,
      reason: 'Grandfather existing active tenants ahead of server-authoritative mobile app guide rollout',
      scanned,
      eligible,
      modified,
      skipped,
      seen_at: seenAt,
      created_at: seenAt,
    });
  }

  return { scanned, eligible, modified, skipped };
}

module.exports = { run };

if (require.main === module) {
  const dryRun = !process.argv.includes('--confirm');
  const forceRerun = process.argv.includes('--force-rerun');
  (async () => {
    await connectToMongo();
    const { scanned, eligible, modified, skipped } = await run({ dryRun, forceRerun });
    console.log(
      `Scanned ${scanned} user(s) without tenant_onboarding_seen_at | `
      + `matched (active tenant/resident): ${eligible} | `
      + `${dryRun ? 'would modify' : 'modified'}: ${dryRun ? eligible : modified} | `
      + `skipped (not an active tenant/resident): ${skipped}.`
      + (dryRun ? ' Re-run with --confirm to apply.' : ''),
    );
  })()
    .catch((error) => {
      console.error(`Backfill failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => closeConnection().catch((error) => console.error(`Close failed: ${error.message}`)));
}
