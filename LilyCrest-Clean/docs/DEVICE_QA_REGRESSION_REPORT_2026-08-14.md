# LilyCrest Mobile — Device QA Regression Report

**Date:** 2026-08-14
**Scope:** Profile Branch, Contract PDF presentation, Survey safe fallback states
**Supersedes:** the prior "DEVICE QA PASSED WITH NON-BLOCKING FOLLOW-UP" verdict

> Note on provenance: no document with that exact prior verdict text exists in this
> repository (searched for it directly). This report is written as the authoritative
> update Phase 10 calls for, incorporating the new authenticated-device findings
> against the current source, and should replace that verdict wherever it is held
> (e.g. release notes, a QA tracker, or a doc outside this repo).

---

## 1. Executive Verdict

**FIXED LOCALLY — DEVICE REBUILD/RETEST REQUIRED**

All three regressions have a confirmed, code-evidenced root cause, a minimal scoped
fix has been applied, and the full frontend (125/125) and backend (232/232) test
suites pass, including new regression tests for each fix. None of the fixes have
been rebuilt into an APK or retested on a physical device — that is the next step.

**Observation period: NO.** Do not resume the observation window and do not
freeze/retire `mobile-api.lilycrest.space` until the backend change ships and an
authenticated on-device retest confirms all three.

---

## 2. Authentication (carried forward)

Unchanged from the prior report: the exact APK was installed, the Google native
flow reached the canonical backend correctly, rejection of an unregistered Google
account was expected, and network communication was functioning. Authenticated
tenant access subsequently became available and is what surfaced the three
regressions below — this is no longer a "missing credentials" limitation.

---

## 3. Regression Investigation

### 3.1 Profile Branch missing (Dashboard Branch renders correctly)

