'use strict';

// Canonical support-chat attachment limits for this repository.
//
// These values are deliberately duplicated (not imported) in the separate
// Capstone-Website admin repository, which enforces the identical numbers in
// `server/controllers/chatController.js` and `server/routes/chatRoutes.js`.
// Each repo owns its own constant so neither deploys a build coupled to the
// other's source tree; the numbers below are the contract, and the cross-repo
// contract tests in both repos pin them.
//
// Anything that enforces a support-chat attachment rule must read from here.
// Maintenance-request and AI-assistant attachments are separate surfaces with
// their own, intentionally different caps — do not fold them into this module.

// Per message. The mobile compose UI, the mobile backend and the admin web
// backend all enforce this same number independently.
const MAX_SUPPORT_ATTACHMENTS = 5;

// Per file. Matches the admin repo's multer `limits.fileSize` and the
// `max: 5 * 1024 * 1024` on its ChatAttachment schema's `size` field, so a
// record written by either app validates in both.
const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

// The exact set the admin repo's chat upload `fileFilter` accepts, plus the
// non-standard `image/jpg` alias some Android pickers report for a JPEG.
// This is intentionally NARROWER than the general tenant-upload allow-list —
// support chat renders these inline in two clients, so the set stays small.
// Do not widen it without widening the admin repo's fileFilter in step.
const SUPPORT_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

// Storage prefix the upload endpoint scopes to `<folder>/<user_id>/`.
const SUPPORT_ATTACHMENT_FOLDER = 'support-attachments';

module.exports = {
  MAX_SUPPORT_ATTACHMENTS,
  SUPPORT_ATTACHMENT_FOLDER,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MIME_TYPES,
};
