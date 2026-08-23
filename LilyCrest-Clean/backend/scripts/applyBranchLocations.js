#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'applyBranchLocations.js' });

'use strict';

require('dotenv').config();
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { BRANCH_LOCATION_RECORDS } = require('../config/branchLocationRecords');

async function run({ confirm = process.argv.includes('--confirm') } = {}) {
  await connectToMongo();
  const db = getDb();
  const results = [];
  for (const location of BRANCH_LOCATION_RECORDS) {
    const existing = await db.collection('branches').findOne({
      $or: [{ branchCode: location.branchCode }, { slug: location.branchCode }],
    });
    if (!existing) {
      results.push({ branchCode: location.branchCode, status: 'BLOCKED_MISSING_CANONICAL_BRANCH' });
      continue;
    }
    if (!confirm) {
      results.push({ branchCode: location.branchCode, status: 'DRY_RUN_READY', branchId: existing.branchId });
      continue;
    }
    await db.collection('branches').updateOne(
      { _id: existing._id },
      { $set: { ...location, updatedAt: new Date() } },
    );
    results.push({ branchCode: location.branchCode, status: 'UPDATED', branchId: existing.branchId });
  }
  console.log(JSON.stringify({ mode: confirm ? 'apply' : 'dry-run', results }, null, 2));
  return results;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Branch location update failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { run };
