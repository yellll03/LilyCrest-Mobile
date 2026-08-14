const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');
const { getDb } = require('../config/database');
const {
  notifyMaintenanceStatusChange,
  notifyMaintenanceTenantUpdate,
} = require('../services/pushService');

// Canonical collection used by the website backend (Mongoose model collection).
const PRIMARY_COLLECTION = 'maintenance_requests';

// Legacy collection used by earlier mobile/backend builds.
const LEGACY_COLLECTION = 'maintenancerequests';

// Read from both so old records still appear while new records land in primary.
const COLLECTIONS = [...new Set([PRIMARY_COLLECTION, LEGACY_COLLECTION])];

const ACTIVE_RESERVATION_STATUSES = ['moveIn', 'active', 'completed', 'confirmed'];
const VALID_URGENCIES = ['low', 'normal', 'high'];
const VALID_REQUEST_TYPES = ['maintenance', 'plumbing', 'electrical', 'aircon', 'cleaning', 'pest', 'furniture', 'other'];
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 1000;
const VALID_STATUSES = ['pending', 'viewed', 'in_progress', 'assigned', 'scheduled', 'resolved', 'completed', 'rejected', 'cancelled'];
const ACTIVE_MAINTENANCE_STATUSES = ['pending', 'viewed', 'in_progress', 'assigned', 'scheduled'];
const TERMINAL_STATUSES = ['cancelled', 'rejected'];
const ADMIN_STATUS_TRANSITIONS = {
  pending: new Set(['viewed', 'cancelled']),
  viewed: new Set(['assigned']),
  assigned: new Set(['in_progress']),
  in_progress: new Set(['resolved']),
  resolved: new Set(['completed']),
  completed: new Set(),
  cancelled: new Set(),
  rejected: new Set(),
  scheduled: new Set(['in_progress']),
};
const TENANT_STATUS_TRANSITIONS = {
  cancel: { pending: 'cancelled' },
  reopen: { resolved: 'pending' },
  confirm_resolved: { resolved: 'completed' },
};

function isMaintenanceTransitionAllowed(from, to, actor = 'admin', action = '') {
  const source = String(from || '').toLowerCase();
  const target = String(to || '').toLowerCase();
  if (actor === 'tenant') return TENANT_STATUS_TRANSITIONS[action]?.[source] === target;
  return source === target || ADMIN_STATUS_TRANSITIONS[source]?.has(target) === true;
}
const MAX_PROGRESS_ATTACHMENTS = 4;
const MAX_PROGRESS_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TENANT_ATTACHMENTS = 4;
// QA requirement: every inquiry (tenant-submitted maintenance request and its
// follow-up replies) is capped at 5MB per attachment regardless of whether it
// is an image, PDF, or other supported document type — independent of the
// generic upload endpoint's own (larger) per-mime-type ceiling.
const INQUIRY_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const FIREBASE_STORAGE_BUCKET_FALLBACK = 'dormitorymanagement-caps-572cf.firebasestorage.app';
const LOCAL_ONLY_URI_PATTERN = /^(?:file|content|ph|assets-library|blob|ms-appdata):\/\/|^\/data\/user\/|^\/storage\/|^\/private\/var\/|^\/var\/mobile\/|(?:^|[\\/])cache(?:[\\/]|$)/i;
const IMAGE_ATTACHMENT_NAME_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)(?:\?.*)?$/i;
const DOCUMENT_ATTACHMENT_NAME_PATTERN = /\.(pdf|docx?|txt|csv)(?:\?.*)?$/i;
const DATA_ATTACHMENT_PATTERN = /^data:([^;]+);base64,/i;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
]);

function validateMaintenanceFields({ requestType, description, urgency }, { partial = false } = {}) {
  const errors = {};
  if (!partial || requestType !== undefined) {
    const value = typeof requestType === 'string' ? requestType.trim().toLowerCase() : '';
    if (!VALID_REQUEST_TYPES.includes(value)) errors.request_type = `request_type must be one of: ${VALID_REQUEST_TYPES.join(', ')}`;
  }
  if (!partial || description !== undefined) {
    const value = typeof description === 'string' ? description.trim() : '';
    if (value.length < DESCRIPTION_MIN) errors.description = `description must be at least ${DESCRIPTION_MIN} characters`;
    else if (value.length > DESCRIPTION_MAX) errors.description = `description must be ${DESCRIPTION_MAX} characters or fewer`;
  }
  if (!partial || urgency !== undefined) {
    const value = typeof urgency === 'string' ? urgency.trim().toLowerCase() : '';
    if (!VALID_URGENCIES.includes(value)) errors.urgency = `urgency must be one of: ${VALID_URGENCIES.join(', ')}`;
  }
  return errors;
}

function asObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }
  return null;
}

function sanitizeBranch(value) {
  if (typeof value !== 'string') return null;
  const branch = value.trim();
  return branch || null;
}

function actorNameFromUser(user) {
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return user.name || user.fullName || fullName || user.email || user.user_id || null;
}

function requestTimestampValue(request) {
  const dt = request?.lastActivityAt
    || request?.last_activity_at
    || request?.updated_at
    || request?.updatedAt
    || request?.created_at
    || request?.createdAt
    || 0;
  const time = new Date(dt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getDecodedBase64Bytes(value = '') {
  const raw = String(value || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw) return 0;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  return Math.floor((raw.length * 3) / 4) - padding;
}

function isLocalOnlyAttachmentUri(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return false;
  }
  return LOCAL_ONLY_URI_PATTERN.test(normalized);
}

function validateAttachmentUri(uri, { allowDataAttachment = false, allowDataImage = false } = {}) {
  const normalized = String(uri || '').trim();

  if (!normalized) {
    return { ok: false, error: 'Attachment URL is required.' };
  }

  if (isLocalOnlyAttachmentUri(normalized)) {
    return {
      ok: false,
      error: 'Attachments must be uploaded before submission. Local device paths are not allowed.',
    };
  }

  if (/^https:\/\//i.test(normalized)) {
    return { ok: true, value: normalized };
  }

  if (allowDataImage && /^data:image\//i.test(normalized)) {
    return { ok: true, value: normalized };
  }

  if (allowDataAttachment) {
    const dataMatch = normalized.match(DATA_ATTACHMENT_PATTERN);
    const dataMimeType = String(dataMatch?.[1] || '').trim().toLowerCase();
    if (dataMimeType && ALLOWED_ATTACHMENT_MIME_TYPES.has(dataMimeType)) {
      return { ok: true, value: normalized, mimeType: dataMimeType };
    }
  }

  return {
    ok: false,
    error: allowDataImage || allowDataAttachment
      ? 'Attachments must use HTTPS upload URLs or supported data URLs.'
      : 'Attachments must use uploaded HTTPS URLs.',
  };
}

function attachmentUrlFromEntry(entry = {}) {
  if (typeof entry === 'string') return entry.trim();
  const token = attachmentDownloadTokenFromEntry(entry);
  const candidates = [
    entry?.downloadUrl,
    entry?.download_url,
    entry?.attachmentUrl,
    entry?.attachment_url,
    entry?.mediaUrl,
    entry?.media_url,
    entry?.fileUrl,
    entry?.file_url,
    entry?.fileData,
    entry?.file_data,
    entry?.signedUrl,
    entry?.signed_url,
    entry?.secure_url,
    entry?.url,
    entry?.uri,
  ];
  const url = candidates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean) || '';
  if (/^gs:\/\//i.test(url)) {
    return firebaseDownloadUrlFromGsUri(url, token);
  }
  return url || firebaseDownloadUrlFromStoragePath(entry?.storagePath || entry?.storage_path, token);
}

function attachmentDownloadTokenFromEntry(entry = {}) {
  const token = entry?.downloadToken
    || entry?.download_token
    || entry?.firebaseStorageDownloadToken
    || entry?.firebase_storage_download_token
    || entry?.firebaseStorageDownloadTokens
    || entry?.firebase_storage_download_tokens
    || entry?.token;
  return String(token || '').split(',')[0].trim();
}

function firebaseStorageBucket() {
  const explicitBucket = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  if (explicitBucket) return explicitBucket;
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  return projectId ? `${projectId}.firebasestorage.app` : FIREBASE_STORAGE_BUCKET_FALLBACK;
}

function firebaseDownloadUrlFromStoragePath(storagePath = '', token = '') {
  const normalizedPath = String(storagePath || '').trim().replace(/^\/+/, '');
  const bucket = firebaseStorageBucket();
  if (!normalizedPath || !bucket || !token) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(normalizedPath)}?alt=media&token=${encodeURIComponent(token)}`;
}

function firebaseDownloadUrlFromGsUri(uri = '', token = '') {
  const match = String(uri || '').trim().match(/^gs:\/\/([^/]+)\/(.+)$/i);
  if (!match || !token) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(match[1])}/o/${encodeURIComponent(match[2])}?alt=media&token=${encodeURIComponent(token)}`;
}

