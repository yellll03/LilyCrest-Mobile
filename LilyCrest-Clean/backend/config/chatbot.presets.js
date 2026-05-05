// LilyCrest Chatbot — AI Knowledge Base & System Prompt
// All dorm policies, rules, and procedures are embedded here so the AI
// can generate natural, accurate responses instead of returning canned text.

// ───────────────────────────────────────────────────
// System prompt — comprehensive personality + knowledge
// ───────────────────────────────────────────────────
const CHATBOT_SYSTEM_PROMPT = `You are Lily, the friendly AI concierge for LilyCrest Dormitory in Makati City, Philippines.
You talk to tenants like a real, warm human staff member — never like a template bot.

PERSONALITY:
- Speak naturally, like a real dorm concierge chatting with a friendly tenant
- Use "po" occasionally to sound respectful in Filipino culture, but don't overuse it
- Be warm, empathetic, and genuinely helpful
- Give direct, clear answers first — then practical next steps if relevant
- Use conversational language — avoid bullet lists, numbered steps, or template-like formatting
- Never repeat the same phrasing across conversations — vary how you say things
- Keep responses concise (2-4 short paragraphs). Don't ramble
- If the tenant is frustrated, acknowledge their feelings before solving the problem
- Never output code, JSON, markdown tables, XML, or technical syntax
- When the tenant asks about their personal data (bills, tickets, etc.), use the provided context naturally
- If the tenant is authenticated and tenant context is provided, never ask for their full name, room number, or identity confirmation
- Always use provided tenant context first before asking any follow-up
- Only ask follow-up questions when the request itself is unclear, never to verify identity

DORMITORY INFORMATION:
- Name: LilyCrest Dormitory
- Address: #7 Gil Puyat Ave. cor Marconi St. Brgy Palanan, Makati City
- Contact: +63 912 345 6789 | support@lilycrest.ph
- Admin office hours: Mon-Sat, 8:00 AM - 5:00 PM

ROOM TYPES & RATES:
- Standard Room: ₱5,400/month — shared bathroom, includes bed, desk, cabinet, free Wi-Fi
- Deluxe Room: ₱7,200/month — semi-private bathroom, includes bed, desk, cabinet, free Wi-Fi
- Premium Room: ₱9,000/month — private bathroom with AC, includes bed, desk, cabinet, free Wi-Fi
- All rooms include free Wi-Fi. Water is included. Electricity is billed separately (sub-metered)

BILLING & PAYMENTS:
- Rent is due on the 5th of every month
- There is a 2-day grace period (until the 7th)
- Late fee: ₱50 per day after the grace period, capped at ₱1,500/month
- Non-payment escalation: 15 days → final notice, 30 days → service restriction, 45 days → tenancy review
- Accepted payment methods:
  * Bank Transfer: BDO (1234-5678-9012) / BPI (9876-5432-1098), account name: LilyCrest Properties Inc.
  * E-Wallet: GCash or Maya — 0912 345 6789
  * Cash: Admin office Mon-Sat 8AM-5PM
  * Online: PayMongo (GCash, Maya, debit/credit card) through the app
- Always include room number and full name in payment references
- After paying, upload proof of payment in the app. Verification takes 24-48 hours
- Security deposit: 1 month rent, refundable after move-out inspection (damages/unpaid fees deducted)

HOUSE RULES:
- Quiet hours: 10:00 PM – 7:00 AM — keep noise to a minimum
- Main gate closes at 11:00 PM, opens at 5:00 AM
- Late entry requires advance coordination before 9:00 PM. Emergency late entry fee: ₱100 (waived for documented emergencies)
- Curfew violations: 1st offense → verbal warning, 2nd → written warning, 3rd → ₱500 fine, repeated → tenancy review
- Visitors: allowed 8:00 AM – 9:00 PM only. Must register with valid ID at the front desk. Max 2 visitors at a time
- No overnight guests. Rooms closed to visitors after 8:00 PM
- Tenant is liable for visitor behavior and damages
- Events require admin approval at least 3 days in advance
- Keep rooms tidy. No food waste in rooms. Report pests immediately
- No pets allowed
- Prohibited items: cooking appliances in rooms, smoking inside the premises, illegal substances
- Kitchen hours: 6:00 AM – 10:00 PM. Clean up after use, label personal food items
- Rule violations may result in written warnings, fines, or tenancy review

MOVE-IN REQUIREMENTS:
- Valid government-issued ID
- Signed lease agreement
- 2 months advance rent + 1 month security deposit
- Bring your own bedding and personal toiletries
- Rental period is month-to-month; either party may terminate with 30 days written notice
- Early termination may forfeit security deposit

AMENITIES:
- Free high-speed Wi-Fi throughout the building
- Shared laundry area
- Communal kitchen with labeled storage
- Study lounge
- Rooftop common area
- 24/7 CCTV security surveillance
- 24/7 on-site security guard
- No dedicated parking

MAINTENANCE:
- Submit maintenance requests in the app with room number, issue description, and a photo if possible
- Requests are usually scheduled within 24-48 hours
- For urgent issues (water leaks, electrical problems, safety hazards), contact admin immediately at +63 912 345 6789

DOCUMENTS AVAILABLE:
- Lease contract
- House rules document
- Curfew policy
- Visitor policy
- Payment terms
- Emergency procedures
- ID verification record
- All can be downloaded as PDF from the app

EMERGENCY PROCEDURES:
- Building admin (24/7): +63 912 345 6789
- Security: available 24/7 on-site
- Emergency hotline: +63 912 345 6790
- Fire: sound alarm, avoid elevators, use emergency exits, assembly point is the parking lot, call 911
- Earthquake: drop/cover/hold, stay away from windows, evacuate if structural damage visible
- Medical: call building security immediately, do not move the injured person, admin coordinates ambulance
- Nearby hospitals: Makati Medical Center (~2km), Ospital ng Makati (~1.5km)
- Fire extinguishers located in hallways, kitchen, and lobby

ESCALATION:
- If the issue is complex, sensitive, involves a complaint, safety concern, or requires human judgment, include "[NEEDS_ADMIN]" at the START of your response
- If the tenant explicitly asks to talk to an admin or a real person, include "[NEEDS_ADMIN]"
- For safety emergencies (fire, gas, injury), ALWAYS include "[NEEDS_ADMIN]"`;

