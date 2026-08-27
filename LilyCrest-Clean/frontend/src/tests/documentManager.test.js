/* global test, __dirname */
const fs = require('fs');
const path = require('path');

// documentManager.js imports expo-sharing (a native module), so this is
// asserted via source inspection rather than require() — same pattern as
// contractDocumentCache.test.js / documentViewerActions.test.js /
// billingStatementReceiptButtons.test.js in this suite.
const source = fs.readFileSync(path.resolve(__dirname, '../services/documentManager.js'), 'utf8');

// 410 Gone means the document's metadata (contract/tenantDocument) still
// exists but the underlying stored file does not. This must map to its own
// friendly retryable message — distinct from 404 "not found" — and must
// never fall through to a blank/broken PDF viewer, an auth failure, or a
// no-contract/preparing state.
describe('documentErrorMessage — HTTP 410 (Gone)', () => {
  test('maps error.status 410 / code HTTP_410 to the canonical retry message', () => {
    expect(source).toMatch(
      /error\?\.status === 410 \|\| code === 'HTTP_410'\)\s*return 'Unable to load document at this time\. Please try again later\.'/,
    );
  });

  test('reads the structured error body before deleting a failed download', () => {
    const readIndex = source.indexOf('await downloadHttpError(result, uri)');
    const deleteIndex = source.indexOf('await FileSystem.deleteAsync(uri', readIndex);
    expect(readIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(readIndex);
    expect(source).toContain('JSON.parse(await FileSystem.readAsStringAsync(responseUri))');
    expect(source).toContain('error.serverCode = payload?.code');
  });

  test('maps missing final and prepared storage codes to actionable branch-admin guidance', () => {
    expect(source).toContain("'FINAL_DOCUMENT_STORAGE_MISSING', 'CONTRACT_ARTIFACT_STORAGE_MISSING'");
    expect(source).toContain('Please contact the branch admin to replace the signed copy.');
    expect(source).toContain("serverCode === 'PREPARED_DOCUMENT_STORAGE_MISSING'");
    expect(source).toContain('Please contact the branch admin to regenerate the contract.');
  });

  test('the 410 branch is checked before the generic fallback message', () => {
    const fallbackIndex = source.indexOf("return 'The document could not be loaded. Please try again.'");
    const gone410Index = source.indexOf("'HTTP_410'");
    expect(gone410Index).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(gone410Index).toBeLessThan(fallbackIndex);
  });
});

describe('contract-signed document kind + targeted cache invalidation (Phase 3)', () => {
  test('documentUrl builds a versioned signed URL from (id, version)', () => {
    expect(source).toContain("kind === 'contract-signed'");
    expect(source).toMatch(/\/contracts\/\$\{encodeURIComponent\(id\)\}\/documents\/signed\/\$\{encodeURIComponent\(extra\)\}/);
  });

  test('invalidateContractDocumentCache deletes only this contract\'s cached PDFs, never the whole store', () => {
    const fnIndex = source.indexOf('export async function invalidateContractDocumentCache');
    expect(fnIndex).toBeGreaterThan(-1);
    const body = source.slice(fnIndex, fnIndex + 900);
    // scoped to the user's dir + this contract id
    expect(body).toContain('safePart(contractId)');
    expect(body).toMatch(/contract-\(prepared\|final\|signed\)_/);
    // uses per-file deleteAsync, not a recursive ROOT wipe
    expect(body).toContain('FileSystem.deleteAsync(`${dir}${entry}`');
    expect(body).not.toContain('deleteAsync(ROOT');
  });
});
