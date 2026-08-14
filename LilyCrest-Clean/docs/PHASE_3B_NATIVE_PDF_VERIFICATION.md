# Phase 3B — Native PDF Build and Device Verification

Date: 2026-07-24

## Final decision

**DOCUMENT MANAGEMENT NOT PASSED**

Android release compilation and installation of the initial candidate passed, and the app launched without a native-module startup crash. Full PDF runtime/device testing did not finish because the authorized TECNO CLA5 disconnected from ADB. The corrected landscape-capable APK was consequently built but not installed or exercised.

## Modified files

- `frontend/android/app/src/main/AndroidManifest.xml` — removed the stale portrait lock from `MainActivity`.
- This report.

No PDF generator, contract data, authentication, survey, backend, or iOS implementation was changed.

## Native dependency compatibility

| Component | Version/result |
|---|---|
| Expo | 54.0.36 |
| React Native | 0.81.5 |
| `react-native-pdf` | 7.0.4 |
| `react-native-blob-util` | 0.24.10 |
| Android Gradle wrapper | 8.14.3 |
| Android build tools | 36.0.0 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| Kotlin / KSP | 2.1.20 / 2.1.20-2.0.1 |
| New Architecture | Enabled |

Compatibility is empirically confirmed for Android compilation: codegen, Java/Kotlin compilation, lint-vital, dexing, resource merging, and release packaging completed for both PDF modules. Only deprecation warnings were emitted.

- `npx expo-doctor`: 17/17 checks passed.
- `npx expo install --check`: dependencies up to date.
- No blind package upgrades were performed.

## Expo/native configuration

- Both native modules autolinked and generated New Architecture artifacts.
- Expo Go: **not supported** for this feature; it does not contain these custom native modules.
- Development build, preview APK, and release APK: supported after a new native build.
- `INTERNET` permission is present.
- App-private document storage does not need Android shared-storage permission.
- Merged manifest contains blob-util, Expo filesystem, and Expo sharing `FileProvider` entries.
- The checked-in manifest initially overrode Expo's `orientation: default` with `screenOrientation="portrait"`. It is now `unspecified`; the rebuilt merged manifest confirms that value.
- EAS preview is an internal APK profile using the public mobile API host.
- Existing legacy `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` declarations remain, but the document manager does not depend on them for its private cache/share path.

## Android build and APK

Initial command:

```text
gradlew.bat :app:assembleRelease --no-daemon --stacktrace
```

Result: successful in 4m40s. That APK was installed in-place with `adb install -r`; existing app data was not erased.

After correcting the orientation mismatch:

```text
NODE_ENV=production gradlew.bat :app:assembleRelease --no-daemon
```

Result: successful in 2m51s.

| Property | Final candidate |
|---|---|
| APK | `frontend/android/app/build/outputs/apk/release/app-release.apk` |
| Package | `com.lilycrest.lilycrestdorm` |
| Version | 1.0.0 |
| Version code | 1 |
| Size | 59,479,176 bytes (56.72 MiB) |
| SHA-256 | `E7464A4A5832883024CD487D9061914923453E5863809BC3B01446AE31C74A17` |

The final candidate was not installed because the device was no longer connected.

## Physical installation and runtime

TECNO CLA5 serial was authorized at the start. The initial release APK installed successfully as an update. The process launched, remained alive, and `MainActivity` became top-resumed. Android reported first-window display in 2.123 seconds.

Sanitized Logcat showed:

- no `FATAL EXCEPTION`;
- no `NativeModule is null`;
- no TurboModule/bridgeless incompatibility;
- no blob-util linkage failure;
- no Android storage-permission crash.

This proves application startup compatibility, not PDF-view runtime compatibility. The device disconnected before a PDF could be opened and remained absent after an ADB server restart.

## Physical test matrices

