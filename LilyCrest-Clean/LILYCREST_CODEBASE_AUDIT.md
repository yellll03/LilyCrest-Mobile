# LilyCrest Codebase Audit

Static audit date: 2026-07-12

## Executive Summary

LilyCrest is a React Native/Expo Router mobile app in `frontend/` and a Node/Express API in `backend/`. The current codebase is close enough to continue stabilization work, but it is not ready for iOS preparation or release without config cleanup, secret hygiene, and device testing.

The largest confirmed blockers are iOS native configuration gaps, stale generated Android artifacts, Expo SDK patch mismatches, custom-scheme payment redirects, committed Firebase client config history, and session/token storage in AsyncStorage. Lint and the existing Jest tests pass. Backend JavaScript syntax checks pass. No app behavior was changed during this audit.

## Current Architecture

- Frontend: `frontend/package.json:1-109` defines Expo SDK 54, Expo Router via `"main": "expo-router/entry"`, React Native 0.81.5, React 19.1.0, Firebase client SDK, Expo native modules, and `@react-native-google-signin/google-signin`.
- Backend: `backend/package.json:1-24` defines Express, MongoDB driver, Firebase Admin, PayMongo via Axios, Nodemailer, Gemini, rate limiting, and UUID.
- Routing: `frontend/app/_layout.jsx:87-115` registers app routes; `frontend/app/(tabs)/_layout.jsx:156-237` defines visible tabs.
- API client: `frontend/src/config/api.js:1-25` resolves the mobile backend and `frontend/src/services/api.js:126-339` centralizes Axios mobile calls.
- Backend route mounting: `backend/server.js:156-158` mounts the same router at both `/api` and `/api/m`; `backend/routes/index.js:7-64` mounts feature routers.
- Native folders: `frontend/android/` exists and appears generated plus locally dirty; `frontend/ios/` does not exist.

## Confirmed Build Blockers

| Severity | Confidence | Issue | Evidence | Minimal Fix Direction |
|---|---|---|---|---|
| Critical | Confirmed | iOS bundle identifier is missing. EAS/TestFlight/App Store builds need `ios.bundleIdentifier`. | `frontend/app.config.js:13-18` has only `supportsTablet` and Maps config; `npx expo config --type public` shows `ios: { supportsTablet: true }`. | Add a stable `ios.bundleIdentifier`, likely `com.lilycrest.lilycrestdorm`, after product confirmation. |
| High | Confirmed | No iOS native project exists, so local `expo run:ios` cannot work until a controlled prebuild/EAS iOS build is done. | Repo contains `frontend/android/`; no `frontend/ios/`. `frontend/package.json:12-13` exposes iOS scripts. | Use EAS managed iOS builds first; prebuild only when intentionally entering native workflow. |
| High | Confirmed | iOS permission strings are missing for camera/photo library and biometrics. | Feature usage in `frontend/src/utils/attachmentPicker.js:39-67`, `frontend/app/my-documents.jsx:380-387`, `frontend/app/index.jsx:74-81`, `frontend/app/login.jsx:312-319`; no `ios.infoPlist` in `frontend/app.config.js:13-18`. | Add Apple usage descriptions before iOS builds. |
| High | Confirmed | Payment redirects use hard-coded `frontend://` scheme and no iOS associated domains/universal link setup. | `frontend/app/payment.jsx:125`; `frontend/app/bill-details.jsx:160`; backend emits `frontend://payment-success` and `frontend://payment-cancel` in `backend/controllers/paymongo.controller.js:915-916` and `958-959`. | Keep behavior for Android, but add iOS-tested callback handling and consider a branded scheme/universal link. |
| Medium | Confirmed | Expo SDK dependency patch mismatch. | `npx expo-doctor` failed: expected `expo ~54.0.35`, `expo-file-system ~19.0.23`, `expo-font ~14.0.12`, `expo-router ~6.0.24`; installed `54.0.34`, `19.0.22`, `14.0.11`, `6.0.23`. | Use `npx expo install --check` and update only compatible patch versions. |
| Medium | Confirmed | EAS profiles are Android-focused and do not define iOS-specific build profiles. | `frontend/eas.json:5-40` sets Android `buildType` for development/release/preview and no `ios` objects. | Add iOS simulator/internal/TestFlight profiles after bundle ID and credentials are decided. |
| Medium | Confirmed | Generated Android folder includes local/build artifacts. | `frontend/android/build/`, `.gradle/`, `.kotlin/`, `local.properties`, and tracked `frontend/android/build_output.txt`, `frontend/android/build_command_output.txt`. | Do not regenerate yet; later remove tracked build logs and keep native folders source-only. |
| Medium | Confirmed | Android release currently signs with debug keystore in native Gradle. | `frontend/android/app/build.gradle:121-125` sets release `signingConfig signingConfigs.debug`. | For production Android, configure EAS credentials or release signing; do not alter before baseline. |

