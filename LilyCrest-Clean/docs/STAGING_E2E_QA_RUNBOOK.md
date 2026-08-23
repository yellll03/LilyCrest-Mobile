# LilyCrest staging/E2E QA runbook

Status: source capability implemented; external staging resources must be provisioned before fixture creation or device QA.

This runbook is intentionally non-secret. Never paste passwords, private keys, access tokens, OTPs, or complete service-account JSON into a report or terminal transcript.

## Isolation contract

| Component | Staging identity | Production identity | Fail-closed proof |
| --- | --- | --- | --- |
| Mobile APK | `com.lilycrest.lilycrestdorm.staging`, `lilycrest-staging`, visible STAGING banner | `com.lilycrest.lilycrestdorm`, `frontend` | staging/production Gradle flavors and pre-build verifier |
| Mobile API | public HTTPS host containing `staging`, `qa`, or `e2e` | `https://api.lilycrest.space` | server startup guard and mobile runtime/build guard |
| Contract API | public HTTPS host containing `staging`, `qa`, or `e2e` | production Contract API | both API startup guards reject cross-environment resources |
| Admin web | public host containing `staging`, `qa`, or `e2e`; visible STAGING banner | production admin host | web build/runtime verifier |
| MongoDB | database name containing `staging`, `qa`, `e2e`, or `test` | existing production DB | API startup and every write-tool guard |
| Firebase | dedicated project and bucket containing a non-production marker | existing production project | API, web, mobile, Google-services, and APK checks |
| PayMongo | `sk_test_...` only | production key | API startup/write guard |
| EAS | `preview` environment, staging flavor, internal APK | `production` environment | profiles have distinct environment IDs and Gradle commands |

`NODE_ENV=production` is deliberate in hosted staging. It enables secure cookies, strict CORS, rate limits, and production-style error behavior. `LILYCREST_ENVIRONMENT=staging` identifies the resource boundary. A write tool additionally requires `STAGING_ALLOW_WRITES=true`; none of those settings can compensate for a production-looking DB, Firebase project/bucket, or public host.

## Provisioning order

1. Create a new MongoDB database and least-privilege database user. The database name must visibly contain a QA marker; never copy production tenant data.
2. Create a dedicated Firebase project. Enable email/password Auth, Storage, and Cloud Messaging. Register Android package `com.lilycrest.lilycrestdorm.staging`, its staging signing certificate, the web app, and controlled Google OAuth clients. Keep the generated staging `google-services.json` in the secret manager only.
3. Deploy the Contract API from the coordinated staging revision. Start from `server/.env.staging.example` in the Contract repository and supply every secret in the host's secret manager.
4. Deploy the mobile-facing API from this repository. Start from `backend/.env.staging.example`; point `CONTRACT_UPSTREAM_URL` only at the Contract staging API.
5. Deploy the Admin web from the same coordinated Contract revision using its `web/.env.staging.example`. Run `npm run build:staging`; do not promote an artifact that fails the environment verifier.
6. Configure the EAS `preview` environment from `frontend/.env.staging.example`. Store `GOOGLE_SERVICES_JSON` as a file secret. The profile deliberately does not inline an API fallback.
7. Verify both API health endpoints and their deployment commit/build IDs. Confirm the Admin banner and inspect its network requests before enabling QA writes.
8. Seed one new `QA_RUN_ID`, run the complete checklist, perform a cleanup dry run, execute cleanup, and verify zero remaining records.

The hosted services should be production-like but operationally isolated: separate database credentials, Firebase service account, storage bucket, OAuth clients, public hostnames, CORS allowlists, email sender/test mailbox, PayMongo test credentials, and scheduler ownership. Disable production schedules and webhooks unless a staging-specific equivalent is being explicitly tested.

## Preflight commands

From the mobile frontend:

```powershell
npm.cmd run verify:release-contract
npm.cmd run verify:environment -- staging
```

From the Contract web:

```powershell
npm.cmd run verify:environment -- staging
npm.cmd run build:staging
```

From each API, start the server normally. Startup validation must pass before the service listens. A production host, a production-looking database/Firebase resource, a non-test PayMongo secret, missing explicit staging identity, or missing write opt-in must terminate the operation before writes.

