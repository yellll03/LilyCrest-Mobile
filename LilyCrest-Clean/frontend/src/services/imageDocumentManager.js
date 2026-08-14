import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { MOBILE_API_BASE_URL } from '../config/api';
import { getSessionToken } from './secureCredentials';

const ROOT = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}tenant-images/`;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const safePart = (value) => String(value || 'document').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);

export const cachedImagePath = (userId, id, extension = 'jpg') =>
  `${ROOT}${safePart(userId)}/${safePart(id)}.${safePart(extension)}`;

function extensionForMime(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

async function ensureParent(uri) {
  await FileSystem.makeDirectoryAsync(uri.slice(0, uri.lastIndexOf('/')), { intermediates: true });
}

async function validCachedImage(userId, id) {
  for (const extension of ['jpg', 'png', 'webp']) {
    const uri = cachedImagePath(userId, id, extension);
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && info.size > 0 && info.size <= MAX_IMAGE_BYTES) {
      const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
      return { uri, size: info.size, mimeType, cached: true };
    }
  }
  return null;
}

export async function fetchTenantImage({ userId, id, onProgress, force = false }) {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('INVALID_ID');
  if (!force) {
    const cached = await validCachedImage(userId, id);
    if (cached) return cached;
  }
  const token = await getSessionToken();
  if (!token) throw new Error('UNAUTHENTICATED');
  const temporaryUri = cachedImagePath(userId, id, 'download');
  await ensureParent(temporaryUri);
  const task = FileSystem.createDownloadResumable(
    `${MOBILE_API_BASE_URL}/users/documents/${encodeURIComponent(String(id))}/content`,
    temporaryUri,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'image/jpeg,image/png,image/webp' } },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
      onProgress?.(totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0),
  );
  const result = await task.downloadAsync();
  if (!result?.uri || result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    const error = new Error(`HTTP_${result?.status || 0}`);
    error.status = result?.status;
    throw error;
  }
  const mimeType = String(result.headers?.['content-type'] || result.headers?.['Content-Type'] || '').split(';')[0].toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    throw new Error('WRONG_MIME');
  }
  const info = await FileSystem.getInfoAsync(temporaryUri);
  if (!info.exists || !info.size || info.size > MAX_IMAGE_BYTES) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    throw new Error(!info.size ? 'EMPTY_FILE' : 'FILE_TOO_LARGE');
  }
  const uri = cachedImagePath(userId, id, extensionForMime(mimeType));
  await FileSystem.moveAsync({ from: temporaryUri, to: uri });
  return { uri, size: info.size, mimeType, cached: false };
}

export async function shareImage(uri, mimeType = 'image/jpeg', title = 'Document') {
  if (!(await Sharing.isAvailableAsync())) throw new Error('SHARING_UNAVAILABLE');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

export async function printImage(uri) {
  const extension = String(uri).split('.').pop()?.toLowerCase();
  const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  await Print.printAsync({ html: `<html><body style="margin:0;text-align:center"><img src="data:${mimeType};base64,${base64}" style="max-width:100%;max-height:100%" /></body></html>` });
}

export async function downloadImage(uri, title = 'document', mimeType = 'image/jpeg') {
  const extension = extensionForMime(mimeType);
  const filename = `${safePart(title)}_${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  if (FileSystem.StorageAccessFramework?.requestDirectoryPermissionsAsync) {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) throw new Error('DOWNLOAD_CANCELLED');
    const destination = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, filename, mimeType);
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(destination, base64, { encoding: FileSystem.EncodingType.Base64 });
    return { uri: destination, filename };
  }
  const destination = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return { uri: destination, filename };
}

export function imageDocumentErrorMessage(error) {
  const code = String(error?.message || '');
  if (error?.status === 403 || code === 'HTTP_403') return 'You do not have permission to view this document.';
  if (error?.status === 404 || code === 'HTTP_404') return 'The requested document could not be found.';
  if (/Network|timeout|HTTP_0/i.test(code)) return 'Internet connection required to load this document.';
  if (['WRONG_MIME', 'EMPTY_FILE'].includes(code)) return 'This file is damaged or is not a supported image.';
  if (code === 'FILE_TOO_LARGE') return 'This image is too large to open safely on this device.';
  if (code === 'INVALID_ID') return 'This document link is invalid.';
  if (code === 'UNAUTHENTICATED') return 'Please sign in again to view this document.';
  return 'The document could not be loaded. Please try again.';
}
