const { getDb } = require('../config/database');

// Seed database with sample data
async function seedData(req, res) {
  try {
    const db = getDb();

    // ── Rooms ──────────────────────────────────────────────────────────────
    const sampleRooms = [
      {
        room_id: 'room_quad_001',
        room_number: '101',
        room_type: 'Quadruple Sharing',
        bed_type: 'Lower Bed',
        floor: 1,
        capacity: 4,
        price: 5400,
        status: 'occupied',
        amenities: ['WiFi', 'Air Conditioning', 'Cabinet', 'Electric Fan'],
        description: 'Quadruple sharing room on the ground floor with shared bathroom.',
        images: [],
        created_at: new Date(),
      },
      {
        room_id: 'room_double_001',
        room_number: '201',
        room_type: 'Double Sharing',
        bed_type: 'Upper Bed',
        floor: 2,
        capacity: 2,
        price: 7500,
        status: 'available',
        amenities: ['WiFi', 'Air Conditioning', 'Cabinet', 'Ref'],
        description: 'Double sharing room on the second floor with private bathroom.',
        images: [],
        created_at: new Date(),
      },
      {
        room_id: 'room_private_001',
        room_number: '301',
        room_type: 'Private Room',
        bed_type: 'Single Bed',
        floor: 3,
        capacity: 1,
        price: 12000,
        status: 'available',
        amenities: ['WiFi', 'Air Conditioning', 'Cabinet', 'Ref', 'Private Bathroom'],
        description: 'Private room on the third floor with ensuite bathroom.',
        images: [],
        created_at: new Date(),
      },
    ];

    await db.collection('rooms').deleteMany({ room_id: { $in: ['room_quad_001', 'room_double_001', 'room_private_001'] } });
    await db.collection('rooms').insertMany(sampleRooms);

    const sampleAnnouncements = [
      {
        announcement_id: 'ann_001',
        title: 'April 2026 Billing Statements Released',
        content: 'Your April 2026 billing statements are now available in the app. Kindly settle your balance on or before April 28, 2026 to avoid late fees. You may pay conveniently via GCash, Maya, or Credit/Debit Card through our in-app PayMongo payment. For concerns, message us at 0917 1000087.',
        author_id: 'admin',
        author_name: 'LilyCrest Admin',
        priority: 'high',
        category: 'Billing',
        is_active: true,
        is_urgent: true,
        created_at: new Date('2026-04-18T08:00:00.000Z'),
      },
      {
        announcement_id: 'ann_002',
        title: 'Scheduled Water Interruption – April 12, 2026',
        content: 'Please be advised that there will be a scheduled water interruption on Saturday, April 12, 2026, from 8:00 AM to 5:00 PM due to pipe maintenance. Please store enough water before the interruption. We apologize for the inconvenience and appreciate your understanding.',
        author_id: 'admin',
        author_name: 'LilyCrest Admin',
        priority: 'high',
        category: 'Maintenance',
        is_active: true,
        is_urgent: true,
        created_at: new Date('2026-04-09T09:00:00.000Z'),
      },
      {
        announcement_id: 'ann_003',
        title: 'House Rules Reminder: Quiet Hours',
        content: 'As a reminder to all tenants, quiet hours are strictly observed from 10:00 PM to 7:00 AM. Please keep noise to a minimum during these hours out of respect for your fellow residents. Repeated violations may result in a notice from management. Thank you for your cooperation.',
        author_id: 'admin',
        author_name: 'LilyCrest Admin',
        priority: 'normal',
        category: 'Rules',
        is_active: true,
        is_urgent: false,
        created_at: new Date('2026-04-05T10:00:00.000Z'),
      },
      {
        announcement_id: 'ann_004',
        title: 'Refer a Friend – Get 1 Month FREE!',
        content: 'Know someone looking for a place to stay? Refer a friend and get 1 month of free WiFi when they successfully move in! Simply have them mention your name upon inquiry. This promo is ongoing until slots are filled. Spread the word and enjoy the perks!',
        author_id: 'admin',
        author_name: 'LilyCrest Admin',
        priority: 'normal',
        category: 'Promo',
        is_active: true,
        is_urgent: false,
        created_at: new Date('2026-04-01T08:00:00.000Z'),
      },
      {
        announcement_id: 'ann_005',
        title: 'Welcome, New Tenants! – April 2026 Move-Ins',
        content: 'LilyCrest warmly welcomes our new tenants who moved in this April! We hope you feel at home. Should you need anything or have questions about the dorm policies, do not hesitate to reach out to us at 0917 1000087 or message us on our Facebook page. Enjoy your stay!',
        author_id: 'admin',
        author_name: 'LilyCrest Admin',
        priority: 'low',
        category: 'General',
        is_active: true,
        is_urgent: false,
        created_at: new Date('2026-04-01T07:00:00.000Z'),
      },
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

      // ── Room Assignment ──────────────────────────────────────────────────
      await db.collection('room_assignments').deleteMany({ user_id: existingUser.user_id });
      await db.collection('room_assignments').insertOne({
        assignment_id: `assign_${existingUser.user_id}`,
        user_id: existingUser.user_id,
        room_id: 'room_quad_001',
        status: 'active',
        move_in_date: new Date('2025-01-01'),
        move_out_date: new Date('2026-12-31'),
        created_at: new Date(),
      });
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
