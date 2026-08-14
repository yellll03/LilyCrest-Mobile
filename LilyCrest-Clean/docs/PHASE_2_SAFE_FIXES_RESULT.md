# Phase 2 Safe Fixes Result

Date: 2026-07-12

Branch: `master`

Repository root: `D:\LilyCrest\LilyCrest-Clean`

## Scope Completed

Implemented only the approved low-risk Phase 2 items after capturing Phase 0 baseline:

- Expo SDK 54 patch alignment.
- Removal of tracked Android build-output text logs.
- Production API URL validation hardening for local/private backend URLs.
- Focused unit tests for the API URL resolver.

No authentication flow, payment flow, iOS native configuration, API endpoint contract, UI redesign, Android manifest/Gradle/signing configuration, Expo prebuild, or secret rotation was intentionally changed.

## Files Changed By This Task

- `.gitignore`
- `docs/PHASE_0_BASELINE.md`
- `docs/PHASE_2_SAFE_FIXES_RESULT.md`
- `frontend/android/build_output.txt` removed
- `frontend/android/build_command_output.txt` removed
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/src/config/api.js`
- `frontend/src/tests/apiConfig.test.js`

The repository also contains many pre-existing modified/untracked files that were not part of this task.

## Dependency Versions

| Package | Before | After | Tooling |
|---|---:|---:|---|
| `expo` | `54.0.34` installed, `^54.0.33` in `package.json` | `54.0.35`, `~54.0.35` | `npx expo install expo@~54.0.35 ...` |
| `expo-file-system` | `19.0.22` installed, `^19.0.21` in `package.json` | `19.0.23`, `~19.0.23` | `npx expo install expo-file-system@~19.0.23 ...` |
| `expo-font` | `14.0.11`, `~14.0.11` | `14.0.12`, `~14.0.12` | `npx expo install expo-font@~14.0.12 ...` |
| `expo-router` | `6.0.23`, `~6.0.23` | `6.0.24`, `~6.0.24` | `npx expo install expo-router@~6.0.24 ...` |
| `babel-preset-expo` | Transitively available/hoisted before install; not direct | `54.0.11`, direct dev dependency | `npx expo install --dev babel-preset-expo@~54.0.11` |

Why `babel-preset-expo` was added: after Expo patch alignment, npm nested the preset under `expo`, but `frontend/babel.config.js` references `babel-preset-expo` by package name. Jest could no longer resolve it until the exact SDK 54 preset was restored as a direct dev dependency. This preserves the existing Babel config contract.

Final installed versions:

```text
babel-preset-expo@54.0.11
expo@54.0.35
expo-file-system@19.0.23
expo-font@14.0.12
expo-router@6.0.24
```

## Tests Added

Added `frontend/src/tests/apiConfig.test.js`.

Coverage added:

- Valid production URL `https://mobile-api.lilycrest.space` is accepted.
- Production mode rejects:
  - `localhost`
  - `127.0.0.1`
  - `0.0.0.0`
  - `10.0.2.2`
  - private `10.x.x.x`
  - private `172.16.x.x` through `172.31.x.x`
  - private `192.168.x.x`
- Public IPv4 addresses are not classified as private.
- Development mode still permits local backend URLs.
- Existing fallback behavior remains for legacy disallowed hosts such as `api.lilycrest.space` and Render.

## Command Results

### Frontend Lint

Command:

```text
npm.cmd run lint
```

Result: Passed.

### Frontend Jest

Command:

```text
npm.cmd test -- --runInBand
```

Result: Passed.

Final output:

```text
PASS src/tests/useAssistantChat.test.js
PASS src/tests/attachmentPicker.test.js
PASS src/tests/apiConfig.test.js

Test Suites: 3 passed, 3 total
Tests:       18 passed, 18 total
Snapshots:   0 total
```

### Expo Doctor

Command:

```text
npx.cmd expo-doctor
```

Result: Passed.

Final output:

```text
Running 17 checks on your project...
17/17 checks passed. No issues detected!
```

Remaining known warning:

```text
The appConfigFieldsNotSyncedCheck is disabled.
```

### Backend Syntax Checks

Command:

```text
Get-ChildItem -Recurse -Filter *.js | Where-Object {$_.FullName -notmatch '\\node_modules\\'} | ForEach-Object { node --check $_.FullName }
```

Result: Passed.

Final output:

```text
backend syntax checks completed
```

### Expo Public Config

Command:

```text
npx.cmd expo config --type public
```

Result: Passed.

Observed config remained on Expo SDK 54 and retained the existing app identifiers/config:

```text
sdkVersion: '54.0.0'
scheme: 'frontend'
ios: { supportsTablet: true }
android.package: 'com.lilycrest.lilycrestdorm'
```

### Git Diff Check

Command:

```text
git diff --check
```

Result: Passed with exit code 0.

Warnings observed: Git reported LF-to-CRLF working-copy warnings for several existing modified files. No whitespace errors were reported.

### Git Status

Command:

```text
git status --short
```

Result: Completed.

Task-related entries:

```text
 M .gitignore
 D frontend/android/build_command_output.txt
 D frontend/android/build_output.txt
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/src/config/api.js
?? docs/PHASE_0_BASELINE.md
?? docs/PHASE_2_SAFE_FIXES_RESULT.md
?? frontend/src/tests/apiConfig.test.js
```

The broader status still includes pre-existing modified/untracked files from before this task.

### Git Diff Stat

Command:

```text
git diff --stat
```

Result: Completed.

The full stat is noisy because it includes pre-existing work. Task-scoped diff stat for tracked files:

```text
.gitignore                                      |    2 +
frontend/android/build_command_output.txt      | 9763 --------------------
frontend/android/build_output.txt              | 1422 ---
frontend/package-lock.json                     | 1385 +--
frontend/package.json                          |    9 +-
frontend/src/config/api.js                     |   58 +-
```

Untracked task files are not included in `git diff --stat` until staged.

## Remaining Warnings

- `npx expo install` initially timed out while still running in the background. It partially updated `expo`; after stopping the stuck install process, the remaining approved packages were aligned successfully with `npx expo install`.
- `npx expo install` for `expo-font` exited nonzero because Expo CLI could not automatically write plugin config into dynamic `app.config.js`. No config plugin was added because this task was dependency alignment only and validation passes.
- After dependency alignment, Jest temporarily failed because `babel-preset-expo` was no longer hoisted. Adding `babel-preset-expo@~54.0.11` as a dev dependency restored the existing Babel config behavior.
- `git diff --check` emits line-ending warnings but no whitespace errors.
- Pre-existing uncommitted work remains in many unrelated files.

## Intentionally Not Changed

- Authentication and session behavior.
- Payment and PayMongo behavior.
- iOS bundle ID, iOS permission strings, Apple credentials, APNs, or `GoogleService-Info.plist`.
- Android source files, manifest, Gradle config, package identifier, ABI settings, signing config, or native project generation.
- Backend routes, controllers, middleware, environment variables, or secrets.
- UI layout/design.
- Dependency removal.
- `npm audit fix` or `npm audit fix --force`.
- Expo prebuild or native regeneration.
