# LilyCrest Mobile Phase 1 — P0 Security Remediation Report

Report date: 2026-08-16 (Asia/Singapore)
Scope: MOB-P0-01 (document storage authorization) and MOB-P0-02 (chatbot announcement isolation) only, plus directly necessary supporting fixes/tests.
Canonical API: `https://api.lilycrest.space` (unchanged, not deployed by this phase)
Rollback-only API: `https://mobile-api.lilycrest.space` (untouched)

## 1. Executive Verdict

**P0 SECURITY GATE PASSED — READY FOR P1 REMEDIATION**

Both P0 findings from the prior audit are RESOLVED in source, with adversarial regression tests proving the fix and guarding against reintroduction:

- **MOB-P0-01** (cross-tenant Firebase document read/delete): a client-supplied `storagePath` is no longer trusted as authorization. The download URL, the submitted path, the configured bucket, and the authenticated tenant's own upload prefix must all identify the exact same object before metadata can be registered, and the same invariant is re-checked before every privileged read/delete of already-stored (including legacy) metadata.
- **MOB-P0-02** (cross-branch/private announcement disclosure to the AI assistant): the chatbot's announcement query no longer bypasses ownership/branch/publish-window filtering. It now shares one canonical, authoritative visibility predicate with News and the merged notification feed, and a prompt-spy test proves forbidden content never reaches the Gemini prompt.

No production deployment, migration, or APK build occurred. Remaining P1/P2 blockers from the prior audit are unchanged and still block full deployment readiness — see sections 25–26.

## 2. Repository State

| Item | Before this phase | After this phase |
|---|---|---|
| Repository root | `D:/LilyCrest` | unchanged |
| Project root | `D:/LilyCrest/LilyCrest-Clean` | unchanged |
| Branch | `master` | unchanged |
| HEAD at session start | `bcf4235655cfbff8d143720300fdf8835d790801` | `13014e156e1d0bb57853d023c3347f5d5f6ad343` |
| Origin | `https://github.com/yellll03/LilyCrest-Mobile.git` | unchanged |
| Upstream (origin/master) | 0 ahead / 0 behind | 0 ahead / 0 behind |

HEAD advanced by one commit (`13014e15 fix: harden billing payment settlement and eliminate paid/unpaid state drift`) during this session. **This commit was not made by this phase** — no `git commit`, `git push`, or destructive git command was run at any point. The prior audit had already flagged that billing/PayMongo files were changing concurrently in the working tree; that concurrent work was evidently committed (and already matches `origin/master`) by another process while this phase was in progress. This phase's own changes remained uncommitted and intact on top of that new HEAD throughout, and the full backend/frontend suites were re-run after the HEAD change to confirm nothing broke (see section 22–23).

Pre-existing/concurrent worktree items specified as off-limits were inspected and confirmed **untouched by this phase**:

- `backend/controllers/billing.controller.js`, `backend/controllers/paymongo.controller.js`, `backend/routes/billing.routes.js` — now committed (part of `13014e15`), not edited by this phase.
- `frontend/app/bill-details.jsx`, `frontend/app/billing-history.jsx`, `frontend/app/document-viewer.jsx`, `frontend/app/payment.jsx`, `frontend/src/services/documentManager.js`, `frontend/src/utils/billingStatus.js` — same; committed, not edited by this phase.
- `backend/tests/billingUtilityReleaseConsistency.test.js`, `backend/tests/paymongoSettlementSecurity.test.js`, `backend/tests/billingReceiptEndpoint.test.js`, `backend/tests/billingStateConsistency.test.js`, `frontend/src/tests/billingStatementReceiptButtons.test.js`, `frontend/src/tests/billingStatusConsistency.test.js` — same.
- `../phase15c-health-deploy/` — untracked directory outside the project root, left untouched.
- `../.claude/settings.local.json` — pre-existing local tool-permission diff, unrelated to this phase, left as found.

## 3. Scope

In scope and completed: MOB-P0-01 remediation (backend authorization + fail-closed read/delete revalidation), MOB-P0-02 remediation (canonical announcement visibility service + chatbot wiring + mark-read fix), adversarial regression tests for both, full backend/frontend regression run, this report.

