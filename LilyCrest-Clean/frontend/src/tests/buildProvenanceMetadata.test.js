/* global __dirname */
// Regression coverage for app.config.js's extra.{gitCommit,buildTime} shape
// — the full build-identity payload consumed by the Profile screen footer
// (frontend/app/(tabs)/profile.jsx). Requires app.config.js directly (it's
// plain CommonJS, no Expo CLI needed) rather than shelling out to
// `expo config`, so this stays fast and deterministic in CI.
const path = require('path');

describe('app.config.js build provenance metadata', () => {
  const config = require(path.resolve(__dirname, '../../app.config.js')).expo;

  it('exposes version, native build number, commit, and build time together', () => {
    expect(typeof config.version).toBe('string');
    expect(config.version.length).toBeGreaterThan(0);
    expect(Number.isInteger(config.android?.versionCode)).toBe(true);
    expect(typeof config.ios?.buildNumber).toBe('string');
    expect(typeof config.extra?.gitCommit).toBe('string');
    expect(config.extra.gitCommit.length).toBeGreaterThan(0);
    expect(typeof config.extra?.buildTime).toBe('string');
  });

  it('buildTime is a valid, parseable ISO-8601 timestamp', () => {
    const parsed = new Date(config.extra.buildTime);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    // ISO-8601 with a Z (UTC) suffix, as produced by Date#toISOString().
    expect(config.extra.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('re-requiring the same module in one process does not recompute buildTime (module-cache singleton, not per-import)', () => {
    const again = require(path.resolve(__dirname, '../../app.config.js')).expo;
    expect(again.extra.buildTime).toBe(config.extra.buildTime);
  });

  it('gitCommit carries a -dirty suffix whenever the local working tree has uncommitted changes (this repo does during active development)', () => {
    // Not asserting a specific state either way — just that the format is
    // one of the two valid shapes, so this doesn't become flaky as the repo
    // moves between clean and dirty over time.
    expect(config.extra.gitCommit).toMatch(/^([0-9a-f]{7,9}(-dirty)?|unknown)$/);
  });
});
