const test = require('node:test');
const assert = require('node:assert/strict');

const IMAGE_URL = 'https://firebasestorage.googleapis.com/v0/b/test/o/tenant.jpg?alt=media&token=image-token';
const PDF_URL = 'https://firebasestorage.googleapis.com/v0/b/test/o/report.pdf?alt=media&token=pdf-token';

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('detail response includes tenant and admin image/document attachments without internal paths', () => {
  const { buildTenantRequestResponse } = require('../controllers/maintenance.controller');
  const detail = buildTenantRequestResponse({
    request_id: 'request-a', user_id: 'tenant-a', status: 'in_progress',
    attachments: [
      { downloadUrl: IMAGE_URL, originalName: 'tenant.jpg', mimeType: 'image/jpeg', storagePath: 'internal/tenant.jpg' },
      { downloadUrl: PDF_URL, originalName: 'tenant.pdf', mimeType: 'application/pdf', storagePath: 'internal/tenant.pdf' },
    ],
    updates: [
      { update_id: 'admin-image', type: 'admin_update', visibility: 'tenant', attachments: [{ url: IMAGE_URL, name: 'progress.jpg', type: 'image/jpeg', storagePath: 'internal/progress.jpg' }] },
      { update_id: 'admin-document', type: 'admin_update', visibility: 'tenant', attachments: [{ url: PDF_URL, name: 'progress.pdf', type: 'application/pdf', storagePath: 'internal/progress.pdf' }] },
      { update_id: 'missing-url', type: 'admin_update', visibility: 'tenant', attachments: [{ storagePath: 'internal/missing.jpg', name: 'missing.jpg', type: 'image/jpeg' }] },
      { update_id: 'no-attachment', type: 'admin_update', visibility: 'tenant', attachments: [] },
    ],
  }, { includeThread: true });

  assert.equal(detail.attachments.length, 2);
  assert.equal(detail.thread.find((entry) => entry.update_id === 'admin-image').attachments[0].downloadUrl, IMAGE_URL);
  assert.equal(detail.thread.find((entry) => entry.update_id === 'admin-document').attachments[0].mimeType, 'application/pdf');
  assert.equal(detail.thread.find((entry) => entry.update_id === 'missing-url').attachments.length, 0);
  assert.equal(detail.thread.find((entry) => entry.update_id === 'no-attachment').attachments.length, 0);
  for (const attachment of [...detail.attachments, ...detail.thread.flatMap((entry) => entry.attachments)]) {
    assert.match(attachment.downloadUrl, /^https:\/\//);
    assert.equal('storagePath' in attachment, false);
  }
});

test('maintenance detail ownership is enforced before attachments are returned', async () => {
  const databasePath = require.resolve('../config/database');
  let receivedQuery;
  require(databasePath).getDb = () => ({ collection: () => ({
    findOne: async (query) => {
      receivedQuery = query;
      const ownsRequest = query.$or?.some((condition) => condition.user_id === 'tenant-a');
      return ownsRequest ? { request_id: 'request-a', user_id: 'tenant-a', attachments: [{ downloadUrl: IMAGE_URL }] } : null;
    },
  }) });
  delete require.cache[require.resolve('../controllers/maintenance.controller')];
  const { getMaintenanceDetail } = require('../controllers/maintenance.controller');
  const res = response();
  await getMaintenanceDetail({ params: { requestId: 'request-a' }, user: { user_id: 'tenant-b', role: 'tenant' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(receivedQuery.request_id, 'request-a');
});
