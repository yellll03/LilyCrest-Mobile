#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { inspectBranchLikeValues } = require('../migrations/branchMigration');
const {
  createBranchApprovalWorksheets, renderBranchApprovalMarkdown,
} = require('../migrations/branchLegalApproval');
const { parseCliArgs, writeJson, writeCsv, ensureOutputDirectory } = require('../migrations/reportUtils');

async function run(options = parseCliArgs(process.argv.slice(2))) {
  if (options.dryRun !== true && options.export !== true) {
    throw new Error('Branch approval preparation supports only --dry-run or --export.');
  }
  await connectToMongo();
  const observations = await inspectBranchLikeValues(getDb());
  const worksheets = createBranchApprovalWorksheets(observations);
  const outputDirectory = path.resolve(options.outputDir || path.join('reports', 'phase2a-stage1b'));
  ensureOutputDirectory(outputDirectory);
  const jsonPath = path.join(outputDirectory, 'branch-legal-approval-worksheets.json');
  const csvPath = path.join(outputDirectory, 'branch-legal-approval-worksheets.csv');
  const markdownPath = path.join(outputDirectory, 'branch-legal-approval-pack.md');
  writeJson(jsonPath, {
    generatedAt: new Date().toISOString(),
    mode: options.export === true ? 'export' : 'dry-run',
    writesPerformed: false,
    worksheets,
  });
  writeCsv(csvPath, worksheets.map((item) => ({
    proposedBranchId: item.proposedBranchId,
    observedSlugs: item.observedSlugs.join('|'),
    observedDisplayNames: item.observedDisplayNames.join('|'),
    legalName: item.legalName,
    legalAddress: item.legalAddress.formattedAddress,
    coordinates: '',
    status: item.status,
    supportedContractTemplates: item.supportedContractTemplates.join('|'),
    sourceOfLegalData: item.sourceOfLegalData,
    approvedBy: '',
    approvedAt: '',
    approvalReference: '',
    blockerCodes: (item.blockerCodes || []).join('|'),
  })), [
    'proposedBranchId', 'observedSlugs', 'observedDisplayNames', 'legalName',
    'legalAddress', 'coordinates', 'status', 'supportedContractTemplates',
    'sourceOfLegalData', 'approvedBy', 'approvedAt', 'approvalReference', 'blockerCodes',
  ]);
  fs.writeFileSync(markdownPath, renderBranchApprovalMarkdown(worksheets), 'utf8');
  console.log(JSON.stringify({ json: jsonPath, csv: csvPath, markdown: markdownPath, writesPerformed: false }, null, 2));
  return { worksheets, jsonPath, csvPath, markdownPath };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Branch approval pack failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { run };
