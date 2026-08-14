# LILIORA Dormitory Management System — Actual-Code Audit

**Client:** Lilycrest Residences  
**Audit date:** 2026-07-19  
**Evidence reviewed:** all 230 source/config/script files under `frontend/` and `backend/` excluding dependencies/build products; seven PNGs in `docs/mobile-screenshots/`; package manifests and existing tests. Documentation was used only to identify intended scope, never to confirm implementation.

## Evidence limits

This repository is **not the entire capstone system**. It contains an Expo/React Native tenant app and a Node/Express mobile/shared API. It references collections created by a separate web/admin system, but does not contain that system's pages, reservation/contract controllers, database models, MongoDB dump, validators, rules, or complete indexes. Accordingly:

- Tenant/mobile behavior can be audited directly.
- Admin/super-admin API capabilities present here can be audited directly, but their UI cannot.
- Reservation, contract, room/bed administration, billing generation, occupancy calculation, and approval workflows cannot be completely audited from this repository.
- MongoDB is the operational database (`backend/config/database.js`); Firebase is used for identity, push, and Storage. There are no Firestore CRUD calls.

Artifacts needed for a complete whole-system audit: the web public/admin/super-admin source; all Mongoose schemas/models; reservation, contract, tenant, room/bed, utility, and billing-generation controllers/jobs; MongoDB schema export/sample dump with secrets removed; deployed index list; Firebase Auth/Storage rules; PayMongo and Firebase console configuration exports; environment values redacted to presence only; capstone requirements/specification and acceptance criteria; admin/public screenshots; API collection/OpenAPI file; production scheduler/cron configuration.

# A. System Overview

The confirmed architecture is:

- Mobile frontend: Expo SDK 54, Expo Router, React Native 0.81.5 (`frontend/package.json`; routes in `frontend/app/_layout.jsx:14-115`).
- API: Express, MongoDB native driver, Firebase Admin, PayMongo, Nodemailer, Gemini (`backend/package.json`; `backend/server.js`). The same router is mounted at `/api` and `/api/m` (`backend/server.js:156-158`).
- Authentication: Firebase verifies password/Google identity, then the API issues a random seven-day MongoDB session token (`backend/controllers/auth.controller.js:61-74`). Mobile stores it in AsyncStorage (`frontend/src/context/AuthContext.js:33-41`).
- Visible bottom tabs: Services, News, Home, Billings, Profile (`frontend/app/(tabs)/_layout.jsx:150-237`), confirmed by the supplied screenshots.
- The app is tenant-oriented. There is no role-adaptive admin navigation in `frontend/app/`.

Confirmed modules: onboarding, login/OTP/Google/biometric login, forgot/reset/change password, dashboard/home and search, room/assignment summary, billing/history/detail/PDF/PayMongo, maintenance lifecycle, announcements/notification inbox, AI assistant plus human support chat, documents, profile, settings, policies, FAQ API, support-ticket API, push registration, and logout.

# B. User Roles and Permissions

| Role | Confirmed accessible behavior | Evidence and limitation |
|---|---|---|
| Public/unauthenticated | Onboarding, login, forgot/reset password, privacy, terms, house rules, About, health endpoint, rooms GET, FAQs GET, announcements GET (private announcements filtered), PayMongo redirects/webhook | Route guard list: `frontend/app/_layout.jsx:14-36`; public API routes: `backend/routes/*.routes.js`. Public room inventory may expose occupancy/price details (`backend/routes/room.routes.js:5-6`). |
| Tenant | All mobile tabs; own profile/documents/dashboard/bills; own maintenance; tickets; chatbot/support chat; PayMongo; notifications; logout | Ownership filters appear in billing, maintenance, ticket, chat, document, and payment controllers. Login requires a non-admin user record, active status, and linked/derivable Firebase UID (`backend/controllers/auth.controller.js:209-444`). |
| Admin | All `adminMiddleware` APIs: create/update bills, create announcements, list users, manage maintenance/tickets/chatbot live chats/support chats; development seed | `backend/middleware/auth.js:49-55` accepts `admin` and `superadmin`. No admin mobile UI is present. |
| Super Admin | Exactly the same permissions as Admin in this repository | No super-admin-only middleware or endpoint exists. This is a confirmed authorization gap if scope expects privilege separation. |
| Owner | Only development seed middleware recognizes `owner` (`backend/routes/index.js:66-80`); normal `adminMiddleware` rejects it | Inconsistent role taxonomy. |

Authentication does not re-check `status`/disabled state in middleware after a session is issued (`backend/middleware/auth.js:18-42`); deactivated users retain access until logout/session expiry unless sessions are separately deleted.

# C. Module-by-Module Functionalities

