import {
  getRoomTransferPresentation,
  isValidPreferredTransferDate,
} from '../utils/roomTransferPresentation';

describe('room transfer presentation parity', () => {
  const fixture = {
    status: 'scheduled',
    statusLabel: 'Transfer Scheduled',
    request: { id: 'request-1', canCancel: false },
    scheduledRoomTransfer: {
      status: 'scheduled',
      statusLabel: 'Transfer Scheduled',
      effectiveTransferDate: '2026-09-15T00:00:00.000Z',
      effectiveTransferTimeMinutes: 600,
    },
  };

  it('uses the backend canonical status label and never enables tenant cancellation after scheduling', () => {
    const result = getRoomTransferPresentation(fixture);
    expect(result.status).toBe('scheduled');
    expect(result.statusLabel).toBe('Transfer Scheduled');
    expect(result.canCancel).toBe(false);
    expect(result.canRequest).toBe(false);
    expect(result.scheduledLabel).toContain('Sep');
    expect(result.scheduledLabel).toContain('2026');
    expect(result.scheduledLabel).toContain('10:00 AM');
  });

  it('allows cancellation only when the backend explicitly grants it for pending', () => {
    expect(getRoomTransferPresentation({ status: 'pending', statusLabel: 'Pending Admin Review', request: { canCancel: true } }))
      .toMatchObject({ statusLabel: 'Pending Admin Review', canCancel: true, canRequest: false });
    expect(getRoomTransferPresentation({ status: 'pending', statusLabel: 'Pending Admin Review', request: { canCancel: false } }).canCancel)
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


describe('QA room transfer recovery and calendar regressions', () => {
  it.each([null, undefined, {}, [], { status: 'unknown' }, { status: 'pending', request: [] }])('fails closed for malformed lifecycle %p', value => {
    expect(getRoomTransferPresentation(value).canRequest).toBe(false);
  });
  it('ignores nonexistent acknowledgement transitions', () => {
    expect(getRoomTransferPresentation({ status: 'pending', request: { acknowledgedAt: '2026-09-15' } }).statusLabel).toBe('Pending Admin Review');
  });
  it('never renders internal state codes as labels', () => {
    expect(getRoomTransferPresentation({ status: 'awaiting_settlement', statusLabel: 'awaiting_settlement' }).statusLabel).toBe('Payment Required');
  });
  it('respects backend eligibility even without an open request', () => {
    expect(getRoomTransferPresentation({ status: null, canRequest: false }).canRequest).toBe(false);
  });
  it.each(['2027-02-29', '2027-02-30', '2026-13-01'])('rejects impossible calendar date %s', value => {
    expect(isValidPreferredTransferDate(value, new Date('2026-01-01T00:00:00Z'))).toBe(false);
  });
  it('uses Manila midnight even on a device in a different timezone', () => {
    const now = new Date('2026-09-14T16:00:01Z');
    expect(isValidPreferredTransferDate('2026-09-14', now)).toBe(false);
    expect(isValidPreferredTransferDate('2026-09-15', now)).toBe(true);
    expect(isValidPreferredTransferDate('2026-09-16', now)).toBe(true);
  });
});
