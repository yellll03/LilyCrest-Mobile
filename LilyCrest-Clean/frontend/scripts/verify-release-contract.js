const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const appConfig = fs.readFileSync(path.join(root, 'app.config.js'), 'utf8');

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

if (failures.length) {
  console.error(`Release contract failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Release contract OK: ${configVersion} (${configCode}), canonical API, standalone profiles.`);
