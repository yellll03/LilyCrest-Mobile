#!/usr/bin/env node
// Runs as the `eas-build-pre-install` hook (see package.json).
//
// This project commits a bare `android/` project but no `ios/` project, so
// EAS Build's per-platform workflow detection treats Android as generic/bare
// (never runs `expo prebuild` for it — the `android.googleServicesFile`
// field in app.config.js is never consumed by EAS; the
// com.google.gms.google-services Gradle plugin reads android/app/
// google-services.json directly) and treats iOS as managed (EAS DOES run
// `expo prebuild` for iOS, which consumes `ios.googleServicesFile` from
// app.config.js to derive the native GoogleService-Info.plist wiring,
// including the REVERSED_CLIENT_ID URL scheme Google Sign-In's OAuth
// callback needs).
//
// Both files are gitignored and just sit on disk for local builds. On EAS
// each must be materialized from its own file environment variable before
// install/prebuild runs, or the corresponding platform's Google Sign-In
// silently breaks (Android: Gradle build fails; iOS: prebuild either fails
// outright or, if a stale local plist happens to be present, produces the
// wrong/missing URL scheme so the Google OAuth callback never returns to
// the app).
const fs = require('fs');
const path = require('path');

function materialize({ label, targetPath, envVar }) {
  const source = process.env[envVar];
  if (source) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(source, targetPath);
    console.log(`[eas-build-pre-install] Copied ${envVar} into ${path.relative(path.join(__dirname, '..'), targetPath)}`);
  } else if (fs.existsSync(targetPath)) {
    console.log(`[eas-build-pre-install] ${envVar} not set; using existing ${path.relative(path.join(__dirname, '..'), targetPath)}`);
  } else {
    console.warn(
      `[eas-build-pre-install] ${envVar} is not set and ${path.relative(path.join(__dirname, '..'), targetPath)} is missing. `
      + `${label} Google Sign-In will fail to build. Set the ${envVar} file variable in the EAS environment used by this build profile.`
    );
  }
}

materialize({
  label: 'Android',
  targetPath: path.join(__dirname, '..', 'android', 'app', 'google-services.json'),
  envVar: 'GOOGLE_SERVICES_JSON',
});

materialize({
  label: 'iOS',
  targetPath: path.join(__dirname, '..', 'GoogleService-Info.plist'),
  envVar: 'GOOGLE_SERVICES_PLIST',
});
