# Lilycrest mobile audit and implementation — 12 September 2026

Latest verification: [final pre-merge report](final-premerge-verification-2026-09-12.md). The original payment is now confirmed GCash in provider test mode; a read-only checkout-evidence follow-up covers its missing ledger transaction. Physical-device/E2E/push gates remain blocked. The historical access limitations below describe the initial audit and are superseded by that report.

Status: implemented in the local working trees for review. Nothing has been merged or deployed. Production data has not been changed.

Cleanup follow-up: generated evidence and the temporary browser harness are now preserved outside Git at `D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean`. Test/log filenames below refer to its `docs/` directory. Reproducible native/web build outputs were removed after validation; see [cleanup report](worktree-cleanup-2026-09-12.md).

The audit findings and implementation plan were reported before editing. The two pasted requests were duplicates; the five screenshots supplied the UI references. This report distinguishes source-code findings, automated verification, browser fixtures, and checks that still require access or devices.

## Audit findings

1. **Incorrect Advance & Deposit method.** The production mobile API is served by the canonical bridges in `D:/Capstone-Website/server`, mounted before the vendored legacy mobile API. The payment path is checkout → `mobilePaymongoRoutes.js` / `webhookController.js` / `paymentController.js` → `readPaymentMethod` → the canonical settlement/payment ledger → `mobileBillingRoutes.js` → `mobileBillingBridge.js` → mobile `bill-details.jsx`. The bridge previously exposed `Bill.paymentMethod`. Initial move-in check-in could default an omitted method to `offline_cash`, which renders as Cash (Branch). The successful ledger's `Payment.method` is the transaction evidence. A provider reference alone does not establish GCash, Maya, card, bank, or cash. The exact screenshot bill's live transaction could not be verified: a scoped, read-only database connection timed out. The source-code defect is confirmed; the individual historical row's cause remains unconfirmed.
2. **Electricity and Water.** Both sections lived inline in `frontend/app/bill-details.jsx`. Electricity already used `elecTable`, reading/date/unit columns, amount and due-date rows. Water used a separate two-column information grid and interpolated raw numeric values. Water API data includes legacy-compatible fields and canonical allocation records; room totals and tenant shares must remain distinct.
3. **Included Bills alignment.** `outstanding-balance.jsx` reused centered muted text for the status beneath a left-aligned period. Status length therefore changed its visual position. The existing `StatusBadge` component and semantic status palette can provide consistent rows.
4. **Room Transfer contrast.** Light gold `accentLight` backgrounds were paired with theme-dependent foregrounds that did not remain readable in dark mode. Selected controls, information cards, faint input borders, placeholders, and a missing `danger` token needed attention. Shared semantic selection/input tokens are the appropriate repair. Light-mode muted text also fell below 4.5:1 against the input background.
5. **Existing extension capability.** `renewStayWorkflow` is the authoritative renewal entry point. It creates a successor Stay, links the predecessor, invokes renewal contract generation, and preserves the established rent/contract activation process. `resolveAuthoritativeLeasePricing`, canonical current Stay/Contract selectors, renewal-offer checks, transfer conflict guards, and lifecycle notifications can be reused. A request record should hold intent and review history, not become a second tenancy authority.
6. **Reusable feedback implementations.** `AlertContext` hosts `StyledModal`; `ToastContext` hosts the shared toast. Other reusable overlays include `ProfilePhotoCropModal`, `AttachmentPickerSheet`, and `ImageLightbox`. Services has native detail/composer modals and `InlineMaintenanceDialog`; other screens also own native modal containers. True native modals already escape page scroll containers. The profile's success banner, however, was inside its ScrollView; services also had a scroll-bound banner. The toast host needed an explicit full-height root, and StyledModal needed a safe-area/viewport height limit for long content. The existing maintenance dialog is deliberately a sibling inside its current native modal; its iOS presentation arrangement must be preserved.
7. **Navigation.** Tabs used `backBehavior="initialRoute"`, which discarded the desired visited-tab Back behavior. `returnToBilling` forced bill details back to Billing even when another route opened it. Payment, bill-details, and outstanding batch checkout replaced the source route with the result; success/cancel timers then redirected again. Most other headers already call `safeBack`. Authentication replacements, disabled-feature guards, explicit Go to Home, and explicit retry actions have different purposes and remain. No new hardware Back override or manually maintained previous-screen parameter was introduced.
8. **Related lifecycle/data concerns.** Historical synthetic check-in cash rows cannot reliably establish tender. Missing meter readings must not be rendered as invented consumption. Renewal approval intentionally follows a successor lease process; simply stretching the original signed contract would bypass its lifecycle. Current rent must not change early. Pending extensions also need coordination with existing renewal/transfer actions, and approval must recheck the canonical Stay rather than trusting a saved snapshot.

## Implementation plan followed