| Page/module | Current behavior | Validation/problem | Recommended fix |
|---|---|---|---|
| Onboarding (`frontend/app/index.jsx`) | Slide carousel; skips to authenticated home; login CTA | Camera permission is requested during onboarding although onboarding does not capture an image (`:74-81`) | Remove unrelated permission prompt; ask just-in-time. |
| Login (`frontend/app/login.jsx`) | Email/password, Google, remember email, biometric credential replay, OTP navigation, debug-health link in dev | Email max 254/regex; password 6–128/no whitespace. Biometric stores/replays a password, increasing exposure | Prefer platform passkey/refresh-token design; never retain account password. |
| OTP (`frontend/app/otp-verify.jsx`) | Six-digit verification, resend after 60 seconds, optional biometric enrollment | UI uses one input per digit but each has `maxLength={6}` (`:279-286`), allowing awkward paste/focus behavior | Use a single hidden 6-digit input or per-box max 1; server-side resend throttling per token. |
| Password recovery/change | Forgot email, email reset link, in-app reset, current-password change, app/email alerts | Strong password UI/backend; reset token 15 min; reset token stored in plaintext MongoDB | Store reset-token hashes and add atomic single-use consumption. |
| Home/dashboard (`frontend/app/(tabs)/home.jsx`) | Assignment/room, outstanding bill, billing insights, quick maintenance status, app-wide local search, maps link | Search is local hard-coded navigation/data, not backend search; room assignment is reconstructed from three collections | Return one canonical assignment contract; label search as navigation search. |
| Billing (`billing-history.jsx`, `bill-details.jsx`, `payment.jsx`) | All/pending/overdue/paid filters, outstanding total, breakdown, trends, PDF, PayMongo checkout, polling/redirect | Two collections and presentation fallbacks are merged/deduped; authoritative status can be inferred from payment evidence. No generation rules here | Migrate to one canonical bills schema; database unique idempotency key; remove sample/presentation fallback in production. |
| Maintenance (`(tabs)/services.jsx`) | List/filter/search, submit with up to four attachments, details/progress, reply, edit/cancel pending, confirm resolved, reopen | Frontend requires description ≥10; backend only requires non-empty on create and allows empty description on edit. Category accepts any non-empty backend string | Mirror whitelist/min/max server-side; enforce transition table atomically. |
| News/notifications (`(tabs)/announcements.jsx`, `AppHeader.js`) | Combined announcements/notifications, sorting/category filters, local “mark all read” timestamp | No server read-state endpoint; mark-read is device-local. Public GET may expose broadly targeted items | Persist per-user read state; explicitly define public announcement policy. |
| Profile (`(tabs)/profile.jsx`) | View/edit username/email/phone/address/picture; name shown but backend rejects name edits; shortcuts/logout | Frontend name validator and edit control conflict with backend message that name is admin-managed | Make name read-only or add approved change workflow. Updating email does not synchronize Firebase Auth email. |
| Documents (`my-documents.jsx`, `documents.jsx`) | Policy previews/download; reservation documents; upload/delete tenant documents | Uploaded file is placed in Storage before metadata API; failures/orphan deletion leave blobs. Reservation docs are displayed as `verified` without review lookup | Use signed upload completion/finalization and Storage cleanup; represent real verification status. |
| Settings | Theme, push toggle, biometric toggle, change password, policies | Disabling notifications calls save-token logic but server behavior must remove all device tokens consistently; settings are partly local per device | Add per-device preference records and an authenticated delete-token endpoint. |
| Lily Assistant | FAQ/preset/Gemini answers using own billing/maintenance/profile context; escalation and human support chat | Two independent support systems exist: chatbot live requests and `chat_conversations`; attachments selected in UI are not included by `sendSupportMessage`, whose API accepts only text | Consolidate support domain; upload and send attachment metadata or remove attachment UI. |
| Tickets | Tenant/admin CRUD/status API exists | No ticket page calls these methods in current UI; dead/unreachable feature | Either add UI/navigation or remove/version the unused API. |
| Rooms | Public list/detail API | No room-browser/reservation page in mobile UI; unrestricted exposure | Decide public projection; omit sensitive occupancy/bed metadata. |
| Static backend admin (`backend/public/admin/index.html`) | Static placeholder served by backend | Not an operational admin application | Do not count as admin module. |

# D. Complete User Flows

## Email tenant flow

