/* global test, __dirname */
const fs = require('fs');
const path = require('path');

// documentManager.js imports expo-sharing (a native module), so this is
// asserted via source inspection rather than require() — same pattern as
// documentViewerActions.test.js / billingStatementReceiptButtons.test.js in
// this suite.
const source = fs.readFileSync(path.resolve(__dirname, '../services/documentManager.js'), 'utf8');

// A regenerated prepared PDF, or a final document replacing a draft, must
// never resolve to the same on-disk cache path as the version/variant it
// replaced — otherwise a stale local file could be shown even though the
// canonical backend already moved on. cacheKey (see contractPresentation.js's
// documentCacheKey) must participate in the cache path, not just `id`.
describe('version-aware contract PDF cache path', () => {
  test('cachedDocumentPath accepts a cacheKey and prefers it over id for the file path', () => {
    expect(source).toMatch(/cachedDocumentPath = \(userId, kind, id, cacheKey\)/);
    expect(source).toContain('safePart(cacheKey || id)');
  });

  test('getCachedPdf and fetchPdf forward cacheKey through to cachedDocumentPath', () => {
    expect(source).toMatch(/getCachedPdf\(userId, kind, id, cacheKey\)/);
    expect(source).toContain('cachedDocumentPath(userId, kind, id, cacheKey)');
    expect(source).toMatch(/fetchPdf\(\{ userId, kind, id, cacheKey, extra, onProgress \}\)/);
  });
});
