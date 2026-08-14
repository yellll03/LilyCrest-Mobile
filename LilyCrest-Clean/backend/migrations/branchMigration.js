'use strict';

const { validateBranchRecord } = require('../repositories/branchRepository');

const BRANCH_SOURCES = Object.freeze([
  { collection: 'rooms', fields: ['branch', 'branchId', 'branch_id', 'branchName'] },
  { collection: 'reservations', fields: ['branch', 'branchId', 'branch_id', 'branchName'] },
  { collection: 'bills', fields: ['branch', 'branchId', 'branch_id', 'branchName'] },
  { collection: 'stays', fields: ['branch', 'branchId', 'branch_id', 'branchName'] },
  { collection: 'bedhistories', fields: ['branch', 'branchId', 'branch_id', 'branchName'] },
]);

function normalizeObservedValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function inspectBranchLikeValues(db) {
  const observations = [];
  for (const source of BRANCH_SOURCES) {
    const documents = await db.collection(source.collection).find(
      {},
      { projection: Object.fromEntries(source.fields.map((field) => [field, 1])) },
    ).toArray();
    for (const document of documents) {
      for (const field of source.fields) {
        const value = normalizeObservedValue(document[field]);
        if (value) observations.push({ collection: source.collection, field, value });
      }
    }
  }
  return observations;
}

function analyzeBranchSeed(observations, proposedRecords = []) {
  const grouped = new Map();
  for (const observation of observations) {
    const key = observation.value.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { observedValue: observation.value, sources: new Map(), spellings: new Set() });
    const group = grouped.get(key);
    const sourceKey = `${observation.collection}.${observation.field}`;
    group.sources.set(sourceKey, (group.sources.get(sourceKey) || 0) + 1);
    group.spellings.add(observation.value);
  }

  const observedBranches = [...grouped.values()]
    .map((group) => ({
      observedValue: group.observedValue,
      spellings: [...group.spellings].sort(),
      sources: [...group.sources.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([source, count]) => ({ source, count })),
    }))
    .sort((a, b) => a.observedValue.localeCompare(b.observedValue));

  const proposed = proposedRecords.map((record) => {
    const validation = validateBranchRecord(record);
    return {
      branchId: record.branchId || null,
      slug: record.slug || null,
      legalName: record.legalName || null,
      valid: validation.ok,
      errors: validation.errors,
    };
  });

  const conflicts = [];
  const byBranchId = new Map();
  const bySlug = new Map();
  for (const record of proposedRecords) {
    if (record.branchId) {
      if (byBranchId.has(record.branchId)) conflicts.push({ type: 'DUPLICATE_BRANCH_ID', value: record.branchId });
      byBranchId.set(record.branchId, record);
    }
    if (record.slug) {
      if (bySlug.has(record.slug)) conflicts.push({ type: 'DUPLICATE_SLUG', value: record.slug });
      bySlug.set(record.slug, record);
    }
  }

  for (const branch of observedBranches) {
    if (!proposedRecords.some((record) => record.slug === branch.observedValue.toLowerCase())) {
      conflicts.push({
        type: 'OBSERVED_BRANCH_WITHOUT_APPROVED_LEGAL_RECORD',
        value: branch.observedValue,
        blockerCode: 'BRANCH_LEGAL_DATA_MISSING',
      });
    }
  }

  return {
    observedBranches,
    proposedRecords: proposed,
    conflicts: conflicts.sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`)),
    readyToApply: proposed.length > 0
      && proposed.every((record) => record.valid)
      && conflicts.length === 0,
  };
}

function analyzeBranchIndexSafety(branches, existingIndexes = []) {
  const duplicateValues = (field) => {
    const groups = new Map();
    for (const branch of branches) {
      const value = branch[field];
      if (value === null || value === undefined) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(String(branch._id));
    }
    return [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([value, recordIds]) => ({ field, value, recordIds }));
  };
  const conflicts = [...duplicateValues('branchId'), ...duplicateValues('slug')];
  const requiredIndexes = [
    { name: 'branches_branchId_unique', key: { branchId: 1 }, unique: true },
    { name: 'branches_slug_unique', key: { slug: 1 }, unique: true },
    { name: 'branches_status', key: { status: 1 }, unique: false },
  ];
  return {
    safeToCreate: conflicts.length === 0,
    conflicts,
    requiredIndexes,
    existingIndexes: existingIndexes.map((index) => ({
      name: index.name,
      key: index.key,
      unique: Boolean(index.unique),
    })),
  };
}

module.exports = {
  BRANCH_SOURCES,
  normalizeObservedValue,
  inspectBranchLikeValues,
  analyzeBranchSeed,
  analyzeBranchIndexSafety,
};
