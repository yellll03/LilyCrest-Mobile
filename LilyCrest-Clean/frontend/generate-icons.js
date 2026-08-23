/**
 * Generate every Android launcher asset from the approved LilyCrest diamond.
 *
 * The splash screen has its own approved source (`splash-image.png`) and is
 * intentionally not touched here. Keeping launcher generation focused avoids
 * accidentally restoring retired wordmarks or artwork during a native build.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = __dirname;
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ASSETS = path.join(ROOT, 'assets', 'images');
const DIAMOND_MARK = path.join(ASSETS, 'lilycrest-mark.png');
const NAVY = '#0A1628';
const MARK_RATIO = 0.62;

const DENSITIES = [
  { dir: 'mipmap-mdpi', icon: 48, foreground: 108 },
  { dir: 'mipmap-hdpi', icon: 72, foreground: 162 },
  { dir: 'mipmap-xhdpi', icon: 96, foreground: 216 },
  { dir: 'mipmap-xxhdpi', icon: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', icon: 192, foreground: 432 },
];

const transparentCanvas = (size) => sharp({
  create: {
    width: size,
    height: size,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
});

const backgroundSvg = (size, round) => Buffer.from(
  round
    ? `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${NAVY}"/></svg>`
    : `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="${NAVY}"/></svg>`,
);

async function resizedDiamond(size, ratio = MARK_RATIO) {
  const markSize = Math.round(size * ratio);
  return sharp(DIAMOND_MARK)
    .resize(markSize, markSize, { fit: 'contain' })
    .png()
    .toBuffer();
}

async function diamondPlacement(size, ratio = MARK_RATIO) {
  const diamond = await resizedDiamond(size, ratio);
  const metadata = await sharp(diamond).metadata();
  return {
    input: diamond,
    left: Math.round((size - metadata.width) / 2),
    top: Math.round((size - metadata.height) / 2),
  };
}

async function buildLegacyIcon(size, { round = false } = {}) {
  const placement = await diamondPlacement(size);
  return transparentCanvas(size)
    .composite([{ input: backgroundSvg(size, round), left: 0, top: 0 }, placement])
    .webp({ lossless: true })
    .toBuffer();
}

async function buildAdaptiveForeground(size) {
  const placement = await diamondPlacement(size);
  return transparentCanvas(size)
    .composite([placement])
    .webp({ lossless: true })
    .toBuffer();
}

async function buildAppIcon(size) {
  const placement = await diamondPlacement(size);
  return transparentCanvas(size)
    .composite([{ input: backgroundSvg(size, false), left: 0, top: 0 }, placement])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function buildAdaptiveAsset(size = 864) {
  const placement = await diamondPlacement(size);
  return transparentCanvas(size)
    .composite([placement])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function generateAdaptiveIcons() {
  for (const { dir, foreground } of DENSITIES) {
    const destination = path.join(RES, dir, 'ic_launcher_foreground.webp');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, await buildAdaptiveForeground(foreground));
  }
  fs.writeFileSync(path.join(ASSETS, 'adaptive-icon.png'), await buildAdaptiveAsset());
}

async function generateIcons() {
  for (const { dir, icon, foreground } of DENSITIES) {
    const destination = path.join(RES, dir);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'ic_launcher.webp'), await buildLegacyIcon(icon));
    fs.writeFileSync(path.join(destination, 'ic_launcher_round.webp'), await buildLegacyIcon(icon, { round: true }));
    fs.writeFileSync(path.join(destination, 'ic_launcher_foreground.webp'), await buildAdaptiveForeground(foreground));
  }

  fs.writeFileSync(path.join(ASSETS, 'icon.png'), await buildAppIcon(1024));
  fs.writeFileSync(path.join(ASSETS, 'adaptive-icon.png'), await buildAdaptiveAsset());
  fs.writeFileSync(path.join(ASSETS, 'favicon.png'), await buildAppIcon(48));
}

if (require.main === module) {
  generateIcons()
    .then(() => console.log('Generated LilyCrest diamond launcher assets.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  DENSITIES,
  DIAMOND_MARK,
  buildAdaptiveAsset,
  buildAdaptiveForeground,
  buildAppIcon,
  buildLegacyIcon,
  generateAdaptiveIcons,
  generateIcons,
};