## Critical Security Issues

| Severity | Confidence | Issue | Evidence | Impact |
|---|---|---|---|---|
| Critical | Confirmed | Firebase client config files are present in Git history. | `git log --all --name-only` shows `frontend/google-services.json` and `frontend/android/app/google-services.json`. Current `.gitignore` ignores them, but history remains. | Rotate/restrict Firebase client API keys and OAuth clients; assume historical copies may be accessible to anyone with repo history. |
| High | Confirmed | Local backend `.env` contains real operational secrets. It is ignored and not tracked now, but must be protected. | Redacted inventory found set values for `GOOGLE_AI_API_KEY`, `GEMINI_API_KEY`, Firebase Admin vars, `MONGO_URL`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `IMAGEKIT_PRIVATE_KEY`, `SMTP_PASS` in `backend/.env:1-44`. | Do not commit. Rotate if this workspace has ever been shared or zipped. |
| High | Confirmed | Mobile session token is stored in AsyncStorage, not SecureStore. | `frontend/src/context/AuthContext.js:33-41`; `frontend/src/services/api.js:159-162`; `frontend/src/services/secureCredentials.js:135-140`. | Higher token exposure risk on compromised devices/backups. Move session tokens to SecureStore in a separate behavior-preserving phase. |
| Medium | Confirmed | Backend allows mobile/dev CORS origins by default unless disabled. | `backend/server.js:57-69` defaults `ALLOW_MOBILE_DEV_CORS` to true and permits private-network/local origins. | In production, explicitly set `ALLOW_MOBILE_DEV_CORS=false` unless needed. |
| Medium | Confirmed | Backend accepts 30 MB JSON globally. | `backend/server.js:103-109`. | Increases payload abuse impact; constrain large body parsing to upload/admin routes later. |
| Medium | Confirmed | Git history contains Firebase client files, but current `.env` files are not tracked. | `git ls-files backend/.env frontend/.env` returned none; `git check-ignore` confirms ignores. | Secret cleanup is still needed for history/config files. |

Credentials to rotate or restrict immediately if repo history was shared: Firebase client API keys/OAuth clients from `google-services.json`; backend `.env` values if copied outside the machine: Firebase Admin key, MongoDB URI, PayMongo secret/webhook secret, Google AI/Gemini keys, ImageKit private key, SMTP app password.

## Functional Bugs And Stability Risks

| Severity | Confidence | Issue | Evidence | Notes |
|---|---|---|---|---|
| High | Confirmed | Session refresh only works for users with an active Firebase user; email/OTP sessions without Firebase state are cleared on 401. | `frontend/src/services/api.js:134-199` refreshes through `/auth/google` using `getFreshIdToken(true)`. | Can cause valid email sessions to fail instead of using backend session renewal. Needs runtime test. |
| High | Confirmed | Email/password login can auto-create a Firebase account for an existing tenant. | `backend/controllers/auth.controller.js:263-279`. | This is intentional-looking but security-sensitive. Keep only if product-approved. |
| Medium | Confirmed | Login password requirement differs from new/change password requirement. | Login accepts 6 chars in `frontend/src/utils/passwordValidation.js:17-24`; backend login allows min 6 at `backend/controllers/auth.controller.js:220-224`; new/change password requires 8 plus complexity in `frontend/src/utils/passwordValidation.js:38-62` and backend `backend/controllers/auth.controller.js:765-783`. | Not necessarily wrong, but should be documented to avoid support confusion. |
| Medium | Confirmed | Register flow exists in frontend API context and backend route, but tenant app appears login/approval oriented. | `frontend/src/context/AuthContext.js:514-539`; `backend/routes/auth.routes.js:16`; `backend/controllers/auth.controller.js:661-720`. | Could allow self-created resident accounts if exposed by any UI/deep link/client. Product decision needed. |
| Medium | Confirmed | `/api` and `/api/m` mirror the same routes. | `backend/server.js:156-158`. | Useful for migration, but mobile/admin contracts can drift invisibly because they are not isolated. |
| Medium | Confirmed | Mobile API service exposes admin ticket and seed methods. | `frontend/src/services/api.js:299-316`; backend seed is gated in `backend/routes/index.js:66-80`. | No direct UI found for seed/admin calls, but keep off tenant surfaces. |
| Medium | Likely | Announcements are public but no-store middleware treats them private. | `backend/routes/announcement.routes.js:6`; `backend/server.js:146-148`. | Probably harmless; clarify desired public/private behavior. |

## Dependency Problems

