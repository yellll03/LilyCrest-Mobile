'use strict';

// Regression coverage for the 5MB image / 10MB document upload ceilings
// enforced server-side in routes/upload.routes.js. A client-supplied
// maxBytes must never be able to relax the mime-type-appropriate ceiling
// (e.g. requesting a 10MB maxBytes for an image must still cap at 5MB),
// and the actual decoded buffer length — not a client-supplied `size`
// field — is what gets compared against it.

const test = require('node:test');
const assert = require('node:assert/strict');

const uploadRoutes = require('../routes/upload.routes');
const { resolveUploadMaxBytes, decodeBase64Payload, MAX_IMAGE_UPLOAD_BYTES, MAX_FIREBASE_UPLOAD_BYTES } = uploadRoutes.__test;

test('image mime types are capped at 5MB regardless of requested maxBytes', () => {
  assert.equal(resolveUploadMaxBytes('image/jpeg', undefined), MAX_IMAGE_UPLOAD_BYTES);
  assert.equal(MAX_IMAGE_UPLOAD_BYTES, 5 * 1024 * 1024);
  // A malicious/modified client asking for a bigger cap cannot relax it.
  assert.equal(resolveUploadMaxBytes('image/png', 10 * 1024 * 1024), MAX_IMAGE_UPLOAD_BYTES);
  assert.equal(resolveUploadMaxBytes('image/png', 999 * 1024 * 1024), MAX_IMAGE_UPLOAD_BYTES);
});

test('document mime types keep the 10MB ceiling', () => {
  assert.equal(resolveUploadMaxBytes('application/pdf', undefined), MAX_FIREBASE_UPLOAD_BYTES);
  assert.equal(MAX_FIREBASE_UPLOAD_BYTES, 10 * 1024 * 1024);
  assert.equal(resolveUploadMaxBytes('application/pdf', 999 * 1024 * 1024), MAX_FIREBASE_UPLOAD_BYTES);
});

test('a client-supplied maxBytes can only tighten the cap, never loosen it', () => {
  assert.equal(resolveUploadMaxBytes('image/jpeg', 1024), 1024);
  assert.equal(resolveUploadMaxBytes('application/pdf', 2048), 2048);
  // Non-finite / missing values fall back to the mime-type ceiling.
  assert.equal(resolveUploadMaxBytes('image/jpeg', 'not-a-number'), MAX_IMAGE_UPLOAD_BYTES);
});

test('decoded buffer length — not a spoofable client size field — is what gets checked', () => {
  const oneByteOverLimit = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1, 'a').toString('base64');
  const buffer = decodeBase64Payload(oneByteOverLimit);
  assert.ok(buffer.length > MAX_IMAGE_UPLOAD_BYTES);
  assert.ok(buffer.length > resolveUploadMaxBytes('image/jpeg', undefined));
});