Explicitly out of scope and **not touched**: billing/PayMongo/receipt logic, contract bridge, room DTO, auth role allowlist, session revocation enforcement, reset-link scheme, dependency upgrades, Android release config, Render deployment, APK build, any production data or production Firebase Storage object.

## 4. Canonical API Verification

Not re-verified in this phase (no network calls were made; this was a source-only remediation phase). The prior audit's live-health finding (source/deployment drift, no version endpoint — MOB-P1-18) is unchanged and still open. No deployment occurred; the canonical host `https://api.lilycrest.space` continues to serve whatever was last deployed there, which does **not** yet include this phase's fixes.

## 5. P0-01 Original Exploit Chain

1. Tenant A authenticates and calls `POST /api/m/users/documents` with a legitimate-looking Firebase HTTPS `downloadUrl` and an arbitrary client-chosen `storagePath` (e.g. another tenant's real object path, or a guessed one).
2. `normalizeUploadedDocumentMetadata()` (`backend/controllers/user.controller.js`) validated URL *shape* (host pattern, protocol) and MIME type, but performed **no correlation** between the URL, the `storagePath`, the configured Firebase bucket, or the authenticated tenant — `storagePath` was stored verbatim under Tenant A's own `uploaded_documents` array.
3. `GET /api/m/users/documents/:id/content` (`getDocumentContent`) and `DELETE /api/m/users/documents/:id` (`deleteDocument`) both used the Firebase **Admin SDK** (privileged, bypasses Storage security rules) against `doc.storagePath` with no further check that the object actually belonged to Tenant A.
4. Result: Tenant A could read or permanently delete any object in the configured bucket whose path they knew or guessed, by registering it as their own document metadata first.

## 6. P0-01 Root Cause

`normalizeUploadedDocumentMetadata()` treated a client-supplied `storagePath` as self-authorizing. The backend's own `/api/m/upload/firebase-storage` route (`backend/routes/upload.routes.js`) already generates a safe, tenant-bound path server-side (`tenant-documents/{req.user.user_id}/{entityId}/{timestamp}-{filename}`, using `req.user.user_id` — never client input — for the tenant segment) and uploads the actual bytes there. The vulnerability was not in that upload step; it was that the **separate, later** metadata-registration call (`POST /users/documents`) never verified the `storagePath` it was told to register was the object that upload step had actually produced.

## 7. Current Document Upload Architecture

```
My Documents screen (frontend/app/my-documents.jsx)
    │  ensureFirebaseStorageAttachments([...], { folder:'tenant-documents', entityId: docType.key })
    ▼
uploadAttachmentToFirebaseStorage (frontend/src/services/firebaseStorageUpload.js)
    │  POST /api/m/upload/firebase-storage  (base64 file bytes, folder, entityId, mimeType)
    ▼
backend/routes/upload.routes.js  →  storagePath = `${folder}/${req.user.user_id}/${entityId}/${Date.now()}-${fileName}`
    │  admin.storage().bucket(...).file(storagePath).save(buffer, ...)
    │  returns { downloadUrl, storagePath, mimeType, ... }  ← genuinely safe, server-issued
    ▼
apiService.uploadUserDocument({ type, label, ...toStoredAttachmentMetadata(uploadedDocument) })
    │  POST /api/m/users/documents  ← **this call is the vulnerable seam**: client resubmits
    │  downloadUrl/storagePath from the previous response body, unverified
    ▼
backend/controllers/user.controller.js: uploadDocument → normalizeUploadedDocumentMetadata
    ▼  (now) authorizeTenantStorageObject() — see section 8
    stored under users.uploaded_documents[]
    ▼
GET  /users/documents/:id/content → getDocumentContent (Admin Storage download)
DELETE /users/documents/:id       → deleteDocument (Admin Storage delete)
```

- Frontend upload call: `frontend/app/my-documents.jsx:427-440`
- Frontend metadata shaping: `frontend/src/services/firebaseStorageUpload.js:291-310` (`toStoredAttachmentMetadata`)
- Backend upload route (path generation): `backend/routes/upload.routes.js:122-176`
- Metadata registration controller: `backend/controllers/user.controller.js` (`uploadDocument`, `normalizeUploadedDocumentMetadata`)
- Content controller: `backend/controllers/user.controller.js` (`getDocumentContent`)
- Delete controller: `backend/controllers/user.controller.js` (`deleteDocument`)
- Configured bucket: `resolveStorageBucket()` in `backend/config/firebase.js` (env `FIREBASE_STORAGE_BUCKET`, else `{FIREBASE_PROJECT_ID}.firebasestorage.app`)
- Actual generated path format: `tenant-documents/{user_id}/{docType.key}/{timestamp}-{filename}` (confirmed from `backend/routes/upload.routes.js`, not assumed)
- Stored metadata fields: `doc_id, type, label, file_url, downloadUrl, storagePath, originalName, mimeType, size, uploadedAt, provider, uploaded_at, status`

## 8. Storage Authorization Invariant

New module: `backend/services/documentStorageAuthorization.service.js`, exporting `authorizeTenantStorageObject({ downloadUrl, storagePath, userId, configuredBucket })`.

The invariant proven before any metadata write and before any privileged read/delete:

```
authenticatedUserId → expected prefix "tenant-documents/{userId}/"
        │
submitted storagePath must start with that exact prefix
        │
downloadUrl must decode (via the canonical
  https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path} shape only)
  to a bucket + object path
        │
decoded bucket must equal resolveStorageBucket()
        │
decoded object path must equal the submitted storagePath, exactly
```

Any other URL host/shape (including the `*.firebasestorage.app` string the old regex accepted but which the backend's own upload route never actually issues) is rejected as `unrecognized_url` rather than guessed at — fail closed per the non-negotiable rule that ambiguity is always a denial.

Path-traversal handling: the submitted `storagePath` is rejected outright if it contains `..`, a backslash, a leading `/`, or `//`. The decoded URL object path is checked the same way, and — to catch double-encoding (`%252e%252e` → `%2e%2e` → `..`) — is decoded a second time and re-checked before being trusted.

Design choice made explicit: **Option A (server-issued identity) was already in place** for the upload step itself; this phase closes the gap by additionally enforcing **Option B (strict server validation)** at the separate metadata-registration step, since the architecture requires the client to round-trip the URL/path between those two calls.

## 9. Document Security Changes

`backend/controllers/user.controller.js`:

- `normalizeUploadedDocumentMetadata(body, { userId })` — now requires `userId` and calls `authorizeTenantStorageObject()`; returns a generic `Document storage location could not be verified. Please re-upload the file.` error (400) on any failure, with the specific denial reason logged server-side only (`console.warn`, reason code — never bucket/path internals sent to the client).
- `uploadDocument` — passes `req.user.user_id` into the above.
- `isAuthorizedStoredDocument(doc, userId)` (new) — re-runs the same invariant against **already-stored** metadata (`doc.downloadUrl`/`doc.storagePath`), for use before every privileged operation.
- `getDocumentContent` — calls `isAuthorizedStoredDocument()` before the Admin Storage `.download()` call; fails closed with `409 { detail: "This document needs to be re-uploaded before it can be viewed." }` if the stored metadata cannot be re-verified. No Firebase Admin call is made in the failure path.
- `deleteDocument` — calls `isAuthorizedStoredDocument()` before the Admin Storage `.delete()` call; fails closed with `409 { detail: "This document could not be safely deleted. Please contact support." }`. The pending-deletion marker is rolled back and **the metadata record itself is left intact** (not deleted) so an unsafe/legacy record remains available for manual review/migration rather than being silently discarded.
- `resolveVerifiedContentType(buffer, declaredMimeType)` (new, **MOB-P1-11 opportunistically resolved**) — since the storagePath content branch had to be touched for the P0 authorization check anyway, it was also changed from unconditionally requiring `%PDF-` + `application/pdf` to validating the buffer's real magic bytes against the document's own stored `mimeType` (PDF, JPEG, PNG, WebP, GIF, BMP supported); mismatches are rejected with `422`. This does not expand P0 scope — it reuses the exact code path already being changed for authorization and closes an availability bug (mobile document uploads are images, not PDFs) discovered along the way.

`normalizeUploadedDocumentMetadata`, `isAuthorizedStoredDocument`, and `resolveVerifiedContentType` are exported via the existing `__test` pattern for direct unit coverage.

## 10. Legacy Document Handling

No automatic migration was performed (per instruction — read-only classification only). Behaviorally, every existing `uploaded_documents` record with a `storagePath` is now classified **at request time**, on every read/delete attempt, into:

- **SAFE** — `isAuthorizedStoredDocument()` returns true (URL/path/bucket/prefix all agree) → operation proceeds normally.
- **UNSAFE / AMBIGUOUS** — anything else (wrong prefix, URL/path mismatch, wrong bucket, unrecognized URL, missing data) → operation fails closed with a generic error; no Admin Storage call is made; the metadata record is preserved unmodified (delete path only clears the transient `deletion_pending` marker it had itself just set).

There is no separate "LEGACY-VERIFIABLE" bucket beyond SAFE/UNSAFE — the invariant is structural (prefix + URL/path/bucket agreement), so any record that satisfies it is safe regardless of when it was written, and any record that doesn't is treated identically to an adversarial one. This is intentionally conservative: it does not attempt to special-case "probably fine" legacy data.

## 11. Document Metadata Dry-Run Plan

**NOT VERIFIED / NOT RUN** — no database access was available/exercised in this phase (all P0-01 tests use in-memory fakes, never a real MongoDB connection), and running a live inventory against production or staging data was out of scope for this phase regardless. The dry-run this unblocks, to be run before any data remediation:

```js
// Read-only. Requires a live DB connection (not run in this phase).
const db = getDb();
const bucket = resolveStorageBucket();
const users = await db.collection('users').find(
  { 'uploaded_documents.storagePath': { $exists: true } },
  { projection: { user_id: 1, uploaded_documents: 1 } },
).toArray();

let total = 0, safe = 0, unsafeWrongPrefix = 0, unsafeUrlMismatch = 0,
    unsafeWrongBucket = 0, unsafeUnrecognizedUrl = 0, missingData = 0;

for (const user of users) {
  for (const doc of user.uploaded_documents || []) {
    if (!doc.storagePath) continue;
    total += 1;
    const result = authorizeTenantStorageObject({
      downloadUrl: doc.downloadUrl || doc.file_url,
      storagePath: doc.storagePath,
      userId: user.user_id,
      configuredBucket: bucket,
    });
    if (result.authorized) { safe += 1; continue; }
    if (result.reason === 'wrong_prefix') unsafeWrongPrefix += 1;
    else if (result.reason === 'url_path_mismatch') unsafeUrlMismatch += 1;
    else if (result.reason === 'wrong_bucket') unsafeWrongBucket += 1;
    else if (result.reason === 'unrecognized_url') unsafeUnrecognizedUrl += 1;
    else missingData += 1;
  }
}
console.log({ total, safe, unsafeWrongPrefix, unsafeUrlMismatch, unsafeWrongBucket, unsafeUnrecognizedUrl, missingData });
```

This only reads metadata fields already in the `users` collection (never fetches object content, never touches Storage) and prints counts only — no tenant PII. It must be run and reviewed before any quarantine/migration decision, per the non-negotiable data-remediation ordering in the original remediation brief.

## 12. P0-01 Adversarial Test Results

`backend/tests/documentStorageAuthorization.test.js` (unit, pure function): **12/12 pass**
`backend/tests/userDocumentStorageAuthorization.test.js` (handler-level, in-memory `users` collection + in-memory Firebase Admin Storage fake): **13/13 pass**

Covered: authorized own-path accept; foreign-tenant-path reject; own-valid-URL-paired-with-foreign-path reject (the exact substitution attack in the original finding); URL-genuinely-elsewhere-with-claimed-own-path reject; wrong-bucket reject; unrecognized/non-canonical URL host reject; malformed `/v0/b/.../o/...` shape reject; raw path traversal reject; encoded/double-encoded traversal reject; out-of-namespace path reject; missing-bucket-config fail-closed; end-to-end `uploadDocument` acceptance and rejection (including the substitution and traversal attacks and cross-bucket URLs); `getDocumentContent` authorized read, unsafe-legacy-metadata fail-closed (409, no Admin call), owner-scoping 404, MIME-aware magic-byte acceptance and spoofed-MIME rejection; `deleteDocument` authorized delete, unsafe-legacy fail-closed (object survives, metadata record survives), owner-scoping 404.

## 13. P0-02 Original Disclosure Chain

1. Any authenticated tenant sends a chatbot message that reaches the general AI-response path in `sendMessage` (`backend/controllers/chatbot.controller.js`).
2. The handler queried `db.collection('announcements').find({ is_active: true }).sort({ created_at: -1 }).limit(3)` — **no** owner filter, **no** branch filter, **no** archived filter, **no** publish/expiry window filter.
3. The (unfiltered) titles/content excerpts were placed directly into `contextLines`, which is embedded verbatim in the prompt string sent to `sendGeminiMessage()` (Gemini).
4. Result: any tenant's Lily Assistant conversation — and the Gemini model itself — could receive another branch's announcement, another tenant's private announcement, or a future/expired/archived announcement that every other surface (News, notifications) correctly hides.

## 14. P0-02 Root Cause

Announcement visibility logic already existed and was already correctly shared between News (`getAllAnnouncements`) and the merged notification feed (`getMyNotifications`) via two exported helpers, `isAnnouncementVisibleForBranch` and `resolveRequesterBranchCode`. The chatbot controller was never wired to either of them — it queried the raw collection independently. Additionally, even the two "correct" surfaces were missing a publish/expiry window check (creation persisted `publishedAt`/`expiresAt` but no read path filtered on them), and the notification mark-read fallback (`markNotificationRead`'s announcement branch) also bypassed branch visibility entirely.

## 15. Canonical Announcement Visibility Model

`backend/controllers/announcement.controller.js` now exports one authoritative async function, `getVisibleAnnouncementsForTenant(db, user, { limit, fetchCap, now })`, built from:

- `buildAnnouncementBaseQuery(userId)` — the Mongo-level filter: active (`is_active`/`isActive`, missing-both treated as active), not archived (`isArchived !== true`), and private-ownership (`is_private`/`isPrivate` docs only returned when `user_id`/`userId` matches the requester).
- `resolveRequesterBranchCode(db, user)` — unchanged, delegates to the existing authoritative `resolveTenantBranch()` tiered resolver (`backend/services/branchLocation.service.js`), fails closed (`null`) on no/conflicting occupancy.
- `isAnnouncementVisibleForBranch(doc, requesterBranchCode)` — unchanged: private announcements bypass branch matching (already exactly scoped by owner at the query level); branch-restricted announcements require an exact match; global/legacy (no branch field) always visible.
- `isAnnouncementWithinPublicationWindow(doc, now)` (**new**) — visible only once `publishedAt <= now` (or absent) and while `expiresAt > now` (or absent). Missing dates never hide legacy announcements.

`getVisibleAnnouncementsForTenant` runs the Mongo query (optionally capped by `fetchCap`, `0`/omitted = unbounded, matching prior News-feed behavior), then applies branch + window filtering in-process, then applies `limit` **after** filtering — so "3 newest visible" callers (the chatbot) don't get starved by an unlucky page of otherwise-invisible newest records.

## 16. Branch / Private / Publication Rules

Unchanged from the pre-existing, already-correct rules — reused, not reinvented:

- Branch resolution is exclusively via `resolveTenantBranch()`'s tiered lookup (current stay → active room assignment → approved contract → approved reservation), never inferred from profile/room text or client input, and fails closed (no branch-restricted content shown) on ambiguity/conflict.
- Private announcements remain owner-scoped at the query level; a stale/mismatched `branch` field on a private announcement cannot additionally hide it from its intended recipient (existing, deliberate behavior — see `announcement.controller.js` comment, preserved).
- Publication window is now enforced everywhere via `isAnnouncementWithinPublicationWindow`, using the server clock (`now = new Date()` by default, injectable for tests) — never a client-supplied time.

## 17. Chatbot Context Changes

`backend/controllers/chatbot.controller.js`:

```diff
- db.collection('announcements').find({ is_active: true }).sort({ created_at: -1 }).limit(3).toArray(),
+ getVisibleAnnouncementsForTenant(db, req.user, { limit: 3, fetchCap: 50 }),
```

The announcement summary block sent to Gemini is otherwise unchanged (title + first 120 chars of content only — already minimal; no internal IDs, no admin-only fields, no raw DB documents were ever included). Full context-minimization-by-intent (only including announcements when the user's intent actually concerns them) is **not** implemented in this phase — that's part of the broader MOB-P1-16 AI-privacy work, which remains open. This phase only removes the unauthorized-content path, per the explicit non-goal in section 24/33 of the remediation brief.

## 18. Gemini Prompt Isolation Test

`backend/tests/chatbotAnnouncementIsolation.test.js` — the mandatory prompt-spy test. Mocks `services/gemini.service.js`'s `sendGeminiMessage` to record every prompt string actually sent, then drives the real `sendMessage` handler end-to-end (real branch resolution, real visibility filtering, real prompt construction) against a fixture set covering global / own-branch / other-branch / own-private / other-tenant-private / future / expired / archived announcements, each tagged with a unique content marker.

**Result: 3/3 pass.** For a Gil Puyat tenant, the captured prompt contains all three authorized markers (global, own-branch, own-private) and **none** of the five forbidden markers (other-branch, other-tenant-private, future, expired, archived) — and a title-level `"FORBIDDEN"` substring check independently confirms no forbidden announcement leaked anywhere in the prompt. A second test confirms a tenant with no resolvable branch/occupancy gets only the global announcement. A third confirms the "Recent announcements" section is omitted entirely when nothing is visible.

## 19. Announcement Read Authorization

`backend/controllers/notification.controller.js`: `markNotificationRead`'s announcement-ID fallback previously queried active/non-archived/private-ownership only, with **no branch or window check** — MOB-P2-04. It now calls the same `getVisibleAnnouncementsForTenant(db, req.user, { fetchCap: 200 })` used everywhere else, so a `notificationId` can only resolve to (and create a read receipt for) an announcement the tenant is actually authorized to view.

## 20. P0-02 Adversarial Test Results

`backend/tests/announcementVisibilitySecurity.test.js`: **9/9 pass** — publication-window boundary tests (inclusive `publishedAt == now`, exclusive `expiresAt == now`, both ±1 second, no-dates legacy case) plus a full visibility-matrix test (global/own-branch/other-branch/own-private/other-private/future/expired/archived, asserting the exact expected visible set) and a limit-applies-after-filtering test.

`backend/tests/chatbotAnnouncementIsolation.test.js`: **3/3 pass** (see section 18).

Combined with the pre-existing (unmodified, still-passing) `announcementBranchVisibility.test.js`, `announcementHandlerIntegration.test.js`, and `notificationHandlerIntegration.test.js`, the branch/private/query-level behavior that predated this phase is confirmed unchanged by the refactor into a shared function.

## 21. Files Changed

| File | Classification | Change |
|---|---|---|
| `backend/services/documentStorageAuthorization.service.js` | P0-01 (new) | Storage authorization invariant |
| `backend/controllers/user.controller.js` | P0-01 | Wire invariant into upload/read/delete; opportunistic MIME-aware content-type fix |
| `backend/controllers/announcement.controller.js` | P0-02 | Canonical `getVisibleAnnouncementsForTenant` + publication-window predicate |
| `backend/controllers/notification.controller.js` | P0-02 | Use canonical predicate in `getMyNotifications` and `markNotificationRead` |
| `backend/controllers/chatbot.controller.js` | P0-02 | Use canonical predicate instead of raw unfiltered query |
| `backend/tests/documentStorageAuthorization.test.js` | Supporting test (new) | Unit tests for the P0-01 invariant |
| `backend/tests/userDocumentStorageAuthorization.test.js` | Supporting test (new) | Handler-level adversarial tests for P0-01 |
| `backend/tests/announcementVisibilitySecurity.test.js` | Supporting test (new) | Unit + matrix tests for the P0-02 predicate |
| `backend/tests/chatbotAnnouncementIsolation.test.js` | Supporting test (new) | Mandatory Gemini prompt-spy regression |
| `docs/mobile/MOBILE_PHASE1_P0_SECURITY_REMEDIATION_REPORT.md` | Report only (new) | This report |

No other file was modified by this phase. `docs/mobile/MOBILE_DEPLOYMENT_READINESS_AUDIT.md` (untracked, pre-existing from the prior audit) was read as input and left untouched.

## 22. Backend Regression Results

`node --test tests/*.test.js`: **392 tests, 392 pass, 0 fail, 0 skipped** (up from the prior audit's 344 — the difference is the 37 new P0 tests in this phase plus tests added by the independently-committed billing/PayMongo work). Re-run after HEAD advanced mid-session (section 2) with identical result.

## 23. Frontend Regression Results

`npx jest --runInBand`: **37 suites, 37 pass; 219 tests, 219 pass; 0 fail, 0 snapshots.** No frontend source was changed by this phase. The prior audit's nondeterministic `notificationsFilterUi.test.js` failure was **not reproduced** in this run (all 37 suites green in a single in-band run) — not something this phase needed to fix, and not claimed as fixed; it may still be flaky under different conditions and should be re-verified in the reliability phase (MOB-P2 track).

## 24. Security Regression Matrix

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| Own document path (own URL + own storagePath) | Allowed | Allowed (`upload`, `content read`, `delete` tests) | PASS |
| Foreign document path registered as own metadata | Denied | Denied, 400 on upload | PASS |
| Own valid URL + foreign storagePath substitution | Denied | Denied, 400 on upload | PASS |
| Wrong Firebase bucket | Denied | Denied, 400 on upload | PASS |
| URL object path ≠ submitted storagePath | Denied | Denied (`url_path_mismatch`) | PASS |
| Encoded/double-encoded path traversal | Denied | Denied, decode-and-recheck catches it | PASS |
| Unsafe legacy metadata — read | Denied, 409, no Admin call | Denied, 409, object untouched | PASS |
| Unsafe legacy metadata — delete | Denied, object + metadata survive | Denied, 409, object and metadata record both survive | PASS |
| Cross-tenant read/delete via owner scoping | Denied, 404 | Denied, 404 | PASS |
| Global announcement | Visible | Visible (News, notifications, chatbot prompt) | PASS |
| Own-branch announcement | Visible | Visible | PASS |
| Other-branch announcement | Hidden | Hidden everywhere, including chatbot prompt | PASS |
| Own private announcement | Visible | Visible | PASS |
| Other tenant's private announcement | Hidden | Hidden everywhere, including chatbot prompt | PASS |
| Future announcement (`publishedAt` in future) | Hidden | Hidden everywhere, including chatbot prompt | PASS |
| Expired announcement (`expiresAt` passed) | Hidden | Hidden everywhere, including chatbot prompt | PASS |
| Archived announcement | Hidden | Hidden everywhere, including chatbot prompt | PASS |
| Unauthorized announcement in Gemini prompt | Never present | Never present (prompt-spy asserts absence of every forbidden marker + "FORBIDDEN" title substring) | PASS |
| `markNotificationRead` on an announcement outside visibility | Denied | Denied — same canonical predicate now governs resolution | PASS |

## 25. Remaining P0 Issues

None. Both MOB-P0-01 and MOB-P0-02 are RESOLVED per the verdict rule in section 48 of the remediation brief (resolved in source + passing adversarial tests; not deployed).

## 26. Remaining P1 Issues

All 19 P1 findings from the prior audit remain open and untouched by this phase, as instructed: MOB-P1-01 (tenant role denylist) through MOB-P1-19 (Android release config). Two are worth flagging as adjacent to this phase's work without being resolved by it:

- **MOB-P1-11** (image documents forced through PDF-only content check) — opportunistically resolved as a side effect of touching `getDocumentContent`'s storagePath branch for P0-01 (see section 9, 17). Verified by dedicated tests (section 12).
- **MOB-P1-05** (announcement publish/expiry window) and **MOB-P2-04** (mark-read branch re-check) — resolved as directly necessary supporting work while centralizing P0-02's visibility predicate (a single shared function couldn't correctly serve the chatbot without also fixing the window, and couldn't be called from mark-read without also fixing that surface's gap). Verified by dedicated tests (section 20).

All other P1 items (role allowlist, session revocation, reset-link scheme, billing dedupe/pending-verification/idempotency/webhook durability, contract env validation, hardcoded policy content, public rooms endpoint, dependency advisories, AI privacy notice/consent, controlled migrations, deployment provenance, Android release config) are **unchanged and still block deployment.**

## 27. Database/Data Remediation Requirement

**YES, still required before the P0-01 fix can be trusted against any pre-existing production data.** The dry-run inventory script in section 11 must be run against the real database, results reviewed by a human, and any UNSAFE record quarantined/migrated per the 8-stage plan in the original remediation brief (dry-run → classify → redacted report → approval → quarantine → migrate verifiable-only → verify ownership without cross-tenant exposure → enable strict behavior). This phase's code changes make the *live* read/delete paths fail closed on unsafe records automatically (no code deployment risk), but does not itself inventory or migrate anything, and no such inventory was run (no DB access in this phase).

## 28. Render Deployment Requirement

**Not performed. Still required later**, after: (a) the data remediation dry-run in section 27, (b) this phase's code changes are reviewed/merged, and (c) per the original audit's broader gate — since 19 P1 blockers remain open regardless of P0 closure. Only the canonical service serving `https://api.lilycrest.space` may ever receive these changes; the rollback host `https://mobile-api.lilycrest.space` must not.

## 29. APK Requirement

**Not built. Not required by this phase alone.** All changes in this phase are backend-only (no `frontend/` file was modified), so once the canonical backend is eventually redeployed with these fixes, no new APK is required *for this phase's changes specifically*. A new APK will still eventually be required once the P1/P2 frontend-side fixes (role UI sync, notification feed, reset links, privacy disclosure, native release config, etc.) are implemented in a later phase.

## 30. Git / Worktree Safety

`git status --short` at the end of this phase:

```
 M ../.claude/settings.local.json                                   (pre-existing, unrelated — untouched)
 M backend/controllers/announcement.controller.js                   (P0-02)
 M backend/controllers/chatbot.controller.js                        (P0-02)
 M backend/controllers/notification.controller.js                   (P0-02)
 M backend/controllers/user.controller.js                           (P0-01)
?? backend/services/documentStorageAuthorization.service.js         (P0-01, new)
?? backend/tests/announcementVisibilitySecurity.test.js             (Supporting test, new)
?? backend/tests/chatbotAnnouncementIsolation.test.js               (Supporting test, new)
?? backend/tests/documentStorageAuthorization.test.js               (Supporting test, new)
?? backend/tests/userDocumentStorageAuthorization.test.js           (Supporting test, new)
?? docs/mobile/MOBILE_DEPLOYMENT_READINESS_AUDIT.md                 (Report only — prior audit's own output, pre-existing)
?? ../phase15c-health-deploy/                                       (Pre-existing, outside project root — untouched)
```

Zero unexplained changes. Every entry is classified above. No commit, push, reset, checkout, clean, or force operation was performed at any point in this phase. The HEAD advance documented in section 2 was caused by an external/concurrent process, not by this phase, and was verified not to have altered or discarded any of this phase's uncommitted work.

## 31. Final Verdict

**P0 SECURITY GATE PASSED — READY FOR P1 REMEDIATION**

- P0-01 resolved: **YES**
- P0-02 resolved: **YES**
- Canonical backend changed: **YES** (uncommitted, not deployed)
- Mobile frontend changed: **NO**
- Database schema changed: **NO**
- Production data changed: **NO**
- Data remediation later required: **YES** (dry-run inventory, section 27)
- Canonical Render deployment eventually required: **YES** (`https://api.lilycrest.space` only)
- Rollback Render deployment required: **NO**
- New APK required from this phase alone: **NO**
- P0 security gate: **PASS**

Next recommended phase: **Phase 2 — P1 Financial Correctness**
