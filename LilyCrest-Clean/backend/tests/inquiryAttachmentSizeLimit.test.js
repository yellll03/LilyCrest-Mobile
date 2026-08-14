'use strict';

// Regression coverage for the inquiry (tenant-submitted maintenance request +
// follow-up reply) attachment size cap. QA requirement: exactly 5MB max per
// attachment for every supported inquiry MIME type (image, PDF, or other
// supported document type) — the generic upload endpoint's larger per-mime
// ceiling (routes/upload.routes.js) must never be inherited here, since
// normalizeTenantAttachments (used by both createMaintenance and
// addTenantMaintenanceReply) is the actual gate that accepts an attachment
// into an inquiry record, independent of which folder/mimeType the raw
// upload used.

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTenantAttachments, INQUIRY_ATTACHMENT_MAX_BYTES } = require('../controllers/maintenance.controller');

const IMAGE_URL = 'https://firebasestorage.googleapis.com/v0/b/test/o/photo.jpg?alt=media&token=image-token';
const PDF_URL = 'https://firebasestorage.googleapis.com/v0/b/test/o/report.pdf?alt=media&token=pdf-token';

function imageAttachment(size) {
  return {
    downloadUrl: IMAGE_URL,
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    storagePath: 'maintenance-attachments/tenant-a/temp/photo.jpg',
    provider: 'firebase-storage',
    size,
  };
}

function pdfAttachment(size) {
  return {
    downloadUrl: PDF_URL,
    originalName: 'report.pdf',
    mimeType: 'application/pdf',
    storagePath: 'maintenance-attachments/tenant-a/temp/report.pdf',
    provider: 'firebase-storage',
    size,
  };
}

test('the inquiry cap is exactly 5MB', () => {
  assert.equal(INQUIRY_ATTACHMENT_MAX_BYTES, 5 * 1024 * 1024);
});

test('inquiry image under 5MB is accepted', () => {
  const { attachments, error } = normalizeTenantAttachments([imageAttachment(INQUIRY_ATTACHMENT_MAX_BYTES - 1)]);
  assert.equal(error, null);
  assert.equal(attachments.length, 1);
});

test('inquiry image exactly 5MB is accepted', () => {
  const { attachments, error } = normalizeTenantAttachments([imageAttachment(INQUIRY_ATTACHMENT_MAX_BYTES)]);
  assert.equal(error, null);
  assert.equal(attachments.length, 1);
});

test('inquiry image over 5MB is rejected', () => {
  const { attachments, error } = normalizeTenantAttachments([imageAttachment(INQUIRY_ATTACHMENT_MAX_BYTES + 1)]);
  assert.match(error, /5 MB/);
  assert.equal(attachments.length, 0);
});

test('inquiry PDF under 5MB is accepted', () => {
  const { attachments, error } = normalizeTenantAttachments([pdfAttachment(INQUIRY_ATTACHMENT_MAX_BYTES - 1)]);
  assert.equal(error, null);
  assert.equal(attachments.length, 1);
});

test('inquiry PDF exactly 5MB is accepted', () => {
  const { attachments, error } = normalizeTenantAttachments([pdfAttachment(INQUIRY_ATTACHMENT_MAX_BYTES)]);
  assert.equal(error, null);
  assert.equal(attachments.length, 1);
});

test('inquiry PDF over 5MB is rejected', () => {
  const { attachments, error } = normalizeTenantAttachments([pdfAttachment(INQUIRY_ATTACHMENT_MAX_BYTES + 1)]);
  assert.match(error, /5 MB/);
  assert.equal(attachments.length, 0);
});

test('a missing/non-numeric size cannot be used to smuggle an oversized inquiry attachment past the check', () => {
  const withoutSize = imageAttachment(undefined);
  delete withoutSize.size;
  const { attachments, error } = normalizeTenantAttachments([withoutSize]);
  assert.match(error, /5 MB/);
  assert.equal(attachments.length, 0);
});

test('an inquiry attachment cannot inherit the generic 10MB document ceiling used elsewhere in the app', () => {
  // 6MB PDF: well under the generic upload endpoint's 10MB document ceiling,
  // but must still be rejected by the inquiry-specific 5MB gate.
  const sixMb = 6 * 1024 * 1024;
  const { attachments, error } = normalizeTenantAttachments([pdfAttachment(sixMb)]);
  assert.match(error, /5 MB/);
  assert.equal(attachments.length, 0);
});
