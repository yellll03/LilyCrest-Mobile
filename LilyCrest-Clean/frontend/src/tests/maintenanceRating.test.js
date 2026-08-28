/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildMaintenanceRatingPayload,
  canRateMaintenanceRequest,
  getSubmittedMaintenanceRating,
  hasSubmittedMaintenanceRating,
  MAINTENANCE_RATING_LABELS,
} from '../utils/maintenanceRating';

const root = path.resolve(__dirname, '../..');
const screen = fs.readFileSync(path.join(root, 'app/(tabs)/services.jsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/services/api.js'), 'utf8');

describe('maintenance rating contract', () => {
  test.each([1, 2, 3, 4, 5])('builds the canonical payload for rating %i', (rating) => {
    expect(buildMaintenanceRatingPayload(rating, '  Fixed well.  ')).toEqual({
      action: 'confirm',
      confirmed: true,
      rating,
      feedback: 'Fixed well.',
    });
  });

  test.each([0, 6, -1, 2.5, '5', null, undefined])('rejects invalid rating %p', (rating) => {
    expect(() => buildMaintenanceRatingPayload(rating)).toThrow('Please choose a rating from 1 to 5.');
  });

  test('omits blank optional feedback', () => {
    expect(buildMaintenanceRatingPayload(4, '   ')).toEqual({
      action: 'confirm',
      confirmed: true,
      rating: 4,
    });
  });

  test('only an unrated resolved request is eligible', () => {
    expect(canRateMaintenanceRequest({ status: 'resolved' })).toBe(true);
    expect(canRateMaintenanceRequest({ status: 'pending' })).toBe(false);
    expect(canRateMaintenanceRequest({ status: 'in_progress' })).toBe(false);
    expect(canRateMaintenanceRequest({ status: 'completed' })).toBe(false);
    expect(canRateMaintenanceRequest({ status: 'resolved', tenant_confirmed_resolved: true })).toBe(false);
    expect(canRateMaintenanceRequest({
      status: 'resolved',
      tenant_confirmed_resolved: true,
      resolutionConfirmation: { rating: 5, confirmedAt: '2026-08-29T00:00:00.000Z' },
    })).toBe(false);
  });

  test('reads canonical confirmation after refresh and rejects malformed persisted ratings', () => {
    const request = {
      tenant_confirmed_resolved: true,
      resolutionConfirmation: { rating: 3, confirmedAt: '2026-08-29T00:00:00.000Z' },
    };
    expect(getSubmittedMaintenanceRating(request)).toBe(3);
    expect(hasSubmittedMaintenanceRating(request)).toBe(true);
    expect(getSubmittedMaintenanceRating({ resolutionConfirmation: { rating: 2.5 } })).toBeNull();
  });

  test('screen/API wire loading, error, persistence, theme, and accessibility behavior', () => {
    expect(api).toContain("api.post(`/maintenance/${requestId}/confirm`, data)");
    expect(screen).toContain('buildMaintenanceRatingPayload');
    expect(screen).toContain('getApiErrorMessage');
    expect(screen).toContain('accessibilityLabel={`${star} star');
    expect(screen).toContain('accessibilityState={{ selected: rating === star, disabled: saving }}');
    expect(screen).toContain('detailResolutionConfirmation');
    expect(screen).toContain('colors.warning');
    expect(screen).toContain('colors.textMuted');
    expect(MAINTENANCE_RATING_LABELS).toEqual({
      1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent',
    });
  });
});
