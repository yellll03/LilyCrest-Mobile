# LilyCrest Structure Audit

Date: 2026-05-20

Scope: `D:\LilyCrest\LilyCrest-Clean`

Safety notes:

- No files were deleted.
- No files or folders were moved.
- No app logic, backend logic, database logic, auth, billing, maintenance, reservation, or UI behavior was changed.
- The sibling archive and old dependency folders outside this project were not touched.
- The Git repository root is `D:\LilyCrest`, while this audit target is `D:\LilyCrest\LilyCrest-Clean`.

## 1. Current Folder Structure Summary

```text
LilyCrest-Clean/
  .gitignore
  README.md
  package.json
  package-lock.json
  generate_system_manual_pdf.py
  generate_user_manual_pdf.py
  LILYCREST_*_MANUAL.md
  LILYCREST_*_MANUAL.html
  LILYCREST_*_MANUAL.pdf
  module_progress_report.html
  .vscode/
  frontend/
    .env
    .env.example
    .gitignore
    package.json
    package-lock.json
    app.config.js
    app/
    src/
    assets/
    android/
    scripts/
    __mocks__/
    node_modules/
    .expo/
    .expo-export-check*/
    dist/
    build_output*.txt
    frontend-live-*.log
  backend/
    .env
    .env.example
    .gitignore
    package.json
    package-lock.json
    server.js
    ai/
    config/
    controllers/
    middleware/
    public/admin/
    routes/
    scripts/
    services/
    utils/
    node_modules/
    .latest-tunnel-url
    backend*.log
    cloudflared*.log
```

Assessment:

- The frontend shape is valid for a React Native Expo app using Expo Router: `frontend/package.json` has `main: "expo-router/entry"`, and the expected `app/`, `src/`, `assets/`, `android/`, Metro/Babel/EAS/Jest config files are present.
- The backend shape is valid for a Node/Express app: `backend/server.js`, `config/`, `controllers/`, `middleware/`, `routes/`, `services/`, `scripts/`, and `public/admin/` are present.
- `backend/models/` is not present. That is not automatically wrong because this backend appears to use MongoDB collections directly rather than a model layer. Only add/move models if the codebase intentionally adopts that pattern.
- No `_archive`, `_old-*`, or dependency archive folders were found inside `LilyCrest-Clean`.

## 2. Recommended Clean Folder Structure

```text
LilyCrest-Clean/
  README.md
  STRUCTURE_AUDIT.md
  .gitignore
  package.json
  package-lock.json
  docs/
    manuals/
      LILYCREST_SYSTEM_MANUAL.md
      LILYCREST_USER_MANUAL.md
    generated/
      *.html
      *.pdf
  frontend/
    .env.example
    package.json
    package-lock.json
    app.config.js
    app/
    src/
    assets/
    android/
    scripts/
    __mocks__/
  backend/
    .env.example
    package.json
    package-lock.json
    server.js
    ai/
    config/
    controllers/
    middleware/
    public/admin/
    routes/
    scripts/
    services/
    utils/
```

No moves were made in this audit. If cleanup is done later, move documentation in a separate, reviewable step.

## 3. Files And Folders That Should Stay

- `package.json` and `package-lock.json` files should stay. The frontend and backend lockfiles are especially important and should be kept with their matching package files.
- `frontend/app/`, `frontend/src/`, `frontend/assets/`, `frontend/android/`, `frontend/scripts/`, and frontend config files should stay.
- `frontend/package.json` and `frontend/package-lock.json` should stay.
- `backend/server.js`, `backend/config/`, `backend/controllers/`, `backend/middleware/`, `backend/routes/`, `backend/services/`, `backend/scripts/`, `backend/utils/`, and `backend/public/admin/` should stay.
- `backend/package.json` and `backend/package-lock.json` should stay.
- `frontend/.env.example` and `backend/.env.example` should stay.
- `frontend/.env` and `backend/.env` should stay locally but remain ignored.

## 4. Files And Folders That Should Be Ignored

Already ignored or now covered by project-local ignore rules:

- `.env`, `.env.*`, `*.env`, `*.env.*`, except `.env.example`
- `node_modules/`
- `.expo/`, `.expo-shared/`, `.expo/web/`, `.metro-cache/`
- `frontend/.expo-export-check*/`
- `dist/`, `build/`, `web-build/`, `.cache/`, `.tmp/`
- `frontend/android/build/`, `frontend/android/app/build/`
- `frontend/android/.kotlin/`
- `*.log`, including backend and Cloudflare tunnel logs
- `backend/.latest-tunnel-url`
- `build_output*.txt`, `frontend/build_output*.txt`, `frontend/android/build_output*.txt`, `frontend/android/build_command_output.txt`
- `coverage/`, `.nyc_output/`, `test-results/`, `playwright-report/`, `junit.xml`
- `docs/generated/`
- `LILYCREST_*_MANUAL.html`
- `LILYCREST_*_MANUAL.pdf`
- `module_progress_report.html`

Important Git note: ignore rules do not remove already-tracked files from Git. Some generated artifacts are already tracked and would need a separate, explicit `git rm --cached` review step if you want Git to stop tracking them later.

