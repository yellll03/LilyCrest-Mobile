'use strict';

const crypto = require('crypto');

const MIGRATION_NAME = 'billing-to-bills';
const MIGRATION_VERSION = 1;
const PAID_STATUSES = new Set(['paid', 'settled']);
const STATUS_ALIASES = Object.freeze({
  pending: 'unpaid',
  settled: 'paid',
  verification: 'pending_verification',
  canceled: 'cancelled',
});

function stringValue(value) {
  return String(value ?? '').trim();
}

function objectIdText(value) {
  if (!value) return '';
  if (typeof value.toHexString === 'function') return value.toHexString();
  return stringValue(value);
}

function normalizeStatus(value) {
  const normalized = stringValue(value).toLowerCase();
  return STATUS_ALIASES[normalized] || normalized || 'unpaid';
}

function moneyToCentavos(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

function centavosToMoney(value) {
  return Number.isInteger(value) ? value / 100 : null;
}

function dateToIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstMoneyCentavos(...values) {
  for (const value of values) {
    const centavos = moneyToCentavos(value);
    if (centavos !== null) return centavos;
  }
  return null;
}

function normalizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item = {}) => ({
    label: stringValue(item.label || item.name || item.description),
    type: stringValue(item.type).toLowerCase(),
    amountCentavos: moneyToCentavos(item.amount),
  }));
}

function legacyFinancialSnapshot(legacy = {}) {
  const status = normalizeStatus(legacy.status);
  const grossCentavos = firstMoneyCentavos(
    legacy.gross_amount,
    legacy.original_total,
    legacy.total,
    legacy.amount,
  );
  const remainingCandidate = firstMoneyCentavos(
    legacy.remaining_amount,
    legacy.balance,
    grossCentavos === null ? null : centavosToMoney(grossCentavos),
  );
  return {
    sourceId: objectIdText(legacy._id),
    billingId: stringValue(legacy.billing_id),
    ownerUserId: stringValue(legacy.user_id),
    status,
    grossCentavos,
    remainingCentavos: PAID_STATUSES.has(status) ? 0 : remainingCandidate,
    charges: {
      rent: moneyToCentavos(legacy.rent) ?? 0,
      electricity: moneyToCentavos(legacy.electricity) ?? 0,
      water: moneyToCentavos(legacy.water) ?? 0,
      penalty: firstMoneyCentavos(legacy.penalties, legacy.penalty) ?? 0,
      applianceFees: moneyToCentavos(legacy.appliance_fees ?? legacy.applianceFees) ?? 0,
      corkageFees: moneyToCentavos(legacy.corkage_fees ?? legacy.corkageFees) ?? 0,
    },
    lineItems: normalizeLineItems(legacy.items || legacy.additionalCharges),
    billingPeriod: stringValue(legacy.billing_period || legacy.billingMonth),
    billingType: stringValue(legacy.billing_type || legacy.billingType || 'consolidated').toLowerCase(),
    dueDate: dateToIso(legacy.due_date || legacy.dueDate),
    releaseDate: dateToIso(legacy.release_date || legacy.releaseDate),
    paymentDate: dateToIso(legacy.payment_date || legacy.paymentDate || legacy.paidAt),
    paymentMethod: stringValue(legacy.payment_method || legacy.paymentMethod).toLowerCase(),
    paymongoSessionId: stringValue(legacy.paymongo_checkout_id || legacy.paymongoSessionId),
    paymongoPaymentId: stringValue(legacy.paymongo_payment_id || legacy.paymongoPaymentId),
    paymongoReference: stringValue(legacy.paymongo_reference || legacy.paymongoReference),
  };
}