1. Launch onboarding. Authenticated cached/session users are redirected to `/(tabs)/home`; protected paths redirect unauthenticated users to `/login` (`frontend/app/index.jsx:111-128`, `_layout.jsx:55-72`).
2. Enter email/password. Client normalizes email and validates both (`login.jsx:37-44,134-149`).
3. API validates, rate-limits, verifies Firebase password, maps the email to a non-admin MongoDB user, checks active status and Firebase UID, and records attempts (`auth.controller.js:209-444`). After three failures, account password login is locked for 15 minutes (`:35-36,129-159`).
4. A six-digit OTP, expiring in 10 minutes, is emailed and stored in `otp_store`; no app session exists yet (`:400-438`).
5. User enters OTP; server allows at most five incorrect attempts, deletes the OTP on success/expiry/exhaustion, and creates a seven-day session (`:446-498`).
6. App persists session/user; optional remember-email and biometric credential setup; navigates home (`otp-verify.jsx:134-210`).
7. Authenticated navigation: Home ↔ Services ↔ News ↔ Billing ↔ Profile; profile links documents/settings/support/about.
8. Logout posts `/auth/logout`, clears local session and credentials according to preferences, signs out Google, and routes login (`AuthContext.js:581-608`; `profile.jsx:159-166`). Server deletes the presented session (`auth.controller.js:737-750`).

## Google flow

Native Google obtains Firebase ID token → `/auth/google` verifies token → maps only to existing non-admin verified/active tenant → creates session → home (`googleSignIn.js`; `auth.controller.js:536-655`). Google does not self-register tenants.

## Registration flow

`POST /auth/register` exists and `AuthContext.register` calls it (`AuthContext.js:514-539`), but there is no registration page or link. It creates Firebase Auth plus a MongoDB `tenant` user with `is_active: true` (`auth.controller.js:661-723`). Thus it is code-only/unreachable through the interface and conflicts with the verified-tenant login posture.

## Payment flow

Open outstanding bill → server ownership lookup → create PayMongo checkout → external browser → backend success/cancel redirect → app deep link → success screen polls PayMongo → webhook/poll reconciliation marks bill paid → refresh billing. The status polling endpoint fails to confirm that `checkoutId` belongs to the requesting tenant (`paymongo.controller.js:723-750`), a horizontal-data exposure risk.

# E. Forms and Validations Matrix

| Module | Form/Field | Required? | Current Validation | Error Message | Backend Validation | Missing Validation | Recommended Test |
|---|---|---:|---|---|---|---|---|
| Login | Email | Yes | trim/lowercase; regex; max 254 | “Email is required”; “Email address is too long”; “Please enter a valid email address” | Same broad regex/max | Unicode/domain normalization | empty, 254/255, whitespace, mixed case |
| Login | Password | Yes | 6–128; no whitespace | required/min/too long/no spaces | Same via `validateAuthPassword(...minLength:6)` | Password may be auto-created in Firebase for existing tenant | 5/6/128/129, every whitespace type |
| OTP | token/code | Yes | token from secure pending login; code exactly 6 digits | complete-code/session errors | token/code required, `/^\d{6}$/`, expiry, max 5 attempts | resend endpoint lacks per-token cooldown visible in controller | wrong ×5, expired, replay, rapid resend |
| Forgot password | Email | Yes | regex | email required/invalid | generic success prevents enumeration; reset record 15 min | token stored plaintext; no explicit request-per-account throttle beyond IP limiter | known/unknown/case variants/rate limit |
| Reset/change password | Passwords | Yes | ≥8, uppercase, lowercase, number, listed special, no whitespace; confirmation match | granular rule messages | same plus common-password list and max 128; current must differ | frontend strong validator has no max-128 check | 7/8/128/129, common, mismatch, reuse |
| Profile | Username | Yes if sent | 3–30, alphanumeric/underscore | field-specific | same + case-insensitive uniqueness query | check-then-write race; DB unique index intentionally removed | concurrent same username updates |
| Profile | Email | Yes if sent | regex, max 254 | field-specific | same + case-insensitive check | does not update Firebase email; race/no unique index | duplicate casing and login after change |
| Profile | Phone | Optional | `+63` + 10 digits; formatting stripped | “Phone must be in +63…” | same | No plausibility/ownership verification | +63 only, 9/10/11 digits |
| Profile | Address | Optional | max 200; strips `<`/`>` | max message | same | minimal sanitization; output encoding assumed | 200/201, HTML/control chars |
| Profile | Picture | Optional | image picker; base64 under 2 MB | permission/size errors | data-image or any string starting `http`; decoded size only meaningful for base64 | arbitrary `http` URL/SSRF not server-fetched but mixed-content/privacy risk; MIME not restricted for URL | 2 MB boundary, `httpx`, huge URL |
| Maintenance create | Type | Yes | selected from 8 IDs | “Select a service type.” | non-empty only | backend whitelist absent | forged category/very long value |
| Maintenance create | Description | Yes | trimmed, minimum 10 | “Description must be at least 10 characters.” | non-empty only | backend min/max absent | 1/9/10/very large/control chars |
| Maintenance create | Urgency | No/default normal | low/normal/high | selection UI | invalid silently becomes normal | Reject forged values instead of coercing | invalid/case variants |
| Maintenance | Attachments | No | ≤4; image 5 MB or document 10 MB; allowed MIME helper | type/count/size messages | ≤4, supported MIME/HTTPS; ≤10 MB metadata size | client/server image limit mismatch; trusts reported size/URL metadata after upload | 4/5, spoofed MIME/size/URL |
| Maintenance reply | Message | Conditional | message or attachment | “Add a message or attachment…” | max 2000, conditional required | UI has no `maxLength`; reopen note no max | 2000/2001, attachment-only |
| Maintenance edit | Type/urgency/description | Conditional | description ≥10 | minimum message | only pending; type any non-empty; urgency whitelist; description can become empty | same create gaps; no optimistic concurrency | edit after admin status change |
| Document upload | Type | Yes | fixed UI types | upload errors | whitelist of 9 types | UI/backend lists need contract tests | forged type |
| Document upload | File | Yes | image/PDF, ≤5 MB on documents page | “Please select a file under 5 MB.” | Firebase HTTPS URL, provider/path, image/PDF MIME, reported size ≤5 MB | trusts caller metadata and public token URL; orphaned files | spoof metadata; delete then access URL |
| Ticket | subject/message/category | subject/message | API only | backend: subject/message required; 120/2000/40 max | yes | no UI; category whitelist absent | boundaries/HTML/forged category |
| Support chat | category/priority/message | varies | UI normalizes choices; assistant 800 chars | API-specific | chat messages 1000; categories and priorities whitelisted | assistant and support limits differ; attachment UI disconnected | 800/801/1000/1001 |
| Announcement create | title/content | Yes | no UI here | “title and content are required” | only presence | no length/type/category/target validation | huge payload, malformed audience |
| Bill create/update | total/due date and itemized values | create total/due | no UI here | total >0, max ₱500,000, valid due date | create partially validates; update converts arbitrary values and accepts arbitrary status | user target is ignored: create uses admin’s own `user_id`; negative/NaN items/status/date unvalidated | create for tenant, negative items, invalid status/date |
| PayMongo checkout | billingId | Yes | selected bill | bill unavailable/paid/amount errors | ownership checked on create | status poll ownership absent; no idempotent checkout reuse | other tenant checkout ID; double tap |

