#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { ObjectId } = require('mongodb');
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { approveBranch, validateBranchLegalApproval } = require('../migrations/branchLegalApproval');
const { assertWriteGates } = require('../migrations/migrationSafety');
const { parseCliArgs } = require('../migrations/reportUtils');

function recordFromOptions(options) {
  const templates = typeof options.supportedTemplateKeys === 'string' && options.supportedTemplateKeys.trim()
    ? options.supportedTemplateKeys.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const coordinates = options.latitude !== undefined || options.longitude !== undefined
    ? { latitude: Number(options.latitude), longitude: Number(options.longitude) }
    : null;
  return {
    branchId: options.branchKey,
    slug: options.slug,
    legalName: options.legalName,
    displayName: options.displayName,
    legalAddress: {
      addressLine1: options.addressLine1,
      addressLine2: options.addressLine2 || null,
      barangay: options.barangay,
      city: options.city,
      province: options.province || null,
      postalCode: options.postalCode || null,
      country: options.country,
      formattedAddress: options.formattedAddress,
    },
    coordinates,
    status: options.status,
    supportedContractTemplates: templates,
    sourceDocumentReference: options.sourceDocumentReference,
    approvalReference: options.approvalReference,
    legalDataApprovedBy: options.administratorId,
    legalDataApprovedAt: options.approvedAt || new Date(),
  };
}

function validateCommand(options) {
  assertWriteGates({
    confirm: options.confirm === true,
    actorId: options.administratorId,
    actorName: options.administrator,
    approvalReference: options.approvalReference,
    backupReference: options.backupReference,
    migrationBatchId: options.batchId,
  });
  if (!ObjectId.isValid(String(options.administratorId))) throw new Error('administratorId must be a valid ObjectId.');
  const record = recordFromOptions(options);
  const validation = validateBranchLegalApproval(record);
  if (!validation.ok) throw new Error(`Branch approval blocked: ${validation.errors.join(' ')}`);
  return record;
}

async function run(options = parseCliArgs(process.argv.slice(2))) {
  const record = validateCommand(options);
  await connectToMongo();
  const result = await approveBranch(getDb(), record, {
    actorId: options.administratorId,
    actorName: options.administrator,
    migrationBatchId: options.batchId,
    environment: process.env.NODE_ENV || 'development',
  });
  console.log(JSON.stringify({ approved: true, ...result }, null, 2));
  return result;
}

if (require.main === module) {
  const options = parseCliArgs(process.argv.slice(2));
  try {
    validateCommand(options);
  } catch (error) {
    console.error(`Branch approval failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  run(options).catch((error) => {
    console.error(`Branch approval failed: ${error.message}`);
    process.exitCode = 1;
  }).finally(closeConnection);
}

module.exports = { recordFromOptions, validateCommand, run };
