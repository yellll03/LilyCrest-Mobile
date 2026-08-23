/* global test, __dirname */
const fs = require('fs');
const path = require('path');

const pdfViewer = fs.readFileSync(path.resolve(__dirname, '../../app/document-viewer.jsx'), 'utf8');
const imageViewer = fs.readFileSync(path.resolve(__dirname, '../../app/image-viewer.jsx'), 'utf8');
const myDocuments = fs.readFileSync(path.resolve(__dirname, '../../app/my-documents.jsx'), 'utf8');
const imageManager = fs.readFileSync(path.resolve(__dirname, '../services/imageDocumentManager.js'), 'utf8');

describe('authenticated document viewer actions', () => {
  test('document viewer exposes download, print, share, paging, and retry', () => {
    expect(pdfViewer).toContain('Download document');
    expect(pdfViewer).toContain('Print document');
    expect(pdfViewer).toContain('Share document');
    expect(pdfViewer).toContain('Page {page} of {pages}');
    expect(pdfViewer).toContain('load(true)');
  });

  // A wet-signed contract scan may be uploaded as a PDF or as a JPG/PNG image
  // (see CONTRACT_MOBILE_DISPLAY_WORKFLOW.md) — this viewer must render
  // whichever format the backend actually served, not assume PDF always.
  test('document viewer renders images (jpg/png) as well as PDFs', () => {
    expect(pdfViewer).toContain("extension === 'jpg' || extension === 'png'");
    expect(pdfViewer).toContain('isImage ?');
    expect(pdfViewer).toContain('<Image');
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

  test('iOS policy previews provide close-button and swipe-down dismissal paths', () => {
    expect(myDocuments).toContain("presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}");
    expect(myDocuments).toContain("allowSwipeDismissal={Platform.OS === 'ios'}");
    expect(myDocuments).toContain('onRequestClose={closePreview}');
    expect(myDocuments).toContain('accessibilityLabel="Close document preview"');
    expect(myDocuments).toContain('hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}');
  });
});
