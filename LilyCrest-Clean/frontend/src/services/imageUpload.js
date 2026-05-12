import { apiService } from './api';

const IMAGEKIT_PUBLIC_KEY = String(process.env.EXPO_PUBLIC_IMAGEKIT_PUBLIC_KEY || '').trim();
const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const LOCAL_ONLY_URI_PATTERN = /^(?:file|content|ph|assets-library|blob|ms-appdata):\/\/|^\/data\/user\/|^\/storage\/|^\/private\/var\/|^\/var\/mobile\/|(?:^|[\\/])cache(?:[\\/]|$)/i;
const IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

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

export function isImageAttachmentCandidate(attachment = {}) {
  const type = String(attachment?.type || '').toLowerCase();
  const name = String(attachment?.name || '').toLowerCase();
  return type.startsWith('image/') || IMAGE_NAME_PATTERN.test(name);
}

function normalizeAttachmentName(attachment = {}, index = 0) {
  const rawName = typeof attachment?.name === 'string' ? attachment.name.trim() : '';
  if (rawName) return rawName;
  return `image-${index + 1}.jpg`;
}

async function getImageKitAuthParams() {
  try {
    const response = await apiService.getImageUploadAuth();
    const auth = response?.data || {};

    if (!auth?.token || !auth?.expire || !auth?.signature) {
      throw new Error('Image upload failed. Please try again.');
    }

    return auth;
  } catch (_) {
    throw new Error('Image upload failed. Please try again.');
  }
}

async function uploadLocalAttachmentToImageKit(attachment = {}, index = 0) {
  const localUri = String(attachment?.uri || '').trim();

  if (!IMAGEKIT_PUBLIC_KEY) {
    throw new Error('Image upload failed. Please try again.');
  }
  if (!isLocalOnlyAttachmentUri(localUri)) {
    throw new Error('Image upload failed. Please try again.');
  }
  if (!isImageAttachmentCandidate(attachment)) {
    throw new Error('Image upload failed. Please try again.');
  }

  const auth = await getImageKitAuthParams();
  const fileName = normalizeAttachmentName(attachment, index);
  const fileType = typeof attachment?.type === 'string' && attachment.type.trim()
    ? attachment.type.trim()
    : 'image/jpeg';

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    name: fileName,
    type: fileType,
  });
  formData.append('publicKey', IMAGEKIT_PUBLIC_KEY);
  formData.append('signature', auth.signature);
  formData.append('expire', String(auth.expire));
  formData.append('token', auth.token);
  formData.append('fileName', fileName);
  formData.append('folder', '/lilycrest/mobile');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error('Image upload failed. Please try again.'));
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText || '{}');
        const uploadedUri = String(payload?.url || '').trim();
        if (!isUploadedHttpsAttachmentUri(uploadedUri)) {
          reject(new Error('Image upload failed. Please try again.'));
          return;
        }

        resolve({
          name: fileName,
          uri: uploadedUri,
          type: fileType,
          size: attachment?.size,
        });
      } catch (_) {
        reject(new Error('Image upload failed. Please try again.'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Image upload failed. Please try again.')));
    xhr.addEventListener('abort', () => reject(new Error('Image upload failed. Please try again.')));

    xhr.open('POST', IMAGEKIT_UPLOAD_URL);
    xhr.send(formData);
  });
}

export async function ensureCloudImageAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  const uploaded = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index] || {};
    const uri = String(attachment?.uri || '').trim();

    if (isUploadedHttpsAttachmentUri(uri)) {
      uploaded.push({
        name: normalizeAttachmentName(attachment, index),
        uri,
        type: attachment?.type || 'image/jpeg',
        size: attachment?.size,
      });
      continue;
    }

    if (!isLocalOnlyAttachmentUri(uri)) {
      throw new Error('Image upload failed. Please try again.');
    }

    uploaded.push(await uploadLocalAttachmentToImageKit(attachment, index));
  }

  return uploaded;
}