function attachmentNameFromEntry(entry = {}, fallback = 'attachment') {
  const name = typeof entry?.originalName === 'string' && entry.originalName.trim()
    ? entry.originalName.trim()
    : typeof entry?.fileName === 'string' && entry.fileName.trim()
      ? entry.fileName.trim()
      : typeof entry?.filename === 'string' && entry.filename.trim()
        ? entry.filename.trim()
        : typeof entry?.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : fallback;
  return name.replace(/[<>]/g, '').slice(0, 180);
}

function attachmentMimeTypeFromEntry(entry = {}, fallback = 'application/octet-stream') {
  const type = typeof entry?.mimeType === 'string' && entry.mimeType.trim()
    ? entry.mimeType.trim()
    : typeof entry?.contentType === 'string' && entry.contentType.trim()
      ? entry.contentType.trim()
      : typeof entry?.type === 'string' && entry.type.trim()
        ? entry.type.trim()
        : fallback;
  return type.slice(0, 120);
}

function attachmentProviderFromEntry(entry = {}, url = '') {
  if (typeof entry?.provider === 'string' && entry.provider.trim()) {
    return entry.provider.trim().slice(0, 80);
  }
  return /firebasestorage(?:\.googleapis\.com|\.app)/i.test(url) ? 'firebase-storage' : 'https-url';
}

function isImageTenantAttachment({ downloadUrl = '', originalName = '', mimeType = '' } = {}) {
  return String(mimeType || '').toLowerCase().startsWith('image/')
    || IMAGE_ATTACHMENT_NAME_PATTERN.test(String(originalName || ''))
    || IMAGE_ATTACHMENT_NAME_PATTERN.test(String(downloadUrl || '').split('?')[0]);
}

function isDocumentTenantAttachment({ downloadUrl = '', originalName = '', mimeType = '' } = {}) {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  return normalizedMimeType === 'application/pdf'
    || normalizedMimeType === 'application/msword'
    || normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || normalizedMimeType === 'text/plain'
    || normalizedMimeType === 'text/csv'
    || DOCUMENT_ATTACHMENT_NAME_PATTERN.test(String(originalName || ''))
    || DOCUMENT_ATTACHMENT_NAME_PATTERN.test(String(downloadUrl || '').split('?')[0]);
}

function isSupportedTenantAttachment(attachment = {}) {
  return isImageTenantAttachment(attachment) || isDocumentTenantAttachment(attachment);
}

function sanitizeAttachmentForTenant(attachment = {}, index = 0) {
  const url = attachmentUrlFromEntry(attachment);
  const name = attachmentNameFromEntry(attachment, `attachment-${index + 1}`);
  const mimeType = attachmentMimeTypeFromEntry(attachment);
  const size = Number(attachment?.size);

  return {
    downloadUrl: /^https:\/\//i.test(url) ? url : '',
    uri: /^https:\/\//i.test(url) ? url : '',
    url: /^https:\/\//i.test(url) ? url : '',
    originalName: name,
    name,
    fileName: name,
    mimeType,
    type: mimeType,
    size: Number.isFinite(size) ? size : null,
    uploadedAt: attachment?.uploadedAt || attachment?.uploaded_at || attachment?.created_at || attachment?.createdAt || null,
  };
}

function normalizeProgressAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return { attachments: [], error: null };
  if (rawAttachments.length > MAX_PROGRESS_ATTACHMENTS) {
    return { attachments: [], error: `You can attach up to ${MAX_PROGRESS_ATTACHMENTS} files per update.` };
  }

  const attachments = rawAttachments
    .slice(0, MAX_PROGRESS_ATTACHMENTS)
    .map((entry, index) => {
      const uri = attachmentUrlFromEntry(entry);
      const name = attachmentNameFromEntry(entry, `maintenance-file-${index + 1}`);
      const type = attachmentMimeTypeFromEntry(entry, 'application/octet-stream');
      const uriCheck = validateAttachmentUri(uri);

      if (!uriCheck.ok) {
        return { error: uriCheck.error };
      }
      if (!isSupportedTenantAttachment({ downloadUrl: uriCheck.value, originalName: name, mimeType: uriCheck.mimeType || type })) {
        return { error: 'Maintenance update attachments must be images, PDFs, documents, text, or CSV files.' };
      }

      return {
        name,
        originalName: name,
        uri: uriCheck.value,
        downloadUrl: uriCheck.value,
        type: uriCheck.mimeType || type,
        mimeType: uriCheck.mimeType || type,
        size: Number.isFinite(Number(entry?.size)) ? Number(entry.size) : null,
      };
    });

  const invalidEntry = attachments.find((entry) => entry?.error);
  if (invalidEntry?.error) {
    return { attachments: [], error: invalidEntry.error };
  }

  return {
    attachments: attachments.filter(Boolean),
    error: null,
  };
}

function normalizeTenantAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) return { attachments: [], error: null };
  if (rawAttachments.length > MAX_TENANT_ATTACHMENTS) {
    return { attachments: [], error: `You can upload up to ${MAX_TENANT_ATTACHMENTS} maintenance files only.` };
  }

  const attachments = rawAttachments.map((entry, index) => {
    const downloadUrl = attachmentUrlFromEntry(entry);
    const originalName = attachmentNameFromEntry(entry, `attachment-${index + 1}`);
    const mimeType = attachmentMimeTypeFromEntry(entry);
    const storagePath = typeof entry?.storagePath === 'string' ? entry.storagePath.trim().slice(0, 500) : '';
    const uriCheck = validateAttachmentUri(downloadUrl);

    if (!uriCheck.ok) {
      return { error: uriCheck.error };
    }

    const size = Number(entry?.size);
    const provider = attachmentProviderFromEntry(entry, uriCheck.value);
    if (provider !== 'firebase-storage') {
      return { error: 'Maintenance attachments must be uploaded to Firebase Storage.' };
    }
    if (!/firebasestorage(?:\.googleapis\.com|\.app)/i.test(uriCheck.value)) {
      return { error: 'Maintenance attachments must use Firebase Storage download URLs.' };
    }
    if (!storagePath) {
      return { error: 'Maintenance attachment storagePath is required.' };
    }
    if (!isSupportedTenantAttachment({ downloadUrl: uriCheck.value, originalName, mimeType })) {
      return { error: 'Maintenance attachments must be images, PDFs, documents, text, or CSV files.' };
    }
    // Reject outright (rather than silently skipping the check) when size is
    // missing or non-numeric — a client cannot bypass the 5MB inquiry cap by
    // omitting the size field the upload endpoint returned.
    if (!Number.isFinite(size) || size > INQUIRY_ATTACHMENT_MAX_BYTES) {
      return { error: 'Maintenance attachment exceeds the 5 MB limit.' };
    }

    return {
      downloadUrl: uriCheck.value,
      storagePath,
      originalName,
      mimeType,
      size: Number.isFinite(size) ? size : null,
      uploadedAt: entry?.uploadedAt ? new Date(entry.uploadedAt) : new Date(),
      provider,
    };
  });

  const invalidEntry = attachments.find((entry) => entry?.error);
  if (invalidEntry?.error) {
    return { attachments: [], error: invalidEntry.error };
  }

  return {
    attachments: attachments.filter(Boolean),
    error: null,
  };
}

function normalizeVisibility(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['internal', 'admin', 'private', 'admin_only', 'admin-only'].includes(raw)) {
    return 'internal';
  }
  return 'tenant';
}

function isTenantVisibleEntry(entry = {}) {
  const visibility = normalizeVisibility(entry.visibility || (entry.visibleToTenant === false ? 'internal' : 'tenant'));
  if (visibility !== 'tenant') return false;
  if (entry.isTenantVisible === false || entry.visibleToTenant === false) return false;
  if (entry.internal === true || entry.adminOnly === true || entry.isInternal === true) return false;
  return true;
}

