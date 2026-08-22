export const LILY_TOPICS = Object.freeze([
  Object.freeze({ id: 'billing', label: 'Billing' }),
  Object.freeze({ id: 'maintenance', label: 'Maintenance' }),
  Object.freeze({ id: 'documents', label: 'Documents' }),
  Object.freeze({ id: 'house-rules', label: 'House Rules' }),
  Object.freeze({ id: 'account', label: 'Account & Support' }),
]);

const UNRESOLVED_SUGGESTIONS = Object.freeze([
  'How much do I need to pay this month?',
  'Check my maintenance request.',
  'What documents are available to me?',
  'Continue a concern with admin support.',
]);

const RESIDENT_DOCUMENT_SUGGESTIONS = Object.freeze([
  'View my contract.',
  'What is my current contract status?',
  'What documents are available to me?',
]);

const PRE_MOVE_IN_DOCUMENT_SUGGESTIONS = Object.freeze([
  'What is my current contract status?',
  'What move-in date is on my account?',
  'What documents are still required?',
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

export function getLilyTopicSuggestions(topicId, options = {}) {
  const tenantState = options?.tenantState || 'unresolved';
  const initialSuggestions = Array.isArray(options?.initialSuggestions)
    ? options.initialSuggestions.filter((suggestion) => typeof suggestion === 'string' && suggestion.trim())
    : [];

  if (!topicId) {
    return initialSuggestions.length ? initialSuggestions : UNRESOLVED_SUGGESTIONS;
  }

  if (topicId === 'documents') {
    if (tenantState === 'resident') return RESIDENT_DOCUMENT_SUGGESTIONS;
    if (tenantState === 'pre_move_in') return PRE_MOVE_IN_DOCUMENT_SUGGESTIONS;
  }

  return LILY_TOPIC_SUGGESTIONS[topicId] || UNRESOLVED_SUGGESTIONS;
}
