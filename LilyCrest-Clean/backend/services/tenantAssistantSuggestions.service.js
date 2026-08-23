const RESIDENT_STATUSES = new Set([
  'active',
  'current',
  'occupied',
  'checked_in',
  'in_residence',
  'moved_in',
]);

const PRE_MOVE_IN_STATUSES = new Set([
  'applicant',
  'pending',
  'reserved',
  'confirmed',
  'scheduled',
  'awaiting_move_in',
  'pre_move_in',
]);

function normalizedStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function classifyTenantAssistantState(accountContext = {}) {
  const statuses = [
    accountContext.occupancyStatus,
    accountContext.leaseStatus,
  ].map(normalizedStatus).filter(Boolean);

  if (statuses.some((status) => RESIDENT_STATUSES.has(status))) return 'resident';
  if (statuses.some((status) => PRE_MOVE_IN_STATUSES.has(status))) return 'pre_move_in';
  return 'unresolved';
}

function getTenantAssistantSuggestions(accountContext = {}) {
  const state = classifyTenantAssistantState(accountContext);

  if (state === 'resident') {
    return {
      state,
      suggestions: [
        'How much do I need to pay this month?',
        'Check my maintenance request.',
        'What is my current contract status?',
        'Continue a concern with admin support.',
      ],
    };
  }

  if (state === 'pre_move_in') {
    return {
      state,
      suggestions: [
        'What is my current contract status?',
        'What move-in date is on my account?',
        'What documents are still required?',
        'Continue a concern with admin support.',
      ],
    };
  }

  return {
    state,
    suggestions: [
      'How much do I need to pay this month?',
      'Check my maintenance request.',
      'What documents are available to me?',
      'Continue a concern with admin support.',
    ],
  };
}

module.exports = {
  classifyTenantAssistantState,
  getTenantAssistantSuggestions,
};
