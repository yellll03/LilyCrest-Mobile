/* global __dirname */
const fs = require('fs');
const path = require('path');

describe('Android release identity', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '../../app.config.js'), 'utf8');
  const gradle = fs.readFileSync(path.resolve(__dirname, '../../android/app/build.gradle'), 'utf8');

  it('keeps Expo and native Android version declarations synchronized', () => {
    const expoVersion = config.match(/version:\s*'([^']+)'/)?.[1];
    const expoVersionCode = Number(config.match(/versionCode:\s*(\d+)/)?.[1]);
    const nativeVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    const nativeVersionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);

    expect(expoVersion).toBe(nativeVersion);
    expect(expoVersionCode).toBe(nativeVersionCode);
    expect(nativeVersion).toBe('1.1.10');
    expect(nativeVersionCode).toBe(12);
  });

  it('keeps the production application ID unchanged', () => {
    expect(config).toContain("package: 'com.lilycrest.lilycrestdorm'");
    expect(gradle).toContain("applicationId 'com.lilycrest.lilycrestdorm'");
  });
});
