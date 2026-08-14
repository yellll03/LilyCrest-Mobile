import { MOBILE_HEALTH_URL } from '../config/api';

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const DEFAULT_READY_TIMEOUT_MS = 15000;

let readinessPromise = null;
let lastReadyAt = 0;

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortController === 'undefined') {
    return { signal: undefined, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

export async function ensureMobileApiReady({ timeoutMs = DEFAULT_READY_TIMEOUT_MS } = {}) {
  if (lastReadyAt) {
    return { ok: true, url: MOBILE_HEALTH_URL, cached: true, readyAt: lastReadyAt };
  }

  if (!readinessPromise) {
    readinessPromise = (async () => {
      const startedAt = Date.now();
      const { signal, cleanup } = createTimeoutSignal(timeoutMs);

      if (IS_DEV) {
        console.log('[MobileApiReady] waiting for mobile API health', {
          url: MOBILE_HEALTH_URL,
          timeoutMs,
        });
      }

      try {
        const response = await fetch(MOBILE_HEALTH_URL, { signal });
        const elapsedMs = Date.now() - startedAt;
        if (!response.ok) {
          throw new Error(`Mobile API health returned HTTP ${response.status}`);
        }
        const payload = await response.json().catch(() => null);
        if (payload?.status !== 'ok') {
          throw new Error('Mobile API health returned an invalid response');
        }
        lastReadyAt = Date.now();
        if (IS_DEV) {
          console.log('[MobileApiReady] mobile API health ready', {
            url: MOBILE_HEALTH_URL,
            status: response.status,
            elapsedMs,
          });
        }
        return { ok: true, status: response.status, url: MOBILE_HEALTH_URL, elapsedMs };
      } catch (error) {
        readinessPromise = null;
        const message = error?.name === 'AbortError'
          ? `Mobile API health timed out after ${timeoutMs}ms`
          : error?.message || 'Mobile API health check failed';
        const nextError = new Error(message);
        nextError.cause = error;
        nextError.code = error?.name === 'AbortError' ? 'MOBILE_API_HEALTH_TIMEOUT' : error?.code;
        if (IS_DEV) {
          console.warn('[MobileApiReady] mobile API health failed', {
            url: MOBILE_HEALTH_URL,
            message,
            code: nextError.code,
          });
        }
        throw nextError;
      } finally {
        cleanup();
      }
    })();
  }

  return readinessPromise;
}
