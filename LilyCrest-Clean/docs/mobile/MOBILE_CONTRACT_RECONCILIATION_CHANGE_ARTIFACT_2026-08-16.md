# LilyCrest Mobile Contract Reconciliation — Change Artifact

**Artifact date:** 2026-08-16

**Repository:** `yellll03/LilyCrest-Mobile`

**Branch inspected:** `master`

**Implementation scope:** Mobile API bridge and React Native tenant contract experience

**Deployment status:** Not deployed

**Push/commit status:** Not pushed or committed by this implementation session

## 1. Executive Summary

The LilyCrest mobile contract flow was reconciled so that it can consume the canonical backend's normalized `tenantDocument` result and canonical current-document stream without creating a second mobile contract lifecycle.

When canonical mode is available, the tenant-facing rule is:

```text
No canonical tenant document
        -> Preparing Contract

tenantDocument.type = generated_draft
        -> Generated Draft — For Signing

tenantDocument.type = final_notarized
        -> Final Notarized Contract
```

The mobile client does not inspect `preparedDocuments[]`, `signedDocuments[]`, or `notarizedDocuments[]`. It does not expose the intermediate signed copy. The canonical `tenantDocument` takes precedence whenever it is present.

Legacy prepared/final response flags and per-document endpoints remain temporarily supported for backward compatibility with the currently deployed canonical response.

## 2. Scope and Ownership

This artifact covers changes in the LilyCrest mobile repository only.

The canonical `Capstone-Website` repository was not present in the implementation workspace. Therefore, this work did not modify or independently verify:

- the canonical `Contract` model;
- `preparedDocuments[]`, `signedDocuments[]`, or `notarizedDocuments[]` persistence;
- canonical `finalDocument` establishment;
- the canonical current-contract query;
- canonical Firebase/session identity to `User._id` resolution;
- `Contract.tenantId` ownership enforcement inside the upstream service;
- contract generation or final notarized upload workflows.

Those remain owned by the canonical web/backend system.

## 3. Architecture Found

### Contract metadata flow

```text
Contract screen / Profile / My Documents
        -> useTenantContract()
        -> apiService.getCurrentContract()
        -> GET /api/m/contracts/current
        -> local Express contract bridge
        -> GET {CONTRACT_UPSTREAM_URL}/api/m/contracts/current
        -> canonical Capstone-Website contract system
```

### Canonical document flow

```text
Contract screen
        -> document-viewer
        -> documentManager
        -> authenticated GET /api/m/contracts/current/document
        -> local Express stream bridge
        -> GET {CONTRACT_UPSTREAM_URL}/api/m/contracts/current/document
        -> canonical tenant-document resolver
        -> selected private PDF stream
```

### Temporary legacy document flow

```text
Legacy canonical response without tenantDocument
        -> preparedDocument/finalDocument availability flags
        -> existing authenticated per-contract prepared/final endpoint
        -> upstream private PDF stream
```

This compatibility path can be retired only after canonical `tenantDocument` and `/api/m/contracts/current/document` are deployed and verified.

## 4. Confirmed Problems in the Mobile Repository

The inspected mobile path did not contain an `active`-only or `published`-only contract filter. A generated draft was already openable when the upstream returned `preparedDocument.available: true`.

The confirmed local problems were:

1. **The mobile presentation layer selected prepared versus final locally.**
   - It evaluated separate `preparedDocument` and `finalDocument` flags.
   - This duplicated document priority outside the canonical backend.

2. **No unified current-document stream existed in the local bridge.**
   - The client had to select a prepared or final endpoint.

3. **Contract data refreshed only on the hook's initial mount.**
   - Returning to the Contract screen or foregrounding the app did not reliably retrieve a newly generated or final contract.

4. **PDF cache identity did not include document version.**
   - A regenerated prepared PDF could reuse the cache entry for an older version of the same contract.

5. **All request failures cleared contract state.**
   - Transient network/upstream failures were rendered like an unavailable contract instead of preserving the last successfully authorized presentation with an explicit error.

The complete web-generation-to-canonical-database failure that originally prevented a prepared PDF from appearing cannot be attributed from this repository alone because the canonical upstream implementation and deployment configuration were unavailable.

## 5. Changes Made

### 5.1 Mobile API bridge

#### `backend/routes/contracts.routes.js`

- Added authenticated `GET /contracts/current/document` handling.
- Proxies directly to `/api/m/contracts/current/document` on `CONTRACT_UPSTREAM_URL`.
- Does not inspect statuses, document arrays, storage paths, or prepared/final lifecycle state.
- Preserves the exact bearer authorization header for upstream revalidation.
- Retains legacy prepared and final stream routes.

#### `backend/server.js`

- Added `/api/contracts` and `/api/m/contracts` to private no-store response handling.
- Prevents authenticated contract metadata and streams from being treated as publicly cacheable API responses.

### 5.2 Canonical response consumption

#### `frontend/src/utils/contractPresentation.js`

