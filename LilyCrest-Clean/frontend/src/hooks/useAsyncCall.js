import { useCallback, useRef } from 'react';

// Small helper to wrap async calls with duplicate guard and normalized error shape.
export function useAsyncCall() {
  const inflight = useRef(new Set());

  const run = useCallback(async (key, fn) => {
    if (inflight.current.has(key)) return { error: { code: 'duplicate_inflight', detail: 'Already running' } };
    inflight.current.add(key);
    try {
      const result = await fn();
      return { data: result, error: null };
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail || err?.message || 'Request failed';
      const code = status === 401 ? 'unauthorized' : status === 500 ? 'server_error' : 'network_error';
      return { error: { code, detail, status } };
    } finally {
      inflight.current.delete(key);
    }
  }, []);

  return { run };
}
