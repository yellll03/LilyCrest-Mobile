export const BILL_UNAVAILABLE_MESSAGE = 'This billing record is no longer available.';

const listeners = new Set();

export function emitBillingRefresh(reason = 'updated') {
  const payload = { reason, at: Date.now() };
  listeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (_error) {
      // Ignore listener failures so one screen cannot block the others.
    }
  });
}

export function subscribeBillingRefresh(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBillingApiMessage(error, fallbackMessage) {
  const detail = typeof error?.response?.data?.detail === 'string'
    ? error.response.data.detail.trim()
    : '';

  if (detail) return detail;
  return fallbackMessage;
}

export function isBillingUnavailableMessage(message) {
  return String(message || '').trim() === BILL_UNAVAILABLE_MESSAGE;
}
