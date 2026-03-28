import { useCallback, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { useAsyncCall } from './useAsyncCall';

const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 900; // debounce to prevent spam submits

export function useAssistantChat(initialSessionId) {
  const { run } = useAsyncCall();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [isTyping, setIsTyping] = useState(false);
  const cooldownRef = useRef(0);

  const loadPersistedSession = useCallback(async () => {
    // No persistence: always start fresh
    setSessionId(initialSessionId);
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const now = Date.now();
      if (now - cooldownRef.current < RATE_LIMIT_MS) {
        return { error: { code: 'rate_limited', detail: 'Please wait a moment before sending again.' } };
      }
      cooldownRef.current = now;

      setIsTyping(true);
      let attempt = 0;
      let lastError = null;

      while (attempt < MAX_RETRIES) {
        const backoffMs = attempt === 0 ? 0 : 500 * Math.pow(2, attempt - 1); // 0, 500, 1000
        if (backoffMs) await new Promise((res) => setTimeout(res, backoffMs));
        attempt += 1;

        const { data, error } = await run(`chat-${sessionId}-${attempt}`, async () =>
          apiService.sendChatMessage(text, sessionId)
        );

        if (!error) {
          setIsTyping(false);
          const response = data?.data?.response || '';
          const metadata = data?.data?.meta || {};
          const needsAdmin = data?.data?.needs_admin || false;
          const suggestions = Array.isArray(data?.data?.suggestions) ? data.data.suggestions : [];
          return { response, metadata, needsAdmin, suggestions, attempt };
        }

        lastError = error;
        if (error.code === 'unauthorized') break; // don't retry auth failures
        if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) break; // validation/client errors
      }

      setIsTyping(false);
      return { error: lastError || { code: 'network_error', detail: 'No response received.' } };
    },
    [run, sessionId]
  );

  const resetSession = useCallback(async () => {
    try {
      await apiService.resetChatSession(sessionId);
    } catch (err) {
      console.warn('Session reset failed:', err?.message);
    }
    const newSessionId = `${initialSessionId.split('-chat-')[0]}-chat-${Date.now()}`;
    setSessionId(newSessionId);
    return newSessionId;
  }, [sessionId, initialSessionId]);

  return { sessionId, setSessionId, sendMessage, isTyping, loadPersistedSession, resetSession };
}
