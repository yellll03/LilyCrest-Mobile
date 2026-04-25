/**
 * LilyCrest Icon Generator
 * Writes WebP launcher icons to every Android mipmap density,
 * updates splash drawables, and regenerates assets/images sources.
 */

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

const RES  = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
const ASSETS = path.join(__dirname, 'assets', 'images');

// ── SVGs ─────────────────────────────────────────────────────────────────

// Full icon (navy bg + lily + wordmark)
function iconSvg(size) {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%">
      <stop offset="0%"  stop-color="#2A4F80"/>
      <stop offset="100%" stop-color="#1E3A5F"/>
    </radialGradient>
    <radialGradient id="pg" cx="50%" cy="0%" r="100%">
      <stop offset="0%"  stop-color="#F08040"/>
      <stop offset="100%" stop-color="#C05018"/>
    </radialGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${s*0.2}" ry="${s*0.2}" fill="url(#bg)"/>
  <g transform="translate(${s/2},${s*0.42})">
    <g fill="url(#pg)">
      <ellipse cx="0" cy="${-s*0.22}" rx="${s*0.085}" ry="${s*0.19}" transform="rotate(0)"/>
      <ellipse cx="0" cy="${-s*0.22}" rx="${s*0.085}" ry="${s*0.19}" transform="rotate(60)"/>
      <ellipse cx="0" cy="${-s*0.22}" rx="${s*0.085}" ry="${s*0.19}" transform="rotate(120)"/>
      <ellipse cx="0" cy="${-s*0.22}" rx="${s*0.085}" ry="${s*0.19}" transform="rotate(180)"/>
      <ellipse cx="0" cy="${-s*0.22}" rx="${s*0.085}" ry="${s*0.19}" transform="rotate(240)"/>
      <ellipse cx="0" cy="${-s*0.22}" rx="${s*0.085}" ry="${s*0.19}" transform="rotate(300)"/>
    </g>
    <g fill="#FFD080">
      <circle cx="0" cy="${-s*0.1}" r="${s*0.014}" transform="rotate(0)"/>
      <circle cx="0" cy="${-s*0.1}" r="${s*0.014}" transform="rotate(60)"/>
      <circle cx="0" cy="${-s*0.1}" r="${s*0.014}" transform="rotate(120)"/>
      <circle cx="0" cy="${-s*0.1}" r="${s*0.014}" transform="rotate(180)"/>
      <circle cx="0" cy="${-s*0.1}" r="${s*0.014}" transform="rotate(240)"/>
      <circle cx="0" cy="${-s*0.1}" r="${s*0.014}" transform="rotate(300)"/>
    </g>
    <circle cx="0" cy="0" r="${s*0.072}" fill="#FFFFFF" opacity="0.95"/>
    <circle cx="0" cy="0" r="${s*0.05}"  fill="#D4682A"/>
    <circle cx="0" cy="0" r="${s*0.022}" fill="#FFFFFF" opacity="0.9"/>
  </g>
</svg>`;
}

// Foreground only — transparent bg, flower centred, scaled for adaptive icon safe zone
function foregroundSvg(size) {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs>
    <radialGradient id="pg" cx="50%" cy="0%" r="100%">
      <stop offset="0%"  stop-color="#F08040"/>
      <stop offset="100%" stop-color="#C05018"/>
    </radialGradient>
  </defs>
  <g transform="translate(${s/2},${s*0.45})">
    <g fill="url(#pg)">
      <ellipse cx="0" cy="${-s*0.24}" rx="${s*0.09}" ry="${s*0.21}" transform="rotate(0)"/>
      <ellipse cx="0" cy="${-s*0.24}" rx="${s*0.09}" ry="${s*0.21}" transform="rotate(60)"/>
      <ellipse cx="0" cy="${-s*0.24}" rx="${s*0.09}" ry="${s*0.21}" transform="rotate(120)"/>
      <ellipse cx="0" cy="${-s*0.24}" rx="${s*0.09}" ry="${s*0.21}" transform="rotate(180)"/>
      <ellipse cx="0" cy="${-s*0.24}" rx="${s*0.09}" ry="${s*0.21}" transform="rotate(240)"/>
      <ellipse cx="0" cy="${-s*0.24}" rx="${s*0.09}" ry="${s*0.21}" transform="rotate(300)"/>
    </g>
    <g fill="#FFD080">
      <circle cx="0" cy="${-s*0.11}" r="${s*0.015}" transform="rotate(0)"/>
      <circle cx="0" cy="${-s*0.11}" r="${s*0.015}" transform="rotate(60)"/>
      <circle cx="0" cy="${-s*0.11}" r="${s*0.015}" transform="rotate(120)"/>
      <circle cx="0" cy="${-s*0.11}" r="${s*0.015}" transform="rotate(180)"/>
      <circle cx="0" cy="${-s*0.11}" r="${s*0.015}" transform="rotate(240)"/>
      <circle cx="0" cy="${-s*0.11}" r="${s*0.015}" transform="rotate(300)"/>
    </g>
    <circle cx="0" cy="0" r="${s*0.078}" fill="#FFFFFF" opacity="0.95"/>
    <circle cx="0" cy="0" r="${s*0.054}" fill="#D4682A"/>
    <circle cx="0" cy="0" r="${s*0.024}" fill="#FFFFFF" opacity="0.9"/>
  </g>
</svg>`;
}

// Splash logo — lily + wordmark on transparent bg
function splashLogoSvg(size) {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs>
    <radialGradient id="pg" cx="50%" cy="0%" r="100%">
      <stop offset="0%"  stop-color="#F08040"/>
      <stop offset="100%" stop-color="#C05018"/>
    </radialGradient>
  </defs>
  <g transform="translate(${s/2},${s*0.35})">
    <g fill="url(#pg)">
      <ellipse cx="0" cy="${-s*0.2}" rx="${s*0.075}" ry="${s*0.175}" transform="rotate(0)"/>
      <ellipse cx="0" cy="${-s*0.2}" rx="${s*0.075}" ry="${s*0.175}" transform="rotate(60)"/>
      <ellipse cx="0" cy="${-s*0.2}" rx="${s*0.075}" ry="${s*0.175}" transform="rotate(120)"/>
      <ellipse cx="0" cy="${-s*0.2}" rx="${s*0.075}" ry="${s*0.175}" transform="rotate(180)"/>
      <ellipse cx="0" cy="${-s*0.2}" rx="${s*0.075}" ry="${s*0.175}" transform="rotate(240)"/>
      <ellipse cx="0" cy="${-s*0.2}" rx="${s*0.075}" ry="${s*0.175}" transform="rotate(300)"/>
    </g>
    <g fill="#FFD080">
      <circle cx="0" cy="${-s*0.092}" r="${s*0.012}" transform="rotate(0)"/>
      <circle cx="0" cy="${-s*0.092}" r="${s*0.012}" transform="rotate(60)"/>
      <circle cx="0" cy="${-s*0.092}" r="${s*0.012}" transform="rotate(120)"/>
      <circle cx="0" cy="${-s*0.092}" r="${s*0.012}" transform="rotate(180)"/>
      <circle cx="0" cy="${-s*0.092}" r="${s*0.012}" transform="rotate(240)"/>
      <circle cx="0" cy="${-s*0.092}" r="${s*0.012}" transform="rotate(300)"/>
    </g>
    <circle cx="0" cy="0" r="${s*0.065}" fill="#FFFFFF" opacity="0.95"/>
    <circle cx="0" cy="0" r="${s*0.045}" fill="#D4682A"/>
    <circle cx="0" cy="0" r="${s*0.02}"  fill="#FFFFFF" opacity="0.9"/>
  </g>
  <text x="${s/2}" y="${s*0.72}"
    font-family="Georgia,serif" font-size="${s*0.13}" font-weight="700"
    fill="#FFFFFF" text-anchor="middle" letter-spacing="${s*0.005}">LilyCrest</text>
  <text x="${s/2}" y="${s*0.84}"
    font-family="Georgia,serif" font-size="${s*0.05}" font-style="italic"
    fill="#D4682A" text-anchor="middle" letter-spacing="${s*0.01}">Dormitory</text>
</svg>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function writeWebp(svgStr, w, h, destPath) {
  await sharp(Buffer.from(svgStr))
    .resize(w, h)
    .webp({ quality: 95 })
    .toFile(destPath);
}

async function writePng(svgStr, w, h, destPath) {
  await sharp(Buffer.from(svgStr))
    .resize(w, h)
    .png({ compressionLevel: 9 })
    .toFile(destPath);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function generate() {
  console.log('Generating LilyCrest icons…\n');

  // Launcher icon sizes (dp × density scale)
  const densities = [
    { dir: 'mipmap-mdpi',    icon: 48,  fg: 108 },
    { dir: 'mipmap-hdpi',    icon: 72,  fg: 162 },
    { dir: 'mipmap-xhdpi',   icon: 96,  fg: 216 },
    { dir: 'mipmap-xxhdpi',  icon: 144, fg: 324 },
    { dir: 'mipmap-xxxhdpi', icon: 192, fg: 432 },
  ];

  for (const { dir, icon, fg } of densities) {
    const d = path.join(RES, dir);
    fs.mkdirSync(d, { recursive: true });

    await writeWebp(iconSvg(icon * 4), icon, icon,
      path.join(d, 'ic_launcher.webp'));
    await writeWebp(iconSvg(icon * 4), icon, icon,
      path.join(d, 'ic_launcher_round.webp'));
    await writeWebp(foregroundSvg(fg * 4), fg, fg,
      path.join(d, 'ic_launcher_foreground.webp'));

    console.log(`✓  ${dir.padEnd(20)} launcher ${icon}px  foreground ${fg}px`);
  }

  // Splash screen logos (png, transparent bg)
  const splashDensities = [
    { dir: 'drawable-mdpi',    size: 200 },
    { dir: 'drawable-hdpi',    size: 300 },
    { dir: 'drawable-xhdpi',   size: 400 },
    { dir: 'drawable-xxhdpi',  size: 600 },
    { dir: 'drawable-xxxhdpi', size: 800 },
  ];

  for (const { dir, size } of splashDensities) {
    const d = path.join(RES, dir);
    fs.mkdirSync(d, { recursive: true });
    await writePng(splashLogoSvg(size * 4), size, size,
      path.join(d, 'splashscreen_logo.png'));
    console.log(`✓  ${dir.padEnd(20)} splash  ${size}px`);
  }

  // assets/images sources (used by Expo / Metro)
  await writePng(iconSvg(1024 * 4), 1024, 1024,
    path.join(ASSETS, 'icon.png'));
  await writePng(foregroundSvg(1024 * 4), 1024, 1024,
    path.join(ASSETS, 'adaptive-icon.png'));
  await writePng(splashLogoSvg(2048), 1024, 1024,
    path.join(ASSETS, 'splash-image.png'));
  await writePng(iconSvg(192), 48, 48,
    path.join(ASSETS, 'favicon.png'));

  console.log('\n✓  assets/images sources updated');
  console.log('\nAll icons generated successfully.');
}

generate().catch(e => { console.error(e.message); process.exit(1); });
