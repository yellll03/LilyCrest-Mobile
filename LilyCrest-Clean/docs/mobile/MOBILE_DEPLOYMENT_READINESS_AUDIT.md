# LilyCrest Tenant Mobile Deployment Readiness Audit

Audit date: 2026-08-16 (Asia/Singapore)  
Audit mode: Read-only source, test, build, and unauthenticated health verification  
Source snapshot: `bcf4235655cfbff8d143720300fdf8835d790801` (`master`, equal to `origin/master`) plus the uncommitted files listed in section 3  
Canonical API: `https://api.lilycrest.space`  
Rollback-only API: `https://mobile-api.lilycrest.space`

## 1. Executive Verdict

**NOT READY — P0 CRITICAL ISSUE**

The app must not be distributed as a deployment-test APK from this snapshot. Two confirmed authorization designs meet the audit's P0 definition: an authenticated tenant can register an arbitrary Firebase `storagePath` and then make the backend read or delete that object, and the AI assistant loads unscoped active announcements into tenant prompts. The first permits cross-tenant document access/destruction when an object path is known or guessed; the second can disclose private or other-branch announcement content to a tenant and to Gemini.

There are also P1 blockers in payment confirmation, checkout duplicate protection, role enforcement, session revocation, reset-link handling, notifications, contract configuration, dependency posture, backend deployment provenance, and Android release configuration. Automated tests and local compilation provide useful evidence but do not close these gates.

| Severity | Open findings | Release meaning |
|---|---:|---|
| P0 | 2 | Critical security/tenant-isolation blockers |
| P1 | 19 | Deployment blockers after P0 remediation |
| P2 | 16 | Required reliability, privacy, and hardening work |
| P3 | 1 | Non-blocking cleanup |

## 2. Audit Scope

Included: the Expo/React Native tenant app under `frontend`, the Node/Express routes used or reachable by that app under `backend`, authentication/session behavior, tenant ownership and branch isolation, billing/PayMongo, documents/contracts, maintenance, notifications, profile, hidden surveys, native Android/EAS configuration, tests, dependency advisories, and the canonical unauthenticated health endpoint.

Excluded by design: applicant/reservation workflows as mobile features, admin UI behavior except where it shares or shapes tenant APIs, authenticated production data inspection, payment-provider dashboards, Firebase/Google/Render dashboards, production database writes, destructive migrations, deployment, pushing, publishing, and rollback-host deployment. No application fix was implemented by this audit.

Limitations:

- No production tenant credentials or production records were used. Data-dependent findings are source-proven unless explicitly marked `NOT VERIFIED`.
- Render environment variables, PayMongo webhook registration, Google/Firebase release credentials, and contract-upstream ownership are `NOT VERIFIED` in their deployed dashboards.
- iOS has Expo configuration but no checked-in `ios` native project; iOS compilation/signing was not tested. The requested deployment artifact is Android-focused.
- The working tree changed concurrently during the audit. The final source review uses the newest on-disk files listed in section 3, but those changes are uncommitted and are not proven deployed.

## 3. Repository State

| Item | Result |
|---|---|
| Git root | `D:/LilyCrest` |
| Audited project | `D:/LilyCrest/LilyCrest-Clean` |
| Branch / commit | `master` / `bcf4235655cfbff8d143720300fdf8835d790801` |
| Upstream state | 0 ahead / 0 behind `origin/master` |
| Origin | `https://github.com/yellll03/LilyCrest-Mobile.git` |
| Existing target report | None before this audit |
| Application changes by this audit | None |

Pre-existing or concurrently created worktree changes were preserved:

- `../.claude/settings.local.json`
- `backend/controllers/billing.controller.js`
- `backend/controllers/paymongo.controller.js`
- `frontend/app/bill-details.jsx`
- `frontend/app/billing-history.jsx`
- `frontend/app/document-viewer.jsx`
- `frontend/src/utils/billingStatus.js`
- `backend/tests/billingUtilityReleaseConsistency.test.js` (untracked)
- `backend/tests/paymongoSettlementSecurity.test.js` (untracked; appeared during report generation)
- `frontend/src/tests/billingStatusConsistency.test.js` (untracked)
- `../phase15c-health-deploy/` (untracked)

The billing, PayMongo, viewer, and regression-test files changed while the audit was running. Relevant tests were rerun after the changes. Deployment must begin from a deliberate commit/tag and repeat the gates because a mutable, dirty snapshot is not reproducible.

## 4. Deployment / API Architecture

The mobile API resolver defaults to the canonical host and forms `/api/m` in `frontend/src/config/api.js:1-5,59-67`. All EAS profiles set `EXPO_PUBLIC_BACKEND_URL=https://api.lilycrest.space` in `frontend/eas.json:6-38`. The rollback hostname is documented but not selected by default. A public override is still accepted, including the rollback host; only empty, Render, TryCloudflare, localhost, and private-network inputs are rejected/fallen back (`frontend/src/config/api.js:36-56`).

The backend mounts one router twice at `/api` and `/api/m` (`backend/server.js:161-163`). This is an **intentional compatibility alias**, not two implementations. The mobile client consistently uses `/api/m`. PayMongo webhook registration uses `/api/paymongo/webhook`, while redirects use `/api/m/paymongo/...`; both reach the same handlers.

Live read-only verification on 2026-08-16:

- `GET https://api.lilycrest.space/api/m/health` returned HTTP 200 in 0.696 s with `status: healthy`, `backend: Node.js/Express`, and `auth: Firebase-only`.
- DNS resolves the canonical hostname through `lilycrest-api.onrender.com` to Render/Cloudflare.
- The deployed response does **not** match this repository: local `backend/routes/index.js:91-94` returns only `{status:'ok'}`, and local rate limiting is 100 requests/minute (`backend/server.js:117-127`), while the live response advertised 1000/900 seconds and additional security/request-id middleware absent here. This proves deployment/source drift or an undocumented wrapper. There is no commit/version endpoint.

`CONTRACT_UPSTREAM_URL` must be a separate authoritative Capstone host; the bridge forwards the exact bearer token to its `/api/m/contracts/...` paths (`backend/routes/contracts.routes.js:41-95,131-144`). The local ignored environment inspected during the audit does not define that variable, while `validateEnv()` does not require it (`backend/server.js:168-198`). Deployed value: `NOT VERIFIED`.

## 5. Mobile Route & Screen Inventory

All Expo Router files under `frontend/app` were inventoried. “Protected” means the global route guard requires an authenticated tenant session; auth/reset routes are public by necessity.

| Route | Screen | File | Reached from | Auth | Main API dependencies | Status |
|---|---|---|---|---|---|---|
| `/` | Bootstrap | `frontend/app/index.jsx` | Launch | No | session hydration, `/users/me` | ACTIVE |
| `/login` | Sign in | `frontend/app/login.jsx` | Bootstrap/logout | No | auth login/Google | ACTIVE |
| `/otp-verify` | Login OTP | `frontend/app/otp-verify.jsx` | Password login | Pending auth | verify/resend OTP | ACTIVE |
| `/forgot-password` | Forgot password | `frontend/app/forgot-password.jsx` | Login | No | forgot password | ACTIVE |
| `/reset-password` | Reset password | `frontend/app/reset-password.jsx` | Email deep link | No | reset status/reset | ACTIVE |
| `/auth-callback` | Auth callback alias | `frontend/app/auth-callback.jsx` | Legacy deep link | No | none; redirects | DEPRECATED |
| `/home` | Home alias | `frontend/app/home.jsx` | Legacy route | Yes | none; redirects | DEPRECATED |
| `/(tabs)/home` | Tenant home | `frontend/app/(tabs)/home.jsx` | Center tab | Yes | dashboard, notifications, billing | ACTIVE |
| `/(tabs)/announcements` | News/notifications | `frontend/app/(tabs)/announcements.jsx` | News tab/bell | Yes | announcements; mark-all through context | ACTIVE |
| `/(tabs)/services` | Maintenance/services | `frontend/app/(tabs)/services.jsx` | Services tab | Yes | maintenance and uploads | ACTIVE |
| `/(tabs)/billing` | Billing tab wrapper | `frontend/app/(tabs)/billing.jsx` | Billing tab | Yes | redirects to history | ACTIVE |
| `/(tabs)/profile` | Profile | `frontend/app/(tabs)/profile.jsx` | Profile tab | Yes | users/me, update | ACTIVE |
| `/(tabs)/chatbot` | Lily Assistant | `frontend/app/(tabs)/chatbot.jsx` | Service/home/profile actions | Yes | chatbot/support chat/upload | ACTIVE (hidden tab) |
| `/(tabs)/dashboard` | Dashboard alias | `frontend/app/(tabs)/dashboard.jsx` | Legacy route only | Yes | none; redirects | DEPRECATED |
| `/billing-history` | Billing history | `frontend/app/billing-history.jsx` | Billing wrapper/home | Yes | latest/history/paid | ACTIVE |
| `/bill-details` | Bill details/proof | `frontend/app/bill-details.jsx` | Billing card | Yes | bill, PDF, proof, checkout | ACTIVE |
| `/payment` | Legacy payment launch | `frontend/app/payment.jsx` | Deep link/legacy call | Yes | bill, checkout | ACTIVE/LEGACY |
| `/payment-success` | Payment reconciliation | `frontend/app/payment-success.jsx` | PayMongo deep link | Yes | checkout status polling | ACTIVE |
| `/payment-cancel` | Payment cancelled | `frontend/app/payment-cancel.jsx` | PayMongo deep link | Yes | none | ACTIVE |
| `/my-documents` | Tenant documents | `frontend/app/my-documents.jsx` | Profile | Yes | document list/upload/delete, contract | ACTIVE |
| `/contract-viewer` | Contract viewer | `frontend/app/contract-viewer.jsx` | Profile/documents | Yes | current/prepared/final | ACTIVE |
| `/document-viewer` | PDF viewer | `frontend/app/document-viewer.jsx` | Bills/policies/contracts | Yes | protected binary endpoints | ACTIVE |
| `/image-viewer` | Image viewer | `frontend/app/image-viewer.jsx` | My Documents/maintenance | Yes | user document content/direct attachment | ACTIVE |
| `/documents` | Policy document menu | `frontend/app/documents.jsx` | Deep link/legacy | Yes | static policy PDFs | ACTIVE but weakly discoverable |
| `/house-rules` | House rules | `frontend/app/house-rules.jsx` | Settings/profile | Yes | local copy | ACTIVE |
| `/settings` | Settings | `frontend/app/settings.jsx` | Profile | Yes | push token/settings | ACTIVE |
| `/change-password` | Change password | `frontend/app/change-password.jsx` | Profile/settings | Yes | change password | ACTIVE |
| `/about` | About | `frontend/app/about.jsx` | Settings | Yes | none | ACTIVE |
| `/privacy-policy` | Privacy policy | `frontend/app/privacy-policy.jsx` | Settings | Yes | none | ACTIVE |
| `/terms-of-service` | Terms | `frontend/app/terms-of-service.jsx` | Settings | Yes | none | ACTIVE |
| `/surveys` | Survey list | `frontend/app/surveys.jsx` | Feature-gated profile | Yes | survey endpoints | HIDDEN |
| `/survey-form` | Survey form | `frontend/app/survey-form.jsx` | Survey list/push | Yes | survey read/draft/submit | HIDDEN |
| `/debug/api-health` | API diagnostics | `frontend/app/debug/api-health.jsx` | Direct URL | Public prefix, component-gated | health/diagnostics | DEV-ONLY; release redirects |

