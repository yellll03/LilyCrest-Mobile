# LilyCrest staging/E2E QA result — 2026-08-23

Final status: PARTIALLY COMPLETE

The source-level staging capability, production-write protections, deterministic synthetic fixtures, scoped cleanup, and notification test entry point are implemented in isolated worktrees. No hosted staging resources or QA identities were available, so no synthetic records were created and the required real device/browser workflows remain unverified. The changes in this report have not been pushed, merged, or deployed.

## Fresh repository state

State was recorded after `fetch --prune` and before staging work.

Mobile checkout:

- Branch: `fix/contract-document-410-message`
- HEAD: `0a7df52add3e91381ee85388c55d1d4bdb5ee5d2`
- Upstream: `origin/fix/contract-document-410-message`
- `origin/master`: `c41fa497459e472db1e718b8e65550bf308251bd`
- Ahead/behind: ahead 0, behind 0
- Working tree: DIRTY, 89 entries; preserved unchanged
- PR #37: OPEN, `fix/device-release-polish-20260823` -> `verify/release-integration-20260823`, MERGEABLE, CLEAN
- CI: frontend tests/lint/release, backend tests, Android release, and GitGuardian SUCCESS; Sourcery SKIPPED

Contract checkout:

- Branch: `main-sync`
- HEAD: `1affa00aa4c7e2e21e4d3f326828049cb38bcf0b`
- Upstream: `origin/main`
- `origin/main`: `26c1f17d92e7682c26cc0afc9bb6cf3c1c6ce505`
- Ahead/behind: ahead 0, behind 2
- Working tree: DIRTY, 11 entries; preserved unchanged
- PR #121: OPEN, `test/contract-final-isolation-20260822` -> `main`, MERGEABLE, CLEAN
- CI: Server CI, Frontend CI, Vercel, and auto-merge checks SUCCESS

Implementation was made separately on Mobile `feat/staging-e2e-20260823` from PR #37 commit `f583da9d7892251b8253c3d30b6950dc73de590b`, and Contract `feat/staging-e2e-20260823` from PR #121 commit `7136fa8427d183d809ec4a5b9e7b4f472931e3da`.

## Staging services and isolation

| Service | Result | Production isolation |
| --- | --- | --- |
| Mobile APK | SOURCE READY; STAGING BUILD NOT RUN | Distinct `.staging` package, scheme, app label/banner, Firebase file, Gradle flavor, pre-build guard, and packaged-APK target verifier. Staging build refuses production/missing inputs. |
| Mobile API | SOURCE READY; NOT DEPLOYED | Startup refuses staging unless API, QA-named DB, Firebase project/bucket, and Contract upstream all have non-production identities. |
| Contract API | SOURCE READY; NOT DEPLOYED | Startup refuses cross-environment API/web, DB, Firebase, storage, or PayMongo configuration. |
| Admin web | SOURCE READY; NOT DEPLOYED | Persistent STAGING banner plus build/runtime checks reject production API/socket/app/Firebase targets. Production build passed. |
| MongoDB | NOT PROVISIONED | Fixtures and cleanup require an explicit QA/staging/test DB name and staging write opt-in; production-looking DBs abort before connection/write. |
| Firebase Auth/Storage/Push | NOT PROVISIONED | Dedicated non-production project/bucket and flavor-specific Google services are mandatory. Firebase CLI was not authenticated. |
| EAS preview | NOT CONFIGURED | Account was readable, but the preview environment contained no staging variables. The profile has no production fallback. |

## Hard guards added and tested

- Explicit `LILYCREST_ENVIRONMENT=staging`; `NODE_ENV=production` alone is not treated as staging.
- Independent `STAGING_ALLOW_WRITES=true` requirement for every staging write tool.
- Immediate non-zero refusal with `PRODUCTION_TARGET_DETECTED` before any DB/Firebase write when production identity, host, DB, project, or bucket is detected.
- Explicit Mongo URI and QA/staging/e2e/test database-name requirement.
- Dedicated Firebase project and storage bucket marker checks.
- Staging API, frontend, and Contract hosts must be public, visibly non-production hosts; `api.lilycrest.space` is denied.
- Staging PayMongo credentials, when configured, must use `sk_test_...`.
- Production startup/build rejects staging-marked DB, hosts, Firebase resources, or endpoints.
- Mobile staging/production have separate application IDs, schemes, Google-services files, EAS environments, and Gradle tasks.
- Mobile build verifies Firebase/OAuth inputs and Google-services project/package before Gradle; final APK verifies packaged application ID and embedded API metadata.
- Admin build/runtime validates deployment identity, API/socket/app URLs, and Firebase project/bucket/app identity.
- The staging notification route is absent outside explicit staging, uses normal authentication and Admin authorization, requires a dedicated QA-admin allowlist plus marked QA tenant/run, resolves real entities, calls the real producers, and records dispatch audits.
- Seed records use deterministic IDs and a QA run manifest. Cleanup defaults to list/dry-run, requires explicit staging confirmation, deletes only captured IDs/owned storage keys/QA-claimed Auth users, compares counts, and verifies absence afterward.
- 19 Mobile write entry points and 72 legacy Contract write scripts now call the shared fail-closed guard. Five Contract fixture/guard modules provide seed, list/dry-run, confirmed cleanup, deterministic IDs, and CJS/ESM guard parity.
- Automated environment/write/route tests passed 14/14 in Mobile and 14/14 in Contract. Direct production-target probes for Mobile seed, Contract seed, and Contract cleanup exited non-zero before writes. Mobile and Admin staging verifiers rejected production URLs.

## QA identities

