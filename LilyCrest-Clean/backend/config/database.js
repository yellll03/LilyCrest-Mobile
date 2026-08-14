const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest_db';

let db;
let client;

// Connect to MongoDB with exponential backoff retry
async function connectToMongo(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  const BASE_DELAY_MS = 1000;

  if (db) return db; // singleton — already connected

  try {
    client = new MongoClient(MONGO_URL);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB');
    return db;
  } catch (error) {
    console.error(`MongoDB connection error (attempt ${attempt}/${MAX_ATTEMPTS}):`, error.message);
    if (attempt >= MAX_ATTEMPTS) {
      console.error('MongoDB: max retries exceeded — exiting.');
      process.exit(1);
    }
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    console.log(`Retrying in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return connectToMongo(attempt + 1);
  }
}

// Get database instance
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call connectToMongo first.');
  }
  return db;
}

async function closeConnection() {
  if (client) await client.close();
  client = null;
  db = null;
}

module.exports = { connectToMongo, getDb, closeConnection };
