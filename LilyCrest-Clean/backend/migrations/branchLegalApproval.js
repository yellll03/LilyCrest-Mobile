'use strict';

const { ObjectId } = require('mongodb');
const { APPROVED_TEMPLATE_KEYS } = require('../domain/contracts/templateRegistry');
const { validateBranchRecord, BranchRepository } = require('../repositories/branchRepository');
const { buildAuditRecord } = require('./migrationSafety');

const GIL_PUYAT_TEMPLATE_WORDING = Object.freeze({
  slug: 'gil-puyat',
  legalName: 'LILYCREST GIL PUYAT',
  formattedAddress: '#7 Gil Puyat Ave. corner Marconi St., Makati City',
});

function validateBranchLegalApproval(record) {
  const errors = [...validateBranchRecord(record).errors];
  if (typeof record.sourceDocumentReference !== 'string' || !record.sourceDocumentReference.trim()) {
    errors.push('sourceDocumentReference is required.');
  }
  if (record.slug === GIL_PUYAT_TEMPLATE_WORDING.slug) {
    if (record.legalName !== GIL_PUYAT_TEMPLATE_WORDING.legalName) {
      errors.push('Gil Puyat legalName must exactly match the approved template wording.');
    }
    if (record.legalAddress?.formattedAddress !== GIL_PUYAT_TEMPLATE_WORDING.formattedAddress) {
      errors.push('Gil Puyat formatted legal address must exactly match the approved template wording.');
    }
  }
  if (record.slug === 'guadalupe' && record.supportedContractTemplates?.length) {
    errors.push('Guadalupe cannot inherit Gil Puyat contract templates.');
  }
  return { ok: errors.length === 0, errors };
}

function createBranchApprovalWorksheets(observations) {
  const observed = new Map();
  for (const observation of observations) {
    const slug = String(observation.value || '').trim().toLowerCase();
    if (!slug) continue;
    if (!observed.has(slug)) observed.set(slug, { slugs: new Set(), names: new Set() });
    const entry = observed.get(slug);
    if (observation.field.toLowerCase().includes('name')) entry.names.add(observation.value);
    else entry.slugs.add(observation.value);
  }
  const create = (slug, proposedBranchId) => {
    const entry = observed.get(slug) || { slugs: new Set([slug]), names: new Set() };
    return {
      proposedBranchId,
      observedSlugs: [...entry.slugs].sort(),
      observedDisplayNames: [...entry.names].sort(),
      legalName: '',
      legalAddress: {
        addressLine1: '',
        addressLine2: null,
        barangay: '',
        city: '',
        province: null,
        postalCode: null,
        country: 'Philippines',
        formattedAddress: '',
      },
      coordinates: null,
      status: 'PENDING_APPROVAL',
      supportedContractTemplates: [],
      sourceOfLegalData: '',
      approvedBy: null,
      approvedAt: null,
      approvalReference: '',
    };
  };
  const gilPuyat = create('gil-puyat', 'BRANCH_GIL_PUYAT');
  gilPuyat.templateReference = {
    legalName: GIL_PUYAT_TEMPLATE_WORDING.legalName,
    formattedAddress: GIL_PUYAT_TEMPLATE_WORDING.formattedAddress,
    approvedTemplateKeys: [...APPROVED_TEMPLATE_KEYS],
    note: 'Reference only. Legal fields remain blank until administrator/legal approval.',
  };
  gilPuyat.verificationChecklist = [
    'Legal name matches approved template',
    'Legal address matches approved template',
    'Branch slug mapped',
    'Coordinates verified',
    'Supported templates mapped',
    'Legal owner approves',
    'Approval reference recorded',
  ].map((item) => ({ item, status: 'PENDING_APPROVAL' }));

  const guadalupe = create('guadalupe', 'BRANCH_GUADALUPE');
  guadalupe.blockerCodes = ['BRANCH_LEGAL_DATA_MISSING', 'TEMPLATE_BRANCH_MISMATCH'];
  guadalupe.verificationChecklist = [
    'Official legal name supplied',
    'Official legal address supplied',
    'Coordinates verified',
    'Branch-specific lease templates legally approved',
    'Legal owner approves',
    'Approval reference recorded',
  ].map((item) => ({ item, status: 'PENDING_APPROVAL' }));
  guadalupe.supportedContractTemplates = [];
  return [gilPuyat, guadalupe];
}

function renderBranchApprovalMarkdown(worksheets) {
  const lines = ['# Phase 2A Stage 1B Branch Legal Approval Pack', ''];
  for (const branch of worksheets) {
    lines.push(`## ${branch.proposedBranchId}`, '');
    lines.push(`- Observed slugs: ${branch.observedSlugs.join(', ') || 'None'}`);
    lines.push(`- Observed display names: ${branch.observedDisplayNames.join(', ') || 'None'}`);
    lines.push('- Legal name: **PENDING_APPROVAL**');
    lines.push('- Legal address: **PENDING_APPROVAL**');
    lines.push(`- Supported templates: ${branch.supportedContractTemplates.join(', ') || 'None approved'}`);
    if (branch.blockerCodes) lines.push(`- Blockers: ${branch.blockerCodes.join(', ')}`);
    lines.push('', '### Verification checklist', '');
    for (const item of branch.verificationChecklist) lines.push(`- [ ] ${item.item}`);
    if (branch.templateReference) {
      lines.push('', '### Approved-template wording for comparison only', '');
      lines.push(`- Legal name: \`${branch.templateReference.legalName}\``);
      lines.push(`- Legal address: \`${branch.templateReference.formattedAddress}\``);
      lines.push('- These reference values have not been copied into the proposed legal record.');
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function approveBranch(db, record, auditContext) {
  const validation = validateBranchLegalApproval(record);
  if (!validation.ok) {
    const error = new Error('Branch approval validation failed.');
    error.validationErrors = validation.errors;
    throw error;
  }
  const repository = new BranchRepository(db);
  const result = await repository.createApproved(record);
  if (!result.created) return result;
  await db.collection('auditLogs').insertOne(buildAuditRecord({
    action: 'CANONICAL_BRANCH_LEGAL_APPROVED',
    actorId: auditContext.actorId,
    actorName: auditContext.actorName,
    approvalReference: record.approvalReference,
    migrationBatchId: auditContext.migrationBatchId,
    environment: auditContext.environment,
    targetCollection: 'branches',
    affectedRecordIds: [result.recordId],
    before: [],
    after: {
      branchId: record.branchId,
      slug: record.slug,
      legalDataHashSource: record.sourceDocumentReference,
    },
  }));
  return result;
}

module.exports = {
  GIL_PUYAT_TEMPLATE_WORDING,
  validateBranchLegalApproval,
  createBranchApprovalWorksheets,
  renderBranchApprovalMarkdown,
  approveBranch,
};
