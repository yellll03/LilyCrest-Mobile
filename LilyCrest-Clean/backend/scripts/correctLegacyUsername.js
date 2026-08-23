#!/usr/bin/env node
const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'correctLegacyUsername.js' });

'use strict';

require('dotenv').config();
const { connectToMongo, getDb, closeConnection } = require('../config/database');
const { USERNAME_PATTERN, normalizeUsername } = require('./backfillUsernameNormalized');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

async function run() {
  const userId = argument('user-id').trim();
  const username = normalizeUsername(argument('username'));
  const approvedBy = argument('approved-by').trim();
  const ticket = argument('approval-ref').trim();
  const confirmed = process.argv.includes('--confirm')
    || String(process.env.CONFIRM_LEGACY_USERNAME_CORRECTION || '').toLowerCase() === 'true';
  const environment = process.env.NODE_ENV || 'development';

  console.log(`Legacy username correction | environment=${environment} | database=${process.env.DB_NAME || 'lilycrest_db'}`);
  if (!userId || !username || !approvedBy || !ticket) {
    throw new Error('Required: --user-id, --username, --approved-by, and --approval-ref.');
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Replacement must be 3–30 characters using only letters, numbers, underscores, or periods.');
  }
  if (!confirmed) throw new Error('Write mode requires --confirm or CONFIRM_LEGACY_USERNAME_CORRECTION=true.');
  if (environment.toLowerCase() === 'production') {
    console.warn('WARNING: Production correction requested. Confirm a verified backup before running this command.');
  }

  await connectToMongo();
  const db = getDb();
  const users = db.collection('users');
  const target = await users.findOne({ user_id: userId }, { projection: { _id: 1, user_id: 1, username: 1 } });
  if (!target) throw new Error('Target user was not found.');
  const conflict = await users.findOne({
    user_id: { $ne: userId },
    $or: [
      { username_normalized: username },
      { username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
    ],
  }, { projection: { user_id: 1 } });
  if (conflict) throw new Error('Replacement username is no longer available.');

  const correctedAt = new Date();
  const result = await users.updateOne(
    { _id: target._id, username: target.username },
    { $set: { username, username_normalized: username, updated_at: correctedAt } },
  );
  if (result.modifiedCount !== 1) throw new Error('Correction was not applied; the record may have changed concurrently.');

  await db.collection('audit_logs').insertOne({
    action: 'legacy_username_corrected',
    actor: approvedBy,
    approval_reference: ticket,
    target_user_id: userId,
    previous_username: target.username,
    new_username: username,
    reason: 'Pre-Phase 2 normalization remediation',
    created_at: correctedAt,
  });
  console.log(JSON.stringify({ corrected: true, userId, username, auditRecorded: true }, null, 2));
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`Correction failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => closeConnection().catch((error) => console.error(`Close failed: ${error.message}`)));
}