1. Fix the payment projection with successful, tenant-owned ledger evidence; stop creating implied cash settlements.
2. Reuse Electricity table styles for Water, existing badges for Included Bills, and shared theme tokens for transfer contrast.
3. Add tenant request and admin review around the existing renewal workflow, with authoritative dates/pricing, duplicate protection, conflict checks, and notifications.
4. Repair shared feedback positioning and use native navigation history.
5. Run relevant integration/regression tests, both native bundle exports, and local visual/interaction checks; retain review artifacts and record unverified cases.

## Implemented behavior

### Billing and UI

- The production billing bridge bulk-loads successful, positive-amount Payments scoped to the tenant and bill. The latest effective settlement/verification timestamp selects the evidence. Method, reference, and payment date come from that record. Existing canonical labels are retained, including “Credit / Debit Card” and “Bank Transfer”.
- Old synthetic check-in records without explicitly recorded tender are excluded as evidence. A bill without reliable transaction evidence displays “Method unavailable”. Historical invoices and ledger entries are never repaired or rewritten by this read path.
- New check-in auto-settlement requires an explicit method. Explicit branch cash remains supported and records its provenance; an omitted method no longer creates a fabricated cash payment.
- Water uses the Electricity table styles for cycle, occupants when available, opening/closing readings and dates, consumption, rate, room total, allocated share, total due, and due date. Formatting turns `2.9800000000000004` into `2.98` without changing API data or billing math. Missing historical measurements remain unavailable.
- Included Bills uses reusable Paid / Partially Paid / Unpaid / Overdue badges, a left-aligned period/status block, and right-aligned amounts. Outstanding aggregation is unchanged.
- Room Transfer uses shared selection, input-border, information, error, and text tokens in both themes. Validation opens a viewport-level alert, including repeated identical errors.

### Extend Stay

- Active tenants can open Extend Stay from Profile or eligible current contract information. The screen shows current dates, server-provided extension dates/rates, duration choices, optional reason/note, confirmation, and the latest request/review note.
- Mobile endpoints: `GET /api/m/stay-extension/current` and `POST /api/m/stay-extension-requests`. Authentication and active-tenant/canonical Stay/Contract checks run on the server. Duration is validated as 1–24 whole months; the UI offers 1, 3, 6, and 12. Dates must be valid, future relative to the current lease, and consistent with the requested duration. Stale terms/pricing require refresh.
- A partial unique index permits only one pending request per tenant. Transactional reservation linkage coordinates the pending request with canonical actions. Existing move-out, termination, renewal, successor, and transfer conflicts are checked; tenant transfer, scheduled transfer, direct transfer, and renewal-offer paths reject a pending extension.
- Admin Tenants workspace shows tenant, room, current dates, requested extension/rate, reason/note, and review controls. `GET /api/tenant/stay-extension-requests` and `PATCH /api/tenant/stay-extension-requests/:id` require admin permissions and enforce branch scope (owner can review across branches).
- Approval calls `renewStayWorkflow`. The pending request, matching canonical Stay/Contract, original end date, room, and requested end date are checked again. Request approval and successor Stay creation occur in the same transaction. The existing contract-generation/signing and deferred rent-activation services remain authoritative. Rejection clears the pending lock without changing Stay/Contract dates.
- Submitted, approved, and rejected events produce deduplicated tenant notifications with the Extend Stay destination. Branch admins receive the submitted request notification. No mobile code directly changes tenancy dates.

### Feedback and navigation

- Profile success/error feedback is routed through the shared viewport toast. The services banner sits outside its scrolling content. Survey draft/error feedback uses the shared alert while preserving the existing feature flag.
- StyledModal is a native overlay with safe-area padding, viewport-bounded height, scrollable long content, and semantic icon colors. ToastProvider has a full-height root and a correct default duration for string messages. AlertContext settles superseded confirmations instead of leaving unresolved callers.
- Visited-tab history is enabled. Bill-details Back uses actual history; checkout results are pushed from their source screen. Result screens remain visible until an action is taken. Success/cancel Back uses `safeBack`; Home is its cold-entry fallback. Explicit Home/retry/authentication actions remain explicit actions.

## Verification and evidence

