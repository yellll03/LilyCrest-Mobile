/* global test */
import {
  BIOMETRIC_ACCESS_STATE,
  classifyBiometricCapability,
  classifyBiometricResult,
  shouldBypassBiometricGate,
} from '../utils/biometricAccess';

describe('biometric local-access state machine', () => {
  test.each([
    [{ hasHardware: false, isEnrolled: false }, BIOMETRIC_ACCESS_STATE.UNSUPPORTED],
    [{ hasHardware: true, isEnrolled: false }, BIOMETRIC_ACCESS_STATE.UNENROLLED],
    [{ hasHardware: true, isEnrolled: true }, BIOMETRIC_ACCESS_STATE.LOCKED],
  ])('classifies capability %j as %s', (input, expected) => {
    expect(classifyBiometricCapability(input)).toBe(expected);
  });

  test.each([
    [{ success: true }, BIOMETRIC_ACCESS_STATE.UNLOCKED],
    [{ success: false, error: 'user_cancel' }, BIOMETRIC_ACCESS_STATE.CANCELLED],
    [{ success: false, error: 'system_cancel' }, BIOMETRIC_ACCESS_STATE.CANCELLED],
    [{ success: false, error: 'authentication_failed' }, BIOMETRIC_ACCESS_STATE.FAILED],
    [{ success: false, error: 'lockout' }, BIOMETRIC_ACCESS_STATE.LOCKED_OUT],
    [{ success: false, error: 'not_enrolled' }, BIOMETRIC_ACCESS_STATE.UNENROLLED],
    [{ success: false, error: 'not_available' }, BIOMETRIC_ACCESS_STATE.UNSUPPORTED],
  ])('classifies prompt result %j as %s', (result, expected) => {
    expect(classifyBiometricResult(result)).toBe(expected);
  });

  it('lets password-reset actions take priority over an existing session lock', () => {
    expect(shouldBypassBiometricGate('/reset-password?token=one-time')).toBe(true);
    expect(shouldBypassBiometricGate('/(tabs)/home')).toBe(false);
  });
});
