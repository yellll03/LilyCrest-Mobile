export const MAINTENANCE_GROUPS = Object.freeze({
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
});

export const MAINTENANCE_ACTIONS = Object.freeze({
  EDIT: 'edit',
  CANCEL: 'cancel',
  REPLY: 'reply',
  CONFIRM_RESOLVED: 'confirm_resolved',
  REOPEN: 'reopen',
  SUBMIT_SIMILAR: 'submit_similar',
});

export const MAINTENANCE_STAGE_KEYS = Object.freeze({
  PENDING_REVIEW: 'pending_review',
  UNDER_REVIEW: 'under_review',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  COMPLETED: 'completed',
});

const ACTIVE_ACTIONS = Object.freeze([
  MAINTENANCE_ACTIONS.REPLY,
  MAINTENANCE_ACTIONS.SUBMIT_SIMILAR,
]);
const PENDING_ACTIONS = Object.freeze([
  MAINTENANCE_ACTIONS.EDIT,
  MAINTENANCE_ACTIONS.CANCEL,
  ...ACTIVE_ACTIONS,
]);
const RESOLVED_ACTIONS = Object.freeze([
  MAINTENANCE_ACTIONS.CONFIRM_RESOLVED,
  MAINTENANCE_ACTIONS.REOPEN,
  MAINTENANCE_ACTIONS.SUBMIT_SIMILAR,
]);
const CLOSED_ACTIONS = Object.freeze([MAINTENANCE_ACTIONS.SUBMIT_SIMILAR]);

function definition(group, stage, actions) {
  return Object.freeze({ group, stage, actions });
}

// Mobile source of truth for list placement, progress-stage placement, and
// tenant actions. Canonical backend spellings and known website/legacy
// spellings live together here instead of in independent screen arrays.
export const MAINTENANCE_STATUS_DEFINITIONS = Object.freeze({
  pending: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.PENDING_REVIEW, PENDING_ACTIONS),
  pending_review: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.PENDING_REVIEW, ACTIVE_ACTIONS),
  viewed: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.UNDER_REVIEW, ACTIVE_ACTIONS),
  reviewed: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.UNDER_REVIEW, ACTIVE_ACTIONS),
  assigned: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  provider_assigned: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  scheduled: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  in_progress: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  'in process': definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  waiting_tenant: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  reopened: definition(MAINTENANCE_GROUPS.ACTIVE, MAINTENANCE_STAGE_KEYS.IN_PROGRESS, ACTIVE_ACTIONS),
  resolved: definition(MAINTENANCE_GROUPS.RESOLVED, MAINTENANCE_STAGE_KEYS.RESOLVED, RESOLVED_ACTIONS),
  completed: definition(MAINTENANCE_GROUPS.RESOLVED, MAINTENANCE_STAGE_KEYS.COMPLETED, CLOSED_ACTIONS),
  rejected: definition(MAINTENANCE_GROUPS.RESOLVED, null, CLOSED_ACTIONS),
  closed: definition(MAINTENANCE_GROUPS.RESOLVED, null, CLOSED_ACTIONS),
  cancelled: definition(MAINTENANCE_GROUPS.CANCELLED, null, CLOSED_ACTIONS),
});

const UNKNOWN_STATUS_DEFINITION = definition(
  MAINTENANCE_GROUPS.ACTIVE,
  null,
  CLOSED_ACTIONS,
);

const STAGE_METADATA = Object.freeze([
  { key: MAINTENANCE_STAGE_KEYS.PENDING_REVIEW, label: 'Pending Review', cardTitle: 'Request Received', detail: 'Awaiting Admin Review' },
  { key: MAINTENANCE_STAGE_KEYS.UNDER_REVIEW, label: 'Under Review', cardTitle: 'Admin Reviewing', detail: 'Being Reviewed by Admin' },
  { key: MAINTENANCE_STAGE_KEYS.IN_PROGRESS, label: 'In Progress', cardTitle: 'Repair In Progress', detail: 'Provider Assigned & Working' },
  { key: MAINTENANCE_STAGE_KEYS.RESOLVED, label: 'Resolved', cardTitle: 'Work Resolved', detail: 'Awaiting Tenant Feedback & Verification' },
  { key: MAINTENANCE_STAGE_KEYS.COMPLETED, label: 'Completed', cardTitle: 'Request Completed', detail: 'Confirmed & Closed' },
]);

export const MAINTENANCE_STATUS_STAGES = Object.freeze(STAGE_METADATA.map((stage) => Object.freeze({
  ...stage,
  statuses: Object.freeze(Object.entries(MAINTENANCE_STATUS_DEFINITIONS)
    .filter(([, value]) => value.stage === stage.key)
    .map(([status]) => status)),
})));

export function normalizeMaintenanceStatus(status) {
  return String(status || 'pending').trim().toLowerCase();
}

export function getMaintenanceStatusDefinition(status) {
  return MAINTENANCE_STATUS_DEFINITIONS[normalizeMaintenanceStatus(status)]
    || UNKNOWN_STATUS_DEFINITION;
}

export function getMaintenanceStatusGroup(status) {
  return getMaintenanceStatusDefinition(status).group;
}

export function getMaintenanceAllowedActions(status) {
  return getMaintenanceStatusDefinition(status).actions;
}