function canonicalFinancialSnapshot(canonical = {}, ownerUserId = '') {
  const charges = canonical.charges || {};
  const status = normalizeStatus(canonical.status);
  const grossCentavos = firstMoneyCentavos(
    canonical.grossAmount,
    canonical.totalAmount,
    canonical.original_total,
    canonical.total,
    canonical.amount,
  );
  const remainingCandidate = firstMoneyCentavos(
    canonical.remainingAmount,
    canonical.remaining_amount,
    grossCentavos === null ? null : centavosToMoney(grossCentavos),
  );
  return {
    sourceId: objectIdText(canonical.migration?.sourceId || canonical.legacyCollectionId),
    billingId: stringValue(canonical.billing_id || canonical.legacyBillingId),
    ownerUserId: stringValue(canonical.tenantUserId || canonical.user_id || ownerUserId),
    status,
    grossCentavos,
    remainingCentavos: remainingCandidate,
    charges: {
      rent: firstMoneyCentavos(charges.rent, canonical.rent) ?? 0,
      electricity: firstMoneyCentavos(charges.electricity, canonical.electricity) ?? 0,
      water: firstMoneyCentavos(charges.water, canonical.water) ?? 0,
      penalty: firstMoneyCentavos(charges.penalty, canonical.penalties) ?? 0,
      applianceFees: firstMoneyCentavos(charges.applianceFees, canonical.applianceFees) ?? 0,
      corkageFees: firstMoneyCentavos(charges.corkageFees, canonical.corkageFees) ?? 0,
    },
    lineItems: normalizeLineItems(canonical.additionalCharges || canonical.items),
    billingPeriod: stringValue(canonical.billingMonth || canonical.billing_period),
    billingType: stringValue(canonical.billingType || canonical.billing_type || 'consolidated').toLowerCase(),
    dueDate: dateToIso(canonical.dueDate || canonical.due_date),
    releaseDate: dateToIso(canonical.billingCycleStart || canonical.releaseDate || canonical.release_date),
    paymentDate: dateToIso(canonical.paymentDate || canonical.paidAt || canonical.payment_date),
    paymentMethod: stringValue(canonical.paymentMethod || canonical.payment_method).toLowerCase(),
    paymongoSessionId: stringValue(canonical.paymongoSessionId || canonical.paymongo_checkout_id),
    paymongoPaymentId: stringValue(canonical.paymongoPaymentId || canonical.paymongo_payment_id),
    paymongoReference: stringValue(canonical.paymongoReference || canonical.paymongo_reference),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprintSnapshot(snapshot) {
  return crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function validateLegacyBill(legacy = {}, user = null) {
  const snapshot = legacyFinancialSnapshot(legacy);
  const errors = [];
  const warnings = [];

  if (!snapshot.sourceId) errors.push('MISSING_SOURCE_ID');
  if (!snapshot.billingId) errors.push('MISSING_BILLING_ID');
  if (!snapshot.ownerUserId) errors.push('MISSING_OWNER_USER_ID');
  if (!user?._id) errors.push('OWNER_NOT_FOUND');
  if (snapshot.grossCentavos === null || snapshot.grossCentavos <= 0) errors.push('INVALID_GROSS_AMOUNT');
  if (snapshot.remainingCentavos === null || snapshot.remainingCentavos < 0) errors.push('INVALID_REMAINING_AMOUNT');
  if (
    snapshot.grossCentavos !== null
    && snapshot.remainingCentavos !== null
    && snapshot.remainingCentavos > snapshot.grossCentavos
  ) errors.push('REMAINING_EXCEEDS_GROSS');

  const rawRemaining = firstMoneyCentavos(legacy.remaining_amount, legacy.balance);
  if (PAID_STATUSES.has(snapshot.status) && rawRemaining !== null && rawRemaining !== 0) {
    errors.push('PAID_BILL_HAS_REMAINING_BALANCE');
  }

  for (const [field, centavos] of Object.entries(snapshot.charges)) {
    if (!Number.isInteger(centavos) || centavos < 0) errors.push(`INVALID_CHARGE_${field.toUpperCase()}`);
  }
  snapshot.lineItems.forEach((item, index) => {
    if (!item.label) errors.push(`ITEM_${index}_MISSING_LABEL`);
    if (!Number.isInteger(item.amountCentavos) || item.amountCentavos < 0) {
      errors.push(`ITEM_${index}_INVALID_AMOUNT`);
    }
  });

  for (const [field, raw] of [
    ['DUE_DATE', legacy.due_date || legacy.dueDate],
    ['RELEASE_DATE', legacy.release_date || legacy.releaseDate],
    ['PAYMENT_DATE', legacy.payment_date || legacy.paymentDate || legacy.paidAt],
  ]) {
    if (raw && !dateToIso(raw)) errors.push(`INVALID_${field}`);
  }

  const itemizedCentavos = Object.values(snapshot.charges).reduce((sum, value) => sum + value, 0)
    + snapshot.lineItems.reduce((sum, item) => sum + (item.amountCentavos || 0), 0);
  if (itemizedCentavos > 0 && snapshot.grossCentavos !== null && itemizedCentavos !== snapshot.grossCentavos) {
    warnings.push({
      code: 'ITEMIZED_TOTAL_DIFFERS_FROM_GROSS',
      itemizedCentavos,
      grossCentavos: snapshot.grossCentavos,
    });
  }

  return { snapshot, errors, warnings };
}

function buildCanonicalBill(legacy, user, now = new Date()) {
  const { snapshot, errors } = validateLegacyBill(legacy, user);
  if (errors.length) {
    const error = new Error(`Legacy bill is not safe to migrate: ${errors.join(', ')}`);
    error.code = 'BILLING_MIGRATION_INVARIANT_FAILED';
    error.invariants = errors;
    throw error;
  }

  const migratedAt = now instanceof Date ? now : new Date(now);
  const createdAt = legacy.created_at || legacy.createdAt;
  const updatedAt = legacy.updated_at || legacy.updatedAt;
  const paymentDate = snapshot.paymentDate ? new Date(snapshot.paymentDate) : null;
  const sourceFingerprint = fingerprintSnapshot(snapshot);
  const lineItems = snapshot.lineItems.map((item) => ({
    label: item.label,
    type: item.type || 'other',
    amount: centavosToMoney(item.amountCentavos),
  }));

  return {
    billing_id: snapshot.billingId,
    legacyBillingId: snapshot.billingId,
    legacyCollection: 'billing',
    legacyCollectionId: legacy._id,
    userId: user._id,
    tenantUserId: snapshot.ownerUserId,
    billingMonth: snapshot.billingPeriod || legacy.description || null,
    billingType: snapshot.billingType,
    billingCycleStart: snapshot.releaseDate ? new Date(snapshot.releaseDate) : null,
    dueDate: snapshot.dueDate ? new Date(snapshot.dueDate) : null,
    description: legacy.description || snapshot.billingPeriod || 'Billing Statement',
    status: snapshot.status,
    charges: Object.fromEntries(Object.entries(snapshot.charges).map(([key, value]) => [key, centavosToMoney(value)])),
    additionalCharges: lineItems,
    items: lineItems,
    totalAmount: centavosToMoney(snapshot.grossCentavos),
    grossAmount: centavosToMoney(snapshot.grossCentavos),
    remainingAmount: centavosToMoney(snapshot.remainingCentavos),
    paymentMethod: snapshot.paymentMethod || null,
    paymentDate,
    paidAt: PAID_STATUSES.has(snapshot.status) ? paymentDate : null,
    paymongoReference: snapshot.paymongoReference || null,
    paymongoSessionId: snapshot.paymongoSessionId || null,
    paymongoPaymentId: snapshot.paymongoPaymentId || null,
    electricity_breakdown: Array.isArray(legacy.electricity_breakdown) ? legacy.electricity_breakdown : [],
    water_breakdown: legacy.water_breakdown && typeof legacy.water_breakdown === 'object' ? legacy.water_breakdown : null,
    notes: legacy.notes || null,
    paymentProof: legacy.proof || null,
    isArchived: legacy.isArchived === true,
    isHidden: legacy.isHidden === true || legacy.hidden === true,
    isDeleted: legacy.isDeleted === true,
    migration: {
      name: MIGRATION_NAME,
      version: MIGRATION_VERSION,
      sourceCollection: 'billing',
      sourceId: snapshot.sourceId,
      sourceFingerprint,
      migratedAt,
    },
    migratedFromLegacyAt: migratedAt,
    createdAt: createdAt ? new Date(createdAt) : migratedAt,
    updatedAt: updatedAt ? new Date(updatedAt) : migratedAt,
  };
}

const FINANCIAL_COMPARISON_FIELDS = [
  'billingId',
  'ownerUserId',
  'status',
  'grossCentavos',
  'remainingCentavos',
  'charges',
  'lineItems',
  'billingPeriod',
  'billingType',
  'dueDate',
  'releaseDate',
  'paymentDate',
  'paymentMethod',
  'paymongoSessionId',
  'paymongoPaymentId',
  'paymongoReference',
];

function compareFinancialSnapshots(legacySnapshot, canonicalSnapshot) {
  return FINANCIAL_COMPARISON_FIELDS.flatMap((field) => (
    stableJson(legacySnapshot[field]) === stableJson(canonicalSnapshot[field])
      ? []
      : [{ field, legacy: legacySnapshot[field], canonical: canonicalSnapshot[field] }]
  ));
}

function buildUserIndexes(users = []) {
  const byUserId = new Map();
  const byMongoId = new Map();
  const duplicateUserIds = new Set();
  for (const user of users) {
    const userId = stringValue(user.user_id);
    const mongoId = objectIdText(user._id);
    if (mongoId) byMongoId.set(mongoId, userId);
    if (!userId) continue;
    if (byUserId.has(userId)) duplicateUserIds.add(userId);
    else byUserId.set(userId, user);
  }
  return { byUserId, byMongoId, duplicateUserIds };
}

function canonicalOwnerUserId(canonical, usersByMongoId) {
  return stringValue(
    canonical.tenantUserId
      || canonical.user_id
      || usersByMongoId.get(objectIdText(canonical.userId || canonical.tenantId)),
  );
}

function canonicalMatchesLegacy(canonical, legacySnapshot, ownerUserId) {
  const linkedSourceId = objectIdText(canonical.migration?.sourceId || canonical.legacyCollectionId);
  if (linkedSourceId) return linkedSourceId === legacySnapshot.sourceId;
  if (ownerUserId !== legacySnapshot.ownerUserId) return false;
  const canonicalIds = [canonical.billing_id, canonical.legacyBillingId].map(stringValue).filter(Boolean);
  return canonicalIds.includes(legacySnapshot.billingId);
}

function duplicateValues(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function duplicateDocumentValues(documents, valueSelector) {
  const bindings = new Map();
  documents.forEach((document, index) => {
    const uniqueValues = new Set(valueSelector(document).map(stringValue).filter(Boolean));
    uniqueValues.forEach((value) => {
      if (!bindings.has(value)) bindings.set(value, new Set());
      bindings.get(value).add(index);
    });
  });
  return [...bindings.entries()]
    .filter(([, indexes]) => indexes.size > 1)
    .map(([value, indexes]) => ({ value, count: indexes.size }));
}

function publicAction(action) {
  return {
    type: action.type,
    sourceId: action.sourceId,
    billingId: action.billingId,
    ownerUserId: action.ownerUserId,
    canonicalId: action.canonicalId || null,
    sourceFingerprint: action.sourceFingerprint,
  };
}

function planBillingMigration({ legacyDocs = [], canonicalDocs = [], users = [], now = new Date() } = {}) {
  const userIndexes = buildUserIndexes(users);
  const actions = [];
  const conflicts = [];
  const warnings = [];
  const matchedCanonicalIds = new Set();

  const duplicateLegacyBillingIds = duplicateDocumentValues(
    legacyDocs,
    (doc) => [doc.billing_id],
  );
  duplicateLegacyBillingIds.forEach(({ value, count }) => conflicts.push({
    code: 'DUPLICATE_LEGACY_BILLING_ID', key: value, count,
  }));

  const duplicateCanonicalBillingIds = duplicateDocumentValues(
    canonicalDocs,
    (doc) => [doc.billing_id, doc.legacyBillingId],
  );
  duplicateCanonicalBillingIds.forEach(({ value, count }) => conflicts.push({
    code: 'DUPLICATE_CANONICAL_BILLING_ID', key: value, count,
  }));

  const duplicateMigrationSourceIds = duplicateValues(canonicalDocs.map((doc) => (
    objectIdText(doc.migration?.sourceId || doc.legacyCollectionId)
  )));
  duplicateMigrationSourceIds.forEach(({ value, count }) => conflicts.push({
    code: 'DUPLICATE_MIGRATION_SOURCE_ID', sourceId: value, count,
  }));

  const checkoutBindings = new Map();
  legacyDocs.forEach((doc) => {
    const checkoutId = stringValue(doc.paymongo_checkout_id);
    if (!checkoutId) return;
    if (!checkoutBindings.has(checkoutId)) checkoutBindings.set(checkoutId, []);
    checkoutBindings.get(checkoutId).push({ source: 'legacy', doc });
  });
  canonicalDocs.forEach((doc) => {
    const checkoutId = stringValue(doc.paymongoSessionId);
    if (!checkoutId) return;
    if (!checkoutBindings.has(checkoutId)) checkoutBindings.set(checkoutId, []);
    checkoutBindings.get(checkoutId).push({ source: 'canonical', doc });
  });
  checkoutBindings.forEach((bindings, checkoutId) => {
    if (bindings.length <= 1) return;
    const legacyBindings = bindings.filter((binding) => binding.source === 'legacy');
    const canonicalBindings = bindings.filter((binding) => binding.source === 'canonical');
    const isOneMigrationPair = legacyBindings.length === 1
      && canonicalBindings.length === 1
      && canonicalMatchesLegacy(
        canonicalBindings[0].doc,
        legacyFinancialSnapshot(legacyBindings[0].doc),
        canonicalOwnerUserId(canonicalBindings[0].doc, userIndexes.byMongoId),
      );
    if (!isOneMigrationPair) {
      conflicts.push({ code: 'DUPLICATE_PAYMONGO_SESSION_ID', checkoutId, count: bindings.length });
    }
  });

  for (const legacy of legacyDocs) {
    const userId = stringValue(legacy.user_id);
    const user = userIndexes.byUserId.get(userId) || null;
    const validation = validateLegacyBill(legacy, user);
    const context = {
      sourceId: validation.snapshot.sourceId,
      billingId: validation.snapshot.billingId,
      ownerUserId: userId,
    };

    if (userIndexes.duplicateUserIds.has(userId)) {
      validation.errors.push('AMBIGUOUS_OWNER_USER_ID');
    }
    validation.warnings.forEach((warning) => warnings.push({ ...context, ...warning }));
    if (validation.errors.length) {
      conflicts.push({ ...context, code: 'LEGACY_INVARIANT_FAILED', invariants: [...new Set(validation.errors)] });
      continue;
    }

    const matches = canonicalDocs.filter((canonical) => canonicalMatchesLegacy(
      canonical,
      validation.snapshot,
      canonicalOwnerUserId(canonical, userIndexes.byMongoId),
    ));
    if (matches.length > 1) {
      conflicts.push({
        ...context,
        code: 'AMBIGUOUS_CANONICAL_MATCH',
        canonicalIds: matches.map((doc) => objectIdText(doc._id)),
      });
      continue;
    }

    const occupiedByAnotherSource = canonicalDocs.filter((canonical) => {
      const canonicalOwner = canonicalOwnerUserId(canonical, userIndexes.byMongoId);
      const canonicalIds = [canonical.billing_id, canonical.legacyBillingId].map(stringValue).filter(Boolean);
      const linkedSourceId = objectIdText(canonical.migration?.sourceId || canonical.legacyCollectionId);
      return canonicalOwner === validation.snapshot.ownerUserId
        && canonicalIds.includes(validation.snapshot.billingId)
        && linkedSourceId
        && linkedSourceId !== validation.snapshot.sourceId;
    });
    if (occupiedByAnotherSource.length) {
      conflicts.push({
        ...context,
        code: 'CANONICAL_ID_LINKED_TO_DIFFERENT_SOURCE',
        canonicalIds: occupiedByAnotherSource.map((doc) => objectIdText(doc._id)),
      });
      continue;
    }

    const canonicalDocument = buildCanonicalBill(legacy, user, now);
    const sourceFingerprint = canonicalDocument.migration.sourceFingerprint;
    if (matches.length === 0) {
      actions.push({
        type: 'insert',
        ...context,
        sourceFingerprint,
        canonicalDocument,
        legacy,
      });
      continue;
    }

    const existing = matches[0];
    matchedCanonicalIds.add(objectIdText(existing._id));
    const canonicalOwner = canonicalOwnerUserId(existing, userIndexes.byMongoId);
    const differences = compareFinancialSnapshots(
      validation.snapshot,
      canonicalFinancialSnapshot(existing, canonicalOwner),
    );
    if (differences.length) {
      conflicts.push({
        ...context,
        code: 'CANONICAL_FINANCIAL_CONFLICT',
        canonicalId: objectIdText(existing._id),
        differences,
      });
      continue;
    }

    const alreadyLinked = existing.migration?.name === MIGRATION_NAME
      && Number(existing.migration?.version) === MIGRATION_VERSION
      && objectIdText(existing.migration?.sourceId) === validation.snapshot.sourceId
      && stringValue(existing.migration?.sourceFingerprint) === sourceFingerprint;
    actions.push({
      type: alreadyLinked ? 'noop' : 'link',
      ...context,
      canonicalId: objectIdText(existing._id),
      sourceFingerprint,
      canonicalDocument,
      existing,
      legacy,
    });
  }

  const publicActions = actions.map(publicAction).sort((left, right) => (
    `${left.ownerUserId}:${left.billingId}:${left.sourceId}`
      .localeCompare(`${right.ownerUserId}:${right.billingId}:${right.sourceId}`)
  ));
  conflicts.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  warnings.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  const planBasis = {
    migration: MIGRATION_NAME,
    version: MIGRATION_VERSION,
    actions: publicActions,
    conflicts,
  };
  const planId = fingerprintSnapshot(planBasis);
  const counts = {
    legacyScanned: legacyDocs.length,
    canonicalScanned: canonicalDocs.length,
    inserts: actions.filter((action) => action.type === 'insert').length,
    links: actions.filter((action) => action.type === 'link').length,
    noops: actions.filter((action) => action.type === 'noop').length,
    conflicts: conflicts.length,
    warnings: warnings.length,
    nativeCanonical: canonicalDocs.filter((doc) => !matchedCanonicalIds.has(objectIdText(doc._id))).length,
  };

  return {
    migration: MIGRATION_NAME,
    version: MIGRATION_VERSION,
    planId,
    counts,
    actions,
    conflicts,
    warnings,
  };
}

function publicMigrationReport(plan) {
  return {
    migration: plan.migration,
    version: plan.version,
    plan_id: plan.planId,
    counts: plan.counts,
    actions: plan.actions.map(publicAction),
    conflicts: plan.conflicts,
    warnings: plan.warnings,
    apply_allowed: plan.conflicts.length === 0,
    apply_command: plan.conflicts.length === 0
      ? `npm run billing:migrate-to-bills -- --apply --confirm ${plan.planId}`
      : null,
  };
}

module.exports = {
  MIGRATION_NAME,
  MIGRATION_VERSION,
  buildCanonicalBill,
  canonicalFinancialSnapshot,
  compareFinancialSnapshots,
  fingerprintSnapshot,
  legacyFinancialSnapshot,
  normalizeStatus,
  planBillingMigration,
  publicMigrationReport,
  validateLegacyBill,
};
