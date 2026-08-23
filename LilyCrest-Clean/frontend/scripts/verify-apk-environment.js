#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const profile = String(process.argv[2] || '').trim().toLowerCase();
const apkPath = path.resolve(process.argv[3] || '');
const productionApi = 'https://api.lilycrest.space';
const marker = /(?:^|[-.])(staging|stage|qa|e2e|test|dev)(?:[-.]|$)/i;

if (!['staging', 'production'].includes(profile)) throw new Error('APK profile must be staging or production.');
if (!apkPath || !fs.existsSync(apkPath)) throw new Error(`APK does not exist: ${apkPath}`);

function buildToolCandidates(name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  ].filter(Boolean);
  const candidates = [`${name}${suffix}`];
  for (const sdkRoot of sdkRoots) {
    const buildTools = path.join(sdkRoot, 'build-tools');
    if (!fs.existsSync(buildTools)) continue;
    const versions = fs.readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) candidates.push(path.join(buildTools, version, `${name}${suffix}`));
  }
  return candidates;
}

function runFirst(candidates, args) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, { encoding: 'utf8' });
    if (!result.error && result.status === 0) return result.stdout;
  }
  throw new Error(`Android build tool is unavailable; install SDK build-tools and ensure ANDROID_HOME is set.`);
}

const aaptCandidates = buildToolCandidates('aapt');
const badging = runFirst(aaptCandidates, ['dump', 'badging', apkPath]);
const manifest = runFirst(aaptCandidates, ['dump', 'xmltree', apkPath, 'AndroidManifest.xml']);
const expectedPackage = profile === 'staging'
  ? 'com.lilycrest.lilycrestdorm.staging'
  : 'com.lilycrest.lilycrestdorm';
const expectedApi = profile === 'staging'
  ? String(process.env.EXPO_PUBLIC_BACKEND_URL || '').trim().replace(/\/+$/, '')
  : productionApi;

let expectedApiHost = '';
try {
  expectedApiHost = new URL(expectedApi).hostname;
} catch (_) {
  // Report through the consolidated, credential-free failure below.
}
if (!expectedApi || (profile === 'staging' && (!marker.test(expectedApiHost) || expectedApi === productionApi))) {
  throw new Error('Expected staging API is missing or production-looking.');
}
if (!badging.includes(`package: name='${expectedPackage}'`)) {
  throw new Error(`APK package does not match ${expectedPackage}.`);
}
if (!manifest.includes('com.lilycrest.API_BASE_URL') || !manifest.includes(expectedApi)) {
  throw new Error(`Packaged API provenance does not match ${expectedApi}.`);
}

console.log(`APK target verified: ${path.basename(apkPath)}; package ${expectedPackage}; API ${expectedApi}.`);
