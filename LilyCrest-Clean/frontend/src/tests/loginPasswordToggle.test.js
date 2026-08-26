import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import LoginScreen from '../../app/login';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../config/googleSignIn', () => ({
  useGoogleSignIn: () => ({ signInWithGoogle: jest.fn() }),
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ loginWithEmail: jest.fn(), signInWithGoogle: jest.fn(), isLoading: false }),
}));

jest.mock('../context/ThemeContext', () => {
  const colors = {
    background: '#fff', text: '#000', textSecondary: '#333', textMuted: '#999',
    border: '#ccc', inputBg: '#fff', error: '#f00', errorBg: '#fee', success: '#0a0',
    successBg: '#efe', interactive: '#06f', iconSecondary: '#888', primary: '#123',
    primaryLight: '#eef', accent: '#06f', surface: '#fff',
  };
  return {
    useTheme: () => ({ colors }),
    useThemedStyles: (factory) => factory(colors),
  };
});

jest.mock('../services/secureCredentials', () => ({
  savePendingLogin: jest.fn(),
}));

jest.mock('../services/rememberedEmail', () => ({
  loadRememberedEmail: jest.fn().mockResolvedValue({ email: '', rememberEmail: false }),
  saveRememberedEmail: jest.fn(),
}));

jest.mock('../utils/navigation', () => ({
  resetToHome: jest.fn(),
}));

describe('Login screen — password visibility toggle', () => {
  it('starts hidden, shows the closed eye, and is labeled "Show password"', () => {
    render(<LoginScreen />);
    const passwordInput = screen.getByPlaceholderText('Enter your password');
    expect(passwordInput.props.secureTextEntry).toBe(true);

    const toggle = screen.getByLabelText('Show password');
    expect(toggle).toBeTruthy();
  });

  it('reveals the password and switches to the open eye / "Hide password" on tap, without altering the value', () => {
    render(<LoginScreen />);
    const passwordInput = screen.getByPlaceholderText('Enter your password');
    fireEvent.changeText(passwordInput, 'Secret123!');

    fireEvent.press(screen.getByLabelText('Show password'));

    expect(screen.getByPlaceholderText('Enter your password').props.secureTextEntry).toBe(false);
    expect(screen.getByPlaceholderText('Enter your password').props.value).toBe('Secret123!');
    expect(screen.getByLabelText('Hide password')).toBeTruthy();
    expect(screen.queryByLabelText('Show password')).toBeNull();
  });

  it('hides the password again and returns to the closed eye / "Show password" on a second tap', () => {
    render(<LoginScreen />);
    const passwordInput = screen.getByPlaceholderText('Enter your password');
    fireEvent.changeText(passwordInput, 'Secret123!');

    fireEvent.press(screen.getByLabelText('Show password'));
    fireEvent.press(screen.getByLabelText('Hide password'));

    expect(screen.getByPlaceholderText('Enter your password').props.secureTextEntry).toBe(true);
    expect(screen.getByPlaceholderText('Enter your password').props.value).toBe('Secret123!');
    expect(screen.getByLabelText('Show password')).toBeTruthy();
  });
});