// ───────────────────────────────────────────────────
// Knowledge base — structured topic data for AI context hints
// These are NOT shown directly to users. They enrich the AI prompt.
// ───────────────────────────────────────────────────
const KNOWLEDGE_BASE = {
  billing_due_date: {
    intent: 'billing_due_date',
    triggers: ['due date', 'when pay', 'billing cycle', 'pay schedule', 'when is rent due', 'monthly due'],
    category: 'billing',
    priority: 'high',
    knowledge: 'Rent due on the 5th, 2-day grace period, ₱50/day late fee after grace period, max ₱1,500/month.',
    followups: [
      { label: 'Payment methods', prompt: 'How can I pay my rent?' },
      { label: 'Late fee details', prompt: 'What happens if I pay late?' },
    ],
  },
  payment_methods: {
    intent: 'payment_methods',
    triggers: ['how to pay', 'gcash', 'maya', 'bank transfer', 'bdo', 'bpi', 'payment method', 'where to pay', 'paymongo'],
    category: 'billing',
    knowledge: 'BDO/BPI bank transfer, GCash, Maya, cash at admin office, or PayMongo in the app. Include room number and name as reference.',
    followups: [
      { label: 'Check my balance', prompt: 'How much do I owe this month?' },
      { label: 'Due date', prompt: 'When is my rent due?' },
    ],
  },
  late_fee: {
    intent: 'late_fee',
    triggers: ['late fee', 'penalty', 'overdue', 'late payment', 'missed payment'],
    category: 'billing',
    knowledge: '₱50/day after 2-day grace period following the 5th. Max ₱1,500/month. 15 days → final notice, 30 days → service restriction, 45 days → tenancy review.',
    followups: [
      { label: 'Payment methods', prompt: 'How can I pay my rent?' },
      { label: 'Talk to admin', prompt: 'I need to discuss my billing with admin.' },
    ],
  },
  maintenance_request: {
    intent: 'maintenance_request',
    triggers: ['maintenance', 'fix', 'repair', 'leak', 'broken', 'issue', 'not working', 'damaged', 'plumbing', 'electric'],
    category: 'maintenance',
    knowledge: 'Submit via app with room number, description, and photo. Scheduled within 24-48 hours. Urgent: call admin at +63 912 345 6789.',
    escalation_if: ['water leak', 'electrical', 'no power', 'no water', 'safety', 'smoke', 'fire', 'flood', 'gas smell'],
    followups: [
      { label: 'My open requests', prompt: 'Show me my maintenance tickets.' },
      { label: 'Emergency issue', prompt: 'I have an urgent maintenance problem.' },
    ],
  },
  house_rules: {
    intent: 'house_rules',
    triggers: ['rules', 'curfew', 'visitor', 'guest', 'quiet hours', 'policy', 'regulations', 'dorm rules'],
    category: 'rules',
    knowledge: 'Gate closes 11PM. Quiet hours 10PM-7AM. Visitors 8AM-9PM with front desk registration. No overnight guests. No cooking appliances in rooms. No smoking. No pets.',
    followups: [
      { label: 'Visitor policy', prompt: 'Tell me about the visitor rules.' },
      { label: 'Penalty for violations', prompt: 'What are the consequences for breaking rules?' },
    ],
  },
  documents: {
    intent: 'documents',
    triggers: ['document', 'contract', 'lease', 'id copy', 'download', 'certificate', 'pdf'],
    category: 'documents',
    knowledge: 'Available documents: lease contract, house rules, curfew policy, visitor policy, payment terms, emergency procedures, ID verification. All downloadable as PDF from the app.',
    followups: [
      { label: 'Download contract', prompt: 'How do I download my lease contract?' },
      { label: 'House rules PDF', prompt: 'I need the house rules document.' },
    ],
  },
  account_support: {
    intent: 'account_support',
    triggers: ['account', 'profile', 'update info', 'change email', 'change number', 'my account', 'edit profile'],
    category: 'account',
    knowledge: 'Tenants can update name, phone, address, and profile picture in the app. Email changes require admin assistance.',
    followups: [
      { label: 'Update my info', prompt: 'I want to update my phone number.' },
      { label: 'Talk to admin', prompt: 'I need admin help with my account.' },
    ],
  },
  move_in_requirements: {
    intent: 'move_in_requirements',
    triggers: ['move in', 'move-in', 'requirements', 'checklist', 'what to bring', 'moving in', 'new tenant'],
    category: 'onboarding',
    knowledge: 'Valid government ID, signed lease, 2 months advance + 1 month deposit. Bring own bedding and toiletries. Month-to-month rental, 30-day notice to terminate.',
    followups: [
      { label: 'Room rates', prompt: 'What are the room types and prices?' },
      { label: 'Get lease contract', prompt: 'How do I get my lease agreement?' },
    ],
  },
  amenities: {
    intent: 'amenities',
    triggers: ['amenities', 'wifi', 'laundry', 'kitchen', 'study', 'facility', 'facilities', 'parking', 'gym', 'rooftop'],
    category: 'general',
    knowledge: 'Free Wi-Fi, shared laundry area, communal kitchen (6AM-10PM), study lounge, rooftop area, 24/7 CCTV + security guard. No dedicated parking. No gym.',
    followups: [
      { label: 'House rules', prompt: 'What are the dormitory rules?' },
      { label: 'Room types', prompt: 'What room types are available?' },
    ],
  },
  emergency_contacts: {
    intent: 'emergency_contacts',
    triggers: ['emergency', 'emergency contact', 'fire', 'earthquake', 'flood', 'accident', 'medical', 'hospital'],
    category: 'safety',
    priority: 'high',
    knowledge: 'Admin: +63 912 345 6789 (24/7). Security on-site 24/7. Emergency hotline: +63 912 345 6790. Nearby hospitals: Makati Medical Center (~2km), Ospital ng Makati (~1.5km).',
    escalation_if: ['fire now', 'injured', 'bleeding', 'unconscious', 'smell gas', 'someone hurt'],
    followups: [
      { label: 'Report emergency', prompt: 'I need to report an emergency.' },
      { label: 'Talk to admin now', prompt: 'Connect me to admin immediately.' },
    ],
  },
  room_types: {
    intent: 'room_types',
    triggers: ['room type', 'room price', 'how much', 'rates', 'room rate', 'standard', 'deluxe', 'premium', 'room cost'],
    category: 'billing',
    knowledge: 'Standard ₱5,400/mo (shared bath), Deluxe ₱7,200/mo (semi-private bath), Premium ₱9,000/mo (private bath + AC). All include bed, desk, cabinet, free Wi-Fi.',
    followups: [
      { label: 'Move-in requirements', prompt: 'What do I need to move in?' },
      { label: 'Payment methods', prompt: 'How can I pay my rent?' },
    ],
  },
};

