#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'createBranchIndexes.js' });

'use strict';

require('dotenv').config();
const path = require('node:path');
const { ObjectId } = require('mongodb');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { analyzeBranchIndexSafety } = require('../migrations/branchMigration');
const { assertWriteGates, buildAuditRecord } = require('../migrations/migrationSafety');
const { parseCliArgs, writeJson } = require('../migrations/reportUtils');

async function run(options = parseCliArgs(process.argv.slice(2))) {
  const dryRun = options.dryRun === true;
  const migrationBatchId = options.batchId || `branch-indexes-${new Date().toISOString().slice(0, 10)}`;
  if (!dryRun) {
    assertWriteGates({
      confirm: options.confirm === true,
      actorId: options.actorId,
      actorName: options.actorName,
      approvalReference: options.approvalReference,
      backupReference: options.backupReference,
      migrationBatchId,
    });
    if (!ObjectId.isValid(String(options.actorId))) throw new Error('actorId must be a valid administrator ObjectId.');
  }

  await connectToMongo();
  const db = getDb();
  const collection = db.collection('branches');
  const branches = await collection.find({}, { projection: { branchId: 1, slug: 1 } }).toArray();
  let existingIndexes;
  try { existingIndexes = await collection.indexes(); } catch (_) { existingIndexes = []; }
  const analysis = analyzeBranchIndexSafety(branches, existingIndexes);
  const report = {
    mode: dryRun ? 'dry-run' : 'apply',
    migrationBatchId,
    generatedAt: new Date().toISOString(),
    branchRecordsScanned: branches.length,
    ...analysis,
    writesPerformed: false,
  };

  if (!dryRun) {
    if (!analysis.safeToCreate) throw new Error('Branch index creation blocked by duplicate branchId or slug values.');
    const beforeNames = new Set(existingIndexes.map((index) => index.name));
    for (const index of analysis.requiredIndexes) {
      await collection.createIndex(index.key, { name: index.name, unique: index.unique });
    }
    const afterIndexes = await collection.indexes();
    const createdNames = afterIndexes.map((index) => index.name).filter((name) => !beforeNames.has(name));
    await db.collection('auditLogs').insertOne(buildAuditRecord({
      action: 'CANONICAL_BRANCH_INDEXES_CREATE',
      actorId: options.actorId,
      actorName: options.actorName,
      approvalReference: options.approvalReference,
      migrationBatchId,
      environment: process.env.NODE_ENV || 'development',
      targetCollection: 'branches',
      affectedRecordIds: [],
      before: existingIndexes.map(({ name, key, unique }) => ({ name, key, unique: Boolean(unique) })),
      after: afterIndexes.map(({ name, key, unique }) => ({ name, key, unique: Boolean(unique) })),
    }));
    report.writesPerformed = true;
    report.createdIndexNames = createdNames;
    report.verifiedIndexes = afterIndexes.map(({ name, key, unique }) => ({ name, key, unique: Boolean(unique) }));
  }

  const output = path.resolve(options.output || path.join('reports', 'phase2a-stage1', 'branch-indexes-dry-run.json'));
  writeJson(output, report);
  console.log(JSON.stringify({ report: output, ...report }, null, 2));
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Branch index operation failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { run };
