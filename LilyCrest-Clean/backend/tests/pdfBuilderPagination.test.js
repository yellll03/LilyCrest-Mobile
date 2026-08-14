'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBrandedPdf, unicodeSafeText, wrapText } = require('../utils/pdfBuilder');

test('long generated documents paginate without silently omitting tail content', () => {
  const marker = 'FINAL ACKNOWLEDGMENT MARKER';
  const pdf = buildBrandedPdf({
    title: 'Long Policy',
    sections: Array.from({ length: 40 }, (_, index) => ({
      heading: `Section ${index + 1}`,
      lines: [`This deliberately long paragraph ${index + 1} must wrap and continue to a later page without being cropped or omitted. `.repeat(3), ...(index === 39 ? [marker] : [])],
    })),
  });
  const source = pdf.toString('latin1');
  const count = Number(source.match(/\/Type \/Pages \/Count (\d+)/)?.[1] || 0);
  assert.ok(count > 1);
  assert.match(source, new RegExp(marker));
  assert.match(source, /Page 1 of/);
  assert.match(source, new RegExp(`Page ${count} of ${count}`));
});
test('long table values wrap instead of overflowing the A4 content width', () => {
  assert.ok(wrapText('A very long table description '.repeat(20), 9, 250).length > 1);
});
test('Unicode is converted readably and never silently deleted', () => {
  assert.equal(unicodeSafeText('₱50 — José • ✓'), 'PHP 50 - Jose - Yes');
  assert.equal(unicodeSafeText('tenant 😀'), 'tenant ??');
});
