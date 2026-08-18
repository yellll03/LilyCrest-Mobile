/* global test */
import {
  getRenderableUtilitySchedules,
  utilityScheduleStateMessage,
} from '../utils/billingSchedulePresentation';

describe('billing schedule presentation', () => {
  test('renders canonical available dates instead of an empty schedule card', () => {
    const schedules = getRenderableUtilitySchedules({
      electricity: 7200,
      utility_schedules: {
        electricity: {
          state: 'available',
          period_start: '2026-08-17T16:00:00.000Z',
          period_end: '2026-09-17T16:00:00.000Z',
          reading_date: '2026-09-17T16:00:00.000Z',
          release_date: '2026-08-17T19:15:21.574Z',
          due_date: '2026-09-27T16:00:00.000Z',
        },
      },
    });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toEqual(['electricity', expect.objectContaining({
      state: 'available',
      due_date: '2026-09-27T16:00:00.000Z',
    })]);
  });

  test('keeps pending explicit and suppresses not-applicable utilities', () => {
    expect(getRenderableUtilitySchedules({
      utility_schedules: {
        electricity: { state: 'pending' },
        water: { state: 'not_applicable' },
      },
    })).toEqual([['electricity', expect.objectContaining({ state: 'pending' })]]);
    expect(utilityScheduleStateMessage('pending')).toMatch(/still being finalized/i);
  });

  test('renders unavailable copy for an explicit unavailable state', () => {
    expect(getRenderableUtilitySchedules({
      utility_schedules: { electricity: { state: 'unavailable' } },
    })[0][1].state).toBe('unavailable');
    expect(utilityScheduleStateMessage('unavailable')).toMatch(/temporarily unavailable/i);
  });

  test('never leaves a charge or supplied breakdown with a blank schedule section', () => {
    expect(getRenderableUtilitySchedules({ electricity: 7200 }))
      .toEqual([['electricity', { state: 'unavailable' }]]);
    expect(getRenderableUtilitySchedules({ electricity_breakdown: [{ total: 7200 }] }))
      .toEqual([['electricity', { state: 'unavailable' }]]);
  });

  test('does not invent a schedule when amount and breakdown are both absent', () => {
    expect(getRenderableUtilitySchedules({})).toEqual([]);
  });
});
