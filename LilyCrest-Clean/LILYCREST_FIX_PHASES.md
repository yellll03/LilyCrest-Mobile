# LilyCrest Fix Phases

## Phase 0 - Backup and Baseline

Objective: Preserve the current system and prove the existing baseline before behavior changes.

Issues included: dirty worktree, ignored `.env` files, generated Android folder state, current passing lint/tests, current Expo doctor failure.

Exact files likely affected: none initially; documentation only. Later: `.gitignore`, tracked build logs if approved.

Dependencies: Must happen before all other phases.

Risk level: Low.

Acceptance criteria:
- Current branch/worktree is backed up or committed as-is by the owner.
- `npm.cmd run lint`, `npm.cmd test -- --runInBand`, backend `node --check`, and `npx expo-doctor` outputs are captured.
- No app behavior changed.

Regression tests: Existing frontend Jest suites; backend syntax check; Expo doctor.

Items that must not be changed yet: Do not regenerate `android/` or create `ios/`; do not run `npm audit fix --force`; do not delete dependencies.

## Phase 1 - Critical Security and Secret Cleanup

Objective: Eliminate credential exposure risk before release work.

Issues included: Firebase config files in Git history; real local backend secrets; session token storage risk; production CORS defaults.

Exact files likely affected:
- `.gitignore`
- `backend/.env.example`
- `frontend/.env.example`
- `frontend/src/services/secureCredentials.js`
- `frontend/src/context/AuthContext.js`
- `frontend/src/services/api.js`
- deployment/EAS/Render secret settings outside repo

Dependencies: Phase 0.

Risk level: High, because auth/storage changes can log users out.

Acceptance criteria:
- Firebase client keys/OAuth clients restricted or rotated if history was shared.
- Backend Firebase Admin, MongoDB, PayMongo, AI, SMTP, ImageKit secrets rotated if workspace was exposed.
- Production has explicit `ALLOW_MOBILE_DEV_CORS=false` unless intentionally required.
- Session token SecureStore migration plan is documented before implementation.

Regression tests:
- Login, OTP, Google login, logout, session restore, password change.
- Push token sync after login/logout.

Items that must not be changed yet: Do not purge Git history until a backup and team coordination exist; do not change auth token storage without a migration/fallback.

## Phase 2 - Existing Build and Runtime Blockers

Objective: Fix current build/config blockers without changing intended behavior.

Issues included: Expo SDK patch mismatch; Android build artifacts/logs; Android release debug signing documentation; malformed/generated native state.

