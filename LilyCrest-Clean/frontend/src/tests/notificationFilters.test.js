import {
  buildNotificationFilterCounts,
  filterNotifications,
  isUrgentNotification,
  normalizeNotificationCategory,
  sortNotifications,
} from '../utils/notificationFilters';

const FIXTURE = [
  { notification_id: 'security-urgent', category: 'Security', priority: 'high', created_at: '2026-08-03T00:00:00.000Z' },
  { notification_id: 'security-normal', category: 'security', priority: 'normal', created_at: '2026-08-01T00:00:00.000Z' },
  { notification_id: 'general-urgent', category: 'General', priority: 'normal', is_urgent: true, created_at: '2026-08-02T00:00:00.000Z' },
  { notification_id: 'event-low', category: 'Event', priority: 'low', created_at: '2026-08-04T00:00:00.000Z' },
];

describe('notification filter presentation model', () => {
  it('normalizes category casing and defaults blank categories to general', () => {
    expect(normalizeNotificationCategory(' SECURITY ')).toBe('security');
    expect(normalizeNotificationCategory('')).toBe('general');
  });

  it('shows all, category-only, urgent-only, and category-plus-urgent intersections', () => {
    expect(filterNotifications(FIXTURE)).toHaveLength(4);
    expect(filterNotifications(FIXTURE, { category: 'security' }).map((item) => item.notification_id))
      .toEqual(['security-urgent', 'security-normal']);
    expect(filterNotifications(FIXTURE, { priority: 'urgent' }).map((item) => item.notification_id))
      .toEqual(['security-urgent', 'general-urgent']);
    expect(filterNotifications(FIXTURE, { category: 'security', priority: 'urgent' }).map((item) => item.notification_id))
      .toEqual(['security-urgent']);
  });

  it('treats the explicit urgent flag as urgent even when priority is normal', () => {
    expect(isUrgentNotification(FIXTURE[2])).toBe(true);
    expect(filterNotifications(FIXTURE, { priority: 'normal' }).map((item) => item.notification_id))
      .toEqual(['security-normal', 'event-low']);
  });

  it('sorts newest and oldest without mutating authoritative input order', () => {
    const originalOrder = FIXTURE.map((item) => item.notification_id);
    expect(sortNotifications(FIXTURE, 'newest').map((item) => item.notification_id))
      .toEqual(['event-low', 'security-urgent', 'general-urgent', 'security-normal']);
    expect(sortNotifications(FIXTURE, 'oldest').map((item) => item.notification_id))
      .toEqual(['security-normal', 'general-urgent', 'security-urgent', 'event-low']);
    expect(FIXTURE.map((item) => item.notification_id)).toEqual(originalOrder);
  });

  it('keeps urgency cross-cutting instead of adding it to category totals', () => {
    const counts = buildNotificationFilterCounts(FIXTURE);
    expect(counts.allCategories).toBe(4);
    expect(Object.fromEntries(counts.categories)).toEqual({ security: 2, general: 1, event: 1 });
    expect(counts.priorities).toEqual({ all: 4, urgent: 2, normal: 2 });

    const securityCounts = buildNotificationFilterCounts(FIXTURE, { category: 'security' });
    expect(securityCounts.priorities).toEqual({ all: 2, urgent: 1, normal: 1 });

    const urgentCounts = buildNotificationFilterCounts(FIXTURE, { priority: 'urgent' });
    expect(urgentCounts.allCategories).toBe(2);
    expect(Object.fromEntries(urgentCounts.categories)).toEqual({ security: 1, general: 1 });
  });
});
