/* global test, __dirname */
const fs = require('fs');
const path = require('path');

const pdfViewer = fs.readFileSync(path.resolve(__dirname, '../../app/document-viewer.jsx'), 'utf8');
const imageViewer = fs.readFileSync(path.resolve(__dirname, '../../app/image-viewer.jsx'), 'utf8');
const imageManager = fs.readFileSync(path.resolve(__dirname, '../services/imageDocumentManager.js'), 'utf8');

describe('authenticated document viewer actions', () => {
  test('PDF viewer exposes download, print, share, paging, and retry', () => {
    expect(pdfViewer).toContain('Download PDF');
    expect(pdfViewer).toContain('Print PDF');
    expect(pdfViewer).toContain('Share PDF');
    expect(pdfViewer).toContain('Page {page} of {pages}');
    expect(pdfViewer).toContain('load(true)');
  });

  test('image viewer downloads to an owner-scoped cache and supports actions', () => {
    expect(imageManager).toContain('tenant-images/');
    expect(imageManager).toContain('Authorization: `Bearer ${token}`');
    expect(imageManager).toContain("['image/jpeg', 'image/png', 'image/webp']");
    expect(imageViewer).toContain('Download image');
    expect(imageViewer).toContain('Print image');
    expect(imageViewer).toContain('Share image');
    expect(imageViewer).toContain('load(true)');
  });
});