- Added normalization for canonical responses where `tenantDocument` is returned beside `contract` or nested in it.
- Makes canonical `tenantDocument` authoritative when the field is present.
- Maps only:
  - `generated_draft` to the generated draft presentation;
  - `final_notarized` to the final contract presentation;
  - unavailable to preparing.
- Ignores legacy prepared/final flags when canonical mode is active.
- Does not inspect or select signed intermediate documents.
- Retains a documented legacy compatibility branch when `tenantDocument` is absent.
- Produces document-kind, title, lifecycle message, and version-aware cache metadata for the viewer.

### 5.3 Refresh and error lifecycle

#### `frontend/src/hooks/useTenantContract.js`

- Refreshes on screen focus.
- Refreshes when the application returns from background/inactive state.
- Normalizes top-level canonical `tenantDocument` into the client contract view.
- Prevents an older overlapping request from replacing a newer response.
- Preserves the last successful contract presentation on transient network/upstream failure.
- Clears prior private contract state on HTTP 401/403 authorization failure.
- Replaces the legacy `NO_PUBLISHED_CONTRACT` fallback with `NO_CURRENT_CONTRACT`.

### 5.4 Tenant contract screen

#### `frontend/app/contract-viewer.jsx`

- Added pull-to-refresh.
- Added distinct loading, no-current-contract, preparing, draft, final, and error presentations.
- Shows retry for failed requests.
- Shows the last successful presentation with a visible warning after transient refresh failure.
- Uses the canonical document kind and canonical current-document endpoint when available.
- Uses the normalized tenant-facing label as the PDF viewer title.

#### `frontend/app/(tabs)/profile.jsx`

- Updated contract-empty and preparing language to match the reconciled lifecycle.

#### `frontend/app/my-documents.jsx`

- Updated the contract-empty message to `No current contract is available.`

### 5.5 PDF retrieval and cache safety

#### `frontend/src/services/documentManager.js`

- Added authenticated `contract-current` document URL support.
- Separated the document resource identifier from the local PDF cache key.
- Allows the canonical type/version/timestamp to invalidate an older contract cache entry.

#### `frontend/app/document-viewer.jsx`

- Accepts and uses the version-aware `cacheKey` supplied by the contract presentation layer.
- Continues to require an authenticated session token before requesting contract bytes.

## 6. Resulting Tenant Behavior

| Canonical result | Mobile status | PDF action | Tenant-visible document |
|---|---|---|---|
| No current contract | No current contract is available | Hidden | None |
| Contract exists; document unavailable | Preparing Contract | Hidden | None |
| `tenantDocument.type = generated_draft` | Generated Draft — For Signing | Enabled | Canonically resolved generated PDF |
| Intermediate signed document only | Preparing or generated draft, according to canonical resolver | Never selects signed copy | Signed copy remains hidden |
| `tenantDocument.type = final_notarized` | Final Notarized Contract | Enabled | Canonically resolved final PDF |
| Network/upstream refresh failure after success | Visible warning and retry | Last safe presentation retained | Cached document is not lifecycle authority |
| HTTP 401/403 | Sign-in error and retry path | Hidden | Prior private presentation cleared |

## 7. Canonical Priority Rule

In canonical mode the mobile client relies on this upstream result:

```text
valid finalDocument
        -> final_notarized

otherwise latest valid non-superseded prepared document
        -> generated_draft

otherwise
        -> unavailable / preparing
```

The mobile repository does not implement this array-level selection. It only renders the normalized result.

## 8. Endpoints

### Metadata

```http
GET /api/m/contracts/current
Authorization: Bearer <tenant-session-token>
```

Expected canonical response:

```json
{
  "contract": {
    "id": "507f1f77bcf86cd799439011",
    "contractNumber": "LC-2026-0001",
    "status": "generated"
  },
  "tenantDocument": {
    "available": true,
    "type": "generated_draft",
    "label": "Generated Draft — For Signing",
    "isFinal": false,
    "version": 1
  }
}
```

### Canonical document

```http
GET /api/m/contracts/current/document
Authorization: Bearer <tenant-session-token>
Accept: application/pdf
```

The local mobile bridge passes this request to the equivalent upstream canonical endpoint. The canonical backend must resolve ownership and choose the authoritative tenant document.

### Legacy compatibility

```http
GET /api/m/contracts/:contractId/documents/prepared
GET /api/m/contracts/:contractId/documents/final
```

These endpoints remain for older canonical responses and clients. They are not used when canonical `tenantDocument` is active.

## 9. Identity and Authorization

### Locally verified chain

```text
Bearer session token
        -> local user_sessions lookup
        -> local users lookup by session.user_id
        -> active tenant/account check
        -> exact Authorization header forwarded upstream
```

The local bridge rejects missing, expired, inactive, admin, and superadmin access before proxying.

### Canonical chain requiring upstream verification

```text
forwarded bearer token
        -> canonical session/auth middleware
        -> canonical User record
        -> User._id
        -> Contract.tenantId ownership check
```

The canonical identity mapping and ownership query could not be independently verified because the `Capstone-Website` source was not part of this workspace. The mobile implementation does not send a client-selected tenant ID, Firebase UID, email, reservation ID, or storage path to select a contract.

