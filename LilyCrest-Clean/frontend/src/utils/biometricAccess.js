export const BIOMETRIC_ACCESS_STATE = Object.freeze({
  CHECKING: 'checking',
  NOT_REQUIRED: 'not_required',
  LOCKED: 'locked',
  PROMPTING: 'prompting',
  UNLOCKED: 'unlocked',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  LOCKED_OUT: 'locked_out',
  UNSUPPORTED: 'unsupported',
  UNENROLLED: 'unenrolled',
  INVALIDATED: 'invalidated',
});

export function classifyBiometricCapability({ hasHardware, isEnrolled }) {
  if (!hasHardware) return BIOMETRIC_ACCESS_STATE.UNSUPPORTED;
  if (!isEnrolled) return BIOMETRIC_ACCESS_STATE.UNENROLLED;
  return BIOMETRIC_ACCESS_STATE.LOCKED;
}

export function classifyBiometricResult(result) {
  if (result?.success === true) return BIOMETRIC_ACCESS_STATE.UNLOCKED;

  const code = String(result?.error || '').trim().toLowerCase();
  if (['user_cancel', 'app_cancel', 'system_cancel'].includes(code)) {
    return BIOMETRIC_ACCESS_STATE.CANCELLED;
  }
  if (code === 'lockout') return BIOMETRIC_ACCESS_STATE.LOCKED_OUT;
  if (code === 'not_enrolled') return BIOMETRIC_ACCESS_STATE.UNENROLLED;
  if (['not_available', 'passcode_not_set'].includes(code)) return BIOMETRIC_ACCESS_STATE.UNSUPPORTED;
  if (['authentication_failed', 'user_fallback'].includes(code)) return BIOMETRIC_ACCESS_STATE.FAILED;
  return BIOMETRIC_ACCESS_STATE.FAILED;
}

export function shouldBypassBiometricGate(pathname = '') {
  const normalized = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
  // A password-reset action is its own one-time authorization flow. It must
  // never be hidden or redirected because an unrelated account session is
  // currently present on the device.
  return normalized === '/reset-password';
}
