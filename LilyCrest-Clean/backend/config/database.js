const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest_db';
let db;

// Connect to MongoDB
async function connectToMongo() {
  try {
    const client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Get database instance
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToMongo first.');
  }
  return db;
}

module.exports = { connectToMongo, getDb };