The survey flag is hard false (`frontend/src/config/features.js:7`), profile entry is conditional, both screens redirect/return null, and notification routing suppresses survey destinations (`frontend/app/surveys.jsx:56-59`, `frontend/app/survey-form.jsx:99-102`, `frontend/src/services/notifications.js:301-348`). No reservation process was found or introduced in tenant mobile.

## 6. End-to-End Architecture Map

| Screen/module | Frontend state/client | HTTP route | Middleware/controller/service | Data and response/render |
|---|---|---|---|---|
| Auth screens | `AuthContext`, `apiService` | auth routes | auth limiter/controller, Firebase Identity/Admin | `users`, `user_sessions`, `otp_store`, reset tokens → sanitized user/session |
| Home | local hooks + `AuthContext` | `GET /dashboard/me`, `/notifications`, billing history | auth + tenant; dashboard/notification/billing controllers | assignment/rooms/reservations, notifications/announcements, bills → cards/quick actions |
| News | local state + context unread state | `GET /announcements`, `PATCH /notifications/read-all` | optional auth vs auth+tenant | announcements + read-state collections → filtered list |
| Maintenance | screen state, upload service | maintenance CRUD/reply/read/resolve routes | auth + tenant; maintenance controller | `maintenance_requests` + legacy collection → tenant-safe DTO/timeline |
| Billing | screen state + shared `billingStatus` | billing list/detail/PDF/proof | auth + tenant; billing controller/domain policy | `bills`, legacy `billing`, `utilityperiods` → normalized bill DTO/PDF |
| Payments | browser/deep link + polling | PayMongo checkout/status/webhook/redirect | auth + tenant except webhook/redirect | PayMongo + bill record → checkout/reconciliation/status |
| Documents | document managers | users documents/static documents/contracts | auth + tenant; user/doc/bridge controllers | user/reservation/generated docs, Firebase, upstream contract → metadata/binary viewer |
| Profile | `AuthContext.updateUser` | `GET/PUT /users/me` | auth + tenant; validation and branch resolver | users/reservations/contracts/branches → client-safe profile |
| Lily Assistant | `useAssistantChat` | chatbot/support chat/upload | auth + tenant; chatbot/Gemini/attachment services | bills, maintenance, announcements, chat history + Gemini → assistant thread |
| Surveys (hidden) | local/cache/draft services | survey tenant routes | tenant middleware; survey service | surveys/responses → gated UI |

Static screens skip backend layers. Contract internals beyond the bridge are `NOT VERIFIED` because the authoritative upstream repository/configuration is outside this workspace.

## 7. Authentication & Session Audit

Passes:

- Password login validates input, verifies through Firebase, applies account locks, sends a hashed 10-minute OTP, and creates a seven-day single session only after OTP (`backend/controllers/auth.controller.js:238-537`). Google login verifies the Firebase ID token. Registration is disabled unless explicitly enabled and creates an inactive resident.
- Session tokens are held in SecureStore; “remember me” off uses memory. Logout invalidates the server session and removes credentials. Change/reset password invalidate active sessions (`backend/controllers/auth.controller.js:871-1008,1362-1400`).
- `/users/me` and auth responses use `sanitizeUserForClient` through `backend/utils/normalizeUser.js`; tests cover serialization and secret removal.

Blockers and risks:

- **MOB-P1-01:** Tenant identity is defined as “not admin/superadmin.” Login queries and `tenantMiddleware` admit `owner`, `branch_admin`, applicant, and unknown active roles (`backend/controllers/auth.controller.js:111-119,385-389,603-625`; `backend/middleware/auth.js:117-131`). Use an explicit tenant-role allowlist shared by login, middleware, and client.
- **MOB-P1-02:** New sessions store `security_version`, but local `authMiddleware` validates only token and expiry and never compares it to the user's current version (`backend/controllers/auth.controller.js:62-88`; `backend/middleware/auth.js:25-53`). Cross-system version revocation can therefore fail unless every session document is deleted.
- **MOB-P1-03:** reset links contain the bearer reset token in generic, unverified `frontend://` / `exp+frontend://` schemes (`backend/controllers/auth.controller.js:1127-1128`; `frontend/app.config.js:10,38-44`). Another Android app can register the scheme and intercept a single-use password-reset token. Use verified HTTPS App Links/universal links or a dedicated domain-bound flow.
- **MOB-P2-01:** bootstrap network errors restore cached `session_user` as authenticated, while `checkAuth()` network errors delete that cache and log out (`frontend/src/context/AuthContext.js:494-538,806-848`). Define one offline-expiry policy.
- **MOB-P2-02:** Android backup is allowed and backup rules exclude only SecureStore (`frontend/android/app/src/main/AndroidManifest.xml:36`; secure-store XML rules). `session_user` and persistent tenant PDF/image caches are not excluded. Logout clears PDF but not image cache (`frontend/src/context/AuthContext.js:780-804`; `frontend/src/services/imageDocumentManager.js:7-13`).

## 8. Home / Dashboard Audit

`/(tabs)/home` fetches the dashboard, notification feed, and billing summary and has explicit loading/error/empty behavior. Dashboard ownership starts from `req.user` and does not accept a tenant ID. Room details are derived from occupancy/bed/reservation records and a room document (`backend/controllers/dashboard.controller.js:96-253`).

**MOB-P2-03:** dashboard independently resolves occupancy → bed history → reservation and formats branch text, instead of using the canonical tiered `resolveTenantBranch()` used by profile/notifications (`backend/controllers/dashboard.controller.js:96-253` versus `backend/services/branchLocation.service.js:204-220`). The same tenant can therefore see a different branch/assignment on Home than Profile or News. Replace dashboard branch resolution with the shared service and define one authoritative current-stay DTO.

Home also overlaps billing calls with Billing History and notification calls with `AuthContext`; this is not a security defect but contributes to start-up load and inconsistent snapshots.

## 9. Notifications / News Audit

Passes:

- The shared context owns `notifications`, unread count, mark-one, mark-all, polling, foreground refresh, optimistic rollback, and 401 teardown (`frontend/src/context/AuthContext.js:123-260,470-475`).
- Direct announcements use authoritative branch resolution and fail closed on conflict/missing branch; private announcements are owner scoped (`backend/controllers/announcement.controller.js:75-150`). Branch tests pass.
- The former permanent chip wall is replaced with `[Filters] [Newest/Oldest] [Refresh]` and a category/priority modal (`frontend/app/(tabs)/announcements.jsx:317-349,523-752`). Category and priority are independent in the UI.

Failures:

- **MOB-P1-04:** the shared feed is `GET /notifications`, but News fetches only `GET /announcements` and calls `clearNotificationUnread()` on focus (`frontend/app/(tabs)/announcements.jsx:317-346`; `frontend/src/context/AuthContext.js:187-251`). Personal billing/maintenance notifications shown in the bell are marked read and then absent from “view all.” Render the shared merged feed, or expose one canonical feed endpoint for every surface.
- **MOB-P1-05:** announcement reads do not filter `publishedAt <= now` or `expiresAt > now`, even though creation persists both (`backend/controllers/announcement.controller.js:117-139,163-198`; the notification merge has the same omission at `backend/controllers/notification.controller.js:103-139`). Future/expired content can be visible.
- **MOB-P2-04:** mark-one validates stored-notification ownership, but the announcement fallback does not re-run authoritative branch resolution (`backend/controllers/notification.controller.js:179-216`). It returns no content, so impact is limited to an unauthorized read receipt; still require the same visibility predicate.
- **MOB-P2-05:** notification `data.url` accepts any internal path except surveys (`frontend/src/services/notifications.js:301-312`). Replace with a route allowlist and typed parameters.

## 10. Maintenance / Services Audit

Passes:

- All tenant routes require auth + tenant middleware and locate records with `user_id`/user ObjectId before returning a tenant DTO (`backend/routes/maintenance.routes.js:11-19`; `backend/controllers/maintenance.controller.js:1065-1110`). Internal notes, negotiation, alternative providers, and admin-only details are not returned; assignment is reduced to safe summary fields.
- Creation validates enum, description 10–1000, maximum attachments/size, and client idempotency. The frontend persists `client_request_id` and disables submission; unique/concurrency regression tests pass (`backend/controllers/maintenance.controller.js:20-24,1418-1529`; `frontend/app/(tabs)/services.jsx:567-586`).
- Tenant mutations are state constrained: edit/cancel pending, reopen resolved, confirm resolved, and replies have content/attachment checks.

Issues:

- **MOB-P2-06:** backend sequence is pending → viewed → assigned → in_progress → resolved, while UI orders in_progress before assigned and includes scheduled; backend has no transition into scheduled (`backend/controllers/maintenance.controller.js:26-40`; `frontend/app/(tabs)/services.jsx:199-204,1246-1257`). Align one exported state machine.
- **MOB-P2-07:** maintenance attachment metadata requires Firebase URL/path but does not correlate the URL object path, configured bucket, or `maintenance/{tenant}/` prefix (`backend/controllers/maintenance.controller.js:357-413`). Apply the strict pattern already implemented for AI attachments in `backend/services/assistantAttachment.service.js:20-60`.
- **MOB-P2-08:** generic upload trusts client MIME and does not inspect magic bytes (`backend/routes/upload.routes.js:118-184`). Abandoned pre-mutation uploads are not reclaimed. Tenant list endpoints are unpaginated.
- **MOB-P2-09:** after an owner-scoped lookup, several mutations update by `request_id` rather than `request_id + owner`; collision/duplicate legacy rows could update the wrong record (`backend/controllers/maintenance.controller.js:1089-1110,1571-1576,1637-1655`). Carry the owner filter through the mutation and enforce uniqueness.

## 11. Billing Audit

The controller reads both legacy `billing` and canonical `bills`, maps them into a common DTO, filters hidden statuses, enriches canonical bills from `utilityperiods`, and owner-scopes every ID lookup through authenticated user identity. Billing History, Home, Details, and payment use stable bill IDs where available.

**MOB-P1-06:** cross-collection deduplication first merges equal IDs, then collapses different IDs sharing period, description, dates, amount, type, and charge fingerprint; the preferred record is merged with missing fields from the fallback (`backend/controllers/billing.controller.js:370-483,561-596`). Two legitimate same-value bills can collapse, and fields from separate records can blend. Replace heuristic identity with an explicit migration/crosswalk key and never merge financial fields across IDs.

The current uncommitted mapping adds `billingCycleStart`/`dueDate` fallbacks for canonical utility deadlines (`backend/controllers/billing.controller.js:982-1035`) and shared UI scheduling in `frontend/src/utils/billingStatus.js:32-75`. This fixes the reported real canonical bill in new tests, but it is not committed/deployed and legacy records without dates can still render “not released.”

Plain `Number` is used for money, and invalid/negative display values can be normalized to zero. See section 28.

## 12. Payment Integrity Audit

Passes:

- Checkout resolves a bill through authenticated ownership, supplies bill/user metadata to PayMongo, uses centavos in the gateway payload, rejects paid/non-payable bills, and current canonical bills have a 20-minute reuse window plus atomic creation claim (`backend/controllers/paymongo.controller.js:681-835`).
- Webhook signatures use timing-safe verification and fail closed when invalid (`backend/controllers/paymongo.controller.js:927-939`). Status polling is owner scoped. Current uncommitted logic records but does not settle an underpayment; a newly added untracked suite covers correct/wrong bill and tenant metadata, checkout-ID fallback/ambiguity, underpayment, duplicate delivery, concurrent settlement, and a pending session.

Blockers:

- **MOB-P1-07:** `pending_verification` is normalized as an active status but absent from both backend and frontend non-payable sets (`backend/controllers/billing.controller.js:12-18,161-168,521-525`; `frontend/src/utils/billingStatus.js:7-19`). A proof-under-review bill remains outstanding and can start PayMongo checkout. Add `pending_verification` and aliases to one shared policy and test every surface/API.
- **MOB-P1-08:** atomic reuse/claim applies only when `source === 'real'`; a legacy `billing` record goes directly to PayMongo after the read check (`backend/controllers/paymongo.controller.js:723-772,815-830`). Concurrent taps/retries can mint multiple live sessions. Implement an idempotency collection or equivalent atomic claim for both sources.
- **MOB-P1-09:** `getCheckoutSessionPaymentState()` treats an inactive session with any non-empty payments array as confirmed even if an individual payment is failed/pending (`backend/controllers/paymongo.controller.js:64-77`). Require a successful payment/intent state and reconcile amount/currency/bill metadata.
- **MOB-P1-10:** webhook processing catches database/provider errors and still returns 200, explicitly preventing retries (`backend/controllers/paymongo.controller.js:933-965`). Persist events idempotently before acknowledgement or return retriable failure on uncommitted processing errors.

The newly added underpayment logic reads, then updates. Its new tests are useful, but currency validation, legacy-source behavior, failed/mixed payments inside an inactive session, and an underpayment-specific race remain uncovered. It must stay in the financial regression phase before deployment.

## 13. Utility Calculation Audit

Canonical bills can be enriched by matching `utilityperiods.tenantSummaries.billId`, deriving electricity/water structures only from persisted period data (`backend/controllers/billing.controller.js:909-964`). Exposed structures can include readings, consumption, rates, shared totals/counts, and tenant share. Missing data is honestly rendered “Breakdown unavailable”; no fabricated readings are created.

Legacy billing often stores only final `electricity`/`water` amounts. That is a confirmed model limitation: a structured historical breakdown cannot be reconstructed safely. The fix is a controlled backfill from authoritative meter/utility records where available, otherwise preserve the explicit unavailable state.

The concurrent release-date fix maps real `billingCycleStart` and `dueDate` to utility deadlines and passes four backend regression tests. Production deployment/data result is `NOT VERIFIED`.

## 14. Billing Statement / Receipt / PDF Audit

Current uncommitted frontend changes now consistently label `/billing/:id/pdf` as **Billing Statement**, and the backend emits `BILLING STATEMENT` or `BILLING STATEMENT - PAID` with `TOTAL PAID` for settled bills (`frontend/app/bill-details.jsx:703-711`; `frontend/app/billing-history.jsx:415-423`; `backend/controllers/billing.controller.js:1651-1673`). This removes the earlier false “Payment Receipt” label.

There is still no mobile receipt resource with a receipt number, actual payment amount/date/method/reference, and settlement/remaining-balance semantics. **MOB-P2-10:** a statement and receipt remain different artifacts; expose a separately owner-scoped receipt endpoint if an in-app receipt is a release requirement. PayMongo email receipt behavior/dashboard is `NOT VERIFIED`.

PDF byte/pagination tests pass. The builder intentionally uses large dark navy panels; visual inspection of a production-data PDF was not performed. The viewer background was concurrently changed from dark to light in `frontend/app/document-viewer.jsx:84-94`. Therefore the reported “large black blocks” are **not conclusively reproduced** in generated bytes; source contains a design risk, and device/render QA remains required. The audit did not use production billing data or generate a production receipt.

## 15. Contracts & Documents Audit

Contracts are fetched only through the authenticated tenant bridge and stream prepared/final states according to the upstream response. User document lists remove direct URLs/path fields, reservation documents are owner-located, and generated contract visibility is limited to published states. Upstream contract ownership and state rules are `NOT VERIFIED` outside this repo.

Critical failures:

- **MOB-P0-01:** upload metadata accepts any Firebase HTTPS URL and arbitrary `storagePath` without tenant prefix, bucket, or URL/path correlation (`backend/controllers/user.controller.js:297-338,534-566`). Later content retrieval downloads that path from the configured privileged bucket, and deletion deletes it (`backend/controllers/user.controller.js:821-832,867-905`). A tenant can pair their own valid Firebase URL with another known/guessed object path, then read a PDF or delete the object. Enforce server-issued upload receipts or reconstruct/validate `tenant-documents/{user_id}/...`, match decoded URL path and bucket, and refuse legacy unsafe paths until migrated. Add adversarial read/delete tests. This is a canonical-backend P0 and may require database metadata quarantine/remediation.
- **MOB-P0-02:** discussed in sections 21/22/36: unscoped chatbot announcements are a separate document/content disclosure path.
- **MOB-P1-11:** all mobile user uploads are images with a `storagePath`, but the storagePath content branch requires `%PDF-` and always responds `application/pdf` (`backend/controllers/user.controller.js:821-832`; image upload flow `frontend/app/my-documents.jsx:403-439`). Image viewing will return 422. Validate magic bytes against stored MIME and return the correct safe image type.
- **MOB-P1-12:** the contract bridge returns 502 when `CONTRACT_UPSTREAM_URL` is missing (`backend/routes/contracts.routes.js:55-86`), but startup validation omits it. Local env is missing; deployed env is `NOT VERIFIED`. Make required-feature environment validation explicit and verify the separate upstream before release.
- **MOB-P1-13:** policy PDFs and chatbot presets contain placeholder-looking bank accounts, wallet numbers, emergency numbers, contact/rates, and rules (`backend/controllers/documents.controller.js:153-188`; `backend/config/chatbot.presets.js:33-76`). These are tenant-facing financial/safety instructions. Replace with approved configuration/content records and obtain owner/DPO/operations sign-off.

## 16. Profile Audit

Profile is largely ready. `GET /users/me` owner-scopes the user, hydrates approved-application address read-only, allows the saved tenant phone to override the application fallback, resolves branch with the canonical service, and returns a sanitized DTO (`backend/controllers/user.controller.js:160-210`). `PUT /users/me` allows only username, phone, and picture; email/address are rejected, username uniqueness/cooldown is server-enforced, and Philippine phone normalization is server-side (`backend/controllers/user.controller.js:343-497`). Frontend validation mirrors username/phone constraints and handles field errors (`frontend/app/(tabs)/profile.jsx:19-41,140-220`).