## 10. Security Properties Preserved

- Contract API requests remain authenticated.
- Tenant-only middleware remains active on local contract bridge routes.
- The original bearer token is forwarded for canonical revalidation.
- Contract responses are marked private/no-store.
- Raw storage paths and direct private file URLs are not introduced.
- PDF bytes continue through authenticated API endpoints.
- Signed intermediate documents are not exposed by the mobile UI.
- Invalid contract IDs remain rejected on legacy routes.
- HTTP 401/403 removes prior private contract presentation state.

## 11. Backward Compatibility

The rollout is intentionally additive:

- canonical `tenantDocument` takes precedence;
- canonical current-document streaming is preferred;
- legacy `preparedDocument`/`finalDocument` flags are used only if `tenantDocument` is absent;
- legacy per-contract prepared/final endpoints remain available;
- no existing contract model, status, upload, storage, audit, or RBAC logic was removed.

Recommended removal gate for the legacy path:

1. Deploy canonical `tenantDocument` on all current-contract responses.
2. Deploy and authorize canonical `/api/m/contracts/current/document`.
3. Verify generated, regenerated, transfer, renewal, and final-upload flows in staging/production.
4. Confirm no supported client versions still require per-variant fields or endpoints.
5. Remove the compatibility branch in a separately reviewed release.

## 12. Test Evidence

### Focused mobile contract verification

```text
Test suites: 4 passed / 4
Tests:       27 passed / 27
```

Covered:

- canonical top-level `tenantDocument` normalization;
- generated draft presentation;
- final document priority;
- canonical fields overriding contradictory legacy flags;
- preparing state;
- signed-copy exclusion;
- regenerated prepared version cache invalidation;
- focus/foreground refresh;
- final replacing draft after foreground refresh;
- transient failure preservation;
- 401 private-state clearing;
- canonical current-document route use;
- contract screen state and retry behavior.

### Backend full suite

```text
Tests: 434 passed / 434
Failures: 0
```

The backend contract bridge portion specifically verified:

- bearer-only authentication forwarding;
- canonical current-contract JSON proxying;
- canonical current-document PDF streaming;
- upstream 401/403 passthrough;
- timeout/unavailable handling;
- prepared/final legacy streaming;
- invalid contract ID rejection;
- private cache-control forwarding.

### Frontend full suite

```text
Test suites: 38 passed / 38
Tests:       233 passed / 233
Failures:    0
```

### Lint and syntax

```text
Expo lint:       0 errors
Existing lint:   4 unrelated warnings
Node syntax:     passed for modified backend route/server files
Git diff check:  passed for implementation files
```

## 13. Files Changed for This Reconciliation

### Backend / mobile API adapter

- `backend/routes/contracts.routes.js`
- `backend/server.js`
- `backend/tests/contractsBridge.test.js`

### React Native frontend

- `frontend/app/(tabs)/profile.jsx`
- `frontend/app/contract-viewer.jsx`
- `frontend/app/document-viewer.jsx`
- `frontend/app/my-documents.jsx`
- `frontend/src/hooks/useTenantContract.js`
- `frontend/src/services/documentManager.js`
- `frontend/src/utils/contractPresentation.js`

### Tests

- `frontend/src/tests/contractPresentation.test.js`
- `frontend/src/tests/contractSurveyDisplay.test.js`
- `frontend/src/tests/documentViewerActions.test.js`
- `frontend/src/tests/useTenantContract.test.js`

## 14. Remaining Dependencies and Risks

1. **Canonical source verification remains required.**
   - Inspect the actual `Capstone-Website` current-contract resolver, tenant-document resolver, identity mapping, ownership enforcement, prepared-version selection, and final upload transition.

2. **Canonical response and stream must be deployed together.**
   - `tenantDocument` should not be enabled without the canonical current-document stream expected by the mobile client.

3. **`CONTRACT_UPSTREAM_URL` must be configured correctly.**
   - The bridge fails closed with HTTP 502 when it is missing.
   - It must identify the separate canonical contract service and must not recurse to the mobile bridge itself.

4. **End-to-end authenticated device QA is still required.**
   - Generate a prepared contract on web/admin.
   - Confirm mobile returns `generated_draft` and opens that exact PDF.
   - Regenerate and confirm the newer version opens.
   - Upload the final signed and notarized copy.
   - Confirm mobile returns `final_notarized` and opens the final PDF.
   - Confirm another tenant and an expired session cannot retrieve either document.

## 15. Release Verdict

### Mobile repository

**READY FOR CANONICAL RESPONSE INTEGRATION, SUBJECT TO UPSTREAM VERIFICATION.**

The mobile repository is prepared to consume the canonical normalized contract result and unified document stream while retaining backward compatibility.

### Full web-to-mobile contract lifecycle

**NOT YET END-TO-END VERIFIED.**

The canonical source, deployed upstream behavior, identity ownership query, and authenticated document selection must be inspected and tested before declaring the complete LilyCrest contract lifecycle production-ready.
