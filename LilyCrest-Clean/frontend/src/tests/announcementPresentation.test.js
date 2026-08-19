/* global test */
import {
  ANNOUNCEMENT_CATEGORY_PRESENTATION,
  getAnnouncementCategoryPresentation,
} from '../utils/announcementPresentation';

describe('announcement semantic category presentation', () => {
  test('canonical categories use distinct meaningful icons', () => {
    const expected = {
      general: 'information-circle-outline',
      policy: 'shield-checkmark-outline',
      alert: 'warning-outline',
      reminder: 'notifications-outline',
    };

    expect(Object.fromEntries(
      Object.keys(expected).map((category) => [category, getAnnouncementCategoryPresentation(category).icon]),
    )).toEqual(expected);
    expect(new Set(Object.values(expected)).size).toBe(4);
  });

  test('category metadata is independent from priority presentation', () => {
    expect(ANNOUNCEMENT_CATEGORY_PRESENTATION).not.toHaveProperty('urgent');
    expect(ANNOUNCEMENT_CATEGORY_PRESENTATION).not.toHaveProperty('normal');
  });

  test('unknown categories fall back to neutral information', () => {
    expect(getAnnouncementCategoryPresentation('unknown')).toMatchObject({
      icon: 'information-circle-outline',
      text: '#4B5563',
    });
  });
});
