const { getDb } = require('../config/database');

// Seed database with sample data
async function seedData(req, res) {
  try {
    const db = getDb();
    
    // Remove previously seeded sample rooms and stop reseeding them
    await db.collection('rooms').deleteMany({ room_id: { $in: ['room_quad_001', 'room_double_001', 'room_private_001'] } });

    const sampleAnnouncements = [
      {
        announcement_id: 'ann_001', title: 'Welcome to Lilycrest Gil Puyat!',
        content: 'We\'re excited to have you as part of our community at #7 Gil Puyat Ave. cor Marconi St. Brgy Palanan, Makati City. Contact us at 0917 1000087.',
        author_id: 'admin', priority: 'high', category: 'General', is_active: true, created_at: new Date()
      },
      {
        announcement_id: 'ann_002', title: '🎉 DISCOUNTED Monthly Rates Available!',
        content: 'Avail our discounted monthly rates! Quadruple Sharing: 10% OFF. Double Sharing: 20% OFF. Private Room: 10% OFF.',
        author_id: 'admin', priority: 'high', category: 'Promo', is_active: true, created_at: new Date(Date.now() - 2 * 60 * 60 * 1000)
      },
      {
        announcement_id: 'ann_003', title: 'Monthly Rent Payment Reminder',
        content: 'Please remember that monthly rent is due on the 1st of each month. Grace period: 2 days. Late fee: ₱50/day.',
        author_id: 'admin', priority: 'normal', category: 'Billing', is_active: true, created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      }
    ];

    await db.collection('announcements').deleteMany({});
    await db.collection('announcements').insertMany(sampleAnnouncements);

    const sampleFaqs = [
      { faq_id: 'faq_001', question: 'What are the payment methods accepted?', answer: 'We accept online payments through PayMongo (GCash, Maya, Credit/Debit Card, Online Banking).', category: 'Billing' },
      { faq_id: 'faq_002', question: 'What is included in the monthly rent?', answer: 'Monthly rent includes WiFi, air conditioning usage, water, and access to common areas.', category: 'Billing' },
      { faq_id: 'faq_003', question: 'What are the quiet hours?', answer: 'Quiet hours are from 10:00 PM to 7:00 AM.', category: 'House Rules' },
      { faq_id: 'faq_004', question: 'How do I submit a maintenance request?', answer: 'Use the Services tab in the app or visit the front desk.', category: 'Maintenance' }
    ];

    await db.collection('faqs').deleteMany({});
    await db.collection('faqs').insertMany(sampleFaqs);

    const existingUser = await db.collection('users').findOne({});
    if (existingUser) {
      const now = new Date();
      const sampleBilling = [
        {
          // Consolidated bill with all charge types
          billing_id: 'BILL-2026-004',
          user_id: existingUser.user_id,
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
              reading_date_from: '2026-03-15',
              reading_date_to: '2026-03-24',
              reading_from: 1091.91,
              reading_to: 1127.69,
              consumption: 35.78,
              rate: 16,
              segment_total: 572.48,
              share_per_tenant: 143.12,
            },
            {
              occupants: 3,
              reading_date_from: '2026-03-24',
              reading_date_to: '2026-04-15',
              reading_from: 1127.69,
              reading_to: 1167.21,
              consumption: 39.52,
              rate: 16,
              segment_total: 632.32,
              share_per_tenant: 210.77,
            },
          ],
          water_breakdown: {
            reading_from: 22,
            reading_to: 31,
            consumption: 9,
            rate: 50,
            total: 450,
            sharing_policy: 'Equal division among active tenants',
          },
          created_at: now,
        },
        {
          billing_id: 'BILL-2026-003',
          user_id: existingUser.user_id,
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
              reading_date_from: '2026-02-15',
              reading_date_to: '2026-02-24',
              reading_from: 1016.61,
              reading_to: 1052.39,
              consumption: 35.78,
              rate: 16,
              segment_total: 572.48,
              share_per_tenant: 143.12,
            },
            {
              occupants: 3,
              reading_date_from: '2026-02-24',
              reading_date_to: '2026-03-15',
              reading_from: 1052.39,
              reading_to: 1091.91,
              consumption: 39.52,
              rate: 16,
              segment_total: 632.32,
              share_per_tenant: 210.77,
            },
          ],
          created_at: now,
        },
        {
          billing_id: 'BILL-2026-002',
          user_id: existingUser.user_id,
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
              reading_date_from: '2026-01-15',
              reading_date_to: '2026-02-15',
              reading_from: 946.61,
              reading_to: 1016.61,
              consumption: 70,
              rate: 16,
              segment_total: 1120,
              share_per_tenant: 280,
            },
          ],
          created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
        {
          billing_id: 'BILL-2026-001',
          user_id: existingUser.user_id,
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
              reading_date_from: '2025-12-15',
              reading_date_to: '2026-01-15',
              reading_from: 905.98,
              reading_to: 946.61,
              consumption: 40.63,
              rate: 16,
              segment_total: 650.08,
              share_per_tenant: 195.50,
            },
          ],
          created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        },
      ];

      await db.collection('billing').deleteMany({});
      await db.collection('billing').insertMany(sampleBilling);
    }

    res.json({ message: 'Seed data created successfully' });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ detail: 'Failed to seed data' });
  }
}

module.exports = {
  seedData
};
