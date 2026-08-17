import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { getChatErrorMessage } from '../utils/chatErrorMessage';
import { useAsyncCall } from './useAsyncCall';

const MAX_RETRIES = 2;
const RATE_LIMIT_MS = 900; // debounce to prevent spam submits

function detectTypingIntent(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/\b(bill|balance|unpaid|bayarin|bayad|rent|due|payment|paymongo|paid already|already paid)\b/.test(lower)) return 'billing';
  if (/\b(maintenance|repair|sira|request|fix|admin reply|may reply|repair status|status ng maintenance)\b/.test(lower)) return 'maintenance';
  if (/\b(account|profile|info|details)\b/.test(lower)) return 'profile';
  return 'general';
}

function unwrapAssistantPayload(result) {
  const body = result?.data || {};
  if (body?.data && typeof body.data === 'object' && (body.data.message || body.data.response)) {
    return body.data;
  }
  return body;
}

export function useAssistantChat(initialSessionId) {
  const { run } = useAsyncCall();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [isTyping, setIsTyping] = useState(false);
  const [typingIntent, setTypingIntent] = useState('general');
  const cooldownRef = useRef(0);

  useEffect(() => {
    setSessionId(initialSessionId);
    setIsTyping(false);
    setTypingIntent('general');
    cooldownRef.current = 0;
  }, [initialSessionId]);

  const loadPersistedSession = useCallback(async () => {
    // No persistence: always start fresh
    setSessionId(initialSessionId);
  }, [initialSessionId]);

  const sendMessage = useCallback(
    async (text, attachments = []) => {
      const now = Date.now();
      if (now - cooldownRef.current < RATE_LIMIT_MS) {
        return { error: { code: 'rate_limited', detail: 'Please wait a moment before sending again.' } };
      }
      cooldownRef.current = now;

      setIsTyping(true);
      setTypingIntent(detectTypingIntent(text));
      let attempt = 0;
      let lastError = null;

      while (attempt < MAX_RETRIES) {
        const backoffMs = attempt === 0 ? 0 : 350 * Math.pow(2, attempt - 1); // 0, 350
        if (backoffMs) await new Promise((res) => setTimeout(res, backoffMs));
        attempt += 1;

        const { data, error } = await run(`chat-${sessionId}-${attempt}`, async () =>
          apiService.sendChatMessage(text, sessionId, attachments)
        );

        if (!error) {
          setIsTyping(false);
          const payload = unwrapAssistantPayload(data);
          const response = payload?.message || payload?.response || '';
          const intent = payload?.intent || payload?.meta?.intent || 'general';
          const metadata = payload?.meta || payload?.metadata || {};
          const needsAdmin = Boolean(payload?.needs_admin ?? payload?.needsAdmin);
          const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
          return { response, intent, metadata, needsAdmin, suggestions, attempt };
        }

        lastError = { ...error, detail: getChatErrorMessage(error) };
        if (error.code === 'unauthorized') break; // don't retry auth failures
        if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) break; // validation/client errors
      }

      setIsTyping(false);
      setTypingIntent('general');
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

  return { sessionId, setSessionId, sendMessage, isTyping, typingIntent, loadPersistedSession, resetSession };
}