| Check | Result and limits |
| --- | --- |
| Complete mobile Jest suite | 115 suites / 806 tests passed. `mobile-audit-final-results.json`; `mobile-audit-final-output.log`. |
| Final presentation/billing/transfer/modal follow-up | 6 suites / 49 tests passed after the final method-reference and feedback changes. `mobile-final-focused.log`. |
| Final batch-payment/navigation follow-up | 4 suites / 39 tests passed after retaining the outstanding-balance route during checkout. `mobile-navigation-final.log`. |
| Canonical backend targeted suite | 10 suites / 101 tests passed: new extension/payment integration tests, mobile bridge/routes/PDF, PayMongo extraction, check-in settlement, canonical renewal, and effective-date contract activation. `backend-audit-final-tests.log`. |
| Final payment-evidence follow-up | 2 suites / 47 tests passed, including the additional latest historical manual-transaction timestamp/reference case. `backend-final-focused.log`. This overlaps the targeted suite. |
| Transfer regressions | 2 suites / 35 tests passed for tenant transfer and scheduled-transfer integration. `transfer-regression-tests.log`. |
| Maintenance feedback platform tests | 18 tests passed with Android/iOS platform cases. `mobile-maintenance-final-results.json`. These simulate platform behavior, not physical devices. |
| Extend Stay screen interactions | 3 tests passed: confirmation/submission intent, rapid-tap guard, cancel, and pending-request state. Included in the mobile suite. |
| Android / iOS Expo exports | Both isolated platform exports passed with exit code 0. `android-native-export.log`, `ios-native-export.log`. Reproducible bundle output was removed during cleanup; successful export logs are retained externally. |
| Admin website build | Vite production build completed successfully. `admin-build-output.log`. Existing Browserslist freshness warnings were emitted. |
| Browser visual/interaction fixtures | Actual Water, Room Transfer, Extend Stay, shared toast/dialog, and admin review components rendered locally. Light/dark at 390×844; top/middle/bottom scroll tests kept feedback inside the viewport and simulated safe areas. Admin fixture approval and rejection passed. API, icons, and native safe-area/browser integrations were mocked. These are not device screenshots. |
| Whitespace | `git diff --check` passed in both working trees (line-ending notices only). |

The Mongo integration tests use isolated in-memory MongoDB instances; extension approval uses a replica set for transactions. They assert duplicate submission handling, invalid/past/mismatched dates, inactive/stale/historical/other-branch rejection, approval/rejection notifications, successor Stay linkage, no current-rent repricing, original contract dates preserved, and invocation of the canonical contract-generation service. External push delivery and actual PDF generation are mocked in the new extension integration test; separate existing contract/activation regressions cover the canonical downstream behavior.

Payment tests cover successful GCash, Maya, card, bank, explicit branch/manual records, historical paid rows, exclusion of pending/other-tenant/synthetic rows, and unchanged partial/unpaid/outstanding amounts. Existing gateway extraction/reconciliation tests exercise provider payload fixtures. No live payment was initiated.

Navigation verification uses actual React Navigation tab/stack reducers as well as existing router/state-machine tests. It covers Home/Profile/News → Billing → Back; Home/Profile → Contract → Back; News → Details → Back; nested/cold-entry behavior. Actual Android hardware Back and iOS gestures/header behavior still require device checks.

Visual artifacts: [Water dark](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/water-dark.png), [Water light](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/water-light.png), [Transfer dark](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/transfer-dark.png), [Transfer light](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/transfer-light.png), [Extend Stay](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/extension-light.png), [bottom-scroll dialog](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/feedback-dark-bottom.png), [admin review](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/evidence/mobile/LilyCrest-Clean/docs/mobile-audit-visual/admin-extension-review.png). The full screenshot set is in the external evidence archive under `docs/mobile-audit-visual/`.

## Remaining risks and required review

- The screenshot's exact historical transaction remains unverified because the configured database connection timed out. If the successful payment is missing or not linked to that bill, the UI deliberately reports unavailable evidence. Any historical reconciliation should be a separately reviewed, evidence-based operation.
- No Android device was attached (`adb devices` was empty), and native iOS execution was unavailable on this Windows workstation. Validate Android hardware Back, iOS Back/gestures, native modal stacking, keyboard/safe-area behavior, and both themes on devices before release. Native bundle exports and browser fixtures do not establish device QA completion.
- Live GCash/Maya/card/bank checkout, actual push delivery, and end-to-end generated/signed renewal contracts were not exercised. Those need test-account/provider and native-device access.
- The all-platform Expo export encountered the existing web incompatibility of a native PDF dependency (`codegenNativeComponent`). The separate Android and iOS exports succeeded. This task does not claim a working Expo web app export.
- Canonical successor contract generation remains asynchronous, as in the existing renewal workflow. Approval is not equivalent to a signed/activated new contract; operational failures in document generation still need the existing monitoring/retry process.
- The admin queue currently returns the latest 100 requests. Larger histories need pagination/filtering before this becomes a high-volume review queue.
- Both repositories must be reviewed together. The request model/index and canonical server routes are part of the backend change; the legacy `LilyCrest-Clean/backend` is not the production owner for these endpoints. Review deployment/index creation through the normal release process.
- User-existing untracked documents, user-guide work, website audit scripts, and output directories were preserved. No commit, merge, deployment, live checkout, or historical invoice write was performed.

## Changed-file manifest

The accompanying [changed-file manifest](mobile-audit-changed-files.txt) lists the mobile and canonical API/admin source/test changes. The temporary local fixture sources, screenshots, and raw test results are preserved in the external evidence archive. They are excluded from the feature files; permanent regression tests remain in the repositories.
