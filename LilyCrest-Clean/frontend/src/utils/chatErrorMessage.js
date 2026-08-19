export function getChatErrorMessage(error, fallback = 'Chat is unavailable right now. Please try again.') {
  const status = error?.response?.status ?? error?.status;
  const code = String(error?.response?.data?.code || error?.backendCode || '').trim().toUpperCase();

  if (status === 401) return 'Your session expired. Please sign in again to continue.';
  if (status === 403 && code === 'ACCOUNT_INACTIVE') {
    return 'This tenant account is inactive. Please contact LilyCrest support.';
  }
  if (status === 403) return 'Chat is not available for this account.';
  if (code === 'BRANCH_REQUIRED' || code === 'TENANT_CONTEXT_REQUIRED' || code === 'TENANT_NOT_FOUND') {
    return 'We could not resolve your active tenant and branch. Please contact LilyCrest support.';
  }
  if (status === 409) return 'This conversation changed on the server. Refresh it and try again.';
  if (status === 413 || code === 'ATTACHMENT_TOO_LARGE') {
    return 'This attachment is too large. Choose a file smaller than 5 MB.';
  }
  if (status === 422 || code === 'UNSUPPORTED_FILE_TYPE' || code === 'INVALID_CHAT_ATTACHMENT') {
    return 'This attachment could not be accepted. Choose a supported image or PDF and try again.';
  }
  if (status === 429) return 'Too many chat requests. Please wait a moment and try again.';
  if (
    error?.code === 'network_error'
    || error?.network
    || (!error?.response && (error?.request || /network|timeout|failed to fetch/i.test(String(error?.message || ''))))
  ) {
    return 'Unable to connect to chat. Check your connection and try again.';
  }
  if (status === 404 || status >= 500) return 'Chat is temporarily unavailable. Please try again later.';
  return fallback;
}
