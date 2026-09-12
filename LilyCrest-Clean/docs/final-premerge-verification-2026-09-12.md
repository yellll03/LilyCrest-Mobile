# Final pre-merge verification — 12 September 2026

**Verdict: BLOCKED.** Historical payment evidence is now verified, but physical-device regression, the real tenant/admin Extend Stay workflow, and actual OS push delivery remain incomplete. No files have been staged or committed. Nothing has been merged or deployed. All access to the configured application database and PayMongo was read-only.

This report supersedes the historical-payment access blocker in the initial audit. Raw evidence, scripts, test logs, status captures, and full classifications are outside both repositories at `D:/LilyCrest-Task-Review/2026-09-12-final-verification/`.

## A. Historical PayMongo verification

**Actual channel: GCash. Implemented API projection/mobile label helper result: GCash.** Physical rendering and an authenticated deployed HTTP response were not tested; no deployment was performed.

The prior `.env.audit.local` URI selected a disposable local `lilycrest-reservation-audit-2026-08` database. This pass used the application's configured `lilycrest-dormitory` database with the native MongoDB driver. No application server, scheduler, Mongoose connection, index creation, or settlement/polling endpoint was started against that database.

The exact trace is:

| Evidence | Verified result |
| --- | --- |
| Screenshot bill | `6a8d7b397264ca3f491b1023`, initial payment; total/paid ₱10,600, remaining ₱0 |
| Existing ledger | Synthetic check-in record `6a9168c369b5a9de03864a11`; method `offline_cash`; reason “Settled upon move-in check-in”; no provider payment ID or explicit-method provenance |
| Bill's linked checkout | `cs_500d236b70903dc0b289f8c7` |
| PayMongo payment | `pay_fy66tqX1RqeMGSxfswD6M4Wd`; direct GET returned HTTP 200, status `paid`, PHP 1,060,000 centavos, source type `gcash`, no refunds |
| Ownership/purpose | Checkout metadata matches the exact bill, tenant, reservation, and `initial_payment` purpose |
| Actual paid timestamp | August 25, 2026, 11:36:56 UTC / 7:36:56 PM Manila |
| Provider environment | **Test mode:** PayMongo reports `livemode: false`. This is the provider record used by the screenshot account, not evidence of a live-money charge. |
| Projection | `payment_method_label: GCash`, `payment_method_source: paymongo_checkout_transaction`, provider payment reference and actual paid date |
| Data preservation | Before/after hashes of the original complete bill and linked payment records matched. Total, paid amount, and remaining balance are unchanged. |

A separate ₱2,000 reservation deposit is also confirmed GCash, but it was **not** used to infer the ₱10,600 bill's channel. The bill's own checkout and payment provide that evidence.

This exposed a gap in the accepted implementation: excluding the synthetic cash row alone produced “Method unavailable” because the successful provider payment was missing from the local ledger. The follow-up adds a read-only historical initial-payment evidence lookup, using the shared PayMongo method extractor. It runs only when a paid initial bill has an excluded synthetic check-in entry and no reliable ledger transaction. It validates checkout ID, bill/tenant/reservation/purpose metadata, one successful PHP payment, exact paid amount, and no refunds. Provider failures/mismatches retain “Method unavailable”; the lookup has a five-second timeout. Synthetic local checkout IDs are rejected. No payment record or paid invoice is rewritten.

Raw evidence: [original payment projection](/D:/LilyCrest-Task-Review/2026-09-12-final-verification/original-payment-projection.json), [direct provider payment](/D:/LilyCrest-Task-Review/2026-09-12-final-verification/original-provider-payment.json), and [checkout evidence](/D:/LilyCrest-Task-Review/2026-09-12-final-verification/provider-checkout-readonly.json).

## B. Physical-device results and viewport feedback

Repeated `adb devices -l` checks returned an empty device list. No physical Android transport was available. No iOS/TestFlight device or native iOS execution environment was available on this Windows host. A request for an authorized Android device and non-production tenant/admin environment was sent; neither became available during this verification.

