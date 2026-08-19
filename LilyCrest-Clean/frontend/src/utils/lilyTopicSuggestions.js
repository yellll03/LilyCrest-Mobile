export const LILY_TOPICS = Object.freeze([
  Object.freeze({ id: 'billing', label: 'Billing' }),
  Object.freeze({ id: 'maintenance', label: 'Maintenance' }),
  Object.freeze({ id: 'documents', label: 'Documents' }),
  Object.freeze({ id: 'house-rules', label: 'House Rules' }),
  Object.freeze({ id: 'account', label: 'Account & Support' }),
]);

const DEFAULT_SUGGESTIONS = Object.freeze([
  'How much do I need to pay this month?',
  'Comply with move-in requirements',
  'Curfew and visitor policy',
  'File a complaint to admin',
]);

export const LILY_TOPIC_SUGGESTIONS = Object.freeze({
  billing: Object.freeze([
    'How much do I need to pay?',
    'When is my due date?',
    'Show my latest statement.',
    'Explain my electricity/water charges.',
  ]),
  maintenance: Object.freeze([
    'Report a maintenance issue.',
    'Check my maintenance request.',
    'My previous concern still persists.',
  ]),
  documents: Object.freeze([
    'View my contract.',
    'What is my current contract status?',
    'What documents are still required?',
  ]),
  'house-rules': Object.freeze([
    'What are the current house rules?',
    'Explain the curfew and visitor policy.',
    'What are the quiet hours?',
  ]),
  account: Object.freeze([
    'Check my existing inquiries.',
    'Help with my Lilycrest account.',
    'Continue a concern with admin support.',
  ]),
});

export function getLilyTopicSuggestions(topicId) {
  return LILY_TOPIC_SUGGESTIONS[topicId] || DEFAULT_SUGGESTIONS;
}
