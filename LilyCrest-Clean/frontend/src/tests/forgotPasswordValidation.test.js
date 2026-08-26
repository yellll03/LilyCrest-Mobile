import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ForgotPasswordScreen from '../../app/forgot-password';
import { AUTH_MESSAGES } from '../utils/authStability';

const mockForgotPassword = jest.fn();
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
}));

jest.mock('../context/ThemeContext', () => {
  const colors = {
    background: '#fff', text: '#000', textSecondary: '#333', textMuted: '#777',
    border: '#ccc', inputBg: '#fff', error: '#b91c1c', errorBg: '#fee2e2',
    success: '#059669', successBg: '#ecfdf5', interactive: '#204b7e',
    iconSecondary: '#666', primary: '#123', primaryLight: '#eef', accent: '#06f',
  };
  return {
    useTheme: () => ({ colors }),
    useThemedStyles: (factory) => factory(colors),
  };
});

jest.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../services/api', () => ({
  apiService: { forgotPassword: (...args) => mockForgotPassword(...args) },
}));

jest.mock('../utils/navigation', () => ({ safeBack: jest.fn() }));

describe('Forgot Password validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows Email is required and does not call the reset API for blank input', () => {
    render(<ForgotPasswordScreen />);
    fireEvent.press(screen.getByLabelText('Send Reset Link'));
    expect(screen.getByText('Email is required.')).toBeTruthy();
    expect(mockForgotPassword).not.toHaveBeenCalled();
  });

  it.each(['abc', 'tenant@', '@domain.com', 'tenant@domain'])('rejects invalid email %s locally', (email) => {
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Enter your email'), email);
    fireEvent.press(screen.getByLabelText('Send Reset Link'));
    expect(screen.getByText(AUTH_MESSAGES.invalidEmail)).toBeTruthy();
    expect(mockForgotPassword).not.toHaveBeenCalled();
  });

  it('sends a normalized valid email and advances only after API success', async () => {
    mockForgotPassword.mockResolvedValue({ data: { message: AUTH_MESSAGES.forgotSuccess } });
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Enter your email'), ' Tenant@Example.com ');
    fireEvent.press(screen.getByLabelText('Send Reset Link'));

    await waitFor(() => expect(mockForgotPassword).toHaveBeenCalledWith('tenant@example.com'));
    expect(await screen.findByText('Check Your Email')).toBeTruthy();
  });

  it('does not advance for an unregistered tenant and shows the safe product error', async () => {
    mockForgotPassword.mockRejectedValue({
      response: { status: 422, data: { code: 'TENANT_RESET_NOT_AVAILABLE' } },
    });
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Enter your email'), 'unknown@example.com');
    fireEvent.press(screen.getByLabelText('Send Reset Link'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: AUTH_MESSAGES.resetNotAvailable,
    })));
    expect(screen.queryByText('Check Your Email')).toBeNull();
  });
});
