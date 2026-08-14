# Phase 3 — Tenant Mobile Document Management

Date: 2026-07-24

## Decision

**DOCUMENT MANAGEMENT NOT PASSED**

The tenant app now has one native, full-screen PDF viewer with authenticated retrieval, PDF integrity checks, progress, retry, page count/navigation, pinch and double-tap zoom, rotation, private per-user offline caching, and native sharing. Release sign-off is withheld because the existing generator can drop content and physical-device/native-build verification is still outstanding.

## Document flow

```text
Tenant list / bill / contract section
  -> document-viewer (kind + opaque document ID)
  -> check current tenant's private cache
  -> protected backend ownership lookup
  -> download to app-private storage
  -> size + MIME + %PDF signature validation
  -> native paged renderer
  -> offline reopen / native share sheet
```

No backend token or private filesystem path is rendered in the UI.

## Inventory and endpoint audit

| Class | Source | Endpoint/storage | Format | Authorization and ownership |
|---|---|---|---|---|
| Lease Contract | Generated policy payload | `GET /api/m/documents/contract`; generated buffer | PDF, `application/pdf` | Active authenticated user. The mobile Contract section is hidden behind the current profile's contract record. |
| Billing statement / payment receipt | `bills` plus legacy billing sources | `GET /api/m/billing/:billingId/pdf`; generated buffer | PDF, `application/pdf` | Active authenticated user; `fetchUserBills` scopes the bill to the current user. |
| Reservation documents | Active reservation fields | `GET /api/m/users/documents/:docId`; Firebase HTTPS URL | Image or PDF depending on source | Active authenticated user; reservation is queried using the current user's database ID and the requested derived ID must match. |
| Application / uploaded documents | `users.uploaded_documents` | Same user-document endpoint; Firebase HTTPS URL | Image or PDF; stored MIME where supplied | Active authenticated user; user record is selected from the authenticated `user_id`, then exact `doc_id` match. |
| House rules, curfew, visitor, payment terms, emergency procedures | In-process document templates | `GET /api/m/documents/:docId`; generated buffer | PDF, `application/pdf` | Active authenticated user and allow-listed document ID. |

Firebase URLs are retrieval URLs, not preview URLs. The app does not display or share them; it downloads the result into app-private storage first.

## Viewer architecture

- `document-viewer.jsx`: reusable native renderer and UI state machine.
- `documentManager.js`: URL selection, authenticated transfer, per-user cache, header/MIME/size validation, errors, and sharing.
- `contract-viewer.jsx`: dedicated metadata/empty-state screen. It shows status, room, branch, lease type, dates, version, and generated date when supplied.
- `react-native-pdf` renders pages lazily and supports pinch/double-tap zoom. `react-native-blob-util` supplies its native transport dependency.

## Error handling matrix

| Condition | Result |
|---|---|
| 401/session expired | “Please sign in again…” |
| 403/inactive or unauthorized | Permission-safe message; no resource details |
| 404/missing document | “The requested document could not be found.” |
| Invalid ID/source | Invalid-link message |
| Offline without cache / timeout | Internet-required message and Retry |
| Offline with valid cache | Opens from private storage |
| Zero-byte, wrong MIME, non-PDF header | Cache entry deleted; damaged-file message |
| Partial/non-2xx download | Partial file deleted; Retry shown |
| Native share unavailable | Safe user-facing error |
| Renderer failure | Error state; app remains responsive |

## Rendering and PDF quality audit

The native viewer handles A4, portrait/landscape rotation, large and multi-page files, images, tables, and zoom without loading the complete document into a JavaScript string.

The existing raw PDF generator remains a known limitation: it emits one US-Letter page, strips non-ASCII characters instead of embedding a Unicode font, approximates text width, does not wrap arbitrary paragraphs, and skips content when the cursor reaches the footer. This can cause missing clauses or breakdown rows in long generated documents. Changing contract-generation behavior was explicitly out of scope, so this phase does not rewrite that generator.

## Security audit

- All backend routes use `authMiddleware`, which validates a live session, loads the associated user, and rejects inactive accounts.
- Bill lookup is owner-scoped.
- Uploaded and reservation document lookup is owner-scoped and exact-ID based.
- Offline files are separated by tenant identifier and remain inside app-private document storage.
- External storage paths, bearer tokens, and Firebase URLs are never shown by the viewer or sent to the share sheet.
- Existing Firebase token URLs do not have short signed-URL expiry; replacing them requires a storage architecture change.

## Performance and offline strategy

Downloads stream to disk with progress. Rendering is native and page-based; JavaScript only reads the five-byte PDF signature. Valid files persist in a tenant-specific cache and reopen offline. Failed or partial files are removed. Rotation is enabled at app configuration level.

## Verification

- Targeted ESLint: passed after fixing viewer integration issues.
- Static authorization trace: passed for bills, uploads, reservation documents, active-account checks, and exact IDs.
- Integrity paths implemented: missing, zero-byte, wrong MIME, invalid header, non-2xx, timeout/offline, renderer error.
- The targeted Android native compile did not finish inside the 120-second verification window, so it is inconclusive rather than passed.
- Device/EAS verification remains required for native pinch/double-tap behavior, large-file memory measurements, background/foreground recovery, Android share sheet, and iOS build linkage.

## Remaining minor issues / release steps

1. Rebuild the Expo development client/EAS binary; Expo Go cannot load the new native PDF modules.
2. Run the 15-case physical-device matrix on Android and iOS, especially new-architecture linkage and 16 KB Android page-size compatibility.
3. Replace the one-page raw PDF builder in a separately authorized contract/PDF-generation phase to guarantee Unicode, wrapping, pagination, signatures, headers/footers, and page numbering.
4. Replace long-lived Firebase download-token URLs with expiring server-issued URLs or authenticated streaming when the storage architecture permits it.
