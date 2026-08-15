# LilyCrest Billing Phase 2 — Pre-Deployment Report

## 1. Executive Verdict

**READY WITH NON-BLOCKING P2 ITEMS**

Payment settlement has been hardened (amount validation, ambiguous-fallback fail-closed, ownership/idempotency proven by tests). A real, distinct Payment Receipt endpoint now exists, separate from the Billing Statement. Unknown bill fields were traced exhaustively (all branches, stash, dangling commits) and confirmed non-authoritative — nothing in current logic depends on them. The utility-breakdown gap is a genuine historical data limitation, not a blocker. All 350 backend and 217 frontend tests pass. Nothing has been deployed.

## 2. Repository State

```
Repository root: D:/LilyCrest
Branch:          master
HEAD:            bcf4235655cfbff8d143720300fdf8835d790801 "feat: streamline tenant notification filters"
Upstream:        origin/master
Ahead/Behind:    0 / 0 (fully synced)
```

Tracked modified (before this phase's edits): `../.claude/settings.local.json` (unrelated, pre-existing, not touched by this work).

Previous billing fix files — explicitly inspected, confirmed present and undrifted before any Phase 2 edit:

| File | State before Phase 2 |
|---|---|
| `backend/controllers/billing.controller.js` | Phase 1 diff intact (24 lines) |
| `frontend/src/utils/billingStatus.js` | Phase 1 diff intact (52 lines) |
| `frontend/app/billing-history.jsx` | Phase 1 diff intact (25 lines) |
| `frontend/app/bill-details.jsx` | Phase 1 diff intact (14 lines) |
| `frontend/app/document-viewer.jsx` | Phase 1 diff intact (11 lines) |
| `backend/tests/billingUtilityReleaseConsistency.test.js` | present, untracked |
| `frontend/src/tests/billingStatusConsistency.test.js` | present, untracked |

Reproduced test totals before touching anything: **Backend 334/334**, **Frontend 211/211** — matching the prior report exactly.

## 3. Previous Fix Verification

All Phase 1 fixes verified live in the code, not just in memory:
- `mapRealBill()`'s `billReleaseDate`/`providerDueDate` fallback to `billingCycleStart`/`dueDate` — present.
- Shared `billingStatus.js` (`getUtilityReleaseSchedule`, `isBillOutstanding`, `getBillPaymentDate`) — present, imported by both screens.
- No fake "Payment Receipt" label on the statement PDF — verified (superseded correctly in Phase 2 by a *real* receipt, see §12).
- Paid-aware statement wording (`TOTAL PAID` vs `TOTAL AMOUNT DUE`) — present.
- PDF viewer neutral background (`#e9edf2`, no more `#30343b`) — present.
- KB/MB size formatting — present.

Nothing was overwritten; all Phase 2 edits are additive on top of these.

## 4. Canonical API Verification

Searched `frontend/` for `api.lilycrest.space`, `mobile-api.lilycrest.space`, `lilycrest-api`, `lilycrest-mobile`, `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_API_URL`, `BASE_URL`, `API_URL`. Confirmed unchanged from Phase 1:

- `frontend/src/config/api.js:1` — `MOBILE_BACKEND_URL = 'https://api.lilycrest.space'` (hardcoded runtime fallback).
- `frontend/src/config/api.js:4` — `ROLLBACK_BACKEND_URL = 'https://mobile-api.lilycrest.space'`, explicitly documented as "not used by any runtime resolver."
- `eas.json` (all 4 build profiles) and `.env.example` set `EXPO_PUBLIC_BACKEND_URL=https://api.lilycrest.space`.
- `backend/controllers/paymongo.controller.js:15` — `DEFAULT_BACKEND_URL = 'https://api.lilycrest.space'` (used only as a fallback for constructing PayMongo redirect URLs when `BACKEND_URL` env var is unset — unchanged).

No host was switched. No rollback-service code was touched.

## 5. Payment Settlement Audit

Read the entire current `backend/controllers/paymongo.controller.js` fresh (not relying on the Phase 1 summary). Confirmed structure:

- **No separate `payments` collection** — payment evidence is written directly onto the bill document (`bills`/`billing`).
- **Primary settlement path**: `markBillPaid()` resolves the bill by `billing_id` + owner (`buildRealBillLookupFilter`, includes an owner match), then atomically flips it via `findOneAndUpdate` guarded by `status: { $nin: ['paid','settled'] }`.
- **Fallback path**: when billing_id/user_id metadata doesn't resolve any bill, `markBillPaid()` falls back to `paymongoSessionId` (the PayMongo checkout ID) alone.

## 6. Payment Fallback Root Cause

The checkout-ID fallback exists because `paymongoSessionId` is written to exactly one bill by `saveCheckoutRef()`, called only from `createCheckoutSession()` — which requires the authenticated caller to already own the bill it creates a session for (`buildRealBillLookupFilter(billingId, req.user._id, {}, req.user.user_id)`). This makes `paymongoSessionId` a foreign-key-style binding *we* control, established at creation time with ownership already proven — not a looser heuristic than the billing_id/user_id metadata path. It exists because PayMongo's webhook/redirect payloads echo back metadata as free text, which can drift in formatting (ObjectId string vs stored string, legacy vs real collection ID) even when the checkout session unambiguously belongs to one bill.

**What was NOT previously true**: the code trusted `db.collection('bills').findOne({ paymongoSessionId })` — a single match — without checking whether more than one document could ever share that session ID. If that ever happened (e.g. a future bug in the reuse/claim logic, or manual DB edits), the old code would silently settle whichever document Mongo happened to return first.

**Verdict: HARDENED.** See §7.

## 7. Payment Hardening Changes

`backend/controllers/paymongo.controller.js`:

1. **Ambiguous checkout-ID fail-closed** — both the `bills` and legacy `billing` checkout-ID fallback lookups now use `.find(...).limit(2).toArray()` instead of `.findOne()`. If more than one document matches the same `paymongoSessionId`/`paymongo_checkout_id`, settlement is refused entirely and logged (`REFUSING to settle`), rather than picking an arbitrary match. Proven by test: *"a checkout ID that ambiguously matches more than one bill fails closed."*
2. **Amount validation** — `markRealBillPaidAtomic()`/`markLegacyBillPaidAtomic()` now accept `paidAmountCentavos` (from PayMongo's settled Payment resource, the authoritative "what did the tenant actually pay" figure) and compare it against the bill's current expected amount *before* ever writing `status: 'paid'`. If the settled amount is short, the bill is **not** flipped to paid and the balance is **not** zeroed — payment evidence (date/method/reference/underpaid amount) is recorded for audit, and a warning is logged for manual review. Proven by tests: underpaid does not settle; full/overpayment settles normally.
3. **Owner re-derivation, not trust** — the checkout-ID fallback path already re-derives the bill's owner from the bill document itself (`resolveRealBillOwnerUserId`), never from the possibly-mismatched webhook metadata. Verified unchanged and correct.

No new payments-ledger collection was introduced — see §32C / §43 discussion below for why the current embedded-payment model, once hardened this way, is deterministic enough without one.

## 8. Idempotency Validation

Existing atomic `$nin: ['paid','settled']` guards were preserved unchanged. Added explicit regression tests:
- Duplicate webhook for an already-settled bill → `alreadyPaid: true`, no field is overwritten (payment date unchanged).
- Two concurrent settlement calls (`Promise.all`) for the same bill → exactly one performs the actual settlement.

Both pass.

## 9. Payment Amount Validation

Implemented as described in §7.2. The authoritative expected amount is the bill's own `remainingAmount ?? totalAmount ?? grossAmount` (real) / `remaining_amount ?? total ?? amount` (legacy) at settlement time — read fresh, not the (possibly stale) amount the checkout session was originally created for. This codebase has **no partial-payment settlement state machine** — `partially_paid` exists only as an admin-settable display value (`ALLOWED_BILL_STATUSES`), never auto-derived. Per the non-negotiable rule not to invent one, an underpaid settlement **fails closed**: it is recorded but not called "paid."

## 10. Payment Ownership / IDOR Validation

- `fetchUserBills(db, req.user, { billingId })` — used by every tenant-facing billing read, including the new receipt endpoint — already scopes every query to `buildBillingOwnerFilters(user)` (matches on `user_id`/`userId`/`tenantId` in every field-naming variant). A billingId belonging to another tenant simply returns no rows → 404, identical to "bill does not exist." No existence-leak.
- Added `paymongoSettlementSecurity.test.js`: wrong `billing_id` in metadata → no settlement; wrong `user_id` (cross-tenant) in metadata → Tenant A's bill is not touched.
- Added `billingReceiptEndpoint.test.js`: Tenant B requesting Tenant A's receipt → 404 (not 403, so existence isn't distinguishable either).

## 11. Billing Statement Architecture

Unchanged in shape: `GET /api/billing/:billingId/pdf` → `downloadBillPdf()` → `buildBrandedPdf()`. Still contains charges, billing period, due date, utility breakdown (if available). Paid-aware wording from Phase 1 preserved (`TOTAL PAID` vs `TOTAL AMOUNT DUE`, `BILLING STATEMENT - PAID` docType, a `Remaining Balance` row).

## 12. Payment Receipt Architecture

**Decision: receipt data IS sufficient — a real, distinct receipt was implemented**, not a rename of the statement.

New route: `GET /api/billing/:billingId/receipt` → `downloadBillReceiptPdf()` (new function in `billing.controller.js`), reusing the same authenticated/owner-scoped bill lookup as the statement endpoint. Searched first for any existing receipt/document route before adding a new one — none exists (confirmed in Phase 1 and reconfirmed: no `receipt` route anywhere in `backend/routes/`).

## 13. Receipt Endpoint / Validation

`downloadBillReceiptPdf()`:
1. Fetches the bill via the same owner-scoped `fetchUserBills()` — cross-tenant requests get 404, same as every other billing route.
2. If the bill has no confirmed payment evidence (`isPaidBill(bill)` false) → **404** `"No payment receipt is available for this bill yet."` — never a fabricated receipt for an unpaid bill.
3. Malformed/nonexistent billing IDs → 404 (proven by test; `fetchUserBills`'s ID matching is pure string/guarded-ObjectId comparison, never an unguarded `new ObjectId()` — no CastError path exists here).

## 14. PDF Generation Validation

Receipt content (built with the same `buildBrandedPdf()` generic template, different `docType`/fields than the statement — **not** a copy):

```
docType: PAYMENT RECEIPT
Receipt No.   RCPT-<billing_id>   (stable, deterministic — no fabricated receipt number)
Bill ID       <billing_id>
Tenant        <name>
Billing Period
Payment Date
Payment Method
Reference No.
Amount Paid
Applied to Bill
Remaining Balance   PHP 0.00
Status        PAID
```

No charges table, no utility breakdown, no "TOTAL DUE" bar, no payment instructions — verified by test (`receiptText` does not contain `TOTAL AMOUNT DUE` or `/Please pay/i`). Validated with `pdf-lib`: loads successfully, exactly one page, non-empty.

## 15. Unknown Bill Field Provenance

Re-investigated exhaustively beyond the Phase 1 pass: searched **every local and remote branch** (`git log --all -S"<field>"`), the **stash** (`stash@{0}`), and all **8 dangling/unreachable commits** (`git fsck --unreachable`) for each field name. Zero matches, everywhere, for every field.

| Field | Current reader | Current writer | Earliest git appearance | Migration/script source | Authoritative? | Safe to ignore? |
|---|---|---|---|---|---|---|
| `publicationState` | none | none | never (0 hits, all branches/stash/dangling) | none found | NO | YES |
| `paymentState` | none (a same-named local *variable* exists in `paymongo.controller.js` history, unrelated to this document field) | none | never | none found | NO | YES |
| `dueState` | none | none | never | none found | NO | YES |
| `utilityDispatch` | none | none | never | none found | NO | YES |
| `issuedAt` | none | none | never | none found | NO | YES |
| `pdfPath` | none | none | never | none found | NO | YES (see §16) |
| `structuredWorkflowVersion` | none | none | never | none found | NO | YES |
| `pricingSnapshotVersion` | none | none | never | none found | NO | YES |
| `isMilestoneSubInvoice` / `milestoneIndex` | none | none | never | none found | NO | YES |
| `roomBillId` | none | none | never | none found | NO | YES |
| `isFirstCycleBill` | none | none | never | none found | NO | YES |

**Conclusion, unchanged from Phase 1 but now proven exhaustively**: this document's extended schema was never authored anywhere in this repository's git history — not in a merged commit, not in an unmerged branch, not in a stash, not in an orphaned/dangling commit. It was written by something outside this codebase. Current billing logic does not read or depend on any of these fields (confirmed: `mapRealBill()` and every other reader touch only the field names documented in the Phase 1 report). No fix in this phase reads, writes, renames, or backfills any of them, per the non-negotiable rule.

## 16. pdfPath Investigation

Re-confirmed: no code path in the current backend reads `bill.pdfPath`. A direct HTTPS request to the URL it implies (`/uploads/bills/<id>.pdf` on `api.lilycrest.space`) returns **404** — nothing serves it. `server.js` only serves `/admin` as a static directory; there is no static route for `uploads/`.

**Classification: NON-AUTHORITATIVE STALE FIELD.** It does not block the current PDF endpoint (which generates the statement dynamically from `fetchUserBills()`, never touching `pdfPath`). No fake file was created; the field was left untouched in the database.

## 17. Utility Calculation Source

Traced every code path that could compute or store `charges.electricity`:
- `createBilling`/`updateBilling` (`billing.controller.js`) accept an **optional, admin-supplied** `electricity_breakdown` array (`[{period_start, period_end, reading_from, reading_to, consumption, rate, segment_total, active_tenants, share_per_tenant}]`) — if an admin manually types/pastes this in, it is stored as-is and rendered correctly by both the statement PDF and the mobile breakdown UI.
- There is **no automated meter-reading/consumption calculator** anywhere in the backend (`services/`, `controllers/`, `domain/` — no `utility*` calculation service exists).
- `enrichRealBillsWithUtilityBreakdowns()` reads from `db.collection('utilityperiods')` — a collection **nothing in the current codebase ever writes to** (confirmed again this phase). This is a half-built, disconnected feature, not an active pipeline.

**Classification: B. MANUAL FINAL AMOUNT ONLY** for the bill actually examined (₱9,088, no `electricity_breakdown` present). The system as a whole supports classification A *only if an admin manually populates the optional breakdown field* — there is no calculator generating it automatically. Evidence is unambiguous: zero calculation service exists, and the one automated-enrichment code path reads from a collection with zero writers.

## 18. Utility Breakdown Data Model

Existing (already correct, from Phase 1): `hasUsableElectricityBreakdown()` requires occupants, both dates, both readings, rate, and share before rendering a breakdown; otherwise "Breakdown unavailable." is shown — never fabricated. No schema change was needed or made; the admin-populatable field already exists and already works when used.

## 19. Historical Breakdown Handling

Unchanged and correct: a historical bill with no `electricity_breakdown` shows the honest fallback, computed from that bill's own stored fields only — never derived from current room/occupant state. No code anywhere recomputes a historical charge from live data.

## 20. Future Bill Breakdown Handling

No new structured-snapshot pipeline was built. The admin-facing `electricity_breakdown` field already accepts structured data per bill at creation/update time — the gap is a **product/process gap** (admins aren't consistently entering it), not a **code gap**. Building an automated meter-reading capture + calculation service would be a genuine new feature (UI, workflow, possibly hardware/reading-entry integration) — out of proportion for this pass, per the explicit instruction not to jeopardize deployment with an unbounded rewrite. Recommended as a separate, future product decision.

## 21. Billing State Single Source of Truth

Re-verified this phase: `billing-history.jsx` and `bill-details.jsx` both import `getUtilityReleaseSchedule`/`isBillOutstanding`/`getBillPaymentDate` from `../src/utils/billingStatus`; neither defines a local copy (`function getDisplaySchedule` / `function isBillOutstanding` — both absent from source, proven by test). No new duplicated business logic was introduced by the statement/receipt button changes — both buttons reuse the exact same `paid`/`isOutstanding` flags the rest of each screen already computes.

## 22. API Contract Changes

- **New, additive**: `GET /api/billing/:billingId/receipt`. No existing endpoint's request shape changed.
- **Behavior change, same shape**: `GET /api/billing/:billingId` (and every endpoint built on `fetchUserBills`) now returns non-null `utility_deadlines.<utility>.billReleaseDate/finalDueDate` for bills that have a `billingCycleStart`/`dueDate`, where it previously always returned `null` for these — this was the Phase 1 fix, reconfirmed intact. Field names and types are unchanged; only previously-always-null values are now populated correctly. No frontend field was added/removed to accommodate this — the existing frontend fields (`status`, `remaining_amount`, `utility_deadlines`, `payment_date`, etc.) were already sufficient once correctly populated. No further API normalization was performed, consistent with "do not add redundant fields unless needed."

## 23. Files Changed

| File | Purpose |
|---|---|
| `backend/controllers/paymongo.controller.js` | Payment settlement hardening: ambiguous checkout-ID fail-closed, amount validation before settling |
| `backend/controllers/billing.controller.js` | New `downloadBillReceiptPdf()` — distinct Payment Receipt PDF endpoint |
| `backend/routes/billing.routes.js` | New route `GET /:billingId/receipt` |
| `frontend/app/billing-history.jsx` | "View Statement" (always) + "View Receipt" (paid only) buttons; unused import cleanup |
| `frontend/app/bill-details.jsx` | "View Statement" (always) + "View Receipt" (paid only) buttons |
| `frontend/src/services/documentManager.js` | New `documentUrl` mapping for `kind: 'bill-receipt'` |
| `backend/tests/paymongoSettlementSecurity.test.js` | New — 10 tests: identity, ownership, amount validation, ambiguous-fallback, idempotency, concurrency |
| `backend/tests/billingReceiptEndpoint.test.js` | New — 6 tests: paid/unpaid/nonexistent/malformed-ID/IDOR/content-separation |
| `frontend/src/tests/billingStatusConsistency.test.js` | Updated — Phase 1 "no fake receipt label" assertion replaced with "Payment Receipt only ever pairs with kind: bill-receipt" |
| `frontend/src/tests/billingStatementReceiptButtons.test.js` | New — 6 tests: button gating, distinct URLs |

## 24. Backend Test Results

```
node --test tests/*.test.js
# tests 350
# pass 350
# fail 0
```

(334 pre-existing + 16 new: 10 settlement-security + 6 receipt-endpoint.)

## 25. Frontend Test Results

```
npx jest
Test Suites: 37 passed, 37 total
Tests:       217 passed, 217 total
```

(211 pre-existing + 6 new; 1 updated.) `npx eslint` on every changed file: 0 errors, 0 warnings (2 unused-import warnings found and fixed during this phase).

No `typecheck` script exists in either package.json; none was skipped, none was fabricated.

## 26. Security Regression Results

Included in §24's 350: cross-bill settlement prevention, cross-tenant settlement prevention, ambiguous-checkout-ID fail-closed, underpaid-settlement fail-closed, duplicate-webhook idempotency, concurrent-settlement idempotency, receipt IDOR (Tenant B cannot fetch Tenant A's receipt), malformed billing ID safety (no 500/CastError).

## 27. Data Integrity Regression Results

Included in §24's 350: Phase 1's `mapRealBill` utility-deadline reconciliation tests (4) still pass; new receipt-content tests confirm no statement-only wording appears in a receipt.

## 28. Web Regression Impact

No web frontend exists in this repository to test directly. Assessed by contract:
- New `/receipt` route is purely additive — cannot break an existing web consumer.
- The `utility_deadlines` population change (Phase 1, reconfirmed) only fills in previously-`null` values with the correct types already documented in the response shape — if a web client has the same "always null" assumption baked in, this fix is a strict improvement there too, not a regression.
- Settlement hardening changes internal write behavior only for the rare underpaid/ambiguous cases; the response shape gained one additive field (`underpaid`, default `false`) and no existing field changed type or meaning.

No backend route, response field, or webhook contract was removed or renamed.

## 29. Remaining P0 Issues

None identified.

## 30. Remaining P1 Issues

None identified. (The Phase 1 contradiction, the receipt/statement conflation, and the unhardened payment fallback — the three issues with genuine P1 severity — are all resolved and tested in this phase.)

## 31. Remaining P2 Issues

1. **Utility breakdown is admin-populated only, not automated.** Historical bills without it correctly show an honest fallback. Building an automated meter-reading/consumption calculator is a genuine new feature, not a bug — recommended as a separate product decision (§20).
2. **Unknown bill-schema fields on at least one live document** (`publicationState`, `utilityDispatch`, `pdfPath`, etc.) — confirmed non-authoritative and safely ignored by all current code, but their true origin is still unknown. Recommend asking whoever manages the database/backfills directly; this cannot be resolved from the codebase alone.
3. **No independent receipt-number sequence** — the new receipt uses a stable, deterministic `RCPT-<billing_id>` identifier rather than a fabricated sequential number. If LilyCrest wants a true sequential receipt numbering scheme, that's a small, separate, low-risk addition once the business wants it.

None of these block controlled deployment.

## 32. Deployment Requirements

**A. Unknown fields:** NON-AUTHORITATIVE / NON-BLOCKING — exhaustively traced (all branches, stash, dangling commits), confirmed unread/unwritten by any current code, left untouched in the database.

**B. Utility breakdown:** HISTORICAL DATA LIMITATION / NON-BLOCKING for existing bills; REQUIRES PRODUCT DECISION for whether to build an automated calculator going forward. The admin-manual path already works today.

**C. Payment fallback:** HARDENED. Amount validation, ambiguous-match fail-closed, and idempotency are now proven by 16 new regression tests alongside the existing atomic-settlement guards. The current embedded-payment-on-bill-document model is deterministic once these guards are in place — see §43 reasoning: a dedicated payments ledger remains a *good future architecture* (would give clean per-payment audit history and multi-payment support) but is not required to make settlement safe today, since every settlement path now has proof of exact-bill identity, exact-tenant ownership, and expected-amount before it ever writes `status: 'paid'`.

## 33. Render Deployment Decision

**Canonical backend changed: YES.** Target: `https://api.lilycrest.space`. **NOT DEPLOYED — stopping here per instructions**, awaiting explicit approval.

## 34. APK Build Decision

**Mobile frontend changed: YES.** A new deployment-test APK will be needed to ship the Statement/Receipt button changes and the (already Phase 1) PDF viewer fixes. **NOT BUILT — stopping here.**

## 35. Final Verdict

**READY WITH NON-BLOCKING P2 ITEMS**

---

## 49. Deployment Summary

```
Canonical backend changed:                YES
Mobile frontend changed:                  YES
Database/schema changed:                  NO
Production data changed:                  NO
Canonical Render deployment required:     YES — target https://api.lilycrest.space (NOT deployed)
Rollback Render deployment required:      NO
New APK eventually required:              YES (NOT built)
```

## 50. Git Safety

```
git status --short
 M ../.claude/settings.local.json                 (pre-existing, unrelated to this work, not touched)
 M backend/controllers/billing.controller.js       (expected — new receipt endpoint)
 M backend/controllers/paymongo.controller.js       (expected — settlement hardening)
 M backend/routes/billing.routes.js                 (expected — new route)
 M frontend/app/bill-details.jsx                    (expected — statement/receipt buttons)
 M frontend/app/billing-history.jsx                 (expected — statement/receipt buttons)
 M frontend/app/document-viewer.jsx                 (Phase 1, reconfirmed intact)
 M frontend/src/services/documentManager.js         (expected — receipt URL mapping)
 M frontend/src/utils/billingStatus.js              (Phase 1, reconfirmed intact)
?? backend/tests/billingReceiptEndpoint.test.js      (new test file)
?? backend/tests/billingUtilityReleaseConsistency.test.js  (Phase 1, reconfirmed present)
?? backend/tests/paymongoSettlementSecurity.test.js  (new test file)
?? docs/mobile/                                      (this report; docs/mobile/ pre-exists with an
                                                        unrelated MOBILE_DEPLOYMENT_READINESS_AUDIT.md
                                                        from other work — not touched or overwritten)
?? frontend/src/tests/billingStatementReceiptButtons.test.js  (new test file)
?? frontend/src/tests/billingStatusConsistency.test.js         (Phase 1, reconfirmed present)
?? ../phase15c-health-deploy/                         (pre-existing sibling directory, unrelated, outside this repo's normal tree)
```

Every change traces to one of: Phase 1 (reconfirmed, untouched), or a Phase 2 objective explicitly requested above. Nothing unexpected. No commit was made. No push was made. No Render deployment was triggered.

---

**Stopping here per instructions, awaiting explicit production deployment approval.**