function normalizeSenderRole(value, fallback = 'admin') {
  const raw = String(value || fallback || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (['tenant', 'you'].includes(raw)) return 'tenant';
  if (['service_provider', 'provider', 'contractor', 'technician'].includes(raw)) return 'service_provider';
  if (['branch_admin', 'branch'].includes(raw)) return 'branch_admin';
  if (['owner', 'property_owner'].includes(raw)) return 'owner';
  if (['system', 'maintenance_system'].includes(raw)) return 'system';
  return 'admin';
}

function senderLabelFromRole(role, fallbackName = '') {
  const normalized = normalizeSenderRole(role);
  if (normalized === 'tenant') return 'You';
  if (normalized === 'service_provider') return 'Service Provider';
  if (normalized === 'branch_admin') return 'Branch Admin';
  if (normalized === 'owner') return 'Owner';
  if (normalized === 'system') return 'Maintenance Team';
  return fallbackName || 'Dormitory Admin';
}

function friendlyStatusCopy(status = '') {
  switch (String(status || '').toLowerCase()) {
    case 'pending':
      return 'Your request has been received and is waiting for admin review.';
    case 'viewed':
      return 'Admin has viewed your request.';
    case 'in_progress':
      return 'Your request is currently being handled.';
    case 'assigned':
      return 'A service provider has been assigned.';
    case 'scheduled':
      return 'A maintenance visit has been scheduled.';
    case 'resolved':
      return 'This request has been marked as resolved.';
    case 'completed':
      return 'This request has been completed.';
    case 'rejected':
      return 'This request was rejected. Please review the reason below.';
    case 'cancelled':
      return 'This request was cancelled.';
    default:
      return 'A maintenance update was sent.';
  }
}

function nextStepCopy(status = '', request = {}) {
  switch (String(status || '').toLowerCase()) {
    case 'pending':
      return 'Please wait while the admin team reviews your request.';
    case 'viewed':
      return 'The team will update you once the next action is ready.';
    case 'in_progress':
      return 'The team is working on your concern and will share updates here.';
    case 'assigned':
      return request.assigned_to
        ? `${request.assigned_to} has been assigned to handle this request.`
        : 'A service provider has been assigned to handle this request.';
    case 'scheduled':
      return request.scheduled_for
        ? `A maintenance visit is scheduled for ${request.scheduled_for}.`
        : 'Please watch for the scheduled maintenance visit details.';
    case 'resolved':
    case 'completed':
      return 'Please confirm if the issue has been fixed, or report if it is still a problem.';
    case 'rejected':
      return 'Please review the admin note and submit a new request if needed.';
    case 'cancelled':
      return 'You can submit a new request if you still need help.';
    default:
      return 'Check the latest update below for details.';
  }
}

function updateTitleFromEntry(entry = {}) {
  const type = String(entry.type || entry.kind || entry.event || '').toLowerCase();
  if (type === 'tenant_summary' || type === 'summary') return 'Maintenance Summary';
  if (type === 'tenant_reply') return 'Tenant Follow-up';
  if (type === 'tenant_submitted' || type === 'submitted') return 'Request Submitted';
  if (type === 'tenant_cancelled' || type === 'cancelled') return 'Request Cancelled';
  if (type === 'tenant_reopened' || type === 'reopened') return 'Still an Issue';
  if (type === 'tenant_confirmed_resolved') return 'Tenant Confirmed Resolved';
  if (entry.status_to || entry.status) return friendlyStatusCopy(entry.status_to || entry.status);
  return 'Maintenance Update';
}

function updatePreviewText(entry = {}) {
  const message = String(entry.message || entry.note || entry.content || '').trim();
  if (message) return message.length > 140 ? `${message.slice(0, 137)}...` : message;
  if (entry.summary || entry.tenantSummary) return 'Maintenance summary was sent.';
  if (Array.isArray(entry.attachments) && entry.attachments.length) {
    return `${entry.attachments.length} attachment${entry.attachments.length > 1 ? 's' : ''} sent.`;
  }
  return updateTitleFromEntry(entry);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateValue(value, fallback = null) {
  const date = normalizeDate(value);
  return date || fallback;
}

function getEntryTimestamp(entry = {}) {
  return entry.created_at || entry.createdAt || entry.timestamp || entry.updated_at || entry.updatedAt || null;
}

function getEntryTimeValue(entry = {}) {
  const date = normalizeDate(getEntryTimestamp(entry));
  return date ? date.getTime() : 0;
}

function sanitizeTenantSummary(summary = null) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  return {
    request_type: String(summary.request_type || '').trim(),
    current_status: String(summary.current_status || summary.status || '').trim(),
    action_taken: String(summary.action_taken || '').trim(),
    assigned_provider: String(summary.assigned_provider || '').trim(),
    schedule: String(summary.schedule || '').trim(),
    next_step: String(summary.next_step || '').trim(),
    completion_note: String(summary.completion_note || '').trim(),
    attachments: Array.isArray(summary.attachments)
      ? summary.attachments.map(sanitizeAttachmentForTenant).filter((item) => item.uri)
      : [],
    created_at: summary.created_at || summary.createdAt || null,
  };
}

function buildTenantSummary(request = {}, input = {}) {
  const status = input.status || request.status || 'pending';
  const note = String(input.notes || input.note || '').trim();
  const completionNote = String(input.completion_note || '').trim();
  const assignedProvider = String(input.assigned_to || request.assigned_to || '').trim();
  const schedule = String(input.schedule || input.scheduled_for || request.scheduled_for || '').trim();

  return sanitizeTenantSummary({
    request_type: request.request_type || 'maintenance',
    current_status: status,
    action_taken: note || friendlyStatusCopy(status),
    assigned_provider: assignedProvider,
    schedule,
    next_step: String(input.next_step || '').trim() || nextStepCopy(status, { ...request, assigned_to: assignedProvider, scheduled_for: schedule }),
    completion_note: completionNote || (['resolved', 'completed'].includes(String(status).toLowerCase()) ? note : ''),
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    created_at: input.created_at || new Date(),
  });
}

function summaryToMessage(summary = {}) {
  const lines = [
    summary.action_taken ? `Action taken: ${summary.action_taken}` : '',
    summary.assigned_provider ? `Assigned provider: ${summary.assigned_provider}` : '',
    summary.schedule ? `Schedule: ${summary.schedule}` : '',
    summary.next_step ? `Next step: ${summary.next_step}` : '',
    summary.completion_note ? `Completion note: ${summary.completion_note}` : '',
  ].filter(Boolean);
  return lines.join('\n') || 'A maintenance summary was sent.';
}

function buildUpdateEntry({
  type = 'admin_update',
  visibility = 'tenant',
  actor = {},
  message = '',
  attachments = [],
  status = null,
  statusFrom = null,
  statusTo = null,
  senderRole = null,
  senderLabel = null,
  summary = null,
  readByTenant = false,
  extra = {},
} = {}) {
  const now = extra.created_at || extra.createdAt || new Date();
  const normalizedVisibility = normalizeVisibility(visibility);
  const role = normalizeSenderRole(senderRole || actor.role, type.startsWith('tenant') ? 'tenant' : 'admin');
  const actorName = actor.name || actor.actor_name || actor.fullName || '';

  return {
    update_id: extra.update_id || `upd_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
    type,
    kind: type,
    visibility: normalizedVisibility,
    visibleToTenant: normalizedVisibility === 'tenant',
    isTenantVisible: normalizedVisibility === 'tenant',
    actor_id: actor.id || actor.user_id || actor.actor_id || null,
    actor_name: actorName || senderLabelFromRole(role),
    actor_role: role,
    sender_name: senderLabel || senderLabelFromRole(role, actorName),
    sender_role: role,
    message: String(message || '').trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    status,
    status_from: statusFrom,
    status_to: statusTo || status,
    summary: summary || null,
    tenantSummary: summary || null,
    readByTenant: readByTenant === true,
    created_at: now,
    createdAt: now,
    ...extra,
  };
}

function mapLegacyStatusHistoryEntry(entry = {}, index = 0) {
  if (!isTenantVisibleEntry(entry)) return null;
  const role = normalizeSenderRole(entry.actor_role || entry.sender_role || (entry.event === 'submitted' ? 'tenant' : 'admin'));
  const timestamp = getEntryTimestamp(entry);
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments.map(sanitizeAttachmentForTenant).filter((item) => item.uri)
    : [];

  return {
    update_id: entry.update_id || `legacy_${entry.event || 'status'}_${timestamp || index}`,
    type: entry.event === 'submitted'
      ? 'tenant_submitted'
      : entry.event === 'reopened'
        ? 'tenant_reopened'
        : entry.event === 'cancelled'
          ? 'tenant_cancelled'
          : 'status_change',
    kind: entry.event || 'status_change',
    title: updateTitleFromEntry(entry),
    senderName: senderLabelFromRole(role, entry.actor_name),
    senderRole: role,
    actor_name: entry.actor_name || senderLabelFromRole(role),
    actor_role: role,
    message: String(entry.note || '').trim() || (entry.status ? friendlyStatusCopy(entry.status) : ''),
    status: entry.status || null,
    status_from: entry.previous_status || null,
    status_to: entry.status || null,
    attachments,
    readByTenant: entry.readByTenant === true,
    visibleToTenant: true,
    visibility: 'tenant',
    created_at: timestamp,
    createdAt: timestamp,
  };
}

function mapUpdateForTenant(entry = {}, index = 0) {
  if (!isTenantVisibleEntry(entry)) return null;
  const role = normalizeSenderRole(entry.sender_role || entry.actor_role || entry.role, entry.type?.startsWith?.('tenant') ? 'tenant' : 'admin');
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments.map(sanitizeAttachmentForTenant).filter((item) => item.uri)
    : [];
  const summary = sanitizeTenantSummary(entry.summary || entry.tenantSummary);
  const timestamp = getEntryTimestamp(entry);

  return {
    update_id: entry.update_id || entry.id || `update_${timestamp || index}`,
    type: entry.type || entry.kind || 'maintenance_update',
    kind: entry.kind || entry.type || 'maintenance_update',
    title: updateTitleFromEntry(entry),
    senderName: entry.sender_name || entry.senderName || senderLabelFromRole(role, entry.actor_name),
    senderRole: role,
    actor_name: entry.actor_name || entry.sender_name || senderLabelFromRole(role),
    actor_role: role,
    message: String(entry.message || entry.note || entry.content || '').trim(),
    status: entry.status_to || entry.status || null,
    status_from: entry.status_from || null,
    status_to: entry.status_to || entry.status || null,
    attachments,
    summary,
    tenantSummary: summary,
    readByTenant: entry.readByTenant === true,
    visibleToTenant: true,
    visibility: 'tenant',
    created_at: timestamp,
    createdAt: timestamp,
  };
}

function dedupeThreadEntries(entries = []) {
  const seen = new Set();
  return entries.filter((entry, index) => {
    if (!entry) return false;
    const key = entry.update_id
      || entry.log_id
      || entry.id
      || `${entry.type || entry.kind || 'entry'}:${getEntryTimestamp(entry) || index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTenantThread(request = {}) {
  const explicitReplies = [
    ...(Array.isArray(request.publicReplies) ? request.publicReplies : []),
    ...(Array.isArray(request.tenantReplies) ? request.tenantReplies : []),
  ];
  const mappedExplicitReplies = explicitReplies
    .map(mapUpdateForTenant)
    .filter(Boolean);
  const updateIds = new Set(mappedExplicitReplies.map((entry) => entry.update_id).filter(Boolean));

  const updates = Array.isArray(request.updates) ? request.updates : [];
  const mappedUpdates = updates
    .map(mapUpdateForTenant)
    .filter((entry) => entry && !updateIds.has(entry.update_id));
  mappedUpdates.forEach((entry) => {
    if (entry.update_id) updateIds.add(entry.update_id);
  });
  const hasMappedSubmitted = [...mappedExplicitReplies, ...mappedUpdates].some((entry) => entry.type === 'tenant_submitted');

  const legacyEntries = (Array.isArray(request.statusHistory) ? request.statusHistory : [])
    .map(mapLegacyStatusHistoryEntry)
    .filter((entry) => entry && !updateIds.has(entry.update_id) && !(hasMappedSubmitted && entry.type === 'tenant_submitted'));
  legacyEntries.forEach((entry) => {
    if (entry.update_id) updateIds.add(entry.update_id);
  });

  const tenantSummary = sanitizeTenantSummary(request.tenant_summary || request.tenantSummary);
  const hasSummaryEntry = [...mappedExplicitReplies, ...mappedUpdates, ...legacyEntries]
    .some((entry) => entry.type === 'tenant_summary');
  const summaryEntry = tenantSummary && !hasSummaryEntry
    ? {
        update_id: `summary_${request.request_id || request._id || 'request'}_${tenantSummary.created_at || request.updated_at || request.updatedAt || ''}`,
        type: 'tenant_summary',
        kind: 'tenant_summary',
        title: 'Maintenance Summary',
        senderName: 'Maintenance Team',
        senderRole: 'admin',
        actor_name: 'Maintenance Team',
        actor_role: 'admin',
        message: summaryToMessage(tenantSummary),
        status: request.status || null,
        status_from: null,
        status_to: request.status || null,
        attachments: tenantSummary.attachments || [],
        summary: tenantSummary,
        tenantSummary,
        readByTenant: false,
        visibleToTenant: true,
        visibility: 'tenant',
        created_at: tenantSummary.created_at || request.updated_at || request.updatedAt || null,
        createdAt: tenantSummary.created_at || request.updated_at || request.updatedAt || null,
      }
    : null;

  const hasSubmitted = [...mappedExplicitReplies, ...mappedUpdates, ...legacyEntries].some((entry) => entry.type === 'tenant_submitted');
  const submittedEntry = hasSubmitted
    ? null
    : {
        update_id: `submitted_${request.request_id || request._id || 'request'}`,
        type: 'tenant_submitted',
        kind: 'tenant_submitted',
        title: 'Request Submitted',
        senderName: 'You',
        senderRole: 'tenant',
        actor_name: 'You',
        actor_role: 'tenant',
        message: 'Your request was submitted successfully.',
        status: request.status || 'pending',
        status_from: null,
        status_to: request.status || 'pending',
        attachments: Array.isArray(request.attachments)
          ? request.attachments.map(sanitizeAttachmentForTenant).filter((item) => item.uri)
          : [],
        summary: null,
        tenantSummary: null,
        readByTenant: true,
        visibleToTenant: true,
        visibility: 'tenant',
        created_at: request.created_at || request.createdAt || null,
        createdAt: request.created_at || request.createdAt || null,
      };

  return dedupeThreadEntries([
    ...(submittedEntry ? [submittedEntry] : []),
    ...mappedExplicitReplies,
    ...legacyEntries,
    ...mappedUpdates,
    ...(summaryEntry ? [summaryEntry] : []),
  ]).sort((left, right) => getEntryTimeValue(left) - getEntryTimeValue(right));
}

function isUnreadForTenant(entry = {}, lastTenantSeenAt = null) {
  if (normalizeSenderRole(entry.senderRole || entry.actor_role) === 'tenant') return false;
  const timestamp = normalizeDate(getEntryTimestamp(entry));
  if (!timestamp) return false;
  const lastSeen = normalizeDate(lastTenantSeenAt);
  if (!lastSeen) return true;
  return timestamp > lastSeen;
}

function getLatestTenantVisibleUpdate(thread = []) {
  return [...thread]
    .filter((entry) => entry.type !== 'tenant_submitted')
    .sort((left, right) => getEntryTimeValue(right) - getEntryTimeValue(left))[0] || null;
}

function buildTenantRequestResponse(request = {}, { includeThread = false } = {}) {
  const thread = buildTenantThread(request);
  const latestUpdate = getLatestTenantVisibleUpdate(thread);
  const lastTenantSeenAt = request.lastTenantSeenAt || request.last_tenant_seen_at || null;
  const unreadTenantCount = thread.filter((entry) => isUnreadForTenant(entry, lastTenantSeenAt)).length;
  const tenantSummary = sanitizeTenantSummary(request.tenant_summary || request.tenantSummary);

  const response = {
    request_id: request.request_id || String(request._id || ''),
    request_type: request.request_type || request.type || request.category || 'maintenance',
    description: request.description || request.issue || '',
    urgency: request.urgency || 'normal',
    status: request.status || 'pending',
    assigned_to: request.assigned_to || '',
    scheduled_for: request.scheduled_for || '',
    branch: request.branch || null,
    roomId: request.roomId ? String(request.roomId) : null,
    room_id: request.room_id || (request.roomId ? String(request.roomId) : null),
    attachments: Array.isArray(request.attachments)
      ? request.attachments.map(sanitizeAttachmentForTenant).filter((item) => item.uri)
      : [],
    tenant_summary: tenantSummary,
    tenantSummary,
    tenant_confirmed_resolved: request.tenant_confirmed_resolved === true,
    lastTenantSeenAt,
    lastActivityAt: request.lastActivityAt || request.last_activity_at || request.updated_at || request.updatedAt || request.created_at || request.createdAt || null,
    latestActivityAt: request.lastActivityAt || request.last_activity_at || request.updated_at || request.updatedAt || request.created_at || request.createdAt || null,
    lastTenantVisibleActivityAt: request.lastTenantVisibleActivityAt || request.last_tenant_visible_activity_at || latestUpdate?.created_at || null,
    unreadTenantCount,
    hasUnreadTenantUpdates: unreadTenantCount > 0,
    latestTenantVisibleUpdate: latestUpdate
      ? {
          update_id: latestUpdate.update_id,
          type: latestUpdate.type,
          title: latestUpdate.title,
          senderName: latestUpdate.senderName,
          senderRole: latestUpdate.senderRole,
          preview: updatePreviewText(latestUpdate),
          hasAttachments: Array.isArray(latestUpdate.attachments) && latestUpdate.attachments.length > 0,
          attachmentCount: Array.isArray(latestUpdate.attachments) ? latestUpdate.attachments.length : 0,
          created_at: latestUpdate.created_at,
        }
      : null,
    created_at: request.created_at || request.createdAt || null,
    updated_at: request.updated_at || request.updatedAt || null,
  };

  if (includeThread) {
    response.thread = thread;
    response.publicReplies = thread;
    response.tenantReplies = thread;
    response.statusHistory = thread
      .filter((entry) => entry.status)
      .map((entry) => ({
        event: entry.kind || entry.type,
        status: entry.status,
        actor_name: entry.actor_name,
        actor_role: entry.actor_role,
        note: entry.message,
        attachments: entry.attachments,
        timestamp: entry.created_at,
        visibleToTenant: true,
        visibility: 'tenant',
      }));
  }

  return response;
}

function stripInternalRequestFields(request) {
  if (!request) return request;
  const clean = { ...request };
  clean._id = undefined;
  delete clean.__source_collection;
  return clean;
}

function normalizeRequestForPrimary(request, user = {}) {
  const now = new Date();
  const normalized = { ...request };

  delete normalized._id;
  delete normalized.__source_collection;

  normalized.request_id = normalized.request_id || `maint_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
  normalized.user_id = normalized.user_id || user.user_id || null;
  if (!normalized.userId && user._id) {
    normalized.userId = asObjectId(user._id) || user._id;
  }

  normalized.request_type = normalized.request_type || 'other';
  normalized.description = normalized.description || '';
  normalized.urgency = VALID_URGENCIES.includes(normalized.urgency) ? normalized.urgency : 'normal';
  normalized.status = normalized.status || 'pending';
  normalized.assigned_to = normalized.assigned_to ?? null;
  normalized.scheduled_for = normalized.scheduled_for ?? null;
  normalized.notes = normalized.notes ?? null;
  normalized.reopen_note = normalized.reopen_note ?? null;

  normalized.attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
  normalized.updates = Array.isArray(normalized.updates) ? normalized.updates : [];
  normalized.reopen_history = Array.isArray(normalized.reopen_history) ? normalized.reopen_history : [];
  normalized.statusHistory = Array.isArray(normalized.statusHistory) ? normalized.statusHistory : [];
  normalized.tenant_summary = sanitizeTenantSummary(normalized.tenant_summary || normalized.tenantSummary) || null;

  normalized.created_at = normalized.created_at || normalized.createdAt || now;
  normalized.updated_at = normalized.updated_at || normalized.updatedAt || now;
  normalized.createdAt = normalized.createdAt || normalized.created_at;
  normalized.updatedAt = normalized.updatedAt || normalized.updated_at;
  normalized.lastActivityAt = normalized.lastActivityAt || normalized.last_activity_at || normalized.updated_at || now;
  normalized.lastTenantVisibleActivityAt = normalized.lastTenantVisibleActivityAt || normalized.last_tenant_visible_activity_at || normalized.created_at || now;
  normalized.lastTenantSeenAt = normalized.lastTenantSeenAt || normalized.last_tenant_seen_at || null;

  normalized.cancelled_at = normalized.cancelled_at ?? null;
  normalized.reopened_at = normalized.reopened_at ?? null;
  normalized.resolved_at = normalized.resolved_at ?? null;
  normalized.tenant_confirmed_resolved = normalized.tenant_confirmed_resolved === true;
  normalized.isArchived = typeof normalized.isArchived === 'boolean' ? normalized.isArchived : false;

  normalized.branch = sanitizeBranch(normalized.branch || user.branch || user.branchId) || null;
  normalized.reservationId = normalized.reservationId ?? null;
  normalized.roomId = normalized.roomId ?? null;

  return normalized;
}

async function resolveTenantContext(db, user) {
  const context = {
    branch: sanitizeBranch(user?.branch || user?.branchId),
    reservationId: null,
    roomId: null,
  };

  const mongoId = asObjectId(user?._id);
  if (!mongoId) return context;

  const reservation = await db.collection('reservations').findOne(
    {
      userId: mongoId,
      status: { $in: ACTIVE_RESERVATION_STATUSES },
      isArchived: { $ne: true },
    },
    {
      sort: { createdAt: -1 },
      projection: { _id: 1, roomId: 1, branch: 1 },
    }
  );

  if (reservation) {
    context.branch = sanitizeBranch(reservation.branch) || context.branch;
    context.reservationId = reservation._id || null;
    context.roomId = asObjectId(reservation.roomId) || reservation.roomId || null;
  }

  if (!context.roomId || !context.branch) {
    const bedHistory = await db.collection('bedhistories').findOne(
      { tenantId: mongoId, status: 'active' },
      { sort: { moveInDate: -1 }, projection: { roomId: 1, branch: 1 } }
    );

    if (bedHistory) {
      context.branch = sanitizeBranch(bedHistory.branch) || context.branch;
      context.roomId = context.roomId || asObjectId(bedHistory.roomId) || bedHistory.roomId || null;
    }
  }

  if (!context.roomId || !context.branch) {
    const occupancy = await db.collection('roomoccupancyhistories').findOne(
      { tenantId: mongoId, stayStatus: 'active' },
      { sort: { moveInDate: -1 }, projection: { roomId: 1, branchId: 1 } }
    );

    if (occupancy) {
      context.branch = sanitizeBranch(occupancy.branchId) || context.branch;
      context.roomId = context.roomId || asObjectId(occupancy.roomId) || occupancy.roomId || null;
    }
  }

  if (!context.branch && context.roomId) {
    const roomObjectId = asObjectId(context.roomId);
    const roomFilter = roomObjectId
      ? { _id: roomObjectId }
      : { room_id: String(context.roomId) };

    const room = await db.collection('rooms').findOne(roomFilter, {
      projection: { branch: 1, branchId: 1 },
    });

    context.branch = sanitizeBranch(room?.branch || room?.branchId) || context.branch;
  }

  return context;
}

function dedupeRequests(requests) {
  const map = new Map();

  for (const request of requests) {
    const key = request.request_id || String(request._id);
    const previous = map.get(key);

    if (!previous) {
      map.set(key, request);
      continue;
    }

    // Prefer canonical collection entries when duplicate request_id exists.
    if (
      previous.__source_collection === LEGACY_COLLECTION
      && request.__source_collection === PRIMARY_COLLECTION
    ) {
      map.set(key, request);
    }
  }

  return Array.from(map.values());
}

async function loadRequestsAcrossCollections(db, filter) {
  const records = [];

  for (const collectionName of COLLECTIONS) {
    try {
      const docs = await db.collection(collectionName).find(filter).toArray();
      records.push(...docs.map((doc) => ({ ...doc, __source_collection: collectionName })));
    } catch (_) {
      // Ignore missing legacy collections; keep serving from available source.
    }
  }

  return dedupeRequests(records)
    .sort((left, right) => requestTimestampValue(right) - requestTimestampValue(left));
}

function buildUserMaintenanceFilter(user, extraFilter = {}) {
  const userId = user?.user_id;
  const mongoId = asObjectId(user?._id);

  return {
    ...extraFilter,
    $or: [
      ...(userId ? [{ user_id: userId }] : []),
      ...(mongoId ? [{ userId: mongoId }] : []),
    ],
  };
}

async function countActiveMaintenanceForUser(db, user) {
  const filter = buildUserMaintenanceFilter(user, {
    status: { $in: ACTIVE_MAINTENANCE_STATUSES },
  });

  if (!filter.$or.length) return 0;

  const requests = await loadRequestsAcrossCollections(db, filter);
  return requests.length;
}

async function findRequestForUser(db, requestId, user) {
  const userFilter = typeof user === 'string'
    ? { $or: [{ user_id: user }] }
    : buildUserMaintenanceFilter(user);
  if (!userFilter.$or?.length) return null;

  for (const collectionName of [PRIMARY_COLLECTION, LEGACY_COLLECTION]) {
    try {
      const request = await db.collection(collectionName).findOne({
        request_id: requestId,
        $or: userFilter.$or,
      });

      if (request) {
        return { request, collectionName };
      }
    } catch (_) {
      // Continue lookup in other collection.
    }
  }

  return null;
}

async function findRequestForAdmin(db, requestId) {
  for (const collectionName of [PRIMARY_COLLECTION, LEGACY_COLLECTION]) {
    try {
      const request = await db.collection(collectionName).findOne({ request_id: requestId });
      if (request) {
        return { request, collectionName };
      }
    } catch (_) {
      // Continue lookup in other collection.
    }
  }

  return null;
}

async function promoteRequestToPrimary(db, request, user = {}) {
  const normalized = normalizeRequestForPrimary(request, user);

  await db.collection(PRIMARY_COLLECTION).updateOne(
    { request_id: normalized.request_id },
    { $set: normalized },
    { upsert: true }
  );

  return db.collection(PRIMARY_COLLECTION).findOne({ request_id: normalized.request_id });
}

// Get user's maintenance requests
async function getMyMaintenance(req, res) {
  try {
    const db = getDb();
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const filter = buildUserMaintenanceFilter(req.user, status ? { status } : {});

    const requests = await loadRequestsAcrossCollections(db, filter);
    res.json(requests.map((request) => buildTenantRequestResponse(request)));
  } catch (error) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ detail: 'Failed to fetch maintenance requests' });
  }
}

// Get one tenant-owned maintenance request with tenant-visible thread.
async function getMaintenanceDetail(req, res) {
  try {
    const db = getDb();
    const { requestId } = req.params;
    const located = await findRequestForUser(db, requestId, req.user);

    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    res.json(buildTenantRequestResponse(located.request, { includeThread: true }));
  } catch (error) {
    console.error('Get maintenance detail error:', error);
    res.status(500).json({ detail: 'Failed to fetch maintenance request' });
  }
}

// Mark tenant-visible updates as read for the signed-in tenant.
async function markMaintenanceRead(req, res) {
  try {
    const db = getDb();
    const { requestId } = req.params;
    const located = await findRequestForUser(db, requestId, req.user);

    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    const now = new Date();
    const updates = Array.isArray(located.request.updates)
      ? located.request.updates.map((entry) => (
          isTenantVisibleEntry(entry)
            ? { ...entry, readByTenant: true, read_by_tenant: true, readByTenantAt: now }
            : entry
        ))
      : [];

    await db.collection(located.collectionName).updateOne(
      { request_id: requestId },
      {
        $set: {
          updates,
          lastTenantSeenAt: now,
          last_tenant_seen_at: now,
          updatedAt: located.request.updatedAt || located.request.updated_at || now,
          updated_at: located.request.updated_at || located.request.updatedAt || now,
        },
      }
    );

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);

    res.json(buildTenantRequestResponse(updated, { includeThread: true }));
  } catch (error) {
    console.error('Mark maintenance read error:', error);
    res.status(500).json({ detail: 'Failed to mark maintenance updates as read' });
  }
}

async function addTenantMaintenanceReply(req, res) {
  try {
    const db = getDb();
    const { requestId } = req.params;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const { attachments, error: attachmentError } = normalizeTenantAttachments(req.body?.attachments);

    if (attachmentError) {
      return res.status(400).json({ detail: attachmentError });
    }
    if (!message && !attachments.length) {
      return res.status(400).json({ detail: 'Message or attachment is required' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ detail: 'Message must be 2000 characters or fewer' });
    }

    const located = await findRequestForUser(db, requestId, req.user);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    const currentStatus = String(located.request.status || '').toLowerCase();
    if (TERMINAL_STATUSES.includes(currentStatus) || ['resolved', 'completed'].includes(currentStatus)) {
      return res.status(400).json({ detail: 'This request is closed. Please reopen it if the issue is still happening.' });
    }

    const now = new Date();
    const update = buildUpdateEntry({
      type: 'tenant_reply',
      visibility: 'tenant',
      actor: {
        id: req.user.user_id,
        name: actorNameFromUser(req.user),
        role: 'tenant',
      },
      message,
      attachments,
      status: located.request.status || 'pending',
      senderRole: 'tenant',
      readByTenant: true,
      extra: { created_at: now, createdAt: now },
    });

    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    statusHistory.push({
      event: 'tenant_reply',
      status: located.request.status || 'pending',
      actor_id: req.user.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: 'tenant',
      note: message,
      attachments,
      update_id: update.update_id,
      visibility: 'tenant',
      visibleToTenant: true,
      timestamp: now,
    });

    const updates = Array.isArray(located.request.updates)
      ? [...located.request.updates, update]
      : [update];

    await db.collection(located.collectionName).updateOne(
      { request_id: requestId },
      {
        $set: {
          updates,
          statusHistory,
          tenant_confirmed_resolved: false,
          lastActivityAt: now,
          last_activity_at: now,
          lastTenantVisibleActivityAt: now,
          last_tenant_visible_activity_at: now,
          updated_at: now,
          updatedAt: now,
        },
      }
    );

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);

    res.status(201).json(buildTenantRequestResponse(updated, { includeThread: true }));
  } catch (error) {
    console.error('Tenant maintenance reply error:', error);
    res.status(500).json({ detail: 'Failed to send maintenance reply' });
  }
}

async function confirmMaintenanceResolved(req, res) {
  try {
    const db = getDb();
    const { requestId } = req.params;
    const located = await findRequestForUser(db, requestId, req.user);

    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    const currentStatus = String(located.request.status || '').toLowerCase();
    if (!isMaintenanceTransitionAllowed(currentStatus, 'completed', 'tenant', 'confirm_resolved')) {
      return res.status(409).json({ detail: 'Only resolved requests can be confirmed.' });
    }

    const now = new Date();
    const update = buildUpdateEntry({
      type: 'tenant_confirmed_resolved',
      visibility: 'tenant',
      actor: {
        id: req.user.user_id,
        name: actorNameFromUser(req.user),
        role: 'tenant',
      },
      message: 'Tenant confirmed the issue has been fixed.',
      status: 'completed',
      statusFrom: located.request.status || null,
      statusTo: 'completed',
      senderRole: 'tenant',
      readByTenant: true,
      extra: { created_at: now, createdAt: now },
    });

    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    statusHistory.push({
      event: 'tenant_confirmed_resolved',
      status: 'completed',
      previous_status: located.request.status || null,
      actor_id: req.user.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: 'tenant',
      note: update.message,
      update_id: update.update_id,
      visibility: 'tenant',
      visibleToTenant: true,
      timestamp: now,
    });

    const updates = Array.isArray(located.request.updates)
      ? [...located.request.updates, update]
      : [update];

    const result = await db.collection(located.collectionName).updateOne(
      { request_id: requestId, status: currentStatus },
      {
        $set: {
          status: 'completed',
          tenant_confirmed_resolved: true,
          updates,
          statusHistory,
          lastActivityAt: now,
          last_activity_at: now,
          lastTenantVisibleActivityAt: now,
          last_tenant_visible_activity_at: now,
          updated_at: now,
          updatedAt: now,
        },
      }
    );

    if (result.matchedCount === 0) return res.status(409).json({ detail: 'Request status changed before confirmation.' });
    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);

    res.json(buildTenantRequestResponse(updated, { includeThread: true }));
  } catch (error) {
    console.error('Confirm maintenance resolved error:', error);
    res.status(500).json({ detail: 'Failed to confirm maintenance resolution' });
  }
}

// Create maintenance request
async function createMaintenance(req, res) {
  try {
    const db = getDb();
    const requestType = typeof req.body?.request_type === 'string'
      ? req.body.request_type.trim()
      : '';
    const description = typeof req.body?.description === 'string'
      ? req.body.description.trim()
      : '';
    const urgencyRaw = typeof req.body?.urgency === 'string'
      ? req.body.urgency.trim().toLowerCase()
      : 'normal';
    const attachmentsRaw = req.body?.attachments;

    const fieldErrors = validateMaintenanceFields({ requestType, description, urgency: urgencyRaw });
    if (Object.keys(fieldErrors).length) {
      return res.status(400).json({ detail: 'Validation failed.', errors: fieldErrors });
    }

    const urgency = urgencyRaw;
    const { attachments, error: attachmentError } = normalizeTenantAttachments(attachmentsRaw);
    if (attachmentError) {
      return res.status(400).json({ detail: attachmentError });
    }

    const tenantContext = await resolveTenantContext(db, req.user);
    const now = new Date();
    const submittedUpdate = buildUpdateEntry({
      type: 'tenant_submitted',
      visibility: 'tenant',
      actor: {
        id: req.user.user_id,
        name: actorNameFromUser(req.user),
        role: 'tenant',
      },
      message: 'Your request was submitted successfully.',
      attachments,
      status: 'pending',
      senderRole: 'tenant',
      readByTenant: true,
      extra: { created_at: now, createdAt: now },
    });

    const newRequest = normalizeRequestForPrimary(
      {
        request_id: `maint_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
        user_id: req.user.user_id,
        ...(req.user._id ? { userId: asObjectId(req.user._id) || req.user._id } : {}),
        request_type: requestType.toLowerCase(),
        description,
        urgency,
        status: 'pending',
        assigned_to: null,
        notes: null,
        attachments,
        updates: [submittedUpdate],
        reopen_note: null,
        reopen_history: [],
        statusHistory: [
          {
            event: 'submitted',
            status: 'pending',
            actor_id: req.user.user_id || null,
            actor_name: actorNameFromUser(req.user),
            actor_role: req.user.role || null,
            note: null,
            attachments,
            update_id: submittedUpdate.update_id,
            visibility: 'tenant',
            visibleToTenant: true,
            timestamp: now,
          },
        ],
        branch: tenantContext.branch,
        reservationId: tenantContext.reservationId,
        roomId: tenantContext.roomId,
        isArchived: false,
        tenant_confirmed_resolved: false,
        lastActivityAt: now,
        last_activity_at: now,
        lastTenantVisibleActivityAt: now,
        last_tenant_visible_activity_at: now,
        lastTenantSeenAt: now,
        last_tenant_seen_at: now,
        created_at: now,
        updated_at: now,
        createdAt: now,
        updatedAt: now,
      },
      req.user,
    );

    await db.collection(PRIMARY_COLLECTION).insertOne(newRequest);
    res.status(201).json(buildTenantRequestResponse(newRequest, { includeThread: true }));
  } catch (error) {
    console.error('Create maintenance error:', error);
    res.status(500).json({ detail: 'Failed to create maintenance request' });
  }
}

// Update maintenance request (only when pending)
async function updateMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const { request_type, description, urgency } = req.body;
    const db = getDb();

    const located = await findRequestForUser(db, requestId, req.user);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    if (!isMaintenanceTransitionAllowed(located.request.status, 'cancelled', 'tenant', 'cancel')) {
      return res.status(409).json({ detail: 'Only pending requests can be edited' });
    }

    const fieldErrors = validateMaintenanceFields({ requestType: request_type, description, urgency }, { partial: true });
    if (Object.keys(fieldErrors).length) return res.status(400).json({ detail: 'Validation failed.', errors: fieldErrors });

    const updates = { updated_at: new Date(), updatedAt: new Date() };

    if (typeof request_type === 'string' && request_type.trim()) {
      updates.request_type = request_type.trim().toLowerCase();
    }
    if (description !== undefined) {
      updates.description = typeof description === 'string' ? description.trim() : '';
    }
    if (typeof urgency === 'string' && VALID_URGENCIES.includes(urgency.trim().toLowerCase())) {
      updates.urgency = urgency.trim().toLowerCase();
    }

    const result = await db.collection(located.collectionName).updateOne(
      { request_id: requestId, status: 'pending' },
      { $set: updates }
    );
    if (result.matchedCount === 0) return res.status(409).json({ detail: 'Request status changed before the edit could be saved.' });

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);
    res.json(buildTenantRequestResponse(updated, { includeThread: true }));
  } catch (error) {
    console.error('Update maintenance error:', error);
    res.status(500).json({ detail: 'Failed to update maintenance request' });
  }
}

