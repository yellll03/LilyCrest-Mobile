'use strict';

const crypto = require('crypto');

const GENERATOR_VERSION = 'option-a-v1';
const ALLOWED_STATUS = new Set(['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function snapshotSha256(snapshot) {
  return crypto.createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

function createDraftRecord(input, now = new Date()) {
  const snapshot = structuredClone(input.snapshot);
  const timestamp = now.toISOString();
  return {
    contractId: input.contractId || crypto.randomUUID(),
    userId: input.userId,
    tenantId: input.tenantId,
    reservationId: input.reservationId,
    stayId: input.stayId,
    branchId: input.branchId,
    roomId: input.roomId,
    bedId: input.bedId,
    templateKey: input.templateKey,
    sourceTemplateSha256: input.sourceTemplateSha256,
    generatorVersion: GENERATOR_VERSION,
    status: 'DRAFT',
    version: input.version,
    previousContractId: input.previousContractId || null,
    snapshot,
    snapshotSha256: snapshotSha256(snapshot),
    draftFileUrl: input.draftFileUrl || null,
    finalFileUrl: null,
    generatedAt: timestamp,
    generatedBy: input.generatedBy,
    approvedAt: null,
    approvedBy: null,
    createdAt: timestamp,
  };
}

function approveRecord(record, approval) {
  if (record.status !== 'DRAFT' && record.status !== 'UNDER_REVIEW') {
    throw new Error('Only a draft or under-review contract can be approved.');
  }
  if (snapshotSha256(record.snapshot) !== record.snapshotSha256) {
    throw new Error('The contract snapshot changed after generation.');
  }
  if (!approval?.approvedBy || !approval?.finalFileUrl || !approval?.approvedAt) {
    throw new Error('Complete approval metadata is required.');
  }
  return {
    ...structuredClone(record),
    status: approval.activate ? 'ACTIVE' : 'APPROVED',
    finalFileUrl: approval.finalFileUrl,
    approvedAt: new Date(approval.approvedAt).toISOString(),
    approvedBy: approval.approvedBy,
  };
}

function assertImmutableApprovedRecord(before, after) {
  if (!ALLOWED_STATUS.has(before.status) || !ALLOWED_STATUS.has(after.status)) throw new Error('Invalid contract status.');
  if (!['APPROVED', 'ACTIVE'].includes(before.status)) return true;
  for (const field of ['contractId', 'snapshotSha256', 'sourceTemplateSha256', 'finalFileUrl', 'version']) {
    if (before[field] !== after[field]) throw new Error(`Approved contract field is immutable: ${field}`);
  }
  if (snapshotSha256(before.snapshot) !== snapshotSha256(after.snapshot)) {
    throw new Error('Approved contract snapshot is immutable.');
  }
  return true;
}

module.exports = {
  GENERATOR_VERSION,
  approveRecord,
  assertImmutableApprovedRecord,
  canonicalJson,
  createDraftRecord,
  snapshotSha256,
};