## Build and inspect the APK

```powershell
npm.cmd run android:staging-apk
npm.cmd run verify:staging-apk-target
```

The first command verifies environment/Firebase inputs, builds `assembleStagingRelease`, and automatically inspects the packaged manifest. The second can be repeated immediately before installation. It proves the package ID and the embedded API provenance metadata are staging-only. Do not install an artifact that fails.

For the production regression build, use the separate production Firebase file and environment:

```powershell
npm.cmd run android:production-apk
npm.cmd run verify:production-apk-target
```

## Synthetic fixture lifecycle

The authoritative fixture scripts live in the Contract repository. Use a unique run such as `qa-20260823-001`; all emails must be recognizable QA addresses. Tenant B's controlled Google email must be the same mailbox as `QA_TENANT_B_EMAIL`. Passwords are supplied through the process environment and are never printed.

```powershell
$env:QA_RUN_ID='qa-20260823-001'
npm.cmd run qa:fixtures:seed
npm.cmd run qa:fixtures:list
npm.cmd run qa:fixtures:cleanup
npm.cmd run qa:fixtures:cleanup:confirm
npm.cmd run qa:fixtures:list
```

Seed is idempotent for the selected run and creates deterministic Mongo IDs plus three dedicated Firebase Auth users. Expected initial database scope is 22 records: one run manifest and 21 business records (three users, two rooms, two reservations, two stays, two independent Contracts, two known bills, six audience/lifecycle announcements, one maintenance request, and one canonical support conversation). It creates no prepared/final Contract document: those must come from the real Admin workflow.

Cleanup is dry-run by default. It lists exact Mongo IDs, QA Auth identities, and provably-owned storage keys. Execute mode deletes only that captured ID set, refuses ambiguous storage keys, checks QA custom claims before deleting Auth users, compares listed/deleted counts, and rechecks every captured ID. Archive the non-secret JSON summaries as test evidence.

## Notification release-gate route

`POST /api/staging/qa/notifications/:type` exists only when `LILYCREST_ENVIRONMENT=staging`. It uses normal authentication, Admin authorization, the dedicated `STAGING_QA_ADMIN_EMAILS` allowlist, and a QA-run tenant lookup. Every dispatch is recorded in `qa_notification_dispatch_audits`.

Supported types are `announcement`, `billing`, `contract`, `maintenance`, and `support`. Use placeholders in shell history and reports:

```text
Authorization: Bearer <QA_ADMIN_ID_TOKEN>
Content-Type: application/json

{
  "qaRunId": "qa-20260823-001",
  "tenantEmail": "<QA_TENANT_EMAIL>",
  "entityId": "<QA_ENTITY_ID>",
  "eventId": "<UNIQUE_RETRY_SAFE_EVENT_ID>"
}
```

The route calls the production notification producers and payload builders. Announcement requires an explicit live, audience-eligible QA entity. Contract refuses until the real Admin draft/final workflow creates a version. Support refuses until a real Admin message exists and routes using that actual message ID. Billing and maintenance resolve only the selected QA tenant's marked records.

## Real-world QA checklist

Record PASS/FAIL with timestamp, build ID/commit, device/browser version, QA run ID, entity ID, expected result, actual result, and a redacted screenshot/network trace where useful.

### Authentication and isolation

- Tenant A: email/password -> delivered OTP -> correct OTP -> Home; correct branch and room; no Login/OTP beneath the authenticated stack.
- Force-stop/reopen -> Home with no Login flash.
- Logout -> Login; force-stop/reopen -> Login with no authenticated data visible.
- Controlled Google Tenant B -> Home; force-stop/reopen -> Home; no Tenant A identity or cache.
- Tenant A -> logout -> Tenant B: Tenant B never renders Tenant A room, Contract, billing, notifications, support, or profile, even transiently.

### Five cold-start notification routes

For each type, force-stop first, dispatch independently, tap from the system tray, and verify authenticated restore precedes routing. Confirm the exact announcement, bill, Contract, maintenance request, or support conversation; no duplicate stack; repeated tap is safe.

