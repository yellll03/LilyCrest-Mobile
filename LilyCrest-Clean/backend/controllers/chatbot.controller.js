const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const {
  CHATBOT_SYSTEM_PROMPT,
  KNOWLEDGE_BASE,
  ESCALATION_KEYWORDS,
  DEFAULT_FOLLOWUPS,
  isGreeting,
  getTimeOfDayGreeting,
} = require('../config/chatbot.presets');
const {
  classifyIntent,
  sendGeminiMessage,
  liveChatQueue,
  chatSessions,
  isQuotaError,
} = require('../services/gemini.service');

const GEMINI_QUOTA_FALLBACK = 'Lily Assistant is temporarily unavailable due to high demand. You may try again later or contact admin for urgent concerns.';
const {
  notifyAdminChatAccepted,
  notifyChatbotReply,
} = require('../services/pushService');
const { fetchUserBills } = require('./billing.controller');

function sanitizeResponse(text = '') {
  const withoutFences = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''));
  const withoutInline = withoutFences.replace(/`([^`]+)`/g, '$1');
  const squashedBlankLines = withoutInline.replace(/\n{3,}/g, '\n\n');
  return squashedBlankLines.trim();
}

function looksLikeCode(text = '') {
  if (!text) return false;
  if (/```/.test(text)) return true;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const codeLineCount = lines.filter((line) =>
    /^(const|let|var|function|class|import|export|if\s*\(|for\s*\(|while\s*\(|return\b|<\w+|SELECT\b|INSERT\b|UPDATE\b|DELETE\b)/i.test(line)
  ).length;
  const symbolHits = (text.match(/[{}<>;]/g) || []).length;
  return codeLineCount >= 2 || symbolHits > 40;
}

const KNOWLEDGE_LIST = Object.values(KNOWLEDGE_BASE);
const MAX_CHAT_MESSAGE_CHARS = 800;
const MAX_ADMIN_REASON_CHARS = 300;
const MAX_SESSION_ID_CHARS = 120;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PRIMARY_MAINTENANCE_COLLECTION = 'maintenance_requests';
const LEGACY_MAINTENANCE_COLLECTION = 'maintenancerequests';
const SUPPORTED_INTENTS = {
  BILLING: 'billing',
  MAINTENANCE: 'maintenance',
  PROFILE: 'profile',
  GENERAL: 'general',
};

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }
  return null;
}

function normalizeSessionId(rawSessionId, userId) {
  const candidate = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
  if (!candidate) {
    return { ok: true, value: `${userId}_${Date.now()}` };
  }
  if (candidate.length > MAX_SESSION_ID_CHARS || !SESSION_ID_PATTERN.test(candidate)) {
    return { ok: false, error: 'Invalid session id format' };
  }
  return { ok: true, value: candidate };
}

function normalizeUserMessage(rawMessage) {
  if (typeof rawMessage !== 'string') {
    return { ok: false, error: 'Message must be text' };
  }
  const collapsed = rawMessage.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!collapsed) {
    return { ok: false, error: 'Message is required' };
  }
  if (collapsed.length > MAX_CHAT_MESSAGE_CHARS) {
    return { ok: false, error: `Message must be ${MAX_CHAT_MESSAGE_CHARS} characters or fewer` };
  }
  return { ok: true, value: collapsed };
}

function detectSystemIntent(message = '') {
  const lower = String(message || '').toLowerCase();
  if (/\b(bill|unpaid|bayarin|due|payment)\b/.test(lower)) {
    return SUPPORTED_INTENTS.BILLING;
  }
  if (/\b(maintenance|repair|sira|request|fix)\b/.test(lower)) {
    return SUPPORTED_INTENTS.MAINTENANCE;
  }
  if (/\b(account|profile|info|details)\b/.test(lower)) {
    return SUPPORTED_INTENTS.PROFILE;
  }
  return SUPPORTED_INTENTS.GENERAL;
}

function normalizeAssistantIntent(intent = '') {
  const lower = String(intent || '').toLowerCase();
  if (lower.includes('billing') || lower.includes('payment') || lower.includes('bill')) {
    return SUPPORTED_INTENTS.BILLING;
  }
  if (lower.includes('maintenance') || lower.includes('repair') || lower.includes('request')) {
    return SUPPORTED_INTENTS.MAINTENANCE;
  }
  if (lower.includes('profile') || lower.includes('account')) {
    return SUPPORTED_INTENTS.PROFILE;
  }
  return SUPPORTED_INTENTS.GENERAL;
}

