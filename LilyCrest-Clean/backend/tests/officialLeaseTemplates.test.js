'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPROVED_TEMPLATE_KEYS, LONG_BOND, selectTemplate, verifyTemplateIntegrity, validateTemplateReadiness,
} = require('../domain/contracts/templateRegistry');
const { TEMPLATE_FIELD_MAPS } = require('../domain/contracts/templateFieldMaps');

test('all six official template combinations resolve without a default', () => {
  assert.equal(APPROVED_TEMPLATE_KEYS.length, 6);
  assert.equal(selectTemplate('PRIVATE_ROOM', 'SHORT_TERM').filename, 'Lease_Private_Room_ShortTerm.pdf');
  assert.equal(selectTemplate('DOUBLE_SHARING', 'LONG_TERM').filename, 'Lease_Double_Sharing_LongTerm.pdf');
  assert.equal(selectTemplate('QUADRUPLE_SHARING', 'SHORT_TERM').filename, 'Lease_Quadruple_Sharing_ShortTerm.pdf');
  assert.equal(selectTemplate('UNKNOWN', 'SHORT_TERM'), null);
  assert.equal(selectTemplate('', ''), null);
});

test('every official source template matches its approved SHA-256', () => {
  for (const key of APPROVED_TEMPLATE_KEYS) {
    const result = verifyTemplateIntegrity(selectTemplate(...key.split(/_(?=(?:SHORT|LONG)_TERM$)/)));
    assert.equal(result.ok, true, `${key} integrity`);
    assert.equal(result.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.match(result.bytes.toString('latin1'), /\/MediaBox\s*\[\s*0\s+0\s+612(?:\.0+)?\s+936(?:\.0+)?\s*\]/);
  }
});

test('official templates use 8.5 by 13 inch long bond dimensions', () => {
  assert.deepEqual(LONG_BOND, { widthPoints: 612, heightPoints: 936, widthInches: 8.5, heightInches: 13 });
});

test('every approved template owns a complete bounded coordinate map', () => {
  assert.deepEqual(Object.keys(TEMPLATE_FIELD_MAPS).sort(), [...APPROVED_TEMPLATE_KEYS].sort());
  for (const key of APPROVED_TEMPLATE_KEYS) {
    const fields = TEMPLATE_FIELD_MAPS[key];
    assert.equal(Object.keys(fields).length, 12, `${key} field count`);
    for (const [name, field] of Object.entries(fields)) {
      assert.equal(field.page, 1, `${key}.${name} page`);
      assert.ok(field.x >= 0 && field.y >= 0, `${key}.${name} origin`);
      assert.ok(field.x + field.width <= LONG_BOND.widthPoints, `${key}.${name} horizontal bounds`);
      assert.ok(field.y + field.height <= LONG_BOND.heightPoints, `${key}.${name} vertical bounds`);
      assert.ok(field.minFontSize > 0 && field.maxFontSize >= field.minFontSize, `${key}.${name} font bounds`);
    }
  }
});

test('templates fail closed for an unapproved branch', () => {
  const result = validateTemplateReadiness({
    roomType: 'DOUBLE_SHARING', leaseType: 'LONG_TERM', branchCode: 'GUADALUPE',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockerCode, 'TEMPLATE_BRANCH_MISMATCH');
});