| Affected feature | Physical Android | Physical iOS/TestFlight |
| --- | --- | --- |
| Advance & Deposit statement | BLOCKED: no device | NOT AVAILABLE |
| Electricity bill | BLOCKED: no device | NOT AVAILABLE |
| Water bill | BLOCKED: no device | NOT AVAILABLE |
| Outstanding Balance | BLOCKED: no device | NOT AVAILABLE |
| Room Transfer | BLOCKED: no device | NOT AVAILABLE |
| Extend Stay | BLOCKED: no device | NOT AVAILABLE |
| Success/error/confirmation feedback | BLOCKED: no device | NOT AVAILABLE |
| Custom header Back / nested entry paths | BLOCKED: no device | NOT AVAILABLE |
| Android hardware Back / iOS gestures | BLOCKED: no device | NOT AVAILABLE |

The following paths remain on the physical-device checklist: Home → Billing → Back → Home; Profile → Billing → Back → Profile; Profile → Contract → Back → Profile; Home → News → Announcement → Back → News; equivalent nested and cold-entry paths. Automated navigation reducers/router regressions pass; they do not establish physical hardware/gesture behavior.

The archived fixture for the unchanged mobile frontend was rerun in a local browser. Shared toast/dialog checks passed at **top, middle, and bottom**, in **light and dark** themes, with simulated safe areas. The fixture kept feedback within the viewport. Its native/API/icon integrations are mocked. Evidence is in `viewport-browser.log` and `viewport-evidence/` in the external directory.

Physical photo upload/profile edits, password/security actions, transfer, extension, billing/payment, and maintenance cancellation/reopen feedback are still unverified per flow. The generic browser fixture and existing platform-mocked tests are supplemental evidence only.

## C. Extend Stay end-to-end

**Real mobile → API → admin website → approval/rejection → canonical renewal → notification → refreshed device: BLOCKED.** No connected device or identified authenticated non-production tenant/admin test environment was available. Production writes were not authorized, so no production extension, contract, payment, or notification was created.

Isolated MongoDB replica-set integration tests verified:

| Case | Automated result | Real device/environment |
| --- | --- | --- |
| Valid extension | PASS: canonical snapshot/request persisted | BLOCKED |
| End date before/equal current end | PASS: rejected | BLOCKED |
| Duplicate pending/concurrent submissions | PASS: one pending request | BLOCKED |
| Tenant without active Stay | PASS: rejected | BLOCKED |
| Approval | PASS: one successor Stay, correct predecessor/request association | BLOCKED |
| Rejection | PASS: original dates preserved, pending lock released | BLOCKED |
| Repeated/concurrent approvals | PASS: one success, one successor, one generator invocation | BLOCKED |
| Stale/transferred-out request and wrong branch | PASS: rejected | BLOCKED |
| Refreshed mobile API state | PASS: service returns latest approved/rejected request | BLOCKED on device |

The new concurrency test confirms no duplicate successor Stay and only one invocation of canonical contract generation. Contract generation is mocked in this request integration suite; it does not prove a real generated/signed Contract. Existing separate canonical renewal and activation integration suites also pass, including deferred rent changes, duplicate-successor conflict handling, and activation idempotency. Real document preparation/signing and full workflow execution remain pending.

## D. Notifications

| Event | Isolated persisted in-app record | Mocked mobile dispatch count | Actual in-app/device display and OS push |
| --- | --- | --- | --- |
| Submitted | PASS: one record after concurrent duplicate submissions | PASS: one invocation | BLOCKED |
| Approved | PASS: one record after concurrent approvals | PASS: one invocation | BLOCKED |
| Rejected | PASS: one record after repeated rejection attempt | PASS: one invocation | BLOCKED |

Submitted notifications are intended by this implementation. Actual OS delivery, tap navigation, permission handling, foreground/background behavior, and absence of duplicate OS notifications cannot be confirmed without a registered test device and authorized test environment. No claim is made that a mocked dispatch is actual push delivery.

## E. Automated tests

