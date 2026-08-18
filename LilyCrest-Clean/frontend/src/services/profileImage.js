import { apiService } from './api';
import {
  getAttachmentDownloadUrl,
  isInvalidFinalAttachmentUrl,
  uploadAttachmentToFirebaseStorage,
} from './firebaseStorageUpload';

export const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

function isCanonicalProfile(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.user_id === 'string'
    && value.user_id.trim().length > 0;
}

export async function persistCanonicalProfileImage(asset, tenantId) {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Please choose a profile picture.');
  }

  const uploaded = await uploadAttachmentToFirebaseStorage({
    uri: asset.uri,
    fileName: asset.fileName || asset.filename || 'profile-image.jpg',
    mimeType: asset.mimeType || asset.type || 'image/jpeg',
    fileSize: asset.fileSize,
  }, {
    allowedMimeTypes: PROFILE_IMAGE_MIME_TYPES,
    context: 'profile',
    entityId: 'profile',
    folder: 'profile-images',
    maxBytes: PROFILE_IMAGE_MAX_BYTES,
    tenantId,
  });

  const picture = getAttachmentDownloadUrl(uploaded);
  if (isInvalidFinalAttachmentUrl(picture)) {
    throw new Error('Profile picture upload did not return a permanent HTTPS URL.');
  }

  const response = await apiService.updateProfile({ picture });
  if (!isCanonicalProfile(response?.data) || response.data.picture !== picture) {
    throw new Error('Invalid canonical profile response after picture update.');
  }
  return response.data;
}