| | |
|---|---|
| **Observed** | Home tab's Location Card shows the tenant's branch; Profile tab's "Branch Information" section shows "Branch location is not available yet." in the same session. |
| **Expected** | Profile shows the same branch as Home, since both read `user.branch` from the same `AuthContext`. |
| **Root cause** | Both screens render `user?.branch` from the identical shared `AuthContext` state — there are not two branch resolvers, confirming the finding's hypothesis. `backend/services/branchLocation.service.js:resolveTenantBranch` can legitimately fail to resolve a branch for edge-case data states (ambiguous or missing linked stay/reservation/room records) and `buildTenantProfile` (`backend/controllers/user.controller.js:177-183`) silently degrades that to `branch: null` rather than failing the request. Profile's `fetchProfile()` re-fetches `/users/me` on every screen focus and merged the result into context via `updateUser()`, a naive `{...prev, ...data}` spread. If that later fetch landed a transient `branch: null` (network hiccup mid-resolution, or a genuinely ambiguous DB state at that instant), it silently overwrote the good branch value **for the whole app**, not just Profile — Dashboard would only still look correct if it hadn't re-rendered/re-fetched since. Session hydration and `checkAuth()` had the identical exposure via a plain `setUser(response.data)` replace. |
| **Fix** | `frontend/src/context/AuthContext.js`: added `preserveKnownBranch(prevUser, nextUser)` — if a fresh `/users/me`-shaped payload has `branch: null`/`undefined` but the current session already has a non-null branch, keep the known-good value instead of regressing it. Applied at all three risk points: `updateUser()`, the session-hydration effect, and `checkAuth()`. Fresh logins/registrations/Google sign-in are unaffected (no previous branch to protect, and a new identity must never inherit a prior account's branch). No new branch-resolution logic was added — this only prevents a transient resolver failure from clobbering an already-established value, per the instruction not to duplicate Dashboard's logic. |
| **Tests** | `frontend/src/tests/authContextBranchPersistence.test.js` (new, 3 tests): `updateUser` does not regress a known branch on a transient null; `updateUser` still applies a genuinely new branch (not permanently sticky); `checkAuth()` does not regress a known branch. |
| **Deployment impact** | Frontend-only. Requires an EAS rebuild + device reinstall to take effect (JS-only change, so an OTA/EAS Update to the existing build channel is sufficient if that pipeline is in use — no native module changes). |

### 3.2 Contract screen not showing the expected PDF

| | |
|---|---|
| **Observed** | Contract entry point is reachable but does not present the tenant's actual canonical Contract PDF. |
| **Expected** | Deterministic lifecycle-driven UI: loading → error+retry → no-contract empty state → summary-with-"still being prepared" → "Open Contract PDF" (prepared or final, final preferred) → real PDF in the viewer. |
| **Root cause** | The **frontend lifecycle/presentation code was already correct** and did not need to change: `contract-viewer.jsx` → `useTenantContract()` (`GET /api/m/contracts/current`) → `contractPresentation.js` (`buildContractSummary`, `preferredContractDocument`) → `document-viewer.jsx` with `kind=contract-prepared`/`contract-final` → `documentManager.js` → `GET /api/m/contracts/:id/documents/prepared`/`final`. All Contract entry points (Profile, `documents.jsx`, `my-documents.jsx`) route through the same `useTenantContract()` single source of truth and the same `contract.id` — no fallback to `generatedContracts` exists in this path. The actual defect is server-side, in the bridge that relays these requests to Capstone-Website's authoritative Contract API: `backend/routes/contracts.routes.js` resolved its upstream target from `process.env.BACKEND_URL`. That env var is already used everywhere else in this codebase (`paymongo.controller.js`, `auth.controller.js`) to mean **this server's own public URL**, for building callback/redirect links back to itself — and is documented/configured that way (`backend/.env.example: BACKEND_URL=https://api.lilycrest.space`, this server's own canonical host post-migration). Because the Contract bridge reused the same variable to mean "the separate upstream Capstone-Website host," a correctly-configured deployment (`BACKEND_URL` set to this server's own URL, as every other feature requires) caused `/api/m/contracts/*` to proxy back to itself instead of to Capstone-Website — never returning the tenant's real Contract data. |
| **Fix** | `backend/routes/contracts.routes.js`: introduced a dedicated `CONTRACT_UPSTREAM_URL` env var, fully decoupled from `BACKEND_URL`. `resolveContractUpstreamBase()` no longer has a default — an unconfigured value now fails closed with `502 { detail: "Contract service is not configured..." }` instead of silently guessing (guessing wrong would look identical to this bug). Updated `backend/.env.example` with a `CONTRACT_UPSTREAM_URL` entry and an explicit warning not to reuse `BACKEND_URL`. Contract lifecycle/presentation logic was **not** touched, per the instruction to only change it if runtime evidence proved it wrong — it didn't. |
| **Tests** | `backend/tests/contractsBridge.test.js`: replaced the stale "falls back to `https://api.lilycrest.space`" expectation with one proving `BACKEND_URL` no longer leaks into the Contract upstream target; added a new test proving `proxyJson` fails closed (502, upstream never called) when `CONTRACT_UPSTREAM_URL` is unset even though `BACKEND_URL` is set. All other existing bridge tests (draft contract relay, 401/403 passthrough, timeout→504, unreachable→502, PDF streaming, non-JSON error normalization, `?download=1`) still pass against the corrected config. |
| **Deployment impact** | **Backend change + required Render environment variable.** `CONTRACT_UPSTREAM_URL` must be set to Capstone-Website's real host in the live environment before/at deploy time, or every Contract request will 502 (fails safe, but still broken until configured — this is a required manual step, not something this session can supply since the real Capstone-Website hostname isn't recorded anywhere in this repo). |

### 3.3 Survey missing safe fallback states

