const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const appConfig = fs.readFileSync(path.join(root, 'app.config.js'), 'utf8');
const apiConfig = fs.readFileSync(path.join(root, 'src', 'config', 'api.js'), 'utf8');

const failures = [];
const productionUrl = 'https://api.lilycrest.space';

for (const profileName of ['release', 'production']) {
  const profile = eas.build?.[profileName] || {};
  const resolved = profile.extends ? { ...eas.build[profile.extends], ...profile } : profile;
  if (resolved.developmentClient === true) failures.push(`${profileName} must not be a development client`);
}

const staging = eas.build?.staging || {};
if (staging.env?.EXPO_PUBLIC_DEPLOYMENT_ENV !== 'staging') failures.push('staging profile must identify itself as staging');
if (staging.env?.EXPO_PUBLIC_BACKEND_URL === productionUrl) failures.push('staging profile must never inline the production API URL');
if (staging.environment !== 'preview') failures.push('staging profile must use the isolated EAS preview environment');
if (staging.android?.gradleCommand !== ':app:assembleStagingRelease') failures.push('staging must build the staging Android flavor');

const production = eas.build?.production || {};
if (production.env?.EXPO_PUBLIC_DEPLOYMENT_ENV !== 'production') failures.push('production profile must identify itself as production');
if (production.env?.EXPO_PUBLIC_BACKEND_URL !== productionUrl) failures.push(`production must target ${productionUrl}`);
if (production.android?.gradleCommand !== ':app:bundleProductionRelease') failures.push('production must build the production Android flavor');

for (const requiredSource of [
  "productFlavors",
  'applicationIdSuffix ".staging"',
  'com.lilycrest.API_BASE_URL',
  'verifyStagingApkTarget',
  'assembleStagingRelease',
]) {
  const haystack = requiredSource === 'assembleStagingRelease'
    ? JSON.stringify(eas)
    : requiredSource === 'com.lilycrest.API_BASE_URL'
      ? fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
      : gradle;
  if (!haystack.includes(requiredSource)) failures.push(`missing Android isolation contract: ${requiredSource}`);
}

if (!appConfig.includes("deploymentEnvironment: DEPLOYMENT_ENVIRONMENT")) failures.push('Expo config must expose the deployment environment');
if (!apiConfig.includes("normalized === PRODUCTION_MOBILE_BACKEND_URL")) failures.push('runtime staging API guard is missing');

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

console.log(`Release contract OK: ${configVersion} (${configCode}); development/staging/production are isolated.`);