// Cancel maintenance request (only when pending)
async function cancelMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const db = getDb();

    const located = await findRequestForUser(db, requestId, req.user);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }
    if ((located.request.status || '').toLowerCase() !== 'pending') {
      return res.status(409).json({ detail: 'Only pending requests can be cancelled' });
    }

    const now = new Date();
    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    const update = buildUpdateEntry({
      type: 'tenant_cancelled',
      visibility: 'tenant',
      actor: {
        id: req.user.user_id,
        name: actorNameFromUser(req.user),
        role: 'tenant',
      },
      message: 'Your request was cancelled.',
      status: 'cancelled',
      statusFrom: located.request.status || null,
      statusTo: 'cancelled',
      senderRole: 'tenant',
      readByTenant: true,
      extra: { created_at: now, createdAt: now },
    });
    statusHistory.push({
      event: 'cancelled',
      status: 'cancelled',
      actor_id: req.user.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: req.user.role || null,
      note: null,
      update_id: update.update_id,
      visibility: 'tenant',
      visibleToTenant: true,
      timestamp: now,
    });
    const updates = Array.isArray(located.request.updates)
      ? [...located.request.updates, update]
      : [update];

    const result = await db.collection(located.collectionName).updateOne(
      { request_id: requestId, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          cancelled_at: now,
          updates,
          statusHistory,
          lastActivityAt: now,
          last_activity_at: now,
          lastTenantVisibleActivityAt: now,
          last_tenant_visible_activity_at: now,
          updated_at: now,
          updatedAt: now,
        },
      }
    );

    if (result.matchedCount === 0) return res.status(409).json({ detail: 'Request status changed before cancellation.' });
    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);
    res.json(buildTenantRequestResponse(updated, { includeThread: true }));
  } catch (error) {
    console.error('Cancel maintenance error:', error);
    res.status(500).json({ detail: 'Failed to cancel maintenance request' });
  }
}