| Severity | Confidence | Dependency | Evidence | Recommendation |
|---|---|---|---|---|
| Medium | Confirmed | `expo`, `expo-file-system`, `expo-font`, `expo-router` patch levels | `npx expo-doctor` failed dependency validation. | Update with Expo-compatible patch versions only. |
| Medium | Confirmed | `expo-dev-client` is always listed as app config plugin. | `frontend/app.config.js:50-57`; `frontend/package.json:36`. | Development builds require it; confirm production profiles do not unintentionally keep dev launcher behavior. |
| Medium | Confirmed | `@react-native-google-signin/google-signin` requires native builds and iOS config. | Dependency at `frontend/package.json:23`; native module loaded in `frontend/src/config/googleSignIn.js:9-28`. | Not iOS-incompatible, but not Expo Go-compatible. Add iOS Google config before iOS testing. |
| Low | Confirmed | `expo-auth-session` appears installed but no active source import found in `app/` or `src/`. | `frontend/package.json:31`; `rg` found no app source usage. | Candidate for later removal only after checking lock/history and Google flow decision. |
| Low | Confirmed | `expo-clipboard`, `expo-haptics`, `expo-symbols`, `moti`, `react-native-webview`, `zustand` have no active app/source imports found. | Dependencies in `frontend/package.json:33,40,52,56,65,67`; source search did not find matching imports. | Do not delete yet; mark for dead-dependency pass after runtime baseline. |
| Low | Confirmed | `nodemailer@8` is installed. | `backend/package.json:17`; `npm ls` shows `nodemailer@8.0.7`. | Verify support posture before release; replace only if needed after email regression tests. |

No React Native Community CLI dependencies were found as direct frontend dependencies.

## API And Environment Configuration

Confirmed backend URL resolution:

- `frontend/src/config/api.js:1-25` uses `https://mobile-api.lilycrest.space` as the forced default.
- It rejects empty config, `api.lilycrest.space`, `onrender.com`, and `trycloudflare.com` at `frontend/src/config/api.js:5-19`.
- It does not explicitly reject `localhost`, `127.0.0.1`, `10.0.2.2`, or `192.168.x.x`. Because empty and certain legacy hosts are blocked, but localhost/LAN are not blocked by regex, a release build could use a local URL if `EXPO_PUBLIC_BACKEND_URL` were set that way.
- EAS currently sets `EXPO_PUBLIC_BACKEND_URL=https://mobile-api.lilycrest.space` in all profiles at `frontend/eas.json:12-35`.

Hard-coded domains and URLs:

- Mobile API: `frontend/src/config/api.js:1`.
- Direct Render diagnostic only: `frontend/src/utils/mobileDiagnostics.js:10`.
- PayMongo API: `backend/controllers/paymongo.controller.js:14`.
- Backend redirect fallback: `backend/controllers/paymongo.controller.js:15,37,832-839`.
- Expo push service: `backend/services/pushService.js:12`.
- Firebase Storage download URL builder: `backend/routes/upload.routes.js:157`.
- Google Maps web search URL: `frontend/app/(tabs)/home.jsx:600`.

Required frontend environment names:

- `EXPO_PUBLIC_BACKEND_URL`
- `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_WEB_API_KEY`, `EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `EXPO_PUBLIC_FIREBASE_WEB_APP_ID`, `EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID`, `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_GOOGLE_ANDROID_API_KEY`, `EXPO_PUBLIC_GOOGLE_ANDROID_CERT_HASH`
- Optional/logging: `EXPO_PUBLIC_ASSISTANT_LOGS`

Required backend environment names:

- `MONGO_URL`, `DB_NAME`
- Firebase Admin: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, plus service account fields in `backend/config/firebase.js:13-56`
- `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `BACKEND_URL`
- `GOOGLE_AI_API_KEY` or `GEMINI_API_KEY`, `GEMINI_MODEL`
- `IMAGEKIT_PRIVATE_KEY` or Firebase Storage upload bucket settings
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- CORS: `CORS_ORIGINS`, `FRONTEND_URL`, `WEB_BASE_URL`, `MOBILE_APP_URL`, `ALLOW_LOCAL_CORS`, `ALLOW_MOBILE_DEV_CORS`

## Backend Contract Mismatches

| Severity | Confidence | Issue | Evidence |
|---|---|---|---|
| Medium | Confirmed | Frontend service contains admin-only endpoints in tenant client bundle. | `frontend/src/services/api.js:299-302`. |
| Medium | Confirmed | Frontend exposes seed API method although backend gates seed to non-production admin/owner. | `frontend/src/services/api.js:315-316`; `backend/routes/index.js:66-80`. |
| Medium | Confirmed | Billing update exists in mobile API service but backend requires admin. | `frontend/src/services/api.js:238-239`; `backend/routes/billing.routes.js:12-13`. |
| Medium | Likely | Support is split between chatbot live-chat endpoints and `/chat` conversation endpoints. | `frontend/src/services/api.js:277-313`; `backend/routes/chatbot.routes.js:7-17`; `backend/routes/chat.routes.js:7-17`. |
| Low | Confirmed | `/api` and `/api/m` route duplication makes mobile/admin separation policy unclear. | `backend/server.js:156-158`. |