# F. Status and Workflow Matrix

| Domain | Statuses found | Implemented transitions/behavior | Gaps |
|---|---|---|---|
| Maintenance | pending, viewed, in_progress, assigned, scheduled, resolved, completed, rejected, cancelled | tenant create→pending; edit/cancel only pending; admin may set **any** valid status from any state; resolved/completed→tenant reopen→pending; resolved→tenant confirm→completed | No transition graph for admin; races can overwrite states; UI counts rejected as resolved but cancelled separately. |
| Tickets | open, in_progress, resolved, closed | tenant create/open; tenant reply resets open; tenant status endpoint allows only closed; admin allows all four | Ticket UI absent; no transition restrictions beyond allowed destination. |
| Support conversations | open, in_review, waiting_tenant, resolved, closed | tenant starts/open, message reopens; admin reply→waiting_tenant; tenant close→closed; admin arbitrary listable status | “resolved” included in active conversation set, so start may reuse resolved thread. |
| Chatbot live request | waiting, active/open, closed/archive values | escalation→waiting; admin accept; live message; close/archive | Parallel model to support conversations creates inconsistent queues. |
| Bills/payment | pending, unpaid, overdue, partially_paid, paid, settled, processing, pending_payment plus hidden void/cancelled/deleted/draft/rejected/reversed/refunded/failed/archived | display normalizes statuses; payment evidence can force paid; PayMongo paid reconciliation updates record | No formal transition validation; admin update accepts arbitrary string; paid cannot be downgraded but other invalid transitions allowed. |
| Reservation | moveIn, active, completed, payment_pending, confirmed (query sets); push accepts arbitrary status | Read-only integration for room/context/docs; reservation push helper exists | No reservation endpoints/UI/transitions/expiry/conflict logic here. |
| Tenant | role plus `is_active` / `status` variants | login blocks inactive; registration creates active tenant | Middleware does not re-check after login; exact tenant status enum absent. |
| Contract | inferred dates/contract file; no status enum/controller | dashboard derives end date and documents expose contract | No contract lifecycle implementation here. |
| Room/bed | room sample: available/occupied; room assignment: active; bed histories queried | public read; dashboard selects active reservation/history | No create/update/assignment conflict/status transitions here. |

# G. Database Structure

