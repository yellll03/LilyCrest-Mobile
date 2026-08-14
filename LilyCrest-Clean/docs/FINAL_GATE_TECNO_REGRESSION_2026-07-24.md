# Final Gate — TECNO Clean Install and Pre-release Regression

Date: 2026-07-24  
Device: TECNO CLA5 (`TECNO_CLA5`), Android 15 / API 35  
ADB serial: `12782374AY101914`  
Package: `com.lilycrest.lilycrestdorm`

## Release decision

**PRE-RELEASE APK NOT READY FOR CLIENT TESTING**

Email/password authentication is blocked on the physical TECNO by a reproducible
React Native networking failure. Android and Chrome can reach the production
backend, but the app receives no HTTP response (`status: 0`, offline
classification) on both mobile data and Wi-Fi. Authenticated regression therefore
cannot proceed.

## Device and installation evidence

- `adb kill-server`, `adb start-server`, and `adb devices -l` completed.
- Exact ADB state: `device product:CLA5-OP model:TECNO_CLA5 device:TECNO-CLA5`.
- Tester explicitly confirmed local app data was safe to clear and test
  credentials were ready.
- Expected local losses were acknowledged: SecureStore session, survey drafts,
  offline document cache, chatbot context, and other app-only state.
- Previous installation: version 1.0.0, version code 1.
- Previous first install: 2026-05-20 23:29:10.
- Previous last update: 2026-07-24 01:18:01.
- Uninstall result: `Success`; only the LilyCrest package was targeted.
- Fresh install result: `Performing Streamed Install` / `Success`.
- Fresh install timestamp: 2026-07-24 02:27:43.
- Installed version: 1.1.0, version code 2.
- Cold launch: successful; `MainActivity` became top-resumed.
- No immediate crash or Android “keeps stopping” dialog.

## Frozen APK re-verification

- File: `frontend/builds/LilyCrest-PreRelease-1.1.0-vc2-20260724.apk`
- Size: 59,503,540 bytes.
- SHA-256:
  `A317BE3DED5EB61B68F3788AA32CF0F6064B194B02B9116568FFBC8B7B26B2FC`
- Package: `com.lilycrest.lilycrestdorm`.
- Version: 1.1.0 (code 2).
- Signature: APK Signature Scheme v2 verified; one signer.
- Backend: `https://mobile-api.lilycrest.space`.
- Health endpoint: HTTP 200.
- The original frozen APK was restored after unsuccessful diagnostic builds.

## Runtime result

- Firebase initialization completed.
- React Native main application started.
- Firebase Auth persistence initialized for Android.
- Native PDF manager loaded; a nonfatal PDF setter warning was observed.
- Notification permission was not granted after clean install, which is expected
  before the user accepts the Android prompt.
- No startup crash, SecureStore crash, navigation crash, or repeated auth loop
  was detected.
- Onboarding and login screens rendered without visible clipping.
- Invalid-email validation passed with `Please enter a valid email address.`

## Release-blocking bug

### MOB-AUTH-NET-001 — App HTTP requests fail before receiving a response

Severity: Blocker

Reproduction:

1. Clean-install the frozen APK on the TECNO CLA5.
2. Connect to validated LTE or validated Wi-Fi.
3. Open LilyCrest and enter an authorized test account.
4. Tap Sign In once.

Expected: the backend returns an authentication result and the app proceeds to
OTP, account-state feedback, or the authenticated home screen.

Actual: the app reports an internet problem. A status-only diagnostic build
recorded `status: 0`, `type: offline`, `code: ""`, `hasResponse: false`.

Controls performed:

- Android reported validated LTE.
- TECNO resolved and pinged `mobile-api.lilycrest.space`.
- TECNO resolved and pinged Google.
- Wi-Fi connected with a valid local address and strong signal.
- The exact backend health URL opened successfully in Chrome on the TECNO.
- The health URL returned HTTP 200 from the workstation.
- Production login route returned a normal JSON HTTP response for a non-real,
  reserved-domain probe.
- Device clock was correct.
- No proxy, restricted networking mode, data saver, or effective foreground UID
  block was active.
- The TECNO system trust store contains GTS Roots R1–R4; the endpoint certificate
  is issued through Google Trust Services WE1.
- Axios Fetch-adapter and direct React Native `fetch` diagnostic attempts both
  failed before receiving an HTTP response. These changes were reverted.
- The failed diagnostic APK was deleted; it is not a release candidate.

No verified application fix was retained. Further diagnosis requires native
Android networking instrumentation or a comparable second physical Android
device to determine whether this is TECNO/HiOS-specific.

## Authentication matrix

| Test | Result |
|---|---|
| Valid email/password | FAILED |
| Wrong password | COULD NOT BE TESTED |
| Invalid email | PASSED |
| Empty email/password | PARTIALLY PASSED |
| Rapid repeated taps/loading | COULD NOT BE TESTED |
| Unverified/disabled account | COULD NOT BE TESTED |
| Forgot Password end-to-end | COULD NOT BE TESTED |
| Google Sign-In end-to-end | COULD NOT BE TESTED |

## Authenticated feature results

| Area | Result | Reason |
|---|---|---|
| Session/account isolation | COULD NOT BE TESTED | Authentication blocker |
| Tenant profile | COULD NOT BE TESTED | Authentication blocker |
| Branch and Maps | COULD NOT BE TESTED | Authentication blocker |
| Billing | COULD NOT BE TESTED | Authentication blocker |
| Surveys | COULD NOT BE TESTED | Authentication blocker |
| Smart Tenant Assistant | COULD NOT BE TESTED | Authentication blocker |
| Documents/contracts | COULD NOT BE TESTED | Authentication blocker |
| Generated PDFs | COULD NOT BE TESTED | Authentication blocker/test data |
| Maintenance/announcements | COULD NOT BE TESTED | Authentication blocker |
| Notifications/deep links | COULD NOT BE TESTED | Authentication blocker/test events |

## Network matrix

| Feature | Primary Wi-Fi | Mobile data | Offline | Alternative Wi-Fi | Slow/unstable |
|---|---|---|---|---|---|
| Email login | FAILED | FAILED | PARTIALLY PASSED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Forgot Password | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Google Sign-In | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Profile | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Billing | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Surveys | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Chatbot | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Documents | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Maintenance | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |

## Automated verification

- Existing backend suite: 98 tests passed.
- Existing frontend suite: 66 tests passed.
- Focused authentication/API suites: 37 tests passed before diagnostics.
- Focused auth suites: 26 tests passed after the direct-fetch experiment.
- Survey suite: 12 tests passed.
- Focused backend suite: 50 tests passed.
- Expo Doctor: 17/17 checks passed.
- Android release build: successful.

## Remaining blockers

1. Resolve `MOB-AUTH-NET-001` using a native OkHttp/React Native networking trace.
2. Rebuild and repeat clean-install login on the TECNO.
3. Verify the same APK on a second physical Android device and alternative Wi-Fi.
4. Complete every authenticated feature, isolation, PDF, notification, and
   network-matrix test before client distribution.
5. Keep the current debug-signed APK restricted to internal testing.

