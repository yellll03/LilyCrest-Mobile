'use strict';

const PRODUCTION_HOSTS = new Set([
  'api.lilycrest.space',
  'www.lilycrest.space',
  'lilycrest.space',
]);

const SAFE_NON_PRODUCTION_MARKER = /(?:^|[-_.])(staging|stage|qa|e2e|test|dev|local)(?:$|[-_.])/i;

function text(value) {
  return String(value || '').trim();
}

function deploymentEnvironment(env = process.env) {
  const explicit = text(env.LILYCREST_ENVIRONMENT || env.DEPLOYMENT_ENV || env.APP_ENV);
  if (explicit) return explicit.toLowerCase();
  const nodeEnvironment = text(env.NODE_ENV).toLowerCase();
  return ['production', 'staging'].includes(nodeEnvironment) ? nodeEnvironment : 'development';
}

function urlHost(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    return raw.replace(/^\w+:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  }
}

function mongoDatabaseName(env = process.env) {
  const explicit = text(env.DB_NAME);
  if (explicit) return explicit;
  const uri = text(env.MONGO_URL || env.MONGODB_URI || env.MONGO_URI);
  if (!uri) return '';
  try {
    return decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, '').split('/')[0] || '');
  } catch (_) {
    return '';
  }
}

function hasSafeNonProductionMarker(value) {
  return SAFE_NON_PRODUCTION_MARKER.test(text(value));
}

function configuredProductionHosts(env = process.env) {
  return text(env.PRODUCTION_RESOURCE_HOSTS)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function productionSignals(env = process.env) {
  const reasons = [];
  if (deploymentEnvironment(env) === 'production') reasons.push('deployment environment is production');

  const productionHosts = new Set([...PRODUCTION_HOSTS, ...configuredProductionHosts(env)]);
  for (const name of [
    'API_HOST',
    'BACKEND_URL',
    'CANONICAL_API_URL',
    'CANONICAL_AUTH_API_ORIGIN',
    'FRONTEND_URL',
    'WEB_BASE_URL',
    'CONTRACT_UPSTREAM_URL',
  ]) {
    const host = urlHost(env[name]);
    if (host && productionHosts.has(host)) reasons.push(`${name} targets production host ${host}`);
  }

  const dbName = mongoDatabaseName(env);
  if (dbName && !hasSafeNonProductionMarker(dbName)) {
    reasons.push(`database name is not explicitly non-production (${dbName})`);
  }

  for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET']) {
    const value = text(env[name]);
    if (value && !hasSafeNonProductionMarker(value)) {
      reasons.push(`${name} is not explicitly non-production`);
    }
  }

  return [...new Set(reasons)];
}

function stagingConfigurationFailures(env = process.env, { requireContract = false } = {}) {
  const failures = [];
  if (deploymentEnvironment(env) !== 'staging') failures.push('LILYCREST_ENVIRONMENT must equal staging');
  if (text(env.STAGING_ALLOW_WRITES).toLowerCase() !== 'true') failures.push('STAGING_ALLOW_WRITES must equal true');
  if (!text(env.MONGO_URL || env.MONGODB_URI || env.MONGO_URI)) failures.push('an explicit staging MongoDB URI is required');
  const dbName = mongoDatabaseName(env);
  if (!dbName || !hasSafeNonProductionMarker(dbName)) failures.push('the database name must contain a staging/qa/e2e/test marker');

  const firebaseProject = text(env.FIREBASE_PROJECT_ID);
  const firebaseBucket = text(env.FIREBASE_STORAGE_BUCKET);
  if (!firebaseProject || !hasSafeNonProductionMarker(firebaseProject)) failures.push('FIREBASE_PROJECT_ID must identify a non-production project');
  if (!firebaseBucket || !hasSafeNonProductionMarker(firebaseBucket)) failures.push('FIREBASE_STORAGE_BUCKET must identify a non-production bucket');

  const backendHost = urlHost(env.BACKEND_URL || env.API_HOST);
  if (!backendHost || PRODUCTION_HOSTS.has(backendHost) || !hasSafeNonProductionMarker(backendHost)) {
    failures.push('BACKEND_URL/API_HOST must identify a clearly named staging/QA API');
  }

  if (requireContract) {
    const contractHost = urlHost(env.CONTRACT_UPSTREAM_URL);
    if (!contractHost || PRODUCTION_HOSTS.has(contractHost) || !hasSafeNonProductionMarker(contractHost)) {
      failures.push('CONTRACT_UPSTREAM_URL must identify a clearly named staging/QA Contract service');
    }
  }

  const paymongoKey = text(env.PAYMONGO_SECRET_KEY);
  if (paymongoKey && !paymongoKey.startsWith('sk_test_')) failures.push('PAYMONGO_SECRET_KEY must be a test key in staging');
  return [...new Set([...productionSignals({ ...env, NODE_ENV: '' }), ...failures])];
}

function assertStagingServiceIsolation(env = process.env, options = {}) {
  const target = deploymentEnvironment(env);
  let failures = [];
  if (target === 'staging') {
    failures = stagingConfigurationFailures(env, options);
  } else if (target === 'production') {
    for (const name of ['BACKEND_URL', 'API_HOST', 'CONTRACT_UPSTREAM_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET']) {
      if (hasSafeNonProductionMarker(env[name])) failures.push(`${name} contains a staging/QA marker`);
    }
    if (hasSafeNonProductionMarker(mongoDatabaseName(env))) failures.push('production database name contains a staging/QA marker');
  }
  if (failures.length) {
    const error = new Error(`${target} isolation check failed: ${failures.join('; ')}`);
    error.code = 'STAGING_ISOLATION_FAILED';
    throw error;
  }
  return true;
}

function assertStagingWriteTarget(env = process.env, { toolName = 'write tool' } = {}) {
  const signals = productionSignals(env);
  if (signals.length) {
    const error = new Error(`Production target detected; ${toolName} aborted with no writes: ${signals.join('; ')}`);
    error.code = 'PRODUCTION_TARGET_DETECTED';
    throw error;
  }

  const failures = stagingConfigurationFailures(env);
  if (failures.length) {
    const error = new Error(`Staging write guard blocked ${toolName} with no writes: ${failures.join('; ')}`);
    error.code = 'STAGING_WRITE_BLOCKED';
    throw error;
  }
  return true;
}

module.exports = {
  PRODUCTION_HOSTS,
  assertStagingServiceIsolation,
  assertStagingWriteTarget,
  deploymentEnvironment,
  hasSafeNonProductionMarker,
  mongoDatabaseName,
  productionSignals,
  stagingConfigurationFailures,
  urlHost,
};