// Reopen a resolved/completed request
async function reopenMaintenance(req, res) {
  try {
    const { requestId } = req.params;
    const { reopen_note } = req.body;
    const db = getDb();

    const located = await findRequestForUser(db, requestId, req.user);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    if (!isMaintenanceTransitionAllowed(located.request.status, 'pending', 'tenant', 'reopen')) {
      return res.status(409).json({ detail: 'Only resolved requests can be reopened' });
    }

    const now = new Date();
    const note = typeof reopen_note === 'string' && reopen_note.trim()
      ? reopen_note.trim()
      : null;

    const reopenHistory = Array.isArray(located.request.reopen_history)
      ? [...located.request.reopen_history]
      : [];
    reopenHistory.push({
      reopened_at: now,
      previous_status: located.request.status,
      note,
    });

    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    const update = buildUpdateEntry({
      type: 'tenant_reopened',
      visibility: 'tenant',
      actor: {
        id: req.user.user_id,
        name: actorNameFromUser(req.user),
        role: 'tenant',
      },
      message: note || 'The issue is still happening.',
      status: 'pending',
      statusFrom: located.request.status || null,
      statusTo: 'pending',
      senderRole: 'tenant',
      readByTenant: true,
      extra: { created_at: now, createdAt: now },
    });
    statusHistory.push({
      event: 'reopened',
      status: 'pending',
      actor_id: req.user.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: req.user.role || null,
      note,
      update_id: update.update_id,
      visibility: 'tenant',
      visibleToTenant: true,
      timestamp: now,
    });
    const updates = Array.isArray(located.request.updates)
      ? [...located.request.updates, update]
      : [update];

    const result = await db.collection(located.collectionName).updateOne(
      { request_id: requestId, status: 'resolved' },
      {
        $set: {
          status: 'pending',
          reopen_note: note,
          reopen_history: reopenHistory,
          reopened_at: now,
          updates,
          statusHistory,
          tenant_confirmed_resolved: false,
          lastActivityAt: now,
          last_activity_at: now,
          lastTenantVisibleActivityAt: now,
          last_tenant_visible_activity_at: now,
          updated_at: now,
          updatedAt: now,
        },
      }
    );

    if (result.matchedCount === 0) return res.status(409).json({ detail: 'Request status changed before reopening.' });
    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);
    res.json(buildTenantRequestResponse(updated, { includeThread: true }));
  } catch (error) {
    console.error('Reopen maintenance error:', error);
    res.status(500).json({ detail: 'Failed to reopen maintenance request' });
  }
}