Exact files likely affected:
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/android/build_output.txt`
- `frontend/android/build_command_output.txt`
- possibly `.gitignore`

Dependencies: Phase 0, security decisions from Phase 1 for config files.

Risk level: Medium.

Acceptance criteria:
- `npx expo-doctor` passes or only has documented accepted warnings.
- Lint and Jest still pass.
- No native folders regenerated.

Regression tests:
- `npm.cmd run lint`
- `npm.cmd test -- --runInBand`
- `npx expo-doctor`
- Android dev build smoke test if available.

Items that must not be changed yet: Do not update major dependencies; do not replace Google Sign-In; do not remove dependencies based only on search.

## Phase 3 - Authentication and Session Stability

Objective: Make login/session flows predictable across email, OTP, Google, biometric restore, refresh, and logout.

Issues included: Google-only refresh path; AsyncStorage session token; auto-created Firebase user behavior; inconsistent password requirements; cached session restoration.

Exact files likely affected:
- `frontend/src/context/AuthContext.js`
- `frontend/src/services/api.js`
- `frontend/src/services/secureCredentials.js`
- `frontend/app/login.jsx`
- `frontend/app/otp-verify.jsx`
- `frontend/app/change-password.jsx`
- `backend/controllers/auth.controller.js`
- `backend/routes/auth.routes.js`
- `backend/middleware/auth.js`

Dependencies: Phases 0-2.

Risk level: High.

Acceptance criteria:
- Email/OTP sessions do not break on token refresh.
- Google sessions refresh predictably.
- Logout clears local and backend state.
- Biometric unlock never stores raw passwords and does not restore invalid sessions.

Regression tests:
- Email login -> OTP -> app restart -> `/auth/me`.
- Google login -> app restart -> protected API call.
- 401 handling for email and Google sessions.
- Forgot/reset/change password.

Items that must not be changed yet: Do not remove OTP or auto-create behavior without product approval.

## Phase 4 - API and Backend Contract Consistency

Objective: Make mobile contracts explicit and remove ambiguity between `/api` and `/api/m`.

Issues included: duplicate route mounting; admin/seed methods in mobile service; billing update mismatch; chat/support duplicate flows.

Exact files likely affected:
- `frontend/src/services/api.js`
- `backend/server.js`
- `backend/routes/index.js`
- `backend/routes/*.routes.js`
- `backend/controllers/*.controller.js`
- `docs/MOBILE_API_MATRIX.md`

Dependencies: Phase 3.

Risk level: Medium.

Acceptance criteria:
- Mobile API methods map only to tenant-safe endpoints.
- Admin-only endpoints are not exposed through tenant UI/service wrappers unless explicitly needed.
- Response shapes for dashboard, billing, documents, maintenance, chat, notifications are documented.

Regression tests:
- Authenticated mobile endpoint smoke suite.
- Authorization tests for billing/documents/maintenance ownership.

Items that must not be changed yet: Do not remove `/api` or `/api/m` duplication until live clients are inventoried.

## Phase 5 - Mobile State, Billing, Payment, and Data Correctness

Objective: Stabilize tenant-facing data truth and PayMongo status freshness.

Issues included: billing history/latest/status assumptions; PayMongo redirect status reconciliation; PDF/document downloads; frontend-derived billing labels.

Exact files likely affected:
- `frontend/app/(tabs)/billing.jsx`
- `frontend/app/billing-history.jsx`
- `frontend/app/bill-details.jsx`
- `frontend/app/payment.jsx`
- `frontend/app/payment-success.jsx`
- `frontend/src/services/billingState.js`
- `backend/controllers/billing.controller.js`
- `backend/controllers/paymongo.controller.js`

Dependencies: Phase 4.

Risk level: High.

Acceptance criteria:
- PayMongo checkout, redirect, webhook, and status polling agree.
- Paid/unpaid state comes from backend truth.
- PDFs/downloads require auth and handle missing files gracefully.

Regression tests:
- Unpaid bill checkout.
- Cancel redirect.
- Success redirect with delayed webhook.
- Billing refresh after payment.

Items that must not be changed yet: Do not change payment provider flow or callback scheme until iOS callback test plan exists.

## Phase 6 - Dependency and Expo Compatibility Cleanup

Objective: Align with Expo SDK 54 and remove confirmed-unused dependencies conservatively.

Issues included: Expo doctor patch mismatches; possibly unused frontend dependencies; native-only Google Sign-In/development-build requirements.

Exact files likely affected:
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/app.config.js`
- `frontend/babel.config.js`
- `frontend/metro.config.js`

Dependencies: Phases 0-5.

Risk level: Medium.

Acceptance criteria:
- Expo doctor passes.
- No dependency removed unless source, native config, and runtime checks confirm unused.
- Android app still builds/runs.

Regression tests:
- Lint/Jest.
- Android dev build.
- Smoke test Google, notifications, image/document picker, file download.

Items that must not be changed yet: No major SDK/RN upgrades; no `npm audit fix --force`.

## Phase 7 - Cross-Platform UI and Navigation

Objective: Fix iOS-safe layout, keyboard, navigation, and accessibility issues.

Issues included: bottom safe area gaps, keyboard avoidance, fixed sizes, absolute floating button placement, iOS no-physical-back assumptions.

Exact files likely affected:
- `frontend/app/_layout.jsx`
- `frontend/app/(tabs)/*.jsx`
- `frontend/app/*.jsx`
- `frontend/src/components/AppHeader.js`
- `frontend/src/utils/navigation.js`
- `frontend/src/screens/LilyAssistantScreen.jsx`

Dependencies: Phases 2-4.

Risk level: Medium.

Acceptance criteria:
- iPhone SE, current iPhone, large iPhone, and tablet screenshots have no blocked controls or text overlaps.
- Back actions have fallbacks.
- Keyboard does not cover active inputs.

Regression tests:
- Expo dev-client/device QA.
- Screen-by-screen navigation walkthrough.
- Font scaling and dark mode spot checks.

Items that must not be changed yet: Do not redesign the app; keep visual fixes minimal.

## Phase 8 - iOS Native Configuration

Objective: Add the minimum iOS config needed for development/internal/TestFlight builds.

Issues included: missing bundle ID, `GoogleService-Info.plist`, permission text, notification/APNs config, Google Sign-In iOS setup, payment callback scheme.

Exact files likely affected:
- `frontend/app.config.js`
- `frontend/eas.json`
- iOS Firebase config file outside tracked secrets policy
- EAS credentials outside repo

Dependencies: Phases 1-2 and product decision on bundle ID/scheme.

Risk level: High.

Acceptance criteria:
- `ios.bundleIdentifier` set.
- Apple permission descriptions set for camera, photo library, biometrics, notifications where required.
- Firebase/Google iOS app/client configured.
- EAS iOS development/internal profiles exist.

Regression tests:
- `npx expo config --type public`
- EAS iOS development build.
- Device test for Google, payments, notifications, file/image flows.

Items that must not be changed yet: Do not commit private Apple/Firebase service files unless policy explicitly allows.

## Phase 9 - iOS Build and Device Testing

Objective: Validate iOS behavior on simulator and physical devices.

Issues included: custom URL callbacks, push/APNs, camera/photo picker, document picker, file downloads/sharing, biometrics, keyboard/safe areas.

Exact files likely affected: fixes from testing may touch frontend app/screens/services and `app.config.js`.

Dependencies: Phase 8.

Risk level: High.

Acceptance criteria:
- iOS dev build installs and launches.
- Login, OTP, Google, dashboard, billing, PayMongo, documents, maintenance, assistant, notifications tested.
- Known non-Expo-Go features tested in development build.

Regression tests:
- iPhone SE and current iPhone physical/simulator test matrix.
- Backend authenticated smoke tests.

Items that must not be changed yet: Do not submit to TestFlight until production secrets/callbacks are verified.

## Phase 10 - TestFlight and App Store Readiness

Objective: Prepare App Store metadata, production credentials, release profiles, and compliance.

Issues included: production EAS iOS profile, app icons/splash review, privacy strings, push entitlements, payment/external purchase review concerns, support/privacy docs.

Exact files likely affected:
- `frontend/app.config.js`
- `frontend/eas.json`
- app assets
- App Store Connect metadata outside repo

Dependencies: Phase 9.

Risk level: High.

Acceptance criteria:
- TestFlight build passes review.
- App Store privacy labels match actual data collection.
- Production backend, PayMongo, Firebase, APNs, and email configs are live.

Regression tests:
- Full tenant journey on TestFlight.
- Production-like backend smoke test.
- Crash/log monitoring review.

Items that must not be changed yet: Do not change pricing/payment product behavior without App Store policy review.
