import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MOBILE_API_BASE_URL } from '../config/api';
import { getSessionToken } from './secureCredentials';

const ROOT = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}tenant-documents/`;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export const documentUrl = (kind, id) => {
  if (kind === 'bill') return `${MOBILE_API_BASE_URL}/billing/${encodeURIComponent(id)}/pdf`;
  if (kind === 'policy' || kind === 'contract') return `${MOBILE_API_BASE_URL}/documents/${encodeURIComponent(id)}`;
  if (kind === 'user') return `${MOBILE_API_BASE_URL}/users/documents/${encodeURIComponent(id)}/content`;
  return null;
};

const safePart = (value) => String(value || 'document').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
export const cachedDocumentPath = (userId, kind, id) =>
  `${ROOT}${safePart(userId)}/${safePart(kind)}_${safePart(id)}.pdf`;

async function ensureParent(uri) {
  await FileSystem.makeDirectoryAsync(uri.slice(0, uri.lastIndexOf('/')), { intermediates: true });
}

export async function validatePdf(uri, headers = {}) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('MISSING_FILE');
  if (!info.size) throw new Error('EMPTY_FILE');
  if (info.size > MAX_PDF_BYTES) throw new Error('FILE_TOO_LARGE');
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  if (contentType && !contentType.includes('application/pdf') && !contentType.includes('octet-stream')) {
    throw new Error('WRONG_MIME');
  }
  const prefix = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 5,
  });
  if (!prefix.startsWith('JVBERi0')) throw new Error('INVALID_PDF');
  return info;
}

export async function getCachedPdf(userId, kind, id) {
  const uri = cachedDocumentPath(userId, kind, id);
  try {
    await validatePdf(uri);
    return uri;
  } catch (_) {
    return null;
  }
}

export async function fetchPdf({ userId, kind, id, onProgress }) {
  let url = documentUrl(kind, id);
  let useAuthorization = true;
  if (!url) throw new Error('INVALID_ID');
  const token = await getSessionToken();
  if (!token) throw new Error('UNAUTHENTICATED');
  const uri = cachedDocumentPath(userId, kind, id);
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
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const error = new Error(`HTTP_${result?.status || 0}`);
    error.status = result?.status;
    throw error;
  }
  try {
    const info = await validatePdf(result.uri, result.headers);
    return { uri: result.uri, size: info.size, cached: false };
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}

export async function sharePdf(uri, title) {
  await validatePdf(uri);
  if (!(await Sharing.isAvailableAsync())) throw new Error('SHARING_UNAVAILABLE');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
}

export async function getPdfMetadata(uri) {
  const info = await validatePdf(uri);
  return { size: info.size || 0, modifiedAt: info.modificationTime ? new Date(info.modificationTime * 1000) : null };
}

export async function downloadPdf(uri, title = 'document') {
  await validatePdf(uri);
  const filename = `${safePart(title)}_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
  if (FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) throw new Error('DOWNLOAD_CANCELLED');
    const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename, 'application/pdf');
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
  if (!hasNetwork || /Network|timeout|HTTP_0/i.test(code)) return 'Internet connection required to load this document.';
  if (error?.status === 403 || code === 'HTTP_403') return 'You do not have permission to view this document.';
  if (error?.status === 404 || code === 'HTTP_404' || code === 'MISSING_FILE') return 'The requested document could not be found.';
  if (['EMPTY_FILE', 'WRONG_MIME', 'INVALID_PDF'].includes(code)) return 'This file is damaged or is not a valid PDF.';
  if (code === 'FILE_TOO_LARGE') return 'This PDF is too large to open safely on this device.';
  if (code === 'DOWNLOAD_CANCELLED') return 'Download cancelled.';
  if (code === 'INVALID_ID') return 'This document link is invalid.';
  if (code === 'UNAUTHENTICATED') return 'Please sign in again to view this document.';
  return 'The document could not be loaded. Please try again.';
}
