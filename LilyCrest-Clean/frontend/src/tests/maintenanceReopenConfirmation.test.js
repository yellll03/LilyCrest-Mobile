jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Modal, Platform } from 'react-native';
import ServicesScreen from '../../app/(tabs)/services';
import { apiService } from '../services/api';

jest.setTimeout(15000);

const mockToast = jest.fn();
const mockNotifications = [];
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-request-id' }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback) => {
    const React = require('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { user_id: 'tenant-a' }, authReady: true, authStatus: 'authenticated', notifications: mockNotifications }),
}));
jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('../theme/tokens').LIGHT_COLORS, isDarkMode: false }),
  useThemedStyles: (factory) => factory(require('../theme/tokens').LIGHT_COLORS),
}));
jest.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: mockToast }) }));
jest.mock('../components/assistant/LilyAssistantFab', () => () => null);
jest.mock('../components/AttachmentPickerSheet', () => () => null);
jest.mock('../services/firebaseStorageUpload', () => ({
  getAttachmentDisplayName: () => '', getAttachmentDownloadUrl: () => '',
  DEFAULT_UPLOAD_MIME_TYPES: [],
}));
jest.mock('../services/api', () => ({
  apiService: {
    getMyMaintenance: jest.fn(), getMaintenance: jest.fn(), reopenMaintenance: jest.fn(),
    cancelMaintenance: jest.fn(), updateMaintenance: jest.fn(), markMaintenanceRead: jest.fn(),
  },
  getApiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}));

const resolved = {
  request_id: 'request-reopen', user_id: 'tenant-a', status: 'resolved',
  request_type: 'plumbing', description: 'The bathroom faucet is still leaking.',
  created_at: '2026-09-01T00:00:00Z', updates: [], attachments: [],
};
const pending = { ...resolved, status: 'pending' };
const detailResponse = (request) => ({ data: request });
const listResponse = (request) => ({ data: [request] });

async function openDetails(request = resolved) {
  apiService.getMyMaintenance.mockResolvedValue(listResponse(request));
  apiService.getMaintenance.mockResolvedValue(detailResponse(request));
  const screen = render(<ServicesScreen />);
  await waitFor(() => expect(screen.getByText('Resolved (1)')).toBeTruthy());
  fireEvent.press(screen.getByText('Resolved (1)'));
  fireEvent.press(screen.getByText(request.description));
  await waitFor(() => expect(apiService.getMyMaintenance).toHaveBeenCalledTimes(2));
  await act(async () => {});
  jest.clearAllMocks();
  return screen;
}

function expectNoApiCalls() {
  for (const method of Object.values(apiService)) expect(method).not.toHaveBeenCalled();
}

