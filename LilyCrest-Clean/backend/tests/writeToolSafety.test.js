'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const writePattern = /(?:\.save\s*\(|\.create\s*\(|insert(?:One|Many)\s*\(|update(?:One|Many)\s*\(|delete(?:One|Many)\s*\(|findOneAnd(?:Update|Delete|Replace)\s*\(|replaceOne\s*\(|bulkWrite\s*\(|dropDatabase\s*\()/i;

function scriptFiles() {
  const scriptsDir = path.join(backendRoot, 'scripts');
  return fs.readdirSync(scriptsDir)
    .filter((name) => /\.(?:c?js|mjs)$/.test(name))
    .map((name) => path.join(scriptsDir, name));
}

test('every direct database-write script imports the fail-closed staging guard', () => {
  const candidates = [
    ...scriptFiles(),
    path.join(backendRoot, 'migration_script.js'),
    path.join(backendRoot, 'migration_script_fixed.js'),
    path.join(backendRoot, 'reseed_billing.js'),
  ];

  const unsafe = candidates.filter((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return writePattern.test(source) && !source.includes('assertStagingWriteTarget');
  });

  assert.deepEqual(unsafe.map((file) => path.relative(backendRoot, file)), []);
});

test('publisher and approval tools are guarded even when writes happen through APIs or libraries', () => {
  for (const relative of [
    'scripts/publishTenantTestContract.js',
    'scripts/approveCanonicalBranch.js',
    'scripts/approveIdentityCrosswalk.js',
  ]) {
    assert.match(fs.readFileSync(path.join(backendRoot, relative), 'utf8'), /assertStagingWriteTarget/);
  }
});
