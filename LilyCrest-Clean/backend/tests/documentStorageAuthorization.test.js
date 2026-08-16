'use strict';

// Unit tests for the MOB-P0-01 storage-authorization invariant itself:
// a document's downloadUrl, storagePath, and the configured bucket must all
// identify the exact same object under the authenticated tenant's own
// upload prefix. See backend/services/documentStorageAuthorization.service.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizeTenantStorageObject,
  decodeFirebaseDownloadUrl,
  tenantDocumentPrefix,
} = require('../services/documentStorageAuthorization.service');

const BUCKET = 'lilycrest-test.firebasestorage.app';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function ownPath(userId, suffix = 'government_id/1700000000000-id.jpg') {
  return `${tenantDocumentPrefix(userId)}${suffix}`;
}

function downloadUrlFor(path, bucket = BUCKET) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}?alt=media&token=test-token`;
}

test('accepts a storagePath that matches the download URL and the tenant own prefix', () => {
  const path = ownPath(TENANT_A);
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(path),
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.objectPath, path);
});

test('rejects a foreign tenant storagePath even with a self-consistent URL', () => {
  const foreignPath = ownPath(TENANT_B);
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(foreignPath),
    storagePath: foreignPath,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'wrong_prefix');
});

test('rejects when the submitted storagePath does not match the decoded URL object path (own valid URL paired with a foreign path)', () => {
  const own = ownPath(TENANT_A);
  const foreign = ownPath(TENANT_B);
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(own), // a genuinely valid URL for tenant A's own object
    storagePath: foreign, // but the client submits tenant B's object path alongside it
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'wrong_prefix');
});

test('rejects when the URL genuinely points elsewhere even though the submitted storagePath looks like the tenant own object', () => {
  const own = ownPath(TENANT_A);
  const foreign = ownPath(TENANT_B);
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(foreign), // URL genuinely points at tenant B's object
    storagePath: own, // but the client claims it's tenant A's own path
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'url_path_mismatch');
});

test('rejects a URL whose object path does not equal the submitted storagePath', () => {
  const path = ownPath(TENANT_A);
  const otherOwnPath = ownPath(TENANT_A, 'passport/1700000000001-other.jpg');
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(otherOwnPath),
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'url_path_mismatch');
});

test('rejects a URL pointing at a different bucket than configured', () => {
  const path = ownPath(TENANT_A);
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(path, 'attacker-bucket.firebasestorage.app'),
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'wrong_bucket');
});

test('rejects an unrecognized/non-canonical download URL host', () => {
  const path = ownPath(TENANT_A);
  const result = authorizeTenantStorageObject({
    downloadUrl: `https://evil.example.com/${encodeURIComponent(path)}`,
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'unrecognized_url');
  assert.equal(decodeFirebaseDownloadUrl(`https://evil.example.com/${path}`), null);
});

test('rejects a malformed Firebase URL that does not match the /v0/b/.../o/... shape', () => {
  const path = ownPath(TENANT_A);
  const result = authorizeTenantStorageObject({
    downloadUrl: `https://firebasestorage.googleapis.com/download/${encodeURIComponent(path)}`,
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'unrecognized_url');
});

test('rejects raw path traversal in the submitted storagePath', () => {
  const traversal = `${tenantDocumentPrefix(TENANT_A)}../${tenantDocumentPrefix(TENANT_B)}secret.jpg`;
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(traversal),
    storagePath: traversal,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
});

test('rejects encoded (%2e%2e / %2f) traversal tricks inside the URL object segment', () => {
  const encodedTraversalSegment = 'tenant-documents/tenant-a/government_id/%2e%2e%2f%2e%2e%2ftenant-documents%2ftenant-b%2fsecret.jpg';
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o/${encodedTraversalSegment}?alt=media&token=x`;
  assert.equal(decodeFirebaseDownloadUrl(url), null);
});

test('rejects a storagePath outside the tenant-documents namespace even if it starts with the tenant id', () => {
  const path = `other-folder/${TENANT_A}/leak.jpg`;
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(path),
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: BUCKET,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'wrong_prefix');
});

test('fails closed on missing bucket configuration rather than allowing an unverifiable object', () => {
  const path = ownPath(TENANT_A);
  const result = authorizeTenantStorageObject({
    downloadUrl: downloadUrlFor(path),
    storagePath: path,
    userId: TENANT_A,
    configuredBucket: '',
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'missing_input');
});
