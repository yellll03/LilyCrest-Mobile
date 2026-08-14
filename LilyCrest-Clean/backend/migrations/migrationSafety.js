'use strict';

const crypto = require('node:crypto');

const REQUIRED_WRITE_OPTIONS = Object.freeze([
  'confirm',
  'actorId',
  'actorName',
  'approvalReference',
  'backupReference',
  'migrationBatchId',
]);

function assertWriteGates(options = {}) {
  const missing = REQUIRED_WRITE_OPTIONS.filter((key) => {
    if (key === 'confirm') return options.confirm !== true;
    return typeof options[key] !== 'string' || !options[key].trim();
  });
  if (missing.length) {
    throw new Error(`Write mode blocked. Missing approval gates: ${missing.join(', ')}`);
  }
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRecord(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function buildAuditRecord({
  action, actorId, actorName, approvalReference, migrationBatchId,
  environment, targetCollection, affectedRecordIds, before, after, now = new Date(),
}) {
  return {
    action,
    actorId,
    actorName,
    approvalReference,
    migrationBatchId,
    environment,
    targetCollection,
    affectedRecordIds: affectedRecordIds.map(String),
    beforeHash: hashRecord(before),
    afterHash: hashRecord(after),
    createdAt: now,
  };
}

module.exports = { REQUIRED_WRITE_OPTIONS, assertWriteGates, stableJson, hashRecord, buildAuditRecord };
