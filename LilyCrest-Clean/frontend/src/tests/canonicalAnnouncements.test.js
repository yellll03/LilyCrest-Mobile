import { act, renderHook } from '@testing-library/react-native';
import {
  MAX_ANNOUNCEMENT_DISMISS_IDS,
  normalizeAnnouncementIds,
  useCanonicalAnnouncements,
} from '../hooks/useCanonicalAnnouncements';
import { apiService } from '../services/api';

jest.mock('../services/api', () => ({
  apiService: {
    getAnnouncements: jest.fn(),
    dismissAnnouncement: jest.fn(),
    restoreAnnouncement: jest.fn(),
    dismissAnnouncementsBulk: jest.fn(),
    getNotifications: jest.fn(),
  },
}));

const first = { announcement_id: 'ann_1', title: 'First' };
const second = { announcement_id: 'ann_2', title: 'Second' };

describe('canonical announcement reconciliation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads only the dedicated canonical announcement list', async () => {
    apiService.getAnnouncements.mockResolvedValueOnce({ data: [first, second] });
    const { result } = renderHook(() => useCanonicalAnnouncements());

    await act(async () => result.current.loadAnnouncements());

    expect(apiService.getAnnouncements).toHaveBeenCalledTimes(1);
    expect(apiService.getNotifications).not.toHaveBeenCalled();
    expect(result.current.announcements).toEqual([first, second]);
  });

  it('optimistically archives an individual announcement and reconciles after server confirmation', async () => {
    let confirmDismissal;
    apiService.getAnnouncements
      .mockResolvedValueOnce({ data: [first, second] })
      .mockResolvedValueOnce({ data: [second] });
    apiService.dismissAnnouncement.mockImplementationOnce(() => new Promise((resolve) => {
      confirmDismissal = resolve;
    }));
    const { result } = renderHook(() => useCanonicalAnnouncements());
    await act(async () => result.current.loadAnnouncements());

    let dismissalPromise;
    act(() => { dismissalPromise = result.current.dismissAnnouncements(['ann_1']); });
    expect(result.current.announcements).toEqual([second]);
    expect(apiService.dismissAnnouncement).toHaveBeenCalledWith('ann_1');

    await act(async () => {
      confirmDismissal({ data: { status: 'dismissed' } });
      await dismissalPromise;
    });
    expect(result.current.announcements).toEqual([second]);
    expect(apiService.getAnnouncements).toHaveBeenCalledTimes(2);
  });

  it('Undo reverses the tenant dismissal and restores the item at its prior position', async () => {
    apiService.getAnnouncements
      .mockResolvedValueOnce({ data: [first, second] })
      .mockResolvedValueOnce({ data: [second] })
      .mockResolvedValueOnce({ data: [first, second] });
    apiService.dismissAnnouncement.mockResolvedValueOnce({ data: { status: 'dismissed' } });
    apiService.restoreAnnouncement.mockResolvedValueOnce({ data: { status: 'restored' } });
    const { result } = renderHook(() => useCanonicalAnnouncements());
    await act(async () => result.current.loadAnnouncements());

    let dismissal;
    await act(async () => { dismissal = await result.current.dismissAnnouncements(['ann_1']); });
    expect(result.current.announcements).toEqual([second]);

    await act(async () => result.current.restoreAnnouncement('ann_1', dismissal.removed[0]));
    expect(apiService.restoreAnnouncement).toHaveBeenCalledWith('ann_1');
    expect(result.current.announcements).toEqual([first, second]);
  });

  it('rolls back an optimistic Undo when the canonical restore request fails', async () => {
    apiService.getAnnouncements
      .mockResolvedValueOnce({ data: [first, second] })
      .mockResolvedValueOnce({ data: [second] });
    apiService.dismissAnnouncement.mockResolvedValueOnce({ data: { status: 'dismissed' } });
    apiService.restoreAnnouncement.mockRejectedValueOnce(new Error('restore failed'));
    const { result } = renderHook(() => useCanonicalAnnouncements());
    await act(async () => result.current.loadAnnouncements());

    let dismissal;
    await act(async () => { dismissal = await result.current.dismissAnnouncements(['ann_1']); });
    let restore;
    await act(async () => {
      restore = await result.current.restoreAnnouncement('ann_1', dismissal.removed[0]);
    });

    expect(restore).toMatchObject({ ok: false, reason: 'request' });
    expect(result.current.announcements).toEqual([second]);
  });

  it('retains announcements and returns a retryable error result on API failure', async () => {
    apiService.getAnnouncements.mockResolvedValueOnce({ data: [first, second] });
    apiService.dismissAnnouncement.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useCanonicalAnnouncements());
    await act(async () => result.current.loadAnnouncements());

    let dismissal;
    await act(async () => { dismissal = await result.current.dismissAnnouncements(['ann_1']); });

    expect(dismissal).toMatchObject({ ok: false, reason: 'request' });
    expect(result.current.announcements).toEqual([first, second]);
  });

  it('deduplicates a bulk request and sends one batch call', async () => {
    apiService.getAnnouncements
      .mockResolvedValueOnce({ data: [first, second] })
      .mockResolvedValueOnce({ data: [] });
    apiService.dismissAnnouncementsBulk.mockResolvedValueOnce({ data: { status: 'dismissed' } });
    const { result } = renderHook(() => useCanonicalAnnouncements());
    await act(async () => result.current.loadAnnouncements());
    await act(async () => result.current.dismissAnnouncements(['ann_1', 'ann_1', 'ann_2']));

    expect(apiService.dismissAnnouncementsBulk).toHaveBeenCalledTimes(1);
    expect(apiService.dismissAnnouncementsBulk).toHaveBeenCalledWith(['ann_1', 'ann_2']);
    expect(apiService.dismissAnnouncement).not.toHaveBeenCalled();
    expect(result.current.announcements).toEqual([]);
  });

  it('guards against a repeated dismiss while the first request is in flight', async () => {
    let confirmDismissal;
    apiService.getAnnouncements
      .mockResolvedValueOnce({ data: [first] })
      .mockResolvedValueOnce({ data: [] });
    apiService.dismissAnnouncement.mockImplementationOnce(() => new Promise((resolve) => {
      confirmDismissal = resolve;
    }));
    const { result } = renderHook(() => useCanonicalAnnouncements());
    await act(async () => result.current.loadAnnouncements());

    let firstDismissal;
    let repeatedDismissal;
    act(() => {
      firstDismissal = result.current.dismissAnnouncements(['ann_1']);
      repeatedDismissal = result.current.dismissAnnouncements(['ann_1']);
    });

    await expect(repeatedDismissal).resolves.toMatchObject({ ok: false, reason: 'busy' });
    expect(apiService.dismissAnnouncement).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirmDismissal({ data: { status: 'dismissed' } });
      await firstDismissal;
    });
  });

  it('rejects more than 100 unique IDs without mutating or sending a request', async () => {
    const ids = Array.from({ length: MAX_ANNOUNCEMENT_DISMISS_IDS + 1 }, (_, index) => `ann_${index}`);
    const { result } = renderHook(() => useCanonicalAnnouncements());
    let dismissal;
    await act(async () => { dismissal = await result.current.dismissAnnouncements(ids); });

    expect(dismissal.reason).toBe('limit');
    expect(apiService.dismissAnnouncementsBulk).not.toHaveBeenCalled();
  });

  it('keeps duplicate normalization stable and ignores blank IDs', () => {
    expect(normalizeAnnouncementIds([' ann_1 ', '', null, 'ann_1', 'ann_2']))
      .toEqual(['ann_1', 'ann_2']);
  });
});