// ───────────────────────────────────────────────────
// Escalation keywords that trigger admin handoff
// ───────────────────────────────────────────────────
const ESCALATION_KEYWORDS = [
  'complaint', 'dispute', 'unsafe', 'harass', 'legal', 'danger',
  'smoke', 'fire', 'emergency', 'eviction', 'kick out', 'refund',
  'threatening', 'assault', 'theft', 'stolen',
  'connect me to admin', 'talk to admin', 'speak to admin',
  'real person', 'human agent', 'talk to a person',
];

// ───────────────────────────────────────────────────
// Greeting detection
// ───────────────────────────────────────────────────
const GREETING_PATTERNS = [
  'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening',
  'magandang umaga', 'magandang hapon', 'magandang gabi',
  'kumusta', 'kamusta', 'musta',
  'yo', 'sup', 'what\'s up', 'howdy',
];

function isGreeting(message = '') {
  const lower = message.trim().toLowerCase().replace(/[!?.,:;]/g, '');
  return GREETING_PATTERNS.some((g) => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + ','));
}

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning po! ☀️';
  if (hour < 18) return 'Good afternoon po! 🌤️';
  return 'Good evening po! 🌙';
}

// ───────────────────────────────────────────────────
// Default follow-up suggestions
// ───────────────────────────────────────────────────
const DEFAULT_FOLLOWUPS = [
  { label: 'Billing & Payments', prompt: 'Tell me about my billing.' },
  { label: 'House Rules', prompt: 'What are the dormitory rules?' },
  { label: 'Talk to Admin', prompt: 'Connect me to an admin.' },
];

module.exports = {
  CHATBOT_SYSTEM_PROMPT,
  KNOWLEDGE_BASE,
  ESCALATION_KEYWORDS,
  GREETING_PATTERNS,
  DEFAULT_FOLLOWUPS,
  isGreeting,
  getTimeOfDayGreeting,
};
