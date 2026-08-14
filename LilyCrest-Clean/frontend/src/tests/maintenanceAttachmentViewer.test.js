import {
  classifyMaintenanceAttachment,
  ensureMaintenanceAttachmentAvailable,
  getValidMaintenanceAttachmentUrl,
} from '../utils/maintenanceAttachmentViewer';

const image = { downloadUrl: 'https://firebasestorage.googleapis.com/image.jpg?token=ok', originalName: 'photo.jpg', mimeType: 'image/jpeg' };
const document = { downloadUrl: 'https://firebasestorage.googleapis.com/report.pdf?token=ok', originalName: 'report.pdf', mimeType: 'application/pdf' };

describe('maintenance attachment viewer', () => {
  it('classifies tenant and admin images as images', () => expect(classifyMaintenanceAttachment(image)).toBe('image'));
  it('classifies tenant and admin documents as documents', () => expect(classifyMaintenanceAttachment(document)).toBe('document'));
  it('accepts only complete HTTPS URLs', () => {
    expect(getValidMaintenanceAttachmentUrl(image)).toMatch(/^https:\/\//);
    expect(getValidMaintenanceAttachmentUrl({ uri: 'gs://bucket/internal/path' })).toBe('');
    expect(getValidMaintenanceAttachmentUrl({ uri: 'file:///private/file.pdf' })).toBe('');
  });
  it('returns the URL when the remote attachment exists', async () => {
    await expect(ensureMaintenanceAttachmentAvailable(document, jest.fn().mockResolvedValue({ ok: true, status: 200 }))).resolves.toBe(document.downloadUrl);
  });
  it('reports a missing file clearly', async () => {
    await expect(ensureMaintenanceAttachmentAvailable(document, jest.fn().mockResolvedValue({ ok: false, status: 404 }))).rejects.toThrow('no longer exists');
  });
  it('handles a maintenance update without an attachment', () => {
    expect(classifyMaintenanceAttachment({})).toBe('unsupported');
    expect(getValidMaintenanceAttachmentUrl({})).toBe('');
  });
});