// Admin: update maintenance request status and notify tenant
async function adminUpdateStatus(req, res) {
  try {
    const { requestId } = req.params;
    const {
      status,
      notes,
      assigned_to,
      scheduled_for,
      next_step,
      completion_note,
      sender_role,
      sender_label,
    } = req.body;
    const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
    const noteText = typeof notes === 'string' ? notes.trim() : '';
    const visibility = normalizeVisibility(req.body?.visibility || (req.body?.isTenantVisible === false ? 'internal' : 'tenant'));
    const isTenantVisible = visibility === 'tenant';
    const shouldSendSummary = req.body?.send_tenant_summary === true || req.body?.sendTenantSummary === true;
    const { attachments: progressAttachments, error: progressAttachmentError } = normalizeProgressAttachments(
      req.body?.progress_attachments !== undefined
        ? req.body.progress_attachments
        : req.body?.attachments
    );
    if (progressAttachmentError) {
      return res.status(400).json({ detail: progressAttachmentError });
    }

    if (!normalizedStatus || !VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ detail: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const db = getDb();
    const located = await findRequestForAdmin(db, requestId);
    if (!located) {
      return res.status(404).json({ detail: 'Request not found' });
    }

    const now = new Date();
    const previousStatus = located.request.status || null;
    const statusChanged = String(previousStatus || '').toLowerCase() !== normalizedStatus;
    const previousNormalized = String(previousStatus || '').toLowerCase();
    if (statusChanged && !isMaintenanceTransitionAllowed(previousNormalized, normalizedStatus)) {
      return res.status(409).json({
        detail: `Invalid maintenance status transition: ${previousNormalized || 'unknown'} -> ${normalizedStatus}`,
      });
    }
    const actor = {
      id: req.user?.user_id || null,
      name: actorNameFromUser(req.user),
      role: normalizeSenderRole(sender_role || req.user?.role || 'admin'),
    };
    const adminUpdate = buildUpdateEntry({
      type: isTenantVisible ? 'admin_update' : 'internal_note',
      visibility,
      actor,
      message: noteText,
      attachments: progressAttachments,
      status: normalizedStatus,
      statusFrom: previousStatus,
      statusTo: normalizedStatus,
      senderRole: sender_role || req.user?.role || 'admin',
      senderLabel: typeof sender_label === 'string' && sender_label.trim()
        ? sender_label.trim()
        : null,
      readByTenant: false,
      extra: {
        assigned_to: typeof assigned_to === 'string' ? assigned_to.trim() : located.request.assigned_to || '',
        scheduled_for: typeof scheduled_for === 'string' ? scheduled_for.trim() : located.request.scheduled_for || '',
        next_step: typeof next_step === 'string' ? next_step.trim() : '',
        completion_note: typeof completion_note === 'string' ? completion_note.trim() : '',
        created_at: now,
        createdAt: now,
      },
    });

    const tenantStatusUpdate = (!isTenantVisible && statusChanged)
      ? buildUpdateEntry({
          type: 'status_change',
          visibility: 'tenant',
          actor: { role: 'system', name: 'Maintenance Team' },
          message: friendlyStatusCopy(normalizedStatus),
          attachments: [],
          status: normalizedStatus,
          statusFrom: previousStatus,
          statusTo: normalizedStatus,
          senderRole: 'system',
          readByTenant: false,
          extra: { created_at: now, createdAt: now },
        })
      : null;

    const summary = shouldSendSummary && isTenantVisible
      ? buildTenantSummary(located.request, {
          status: normalizedStatus,
          notes: noteText,
          assigned_to,
          schedule: scheduled_for,
          next_step,
          completion_note,
          attachments: progressAttachments,
          created_at: now,
        })
      : null;
    const summaryUpdate = summary
      ? buildUpdateEntry({
          type: 'tenant_summary',
          visibility: 'tenant',
          actor,
          message: summaryToMessage(summary),
          attachments: summary.attachments,
          status: normalizedStatus,
          statusFrom: previousStatus,
          statusTo: normalizedStatus,
          senderRole: sender_role || req.user?.role || 'admin',
          senderLabel: typeof sender_label === 'string' && sender_label.trim()
            ? sender_label.trim()
            : null,
          summary,
          readByTenant: false,
          extra: { created_at: now, createdAt: now },
        })
      : null;

    const nextUpdates = Array.isArray(located.request.updates)
      ? [...located.request.updates]
      : [];
    const hasAdminUpdateContent = noteText || progressAttachments.length || statusChanged || assigned_to !== undefined || scheduled_for !== undefined;
    if (hasAdminUpdateContent) nextUpdates.push(adminUpdate);
    if (tenantStatusUpdate) nextUpdates.push(tenantStatusUpdate);
    if (summaryUpdate) nextUpdates.push(summaryUpdate);

    const statusHistory = Array.isArray(located.request.statusHistory)
      ? [...located.request.statusHistory]
      : [];
    statusHistory.push({
      event: 'status_changed',
      status: normalizedStatus,
      previous_status: previousStatus,
      actor_id: req.user?.user_id || null,
      actor_name: actorNameFromUser(req.user),
      actor_role: actor.role,
      note: noteText || null,
      attachments: progressAttachments,
      update_id: adminUpdate.update_id,
      visibility,
      visibleToTenant: isTenantVisible,
      isTenantVisible,
      timestamp: now,
    });
    if (tenantStatusUpdate) {
      statusHistory.push({
        event: 'status_visible',
        status: normalizedStatus,
        previous_status: previousStatus,
        actor_id: null,
        actor_name: 'Maintenance Team',
        actor_role: 'system',
        note: tenantStatusUpdate.message,
        attachments: [],
        update_id: tenantStatusUpdate.update_id,
        visibility: 'tenant',
        visibleToTenant: true,
        isTenantVisible: true,
        timestamp: now,
      });
    }
    if (summaryUpdate) {
      statusHistory.push({
        event: 'tenant_summary',
        status: normalizedStatus,
        previous_status: previousStatus,
        actor_id: req.user?.user_id || null,
        actor_name: actorNameFromUser(req.user),
        actor_role: actor.role,
        note: summaryUpdate.message,
        attachments: summaryUpdate.attachments,
        update_id: summaryUpdate.update_id,
        visibility: 'tenant',
        visibleToTenant: true,
        isTenantVisible: true,
        timestamp: now,
      });
    }

    const tenantVisibleUpdateSent = [adminUpdate, tenantStatusUpdate, summaryUpdate]
      .filter(Boolean)
      .some((entry) => isTenantVisibleEntry(entry) && normalizeSenderRole(entry.actor_role) !== 'tenant');

    const updates = {
      status: normalizedStatus,
      updates: nextUpdates,
      statusHistory,
      lastActivityAt: now,
      last_activity_at: now,
      updated_at: now,
      updatedAt: now,
    };

    if (notes !== undefined) {
      updates.notes = isTenantVisible ? noteText || null : located.request.notes || null;
    }
    if (assigned_to !== undefined) {
      updates.assigned_to = typeof assigned_to === 'string' ? assigned_to.trim() : null;
    }
    if (scheduled_for !== undefined) {
      updates.scheduled_for = typeof scheduled_for === 'string' ? scheduled_for.trim() : null;
    }
    if (summary) {
      updates.tenant_summary = summary;
      updates.tenantSummary = summary;
    }
    if (tenantVisibleUpdateSent) {
      updates.lastTenantVisibleActivityAt = now;
      updates.last_tenant_visible_activity_at = now;
    }
    if (['resolved', 'completed'].includes(normalizedStatus)) {
      updates.resolved_at = now;
    }
    if (ACTIVE_MAINTENANCE_STATUSES.includes(normalizedStatus)) {
      updates.cancelled_at = null;
      updates.tenant_confirmed_resolved = false;
    }

    const updateResult = await db.collection(located.collectionName).updateOne(
      { request_id: requestId, status: previousStatus },
      { $set: updates }
    );
    if (updateResult.matchedCount === 0) {
      return res.status(409).json({ detail: 'Request status changed before this update could be saved.' });
    }

    const updatedSource = await db.collection(located.collectionName).findOne({ request_id: requestId });
    const updated = await promoteRequestToPrimary(db, updatedSource, req.user)
      .catch(() => updatedSource);

    const tenantUserId = updated?.user_id || located.request.user_id;
    if (tenantVisibleUpdateSent) {
      const notifyEntry = summaryUpdate || (isTenantVisible ? adminUpdate : tenantStatusUpdate);
      notifyMaintenanceTenantUpdate(tenantUserId, updated || located.request, notifyEntry)
        .catch(() => {});
    } else if (statusChanged) {
      notifyMaintenanceStatusChange(tenantUserId, updated || located.request, normalizedStatus)
        .catch(() => {});
    }

    res.json(stripInternalRequestFields(updated));
  } catch (error) {
    console.error('Admin update maintenance status error:', error);
    res.status(500).json({ detail: 'Failed to update maintenance request status' });
  }
}

// Admin: get all maintenance requests
async function adminGetAll(req, res) {
  try {
    const db = getDb();
    const { status, user_id, request_type, urgency, branch } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (user_id) filter.user_id = user_id;
    if (request_type) filter.request_type = request_type;
    if (urgency) filter.urgency = urgency;
    if (branch) filter.branch = branch;

    const requests = await loadRequestsAcrossCollections(db, filter);
    res.json(requests.map(stripInternalRequestFields));
  } catch (error) {
    console.error('Admin get maintenance error:', error);
    res.status(500).json({ detail: 'Failed to fetch maintenance requests' });
  }
}

module.exports = {
  getMyMaintenance,
  getMaintenanceDetail,
  createMaintenance,
  addTenantMaintenanceReply,
  markMaintenanceRead,
  confirmMaintenanceResolved,
  updateMaintenance,
  cancelMaintenance,
  reopenMaintenance,
  adminUpdateStatus,
  adminGetAll,
  countActiveMaintenanceForUser,
  isMaintenanceTransitionAllowed,
  sanitizeAttachmentForTenant,
  buildTenantRequestResponse,
  // Exported only for direct unit testing of the inquiry attachment 5MB cap
  // (see tests/inquiryAttachmentSizeLimit.test.js).
  normalizeTenantAttachments,
  INQUIRY_ATTACHMENT_MAX_BYTES,
};
