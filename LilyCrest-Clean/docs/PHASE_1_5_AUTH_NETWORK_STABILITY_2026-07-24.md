# Phase 1.5 — Authentication and Network Stability

Date: 2026-07-24 (Asia/Singapore)

## Decision

AUTHENTICATION AND NETWORK STABILITY NOT PASSED

The repository-level fixes and automated checks pass, but a fresh preview APK is not
available, the current live health endpoint has not received the safe-response
deployment, and no physical-device or real password-reset-email test was possible.

## Modified files

- `frontend/src/utils/authStability.js`
- `frontend/src/tests/authStability.test.js`
- `frontend/src/tests/authFlowContracts.test.js`
- `frontend/app/login.jsx`
- `frontend/app/forgot-password.jsx`
- `frontend/src/context/AuthContext.js`
- `frontend/src/services/api.js`
- `frontend/src/services/mobileApiReadiness.js`
- `frontend/src/utils/passwordValidation.js`
- `backend/routes/index.js`

The worktree contained pre-existing uncommitted changes in several of these files.
This phase preserved them and made narrow auth/network changes on top.

## Authentication flow audit

```text
app/login.jsx:handleLogin
  -> AuthContext.loginWithEmail
  -> POST /api/m/auth/login
  -> backend auth.controller.login
  -> Firebase Identity Toolkit accounts:signInWithPassword
  -> tenant lookup + OTP creation/email
  -> app/otp-verify.jsx
  -> AuthContext.verifyLoginOtp
  -> POST /api/m/auth/login/verify-otp
  -> backend session_token + normalized user
  -> SecureStore(session_token) + AsyncStorage(session_user)
  -> authStatus="authenticated"
  -> router.replace("/(tabs)/home")
```

Email/password login is backend-mediated. It does not call the Firebase client SDK
`signInWithEmailAndPassword`; the backend calls Firebase Identity Toolkit's
`accounts:signInWithPassword` REST method, then applies tenant and OTP checks.

Relevant files and functions:

- `frontend/app/login.jsx`: `handleLogin`, validation, request ref lock, loading UI,
  OTP navigation, and post-login replacement navigation.
- `frontend/src/context/AuthContext.js`: `loginWithEmail`, `verifyLoginOtp`,
  `persistSession`, `checkAuth`, hydration effect, `logout`.
- `frontend/src/services/api.js`: centralized Axios client and token interceptors.
- `frontend/src/services/secureCredentials.js`: `setSessionToken`,
  `getSessionToken`, `removeSessionToken`, credential migration.
- `frontend/src/config/firebase.js`: single Firebase initialization,
  AsyncStorage-backed Firebase Auth persistence, auth-state subscription, ID-token
  retrieval for Google-session refresh.
- `backend/routes/auth.routes.js`: login, OTP, current-session, logout,
  forgot/reset-password routes.
- `backend/controllers/auth.controller.js`: Firebase password verification, OTP,
  backend session creation, logout, and password reset.
- `backend/middleware/auth.js`: Bearer/cookie session verification against
  `user_sessions`.
- `frontend/app/_layout.jsx`: protected-route guard and pre-auth loading state.

Token flow:

1. The password is sent unchanged over HTTPS to `/api/m/auth/login`.
2. The backend verifies it with Firebase and does not return Firebase access or
   refresh tokens to the app.
3. Following OTP verification, the backend returns an opaque `session_token`.
4. Native builds store that token in Expo SecureStore. A legacy AsyncStorage token
   is migrated and removed. The non-sensitive user snapshot is in AsyncStorage.
5. The Axios request interceptor attaches one `Authorization: Bearer` header unless
   the request already has an explicit header.
6. `/auth/me` validates restoration. HTTP 401 clears the persisted session and
   returns the app to unauthenticated navigation.

Logout calls `/api/m/auth/logout`, clears SecureStore and cached user/biometric
session state immediately, clears notification state, calls Firebase `signOut`,
and relies on replacement/protected-route navigation to prevent protected-screen
re-entry. The backend currently invalidates all sessions for that user.

## API and environment findings

- Preview, development, release, and production EAS profiles point to
  `https://mobile-api.lilycrest.space`.
- The preview profile produces an Android APK.
- The centralized runtime client is `frontend/src/services/api.js` with base
  `https://mobile-api.lilycrest.space/api/m` and a 15-second timeout.
- Production configuration rejects localhost, loopback, emulator, and RFC1918
  private IP URLs.
- No mobile runtime API service was found pointing to localhost or a development
  host. Backend development/database scripts still contain local database defaults;
  they are not mobile API configuration.

## Backend health

- Live probe: HTTP 200 from
  `https://mobile-api.lilycrest.space/api/m/health`.
- Live deployment result at test time: verbose legacy response with
  `status: "healthy"`.
