const ENABLE_LOGS = process.env.EXPO_PUBLIC_ASSISTANT_LOGS === 'true';

const redact = (payload) => {
  const clone = { ...payload };
  if (clone.token) clone.token = '[redacted]';
  if (clone.headers) clone.headers = '[redacted]';
  return clone;
};

export function logInfo(message, payload) {
  if (!ENABLE_LOGS) return;
  console.log(`[assistant] ${message}`, payload ? redact(payload) : '');
}

export function logError(message, error) {
  if (!ENABLE_LOGS) return;
  console.error(`[assistant] ${message}`, {
    message: error?.message,
    status: error?.response?.status,
    detail: error?.response?.data?.detail,
  });
}
