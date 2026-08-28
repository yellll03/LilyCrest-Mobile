import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ChangePasswordScreen from '../../app/change-password';

const mockChangePassword = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ logout: jest.fn() }),
}));

jest.mock('../context/ThemeContext', () => {
  const colors = {
    background: '#fff', text: '#000', textSecondary: '#333', textMuted: '#999',
    border: '#ccc', inputBg: '#fff', accentSubtle: '#eef', accentLight: '#ccf', primary: '#123',
  };
  return { useTheme: () => ({ colors }) };
});

jest.mock('../context/AlertContext', () => ({
  useAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../services/api', () => ({
  apiService: { changePassword: mockChangePassword },
}));

jest.mock('../services/secureCredentials', () => ({
  clearCredentials: jest.fn(),
}));

jest.mock('../utils/navigation', () => ({
  safeBack: jest.fn(),
}));

const FIELDS = [
  { placeholder: 'Enter current password', show: 'Show password', hide: 'Hide password' },
  { placeholder: 'Enter new password', show: 'Show password', hide: 'Hide password' },
  { placeholder: 'Confirm new password', show: 'Show password', hide: 'Hide password' },
];

describe('Change Password screen — password visibility toggles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows all three required-field messages on submit and makes no request', () => {
    render(<ChangePasswordScreen />);

    fireEvent.press(screen.getByLabelText('Update Password'));

    expect(screen.getByText('Current password is required')).toBeTruthy();
    expect(screen.getByText('New password is required')).toBeTruthy();
    expect(screen.getByText('Please confirm your new password')).toBeTruthy();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('shows a visible mismatch error and makes no request', () => {
    render(<ChangePasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Enter current password'), 'CurrentStrong1!');
    fireEvent.changeText(screen.getByPlaceholderText('Enter new password'), 'NewStrong1!');
    fireEvent.changeText(screen.getByPlaceholderText('Confirm new password'), 'DifferentStrong1!');

    fireEvent.press(screen.getByLabelText('Update Password'));

    expect(screen.getByText('Passwords do not match')).toBeTruthy();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('all three fields start hidden with the closed eye / "Show password" label', () => {
    render(<ChangePasswordScreen />);
    for (const { placeholder } of FIELDS) {
      expect(screen.getByPlaceholderText(placeholder).props.secureTextEntry).toBe(true);
    }
    expect(screen.getAllByLabelText('Show password')).toHaveLength(3);
  });

  it.each(FIELDS)('tapping the toggle for "$placeholder" reveals it, flips to "Hide password", and preserves the value', ({ placeholder }) => {
    render(<ChangePasswordScreen />);
    const input = screen.getByPlaceholderText(placeholder);
    fireEvent.changeText(input, 'MyValue1!');

    const toggles = screen.getAllByLabelText('Show password');
    const index = FIELDS.findIndex((f) => f.placeholder === placeholder);
    fireEvent.press(toggles[index]);

    const updatedInput = screen.getByPlaceholderText(placeholder);
    expect(updatedInput.props.secureTextEntry).toBe(false);
    expect(updatedInput.props.value).toBe('MyValue1!');
  });

  it('tapping again re-hides the password and restores the closed eye / "Show password" label', () => {
    render(<ChangePasswordScreen />);
    const input = screen.getByPlaceholderText('Enter new password');
    fireEvent.changeText(input, 'MyValue1!');

    const toggles = screen.getAllByLabelText('Show password');
    fireEvent.press(toggles[1]);
    fireEvent.press(screen.getByLabelText('Hide password'));

    expect(screen.getByPlaceholderText('Enter new password').props.secureTextEntry).toBe(true);
    expect(screen.getByPlaceholderText('Enter new password').props.value).toBe('MyValue1!');
    expect(screen.getAllByLabelText('Show password')).toHaveLength(3);
  });

  it.each(FIELDS)('blocks pasted whitespace in "$placeholder" without changing the displayed credential', ({ placeholder }) => {
    render(<ChangePasswordScreen />);
    const input = screen.getByPlaceholderText(placeholder);
    fireEvent.changeText(input, 'ValidPass1!');
    fireEvent.changeText(input, 'Pasted Value1!');

    expect(screen.getByPlaceholderText(placeholder).props.value).toBe('ValidPass1!');
    expect(screen.getByText('Password must not contain whitespace.')).toBeTruthy();
  });
});