No obsolete reservation workflow is exposed as a tenant action. Reservation data remains an authoritative read-only source for approved address/documents, which is legitimate but should be described in privacy documentation.

## 17. Feedback / Survey Release-State Audit

Status: **HIDDEN INTENTIONALLY — PASS for this APK scope.**

`SURVEY_FEEDBACK_ENABLED=false`; profile does not fetch/show survey UI, routes immediately redirect to profile and render null, and push/deep links are routed back to News (`frontend/src/config/features.js:7`; profile `:102-112,584-596`; survey screens `:99-102` and `:56-59`; notification resolver `:301-348`). Tests cover the release gate. Backend survey routes remain live but authenticated/tenant-scoped; this is acceptable deferred code, not a reason to delete the module.

## 18. Navigation & Mobile UX Audit

The five visible tabs are Services, News, Home, Billings, and Profile; Assistant is deliberately hidden from the tab bar but reachable from actions. Deprecated aliases redirect safely. Global protected-route handling covers viewers and deep-link targets. The release debug screen also self-gates with `__DEV__` and has a passing regression test.

Loading, retry, empty states, safe-back behavior, FlatList use, and accessible labels are present on major screens. Remaining physical-device gaps include keyboard/text-scaling, modal focus, Android back behavior, very long payment references/names, small-screen layout, and TalkBack traversal; these are `NOT TESTED`. Direct internal notification URLs need allowlisting (MOB-P2-05). Generic reset/payment schemes need a verified-link redesign (MOB-P1-03).

## 19. API Route Inventory

All paths below are canonical mobile paths under `/api/m`; the same router is intentionally mirrored at `/api`. “Tenant” currently means the flawed negative-role middleware described in MOB-P1-01.

| API group | Methods/routes | Auth/ownership/branch/validation | Mobile use | Status |
|---|---|---|---|---|
| Health | `GET /health`, `GET /` | Public, no data | diagnostics/bootstrap | PASS (live health 200; source drift) |
| Auth | `POST /auth/google`, `/register`, `/login`, `/login/verify-otp`, `/login/resend-otp`, `/logout`, `/session-teardown`, `/change-password`, `/forgot-password`, `/reset-password/status`, `/reset-password`; `GET /auth/me`, `/auth/reset-password` | Public where necessary; auth on me/logout/change; input checks and rate limiter | auth screens/context | PARTIAL — role, revocation, reset link |
| Users/profile | `GET/PUT /users/me`; `POST /users/push-token` | auth+tenant; owner from session; field validation | profile/context/settings | PASS |
| User documents | `GET/POST /users/documents`; `GET /users/documents/:id`, `GET .../:id/content`, `DELETE .../:id` | auth+tenant; metadata owner, unsafe storage path | My Documents/viewers | FAIL |
| Dashboard | `GET /dashboard/me` | auth+tenant; session owner; divergent branch resolver | Home | PARTIAL |
| Billing | `GET /billing/me`, `/me/latest`, `/history`, `/history/paid`, `/:id`, `/:id/pdf`; `POST /:id/payment-proof` | auth+tenant; owner-scoped IDs; proof validation | Home/history/details | PARTIAL — dedupe/status/PDF semantics |
| PayMongo | `POST /paymongo/checkout`; `GET /checkout/:id/status`; `POST /webhook`; `GET /redirect/success`, `/redirect/cancel` | tenant ownership on checkout/status; signed webhook; owner encoded reconciliation | payment screens | FAIL |
| Announcements | `GET /announcements` | optional auth; owner/branch visibility; no publication window | News | PARTIAL |
| Notifications | `GET /notifications`; `PATCH /read-all`, `/:id/read` | auth+tenant; stored owner, announcement read gap | context/header | PARTIAL |
| Maintenance | `GET /maintenance/me`, `/:id`; `POST /maintenance`, `/:id/replies`; `PUT /:id`; `PATCH /:id/read`, `/cancel`, `/reopen`, `/confirm-resolved` | auth+tenant; owner lookup; strong body/idempotency; mutation filter/path gaps | Services | PARTIAL |
| Upload | `GET /upload/imagekit-auth`; `POST /upload/firebase-storage` | auth+tenant; size/type/path generated server-side; MIME magic gap | maintenance/docs/assistant | PARTIAL |
| Static documents | `GET /documents/:docId` | auth+tenant; fixed allowlist | policies/viewer | FAIL until content approved |
| Contracts | `GET /contracts/current`, `/:id/documents/prepared`, `/:id/documents/final` | bridge-level auth+tenant; upstream bearer/ownership unknown | contract screens | NOT TESTED / config blocker |
| Chatbot | `POST /chatbot/message`, `/request-admin`, `/reset`, `/close-live-chat`; `GET /live-status/:id`, `/history` | auth; tenant on all except close route (controller owner check required); mixed in-memory/DB | Assistant | FAIL — unscoped announcements/privacy |
| Support chat | `POST /chat/start`, `/:id/messages`; `GET /chat/me`, `/:id/messages`; `PATCH /:id/close` | route parent applies auth; tenant middleware; conversation owner tests | Assistant/admin escalation | PASS/PARTIAL reliability |
| FAQs | `GET /faqs`, `/faqs/categories` | Public/cache | support knowledge | PASS |
| Rooms | `GET /rooms`, `/:roomId` | **No auth; returns raw documents** | not required by current tenant UI | FAIL |
| Surveys | tenant `GET /surveys/me`, `/:id/me`, `/:id/response/me`; `PUT /:id/draft`; `POST /:id/submit` | router parent auth; tenant eligibility/branch/service validation | hidden screens | PASS for hidden state |
| Tickets | `GET /tickets/me`, `/:id`; `POST /tickets`, `/:id/respond`; `PUT /:id/status` | auth+tenant; owner scoped | support/escalation legacy | PARTIAL; limited mobile coverage |
| Seed/admin variants | `/seed`, maintenance/ticket/chatbot/survey/user admin routes | auth + admin/permission; seed returns 404 in production | not tenant mobile | NOT APPLICABLE; still mirrored under both prefixes |

**MOB-P1-14:** `GET /rooms` and `GET /rooms/:roomId` have no auth and serialize raw Mongo documents except `_id` (`backend/routes/room.routes.js:5-6`; `backend/controllers/room.controller.js:4-22`). If room documents contain beds, assignments, internal notes, or operational fields, they are public. Production schema/data was not queried. Require auth or an explicit public DTO; add a no-PII contract test.

## 20. API Validation Audit

Read endpoints generally derive owner identity from `req.user` rather than user-supplied IDs. Write endpoints have meaningful body checks, but there is no centralized schema middleware; validation is duplicated in controllers and frontend helpers.

Key gaps are: document metadata has no storage authorization invariant; maintenance metadata lacks URL/path/prefix correlation; pending-verification payment policy is omitted; PayMongo settlement accepts an unsafe state; notification direct routes are not typed; required feature environment variables are not validated on startup. Malformed-ID paths mostly return 404/422 safely, but there is no complete fuzz/IDOR suite for documents/payments.

## 21. Authentication / Authorization / IDOR Audit

Authentication and authorization were evaluated separately. A valid bearer session is required on private routes, and most bill/maintenance/profile/chat lookups include authenticated owner identity. That does not compensate for the following:

- P0 document storage-path authorization bypass (MOB-P0-01).
- P0 chatbot content scoping bypass (MOB-P0-02): `sendMessage` loads the three newest `{is_active:true}` announcements with no owner, visibility, branch, archive, publish, or expiry filter (`backend/controllers/chatbot.controller.js:1133-1145,1214-1217`), then includes them in Gemini prompts (`:1394-1396`; `backend/services/gemini.service.js:81-102`).
- Tenant role authorization is a denylist rather than allowlist (MOB-P1-01).
- Sessions do not enforce security-version revocation (MOB-P1-02).
- Rooms are public/raw (MOB-P1-14).

No production ID guessing was performed. Source proves the document exploit chain without accessing another tenant's record.

## 22. Branch Isolation Audit

Direct announcements and notifications reuse `resolveTenantBranch`, whose ordered sources are current stay, active assignment, approved contract, approved reservation; multiple references fail closed with 409 (`backend/services/branchLocation.service.js:204-220`). Branch unit/integration tests pass. Profile uses the same resolver.

Failures: chatbot announcements bypass the resolver entirely (P0); dashboard uses an independent resolver (P2); announcement publish windows are omitted; mark-announcement-read does not repeat branch validation. Contract upstream branch enforcement is `NOT VERIFIED`.

## 23. Data Model & Single-Source-of-Truth Audit

The largest structural risks are dual collections (`bills`/`billing`, `maintenance_requests`/legacy), multiple assignment sources, mixed snake/camel status fields, three app-version sources, three notification representations, and static financial/policy content in code.

Billing uses heuristic cross-source reconciliation rather than a migration crosswalk. Maintenance promotes legacy records and deduplicates on `request_id`. Branch has a strong shared resolver but dashboard/chatbot keep alternative logic. Contract source is intentionally external. These should be consolidated through explicit identifiers and read models, not UI masking.

## 24. State Machine / Status Consistency Audit

| Domain | Current model | Finding |
|---|---|---|
| Account | active/inactive plus legacy flags | Active guard is comprehensive; role semantics are not |
| Bill | unpaid, overdue, pending_verification, partially_paid, paid, rejected, cancelled + aliases | Pending verification wrongly payable; some status inferred from evidence |
| PayMongo | gateway intent/session/payment states → app enum | Inactive+any payment incorrectly confirms |
| Maintenance | explicit transition maps | UI order differs; scheduled unreachable from admin map |
| Contract | upstream Draft/Prepared/Final and local published generated states | Bridge behavior present; upstream rules unverified |
| Survey | ACTIVE/CLOSED/response states | Hidden frontend; backend tests strong |
| Notification | stored notification + announcement + read receipts/state | Feed surfaces disagree |