This is a schemaless MongoDB integration. Fields below are reconstructed from reads/writes and are therefore “observed,” not a complete schema.

| Collection | Observed fields/relationships |
|---|---|
| `users` | `_id`, `user_id`, Firebase UID variants, email, username, name/fullName/firstName/lastName, phone, address, picture, role, active/status flags, failed-login lock fields, push token(s)/devices/preferences, `uploaded_documents[]`. `_id` and `user_id` are inconsistently used as foreign keys. |
| `user_sessions` | `session_token`, `user_id`, `created_at`, `expires_at`; TTL on expiry and index by user; login deletes all previous sessions. |
| `login_attempts` | email, success, reason, IP/user-agent/timestamp data. No retention policy found. |
| `otp_store` | `user_id`, email, OTP token/code, attempts, expiry; TTL. OTP code/token appear plaintext. |
| `password_reset_tokens` | user/email/Firebase UID, token, expiry, used fields. Token plaintext. |
| `rooms` | room identifiers/name/number/type, capacity/status, price/monthlyPrice, branch, amenities/images, nested `beds[]` including id/position/status. Public projection is not restricted. |
| `reservations` | `userId` ObjectId, roomId, selectedBed, branch, status, move-in/contract dates, rent; identity/document URLs; contract/proof; timestamps. Read-only here. |
| `bedhistories` / `roomoccupancyhistories` / `room_assignments` | user/room/bed/branch/status/date assignment records. Three competing assignment sources are used. |
| `billing` | legacy snake_case: `billing_id`, `user_id`, amount/total, description/type/period, due/release/payment dates, status/method/proof/notes, rent/electricity/water/penalties/items/breakdowns, PayMongo refs, timestamps. |
| `bills` | external camelCase: `_id`, `userId`, amounts/remainingAmount, status, dueDate/paidAt, line items, PayMongo refs, legacyBillingId. |
| `utilityperiods` | period/room/tenant utility readings/amount allocations consumed to derive electricity/water breakdowns (`billing.controller.js:603-773`). |
| `maintenance_requests`, `maintenancerequests` | canonical and legacy copies; request id, user IDs, reservation/room/branch, type/description/urgency/status, attachments, progress/status/reply/update histories, admin assignment/schedule/resolution, tenant confirmation/reopen/read timestamps. Dual-read/deduped. |
| `announcements` | id/title/content/category/priority, dates/timestamps, createdBy/user targeting/audience fields. |
| `notifications` | user_id, type/category/title/body/message/data, entity IDs, event key, timestamps/read metadata. Unique partial `(user_id,event_key)` index. |
| `tickets` | ticket_id/user_id/subject/message/category/status/responses[]/timestamps. |
| `chat_conversations`, `chat_messages` | tenant/admin assignment, branch/category/priority/status, unread counts/last message/timestamps; individual sender role/name/message/read/status. |
| `live_chat_requests`, `live_chat_archive` | assistant session/user/reason/status/messages/admin assignment/timestamps. |
| `faqs` | faq_id/question/answer/category. |
| `migrations` | migration completion markers. |

Indexes created at startup (`backend/server.js:187-399`) cover notification deduplication, sparse Firebase UID uniqueness, billing lookup, maintenance lookup, OTP/session TTL. Email/username unique indexes are deliberately dropped and enforced by non-atomic application checks, allowing concurrent duplicates.

# H. API Endpoints

All paths exist under both `/api` and `/api/m`.

