export function createLatestRequestGate() {
  let latestToken = 0;

  return {
    begin() {
      latestToken += 1;
      return latestToken;
    },
    isLatest(token) {
      return token === latestToken;
    },
    invalidate() {
      latestToken += 1;
    },
  };
}

export async function runLatestRequest({ gate, request, onSuccess, onError, onSettled }) {
  const token = gate.begin();

  try {
    const value = await request();
    if (!gate.isLatest(token)) return { applied: false, value };
    await onSuccess?.(value);
    return { applied: true, value };
  } catch (error) {
    if (!gate.isLatest(token)) return { applied: false, error };
    await onError?.(error);
    return { applied: true, error };
  } finally {
    if (gate.isLatest(token)) await onSettled?.();
  }
}