Unknown states mostly fail to generic labels rather than crash, but financial unknowns must fail closed.

## 25. Error / Loading / Empty-State Audit

Core screens provide ActivityIndicators, retry/pull-to-refresh, empty copy, and normalized API messages. Document managers translate auth/not-found/network/type errors. Notification optimistic updates roll back.

**MOB-P2-11:** the top-level ErrorBoundary logs the full error/component stack and renders raw `error.message` to the tenant (`frontend/app/_layout.jsx:123-145`). Render a stable support code/message in production and send redacted diagnostics only to an approved telemetry service. Several `console.error` calls also expose raw error objects.

No global crash/error monitoring configuration was found. Offline behavior is inconsistent (MOB-P2-01).

## 26. Network / Retry / Duplicate-Submission Audit

Axios interceptors handle session expiry; screens commonly use explicit timeouts, in-flight guards, polling cleanup, and retry UI. Maintenance submission idempotency is strong. Notification fetch has an in-flight ref and 60-second refresh. Payment success polls status.

Failures: legacy checkout has no atomic duplicate guard; webhook processing suppresses retries; request-admin escalation can create duplicate live/ticket records across reset sessions; chatbot/live state is in process memory and is not horizontally shared. **MOB-P2-12:** multi-instance/restart reliability for live Assistant chat is therefore not deployment-proven (`backend/controllers/chatbot.controller.js` in-memory maps plus Mongo restoration paths).

## 27. File Upload & Storage Audit

Upload endpoints cap decoded bytes, generate tenant-scoped server paths, and issue tokenized Firebase URLs. AI assistant attachments correctly require exact URL/path correlation, allowed prefix, MIME/size, and downloaded content type/magic (`backend/services/assistantAttachment.service.js:20-60`). This is the reference design.

Document metadata fails that design at P0; user images then fail the PDF-only content branch at P1; maintenance metadata is partial; generic upload trusts declared MIME; cached tenant images persist on logout and backup rules are incomplete. Storage rules themselves and Firebase token revocation are `NOT VERIFIED`.

## 28. Date / Time / Currency Audit

**MOB-P2-13:** backend billing uses JavaScript `Number`, rounds to centavos at PayMongo creation, and compares/maps decimal amounts without Decimal128/integer-centavo invariants (`backend/controllers/billing.controller.js:213-220`; `backend/controllers/paymongo.controller.js:718-720`). Use integer centavos or Decimal128 across persisted totals, payments, and reconciliation; reject non-finite/negative values rather than displaying zero.

**MOB-P2-14:** UI frequently constructs `new Date()` from date-only/ISO inputs and formats in device locale; most billing display logic is not pinned to Asia/Manila. `YYYY-MM-DD` can shift one day across timezones. Define backend ISO instants versus local calendar dates and use one formatter. The concurrent utility test includes a payment timestamp preceding an October billing period, illustrating that source dates can be chronologically surprising even when technically accepted; production chronology requires data review.

## 29. Security Logging / Secret Exposure Audit

Tracked-file scanning found no committed private key, password, PayMongo secret, or Mongo credential. `.env` files are ignored; only presence was inspected and values are redacted. Firebase/Google client IDs/API keys in mobile configuration are public identifiers but must still be restricted by package/signing certificate and API policy; dashboard restrictions are `NOT VERIFIED`.

**MOB-P2-15:** login/Google flows log full email/name/user IDs (`backend/controllers/auth.controller.js:398-407,599-626`), and maintenance UI logs attachment name/MIME/host/status in release-capable code (`frontend/app/(tabs)/services.jsx:845-865`). Redact/disable production PII logs, add log-safety tests, and establish retention/access controls.

## 30. Performance Audit

Notification lists use FlatList and memoized filters; tests cover virtualization. Main concerns are three overlapping billing calls, separate notification/announcement snapshots, unpaginated maintenance/chat/document lists, repeated legacy/canonical collection scans, persistent image/PDF caches without quota/TTL, and a 44 MB local arm64 bundle. These are not P0/P1 by themselves.

**MOB-P2-16:** Android release minification/resource shrinking default false, only `arm64-v8a` is built, and unused `RECORD_AUDIO` is declared (`frontend/android/app/build.gradle:66-69,100-128`; manifest `:3`). Remove unused permissions, decide supported ABIs explicitly, and enable/test release optimization. No profiling on low-end devices was performed.

## 31. Automated Test Results

| Check | Exact result | Status |
|---|---|---|
| Backend `npm test` after latest changes | 344 tests, 344 pass, 0 fail, 0 skipped; 6.774 s | PASS |
| Frontend full Jest, run in-band | 35 suites: 34 pass, 1 fail; 206 tests: 205 pass, 1 fail; 0 snapshots; ~191 s | FAIL/flaky |
| Failing full-suite case | `notificationsFilterUi.test.js` could not find “Security urgent” while the screen remained loading | FAIL in aggregate |
| Same notification file isolated | 1 suite, 7/7 tests pass; 13.2 s | PASS isolated; nondeterministic |
| Latest changed billing/viewer targeted set | 5 suites, 24/24 tests pass; 3.912 s | PASS |
| Expo lint | 0 errors, 5 warnings | PARTIAL |
| Expo Doctor | 16/17 checks pass; direct `@types/react-native`; config-sync check explicitly disabled | PARTIAL |
| Expo Android production export | 2,100 modules, 58 assets; Hermes bundle 6.27 MB; 60 files / 14,921,895 bytes | PASS |
| Native Gradle `:app:bundleRelease` | BUILD SUCCESSFUL in 12m 6s; local AAB 44,143,914 bytes | COMPILE PASS only |
| Canonical health | HTTP 200 in 0.696 s | PASS availability; FAIL provenance |
| Backend production dependency audit | 15: 1 low, 9 moderate, 4 high, 1 critical | FAIL triage gate |
| Frontend production dependency audit | 18: 2 moderate, 15 high, 1 critical | FAIL triage gate |

Lint warnings include one hook callback dependency in Services, an unused billing import, and test-hook warnings. No `typecheck` script or TypeScript project check is configured. The AAB was generated only to validate native compilation, used local debug signing (`frontend/android/app/build.gradle:109-128`), was not installed/published, and was deleted immediately after inspection. No release APK was generated.

**MOB-P1-15:** production dependency trees include a critical `websocket-driver`, high `@grpc/grpc-js` crash advisories on backend, and directly vulnerable `axios`; backend also directly includes vulnerable `nodemailer`, `firebase-admin`, and `uuid`. Frontend advisories are heavily build-tool/transitive but direct `axios`, `expo`, and `react-native` are affected. Triage actual shipped/reachable paths, update within supported Expo/Firebase matrices, regenerate locks, and repeat builds/tests/audits. Do not equate npm severity with exploitability, but do not ship unreviewed critical/high findings.

## 32. Test Coverage Gaps

Missing or insufficient tests:

- Adversarial document metadata → cross-tenant read/delete and bucket/path mismatch.
- Chatbot private/branch/future/expired announcement isolation.
- Explicit tenant-role allowlist for owner, branch_admin, applicant, unknown roles.
- `security_version` revocation across shared web/mobile sessions.
- Android App Link interception/reset-token end-to-end.
- `pending_verification` checkout rejection across backend and all screens.
- Legacy checkout concurrency/idempotency and webhook retry/crash recovery.
- PayMongo failed/mixed payment inside an inactive session, currency mismatch, legacy idempotency, and underpayment-specific races.
- Two distinct same-signature bill IDs must remain distinct.
- Uploaded image content/storage authorization and logout/backup cache handling.
- Contract bridge against the actual upstream with wrong-tenant IDs.
- Production policy/contact content approval fixture.
- Physical Android device: Google sign-in release SHA, push/deep links, PayMongo return, PDF visual rendering, TalkBack, small screen, offline/resume.
- Deterministic full Jest execution; the isolated passing notification suite does not explain the aggregate failure.

## 33. Module Readiness Matrix

| Module | UI | API | Validation | Security | Data consistency | Tests | Deployment ready? |
|---|---|---|---|---|---|---|---|
| App bootstrap | PASS | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | FAIL |
| Authentication | PASS | PARTIAL | PASS | FAIL | PARTIAL | PASS | FAIL |
| Home | PASS | PASS | N/A | PASS | PARTIAL | PARTIAL | PARTIAL |
| Notifications | PASS | PARTIAL | PARTIAL | FAIL | FAIL | FLAKY | FAIL |
| Maintenance | PASS | PASS | PASS | PARTIAL | PARTIAL | PASS | PARTIAL |
| Billing | PASS | PARTIAL | PARTIAL | PASS | FAIL | PASS | FAIL |
| Payments | PASS | FAIL | PARTIAL | PARTIAL | FAIL | PARTIAL | FAIL |
| PDF/Documents | PARTIAL | FAIL | FAIL | FAIL | PARTIAL | PARTIAL | FAIL |
| Contracts | PASS | NOT TESTED | PARTIAL | NOT TESTED | NOT TESTED | PARTIAL | FAIL |
| Profile | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| Assistant/chat | PASS | PARTIAL | PARTIAL | FAIL | PARTIAL | PARTIAL | FAIL |
| Feedback/Survey visibility | PASS | PASS | PASS | PASS | PASS | PASS | PASS (hidden) |
| Navigation | PASS | N/A | N/A | PARTIAL | PASS | PARTIAL | PARTIAL |

## 34. API Readiness Matrix