| Method/path | Access | Behavior |
|---|---|---|
| POST `/auth/register` | Public/rate-limited | Self-register Firebase + active tenant Mongo record. UI absent. |
| POST `/auth/login`, `/auth/login/verify-otp`, `/auth/login/resend-otp` | Public/rate-limited | Password phase, OTP verification/session, resend. |
| POST `/auth/google` | Public/rate-limited | Existing active tenant Google login/session refresh. |
| GET `/auth/me`; POST `/auth/logout`, `/auth/change-password` | Auth | Current identity, revoke current session, Firebase password change. |
| POST `/auth/forgot-password`; GET/POST `/auth/reset-password` | Public | Email reset flow and HTML/mobile reset. |
| GET/PUT `/users/me`; POST `/users/push-token` | Auth | Profile and device push registration/preferences. |
| POST/GET `/users/documents`; GET/DELETE `/users/documents/:docId` | Auth | Own document metadata/content/delete. |
| GET `/users/admin/all` | Admin+ | All normalized users. |
| GET `/dashboard/me` | Auth | Own profile, assignment/room, billing and maintenance summary. |
| GET `/rooms`, `/rooms/:roomId` | Public | Full room list/detail. |
| GET `/billing/me`, `/me/latest`, `/history`, `/history/paid`, `/:billingId`, `/:billingId/pdf` | Auth | Own normalized/deduped bills and PDF. |
| POST `/billing`; PUT `/billing/:billingId` | Admin+ | Create/update bill; create currently assigns admin as owner. |
| POST `/paymongo/checkout`; GET `/checkout/:checkoutId/status` | Auth | Checkout and reconciliation/poll. Second lacks ownership check. |
| POST `/paymongo/webhook`; GET redirect success/cancel | Public/provider | Signature-verified payment webhook and deep-link bridge. |
| GET `/maintenance/me`; POST `/maintenance`; GET/PUT `/:requestId` | Auth | Own list/create/detail/pending edit. |
| POST `/:requestId/replies`; PATCH read/confirm-resolved/cancel/reopen | Auth | Own maintenance lifecycle actions. |
| GET `/maintenance/admin/all`; PATCH `/admin/:requestId/status` | Admin+ | Filter all and update status/progress. |
| GET `/announcements` | Optional auth | Public plus audience-filtered announcements. |
| POST `/announcements` | Admin+ | Create and notify broad/branch/user audience. |
| GET `/notifications` | Auth | Own notifications combined/deduped with announcements. |
| GET `/faqs`, `/faqs/categories` | Public | FAQ content/category. |
| GET/POST tickets tenant routes; GET/reply/status ticket admin routes | Auth/Admin+ | Ticket lifecycle. UI absent. |
| POST `/chat/start`; tenant conversation/message/close routes | Auth | Human support conversation. |
| `/chat/admin/...` routes | Admin+ | List/read/reply/change conversation status. |
| `/chatbot/message`, request-admin/reset/live-status/close/history | Auth | AI session and legacy live escalation. |
| `/chatbot/admin/live-chats`, accept, message | Admin+ | Legacy live queue management. |
| GET `/upload/imagekit-auth`; POST `/upload/firebase-storage` | Auth | Upload credentials/direct base64 Storage upload. |
| GET `/documents/:docId` | Auth | Contract/house-rule document PDF. |
| POST `/seed` | Auth + admin/superadmin/owner, non-production | Destructive sample reseed. |
| GET `/health`, `/` | Public | Health/root. |

# I. Automated Computations

| Computation | Confirmed behavior | Not implemented/problem |
|---|---|---|
| Bill total | Admin update sums rent + electricity + water + penalties + extra item amounts (`billing.controller.js:1057-1075`) | No non-negative/finite/max validation on updates or child items. |
| Utility breakdown | Derives tenant electricity/water breakdown from existing `utilityperiods` records and occupant/readings (`billing.controller.js:603-773`) | It does not calculate authoritative prorated charges or write bills. Formula provenance/rates are absent. |
| Billing insights | Client computes outstanding total/count, averages, on-time counts, month/utility comparisons, composition (`frontend/src/utils/billingInsights.js`) | Presentation analytics only; malformed/duplicate source values can distort results. |
| Bill status | Payment evidence may override stored status; hidden/non-payable status filters and cross-collection fingerprint dedupe (`billing.controller.js:134-481`) | Heuristic dedupe may merge legitimate equal charges; no database transaction/canonical key. |
| Payment amount | Remaining/total ×100 rounded to centavos (`paymongo.controller.js:648`) | No upper bound at checkout and no currency/source snapshot integrity record shown. |
| Due dates | Displayed and accepted on bill create | No due-date generation formula or overdue scheduler in this repository. |
| Rent, penalties | Values accepted/read and shown | No rent-generation or penalty formula/job. |
| Reservation expiry | None | No scheduler or transition logic. |
| Occupancy percentage | None | Dashboard returns assignment/room; no percentage calculation. |
| Maintenance counts | Dashboard/client count active statuses | Dual collections make correctness depend on dedupe. |

# J. Notifications

Confirmed trigger helpers in `backend/services/pushService.js` and call sites:

- New bill → bill owner (`billing.controller.js:1003-1011`).
- Payment confirmed → bill owner, from webhook/poll reconciliation (`paymongo.controller.js:601`).
- Maintenance status/admin progress → request tenant; tenant reply/reopen/confirm → admins/assigned recipients depending on helper (`maintenance.controller.js`).
- Announcement → all tenants, branch tenants, or targeted user; private announcements are intentionally not broadcast (`announcement.controller.js:148-159`).
- Password changed/reset requested → in-app notification and optionally email (`auth.controller.js:789-999`).
- Reservation update helper exists (`pushService.js:657-685`) but no call site in this repository.

Notifications can be Expo or FCM and invalid tokens are pruned. `notificationService.js` persists in-app records and uses event keys for dedupe. Missing: server-side read/unread mutation, guaranteed delivery/retry ledger, tenant notification preference categories, admin notification UI, and direct evidence that external reservation/contract systems invoke the helpers.

