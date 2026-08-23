#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'approveIdentityCrosswalk.js' });

'use strict';

require('dotenv').config();
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { approveIdentityResolution } = require('../migrations/identityApproval');
const { parseCliArgs } = require('../migrations/reportUtils');

async function run(options = parseCliArgs(process.argv.slice(2))) {
  await connectToMongo();
  const result = await approveIdentityResolution(getDb(), {
    ...options,
    sourceCollection: options.sourceCollection,
    sourceRecordId: options.sourceRecordId,
    selectedUserId: options.selectedUserId,
    administrator: options.administrator,
    approvalReference: options.approvalReference,
    reason: options.reason,
    backupReference: options.backupReference,
    migrationBatchId: options.batchId,
    expectedSourceHash: options.expectedSourceHash,
    evidenceType: options.evidenceType,
    evidenceReference: options.evidenceReference,
    confirm: options.confirm === true,
    allowInactive: options.allowInactive === true,
  });
  console.log(JSON.stringify({ approved: true, ...result }, null, 2));
  return result;
}

if (require.main === module) {
  const options = parseCliArgs(process.argv.slice(2));
  // Validate before opening a production connection whenever possible.
  const { validateManualResolutionInput } = require('../migrations/identityReview');
  try {
    validateManualResolutionInput({
      ...options,
      migrationBatchId: options.batchId,
      confirm: options.confirm === true,
    });
  } catch (error) {
    console.error(`Identity approval failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  run(options).catch((error) => {
    console.error(`Identity approval failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { run };
