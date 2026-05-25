import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LilyFlowerIcon from '../../src/components/assistant/LilyFlowerIcon';
import { useAuth } from '../../src/context/AuthContext';
import { useTheme, useThemedStyles } from '../../src/context/ThemeContext';
import { useToast } from '../../src/context/ToastContext';
import { apiService, getApiErrorMessage } from '../../src/services/api';
import {
  ensureFirebaseStorageAttachments,
  DEFAULT_UPLOAD_MIME_TYPES,
  getAttachmentDisplayName,
  getAttachmentDownloadUrl,
  isDocumentAttachmentCandidate,
  isImageAttachmentCandidate,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  toStoredAttachmentMetadata,
} from '../../src/services/firebaseStorageUpload';
import { pickDocument, pickFromCamera, pickFromLibrary } from '../../src/utils/attachmentPicker';

function safeFormat(dateStr, fmt) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return format(d, fmt);
  } catch (_e) { return '—'; }
}

function formatStatusLabel(status = '') {
  if (!status) return 'Update';
  if (String(status).toLowerCase() === 'in_progress') return 'In Progress';
  return String(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getProgressTitle(entry = {}) {
  const type = String(entry?.type || entry?.kind || '').toLowerCase();
  if (type === 'tenant_summary') return 'Maintenance Summary';
  if (type === 'tenant_reply') return 'Follow-up from You';
  if (type === 'admin_update') return 'Maintenance Update';
  if (type === 'tenant_submitted') return 'Request Submitted';
  if (type === 'tenant_reopened') return 'Still an Issue';
  if (type === 'tenant_confirmed_resolved') return 'Confirmed Resolved';
  const event = String(entry?.event || '').toLowerCase();
  const statusLabel = formatStatusLabel(entry?.status);

  if (event === 'created') return 'Request Submitted';
  if (event === 'reopened') return 'Request Reopened';
  if (event === 'cancelled') return 'Request Cancelled';
  if (statusLabel && statusLabel !== 'Update') return statusLabel;
  return 'Progress Update';
}

function isImageAttachment(attachment = {}) {
  const url = getAttachmentDownloadUrl(attachment).toLowerCase();
  return isImageAttachmentCandidate(attachment)
    || url.startsWith('data:image/')
    || /\.(png|jpe?g|gif|webp|bmp)$/i.test(url);
}

function isOpenableAttachment(attachment = {}) {
  const url = getAttachmentDownloadUrl(attachment);
  return /^https?:\/\//i.test(url) || /^data:image\//i.test(url);
}

const TENANT_CONVERSATION_TYPES = new Set([
  'admin_reply',
  'admin_update',
  'tenant_reply',
  'tenant_summary',
  'summary',
]);

const INTERNAL_THREAD_TYPES = new Set([
  'status_change',
  'status_changed',
  'status_visible',
  'internal_note',
  'internal_log',
  'workflow_action',
  'viewed',
  'processing',
  'draft_saved',
  'tenant_submitted',
  'tenant_cancelled',
  'tenant_reopened',
  'tenant_confirmed_resolved',
]);

function getSenderRoleLabel(role = '', fallback = '') {
  const normalized = String(role || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'tenant') return 'You';
  if (normalized === 'owner' || normalized === 'property_owner') return 'Owner';
  if (normalized === 'branch_admin' || normalized === 'branch') return 'Branch Admin';
  if (normalized === 'service_provider' || normalized === 'provider' || normalized === 'technician') return 'Service Provider';
  if (normalized === 'admin') return fallback && !/admin/i.test(fallback) ? fallback : 'Branch Admin';
  return fallback || 'Branch Admin';
}

function summaryToConversationText(summary = {}) {
  return [
    summary.action_taken ? `Action taken: ${summary.action_taken}` : '',
    summary.assigned_provider ? `Assigned provider: ${summary.assigned_provider}` : '',
    summary.schedule ? `Schedule: ${summary.schedule}` : '',
    summary.next_step ? `Next step: ${summary.next_step}` : '',
    summary.completion_note ? `Completion note: ${summary.completion_note}` : '',
  ].filter(Boolean).join('\n');
}

function hasConversationContent(entry = {}) {
  const message = typeof entry?.message === 'string'
    ? entry.message.trim()
    : typeof entry?.note === 'string'
      ? entry.note.trim()
      : '';
  const summary = entry?.summary || entry?.tenantSummary || null;
  const attachments = Array.isArray(entry?.attachments) ? entry.attachments.filter(Boolean) : [];
  return Boolean(message || summary || attachments.length);
}

function isTenantConversationEntry(entry = {}) {
  const type = String(entry?.type || entry?.kind || entry?.event || '').toLowerCase();
  const visibility = String(entry?.visibility || (entry?.visibleToTenant === false ? 'internal' : 'tenant')).toLowerCase();
  const role = String(entry?.senderRole || entry?.sender_role || entry?.actor_role || '').toLowerCase();

  if (visibility === 'internal' || entry?.visibleToTenant === false || entry?.isTenantVisible === false) return false;
  if (entry?.internal === true || entry?.adminOnly === true || entry?.isInternal === true) return false;
  if (INTERNAL_THREAD_TYPES.has(type)) return false;
  if (type && !TENANT_CONVERSATION_TYPES.has(type)) return false;
  if (role === 'system') return false;
  return hasConversationContent(entry);
}

function buildRequestProgress(request) {
  if (!request) return [];

  const publicEntries = Array.isArray(request.publicReplies)
    ? request.publicReplies
    : Array.isArray(request.tenantReplies)
      ? request.tenantReplies
      : Array.isArray(request.thread)
        ? request.thread
        : Array.isArray(request.conversation)
          ? request.conversation
          : Array.isArray(request.updates)
            ? request.updates
            : [];
  const progress = publicEntries
    .filter(isTenantConversationEntry)
      .map((entry, index) => {
        const timestamp = entry?.created_at || entry?.createdAt || entry?.timestamp || null;
        const role = entry?.senderRole || entry?.sender_role || entry?.actor_role || null;
        const summary = entry?.summary || entry?.tenantSummary || null;
        const message = typeof entry?.message === 'string'
          ? entry.message.trim()
          : typeof entry?.note === 'string'
            ? entry.note.trim()
            : summaryToConversationText(summary);
        const entryAttachments = Array.isArray(entry?.attachments) ? entry.attachments.filter(Boolean) : [];
        const summaryAttachments = Array.isArray(summary?.attachments) ? summary.attachments.filter(Boolean) : [];
        return {
          id: entry?.update_id || `${entry?.type || 'update'}_${timestamp || index}`,
          title: entry?.type === 'tenant_summary' ? 'Maintenance Summary' : entry?.title || getProgressTitle(entry),
          type: entry?.type || entry?.kind || 'maintenance_update',
          message,
          timestamp,
          attachments: entryAttachments.length ? entryAttachments : summaryAttachments,
          actorLabel: getSenderRoleLabel(role, entry?.senderName || entry?.sender_name || entry?.actor_name || entry?.actorLabel || ''),
          actorRole: role,
          isTenant: String(role || '').toLowerCase() === 'tenant',
          isSummary: entry?.type === 'tenant_summary' || entry?.kind === 'tenant_summary' || Boolean(summary),
          summary,
        };
      })
      .sort((left, right) => {
        const leftTime = new Date(left.timestamp || 0).getTime();
        const rightTime = new Date(right.timestamp || 0).getTime();
        return leftTime - rightTime;
      });

  if (progress.length > 0) {
    return progress;
  }

  const summary = request.tenant_summary || request.tenantSummary || null;
  if (summary) {
    return [{
      id: `summary_${request.request_id || 'maintenance'}`,
      title: 'Maintenance Summary',
      type: 'tenant_summary',
      message: summaryToConversationText(summary) || 'A maintenance summary is available.',
      timestamp: summary.created_at || request.updated_at || request.updatedAt || request.created_at || request.createdAt || null,
      attachments: Array.isArray(summary.attachments) ? summary.attachments.filter(Boolean) : [],
      actorLabel: 'Branch Admin',
      actorRole: 'admin',
      isTenant: false,
      isSummary: true,
      summary,
    }];
  }

  return [];
}

function unwrapMaintenanceRequests(response) {
  const payload = response?.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.requests)) return payload.data.requests;
  if (Array.isArray(payload?.requests)) return payload.requests;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function isMaintenanceRequestPayload(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      value.request_id
      || value.requestId
      || value._id
      || value.status
      || value.request_type
      || value.thread
      || value.publicReplies
      || value.tenantReplies
    )
  );
}

