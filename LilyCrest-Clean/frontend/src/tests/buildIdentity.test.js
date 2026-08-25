/* global __dirname */
const fs = require('fs');
const path = require('path');

describe('Android release identity', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '../../app.config.js'), 'utf8');
  const gradle = fs.readFileSync(path.resolve(__dirname, '../../android/app/build.gradle'), 'utf8');
  const about = fs.readFileSync(path.resolve(__dirname, '../../app/about.jsx'), 'utf8');
  const brandHeader = fs.readFileSync(path.resolve(__dirname, '../components/BrandHeader.jsx'), 'utf8');
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
    expect(config).toContain("package: 'com.lilycrest.lilycrestdorm'");
    expect(gradle).toContain("applicationId 'com.lilycrest.lilycrestdorm'");
  });

  it('renders the configured release version instead of stale hardcoded copy', () => {
    expect(about).toContain("Constants.expoConfig?.version || 'Unknown'");
    expect(settings).toContain("Constants.expoConfig?.version || 'Unknown'");
    expect(about).not.toContain('Version 1.0.0');
    expect(settings).not.toContain('v1.0.0');
  });

  it('uses the current diamond mark in the About screen branding', () => {
    expect(about).toContain('<BrandHeader compact');
    expect(brandHeader).toContain("require('../../assets/images/lilycrest-mark.png')");
    expect(brandHeader).not.toContain("require('../../assets/images/logo-main.png')");
    expect(brandHeader).toContain('accessibilityLabel="LilyCrest diamond logo"');
  });
});

// Regression: the Profile screen's build-provenance footer (the only place
// an installed build's identity can be confirmed on-device, since this repo
// has no committed native ios/ project to inspect) previously always read
// config.android.versionCode regardless of platform, so an installed iOS
// build displayed Android's build number instead of its own
// ios.buildNumber — silently wrong provenance on exactly the platform where
// there's nothing else to cross-check it against.
describe('build provenance footer is platform-correct', () => {
  const profile = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/profile.jsx'), 'utf8');

  it('reads ios.buildNumber on iOS and android.versionCode on Android, not one for both', () => {
    expect(profile).toMatch(/Platform\.OS === 'ios'[\s\S]{0,40}config\.ios\?\.buildNumber/);
    expect(profile).toMatch(/config\.android\?\.versionCode/);
  });
});

// Regression: app.config.js's embedded commit hash used to always be a bare
// SHA even when the working tree that produced the build had uncommitted
// changes on top of it — see src/tests/gitBuildIdentity.test.js for the
// behavioral coverage of the dirty-detection logic itself. This just locks
// that app.config.js actually wires that shared module in, instead of
// reverting to an inline (untested) copy of the same logic.
describe('app.config.js delegates commit resolution to the tested shared module', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '../../app.config.js'), 'utf8');

  it('imports resolveGitCommit from scripts/gitBuildIdentity', () => {
    expect(config).toContain("require('./scripts/gitBuildIdentity')");
    expect(config).not.toContain("execSync('git status --porcelain'");
  });
});
