// Lightweight pub/sub so the axios layer (outside the React tree) can tell
// AuthContext a session just died mid-use, mirroring the pattern in billingState.js.
// Without this, a background 401 that api.js already clears the token for
// left React state (`authStatus: 'authenticated'`) stale until the next screen
// happened to make another API call.

const expiredListeners = new Set();
const recoveredListeners = new Set();

export function emitSessionExpired(reason = 'expired', details = {}) {
  // `expiredToken` is the token that just failed, captured before api.js deletes it
  // from storage — it's already rejected by the server for genuine TTL expiry, but
  // passing it along lets the listener attempt a best-effort authenticated cleanup
  // call for the cases where it isn't (see AuthContext's forced-expiry handler).
  const payload = { reason, at: Date.now(), expiredToken: details?.expiredToken || null };
  expiredListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (_error) {
      // Ignore listener failures so one screen cannot block the others.
    }
  });
}

export function subscribeSessionExpired(listener) {
  if (typeof listener !== 'function') return () => {};
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

// An authenticated 2xx response proves both connectivity and session validity.
// Keep this separate from screen-local error state so a successful retry can
// reconcile AuthContext's global offline banner without hiding it optimistically.
export function emitSessionRecovered(details = {}) {
  const payload = { at: Date.now(), url: details?.url || null };
  recoveredListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (_error) {
      // A recovery observer must never affect the successful API response.
    }
  });
}

export function subscribeSessionRecovered(listener) {
  if (typeof listener !== 'function') return () => {};
  recoveredListeners.add(listener);
  return () => {
    recoveredListeners.delete(listener);
  };
}
