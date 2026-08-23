#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'seedCanonicalBranches.js' });

'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { BranchRepository } = require('../repositories/branchRepository');
const { inspectBranchLikeValues, analyzeBranchSeed } = require('../migrations/branchMigration');
const { assertWriteGates, buildAuditRecord } = require('../migrations/migrationSafety');
const { parseCliArgs, writeJson } = require('../migrations/reportUtils');

function loadApprovedRecords(inputPath) {
  if (!inputPath) return [];
  const parsed = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Approved branch input must be a JSON array.');
  return parsed;
}

async function run(options = parseCliArgs(process.argv.slice(2))) {
  const dryRun = options.dryRun === true;
  const writeMode = !dryRun;
  const migrationBatchId = options.batchId || `branches-${new Date().toISOString().slice(0, 10)}`;
  const approvedRecords = loadApprovedRecords(options.input);
  if (writeMode) {
    assertWriteGates({
      confirm: options.confirm === true,
      actorId: options.actorId,
      actorName: options.actorName,
      approvalReference: options.approvalReference,
      backupReference: options.backupReference,
      migrationBatchId,
    });
    if (!options.input) throw new Error('Write mode requires --input with administrator-approved legal branch records.');
    if (!ObjectId.isValid(String(options.actorId))) throw new Error('actorId must be a valid administrator ObjectId.');
  }
  const effectiveRecords = writeMode ? approvedRecords.map((record) => ({
    ...record,
    approvalReference: options.approvalReference,
    legalDataApprovedBy: options.actorId,
    legalDataApprovedAt: record.legalDataApprovedAt || new Date(),
  })) : approvedRecords;

  await connectToMongo();
  const db = getDb();
  const observations = await inspectBranchLikeValues(db);
  const analysis = analyzeBranchSeed(observations, effectiveRecords);
  const report = {
    mode: dryRun ? 'dry-run' : 'apply',
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DB_NAME || 'lilycrest_db',
    migrationBatchId,
    generatedAt: new Date().toISOString(),
    ...analysis,
    writesPerformed: false,
  };

  if (writeMode) {
    if (!analysis.readyToApply) throw new Error('Branch seed is blocked by validation errors or conflicts.');
    const repository = new BranchRepository(db);
    const affectedRecordIds = [];
    for (const record of effectiveRecords) {
      const result = await repository.createApproved(record);
      affectedRecordIds.push(result.recordId);
    }
    const audit = buildAuditRecord({
      action: 'CANONICAL_BRANCH_SEED',
      actorId: options.actorId,
      actorName: options.actorName,
      approvalReference: options.approvalReference,
      migrationBatchId,
      environment: process.env.NODE_ENV || 'development',
      targetCollection: 'branches',
      affectedRecordIds,
      before: [],
      after: effectiveRecords,
    });
    await db.collection('auditLogs').insertOne(audit);
    report.writesPerformed = true;
    report.affectedRecordIds = affectedRecordIds.map(String);
  }

  const output = path.resolve(options.output || path.join('reports', 'phase2a-stage1', 'branch-seed-dry-run.json'));
  writeJson(output, report);
  const conflictOutput = path.resolve(options.conflictOutput || path.join('reports', 'phase2a-stage1', 'branch-conflicts.json'));
  writeJson(conflictOutput, {
    migrationBatchId,
    generatedAt: report.generatedAt,
    writesPerformed: report.writesPerformed,
    conflicts: report.conflicts,
  });
  console.log(JSON.stringify({ report: output, conflictReport: conflictOutput, ...report }, null, 2));
  return report;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Branch seed failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { loadApprovedRecords, run };