| | |
|---|---|
| **Observed** | Survey feature lacks an adequate safe fallback in at least one state. |
| **Expected** | Deterministic states — loading, available, empty, draft, submitted, error — with no blank screen, broken card, undefined values, or raw error/JSON. |
| **Root cause** | `surveys.jsx` (the list screen) already implements loading/error+retry/empty/grouped states correctly and needed no change. `survey-form.jsx` (the detail/answer screen) had one real gap: on a `200` response whose body was missing or lacked a usable `survey` object (e.g. `{}`, `null`, or a body missing `surveyId`/`title` — a malformed upstream payload, not a network error), the load effect did not throw, so the `catch` block that sets a safe `message` never ran. `survey` ended up falsy with `message` still `''`, and the `!survey` render branch showed only an empty, message-less `<Text>` — a blank screen, one of the explicitly forbidden states. |
| **Fix** | `frontend/app/survey-form.jsx`: after computing `payloadSurvey`, explicitly validate it (non-null object with `surveyId` and `title`) and throw if invalid, routing it through the existing `catch` → `safeSurveyErrorMessage` fallback ("This survey is not available right now."). No other survey states needed a fix — malformed `questions`/answers already degrade safely via `visibleSurveyQuestions`'s existing `survey?.questions || []` guard, draft restore, and the submitted/read-only state were already correct. |
| **Tests** | `frontend/src/tests/surveyFormSafeFallback.test.js` (new, 3 tests, full component render): shows the safe error message instead of a blank screen for an empty-object body; same for a `null` body; renders normally for a well-formed payload. |
| **Deployment impact** | Frontend-only. Requires an EAS rebuild + device reinstall (or OTA update if the pipeline supports it). |

---

## 4. Files Changed

**Mobile frontend**
- `frontend/src/context/AuthContext.js` — branch-preserving merge (`preserveKnownBranch`) at `updateUser()`, session hydration, and `checkAuth()`.
- `frontend/app/survey-form.jsx` — malformed-payload guard before rendering.
- `frontend/src/tests/authContextBranchPersistence.test.js` — new.
- `frontend/src/tests/surveyFormSafeFallback.test.js` — new.

**Canonical backend** (`backend/`, deployed at `api.lilycrest.space`)
- `backend/routes/contracts.routes.js` — `CONTRACT_UPSTREAM_URL` replaces the `BACKEND_URL` collision; fails closed (502) when unset.
- `backend/.env.example` — documents `CONTRACT_UPSTREAM_URL`.
- `backend/tests/contractsBridge.test.js` — updated + new tests for the corrected env resolution.

**Standalone/rollback backend** (`mobile-api.lilycrest.space`)
- No changes. Not touched, not frozen, not retired, per instructions.

**Contract lifecycle / authoritative data**
- No changes. Verified correct by inspection; the defect was in upstream routing configuration, not lifecycle logic.

---

## 5. Test Results

| Suite | Result |
|---|---|
| Frontend full suite (`npx jest`) | **125/125 passed**, 20/20 suites |
| — incl. `authContextBranchPersistence.test.js` (new) | 3/3 passed |
| — incl. `surveyFormSafeFallback.test.js` (new) | 3/3 passed |
| — incl. `contractPresentation.test.js`, `contractSurveyDisplay.test.js`, `surveyDrafts.test.js`, `surveyMobilePolish.test.js`, `authContextSessionExpiry.test.js`, `authFlowContracts.test.js`, `apiConfig.test.js` | all passed, unaffected |
| Backend full suite (`npm test`, `node --test tests/*.test.js`) | **232/232 passed** |
| — incl. `contractsBridge.test.js` (updated) | 14/14 passed |

---

## 6. Updated Device QA Report Sections