function formatPesoCompact(amount) {
  const numeric = Number(amount || 0);
  return `P${numeric.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-PH', { month: 'long', day: 'numeric' });
}

function getBillAmountValue(bill = {}) {
  const candidates = [bill.remaining_amount, bill.total, bill.amount, bill.gross_amount];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function isBillUnpaid(bill = {}) {
  const status = String(bill.status || '').toLowerCase();
  return status !== 'paid' && status !== 'settled';
}

function normalizeBillTypeLabel(bill = {}) {
  const source = String(
    bill.description
      || bill.billing_period
      || bill.billing_type
      || 'bill'
  ).trim();
  if (!source) return 'bill';
  return source.charAt(0).toLowerCase() + source.slice(1);
}

function requestTimestampValue(request = {}) {
  const raw = request.created_at || request.createdAt || request.updated_at || request.updatedAt || 0;
  const numeric = new Date(raw).getTime();
  return Number.isFinite(numeric) ? numeric : 0;
}

function requestStatusValue(request = {}) {
  return String(request.status || '').toLowerCase();
}

async function fetchMaintenanceRequestsForUser(db, user = {}) {
  const userId = user.user_id;
  const mongoId = asObjectId(user._id);
  const filter = {
    $or: [
      { user_id: userId },
      ...(mongoId ? [{ userId: mongoId }] : []),
    ],
  };

  const collections = [PRIMARY_MAINTENANCE_COLLECTION, LEGACY_MAINTENANCE_COLLECTION];
  const records = [];

  for (const collectionName of collections) {
    try {
      const docs = await db.collection(collectionName).find(filter).toArray();
      records.push(...docs);
    } catch (_error) {
      // Ignore missing legacy collections.
    }
  }

  const deduped = new Map();
  for (const record of records) {
    const key = record.request_id || String(record._id);
    if (!deduped.has(key)) {
      deduped.set(key, record);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => requestTimestampValue(right) - requestTimestampValue(left));
}

async function buildBillingResponse(db, user) {
  const bills = await fetchUserBills(db, user, { limit: 20 });
  const unpaidBills = bills.filter(isBillUnpaid);

  if (!unpaidBills.length) {
    return {
      message: 'You currently have no unpaid bills.',
      intent: SUPPORTED_INTENTS.BILLING,
      suggestions: [
        { label: 'Payment history', prompt: 'Show my recent payments.' },
        { label: 'Billing summary', prompt: 'Show my latest billing summary.' },
      ],
    };
  }

  const totalOutstanding = unpaidBills.reduce((sum, bill) => sum + getBillAmountValue(bill), 0);
  const nextDueBill = [...unpaidBills].sort((left, right) => {
    const leftTime = new Date(left.due_date || left.dueDate || 0).getTime();
    const rightTime = new Date(right.due_date || right.dueDate || 0).getTime();
    return leftTime - rightTime;
  })[0];

  const dueDate = formatShortDate(nextDueBill?.due_date || nextDueBill?.dueDate);
  const billType = normalizeBillTypeLabel(nextDueBill);
  const dueText = dueDate ? ` due on ${dueDate}` : '';

  return {
    message: `You currently have ${formatPesoCompact(totalOutstanding)} unpaid for ${billType}${dueText}.`,
    intent: SUPPORTED_INTENTS.BILLING,
    suggestions: [
      { label: 'Latest bill', prompt: 'Show my latest billing summary.' },
      { label: 'Payment methods', prompt: 'How can I pay my bill?' },
    ],
  };
}

async function buildMaintenanceResponse(db, user) {
  const requests = await fetchMaintenanceRequestsForUser(db, user);
  const activeStatuses = new Set(['pending', 'viewed', 'in_progress', 'open']);
  const activeRequests = requests.filter((request) => activeStatuses.has(requestStatusValue(request)));

  if (!activeRequests.length) {
    return {
      message: 'You currently have no active maintenance requests.',
      intent: SUPPORTED_INTENTS.MAINTENANCE,
      suggestions: [
        { label: 'Report an issue', prompt: 'I need help with a maintenance issue.' },
      ],
    };
  }

  const latestRequest = activeRequests[0];
  const requestType = String(latestRequest.request_type || latestRequest.title || 'maintenance issue')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  const status = requestStatusValue(latestRequest).replace(/_/g, ' ');
  const submittedDate = formatShortDate(latestRequest.created_at || latestRequest.createdAt);
  const dateText = submittedDate ? ` It was submitted on ${submittedDate}.` : '';

  return {
    message: `Your latest maintenance request for ${requestType} is still ${status}.${dateText}`.replace('..', '.'),
    intent: SUPPORTED_INTENTS.MAINTENANCE,
    suggestions: [
      { label: 'Latest request', prompt: 'Show my latest maintenance request.' },
      { label: 'Create request', prompt: 'I need to report a new maintenance issue.' },
    ],
  };
}

function buildProfileResponse(user = {}) {
  const name = user.name || 'your account';
  const email = user.email || 'no email on file';
  return {
    message: `Your account is registered under ${name} (${email}).`,
    intent: SUPPORTED_INTENTS.PROFILE,
    suggestions: [
      { label: 'Update profile', prompt: 'How do I update my profile?' },
    ],
  };
}

function asksForIdentityInfo(text = '') {
  const normalized = String(text || '').toLowerCase();
  return (
    /full name/.test(normalized)
    || /room number/.test(normalized)
    || /what(?:'s| is) your name/.test(normalized)
    || /what(?:'s| is) your room/.test(normalized)
    || /can you give me your name/.test(normalized)
    || /can you provide your room/.test(normalized)
    || /confirm your identity/.test(normalized)
  );
}

function getIdentitySafeFallback(intent) {
  switch (intent) {
    case SUPPORTED_INTENTS.BILLING:
      return 'I already have your account open. Ask me what part of your billing you want to check, like your unpaid total or due date.';
    case SUPPORTED_INTENTS.MAINTENANCE:
      return 'I already have your account details. Ask me if you want your latest maintenance status or active requests.';
    case SUPPORTED_INTENTS.PROFILE:
      return 'I already have your account details open. Tell me what profile information you want to review.';
    default:
      return 'I already have your account context, so you do not need to repeat your identity. Tell me what you need help with.';
  }
}

// ── Knowledge matching (for context hints, NOT direct responses) ──

function findRelevantKnowledge(message) {
  const lower = message.toLowerCase();
  const matched = KNOWLEDGE_LIST.filter((entry) =>
    (entry.triggers || []).some((t) => lower.includes(t))
  );
  return matched;
}

function findKnowledgeByIntent(intent) {
  return KNOWLEDGE_LIST.find((entry) => entry.intent === intent) || null;
}

function inferIntentFromKnowledge(knowledgeEntries, message) {
  const firstIntent = knowledgeEntries.find((entry) => entry.intent)?.intent;
  if (firstIntent) return { intent: firstIntent, confidence: 0.9 };

  const lower = String(message || '').toLowerCase();
  if (isGreeting(message) && lower.trim().split(/\s+/).length <= 4) {
    return { intent: 'greeting', confidence: 1 };
  }
  if (/complaint|connect me to an admin|talk to admin|speak to admin|contact admin|escalate/.test(lower)) {
    return { intent: 'admin_escalation', confidence: 0.9 };
  }
  return { intent: 'general', confidence: null };
}

function shouldEscalate(knowledgeEntries, message) {
  const lower = message.toLowerCase();
  const hitGlobalKeyword = ESCALATION_KEYWORDS.some((word) => lower.includes(word));
  const hitEntryKeyword = knowledgeEntries.some((entry) =>
    (entry.escalation_if || []).some((word) => lower.includes(word))
  );
  return hitGlobalKeyword || hitEntryKeyword;
}

/**
 * Pick follow-up suggestions based on matched knowledge or intent.
 */
function pickFollowups(knowledgeEntries, intent) {
  // Use followups from the first matched knowledge entry that has them
  for (const entry of knowledgeEntries) {
    if (entry.followups?.length) return entry.followups.slice(0, 3);
  }
  // Fall back to intent-based lookup
  const intentEntry = findKnowledgeByIntent(intent);
  if (intentEntry?.followups?.length) return intentEntry.followups.slice(0, 3);
  return DEFAULT_FOLLOWUPS;
}

/**
 * Build a rich, context-aware prompt for Gemini.
 * This is the heart of the AI-first approach.
 */
function buildAIPrompt(userMessage, contextLines, knowledgeHints, conversationHistory) {
  const timeContext = `Current time: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`;
  const contextBlock = contextLines.length > 0
    ? `\nTENANT CONTEXT:\n${contextLines.join('\n')}`
    : '';
  const knowledgeBlock = knowledgeHints.length > 0
    ? `\nRELEVANT POLICIES (reference naturally, don't quote verbatim):\n${knowledgeHints.map((k) => `- ${k.knowledge}`).join('\n')}`
    : '';
  const historyBlock = conversationHistory.length > 0
    ? `\nRECENT CONVERSATION:\n${conversationHistory.slice(-6).map((h) => `${h.role === 'user' ? 'Tenant' : 'Lily'}: ${h.content}`).join('\n')}`
    : '';

  return `${CHATBOT_SYSTEM_PROMPT}\n\n${timeContext}${contextBlock}${knowledgeBlock}${historyBlock}\n\nTenant: ${userMessage}`;
}

async function ensureLiveChatRequest(db, sessionId, userId, userName, userEmail, reason) {
  const existing = liveChatQueue.get(sessionId);
  if (existing) return existing;

  const session = chatSessions.get(sessionId);
  const chatHistory = session ? session.history : [];
  const liveChatRequest = {
    session_id: sessionId,
    user_id: userId,
    user_name: userName || 'Tenant',
    user_email: userEmail,
    reason: reason || 'Requested admin assistance',
    chat_history: chatHistory,
    messages: [],
    status: 'waiting',
    admin_id: null,
    admin_name: null,
    position: liveChatQueue.size + 1,
    created_at: new Date(),
  };

  liveChatQueue.set(sessionId, liveChatRequest);
  await db.collection('live_chat_requests').insertOne(liveChatRequest);

  // Also create a support ticket so the web admin dashboard (which watches
  // the tickets collection) sees the escalation immediately.
  const ticketId = `ticket_esc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
  await db.collection('tickets').insertOne({
    ticket_id: ticketId,
    user_id: userId,
    subject: 'Admin Chat Request',
    message: reason || 'Tenant requested admin assistance via AI assistant.',
    category: 'Escalation',
    status: 'open',
    source: 'live_chat',
    session_id: sessionId,
    responses: [],
    created_at: new Date(),
    updated_at: new Date(),
  });

  return liveChatRequest;
}

// ─────────────────────────────────────────────────────
// Send message — main chatbot endpoint (AI-first)
// ─────────────────────────────────────────────────────
async function sendMessage(req, res) {
  try {
    const { message, session_id } = req.body;
    const userId = req.user.user_id;
    const userEmail = req.user.email;
    const userName = req.user.name;
    const normalizedMessage = normalizeUserMessage(message);
    if (!normalizedMessage.ok) {
      return res.status(400).json({ detail: normalizedMessage.error });
    }

    const normalizedSession = normalizeSessionId(session_id, userId);
    if (!normalizedSession.ok) {
      return res.status(400).json({ detail: normalizedSession.error });
    }
    const sessionId = normalizedSession.value;
    const userMessage = normalizedMessage.value;
    const lowerUserMessage = userMessage.toLowerCase();
    const routedIntent = detectSystemIntent(userMessage);
    const forceEscalation = ESCALATION_KEYWORDS.some((keyword) => lowerUserMessage.includes(keyword));

    // Pull tenant context for grounded responses
    const db = getDb();
    const [announcements, pendingBills, activeSupportConversations] = await Promise.all([
      db.collection('announcements').find({ is_active: true }).sort({ created_at: -1 }).limit(3).toArray(),
      fetchUserBills(db, req.user, { limit: 3 }).then((bills) => bills.filter(isBillUnpaid).slice(0, 3)),
      db.collection('chat_conversations')
        .find({ tenantUserId: userId, status: { $in: ['open', 'in_review', 'waiting_tenant', 'resolved'] } })
        .sort({ updatedAt: -1 })
        .limit(3)
        .toArray(),
    ]);

    // Check if this is an active live chat (admin is responding)
    const liveChat = liveChatQueue.get(sessionId);
    if (liveChat && liveChat.status === 'active') {
      liveChat.messages.push({ sender: 'tenant', content: userMessage, timestamp: new Date() });
      return res.json({ response: null, session_id: sessionId, live_chat_active: true, admin_name: liveChat.admin_name, message: 'Message sent to admin' });
    }

    // Build tenant context lines
    const contextLines = [];
    contextLines.push(`Tenant: ${userName || 'Resident'} (${userEmail || 'unknown'})`);
    contextLines.push('Authentication: This tenant is already signed in. Never ask for their full name, room number, or identity confirmation.');

    if (pendingBills.length > 0) {
      const billsSummary = pendingBills.map((b) => {
        const amount = typeof b.amount === 'number' ? b.amount.toFixed(2) : b.amount;
        return `- ${b.description || b.billing_type || 'Bill'}: ₱${amount}, due ${new Date(b.due_date).toLocaleDateString('en-PH')}`;
      }).join('\n');
      contextLines.push(`Pending bills:\n${billsSummary}`);
    } else {
      contextLines.push('Pending bills: none');
    }

    if (activeSupportConversations.length > 0) {
      const supportSummary = activeSupportConversations.map((conversation) => {
        const category = String(conversation.category || 'general_inquiry').replace(/_/g, ' ');
        return `- ${category} (${conversation.status || 'open'})`;
      }).join('\n');
      contextLines.push(`Active admin support conversations:\n${supportSummary}`);
    } else {
      contextLines.push('Active admin support conversations: none');
    }

    if (announcements.length > 0) {
      const annSummary = announcements.map((a) => `- ${a.title || 'Announcement'}: ${a.content ? a.content.slice(0, 120) : ''}`).join('\n');
      contextLines.push(`Recent announcements:\n${annSummary}`);
    }

    if (!forceEscalation && routedIntent === SUPPORTED_INTENTS.BILLING) {
      const billingResult = await buildBillingResponse(db, req.user);
      const billingSess = chatSessions.get(sessionId) || { history: [] };
      billingSess.history.push({ role: 'user', content: userMessage });
      billingSess.history.push({ role: 'assistant', content: billingResult.message });
      chatSessions.set(sessionId, billingSess);
      return res.json({
        message: billingResult.message,
        response: billingResult.message,
        intent: billingResult.intent,
        session_id: sessionId,
        needs_admin: false,
        live_chat_active: false,
        fallback: false,
        suggestions: billingResult.suggestions,
        meta: { intent: billingResult.intent, confidence: 1, source: 'system' },
      });
    }

    if (!forceEscalation && routedIntent === SUPPORTED_INTENTS.MAINTENANCE) {
      const maintenanceResult = await buildMaintenanceResponse(db, req.user);
      const maintenanceSess = chatSessions.get(sessionId) || { history: [] };
      maintenanceSess.history.push({ role: 'user', content: userMessage });
      maintenanceSess.history.push({ role: 'assistant', content: maintenanceResult.message });
      chatSessions.set(sessionId, maintenanceSess);
      return res.json({
        message: maintenanceResult.message,
        response: maintenanceResult.message,
        intent: maintenanceResult.intent,
        session_id: sessionId,
        needs_admin: false,
        live_chat_active: false,
        fallback: false,
        suggestions: maintenanceResult.suggestions,
        meta: { intent: maintenanceResult.intent, confidence: 1, source: 'system' },
      });
    }

    if (!forceEscalation && routedIntent === SUPPORTED_INTENTS.PROFILE) {
      const profileResult = buildProfileResponse(req.user);
      const profileSess = chatSessions.get(sessionId) || { history: [] };
      profileSess.history.push({ role: 'user', content: userMessage });
      profileSess.history.push({ role: 'assistant', content: profileResult.message });
      chatSessions.set(sessionId, profileSess);
      return res.json({
        message: profileResult.message,
        response: profileResult.message,
        intent: profileResult.intent,
        session_id: sessionId,
        needs_admin: false,
        live_chat_active: false,
        fallback: false,
        suggestions: profileResult.suggestions,
        meta: { intent: profileResult.intent, confidence: 1, source: 'system' },
      });
    }

    // Find relevant knowledge entries (context hints for the AI)
    const knowledgeHints = findRelevantKnowledge(userMessage);
    const meta = { intent: SUPPORTED_INTENTS.GENERAL, confidence: null };
    let followups = [];
    let aiResponse = '';
    let needsAdmin = false;

    // Avoid a second model call when we already have a strong local signal.
    const inferredIntent = inferIntentFromKnowledge(knowledgeHints, userMessage);
    meta.intent = inferredIntent.intent || 'general';
    meta.confidence = inferredIntent.confidence ?? null;

    if (meta.intent === 'general' && knowledgeHints.length === 0 && !isGreeting(userMessage)) {
      try {
        const intentResult = await classifyIntent(userMessage);
        meta.intent = intentResult.intent || 'general';
        meta.confidence = intentResult.confidence ?? null;
        const intentKnowledge = findKnowledgeByIntent(intentResult.intent);
        if (intentKnowledge && !knowledgeHints.includes(intentKnowledge)) {
          knowledgeHints.push(intentKnowledge);
        }
      } catch (intentErr) {
        console.warn('Intent classify failed:', intentErr?.message);
      }
    }

    // Pick follow-ups
    followups = pickFollowups(knowledgeHints, meta.intent);

    // Check for escalation
    const escalate = shouldEscalate(knowledgeHints, userMessage);

    // Get conversation history for continuity
    const session = chatSessions.get(sessionId) || { history: [] };
    const conversationHistory = session.history || [];

    // ── Generate response ──
    try {
      if (escalate) {
        // Safety/admin escalation — AI still generates the response, but we flag it
        needsAdmin = true;
        await ensureLiveChatRequest(
          db, sessionId, userId, userName, userEmail,
          `Escalated: ${userMessage.slice(0, 120)}`
        );
        // Let AI craft a natural escalation message
        const escalationPrompt = buildAIPrompt(
          userMessage, contextLines, knowledgeHints, conversationHistory
        ) + '\n\nIMPORTANT: This message has been flagged for admin attention. Acknowledge the tenant\'s concern empathetically, let them know an admin will follow up shortly, and reassure them. Keep it short and warm.';
        const { text } = await sendGeminiMessage(sessionId, escalationPrompt);
        aiResponse = text || "I understand your concern po. I've flagged this for our admin team and they'll get back to you shortly. If it's urgent, you can also call +63 912 345 6789.";
      } else if (isGreeting(userMessage) && userMessage.trim().split(/\s+/).length <= 4) {
        // Pure greeting (short message) — let AI generate a warm, personalized greeting
        const greetingPrompt = buildAIPrompt(
          userMessage, contextLines, [], conversationHistory
        ) + '\n\nThis is a greeting. Respond warmly, introduce yourself briefly as Lily, and ask how you can help. Mention the time of day naturally. Keep it to 1-2 sentences.';
        const { text } = await sendGeminiMessage(sessionId, greetingPrompt);
        aiResponse = text || `${getTimeOfDayGreeting()} I'm Lily, your dorm assistant. How can I help you today po?`;
        meta.intent = 'greeting';
        meta.confidence = 1;
      } else {
        // Normal message — AI-first, always
        const prompt = buildAIPrompt(userMessage, contextLines, knowledgeHints, conversationHistory);
        const { text } = await sendGeminiMessage(sessionId, prompt);

        if (text && !looksLikeCode(text)) {
          aiResponse = text;
          if (text.includes('[NEEDS_ADMIN]')) {
            needsAdmin = true;
            await ensureLiveChatRequest(
              db, sessionId, userId, userName, userEmail,
              `AI escalation: ${userMessage.slice(0, 120)}`
            );
          }
        } else {
          // AI returned code or empty — retry with a simpler prompt
          const retryPrompt = `${CHATBOT_SYSTEM_PROMPT}\n\nThe tenant asked: "${userMessage}"\n\nRespond naturally and helpfully. Do NOT include any code, formatting, or technical syntax.`;
          const retry = await sendGeminiMessage(sessionId, retryPrompt);
          aiResponse = retry.text || "I'm here to help po. Could you rephrase your question? You can ask me about billing, maintenance, house rules, or anything about your stay at LilyCrest.";
        }
      }
    } catch (modelError) {
      if (isQuotaError(modelError)) {
        console.warn('[Chatbot] Gemini quota/rate-limit exceeded — returning friendly fallback. Not exposing error to client.');
        aiResponse = GEMINI_QUOTA_FALLBACK;
      } else {
        console.error('Chatbot AI error:', modelError);
        aiResponse = "I'm having a bit of trouble right now po. Please try again in a moment, or you can reach the admin office directly at +63 912 345 6789.";
      }
    }

    // Clean the response
    const responseText = typeof aiResponse === 'string' ? aiResponse : String(aiResponse ?? '');
    let cleanResponse = sanitizeResponse(responseText.replace('[NEEDS_ADMIN]', '').trim())
      || "I'm here to help po. Could you tell me more about what you need?";

    if (req.user && asksForIdentityInfo(cleanResponse)) {
      cleanResponse = getIdentitySafeFallback(meta.intent);
    }

    // Final code check
    if (looksLikeCode(cleanResponse)) {
      cleanResponse = "I'm here to help po. Could you rephrase your question? You can ask me about billing, maintenance, house rules, or anything about your stay.";
    }

    // Update in-memory session history
    session.history = session.history || [];
    session.history.push({ role: 'user', content: userMessage });
    session.history.push({ role: 'assistant', content: cleanResponse });
    if (session.history.length > 30) {
      session.history = session.history.slice(-30);
    }
    chatSessions.set(sessionId, session);

    res.json({
      message: cleanResponse,
      response: cleanResponse,
      intent: normalizeAssistantIntent(meta.intent),
      session_id: sessionId,
      needs_admin: needsAdmin,
      live_chat_active: false,
      fallback: false,
      suggestions: followups,
      meta,
    });
  } catch (error) {
    if (isQuotaError(error)) {
      console.warn('[Chatbot] Uncaught Gemini quota error — returning friendly fallback as bot message.');
      return res.json({
        message: GEMINI_QUOTA_FALLBACK,
        response: GEMINI_QUOTA_FALLBACK,
        intent: 'general',
        session_id: req.body?.session_id || null,
        needs_admin: false,
        live_chat_active: false,
        fallback: true,
        suggestions: DEFAULT_FOLLOWUPS,
        meta: { intent: 'general', confidence: null, source: 'quota_fallback' },
      });
    }
    console.error('Chatbot error:', error);
    res.status(500).json({
      response: "I'm having trouble connecting right now po. Please try again, or contact the admin office at +63 912 345 6789.",
      detail: 'Service temporarily unavailable',
    });
  }
}

