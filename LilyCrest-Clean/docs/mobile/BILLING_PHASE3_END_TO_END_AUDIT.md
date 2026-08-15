# LilyCrest Billing Phase 3 — End-to-End Audit

Continues from `docs/mobile/BILLING_PHASE2_PREDEPLOYMENT_REPORT.md` (Phase 2 complete, verified intact, not redone). Scope: tenant-mobile billing lifecycle only. No deployment performed.

## 1. Executive Verdict

**READY WITH NON-BLOCKING ITEMS**

Tracing the bill from creation through payment, receipt, dashboard, and notifications found the single-source-of-truth guarantee holds everywhere it matters, with one real gap: `payment.jsx` (a live "Try Again" screen reached after a failed/cancelled payment) carried its own weaker, uncaught local copy of the paid/outstanding check — the exact class of bug this whole audit exists to eliminate. It has been fixed and is now proven by tests. No other screen, endpoint, or notification path was found deriving payment truth independently in a way that could produce a live contradiction. Two structural duplications remain (documented, not fixed) because they don't currently cause a contradiction and fixing them would be a larger refactor than this phase's risk budget allows — flagged as non-blocking.

## 2. Actual Billing Architecture

```
Admin creates/updates bill (createBilling/updateBilling, admin-only)
        ↓ writes bills{status, charges, dueDate, billingCycleStart, remainingAmount}
Bill availability = owner-scoped read (fetchUserBills, every tenant route)
        ↓
Tenant mobile bill retrieval — ALL of these call fetchUserBills() -> mapRealBill():
  GET /billing/me, /me/latest, /history, /history/paid, /:id, /:id/pdf, /:id/receipt
  GET /dashboard/me (delegates to the same fetchUserBills)
        ↓
Rent + utility + penalty presentation — bill.rent / bill.electricity / bill.water /
  bill.penalties, and bill.utility_deadlines (Phase 1 fix) — server-computed only
        ↓
Payment checkout creation — POST /paymongo/checkout
  amount = bill.remaining_amount (server-side only, proven — see §8)
        ↓
PayMongo payment (tenant pays via GCash/card/etc., fixed line-item amount)
        ↓
Webhook / redirect / poll → reconcileCheckoutSessionPayment() (Phase 2 hardened)
        ↓
Authoritative database update — atomic, amount-validated, ownership re-derived (Phase 2)
        ↓
Mobile refresh — emitBillingRefresh()/subscribeBillingRefresh() pub-sub (no cached
  "paid" flag is ever pushed client-side; every surface refetches from the server)
        ↓
Dashboard state (dashboard.controller.js, delegates to fetchUserBills — no independent logic)
        ↓
Billing History / Bill Details (billingStatus.js shared derivation)
        ↓
Statement PDF (GET /:id/pdf) / Payment Receipt PDF (GET /:id/receipt, Phase 2)
        ↓
Notifications — pure historical event log (notification_id/read/title/body/data);
  never consulted as a live payment-status source (see §5)
```

## 3. Authoritative State Model

Bill statuses actually supported (`ALLOWED_BILL_STATUSES`, `backend/controllers/billing.controller.js:11-13`): `unpaid, overdue, pending_verification, partially_paid, paid, rejected, cancelled` (+ legacy aliases normalized by `normalizeBillStatus`).

**Effective status is computed, not merely stored.** `getEffectiveBillStatus(bill)` (already existing, re-verified this phase): if the literal stored `status` is already in `PAID_BILL_STATUSES` (`paid`/`settled`), use it; otherwise, if `hasConfirmedPaymentEvidence(bill)` is true (a `paymongo_payment_id`/`transaction_id`, or a payment date plus reference/method), report `paid` anyway. This is the mechanism that makes the "stale raw status" class of bug structurally impossible for any reader — every tenant-facing route reads the *effective*, not the *raw*, status (`mapRealBill()` sets `status: effectiveStatus || b.status`). Proven this phase by a new test: a bill with raw `status: 'overdue'` but confirmed payment evidence maps to effective `'paid'` (§9).

Transitions actually found in code:

| Transition | Endpoint/trigger | Fields changed | Validation |
|---|---|---|---|
| (none) → `unpaid` | `POST /billing` (admin) | full bill document created | admin-only, amount/date validation |
| `unpaid`/`overdue` → checkout created | `POST /paymongo/checkout` | `paymongoSessionId`, `paymongoCheckoutUrl`, `paymongoReference` | owner-scoped, rejects if already `paid`/`settled`, rejects non-payable |
| checkout created → `pending_verification` | `POST /:id/payment-proof` (manual GCash-proof upload path) | `proof`/`paymentProof`, `status: 'pending_verification'` | owner-scoped, rejects if already paid or already under review |
| checkout created/`pending_verification` → `paid` | webhook/redirect/poll → `markRealBillPaidAtomic`/`markLegacyBillPaidAtomic` | `status`, `remainingAmount: 0`, `paymentDate`, `paymongoPaymentId`, etc. | atomic `$nin:['paid','settled']` guard, amount-validated (Phase 2) |
| any non-paid → `overdue` (display only) | none found — no code path writes `status: 'overdue'` transactionally; `overdue` appears to be admin-set or derived at display time via `currentBillTiming()`/`billStatusLabel()` | — | server-computed timing only, never client-computed |
| `paid`/`pending_verification`/etc. → `paid` again | N/A | idempotent no-op (`alreadyPaid: true`), proven by Phase 2 tests | — |

