'use strict';

const { ObjectId } = require('mongodb');
const { BRANCH_STATUS, isEnumValue } = require('../domain/contracts/canonicalEnums');
const { isApprovedTemplateKey } = require('../domain/contracts/templateRegistry');

const BRANCH_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateLegalAddress(address) {
  const errors = [];
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    return ['legalAddress must be an object containing administrator-approved legal data.'];
  }
  for (const field of ['addressLine1', 'barangay', 'city', 'formattedAddress']) {
    if (!nonEmptyString(address[field])) errors.push(`legalAddress.${field} is required.`);
  }
  if (address.country !== 'Philippines') errors.push('legalAddress.country must be Philippines.');
  for (const field of ['addressLine2', 'province', 'postalCode']) {
    if (address[field] !== null && address[field] !== undefined && typeof address[field] !== 'string') {
      errors.push(`legalAddress.${field} must be a string or null.`);
    }
  }
  return errors;
}

function validateCoordinates(coordinates) {
  if (coordinates === null || coordinates === undefined) return [];
  if (typeof coordinates !== 'object' || Array.isArray(coordinates)) {
    return ['coordinates must be an object or null.'];
  }
  const hasLatitude = coordinates.latitude !== null && coordinates.latitude !== undefined;
  const hasLongitude = coordinates.longitude !== null && coordinates.longitude !== undefined;
  if (hasLatitude !== hasLongitude) return ['Latitude and longitude must both be present or both be absent.'];
  if (!hasLatitude) return ['Coordinates with absent values must be null.'];
  if (!Number.isFinite(coordinates.latitude) || coordinates.latitude < -90 || coordinates.latitude > 90) {
    return ['coordinates.latitude must be between -90 and 90.'];
  }
  if (!Number.isFinite(coordinates.longitude) || coordinates.longitude < -180 || coordinates.longitude > 180) {
    return ['coordinates.longitude must be between -180 and 180.'];
  }
  return [];
}

function validateBranchRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['Branch record must be an object.'] };
  }
  if (!nonEmptyString(record.branchId) || !BRANCH_ID_PATTERN.test(record.branchId)) {
    errors.push('branchId is required and must use the stable uppercase identifier format.');
  }
  if (!nonEmptyString(record.slug) || !SLUG_PATTERN.test(record.slug)) {
    errors.push('slug is required and must use lowercase kebab-case.');
  }
  if (!nonEmptyString(record.legalName)) errors.push('legalName is required.');
  if (!nonEmptyString(record.displayName)) errors.push('displayName is required.');
  if (!nonEmptyString(record.googleMapsUrl) || !/^https:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.[^/]+\/maps)\//i.test(record.googleMapsUrl)) {
    errors.push('googleMapsUrl must be an approved HTTPS Google Maps destination.');
  }
  errors.push(...validateLegalAddress(record.legalAddress));
  errors.push(...validateCoordinates(record.coordinates));
  if (!isEnumValue(BRANCH_STATUS, record.status)) errors.push('status must be ACTIVE or INACTIVE.');
  if (!Array.isArray(record.supportedContractTemplates)) {
    errors.push('supportedContractTemplates must be an array.');
  } else {
    const duplicates = new Set();
    const seen = new Set();
    for (const key of record.supportedContractTemplates) {
      if (!isApprovedTemplateKey(key)) errors.push(`Unsupported contract template key: ${String(key)}`);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    if (duplicates.size) errors.push('supportedContractTemplates contains duplicate keys.');
  }
  if (!nonEmptyString(record.approvalReference)) {
    errors.push('approvalReference is required; a room slug alone cannot authorize a branch.');
  }
  if (!ObjectId.isValid(String(record.legalDataApprovedBy || ''))) {
    errors.push('legalDataApprovedBy must be a valid administrator ObjectId.');
  }
  const approvedAt = new Date(record.legalDataApprovedAt);
  if (!record.legalDataApprovedAt || Number.isNaN(approvedAt.getTime())) {
    errors.push('legalDataApprovedAt must be a valid approval timestamp.');
  }
  return { ok: errors.length === 0, errors };
}

function canonicalBranchDocument(record, now = new Date()) {
  const validation = validateBranchRecord(record);
  if (!validation.ok) {
    const error = new TypeError('Invalid canonical branch record.');
    error.validationErrors = validation.errors;
    throw error;
  }
  return {
    branchId: record.branchId,
    slug: record.slug,
    legalName: record.legalName.trim(),
    displayName: record.displayName.trim(),
    branchCode: record.branchCode?.trim() || record.slug.trim(),
    branchName: record.displayName.trim(),
    legalAddress: {
      addressLine1: record.legalAddress.addressLine1.trim(),
      addressLine2: record.legalAddress.addressLine2?.trim() || null,
      barangay: record.legalAddress.barangay.trim(),
      city: record.legalAddress.city.trim(),
      province: record.legalAddress.province?.trim() || null,
      postalCode: record.legalAddress.postalCode?.trim() || null,
      country: 'Philippines',
      formattedAddress: record.legalAddress.formattedAddress.trim(),
    },
    coordinates: record.coordinates || null,
    branchAddress: record.legalAddress.formattedAddress.trim(),
    latitude: record.coordinates?.latitude ?? null,
    longitude: record.coordinates?.longitude ?? null,
    googleMapsUrl: record.googleMapsUrl.trim(),
    isActive: record.status === BRANCH_STATUS.ACTIVE,
    status: record.status,
    supportedContractTemplates: [...record.supportedContractTemplates],
    approvalReference: record.approvalReference.trim(),
    sourceDocumentReference: record.sourceDocumentReference?.trim() || null,
    legalDataApprovedBy: new ObjectId(String(record.legalDataApprovedBy)),
    legalDataApprovedAt: new Date(record.legalDataApprovedAt),
    createdAt: now,
    updatedAt: now,
  };
}

class BranchRepository {
  constructor(db) {
    this.collection = db.collection('branches');
  }

  async findByBranchId(branchId) {
    return this.collection.findOne({ branchId });
  }

  async createApproved(record, now = new Date()) {
    const document = canonicalBranchDocument(record, now);
    const existing = await this.collection.findOne({
      $or: [{ branchId: document.branchId }, { slug: document.slug }],
    });
    if (existing) {
      const comparable = ['branchId', 'slug', 'branchCode', 'legalName', 'displayName', 'branchName', 'legalAddress', 'branchAddress', 'coordinates', 'latitude', 'longitude', 'googleMapsUrl', 'isActive', 'status', 'supportedContractTemplates', 'approvalReference', 'sourceDocumentReference'];
      const unchanged = comparable.every((key) => JSON.stringify(existing[key] ?? null) === JSON.stringify(document[key] ?? null));
      if (!unchanged) throw new Error('Existing legal branch data differs; silent overwrite is prohibited.');
      return { created: false, recordId: existing._id, idempotent: true };
    }
    const result = await this.collection.insertOne(document);
    return { created: true, recordId: result.insertedId, idempotent: false };
  }
}

module.exports = {
  BRANCH_ID_PATTERN,
  SLUG_PATTERN,
  validateBranchRecord,
  validateLegalAddress,
  validateCoordinates,
  canonicalBranchDocument,
  BranchRepository,
};
