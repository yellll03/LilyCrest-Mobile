#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { analyzeIdentityCrosswalk } = require('../migrations/identityCrosswalk');
const {
  buildIdentityReviewQueue, summarizeReviewQueue, renderIdentityReviewMarkdown,
} = require('../migrations/identityReview');
const { readInputs } = require('./identityCrosswalk');
const { parseCliArgs, writeJson, writeCsv, ensureOutputDirectory } = require('../migrations/reportUtils');

async function run(options = parseCliArgs(process.argv.slice(2))) {
  if (options.dryRun !== true && options.export !== true) {
    throw new Error('Identity review preparation supports only --dry-run or --export.');
  }
  const migrationBatchId = options.batchId || `identity-review-${new Date().toISOString().slice(0, 10)}`;
  await connectToMongo();
  const db = getDb();
  const input = await readInputs(db);
  const [reservations, approvedResolutions, reviewUsers, bedhistories, stays] = await Promise.all([
    db.collection('reservations').find({}, { projection: { _id: 1, reservationCode: 1 } }).toArray(),
    db.collection('contract_identity_crosswalk').find({}, {
      projection: {
        sourceCollection: 1, sourceRecordId: 1, reviewStatus: 1, resolvedUserObjectId: 1,
      },
    }).toArray(),
    db.collection('users').find({}, { projection: { _id: 1, email: 1, phone: 1 } }).toArray(),
    db.collection('bedhistories').find({}, { projection: { _id: 1, reservationId: 1 } }).toArray(),
    db.collection('stays').find({}, { projection: { _id: 1, reservationId: 1 } }).toArray(),
  ]);
  const reservationCodes = new Map(reservations.map((item) => [String(item._id), item.reservationCode || null]));
  const reservationCodeBySource = new Map();
  for (const item of [...bedhistories.map((record) => ({ ...record, source: 'bedhistories' })),
    ...stays.map((record) => ({ ...record, source: 'stays' }))]) {
    reservationCodeBySource.set(`${item.source}:${item._id}`, reservationCodes.get(String(item.reservationId)) || null);
  }

  const analysis = analyzeIdentityCrosswalk({ ...input, migrationBatchId });
  const queue = buildIdentityReviewQueue({
    analysis, reservations, approvedResolutions, users: reviewUsers, reservationCodeBySource,
  });
  const summary = summarizeReviewQueue({ analysis, queue, approvedResolutions });
  const outputDirectory = path.resolve(options.outputDir || path.join('reports', 'phase2a-stage1b'));
  ensureOutputDirectory(outputDirectory);
  const jsonPath = path.join(outputDirectory, 'identity-manual-review-queue.json');
  const csvPath = path.join(outputDirectory, 'identity-manual-review-queue.csv');
  const markdownPath = path.join(outputDirectory, 'identity-review-summary.md');
  const coveragePath = path.join(outputDirectory, 'identity-resolution-coverage.json');
  const report = {
    mode: options.export === true ? 'export' : 'dry-run',
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DB_NAME || 'lilycrest_db',
    migrationBatchId,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    summary,
    queue,
  };
  writeJson(jsonPath, report);
  writeJson(coveragePath, { ...summary, migrationBatchId, generatedAt: report.generatedAt, writesPerformed: false });
  writeCsv(csvPath, queue.map((item) => ({
    ...item,
    candidateUserIds: item.candidateUserIds.join('|'),
    candidateEvidence: item.candidateEvidence.map((evidence) => evidence.type).join('|'),
    blockerCodes: item.blockerCodes.join('|'),
  })), [
    'sourceCollection', 'sourceRecordId', 'reservationCode', 'rawIdentityValue',
    'rawIdentityType', 'rawIdentityStorageType', 'sourceStateHash', 'candidateUserIds',
    'candidateEvidence', 'currentResolutionStatus', 'blockerCodes', 'recommendedAction', 'reviewStatus',
  ]);
  fs.writeFileSync(markdownPath, renderIdentityReviewMarkdown(summary, queue), 'utf8');
  console.log(JSON.stringify({
    json: jsonPath, csv: csvPath, markdown: markdownPath, coverage: coveragePath,
    ...summary, writesPerformed: false,
  }, null, 2));
  return { report, jsonPath, csvPath, markdownPath, coveragePath };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Identity review preparation failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { run };
