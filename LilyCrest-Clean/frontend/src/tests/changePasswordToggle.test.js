import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ChangePasswordScreen from '../../app/change-password';

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
  apiService: { changePassword: jest.fn() },
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
});
