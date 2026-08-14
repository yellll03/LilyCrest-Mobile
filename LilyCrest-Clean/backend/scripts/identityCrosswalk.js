#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { analyzeIdentityCrosswalk } = require('../migrations/identityCrosswalk');
const { parseCliArgs, writeJson, writeCsv } = require('../migrations/reportUtils');

function loadOptionalArray(filePath, label) {
  if (!filePath) return [];
  const value = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array.`);
  return value;
}

async function readInputs(db) {
  const [users, reservations, bedhistories, stays, rooms] = await Promise.all([
    db.collection('users').find({}, {
      projection: { _id: 1, user_id: 1, firebaseUid: 1, firebase_uid: 1 },
    }).toArray(),
    db.collection('reservations').find({}, { projection: { _id: 1, userId: 1 } }).sort({ _id: 1 }).toArray(),
    db.collection('bedhistories').find({}, { projection: { _id: 1, tenantId: 1 } }).sort({ _id: 1 }).toArray(),
    db.collection('stays').find({}, { projection: { _id: 1, tenantId: 1 } }).sort({ _id: 1 }).toArray(),
    db.collection('rooms').find({}, { projection: { _id: 1, 'beds.occupiedBy.userId': 1 } }).sort({ _id: 1 }).toArray(),
  ]);
  const assignmentRecords = [
    ...bedhistories.map((record) => ({
      sourceCollection: 'bedhistories',
      sourceRecordId: record._id,
      sourceField: 'tenantId',
      identityValue: record.tenantId,
    })),
    ...stays.map((record) => ({
      sourceCollection: 'stays',
      sourceRecordId: record._id,
      sourceField: 'tenantId',
      identityValue: record.tenantId,
    })),
  ];
  for (const room of rooms) {
    for (const bed of room.beds || []) {
      if (bed?.occupiedBy?.userId === null || bed?.occupiedBy?.userId === undefined) continue;
      assignmentRecords.push({
        sourceCollection: 'rooms',
        sourceRecordId: `${room._id}:bed:${bed.id || bed._id}`,
        sourceField: 'beds.occupiedBy.userId',
        identityValue: bed.occupiedBy.userId,
      });
    }
  }
  return { users, reservations, assignmentRecords };
}

async function run(options = parseCliArgs(process.argv.slice(2))) {
  if (options.export !== true && options.dryRun !== true) {
    throw new Error('Identity crosswalk supports only --dry-run or --export. It never writes source records.');
  }
  const migrationBatchId = options.batchId || `identity-crosswalk-${new Date().toISOString().slice(0, 10)}`;
  const explicitMappings = loadOptionalArray(options.mapping, 'Explicit mapping input');
  const deletedValues = new Set(loadOptionalArray(options.deletedIdentities, 'Deleted identity input').map(String));
  await connectToMongo();
  const db = getDb();
  const input = await readInputs(db);
  const analysis = analyzeIdentityCrosswalk({
    ...input,
    migrationBatchId,
    explicitMappings,
    deletedIdentityValues: deletedValues,
  });
  const report = {
    mode: options.export === true ? 'export' : 'dry-run',
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DB_NAME || 'lilycrest_db',
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    ...analysis,
  };
  const outputDirectory = path.resolve(options.outputDir || path.join('reports', 'phase2a-stage1'));
  const jsonPath = path.join(
    outputDirectory,
    options.export === true ? 'identity-crosswalk-export.json' : 'identity-crosswalk-dry-run.json',
  );
  writeJson(jsonPath, report);
  let csvPath = null;
  if (options.export === true) {
    csvPath = path.join(outputDirectory, 'identity-crosswalk-review.csv');
    writeCsv(csvPath, analysis.records.map((record) => ({
      ...record,
      evidence: record.evidence.map((item) => item.type).join('|'),
      blockerCodes: record.blockerCodes.join('|'),
    })), [
      'migrationBatchId', 'sourceCollection', 'sourceRecordId', 'sourceField',
      'legacyIdentityValue', 'legacyIdentityType', 'legacyIdentityStorageType', 'resolvedUserObjectId',
      'resolutionStatus', 'evidence', 'blockerCodes', 'reviewedBy', 'reviewedAt',
    ]);
  }
  console.log(JSON.stringify({
    jsonReport: jsonPath,
    csvExport: csvPath,
    ...analysis.summary,
    writesPerformed: false,
  }, null, 2));
  return { report, jsonPath, csvPath };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Identity crosswalk failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { loadOptionalArray, readInputs, run };