### Admin runtime security

- Login -> Dashboard -> refresh -> still authenticated -> close/reopen -> expected session behavior.
- Inspect HttpOnly, Secure, SameSite, CSRF, CSP, security headers, console, and network.
- Confirm no bearer/session token is stored in localStorage.

### Announcement audience matrix

- Global: both tenants through News, stored notification, push, Home, and chatbot.
- Branch A: Tenant A yes; Tenant B no.
- Branch B: Tenant B yes; Tenant A no.
- Private Tenant A: Tenant A yes; everyone else no.
- Future: invisible before start. Expired: invisible after end.

### Billing consistency

Compare the real API response, Home, Billing, and chatbot for both synthetic bills. Bill ID, status, amount, due date, and previous balance must agree. A valid current bill must never become `no_current`.

### Maintenance

Tenant A creates a request with attachment; Admin receives, assigns, moves In Progress, and resolves; Tenant sees every stage/history/notification. Exercise retry and double tap and prove no stage disappears.

### Support

Tenant starts inquiry; Admin sees it; tenant text/attachment/attachment-only messages arrive; Admin text/attachment replies arrive; resolution/reopen, unread counts, pagination, and lost-response retry work. Tenant B direct access to Tenant A's conversation and attachments is denied without metadata leakage.

### Contract

- `/contracts/current` returns each tenant's own Contract only.
- A -> B document and B -> A document return denied or non-document 404 without metadata.
- Generate Tenant A draft in the real Admin UI; validate tenant, address, branch, room, pricing, lease dates, contract number, and document.
- Confirm Tenant A draft visibility/notification and Tenant B denial.
- Upload Tenant A wet-signed final through the real Admin workflow; confirm canonical lifecycle, final notification, mobile focus/foreground propagation, and continued Tenant B denial.
- Do not directly edit lifecycle fields.

### Chatbot, recovery, and visual pass

- Ask both tenants about Contract expiry, current rent, maintenance, applicable announcements, room, and support status. Answers must change with identity and must not invent contacts, bank accounts, fees, schedules, prices, response times, or policy.
- While authenticated: lose network -> refresh/foreground -> stale/offline state with retained session -> restore network -> retry -> normal state. Connectivity must not route to Login.
- Inspect Home, News, Billing, Contract, Services, Support, Chatbot, Profile, and Admin for spacing, alignment, clipping, touch targets, keyboard, loading/empty/error/stale states, button visibility, icons, and supported themes. Fix only reproduced defects.

## Completion report template

Use only `COMPLETE — RELEASE READY`, `PARTIALLY COMPLETE`, `BLOCKED`, or `FAILED`. End with exactly `MERGE` or `HOLD`.

```text
Final status:

Fresh repository state:
Mobile: Branch / HEAD / Upstream / origin/master / ahead-behind / working tree / PR #37 / CI
Contract: Branch / HEAD / Upstream / origin/main / ahead-behind / working tree / PR #121 / CI

Staging services and isolation:
Mobile APK:
Mobile API:
Contract API:
Admin web:
MongoDB:
Firebase Auth/Storage/Push:
EAS preview:

Hard guards added/tested:

QA identities:
Tenant A: READY / NOT READY
Tenant B: READY / NOT READY
Admin: READY / NOT READY
OTP mailbox: READY / NOT READY
Google QA identity: READY / NOT READY

Authentication/session results:
Email/password + OTP:
Google:
kill/reopen:
logout:
account switch:

Cold-start notification results:
Announcement:
Billing:
Contract:
Maintenance:
Support:

Admin runtime/security results:

Contract isolation/lifecycle:
Tenant A:
Tenant B:
A -> B:
B -> A:
draft:
final:
mobile propagation:

Domain results:
announcements:
billing:
maintenance:
support:
chatbot:

Automated tests/builds:

CONFIRMED DEFECTS:
UNVERIFIED GATES:
ENVIRONMENT BLOCKERS:
TECHNICAL DEBT:

Production records modified: YES / NO
Created:
Cleaned:
Remaining:

MERGE / HOLD
```