**No impossible transition was found writable from the tenant mobile surface.** `paid → unpaid`, `paid → overdue`, `paid → checkout available` are all blocked: `createCheckoutSession()` rejects with 400 before any PayMongo call if `status` is `paid`/`settled` (re-verified this phase, unchanged from Phase 2); nothing in the codebase writes `unpaid`/`overdue` over an existing `paid` bill from a tenant-reachable route (only `updateBilling`, admin-only, can do that, and is out of this audit's scope by design).

## 4. State Consumer Matrix

| Surface | Endpoint | Status Source | Risk |
|---|---|---|---|
| Billing History (`billing-history.jsx`) | `GET /billing/history`, `/history/paid`, `/me/latest` | `billingStatus.js` (`isPaidBillStatus`, `isBillOutstanding`, `getUtilityReleaseSchedule`) over `mapRealBill()` output | None found |
| Bill Details (`bill-details.jsx`) | `GET /billing/:id` | Same shared `billingStatus.js` (Phase 1 fix) | None found |
| Dashboard/Home (`(tabs)/home.jsx`) | `GET /dashboard/me`, `GET /billing/history` | `billingStatus.js` (`isBillOutstanding`, `getBillOwedAmount`) + `billingInsights.js` (separate insight-panel derivation, see §5) | Non-blocking (documented duplication, no live contradiction) |
| Payment / "Try Again" (`payment.jsx`) | `GET /billing/:id`, `POST /paymongo/checkout` | **Was**: local uncaught `isBillOutstanding` copy. **Now**: imports from `billingStatus.js` (fixed this phase) | **Fixed** |
| Payment success (`payment-success.jsx`) | `GET /paymongo/checkout/:id/status` (polled) | Server-reported `status` string only, no client derivation | None found |
| Billing Statement PDF | `GET /billing/:id/pdf` | `isPaidBill(bill)` over `mapRealBill()` output (Phase 1/2) | None found |
| Payment Receipt PDF | `GET /billing/:id/receipt` | `isPaidBill(bill)`, 404 if not paid (Phase 2) | None found |
| Notifications (`AuthContext.js`) | `GET /notifications` | Pure event log (`read` flag only); never re-derives current bill state | None found — see §5 |
| Dashboard controller (backend) | `dashboard.controller.js` | Delegates 100% to `fetchUserBills()` from `billing.controller.js` — no local status logic (proven by source-inspection test, §9) | None found |

## 5. Inconsistencies Found

### FIXED — `payment.jsx` local `isBillOutstanding` duplicate

- **Severity**: P1 (real, live-reachable duplication of the exact bug class this audit targets)
- **Root cause**: `frontend/app/payment.jsx:40-43` defined its own `isBillOutstanding(bill)` checking only `status !== 'paid' && status !== 'settled'` — the same narrower definition `bill-details.jsx` had *before* the Phase 1 fix, missing the `cancelled/rejected/void/refunded/duplicate/archived/verification` exclusions that `billingStatus.js`'s canonical `isBillOutstanding` already has.
- **Affected files**: `frontend/app/payment.jsx`.
- **Reproduction**: `payment-success.jsx:168` routes here (`router.replace({ pathname: '/payment', ... })`) as the "Try Again" action after a failed/cancelled payment — a live, reachable path, not dead code. A bill in one of the excluded-but-not-`paid` states (e.g. `void`, `cancelled`) could have shown the wrong payable/paid branch here versus what Bill Details would show for the same bill.
- **Fix**: removed the local function; `payment.jsx` now imports `isBillOutstanding` from `../src/utils/billingStatus`.
- **Tests**: `frontend/src/tests/billingStatusConsistency.test.js` — new test asserts `payment.jsx` imports from the shared module and has no local redefinition; a second, broader test scans every file under `app/` for any `function isBillOutstanding(` redefinition, so this class of regression can't be reintroduced by any future screen without a test failure.

### DOCUMENTED, NOT FIXED — `billingInsights.js`'s own paid/excluded-status sets

- **Severity**: P2 / non-blocking
- **Root cause**: `frontend/src/utils/billingInsights.js:1-2,9-19` defines its own `EXCLUDED_STATUSES`/`PAID_STATUSES`/`isPaidBill`/`getBillPaymentDate`/`getUnpaidAmount` — a third independent copy, used only internally to build the Home screen's insight panel (headline tone, spending trend, payment-health stats).
- **Why not fixed**: verified this copy's `PAID_STATUSES` (`paid`, `settled`) is identical in meaning to `billingStatus.js`'s, so it does not currently produce a contradiction — it computes a different thing (trend/insight text, not a paid/unpaid badge) from the same underlying truth. Consolidating it into `billingStatus.js` would touch insight-generation logic with its own passing test suite (`billingUiPolish.test.js` and others) for a module explicitly out of the "screens must agree" requirement (it never renders a paid/unpaid badge itself). Given the instruction not to refactor unrelated modules or over-abstract, this is flagged rather than merged.
- **Recommendation**: if `billingInsights.js` is touched again for any reason, fold its status helpers into `billingStatus.js` at that time.

### DOCUMENTED, NOT FIXED — legacy `billing` collection checkout lacks the atomic reuse/claim guard

- **Severity**: P2 / non-blocking (dormant in production)
- **Root cause**: `createCheckoutSession()`'s 20-minute reuse window and atomic claim lock (`backend/controllers/paymongo.controller.js`, re-verified this phase) apply only when `source === 'real'` (the canonical `bills` collection). A bill resolved from the legacy `billing` collection skips straight to calling PayMongo on every request, so rapid repeated taps could theoretically mint more than one live session for the same legacy bill.
- **Why not fixed**: the legacy `billing` collection was confirmed empty in production during Phase 1's direct database read (`billing count: 0`, `bills count: 30`). This is a real code gap but currently unreachable with live data. Implementing the same atomic-claim machinery for a dead path adds real complexity/regression surface for zero current benefit, and this phase's instructions explicitly warn against unbounded refactors and against weakening/redesigning what Phase 2 already hardened.
- **Recommendation**: apply the same claim/reuse guard to the legacy path if/when legacy records reappear (e.g. a future migration rollback), or remove the legacy collection code path entirely once its emptiness is confirmed durable.

## 6. Rent / Utility Breakdown Findings

Unchanged from Phase 2, re-verified this phase: **Classification B — manual final-amount entry.** No automated meter-reading/consumption calculator exists anywhere in the codebase. `bill.rent`, `bill.electricity`, `bill.water`, `bill.penalties` are the only reliably-present charge fields; `bill.electricity_breakdown`/`bill.water_breakdown` are optional, admin-populated structures shown only when genuinely present (`hasUsableElectricityBreakdown()`), with an honest "Breakdown unavailable." fallback otherwise. Penalty/overdue timing (`currentBillTiming()`, `days_overdue`) is computed server-side only; confirmed this phase that the frontend (`billing-history.jsx:248-257`, `bill-details.jsx:308-332`) only ever *displays* `bill.penalties`/`currentSummary.timing?.days_overdue` — no client-side penalty formula exists anywhere in `frontend/app`. No fabricated calculation was added.

## 7. Statement / Receipt Verification

Both endpoints re-verified this phase, unchanged from Phase 1/2:
- `GET /billing/:id/pdf` (statement) and `GET /billing/:id/receipt` (receipt) both set `Content-Type: application/pdf`, `Content-Length`, `Content-Disposition` with **distinct filenames** (`{id}.pdf` vs `{id}-receipt.pdf`), and `Cache-Control: no-cache`.
- Both are owner-scoped via the identical `fetchUserBills()` — cross-tenant requests 404 identically for both (proven by Phase 2's `billingReceiptEndpoint.test.js`).
- Mobile-side (`documentManager.js`) validates every downloaded PDF's magic bytes (`JVBERi0` = "%PDF-" prefix) before ever handing it to the viewer, rejects wrong MIME/empty/oversized files, and caches statement vs receipt under distinct cache keys (`kind` is part of `cachedDocumentPath`) — no collision between the two document types for the same bill.
- Receipt content re-confirmed to contain no statement-only wording (`TOTAL AMOUNT DUE`, "Please pay") — tested in Phase 2.
- No empty/corrupt PDF path was found — `buildBrandedPdf()` always produces a minimally valid single-page document even for a bill with no charges (falls back to a "Total Charges" row), and the receipt path is fully gated behind a confirmed-paid check before generation is ever attempted.

## 8. Security Findings

- **IDOR**: re-confirmed — every tenant billing route (`getBillingById`, `downloadBillPdf`, `downloadBillReceiptPdf`, `createCheckoutSession`, `getCheckoutStatus`, `submitPaymentProof`) resolves the bill through `fetchUserBills(db, req.user, ...)` or an equivalent owner-scoped filter (`buildBillingOwnerFilters`/`buildRealBillLookupFilter` with an owner match); a mismatched tenant gets an identical 404, no existence leak. Payment-proof submission (`submitPaymentProof`, re-read this phase) is likewise owner-scoped and rejects if the bill is already paid or already under review.
- **Amount tampering**: re-confirmed at the source level (no `req.body.amount` reference anywhere in `paymongo.controller.js`) and proven behaviorally this phase — a new test injects `amount: 1` into the checkout request body and asserts the created PayMongo session is still built for the bill's real `remaining_amount` in centavos, unaffected by the client-supplied value.
- **Duplicate payment / webhook replay**: unchanged from Phase 2 — atomic `$nin` guard, ambiguous checkout-ID fail-closed, underpaid settlements fail closed, all proven by 10 existing tests, re-run and still passing this phase.
- **Ownership isolation**: a bill created for Tenant A cannot be settled by Tenant B's metadata (Phase 2 test, re-run and passing); a receipt for Tenant A's bill cannot be retrieved by Tenant B (Phase 2 test, re-run and passing).

No new security issue was found in this phase beyond the `payment.jsx` logic-duplication bug, which was a correctness/consistency issue, not an authorization bypass (the backend independently and correctly enforces payability regardless of what the frontend's local check computed).

## 9. Regression Test Results

```
Backend:  node --test tests/*.test.js
# tests 355
# pass 355
# fail 0
```
(350 from Phase 2 + 5 new this phase: 4 in `billingStateConsistency.test.js` + 1 amount-tampering test appended to `paymongoCheckoutIdempotency.test.js`.)

```
Frontend: npx jest
Test Suites: 37 passed, 37 total
Tests:       219 passed, 219 total
```
(217 from Phase 2 + 2 new this phase, both in `billingStatusConsistency.test.js`: the `payment.jsx` shared-import guard, and the repo-wide "no screen redefines isBillOutstanding" guard.)

`npx eslint` on every file touched this phase (`app/payment.jsx`, `src/tests/billingStatusConsistency.test.js`): 0 errors, 0 warnings.

These are the actual, freshly-reproduced totals — not carried over from Phase 2's report.

## 10. Remaining Deployment Blockers

**BLOCKING**: none.

**NON-BLOCKING / POST-DEPLOYMENT POLISH**:
1. `billingInsights.js`'s independent (but currently non-contradictory) status-helper copy — consolidate opportunistically, not urgently (§5).
2. Legacy `billing` collection's checkout path lacks the atomic claim/reuse guard applied to the canonical `bills` collection — dormant given zero legacy records in production, but should be closed if that collection is ever repopulated (§5).
3. Everything carried over as P2 from Phase 2 (utility breakdown is admin-manual-only, unknown bill-schema fields on one live document, no independent receipt-number sequence) remains unchanged and still non-blocking.

## 11. Deployment Recommendation

**Another code-fix phase is not required.** The one real end-to-end inconsistency this phase set out to find (a screen deriving payment truth independently of the shared source) was found, fixed, and is now covered by a regression test broad enough to catch a recurrence in any screen, not just the one that had it.

The next safe operation is:

1. **Render canonical API deployment** to `https://api.lilycrest.space` (backend changed across Phases 2 and 3: settlement hardening, receipt endpoint, utility-deadline fix — all still pending deployment, none deployed yet).
2. → **Production API smoke test**: hit `/api/m/health`, then an authenticated `GET /billing/me`, `GET /billing/:id/receipt` (against a real paid bill) and `POST /paymongo/checkout` (against a real unpaid bill) against the live deployment before trusting it.
3. → **APK build** (frontend changed across Phases 1–3: PDF viewer background/size fixes, statement/receipt button separation, `payment.jsx` fix).
4. → **Physical-device smoke test**: pay a real test bill end-to-end (checkout → PayMongo → webhook/redirect → Billing History → Bill Details → Dashboard → Statement → Receipt) and confirm every surface agrees, plus exercise the `payment.jsx` "Try Again" path specifically since it was the one screen found with drifted logic.

This recommendation is based on the state machine and consumer matrix in §3–4 holding together end-to-end for a single real bill, not merely on the test suite passing.

---

**Nothing was deployed. No commit was pushed. No Render/APK action was taken. Stopping here per instructions.**
