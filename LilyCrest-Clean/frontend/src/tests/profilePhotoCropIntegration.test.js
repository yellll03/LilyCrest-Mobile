/* global test, __dirname */
import fs from 'fs';
import path from 'path';

const profileSource = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/profile.jsx'), 'utf8');

describe('profile photo crop integration', () => {
  test('the system picker returns the original image into the deterministic in-app crop flow', () => {
    expect(profileSource).toContain('allowsEditing: false');
    expect(profileSource).toContain('setPhotoCropAsset(result.assets[0])');
    expect(profileSource).toContain('<ProfilePhotoCropModal');
  });

  test('only the confirmed cropped preview is persisted to the canonical profile', () => {
    expect(profileSource).toContain('const saveCroppedPhoto = async (croppedAsset) =>');
    expect(profileSource).toContain('persistCanonicalProfileImage(croppedAsset, userId)');
    expect(profileSource).toContain("setProfileBanner({ type: 'success', text: 'Profile picture updated.' })");
  });
});
