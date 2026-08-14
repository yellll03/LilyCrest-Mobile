# Final Mobile Polish and Pre-Release Report

## Outcome

A frozen Android pre-release APK was built and cryptographically verified. The installed TECNO application was **not** uninstalled because no authorized ADB device is connected and the local-state/test-credential safety checks cannot be completed.

Final decision: **PRE-RELEASE APK NOT READY FOR CLIENT TESTING**

The artifact is ready for the device gate, but client-testing readiness cannot be declared without clean-install and physical/network regression evidence.

## Completed updates

- Fixed offline session restoration to retain a validated cached tenant profile when a secure session token exists and the API is temporarily unreachable.
- Removed the redundant health-gate dependency from session hydration; Firebase password reset already uses Firebase directly.
- Added approved move-in-day billing date and exact grace/penalty boundary functions and tests.
- Updated non-contract tenant policy wording to the approved billing schedule.
- Replaced the single-page PDF engine that silently omitted overflow with A4 multi-page rendering, wrapped tables/paragraphs, page numbering and readable Unicode fallback.
- Removed the generated PDF engine's default hardcoded Gil Puyat footer.
- Added 50 MB PDF safety limit, metadata size, Android directory download, duplicate-safe filename and Download action.
- Preserved native zoom, page navigation, rotation support, offline per-tenant cache, retry, share, MIME and `%PDF` validation.
- Retained all Phase 4A–4C branch, assistant and tenant-survey integration.
- Increased Android version from `1.0.0 (1)` to `1.1.0 (2)`.

## Modified files in final polish

### Mobile

- `frontend/app.config.js`
- `frontend/android/app/build.gradle`
- `frontend/app/document-viewer.jsx`
- `frontend/app/house-rules.jsx`
- `frontend/app/my-documents.jsx`
- `frontend/app/terms-of-service.jsx`
- `frontend/src/context/AuthContext.js`
- `frontend/src/services/documentManager.js`

### Backend/shared generation

- `backend/config/chatbot.presets.js`
- `backend/controllers/documents.controller.js`
- `backend/domain/billing/billingPolicy.js`
- `backend/utils/pdfBuilder.js`
- `backend/tests/billingPolicy.test.js`
- `backend/tests/pdfBuilderPagination.test.js`

Supporting freeze/evidence documents and release logs were also added.

## Automated regression

| Check | Result |
|---|---|
| Frontend full suite | PASSED — 66/66 |
| Backend full suite | PASSED — 98/98 |
| Authentication focused | PASSED — 26/26 |
| Survey mobile focused | PASSED — 12/12 |
| Branch/chatbot/upload/maintenance/security/billing/PDF/survey focused backend | PASSED — 50/50 |
| Expo lint | PASSED |
| Expo Doctor | PASSED — 17/17 |
| Expo dependency compatibility | PASSED — up to date |
| Backend Node syntax | PASSED |
| Android release build | PASSED — 954 tasks |

The known test-console warnings are native-module availability warnings inside Jest and the intentionally exercised secure-storage migration warning. They do not fail tests or appear as lint/build errors.

## APK

- artifact: [LilyCrest-PreRelease-1.1.0-vc2-20260724.apk](D:/LilyCrest/LilyCrest-Clean/frontend/builds/LilyCrest-PreRelease-1.1.0-vc2-20260724.apk)
- package: `com.lilycrest.lilycrestdorm`
- version: `1.1.0`
- version code: `2`
- size: 59,503,540 bytes
- SHA-256: `A317BE3DED5EB61B68F3788AA32CF0F6064B194B02B9116568FFBC8B7B26B2FC`
- certificate SHA-256: `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`
- certificate SHA-1: `5E8F16062EA3CD2C4A0D547876BA6F38CABF625`
- signing: RSA 2048, APK Signature Scheme v2
- backend: `https://mobile-api.lilycrest.space`
- backend health: HTTP 200
- native ABI: arm64-v8a
- PDFium/Hermes/React Native native libraries: present
- Git HEAD: `4c9728a0823d0856fbff9a752eaff934ef593dfd`
- frozen source manifest SHA-256: `B262B0EF9B5235715576A61BD4410A7DDCC7DCA1DA314FD6BAA91778EF8328EB`

The APK uses the internal debug certificate whose SHA-1 matches the configured Firebase/Google Android certificate hash. It is suitable for this internal pre-release path, not Play production distribution.

## Remaining blockers

### Code blocker

None known.

### Build blocker

None.

### Backend deployment blocker

Frozen backend changes need coordinated deployment. A healthy endpoint does not prove every new route/controller is deployed.

### Production data blocker

- canonical Gil Puyat and Guadalupe branch records;
- canonical tenant contracts;
- controlled quarterly/move-out surveys and eligible/ineligible test accounts.

### Client approval blocker

- official Gil Puyat Google Maps destination and coordinates;
- approved replacement, if any, for legacy “5th of each month” wording inside the lease template. The legal template was not modified.

### Physical test blocker

- `adb devices -l`: no device listed;
- current TECNO package/version/certificate not inspectable;
- test credentials and unsynced local-state review not confirmed;
- uninstall, install, launch, physical regression and device network matrix not run.

### Optional future enhancement

- embedded full Unicode PDF font;
- stored-document indexing;
- persistent assistant memory;
- centrally owned distributed survey reminder scheduler.

## Pre-uninstall result

Artifact/package/version/checksum/signing/build/tests/evidence checks passed.

Device, current-package, credentials, unsynced-local-state and smoke-test checks did not pass because the TECNO is unavailable. The command below was therefore **not executed**:

```text
adb uninstall com.lilycrest.lilycrestdorm
```

No unrelated package was touched.

Uninstalling later will erase SecureStore/session data, local survey drafts, cached PDFs, local assistant context and other unsynced test state.

## Physical regression matrix

| Area | Result |
|---|---|
| Authentication and password reset | COULD NOT BE TESTED |
| Google Sign-In | COULD NOT BE TESTED |
| Session restoration/logout/account switching | COULD NOT BE TESTED |
| Profile/branch/maps | COULD NOT BE TESTED |
| Billing/payment/penalty boundaries | COULD NOT BE TESTED |
| Surveys/drafts/validation/history | COULD NOT BE TESTED |
| Assistant multilingual/account/attachments/privacy | COULD NOT BE TESTED |
| Documents/PDF/contract/download/share/cache | COULD NOT BE TESTED |
| Maintenance/attachments/status | COULD NOT BE TESTED |
| Announcements/notifications | COULD NOT BE TESTED |
| Small screen/landscape/keyboard/TalkBack | COULD NOT BE TESTED |

## Network matrix

| Network | Login | Reset | Profile | Billing | Surveys | Assistant | Documents | Maintenance |
|---|---|---|---|---|---|---|---|---|
| Primary Wi-Fi | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Mobile data | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Offline | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Alternative Wi-Fi | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |
| Slow/unstable | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED | COULD NOT BE TESTED |

## Evidence

- [Scope freeze](D:/LilyCrest/LilyCrest-Clean/docs/FINAL_MOBILE_SCOPE_FREEZE_2026-07-24.md)
- [APK and safety evidence](D:/LilyCrest/LilyCrest-Clean/docs/PRE_RELEASE_APK_1.1.0_VC2_EVIDENCE.md)
- test/build/source evidence: `release-evidence/pre-release-1.1.0-vc2-20260724/`

## Next gate

Connect and authorize the TECNO CLA5, confirm test credentials and whether any local drafts/cache must be preserved, then rerun the pre-uninstall checklist. Only after all items pass should the old package be uninstalled, this exact checksum-matched APK installed, and the complete physical/network matrix executed.
