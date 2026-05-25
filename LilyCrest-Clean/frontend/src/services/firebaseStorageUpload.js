import * as FileSystem from 'expo-file-system/legacy';
import { api } from './api';

const LOCAL_ONLY_URI_PATTERN = /^(?:file|content|ph|assets-library|blob|ms-appdata):\/\/|^\/data\/user\/|^\/storage\/|^\/private\/var\/|^\/var\/mobile\/|(?:^|[\\/])cache(?:[\\/]|$)/i;
const NEEDS_CACHE_COPY_PATTERN = /^(?:content|ph|assets-library):\/\//i;
const ABSOLUTE_LOCAL_PATH_PATTERN = /^\/(?:data\/user\/|storage\/|private\/var\/|var\/mobile\/)/i;
const IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const DOCUMENT_NAME_PATTERN = /\.(pdf|docx?|txt|csv)$/i;

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_UPLOAD_BYTES = 10 * 1024 * 1024;
export const IMAGE_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
];
export const DOCUMENT_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
];
export const DEFAULT_UPLOAD_MIME_TYPES = [
  ...IMAGE_UPLOAD_MIME_TYPES,
  ...DOCUMENT_UPLOAD_MIME_TYPES,
];

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

const EXTENSION_MIME_TYPE_MAP = Object.entries(MIME_TYPE_EXTENSION_MAP).reduce((acc, [mimeType, extension]) => {
  if (!acc[extension]) acc[extension] = mimeType;
  return acc;
}, {});

export function isLocalOnlyAttachmentUri(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return false;
  }
  return LOCAL_ONLY_URI_PATTERN.test(normalized);
}

export function isUploadedHttpsAttachmentUri(value = '') {
  return /^https:\/\//i.test(String(value || '').trim());
}

export function getAttachmentDownloadUrl(attachment = {}) {
  if (typeof attachment === 'string') return attachment.trim();
  return String(
    attachment?.downloadUrl
    || attachment?.download_url
    || attachment?.fileUrl
    || attachment?.file_url
    || attachment?.signedUrl
    || attachment?.secure_url
    || attachment?.url
    || attachment?.uri
    || ''
  ).trim();
}

export function isInvalidFinalAttachmentUrl(value = '') {
  const normalized = String(value || '').trim();
  return !normalized || isLocalOnlyAttachmentUri(normalized) || !isUploadedHttpsAttachmentUri(normalized);
}

export function getAttachmentDisplayName(attachment = {}, index = 0) {
  const rawName = String(
    attachment?.originalName
    || attachment?.fileName
    || attachment?.filename
    || attachment?.name
    || ''
  ).trim();
  if (rawName) return rawName;

  const url = getAttachmentDownloadUrl(attachment);
  const urlName = decodeURIComponent(String(url).split('?')[0].split('/').filter(Boolean).pop() || '').trim();
  return urlName || `attachment-${index + 1}`;
}

function getNameExtension(name = '') {
  const match = String(name || '').trim().match(/\.[a-z0-9]+$/i);
  return match?.[0]?.toLowerCase() || '';
}

function inferMimeTypeFromName(name = '') {
  return EXTENSION_MIME_TYPE_MAP[getNameExtension(name)] || '';
}

export function getAttachmentMimeType(attachment = {}, index = 0) {
  const explicit = String(attachment?.mimeType || attachment?.contentType || attachment?.type || '').trim().toLowerCase();
  if (explicit && explicit !== 'image' && explicit !== 'application/octet-stream') {
    return explicit;
  }
  return inferMimeTypeFromName(getAttachmentDisplayName(attachment, index)) || explicit || 'application/octet-stream';
}

export function isImageAttachmentCandidate(attachment = {}) {
  const type = getAttachmentMimeType(attachment).toLowerCase();
  const name = getAttachmentDisplayName(attachment).toLowerCase();
  const url = getAttachmentDownloadUrl(attachment).toLowerCase();
  return type.startsWith('image/') || IMAGE_NAME_PATTERN.test(name) || IMAGE_NAME_PATTERN.test(url);
}

export function isDocumentAttachmentCandidate(attachment = {}) {
  const type = getAttachmentMimeType(attachment).toLowerCase();
  const name = getAttachmentDisplayName(attachment).toLowerCase();
  return DOCUMENT_UPLOAD_MIME_TYPES.includes(type) || DOCUMENT_NAME_PATTERN.test(name);
}

function normalizeLocalUploadUri(uri = '') {
  const normalized = String(uri || '').trim();
  if (!normalized) return normalized;
  if (ABSOLUTE_LOCAL_PATH_PATTERN.test(normalized)) {
    return `file://${normalized}`;
  }
  return normalized;
}

