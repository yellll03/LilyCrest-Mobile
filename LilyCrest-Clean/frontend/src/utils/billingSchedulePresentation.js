const RENDERABLE_STATES = new Set(['available', 'pending', 'unavailable']);

function hasUtilityCharge(bill, utility) {
  const amount = bill?.[utility];
  const breakdown = bill?.[`${utility}_breakdown`];
  return (
    (amount !== null && amount !== undefined && amount !== '' && Number(amount) !== 0)
    || (Array.isArray(breakdown) ? breakdown.length > 0 : Boolean(breakdown))
  );
}

function normalizeExplicitSchedule(schedule = {}) {
  const state = String(schedule.state || '').trim().toLowerCase();
  if (state === 'not_applicable') return null;
  return {
    ...schedule,
    state: RENDERABLE_STATES.has(state) ? state : 'unavailable',
  };
}

export function getRenderableUtilitySchedules(bill = {}) {
  const explicitSchedules = Object.entries(bill.utility_schedules || {})
    .map(([utility, schedule]) => [utility, normalizeExplicitSchedule(schedule)])
    .filter(([, schedule]) => Boolean(schedule));
  if (explicitSchedules.length > 0) return explicitSchedules;

  const legacySchedules = Object.entries(bill.utility_deadlines || {}).map(([utility, deadline]) => [
    utility,
    {
      state: deadline?.billReleaseDate && deadline?.finalDueDate ? 'available' : 'pending',
      release_date: deadline?.billReleaseDate || null,
      due_date: deadline?.finalDueDate || null,
      reading_date: deadline?.meterReadingDate || null,
    },
  ]);
  if (legacySchedules.length > 0) return legacySchedules;

  return ['electricity', 'water']
    .filter((utility) => hasUtilityCharge(bill, utility))
    .map((utility) => [utility, { state: 'unavailable' }]);
}

export function utilityScheduleStateMessage(state) {
  if (state === 'pending') {
    return 'This utility charge is still being finalized. Dates will appear after publication.';
  }
  if (state === 'unavailable') {
    return 'Schedule dates are temporarily unavailable. Pull to refresh or contact your branch administrator.';
  }
  return '';
}
