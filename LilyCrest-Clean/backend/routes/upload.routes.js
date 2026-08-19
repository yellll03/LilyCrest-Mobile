const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware, tenantMiddleware } = require('../middleware/auth');
const { admin, resolveStorageBucket } = require('../config/firebase');

const router = express.Router();

const IMAGEKIT_PRIVATE_KEY = String(process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
// Hard ceilings enforced against the decoded upload buffer itself — never
// relaxed by a client-supplied maxBytes, since that value is untrusted input.
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_FIREBASE_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
]);
const ALLOWED_FIREBASE_UPLOAD_MIME_TYPES = new Set([
  ...IMAGE_UPLOAD_MIME_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
]);

const MIME_TYPE_EXTENSION_MAP = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

// 10 token requests per minute per IP — prevents key-exhaustion abuse
const imagekitAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many upload token requests. Please try again shortly.' },
});

router.get('/imagekit-auth', imagekitAuthLimiter, authMiddleware, tenantMiddleware, (req, res) => {
  if (!IMAGEKIT_PRIVATE_KEY) {
    return res.status(503).json({ detail: 'Image uploads are not configured.' });
  }

  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + (60 * 30);
  const signature = crypto
    .createHmac('sha1', IMAGEKIT_PRIVATE_KEY)
    .update(`${token}${expire}`)
    .digest('hex');

  return res.json({ token, expire, signature });
});

function sanitizePathSegment(value = '', fallback = 'upload') {
  const clean = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function safeFileName(fileName = '', mimeType = 'application/octet-stream') {
  const cleanName = sanitizePathSegment(fileName, 'attachment');
  if (/\.[a-z0-9]+$/i.test(cleanName)) return cleanName;
  return `${cleanName}${MIME_TYPE_EXTENSION_MAP[mimeType] || '.bin'}`;
}

function decodeBase64Payload(value = '') {
  const normalized = String(value || '').trim();
  const raw = normalized.replace(/^data:[^;]+;base64,/i, '');
  if (!raw || !/^[a-zA-Z0-9+/]+={0,2}$/.test(raw)) return null;
  return Buffer.from(raw, 'base64');
}

function requestedMimeTypes(body = {}) {
  if (!Array.isArray(body.allowedMimeTypes) || body.allowedMimeTypes.length === 0) {
    return null;
  }

  return new Set(
    body.allowedMimeTypes
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

// Content-signature check. A client declares its own mimeType, and
// safeFileName keeps whatever extension the file already had — so renaming
// `payload.exe` to `payload.pdf` (or simply declaring `application/pdf` for
// arbitrary bytes) would otherwise store executable content under a trusted
// content type that two clients then render inline.
//
// These signatures are checked against the *decoded buffer*, never against a
// client-supplied field. Only formats with an unambiguous magic number are
// listed; HEIC/HEIF and the office/text types have no reliable short prefix,
// so they are deliberately not asserted here rather than guessed at. This
// narrows what is accepted — it never widens the allow-list.
const MIME_TYPE_SIGNATURES = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/jpg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  'image/bmp': [[0x42, 0x4d]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
};

function matchesDeclaredContent(buffer, mimeType) {
  // WebP is RIFF????WEBP — a prefix plus a check at offset 8.
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii'))
      && buffer.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii'));
  }

  const signatures = MIME_TYPE_SIGNATURES[mimeType];
  // Unknown-to-us but allow-listed type (HEIC/HEIF, doc/docx, txt, csv):
  // no assertion is made rather than a wrong one.
  if (!signatures) return true;
  return signatures.some(
    (signature) => buffer.length >= signature.length
      && buffer.subarray(0, signature.length).equals(Buffer.from(signature))
  );
}

// The cap for this mime type is authoritative; a client-supplied maxBytes
// can only tighten it further, never loosen it (e.g. an image can't be
// pushed past MAX_IMAGE_UPLOAD_BYTES by requesting a larger maxBytes).
function resolveUploadMaxBytes(mimeType, requestedMaxBytes) {
  const mimeTypeCeiling = IMAGE_UPLOAD_MIME_TYPES.has(mimeType) ? MAX_IMAGE_UPLOAD_BYTES : MAX_FIREBASE_UPLOAD_BYTES;
  const requested = Number(requestedMaxBytes);
  return Number.isFinite(requested)
    ? Math.min(Math.max(1, requested), mimeTypeCeiling)
    : mimeTypeCeiling;
}

router.post('/firebase-storage', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const mimeType = String(req.body?.mimeType || req.body?.type || '').trim().toLowerCase();
    const fileName = safeFileName(req.body?.fileName || req.body?.name, mimeType);
    const buffer = decodeBase64Payload(req.body?.dataBase64);
    const requestedAllowedTypes = requestedMimeTypes(req.body);
    const maxBytes = resolveUploadMaxBytes(mimeType, req.body?.maxBytes);

    if (!buffer) {
      return res.status(400).json({ detail: 'Upload file data is required.' });
    }
    if (!ALLOWED_FIREBASE_UPLOAD_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ detail: 'Unsupported file type.' });
    }
    if (requestedAllowedTypes && !requestedAllowedTypes.has(mimeType)) {
      return res.status(400).json({ detail: 'Unsupported file type.' });
    }
    if (buffer.length > maxBytes) {
      return res.status(400).json({ detail: `Attachment exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.` });
    }
    if (!matchesDeclaredContent(buffer, mimeType)) {
      return res.status(400).json({ detail: 'This file does not match the file type it claims to be.' });
    }

    const bucketName = resolveStorageBucket();
    if (!bucketName) {
      return res.status(503).json({ detail: 'File uploads are not configured.' });
    }

    const folder = sanitizePathSegment(req.body?.folder, 'tenant-uploads');
    const tenantId = sanitizePathSegment(req.user?.user_id || 'unknown-tenant', 'unknown-tenant');
    const entityId = sanitizePathSegment(req.body?.entityId, 'temp');
    const storagePath = [
      folder,
      tenantId,
      entityId,
      `${Date.now()}-${fileName}`,
    ].join('/');

    const downloadToken = require('crypto').randomUUID();
    const bucket = admin.storage().bucket(bucketName);
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          originalName: fileName,
          provider: 'firebase-storage',
          tenantId,
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
    const uploadedAt = new Date().toISOString();

    return res.status(201).json({
      downloadUrl,
      storagePath,
      originalName: fileName,
      mimeType,
      size: buffer.length,
      uploadedAt,
      provider: 'firebase-storage',
      name: fileName,
      uri: downloadUrl,
      type: mimeType,
    });
  } catch (error) {
    console.error('Firebase Storage upload error:', error);
    return res.status(500).json({ detail: 'Upload failed, please retry.' });
  }
});

router.__test = {
  matchesDeclaredContent,
  resolveUploadMaxBytes,
  decodeBase64Payload,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_FIREBASE_UPLOAD_BYTES,
  IMAGE_UPLOAD_MIME_TYPES,
};

module.exports = router;
