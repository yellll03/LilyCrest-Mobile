'use strict';

// Canonical storage-authorization invariant for tenant-uploaded documents
// (P0). POST /api/users/documents previously trusted a client-supplied
// `storagePath` outright: any authenticated tenant could register another
// tenant's real object path (or any path in the bucket) under their own
// document metadata, and the later GET .../content and DELETE endpoints
// would use privileged Firebase Admin access against that unverified path.
// This module is the single place that proves a storage object, its
// download URL, and the configured bucket all identify the exact same
// object under the authenticated tenant's own upload prefix — used both at
// metadata-registration time and again before every privileged read/delete
// of already-stored metadata (which may predate this invariant).
//
// The tenant prefix is keyed on req.user.user_id (not the Mongo _id) to
// match the real object layout POST /upload/firebase-storage writes to
// (backend/routes/upload.routes.js: `[folder, tenantId, entityId, ...]`,
// where tenantId = req.user.user_id) — that route is itself safe because it
// derives tenantId server-side and ignores any client-supplied value; this
// module exists for the separate /users/documents metadata-registration
// endpoint, which accepts a storagePath from the client directly and has no
// such guarantee on its own.

const TENANT_DOCUMENT_FOLDER = 'tenant-documents';

function safeSegment(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// Only the canonical `firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>`
// download URL shape (the exact format POST /upload/firebase-storage
// issues) can be decoded into a verifiable bucket/object pair. Any other
// host, path shape, or malformed encoding returns null so callers fail
// closed instead of guessing at an unfamiliar URL format.
function decodeFirebaseDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com') return null;

  const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  if (!match) return null;

  let bucket;
  let objectPath;
  try {
    bucket = decodeURIComponent(match[1]);
    objectPath = decodeURIComponent(match[2]);
  } catch (_) {
    return null;
  }
  if (!bucket || !objectPath) return null;

  // Reject traversal/ambiguous paths outright — a legitimate server-issued
  // path never contains these sequences. Also decode a second time and
  // re-check, so a double-encoded traversal attempt (e.g. `%252e%252e`,
  // which only becomes `..` after two decode passes) can't slip through a
  // single decodeURIComponent() call.
  const looksUnsafe = (value) => value.includes('..') || value.includes('\\') || value.startsWith('/') || value.includes('//');
  let doubleDecoded = objectPath;
  try {
    doubleDecoded = decodeURIComponent(objectPath);
  } catch (_) {
    // Not further percent-encoded — nothing more to decode, keep objectPath.
  }
  if (looksUnsafe(objectPath) || looksUnsafe(doubleDecoded)) return null;

  return { bucket, objectPath };
}

// `folder` is the top-level upload folder POST /upload/firebase-storage was
// called with. It defaults to tenant-documents so every existing caller is
// unchanged; support-chat attachments pass their own folder so they are
// authorized against the same prefix rule rather than needing a second,
// parallel authorization implementation.
function tenantDocumentPrefix(userId, folder = TENANT_DOCUMENT_FOLDER) {
  const tenant = safeSegment(userId);
  const scope = safeSegment(folder);
  return tenant && scope ? `${scope}/${tenant}/` : '';
}

// Proves that `storagePath` (as submitted by the client, or as previously
// stored) is genuinely the authenticated tenant's own object: it must sit
// under that tenant's upload prefix, and the download URL must decode to
// the exact same bucket + object path. Ambiguity of any kind is a denial —
// never a best-effort allow.
function authorizeTenantStorageObject({ downloadUrl, storagePath, userId, configuredBucket, folder = TENANT_DOCUMENT_FOLDER } = {}) {
  const submittedPath = String(storagePath || '').trim();
  const prefix = tenantDocumentPrefix(userId, folder);

  if (!submittedPath || !configuredBucket || !prefix) {
    return { authorized: false, reason: 'missing_input' };
  }
  if (submittedPath.includes('..') || submittedPath.includes('\\') || submittedPath.startsWith('/') || submittedPath.includes('//')) {
    return { authorized: false, reason: 'unsafe_path' };
  }
  if (!submittedPath.startsWith(prefix)) {
    return { authorized: false, reason: 'wrong_prefix' };
  }

  const decoded = decodeFirebaseDownloadUrl(downloadUrl);
  if (!decoded) {
    return { authorized: false, reason: 'unrecognized_url' };
  }
  if (decoded.bucket !== configuredBucket) {
    return { authorized: false, reason: 'wrong_bucket' };
  }
  if (decoded.objectPath !== submittedPath) {
    return { authorized: false, reason: 'url_path_mismatch' };
  }

  return { authorized: true, objectPath: submittedPath, bucket: decoded.bucket };
}

module.exports = {
  TENANT_DOCUMENT_FOLDER,
  decodeFirebaseDownloadUrl,
  tenantDocumentPrefix,
  authorizeTenantStorageObject,
};