- Repository result after this phase: exactly `{ "status": "ok" }`.
- Blocker: deploy the backend change before the app's strict health parser can
  accept the new response. The health call is used for restoration/readiness, not
  before every login.

## Firebase verification

- Both `google-services.json` copies contain the expected Android package
  `com.lilycrest.lilycrestdorm`.
- Both files refer to the same Firebase project, and that project matches the
  frontend environment project identifier.
- Repository scan found one Firebase `initializeApp` call, guarded by app/global
  reuse.
- Native Firebase Auth persistence uses React Native AsyncStorage.
- Backend Firebase ID-token verification and password verification are present.
- Email/password provider console state, authorized domains, sender/template
  settings, and action-link behavior cannot be proven from repository files.
  They remain operational checks.
- No Firebase keys or project identifiers are reproduced in this report.

## Safe error mapping

| Condition | User message |
|---|---|
| Invalid credentials | Incorrect email or password. |
| Invalid email | Please enter a valid email address. |
| Empty login fields | Please enter your email and password. |
| Offline | No internet connection. Please check your network and try again. |
| Timeout | The request took too long. Please try again. |
| Backend unavailable | Unable to connect to the server. Please try again later. |
| Too many requests | Too many attempts. Please wait before trying again. |
| Unexpected | Something went wrong. Please try again. |

Provider response details are not used for login or Forgot Password UI messages.

## Automated results

- Frontend Jest: **46 passed, 0 failed** across 8 suites.
- Backend Node tests: **60 passed, 0 failed**.
- Expo ESLint: **passed** (0 errors, 0 warnings after final cleanup).
- Covered: invalid email, empty password, exact password preservation, single-flight
  rapid taps, offline, timeout, unavailable backend, invalid credentials, raw error
  hiding, enumeration-safe reset messaging, Forgot Password lock, restoration
  loading, expired-session cleanup, logout cleanup contract, preview URL, and
  secret-log checks.

## Functional test results

| Area | Result | Evidence/blocker |
|---|---|---|
| Valid login + OTP + navigation | COULD NOT BE TESTED | No supplied test account/fresh APK |
| Incorrect/unregistered/empty/invalid login | AUTOMATED ONLY | Unit/static tests pass |
| Repeated login taps | PASSED (automated) | One request while lock held |
| Offline/timeout/server mapping | PASSED (automated) | Safe mappings asserted |
| Session restore/expired session | PASSED (automated contract) | Loading/401 cleanup asserted |
| Logout/different account isolation | COULD NOT BE TESTED | Requires installed APK and two accounts |
| Registered reset email received | COULD NOT BE TESTED | Requires mailbox/test account |
| Unregistered reset enumeration safety | PASSED (automated UI contract) | Fixed message asserted |
| Reset link opens and password changes | COULD NOT BE TESTED | Requires delivered email and deployed environment |

Forgot Password is not marked passed because actual delivery and reset completion
were not verified.

## Physical-device and network matrix

Target: TECNO CLA5, Android 15 / API 35.

| Network/test | Result |
|---|---|
| Primary Wi-Fi | COULD NOT BE TESTED |
| Alternative Wi-Fi | COULD NOT BE TESTED |
| Mobile data | COULD NOT BE TESTED |
| Offline mode | COULD NOT BE TESTED |
| Slow/unstable connection | COULD NOT BE TESTED |
| Backend unavailable | COULD NOT BE TESTED |
| Firebase unavailable | COULD NOT BE TESTED |
| Install/restart/device restart | COULD NOT BE TESTED |

No claims are based on Expo Go, browser, emulator, or unit tests as substitutes for
physical-device testing.

## Build status

- Requested profile: `preview`
- Artifact type: APK
- Package: `com.lilycrest.lilycrestdorm`
- Version/build number: `1.0.0` / `1`
- Environment: `https://mobile-api.lilycrest.space`
- Latest recorded preview build ID:
  `be94b70d-ccd5-4463-a008-78aa7fd18678`
- Status: `ERRORED` (`EAS_BUILD_UNKNOWN_GRADLE_ERROR`)
- Artifact: unavailable
- A fresh no-wait submission attempt on 2026-07-24 timed out locally before EAS
  created a new build record.

## Remaining blockers

1. Deploy the safe backend health response.
2. Resolve the preview Gradle build error and produce a fresh APK.
3. Install that APK on the specified TECNO device.
4. Run the full Wi-Fi/mobile/offline/unstable network matrix.
5. Use controlled registered/unregistered accounts to verify login, logout account
   isolation, session persistence, real reset-email receipt, link opening, password
   change, and login with the new password.
6. Verify Firebase Console email/password provider, authorized domains, sender,
   reset template, action URL, and expiry behavior with authorized access.