| Executed this pass | Result |
| --- | --- |
| Full mobile Jest suite (before section I follow-up) | **115 suites, 806 tests passed** |
| Focused Home/room-card follow-up | **5 suites, 63 tests passed**, including 40 new platform/theme/value cases |
| Home narrow-screen render checks | **24 cases passed** at 320px/390px, light/dark and simulated Android/iOS |
| Targeted canonical API/integration regressions | **12 suites, 155 tests passed** |
| Final extension notification-dedup follow-up | **16 tests passed**, overlapping the 155 above |
| Browser viewport fixture | PASS: top/middle/bottom, light/dark |
| Changed server JavaScript syntax checks | PASS |
| Both repository `git diff --check` checks | PASS |

The backend suite includes historical provider evidence, incorrect ownership/amount/currency/refunds/session rejection, provider outage handling, extension validation/concurrency, billing bridge/routes/PDF behavior, PayMongo extraction, check-in settlement, renewal/activation, and transfer regressions. Tests use isolated databases and mocked external effects. JSON results and logs are kept outside the worktrees. The previous successful Android/iOS bundle exports and admin build remain supplemental build evidence. The Home presentation follow-up used the requested focused native-render tests and narrow-screen browser geometry checks; a full native device/build rerun is not claimed.

## F. Worktree cleanup

The full before inventory was reclassified before any proposed staging. It matched the prior cleanup exactly: **104 files** (mobile 48, website 56), with no intervening unknown edits. `docs/user-guide-work/` contains only four preserved authored Python scripts and two review JSON files; the extracted images/render intermediates remain removed.

- Earlier cleanup: **913 generated files / 154.48 MiB removed**; retained evidence copied and hash-verified outside the repositories.
- This verification: **0 additional disposable worktree files needed removal**. New logs, scripts, screenshots, and raw database/provider evidence were written directly outside both repositories.
- Preserved unrelated work: **47 files**, including original DOCX files, final guides, authored scripts, prior QA notes, and uncertain historical evidence. These remain unstaged and excluded from the proposed feature list.
- Final worktree: **112 files** — mobile **31 modified + 23 untracked = 54**; website **15 modified + 43 untracked = 58**. The increase from 104 includes the historical-evidence helper, PayMongo timeout support, this report, and five Home presentation/test files from section I. The Home-only follow-up began at 107 files and ended at 112.
- Ignore rules: no additional changes in this pass. The two narrow cleanup ignore-rule changes remain part of the proposed scope. Empty directories left by the previous cleanup are harmless and untracked by Git.

Before/after `git status --short`, expanded classified file inventories, and exact hash checks are in the external final-verification directory. No unrelated source or uncertain user work was deleted/restored. No files are staged.

## G. Exact proposed commit files

The [proposed commit-file list](mobile-audit-changed-files.txt) contains **all 65 exact paths**, separated by Git root. It contains 42 mobile feature/documentation files and 23 canonical API/admin/ignore-rule files. No user guides, DOCX/PDF files, screenshots, temporary scripts, generated bundles, or previous unrelated work are included. This is a proposal only; both indexes remain empty.

## H. Release preparation and lint follow-up

The latest authorization permits committing the approved changes, merging into the actual canonical branches (mobile `master`, website/API `main`), then building a local production Android APK and a production iOS build for TestFlight. Physical-device regression, authenticated tenant/admin Extend Stay E2E, and actual Android/iOS OS push delivery are documented post-release QA, not release blockers. They have not been represented as passed.

The earlier release-preparation pass stopped before commit after ESLint found 11 new `no-undef` errors for Jest's `test` in `extendStayScreen.test.jsx` (3), `homeMonthlyRate.test.jsx` (2), and `mobileAuditPresentation.test.jsx` (6). Existing shared test globals include `it`, but omit `test`. The repository convention is a file-local `/* global test */` declaration, used by numerous existing tests. The authorized fix adds that declaration only to the three new files, preserving their remaining bytes and all test behavior. No ESLint/Jest configuration or functional feature code was changed.