# K. Bugs and Security Issues

| Severity | File/section | Current behavior / problem | Recommended fix |
|---|---|---|---|
| Critical | `backend/controllers/billing.controller.js:947-1013` | Admin bill creation ignores a target tenant and sets `user_id` to the logged-in admin. | Require and validate tenant ID; store immutable creator ID separately; integration test. |
| High | `backend/controllers/paymongo.controller.js:723-750` | Any authenticated user can poll/reconcile any known checkout ID. | Resolve checkout to bill and enforce tenant ownership/admin role before returning data. |
| High | `backend/middleware/auth.js:18-42` | Active/disabled state is checked only at login, not each request. | Reject inactive users in middleware and revoke all sessions on deactivation. |
| High | `frontend/src/context/AuthContext.js:33-41`, `services/api.js:156-162` | Bearer session is stored in AsyncStorage. | Migrate token to SecureStore; rotate on migration. |
| High | `auth.controller.js:400-488,951-999` | OTP/reset secrets are stored plaintext. | Store HMAC/slow hashes; atomic compare/consume; redact logs. |
| High | `backend/server.js:340-345`, `user.controller.js:192-213` | DB email/username uniqueness removed; check-then-update races allow duplicates. | Store normalized fields and enforce sparse unique indexes; handle E11000. |
| High | `maintenance.controller.js:1351-1490` | Server lacks category whitelist and description min/max; edit can set empty description. | Shared schema validation on create/update. |
| High | `billing.controller.js:1021-1152` | Update accepts arbitrary status, negative/NaN monetary fields, invalid dates, oversized totals. | Strict DTO/schema, finite non-negative bounds, status transition policy. |
| High | `frontend/src/screens/LilyAssistantScreen.jsx:961-997` + `api.js:310-311` | Support attachment picker does not send attachments to backend. | Implement upload/message attachment contract or remove control. |
| Medium | `auth.controller.js:263-279` | Login can auto-create Firebase credentials for a pre-existing tenant. | Require one-time admin invitation/claim token and verified email. |
| Medium | `auth.controller.js:661-723`, no registration page | Public self-registration API creates active tenants despite UI being approval-only. | Disable route in production or create pending applicant flow with approval. |
| Medium | `routes/room.routes.js` | Full room endpoints are unauthenticated. | Public-safe projection/rate limit or require auth. |
| Medium | `server.js:103-109` | Global JSON limit is 30 MB. | Default 1 MB; scope larger parser to upload route. |
| Medium | `upload.routes.js:101-171` | Base64 upload loads entire file into memory; client can choose smaller max but metadata authenticity is weak. | Multipart/streamed signed uploads; verify content magic bytes. |
| Medium | `user.controller.js:138-146` | Picture URL check accepts any value beginning `http`. | Require HTTPS and approved Storage/CDN host. |
| Medium | `announcement.controller.js:123-160` | Announcement create only validates title/content presence. | Length, type, priority, audience, date and branch validation. |
| Medium | `chat.controller.js:4-16` vs `chatbot.controller.js:47-50` | Two chat stacks and different message limits/status models. | Consolidate domain and shared schemas. |
| Medium | `billing.controller.js:10-74` | Hard-coded presentation bills can conceal missing real data depending on fallback conditions. | Disable sample fallback outside explicit demo mode. |
| Medium | `frontend/src/services/api.js:134-199` | 401 refresh works only with a Firebase current user; OTP email sessions are cleared. | Add secure refresh token/session renewal endpoint or force predictable re-login. |
| Medium | `AppHeader.js:167-174` | Mark-all-read is local timestamp only. | Server per-user read receipts. |
| Medium | `user.controller.js:509-518` | Deleting document metadata does not delete Storage object/public token URL. | Authorized Storage deletion and audit trail. |
| Medium | `server.js:156-158` | `/api` and `/api/m` duplicate every route, obscuring surface boundaries. | Version and separate route contracts. |
| Low | `services.jsx:596-598` | Error says “photos” although documents are accepted. | Say “files.” |
| Low | screenshots + `services.jsx` | Raw Mongo ObjectIds appear in room/location display. | Resolve friendly room/bed labels; never expose internal IDs in UI. |

Additional release risks already confirmed in actual config: missing iOS bundle identifier and iOS Firebase/permission/Google configuration (`frontend/app.config.js`); Android release uses debug signing (`android/app/build.gradle:121-125`); PayMongo uses hard-coded `frontend://` deep links (`paymongo.controller.js:915-959`); Firebase client config is present in repository history; secrets exist in ignored local `.env` and must be rotated if shared.