## 5. Files And Folders That Are Risky To Move

- `frontend/app/` because Expo Router depends on this location.
- `frontend/src/` because app code imports services/config/screens from this tree.
- `frontend/assets/` because app config and screens reference assets.
- `frontend/android/` because this is the native Android project used by Expo dev-client/prebuild workflows.
- `frontend/google-services.json` because `app.config.js` points to `./google-services.json`. Keep it local/ignored unless you intentionally commit Firebase client config.
- `backend/server.js` because package scripts start this file directly.
- `backend/config/`, `backend/controllers/`, `backend/routes/`, `backend/services/`, `backend/middleware/`, and `backend/scripts/` because runtime imports depend on these locations.
- `backend/public/admin/` because `server.js` serves it as static admin content.
- `frontend/.env` and `backend/.env` because they contain local environment configuration.
- `package.json` and `package-lock.json` files because npm behavior depends on their directory pairing.

## 6. Files That May Be Duplicate Or Misplaced

- Root `package.json` is an orchestrator with scripts that call into `backend` and `frontend`. This is acceptable, but it means running npm commands from the root is different from running them inside each app.
- Root `package-lock.json` is very small and has no dependency tree. It is not dangerous, but it can confuse people into thinking root dependencies exist.
- `frontend/build_output*.txt` are generated build logs and should not be committed in future.
- `frontend/android/build_output.txt` and `frontend/android/build_command_output.txt` are generated build logs. They are currently tracked, so ignore rules alone will not untrack them.
- Root `LILYCREST_*_MANUAL.html` and `LILYCREST_*_MANUAL.pdf` are generated docs. Prefer `docs/generated/` later.
- Root `LILYCREST_*_MANUAL.md` and manual generator scripts look like documentation source files. Prefer `docs/manuals/` later, but do not move without checking references.
- `module_progress_report.html` is generated/report-like and belongs under docs or generated reports later. It is currently tracked.
- `backend/fix_auth.js`, `backend/migration_script.js`, `backend/migration_script_fixed.js`, `backend/reseed_billing.js`, `backend/_test_email.js`, and `backend/_validate_chatbot.js` look like operational scripts. They may belong under `backend/scripts/`, but moving them is risky without checking how they are run.
- `frontend/.env` contains `EXPO_PUBLIC_IMAGEKIT_PUBLIC_KEY`, but no active frontend source reference was found during this audit.

## 7. Recommended VS Code Folder To Open

Open:

```powershell
D:\LilyCrest\LilyCrest-Clean
```

This is the best app workspace root because it contains the active frontend/backend pair and avoids showing the archive/old dependency folders as normal project files.

Note: Git itself is rooted at `D:\LilyCrest`, so `git status` can show changes outside `LilyCrest-Clean`. For scoped checks, use:

```powershell
git -C D:\LilyCrest status -- LilyCrest-Clean
```

## 8. Recommended Terminal Commands To Verify

From the active project root:

```powershell
cd D:\LilyCrest\LilyCrest-Clean
git -C D:\LilyCrest status -- LilyCrest-Clean
npm --prefix backend install
npm --prefix frontend install
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix backend start
npm --prefix frontend start
```

For day-to-day development, run the backend and frontend in separate terminals:

```powershell
cd D:\LilyCrest\LilyCrest-Clean\backend
npm run dev
```

```powershell
cd D:\LilyCrest\LilyCrest-Clean\frontend
npm start
```

## Environment Key Findings

Both `frontend/.env` and `frontend/.env.example` are present.

Both `backend/.env` and `backend/.env.example` are present.

Placeholder-only keys added to examples:

- `frontend/.env.example`: `EXPO_PUBLIC_ASSISTANT_LOGS`
- `backend/.env.example`: `FIREBASE_WEB_API_KEY`, `FIREBASE_STORAGE_BUCKET`

The `.gitignore` files now explicitly allow `.env.example` while continuing to ignore real `.env` files.

Keys present in `frontend/.env` but not in `frontend/.env.example`:

- `EXPO_PUBLIC_IMAGEKIT_PUBLIC_KEY` was found in local env, but no active frontend source usage was found. It was not added to the example.

Keys present in `frontend/.env.example` but not in `frontend/.env`:

- `EXPO_PUBLIC_ASSISTANT_LOGS` optional diagnostics flag.
- `EXPO_PUBLIC_DEV_HOST` optional fallback when `EXPO_PUBLIC_BACKEND_URL` is not set.

Keys present in `backend/.env.example` but not in `backend/.env`:

- `PORT` optional because `server.js` defaults to `8001`.
- `TRUST_PROXY_HOPS` optional because `TRUST_PROXY` is present.
- `FIREBASE_WEB_API_KEY` optional alias/fallback for auth.
- `FIREBASE_STORAGE_BUCKET` optional because backend derives a bucket from `FIREBASE_PROJECT_ID` if omitted.
- `GOOGLE_WEB_CLIENT_ID` appears in the example, but no active backend source usage was found.

Required backend env keys from `server.js` are present by name in `backend/.env`:

- `MONGO_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `PAYMONGO_SECRET_KEY`
