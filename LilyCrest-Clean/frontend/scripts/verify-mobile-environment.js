#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const profile = String(process.argv[2] || process.env.EXPO_PUBLIC_DEPLOYMENT_ENV || '').trim().toLowerCase();
const productionApi = 'https://api.lilycrest.space';
const marker = /(?:^|[-_.])(staging|stage|qa|e2e|test|dev)(?:$|[-_.])/i;
const failures = [];
const value = (name) => String(process.env[name] || '').trim();

if (!['staging', 'production'].includes(profile)) failures.push('profile must be staging or production');
if (value('EXPO_PUBLIC_DEPLOYMENT_ENV') !== profile) failures.push('EXPO_PUBLIC_DEPLOYMENT_ENV must match the requested profile');

const apiUrl = value('EXPO_PUBLIC_BACKEND_URL').replace(/\/+$/, '');
if (profile === 'staging') {
  let stagingApiHost = '';
  try {
    stagingApiHost = new URL(apiUrl).hostname;
  } catch (_) {
    // The consolidated failure below is intentionally credential-free.
  }
  if (!apiUrl || apiUrl === productionApi || !/^https:\/\//.test(apiUrl) || !marker.test(stagingApiHost)) {
    failures.push('staging API must be a public HTTPS host with a staging/QA marker and must not be production');
  }
} else if (apiUrl !== productionApi) {
  failures.push(`production API must equal ${productionApi}`);
}

for (const name of [
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID',
  'EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
]) {
  if (!value(name)) failures.push(`${name} is required`);
}

const projectId = value('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
const bucket = value('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET');
if (profile === 'staging' && (!marker.test(projectId) || !marker.test(bucket))) {
  failures.push('staging Firebase project and bucket must carry a staging/QA marker');
}
if (profile === 'production' && (marker.test(projectId) || marker.test(bucket))) {
  failures.push('production Firebase configuration contains a staging/QA marker');
}

const packageName = profile === 'staging'
  ? 'com.lilycrest.lilycrestdorm.staging'
  : 'com.lilycrest.lilycrestdorm';
const configuredGoogleServices = value('GOOGLE_SERVICES_JSON');
const flavorFile = path.resolve(__dirname, '..', 'android', 'app', 'src', profile, 'google-services.json');
const googleServicesFile = configuredGoogleServices || flavorFile;

if (!fs.existsSync(googleServicesFile)) {
  failures.push(`a ${profile} google-services.json is required`);
} else {
  try {
    const googleServices = JSON.parse(fs.readFileSync(googleServicesFile, 'utf8'));
    const jsonProject = String(googleServices.project_info?.project_id || '');
    const packages = (googleServices.client || [])
      .map((client) => client.client_info?.android_client_info?.package_name)
      .filter(Boolean);
    if (jsonProject !== projectId) failures.push('google-services.json project_id does not match EXPO_PUBLIC_FIREBASE_PROJECT_ID');
    if (!packages.includes(packageName)) failures.push(`google-services.json does not contain Android package ${packageName}`);
    if (profile === 'staging' && !marker.test(jsonProject)) failures.push('staging google-services.json points to a production-looking project');
    if (profile === 'production' && marker.test(jsonProject)) failures.push('production google-services.json points to a staging-looking project');
  } catch (_) {
    failures.push('google-services.json is not valid JSON');
  }
}

if (failures.length) {
  console.error(`Mobile ${profile || 'unknown'} environment verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Mobile ${profile} environment verified: ${apiUrl}; Firebase project ${projectId}; package ${packageName}.`);
