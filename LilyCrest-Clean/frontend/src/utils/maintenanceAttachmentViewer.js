const IMAGE_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)(?:\?.*)?$/i;
const DOCUMENT_PATTERN = /\.(pdf|docx?|txt|csv)(?:\?.*)?$/i;

function attachmentUrl(attachment = {}) {
  if (typeof attachment === 'string') return attachment.trim();
  return String(attachment.downloadUrl || attachment.download_url || attachment.url || attachment.uri || '').trim();
}

function attachmentName(attachment = {}) {
  return String(attachment.originalName || attachment.fileName || attachment.filename || attachment.name || '').trim();
}

function attachmentMimeType(attachment = {}) {
  return String(attachment.mimeType || attachment.contentType || attachment.type || '').trim().toLowerCase();
}

export function classifyMaintenanceAttachment(attachment = {}) {
  const mimeType = attachmentMimeType(attachment);
  const name = attachmentName(attachment);
  const url = attachmentUrl(attachment).split('?')[0];
  if (mimeType.startsWith('image/') || IMAGE_PATTERN.test(name) || IMAGE_PATTERN.test(url)) return 'image';
  if (['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv'].includes(mimeType) || DOCUMENT_PATTERN.test(name) || DOCUMENT_PATTERN.test(url)) return 'document';
  return 'unsupported';
}

export function getValidMaintenanceAttachmentUrl(attachment = {}) {
  const url = attachmentUrl(attachment);
  return /^https:\/\//i.test(url) ? url : '';
}

export async function ensureMaintenanceAttachmentAvailable(attachment = {}, fetchImpl = fetch) {
  const url = getValidMaintenanceAttachmentUrl(attachment);
  if (!url) throw new Error('Attachment link is missing or invalid.');

  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  } catch (_) {
    throw new Error('Attachment could not be reached. Check your connection and try again.');
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('Attachment access has expired. Please contact the dormitory administrator.');
    if (response.status === 404) throw new Error('This attachment no longer exists.');
    throw new Error('Attachment could not be opened. Please try again later.');
  }
  return url;
}
