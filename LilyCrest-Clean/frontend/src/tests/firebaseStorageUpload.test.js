jest.mock('../services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

const {
  getAttachmentDownloadUrl,
  isInvalidFinalAttachmentUrl,
} = require('../services/firebaseStorageUpload');

describe('firebaseStorageUpload attachment URL compatibility', () => {
  const originalBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test-bucket.firebasestorage.app';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = originalBucket;
  });

  it('resolves legacy attachment URL field names', () => {
    expect(getAttachmentDownloadUrl({ attachment_url: 'https://example.com/old-photo.jpg' }))
      .toBe('https://example.com/old-photo.jpg');
    expect(getAttachmentDownloadUrl({ file_data: 'https://example.com/old-document.pdf' }))
      .toBe('https://example.com/old-document.pdf');
    expect(getAttachmentDownloadUrl({ signed_url: 'https://example.com/signed.csv' }))
      .toBe('https://example.com/signed.csv');
  });

  it('builds Firebase download URLs from storagePath and a saved token', () => {
    expect(getAttachmentDownloadUrl({
      storagePath: 'maintenance-followups/tenant/request/photo.jpg',
      firebaseStorageDownloadTokens: 'token-123',
    })).toBe(
      'https://firebasestorage.googleapis.com/v0/b/test-bucket.firebasestorage.app/o/maintenance-followups%2Ftenant%2Frequest%2Fphoto.jpg?alt=media&token=token-123',
    );
  });

  it('builds Firebase download URLs from gs links and a saved token', () => {
    expect(getAttachmentDownloadUrl({
      uri: 'gs://legacy-bucket.appspot.com/maintenance/reply.pdf',
      downloadToken: 'token 123',
    })).toBe(
      'https://firebasestorage.googleapis.com/v0/b/legacy-bucket.appspot.com/o/maintenance%2Freply.pdf?alt=media&token=token%20123',
    );
  });

  it('still rejects local-only attachment paths as final URLs', () => {
    expect(isInvalidFinalAttachmentUrl('content://media/external/images/1')).toBe(true);
    expect(isInvalidFinalAttachmentUrl('/storage/emulated/0/DCIM/photo.jpg')).toBe(true);
  });
});