function sanitizePathSegment(value = '', fallback = 'unknown') {
  const clean = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function safeFileName(attachment = {}, index = 0) {
  const displayName = getAttachmentDisplayName(attachment, index);
  const extension = getNameExtension(displayName)
    || MIME_TYPE_EXTENSION_MAP[getAttachmentMimeType(attachment, index)]
    || '.bin';
  const base = displayName.replace(/\.[a-z0-9]+$/i, '') || `attachment-${index + 1}`;
  return `${sanitizePathSegment(base, `attachment-${index + 1}`)}${extension}`;
}

function mimeMatches(mimeType = '', allowedMimeTypes = DEFAULT_UPLOAD_MIME_TYPES) {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (!allowedMimeTypes?.length) return true;
  return allowedMimeTypes.some((allowed) => {
    const rule = String(allowed || '').trim().toLowerCase();
    if (!rule) return false;
    if (rule.endsWith('/*')) return normalized.startsWith(rule.slice(0, -1));
    return normalized === rule;
  });
}

async function prepareUploadSource(attachment = {}, index = 0) {
  const localUri = normalizeLocalUploadUri(getAttachmentDownloadUrl(attachment));
  if (!NEEDS_CACHE_COPY_PATTERN.test(localUri)) {
    return { uploadUri: localUri, cleanupUri: null };
  }

  const cacheDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheDirectory) {
    throw new Error('Upload failed, please retry');
  }

  const tempUri = `${cacheDirectory}lilycrest-upload-${Date.now()}-${index}-${safeFileName(attachment, index)}`;
  try {
    await FileSystem.copyAsync({ from: localUri, to: tempUri });
    return { uploadUri: tempUri, cleanupUri: tempUri };
  } catch (_) {
    throw new Error('Upload failed, please retry');
  }
}

async function getLocalFileSize(uri = '') {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return typeof info?.size === 'number' ? info.size : null;
  } catch (_) {
    return null;
  }
}

function inferProvider(downloadUrl = '', provider = '') {
  if (provider) return provider;
  return /firebasestorage(?:\.googleapis\.com|\.app)/i.test(downloadUrl)
    ? 'firebase-storage'
    : 'https-url';
}

function normalizeExistingHttpsAttachment(attachment = {}, index = 0) {
  const downloadUrl = getAttachmentDownloadUrl(attachment);
  if (isInvalidFinalAttachmentUrl(downloadUrl)) {
    throw new Error('Upload failed, please retry');
  }

  const originalName = getAttachmentDisplayName(attachment, index);
  const mimeType = getAttachmentMimeType(attachment, index);
  const uploadedAt = attachment?.uploadedAt || attachment?.uploaded_at || new Date().toISOString();
  const provider = inferProvider(downloadUrl, attachment?.provider);

  return {
    downloadUrl,
    storagePath: attachment?.storagePath || '',
    originalName,
    mimeType,
    size: typeof attachment?.size === 'number' ? attachment.size : null,
    uploadedAt,
    provider,
    name: originalName,
    uri: downloadUrl,
    type: mimeType,
  };
}

export function toStoredAttachmentMetadata(attachment = {}) {
  const downloadUrl = getAttachmentDownloadUrl(attachment);
  const originalName = getAttachmentDisplayName(attachment);
  const mimeType = getAttachmentMimeType(attachment);
  const size = typeof attachment?.size === 'number'
    ? attachment.size
    : typeof attachment?.fileSize === 'number'
      ? attachment.fileSize
      : null;

  return {
    downloadUrl,
    storagePath: String(attachment?.storagePath || '').trim(),
    originalName,
    mimeType,
    size,
    uploadedAt: attachment?.uploadedAt || new Date().toISOString(),
    provider: inferProvider(downloadUrl, attachment?.provider),
  };
}

export async function uploadAttachmentToFirebaseStorage(attachment = {}, options = {}) {
  const {
    allowedMimeTypes = DEFAULT_UPLOAD_MIME_TYPES,
    entityId = 'temp',
    folder = 'tenant-uploads',
    index = 0,
    maxBytes = MAX_ATTACHMENT_UPLOAD_BYTES,
    tenantId = 'unknown-tenant',
  } = options;

  const sourceUri = normalizeLocalUploadUri(getAttachmentDownloadUrl(attachment));
  if (!sourceUri || !isLocalOnlyAttachmentUri(sourceUri)) {
    throw new Error('Upload failed, please retry');
  }

  const originalName = getAttachmentDisplayName(attachment, index);
  const mimeType = getAttachmentMimeType(attachment, index);
  if (!mimeMatches(mimeType, allowedMimeTypes)) {
    throw new Error('Unsupported file type.');
  }

  const providedSize = typeof attachment?.size === 'number'
    ? attachment.size
    : typeof attachment?.fileSize === 'number'
      ? attachment.fileSize
      : null;
  if (typeof providedSize === 'number' && providedSize > maxBytes) {
    throw new Error(`Attachment exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
  }

  const { uploadUri, cleanupUri } = await prepareUploadSource({ ...attachment, uri: sourceUri }, index);
  try {
    const localSize = typeof providedSize === 'number' ? providedSize : await getLocalFileSize(uploadUri);
    if (typeof localSize === 'number' && localSize > maxBytes) {
      throw new Error(`Attachment exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
    }

    const dataBase64 = await FileSystem.readAsStringAsync(uploadUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const response = await api.post('/upload/firebase-storage', {
      allowedMimeTypes,
      dataBase64,
      entityId,
      fileName: originalName,
      folder,
      maxBytes,
      mimeType,
      size: localSize,
      tenantId,
    }, { timeout: 90000 });

    return response.data;
  } finally {
    if (cleanupUri) {
      FileSystem.deleteAsync(cleanupUri, { idempotent: true }).catch(() => undefined);
    }
  }
}

export async function ensureFirebaseStorageAttachments(attachments = [], options = {}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  const uploaded = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index] || {};
    const downloadUrl = getAttachmentDownloadUrl(attachment);

    if (isUploadedHttpsAttachmentUri(downloadUrl)) {
      uploaded.push(normalizeExistingHttpsAttachment(attachment, index));
      continue;
    }

    if (!isLocalOnlyAttachmentUri(downloadUrl)) {
      throw new Error('Upload failed, please retry');
    }

    uploaded.push(await uploadAttachmentToFirebaseStorage(attachment, { ...options, index }));
  }

  return uploaded;
}
