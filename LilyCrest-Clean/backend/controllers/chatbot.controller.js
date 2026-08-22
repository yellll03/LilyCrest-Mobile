const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const { ensureTenantSupportConversation } = require('./chat.controller');
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
  chatSessions,
  isQuotaError,
} = require('../services/gemini.service');

const GEMINI_QUOTA_FALLBACK = 'Lily Assistant is temporarily unavailable due to high demand. You may try again later or contact admin for urgent concerns.';
const { fetchUserBills, resolveCurrentBill, currentBillTiming, billStatusLabel } = require('./billing.controller');
const { normalizeUser } = require('../utils/normalizeUser');
const { loadAttachmentParts } = require('../services/assistantAttachment.service');
const { resolveTenantBranch } = require('../services/branchLocation.service');
const { fetchCurrentContractForRequest, fetchContractDocumentForRequest } = require('../routes/contracts.routes');
const { loadRequestsAcrossCollections, buildUserMaintenanceFilter, buildTenantRequestResponse: buildMaintenanceTenantResponse } = require('./maintenance.controller');
const { buildTenantAnnouncementQuery, isAnnouncementVisibleForBranch, resolveRequesterBranchCode } = require('./announcement.controller');
const { extractContractDocumentText, findRelevantContractExcerpts } = require('../domain/contracts/contractDocumentQA');

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
const SUPPORTED_INTENTS = {
  BILLING: 'billing',
  MAINTENANCE: 'maintenance',
  ADMIN_SUPPORT: 'admin_support',
  PROFILE: 'profile',
  BRANCH: 'branch',
  CONTRACT: 'contract',
  DOCUMENTS: 'documents',
  GENERAL: 'general',
};
const ADMIN_ESCALATION_PATTERNS = [
  /\b(connect|contact|notify|message|ask|talk|speak|escalate|report)\s+(me\s+to\s+)?(to\s+)?(the\s+|an\s+)?(admin|branch admin|owner|staff|real person|human)\b/i,
  /\b(i\s+want|i\s+need|i'd\s+like|can\s+i|could\s+i|please)\s+(to\s+)?(talk|speak|chat|message|contact)\s+(to\s+|with\s+)?(the\s+|an\s+)?(admin|branch admin|owner|staff)\b/i,
  /\b(help|assistance)\s+from\s+(the\s+)?(admin|branch admin|owner|staff)\b/i,
  /\b(can someone assist|someone assist|human help|real person|human agent|talk to a person)\b/i,
  /\b(kausapin|ipaalam|sabihin|i-report|ireport)\s+(mo\s+)?(sa\s+)?(admin|branch admin|owner)\b/i,
  /\b(already paid|paid already|bayad na|nagbayad).{0,80}\b(report|notify|admin|pending|not reflected|not updated)\b/i,
];
const COURTESY_PATTERNS = [
  /^(thanks|thank you|thankyou|salamat|ok(?:ay)?|noted|got it|sige|bye|goodbye|see you|ingat)\b/i,
];
const FOLLOW_UP_PATTERNS = [
  /^(what about|how about|what if|what happens|how long|when|then|also|and\b|so\b|can i\b|is that\b|does that\b|will that\b|overnight\b|pwede\b)/i,
];
const DORM_SCOPE_PATTERNS = [
  /\blilycrest\b/i,
  /\bdorm(?:itory)?\b/i,
  /\btenant (?:app|application|account|profile)\b/i,
  /\b(my|assigned)\s+(branch|location|address)\b/i,
  /\b(where|saan|paano).{0,35}\b(lilycrest|branch|dorm)\b/i,
  /\badmin (?:office|support)\b/i,
  /\bannouncements?\b/i,
  /\b(my|latest|current|unpaid)\s+(bill|billing|balance|payment|payments)\b/i,
  /\bhow much do i owe\b/i,
  /\bhow much do i need to pay\b/i,
  /\b(total due|electricity bill|penalt(?:y|ies)|already paid|babayaran ko)\b/i,
  /\b(magkano|how much)\s+(ang\s+)?(balance|bill|bayarin|rent)\b/i,
  /\b(may\s+)?(unpaid|unsettled|pending)\s+(bills?|balance|bayarin)\b/i,
  /\b(kailan|when).{0,40}\b(due date|due|rent|bayad|bayarin)\b/i,
  /\b(show|check)\s+my\s+(bill|billing|balance|payments?)\b/i,
  /^(how can i pay|how do i pay|where do i pay|payment methods?)\??$/i,
  /\b(due date|late fee|rent|proof of payment|billing history|paymongo)\b/i,
  /\b(already paid|paid already|nagbayad|bayad na|payment proof|proof of payment)\b/i,
  /\bmaintenance\b/i,
  /\b(service|repair)\s+request\b/i,
  /\b(status ng maintenance|maintenance status|repair status|request status|admin reply|may reply|reply sa repair|repair request)\b/i,
  /\b(water leak|plumbing|electrical|no power|no water|flood(?:ing)?|gas smell)\b/i,
  /\b(my\s+)?(room|bathroom|toilet|sink|shower|faucet|door|window|light|aircon|ceiling)\s+(is\s+)?(broken|damaged|not working)\b/i,
  /\b(issue|problem)\s+(in|with)\s+my\s+(room|bathroom|toilet|sink|shower|door|window|light|aircon)\b/i,
  /\b(connect|contact|notify|message|ask|talk|speak|escalate|report)\s+(me\s+to\s+)?(to\s+)?(the\s+|an\s+)?(admin|branch admin|owner|staff|real person|human)\b/i,
  /\b(can someone assist|someone assist|admin help|human help|real person|branch admin|owner)\b/i,
  /\b(kausapin|ipaalam|sabihin|i-report|ireport)\s+(mo\s+)?(sa\s+)?(admin|branch admin|owner)\b/i,
  /\b(complaint|complain|report|reklamo|maingay|noisy neighbor|noise complaint|violation|harassment|unsafe)\b/i,
  /\b(payment history|billing history|saan.*makikita|where.*see|app feature|how do i use)\b/i,
  /\b(house rules?|visitor policy|visitors?|guests?|curfew|quiet hours|gate)\b/i,
  /\b(lease|contract|documents?|pdf|passport|student id|company id|government id|valid id)\b/i,
  /\b(move in|move-in|move out|move-out|security deposit)\b/i,
  /\b(full name|legal name|account name)\b/i,
  /\bwhat(?:'s| is)\s+my\s+(full\s+)?name\b/i,
  /\b(change|update|edit)\s+(my\s+)?name\b/i,
  /\b(change|update|edit)\s+(my\s+)?full\s+name\b/i,
  /\b(change|update|edit|reset|forgot)\s+(my\s+)?(password|email|phone|username|profile)\b/i,
  /\b(login|log in|sign in|otp|username|profile picture|email address|phone number)\b/i,
  /\b(amenities|wifi|laundry|kitchen|study lounge|rooftop|parking|cctv|security guard|emergency hotline|hospital)\b/i,
  /\b(room type|room rate|premium room|deluxe room|standard room|bed space|bedspace)\b/i,
  /\b(support ticket|live chat|lily assistant)\b/i,
];
const OUT_OF_SCOPE_PATTERNS = [
  /\b(weather|temperature|forecast)\b/i,
  /\b(nba|basketball|football|soccer|baseball|tennis)\b/i,
  /\b(bitcoin|crypto|stock market|stocks|forex)\b/i,
  /\b(movie|movies|tv show|series|anime|celebrity|song|music|album|band)\b/i,
  /\b(recipe|cook|cooking|restaurant|ulam|masarap ulamin|food suggestion|ano masarap)\b/i,
  /\b(code|coding|programming|javascript|python|java|react)\b/i,
  /\b(homework|assignment|exam|essay|thesis)\b/i,
  /\b(politics|president|senator|election)\b/i,
  /\b(travel itinerary|flight|hotel|vacation)\b/i,
  /\b(joke|poem|horoscope|zodiac|love advice)\b/i,
  /\b(capital of|translate|meaning of life)\b/i,
  /^\s*\d+\s*[+\-*/]\s*\d+\s*\??\s*$/i,
];
const OUT_OF_SCOPE_RESPONSE = 'I can only help with LilyCrest dormitory and tenant app concerns, such as billing, maintenance, announcements, documents, house rules, room details, facilities, and account support.';

function asObjectId(value) {
  if (!value) return null;
  try {
    const candidate = typeof value?.toHexString === 'function'
      ? value.toHexString()
      : String(value);
    if (ObjectId.isValid(candidate)) {
      return new ObjectId(candidate);
    }
  } catch (_error) {
    return null;
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

function isCourtesyMessage(message = '') {
  return COURTESY_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function isAdminEscalationRequest(message = '') {
  return ADMIN_ESCALATION_PATTERNS.some((pattern) => pattern.test(String(message || '').trim()));
}

function requestsOtherTenantInformation(message = '') {
  return /\b(another|other|someone else|ibang|isa pang)\s+(tenant|resident|boarder|nangungupahan)\b/i.test(message)
    || /\b(tenant|resident|boarder)\s+(niya|nila|ng iba)\b/i.test(message);
}

function hasDormitoryScopeSignal(message = '') {
  return isAdminEscalationRequest(message) || DORM_SCOPE_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function hasHighSignalOutOfScopeTopic(message = '') {
  return OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function isDormitoryFollowUp(message = '', session = {}) {
  if (!Array.isArray(session?.history) || session.history.length === 0) return false;
  const trimmed = message.trim();
  if (!trimmed || trimmed.split(/\s+/).length > 10) return false;
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// Default posture: attempt to answer via the AI + tenant context. Only
// refuse when there is a genuine out-of-scope signal (a known unrelated
// topic like math trivia, weather, celebrity gossip) AND no countervailing
// dormitory-scope signal exists. A message that simply doesn't match any of
// the narrow regex-routed system-response paths below (billing/maintenance/
// etc.) is NOT, by itself, a reason to refuse — that only means none of the
// hand-built shortcuts applies, not that the question is unrelated to
// LilyCrest. This is the single scope decision point for the whole request;
// there must not be a second one later that re-derives "no signal matched"
// as a refusal reason.
function shouldRefuseAsOutOfScope(message, session) {
  if (isAdminEscalationRequest(message)) return false;
  if (hasDormitoryScopeSignal(message)) return false;
  if (isDormitoryFollowUp(message, session)) return false;
  if (!hasHighSignalOutOfScopeTopic(message)) return false;
  return true;
}

function replyWithScopeGuard(res, sessionId, session, userMessage) {
  const cleanResponse = OUT_OF_SCOPE_RESPONSE;
  session.history = Array.isArray(session.history) ? session.history : [];
  session.history.push({ role: 'user', content: userMessage });
  session.history.push({ role: 'assistant', content: cleanResponse });
  if (session.history.length > 30) {
    session.history = session.history.slice(-30);
  }
  session.last_intent = SUPPORTED_INTENTS.GENERAL;
  chatSessions.set(sessionId, session);

  return res.json({
    message: cleanResponse,
    response: cleanResponse,
    intent: SUPPORTED_INTENTS.GENERAL,
    session_id: sessionId,
    needs_admin: false,
    live_chat_active: false,
    fallback: false,
    suggestions: DEFAULT_FOLLOWUPS,
    meta: { intent: SUPPORTED_INTENTS.GENERAL, confidence: 1, source: 'scope_guard' },
  });
}

// Distinguishes "what does my contract say about X" (needs the actual
// document text) from generic contract-status questions ("is my contract
// available", "when does it expire") which buildContractResponse already
// answers from structured fields without opening the document.
function asksAboutContractDocumentContent(message = '') {
  const lower = String(message || '').toLowerCase();
  const mentionsContract = /\b(contract|lease)\b/.test(lower);
  if (!mentionsContract) return false;
  if (/\b(say|says|said|state|states|stated|clause|provision|allow|allowed|policy|term|terms|condition|conditions|according to)\b/.test(lower)) return true;
  return /\b(visitor|termination|terminate|curfew|deposit refund)\s+(in|on)\s+my\s+(contract|lease)\b/.test(lower);
}

function detectSystemIntent(message = '') {
  const lower = String(message || '').toLowerCase();
  if (/\b(branch|location|address|directions?|map|maps|where is|saan|paano pumunta)\b/.test(lower)
      && /\b(my|lilycrest|dorm|branch|assigned|ko)\b/.test(lower)) {
    return SUPPORTED_INTENTS.BRANCH;
  }
  if (isAdminEscalationRequest(message) || /\b(complaint|complain|reklamo|noisy neighbor|maingay|unsafe|harassment)\b/.test(lower)) {
    return SUPPORTED_INTENTS.ADMIN_SUPPORT;
  }
  if (/\b(bills?|billing|balance|unpaid|bayarin|bayad|babayaran|due|due date|overdue|pay|payment|payments?|owe|rent|charges?|penalt(?:y|ies)|electricity|magkano|paid already|already paid)\b/.test(lower)) {
    return SUPPORTED_INTENTS.BILLING;
  }
  if (/\b(contract|lease)\b/.test(lower)) {
    return SUPPORTED_INTENTS.CONTRACT;
  }
  if (/\b(documents?|pdf|valid id|government id|company id|nbi clearance)\b/.test(lower)) {
    return SUPPORTED_INTENTS.DOCUMENTS;
  }
  if (/\b(maintenance|repair|sira|fix|service request|repair request|maintenance request|admin reply|may reply|status ng maintenance|repair status|request status)\b/.test(lower)) {
    return SUPPORTED_INTENTS.MAINTENANCE;
  }
  if (
    /\b(account|profile|info|details)\b/.test(lower)
    || /\b(full name|legal name|account name)\b/.test(lower)
    || /\bwhat(?:'s| is)\s+my\s+(full\s+)?name\b/.test(lower)
    || /\b(change|update|edit)\s+(my\s+)?name\b/.test(lower)
  ) {
    return SUPPORTED_INTENTS.PROFILE;
  }
  return SUPPORTED_INTENTS.GENERAL;
}

function detectLanguageStyle(message = '') {
  const text = String(message).toLowerCase();
  const filipino = /\b(ako|ko|mo|akin|magkano|kailan|bayad|bayarin|wala|may|ang|ng|ba|paano|saan|rent ko|babayaran)\b/.test(text);
  const english = /\b(how|what|when|where|my|this|month|bill|rent|due|payment|please|have)\b/.test(text);
  return filipino && english ? 'taglish' : filipino ? 'tagalog' : 'english';
}

function normalizeAssistantIntent(intent = '') {
  const lower = String(intent || '').toLowerCase();
  if (lower.includes('admin') || lower.includes('escalation') || lower.includes('support') || lower.includes('complaint')) {
    return SUPPORTED_INTENTS.ADMIN_SUPPORT;
  }
  if (lower.includes('billing') || lower.includes('payment') || lower.includes('bill')) {
    return SUPPORTED_INTENTS.BILLING;
  }
  if (
    lower.includes('maintenance')
    || lower.includes('repair')
    || lower.includes('service_request')
    || lower.includes('maintenance_status')
    || lower.includes('repair_status')
    || lower.includes('request_status')
  ) {
    return SUPPORTED_INTENTS.MAINTENANCE;
  }
  if (lower.includes('profile') || lower.includes('account')) {
    return SUPPORTED_INTENTS.PROFILE;
  }
  if (lower.includes('branch') || lower.includes('location') || lower.includes('directions')) {
    return SUPPORTED_INTENTS.BRANCH;
  }
  if (lower.includes('contract') || lower.includes('lease')) {
    return SUPPORTED_INTENTS.CONTRACT;
  }
  if (lower.includes('document') || lower.includes('pdf')) {
    return SUPPORTED_INTENTS.DOCUMENTS;
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

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function displayName(user = {}, fallback = 'Tenant') {
  return firstNonEmptyString(
    user.name,
    user.fullName,
    [user.firstName, user.lastName].filter(Boolean).join(' '),
    user.email,
    user.user_id,
    fallback
  );
}

function formatStatusLabel(value = '') {
  const normalized = String(value || '').replace(/_/g, ' ').trim();
  return normalized || 'unknown';
}

function dateTimeValue(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// Billing statuses get the same tenant-friendly wording as billing history,
// bill details, and the downloadable bill PDF (billing.controller.js
// billStatusLabel) instead of the generic formatStatusLabel() used for
// maintenance/lease statuses, which just underscores-to-spaces a raw keyword.
function formatBillStatus(bill = {}) {
  return billStatusLabel(bill.status || bill.payment_status || bill.paymentStatus);
}

function summarizeBillForContext(bill = {}) {
  const amount = formatPesoCompact(getBillAmountValue(bill));
  const type = normalizeBillTypeLabel(bill);
  const status = formatBillStatus(bill);
  const dueDate = formatShortDate(bill.due_date || bill.dueDate);
  return `${type}: ${amount}, ${status}${dueDate ? `, due ${dueDate}` : ''}`;
}

// Formats maintenance.controller.js's canonical `latestTenantVisibleUpdate`
// shape ({ senderName, senderRole, preview, hasAttachments, attachmentCount,
// created_at }) instead of re-deriving thread visibility rules locally.
function summarizeMaintenanceUpdate(update) {
  if (!update) return '';
  const role = String(update.senderRole || '').toLowerCase();
  const sender = update.senderName
    || (role === 'owner' ? 'Owner' : role === 'branch_admin' ? 'Branch Admin' : role === 'tenant' ? 'You' : 'Admin');
  const sentAt = formatShortDate(update.created_at);
  const attachments = Number(update.attachmentCount) || 0;
  const content = update.preview || (attachments ? `${attachments} attachment${attachments > 1 ? 's' : ''}` : 'an update');
  return `${sender}${sentAt ? ` on ${sentAt}` : ''}: ${content}${attachments ? ` (${attachments} attachment${attachments > 1 ? 's' : ''})` : ''}`;
}

// The latest tenant-visible update may itself be the tenant's own message
// (e.g. the tenant just sent a follow-up and no one has replied since) —
// only treat it as an admin reply when the sender isn't the tenant.
function latestAdminUpdateFrom(maintenanceResponse) {
  const update = maintenanceResponse?.latestTenantVisibleUpdate;
  if (!update || String(update.senderRole || '').toLowerCase() === 'tenant') return null;
  return update;
}

function summarizeMaintenanceForContext(request = {}) {
  const response = buildMaintenanceTenantResponse(request);
  const title = firstNonEmptyString(response.request_type, 'maintenance request').replace(/_/g, ' ');
  const status = formatStatusLabel(response.status || 'pending');
  const submitted = formatShortDate(response.created_at);
  const latestUpdate = latestAdminUpdateFrom(response);
  return `${title}: ${status}${submitted ? `, submitted ${submitted}` : ''}${latestUpdate ? `, latest tenant-visible update - ${summarizeMaintenanceUpdate(latestUpdate)}` : ''}`;
}

// Branch/room/occupancy resolution only. Contract/lease fields (dates, rent,
// deposit, document availability) come exclusively from
// resolveCanonicalContractContext() below, which calls the same
// CONTRACT_UPSTREAM_URL bridge the mobile Contract screen uses — never from
// this local reservations/bedhistories derivation, which is a different,
// unauthoritative data path for lease terms.
async function resolveTenantAccountContext(db, user = {}) {
  const userObjectId = asObjectId(user._id);
  const userId = user.user_id;
  const context = {
    tenantName: displayName(user),
    tenantId: firstNonEmptyString(userId, user._id ? String(user._id) : ''),
    role: firstNonEmptyString(user.role, 'tenant'),
    branch: '',
    branchLocation: null,
    branchResolutionError: null,
    roomNumber: '',
    roomBed: '',
    occupancyStatus: '',
    leaseStatus: '',
  };
  try {
    const resolvedBranch = await resolveTenantBranch(db, user);
    context.branchLocation = resolvedBranch.branch;
    context.branch = resolvedBranch.branch.branchName;
  } catch (error) {
    context.branchResolutionError = error?.code || 'BRANCH_NOT_ASSIGNED';
  }

  const reservationOr = [
    ...(userObjectId ? [{ userId: userObjectId }, { tenantId: userObjectId }] : []),
    ...(userId ? [{ user_id: userId }, { tenantUserId: userId }] : []),
  ];

  if (reservationOr.length) {
    const reservation = await db.collection('reservations').findOne(
      { $or: reservationOr },
      { sort: { updatedAt: -1, createdAt: -1 } }
    ).catch(() => null);

    if (reservation) {
      context.occupancyStatus = firstNonEmptyString(reservation.status, reservation.occupancyStatus);
      context.leaseStatus = firstNonEmptyString(reservation.leaseStatus, reservation.contractStatus);
      context.roomNumber = firstNonEmptyString(reservation.roomNumber, reservation.roomName, reservation.room?.roomNumber);
      context.roomBed = firstNonEmptyString(
        reservation.selectedBed?.position,
        reservation.selectedBed?.label,
        reservation.selectedBed?.id,
        reservation.bedNumber,
        reservation.bedId
      );

      const roomId = reservation.roomId || reservation.room_id;
      if (roomId && !context.roomNumber) {
        const room = await db.collection('rooms').findOne({ _id: asObjectId(roomId) || roomId }).catch(() => null);
        context.roomNumber = firstNonEmptyString(room?.roomNumber, room?.name);
      }
    }
  }

  if (userObjectId && (!context.roomNumber || !context.roomBed || !context.branch)) {
    const bedHistory = await db.collection('bedhistories').findOne(
      { userId: userObjectId },
      { sort: { moveInDate: -1, createdAt: -1 } }
    ).catch(() => null);

    if (bedHistory) {
      context.occupancyStatus = context.occupancyStatus || firstNonEmptyString(bedHistory.status, 'active');
      context.roomBed = context.roomBed || firstNonEmptyString(bedHistory.bedPosition, bedHistory.bedLabel, bedHistory.bedId);
      const room = bedHistory.roomId
        ? await db.collection('rooms').findOne({ _id: asObjectId(bedHistory.roomId) || bedHistory.roomId }).catch(() => null)
        : null;
      context.roomNumber = context.roomNumber || firstNonEmptyString(room?.roomNumber, room?.name);
    }
  }

  return context;
}

// The authoritative source for a tenant's contract/lease is the external
// Capstone-Website service, reached through the same server-to-server bridge
// (routes/contracts.routes.js) the mobile Contract screen uses — never a
// locally-derived guess. This always forwards the real request's bearer
// token (via fetchCurrentContractForRequest -> forwardAuthHeader), so the
// contract returned can only ever belong to the authenticated caller.
// Mirrors the exact status-code classification the mobile Contract screen's
// own canonical hook uses (frontend/src/hooks/useTenantContract.js): 409 is
// an unresolved multiple-canonical-contracts data conflict (never guess —
// tell the tenant to contact support), 401/403 means the session couldn't be
// verified upstream, anything else failing (404/5xx/502/504/timeout/
// misconfigured CONTRACT_UPSTREAM_URL) is a transient/unavailable bridge
// failure. A successful response with no contract is the ordinary, expected
// "no contract yet" case. These must stay distinct — collapsing them into
// one message would tell a tenant "you have no contract" when the real
// problem is a data conflict or an outage, which is misleading.
function classifyContractUnavailability(result) {
  if (result.ok) return 'not_found';
  if (result.status === 409) return 'conflict';
  if (result.status === 401 || result.status === 403) return 'unauthorized';
  return 'unavailable';
}

async function resolveCanonicalContractContext(req) {
  const result = await fetchCurrentContractForRequest(req);
  if (!result.ok || !result.data?.contract) {
    return {
      available: false,
      contract: null,
      contractId: null,
      errorKind: classifyContractUnavailability(result),
      reason: result.detail || 'not_available',
    };
  }
  const contract = result.data.contract;
  const advanceRent = Number(contract.advanceRentAmount) || 0;
  const securityDeposit = Number(contract.securityDepositAmount) || 0;
  const reservationFee = Number(contract.reservationFeeAmount) || 0;
  const totalDueBeforeMoveIn = advanceRent + securityDeposit;
  const moveInFinancials = (advanceRent || securityDeposit || reservationFee)
    ? {
        advanceRent,
        securityDeposit,
        totalDueBeforeMoveIn,
        reservationFeeAlreadyPaid: reservationFee,
        remainingBalance: Math.max(totalDueBeforeMoveIn - reservationFee, 0),
      }
    : null;
  return {
    available: true,
    contract,
    contractId: contract.id || null,
    displayStatus: contract.displayStatus || null,
    contractStart: contract.leaseStartDate || null,
    contractEnd: contract.leaseEndDate || null,
    leaseType: contract.leaseType || null,
    monthlyRent: Number.isFinite(Number(contract.approvedMonthlyRate)) ? Number(contract.approvedMonthlyRate) : null,
    securityDeposit: Number.isFinite(securityDeposit) ? securityDeposit : null,
    moveInFinancials,
    documentAvailable: Boolean(contract.tenantDocument?.available),
    documentKind: contract.tenantDocument?.type === 'final_notarized'
      ? 'final'
      : contract.tenantDocument?.type === 'generated_draft'
        ? 'prepared'
        : null,
  };
}

// Thin wrapper around maintenance.controller.js's own tenant-owned lookup —
// intentionally reuses the exact filter/collection logic the tenant-facing
// GET /maintenance/me endpoint uses, rather than a second, divergent
// implementation of "which maintenance records belong to this user."
async function fetchMaintenanceRequestsForUser(db, user = {}) {
  const filter = buildUserMaintenanceFilter(user);
  if (!filter.$or.length) return [];
  return loadRequestsAcrossCollections(db, filter);
}

async function buildBillingResponse(db, user, message = '') {
  const bills = await fetchUserBills(db, user, { limit: 20 });
  const language = detectLanguageStyle(message);
  const currentBill = resolveCurrentBill(bills, new Date());

  if (!currentBill) {
    return {
      message: language === 'tagalog'
        ? 'Wala pa akong makitang billing record sa account mo. Maaaring hindi pa nagagawa ang bill mo ngayong buwan.'
        : language === 'taglish'
          ? "Wala pa akong makitang bill sa account mo for this month."
          : "Your bill for this month hasn't been generated yet.",
      intent: SUPPORTED_INTENTS.BILLING,
      suggestions: [
        { label: 'Contact admin', prompt: 'Can you ask admin about my bill?' },
        { label: 'Payment history', prompt: 'Where can I see my payment history?' },
      ],
    };
  }

  const lowerMessage = String(message || '').toLowerCase();
  const requestedUtilities = [
    /\b(electricity|electric|meralco|kuryente)\b/.test(lowerMessage) ? 'electricity' : null,
    /\b(water|tubig)\b/.test(lowerMessage) ? 'water' : null,
  ].filter(Boolean);
  if (requestedUtilities.length) {
    const schedules = requestedUtilities
      .map((utility) => ({ utility, deadline: currentBill.utility_deadlines?.[utility] }))
      .filter(({ deadline }) => deadline?.billReleaseDate && deadline?.finalDueDate);
    if (!schedules.length) {
      return {
        message: 'Your utility bill has not been released yet.',
        intent: SUPPORTED_INTENTS.BILLING,
        suggestions: [{ label: 'Open billing', prompt: 'Where can I see my bill details?' }],
      };
    }
    const first = schedules[0].deadline;
    const labels = schedules.map(({ utility }) => utility).join(' and ');
    return {
      message: `Your ${labels} bill was released on ${formatShortDate(first.billReleaseDate)} and is due on ${formatShortDate(first.finalDueDate)}.`,
      intent: SUPPORTED_INTENTS.BILLING,
      suggestions: [{ label: 'Open billing', prompt: 'Where can I see my bill details?' }],
    };
  }

  const currentAmount = getBillAmountValue(currentBill);
  const currentDueDate = formatShortDate(currentBill.due_date || currentBill.dueDate);
  const timing = currentBillTiming(currentBill, new Date());
  const penalty = Number(currentBill.penalties || 0);
  const penaltyText = penalty > 0 ? ` Late penalty: ${formatPesoCompact(penalty)}.` : ' No late penalty.';
  const statusText = formatBillStatus(currentBill);
  return {
    message: language === 'tagalog'
      ? `Ang bill mo ngayong buwan ay ${formatPesoCompact(currentAmount)}${currentDueDate ? `, due sa ${currentDueDate}` : ''}. Status: ${statusText}. ${timing.label}.${penaltyText}`
      : language === 'taglish'
        ? `Your bill this month is ${formatPesoCompact(currentAmount)}${currentDueDate ? `, due on ${currentDueDate}` : ''}. Status: ${statusText}. ${timing.label}.${penaltyText}`
        : `Your bill for this month is ${formatPesoCompact(currentAmount)}${currentDueDate ? `, due on ${currentDueDate}` : ''}. Status: ${statusText}. ${timing.label}.${penaltyText}`,
    intent: SUPPORTED_INTENTS.BILLING,
    suggestions: [
      { label: 'Open billing', prompt: 'Where can I see my bill details?' },
      { label: 'Payment methods', prompt: 'How can I pay my bill?' },
    ],
  };

  /*
  if (!unpaidBills.length) {
    const latestBill = [...bills].sort((left, right) => (
      dateTimeValue(right.due_date || right.dueDate || right.created_at || right.createdAt)
      - dateTimeValue(left.due_date || left.dueDate || left.created_at || left.createdAt)
    ))[0];
    const latestText = latestBill ? ` Your latest posted ${summarizeBillForContext(latestBill)}.` : '';
    return {
      message: language === 'tagalog'
        ? `Wala akong makitang hindi pa bayad na bill sa account mo.${latestText}`
        : language === 'taglish'
          ? `Wala akong makitang unpaid bill sa account mo ngayon.${latestText}`
          : `I don't see any unpaid bills on your account right now.${latestText}`,
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
  const nextAmount = formatPesoCompact(getBillAmountValue(nextDueBill));
  const billCount = unpaidBills.length;
  const countText = billCount === 1 ? '1 unpaid bill' : `${billCount} unpaid bills`;

  return {
    message: language === 'tagalog'
      ? `May ${billCount === 1 ? 'isang' : billCount} hindi pa bayad na bill ka na may kabuuang ${formatPesoCompact(totalOutstanding)}. Ang susunod ay ${billType} na ${nextAmount}${dueDate ? ` at kailangang bayaran sa ${dueDate}` : ''}.`
      : language === 'taglish'
        ? `May ${countText} ka totaling ${formatPesoCompact(totalOutstanding)}. Ang next bill ay ${billType} na ${nextAmount}${dueDate ? `, due on ${dueDate}` : ''}.`
        : `You currently have ${countText} totaling ${formatPesoCompact(totalOutstanding)}. The next one I can see is ${billType} for ${nextAmount}${dueText}, marked ${formatBillStatus(nextDueBill)}.`,
    intent: SUPPORTED_INTENTS.BILLING,
    suggestions: [
      { label: 'Latest bill', prompt: 'Show my latest billing summary.' },
      { label: 'Payment methods', prompt: 'How can I pay my bill?' },
    ],
  };
  */
}

async function buildMaintenanceResponse(db, user, message = '') {
  const requests = await fetchMaintenanceRequestsForUser(db, user);
  const activeStatuses = new Set(['pending', 'viewed', 'in_progress', 'assigned', 'scheduled', 'open']);
  const activeRequests = requests.filter((request) => activeStatuses.has(requestStatusValue(request)));
  const latestRequest = activeRequests[0] || requests[0];
  const asksAboutReply = /\b(reply|replied|admin reply|may reply|sagot|update)\b/i.test(message);

  if (!latestRequest) {
    return {
      message: 'I cannot see any maintenance requests on your account right now. If you need a repair, you can file one in Services, or I can help connect you to admin.',
      intent: SUPPORTED_INTENTS.MAINTENANCE,
      suggestions: [
        { label: 'Report an issue', prompt: 'I need help with a maintenance issue.' },
        { label: 'Talk to admin', prompt: 'Connect me to the admin.' },
      ],
    };
  }

  const requestType = String(latestRequest.request_type || latestRequest.title || 'maintenance issue')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  const status = requestStatusValue(latestRequest).replace(/_/g, ' ');
  const submittedDate = formatShortDate(latestRequest.created_at || latestRequest.createdAt);
  const dateText = submittedDate ? ` It was submitted on ${submittedDate}.` : '';
  const latestAdminReply = latestAdminUpdateFrom(buildMaintenanceTenantResponse(latestRequest));

  if (asksAboutReply) {
    const replyText = latestAdminReply
      ? `Yes. The latest tenant-visible admin update I can see is: ${summarizeMaintenanceUpdate(latestAdminReply)}. You can open the request in Services to view the full reply and attachments.`
      : "I don't see a tenant-visible admin reply on your latest maintenance request yet. You can still open Services to check the request details, or I can notify admin if you need a follow-up.";
    return {
      message: replyText,
      intent: SUPPORTED_INTENTS.MAINTENANCE,
      suggestions: [
        { label: 'Notify admin', prompt: 'Can you notify admin about my repair request?' },
        { label: 'Create request', prompt: 'I need to report a new maintenance issue.' },
      ],
    };
  }

  const adminUpdateText = latestAdminReply ? ` Latest admin update: ${summarizeMaintenanceUpdate(latestAdminReply)}.` : '';
  const activeText = activeRequests.length ? 'still ' : '';

  return {
    message: `Your latest maintenance request for ${requestType} is ${activeText}${status}.${dateText}${adminUpdateText}`.replace('..', '.'),
    intent: SUPPORTED_INTENTS.MAINTENANCE,
    suggestions: [
      { label: 'Latest request', prompt: 'Show my latest maintenance request.' },
      { label: 'Create request', prompt: 'I need to report a new maintenance issue.' },
    ],
  };
}

function buildProfileResponse(user = {}, accountContext = {}) {
  const name = user.name || 'your account';
  const email = user.email || 'no email on file';
  const roomText = accountContext.roomNumber
    ? ` Room: ${accountContext.roomNumber}${accountContext.roomBed ? `, bed ${accountContext.roomBed}` : ''}.`
    : '';
  const branchText = accountContext.branch ? ` Branch: ${accountContext.branch}.` : '';
  const leaseText = accountContext.leaseStatus || accountContext.occupancyStatus
    ? ` Status: ${formatStatusLabel(accountContext.leaseStatus || accountContext.occupancyStatus)}.`
    : '';
  return {
    message: `Your account is registered under ${name} (${email}).${branchText}${roomText}${leaseText}`,
    intent: SUPPORTED_INTENTS.PROFILE,
    suggestions: [
      { label: 'Update profile', prompt: 'How do I update my profile?' },
    ],
  };
}

function buildBranchResponse(accountContext = {}, message = '') {
  const branch = accountContext.branchLocation;
  const language = detectLanguageStyle(message);
  if (!branch) {
    return {
      message: language === 'english'
        ? 'Branch location is not available yet.'
        : 'Hindi pa available ang location ng branch mo.',
      intent: SUPPORTED_INTENTS.BRANCH,
      suggestions: [],
    };
  }
  const messageText = language === 'english'
    ? `Your assigned branch is ${branch.branchName}.\n\nAddress:\n${branch.branchAddress}\n\nYou can also open it in Google Maps from your Profile screen.`
    : `Ang assigned branch mo ay ${branch.branchName}.\n\nAddress:\n${branch.branchAddress}\n\nMaaari mo rin itong buksan sa Google Maps mula sa Profile screen.`;
  return {
    message: messageText,
    intent: SUPPORTED_INTENTS.BRANCH,
    suggestions: [{ label: 'Open Profile', prompt: 'Where can I find my branch in the app?' }],
  };
}

// Shared messaging for the three "I can't tell you your contract status"
// failure kinds (conflict/unauthorized/unavailable) that must never be
// presented as "you have no contract" — see classifyContractUnavailability.
// Returns null when errorKind is 'not_found' (or unset), meaning the caller
// should fall through to its own genuine no-contract-yet copy.
function contractUnavailabilityResponse(errorKind) {
  if (errorKind === 'conflict') {
    return {
      message: "I found more than one active contract record on your account, so I can't safely tell which one is current. Please contact LilyCrest support so the records can be reviewed.",
      intent: SUPPORTED_INTENTS.CONTRACT,
      suggestions: [{ label: 'Talk to admin', prompt: 'Connect me to the admin about my contract records.' }],
    };
  }
  if (errorKind === 'unauthorized') {
    return {
      message: "I couldn't verify your account to check your contract just now. Please sign in again and try asking me once more.",
      intent: SUPPORTED_INTENTS.CONTRACT,
      suggestions: [],
    };
  }
  if (errorKind === 'unavailable') {
    return {
      message: "I can't check your contract right now — the contract service is temporarily unavailable. Please try again shortly.",
      intent: SUPPORTED_INTENTS.CONTRACT,
      suggestions: [{ label: 'Try again', prompt: 'When will my contract expire?' }],
    };
  }
  return null;
}

function buildContractResponse(accountContext = {}, message = '') {
  const language = detectLanguageStyle(message);
  if (!accountContext.contractFileAvailable) {
    const unavailability = contractUnavailabilityResponse(accountContext.contractErrorKind);
    if (unavailability) return unavailability;
    const knownStart = formatShortDate(accountContext.contractStart);
    const detail = knownStart
      ? ` I can see a move-in date of ${knownStart}, but there is no approved contract end date or tenant-visible final PDF yet.`
      : '';
    return {
      message: language === 'english'
        ? `No approved lease contract is available yet.${detail}`
        : `Wala pang approved lease contract na available sa account mo.${detail}`,
      intent: SUPPORTED_INTENTS.CONTRACT,
      suggestions: [{ label: 'Open Documents', prompt: 'Where can I view my documents?' }],
    };
  }
  const start = formatShortDate(accountContext.contractStart);
  const end = formatShortDate(accountContext.contractEnd);
  const leaseType = firstNonEmptyString(accountContext.leaseType);
  const details = [
    leaseType ? `Type: ${formatStatusLabel(leaseType)}.` : '',
    start ? `Move-in: ${start}.` : '',
    end ? `Move-out: ${end}.` : '',
  ].filter(Boolean).join(' ');
  return {
    message: `Your approved lease contract is available in Documents.${details ? ` ${details}` : ''}`,
    intent: SUPPORTED_INTENTS.CONTRACT,
    suggestions: [{ label: 'Open Documents', prompt: 'Where can I view my contract PDF?' }],
  };
}

function buildDocumentsResponse(accountContext = {}) {
  let contractText = 'No approved lease contract is available yet.';
  if (accountContext.contractFileAvailable) {
    contractText = 'Your approved lease contract is also available there.';
  } else {
    const unavailability = contractUnavailabilityResponse(accountContext.contractErrorKind);
    if (unavailability) contractText = unavailability.message;
  }
  return {
    message: `Open Profile, then Documents, to view your submitted IDs and available PDFs. ${contractText}`,
    intent: SUPPORTED_INTENTS.DOCUMENTS,
    suggestions: [{ label: 'Contract status', prompt: 'Is my lease contract available?' }],
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
    case SUPPORTED_INTENTS.ADMIN_SUPPORT:
      return 'I already have your account details and can help escalate this to admin. Please describe the concern briefly.';
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
  if (intent === SUPPORTED_INTENTS.ADMIN_SUPPORT) {
    return KNOWLEDGE_BASE.admin_handoff || null;
  }
  return KNOWLEDGE_LIST.find((entry) => entry.intent === intent) || null;
}

function inferIntentFromKnowledge(knowledgeEntries, message) {
  const firstIntent = knowledgeEntries.find((entry) => entry.intent)?.intent;
  if (firstIntent) return { intent: firstIntent, confidence: 0.9 };

  const lower = String(message || '').toLowerCase();
  if (isGreeting(message) && lower.trim().split(/\s+/).length <= 4) {
    return { intent: 'greeting', confidence: 1 };
  }
  if (isAdminEscalationRequest(message) || /complaint|reklamo|noisy neighbor|maingay|speak to admin|contact admin|escalate/.test(lower)) {
    return { intent: SUPPORTED_INTENTS.ADMIN_SUPPORT, confidence: 0.9 };
  }
  return { intent: 'general', confidence: null };
}

function shouldEscalate(knowledgeEntries, message) {
  const lower = message.toLowerCase();
  const hitGlobalKeyword = ESCALATION_KEYWORDS.some((word) => lower.includes(word));
  const hitAdminSupportIntent = knowledgeEntries.some((entry) =>
    entry.category === 'admin_support'
    || entry.intent === 'admin_escalation'
    || entry.intent === 'complaint_report'
  );
  const hitEntryKeyword = knowledgeEntries.some((entry) =>
    (entry.escalation_if || []).some((word) => lower.includes(word))
  );
  const hitSensitiveDormConcern = /\b(complaint|complain|reklamo|noisy neighbor|maingay|unsafe|harassment|violation)\b/.test(lower);
  return isAdminEscalationRequest(message) || hitGlobalKeyword || hitAdminSupportIntent || hitEntryKeyword || hitSensitiveDormConcern;
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

  return `${CHATBOT_SYSTEM_PROMPT}\n\nLANGUAGE: Match the tenant naturally: English for English, Filipino for Filipino, and Taglish for mixed messages. Do not translate names, amounts, dates, or document text. Use only supplied tenant context, policy hints, and attached-file content. If evidence is missing, say you couldn't find it. For images, extract visible text and useful fields, but never identify people or give medical diagnoses. For documents, summarize only visible clauses and say when a clause is absent.\n\n${timeContext}${contextBlock}${knowledgeBlock}${historyBlock}\n\nTenant: ${userMessage}`;
}

function buildSessionIdentityFingerprint(user = {}) {
  return [
    user.user_id || '',
    user.name || '',
    user.email || '',
  ].join('|');
}

async function ensureCanonicalSupportConversation(db, sessionId, user, reason, clientRequestId = sessionId) {
  return ensureTenantSupportConversation(db, user, {
    category: 'general_inquiry',
    priority: 'normal',
    assistantSessionId: sessionId,
    // Current clients send one stable operation id across transport retries.
    // Older clients fall back to their validated assistant session id.
    clientRequestId,
    initialMessage: reason || 'Requested admin assistance',
  });
}

// ─────────────────────────────────────────────────────
// Send message — main chatbot endpoint (AI-first)
// ─────────────────────────────────────────────────────
async function sendMessage(req, res) {
  try {
    const { message, session_id, attachments, client_message_id: clientMessageId } = req.body;
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
    let attachmentParts = [];
    try {
      attachmentParts = await loadAttachmentParts(attachments, userId);
    } catch (attachmentError) {
      const status = attachmentError?.status || 422;
      const detail = status === 403
        ? "I'm sorry, but I can't access that file."
        : attachmentError?.message === 'Attachment unavailable'
          ? "I couldn't access that document. Please try again later."
          : "The uploaded file isn't clear enough for me to read.";
      return res.status(status).json({ detail });
    }
    const lowerUserMessage = userMessage.toLowerCase();
    const existingSession = chatSessions.get(sessionId) || { history: [] };
    const currentIdentityFingerprint = buildSessionIdentityFingerprint(req.user);
    if (
      existingSession.identity_fingerprint
      && existingSession.identity_fingerprint !== currentIdentityFingerprint
    ) {
      existingSession.history = [];
      existingSession.last_intent = null;
    }
    existingSession.identity_fingerprint = currentIdentityFingerprint;
    chatSessions.set(sessionId, existingSession);
    if (requestsOtherTenantInformation(userMessage)) {
      const language = detectLanguageStyle(userMessage);
      const privacyMessage = language === 'english'
        ? "I'm sorry, but I can't access another tenant's information."
        : "Pasensya na, hindi ko maa-access ang impormasyon ng ibang tenant.";
      existingSession.history.push({ role: 'user', content: userMessage }, { role: 'assistant', content: privacyMessage });
      return res.json({
        message: privacyMessage, response: privacyMessage, intent: 'privacy',
        session_id: sessionId, needs_admin: false, live_chat_active: false,
        fallback: false, suggestions: DEFAULT_FOLLOWUPS,
        meta: { intent: 'privacy', confidence: 1, source: 'privacy_guard' },
      });
    }
    const greetingMessage = isGreeting(userMessage);
    const courtesyMessage = isCourtesyMessage(userMessage);
    const scopedMessage = hasDormitoryScopeSignal(userMessage);
    const scopedFollowUp = isDormitoryFollowUp(userMessage, existingSession);
    const routedIntent = detectSystemIntent(userMessage);
    const forceEscalation = isAdminEscalationRequest(userMessage)
      || ESCALATION_KEYWORDS.some((keyword) => lowerUserMessage.includes(keyword));

    if (!forceEscalation && !greetingMessage && !courtesyMessage && shouldRefuseAsOutOfScope(userMessage, existingSession)) {
      return replyWithScopeGuard(res, sessionId, existingSession, userMessage);
    }

    // Pull tenant context for grounded responses
    const db = getDb();
    const requesterBranchCode = await resolveRequesterBranchCode(db, req.user);
    const [announcements, bills, activeSupportConversations, tenantAccount, recentMaintenanceRequests, canonicalContract] = await Promise.all([
      db.collection('announcements')
        .find(buildTenantAnnouncementQuery(userId))
        .sort({ created_at: -1, createdAt: -1 })
        .toArray()
        .then((docs) => docs.filter((doc) => isAnnouncementVisibleForBranch(doc, requesterBranchCode)).slice(0, 3)),
      fetchUserBills(db, req.user, { limit: 5 }),
      db.collection('chat_conversations')
        .find({ tenantUserId: userId, status: { $in: ['open', 'in_review', 'waiting_tenant', 'resolved'] } })
        .sort({ updatedAt: -1 })
        .limit(3)
        .toArray(),
      resolveTenantAccountContext(db, req.user),
      fetchMaintenanceRequestsForUser(db, req.user).then((requests) => requests.slice(0, 3)),
      resolveCanonicalContractContext(req),
    ]);
    const pendingBills = bills.filter(isBillUnpaid).slice(0, 3);

    // Merge canonical contract/lease fields (from the same CONTRACT_UPSTREAM_URL
    // bridge the mobile Contract screen uses) into tenantAccount so downstream
    // consumers (buildContractResponse, buildDocumentsResponse, context lines)
    // need no further changes — they just read tenantAccount.contract* as before.
    tenantAccount.contractStart = canonicalContract.contractStart || '';
    tenantAccount.contractEnd = canonicalContract.contractEnd || '';
    tenantAccount.leaseType = canonicalContract.leaseType || '';
    tenantAccount.monthlyRent = canonicalContract.monthlyRent ?? null;
    tenantAccount.securityDeposit = canonicalContract.securityDeposit ?? null;
    tenantAccount.moveInFinancials = canonicalContract.moveInFinancials || null;
    tenantAccount.contractFileAvailable = canonicalContract.documentAvailable === true;
    tenantAccount.contractDocumentId = canonicalContract.contractId || '';
    tenantAccount.contractDocumentKind = canonicalContract.documentKind || null;
    tenantAccount.contractErrorKind = canonicalContract.available ? null : canonicalContract.errorKind;

    // Build tenant context lines
    const contextLines = [];
    contextLines.push(`Tenant display name: ${tenantAccount.tenantName || userName || 'Resident'}`);
    contextLines.push(`Role: ${tenantAccount.role || req.user.role || 'tenant'}`);
    if (tenantAccount.branch) contextLines.push(`Branch/dorm: ${tenantAccount.branch}`);
    if (tenantAccount.roomNumber || tenantAccount.roomBed) {
      contextLines.push(`Room/bed: ${tenantAccount.roomNumber || 'unknown room'}${tenantAccount.roomBed ? `, bed ${tenantAccount.roomBed}` : ''}`);
    }
    if (tenantAccount.occupancyStatus || tenantAccount.leaseStatus) {
      contextLines.push(`Lease/occupancy status: ${formatStatusLabel(tenantAccount.leaseStatus || tenantAccount.occupancyStatus)}`);
    }
    if (tenantAccount.contractStart) contextLines.push(`Contract start: ${tenantAccount.contractStart}`);
    if (tenantAccount.contractEnd) contextLines.push(`Contract end: ${tenantAccount.contractEnd}`);
    if (tenantAccount.leaseType) contextLines.push(`Lease type: ${tenantAccount.leaseType}`);
    if (tenantAccount.monthlyRent != null) contextLines.push(`Contract monthly rent: ${formatPesoCompact(tenantAccount.monthlyRent)}`);
    if (tenantAccount.securityDeposit != null) contextLines.push(`Contract security deposit: ${formatPesoCompact(tenantAccount.securityDeposit)}`);
    if (tenantAccount.moveInFinancials) {
      const financials = tenantAccount.moveInFinancials;
      contextLines.push(
        `Official Section 4 move-in computation: advance rent ${formatPesoCompact(financials.advanceRent)}`
        + ` + security deposit ${formatPesoCompact(financials.securityDeposit)}`
        + ` = total due before move-in ${formatPesoCompact(financials.totalDueBeforeMoveIn)};`
        + ` reservation fee already paid ${formatPesoCompact(financials.reservationFeeAlreadyPaid)}`
        + ` is a partial payment toward that combined amount; remaining balance ${formatPesoCompact(financials.remainingBalance)}.`
      );
    }
    contextLines.push('Authentication: This tenant is already signed in. Never ask for their full name, room number, or identity confirmation.');

    if (bills.length > 0) {
      const billSummary = bills.slice(0, 5).map((bill) => `- ${summarizeBillForContext(bill)}`).join('\n');
      contextLines.push(`Billing records visible to Lily:\n${billSummary}`);
    } else {
      contextLines.push('Billing records visible to Lily: none');
    }

    if (pendingBills.length > 0) {
      const billsSummary = pendingBills.map((bill) => `- ${summarizeBillForContext(bill)}`).join('\n');
      contextLines.push(`Unpaid bills:\n${billsSummary}`);
    } else {
      contextLines.push('Pending bills: none');
    }

    if (recentMaintenanceRequests.length > 0) {
      const maintenanceSummary = recentMaintenanceRequests.map((request) => `- ${summarizeMaintenanceForContext(request)}`).join('\n');
      contextLines.push(`Recent maintenance requests:\n${maintenanceSummary}`);
    } else {
      contextLines.push('Recent maintenance requests: none');
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

    // "What does my contract say about visitors/termination/etc." needs the
    // AI to read from the tenant's own signed/generated document, not the
    // canned status-only buildContractResponse below — so when detected,
    // fetch a short grounded excerpt into contextLines and let this fall
    // through to the normal AI-generation path instead of short-circuiting.
    const wantsContractDocumentDetail = asksAboutContractDocumentContent(userMessage);
    if (wantsContractDocumentDetail) {
      const unavailability = !canonicalContract.available
        ? contractUnavailabilityResponse(canonicalContract.errorKind)
        : null;
      if (unavailability) {
        // Conflict/unauthorized/unavailable — a real problem accessing the
        // contract, distinct from "no document yet." Reuse the exact same
        // tenant-facing wording buildContractResponse uses for consistency.
        contextLines.push(`Contract document: ${unavailability.message} Do not invent contract clause content.`);
      } else if (!canonicalContract.available || !canonicalContract.documentAvailable) {
        contextLines.push('Contract document: Not available yet. Tell the tenant their signed/generated lease document isn\'t available yet to check that clause, and suggest checking back later or with admin. Do not invent contract clause content.');
      } else {
        const docResult = await fetchContractDocumentForRequest(req, canonicalContract.contractId, canonicalContract.documentKind);
        if (!docResult.ok) {
          contextLines.push('Contract document: Could not be opened right now due to a temporary error. Tell the tenant to try again shortly. Do not invent contract clause content.');
        } else {
          const documentText = await extractContractDocumentText(docResult.buffer).catch(() => '');
          const excerpts = findRelevantContractExcerpts(documentText, userMessage);
          if (!excerpts.length) {
            contextLines.push('Contract document: No matching clause was found for this question in the tenant\'s lease document. Tell them you looked but could not find that specific clause, and suggest confirming with admin. Do not invent contract clause content.');
          } else {
            contextLines.push(
              `Contract document excerpt(s), taken directly from the tenant's own signed/generated lease. Only use this text to answer the question below; attribute the answer clearly (e.g. "According to your contract..."). If the excerpt does not actually answer the question, say the clause could not be found — never invent contract terms:\n${excerpts.join('\n---\n')}`
            );
          }
        }
      }
    }

    if (!forceEscalation && (scopedMessage || scopedFollowUp) && routedIntent === SUPPORTED_INTENTS.BILLING) {
      const billingResult = await buildBillingResponse(db, req.user, userMessage);
      const billingSess = chatSessions.get(sessionId) || { history: [] };
      billingSess.history.push({ role: 'user', content: userMessage });
      billingSess.history.push({ role: 'assistant', content: billingResult.message });
      billingSess.last_intent = billingResult.intent;
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

    if (!forceEscalation && (scopedMessage || scopedFollowUp) && routedIntent === SUPPORTED_INTENTS.MAINTENANCE) {
      const maintenanceResult = await buildMaintenanceResponse(db, req.user, userMessage);
      const maintenanceSess = chatSessions.get(sessionId) || { history: [] };
      maintenanceSess.history.push({ role: 'user', content: userMessage });
      maintenanceSess.history.push({ role: 'assistant', content: maintenanceResult.message });
      maintenanceSess.last_intent = maintenanceResult.intent;
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

    if (!forceEscalation && (scopedMessage || scopedFollowUp) && routedIntent === SUPPORTED_INTENTS.PROFILE) {
      const profileResult = buildProfileResponse(req.user, tenantAccount);
      const profileSess = chatSessions.get(sessionId) || { history: [] };
      profileSess.history.push({ role: 'user', content: userMessage });
      profileSess.history.push({ role: 'assistant', content: profileResult.message });
      profileSess.last_intent = profileResult.intent;
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

    if (!forceEscalation && (scopedMessage || scopedFollowUp) && routedIntent === SUPPORTED_INTENTS.BRANCH) {
      const branchResult = buildBranchResponse(tenantAccount, userMessage);
      const branchSession = chatSessions.get(sessionId) || { history: [] };
      branchSession.history.push({ role: 'user', content: userMessage });
      branchSession.history.push({ role: 'assistant', content: branchResult.message });
      branchSession.last_intent = branchResult.intent;
      chatSessions.set(sessionId, branchSession);
      return res.json({
        message: branchResult.message,
        response: branchResult.message,
        intent: branchResult.intent,
        session_id: sessionId,
        needs_admin: false,
        live_chat_active: false,
        fallback: false,
        suggestions: branchResult.suggestions,
        meta: { intent: branchResult.intent, confidence: 1, source: 'branch_resolution' },
      });
    }

    if (!forceEscalation && !wantsContractDocumentDetail && (scopedMessage || scopedFollowUp) && routedIntent === SUPPORTED_INTENTS.CONTRACT) {
      const contractResult = buildContractResponse(tenantAccount, userMessage);
      existingSession.history.push({ role: 'user', content: userMessage }, { role: 'assistant', content: contractResult.message });
      existingSession.last_intent = contractResult.intent;
      chatSessions.set(sessionId, existingSession);
      return res.json({
        message: contractResult.message, response: contractResult.message, intent: contractResult.intent,
        session_id: sessionId, needs_admin: false, live_chat_active: false, fallback: false,
        suggestions: contractResult.suggestions,
        meta: { intent: contractResult.intent, confidence: 1, source: 'system' },
      });
    }

    if (!forceEscalation && (scopedMessage || scopedFollowUp) && routedIntent === SUPPORTED_INTENTS.DOCUMENTS) {
      const documentsResult = buildDocumentsResponse(tenantAccount);
      existingSession.history.push({ role: 'user', content: userMessage }, { role: 'assistant', content: documentsResult.message });
      existingSession.last_intent = documentsResult.intent;
      chatSessions.set(sessionId, existingSession);
      return res.json({
        message: documentsResult.message, response: documentsResult.message, intent: documentsResult.intent,
        session_id: sessionId, needs_admin: false, live_chat_active: false, fallback: false,
        suggestions: documentsResult.suggestions,
        meta: { intent: documentsResult.intent, confidence: 1, source: 'system' },
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
    if (forceEscalation) {
      meta.intent = SUPPORTED_INTENTS.ADMIN_SUPPORT;
      meta.confidence = 1;
    }

    if (!forceEscalation && meta.intent === 'general' && knowledgeHints.length === 0 && !greetingMessage) {
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
    const escalate = forceEscalation || shouldEscalate(knowledgeHints, userMessage);

    // Get conversation history for continuity
    const session = chatSessions.get(sessionId) || { history: [] };
    const conversationHistory = session.history || [];

    // ── Generate response ──
    try {
      if (escalate) {
        // Safety/admin escalation — AI still generates the response, but we flag it
        needsAdmin = true;
        await ensureCanonicalSupportConversation(
          db,
          sessionId,
          normalizeUser({ ...req.user, ...tenantAccount }),
          `Escalated: ${userMessage.slice(0, 120)}`,
          clientMessageId,
        );
        // Let AI craft a natural escalation message
        const escalationPrompt = buildAIPrompt(
          userMessage, contextLines, knowledgeHints, conversationHistory
        ) + '\n\nIMPORTANT: This message has been flagged for admin attention. Acknowledge the tenant\'s concern empathetically, let them know an admin will follow up shortly, and reassure them. Keep it short and warm.';
        const { text } = await sendGeminiMessage(sessionId, escalationPrompt, attachmentParts);
        aiResponse = text || "I understand your concern po. I've flagged this for our admin team and they'll get back to you shortly. If it's urgent, you can also call +63 912 345 6789.";
      } else if (greetingMessage && userMessage.trim().split(/\s+/).length <= 4) {
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
        const { text } = await sendGeminiMessage(sessionId, prompt, attachmentParts);

        if (text && !looksLikeCode(text)) {
          aiResponse = text;
          if (text.includes('[NEEDS_ADMIN]')) {
            needsAdmin = true;
            await ensureCanonicalSupportConversation(
              db,
              sessionId,
              normalizeUser({ ...req.user, ...tenantAccount }),
              `AI escalation: ${userMessage.slice(0, 120)}`,
              clientMessageId,
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
        aiResponse = needsAdmin
          ? "I've flagged this for admin support po. Please keep the conversation open so the branch admin can follow up."
          : GEMINI_QUOTA_FALLBACK;
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
    session.last_intent = normalizeAssistantIntent(meta.intent);
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
    const user = normalizeUser(await db.collection('users').findOne({ user_id: userId }));
    const normalizedSession = normalizeSessionId(session_id, userId);
    if (!normalizedSession.ok) {
      return res.status(400).json({ detail: normalizedSession.error });
    }
    const sessionId = normalizedSession.value;
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (normalizedReason.length > MAX_ADMIN_REASON_CHARS) {
      return res.status(400).json({ detail: `Reason must be ${MAX_ADMIN_REASON_CHARS} characters or fewer` });
    }

    const result = await ensureCanonicalSupportConversation(
      db,
      sessionId,
      normalizeUser({ ...req.user, ...(user || {}) }),
      normalizedReason || 'Requested admin assistance',
    );

    res.json({
      queued: true,
      session_id: sessionId,
      conversation_id: String(result.conversation._id),
      reusedExisting: result.reusedExisting,
      idempotentReplay: result.idempotentReplay,
      message: result.reusedExisting
        ? 'Your admin support conversation is already active.'
        : 'Your request has been submitted. An admin will follow up shortly.',
    });
  } catch (error) {
    console.error('Live chat request error:', error);
    res.status(500).json({ error: 'Failed to request admin chat' });
  }
}

// ─────────────────────────────────────────────────────
// Get live status
// ─────────────────────────────────────────────────────
function legacySupportRetired(req, res) {
  return res.status(410).json({
    code: 'LEGACY_SUPPORT_RETIRED',
    detail: 'This legacy live-chat endpoint is retired. Use canonical support conversations.',
    canonical: {
      tenant: '/api/chat/me',
      admin: '/api/chat/admin/conversations',
    },
  });
}

async function getLiveStatus(req, res) {
  return legacySupportRetired(req, res);
}

// ─────────────────────────────────────────────────────
// Get live chats (admin)
// ─────────────────────────────────────────────────────
async function getLiveChats(req, res) {
  return legacySupportRetired(req, res);
}

// ─────────────────────────────────────────────────────
// Reset Gemini chat session
// ─────────────────────────────────────────────────────
async function resetSession(req, res) {
  try {
    const { session_id } = req.body;
    const sessionId = session_id || `${req.user?.user_id || 'guest'}_${Date.now()}`;

    chatSessions.delete(sessionId);

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
  return legacySupportRetired(req, res);
}

// ─────────────────────────────────────────────────────
// Send admin message
// ─────────────────────────────────────────────────────
async function sendAdminMessage(req, res) {
  return legacySupportRetired(req, res);
}

// ─────────────────────────────────────────────────────
// Close live chat
// ─────────────────────────────────────────────────────
async function closeLiveChat(req, res) {
  return legacySupportRetired(req, res);
}

// ─────────────────────────────────────────────────────
// Get chat history
// ─────────────────────────────────────────────────────
async function getChatHistory(req, res) {
  return legacySupportRetired(req, res);
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
  getChatHistory,
  __test: {
    detectLanguageStyle,
    requestsOtherTenantInformation,
    detectSystemIntent,
    hasDormitoryScopeSignal,
    hasHighSignalOutOfScopeTopic,
    isDormitoryFollowUp,
    isAdminEscalationRequest,
    shouldRefuseAsOutOfScope,
    asksAboutContractDocumentContent,
    buildContractResponse,
    buildDocumentsResponse,
    formatBillStatus,
    summarizeBillForContext,
    buildBillingResponse,
    resolveCanonicalContractContext,
    classifyContractUnavailability,
    contractUnavailabilityResponse,
    fetchMaintenanceRequestsForUser,
    chatSessions,
  },
};
