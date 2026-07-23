const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAttachmentParts, normalizeAuthorizedAttachments } = require('../services/assistantAttachment.service');

const tenantId = 'tenant-a';
const path = 'ai-assistant-attachments/tenant-a/session-1/receipt.pdf';
const url = `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(path)}?alt=media&token=test-token`;

test('accepts only attachments stored under the authenticated tenant path', () => {
  const [result] = normalizeAuthorizedAttachments([
    { downloadUrl: url, storagePath: path, mimeType: 'application/pdf', size: 10 },
  ], tenantId);
  assert.equal(result.storagePath, path);

  assert.throws(() => normalizeAuthorizedAttachments([
    { downloadUrl: url, storagePath: path, mimeType: 'application/pdf', size: 10 },
  ], 'tenant-b'), /Unauthorized attachment/);
});

test('rejects URL and metadata path substitution', () => {
  assert.throws(() => normalizeAuthorizedAttachments([
    { downloadUrl: url, storagePath: `${path}-other`, mimeType: 'application/pdf', size: 10 },
  ], tenantId), /Unauthorized attachment/);
});

test('validates downloaded MIME and PDF signature before model input', async () => {
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => 'application/pdf' },
    arrayBuffer: async () => Buffer.from('%PDF-1.4\nsafe fixture'),
  });
  const parts = await loadAttachmentParts([
    { downloadUrl: url, storagePath: path, mimeType: 'application/pdf', size: 20 },
  ], tenantId, fetchImpl);
  assert.equal(parts[0].inlineData.mimeType, 'application/pdf');

  await assert.rejects(() => loadAttachmentParts([
    { downloadUrl: url, storagePath: path, mimeType: 'application/pdf', size: 20 },
  ], tenantId, async () => ({
    ok: true,
    headers: { get: () => 'application/pdf' },
    arrayBuffer: async () => Buffer.from('<html>not a pdf</html>'),
  })), /Invalid PDF/);
});

test('rejects unsupported ID and office-document inputs', () => {
  assert.throws(() => normalizeAuthorizedAttachments([
    { downloadUrl: url, storagePath: path, mimeType: 'application/msword', size: 10 },
  ], tenantId), /Unsupported attachment/);
});