### Profile
- **Dashboard Branch: PASS** — renders correctly (unchanged).
- **Profile Branch: FAIL (root cause found, fix applied, not yet device-retested)** — see §3.1. Root cause: frontend state handling, not the backend response shape.
- **Home Branch: PASS on the same data path as Dashboard** — Home *is* the screen serving the "Dashboard" branch display in this codebase (`frontend/app/(tabs)/home.jsx`'s Location Card); there is no separate Home vs. Dashboard screen to distinguish. Not generalized beyond what was inspected.

### Canonical Live Verification
**AUTHENTICATED LIVE VERIFIED, BUT FRONTEND STATE HANDLING BROKEN.** `GET /api/m/users/me` (`backend/controllers/user.controller.js:buildTenantProfile`) correctly includes `branch` when `resolveTenantBranch` succeeds, and the field survives `sanitizeUserForClient`'s allowlist. The defect was a frontend merge/replace pattern that let a transient resolver failure overwrite a previously-good in-memory value across the whole app, not a backend field omission.

### Contract
**FAIL / REGRESSION FOUND → root cause confirmed → fix applied, not yet device-retested.** See §3.2. The tenant-facing lifecycle UI, document-kind selection, and PDF endpoints were already implemented correctly; the break was a backend proxy routing to itself instead of to Capstone-Website because of an env-var naming collision with an existing, unrelated convention (`BACKEND_URL` = "this server's own URL").

### Survey (new section)
**FAIL — SAFE FALLBACK MISSING → root cause confirmed → fix applied, not yet device-retested.** See §3.3. `surveys.jsx` list states (loading/error+retry/empty/grouped) were already correct; `survey-form.jsx` could render a blank, message-less screen for a malformed-but-200 survey payload. After the fix, that same input renders "This survey is not available right now." instead.

### Remaining Risks
Removed (no longer true): *no registered LilyCrest tenant credentials*.

Added:
- Profile/Contract/Survey fixes are unverified on a physical device — code-level and test-level evidence only.
- `CONTRACT_UPSTREAM_URL` must be manually configured in the live Render environment before the Contract fix takes effect; until then Contract requests fail closed (502) rather than silently misbehaving, but the feature remains broken for tenants.
- The branch-preservation fix mitigates the *symptom* of a transient `resolveTenantBranch` failure; it does not address why resolution can fail for some tenants' underlying stay/reservation data in the first place (out of scope per this task's instruction not to build a new branch resolver).

Retained from the prior report: old installed clients, rollback-service live auth, Render SHA visibility, transient routing observation, dirty-tree technical debt.

---

## 7. Final Go/No-Go

| Question | Answer |
|---|---|
| Does Dashboard/Home show the correct Branch? | Yes |
| Does Profile show the same Branch? | Not yet device-verified; root cause fixed and covered by passing regression tests |
| Does `/api/m/users/me` contain the Branch live? | Yes, when `resolveTenantBranch` succeeds; the response was never the problem |
| Is the Profile issue backend response, frontend state, or rendering? | Frontend state (a naive merge/replace let a transient null overwrite a known-good value) |
| Does Contract Viewer open the actual canonical PDF when available? | Frontend logic: yes, already correct. End-to-end: not yet, pending `CONTRACT_UPSTREAM_URL` deployment configuration |
| Does Draft Contract have a safe no-PDF state? | Yes (pre-existing, verified by inspection and existing tests) |
| Does Contract distinguish no-document from no-Contract from network error? | Yes (pre-existing) |
| Does Survey provide safe loading/empty/error/submitted states? | Yes — list screen pre-existing; detail-screen malformed-payload gap now fixed |
| Is a new build/redeploy required? | Yes — backend redeploy with `CONTRACT_UPSTREAM_URL` configured, and a mobile EAS rebuild (or OTA update) for the AuthContext/survey-form changes |
| Can observation begin? | **No** — pending backend deploy + env var + mobile rebuild + authenticated on-device retest of all three |

---

## 8. Next Release Step

1. **Canonical backend:** deploy `backend/routes/contracts.routes.js` + `.env.example` change, and set `CONTRACT_UPSTREAM_URL` to Capstone-Website's real host in the Render environment for `api.lilycrest.space`. Without that env var, Contract requests will 502 (safe, but still non-functional).
2. **Mobile frontend commit:** `AuthContext.js` and `survey-form.jsx` changes.
3. **EAS rebuild:** required for a native build; if the OTA/EAS Update channel covers this JS-only change, that is a faster path — confirm which pipeline is in use before rebuilding a full APK.
4. **Device reinstall:** install the rebuilt/updated app on the same authenticated tenant device used for this QA pass.
5. **Authenticated regression QA:** re-verify all three findings on-device — Profile Branch alongside Dashboard/Home, Contract PDF opening for the same authoritative `contractId`, and Survey's malformed/empty-state handling — before resuming the observation period or considering `mobile-api.lilycrest.space` for freeze/retirement.
