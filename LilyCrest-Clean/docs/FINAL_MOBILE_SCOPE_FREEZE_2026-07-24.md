# Final Mobile Scope Freeze — 2026-07-24

## Freeze decision

Tenant-mobile source is frozen for Android pre-release build `1.1.0 (2)`.

The freeze gate passed:

- frontend tests: 66/66;
- backend tests: 98/98;
- Expo lint: passed;
- Expo Doctor: 17/17;
- Expo dependency compatibility: current;
- backend Node syntax: passed;
- Android `assembleRelease`: passed;
- no known critical code blocker remains.

No production database write, canonical migration, web admin change, iOS build, or client/legal approval assumption was made.

## Mobile audit

| Module | Classification | Evidence / limitation |
|---|---|---|
| Authentication | COMPLETE | Classified errors, opaque passwords, direct Firebase reset, request locks, Firebase singleton, secure token storage, cached offline restoration |
| Tenant profile | COMPLETE | Authoritative name/email/address controls, username validation/cooldown, branch/contract/survey safe states |
| Branch-aware location | BLOCKED BY PRODUCTION DATA | Resolver and consumers complete; canonical Gil Puyat and Guadalupe records are absent |
| Google Maps navigation | BLOCKED BY CLIENT APPROVAL | Guadalupe approved URL configured for canonical data application; official Gil Puyat destination unavailable |
| Document/PDF viewer | COMPLETE | Native PDF, zoom, pages, rotation support, progress, retry, signature/MIME/size validation, tenant cache, offline, download, share |
| Contract viewer | BLOCKED BY PRODUCTION DATA | Safe viewer integration complete; authoritative canonical contract records are unavailable |
| Generated PDF engine | COMPLETE | A4 multi-page engine, wrapped content/tables, page breaks, page numbering, readable Unicode transliteration, no silent tail omission |
| Smart Tenant Assistant | BLOCKED BY DEPLOYMENT | Multilingual/account/document code and tests complete; backend deployment and live Gemini/OCR verification pending |
| Surveys | BLOCKED BY PRODUCTION DATA | Tenant mobile and backend complete; controlled definitions/eligible test accounts absent |
| Notifications | IMPLEMENTED — NEEDS INTEGRATION | Dedupe, targeting and deep-link code complete; live Firebase delivery and closed-target checks require deployed backend/device |
| Billing display | COMPLETE | Rent/utilities/charges/status/proof fields are data-driven; approved date/penalty boundary helper and tests added |
| Payment records | COMPLETE | Paid/unpaid/partial/pending-verification display and PayMongo record handling present |
| Maintenance | COMPLETE | Create, attachment, status, thread, retry and authorization code present |
| Announcements | COMPLETE | List, details, filters, empty/error states and notification survey action present |
| Session restoration | COMPLETE | Secure token plus tenant-scoped cached profile fallback for transient offline startup |
| Logout/account isolation | COMPLETE | Session/SecureStore clearing and tenant-scoped document/survey caches |
| General responsiveness | IMPLEMENTED — NEEDS POLISH | Automated/layout safeguards present; final TECNO portrait/landscape/TalkBack verification pending |

## Included features

- authentication and password-reset stability;
- tenant profile and authoritative branch projection;
- branch-aware maps integration and unavailable state;
- contract/document/PDF viewers;
- native PDF download/share/offline cache;
- paginated generated PDF rendering engine;
- multilingual smart assistant and authenticated account lookups;
- quarterly and move-out tenant surveys;
- billing/payment displays and approved penalty boundaries;
- maintenance/attachment workflow;
- announcements and notification deep links;
- secure session restoration and account isolation;
- Android responsive and accessibility safeguards.

## Excluded

- web admin interfaces and analytics UI;
- iOS/TestFlight;
- canonical contract and identity migrations;
- unapproved production writes;
- features or legal wording requiring client approval;
- persistent chatbot memory and stored-document indexing.

## Blockers by category

### Code blocker

None known after automated and native build regression.

### Build blocker

None. Local signed release APK assembled.

### Backend deployment blocker

- updated branch, survey, assistant, notification, billing/PDF endpoint code must be deployed together;
- deployed health and protected endpoints must be smoke-tested.

### Production data blocker

- missing approved canonical Gil Puyat and Guadalupe branch records;
- missing canonical contracts;
- missing controlled quarterly/move-out definitions and eligible test accounts.

### Client approval blocker

- official Gil Puyat Maps destination and coordinates;
- legacy lease wording still says “5th of each month”; it was not changed because approved legal wording may not be edited in this task.

### Physical test blocker

- `adb devices -l` currently shows no authorized device;
- TECNO CLA5 clean-install regression and network matrix cannot begin until it is connected and authorized.

### Optional future enhancement

- stored-document indexing;
- persistent assistant memory;
- production-owned distributed survey reminder scheduler;
- richer PDF font embedding for scripts beyond WinAnsi/transliteration.

## Billing rule audit

Approved policy represented in shared code:

- one-month advance plus one-month security deposit for new tenants;
- first month covered by advance;
- regular billing begins in month two;
- due-day number follows move-in day and clamps to the last day of shorter months;
- one-day grace;
- PHP 50/day begins on the second day after due.

Existing billing records remain authoritative. The new helper does not retroactively rewrite amounts or production records.

Non-contract tenant policy screens and generated policy documents now use the approved rules. Hardcoded lease text was left unchanged and classified as a client/legal approval blocker.

## PDF repair

The reusable engine now:

- uses A4 dimensions and consistent margins;
- creates actual multiple pages;
- wraps headings, paragraphs, key/value rows, tables and breakdowns;
- continues long content instead of `return`/`continue` omission;
- repeats aligned header/footer chrome and page numbers;
- protects signature/acknowledgment-like sections from silent omission by continuing them;
- transliterates common Unicode and represents unsupported characters rather than deleting them;
- removes the hardcoded Gil Puyat footer default.

Canonical contract generation remains data/approval-blocked and its legal wording was not changed.

## Deployment requirements

1. Deploy the frozen backend source.
2. Apply only administrator-approved canonical branch records/location metadata.
3. Provision controlled survey and tenant fixtures.
4. Confirm Firebase Android SHA/signing registration for the selected signing certificate.
5. Confirm production API `https://mobile-api.lilycrest.space`.

## APK plan

- package: `com.lilycrest.lilycrestdorm`
- app version: `1.1.0`
- Android version code: `2`
- artifact: signed APK
- distribution: internal/pre-release
- backend: `https://mobile-api.lilycrest.space`
- ABI: `arm64-v8a`
- orientation: default/portrait and landscape
- source revision: current Git HEAD plus frozen working-tree snapshot; exact artifact checksum and source manifest are recorded with release evidence

No source changes are permitted after this freeze without invalidating the APK and rerunning the gate.
