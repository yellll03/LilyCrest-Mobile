/* global test */
import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import LilyAssistantScreen from '../screens/LilyAssistantScreen';
import { apiService } from '../services/api';

let mockFocused = true;
const mockParams = { conversationId: 'thread-a', requestId: 'request-a' };
const mockChat = { loadPersistedSession: jest.fn(), sessionId: 'session-a' };
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 88 }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { user_id: 'tenant-a', name: 'Tenant' }, authReady: true }) }));
jest.mock('../context/AlertContext', () => ({ useAlert: () => ({ showAlert: jest.fn() }) }));
jest.mock('../context/ThemeContext', () => ({ useTheme: () => ({ colors: {} }), useThemedStyles: (factory) => factory({}) }));
jest.mock('../hooks/useAssistantChat', () => ({ useAssistantChat: () => mockChat }));
jest.mock('../components/assistant/LilyFlowerIcon', () => () => null);
jest.mock('../components/AttachmentPickerSheet', () => () => null);
jest.mock('../services/firebaseStorageUpload', () => ({ IMAGE_UPLOAD_MIME_TYPES: [] }));
jest.mock('../utils/attachmentPicker', () => ({}));
jest.mock('../utils/chatAttachmentViewer', () => ({}));
jest.mock('../services/api', () => ({ apiService: {
  getChatbotSuggestions: jest.fn(), getMySupportChats: jest.fn(), getSupportChatMessages: jest.fn(),
  rateSupportInquiry: jest.fn(), reopenSupportChat: jest.fn(),
} }));

const resolved = { id: 'thread-a', requestId: 'request-a', tenantUserId: 'tenant-a',
  status: 'resolved', revision: 2, resolvedBy: 'admin-a', resolvedAt: '2026-10-10T00:00:00Z',
  concern: 'Repair', satisfactionRating: null };
let conversation;
let appStateListener;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFocused = true;
  conversation = { ...resolved };
  Platform.OS = 'ios';
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  apiService.getChatbotSuggestions.mockResolvedValue({ data: {} });
  apiService.getMySupportChats.mockImplementation(async () => ({ data: { conversations: [conversation] } }));
  apiService.getSupportChatMessages.mockImplementation(async () => ({ data: { conversation, messages: [] } }));
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
const mount = async () => {
  const view = render(<LilyAssistantScreen />);
  await act(async () => {});
  return view;
};

test('iOS keyboard opening never includes the absolute bottom tab bar in its avoidance offset', async () => {
  const listeners = jest.spyOn(Keyboard, 'addListener');
  const view = await mount();
  const avoiding = view.UNSAFE_getByType(KeyboardAvoidingView);
  await act(async () => avoiding.instance._onLayout({
    persist: () => {}, nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } },
  }));
  // Run RN's actual avoidance calculation and the screen's keyboard handlers.
  const emitKeyboard = async (event) => act(async () => {
    listeners.mock.calls.filter(([name]) => name === event).forEach(([, callback]) => callback({
      endCoordinates: { screenY: 500, height: 300, screenX: 0, width: 390 }, duration: 0,
    }));
  });
  await emitKeyboard('keyboardWillShow');
  await emitKeyboard('keyboardDidShow');
  expect(avoiding.instance.state.bottom).toBe(300);
  await emitKeyboard('keyboardWillHide');
  await emitKeyboard('keyboardDidHide');
  expect(avoiding.instance.state.bottom).toBe(0);
});

test('Android retains height avoidance and did-show/did-hide keyboard handling', async () => {
  Platform.OS = 'android';
  const listeners = jest.spyOn(Keyboard, 'addListener');
  const view = await mount();
  expect(view.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('height');
  expect(listeners).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
  expect(listeners).toHaveBeenCalledWith('keyboardDidHide', expect.any(Function));
});

test('leaving the tab stops support polling; returning reloads persisted resolution state', async () => {
  const view = await mount();
  expect(view.getByLabelText("Yes, it's resolved")).toBeTruthy();
  mockFocused = false;
  await act(async () => view.rerender(<LilyAssistantScreen />));
  const reads = apiService.getSupportChatMessages.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(15000));
  expect(apiService.getSupportChatMessages).toHaveBeenCalledTimes(reads);
  conversation = { ...resolved, status: 'closed', revision: 3, satisfactionRating: 4, satisfactionFeedback: 'Repaired' };
  mockFocused = true;
  await act(async () => view.rerender(<LilyAssistantScreen />));
  expect(view.getByText('Your rating: 4/5')).toBeTruthy();
});