| API | Auth | Ownership | Branch | Validation | Errors | Tests | Used by mobile | Status |
|---|---|---|---|---|---|---|---|---|
| Auth/session | PARTIAL | self | N/A | PASS | PASS | PASS | Yes | FAIL |
| Users/profile | PASS | PASS | PASS | PASS | PASS | PASS | Yes | PASS |
| Dashboard | PASS | PASS | PARTIAL | N/A | PASS | PARTIAL | Yes | PARTIAL |
| Notifications | PASS | PARTIAL | PARTIAL | PARTIAL | PASS | PASS | Yes | FAIL |
| Announcements | optional | PASS private | PASS direct | FAIL window | PASS | PASS | Yes | PARTIAL |
| Maintenance | PASS | PASS lookup | N/A | PASS | PASS | PASS | Yes | PARTIAL |
| Billing | PASS | PASS | N/A | PARTIAL | PASS | PASS | Yes | FAIL |
| PayMongo | mixed | PASS status | N/A | FAIL | FAIL retry | PARTIAL | Yes | FAIL |
| User documents | PASS | metadata only | N/A | FAIL | PASS | GAP | Yes | FAIL |
| Contracts bridge | PASS | upstream unknown | unknown | PARTIAL | PASS | mocked | Yes | FAIL |
| Chatbot | PASS | PASS chats | FAIL announcements | PARTIAL | PARTIAL | PARTIAL | Yes | FAIL |
| Static documents | PASS | N/A | N/A | allowlist | PASS | PDF only | Yes | FAIL content approval |
| Rooms | FAIL | FAIL/raw | FAIL | N/A | PASS | GAP | No | FAIL |
| Surveys | PASS | PASS | PASS | PASS | PASS | PASS | Hidden | PASS |

## 35. Validation Matrix

| Mutation | Frontend validation | Backend validation | Ownership | Duplicate protection | Result |
|---|---|---|---|---|---|
| Login | email/password | email/password, locks, Firebase, active | matched account | rate/lock | PARTIAL role |
| OTP verify/resend | 6 digits/token | hash, expiry, attempts | OTP user | prior OTP invalidated | PASS |
| Change password | current/new/confirm/strength | current Firebase password, strength, session invalidation | session user | rate limit | PASS |
| Profile update | username/phone | allowlist, format, uniqueness, 7-day cooldown | session user | unique username | PASS |
| Maintenance create | type/description/files | enums/length/files/size | session user | client key + unique index | PASS |
| Maintenance attachment | picker/type/size | provider/host/type/size | request owner | none for object path | PARTIAL |
| Mark notification read | ID | stored owner; announcement visibility partial | partial | upsert read key | PARTIAL |
| Mark all read | none | session user only | PASS | idempotent state | PASS |
| Upload user document | image/size | host/type/size only | metadata owner | UUID doc ID | FAIL storage auth |
| Payment proof | image/size/status UI | provider/type/size/owner | PASS | last write/race limited | PARTIAL |
| Checkout creation | bill ID | owner/status/amount | PASS | canonical only | FAIL |
| Payment confirmation | gateway result | signature/metadata/state/amount partial | bill metadata/lookup | atomic paid update | FAIL |
| Survey draft/submit | schema UI | service schema/eligibility | PASS | unique response | PASS (hidden) |

## 36. Security Matrix

| Resource | Authentication | Ownership | Branch isolation | IDOR test | Result |
|---|---|---|---|---|---|
| Profile | bearer | session user | shared resolver | tests present | PASS |
| Notifications | bearer | stored owner; announcement partial | direct feed pass | partial | PARTIAL |
| Maintenance | bearer | owner lookup | tenant record | tests present | PARTIAL mutation/path |
| Bills | bearer | owner-scoped lookup | N/A | policy tests | PASS ownership |
| Payments | bearer/status; signed webhook | bill metadata/lookup | N/A | partial | PARTIAL/FAIL integrity |
| Contracts | bearer forwarded | upstream | upstream | mocked only | NOT VERIFIED |
| User documents | bearer | metadata owner only | N/A | missing | FAIL (P0) |
| Statements | bearer | bill owner | N/A | billing tests | PASS ownership |
| Receipts | no dedicated resource | N/A | N/A | none | NOT APPLICABLE/MISSING |
| Chatbot announcements | bearer | none on announcement query | none | missing | FAIL (P0) |
| Rooms | none | none | none | missing | FAIL |

AI/privacy: **MOB-P1-16** sends tenant display name, role, branch, room/bed, contract dates/type/rent/deposit, bills, maintenance and support summaries, history, and attachments to Google Gemini (`backend/controllers/chatbot.controller.js:1155-1217,1369-1396`; `backend/services/gemini.service.js:81-102`). The in-app policy, last updated January 2024, says data is accessed only by authorized personnel and does not disclose Gemini, categories, purpose, transfer, retention, or consent (`frontend/app/privacy-policy.jsx:22-46`). Obtain DPO/legal review, minimize context per intent, document provider/retention/transfer, and implement consent/disable controls before release.

## 37. Data Consistency Matrix

| Domain | Sources of truth found | Conflict? | Authoritative source | Recommendation |
|---|---|---|---|---|
| Tenant active status | users flags/status | aliases | normalized users record | keep one normalized predicate/schema |
| Tenant role | users role; client helper | Yes | explicit backend tenant allowlist | define/export canonical enum |
| Branch | stays, assignments, reservations, branches, static records, dashboard fallback | Yes | `resolveTenantBranch` + approved branches | make every module consume it |
| Room/bed | occupancy, bed history, reservation, room | Yes | current stay/assignment | shared current-stay service |
| Bill | `bills` + legacy `billing` | Yes | canonical `bills` with crosswalk | migrate; remove signature merges |
| Payment | PayMongo session/payment + bill fields/proof | Yes | verified payment resource linked to bill | event ledger + amount/currency invariants |
| Utility | utility periods + bill charges + legacy final values | Yes/partial | utilityperiods for structured current data | backfill only from evidence |
| Contract | authoritative upstream + local generated metadata/reservation | Yes | upstream published contract | bridge version/ownership contract |
| Notification unread | notifications, announcements, read receipts/state | Yes | one merged feed/read model | use same feed on all surfaces |
| Maintenance | primary + legacy collection | Yes | primary with immutable crosswalk | finish migration/unique owner key |
| App version | package, Expo config, native Gradle | Yes | one release manifest source | generate/sync all values |
| Policy/contact info | controller/preset code | Yes/unapproved | approved configuration/content CMS | remove operational data from code |

## 38. Known Reported Issues Verification

| Reported item | Current finding | Evidence/status |
|---|---|---|
| Paid bill also says utility not released | **FIXED IN CURRENT UNCOMMITTED SOURCE for canonical real bills; NOT DEPLOYED/legacy residual** | Real mapper now uses billingCycleStart/dueDate and shared UI schedule; 4 backend + frontend regression tests pass. Legacy bills without deadlines remain representable as paid+unreleased. |
| “Payment Receipt” opens statement / black blocks | **MISLABEL FIXED IN CURRENT UNCOMMITTED SOURCE; BLACK BLOCKS NOT CONCLUSIVELY VERIFIED** | Buttons now say Billing Statement; backend emits paid statement. Viewer background changed light. PDF pagination bytes pass; production visual/device QA remains. |
| Final utility amount but “Breakdown unavailable” | **CONFIRMED DATA-MODEL LIMITATION for legacy; current canonical path supports structures when utilityperiods exist** | Enrichment in billing controller; no fabrication when historical components absent. |
| Too many category/urgent chips | **FIXED in current HEAD** | Compact toolbar + modal separates category/priority. Isolated 7/7 UI tests pass; full-suite run remains flaky. |

## 39. Master Issue Register