// ─────────────────────────────────────────────────────
// Request admin
// ─────────────────────────────────────────────────────
async function requestAdmin(req, res) {
  try {
    const { session_id, reason } = req.body;
    const userId = req.user.user_id;
    const db = getDb();
    const user = await db.collection('users').findOne({ user_id: userId });
    const normalizedSession = normalizeSessionId(session_id, userId);
    if (!normalizedSession.ok) {
      return res.status(400).json({ detail: normalizedSession.error });
    }
    const sessionId = normalizedSession.value;
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (normalizedReason.length > MAX_ADMIN_REASON_CHARS) {
      return res.status(400).json({ detail: `Reason must be ${MAX_ADMIN_REASON_CHARS} characters or fewer` });
    }

    if (liveChatQueue.has(sessionId)) {
      const existing = liveChatQueue.get(sessionId);
      return res.json({
        queued: true, position: existing.position, status: existing.status,
        message: existing.status === 'active' ? `You are now chatting with ${existing.admin_name}` : 'Your request is in queue. An admin will be with you shortly.'
      });
    }

    const session = chatSessions.get(sessionId);
    const chatHistory = session ? session.history : [];

    const liveChatRequest = {
      session_id: sessionId, user_id: userId, user_name: user?.name || 'Tenant', user_email: user?.email,
      reason: normalizedReason || 'Requested admin assistance', chat_history: chatHistory, messages: [],
      status: 'waiting', admin_id: null, admin_name: null, position: liveChatQueue.size + 1, created_at: new Date()
    };

    liveChatQueue.set(sessionId, liveChatRequest);
    await db.collection('live_chat_requests').insertOne(liveChatRequest);

    // Create a support ticket so the web admin dashboard sees it immediately.
    const ticketId = `ticket_esc_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    await db.collection('tickets').insertOne({
      ticket_id: ticketId,
      user_id: userId,
      subject: 'Admin Chat Request',
      message: normalizedReason || 'Tenant requested admin assistance via AI assistant.',
      category: 'Escalation',
      status: 'open',
      source: 'live_chat',
      session_id: sessionId,
      responses: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    res.json({ queued: true, session_id: sessionId, position: liveChatRequest.position, message: 'Your request has been submitted. An admin will be with you shortly.' });
  } catch (error) {
    console.error('Live chat request error:', error);
    res.status(500).json({ error: 'Failed to request admin chat' });
  }
}

// ─────────────────────────────────────────────────────
// Get live status
// ─────────────────────────────────────────────────────
async function getLiveStatus(req, res) {
  try {
    const { sessionId } = req.params;
    const normalizedSession = normalizeSessionId(sessionId, req.user.user_id);
    if (!normalizedSession.ok) {
      return res.status(400).json({ detail: normalizedSession.error });
    }
    const liveChat = liveChatQueue.get(normalizedSession.value);
    if (!liveChat) {
      return res.json({ active: false, in_queue: false });
    }
    res.json({ active: liveChat.status === 'active', in_queue: liveChat.status === 'waiting', position: liveChat.position, admin_name: liveChat.admin_name, messages: liveChat.messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
}

// ─────────────────────────────────────────────────────
// Get live chats (admin)
// ─────────────────────────────────────────────────────
async function getLiveChats(req, res) {
  try {
    const pendingChats = [];
    liveChatQueue.forEach((chat, sessionId) => {
      if (chat.status === 'waiting' || chat.status === 'active') {
        pendingChats.push({ session_id: sessionId, user_name: chat.user_name, reason: chat.reason, status: chat.status, created_at: chat.created_at });
      }
    });

    // In-memory queue is empty after a server restart — restore from MongoDB so
    // tenants who were already waiting don't disappear from the admin view.
    if (pendingChats.length === 0) {
      const db = getDb();
      const dbChats = await db.collection('live_chat_requests')
        .find({ status: { $in: ['waiting', 'active'] } })
        .sort({ created_at: -1 })
        .toArray();
      for (const chat of dbChats) {
        if (!liveChatQueue.has(chat.session_id)) {
          liveChatQueue.set(chat.session_id, chat);
        }
        pendingChats.push({
          session_id: chat.session_id,
          user_name: chat.user_name,
          reason: chat.reason,
          status: chat.status,
          created_at: chat.created_at,
        });
      }
    }

    res.json(pendingChats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get live chats' });
  }
}

// ─────────────────────────────────────────────────────
// Reset Gemini chat session
// ─────────────────────────────────────────────────────
async function resetSession(req, res) {
  try {
    const { session_id } = req.body;
    const sessionId = session_id || `${req.user?.user_id || 'guest'}_${Date.now()}`;

    chatSessions.delete(sessionId);

    const liveChat = liveChatQueue.get(sessionId);
    if (liveChat && liveChat.status !== 'active') {
      liveChatQueue.delete(sessionId);
    }

    return res.json({ reset: true, session_id: sessionId });
  } catch (error) {
    console.error('Reset chat session error:', error);
    return res.status(500).json({ error: 'Failed to reset chat session' });
  }
}

// ─────────────────────────────────────────────────────
// Accept live chat (admin)
// ─────────────────────────────────────────────────────
async function acceptLiveChat(req, res) {
  try {
    const { session_id } = req.body;
    const db = getDb();
    const adminUser = await db.collection('users').findOne({ user_id: req.user.user_id });
    const liveChat = liveChatQueue.get(session_id);
    if (!liveChat) return res.status(404).json({ error: 'Chat session not found' });
    if (liveChat.status === 'active') return res.status(400).json({ error: 'Chat already being handled', admin_name: liveChat.admin_name });

    liveChat.status = 'active';
    liveChat.admin_id = req.user.user_id;
    liveChat.admin_name = adminUser?.name || 'Admin';
    liveChat.messages.push({ sender: 'system', content: `${liveChat.admin_name} has joined the chat.`, timestamp: new Date() });

    await db.collection('live_chat_requests').updateOne({ session_id }, { $set: { status: 'active', admin_id: req.user.user_id, admin_name: liveChat.admin_name } });
    notifyAdminChatAccepted(liveChat.user_id, liveChat.admin_name, session_id).catch(() => {});
    res.json({ success: true, chat_history: liveChat.chat_history, user_name: liveChat.user_name, reason: liveChat.reason });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept chat' });
  }
}

// ─────────────────────────────────────────────────────
// Send admin message
// ─────────────────────────────────────────────────────
async function sendAdminMessage(req, res) {
  try {
    const { session_id, message } = req.body;
    const normalizedSession = normalizeSessionId(session_id, req.user.user_id);
    if (!normalizedSession.ok) return res.status(400).json({ detail: normalizedSession.error });
    const normalizedMessage = normalizeUserMessage(message);
    if (!normalizedMessage.ok) return res.status(400).json({ detail: normalizedMessage.error });
    const db = getDb();
    const adminUser = await db.collection('users').findOne({ user_id: req.user.user_id });

    const liveChat = liveChatQueue.get(normalizedSession.value);
    if (!liveChat || liveChat.status !== 'active') return res.status(404).json({ error: 'Active chat session not found' });

    liveChat.messages.push({ sender: 'admin', admin_name: adminUser?.name || 'Admin', content: normalizedMessage.value, timestamp: new Date() });
    notifyChatbotReply(liveChat.user_id, {
      adminName: adminUser?.name || 'Admin',
      message: normalizedMessage.value,
      sessionId: normalizedSession.value,
    }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
}

// ─────────────────────────────────────────────────────
// Close live chat
// ─────────────────────────────────────────────────────
async function closeLiveChat(req, res) {
  try {
    const { session_id } = req.body;
    const liveChat = liveChatQueue.get(session_id);
    if (liveChat) {
      const isOwner = liveChat.user_id === req.user.user_id;
      const role = (req.user?.role || '').toLowerCase();
      const isAdmin = role === 'admin' || role === 'superadmin';
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Only the session owner or an admin can close this chat' });
      }

      liveChat.status = 'closed';
      liveChat.messages.push({ sender: 'system', content: 'Chat session has been closed.', timestamp: new Date() });
      const db = getDb();
      const closedAt = new Date();
      await Promise.all([
        db.collection('live_chat_archive').insertOne({ ...liveChat, closed_at: closedAt }),
        // Mark as closed in source collection so stale 'waiting' records don't
        // reappear in admin view after a server restart.
        db.collection('live_chat_requests').updateOne(
          { session_id },
          { $set: { status: 'closed', closed_at: closedAt } }
        ),
      ]);
      setTimeout(() => liveChatQueue.delete(session_id), 5000);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close chat' });
  }
}

// ─────────────────────────────────────────────────────
// Get chat history
// ─────────────────────────────────────────────────────
async function getChatHistory(req, res) {
  try {
    const userId = req.user.user_id;
    const db = getDb();
    const [liveRequests, archived] = await Promise.all([
      db.collection('live_chat_requests').find({ user_id: userId }).sort({ created_at: -1 }).limit(50).toArray(),
      db.collection('live_chat_archive').find({ user_id: userId }).sort({ created_at: -1 }).limit(50).toArray(),
    ]);
    res.json({ escalations: liveRequests, archive: archived });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get history' });
  }
}

module.exports = {
  sendMessage,
  requestAdmin,
  getLiveStatus,
  getLiveChats,
  resetSession,
  acceptLiveChat,
  sendAdminMessage,
  closeLiveChat,
  getChatHistory
};