# L. Missing Features Based on Scope

These are missing **from the provided implementation**, even if an external system may contain them:

1. Public registration/application/reservation UI, room/bed selection, availability locking, deposit/proof workflow, conflict detection, expiry, cancellation, and confirmation.
2. Admin and super-admin interfaces, with distinct permissions, audit logs, staff management, branch scoping, and super-admin-only operations.
3. Tenant approval/deactivation workflow and immediate session revocation.
4. Contract creation/templates/e-signature/renewal/termination/expiry/reminders and explicit contract statuses.
5. Canonical room/bed CRUD, assignment, transfer, occupancy history controls, and occupancy percentage.
6. Authoritative recurring rent generation, meter capture, rate configuration, proration rules, penalty rules, due-date schedules, immutable bill snapshots, and scheduled jobs.
7. Cash/manual/bank payment approval and proof review UI; refunds/reversals/partial payments and reconciliation UI.
8. Server-backed notification read state and granular preferences.
9. Admin review/verification of uploaded documents and secure retention/deletion.
10. Reports/exports/dashboard analytics required for dormitory administration.
11. Complete audit trail for financial/status/admin actions.
12. Automated integration/E2E tests. Existing frontend tests cover only assistant hook, upload helper, attachment picker, and API config; backend has no test framework/scripts.

Code-only but UI-inaccessible features: registration, support tickets, admin ticket methods, admin billing update, seed, admin live-chat/maintenance/user APIs. UI-only/incompletely connected features: assistant support attachments, server read-state for notifications, profile full-name editing, reservation notification navigation, and apparent lease-extension review language without an admin review module here.

# M. Testing Checklist

## Positive

- Email→OTP→session→home; Google existing tenant; biometric returning tenant; forgot/reset/change password.
- Load every tab, pull-to-refresh, dark mode, profile update, upload/view/delete each supported document.
- Maintenance create for every category/urgency, attachment types, edit/cancel, admin statuses, reply, resolve/confirm/reopen.
- Bills from both collections, breakdown/PDF, each PayMongo method, webhook and polling reconciliation.
- Public FAQ/announcement/room and targeted/branch/global announcement delivery.

## Negative

- Invalid/expired/replayed OTP/reset/session; inactive/deleted user with existing session.
- Malformed IDs/dates/statuses/currency, empty/huge strings, unsupported/spoofed files, local URLs, missing Storage objects.
- Payment for paid/hidden/zero bill; checkout API failure/cancel/timeout/webhook invalid signature.

## Boundary

- Email 254/255; login password 6/128; new password 8/128; username 3/30; address 200; ticket 120/2000/40; chat 800/1000; maintenance reply 2000; attachment 4/5 and size exact ±1 byte; bill ₱0.01/₱500,000/above.

## Role and access

- Public, tenant A, tenant B, admin, superadmin, owner against every endpoint.
- Tenant A attempts tenant B bill/PDF/checkout status/document/maintenance/ticket/chat.
- Admin vs superadmin distinction tests should currently fail to find any difference—record as scope defect.
- Deactivate user mid-session; branch-admin cross-branch access.

## Duplicate and conflict

- Concurrent registration/profile email/username; concurrent bill creation; repeated webhook/poll; double checkout tap.
- Same bill in `billing` and `bills`; same maintenance request in both collections; repeated notification event key.
- Two reservations for same bed/dates, room capacity exceeded, overlapping assignment—requires missing reservation backend.

## Security

- Session fixation/rotation/revocation, bearer token extraction, CORS, rate-limit bypass, NoSQL/operator injection, mass assignment, oversized JSON/base64, MIME spoofing, malicious PDF/image, stored XSS in admin web consumers, URL/deep-link tampering, webhook replay/timestamp tolerance, log/PII leakage, dependency audit.

## Mobile responsiveness

- Small/large Android and iPhone, tablet, landscape, font scaling 200%, keyboard overlap, safe areas/notches/home indicator, dark mode contrast, screen reader labels, offline/cold-start/retry, slow network, back behavior, external browser return, camera/library/document permissions denied.

## Database consistency

- Orphan sessions/OTP/reset tokens; duplicate normalized email/username/Firebase UID; dangling reservation/room/bed/user references; conflicting assignment sources; dual billing/maintenance reconciliation; paid amount/remaining/status invariants; Storage metadata/blob parity; notification dedupe/read state; timezone/date type consistency; index/TTL verification on production.

## Verification outcome

Static route-to-controller and UI-to-service tracing completed. Supplied screenshots were visually inspected. Runtime production database state, external admin/web code, Firebase/PayMongo consoles, scheduled jobs, and real-device behavior remain unverified because those artifacts were not provided.
