#!/usr/bin/env node
// Runs as the `eas-build-pre-install` hook (see package.json).
//
// This project commits a bare `android/` project (no `ios/`, so EAS Build
// treats it as generic/bare and never runs `expo prebuild`). That means the
// `android.googleServicesFile` field in app.config.js is never consumed by
// EAS — the com.google.gms.google-services Gradle plugin reads the file
// directly from android/app/google-services.json. Locally that file is
// gitignored and just sits on disk; on EAS it must be materialized from the
// GOOGLE_SERVICES_JSON file environment variable before Gradle runs.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'android', 'app', 'google-services.json');
const source = process.env.GOOGLE_SERVICES_JSON;

if (source) {
  fs.copyFileSync(source, target);
  console.log('[eas-build-pre-install] Copied GOOGLE_SERVICES_JSON into android/app/google-services.json');
} else if (fs.existsSync(target)) {
  console.log('[eas-build-pre-install] GOOGLE_SERVICES_JSON not set; using existing android/app/google-services.json');
} else {
  console.warn(
    '[eas-build-pre-install] GOOGLE_SERVICES_JSON is not set and android/app/google-services.json is missing. ' +
    'Google Sign-In will fail to build. Set the GOOGLE_SERVICES_JSON file variable in the EAS environment used by this build profile.'
  );
}
