/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('standalone release artifact contract', () => {
  test.each(['release', 'preview', 'production'])('%s is not a development-client profile', (profile) => {
    const eas = JSON.parse(read('eas.json'));
    expect(eas.build[profile].developmentClient).toBe(false);
    expect(eas.build[profile].env.EXPO_PUBLIC_BACKEND_URL).toBe('https://api.lilycrest.space');
  });

  test('native and Expo versions are bumped together', () => {
    const config = read('app.config.js');
    const gradle = read('android/app/build.gradle');
    expect(config).toContain("version: '1.2.2'");
    expect(config).toContain('versionCode: 21');
    expect(gradle).toContain('versionName "1.2.2"');
    expect(gradle).toContain('versionCode 21');
  });

  test('iOS release keeps Google sign-in pods modular and export compliance explicit', () => {
    const config = read('app.config.js');
    const firebase = read('src/config/firebase.js');
    const packageJson = JSON.parse(read('package.json'));
    const eas = JSON.parse(read('eas.json'));

    expect(packageJson.dependencies['expo-build-properties']).toBe('~1.0.10');
    expect(config).toContain("{ name: 'GoogleUtilities', modular_headers: true }");
    expect(config).toContain("{ name: 'RecaptchaInterop', modular_headers: true }");
    expect(config).toContain('ITSAppUsesNonExemptEncryption: false');
    expect(config).toContain("buildNumber: '23'");
    expect(config).toContain("googleServicesFile: process.env.GOOGLE_SERVICES_PLIST || './GoogleService-Info.plist'");
    expect(config).toContain("'@react-native-google-signin/google-signin'");
    expect(packageJson.dependencies['expo-local-authentication']).toBeUndefined();
    expect(config).not.toContain("'expo-local-authentication'");
    expect(config).not.toContain('faceIDPermission');
    expect(read('android/app/src/main/AndroidManifest.xml')).not.toMatch(/USE_BIOMETRIC|USE_FINGERPRINT/);
    expect(firebase).toContain("Platform.OS === 'android' ? firebaseNativeConfig : firebaseWebConfig");
    expect(eas.build.release.environment).toBe('production');
    expect(eas.build.production.environment).toBe('production');
  });

  // Regression: this repo has no committed native ios/ project, so EAS runs
  // `expo prebuild` for iOS from app.config.js. If GoogleService-Info.plist
  // isn't materialized on the build worker before that prebuild step, the
  // @react-native-google-signin/google-signin config plugin can't derive the
  // REVERSED_CLIENT_ID URL scheme, so the Google OAuth callback silently
  // never returns control to the app on iOS. See scripts/verify-release-
  // contract.js for the equivalent build-time check.
  test('iOS build provenance: buildNumber is a valid TestFlight integer and the plist materialization hook is wired', () => {
    const config = read('app.config.js');
    const packageJson = JSON.parse(read('package.json'));
    const preInstallHook = packageJson.scripts?.['eas-build-pre-install'] || '';
    const preInstallScript = read('scripts/eas-copy-google-services.js');

    const iosBuildNumber = config.match(/buildNumber:\s*'([^']+)'/)?.[1];
    expect(iosBuildNumber).toMatch(/^\d+$/);
    expect(Number(iosBuildNumber)).toBeGreaterThan(0);

    expect(preInstallHook).toContain('eas-copy-google-services.js');
    expect(preInstallScript).toContain('GOOGLE_SERVICES_JSON');
    expect(preInstallScript).toContain('GOOGLE_SERVICES_PLIST');
  });
});
