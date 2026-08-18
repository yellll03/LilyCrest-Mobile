/* global test */
import { BRAND, DARK_COLORS, LIGHT_COLORS, RADII, SPACING, STATUS, statusTone } from '../theme/tokens';

describe('canonical Lilycrest mobile theme', () => {
  test('exposes the authoritative brand, surface, spacing, and radius tokens', () => {
    expect(BRAND).toMatchObject({ primary: '#0A1628', accent: '#D4AF37' });
    expect(LIGHT_COLORS).toMatchObject({ background: '#F8FAFC', surface: '#FFFFFF', border: '#E5E7EB' });
    expect(DARK_COLORS).toMatchObject({ background: '#08111F', surface: '#111C31', border: '#27334A' });
    expect(Object.values(SPACING)).toEqual([4, 8, 12, 16, 20, 24, 32]);
    expect(RADII).toMatchObject({ sm: 6, md: 8, lg: 12, xl: 16 });
  });

  test.each([
    ['paid', 'success'], ['active', 'success'], ['pending', 'warning'], ['unpaid', 'warning'],
    ['overdue', 'danger'], ['rejected', 'danger'], ['in_progress', 'info'], ['unknown', 'neutral'],
  ])('%s maps to %s', (state, expected) => expect(statusTone(state)).toBe(expected));

  test('destructive, warning, success, and informational states are not gold', () => {
    expect(Object.values(STATUS).map((tone) => tone.solid)).not.toContain(BRAND.accent);
    expect(STATUS.danger).toEqual({ solid: '#DC2626', background: '#FEF2F2', text: '#991B1B' });
  });
});
