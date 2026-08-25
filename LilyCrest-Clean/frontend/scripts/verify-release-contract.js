const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const appConfig = fs.readFileSync(path.join(root, 'app.config.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const failures = [];
for (const profileName of ['release', 'preview', 'production']) {
  const profile = eas.build?.[profileName] || {};
  if (profile.developmentClient === true) {
    failures.push(`${profileName} must not be a development client`);
  }
  if (profile.env?.EXPO_PUBLIC_BACKEND_URL !== 'https://api.lilycrest.space') {
    failures.push(`${profileName} must target https://api.lilycrest.space`);
  }
}

const configVersion = appConfig.match(/version:\s*'([^']+)'/)?.[1];
const configCode = Number(appConfig.match(/versionCode:\s*(\d+)/)?.[1]);
const nativeVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const nativeCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
if (configVersion !== nativeVersion) failures.push('app.config.js and build.gradle versionName differ');
if (configCode !== nativeCode) failures.push('app.config.js and build.gradle versionCode differ');

// There is no committed native ios/ project to cross-check against (EAS
// runs `expo prebuild` for iOS from this file), so app.config.js is the only
// source of truth for ios.buildNumber. TestFlight/App Store Connect requires
// it to be a strictly-increasing positive integer string — catch a
// non-numeric or missing value here rather than at EAS submit time.
const iosBuildNumber = appConfig.match(/buildNumber:\s*'([^']+)'/)?.[1];
if (!iosBuildNumber || !/^\d+$/.test(iosBuildNumber) || Number(iosBuildNumber) <= 0) {
  failures.push(`ios.buildNumber must be a positive integer string, got ${JSON.stringify(iosBuildNumber)}`);
}

// This project has no committed ios/ project, so GoogleService-Info.plist
// must be materialized on the EAS build worker before `expo prebuild` runs
// (see scripts/eas-copy-google-services.js) or iOS Google Sign-In's OAuth
// callback URL scheme silently never gets registered. Guard against that
// hook being edited away without anyone noticing.
const preInstallHook = packageJson.scripts?.['eas-build-pre-install'] || '';
if (!preInstallHook.includes('eas-copy-google-services.js')) {
  failures.push('package.json eas-build-pre-install must run scripts/eas-copy-google-services.js (materializes GoogleService-Info.plist/google-services.json on EAS)');
}
const preInstallScript = fs.readFileSync(path.join(root, 'scripts', 'eas-copy-google-services.js'), 'utf8');
if (!preInstallScript.includes('GOOGLE_SERVICES_PLIST')) {
  failures.push('scripts/eas-copy-google-services.js must materialize GoogleService-Info.plist from GOOGLE_SERVICES_PLIST for iOS builds');
}

if (failures.length) {
  console.error(`Release contract failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Release contract OK: ${configVersion} (${configCode}), canonical API, standalone profiles.`);
