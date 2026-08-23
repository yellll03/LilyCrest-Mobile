const normalizeCode = (value) => String(value ?? '').trim();

function codeMatches(code, expected) {
  if (expected === undefined || expected === null) return false;
  return code === normalizeCode(expected);
}

/**
 * Convert native Google/Firebase failures into stable, non-sensitive states.
 * Raw provider messages are deliberately not returned to the UI because they
 * may contain native implementation details. The stable code + stage remain
 * available for device-console diagnosis without logging credentials/tokens.
 */
export function classifyGoogleAuthError(error, statusCodes = {}, stage = 'native-google') {
  const code = normalizeCode(error?.code) || 'unknown';
  const message = String(error?.message || '').toLowerCase();

  if (codeMatches(code, statusCodes.SIGN_IN_CANCELLED)
    || /cancelled|canceled|user_cancel|app_cancel|system_cancel/.test(`${code} ${message}`)) {
    return {
      cancelled: true,
      type: 'cancelled',
      stage,
      code,
      message: 'Sign-in cancelled',
    };
  }

  if (codeMatches(code, statusCodes.IN_PROGRESS) || /in_progress|operation.*progress/.test(`${code} ${message}`)) {
    return {
      cancelled: false,
      type: 'busy',
      stage,
      code,
      message: 'Google Sign-In is already in progress.',
    };
  }

  if (codeMatches(code, statusCodes.PLAY_SERVICES_NOT_AVAILABLE)) {
    return {
      cancelled: false,
      type: 'configuration',
      stage,
      code,
      message: 'Google Sign-In is unavailable on this device.',
    };
  }

  if (/gidclientid|client.?id|url scheme|reversed.?client|no active configuration|developer_error|configuration/.test(`${code} ${message}`)) {
    return {
      cancelled: false,
      type: 'configuration',
      stage,
      code,
      message: 'Google Sign-In is not configured in this app build. Please install the latest version.',
    };
  }

  if (code === 'auth/network-request-failed'
    || /network|timed?\s*out|offline|connection/.test(`${code} ${message}`)) {
    return {
      cancelled: false,
      type: 'network',
      stage,
      code,
      message: 'Unable to connect. Please check your internet connection.',
    };
  }

  if (/auth\/(?:invalid-credential|operation-not-allowed|account-exists-with-different-credential)/.test(code)) {
    return {
      cancelled: false,
      type: 'credential',
      stage,
      code,
      message: 'Unable to sign in with Google. Please try again.',
    };
  }

  return {
    cancelled: false,
    type: 'unknown',
    stage,
    code,
    message: 'Unable to sign in with Google. Please try again.',
  };
}
