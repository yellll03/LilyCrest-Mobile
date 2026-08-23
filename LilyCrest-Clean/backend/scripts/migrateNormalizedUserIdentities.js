const { assertStagingWriteTarget } = require('./stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'migrateNormalizedUserIdentities.js' });

const { connectToMongo, getDb, closeConnection } = require('../config/database');

async function run() {
  await connectToMongo();
  const users = getDb().collection('users');
  const docs = await users.find({}, { projection: { _id: 1, email: 1, username: 1 } }).toArray();
  const groups = { email_normalized: new Map(), username_normalized: new Map() };

  for (const doc of docs) {
    for (const [field, source] of [['email_normalized', doc.email], ['username_normalized', doc.username]]) {
      const value = typeof source === 'string' ? source.trim().toLowerCase() : '';
      if (!value) continue;
      if (!groups[field].has(value)) groups[field].set(value, []);
      groups[field].get(value).push(doc._id);
    }
  }

  const duplicates = [];
  for (const [field, values] of Object.entries(groups)) {
    for (const [value, ids] of values) {
      if (ids.length > 1) duplicates.push({ field, value, ids: ids.map(String) });
    }
  }
  if (duplicates.length) {
    console.error(JSON.stringify({ detail: 'Duplicate identities require manual resolution; no records were changed.', duplicates }, null, 2));
    process.exitCode = 2;
    return;
  }

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: {
        ...(doc.email ? { email_normalized: String(doc.email).trim().toLowerCase() } : {}),
        ...(doc.username ? { username_normalized: String(doc.username).trim().toLowerCase() } : {}),
      } },
    },
  }));
  if (operations.length) await users.bulkWrite(operations, { ordered: false });
  await users.createIndex({ email_normalized: 1 }, { unique: true, sparse: true, name: 'email_normalized_unique' });
  await users.createIndex({ username_normalized: 1 }, { unique: true, sparse: true, name: 'username_normalized_unique' });
  console.log(`Normalized ${operations.length} user records; unique indexes are active.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => closeConnection().catch(() => {}));
