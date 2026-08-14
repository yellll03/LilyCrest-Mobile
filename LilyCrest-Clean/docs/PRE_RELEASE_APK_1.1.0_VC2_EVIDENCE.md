# Pre-Release APK Evidence — 1.1.0 (2)

## Artifact metadata

| Field | Value |
|---|---|
| Build type | Android Gradle release APK, internal/pre-release |
| Package | `com.lilycrest.lilycrestdorm` |
| App version | `1.1.0` |
| Version code | `2` |
| Compile / target SDK | 36 / 36 |
| Minimum SDK | 24 |
| ABI | arm64-v8a |
| Backend | `https://mobile-api.lilycrest.space` |
| Artifact | `frontend/builds/LilyCrest-PreRelease-1.1.0-vc2-20260724.apk` |
| Size | 59,503,540 bytes |
| SHA-256 | `A317BE3DED5EB61B68F3788AA32CF0F6064B194B02B9116568FFBC8B7B26B2FC` |
| Build timestamp UTC | 2026-07-23 18:17:16 |
| Git HEAD | `4c9728a0823d0856fbff9a752eaff934ef593dfd` |
| Frozen source manifest | `release-evidence/pre-release-1.1.0-vc2-20260724/source-hashes.csv` |
| Source manifest SHA-256 | `B262B0EF9B5235715576A61BD4410A7DDCC7DCA1DA314FD6BAA91778EF8328EB` |

The working tree contains the accumulated approved mobile/backend changes and is not represented by Git HEAD alone. The 972-entry source-hash manifest is the exact frozen snapshot reference.

## Signing

`apksigner verify --verbose --print-certs`:

- verified: yes;
- APK Signature Scheme v2: yes;
- signer: `CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`;
- certificate SHA-256: `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`;
- certificate SHA-1: `5E8F16062EA3CD2C4A0D547876BA6F38CABF625`;
- RSA 2048-bit.

This is an internal pre-release/debug certificate, not a Play production signing identity. Its SHA-1 matches the Android certificate hash configured for Google Sign-In. A future production build must use the approved production/EAS signing credential and its Firebase registration.

## Native contents

Release build tasks include `react-native-pdf` and `react-native-blob-util`. APK archive inspection confirms arm64 PDFium and React Native/Hermes native libraries, including:

- `lib/arm64-v8a/libpdfium.so`
- `lib/arm64-v8a/libpdfiumandroid.so`
- `lib/arm64-v8a/libreactnative.so`
- `lib/arm64-v8a/libhermes.so`

Blob-util is also present through Android autolinking/build tasks; it does not expose a separately named native `.so` in this APK.

## Backend smoke check

`GET https://mobile-api.lilycrest.space/api/m/health` returned HTTP 200 with:

```json
{"ok":true,"service":"LilyCrest Mobile Backend","status":"healthy","backend":"Node.js/Express","auth":"Firebase-only"}
```

This confirms environment reachability, not deployment of every frozen backend change.

## Automated evidence

- backend: 98/98 passed;
- frontend: 66/66 passed;
- Expo lint: passed;
- Expo Doctor: 17/17 passed;
- Expo dependencies: up to date;
- backend syntax: passed;
- Android release: `BUILD SUCCESSFUL`, 954 tasks;
- PDF pagination/billing boundary tests: passed.

Logs and previous-build baseline evidence are backed up under:

`release-evidence/pre-release-1.1.0-vc2-20260724/`

## Pre-uninstall safety checklist

| Check | Result |
|---|---|
| Fresh APK exists | PASSED |
| Checksum recorded and copied artifact matches | PASSED |
| Package verified | PASSED |
| Version code increased from repository/current prior value 1 to 2 | PASSED |
| APK signature verified | PASSED |
| Automated tests passed | PASSED |
| Native release build passed | PASSED |
| Backend environment embedded/configured | PASSED |
| Evidence and exact source manifest backed up | PASSED |
| Authorized TECNO visible in `adb devices -l` | **FAILED — no device listed** |
| Installed TECNO package/version/signing inspected | **COULD NOT BE TESTED** |
| APK launch smoke test | **COULD NOT BE TESTED** |
| Test credentials confirmed | **COULD NOT BE TESTED** |
| Unsynced local drafts/cache reviewed with tester | **COULD NOT BE TESTED** |

The destructive device gate is therefore closed. The current TECNO app was not uninstalled and the new APK was not installed.

Uninstall warning for the tester: uninstalling clears SecureStore/session state, local survey drafts, cached PDFs, local chatbot context, and other unsynced local test state.

## Device/install results

- ADB target: no authorized device connected.
- Uninstall result: **NOT RUN**.
- Install result: **NOT RUN**.
- Launch result: **NOT RUN**.
- Physical regression: **COULD NOT BE TESTED**.
- Network matrix on TECNO: **COULD NOT BE TESTED**.

The only authorized uninstall command remains:

```text
adb uninstall com.lilycrest.lilycrestdorm
```

It must not be executed until the remaining safety checks pass with the TECNO CLA5 connected and authorized.
