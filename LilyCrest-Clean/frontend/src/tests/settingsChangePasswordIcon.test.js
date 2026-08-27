/* global test, __dirname */
const fs = require('fs');
const path = require('path');

// Regression: in dark mode the Change Password row's lock icon used
// `colors.heading` on a faint `accentSubtle` fill and effectively vanished.
// It now uses the gold `colors.accent` for the glyph, with a 1px
// `colors.accentLight` border around the `accentSubtle` fill so the chip has
// a visible edge in both themes. Only this one Security-section icon is
// changed — the other Settings icons keep their existing treatment.

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'settings.jsx'),
  'utf8',
);

describe('Settings — Change Password icon contrast', () => {
  test('the lock-closed icon uses the gold accent colour', () => {
    // Isolate the region around the lock-closed icon.
    const idx = SRC.indexOf("name=\"lock-closed\"");
    expect(idx).toBeGreaterThan(-1);
    const region = SRC.slice(Math.max(0, idx - 400), idx + 120);
    expect(/name="lock-closed"[\s\S]*color=\{colors\.accent\}/.test(region)).toBe(true);
    // No longer the low-contrast heading colour on this icon.
    expect(/name="lock-closed"[\s\S]*color=\{colors\.heading\}/.test(region)).toBe(false);
  });

  test('the icon chip has an accentLight border over the accentSubtle fill', () => {
    const idx = SRC.indexOf("name=\"lock-closed\"");
    const region = SRC.slice(Math.max(0, idx - 400), idx);
    expect(region.includes('backgroundColor: colors.accentSubtle')).toBe(true);
    expect(region.includes('borderWidth: 1')).toBe(true);
    expect(region.includes('borderColor: colors.accentLight')).toBe(true);
  });

  test('no other Settings icon was switched to the accent border treatment', () => {
    // The accentLight border only appears once — for the Change Password chip.
    const occurrences = SRC.split('borderColor: colors.accentLight').length - 1;
    expect(occurrences).toBe(1);
  });
});