Tenant A: NOT READY

Tenant B: NOT READY

Admin: NOT READY

OTP mailbox: NOT READY

Google QA identity: NOT READY

## Authentication/session results

- Email/password + OTP: NOT RUN — UNVERIFIED
- Google: NOT RUN — UNVERIFIED
- kill/reopen: NOT RUN — UNVERIFIED
- logout: NOT RUN — UNVERIFIED
- account switch: NOT RUN — UNVERIFIED

Automated session/navigation contracts remain green, but they do not satisfy the real staging device gate.

## Cold-start notification results

- Announcement: NOT RUN — UNVERIFIED
- Billing: NOT RUN — UNVERIFIED
- Contract: NOT RUN — UNVERIFIED
- Maintenance: NOT RUN — UNVERIFIED
- Support: NOT RUN — UNVERIFIED

## Admin runtime/security results

NOT RUN — UNVERIFIED. Hosted login/refresh/reopen behavior, HttpOnly, Secure, SameSite, CSRF, CSP, security headers, localStorage, console, and network inspection require the missing staging deployment and Admin identity.

## Contract isolation/lifecycle

- Tenant A: NOT RUN — UNVERIFIED
- Tenant B: NOT RUN — UNVERIFIED
- A -> B: NOT RUN — UNVERIFIED
- B -> A: NOT RUN — UNVERIFIED
- draft: NOT RUN — UNVERIFIED
- final: NOT RUN — UNVERIFIED
- mobile propagation: NOT RUN — UNVERIFIED

## Domain results

- announcements: NOT RUN — UNVERIFIED
- billing: NOT RUN — UNVERIFIED
- maintenance: NOT RUN — UNVERIFIED
- support: NOT RUN — UNVERIFIED
- chatbot: NOT RUN — UNVERIFIED

Offline/foreground recovery and the real device/browser visual pass are also unverified.

## Automated tests and builds

- Mobile backend: 642/642 PASS
- Mobile frontend: 503/503 PASS
- Mobile total: 1,145/1,145 PASS
- Contract server: 2,439/2,439 PASS across 257/257 suites after the reproduced transaction fix
- Contract web: 612/612 PASS across 93/93 files
- Contract total: 3,051/3,051 PASS
- Grand total: 4,196/4,196 PASS
- Mobile lint: PASS with 0 errors and 4 existing React Hook warnings
- Release contract verifier: PASS, version 1.2.2 (21), development/staging/production isolated
- Android staging build: NOT RUN — correctly blocked by absent staging API/Firebase/OAuth/Google-services inputs
- Android production build: PASS, 880 tasks, packaged target verified as `com.lilycrest.lilycrestdorm` and `https://api.lilycrest.space`
- Production APK: 60,897,276 bytes; SHA-256 `138F2CE23C28168E9F48F90AC764950CB555CA9E4908151B9989F2B164F08484`
- Contract production web build: PASS
- Final syntax/package JSON and `git diff --check`: PASS; line-ending notices only

## CONFIRMED DEFECTS

1. Room-transfer Contract activation made the successor current before clearing the predecessor. With the real partial unique `stayId/isCurrent` index present, MongoDB raised `E11000` and prevented both caller-managed rollback/commit flows. Fixed by clearing the predecessor first and then activating the successor in the same transaction. The test now explicitly synchronizes indexes; focused replica-set tests pass 13/13 and the complete Contract server suite passes 2,439/2,439.

No other application defect was reproduced. No P0 defect was found.

## UNVERIFIED GATES

- Real email/password, OTP delivery/acceptance, Google login, kill/reopen, logout, and account switch
- All five force-stopped notification tap routes and repeat-tap behavior
- Authenticated Admin browser persistence and runtime security controls
- Announcement audience/schedule behavior across News, stored notifications, push, Home, and chatbot
- API-to-Home/Billing/chatbot bill consistency
- Full maintenance and support workflows, attachments, retries, pagination, unread state, and cross-tenant denial
- Contract current-document isolation, direct cross-access denial, real Admin draft/final workflow, and mobile propagation
- Tenant-scoped chatbot answers and non-invention checks
- Offline/stale/foreground recovery and actual screen/device/browser visual QA

## ENVIRONMENT BLOCKERS

- No hosted staging Mobile API, Contract API, or Admin URL/deployment access
- No separate staging MongoDB/database credentials
- No dedicated staging Firebase Auth/Storage/FCM project or service account; Firebase CLI unauthenticated
- No staging Android Google-services file, OAuth client set, or push configuration
- No accessible synthetic QA mailboxes, OTP delivery path, controlled Google identity, QA Admin, or tenant credentials
- EAS preview environment has no staging variables
- No local production release-signing credentials; the local production APK is Android-debug signed and is build evidence, not a distributable release artifact

## TECHNICAL DEBT

- Dependency audits report: Mobile backend 16 vulnerabilities (1 low, 9 moderate, 5 high, 1 critical); Mobile frontend 17 (2 moderate, 14 high, 1 critical); Contract server 9 (8 moderate, 1 high); Contract web 5 (3 moderate, 2 high).
- Mobile lint retains 4 existing React Hook dependency warnings.
- Android build reports third-party deprecations and Gradle features incompatible with Gradle 9.0.
- Contract web production build reports existing circular/dynamic-import and large-chunk warnings.
- `mongodb-memory-server` emits intermittent `ECONNRESET` warnings while stopping replica sets even when tests pass.

Production records modified: NO

Created: 0 synthetic/cloud records

Cleaned: 0 synthetic/cloud records

Remaining: 0 synthetic/cloud records

HOLD
