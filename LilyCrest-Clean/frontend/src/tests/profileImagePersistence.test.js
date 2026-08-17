import { apiService } from '../services/api';
import {
  getAttachmentDownloadUrl,
  isInvalidFinalAttachmentUrl,
  uploadAttachmentToFirebaseStorage,
} from '../services/firebaseStorageUpload';
import {
  persistCanonicalProfileImage,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_MIME_TYPES,
} from '../services/profileImage';

jest.mock('../services/api', () => ({
  apiService: { updateProfile: jest.fn() },
}));

jest.mock('../services/firebaseStorageUpload', () => ({
  getAttachmentDownloadUrl: jest.fn(),
  isInvalidFinalAttachmentUrl: jest.fn(),
  uploadAttachmentToFirebaseStorage: jest.fn(),
}));

const asset = {
  uri: 'file:///data/user/0/com.lilycrest/cache/avatar.jpg',
  fileName: 'avatar.jpg',
  mimeType: 'image/jpeg',
  fileSize: 1024,
};
const permanentUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/profile-images%2Ftenant-a%2Fprofile%2Favatar.jpg?alt=media&token=t';

describe('canonical profile image persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uploadAttachmentToFirebaseStorage.mockResolvedValue({ downloadUrl: permanentUrl });
    getAttachmentDownloadUrl.mockReturnValue(permanentUrl);
    isInvalidFinalAttachmentUrl.mockReturnValue(false);
  });

  it('uploads first, then persists the permanent URL and returns only the canonical backend profile', async () => {
    const canonicalProfile = { user_id: 'tenant-a', name: 'Canonical Tenant', picture: permanentUrl };
    apiService.updateProfile.mockResolvedValue({ data: canonicalProfile });

    await expect(persistCanonicalProfileImage(asset, 'tenant-a')).resolves.toEqual(canonicalProfile);
    expect(uploadAttachmentToFirebaseStorage).toHaveBeenCalledWith(expect.objectContaining({ uri: asset.uri }), expect.objectContaining({
      allowedMimeTypes: PROFILE_IMAGE_MIME_TYPES,
      context: 'profile',
      maxBytes: PROFILE_IMAGE_MAX_BYTES,
      tenantId: 'tenant-a',
    }));
    expect(apiService.updateProfile).toHaveBeenCalledWith({ picture: permanentUrl });
    expect(uploadAttachmentToFirebaseStorage.mock.invocationCallOrder[0])
      .toBeLessThan(apiService.updateProfile.mock.invocationCallOrder[0]);
  });

  it('does not mutate the canonical profile when upload fails', async () => {
    uploadAttachmentToFirebaseStorage.mockRejectedValue(new Error('upload failed'));
    await expect(persistCanonicalProfileImage(asset, 'tenant-a')).rejects.toThrow('upload failed');
    expect(apiService.updateProfile).not.toHaveBeenCalled();
  });

  it('does not mutate the canonical profile when storage returns a local/non-permanent reference', async () => {
    getAttachmentDownloadUrl.mockReturnValue('file:///cache/avatar.jpg');
    isInvalidFinalAttachmentUrl.mockReturnValue(true);
    await expect(persistCanonicalProfileImage(asset, 'tenant-a')).rejects.toThrow('permanent HTTPS URL');
    expect(apiService.updateProfile).not.toHaveBeenCalled();
  });

  it('propagates profile mutation failure and never returns a fake locally saved profile', async () => {
    apiService.updateProfile.mockRejectedValue(new Error('mutation failed'));
    await expect(persistCanonicalProfileImage(asset, 'tenant-a')).rejects.toThrow('mutation failed');
  });

  it('rejects a malformed canonical mutation response', async () => {
    apiService.updateProfile.mockResolvedValue({ data: { user_id: 'tenant-a', picture: 'https://example.test/stale.jpg' } });
    await expect(persistCanonicalProfileImage(asset, 'tenant-a')).rejects.toThrow('Invalid canonical profile response');
  });
});
