import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MOBILE_API_BASE_URL } from '../config/api';
import { getSessionToken } from '../services/secureCredentials';

const safeName = (value = 'attachment') => String(value || 'attachment')
  .replace(/[^a-zA-Z0-9._-]+/g, '_')
  .slice(0, 120) || 'attachment';

export async function openChatAttachment(attachment = {}) {
  const relativeUrl = String(attachment.url || attachment.fileUrl || '').trim();
  if (!relativeUrl.startsWith('/chat/')) {
    throw new Error('This attachment link is not valid.');
  }
  const token = await getSessionToken();
  if (!token) throw new Error('Please sign in again to open this attachment.');

  const cacheRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!cacheRoot) throw new Error('Attachment storage is unavailable on this device.');
  const destination = `${cacheRoot}lilycrest-chat-${Date.now()}-${safeName(attachment.name || attachment.fileName)}`;
  const result = await FileSystem.downloadAsync(
    `${MOBILE_API_BASE_URL}${relativeUrl}`,
    destination,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error('Unable to download this attachment.');
  }
  if (!(await Sharing.isAvailableAsync())) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
    throw new Error('Opening attachments is not supported on this device.');
  }
  try {
    await Sharing.shareAsync(result.uri, {
      mimeType: attachment.mimeType || attachment.type || 'application/octet-stream',
      dialogTitle: attachment.name || attachment.fileName || 'Chat attachment',
    });
  } finally {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
  }
}
