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
    expect(config).toContain("buildNumber: '2'");
    expect(config).toContain("googleServicesFile: process.env.GOOGLE_SERVICES_PLIST || './GoogleService-Info.plist'");
    expect(config).toContain("'@react-native-google-signin/google-signin'");
    expect(config).toContain("'expo-local-authentication'");
    expect(config).toContain('Allow LilyCrest to use Face ID to unlock your authorized session.');
    expect(firebase).toContain("Platform.OS === 'android' ? firebaseNativeConfig : firebaseWebConfig");
    expect(eas.build.release.environment).toBe('production');
    expect(eas.build.production.environment).toBe('production');
  });
});
