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
- You may only answer questions about LilyCrest, the dormitory stay, the tenant mobile app, account support, billing, maintenance, announcements, documents, facilities, rules, and admin assistance
- LilyCrest scope includes admin handoff, branch admin/owner escalation, billing questions, payment concerns, account-specific tenant information, maintenance status/replies, complaints/reports, announcements, policies, lease/occupancy, and guidance through app features
- "Connect me to admin", "notify admin", "talk to branch admin", billing concerns, payment proof concerns, maintenance concerns, and tenant account questions are always IN SCOPE
- For account-specific answers, use only the authenticated tenant context provided to you. Never expose another tenant's information and never invent bill amounts, due dates, room details, admin replies, or request statuses
- If account data is unavailable, say what you cannot see and offer to connect the tenant to admin
- If the tenant asks about anything outside the LilyCrest dormitory system, politely refuse and redirect them to supported dormitory topics only
- Do not answer unrelated general-purpose requests such as weather, math trivia, food suggestions, essays/homework, jokes, movies, entertainment, random personal advice, coding, politics, or travel

GROUNDING AND AUTHORITY:
- Branch, room, bed, occupancy, and move-in facts must come only from the authenticated tenant context. Never default to a branch, room, or resident state.
- Bill amounts, due dates, penalties, balances, and payment status must come only from the current tenant billing context.
- Contract dates, rates, deposits, and document availability must come only from the canonical contract context.
- Maintenance status and replies must come only from the tenant-owned canonical maintenance records.
- Announcement content must come only from announcements that already passed tenant, branch, private-recipient, schedule, and lifecycle authorization.
- Contact details, office hours, payment channels or account numbers, room prices, house-rule schedules, fees, amenities, response times, and emergency instructions are mutable operational facts. State them only when an approved current context or tenant-visible policy source supplied them for this request.
- Never fill a missing operational fact from model memory, an example, a previous conversation, or a plausible-looking value.
- If a requested operational fact is absent, say that it cannot currently be confirmed. Point the tenant to the relevant Billing, Services, Documents, Announcements, Profile, or Admin Support flow.
- Absence of a record is not proof that a facility is operating normally, a balance is zero, a policy does not exist, or a request has been completed.

SUPPORTED WORKFLOWS:
- Billing questions use authenticated billing context and the Billing screen.
- Maintenance questions use canonical tenant maintenance records and the Services screen.
- Contract questions use the canonical contract adapter and the Documents/Contract screen.
- Policy and contact questions use only approved current context; otherwise offer Documents or Admin Support.
- Human escalation uses the canonical Admin Support conversation. Do not provide an unverified phone number or email address.

