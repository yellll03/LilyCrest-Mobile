import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MOBILE_API_BASE_URL } from '../config/api';
import { getSessionToken } from './secureCredentials';

const ROOT = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}tenant-documents/`;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
const CACHE_BUILD_KEY = 'tenant_document_cache_build';
// Cache files are version-keyed (see cachedDocumentPath's cacheKey param), so
// a superseded statement/contract just becomes an orphaned file under a new
// sibling name instead of being overwritten — nothing else ever deletes the
// old one. Without a ceiling, a long-lived install accumulates every version
// of every document a tenant has ever opened.
const MAX_CACHE_BYTES = 150 * 1024 * 1024;
const MAX_CACHE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export const documentUrl = (kind, id) => {
  if (kind === 'bill') return `${MOBILE_API_BASE_URL}/billing/${encodeURIComponent(id)}/pdf`;
  if (kind === 'bill-receipt') return `${MOBILE_API_BASE_URL}/billing/${encodeURIComponent(id)}/receipt`;
  if (kind === 'policy') return `${MOBILE_API_BASE_URL}/documents/${encodeURIComponent(id)}`;
  if (kind === 'contract-prepared') return `${MOBILE_API_BASE_URL}/contracts/${encodeURIComponent(id)}/documents/prepared`;
  if (kind === 'contract-final') return `${MOBILE_API_BASE_URL}/contracts/${encodeURIComponent(id)}/documents/final`;
  return null;
};

// `kind === 'user'` documents (uploaded, reservation-derived, and generated
// contracts) are served as a binary stream from GET /users/documents/:docId/content
// — the metadata endpoint (GET /users/documents/:docId) intentionally omits
// file_data/file_url/storagePath, so the bytes must come from /content, the
// same endpoint imageDocumentManager.js already uses for images.
const userDocumentContentUrl = (id) => `${MOBILE_API_BASE_URL}/users/documents/${encodeURIComponent(id)}/content`;

async function fetchUserDocumentPdf({ userId, id, onProgress }) {
  const token = await getSessionToken();
  if (!token) throw new Error('UNAUTHENTICATED');

  const uri = cachedDocumentPath(userId, 'user', id);
  await ensureParent(uri);

  const task = FileSystem.createDownloadResumable(
    userDocumentContentUrl(id),
    uri,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress?.(totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0);
    },
  );
  const result = await task.downloadAsync();
  if (!result?.uri || result.status < 200 || result.status >= 300) {
    const error = await downloadHttpError(result, uri);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }

  try {
    const info = await validateDocumentFile(uri, result.headers);
    await writeSidecar(uri, info);
    return { uri, size: info.size, mimeType: info.mimeType, extension: info.kind, cached: false };
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}

// expo-file-system writes a non-2xx response body to the destination path.
// Read the backend's structured error before deleting that failed download so
// callers can distinguish a physically missing Contract artifact (410) from
// a transient or generic HTTP failure.
async function downloadHttpError(result, fallbackUri) {
  const status = result?.status || 0;
  let payload = null;
  const responseUri = result?.uri || fallbackUri;
  if (responseUri) {
    try {
      payload = JSON.parse(await FileSystem.readAsStringAsync(responseUri));
    } catch (_) {
      payload = null;
    }
  }
  const error = new Error(`HTTP_${status}`);
  error.status = status;
  error.serverCode = payload?.code || payload?.error?.code || null;
  error.serverMessage = payload?.error?.message || payload?.error || payload?.detail || null;
  return error;
}

const safePart = (value) => String(value || 'document').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
// `cacheKey` defaults to `id` for document kinds with no versioning concept.
// Contract PDFs pass a version-aware cacheKey (see contractPresentation.js's
// documentCacheKey) so a regenerated prepared version, or a final document
// replacing a draft, never resolves to a stale cached file under the same
// contract id.
export const cachedDocumentPath = (userId, kind, id, cacheKey) =>
  `${ROOT}${safePart(userId)}/${safePart(kind)}_${safePart(cacheKey || id)}.pdf`;

async function ensureParent(uri) {
  await FileSystem.makeDirectoryAsync(uri.slice(0, uri.lastIndexOf('/')), { intermediates: true });
}

export async function clearDocumentCache() {
  await FileSystem.deleteAsync(ROOT, { idempotent: true });
}

// Cached PDFs live in app storage and survive an over-the-top APK update
// (only clearDocumentCache() on logout wipes them). A cached statement or
// contract generated by an older build could otherwise keep showing stale
// content after a fix ships. Call once on app startup — clears the cache the
// first time a new build/commit runs, then no-ops on every later launch of
// that same build.
export async function clearDocumentCacheIfStaleBuild() {
  const currentBuild = `${Constants.expoConfig?.version || '0'}:${Constants.expoConfig?.extra?.gitCommit || 'unknown'}`;
  const lastClearedBuild = await AsyncStorage.getItem(CACHE_BUILD_KEY).catch(() => null);
  if (lastClearedBuild === currentBuild) return;
  await clearDocumentCache();
  await AsyncStorage.setItem(CACHE_BUILD_KEY, currentBuild).catch(() => {});
}

async function listCacheFilesRecursive(dir) {
  const entries = await FileSystem.readDirectoryAsync(dir).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryUri = `${dir}${entry}`;
    const info = await FileSystem.getInfoAsync(entryUri).catch(() => null);
    if (!info?.exists) continue;
    if (info.isDirectory) {
      files.push(...await listCacheFilesRecursive(`${entryUri}/`));
    } else {
      files.push({ uri: entryUri, size: info.size || 0, modificationTime: info.modificationTime || 0 });
    }
  }
  return files;
}

// Deletes anything older than MAX_CACHE_AGE_MS, then — if the directory is
// still over MAX_CACHE_BYTES — deletes oldest-first until it's back under
// the ceiling. Call on app startup alongside clearDocumentCacheIfStaleBuild;
// safe to call anytime since it only ever removes files, never the directory.
export async function evictStaleDocumentCache() {
  const files = await listCacheFilesRecursive(ROOT);
  if (!files.length) return;

  const now = Date.now();
  const keep = [];
  for (const file of files) {
    if (now - file.modificationTime * 1000 > MAX_CACHE_AGE_MS) {
      await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
    } else {
      keep.push(file);
    }
  }

  let totalBytes = keep.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= MAX_CACHE_BYTES) return;

  keep.sort((a, b) => a.modificationTime - b.modificationTime);
  for (const file of keep) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
    totalBytes -= file.size;
  }
}

// The backend accepts PDF, JPG/JPEG, or PNG for a wet-signed contract scan
// (see CONTRACT_MOBILE_DISPLAY_WORKFLOW.md — the standard signing path
// uploads whatever format the admin scanned), so a "current document" is not
// always a PDF. Detected from the file's own magic bytes rather than trusted
// content-type alone, matching the existing PDF-only check's approach.
const DOCUMENT_SIGNATURES = [
  { prefix: 'JVBERi0', mimeType: 'application/pdf', extension: 'pdf', rawBytes: 5 },
  { prefix: '/9j/', mimeType: 'image/jpeg', extension: 'jpg', rawBytes: 3 },
  { prefix: 'iVBORw0KGgo', mimeType: 'image/png', extension: 'png', rawBytes: 8 },
];
const SIGNATURE_PROBE_BYTES = Math.max(...DOCUMENT_SIGNATURES.map((sig) => sig.rawBytes));

function detectDocumentSignature(base64Prefix) {
  return DOCUMENT_SIGNATURES.find((sig) => base64Prefix.startsWith(sig.prefix)) || null;
}

export async function validateDocumentFile(uri, headers = {}) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('MISSING_FILE');
  if (!info.size) throw new Error('EMPTY_FILE');
  if (info.size > MAX_PDF_BYTES) throw new Error('FILE_TOO_LARGE');
  const prefix = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: SIGNATURE_PROBE_BYTES,
  });
  const signature = detectDocumentSignature(prefix);
  if (!signature) throw new Error('INVALID_PDF');
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  if (contentType && !contentType.includes(signature.mimeType) && !contentType.includes('octet-stream')) {
    throw new Error('WRONG_MIME');
  }
  return { ...info, kind: signature.extension, mimeType: signature.mimeType };
}

// Cache lookups must know the file's real kind (pdf vs jpg vs png) without a
// network round trip, so the detected mimeType/extension is written to a
// small sidecar file alongside the cached document the first time it's
// validated (see fetchPdf/fetchUserDocumentPdf below).
function sidecarPath(uri) {
  return `${uri}.kind`;
}

async function writeSidecar(uri, signature) {
  await FileSystem.writeAsStringAsync(sidecarPath(uri), `${signature.mimeType}|${signature.extension}`).catch(() => {});
}

async function readSidecar(uri) {
  try {
    const raw = await FileSystem.readAsStringAsync(sidecarPath(uri));
    const [mimeType, extension] = raw.split('|');
    return { mimeType, extension };
  } catch (_) {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
}

export async function getCachedPdf(userId, kind, id, cacheKey) {
  const uri = cachedDocumentPath(userId, kind, id, cacheKey);
  try {
    await validateDocumentFile(uri);
    const { mimeType, extension } = await readSidecar(uri);
    return { uri, mimeType, extension };
  } catch (_) {
    return null;
  }
}

export async function fetchPdf({ userId, kind, id, cacheKey, onProgress }) {
  if (kind === 'user') return fetchUserDocumentPdf({ userId, id, onProgress });

  let url = documentUrl(kind, id);
  let useAuthorization = true;
  if (!url) throw new Error('INVALID_ID');
  const token = await getSessionToken();
  if (!token) throw new Error('UNAUTHENTICATED');
  const uri = cachedDocumentPath(userId, kind, id, cacheKey);
  await ensureParent(uri);
  const task = FileSystem.createDownloadResumable(
    url,
    uri,
    { headers: { ...(useAuthorization ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/pdf' } },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress?.(totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0);
    },
  );
  const result = await task.downloadAsync();
  if (!result?.uri || result.status < 200 || result.status >= 300) {
    const error = await downloadHttpError(result, uri);
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
  try {
    const info = await validateDocumentFile(result.uri, result.headers);
    await writeSidecar(result.uri, info);
    return { uri: result.uri, size: info.size, mimeType: info.mimeType, extension: info.kind, cached: false };
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}

export async function sharePdf(uri, title) {
  const info = await validateDocumentFile(uri);
  if (!(await Sharing.isAvailableAsync())) throw new Error('SHARING_UNAVAILABLE');
  await Sharing.shareAsync(uri, {
    mimeType: info.mimeType,
    UTI: info.kind === 'pdf' ? 'com.adobe.pdf' : `public.${info.kind === 'jpg' ? 'jpeg' : info.kind}`,
    dialogTitle: title,
  });
}

export async function getPdfMetadata(uri) {
  const info = await validateDocumentFile(uri);
  return { size: info.size || 0, modifiedAt: info.modificationTime ? new Date(info.modificationTime * 1000) : null, mimeType: info.mimeType, extension: info.kind };
}

export async function downloadPdf(uri, title = 'document') {
  const info = await validateDocumentFile(uri);
  const filename = `${safePart(title)}_${new Date().toISOString().replace(/[:.]/g, '-')}.${info.kind}`;
  if (FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) throw new Error('DOWNLOAD_CANCELLED');
    const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename, info.mimeType);
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(destination, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { uri: destination, filename };
  }
  const destination = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return { uri: destination, filename };
}

export function documentErrorMessage(error, hasNetwork = true) {
  const code = String(error?.message || '');
  const serverCode = String(error?.serverCode || error?.code || '');
  if (!hasNetwork || /Network|timeout|HTTP_0/i.test(code)) return 'Internet connection required to load this document.';
  if (error?.status === 403 || code === 'HTTP_403') return 'You do not have permission to view this document.';
  if (error?.status === 404 || code === 'HTTP_404' || code === 'MISSING_FILE') return 'The requested document could not be found.';
  if (['FINAL_DOCUMENT_STORAGE_MISSING', 'CONTRACT_ARTIFACT_STORAGE_MISSING'].includes(serverCode)) {
    return 'The saved contract file is unavailable. Please contact the branch admin to replace the signed copy.';
  }
  if (serverCode === 'PREPARED_DOCUMENT_STORAGE_MISSING') {
    return 'The prepared contract file is unavailable. Please contact the branch admin to regenerate the contract.';
  }
  if (error?.status === 410 || code === 'HTTP_410') return 'Unable to load document at this time. Please try again later.';
  if (['EMPTY_FILE', 'WRONG_MIME', 'INVALID_PDF'].includes(code)) return 'This file is damaged or in an unsupported format.';
  if (code === 'FILE_TOO_LARGE') return 'This document is too large to open safely on this device.';
  if (code === 'DOWNLOAD_CANCELLED') return 'Download cancelled.';
  if (code === 'INVALID_ID') return 'This document link is invalid.';
  if (code === 'UNAUTHENTICATED') return 'Please sign in again to view this document.';
  return 'The document could not be loaded. Please try again.';
}
