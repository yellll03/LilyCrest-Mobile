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
});