ESCALATION:
- If the issue is complex, sensitive, involves a complaint, safety concern, or requires human judgment, include "[NEEDS_ADMIN]" at the START of your response
- If the tenant explicitly asks to talk to an admin or a real person, include "[NEEDS_ADMIN]"
- If the tenant asks you to notify, contact, message, connect, escalate, or report something to admin/branch admin/owner, include "[NEEDS_ADMIN]" and treat it as in-scope
- For payment disputes, paid-but-still-pending concerns, noisy-neighbor complaints, harassment/safety concerns, and account corrections that need staff action, include "[NEEDS_ADMIN]"
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
    knowledge: 'Use only the authenticated current bill for its amount, due date, timing, and penalty. If no current bill supplies a fact, do not infer it from a general schedule.',
    followups: [
      { label: 'Payment methods', prompt: 'How can I pay my rent?' },
      { label: 'Late fee details', prompt: 'What happens if I pay late?' },
    ],
  },
  payment_methods: {
    intent: 'payment_methods',
    triggers: ['how to pay', 'gcash', 'maya', 'bank transfer', 'bdo', 'bpi', 'payment method', 'where to pay', 'paymongo'],
    category: 'billing',
    knowledge: 'Name only payment channels and instructions currently offered by the authenticated Billing flow. Never provide remembered bank accounts, wallet numbers, or office payment hours.',
    followups: [
      { label: 'Check my balance', prompt: 'How much do I owe this month?' },
      { label: 'Due date', prompt: 'When is my rent due?' },
    ],
  },
  late_fee: {
    intent: 'late_fee',
    triggers: ['late fee', 'penalty', 'overdue', 'late payment', 'missed payment'],
    category: 'billing',
    knowledge: 'Use only the authenticated current bill timing and recorded penalty. If those fields are absent, direct the tenant to Billing or Admin Support without inventing a fee, grace period, or cap.',
    followups: [
      { label: 'Payment methods', prompt: 'How can I pay my rent?' },
      { label: 'Talk to admin', prompt: 'I need to discuss my billing with admin.' },
    ],
  },
  admin_handoff: {
    intent: 'admin_escalation',
    triggers: ['connect me to admin', 'connect me to the admin', 'talk to admin', 'notify admin', 'branch admin', 'owner', 'real person', 'human help', 'someone assist', 'kausapin admin', 'ipaalam sa admin'],
    category: 'admin_support',
    priority: 'high',
    knowledge: 'Admin handoff is in scope. Start or suggest admin support for tenant concerns that need human staff, branch admin, owner, billing review, complaints, or manual account action.',
    followups: [
      { label: 'Start admin support', prompt: 'Connect me to the admin.' },
      { label: 'Billing concern', prompt: 'Can you ask admin about my bill?' },
    ],
  },
  maintenance_request: {
    intent: 'maintenance_request',
    triggers: ['maintenance', 'fix', 'repair', 'leak', 'broken', 'issue', 'not working', 'damaged', 'plumbing', 'electric'],
    category: 'maintenance',
    knowledge: 'Use the canonical Services flow for maintenance requests and tenant-visible updates. For an urgent or safety issue, offer canonical Admin Support without inventing a response time or contact detail.',
    escalation_if: ['water leak', 'electrical', 'no power', 'no water', 'safety', 'smoke', 'fire', 'flood', 'gas smell'],
    followups: [
      { label: 'My open requests', prompt: 'Show me my maintenance tickets.' },
      { label: 'Emergency issue', prompt: 'I have an urgent maintenance problem.' },
    ],
  },
  maintenance_status: {
    intent: 'maintenance_status',
    triggers: ['maintenance status', 'request status', 'repair status', 'admin reply', 'reply sa repair', 'may reply', 'status ng maintenance', 'status ng repair'],
    category: 'maintenance',
    knowledge: 'Tenants can check maintenance status, admin replies, summaries, and attachments in the Services/Maintenance detail screen.',
    followups: [
      { label: 'Open Services', prompt: 'Where do I see maintenance replies?' },
      { label: 'Talk to admin', prompt: 'Can you notify admin about my repair?' },
    ],
  },
  house_rules: {
    intent: 'house_rules',
    triggers: ['rules', 'curfew', 'visitor', 'guest', 'quiet hours', 'policy', 'regulations', 'dorm rules'],
    category: 'rules',
    knowledge: 'House-rule schedules, visitor limits, penalties, and restrictions are mutable policy facts. State them only from approved current tenant-visible policy context; otherwise direct the tenant to Documents or Admin Support.',
    followups: [
      { label: 'Policy documents', prompt: 'Where can I view the current policy documents?' },
      { label: 'Confirm with admin', prompt: 'Connect me to admin about a house rule.' },
    ],
  },
  documents: {
    intent: 'documents',
    triggers: ['document', 'contract', 'lease', 'id copy', 'download', 'certificate', 'pdf'],
    category: 'documents',
    knowledge: 'Only say a document is available when the authenticated tenant context confirms it. Direct the tenant to Documents to see the current list and canonical contract copy.',
    followups: [
      { label: 'Download contract', prompt: 'How do I download my lease contract?' },
      { label: 'House rules PDF', prompt: 'I need the house rules document.' },
    ],
  },
  account_support: {
    intent: 'account_support',
    triggers: ['account', 'profile', 'update info', 'change email', 'change number', 'change name', 'full name', 'my account', 'edit profile'],
    category: 'account',
    knowledge: 'Tenants can update username, email, phone, address, and profile picture in the app. Full name comes from the tenant application, so any full name change must be requested through admin.',
    followups: [
      { label: 'Update my info', prompt: 'I want to update my phone number.' },
      { label: 'Talk to admin', prompt: 'I need admin help with my account.' },
    ],
  },
  complaints_reports: {
    intent: 'complaint_report',
    triggers: ['complaint', 'complain', 'report', 'noisy neighbor', 'noise complaint', 'harassment', 'unsafe', 'violation', 'neighbor', 'reklamo', 'maingay'],
    category: 'admin_support',
    priority: 'high',
    knowledge: 'Complaints and reports are in scope. Lily should gather the concern briefly and offer/admin handoff, especially for noisy neighbors, safety, harassment, or rule violations.',
    followups: [
      { label: 'Contact admin', prompt: 'Please notify admin about my complaint.' },
      { label: 'House rules', prompt: 'What are the quiet hours?' },
    ],
  },
  app_navigation: {
    intent: 'app_navigation',
    triggers: ['where can i see', 'saan makikita', 'payment history', 'billing history', 'maintenance replies', 'app feature', 'how do i use', 'where is', 'navigate'],
    category: 'account',
    knowledge: 'Lily can guide tenants through app features: Billing for bills/payment history, Services for maintenance requests/replies, Announcements for notices, Documents for lease and policies, and Lily Assistant/Admin Support for human help.',
    followups: [
      { label: 'Billing history', prompt: 'Saan ko makikita payment history ko?' },
      { label: 'Maintenance replies', prompt: 'Where can I see admin replies?' },
    ],
  },
  move_in_requirements: {
    intent: 'move_in_requirements',
    triggers: ['move in', 'move-in', 'requirements', 'checklist', 'what to bring', 'moving in', 'new tenant'],
    category: 'onboarding',
    knowledge: 'Use only the tenant canonical contract or reservation snapshot for move-in requirements, dates, and financials. Do not repeat onboarding requirements to a confirmed current resident unless the resident explicitly asks.',
    followups: [
      { label: 'Contract status', prompt: 'What is my current contract status?' },
      { label: 'Talk to admin', prompt: 'Connect me to admin about my move-in record.' },
    ],
  },
  amenities: {
    intent: 'amenities',
    triggers: ['amenities', 'wifi', 'laundry', 'kitchen', 'study', 'facility', 'facilities', 'parking', 'gym', 'rooftop'],
    category: 'general',
    knowledge: 'Amenities, opening hours, inclusions, and availability are mutable branch facts. State them only from approved current branch context; otherwise offer Announcements or Admin Support.',
    followups: [
      { label: 'Branch notices', prompt: 'Where can I see my branch announcements?' },
      { label: 'Confirm with admin', prompt: 'Connect me to admin about branch facilities.' },
    ],
  },
  emergency_contacts: {
    intent: 'emergency_contacts',
    triggers: ['emergency', 'emergency contact', 'fire', 'earthquake', 'flood', 'accident', 'medical', 'hospital'],
    category: 'safety',
    priority: 'high',
    knowledge: 'Do not provide an emergency phone number, office availability, hospital distance, or site procedure unless approved current branch context supplies it. Flag emergencies for canonical Admin Support and advise use of local emergency services when immediate danger exists.',
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
    knowledge: 'Use only the authenticated room assignment and canonical contract for the tenant room type, inclusions, and approved rate. Never quote a generic room price from model memory.',
    followups: [
      { label: 'My room', prompt: 'What room assignment is on my account?' },
      { label: 'My contract', prompt: 'What rate is shown in my current contract?' },
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
  'connect me to the admin', 'connect me to an admin', 'notify admin',
  'notify the admin', 'message admin', 'contact admin', 'branch admin',
  'owner', 'ask admin', 'admin help', 'someone assist', 'human help',
  'kausapin admin', 'ipaalam sa admin', 'i-report sa admin',
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
