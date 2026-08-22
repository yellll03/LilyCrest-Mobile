const sharp = require('sharp');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets', 'images', 'icon.png');

// Bounding box of just the building+phone glyph in icon.png (1254x1254),
// excluding the "LilyCrest / Dormitory Management App" wordmark below it.
const glyphBox = { left: 370, top: 210, width: 520, height: 560 };

const MASTER_SIZE = 864;
const SAFE_ZONE_RATIO = 0.62; // glyph occupies ~62% of the 108dp canvas, inside the ~66% mask safe zone

const densities = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

async function buildMaster() {
  const glyph = await sharp(source).extract(glyphBox).toBuffer();
  const innerSize = Math.round(MASTER_SIZE * SAFE_ZONE_RATIO);
  const resizedGlyph = await sharp(glyph)
    .resize({ width: innerSize, height: innerSize, fit: 'inside' })
    .toBuffer();
  const meta = await sharp(resizedGlyph).metadata();
  const left = Math.round((MASTER_SIZE - meta.width) / 2);
  const top = Math.round((MASTER_SIZE - meta.height) / 2);

  return sharp({
    create: {
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resizedGlyph, left, top }])
    .png()
    .toBuffer();
}

async function main() {
  const master = await buildMaster();

  await sharp(master).toFile(path.join(root, 'assets', 'images', 'adaptive-icon.png'));

  for (const [density, size] of Object.entries(densities)) {
    const out = path.join(
      root,
      'android',
      'app',
      'src',
      'main',
      'res',
      `mipmap-${density}`,
      'ic_launcher_foreground.webp'
    );
    await sharp(master).resize(size, size).webp({ lossless: true }).toFile(out);
    console.log('wrote', out);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
