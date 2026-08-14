# Phase 1.5B — EAS Android Build Recovery and Device Verification

Date: 2026-07-24 (Asia/Singapore)

## Decision

AUTHENTICATION AND NETWORK STABILITY NOT PASSED

The original Gradle failure is fixed and a local release APK builds successfully.
A fresh EAS preview build exists but remains queued, no Android device is visible to
ADB, and the live health endpoint still has the legacy response. Therefore remote
artifact, installation, runtime, authentication, and physical network verification
cannot be marked passed.

## Exact EAS failure

Failed build: `be94b70d-ccd5-4463-a008-78aa7fd18678`

- EAS phase: `RUN_GRADLEW`
- Gradle task: none; Gradle stopped before task selection/execution.
- First actionable error:
  `Value 'C:/Program Files/Java/jdk-17' given for org.gradle.java.home Gradle property is invalid`
- Source: `frontend/android/gradle.properties`
- Failure class: native build environment configuration.
- Not involved: dependency resolution, manifest merge, resources, Kotlin/Java
  compilation, signing, or APK assembly.
- Root cause: a Windows workstation-specific JDK path was committed and uploaded to
  the Linux EAS image (`ubuntu-24.04-jdk-17-ndk-r27b`).
- EAS's generic `EAS_BUILD_UNKNOWN_GRADLE_ERROR` is secondary classification, not
  the root cause.

After removing that property, local reproduction exposed a second deterministic
configuration failure at `frontend/android/app/build.gradle:74`: the script required
custom `LILIORA_RELEASE_*` environment variables. These variables are not the
project's EAS credential interface. The custom gate was removed and the standard
Expo/EAS release-signing configuration restored. EAS subsequently confirmed its
remote project keystore was available.

## Modified files

- `frontend/android/gradle.properties`
- `frontend/android/app/build.gradle`
- `frontend/eas.json`
- `frontend/package.json`
- `frontend/package-lock.json`
- this report

No authentication protections were reverted.

## Dependency and compatibility audit

| Component | Verified value/result |
|---|---|
| Expo SDK | `~54.0.36` |
| React Native | `0.81.5` |
| React | `19.1.0` |
| Expo Router | `~6.0.24` |
| Expo SecureStore | `~15.0.8` |
| Firebase | JS SDK `^12.8.0` |
| Axios | `^1.13.4` |
| Gradle | `8.14.3` |
| Android Gradle Plugin | `8.11.0` |
| Kotlin | `2.1.20` |
| EAS JDK | 17 |
| Local JDK | 22.0.1 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| NDK | 27.1.12297006 |

Before changes, Expo Doctor and `expo install --check` reported exactly one
mismatch: Expo `54.0.35`, expected `~54.0.36`. It was updated with
`npx expo install expo@~54.0.36`. No broad or major upgrades were performed.

After the patch:

- Expo Doctor: **17/17 checks passed**
- `npx expo install --check`: **Dependencies are up to date**

`expo prebuild --clean` was intentionally not run. The repository commits and
customizes the native Android directory; deleting and regenerating it could discard
native changes that are not fully represented by app config.

## Firebase Android verification

- Native/application package: `com.lilycrest.lilycrestdorm`.
- Root and native `google-services.json` package entries match.
- Both Firebase files identify the same project.
- Firebase JS SDK is installed.
- No `@react-native-firebase/*` package is installed, so there is no duplicate
  native Firebase SDK stack.
- Native Google Sign-In is installed and the Google Services plugin/config file are
  retained for that native integration.
- No Firebase secrets are reproduced here.

## EAS configuration

Preview now explicitly uses:

- `distribution: internal`
- Android `buildType: apk`
- EAS environment: `production` (the environment containing the existing mobile
  configuration variables)
- build-profile override:
  `EXPO_PUBLIC_BACKEND_URL=https://mobile-api.lilycrest.space`
- native package: `com.lilycrest.lilycrestdorm`

EAS confirmed remote Android credentials and its default project keystore.

## Local build result

Command: `android/gradlew.bat :app:assembleRelease --no-daemon --stacktrace`

