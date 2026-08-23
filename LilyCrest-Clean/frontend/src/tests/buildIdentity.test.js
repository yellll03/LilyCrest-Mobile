/* global __dirname */
const fs = require('fs');
const path = require('path');

describe('Android release identity', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '../../app.config.js'), 'utf8');
  const gradle = fs.readFileSync(path.resolve(__dirname, '../../android/app/build.gradle'), 'utf8');
  const about = fs.readFileSync(path.resolve(__dirname, '../../app/about.jsx'), 'utf8');
  const settings = fs.readFileSync(path.resolve(__dirname, '../../app/settings.jsx'), 'utf8');

  it('keeps Expo and native Android version declarations synchronized', () => {
    const expoVersion = config.match(/version:\s*'([^']+)'/)?.[1];
    const expoVersionCode = Number(config.match(/versionCode:\s*(\d+)/)?.[1]);
    const nativeVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    const nativeVersionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);

    expect(expoVersion).toBe(nativeVersion);
    expect(expoVersionCode).toBe(nativeVersionCode);
    expect(nativeVersion).toBe('1.2.2');
    expect(nativeVersionCode).toBe(21);
  });

  it('keeps the production application ID unchanged', () => {
    const previousEnvironment = process.env.EXPO_PUBLIC_DEPLOYMENT_ENV;
    process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = 'production';
    jest.resetModules();
    const productionConfig = require('../../app.config.js');
    if (previousEnvironment === undefined) delete process.env.EXPO_PUBLIC_DEPLOYMENT_ENV;
    else process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = previousEnvironment;

    expect(productionConfig.expo.android.package).toBe('com.lilycrest.lilycrestdorm');
    expect(productionConfig.expo.ios.bundleIdentifier).toBe('com.lilycrest.lilycrestdorm');
    expect(gradle).toContain("applicationId 'com.lilycrest.lilycrestdorm'");
  });

  it('gives staging an installable identity distinct from production', () => {
    const previousEnvironment = process.env.EXPO_PUBLIC_DEPLOYMENT_ENV;
    process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = 'staging';
    jest.resetModules();
    const stagingConfig = require('../../app.config.js');
    if (previousEnvironment === undefined) delete process.env.EXPO_PUBLIC_DEPLOYMENT_ENV;
    else process.env.EXPO_PUBLIC_DEPLOYMENT_ENV = previousEnvironment;

    expect(stagingConfig.expo.android.package).toBe('com.lilycrest.lilycrestdorm.staging');
    expect(stagingConfig.expo.ios.bundleIdentifier).toBe('com.lilycrest.lilycrestdorm.staging');
    expect(stagingConfig.expo.scheme).toBe('lilycrest-staging');
  });

  it('renders the configured release version instead of stale hardcoded copy', () => {
    expect(about).toContain("Constants.expoConfig?.version || 'Unknown'");
    expect(settings).toContain("Constants.expoConfig?.version || 'Unknown'");
    expect(about).not.toContain('Version 1.0.0');
    expect(settings).not.toContain('v1.0.0');
  });
});
