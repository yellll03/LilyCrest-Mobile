const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

// These values are deliberately public, non-production, and fixed. Keeping
// them here makes the QA artifact reproducible and prevents an inherited
// shell variable from silently pointing a QA package at production.
const ISOLATED_QA_PUBLIC_ENV = Object.freeze({
  NODE_ENV: 'production',
  EXPO_PUBLIC_QA_LOCAL_RUNTIME: 'true',
  EXPO_PUBLIC_BACKEND_URL: 'http://127.0.0.1:5001',
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  EXPO_PUBLIC_FIREBASE_API_KEY: 'fake-api-key-for-auth-emulator-only',
  EXPO_PUBLIC_FIREBASE_WEB_API_KEY: 'fake-api-key-for-auth-emulator-only',
  EXPO_PUBLIC_FIREBASE_ANDROID_API_KEY: 'fake-api-key-for-auth-emulator-only',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-lilycrest-qa.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-lilycrest-qa',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-lilycrest-qa.appspot.com',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  EXPO_PUBLIC_FIREBASE_WEB_APP_ID: '1:1234567890:web:isolatedqa',
  EXPO_PUBLIC_FIREBASE_ANDROID_APP_ID: '1:1234567890:android:isolatedqa',
  EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID: '',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '',
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: '',
});

function createIsolatedQaBuildEnvironment(base = process.env) {
  return { ...base, ...ISOLATED_QA_PUBLIC_ENV };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: createIsolatedQaBuildEnvironment(),
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  run(process.execPath, [path.join('scripts', 'verify-release-contract.js'), '--require-clean']);
  run(process.execPath, [path.join('scripts', 'verify-qa-runtime.js')]);

  // Recreate only the generated app module so changed EXPO_PUBLIC_* inputs can
  // never reuse a stale Metro artifact. Gradle's clean tasks traverse native
  // dependency caches and can fail on Windows when lint/CMake holds one open.
  const androidAppDir = path.resolve(root, 'android', 'app');
  const generatedBuildDir = path.resolve(androidAppDir, 'build');
  const relativeBuildDir = path.relative(androidAppDir, generatedBuildDir);
  if (relativeBuildDir !== 'build' || generatedBuildDir === androidAppDir) {
    throw new Error('Refusing to clean an unexpected QA build path.');
  }
  fs.rmSync(generatedBuildDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

  const gradleArgs = ['assembleIsolatedQaRelease', '-PlilycrestQaBuild=true'];
  if (process.platform === 'win32') {
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', ...gradleArgs], {
      cwd: path.join(root, 'android'),
    });
  } else {
    run('./gradlew', gradleArgs, { cwd: path.join(root, 'android') });
  }
}

if (require.main === module) main();

module.exports = {
  ISOLATED_QA_PUBLIC_ENV,
  createIsolatedQaBuildEnvironment,
};
