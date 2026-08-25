/* global test, __dirname */
// Unit coverage for scripts/eas-copy-google-services.js, the eas-build-
// pre-install hook. Runs the script as a real child process (it's a plain
// Node CLI script, not an importable module) against a scratch copy of the
// frontend/ tree so it never touches the real repo's gitignored
// google-services.json / GoogleService-Info.plist.
//
// This exists because the iOS half of this script (materializing
// GoogleService-Info.plist from GOOGLE_SERVICES_PLIST) is new: previously
// only Android's google-services.json was handled, and the missing iOS half
// is the confirmed root cause of iOS Google Sign-In's OAuth callback never
// completing (no REVERSED_CLIENT_ID URL scheme gets injected during
// `expo prebuild` without the plist present).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoFrontend = path.resolve(__dirname, '../..');

function makeScratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-copy-google-services-'));
  fs.mkdirSync(path.join(dir, 'android', 'app'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(repoFrontend, 'scripts', 'eas-copy-google-services.js'),
    path.join(dir, 'scripts', 'eas-copy-google-services.js'),
  );
  return dir;
}

function runScript(dir, env) {
  // console.warn goes to stderr, console.log to stdout — combine both so
  // assertions can check for either without caring which stream a given
  // branch happens to use.
  const result = spawnSync('node', ['scripts/eas-copy-google-services.js'], {
    cwd: dir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return `${result.stdout || ''}${result.stderr || ''}`;
}

describe('eas-copy-google-services.js pre-install hook', () => {
  let dir;

  beforeEach(() => {
    dir = makeScratchProject();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('materializes both android/app/google-services.json and GoogleService-Info.plist when both env vars are set', () => {
    const jsonSource = path.join(dir, 'fake-google-services.json');
    const plistSource = path.join(dir, 'fake-GoogleService-Info.plist');
    fs.writeFileSync(jsonSource, '{"project_info":{}}');
    fs.writeFileSync(plistSource, '<plist></plist>');

    const output = runScript(dir, {
      GOOGLE_SERVICES_JSON: jsonSource,
      GOOGLE_SERVICES_PLIST: plistSource,
    });

    expect(fs.readFileSync(path.join(dir, 'android', 'app', 'google-services.json'), 'utf8')).toBe('{"project_info":{}}');
    expect(fs.readFileSync(path.join(dir, 'GoogleService-Info.plist'), 'utf8')).toBe('<plist></plist>');
    expect(output).toContain('Copied GOOGLE_SERVICES_JSON');
    expect(output).toContain('Copied GOOGLE_SERVICES_PLIST');
  });

  test('warns (but does not crash) when GOOGLE_SERVICES_PLIST is unset and no plist already exists', () => {
    const jsonSource = path.join(dir, 'fake-google-services.json');
    fs.writeFileSync(jsonSource, '{}');

    const output = runScript(dir, {
      GOOGLE_SERVICES_JSON: jsonSource,
      GOOGLE_SERVICES_PLIST: '',
    });

    expect(fs.existsSync(path.join(dir, 'GoogleService-Info.plist'))).toBe(false);
    expect(output).toContain('GOOGLE_SERVICES_PLIST is not set');
    expect(output).toContain('iOS Google Sign-In will fail to build');
  });

  test('reuses an existing on-disk plist when GOOGLE_SERVICES_PLIST is unset', () => {
    fs.writeFileSync(path.join(dir, 'GoogleService-Info.plist'), '<plist>existing</plist>');
    const jsonSource = path.join(dir, 'fake-google-services.json');
    fs.writeFileSync(jsonSource, '{}');

    const output = runScript(dir, {
      GOOGLE_SERVICES_JSON: jsonSource,
      GOOGLE_SERVICES_PLIST: '',
    });

    expect(fs.readFileSync(path.join(dir, 'GoogleService-Info.plist'), 'utf8')).toBe('<plist>existing</plist>');
    expect(output).toContain('GOOGLE_SERVICES_PLIST not set; using existing');
  });
});
