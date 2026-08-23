#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const flavor = String(process.env.LILYCREST_ANDROID_FLAVOR || process.env.EXPO_PUBLIC_DEPLOYMENT_ENV || '').trim().toLowerCase();
if (!['development', 'staging', 'production'].includes(flavor)) {
  console.error('[eas-build-pre-install] LILYCREST_ANDROID_FLAVOR must be development, staging, or production.');
  process.exit(1);
}

const source = process.env.GOOGLE_SERVICES_JSON;
const target = path.join(__dirname, '..', 'android', 'app', 'src', flavor, 'google-services.json');

if (!source || !fs.existsSync(source)) {
  if (fs.existsSync(target)) {
    console.log(`[eas-build-pre-install] Using existing ${flavor} google-services.json.`);
    process.exit(0);
  }
  console.error(`[eas-build-pre-install] GOOGLE_SERVICES_JSON is required for the ${flavor} flavor; refusing to reuse another flavor's credentials.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`[eas-build-pre-install] Installed Google services credentials for the ${flavor} flavor.`);
