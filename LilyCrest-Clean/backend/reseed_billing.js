/**
 * Quick script to reseed billing data with the new format.
 * Run: node reseed_billing.js
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'lilycrest_db';

async function reseed() {
  console.log(`Connecting to ${MONGO_URL}, DB: ${DB_NAME}...`);
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);

  // Find any existing user to assign bills to
  const user = await db.collection('users').findOne({});
  if (!user) {
    console.error('No users found in database. Cannot seed billing.');
    await client.close();
    return;
  }
  console.log(`Found user: ${user.user_id} (${user.email || user.username})`);

  const now = new Date();
  const bills = [
    {
      billing_id: 'BILL-2026-004',
      user_id: user.user_id,
      description: 'April 2026 Billing Statement',
      billing_period: 'April 2026',
      billing_type: 'consolidated',
      release_date: new Date('2026-04-18'),
      due_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      status: 'pending',
      rent: 5400,
      electricity: 353.89,
      water: 450,
      penalties: 0,
      total: 6203.89,
      amount: 6203.89,
      electricity_breakdown: [
        {
          occupants: 4,
          reading_date_from: '2026-03-15', reading_date_to: '2026-03-24',
          reading_from: 1091.91, reading_to: 1127.69,
          consumption: 35.78, rate: 16,
          segment_total: 572.48, share_per_tenant: 143.12,
        },
        {
          occupants: 3,
          reading_date_from: '2026-03-24', reading_date_to: '2026-04-15',
          reading_from: 1127.69, reading_to: 1167.21,
          consumption: 39.52, rate: 16,
          segment_total: 632.32, share_per_tenant: 210.77,
        },
      ],
      water_breakdown: {
        reading_from: 22, reading_to: 31,
        consumption: 9, rate: 50, total: 450,
        sharing_policy: 'Equal division among active tenants',
      },
      created_at: now,
    },
    {
      billing_id: 'BILL-2026-003',
      user_id: user.user_id,
      description: 'Electricity Bill - March 2026',
      billing_period: 'March 2026',
      billing_type: 'electricity',
      release_date: new Date('2026-03-18'),
      due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      status: 'pending',
      electricity: 353.89,
      total: 353.89,
      amount: 353.89,
      electricity_breakdown: [
        {
          occupants: 4,
          reading_date_from: '2026-02-15', reading_date_to: '2026-02-24',
          reading_from: 1016.61, reading_to: 1052.39,
          consumption: 35.78, rate: 16,
          segment_total: 572.48, share_per_tenant: 143.12,
        },
        {
          occupants: 3,
          reading_date_from: '2026-02-24', reading_date_to: '2026-03-15',
          reading_from: 1052.39, reading_to: 1091.91,
          consumption: 39.52, rate: 16,
          segment_total: 632.32, share_per_tenant: 210.77,
        },
      ],
      created_at: now,
    },
    {
      billing_id: 'BILL-2026-002',
      user_id: user.user_id,
      description: 'Electricity Bill - February 2026',
      billing_period: 'February 2026',
      billing_type: 'electricity',
      release_date: new Date('2026-02-18'),
      due_date: new Date('2026-02-25'),
      status: 'paid',
      electricity: 280,
      total: 280,
      amount: 280,
      payment_method: 'paymongo',
      payment_date: new Date('2026-02-20T10:30:00Z'),
      paymongo_reference: 'LC-BILL-2026-002-1709500000',
      electricity_breakdown: [
        {
          occupants: 4,
          reading_date_from: '2026-01-15', reading_date_to: '2026-02-15',
          reading_from: 946.61, reading_to: 1016.61,
          consumption: 70, rate: 16,
          segment_total: 1120, share_per_tenant: 280,
        },
      ],
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
    {
      billing_id: 'BILL-2026-001',
      user_id: user.user_id,
      description: 'Electricity Bill - January 2026',
      billing_period: 'January 2026',
      billing_type: 'electricity',
      release_date: new Date('2026-01-18'),
      due_date: new Date('2026-01-25'),
      status: 'paid',
      electricity: 195.50,
      total: 195.50,
      amount: 195.50,
      payment_method: 'paymongo',
      payment_date: new Date('2026-01-22T14:20:00Z'),
      paymongo_reference: 'LC-BILL-2026-001-1706900000',
      electricity_breakdown: [
        {
          occupants: 3,
          reading_date_from: '2025-12-15', reading_date_to: '2026-01-15',
          reading_from: 905.98, reading_to: 946.61,
          consumption: 40.63, rate: 16,
          segment_total: 650.08, share_per_tenant: 195.50,
        },
      ],
      created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    },
  ];

  console.log('Deleting old billing records...');
  const deleteResult = await db.collection('billing').deleteMany({});
  console.log(`  Deleted ${deleteResult.deletedCount} old records.`);

  console.log(`Inserting ${bills.length} new billing records...`);
  await db.collection('billing').insertMany(bills);

  console.log('\nDone! New bills seeded:');
  bills.forEach(b => console.log(`  ${b.billing_id} - ${b.description} (${b.status}) [${b.billing_type}] PHP ${b.total}`));

  await client.close();
  process.exit(0);
}

reseed().catch(err => { console.error('Error:', err); process.exit(1); });
