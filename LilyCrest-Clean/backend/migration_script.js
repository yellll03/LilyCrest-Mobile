const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
  const url = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME;
  if (!url || !dbName) {
    console.error("Missing MONGO_URL or DB_NAME in .env");
    process.exit(1);
  }

  const client = new MongoClient(url);
  try {
    await client.connect();
    const db = client.db(dbName);

    const collMain = db.collection('maintenance_requests');
    const collLegacy = db.collection('maintenancerequests');
    const collUsers = db.collection('users');

    // 2) Ensure isArchived=false where missing/null in both
    const updateArchivedRes1 = await collMain.updateMany(
      { isArchived: { $exists: false } },
      { $set: { isArchived: false } }
    );
    const updateArchivedRes2 = await collLegacy.updateMany(
      { isArchived: { $exists: false } },
      { $set: { isArchived: false } }
    );
    const updatedFlagsTotal = updateArchivedRes1.modifiedCount + updateArchivedRes2.modifiedCount;

    // 3) Upsert docs from legacy into main by request_id
    const legacyDocs = await collLegacy.find({}).toArray();
    let insertedFromLegacy = 0;

    for (const doc of legacyDocs) {
      const requestId = doc.request_id || doc._id.toString();
      const existing = await collMain.findOne({ request_id: requestId });

      if (!existing) {
        let branch = doc.branch;
        // 4) Fill missing branch
        if (!branch && doc.user_id) {
          const user = await collUsers.findOne({ _id: doc.user_id });
          if (user) {
            branch = user.branch || user.branchId;
          }
        }

        const newDoc = {
          ...doc,
          request_id: requestId,
          status: doc.status || 'pending',
          urgency: doc.urgency || 'normal',
          attachments: doc.attachments || [],
          created_at: doc.created_at || doc.createdAt || new Date(),
          updated_at: doc.updated_at || doc.updatedAt || new Date(),
          isArchived: doc.isArchived ?? false,
          branch: branch
        };
        delete newDoc._id; // Let Mongo generate new or handle conflict if we reused it
        
        await collMain.insertOne(newDoc);
        insertedFromLegacy++;
      }
    }

    // 5) Summary counts
    const finalCount = await collMain.countDocuments();
    const visibleCount = await collMain.countDocuments({ isArchived: { $ne: true } });

    console.log(`Updated flags: ${updatedFlagsTotal}`);
    console.log(`Inserted from legacy: ${insertedFromLegacy}`);
    console.log(`Final maintenance_requests count: ${finalCount}`);
    console.log(`Final visible count: ${visibleCount}`);

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
^Z