test('backgrounding stops polling and foregrounding reconciles immediately', async () => {
  await mount();
  expect(appStateListener).toEqual(expect.any(Function));
  await act(async () => appStateListener('background'));
  const reads = apiService.getSupportChatMessages.mock.calls.length;
  await act(async () => jest.advanceTimersByTime(15000));
  expect(apiService.getSupportChatMessages).toHaveBeenCalledTimes(reads);
  await act(async () => appStateListener('active'));
  expect(apiService.getSupportChatMessages.mock.calls.length).toBeGreaterThan(reads);
});

test('screen exposes Yes then rating and preserves the saved result after remount', async () => {
  apiService.rateSupportInquiry.mockImplementation(async (_id, payload) => {
    conversation = { ...resolved, status: 'closed', revision: 3, satisfactionRating: payload.rating,
      satisfactionFeedback: payload.feedback };
    return { data: { conversation } };
  });
  const view = await mount();
  fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  fireEvent.press(view.getByLabelText('4 stars'));
  await act(async () => fireEvent.press(view.getByLabelText('Submit rating')));
  expect(apiService.rateSupportInquiry).toHaveBeenCalledWith('thread-a', {
    requestId: 'request-a', revision: 2, rating: 4, feedback: '',
  });
  expect(view.getByText('Your rating: 4/5')).toBeTruthy();
  view.unmount();
  const restarted = await mount();
  expect(restarted.getByText('Your rating: 4/5')).toBeTruthy();
});

test('screen No reopens the same concern without submitting a rating', async () => {
  apiService.reopenSupportChat.mockImplementation(async () => {
    conversation = { ...resolved, status: 'open', revision: 3, resolvedAt: null, resolvedBy: null };
    return { data: { conversation } };
  });
  const view = await mount();
  await act(async () => fireEvent.press(view.getByLabelText('No, I still need help')));
  expect(apiService.reopenSupportChat).toHaveBeenCalledWith('thread-a', '', { requestId: 'request-a', revision: 2 });
  expect(apiService.rateSupportInquiry).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Submit rating')).toBeNull();
});

test('an automated confirmation message cannot make an unresolved concern eligible', async () => {
  conversation = { ...resolved, status: 'open', resolvedBy: null, resolvedAt: null };
  apiService.getSupportChatMessages.mockImplementation(async () => ({ data: { conversation, messages: [{
    id: 'ordinary-message', senderRole: 'admin', message: 'Please confirm if your concern has been addressed.',
  }] } }));
  const view = await mount();
  expect(view.queryByLabelText("Yes, it's resolved")).toBeNull();
  expect(view.queryByLabelText('No, I still need help')).toBeNull();
});

test('a poll completed after blur cannot overwrite the foreground reconciliation', async () => {
  const view = await mount();
  let finishOldRead;
  apiService.getSupportChatMessages.mockImplementationOnce(() => new Promise((resolve) => { finishOldRead = resolve; }));
  await act(async () => jest.advanceTimersByTime(5000));
  mockFocused = false;
  await act(async () => view.rerender(<LilyAssistantScreen />));
  conversation = { ...resolved, status: 'closed', revision: 3, satisfactionRating: 5 };
  mockFocused = true;
  await act(async () => view.rerender(<LilyAssistantScreen />));
  await act(async () => finishOldRead({ data: { conversation: resolved, messages: [] } }));
  expect(view.getByText('Your rating: 5/5')).toBeTruthy();
  expect(view.queryByLabelText("Yes, it's resolved")).toBeNull();
});


test('resolved card scrolls independently of the composer and Continue with Lily stays outside both cards', async () => {
  conversation = { ...resolved, closingNote: 'A long resolution note '.repeat(40) };
  const view = await mount();
  const confirmation = view.getByTestId('support-confirmation-card');
  expect(view.UNSAFE_getAllByType(ScrollView).some((scroll) => within(scroll).queryByTestId('support-confirmation-card'))).toBe(true);
  expect(within(confirmation).queryByText('Continue with Lily')).toBeNull();
  expect(view.getAllByText('Continue with Lily')).toHaveLength(1);
  fireEvent.press(view.getByLabelText("Yes, it's resolved"));
  const rating = view.getByTestId('support-rating-card');
  expect(within(rating).queryByText('Continue with Lily')).toBeNull();
  expect(view.queryByText('Your concern has been marked as resolved.')).toBeNull();
  fireEvent.press(view.getByText('Continue with Lily'));
  expect(view.queryByTestId('support-rating-card')).toBeNull();
  expect(apiService.rateSupportInquiry).not.toHaveBeenCalled();
  expect(apiService.reopenSupportChat).not.toHaveBeenCalled();
});
