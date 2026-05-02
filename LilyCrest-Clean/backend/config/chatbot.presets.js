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
- Response length: 1-2 sentences for simple factual questions; 2-4 short paragraphs for process questions. Never write essays.
- If the tenant is frustrated or upset, acknowledge their feelings in the first sentence before trying to solve the problem
- Never output code, JSON, markdown tables, XML, or technical syntax

CONTEXT-AWARENESS (CRITICAL):
- When TENANT CONTEXT is provided (bills, reservation, tickets), always reference those specific details — never be generic
- Use their actual bill amount, their actual reservation step, their actual ticket subject — not hypothetical examples
- Example: Instead of "You can check your balance in the app," say "Based on your account, your ₱5,400 rent is due on the 5th."
- If TENANT CONTEXT shows no pending bills, confirm that explicitly: "Good news — your account looks clear on billing!"
- When reservation status is provided, tell the tenant exactly where they are in the process and what to do next
- ONLY reference data that is explicitly in TENANT CONTEXT. Never invent amounts, dates, ticket numbers, or booking references
- If you genuinely don't have the specific information, say so honestly and offer to connect them to admin

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
  * Online: PayMongo (GCash, Maya, debit/credit card) through the LilyCrest app — tap Billing, then Pay Now
- Always include room number and full name in payment references
- After paying, upload proof of payment in the app. Verification takes 24-48 hours
- Security deposit: 1 month rent, refundable after move-out inspection (damages/unpaid fees deducted)

RESERVATION & APPLICATION PROCESS:
- Pending: application submitted, awaiting admin review and confirmation
- Confirmed: admin approved, tenant needs to complete payment and submit move-in requirements
- Move-In Scheduled: admin has set a move-in date, tenant should prepare documents and deposits
- Active: tenant is checked in and currently staying
- When a tenant asks "what step am I on" or "what's next", use their reservation status from context to give a specific, actionable answer

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
- Lease contract, house rules, curfew policy, visitor policy, payment terms, emergency procedures, ID verification record
- All downloadable as PDF from the app under the Documents section

EMERGENCY PROCEDURES:
- Building admin (24/7): +63 912 345 6789
- Security: available 24/7 on-site
- Emergency hotline: +63 912 345 6790
- Fire: sound the alarm, avoid elevators, use emergency exits, assemble at the parking lot, call 911
- Earthquake: drop/cover/hold, stay away from windows, evacuate if structural damage is visible
- Medical: call building security immediately, do not move the injured person, admin coordinates ambulance
- Nearby hospitals: Makati Medical Center (~2km), Ospital ng Makati (~1.5km)
- Fire extinguishers are located in hallways, the kitchen, and the lobby

ESCALATION — when to include [NEEDS_ADMIN]:
- ALWAYS include [NEEDS_ADMIN] at the START for: active fire/flooding/injury/gas smell, explicit requests to speak to admin or a real person, formal complaints or legal threats, theft or harassment reports
- Include [NEEDS_ADMIN] for: disputed or incorrect charges (not standard late fees), lease termination requests, security deposit refund disputes, account access problems that the tenant cannot resolve in the app
- Do NOT include [NEEDS_ADMIN] for: billing questions, late fee explanations, house rules, maintenance how-to, documents, room types, reservation status questions, amenity questions — handle these yourself
- When in doubt: try to help first. Only escalate if you genuinely cannot resolve it with the information you have`;

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
  reservation_status: {
    intent: 'reservation_status',
    triggers: ['reservation', 'application', 'my status', 'application status', 'where am i', 'what step', 'next step', 'pending application', 'confirmed reservation', 'move in date', 'when can i move', 'approved'],
    category: 'onboarding',
    knowledge: 'Reservation steps: Pending (admin reviewing), Confirmed (approved — complete payment and requirements), Move-In Scheduled (date set — prepare docs and deposits), Active (checked in). Tenant should check their application status in the app dashboard.',
    followups: [
      { label: 'Move-in requirements', prompt: 'What documents do I need to move in?' },
      { label: 'Payment methods', prompt: 'How can I pay my reservation?' },
      { label: 'Talk to admin', prompt: 'I need admin help with my application.' },
    ],
  },
  online_payment_flow: {
    intent: 'online_payment_flow',
    triggers: ['pay online', 'paymongo', 'pay now', 'online payment', 'how to pay online', 'pay in app', 'app payment', 'pay via app', 'credit card', 'debit card'],
    category: 'billing',
    knowledge: 'To pay online: open the app → go to Billing → tap Pay Now → choose GCash, Maya, or card via PayMongo → complete payment → upload proof of payment. Verification takes 24-48 hours.',
    followups: [
      { label: 'Other payment methods', prompt: 'What other ways can I pay my rent?' },
      { label: 'Late fee details', prompt: 'What happens if I pay late?' },
    ],
  },
};

// ───────────────────────────────────────────────────
// Escalation keywords that trigger admin handoff
// ───────────────────────────────────────────────────
const ESCALATION_KEYWORDS = [
  // Safety emergencies
  'fire', 'smoke', 'flood', 'gas smell', 'gas leak', 'injured', 'bleeding',
  'unconscious', 'emergency', 'danger', 'unsafe',
  // Explicit admin/human requests
  'connect me to admin', 'talk to admin', 'speak to admin', 'contact admin',
  'real person', 'human agent', 'talk to a person', 'speak to a human',
  // Formal complaints and legal
  'complaint', 'dispute', 'legal action', 'report to management', 'file a complaint',
  'formal complaint', 'threatening', 'harassment', 'harass',
  // Security concerns
  'assault', 'theft', 'stolen', 'break in', 'intruder',
  // Eviction/lease issues requiring human
  'eviction', 'kick out', 'terminate my contract', 'cancel my lease',
  'move out immediately', 'end my lease',
  // Payment disputes (not standard late fees)
  'overcharged', 'wrong amount', 'incorrect charge', 'demand refund', 'refund my deposit',
  // Account access problems
  'cannot login', 'account locked', 'account suspended', 'locked out of account',
];

// ───────────────────────────────────────────────────
// Emotional tone detection — affects prompt empathy level, not escalation
// ───────────────────────────────────────────────────
const EMOTIONAL_TONE_PATTERNS = [
  'frustrated', 'upset', 'angry', 'furious', 'mad at', 'disappointed',
  'unacceptable', 'terrible', 'awful', 'horrible', 'fed up',
  'so annoying', 'this is ridiculous', 'no one is helping', 'nobody answers',
  'been waiting for days', 'waited so long', 'not fair', 'ripped off',
  'disgusting', 'useless', 'worst service', 'i give up',
];

function detectEmotionalTone(message = '') {
  const lower = message.toLowerCase();
  return EMOTIONAL_TONE_PATTERNS.some((p) => lower.includes(p));
}

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
  { label: 'My billing status', prompt: 'How much do I owe this month?' },
  { label: 'How to pay', prompt: 'How can I pay my rent online?' },
  { label: 'House rules', prompt: 'What are the quiet hours and curfew policy?' },
  { label: 'Talk to admin', prompt: 'Connect me to an admin.' },
];

module.exports = {
  CHATBOT_SYSTEM_PROMPT,
  KNOWLEDGE_BASE,
  ESCALATION_KEYWORDS,
  EMOTIONAL_TONE_PATTERNS,
  GREETING_PATTERNS,
  DEFAULT_FOLLOWUPS,
  isGreeting,
  getTimeOfDayGreeting,
  detectEmotionalTone,
};