- Result: **BUILD SUCCESSFUL**
- Duration: 4m13s
- Tasks: 800 actionable, 147 executed, 653 up to date
- APK:
  `frontend/android/app/build/outputs/apk/release/app-release.apk`
- Size: 53,603,807 bytes
- Package: `com.lilycrest.lilycrestdorm`
- Version: `1.0.0`
- Version code: `1`
- Format: APK
- SDK metadata: min 24, target 36, compile 36
- SHA-256:
  `0FD8E0FDE0430E5FE306ACF29FCEAB4C41B23EF146793C25ADA62C5E85C8E6E8`

This proves local assembly only. It is not treated as proof of an EAS artifact or a
physical-device pass.

## Fresh EAS build

- Build ID: `e41251cf-feba-4f98-ad04-d11c479e8466`
- Submitted: 2026-07-23 16:37:21 UTC
- Profile/platform: preview / Android
- Distribution/artifact request: internal / APK
- Version/build: 1.0.0 / 1
- Backend: `https://mobile-api.lilycrest.space`
- Fingerprint:
  `d55247570b59aad50c88cbcea36ae56ac64e4e34`
- Source: dirty working tree based on commit
  `4c9728a0823d0856fbff9a752eaff934ef593dfd`; the EAS upload includes the submitted
  working-tree archive, while the displayed Git hash remains the base commit.
- Final observed status: `IN_QUEUE`
- Artifact: unavailable while queued
- Cache use: not yet reported because the builder has not started

The build submission completed normally; no retry or duplicate build was created.

## Device, runtime, and functional verification

`adb devices -l` returned no attached devices. Therefore:

| Test | Result |
|---|---|
| TECNO CLA5 authorization | COULD NOT BE TESTED |
| Existing package/signature check | COULD NOT BE TESTED |
| APK installation | COULD NOT BE TESTED |
| Application launch/crash logs | COULD NOT BE TESTED |
| Valid/invalid/empty/rapid-tap login | COULD NOT BE TESTED |
| Successful navigation | COULD NOT BE TESTED |
| Session restoration after force close | COULD NOT BE TESTED |
| Forgot Password validation and rapid taps | COULD NOT BE TESTED |
| Actual reset email/link/password change | COULD NOT BE TESTED |

No existing application was uninstalled and no device data was changed.

## Physical network matrix

| Network | Login | Forgot Password | Profile | Result |
|---|---|---|---|---|
| Primary Wi-Fi | Required | Required | Required | COULD NOT BE TESTED |
| Mobile data | Required | Required | Required | COULD NOT BE TESTED |
| Offline | Required | Required | Retry/error | COULD NOT BE TESTED |
| Alternative Wi-Fi | When available | When available | When available | COULD NOT BE TESTED |
| Slow/unstable | When practical | When practical | When practical | COULD NOT BE TESTED |

## Live health endpoint

The live endpoint is reachable at
`https://mobile-api.lilycrest.space/api/m/health`, but it still returns the legacy
verbose payload with `status: "healthy"` and implementation metadata.

The repository implementation is the required safe `{ "status": "ok" }` response,
but it has not been deployed. No backend deployment connector or isolated clean
deployment revision was available in this workspace; the backend worktree contains
many unrelated changes, so publishing the whole dirty tree would exceed this
phase's scope.

## Regression results

- Frontend Jest: **46 passed, 0 failed**
- Backend Node tests: **60 passed, 0 failed**
- Focused auth/config suite remains covered by the frontend total
- Expo lint: **passed**
- Expo Doctor: **17/17 passed**
- Expo dependency compatibility: **passed**
- Local Android release assembly: **passed**

## Remaining blockers

1. Wait for EAS build `e41251cf-feba-4f98-ad04-d11c479e8466` to finish and verify
   its remote APK metadata.
2. Connect and authorize the TECNO CLA5 over ADB.
3. Check the installed signature, install the EAS APK, launch it, and collect
   sanitized runtime logs.
4. Obtain authorized test accounts/mailbox access and run the full login,
   reset-email, new-password, session-restoration, and account-isolation checks.
5. Run the required Wi-Fi/mobile/offline/alternative/unstable network matrix.
6. Deploy only the safe health-endpoint change and verify the live response.
