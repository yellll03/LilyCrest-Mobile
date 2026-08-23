'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertStagingServiceIsolation,
  assertStagingWriteTarget,
  mongoDatabaseName,
  productionSignals,
} = require('../config/environmentSafety');

const safe = () => ({
  NODE_ENV: 'production',
  LILYCREST_ENVIRONMENT: 'staging',
  STAGING_ALLOW_WRITES: 'true',
  MONGO_URL: 'mongodb://127.0.0.1:27017/lilycrest-staging-e2e',
  DB_NAME: 'lilycrest-staging-e2e',
  BACKEND_URL: 'https://staging-api.lilycrest.example',
  CONTRACT_UPSTREAM_URL: 'https://staging-contract.lilycrest.example',
  FIREBASE_PROJECT_ID: 'lilycrest-staging-qa',
  FIREBASE_STORAGE_BUCKET: 'lilycrest-staging-qa.firebasestorage.app',
  PAYMONGO_SECRET_KEY: 'sk_test_fixture',
});

test('accepts a fully isolated staging service configuration', () => {
  assert.equal(assertStagingServiceIsolation(safe(), { requireContract: true }), true);
  assert.equal(assertStagingWriteTarget(safe()), true);
});

test('extracts a database name without exposing Mongo credentials', () => {
  assert.equal(mongoDatabaseName({ MONGO_URL: 'mongodb+srv://user:secret@example.invalid/lilycrest-staging-qa' }), 'lilycrest-staging-qa');
});

for (const [label, override] of [
  ['NODE_ENV without an explicit deployment identity', { LILYCREST_ENVIRONMENT: '' }],
  ['deployment environment', { LILYCREST_ENVIRONMENT: 'production' }],
  ['API host', { BACKEND_URL: 'https://api.lilycrest.space' }],
  ['Contract host', { CONTRACT_UPSTREAM_URL: 'https://www.lilycrest.space' }],
  ['Mongo database', { DB_NAME: 'lilycrest' }],
  ['Firebase project', { FIREBASE_PROJECT_ID: 'lilycrest-production' }],
  ['Firebase bucket', { FIREBASE_STORAGE_BUCKET: 'lilycrest.firebasestorage.app' }],
]) {
  test(`refuses a write when ${label} indicates production`, () => {
    assert.throws(
      () => assertStagingWriteTarget({ ...safe(), ...override }, { toolName: 'fixture tool' }),
      (error) => error.code === 'PRODUCTION_TARGET_DETECTED' && /no writes/.test(error.message),
    );
  });
}

test('refuses a write without explicit staging opt-in', () => {
  assert.throws(
    () => assertStagingWriteTarget({ ...safe(), STAGING_ALLOW_WRITES: '' }),
    (error) => error.code === 'STAGING_WRITE_BLOCKED',
  );
});

test('production service refuses staging resources', () => {
  assert.throws(
    () => assertStagingServiceIsolation({
      NODE_ENV: 'production',
      LILYCREST_ENVIRONMENT: 'production',
      MONGO_URL: 'mongodb://example.invalid/lilycrest-staging-e2e',
      DB_NAME: 'lilycrest-staging-e2e',
      BACKEND_URL: 'https://staging-api.example.test',
      FIREBASE_PROJECT_ID: 'lilycrest-staging-qa',
      FIREBASE_STORAGE_BUCKET: 'lilycrest-staging-qa.firebasestorage.app',
    }),
    (error) => error.code === 'STAGING_ISOLATION_FAILED',
  );
});

test('production signal reports do not include credentials', () => {
  const env = { ...safe(), LILYCREST_ENVIRONMENT: '', MONGO_URL: 'mongodb+srv://user:super-secret@example.invalid/lilycrest' };
  const report = productionSignals(env).join(' ');
  assert.doesNotMatch(report, /super-secret|user:/);
});