| Area | Result |
|---|---|
| App installation/update | Passed for initial candidate |
| App launch/MainActivity | Passed |
| Native module startup linkage | Passed |
| Open/render small PDF | Not run |
| Multi-page, large, portrait, landscape | Not run |
| Images, Unicode, signatures, tables | Not run |
| Page indicator/navigation | Not run |
| Pinch and double-tap zoom | Not run |
| Rotate/background/foreground | Not run |
| Retry/back/repeated opens/memory | Not run |
| Contract metadata/empty state | Not run |
| Own versus other tenant document | Not run |
| 401/403/404/expired URL | Not run |
| Offline cache/account switching | Not run |
| Download interruption/duplicate/low storage | Not run |
| Native sharing targets/cancel/offline | Not run |
| Google Sign-In regression | Not run |

No real tenant documents or unauthorized accounts were used.

## Validation and cache audit

Client checks currently occur after download and before rendering:

- file exists;
- size is non-zero;
- response MIME is PDF or octet-stream;
- first five bytes decode to `%PDF-`.

Non-2xx and invalid files are deleted. Backend generated endpoints return `application/pdf`; ownership is enforced server-side for bill and user-document retrieval.

Gaps identified:

- no approved maximum file-size limit is enforced;
- deep structural corruption beyond the header is delegated to the renderer;
- cache keys contain tenant ID + kind + document ID but no document version/hash;
- no cache expiry/eviction policy exists;
- the download experience is automatic private caching, not a separate user-selected export with duplicate-name handling;
- the persistent cached file is shared directly; temporary share-file cleanup is therefore not applicable/implemented.

## Error-handling matrix

These are code-audit results; physical results remain unverified.

| Condition | Expected | Implemented behavior | Status |
|---|---|---|---|
| Offline, uncached | Internet required | Internet-required fallback | Static pass |
| Timeout | Request took too long | Internet-required/general load fallback | Needs improvement |
| 401 | Session expired | Sign-in-again message | Static pass |
| 403 | Access denied | Permission message | Static pass |
| 404 | Document not found | Not-found message | Static pass |
| Wrong MIME | Invalid document | Damaged/not-valid-PDF message; file deleted | Static pass |
| Missing `%PDF` | Invalid/corrupt | Damaged/not-valid-PDF message; file deleted | Static pass |
| Zero byte | Invalid/corrupt | Damaged/not-valid-PDF message; file deleted | Static pass |
| Renderer corruption | Unable to display | Generic document load error | Partial |
| Share failure | Unable to share | “Share unavailable” plus safe fallback | Partial |
| Download failure | Unable to download | Viewer load error and Retry | Partial |

No internal path, token, response body, or stack trace is intentionally rendered.

## Regression results

- Frontend Jest: 8 suites, 54 tests passed.
- Expo lint: passed.
- Backend Node tests: 60 tests passed.
- Expo Doctor: passed.
- Expo dependency check: passed.
- Android release build: passed twice.
- Authentication/Google physical regression: not run.
- There are no dedicated executable PDF-viewer tests yet.

## iOS read-only assessment

Both dependencies include iOS implementations and podspecs targeting iOS 11 or later; blob-util includes an Apple privacy manifest and react-native-pdf links PDFKit. A native CocoaPods/EAS iOS build is required—Expo Go is insufficient. App-private downloads and share-sheet testing must be performed on a real device; simulator testing cannot establish real share-target behavior. New Architecture linkage, Pod installation, file sharing, rotation, memory, and physical rendering remain unverified. No iOS compatibility claim is made.

## Remaining blockers

1. Reconnect the authorized TECNO CLA5 and install the final SHA-256 candidate with `adb install -r`.
2. Execute the full safe-document dataset and interaction matrix.
3. Exercise two authorized tenants for cache/ownership isolation.
4. Add/enforce file-size and cache expiry/version policy.
5. Decide whether “Download” means persistent private offline caching or a distinct exported file workflow.
6. Run iOS build/device verification separately.
