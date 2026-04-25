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
} = require('../services/gemini.service');
const {
  notifyAdminChatAccepted,
  notifyChatbotReply,
} = require('../services/pushService');

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

    // Pull tenant context for grounded responses
    const db = getDb();
    const [announcements, pendingBills, openTickets] = await Promise.all([
      db.collection('announcements').find({ is_active: true }).sort({ created_at: -1 }).limit(3).toArray(),
      db.collection('billing').find({ user_id: userId, status: { $ne: 'paid' } }).sort({ due_date: -1 }).limit(3).toArray(),
      db.collection('tickets').find({ user_id: userId, status: { $ne: 'closed' } }).sort({ created_at: -1 }).limit(3).toArray(),
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

    if (pendingBills.length > 0) {
      const billsSummary = pendingBills.map((b) => {
        const amount = typeof b.amount === 'number' ? b.amount.toFixed(2) : b.amount;
        return `- ${b.description || b.billing_type || 'Bill'}: ₱${amount}, due ${new Date(b.due_date).toLocaleDateString('en-PH')}`;
      }).join('\n');
      contextLines.push(`Pending bills:\n${billsSummary}`);
    } else {
      contextLines.push('Pending bills: none');
    }

    if (openTickets.length > 0) {
      const ticketSummary = openTickets.map((t) => `- ${t.subject || 'Issue'} (${t.status}) — ${t.category || 'General'}`).join('\n');
      contextLines.push(`Open tickets:\n${ticketSummary}`);
    } else {
      contextLines.push('Open tickets: none');
    }

    if (announcements.length > 0) {
      const annSummary = announcements.map((a) => `- ${a.title || 'Announcement'}: ${a.content ? a.content.slice(0, 120) : ''}`).join('\n');
      contextLines.push(`Recent announcements:\n${annSummary}`);
    }

    // Find relevant knowledge entries (context hints for the AI)
    const knowledgeHints = findRelevantKnowledge(userMessage);
    const meta = { intent: 'general', confidence: null };
    let followups = [];
    let aiResponse = '';
    let needsAdmin = false;

    // Classify intent (for follow-up suggestions, not for response routing)
    try {
      const intentResult = await classifyIntent(userMessage);
      meta.intent = intentResult.intent || 'general';
      meta.confidence = intentResult.confidence ?? null;
      // If intent classification found a relevant knowledge entry, include it
      const intentKnowledge = findKnowledgeByIntent(intentResult.intent);
      if (intentKnowledge && !knowledgeHints.includes(intentKnowledge)) {
        knowledgeHints.push(intentKnowledge);
      }
    } catch (intentErr) {
      console.warn('Intent classify failed:', intentErr?.message);
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
      console.error('Chatbot AI error:', modelError);
      // Minimal fallback — no canned policy dump
      aiResponse = "I'm having a bit of trouble right now po. Please try again in a moment, or you can reach the admin office directly at +63 912 345 6789.";
    }

    // Clean the response
    const responseText = typeof aiResponse === 'string' ? aiResponse : String(aiResponse ?? '');
    let cleanResponse = sanitizeResponse(responseText.replace('[NEEDS_ADMIN]', '').trim())
      || "I'm here to help po. Could you tell me more about what you need?";

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
      response: cleanResponse,
      session_id: sessionId,
      needs_admin: needsAdmin,
      live_chat_active: false,
      fallback: false,
      suggestions: followups,
      meta,
    });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({
      response: "I'm having trouble connecting right now po. Please try again, or contact the admin office at +63 912 345 6789.",
      detail: error.message,
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
      await db.collection('live_chat_archive').insertOne({ ...liveChat, closed_at: new Date() });
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
