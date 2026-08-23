/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('standalone release artifact contract', () => {
  test.each(['staging', 'production'])('%s is not a development-client profile', (profile) => {
    const eas = JSON.parse(read('eas.json'));
    expect(eas.build[profile].developmentClient).toBe(false);
  });

  test('staging and production use distinct endpoint and Android-flavor contracts', () => {
    const eas = JSON.parse(read('eas.json'));
    expect(eas.build.staging.env.EXPO_PUBLIC_DEPLOYMENT_ENV).toBe('staging');
    expect(eas.build.staging.env.NODE_ENV).toBe('production');
    expect(eas.build.staging.env.EXPO_PUBLIC_BACKEND_URL).not.toBe('https://api.lilycrest.space');
    expect(eas.build.staging.android.gradleCommand).toBe(':app:assembleStagingRelease');
    expect(eas.build.production.env.EXPO_PUBLIC_DEPLOYMENT_ENV).toBe('production');
    expect(eas.build.production.env.NODE_ENV).toBe('production');
    expect(eas.build.production.env.EXPO_PUBLIC_BACKEND_URL).toBe('https://api.lilycrest.space');
    expect(eas.build.production.android.gradleCommand).toBe(':app:bundleProductionRelease');
  });

  test('native and Expo versions are bumped together', () => {
    const config = read('app.config.js');
    const gradle = read('android/app/build.gradle');
    expect(config).toContain("version: '1.2.2'");
    expect(config).toContain('versionCode: 21');
    expect(gradle).toContain('versionName "1.2.2"');
    expect(gradle).toContain('versionCode 21');
  });
});
