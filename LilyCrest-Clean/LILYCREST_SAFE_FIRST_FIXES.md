# LilyCrest Safe First Fixes

These are conservative first fixes only. They should be committed and tested separately. Do not implement them until Phase 0 backup/baseline is complete.

## 1. Capture Baseline Verification

Why safe: Documentation-only.

Likely files affected:
- `docs/` or a new baseline report file

Acceptance criteria:
- Record current passing `npm.cmd run lint`.
- Record current passing `npm.cmd test -- --runInBand`.
- Record current backend syntax check.
- Record current `npx expo-doctor` dependency mismatch.

Must not change:
- App code, dependencies, native folders.

## 2. Patch Expo SDK 54 Version Mismatches

Why safe: Patch-level Expo alignment recommended by Expo doctor.

Likely files affected:
- `frontend/package.json`
- `frontend/package-lock.json`

Exact issue:
- `npx expo-doctor` expects `expo ~54.0.35`, `expo-file-system ~19.0.23`, `expo-font ~14.0.12`, `expo-router ~6.0.24`.

Acceptance criteria:
- Use Expo-compatible install tooling, not manual major upgrades.
- `npx expo-doctor` passes or only has documented accepted warnings.
- Lint/Jest still pass.

Must not change:
- No SDK major upgrade.
- No `npm audit fix --force`.

## 3. Add Explicit Localhost/LAN Rejection in Mobile Release URL Resolver

Why safe: Prevents release misconfiguration without changing the intended production URL.

Likely files affected:
- `frontend/src/config/api.js`
- focused unit test if test harness is added for config

Exact issue:
- Current resolver rejects empty, admin domain, Render, and Cloudflare tunnel at `frontend/src/config/api.js:5-19`, but not `localhost`, `127.0.0.1`, `10.0.2.2`, or `192.168.x.x`.

Acceptance criteria:
- `EXPO_PUBLIC_BACKEND_URL=https://mobile-api.lilycrest.space` still resolves to the production mobile API.
- Localhost/LAN values cannot be used in non-dev release mode.

Must not change:
- Do not alter endpoint paths or API behavior.

## 4. Remove or Ignore Tracked Android Build Logs

Why safe: Build-output cleanup only.

Likely files affected:
- `frontend/android/build_output.txt`
- `frontend/android/build_command_output.txt`
- `.gitignore`

Exact issue:
- Both build output files are tracked; generated folders are already ignored.

Acceptance criteria:
- No source/native config changes.
- Android source files remain untouched.

Must not change:
- Do not delete `frontend/android/`.
- Do not regenerate native projects.

## 5. Add iOS Bundle Identifier and Permission Text Only After Confirmation

Why safe: Config-only, but needs product confirmation.

Likely files affected:
- `frontend/app.config.js`

Exact issue:
- `frontend/app.config.js:13-18` lacks `ios.bundleIdentifier` and `ios.infoPlist`.

Acceptance criteria:
- Add confirmed bundle ID.
- Add permission text for camera, photo library, Face ID, and notifications.
- `npx expo config --type public` shows iOS config.

Must not change:
- Do not create `ios/`.
- Do not change app scheme/payment behavior in the same commit.

## 6. Document Secret Rotation and Firebase Key Restrictions

Why safe: Operational documentation only unless owner proceeds with rotation externally.

Likely files affected:
- `docs/` or security checklist
- secret managers outside repo

Exact issue:
- Firebase client config files exist in Git history.
- Local backend `.env` contains live secret values, though ignored and not tracked.

Acceptance criteria:
- List variable names to rotate/restrict without printing values.
- Confirm `.env` and Google service files remain ignored.

Must not change:
- Do not print or commit secret values.
- Do not rewrite Git history without coordination.

## 7. Add iOS EAS Profiles After Bundle ID Exists

Why safe: Build-profile addition only.

Likely files affected:
- `frontend/eas.json`

Exact issue:
- `frontend/eas.json:5-40` defines Android `buildType` settings but no iOS-specific simulator/internal/TestFlight profiles.

Acceptance criteria:
- Add iOS simulator/development/internal/production profile structure.
- Existing Android profiles remain behavior-compatible.

Must not change:
- Do not submit to App Store/TestFlight yet.
- Do not change backend URL behavior in the same commit.

## 8. Add Focused Tests for URL Resolution and Auth Shape Guards

Why safe: Test-only if no production code changes are bundled.

Likely files affected:
- `frontend/src/tests/*`

Exact issue:
- API URL release fallback and auth payload shape checks are important and currently lightly covered.

Acceptance criteria:
- Tests cover rejected local backend URLs.
- Tests cover invalid session payload handling.

Must not change:
- No production logic changes in the same commit unless the test demonstrates a confirmed bug and the fix is tiny.