**Lint result: 11 new errors before; zero new errors after.** All three affected files now have zero errors and zero warnings. ESLint across every approved mobile JavaScript/JSX file reports only the two independently confirmed baseline `no-undef` errors at `utilityNotificationRouting.test.js:7` and `:15`, plus seven `import/first` warnings (`maintenanceReopenConfirmation.test.js:2-5`, `profilePendingMoveIn.test.js:23-24`, `surveyFeedbackHidden.test.js:10`). The known two errors remain unchanged under the explicit instruction to preserve them; relevant lint exits 1 for that documented baseline reason.

The finalized implementation has passed the full mobile suite (116 suites / 846 tests), backend regressions (12 suites / 155 tests), admin production build, Expo prebuild configuration resolution, release contract, and repository whitespace checks. Prior standalone Home evidence is 63 focused tests / 24 light/dark simulated-platform render cases. Release-lint-fix logs are kept outside both repositories at `D:/LilyCrest-Task-Review/2026-09-12-release-lint-fix/`; preceding functional/config/build results remain in `D:/LilyCrest-Task-Review/2026-09-12-release/`.

The recalculated implementation manifest contains **65 paths** (42 mobile, 23 website). The three corrected files were already included, so there are no new implementation paths. All **47 unrelated user files** are excluded and must remain unchanged. Any required Android/iOS version metadata is a separate, tested release commit after merging the implementation. Build and submission status must be reported from actual subsequent results, not inferred from validation.

Historical payment verification remains confirmed GCash in PayMongo test mode; the implemented read-only projection returns GCash without changing historical records. No migration rewrites historical paid bills or payment history.

## I. Home - Monthly Rate fallback UI

**Completed, presentation only.** Home's Your Room card now uses a dedicated small presentation component. The Monthly Rate label remains. A missing/invalid amount displays **Not available**, at **13px, 18px line height, normal 400 weight**, using the existing `textSecondary` theme token. The fallback sits beneath the label and aligns left. Finite values retain the existing formatted currency output and **18px/700** price typography. Zero and numeric strings remain supported.

The room detail column now permits shrinking (`minWidth: 0`), the available-price row wraps when needed, and the value is constrained to its column. No billing amount, API request, room selection, or monthly-rate resolution rule was changed. The formatter's existing finite-number/missing-value predicate was extracted and shared with this component to avoid disagreement between availability and formatting.

**Was unavailable legitimate?** It is a legitimate state when the Home API supplies a missing, blank, or non-finite `dashboard.room.price`. Home passes that field directly to the display; valid numeric/numeric-string and zero values render correctly in regression tests. No live Home response for this particular visual report was supplied or captured, so the specific tenant's unavailable state is not asserted as independently verified. No valid-value suppression was reproduced, and no deeper backend tracing was needed for this presentation fix.

**Focused test result:** 5 Home suites / **63 tests passed**. This includes 40 new component cases across Android/iOS platform settings and light/dark tokens: null, undefined, blank, whitespace, malformed/non-finite values; valid 6300/numeric-string amounts; and zero. Existing truthful-state, room-photo interaction, notification-state, and contract-end authority regressions passed. The previous full 806-test mobile run predates this follow-up; it is not represented as a post-change full-suite run.

**Layout/render result:** **24 cases passed**, using the actual rate component, Home card styles, and actual chatbot-button geometry in a local browser at 320px/390px widths, with Android/iOS platform geometry and both themes. Missing values remain inside the card and clear of the chatbot horizontally, including when positioned at the button's vertical level. Available values retain their currency typography. The assistant icon and router were mocked; these are automated/browser layout checks, not physical-device verification. The 320px light and dark captures were visually inspected.

Files added to the proposed commit scope:

- `frontend/app/(tabs)/home.jsx`
- `frontend/src/components/HomeMonthlyRate.jsx`
- `frontend/src/utils/homePresentation.js`
- `frontend/src/tests/homeMonthlyRate.test.jsx`
- `frontend/src/tests/homeRoomPhotoInteractionIsolation.test.js`

Evidence remains outside Git: `D:/LilyCrest-Task-Review/2026-09-12-final-verification/home-focused.json`, `home-focused.log`, and `home-render/results.json` with screenshots. No generated files or temporary fixture scripts were added to the worktree. Nothing is staged, committed, merged, or deployed.
