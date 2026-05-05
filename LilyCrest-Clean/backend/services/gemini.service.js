const { GoogleGenerativeAI } = require('@google/generative-ai');

// Chat session storage (in production, use Redis)
const chatSessions = new Map();
const liveChatQueue = new Map();

let genAIClient;
// Use a v1beta-supported default without models/ prefix (per integration requirements)
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_HISTORY_MESSAGES = 8;

/**
 * Detects Gemini quota / rate-limit errors (HTTP 429, RESOURCE_EXHAUSTED,
 * "quota exceeded", "Too Many Requests") so callers can degrade gracefully
 * without exposing raw API error text to the client.
 */
function isQuotaError(err) {
  if (!err) return false;
  if (err.code === 'QUOTA_EXCEEDED') return true;
  const httpStatus = err?.status ?? err?.response?.status;
  if (httpStatus === 429) return true;
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('resource_exhausted')
  );
}

function getGenAIClient() {
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error('Gemini API key is not configured');
    error.code = 'NO_API_KEY';
    throw error;
  }

  if (!genAIClient) {
    genAIClient = new GoogleGenerativeAI(apiKey);
  }
  return genAIClient;
}

function extractText(result) {
  if (!result) return '';
  try {
    // In @google/generative-ai SDK, response.text() is a METHOD, not a property
    if (result.response) {
      if (typeof result.response.text === 'function') {
        return result.response.text();
      }
      if (typeof result.response.text === 'string') {
        return result.response.text;
      }
      // Fallback: extract from candidates
      const parts = result.response.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        return parts.map((p) => p.text || '').join(' ').trim();
      }
    }
    // Direct text property or method
    if (typeof result.text === 'function') return result.text();
    if (typeof result.text === 'string') return result.text;
    return '';
  } catch (err) {
    console.error('[Gemini] extractText error:', err.message);
    return '';
  }
}

function getOrCreateSession(sessionId) {
  if (!chatSessions.has(sessionId)) {
    chatSessions.set(sessionId, { history: [] });
  }
  return chatSessions.get(sessionId);
}

// Full generative call with chat history
async function sendGeminiMessage(sessionId, prompt) {
  const session = getOrCreateSession(sessionId);
  const recentHistory = Array.isArray(session.history)
    ? session.history.slice(-MAX_HISTORY_MESSAGES)
    : [];

  const contents = recentHistory.map((h) => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }],
  }));

  contents.push({ role: 'user', parts: [{ text: prompt }] });

  try {
    const client = getGenAIClient();
    const model = client.getGenerativeModel({ model: DEFAULT_MODEL });
    console.log(`[Gemini] Sending message to model "${DEFAULT_MODEL}" (session: ${sessionId}, history: ${session.history.length} msgs)`);

    const result = await model.generateContent({
      contents,
      generationConfig: { maxOutputTokens: 360, temperature: 0.65, topP: 0.9 },
    });

    const text = extractText(result);
    console.log(`[Gemini] Response received: ${text ? text.length + ' chars' : 'EMPTY'}`);

    return { text };
  } catch (err) {
    // Quota / rate-limit: log internally, rethrow as a clean typed error.
    // Never let raw Gemini quota messages reach the client.
    if (isQuotaError(err)) {
      console.warn(`[Gemini] Quota/rate-limit exceeded for model "${DEFAULT_MODEL}". Returning QUOTA_EXCEEDED to caller.`);
      const quotaErr = new Error('Gemini quota exceeded');
      quotaErr.code = 'QUOTA_EXCEEDED';
      throw quotaErr;
    }
    console.error(`[Gemini] API error for model "${DEFAULT_MODEL}":`, err.message);
    // If the model name is invalid, try a known fallback
    if (err.message?.includes('not found') || err.message?.includes('404') || err.message?.includes('not supported')) {
      console.log('[Gemini] Retrying with fallback model "gemini-2.0-flash"...');
      try {
        const client = getGenAIClient();
        const fallbackModel = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await fallbackModel.generateContent({
          contents,
          generationConfig: { maxOutputTokens: 360, temperature: 0.65, topP: 0.9 },
        });
        const text = extractText(result);
        console.log(`[Gemini] Fallback response: ${text ? text.length + ' chars' : 'EMPTY'}`);
        return { text };
      } catch (fallbackErr) {
        if (isQuotaError(fallbackErr)) {
          console.warn('[Gemini] Fallback model also quota-exceeded.');
          const quotaErr = new Error('Gemini quota exceeded');
          quotaErr.code = 'QUOTA_EXCEEDED';
          throw quotaErr;
        }
        console.error('[Gemini] Fallback model also failed:', fallbackErr.message);
      }
    }
    throw err;
  }
}

// Intent classification (returns { intent, confidence })
async function classifyIntent(message) {
  try {
    const client = getGenAIClient();
    const model = client.getGenerativeModel({ model: DEFAULT_MODEL });
    const prompt = `You are an intent classifier for a dormitory assistant. Return strict JSON with keys intent (snake_case) and confidence (0-1). Possible intents include billing_due_date, payment_methods, late_fee, maintenance_request, house_rules, documents, account_support, move_in_requirements, amenities, emergency_contacts, room_types, general. If unsure, set intent="general" and confidence<=0.4.\r\nUser: ${message}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
    });

    const text = extractText(result);
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      return {
        intent: parsed.intent || 'general',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      };
    } catch (_err) {
      return { intent: 'general', confidence: null };
    }
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn('[Gemini] classifyIntent: quota exceeded, falling back to general intent.');
      const quotaErr = new Error('Gemini quota exceeded');
      quotaErr.code = 'QUOTA_EXCEEDED';
      throw quotaErr;
    }
    // Any other error: safe default
    return { intent: 'general', confidence: null };
  }
}

// Rephrase a predefined response in a warm, concise tone
async function rephraseWithTone(baseMessage, tenantContext) {
  const client = getGenAIClient();
  const model = client.getGenerativeModel({ model: DEFAULT_MODEL });
  const prompt = `You are Lily, a warm but concise assistant for dormitory tenants. Rephrase the provided message without adding new rules. Keep it short, friendly, and use "po" occasionally. Context (optional): ${tenantContext || 'none'}.
Message: ${baseMessage}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 180 },
  });

  const text = extractText(result);
  return text || baseMessage;
}

function resetSession(sessionId) {
  chatSessions.delete(sessionId);
}

module.exports = {
  sendGeminiMessage,
  classifyIntent,
  rephraseWithTone,
  resetSession,
  chatSessions,
  liveChatQueue,
  isQuotaError,
};