describe.each(['android', 'ios'])('maintenance reopen confirmation on %s', (platform) => {
  const originalPlatform = Platform.OS;
  beforeEach(() => {
    jest.useFakeTimers();
    Platform.OS = platform;
    jest.clearAllMocks();
    apiService.reopenMaintenance.mockResolvedValue(detailResponse(pending));
  });
  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    Platform.OS = originalPlatform;
  });

  it('initial rapid taps show one confirmation without a mutation', async () => {
    const screen = await openDetails();
    const trigger = screen.getByLabelText('Reopen maintenance request');
    act(() => { fireEvent.press(trigger); fireEvent.press(trigger); });
    expect(screen.getAllByText('Reopen this request?')).toHaveLength(1);
    expect(screen.queryByText('Nevermind')).toBeNull();
    expectNoApiCalls();
  });

  it.each(['Cancel', 'backdrop', 'Back', 'accessibility escape'])('%s dismisses and clears the draft with no API or refresh', async (method) => {
    const screen = await openDetails();
    fireEvent.press(screen.getByLabelText('Reopen maintenance request'));
    fireEvent.changeText(screen.getByPlaceholderText('Add a note (optional)...'), 'Discard this draft');
    // Retain a queued confirm callback to exercise Cancel/confirm in the same frame.
    let confirmButton = screen.getByText('Reopen');
    while (!confirmButton.props.onPress) confirmButton = confirmButton.parent;
    const confirm = confirmButton.props.onPress;
    if (method === 'Cancel') fireEvent.press(screen.getByText('Cancel'));
    // The backdrop remains touchable while intentionally outside the accessibility modal.
    if (method === 'backdrop') fireEvent.press(screen.getByLabelText('Close maintenance action dialog', { includeHiddenElements: true }));
    if (method === 'Back') act(() => screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.visible).props.onRequestClose());
    if (method === 'accessibility escape') {
      fireEvent(screen.getByText('Reopen this request?'), 'accessibilityEscape');
    }
    await act(async () => { await confirm(); });
    expect(screen.queryByText('Reopen this request?')).toBeNull();
    expect(screen.getByLabelText('Reopen maintenance request')).toBeTruthy();
    expectNoApiCalls();
    fireEvent.press(screen.getByLabelText('Reopen maintenance request'));
    expect(screen.getByPlaceholderText('Add a note (optional)...').props.value).toBe('');
  });

  it('submits once, locks actions while pending, then refreshes the list and details to Pending', async () => {
    const screen = await openDetails();
    let finish;
    apiService.reopenMaintenance.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.press(screen.getByLabelText('Reopen maintenance request'));
    fireEvent.changeText(screen.getByPlaceholderText('Add a note (optional)...'), '  Still leaking  ');
    const confirm = screen.getByText('Reopen');
    act(() => { fireEvent.press(confirm); fireEvent.press(confirm); });
    expect(apiService.reopenMaintenance).toHaveBeenCalledTimes(1);
    expect(apiService.reopenMaintenance).toHaveBeenCalledWith(resolved.request_id, { reopen_note: 'Still leaking' });
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.getByPlaceholderText('Add a note (optional)...').props.editable).toBe(false);
    fireEvent.press(screen.getByLabelText('Close maintenance action dialog', { includeHiddenElements: true }));
    act(() => screen.UNSAFE_getAllByType(Modal).find((modal) => modal.props.visible).props.onRequestClose());
    expect(screen.getByText('Reopen this request?')).toBeTruthy();
    apiService.getMyMaintenance.mockResolvedValue(listResponse(pending));
    apiService.getMaintenance.mockResolvedValue(detailResponse(pending));
    await act(async () => { finish(detailResponse(pending)); });
    expect(screen.queryByText('Reopen this request?')).toBeNull();
    expect(apiService.getMyMaintenance).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Active (1)'));
    fireEvent.press(screen.getByText(pending.description));
    await act(async () => {});
    expect(screen.queryByLabelText('Reopen maintenance request')).toBeNull();
    expect(screen.getByLabelText('Cancel maintenance request')).toBeTruthy();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('keeps the existing error handling and permits a deliberate retry after failure', async () => {
    const screen = await openDetails();
    apiService.reopenMaintenance.mockRejectedValueOnce({ response: { data: { detail: 'Request status changed before reopening.' } } });
    fireEvent.press(screen.getByLabelText('Reopen maintenance request'));
    await act(async () => { fireEvent.press(screen.getByText('Reopen')); });
    expect(screen.getByText('Reopen this request?')).toBeTruthy();
    expect(screen.getByText('Cancel')).not.toBeDisabled();
    expect(apiService.getMyMaintenance).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Request status changed before reopening.' }));
    apiService.getMyMaintenance.mockResolvedValue(listResponse(pending));
    await act(async () => { fireEvent.press(screen.getByText('Reopen')); });
    expect(apiService.reopenMaintenance).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Reopen this request?')).toBeNull();
  });

  it.each(['completed', 'closed'])('preserves the existing %s eligibility policy', async (status) => {
    const screen = await openDetails({ ...resolved, status });
    expect(screen.queryByLabelText('Reopen maintenance request')).toBeNull();
    expectNoApiCalls();
  });
});
