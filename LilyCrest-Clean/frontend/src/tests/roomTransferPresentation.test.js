import {
  getRoomTransferPresentation,
  isValidPreferredTransferDate,
} from '../utils/roomTransferPresentation';

describe('room transfer presentation parity', () => {
  const fixture = {
    status: 'scheduled',
    statusLabel: 'Scheduled',
    request: { id: 'request-1', canCancel: false },
    scheduledRoomTransfer: {
      status: 'scheduled',
      statusLabel: 'Scheduled',
      effectiveTransferDate: '2026-09-15T00:00:00.000Z',
      effectiveTransferTimeMinutes: 600,
    },
  };

  it('uses the backend canonical status label and never enables tenant cancellation after scheduling', () => {
    const result = getRoomTransferPresentation(fixture);
    expect(result.status).toBe('scheduled');
    expect(result.statusLabel).toBe('Scheduled');
    expect(result.canCancel).toBe(false);
    expect(result.canRequest).toBe(false);
    expect(result.scheduledLabel).toContain('Sep');
    expect(result.scheduledLabel).toContain('2026');
    expect(result.scheduledLabel).toContain('10:00 AM');
  });

  it('allows cancellation only when the backend explicitly grants it for pending', () => {
    expect(getRoomTransferPresentation({ status: 'pending', statusLabel: 'Pending Review', request: { canCancel: true } }))
      .toMatchObject({ statusLabel: 'Pending Review', canCancel: true, canRequest: false });
    expect(getRoomTransferPresentation({ status: 'pending', statusLabel: 'Pending Review', request: { canCancel: false } }).canCancel)
      .toBe(false);
  });

  it.each(['awaiting_settlement', 'ready_for_transfer', 'action_required'])(
    'treats canonical %s state as an open lifecycle and uses server guidance',
    (status) => {
      const result = getRoomTransferPresentation({
        status,
        statusLabel: status,
        scheduledRoomTransfer: {
          status,
          tenantGuidance: 'Canonical tenant guidance',
          settlement: { required: status === 'awaiting_settlement', remaining: 250 },
        },
      });
      expect(result.canRequest).toBe(false);
      expect(result.guidance).toBe('Canonical tenant guidance');
      expect(result.settlement?.remaining).toBe(250);
    },
  );

  it('validates optional preferred date without inventing lifecycle state', () => {
    const today = new Date('2026-08-31T10:00:00+08:00');
    expect(isValidPreferredTransferDate('', today)).toBe(true);
    expect(isValidPreferredTransferDate('2026-08-31', today)).toBe(true);
    expect(isValidPreferredTransferDate('2026-08-30', today)).toBe(false);
    expect(isValidPreferredTransferDate('08/31/2026', today)).toBe(false);
  });
});
