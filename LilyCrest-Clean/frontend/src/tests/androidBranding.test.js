/* global __dirname */
const fs = require('fs');
const path = require('path');
const {
  DENSITIES,
  buildAdaptiveAsset,
  buildAdaptiveForeground,
  buildAppIcon,
  buildLegacyIcon,
} = require('../../generate-icons');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath));
const readText = (relativePath) => read(relativePath).toString('utf8');

describe('approved Android diamond branding', () => {
  it('renders the shared About header from the approved diamond mark', () => {
    const about = readText('app/about.jsx');
    const brandHeader = readText('src/components/BrandHeader.jsx');

    expect(about).toContain('<BrandHeader compact');
    expect(brandHeader).toContain("require('../../assets/images/lilycrest-mark.png')");
    expect(brandHeader).not.toContain("require('../../assets/images/logo-main.png')");
  });

  it('contains no retired flower artwork and preserves the approved splash source', () => {
    const generator = readText('generate-icons.js');
    const config = readText('app.config.js');

    expect(generator).toContain("const DIAMOND_MARK = path.join(ASSETS, 'lilycrest-mark.png')");
    expect(generator).not.toMatch(/ellipse|flower/i);
    expect(generator).not.toContain('splashscreen_logo.png');
    expect(generator).not.toContain("path.join(ASSETS, 'splash-image.png')");
    expect(config).toContain("icon: './assets/images/icon.png'");
    expect(config).toContain("foregroundImage: './assets/images/adaptive-icon.png'");
    expect(config).toContain("image: './assets/images/splash-image.png'");
  });

  it('matches every committed Android launcher density to the diamond generator', async () => {
    for (const { dir, icon, foreground } of DENSITIES) {
      const legacy = read(`android/app/src/main/res/${dir}/ic_launcher.webp`);
      const round = read(`android/app/src/main/res/${dir}/ic_launcher_round.webp`);
      const adaptive = read(`android/app/src/main/res/${dir}/ic_launcher_foreground.webp`);

      expect(legacy.equals(await buildLegacyIcon(icon))).toBe(true);
      expect(round.equals(await buildLegacyIcon(icon, { round: true }))).toBe(true);
      expect(adaptive.equals(await buildAdaptiveForeground(foreground))).toBe(true);
    }
  }, 30000);

  it('matches the Expo launcher sources to the diamond generator', async () => {
    expect(read('assets/images/icon.png').equals(await buildAppIcon(1024))).toBe(true);
    expect(read('assets/images/adaptive-icon.png').equals(await buildAdaptiveAsset())).toBe(true);
    expect(read('assets/images/favicon.png').equals(await buildAppIcon(48))).toBe(true);
  }, 30000);
});