## Android-Specific Assumptions

- Android package exists: `frontend/app.config.js:19-44`.
- Android intent filters are present, including generated duplicate custom scheme filters: `frontend/android/app/src/main/AndroidManifest.xml:33-46`.
- Android generated manifest includes permissions not obviously used by current mobile app, including `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, and legacy storage permissions at `frontend/android/app/src/main/AndroidManifest.xml:2-9`.
- Android native Gradle limits ABIs to `arm64-v8a` at `frontend/android/app/build.gradle:105-107`; this is fine for many devices but can affect emulator/debug matrix.
- `@react-native-google-signin/google-signin` checks Play Services on all native platforms at `frontend/src/config/googleSignIn.js:62`. Expected iOS behavior needs device testing.

## iOS Compatibility Issues

| Severity | Confidence | Issue | Evidence |
|---|---|---|---|
| Critical | Confirmed | Missing `ios.bundleIdentifier`. | `frontend/app.config.js:13-18`. |
| High | Confirmed | No `GoogleService-Info.plist` or iOS Firebase config file is present. | `rg --files` found `google-services.json` only. |
| High | Confirmed | Native Firebase config uses Android app id/API key for all non-web platforms, including iOS. | `frontend/src/config/firebase.js:90-99`. |
| High | Confirmed | Missing Apple permission text for camera/photo library/biometrics/notifications. | Native feature usage listed above; no `ios.infoPlist`. |
| High | Likely | Google native sign-in lacks confirmed iOS URL scheme/client configuration. | `frontend/src/config/googleSignIn.js:15-22`; no iOS config in `frontend/app.config.js:13-18`. |
| Medium | Confirmed | Push notifications require development build and Apple credentials; Expo Go is insufficient. | Lazy load warning in `frontend/src/services/notifications.js:6-15`; token logic in `frontend/src/services/notifications.js:94-160`. |
| Medium | Confirmed | `ios.supportsTablet` is enabled. | `frontend/app.config.js:13-14`. |
| Medium | Needs Runtime Testing | Payment `openAuthSessionAsync` custom scheme behavior differs on iOS. | `frontend/app/payment.jsx:125`; `frontend/app/bill-details.jsx:160`. |

## UI And Accessibility Issues

Static scan found common mobile risk patterns, but visual correctness needs simulator/device testing:

- Fixed dimensions and absolute positioning are common in `frontend/app/(tabs)/home.jsx` and `frontend/src/components/AppHeader.js`; examples include floating assistant button at `frontend/app/(tabs)/home.jsx:1581-1585` and header absolute badge positions at `frontend/src/components/AppHeader.js:218-222`.
- Several screens use `SafeAreaView edges={['top']}` without bottom edges, while tab bar/home indicator behavior needs iOS testing. Examples: `frontend/app/(tabs)/announcements.jsx:358`, `frontend/app/(tabs)/profile.jsx:335`, `frontend/app/payment.jsx:196`.
- Some form screens correctly use `KeyboardAvoidingView`, such as `frontend/app/reset-password.jsx:148-150`; other editable screens need iOS keyboard verification, especially profile editing and maintenance/chat reply forms.
- Global font defaults are applied by mutating `Text.defaultProps` and `TextInput.defaultProps` at `frontend/app/_layout.jsx:43-53`; verify with React Native 0.81 warnings.

## Verification Performed

- `npm.cmd run lint` in `frontend/`: passed.
- `npm.cmd test -- --runInBand` in `frontend/`: passed, 2 suites, 6 tests.
- Backend syntax check with `node --check`: passed across backend `.js` files.
- `npm.cmd ls --depth=0` in frontend/backend: completed.
- `npx expo-doctor`: failed one dependency validation check as described above. It temporarily fetched `expo-doctor`; no project dependency files were modified.

## Could Not Verify Through Static Analysis

- Real iOS simulator/device behavior for Google Sign-In, PayMongo browser return, push/APNs token registration, camera/photo/document picker permissions, and biometric prompts.
- Backend runtime contract against the live `https://mobile-api.lilycrest.space` API with authenticated tenant accounts.
- PayMongo webhook delivery and production signing-secret correctness.
- Firebase/Google OAuth console configuration, Apple Team ID, APNs keys, EAS credentials, App Store Connect setup.
- Whether unused-looking dependencies are required by unpublished code paths or generated native config.