| ID | Severity | Module | Problem/root cause | File/API | User impact | Security/data risk | Recommended fix | Deployment layer |
|---|---|---|---|---|---|---|---|---|
| MOB-P0-01 | P0 | Documents | Arbitrary storagePath accepted then privileged read/delete | user.controller; user document APIs | Other files can be read/deleted | Cross-tenant disclosure/destruction | Server-issued scoped path receipt + quarantine/migrate | CANONICAL BACKEND + DATABASE/DATA |
| MOB-P0-02 | P0 | Assistant/News | Chatbot queries all active announcements | chatbot.controller `/chatbot/message` | Wrong private/branch content | Cross-tenant disclosure to tenant/Gemini | Reuse canonical visibility/window query | CANONICAL BACKEND |
| MOB-P1-01 | P1 | Auth | Tenant role is “not admin” | auth controller/middleware | Wrong roles enter app | Authorization boundary failure | Explicit tenant-role allowlist | CANONICAL BACKEND + MOBILE FRONTEND |
| MOB-P1-02 | P1 | Session | security_version written but not enforced | auth middleware | Revoked session may persist | Account/session risk | Compare every request; revoke atomically | CANONICAL BACKEND |
| MOB-P1-03 | P1 | Reset | Token in unverified generic scheme | reset controller/app config | Reset link can open wrong app | Account takeover | Verified HTTPS link and domain association | CONFIGURATION + BOTH CODE LAYERS |
| MOB-P1-04 | P1 | Notifications | News omits personal feed but marks all read | announcements screen/context | Personal alerts disappear | Missed financial/safety updates | One merged feed for all surfaces | MOBILE FRONTEND |
| MOB-P1-05 | P1 | Announcements | No publish/expiry filter | announcement/notification controllers | Premature/stale notices | Embargo/privacy risk | Server time-window predicate/tests | CANONICAL BACKEND |
| MOB-P1-06 | P1 | Billing | Heuristic signature collapses/merges bill IDs | billing.controller | Missing/blended bill | Financial record corruption in view | Explicit crosswalk/migration | CANONICAL BACKEND + DATABASE/DATA |
| MOB-P1-07 | P1 | Payments | Pending verification remains payable | billing policy/front util | Duplicate payment | Financial loss/reconciliation | Canonical non-payable enum | BOTH CODE LAYERS |
| MOB-P1-08 | P1 | Payments | Legacy checkout lacks atomic idempotency | paymongo.controller | Multiple live checkouts | Duplicate charge risk | Idempotency for both collections | CANONICAL BACKEND |
| MOB-P1-09 | P1 | Payments | Inactive session + any payment confirms | paymongo.controller | Failed/pending could settle bill | Wrong paid state | Require succeeded paid resource + invariants | CANONICAL BACKEND |
| MOB-P1-10 | P1 | Webhook | Errors acknowledged 200 | paymongo.controller | Paid bill may stay unpaid | Lost financial event | Durable idempotent event processing/retry | CANONICAL BACKEND + DATABASE/DATA |
| MOB-P1-11 | P1 | Documents | storagePath images forced through PDF check | user.controller content API | Uploaded image cannot open | Availability/data trust | MIME-aware magic validation | CANONICAL BACKEND |
| MOB-P1-12 | P1 | Contracts | Required upstream not startup-required/local missing | contract bridge/server env | Contract core flow 502 | Misconfiguration | Required feature env + smoke test | CONFIGURATION + CANONICAL BACKEND |
| MOB-P1-13 | P1 | Policy/Safety | Hardcoded placeholder-looking payment/emergency content | documents/presets | Wrong payment or emergency action | Financial/safety harm | Approved dynamic content/config | CANONICAL BACKEND + DOCUMENTATION |
| MOB-P1-14 | P1 | Rooms | Public raw Mongo documents | room routes/controller | Internal room data public | Possible PII/ops exposure | Auth or strict public DTO | CANONICAL BACKEND |
| MOB-P1-15 | P1 | Dependencies | Critical/high production advisories untriaged | package locks | Crash/exploit exposure | Availability/security | Supported upgrades + reachability review | BOTH CODE LAYERS + TESTS |
| MOB-P1-16 | P1 | Privacy/AI | Extensive tenant context sent to Gemini without adequate notice/control | chatbot/Gemini/privacy policy | Unexpected data processing | Privacy/legal exposure | Minimize, disclose, consent, retention controls | BOTH CODE LAYERS + DOCUMENTATION |
| MOB-P1-17 | P1 | Backend release | Startup runs mutations/index repair; feature vars omitted; failures may warn/start | server.js | Deploy can mutate/fail partially | Data/index inconsistency | Versioned predeploy migrations + readiness | CANONICAL BACKEND + CONFIGURATION |
| MOB-P1-18 | P1 | Deployment | Live canonical health differs from source; no version | health/server/deployment | Unknown code will receive changes | Rollback/provenance risk | Commit/version endpoint and Render mapping | CONFIGURATION |
| MOB-P1-19 | P1 | Android release | Version drift, dev client in release, local debug signing | app config/Gradle/package/EAS | Wrong upgrade/build artifact | Release integrity | One version, remove dev plugin prod, EAS signed smoke | CONFIGURATION + MOBILE FRONTEND |
| MOB-P2-01 | P2 | Session UX | Offline hydration/checkAuth conflict | AuthContext | Surprise offline login/logout | Stale local state | One offline expiry policy | MOBILE FRONTEND |
| MOB-P2-02 | P2 | Device privacy | Backup/cache exclusions incomplete | manifest/cache managers | Tenant data persists/transfers | Local data exposure | Exclude/encrypt/clear caches | MOBILE FRONTEND |
| MOB-P2-03 | P2 | Dashboard | Independent assignment/branch resolver | dashboard controller | Inconsistent Home/Profile | Wrong branch context | Shared resolver/read model | CANONICAL BACKEND |
| MOB-P2-04 | P2 | Notifications | Announcement read lacks branch recheck | notification controller | Unauthorized read receipt | Low metadata integrity | Shared visibility predicate | CANONICAL BACKEND |
| MOB-P2-05 | P2 | Deep links | Arbitrary internal notification URL | notifications service | Unexpected navigation | Attack-surface expansion | Typed route allowlist | MOBILE FRONTEND |
| MOB-P2-06 | P2 | Maintenance | UI/backend state order drift | services/controller | Wrong progress timeline | State integrity confusion | Shared state machine | BOTH CODE LAYERS |
| MOB-P2-07 | P2 | Maintenance files | URL/path/prefix not correlated | maintenance controller | Wrong attachment reference | Cross-tenant reference risk | Strict scoped attachment validator | CANONICAL BACKEND |
| MOB-P2-08 | P2 | Upload | MIME trust/orphan files/unpaginated | upload route | Bad files/storage growth | Content/storage risk | Magic bytes, cleanup, pagination | CANONICAL BACKEND |
| MOB-P2-09 | P2 | Maintenance | Mutations omit owner after lookup | maintenance controller | Collision updates wrong row | Integrity risk | Owner in mutation + unique key | CANONICAL BACKEND |
| MOB-P2-10 | P2 | Receipts | No distinct in-app payment receipt | billing PDF | No official mobile receipt | Auditability gap | Owner-scoped receipt model/API | BOTH CODE LAYERS |
| MOB-P2-11 | P2 | Errors | Raw error message/stack logs | app layout | Technical text shown | Information leakage | Stable error IDs/redacted telemetry | MOBILE FRONTEND |
| MOB-P2-12 | P2 | Assistant | Live state process-local | chatbot controller | Restart/multi-instance inconsistency | Lost conversation state | Durable queue/session store | CANONICAL BACKEND |
| MOB-P2-13 | P2 | Currency | Plain Number finance | billing/payment code | Rounding edge cases | Financial precision | Integer centavos/Decimal128 | CANONICAL BACKEND + DATABASE/DATA |
| MOB-P2-14 | P2 | Dates | Device timezone/date-only parsing | billing UI/controllers | Off-by-one dates | Chronology inconsistency | Typed dates + Asia/Manila formatter | BOTH CODE LAYERS |
| MOB-P2-15 | P2 | Logging | PII/attachment metadata in logs | auth/services | Privacy exposure | Log retention risk | Redaction and production logger | BOTH CODE LAYERS |
| MOB-P2-16 | P2 | Native/performance | No minify, arm64-only, unused microphone permission | Gradle/manifest | Size/device compatibility/trust | Excess permission/surface | Optimize, ABI decision, remove permission | MOBILE FRONTEND + CONFIGURATION |
| MOB-P3-01 | P3 | Navigation | Deprecated/orphan aliases/screens remain | app routes | Maintenance burden | None immediate | Remove only after link telemetry/compat window | MOBILE FRONTEND |

## 40. P0 Critical Issues

### MOB-P0-01 — Cross-tenant Firebase object read/delete

- Current/expected: client-selected `storagePath` is trusted; it must be server-issued and bound to the authenticated tenant, bucket, URL, and MIME.
- Root cause/files/API: `normalizeUploadedDocumentMetadata()` lacks authorization invariants; `getDocumentContent()`/`deleteDocument()` use Admin Storage on that path. `POST/GET/DELETE /api/m/users/documents...`.
- Backend change: issue a signed one-time upload receipt or store server-generated path at upload; validate decoded Firebase URL bucket/object equals path and path begins the exact tenant prefix. Refuse unsafe metadata.
- Frontend change: submit only server upload receipt/path; surface migration error.
- Database change: scan metadata for mismatched bucket/prefix/URL without fetching content; quarantine and owner-review suspicious rows before enabling delete/read.
- Tests: attacker path with own URL; other tenant path; other bucket; encoded traversal; read/delete; legacy safe migration; concurrent delete.
- Deployment: canonical backend `https://api.lilycrest.space` and data remediation required; new APK only if request contract changes. High regression risk around legacy documents.

### MOB-P0-02 — Cross-branch/private announcements in Gemini context

- Current/expected: chatbot takes newest active announcements globally; it must use the same authenticated owner/visibility/branch/publish/expiry predicate as News.
- Root cause/files/API: `backend/controllers/chatbot.controller.js:1133-1137,1214-1217`, `POST /api/m/chatbot/message`.
- Backend change: extract one tested announcement visibility repository function and call it from announcements, notifications, and chatbot. Minimize content sent to Gemini and omit announcements unless intent needs them.
- Frontend/database: no schema change required unless visibility fields need normalization; show only source-approved items.
- Tests: global, each branch, private owner/non-owner, future, expired, archived, missing branch/conflict, and prompt spy proving excluded content never reaches model.
- Deployment: canonical backend required; no rollback-host deployment; APK rebuild not required for backend-only correction. High privacy regression risk.

## 41. P1 Deployment Blockers

Implementation-ready specifications:

| ID | Current → expected / root cause | Required implementation and tests | Deploy/rebuild/risk |
|---|---|---|---|
| MOB-P1-01 | Any active non-admin role passes → only canonical tenants pass; denylist role checks | Add shared `TENANT_ROLES` allowlist to login/Google/middleware/client; tests for resident/tenant and owner/admin/branch_admin/applicant/unknown | Backend + APK; medium auth regression |
| MOB-P1-02 | security version stored only → compared on every auth | Project user security version in middleware; constant typed comparison; delete/reject mismatch; shared-system revocation tests | Backend; high shared-session risk |
| MOB-P1-03 | generic custom scheme token → verified domain link | Configure HTTPS App Link/domain association, one-time short TTL token, avoid token logging/referrers; Android competing-app and expiry/reuse tests | Backend/config/APK; high recovery-flow risk |
| MOB-P1-04 | News announcements only/marks all → one shared feed | Render `AuthContext.notifications` or canonical `/notifications`; mark only on explicit view policy; personal/announcement merge/read/refresh tests | APK, possibly backend; medium UX risk |
| MOB-P1-05 | active only → active + published + unexpired | Shared Mongo predicate for snake/camel dates with server clock; boundary/timezone tests | Backend; medium content visibility risk |
| MOB-P1-06 | signature merge → explicit identity/crosswalk | Inventory duplicates read-only; add `canonicalBillId`/legacy link; never merge different IDs; migration dry run/approval; same-value distinct-bill tests | Backend+data; very high financial regression |
| MOB-P1-07 | pending proof payable → non-payable everywhere | Add normalized status to backend/frontend policy; return 409 typed error; screen tests and checkout API tests | Backend+APK; medium status risk |
| MOB-P1-08 | legacy no checkout claim → all sources idempotent | Persist idempotency key/claim with owner+bill unique index; reuse active session; two-request concurrency tests | Backend+DB index; high payment risk |
| MOB-P1-09 | inactive+any payment paid → explicit successful payment only | Require succeeded/paid resource, PHP currency, expected amount, checkout/bill/user metadata; failed/pending/empty/mixed tests | Backend; very high payment risk |
| MOB-P1-10 | processing error 200 → durable/retriable | Store webhook event ID/payload hash/status idempotently, commit reconciliation then 2xx; 5xx on transient precommit failure; duplicate/out-of-order tests | Backend+DB; very high payment risk |
| MOB-P1-11 | storagePath always PDF → safe MIME-aware binary | Persist trusted MIME from server upload, validate magic bytes and size, send correct image/PDF type; image/PDF/spoof/cross-owner tests | Backend; medium documents risk |
| MOB-P1-12 | contract env optional → feature startup/readiness gate | Add `CONTRACT_UPSTREAM_URL` validation, reject self/canonical recursion, health check upstream auth contract in staging; verify Render secret | Backend/config; APK only if API changes; high contract risk |
| MOB-P1-13 | operational content in code → approved source | Move payment/emergency/rules to versioned approved config/CMS, admin sign-off, effective dates, no placeholder fallback; snapshot/content approval tests | Backend+docs/config; high safety risk |
| MOB-P1-14 | public raw rooms → protected/public DTO | Confirm schema, require tenant/admin auth unless deliberately public, explicit allowed fields, cache policy; unauth and no-sensitive-field tests | Backend; medium unknown-client risk |
| MOB-P1-15 | advisories unreviewed → supported patched tree | Reachability triage, upgrade axios/nodemailer/firebase/Expo/RN compatible versions, lockfile review, full test/export/native build/audit | Backend+APK; high dependency regression |
| MOB-P1-16 | broad Gemini context/no notice → minimized, transparent processing | Intent-scoped context, provider contract/retention review, updated privacy/consent/disable/delete controls, no private announcement context; prompt-redaction tests | Both+docs/APK; high legal/assistant risk |
| MOB-P1-17 | deploy startup mutates data and tolerates index failure → controlled migrations/readiness | Move updates/indexes/webhook registration to idempotent versioned predeploy jobs with dry-run/metrics/rollback; fail readiness on required index/config | Backend+DB/config; very high deploy risk |
| MOB-P1-18 | live/source mismatch → traceable artifact | Add non-secret commit/build version to health, map canonical Render service/repo/branch, pin deployment commit, compare staging response; document rollback | Config/backend; high operational risk |
| MOB-P1-19 | versions 1.0.0/1.1.1/1.1.8 and codes 3/10; dev client in release → one signed production manifest | Define release version source, enable Expo config sync check, conditionally include dev client only development, verify release manifest lacks launcher/dev menu, configure EAS credentials and supported ABIs; install/upgrade/smoke tests | Config+APK; high release/install risk |

## 42. P2 Required Polish / Reliability

Address MOB-P2-01 through MOB-P2-16 after P0/P1 correctness. Highest priorities are device backup/cache privacy, maintenance file scoping, money/date types, production log redaction, deterministic test execution, and release permission/optimization cleanup. Also set production `ALLOW_MOBILE_DEV_CORS=false`; its default currently allows local/private origins even in production (`backend/server.js:59-71`). Add graceful SIGTERM/SIGINT shutdown and readiness behavior; `backend/server.js:428-435` starts listening without retaining/closing the server.

The full Jest flake and Expo Doctor failure belong here as engineering quality issues, but the required test gate remains failed until resolved/repeated.

## 43. P3 Future Enhancements

MOB-P3-01: after telemetry confirms no old deep links/clients depend on them, remove or document `/home`, `/(tabs)/dashboard`, `/auth-callback`, legacy `/payment`, and weakly discoverable policy routes. Keep compatibility redirects during a defined deprecation window.

## 44. Recommended Fix Order

1. **Phase 1 — P0 isolation:** lock document paths, quarantine unsafe metadata, and centralize announcement visibility for chatbot/News/notifications.
2. **Phase 2 — P1 financial correctness:** pending-verification policy, checkout idempotency, exact PayMongo success/amount/currency association, durable webhook events, and bill crosswalk dedupe.
3. **Phase 3 — P1 auth/privacy:** role allowlist, security-version enforcement, verified reset links, Gemini minimization/disclosure.
4. **Phase 4 — P1 core/config:** image documents, contract upstream validation, approved policy contacts, protected room DTO.
5. **Phase 5 — release engineering:** freeze/commit source, version endpoint, controlled migrations, dependency upgrades, one Android version, no production dev client, signing/ABI policy.
6. **Phase 6 — P2 reliability:** notifications feed, maintenance state/files, backup/cache/log/date/money/error/performance hardening.
7. **Phase 7 — regression verification:** full deterministic frontend/backend suites, IDOR/concurrency tests, staging contract/PayMongo/Firebase/Google/push/deep-link tests, visual PDF and device matrix.
8. **Phase 8 — deployment-test APK:** deploy only the corrected canonical backend, verify health/version and migrations, then build/sign/install the new APK. Do not routinely deploy the rollback host.

## 45. Deployment Gate Checklist

| Gate | Evidence | Result |
|---|---|---|
| A — Security: zero P0 | Two open P0 isolation defects | **FAIL** |
| B — Authentication | Core code/tests good; role/revocation/reset link open | **FAIL** |
| C — Tenant isolation | Document and chatbot cross-tenant paths | **FAIL** |
| D — Billing integrity | Dedupe, pending status, PayMongo state/webhook/idempotency | **FAIL** |
| E — Maintenance | Create/view/ownership tests pass; state/file/mutation gaps | **PARTIAL** |
| F — Notifications | Read state tests pass; News feed/window/scoping defects | **FAIL** |
| G — Contracts/Documents | P0 path, image 422, upstream env unknown | **FAIL** |
| H — Core UI | Export/native compile pass; physical device/PDF/auth flows untested | **PARTIAL** |
| I — API host | EAS/runtime canonical; live health 200; deployment provenance mismatch | **PARTIAL** |
| J — Tests | Backend passes; full frontend has one nondeterministic failure; security gaps | **FAIL** |

## 46. Render / API Deployment Decision

Do **not** deploy during this audit and do not deploy the current snapshot afterward without fixes. Backend changes will eventually be required only on the canonical service serving `https://api.lilycrest.space`. Before any deploy, identify its Render service/repository/branch and add build-version evidence because the live health response is not produced by this source.

Planned canonical deployment work after remediation: P0/P1 controller/middleware/routes, controlled migration/index jobs, environment validation, dependency upgrades, and approved content. Data remediation is required for document metadata and likely bill crosswalks; it must begin with dry-run reports and owner approval. The rollback-only `https://mobile-api.lilycrest.space` must not receive routine fixes or synchronization deployments.

## 47. APK Build Readiness

Compilation readiness is **PARTIAL**, deployment readiness is **FAIL**.

Positive evidence: Expo production export passed; Hermes bundle produced; native `bundleRelease` compiled successfully on arm64; package ID is consistently `com.lilycrest.lilycrestdorm`; network security rejects cleartext in main release config.

Blocking evidence: P0/P1 application issues, full Jest failure, dependency advisories, `@types/react-native` Doctor failure, config-sync check disabled, version/package drift (`package.json` 1.0.0, Expo 1.1.1/code 3, native 1.1.8/code 10), production inclusion of `expo-dev-client`/dev launcher/dev menu proven by Gradle release compilation, local release debug signing, arm64-only build, unused microphone permission, incomplete backup rules, and no release-device sign-in/push/deep-link/payment/PDF testing.

The audit-created AAB was deleted; no APK was generated, installed, submitted, or published. After canonical-backend fixes are deployed and verified, a **new** signed APK is required for frontend/config changes; backend-only corrections do not by themselves require an APK.

## 48. Final Verdict

**NOT READY — P0 CRITICAL ISSUE**

Frontend changes currently required: role/UI policy sync, notification feed, pending-payment status, verified deep links, privacy disclosure/controls, document behavior, native release configuration, dependency upgrades, cache/log/date/error hardening.  
Canonical backend changes currently required: document authorization, announcement scoping/windows, auth revocation/roles, billing identity, PayMongo idempotency/state/webhooks, document MIME serving, contract/config checks, room DTO, approved content, controlled startup migrations, AI minimization, dependency upgrades.  
Database remediation currently required: read-only inventories followed by approved quarantine/migration of unsafe document paths, explicit bill crosswalk/deduplication, webhook event ledger/indexes, and maintenance uniqueness where needed.  
Environment/configuration changes required: verified reset-link domain, canonical Render source mapping/version, contract upstream, production CORS, approved Google/Firebase signing restrictions, EAS signing/version/dev-client separation, PayMongo dashboard/webhook verification.  
Render deployment required later: **Yes — canonical service serving `https://api.lilycrest.space` only, after fixes and dry-run migration approval.**  
New APK required later: **Yes** for mobile/config fixes; not during this audit.  
Manual verification required: Render, contract upstream, Firebase/Google credentials and storage rules, PayMongo dashboard/webhook, approved financial/emergency content, DPO/privacy, signed physical-device matrix, and visual PDF/receipt behavior.
