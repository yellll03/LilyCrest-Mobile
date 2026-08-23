#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');

'use strict';

require('dotenv').config();
const { getDb, connectToMongo, closeConnection } = require('../config/database');

const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,30}$/;
const INDEX_NAME = 'username_normalized_unique';
const isDryRun = process.argv.includes('--dry-run');
const isConfirmed = process.argv.includes('--confirm')
  || String(process.env.CONFIRM_USERNAME_MIGRATION || '').toLowerCase() === 'true';
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment.toLowerCase() === 'production';
let interrupted = false;

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function maskEmail(value) {
  const [local = '', domain = ''] = String(value || '').split('@');
  if (!domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function publicUserRecord(user, normalized) {
  return {
    userId: String(user.user_id || user._id),
    username: user.username || '',
    normalizedUsername: normalized,
    email: maskEmail(user.email),
    role: user.role || 'unknown',
    status: user.status || (user.is_active === false ? 'inactive' : 'unknown'),
    createdAt: user.created_at || user.createdAt || null,
  };
}

function analyzeUsers(users) {
  const analysis = {
    totalScanned: users.length,
    alreadyValid: 0,
    requiringUpdate: 0,
    missingUsernames: [],
    invalidUsernames: [],
    duplicateGroups: [],
    candidates: [],
  };
  const groups = new Map();

  for (const user of users) {
    const normalized = normalizeUsername(user.username);
    if (!normalized) {
      analysis.missingUsernames.push(publicUserRecord(user, normalized));
      continue;
    }
    if (!USERNAME_PATTERN.test(normalized)) {
      analysis.invalidUsernames.push(publicUserRecord(user, normalized));
      continue;
    }
    const record = publicUserRecord(user, normalized);
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(record);
    if (user.username_normalized === normalized) analysis.alreadyValid += 1;
    else analysis.requiringUpdate += 1;
    analysis.candidates.push({ _id: user._id, current: user.username_normalized, normalized, record });
  }

  analysis.duplicateGroups = [...groups.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([normalizedUsername, records]) => ({
      normalizedUsername,
      records,
      recommendation: 'Administrator review required. Keep the username on the intended active account and assign new usernames to the other accounts.',
    }));
  const duplicateNames = new Set(analysis.duplicateGroups.map((group) => group.normalizedUsername));
  analysis.safeUpdates = analysis.candidates.filter(
    (candidate) => candidate.current !== candidate.normalized && !duplicateNames.has(candidate.normalized),
  );
  return analysis;
}

function buildReplacementOptions(username, occupied = new Set()) {
  const normalized = normalizeUsername(username);
  const candidates = [
    normalized.replace(/-/g, '_'),
    normalized.replace(/-/g, '.'),
    normalized.replace(/-/g, ''),
  ];
  return [...new Set(candidates)].map((candidate) => ({
    username: candidate,
    valid: USERNAME_PATTERN.test(candidate),
    available: USERNAME_PATTERN.test(candidate) && !occupied.has(candidate),
  }));
}

function printSummary(analysis, extra = {}) {
  console.log(JSON.stringify({
    environment,
    mode: isDryRun ? 'dry-run' : 'migration',
    totalUsersScanned: analysis.totalScanned,
    usersAlreadyValid: analysis.alreadyValid,
    usersRequiringUpdate: analysis.requiringUpdate,
    missingUsernames: analysis.missingUsernames.length,
    invalidUsernames: analysis.invalidUsernames.length,
    duplicateGroups: analysis.duplicateGroups.length,
    recordsEligibleForModification: analysis.safeUpdates.length,
    ...extra,
  }, null, 2));
  if (analysis.missingUsernames.length) console.log('Missing usernames:', JSON.stringify(analysis.missingUsernames, null, 2));
  if (analysis.invalidUsernames.length) console.log('Invalid usernames:', JSON.stringify(analysis.invalidUsernames, null, 2));
  if (analysis.duplicateGroups.length) console.log('Duplicate report:', JSON.stringify(analysis.duplicateGroups, null, 2));
}

async function run() {
  console.log(`Username normalization migration | environment=${environment} | database=${process.env.DB_NAME || 'lilycrest_db'}`);
  if (isProduction) {
    console.warn('WARNING: Production environment detected.');
    console.warn('Recommendation: create and verify a database backup before continuing.');
  }
  if (!isDryRun && !isConfirmed) {
    throw new Error('Write mode requires --confirm or CONFIRM_USERNAME_MIGRATION=true. Run --dry-run first.');
  }

  await connectToMongo();
  if (interrupted) throw new Error('Migration interrupted before scanning.');
  const users = getDb().collection('users');
  const documents = await users.find({}, {
    projection: {
      _id: 1, user_id: 1, username: 1, username_normalized: 1,
      email: 1, role: 1, status: 1, is_active: 1, created_at: 1, createdAt: 1,
    },
  }).toArray();
  const analysis = analyzeUsers(documents);
  if (analysis.invalidUsernames.length) {
    const occupied = new Set(documents.map((doc) => normalizeUsername(doc.username)).filter(Boolean));
    const invalidReview = analysis.invalidUsernames.map((record) => ({
      ...record,
      reason: 'Username must be 3–30 characters and contain only letters, numbers, underscores, or periods.',
      suggestedReplacements: buildReplacementOptions(record.username, occupied),
    }));
    console.log('Administrative invalid-username review:', JSON.stringify(invalidReview, null, 2));
  }

  if (isDryRun) {
    printSummary(analysis, { totalUpdated: 0, failedUpdates: 0, indexCreationResult: 'not attempted in dry-run' });
    if (analysis.duplicateGroups.length) process.exitCode = 2;
    return;
  }

  let updated = 0;
  const failures = [];
  for (const candidate of analysis.safeUpdates) {
    if (interrupted) break;
    try {
      const result = await users.updateOne(
        { _id: candidate._id, username: candidate.record.username },
        { $set: { username_normalized: candidate.normalized } },
      );
      if (result.modifiedCount === 1) updated += 1;
      else failures.push({ userId: candidate.record.userId, reason: 'Record changed concurrently or was not modified.' });
    } catch (error) {
      failures.push({ userId: candidate.record.userId, reason: error.message });
    }
  }

  let indexCreationResult = 'not attempted';
  const blockers = analysis.duplicateGroups.length + analysis.missingUsernames.length + analysis.invalidUsernames.length;
  if (!interrupted && blockers === 0 && failures.length === 0) {
    await users.createIndex(
      { username_normalized: 1 },
      {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: { username_normalized: { $type: 'string' } },
      },
    );
    indexCreationResult = `created or already active (${INDEX_NAME})`;
  } else {
    indexCreationResult = 'blocked until duplicates, missing/invalid usernames, failures, and interruptions are resolved';
  }

  printSummary(analysis, {
    totalUpdated: updated,
    failedUpdates: failures.length,
    failures,
    interrupted,
    indexCreationResult,
  });
  if (blockers || failures.length || interrupted) process.exitCode = 2;
}

process.once('SIGINT', () => {
  interrupted = true;
  console.warn('Interruption requested; finishing the current atomic update and closing the database connection.');
});
process.once('SIGTERM', () => {
  interrupted = true;
  console.warn('Termination requested; finishing the current atomic update and closing the database connection.');
});

if (require.main === module) {
  assertStagingWriteTarget(process.env, { toolName: 'backfillUsernameNormalized.js' });
  run()
    .catch((error) => {
      console.error(`Migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      try { await closeConnection(); } catch (error) { console.error(`Failed to close database connection: ${error.message}`); }
    });
}

module.exports = { analyzeUsers, buildReplacementOptions, maskEmail, normalizeUsername, USERNAME_PATTERN };