function unwrapMaintenanceRequest(response, fallback = null) {
  const payload = response?.data ?? response;
  const candidates = [
    payload?.data?.request,
    payload?.request,
    payload?.data,
    payload,
  ];
  return candidates.find(isMaintenanceRequestPayload) || fallback;
}

const REQUEST_TYPES = [
  { id: 'maintenance', label: 'Maintenance', icon: 'construct', color: '#F59E0B' },
  { id: 'plumbing', label: 'Plumbing', icon: 'water', color: '#3B82F6' },
  { id: 'electrical', label: 'Electrical', icon: 'flash', color: '#EF4444' },
  { id: 'aircon', label: 'Air Conditioning', icon: 'snow', color: '#06B6D4' },
  { id: 'cleaning', label: 'Cleaning', icon: 'sparkles', color: '#22C55E' },
  { id: 'pest', label: 'Pest Control', icon: 'bug', color: '#8B5CF6' },
  { id: 'furniture', label: 'Furniture', icon: 'bed', color: '#EC4899' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal', color: '#6B7280' },
];

const URGENCY_LEVELS = [
  { id: 'low', label: 'Low', description: 'Can wait a few days', color: '#22C55E' },
  { id: 'normal', label: 'Normal', description: 'Within 1-2 days', color: '#F59E0B' },
  { id: 'high', label: 'Urgent', description: 'Needs immediate attention', color: '#EF4444' },
];

const RESOLUTION_ESTIMATES = {
  low: '3–5 business days',
  normal: '1–2 business days',
  high: 'Within 24 hours',
};

const STATUS_STEPS = ['pending', 'viewed', 'in_progress', 'assigned', 'scheduled', 'resolved'];
const MIN_DESCRIPTION_LENGTH = 10;
const ACTIVE_STATUSES = ['pending', 'viewed', 'in_progress', 'assigned', 'scheduled'];
const RESOLVED_STATUSES = ['completed', 'resolved', 'rejected'];
const CLOSED_REPLY_STATUSES = ['cancelled', 'rejected'];
const MAX_MAINTENANCE_ATTACHMENTS = 4;

function getStatusNextStep(status, request = {}) {
  switch ((status || '').toLowerCase()) {
    case 'pending': return 'Your request has been received and is waiting for admin review.';
    case 'viewed': return 'Admin has viewed your request.';
    case 'in_progress': return 'Your request is currently being handled.';
    case 'assigned': return 'A service provider has been assigned.';
    case 'scheduled': return 'A maintenance visit has been scheduled.';
    case 'resolved': return 'This request has been marked as resolved.';
    case 'completed': return request.tenant_confirmed_resolved ? 'You confirmed that this request is resolved.' : 'This request has been completed.';
    case 'rejected': return 'This request was rejected. Please review the reason below.';
    case 'cancelled': return 'This request was cancelled.';
    default: return 'A maintenance update is available.';
  }
}

function getNextStepDetail(status, request = {}) {
  switch ((status || '').toLowerCase()) {
    case 'pending': return 'Please wait while the team reviews the details.';
    case 'viewed': return 'The team will share the next action here.';
    case 'in_progress': return 'Watch this thread for repair notes, files, or visit details.';
    case 'assigned': return request.assigned_to ? `${request.assigned_to} is assigned to this request.` : 'The assigned provider will handle the repair.';
    case 'scheduled': return request.scheduled_for ? `Scheduled for ${request.scheduled_for}.` : 'The visit schedule will be shared here.';
    case 'resolved': return 'Please confirm if the issue is fixed, or report that it is still an issue.';
    case 'completed': return 'No action is needed right now.';
    case 'rejected': return 'You can submit a new request if you need another review.';
    case 'cancelled': return 'You can submit a new request if you still need help.';
    default: return 'Review the latest update below.';
  }
}

function canReplyToRequest(request = {}) {
  const status = String(request.status || '').toLowerCase();
  if (CLOSED_REPLY_STATUSES.includes(status)) return false;
  if (['resolved', 'completed'].includes(status)) return false;
  return true;
}

export default function ServicesScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const styles = useThemedStyles((c) => StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border },
    headerTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
    refreshIndicator: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center' },
    scrollView: { flex: 1 },
    scrollContent: { padding: 16 },
    submitCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: c.primaryLight, borderStyle: 'dashed' },
    submitIcon: { marginRight: 12 },
    submitContent: { flex: 1 },
    submitTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 2 },
    submitDescription: { fontSize: 12, color: c.textMuted },
    quickServicesCard: { backgroundColor: c.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12 },
    sectionTitle: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 10 },
    servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    serviceItem: { width: '30%', alignItems: 'center' },
    serviceIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
    serviceLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },
    tabContainer: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: 12, padding: 3, marginBottom: 12 },
    tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, gap: 4 },
    tabActive: { backgroundColor: c.primary },
    tabText: { fontSize: 11, fontWeight: '600', color: c.textMuted },
    tabTextActive: { color: c.surface },
    emptyState: { alignItems: 'center', paddingVertical: 40, backgroundColor: c.surface, borderRadius: 14 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 6 },
    emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', paddingHorizontal: 32 },
    requestCard: { backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: c.border, ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 2 } }) },
    requestCardPressed: { backgroundColor: c.surfaceSecondary },
    requestHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    requestIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    requestInfo: { flex: 1 },
    requestType: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 1 },
    requestDate: { fontSize: 11, color: c.textMuted },
    statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
    statusText: { fontSize: 11, fontWeight: '700' },
    requestDescription: { fontSize: 13, color: c.text, lineHeight: 18 },
    requestAttachments: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    attachmentText: { fontSize: 11, color: c.textMuted },
    urgencyBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 4 },
    urgencyText: { fontSize: 12, color: '#EF4444', fontWeight: '500' },
    bottomSpacer: { height: Platform.OS === 'ios' ? 140 : 120 },
    chatbotButton: { position: 'absolute', bottom: Platform.OS === 'ios' ? 120 : 100, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', ...Platform.select({ ios: { shadowColor: c.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 }, android: { elevation: 8 }, web: { boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)' } }) },
    modalContainer: { flex: 1 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
    modalSectionTitle: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 12, marginTop: 8 },
    typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    typeItem: { width: '23%', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, backgroundColor: c.surfaceSecondary },
    typeItemSelected: { backgroundColor: c.primaryLight, borderWidth: 1, borderColor: c.primary },
    typeIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
    typeLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },
    typeLabelSelected: { color: c.primary, fontWeight: '600' },
    urgencyOptions: { gap: 10, marginBottom: 16 },
    urgencyOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
    urgencyDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
    urgencyContent: { flex: 1 },
    urgencyLabel: { fontSize: 14, fontWeight: '600', color: c.text },
    urgencyDesc: { fontSize: 12, color: c.textMuted },
    descriptionInput: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 16, fontSize: 15, color: c.text, minHeight: 120, marginBottom: 20 },
    uploadPanel: { borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, borderRadius: 14, padding: 14, alignItems: 'center', gap: 8, backgroundColor: c.surfaceSecondary, marginBottom: 10 },
    uploadIcon: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, borderColor: c.border, justifyContent: 'center', alignItems: 'center', backgroundColor: c.surface },
    uploadTitle: { color: c.text, fontWeight: '800', fontSize: 15 },
    uploadSubtitle: { color: c.textMuted, fontSize: 12, textAlign: 'center' },
    uploadButtons: { width: '100%', gap: 10, marginTop: 4 },
    uploadBtn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
    uploadBtnText: { color: c.text, fontWeight: '700' },
    uploadNote: { color: c.textMuted, fontSize: 12, textAlign: 'center' },
    attachmentPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    previewChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.surfaceSecondary },
    previewText: { fontSize: 12, color: c.text },
    submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, borderRadius: 12, paddingVertical: 16, gap: 8, marginBottom: 20 },
    submitButtonDisabled: { opacity: 0.7 },
    submitButtonText: { color: c.surface, fontSize: 16, fontWeight: '600' },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: 14,
      marginBottom: 16,
      borderWidth: 1,
      ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } }),
    },
    bannerText: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text },
    bannerSuccess: { backgroundColor: '#ecfdf3', borderColor: '#bbf7d0' },
    bannerError: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
    bannerWarning: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
    fieldError: { color: '#b91c1c', fontSize: 12, marginBottom: 10 },
    confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
    confirmCard: { width: '84%', backgroundColor: c.surface, borderRadius: 16, padding: 20, gap: 10, ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 10 } }) },
    confirmTitle: { fontSize: 17, fontWeight: '700', color: c.text },
    confirmText: { fontSize: 14, color: c.textMuted, lineHeight: 20 },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
    confirmBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
    confirmCancel: { backgroundColor: c.surfaceSecondary },
    confirmDiscard: { backgroundColor: '#fee2e2' },
    confirmDiscardText: { color: '#b91c1c', fontWeight: '700' },
    confirmCancelText: { color: c.text, fontWeight: '700' },
  }));
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('active');

  const [selectedType, setSelectedType] = useState(null);
  const [selectedUrgency, setSelectedUrgency] = useState('normal');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [banner, setBanner] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({ type: '', description: '' });
  const [fieldTouched, setFieldTouched] = useState({ type: false, description: false });
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [attachmentUploadStatus, setAttachmentUploadStatus] = useState('');

  // Detail modal state
  const [detailRequest, setDetailRequest] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editType, setEditType] = useState(null);
  const [editUrgency, setEditUrgency] = useState('normal');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenNote, setReopenNote] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [replyUploadStatus, setReplyUploadStatus] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const bannerTimerRef = useRef(null);
  const isDirty = useMemo(() => Boolean(selectedType) || description.trim().length > 0 || attachments.length > 0, [attachments.length, description, selectedType]);
  const createFormErrors = useMemo(() => ({
    type: selectedType ? '' : 'Please select a service type',
    description: description.trim().length < MIN_DESCRIPTION_LENGTH ? `Please describe your concern (min ${MIN_DESCRIPTION_LENGTH} characters)` : '',
  }), [description, selectedType]);
  const isCreateFormValid = !createFormErrors.type && !createFormErrors.description;

  const showBannerMessage = useCallback((type, text, { withToast = true } = {}) => {
    setBanner({ type, text });

    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }

    bannerTimerRef.current = setTimeout(() => {
      setBanner(null);
      bannerTimerRef.current = null;
    }, 3200);

    if (withToast) {
      const title =
        type === 'success'
          ? 'Success'
          : type === 'error'
            ? 'Something Went Wrong'
            : type === 'warning'
              ? 'Check Your Form'
              : 'Notice';
      showToast({ type, title, message: text });
    }
  }, [showToast]);

  const renderBanner = () => {
    if (!banner) return null;

    return (
      <View style={[styles.banner, banner.type === 'success' && styles.bannerSuccess, banner.type === 'error' && styles.bannerError, banner.type === 'warning' && styles.bannerWarning]}>
        <Ionicons
          name={banner.type === 'success' ? 'checkmark-circle' : banner.type === 'error' ? 'alert-circle' : 'information-circle'}
          size={18}
          color={banner.type === 'success' ? '#15803d' : banner.type === 'error' ? '#b91c1c' : '#92400e'}
        />
        <Text style={styles.bannerText}>{banner.text}</Text>
        <TouchableOpacity onPress={() => setBanner(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setFieldErrors({
      type: hasAttemptedSubmit || fieldTouched.type ? createFormErrors.type : '',
      description: hasAttemptedSubmit || fieldTouched.description ? createFormErrors.description : '',
    });
  }, [createFormErrors, fieldTouched.description, fieldTouched.type, hasAttemptedSubmit]);

  useEffect(() => {
    if (!detailRequest?.request_id) return;
    const latestDetail = requests.find((request) => request.request_id === detailRequest.request_id);
    if (latestDetail) {
      setDetailRequest((prev) => ({
        ...prev,
        ...latestDetail,
        thread: prev?.thread || latestDetail.thread,
        tenant_summary: prev?.tenant_summary || latestDetail.tenant_summary,
        tenantSummary: prev?.tenantSummary || latestDetail.tenantSummary,
      }));
    }
  }, [detailRequest?.request_id, requests]);

  const confirmCloseModal = () => {
    if (!isDirty && !hasAttemptedSubmit) { setShowModal(false); return; }
    setShowDiscardConfirm(true);
  };

  const fetchRequests = useCallback(async () => {
    try {
      const response = await apiService.getMyMaintenance();
      // Force new array to trigger rerender even if values are identical
      const nextRequests = [...unwrapMaintenanceRequests(response)].sort((a, b) => {
        const aTime = new Date(a.latestActivityAt || a.lastActivityAt || a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.latestActivityAt || b.lastActivityAt || b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      });
      setRequests(nextRequests);
    } catch (error) {
      console.error('Fetch requests error:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useFocusEffect(
    useCallback(() => {
      // Refresh immediately when tab gains focus
      fetchRequests();
      // Also poll while this tab is focused
      const interval = setInterval(() => { fetchRequests(); }, 60000);
      return () => clearInterval(interval);
    }, [fetchRequests])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRequests();
  }, [fetchRequests]);

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    const nextErrors = createFormErrors;
    setFieldTouched({ type: true, description: true });
    setFieldErrors(nextErrors);
    if (nextErrors.type || nextErrors.description) {
      showBannerMessage('warning', 'Please complete the required fields before submitting.', { withToast: false });
      return;
    }

    setSubmitting(true);
    setAttachmentUploadStatus(attachments.length ? 'Uploading attachment...' : '');
    try {
      const tempRequestId = `maintenance-${Date.now()}`;
      const uploadedAttachments = await ensureFirebaseStorageAttachments(attachments, {
        allowedMimeTypes: DEFAULT_UPLOAD_MIME_TYPES,
        entityId: tempRequestId,
        folder: 'maintenance-attachments',
        maxBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
        tenantId: user?.user_id || user?.id || 'unknown-tenant',
      });
      setAttachments(uploadedAttachments);
      if (uploadedAttachments.length) {
        setAttachmentUploadStatus('Attachment uploaded');
      }
      const payload = {
        request_type: selectedType,
        description: description.trim(),
        urgency: selectedUrgency,
        attachments: uploadedAttachments.map(toStoredAttachmentMetadata),
      };
      await apiService.createMaintenance(payload);
      showBannerMessage('success', 'Maintenance request submitted successfully.');
      setShowModal(false);
      resetForm();
      fetchRequests();
    } catch (error) {
      setAttachmentUploadStatus(attachments.length ? 'Upload failed, please retry' : '');
      const message = error?.message === 'Upload failed, please retry'
        ? 'Upload failed, please retry'
        : getApiErrorMessage(error, 'Failed to submit request. Please try again.');
      showBannerMessage('error', message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedType(null);
    setSelectedUrgency('normal');
    setDescription('');
    setAttachments([]);
    setAttachmentUploadStatus('');
    setFieldTouched({ type: false, description: false });
    setFieldErrors({ type: '', description: '' });
    setHasAttemptedSubmit(false);
  };

  const discardAndClose = () => {
    resetForm();
    setShowModal(false);
    setShowDiscardConfirm(false);
  };

  const handleAttach = async (pickerFn) => {
    try {
      const file = await pickerFn();
      if (!file) return;
      const supported = isImageAttachmentCandidate(file) || isDocumentAttachmentCandidate(file);
      if (!supported) {
        showBannerMessage('error', 'Please select an image, PDF, document, text, or CSV file.');
        return;
      }
      const maxBytes = isImageAttachmentCandidate(file) ? MAX_IMAGE_UPLOAD_BYTES : MAX_ATTACHMENT_UPLOAD_BYTES;
      if (file.size && file.size > maxBytes) {
        showBannerMessage('error', `Attachment exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
        return;
      }
      setAttachmentUploadStatus('');
      setAttachments((prev) => {
        if (prev.length >= MAX_MAINTENANCE_ATTACHMENTS) {
          showBannerMessage('error', `You can upload up to ${MAX_MAINTENANCE_ATTACHMENTS} photos only.`);
          return prev;
        }
        return [...prev, file];
      });
    } catch (err) {
      showBannerMessage('error', err?.message || 'Unable to add attachment.');
    }
  };

  const removeAttachment = (name) => {
    setAttachmentUploadStatus('');
    setAttachments((prev) => prev.filter((item) => getAttachmentDisplayName(item) !== name));
  };

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'viewed': return { bg: '#E0E7FF', text: '#6366F1', label: 'Viewed', icon: 'eye' };
      case 'in_progress': case 'in process': return { bg: '#DBEAFE', text: '#3B82F6', label: 'In Progress', icon: 'construct' };
      case 'assigned': return { bg: '#EDE9FE', text: '#7C3AED', label: 'Assigned', icon: 'person' };
      case 'scheduled': return { bg: '#ECFEFF', text: '#0891B2', label: 'Scheduled', icon: 'calendar' };
      case 'resolved': return { bg: '#D1FAE5', text: '#059669', label: 'Resolved', icon: 'checkmark-done-circle' };
      case 'completed': return { bg: '#DCFCE7', text: '#22C55E', label: 'Completed', icon: 'checkmark-circle' };
      case 'rejected': return { bg: '#FEE2E2', text: '#DC2626', label: 'Rejected', icon: 'close-circle' };
      case 'cancelled': return { bg: '#F3F4F6', text: '#9CA3AF', label: 'Cancelled', icon: 'ban' };
      case 'pending': return { bg: '#FEF3C7', text: '#F59E0B', label: 'Pending', icon: 'time' };
      default: return { bg: '#F3F4F6', text: '#6B7280', label: status || 'Pending', icon: 'help-circle' };
    }
  };

  const getTypeInfo = (type) => REQUEST_TYPES.find(t => t.id === type) || REQUEST_TYPES[7];

  // --- Detail modal handlers ---
  const openDetail = async (request) => {
    setDetailRequest(request);
    setEditMode(false);
    setShowCancelConfirm(false);
    setShowReopenModal(false);
    setReopenNote('');
    setReplyMessage('');
    setReplyAttachments([]);
    setReplyUploadStatus('');
    setShowDetailModal(true);
    setDetailLoading(true);
    try {
      const response = await apiService.getMaintenance(request.request_id);
      const detail = unwrapMaintenanceRequest(response, request);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const thread = buildRequestProgress(detail);
        console.log('[Maintenance detail]', {
          requestId: detail?.request_id,
          threadCount: thread.length,
          replyAttachmentCount: thread.reduce((count, entry) => count + (Array.isArray(entry.attachments) ? entry.attachments.length : 0), 0),
        });
      }
      setDetailRequest(detail);
      const readResponse = await apiService.markMaintenanceRead(request.request_id).catch(() => null);
      const readDetail = unwrapMaintenanceRequest(readResponse, null);
      if (readDetail) {
        setDetailRequest(readDetail);
      }
      fetchRequests();
    } catch (error) {
      showBannerMessage('error', getApiErrorMessage(error, 'Failed to load maintenance details.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const enterEditMode = () => {
    if (!detailRequest) return;
    setEditType(detailRequest.request_type);
    setEditUrgency(detailRequest.urgency || 'normal');
    setEditDescription(detailRequest.description || '');
    setEditMode(true);
  };

  const saveEdit = async () => {
    if (!editDescription.trim() || editDescription.trim().length < MIN_DESCRIPTION_LENGTH) {
      showBannerMessage('warning', `Description must be at least ${MIN_DESCRIPTION_LENGTH} characters.`, { withToast: false });
      return;
    }
    setSaving(true);
    try {
      await apiService.updateMaintenance(detailRequest.request_id, {
        request_type: editType,
        urgency: editUrgency,
        description: editDescription.trim(),
      });
      showBannerMessage('success', 'Maintenance request updated successfully.');
      setEditMode(false);
      setShowDetailModal(false);
      fetchRequests();
    } catch (e) {
      showBannerMessage('error', getApiErrorMessage(e, 'Failed to update request.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    setSaving(true);
    try {
      await apiService.cancelMaintenance(detailRequest.request_id);
      showBannerMessage('success', 'Request cancelled successfully.');
      setShowCancelConfirm(false);
      setShowDetailModal(false);
      fetchRequests();
    } catch (e) {
      showBannerMessage('error', getApiErrorMessage(e, 'Failed to cancel request. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    setSaving(true);
    try {
      await apiService.reopenMaintenance(detailRequest.request_id, { reopen_note: reopenNote.trim() || undefined });
      showBannerMessage('success', 'Maintenance request reopened successfully.');
      setShowReopenModal(false);
      setShowDetailModal(false);
      setReopenNote('');
      fetchRequests();
    } catch (e) {
      showBannerMessage('error', getApiErrorMessage(e, 'Failed to reopen request. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmResolved = async () => {
    if (!detailRequest?.request_id) return;
    setSaving(true);
    try {
      const response = await apiService.confirmMaintenanceResolved(detailRequest.request_id);
      setDetailRequest(unwrapMaintenanceRequest(response, detailRequest));
      showBannerMessage('success', 'Resolution confirmed.');
      fetchRequests();
    } catch (e) {
      showBannerMessage('error', getApiErrorMessage(e, 'Failed to confirm resolution.'));
    } finally {
      setSaving(false);
    }
  };

  const handleReplyAttach = async (pickerFn) => {
    try {
      const file = await pickerFn();
      if (!file) return;
      const supported = isImageAttachmentCandidate(file) || isDocumentAttachmentCandidate(file);
      if (!supported) {
        showBannerMessage('error', 'Please select an image, PDF, document, text, or CSV file.');
        return;
      }
      const maxBytes = isImageAttachmentCandidate(file) ? MAX_IMAGE_UPLOAD_BYTES : MAX_ATTACHMENT_UPLOAD_BYTES;
      if (file.size && file.size > maxBytes) {
        showBannerMessage('error', `Attachment exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
        return;
      }
      setReplyAttachments((prev) => {
        if (prev.length >= MAX_MAINTENANCE_ATTACHMENTS) {
          showBannerMessage('error', `You can upload up to ${MAX_MAINTENANCE_ATTACHMENTS} files only.`);
          return prev;
        }
        return [...prev, file];
      });
    } catch (err) {
      showBannerMessage('error', err?.message || 'Unable to add attachment.');
    }
  };

  const removeReplyAttachment = (name) => {
    setReplyAttachments((prev) => prev.filter((item) => getAttachmentDisplayName(item) !== name));
  };

  const sendMaintenanceReply = async () => {
    if (!detailRequest?.request_id) return;
    if (!replyMessage.trim() && replyAttachments.length === 0) {
      showBannerMessage('warning', 'Add a message or attachment before sending.', { withToast: false });
      return;
    }

    setSendingReply(true);
    setReplyUploadStatus(replyAttachments.length ? 'Uploading attachments...' : '');
    try {
      const uploadedAttachments = await ensureFirebaseStorageAttachments(replyAttachments, {
        allowedMimeTypes: DEFAULT_UPLOAD_MIME_TYPES,
        entityId: detailRequest.request_id,
        folder: 'maintenance-followups',
        maxBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
        tenantId: user?.user_id || user?.id || 'unknown-tenant',
      });
      const response = await apiService.sendMaintenanceReply(detailRequest.request_id, {
        message: replyMessage.trim(),
        attachments: uploadedAttachments.map(toStoredAttachmentMetadata),
      });
      setDetailRequest(unwrapMaintenanceRequest(response, detailRequest));
      setReplyMessage('');
      setReplyAttachments([]);
      setReplyUploadStatus('');
      showBannerMessage('success', 'Follow-up sent.');
      fetchRequests();
    } catch (error) {
      setReplyUploadStatus(replyAttachments.length ? 'Upload failed, please retry' : '');
      showBannerMessage('error', getApiErrorMessage(error, error?.message || 'Failed to send follow-up.'));
    } finally {
      setSendingReply(false);
    }
  };

  const openAttachment = async (attachment) => {
    const url = getAttachmentDownloadUrl(attachment);
    if (!url) {
      showBannerMessage('error', 'Attachment link is unavailable.');
      return;
    }
    if (isImageAttachment(attachment)) {
      setPreviewAttachment(attachment);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      showBannerMessage('error', 'This attachment cannot be opened on this device.');
      return;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('Unsupported URL');
      await Linking.openURL(url);
    } catch (_) {
      showBannerMessage('error', 'Unable to open this attachment.');
    }
  };

  const submitSimilar = () => {
    if (!detailRequest) return;
    setShowDetailModal(false);
    setSelectedType(detailRequest.request_type);
    setSelectedUrgency(detailRequest.urgency || 'normal');
    setDescription(detailRequest.description || '');
    setShowModal(true);
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filterBySearch = useCallback((list) => {
    if (!normalizedSearchQuery) return list;
    return list.filter((request) => {
      const typeLabel = getTypeInfo(request.request_type).label.toLowerCase();
      return typeLabel.includes(normalizedSearchQuery) || (request.description || '').toLowerCase().includes(normalizedSearchQuery);
    });
  }, [normalizedSearchQuery]);
  const activeRequests = useMemo(() => filterBySearch(requests.filter((request) => ACTIVE_STATUSES.includes((request.status || 'pending').toLowerCase()))), [filterBySearch, requests]);
  const resolvedRequests = useMemo(() => filterBySearch(requests.filter((request) => RESOLVED_STATUSES.includes((request.status || '').toLowerCase()))), [filterBySearch, requests]);
  const cancelledRequests = useMemo(() => filterBySearch(requests.filter((request) => (request.status || '').toLowerCase() === 'cancelled')), [filterBySearch, requests]);
  const detailProgressEntries = useMemo(() => buildRequestProgress(detailRequest), [detailRequest]);
  const detailTenantSummary = useMemo(() => detailRequest?.tenant_summary || detailRequest?.tenantSummary || null, [detailRequest]);
  const hasConversationSummary = useMemo(() => detailProgressEntries.some((entry) => entry.isSummary), [detailProgressEntries]);
  const currentList = useMemo(() => {
    if (activeTab === 'resolved') return resolvedRequests;
    if (activeTab === 'cancelled') return cancelledRequests;
    return activeRequests;
  }, [activeRequests, activeTab, cancelledRequests, resolvedRequests]);
  const totalUnreadMaintenance = useMemo(() => requests.reduce((sum, request) => sum + Number(request.unreadTenantCount || 0), 0), [requests]);

  if (isLoading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Services & Inquiries</Text>
          {totalUnreadMaintenance > 0 ? (
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 2 }}>{totalUnreadMaintenance} maintenance update{totalUnreadMaintenance > 1 ? 's' : ''} unread</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.refreshIndicator}
          onPress={() => { setRefreshing(true); fetchRequests(); }}
          accessibilityLabel="Refresh service requests"
        >
          <Ionicons name="sync" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />} showsVerticalScrollIndicator={false}>
        {!showModal ? renderBanner() : null}

        <TouchableOpacity style={styles.submitCard} onPress={() => setShowModal(true)}>
          <View style={styles.submitIcon}><Ionicons name="add-circle" size={32} color={colors.primary} /></View>
          <View style={styles.submitContent}>
            <Text style={styles.submitTitle}>Submit New Inquiry</Text>
            <Text style={styles.submitDescription}>Report issues, request maintenance, or send concerns</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.quickServicesCard}>
          <Text style={styles.sectionTitle}>Quick Service Request</Text>
          <View style={styles.servicesGrid}>
            {REQUEST_TYPES.slice(0, 6).map((type) => (
              <TouchableOpacity key={type.id} style={styles.serviceItem} onPress={() => { setSelectedType(type.id); setShowModal(true); }}>
                <View style={[styles.serviceIcon, { backgroundColor: `${type.color}15` }]}>
                  <Ionicons name={type.icon} size={24} color={type.color} />
                </View>
                <Text style={styles.serviceLabel}>{type.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 10 }}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 13, color: colors.text }}
            placeholder="Search requests..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'active' && styles.tabActive]} onPress={() => setActiveTab('active')}>
            <Ionicons name="time-outline" size={15} color={activeTab === 'active' ? colors.surface : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>Active ({activeRequests.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'resolved' && styles.tabActive]} onPress={() => setActiveTab('resolved')}>
            <Ionicons name="checkmark-circle-outline" size={15} color={activeTab === 'resolved' ? colors.surface : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'resolved' && styles.tabTextActive]}>Resolved ({resolvedRequests.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'cancelled' && styles.tabActive]} onPress={() => setActiveTab('cancelled')}>
            <Ionicons name="close-circle-outline" size={15} color={activeTab === 'cancelled' ? colors.surface : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'cancelled' && styles.tabTextActive]}>Cancelled ({cancelledRequests.length})</Text>
          </TouchableOpacity>
        </View>

        {currentList.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name={activeTab === 'active' ? 'construct-outline' : activeTab === 'resolved' ? 'checkmark-done-circle' : 'close-circle-outline'} size={36} color={activeTab === 'active' ? colors.primary : activeTab === 'resolved' ? '#22C55E' : '#9CA3AF'} />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'active' ? 'No Active Requests' : activeTab === 'resolved' ? 'No Resolved Requests' : 'No Cancelled Requests'}
              </Text>
              <Text style={styles.emptyText}>
                {activeTab === 'active' ? 'You have no pending or in-progress requests. Tap above to submit one!' : activeTab === 'resolved' ? 'Resolved requests will appear here.' : 'You haven\u2019t cancelled any requests.'}
              </Text>
            </View>
        ) : currentList.map((request) => {
          const typeInfo = getTypeInfo(request.request_type);
          const statusColor = getStatusColor(request.status);
          const urgencyInfo = URGENCY_LEVELS.find(u => u.id === request.urgency) || URGENCY_LEVELS[1];
          const unreadCount = Number(request.unreadTenantCount || 0);
          const latestUpdate = request.latestTenantVisibleUpdate || null;
          const lastActivity = request.latestActivityAt || request.lastActivityAt || request.updated_at || request.created_at;
          const hasNewAttachment = latestUpdate?.hasAttachments;
          const locationParts = [request.branch, request.room_id || request.roomId].filter(Boolean);
          return (
            <TouchableOpacity key={request.request_id} style={[styles.requestCard, { borderLeftColor: unreadCount > 0 ? colors.primary : typeInfo.color }]} onPress={() => openDetail(request)} activeOpacity={0.85}>
              <View style={styles.requestHeader}>
                <View style={[styles.requestIcon, { backgroundColor: `${typeInfo.color}15` }]}>
                  <Ionicons name={typeInfo.icon} size={20} color={typeInfo.color} />
                </View>
                <View style={styles.requestInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.requestType}>{typeInfo.label}</Text>
                    {unreadCount > 0 ? (
                      <View style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ color: colors.surface, fontSize: 9, fontWeight: '800' }}>{unreadCount > 9 ? '9+' : unreadCount} new</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.requestDate}>Last update {safeFormat(lastActivity, 'MMM dd, yyyy \u2022 h:mm a')}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusColor.bg, borderColor: `${statusColor.text}30` }]}>
                  <Text style={[styles.statusText, { color: statusColor.text }]}>{statusColor.label}</Text>
                </View>
              </View>
              <Text style={styles.requestDescription} numberOfLines={2}>{request.description}</Text>
              {locationParts.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 }}>
                  <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                  <Text style={{ fontSize: 10, color: colors.textMuted }} numberOfLines={1}>{locationParts.join(' / ')}</Text>
                </View>
              ) : null}
              {latestUpdate ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: unreadCount > 0 ? '#EFF6FF' : colors.surfaceSecondary, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9 }}>
                  <Ionicons name={hasNewAttachment ? 'attach' : 'chatbubble-ellipses-outline'} size={13} color={unreadCount > 0 ? '#2563EB' : colors.textMuted} />
                  <Text style={{ flex: 1, fontSize: 11, color: unreadCount > 0 ? '#1D4ED8' : colors.textMuted, fontWeight: unreadCount > 0 ? '700' : '500' }} numberOfLines={1}>
                    {unreadCount > 0 ? (hasNewAttachment ? 'New attachment available' : latestUpdate.senderRole === 'tenant' ? 'New update available' : 'Admin replied') : latestUpdate.preview}
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: urgencyInfo.color }} />
                    <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '500' }}>{urgencyInfo.label}</Text>
                  </View>
                  {(request.attachments?.length || latestUpdate?.attachmentCount) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Ionicons name="attach" size={12} color={colors.textMuted} />
                      <Text style={{ fontSize: 10, color: colors.textMuted }}>{(request.attachments?.length || 0) + (latestUpdate?.attachmentCount || 0)}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>View details</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <Link href="/(tabs)/chatbot" prefetch asChild>
        <TouchableOpacity style={styles.chatbotButton}>
          <LilyFlowerIcon size={26} />
        </TouchableOpacity>
      </Link>

      <Modal visible={showModal} animationType="slide" transparent={true} onRequestClose={confirmCloseModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Submit Inquiry</Text>
                <TouchableOpacity onPress={confirmCloseModal}><Ionicons name="close" size={24} color={colors.textMuted} /></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {showModal ? renderBanner() : null}
                <Text style={styles.modalSectionTitle}>Select Service Type</Text>
                <View style={styles.typeGrid}>
                  {REQUEST_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type.id}
                      style={[styles.typeItem, selectedType === type.id && styles.typeItemSelected]}
                      onPress={() => {
                        setSelectedType(type.id);
                        setFieldTouched((prev) => ({ ...prev, type: true }));
                      }}
                    >
                      <View style={[styles.typeIcon, { backgroundColor: selectedType === type.id ? type.color : `${type.color}15` }]}>
                        <Ionicons name={type.icon} size={20} color={selectedType === type.id ? '#FFFFFF' : type.color} />
                      </View>
                      <Text style={[styles.typeLabel, selectedType === type.id && styles.typeLabelSelected]}>{type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {fieldErrors.type ? <Text style={styles.fieldError}>{fieldErrors.type}</Text> : null}
                <Text style={styles.modalSectionTitle}>Urgency Level</Text>
                <View style={styles.urgencyOptions}>
                  {URGENCY_LEVELS.map((level) => (
                    <TouchableOpacity key={level.id} style={[styles.urgencyOption, selectedUrgency === level.id && { borderColor: level.color, borderWidth: 2 }]} onPress={() => setSelectedUrgency(level.id)}>
                      <View style={[styles.urgencyDot, { backgroundColor: level.color }]} />
                      <View style={styles.urgencyContent}><Text style={styles.urgencyLabel}>{level.label}</Text><Text style={styles.urgencyDesc}>{level.description}</Text></View>
                      {selectedUrgency === level.id && <Ionicons name="checkmark-circle" size={22} color={level.color} />}
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.modalSectionTitle}>Describe Your Concern</Text>
                <TextInput
                  style={[styles.descriptionInput, fieldErrors.description && { borderColor: '#fca5a5', borderWidth: 1 }]}
                  placeholder="Please provide details..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  value={description}
                  onChangeText={(val) => {
                    setDescription(val);
                  }}
                  onBlur={() => setFieldTouched((prev) => ({ ...prev, description: true }))}
                />
                {fieldErrors.description ? <Text style={styles.fieldError}>{fieldErrors.description}</Text> : null}
                <Text style={styles.modalSectionTitle}>Add Attachments (optional)</Text>
                <View style={styles.uploadPanel}>
                  <View style={styles.uploadIcon}><Ionicons name="cloud-upload" size={28} color={colors.textMuted} /></View>
                  <Text style={styles.uploadTitle}>Upload Files</Text>
                  <Text style={styles.uploadSubtitle}>Add supporting photos or documents</Text>
                  <View style={styles.uploadButtons}>
                    <TouchableOpacity style={styles.uploadBtn} onPress={() => handleAttach(pickFromCamera)} disabled={submitting}>
                      <Text style={styles.uploadBtnText}>Take Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.uploadBtn} onPress={() => handleAttach(pickFromLibrary)} disabled={submitting}>
                      <Text style={styles.uploadBtnText}>Choose from Gallery</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.uploadBtn} onPress={() => handleAttach(pickDocument)} disabled={submitting}>
                      <Text style={styles.uploadBtnText}>Choose Document</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.uploadNote}>Accepted: JPG, PNG • Max size: 5MB</Text>
                  {attachmentUploadStatus ? (
                    <Text style={styles.uploadNote}>{attachmentUploadStatus}</Text>
                  ) : null}
                </View>
                {attachments.length > 0 && (
                  <View style={styles.attachmentPreview}>
                    {attachments.map((file) => (
                      <TouchableOpacity
                        key={getAttachmentDisplayName(file)}
                        style={styles.previewChip}
                        onLongPress={() => removeAttachment(getAttachmentDisplayName(file))}
                      >
                        <Text style={styles.previewText}>{getAttachmentDisplayName(file)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.submitButton, (submitting || !isCreateFormValid) && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={submitting || !isCreateFormValid}
                >
                  {submitting ? <ActivityIndicator color={colors.surface} /> : <><Ionicons name="send" size={20} color={colors.surface} /><Text style={styles.submitButtonText}>Submit Request</Text></>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDiscardConfirm} transparent animationType="fade" onRequestClose={() => setShowDiscardConfirm(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Discard this inquiry?</Text>
            <Text style={styles.confirmText}>Your current selections and description will be lost. This cannot be undone.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancel]} onPress={() => setShowDiscardConfirm(false)}>
                <Text style={styles.confirmCancelText}>Keep Editing</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmDiscard]} onPress={discardAndClose}>
                <Text style={styles.confirmDiscardText}>Discard</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ===== REQUEST DETAIL MODAL ===== */}
      <Modal visible={showDetailModal} animationType="slide" transparent onRequestClose={() => { setEditMode(false); setShowDetailModal(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '92%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editMode ? 'Edit Request' : 'Request Details'}</Text>
                <TouchableOpacity onPress={() => { setEditMode(false); setShowDetailModal(false); }}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {detailRequest && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {detailLoading ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={{ color: colors.textMuted, fontSize: 13 }}>Loading latest updates...</Text>
                    </View>
                  ) : null}
                  {/* Status Timeline */}
                  {!editMode && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, paddingHorizontal: 4 }}>
                      {STATUS_STEPS.map((step, i) => {
                        const currentIdx = STATUS_STEPS.indexOf((detailRequest.status || '').toLowerCase());
                        const isActive = i <= currentIdx;
                        const isCurrent = i === currentIdx;
                        const stepLabel = step === 'in_progress' ? 'In Progress' : step.charAt(0).toUpperCase() + step.slice(1);
                        return (
                          <View key={step} style={{ flex: 1, alignItems: 'center' }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isActive ? colors.primary : colors.surfaceSecondary, justifyContent: 'center', alignItems: 'center', borderWidth: isCurrent ? 2 : 0, borderColor: isCurrent ? colors.primary : 'transparent' }}>
                              {isActive ? <Ionicons name="checkmark" size={14} color={colors.surface} /> : <Text style={{ fontSize: 10, color: colors.textMuted }}>{i + 1}</Text>}
                            </View>
                            <Text style={{ fontSize: 9, color: isActive ? colors.primary : colors.textMuted, marginTop: 4, textAlign: 'center' }}>{stepLabel}</Text>
                            {i < STATUS_STEPS.length - 1 && (
                              <View style={{ position: 'absolute', top: 13, left: '60%', right: '-40%', height: 2, backgroundColor: isActive && i < currentIdx ? colors.primary : colors.surfaceSecondary }} />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Header info */}
                  {(() => {
                    const ti = getTypeInfo(detailRequest.request_type);
                    const sc = getStatusColor(detailRequest.status);
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                        <View style={[styles.requestIcon, { backgroundColor: `${ti.color}15` }]}>
                          <Ionicons name={ti.icon} size={24} color={ti.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.requestType}>{ti.label}</Text>
                          <Text style={styles.requestDate}>{safeFormat(detailRequest.created_at, 'MMM dd, yyyy • h:mm a')}</Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                          <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                        </View>
                      </View>
                    );
                  })()}

                  {/* Estimated Resolution */}
                  {!editMode && !['resolved', 'completed', 'rejected', 'cancelled'].includes((detailRequest.status || '').toLowerCase()) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                      <Ionicons name="timer-outline" size={18} color="#2563EB" />
                      <Text style={{ fontSize: 13, color: '#1e40af', fontWeight: '500' }}>Estimated: {RESOLUTION_ESTIMATES[detailRequest.urgency] || RESOLUTION_ESTIMATES.normal}</Text>
                    </View>
                  )}

                  {!editMode && (
                    <View style={{ backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Ionicons name={getStatusColor(detailRequest.status).icon} size={18} color={getStatusColor(detailRequest.status).text} />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>Current Status</Text>
                      </View>
                      <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20, fontWeight: '600' }}>{getStatusNextStep(detailRequest.status, detailRequest)}</Text>
                      <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 19, marginTop: 4 }}>{getNextStepDetail(detailRequest.status, detailRequest)}</Text>
                    </View>
                  )}

                  {/* Urgency */}
                  {!editMode && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: (URGENCY_LEVELS.find(u => u.id === detailRequest.urgency) || URGENCY_LEVELS[1]).color }} />
                      <Text style={{ fontSize: 13, color: colors.text, fontWeight: '500' }}>Urgency: {(URGENCY_LEVELS.find(u => u.id === detailRequest.urgency) || URGENCY_LEVELS[1]).label}</Text>
                    </View>
                  )}

                  {/* Description */}
                  {editMode ? (
                    <>
                      <Text style={styles.modalSectionTitle}>Service Type</Text>
                      <View style={styles.typeGrid}>
                        {REQUEST_TYPES.map((type) => (
                          <TouchableOpacity key={type.id} style={[styles.typeItem, editType === type.id && styles.typeItemSelected]} onPress={() => setEditType(type.id)}>
                            <View style={[styles.typeIcon, { backgroundColor: editType === type.id ? type.color : `${type.color}15` }]}>
                              <Ionicons name={type.icon} size={20} color={editType === type.id ? '#FFFFFF' : type.color} />
                            </View>
                            <Text style={[styles.typeLabel, editType === type.id && styles.typeLabelSelected]}>{type.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.modalSectionTitle}>Urgency Level</Text>
                      <View style={styles.urgencyOptions}>
                        {URGENCY_LEVELS.map((level) => (
                          <TouchableOpacity key={level.id} style={[styles.urgencyOption, editUrgency === level.id && { borderColor: level.color, borderWidth: 2 }]} onPress={() => setEditUrgency(level.id)}>
                            <View style={[styles.urgencyDot, { backgroundColor: level.color }]} />
                            <View style={styles.urgencyContent}><Text style={styles.urgencyLabel}>{level.label}</Text><Text style={styles.urgencyDesc}>{level.description}</Text></View>
                            {editUrgency === level.id && <Ionicons name="checkmark-circle" size={22} color={level.color} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.modalSectionTitle}>Description</Text>
                      <TextInput style={styles.descriptionInput} placeholder="Describe your concern..." placeholderTextColor={colors.textMuted} multiline numberOfLines={4} textAlignVertical="top" value={editDescription} onChangeText={setEditDescription} />
                    </>
                  ) : (
                    <View style={{ marginBottom: 14, backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 }}>Request Summary</Text>
                      <View style={{ gap: 8, marginBottom: 12 }}>
                        {[
                          ['Request ID', detailRequest.request_id],
                          ['Submitted', safeFormat(detailRequest.created_at || detailRequest.createdAt, 'MMM dd, yyyy \u2022 h:mm a')],
                          ['Branch', detailRequest.branch || 'Not specified'],
                          ['Room / Unit', detailRequest.room_id || detailRequest.roomId || 'Not specified'],
                        ].map(([label, value]) => (
                          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                            <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>{label}</Text>
                            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700', flex: 1.4, textAlign: 'right' }} numberOfLines={2}>{value}</Text>
                          </View>
                        ))}
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 5 }}>Original Description</Text>
                      <Text style={{ fontSize: 14, color: colors.text, lineHeight: 22 }}>{detailRequest.description}</Text>
                    </View>
                  )}

                  {!editMode && detailTenantSummary && !hasConversationSummary && (
                    <View style={{ backgroundColor: '#FFF7ED', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#FED7AA' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <Ionicons name="reader-outline" size={18} color="#C2410C" />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: '#9A3412' }}>Maintenance Summary</Text>
                      </View>
                      {[
                        ['Current status', formatStatusLabel(detailTenantSummary.current_status)],
                        ['Action taken', detailTenantSummary.action_taken],
                        ['Assigned provider', detailTenantSummary.assigned_provider],
                        ['Schedule', detailTenantSummary.schedule],
                        ['Next step', detailTenantSummary.next_step],
                        ['Completion note', detailTenantSummary.completion_note],
                      ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                        <View key={label} style={{ marginBottom: 8 }}>
                          <Text style={{ fontSize: 11, color: '#9A3412', fontWeight: '800', textTransform: 'uppercase' }}>{label}</Text>
                          <Text style={{ fontSize: 13, color: '#7C2D12', lineHeight: 19 }}>{value}</Text>
                        </View>
                      ))}
                      {detailTenantSummary.attachments?.length ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                          {detailTenantSummary.attachments.map((att, idx) => (
                            <TouchableOpacity key={`${getAttachmentDisplayName(att, idx)}_${idx}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFEDD5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }} onPress={() => openAttachment(att)}>
                              <Ionicons name={isImageAttachment(att) ? 'image-outline' : 'document-outline'} size={13} color="#C2410C" />
                              <Text style={{ fontSize: 11, color: '#9A3412', fontWeight: '700' }} numberOfLines={1}>{getAttachmentDisplayName(att, idx)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )}

                  {/* Conversation */}
                  {!editMode && detailProgressEntries.length > 0 && (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 8 }}>Conversation</Text>
                      <View style={{ gap: 12 }}>
                        {detailProgressEntries.map((entry) => (
                          <View key={entry.id} style={{ alignSelf: entry.isTenant ? 'flex-end' : 'flex-start', maxWidth: '92%', backgroundColor: entry.isTenant ? '#DCFCE7' : colors.surfaceSecondary, borderRadius: 14, borderTopRightRadius: entry.isTenant ? 4 : 14, borderTopLeftRadius: entry.isTenant ? 14 : 4, padding: 12, borderWidth: 1, borderColor: entry.isTenant ? '#BBF7D0' : colors.border }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: entry.message ? 6 : 0 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 12, fontWeight: '800', color: entry.isTenant ? '#166534' : colors.text }}>{entry.actorLabel || (entry.isTenant ? 'You' : 'Branch Admin')}</Text>
                                {entry.isSummary ? (
                                  <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Maintenance Summary</Text>
                                ) : null}
                              </View>
                              {entry.timestamp ? (
                                <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: 'right' }}>
                                  {safeFormat(entry.timestamp, 'MMM dd, yyyy • h:mm a')}
                                </Text>
                              ) : null}
                            </View>
                            {entry.message ? (
                              <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>{entry.message}</Text>
                            ) : null}
                            {entry.attachments?.length > 0 ? (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                                <View style={{ flexDirection: 'row' }}>
                                  {entry.attachments.map((att, idx) => (
                                    <TouchableOpacity
                                      key={`${getAttachmentDownloadUrl(att) || 'attachment'}_${idx}`}
                                      style={{ width: isImageAttachment(att) ? 180 : 132, height: isImageAttachment(att) ? 128 : 96, borderRadius: 12, backgroundColor: colors.surface, marginRight: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#D1D5DB', justifyContent: 'center', alignItems: 'center' }}
                                      activeOpacity={0.85}
                                      onPress={() => openAttachment(att)}
                                    >
                                      {getAttachmentDownloadUrl(att) && isImageAttachment(att) ? (
                                        <Image source={{ uri: getAttachmentDownloadUrl(att) }} style={{ width: 180, height: 128 }} resizeMode="cover" onError={() => showBannerMessage('error', 'Attachment preview could not be loaded.')} />
                                      ) : (
                                        <View style={{ paddingHorizontal: 8, alignItems: 'center', gap: 6 }}>
                                          <Ionicons name={isOpenableAttachment(att) ? 'document-text-outline' : 'alert-circle-outline'} size={24} color={colors.textMuted} />
                                          <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center' }} numberOfLines={2}>
                                            {getAttachmentDisplayName(att, idx)}
                                          </Text>
                                        </View>
                                      )}
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </ScrollView>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  {!editMode && detailProgressEntries.length === 0 && (
                    <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>No admin replies yet. Messages and attachments from the maintenance team will appear here.</Text>
                    </View>
                  )}

                  {/* Attachment Thumbnails */}
                  {!editMode && detailRequest.attachments?.length > 0 && (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Attachments ({detailRequest.attachments.length})</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ gap: 8 }}>
                        {detailRequest.attachments.map((att, idx) => (
                          <TouchableOpacity key={idx} onPress={() => openAttachment(att)} style={{ width: 88, height: 88, borderRadius: 10, backgroundColor: colors.surfaceSecondary, marginRight: 8, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
                            {getAttachmentDownloadUrl(att) && isImageAttachment(att) ? (
                              <Image source={{ uri: getAttachmentDownloadUrl(att) }} style={{ width: 88, height: 88 }} resizeMode="cover" onError={() => showBannerMessage('error', 'Attachment preview could not be loaded.')} />
                            ) : (
                              <View style={{ alignItems: 'center', paddingHorizontal: 6, gap: 4 }}>
                                <Ionicons name="document-text-outline" size={24} color={colors.textMuted} />
                                <Text style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center' }} numberOfLines={2}>{getAttachmentDisplayName(att, idx)}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {!editMode && canReplyToRequest(detailRequest) && (
                    <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 10 }}>Reply / Follow-up</Text>
                      <TextInput
                        style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 12, fontSize: 14, color: colors.text, minHeight: 84, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border }}
                        placeholder="Add follow-up details..."
                        placeholderTextColor={colors.textMuted}
                        multiline
                        value={replyMessage}
                        onChangeText={setReplyMessage}
                      />
                      {replyAttachments.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                          {replyAttachments.map((file) => (
                            <TouchableOpacity key={getAttachmentDisplayName(file)} style={styles.previewChip} onLongPress={() => removeReplyAttachment(getAttachmentDisplayName(file))}>
                              <Text style={styles.previewText}>{getAttachmentDisplayName(file)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                      {replyUploadStatus ? <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>{replyUploadStatus}</Text> : null}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }} onPress={() => handleReplyAttach(pickFromCamera)} disabled={sendingReply}>
                          <Ionicons name="camera-outline" size={16} color={colors.text} />
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Photo</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }} onPress={() => handleReplyAttach(pickFromLibrary)} disabled={sendingReply}>
                          <Ionicons name="image-outline" size={16} color={colors.text} />
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Gallery</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }} onPress={() => handleReplyAttach(pickDocument)} disabled={sendingReply}>
                          <Ionicons name="document-attach-outline" size={16} color={colors.text} />
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>File</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primary }} onPress={sendMaintenanceReply} disabled={sendingReply || (!replyMessage.trim() && replyAttachments.length === 0)}>
                          {sendingReply ? <ActivityIndicator size="small" color={colors.surface} /> : <Ionicons name="send" size={16} color={colors.surface} />}
                          <Text style={{ color: colors.surface, fontWeight: '800', fontSize: 12 }}>Send</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* Action Buttons */}
                  <View style={{ gap: 10, marginTop: 6, marginBottom: 20 }}>
                    {editMode ? (
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: 'center' }} onPress={() => setEditMode(false)}>
                          <Text style={{ fontWeight: '700', color: colors.text }}>Discard</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' }} onPress={saveEdit} disabled={saving}>
                          {saving ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={{ fontWeight: '700', color: colors.surface }}>Save Changes</Text>}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <>
                        {(detailRequest.status || '').toLowerCase() === 'pending' && (
                          <>
                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14 }} onPress={enterEditMode}>
                              <Ionicons name="create-outline" size={20} color={colors.surface} />
                              <Text style={{ color: colors.surface, fontWeight: '700', fontSize: 15 }}>Edit Request</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FEE2E2', borderRadius: 12, paddingVertical: 14 }} onPress={() => setShowCancelConfirm(true)}>
                              <Ionicons name="close-circle-outline" size={20} color="#DC2626" />
                              <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 15 }}>Cancel Request</Text>
                            </TouchableOpacity>
                          </>
                        )}
                        {['resolved', 'completed'].includes((detailRequest.status || '').toLowerCase()) && !detailRequest.tenant_confirmed_resolved && (
                          <>
                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#DCFCE7', borderRadius: 12, paddingVertical: 14 }} onPress={handleConfirmResolved} disabled={saving}>
                              <Ionicons name="checkmark-done-circle-outline" size={20} color="#15803D" />
                              <Text style={{ color: '#15803D', fontWeight: '700', fontSize: 15 }}>Confirm Resolved</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, paddingVertical: 14 }} onPress={() => setShowReopenModal(true)}>
                              <Ionicons name="refresh" size={20} color="#2563EB" />
                              <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 15 }}>Still an Issue</Text>
                            </TouchableOpacity>
                          </>
                        )}
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingVertical: 14 }} onPress={submitSimilar}>
                          <Ionicons name="copy-outline" size={20} color={colors.text} />
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>Submit Similar</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={Boolean(previewAttachment)} transparent animationType="fade" onRequestClose={() => setPreviewAttachment(null)}>
        <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setPreviewAttachment(null)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{
              width: '88%',
              backgroundColor: colors.surface,
              borderRadius: 18,
              padding: 16,
              gap: 12,
              ...Platform.select({
                ios: { shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
                android: { elevation: 12 },
              }),
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Attachment Preview</Text>
              <TouchableOpacity onPress={() => setPreviewAttachment(null)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {getAttachmentDownloadUrl(previewAttachment) ? (
              <Image
                source={{ uri: getAttachmentDownloadUrl(previewAttachment) }}
                style={{ width: '100%', height: 340, borderRadius: 14, backgroundColor: colors.surfaceSecondary }}
                resizeMode="contain"
                onError={() => showBannerMessage('error', 'Attachment preview could not be loaded.')}
              />
            ) : null}
            <Text style={{ fontSize: 13, color: colors.textMuted }}>
              {previewAttachment ? getAttachmentDisplayName(previewAttachment) : 'Attachment preview'}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Cancel Confirmation */}
      <Modal visible={showCancelConfirm} transparent animationType="fade" onRequestClose={() => setShowCancelConfirm(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Cancel this request?</Text>
            <Text style={styles.confirmText}>This action will cancel your service request. You can submit a new one anytime.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancel]} onPress={() => setShowCancelConfirm(false)}>
                <Text style={styles.confirmCancelText}>Keep Request</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmDiscard]} onPress={handleCancel} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#b91c1c" /> : <Text style={styles.confirmDiscardText}>Cancel Request</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reopen Modal */}
      <Modal visible={showReopenModal} transparent animationType="fade" onRequestClose={() => setShowReopenModal(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Reopen this request?</Text>
            <Text style={styles.confirmText}>The request will be set back to Pending so the team can review it again.</Text>
            <TextInput
              style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text, minHeight: 70, marginTop: 8, marginBottom: 4 }}
              placeholder="Add a note (optional)..."
              placeholderTextColor={colors.textMuted}
              multiline
              textAlignVertical="top"
              value={reopenNote}
              onChangeText={setReopenNote}
            />
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancel]} onPress={() => { setShowReopenModal(false); setReopenNote(''); }}>
                <Text style={styles.confirmCancelText}>Nevermind</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: '#DBEAFE' }]} onPress={handleReopen} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#2563EB" /> : <Text style={{ color: '#2563EB', fontWeight: '700' }}>Reopen</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

