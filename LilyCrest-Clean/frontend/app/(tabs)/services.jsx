import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { format } from 'date-fns';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
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
import AttachmentPickerSheet from '../../src/components/AttachmentPickerSheet';
import StyledModal from '../../src/components/StyledModal';
import LilyAssistantFab from '../../src/components/assistant/LilyAssistantFab';
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
  toStoredAttachmentMetadata,
} from '../../src/services/firebaseStorageUpload';
import { pickDocument, pickFromCamera, pickFromLibrary } from '../../src/utils/attachmentPicker';
import { createLatestRequestGate, runLatestRequest } from '../../src/utils/latestRequest';
import { classifyMaintenanceAttachment, getValidMaintenanceAttachmentUrl } from '../../src/utils/maintenanceAttachmentViewer';
import { getCreateRequestDescriptionError, getMaintenanceAttachmentErrorMessage, getMaintenanceAttachmentSelectionError, shouldConfirmCreateRequestClose } from '../../src/utils/maintenanceForm';
import {
  getMaintenanceAllowedActions,
  getMaintenanceStatusGroup,
  MAINTENANCE_ACTIONS,
  MAINTENANCE_GROUPS,
  MAINTENANCE_STATUS_STAGES,
} from '../../src/utils/maintenanceStatus';
import { resolveThemeForeground, semanticStatusPalette } from '../../src/theme/tokens';

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

function sanitizeAttachmentErrorMessage(value = '') {
  return String(value || 'Attachment could not be opened.')
    .replace(/https?:\/\/[^\s,}]+/gi, '[attachment-url]')
    .replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 300);
}

function buildRequestProgress(request) {
  if (!request) return [];

  if (Array.isArray(request.thread) && request.thread.length > 0) {
    return request.thread
      .map((entry, index) => {
        const timestamp = entry?.created_at || entry?.createdAt || entry?.timestamp || null;
        return {
          id: entry?.update_id || `${entry?.type || 'update'}_${timestamp || index}`,
          title: entry?.title || getProgressTitle(entry),
          type: entry?.type || entry?.kind || 'maintenance_update',
          message: typeof entry?.message === 'string' ? entry.message.trim() : '',
          timestamp,
          status: entry?.status || entry?.status_to || null,
          statusFrom: entry?.status_from || null,
          statusTo: entry?.status_to || entry?.status || null,
          attachments: Array.isArray(entry?.attachments) ? entry.attachments.filter(Boolean) : [],
          actorLabel: entry?.senderName || entry?.actor_name || entry?.actorLabel || null,
          actorRole: entry?.senderRole || entry?.actor_role || null,
          isTenant: (entry?.senderRole || entry?.actor_role || '').toLowerCase() === 'tenant',
          isSummary: entry?.type === 'tenant_summary' || entry?.kind === 'tenant_summary' || Boolean(entry?.summary || entry?.tenantSummary),
          summary: entry?.summary || entry?.tenantSummary || null,
          seenByAdmin: entry?.seenByAdmin === true,
        };
      })
      .sort((left, right) => {
        const leftTime = new Date(left.timestamp || 0).getTime();
        const rightTime = new Date(right.timestamp || 0).getTime();
        return leftTime - rightTime;
      });
  }

  const history = Array.isArray(request.statusHistory) ? request.statusHistory : [];
  const progress = history
    .map((entry, index) => {
      const note = typeof entry?.note === 'string' && entry.note.trim()
        ? entry.note.trim()
        : null;
      const timestamp = entry?.timestamp || entry?.created_at || entry?.createdAt || null;
      const actorRole = String(entry?.actor_role || '').toLowerCase();

      return {
        id: `${entry?.event || 'progress'}_${entry?.status || 'update'}_${timestamp || index}`,
        title: getProgressTitle(entry),
        message: note,
        timestamp,
        attachments: Array.isArray(entry?.attachments) ? entry.attachments.filter(Boolean) : [],
        actorLabel: actorRole === 'admin'
          ? 'Admin'
          : actorRole === 'tenant'
            ? 'You'
            : entry?.actor_name || null,
        actorRole,
        isTenant: actorRole === 'tenant',
        isSummary: entry?.event === 'tenant_summary',
      };
    })
    .filter((entry) => entry.title || entry.message)
    .sort((left, right) => {
      const leftTime = new Date(left.timestamp || 0).getTime();
      const rightTime = new Date(right.timestamp || 0).getTime();
      return rightTime - leftTime;
    });

  if (progress.length > 0) {
    return progress;
  }

  if (request.notes) {
    return [{
      id: `legacy_${request.request_id || 'reply'}`,
      title: formatStatusLabel(request.status),
      message: request.notes,
      timestamp: request.updated_at || request.updatedAt || request.created_at || request.createdAt || null,
      attachments: [],
      actorLabel: 'Admin',
    }];
  }

  return [];
}

// Groups flat, chronologically-ordered thread entries into chat "items" —
// compact date separators plus a showSender flag so consecutive messages
// from the same sender don't repeat a name/avatar header.
function buildChatItems(entries = []) {
  const items = [];
  let lastDateKey = '';
  let lastSenderKey = '';

  entries.forEach((entry) => {
    const dateKey = entry.timestamp ? safeFormat(entry.timestamp, 'yyyy-MM-dd') : '';
    if (dateKey && dateKey !== lastDateKey) {
      items.push({ kind: 'date', id: `date_${dateKey}`, label: safeFormat(entry.timestamp, 'MMMM d, yyyy') });
      lastDateKey = dateKey;
      lastSenderKey = '';
    }
    const senderKey = `${entry.isTenant ? 'tenant' : 'admin'}:${entry.actorLabel || ''}`;
    items.push({ kind: 'message', id: entry.id, entry, showSender: senderKey !== lastSenderKey });
    lastSenderKey = senderKey;
  });

  return items;
}

const REQUEST_TYPES = [
  { id: 'maintenance', label: 'Maintenance', icon: 'construct', color: '#0A1628' },
  { id: 'plumbing', label: 'Plumbing', icon: 'water', color: '#0A1628' },
  { id: 'electrical', label: 'Electrical', icon: 'flash', color: '#0A1628' },
  { id: 'aircon', label: 'Air Conditioning', icon: 'snow', color: '#0A1628' },
  { id: 'cleaning', label: 'Cleaning', icon: 'sparkles', color: '#0A1628' },
  { id: 'pest', label: 'Pest Control', icon: 'bug', color: '#0A1628' },
  { id: 'furniture', label: 'Furniture', icon: 'bed', color: '#0A1628' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal', color: '#0A1628' },
];

function getServiceTypeIconColor(typeColor, colors, isDarkMode) {
  return isDarkMode
    ? colors.accent
    : resolveThemeForeground(typeColor, colors, false);
}

const URGENCY_LEVELS = [
  { id: 'low', label: 'Low', description: 'Can wait a few days', color: '#059669' },
  { id: 'normal', label: 'Normal', description: 'Within 1-2 days', color: '#D97706' },
  { id: 'high', label: 'Urgent', description: 'Needs immediate attention', color: '#DC2626' },
];

const RESOLUTION_ESTIMATES = {
  low: '3–5 business days',
  normal: '1–2 business days',
  high: 'Within 24 hours',
};

const MIN_DESCRIPTION_LENGTH = 10;
// Mirrors backend/controllers/maintenance.controller.js DESCRIPTION_MAX.
// Frontend enforcement here is UX only — the backend remains authoritative.
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_MAINTENANCE_ATTACHMENTS = 4;
// Every inquiry attachment (image, PDF, or other supported document type) is
// capped at 5MB, regardless of the generic upload endpoint's own larger
// per-mime ceiling. Mirrors INQUIRY_ATTACHMENT_MAX_BYTES enforced server-side
// in maintenance.controller.js's normalizeTenantAttachments.
const INQUIRY_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

function getStatusNextStep(status, request = {}) {
  switch ((status || '').toLowerCase()) {
    case 'pending': return 'Your request has been received and is waiting for admin review.';
    case 'pending_review': return 'Your request is waiting for admin review.';
    case 'viewed': return 'Admin has viewed your request.';
    case 'reviewed': return 'Admin has reviewed your request.';
    case 'in_progress': return 'Your request is currently being handled.';
    case 'assigned':
    case 'provider_assigned': return 'A service provider has been assigned.';
    case 'scheduled': return 'A maintenance visit has been scheduled.';
    case 'waiting_tenant': return 'The maintenance team is waiting for your response.';
    case 'reopened': return 'This request was reopened because the issue still needs attention.';
    case 'resolved': return 'This request has been marked as resolved.';
    case 'completed': return request.tenant_confirmed_resolved ? 'You confirmed that this request is resolved.' : 'This request has been completed.';
    case 'rejected': return 'This request was rejected. Please review the reason below.';
    case 'cancelled': return 'This request was cancelled.';
    case 'closed': return 'This request is closed.';
    default: return 'A maintenance update is available.';
  }
}

function getNextStepDetail(status, request = {}) {
  switch ((status || '').toLowerCase()) {
    case 'pending': return 'Please wait while the team reviews the details.';
    case 'pending_review': return 'Please wait while the team reviews the details.';
    case 'viewed': return 'The team will share the next action here.';
    case 'reviewed': return 'The team will share the next action here.';
    case 'in_progress': return 'Watch this thread for repair notes, files, or visit details.';
    case 'assigned':
    case 'provider_assigned': return request.assigned_to ? `${request.assigned_to} is assigned to this request.` : 'The assigned provider will handle the repair.';
    case 'scheduled': return request.scheduled_for ? `Scheduled for ${request.scheduled_for}.` : 'The visit schedule will be shared here.';
    case 'waiting_tenant': return 'Reply in this thread with the requested information.';
    case 'reopened': return 'Watch this thread for the next repair update.';
    case 'resolved': return 'Please confirm if the issue is fixed, or report that it is still an issue.';
    case 'completed': return 'No action is needed right now.';
    case 'rejected': return 'You can submit a new request if you need another review.';
    case 'cancelled': return 'You can submit a new request if you still need help.';
    case 'closed': return 'No action is needed right now.';
    default: return 'Review the latest update below.';
  }
}

export default function ServicesScreen() {
  const { requestId: notificationRequestIdParam } = useLocalSearchParams();
  const notificationRequestId = Array.isArray(notificationRequestIdParam)
    ? notificationRequestIdParam[0]
    : notificationRequestIdParam;
  const { user, authReady, authStatus } = useAuth();
  const { colors, isDarkMode } = useTheme();
  const { showToast } = useToast();
  const styles = useThemedStyles((c) => StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: c.headerBg, borderBottomWidth: 2, borderBottomColor: c.accent },
    headerTitle: { fontSize: 20, fontWeight: 'bold', color: c.onPrimary },
    headerSubtitle: { color: c.accentLight, fontSize: 12, fontWeight: '700', marginTop: 2 },
    refreshIndicator: { width: 36, height: 36, borderRadius: 8, backgroundColor: c.primaryHover, justifyContent: 'center', alignItems: 'center' },
    scrollView: { flex: 1 },
    scrollContent: { padding: 16 },
    submitCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: c.accent, borderStyle: 'dashed' },
    submitIcon: { marginRight: 12 },
    submitContent: { flex: 1 },
    submitTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 2 },
    submitDescription: { fontSize: 12, color: c.textMuted },
    quickServicesCard: { backgroundColor: c.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    sectionTitle: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 10 },
    servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    serviceItem: { width: '30%', alignItems: 'center' },
    serviceIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
    serviceLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },
    tabContainer: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: 12, padding: 3, marginBottom: 12 },
    tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, gap: 4 },
    tabActive: { backgroundColor: c.primary },
    tabText: { fontSize: 11, fontWeight: '600', color: c.textMuted },
    tabTextActive: { color: c.onPrimary },
    emptyState: { alignItems: 'center', paddingVertical: 40, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 6 },
    emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', paddingHorizontal: 32 },
    requestCard: { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.border, borderLeftWidth: 4, borderLeftColor: c.border },
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
    urgencyText: { fontSize: 12, color: '#DC2626', fontWeight: '500' },
    bottomSpacer: { height: Platform.OS === 'ios' ? 140 : 120 },
    modalContainer: { flex: 1 },
    modalOverlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
    modalContent: { backgroundColor: c.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 24, maxHeight: '90%', borderWidth: 1, borderColor: c.border },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
    modalSectionTitle: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 12, marginTop: 8 },
    typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    typeItem: { width: '31%', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, backgroundColor: c.surfaceSecondary },
    typeItemSelected: { backgroundColor: c.primaryLight, borderWidth: 1, borderColor: c.interactive },
    typeIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
    typeLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },
    typeLabelSelected: { color: c.interactive, fontWeight: '600' },
    urgencyOptions: { gap: 10, marginBottom: 16 },
    urgencyOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
    urgencyDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
    urgencyContent: { flex: 1 },
    urgencyLabel: { fontSize: 14, fontWeight: '600', color: c.text },
    urgencyDesc: { fontSize: 12, color: c.textMuted },
    descriptionInput: { backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 16, fontSize: 15, color: c.text, minHeight: 120, marginBottom: 20 },
    attachmentAction: { minHeight: 58, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceSecondary, marginBottom: 8 },
    attachmentActionDisabled: { opacity: 0.58 },
    attachmentActionIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: c.surface },
    attachmentActionContent: { flex: 1 },
    attachmentActionTitle: { color: c.text, fontWeight: '800', fontSize: 14 },
    attachmentActionHint: { color: c.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
    attachmentCount: { color: c.textMuted, fontSize: 12, fontWeight: '700' },
    attachmentUploadNote: { color: c.textMuted, fontSize: 12, marginBottom: 8 },
    createAttachmentChip: { minHeight: 40, maxWidth: '100%', paddingLeft: 10, paddingRight: 6, borderRadius: 10, backgroundColor: c.surfaceSecondary, flexDirection: 'row', alignItems: 'center', gap: 7 },
    createAttachmentName: { flexShrink: 1, maxWidth: 210, fontSize: 12, color: c.text },
    removeAttachmentButton: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    attachmentPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    previewChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.surfaceSecondary },
    previewText: { fontSize: 12, color: c.text },
    conversationThread: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 12, gap: 4 },
    conversationMessageRow: { width: '100%', marginBottom: 8 },
    conversationBubble: { maxWidth: '82%', paddingVertical: 9, paddingHorizontal: 12 },
    conversationTimestamp: { fontSize: 10, color: c.textMuted, marginTop: 3, marginHorizontal: 4 },
    replyComposer: { marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
    replyComposerBar: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.inputBackground, borderRadius: 16, borderWidth: 1, borderColor: c.border, paddingHorizontal: 6, paddingVertical: 5 },
    replyAttachButton: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    replyInput: { flex: 1, minHeight: 40, maxHeight: 100, fontSize: 14, lineHeight: 20, color: c.text, paddingVertical: 0, paddingHorizontal: 2 },
    submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary, borderRadius: 12, paddingVertical: 16, gap: 8, marginBottom: 20 },
    submitButtonDisabled: { opacity: 0.7 },
    submitButtonText: { color: c.onPrimary, fontSize: 16, fontWeight: '600' },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: 12,
      marginBottom: 16,
      borderWidth: 1,
    },
    bannerText: { flex: 1, fontSize: 14, fontWeight: '700', color: c.text },
    bannerSuccess: { backgroundColor: c.successBg, borderColor: c.success },
    bannerError: { backgroundColor: c.errorBg, borderColor: c.error },
    bannerWarning: { backgroundColor: c.warningBg, borderColor: c.warning },
    fieldError: { color: c.errorText, fontSize: 12, marginBottom: 10 },
    descriptionCounter: { alignSelf: 'flex-end', fontSize: 11, color: colors.textMuted, marginTop: 4, marginBottom: 6 },
    descriptionCounterOver: { color: c.errorText, fontWeight: '600' },
    confirmOverlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', alignItems: 'center' },
    reopenInput: { backgroundColor: c.inputBackground, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 12, fontSize: 14, lineHeight: 20, color: c.text, minHeight: 76 },
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
  const [showCreateAttachMenu, setShowCreateAttachMenu] = useState(false);

  // Detail modal state
  const [detailRequest, setDetailRequest] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editType, setEditType] = useState(null);
  const [editUrgency, setEditUrgency] = useState('normal');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [previewAttachmentError, setPreviewAttachmentError] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenNote, setReopenNote] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [replyUploadStatus, setReplyUploadStatus] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showReplyAttachMenu, setShowReplyAttachMenu] = useState(false);
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const bannerTimerRef = useRef(null);
  const handledNotificationRequestRef = useRef('');
  const requestGateRef = useRef(null);
  if (!requestGateRef.current) requestGateRef.current = createLatestRequestGate();
  // Idempotency key for the current submission attempt. Minted once and
  // reused across retries (e.g. a timed-out request the tenant resubmits by
  // tapping Submit again) so the backend can recognize it as the same
  // attempt rather than creating a duplicate ticket. Cleared on success or
  // when the form is reset/discarded, so the next distinct submission gets
  // a fresh key.
  const submissionRequestIdRef = useRef(null);
  const userId = user?.user_id || user?.id || null;
  const isDirty = useMemo(() => Boolean(selectedType) || description.trim().length > 0 || attachments.length > 0, [attachments.length, description, selectedType]);
  const createFormErrors = useMemo(() => {
    return {
      type: selectedType ? '' : 'Please select a service type',
      description: getCreateRequestDescriptionError(description),
    };
  }, [description, selectedType]);
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
          color={banner.type === 'success' ? '#065F46' : banner.type === 'error' ? '#991B1B' : '#92400e'}
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
    if (!shouldConfirmCreateRequestClose({ isDirty, hasAttemptedSubmit })) {
      setShowModal(false);
      return;
    }
    setShowModal(false);
    setShowDiscardConfirm(true);
  };

  const keepEditing = () => {
    setShowDiscardConfirm(false);
    setShowModal(true);
  };

  const fetchRequests = useCallback(async () => {
    if (!authReady) return;
    if (authStatus !== 'authenticated' || !userId) {
      requestGateRef.current.invalidate();
      setRequests([]);
      setIsLoading(false);
      setRefreshing(false);
      showBannerMessage('warning', 'Please sign in to view service requests.', { withToast: false });
      return;
    }

    await runLatestRequest({
      gate: requestGateRef.current,
      request: () => apiService.getMyMaintenance(),
      onSuccess: (response) => {
        const nextRequests = [...(response.data || [])].sort((a, b) => {
          const aTime = new Date(a.latestActivityAt || a.lastActivityAt || a.updated_at || a.created_at || 0).getTime();
          const bTime = new Date(b.latestActivityAt || b.lastActivityAt || b.updated_at || b.created_at || 0).getTime();
          return bTime - aTime;
        });
        setRequests(nextRequests);
      },
      onError: (error) => {
        console.warn('Fetch requests error:', error?.normalized || error?.message);
        showBannerMessage('error', getApiErrorMessage(error, 'Unable to load service requests. Pull to retry.'), { withToast: false });
      },
      onSettled: () => {
        setIsLoading(false);
        setRefreshing(false);
      },
    });
  }, [authReady, authStatus, showBannerMessage, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!authReady) return undefined;
      // One immediate load per focus. There is no separate mount effect racing it.
      fetchRequests();
      const interval = authStatus === 'authenticated' && userId
        ? setInterval(() => { fetchRequests(); }, 60000)
        : null;
      return () => {
        if (interval) clearInterval(interval);
        requestGateRef.current.invalidate();
      };
    }, [authReady, authStatus, fetchRequests, userId])
  );

  const onRefresh = useCallback(() => {
    if (!authReady || authStatus !== 'authenticated' || !userId) {
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    fetchRequests();
  }, [authReady, authStatus, fetchRequests, userId]);

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
        maxBytes: INQUIRY_ATTACHMENT_MAX_BYTES,
        tenantId: user?.user_id || user?.id || 'unknown-tenant',
      });
      setAttachments(uploadedAttachments);
      if (uploadedAttachments.length) {
        setAttachmentUploadStatus('Attachment uploaded');
      }
      if (!submissionRequestIdRef.current) {
        submissionRequestIdRef.current = Crypto.randomUUID();
      }
      const payload = {
        request_type: selectedType,
        description: description.trim(),
        urgency: selectedUrgency,
        attachments: uploadedAttachments.map(toStoredAttachmentMetadata),
        client_request_id: submissionRequestIdRef.current,
      };
      await apiService.createMaintenance(payload);
      showBannerMessage('success', 'Maintenance request submitted successfully.');
      setShowModal(false);
      resetForm();
      fetchRequests();
    } catch (error) {
      setAttachmentUploadStatus(attachments.length ? 'Upload failed, please retry' : '');
      showBannerMessage('error', getMaintenanceAttachmentErrorMessage(error));
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
    setShowCreateAttachMenu(false);
    submissionRequestIdRef.current = null;
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
      const maxBytes = INQUIRY_ATTACHMENT_MAX_BYTES;
      const selectionError = getMaintenanceAttachmentSelectionError(file, { maxBytes, supported });
      if (selectionError) {
        showBannerMessage('error', selectionError);
        return;
      }
      setAttachmentUploadStatus('');
      setAttachments((prev) => {
        if (prev.length >= MAX_MAINTENANCE_ATTACHMENTS) {
          showBannerMessage('error', `You can upload up to ${MAX_MAINTENANCE_ATTACHMENTS} files.`);
          return prev;
        }
        return [...prev, file];
      });
    } catch (err) {
      showBannerMessage('error', err?.message || 'Unable to add attachment.');
    }
  };

  const removeAttachment = (index) => {
    setAttachmentUploadStatus('');
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const getStatusColor = useCallback((status) => {
    const tone = (name) => semanticStatusPalette(colors, name);
    switch ((status || '').toLowerCase()) {
      case 'viewed': return { ...tone('info'), bg: tone('info').background, label: 'Viewed', icon: 'eye' };
      case 'reviewed': return { ...tone('info'), bg: tone('info').background, label: 'Reviewed', icon: 'eye' };
      case 'in_progress': case 'in process': return { ...tone('info'), bg: tone('info').background, label: 'In Progress', icon: 'construct' };
      case 'assigned': case 'provider_assigned': return { ...tone('info'), bg: tone('info').background, label: 'Provider Assigned', icon: 'person' };
      case 'scheduled': return { ...tone('info'), bg: tone('info').background, label: 'Scheduled', icon: 'calendar' };
      case 'waiting_tenant': return { ...tone('warning'), bg: tone('warning').background, label: 'Waiting for You', icon: 'chatbubble-ellipses' };
      case 'reopened': return { ...tone('warning'), bg: tone('warning').background, label: 'Reopened', icon: 'refresh-circle' };
      case 'resolved': return { ...tone('success'), bg: tone('success').background, label: 'Resolved', icon: 'checkmark-done-circle' };
      case 'completed': return { ...tone('success'), bg: tone('success').background, label: 'Completed', icon: 'checkmark-circle' };
      case 'rejected': return { ...tone('danger'), bg: tone('danger').background, label: 'Rejected', icon: 'close-circle' };
      case 'cancelled': return { ...tone('danger'), bg: tone('danger').background, label: 'Cancelled', icon: 'ban' };
      case 'closed': return { ...tone('neutral'), bg: tone('neutral').background, label: 'Closed', icon: 'lock-closed' };
      case 'pending_review': return { ...tone('warning'), bg: tone('warning').background, label: 'Pending Review', icon: 'time' };
      case 'pending': return { ...tone('warning'), bg: tone('warning').background, label: 'Pending', icon: 'time' };
      default: return { ...tone('neutral'), bg: tone('neutral').background, label: status || 'Pending', icon: 'help-circle' };
    }
  }, [colors]);

  const getTypeInfo = (type) => REQUEST_TYPES.find(t => t.id === type) || REQUEST_TYPES[7];

  // --- Detail modal handlers ---
  const openDetail = useCallback(async (request) => {
    setDetailRequest(request);
    setEditMode(false);
    setShowCancelConfirm(false);
    setShowReopenModal(false);
    setReopenNote('');
    setReplyMessage('');
    setReplyAttachments([]);
    setReplyUploadStatus('');
    setShowReplyAttachMenu(false);
    setShowDetailModal(true);
    setDetailLoading(true);
    try {
      const response = await apiService.getMaintenance(request.request_id);
      const detail = response?.data || request;
      setDetailRequest(detail);
      fetchRequests();
      if (detail?.hasUnreadTenantUpdates || detail?.unreadTenantCount) {
        apiService.markMaintenanceRead(request.request_id).catch(() => {});
      }
    } catch (error) {
      showBannerMessage('error', error?.response?.data?.detail || 'Failed to load maintenance details.');
    } finally {
      setDetailLoading(false);
    }
  }, [fetchRequests, showBannerMessage]);

  useEffect(() => {
    const targetRequestId = String(notificationRequestId || '').trim();
    if (!targetRequestId || handledNotificationRequestRef.current === targetRequestId) return;

    const ownedRequest = requests.find(
      (request) => String(request.request_id) === targetRequestId,
    );
    if (!ownedRequest) return;

    handledNotificationRequestRef.current = targetRequestId;
    setActiveTab(getMaintenanceStatusGroup(ownedRequest.status));
    openDetail(ownedRequest);
    // openDetail intentionally refreshes this same owned request after opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationRequestId, requests]);

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
      showBannerMessage('error', e?.response?.data?.detail || 'Failed to update request.');
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
      showBannerMessage('error', e?.response?.data?.detail || 'Failed to cancel request. Please try again.');
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
      showBannerMessage('error', e?.response?.data?.detail || 'Failed to reopen request. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmResolved = async () => {
    if (!detailRequest?.request_id) return;
    setSaving(true);
    try {
      const response = await apiService.confirmMaintenanceResolved(detailRequest.request_id);
      setDetailRequest(response?.data || detailRequest);
      showBannerMessage('success', 'Resolution confirmed.');
      fetchRequests();
    } catch (e) {
      showBannerMessage('error', e?.response?.data?.detail || 'Failed to confirm resolution.');
    } finally {
      setSaving(false);
    }
  };

  const handleReplyAttach = async (pickerFn) => {
    setShowReplyAttachMenu(false);
    try {
      const file = await pickerFn();
      if (!file) return;
      const supported = isImageAttachmentCandidate(file) || isDocumentAttachmentCandidate(file);
      if (!supported) {
        showBannerMessage('error', 'Please select an image, PDF, document, text, or CSV file.');
        return;
      }
      const maxBytes = INQUIRY_ATTACHMENT_MAX_BYTES;
      if (file.size && file.size > maxBytes) {
        showBannerMessage('error', 'File must be 5 MB or smaller.');
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
        maxBytes: INQUIRY_ATTACHMENT_MAX_BYTES,
        tenantId: user?.user_id || user?.id || 'unknown-tenant',
      });
      const response = await apiService.sendMaintenanceReply(detailRequest.request_id, {
        message: replyMessage.trim(),
        attachments: uploadedAttachments.map(toStoredAttachmentMetadata),
      });
      setDetailRequest(response?.data || detailRequest);
      setReplyMessage('');
      setReplyAttachments([]);
      setReplyUploadStatus('');
      fetchRequests();
    } catch (error) {
      setReplyUploadStatus(replyAttachments.length ? 'Upload failed, please retry' : '');
      showBannerMessage('error', error?.response?.data?.detail || error?.message || 'Failed to send your message. Please try again.');
    } finally {
      setSendingReply(false);
    }
  };

  const openAttachment = async (attachment) => {
    const attachmentType = classifyMaintenanceAttachment(attachment);
    const url = getValidMaintenanceAttachmentUrl(attachment);
    const name = getAttachmentDisplayName(attachment);
    const mimeType = String(attachment?.mimeType || attachment?.type || 'application/octet-stream');
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch (_) { hostname = ''; }
    const hasAltMedia = /[?&]alt=media(?:&|$)/i.test(url);
    const hasDownloadToken = /[?&]token=[^&]+/i.test(url);
    const hasInternalStoragePath = Boolean(attachment?.storagePath || attachment?.storage_path);
    console.info('[MaintenanceAttachment] open', { name, mimeType, hostname, type: attachmentType, hasAltMedia, hasDownloadToken, hasInternalStoragePath });

    try {
      if (attachmentType === 'unsupported') throw new Error('This file type is not supported.');
      if (!url) throw new Error('Attachment link is missing or invalid.');
      if (attachmentType === 'image') {
        setPreviewAttachmentError('');
        setPreviewAttachment({ ...attachment, downloadUrl: url });
        return;
      }
      const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'attachment';
      const localUri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}maintenance-${Date.now()}-${safeName}`;
      const result = await FileSystem.downloadAsync(url, localUri);
      console.info('[MaintenanceAttachment] download', { name, mimeType, hostname, httpStatus: result.status });
      if (result.status < 200 || result.status >= 300) {
        if (result.status === 402) throw new Error('File storage is temporarily unavailable because Firebase billing is disabled. Please contact the administrator.');
        if (result.status === 404) throw new Error('This attachment no longer exists.');
        if ([401, 403].includes(result.status)) throw new Error('Attachment access has expired. Please contact the dormitory administrator.');
        throw new Error(`Attachment download failed (HTTP ${result.status}).`);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { mimeType, dialogTitle: `Open ${name}` });
        return;
      }
      const supported = await Linking.canOpenURL(result.uri);
      if (!supported) throw new Error('No compatible document viewer is installed on this device.');
      await Linking.openURL(result.uri);
    } catch (error) {
      console.warn('[MaintenanceAttachment] failure', { name, mimeType, hostname, errorType: error?.name || 'Error', message: error?.message || 'Unknown error' });
      showBannerMessage('error', error?.message || 'Unable to open this attachment.');
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
  const activeRequests = useMemo(() => filterBySearch(requests.filter((request) => getMaintenanceStatusGroup(request.status) === MAINTENANCE_GROUPS.ACTIVE)), [filterBySearch, requests]);
  const resolvedRequests = useMemo(() => filterBySearch(requests.filter((request) => getMaintenanceStatusGroup(request.status) === MAINTENANCE_GROUPS.RESOLVED)), [filterBySearch, requests]);
  const cancelledRequests = useMemo(() => filterBySearch(requests.filter((request) => getMaintenanceStatusGroup(request.status) === MAINTENANCE_GROUPS.CANCELLED)), [filterBySearch, requests]);
  const detailAllowedActions = useMemo(() => new Set(getMaintenanceAllowedActions(detailRequest?.status)), [detailRequest?.status]);
  const detailProgressEntries = useMemo(() => buildRequestProgress(detailRequest), [detailRequest]);
  const detailTenantSummary = useMemo(() => detailRequest?.tenant_summary || detailRequest?.tenantSummary || null, [detailRequest]);
  const hasConversationSummary = useMemo(() => detailProgressEntries.some((entry) => entry.isSummary), [detailProgressEntries]);
  const chatItems = useMemo(() => buildChatItems(detailProgressEntries), [detailProgressEntries]);
  const latestTenantEntryId = useMemo(() => {
    for (let i = detailProgressEntries.length - 1; i >= 0; i -= 1) {
      if (detailProgressEntries[i].isTenant) return detailProgressEntries[i].id;
    }
    return null;
  }, [detailProgressEntries]);
  const currentList = useMemo(() => {
    if (activeTab === 'resolved') return resolvedRequests;
    if (activeTab === 'cancelled') return cancelledRequests;
    return activeRequests;
  }, [activeRequests, activeTab, cancelledRequests, resolvedRequests]);
  const requestKeyExtractor = useCallback((request) => request.request_id, []);

  const renderRequestItem = useCallback(({ item: request }) => {
    const typeInfo = getTypeInfo(request.request_type);
    const typeIconColor = getServiceTypeIconColor(typeInfo.color, colors, isDarkMode);
    const statusColor = getStatusColor(request.status);
    const urgencyInfo = URGENCY_LEVELS.find(u => u.id === request.urgency) || URGENCY_LEVELS[1];
    const latestUpdate = request.latestTenantVisibleUpdate || null;
    const lastActivity = request.latestActivityAt || request.lastActivityAt || request.updated_at || request.created_at;
    const hasNewAttachment = latestUpdate?.hasAttachments;
    const locationParts = [request.branch, request.room_id || request.roomId].filter(Boolean);
    return (
      <TouchableOpacity style={[styles.requestCard, { borderLeftColor: statusColor.solid }]} onPress={() => openDetail(request)} activeOpacity={0.85}>
        <View style={styles.requestHeader}>
          <View style={[styles.requestIcon, { backgroundColor: colors.accentSubtle }]}>
            <Ionicons name={typeInfo.icon} size={20} color={typeIconColor} />
          </View>
          <View style={styles.requestInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.requestType}>{typeInfo.label}</Text>
              {request.hasUnreadTenantUpdates ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#DC2626' }} /> : null}
            </View>
            <Text style={styles.requestDate}>Last update {safeFormat(lastActivity, 'MMM dd, yyyy • h:mm a')}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor.bg, borderColor: statusColor.solid }]}>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9 }}>
            <Ionicons name={hasNewAttachment ? 'attach' : 'chatbubble-ellipses-outline'} size={13} color={colors.textMuted} />
            <Text style={{ flex: 1, fontSize: 11, color: colors.textMuted, fontWeight: '500' }} numberOfLines={1}>
              {latestUpdate.preview}
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
  }, [colors, getStatusColor, isDarkMode, styles, openDetail]);

  const requestListHeader = (
    <>
      {!showModal ? renderBanner() : null}

      <TouchableOpacity style={styles.submitCard} onPress={() => setShowModal(true)}>
        <View style={styles.submitIcon}><Ionicons name="add-circle" size={32} color={colors.interactive} /></View>
        <View style={styles.submitContent}>
          <Text style={styles.submitTitle}>Submit Service Request</Text>
          <Text style={styles.submitDescription}>Report issues, request maintenance, or send concerns</Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.quickServicesCard}>
        <Text style={styles.sectionTitle}>Quick Service Request</Text>
        <View style={styles.servicesGrid}>
          {REQUEST_TYPES.slice(0, 6).map((type) => {
            const foregroundColor = getServiceTypeIconColor(type.color, colors, isDarkMode);
            return (
              <TouchableOpacity key={type.id} style={styles.serviceItem} onPress={() => { setSelectedType(type.id); setShowModal(true); }}>
                <View style={[styles.serviceIcon, { backgroundColor: `${foregroundColor}18` }]}>
                  <Ionicons name={type.icon} size={24} color={foregroundColor} />
                </View>
                <Text style={styles.serviceLabel}>{type.label}</Text>
              </TouchableOpacity>
            );
          })}
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
          <Ionicons name="time-outline" size={15} color={activeTab === 'active' ? colors.onPrimary : colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>Active ({activeRequests.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'resolved' && styles.tabActive]} onPress={() => setActiveTab('resolved')}>
          <Ionicons name="checkmark-circle-outline" size={15} color={activeTab === 'resolved' ? colors.onPrimary : colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'resolved' && styles.tabTextActive]}>Resolved ({resolvedRequests.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'cancelled' && styles.tabActive]} onPress={() => setActiveTab('cancelled')}>
          <Ionicons name="close-circle-outline" size={15} color={activeTab === 'cancelled' ? colors.onPrimary : colors.textMuted} />
          <Text style={[styles.tabText, activeTab === 'cancelled' && styles.tabTextActive]}>Cancelled ({cancelledRequests.length})</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const requestListEmpty = (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name={activeTab === 'active' ? 'construct-outline' : activeTab === 'resolved' ? 'checkmark-done-circle' : 'close-circle-outline'} size={36} color={activeTab === 'active' ? colors.interactive : activeTab === 'resolved' ? colors.success : colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>
        {activeTab === 'active' ? 'No Active Requests' : activeTab === 'resolved' ? 'No Resolved Requests' : 'No Cancelled Requests'}
      </Text>
      <Text style={styles.emptyText}>
        {activeTab === 'active' ? 'You have no pending or in-progress requests. Tap above to submit one!' : activeTab === 'resolved' ? 'Resolved requests will appear here.' : 'You haven’t cancelled any requests.'}
      </Text>
    </View>
  );

  if (isLoading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.interactive} /></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Service Requests</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshIndicator}
          onPress={() => { setRefreshing(true); fetchRequests(); }}
          accessibilityLabel="Refresh service requests"
        >
          <Ionicons name="sync" size={18} color={colors.onPrimary} />
        </TouchableOpacity>
      </View>

      <FlatList
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        data={currentList}
        keyExtractor={requestKeyExtractor}
        renderItem={renderRequestItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.interactive]} tintColor={colors.interactive} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={requestListHeader}
        ListEmptyComponent={requestListEmpty}
        ListFooterComponent={<View style={styles.bottomSpacer} />}
      />

      <LilyAssistantFab />

      <Modal visible={showModal} animationType="slide" transparent={true} onRequestClose={confirmCloseModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Submit Service Request</Text>
                <TouchableOpacity
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}
                  onPress={confirmCloseModal}
                  accessibilityRole="button"
                  accessibilityLabel="Close Submit Service Request"
                >
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {showModal ? renderBanner() : null}
                <Text style={styles.modalSectionTitle}>Select Service Type</Text>
                <View style={styles.typeGrid}>
                  {REQUEST_TYPES.map((type) => {
                    const foregroundColor = getServiceTypeIconColor(type.color, colors, isDarkMode);
                    const isSelected = selectedType === type.id;
                    const iconBackground = isSelected
                      ? (isDarkMode ? `${foregroundColor}24` : type.color)
                      : `${foregroundColor}18`;
                    const iconColor = isSelected && !isDarkMode ? colors.onPrimary : foregroundColor;
                    return (
                      <TouchableOpacity
                        key={type.id}
                        style={[styles.typeItem, isSelected && styles.typeItemSelected]}
                        onPress={() => {
                          setSelectedType(type.id);
                          setFieldTouched((prev) => ({ ...prev, type: true }));
                        }}
                      >
                        <View style={[styles.typeIcon, { backgroundColor: iconBackground }]}>
                          <Ionicons name={type.icon} size={20} color={iconColor} />
                        </View>
                        <Text style={[styles.typeLabel, isSelected && styles.typeLabelSelected]}>{type.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
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
                  style={[styles.descriptionInput, fieldErrors.description && { borderColor: '#DC2626', borderWidth: 1 }]}
                  placeholder="Please provide details..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  value={description}
                  onChangeText={(val) => {
                    setDescription(val);
                  }}
                  onBlur={() => setFieldTouched((prev) => ({ ...prev, description: true }))}
                />
                <Text
                  style={[
                    styles.descriptionCounter,
                    description.length > MAX_DESCRIPTION_LENGTH && styles.descriptionCounterOver,
                  ]}
                >
                  {description.length} / {MAX_DESCRIPTION_LENGTH}
                </Text>
                {fieldErrors.description ? <Text style={styles.fieldError}>{fieldErrors.description}</Text> : null}
                <Text style={styles.modalSectionTitle}>Add Attachments (optional)</Text>
                <TouchableOpacity
                  style={[
                    styles.attachmentAction,
                    (submitting || attachments.length >= MAX_MAINTENANCE_ATTACHMENTS) && styles.attachmentActionDisabled,
                  ]}
                  onPress={() => setShowCreateAttachMenu(true)}
                  disabled={submitting || attachments.length >= MAX_MAINTENANCE_ATTACHMENTS}
                  accessibilityRole="button"
                  accessibilityLabel={attachments.length >= MAX_MAINTENANCE_ATTACHMENTS ? 'Attachment limit reached' : 'Add attachment'}
                  accessibilityHint="Choose a photo or document to include with this service request"
                >
                  <View style={styles.attachmentActionIcon}>
                    <Ionicons name="attach" size={21} color={colors.interactive} />
                  </View>
                  <View style={styles.attachmentActionContent}>
                    <Text style={styles.attachmentActionTitle}>
                      {attachments.length >= MAX_MAINTENANCE_ATTACHMENTS ? 'Attachment limit reached' : 'Add attachment'}
                    </Text>
                    <Text style={styles.attachmentActionHint}>Photos, PDF, Word, TXT, or CSV - max 5 MB each</Text>
                  </View>
                  <Text style={styles.attachmentCount}>{attachments.length}/{MAX_MAINTENANCE_ATTACHMENTS}</Text>
                </TouchableOpacity>
                {attachmentUploadStatus ? (
                  <Text style={styles.attachmentUploadNote}>{attachmentUploadStatus}</Text>
                ) : null}
                {attachments.length > 0 && (
                  <View style={styles.attachmentPreview}>
                    {attachments.map((file, index) => (
                      <View key={`${getAttachmentDisplayName(file)}-${index}`} style={styles.createAttachmentChip}>
                        <Ionicons name="document-attach-outline" size={16} color={colors.textMuted} />
                        <Text style={styles.createAttachmentName} numberOfLines={1}>{getAttachmentDisplayName(file)}</Text>
                        <TouchableOpacity
                          style={styles.removeAttachmentButton}
                          onPress={() => removeAttachment(index)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${getAttachmentDisplayName(file)}`}
                        >
                          <Ionicons name="close" size={17} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Submit Service Request"
                >
                  {submitting ? <ActivityIndicator color={colors.onPrimary} /> : <><Ionicons name="send" size={20} color={colors.onPrimary} /><Text style={styles.submitButtonText}>Submit Service Request</Text></>}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
          <AttachmentPickerSheet
            asOverlay
            visible={showCreateAttachMenu}
            onClose={() => setShowCreateAttachMenu(false)}
            onTakePhoto={() => handleAttach(pickFromCamera)}
            onChoosePhoto={() => handleAttach(pickFromLibrary)}
            onChooseDocument={() => handleAttach(pickDocument)}
            disabled={submitting}
          />
        </KeyboardAvoidingView>
      </Modal>

      <StyledModal
        visible={showDiscardConfirm}
        onClose={keepEditing}
        title="Discard this service request?"
        message="Your current selections and description will be lost. This cannot be undone."
        type="warning"
        buttons={[
          { text: 'Keep Editing', style: 'cancel', onPress: keepEditing },
          { text: 'Discard', style: 'destructive', onPress: discardAndClose },
        ]}
      />

      {/* ===== REQUEST DETAIL MODAL ===== */}
      <Modal visible={showDetailModal} animationType="slide" transparent onRequestClose={() => { setEditMode(false); setShowReplyAttachMenu(false); setShowDetailModal(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '92%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editMode ? 'Edit Request' : 'Request Details'}</Text>
                <TouchableOpacity onPress={() => { setEditMode(false); setShowReplyAttachMenu(false); setShowDetailModal(false); }}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {detailRequest && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {detailLoading ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                      <ActivityIndicator size="small" color={colors.interactive} />
                      <Text style={{ color: colors.textMuted, fontSize: 13 }}>Loading latest updates...</Text>
                    </View>
                  ) : null}
                  {/* Guided Stage Action Hub */}
                  {!editMode && (() => {
                    const currentStatus = (detailRequest.status || '').toLowerCase();
                    const currentIdx = MAINTENANCE_STATUS_STAGES.findIndex((s) => s.statuses.includes(currentStatus));
                    if (currentIdx === -1) return null;
                    const currentStage = MAINTENANCE_STATUS_STAGES[currentIdx];
                    return (
                      <View style={{ marginBottom: 20 }}>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>Guided Stage Action Hub</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 14 }}>
                          Step {currentIdx + 1} of {MAINTENANCE_STATUS_STAGES.length}: {currentStage.label} ({currentStage.detail})
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
                          {MAINTENANCE_STATUS_STAGES.map((stage, i) => {
                            const isActive = i <= currentIdx;
                            const isCurrent = i === currentIdx;
                            return (
                              <View key={stage.label} style={{ flex: 1, alignItems: 'center' }}>
                                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isActive ? colors.primary : colors.surfaceSecondary, justifyContent: 'center', alignItems: 'center', borderWidth: isCurrent ? 2 : 0, borderColor: isCurrent ? colors.interactive : 'transparent' }}>
                                  {isActive ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : <Text style={{ fontSize: 10, color: colors.textMuted }}>{i + 1}</Text>}
                                </View>
                                <Text style={{ fontSize: 9, color: isActive ? colors.interactive : colors.textMuted, marginTop: 4, textAlign: 'center' }}>{stage.label}</Text>
                                {i < MAINTENANCE_STATUS_STAGES.length - 1 && (
                                  <View style={{ position: 'absolute', top: 13, left: '60%', right: '-40%', height: 2, backgroundColor: isActive && i < currentIdx ? colors.primary : colors.surfaceSecondary }} />
                                )}
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Header info */}
                  {(() => {
                    const ti = getTypeInfo(detailRequest.request_type);
                    const typeIconColor = getServiceTypeIconColor(ti.color, colors, isDarkMode);
                    const sc = getStatusColor(detailRequest.status);
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                        <View style={[styles.requestIcon, { backgroundColor: `${typeIconColor}18` }]}>
                          <Ionicons name={ti.icon} size={24} color={typeIconColor} />
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
                  {!editMode && !['resolved', 'completed', 'rejected', 'cancelled', 'closed'].includes((detailRequest.status || '').toLowerCase()) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.infoBg, borderRadius: 10, padding: 12, marginBottom: 14 }}>
                      <Ionicons name="timer-outline" size={18} color={colors.infoText} />
                      <Text style={{ fontSize: 13, color: colors.infoText, fontWeight: '500' }}>Estimated: {RESOLUTION_ESTIMATES[detailRequest.urgency] || RESOLUTION_ESTIMATES.normal}</Text>
                    </View>
                  )}

                  {!editMode && (() => {
                    const currentStatus = (detailRequest.status || '').toLowerCase();
                    const currentIdx = MAINTENANCE_STATUS_STAGES.findIndex((s) => s.statuses.includes(currentStatus));
                    const currentStage = currentIdx !== -1 ? MAINTENANCE_STATUS_STAGES[currentIdx] : null;
                    return (
                      <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                          <Ionicons name={getStatusColor(detailRequest.status).icon} size={18} color={getStatusColor(detailRequest.status).text} />
                          <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginLeft: 8, flex: 1 }}>
                            {currentStage ? `Stage ${currentIdx + 1}: ${currentStage.cardTitle} • ${currentStage.detail}` : 'Current Status'}
                          </Text>
                          {currentStage?.badge && (
                            <View style={{ backgroundColor: colors.infoBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.infoText }}>{currentStage.badge}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20, fontWeight: '600' }}>{getStatusNextStep(detailRequest.status, detailRequest)}</Text>
                        <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 19, marginTop: 4 }}>{getNextStepDetail(detailRequest.status, detailRequest)}</Text>
                      </View>
                    );
                  })()}

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
                        {REQUEST_TYPES.map((type) => {
                          const foregroundColor = getServiceTypeIconColor(type.color, colors, isDarkMode);
                          const isSelected = editType === type.id;
                          const iconBackground = isSelected
                            ? (isDarkMode ? `${foregroundColor}24` : type.color)
                            : `${foregroundColor}18`;
                          const iconColor = isSelected && !isDarkMode ? colors.onPrimary : foregroundColor;
                          return (
                            <TouchableOpacity key={type.id} style={[styles.typeItem, isSelected && styles.typeItemSelected]} onPress={() => setEditType(type.id)}>
                              <View style={[styles.typeIcon, { backgroundColor: iconBackground }]}>
                                <Ionicons name={type.icon} size={20} color={iconColor} />
                              </View>
                              <Text style={[styles.typeLabel, isSelected && styles.typeLabelSelected]}>{type.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
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
                    <View style={{ backgroundColor: colors.warningBg, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.warning }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <Ionicons name="reader-outline" size={18} color={colors.warningText} />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: colors.warningText }}>Maintenance Summary</Text>
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
                          <Text style={{ fontSize: 11, color: colors.warningText, fontWeight: '800', textTransform: 'uppercase' }}>{label}</Text>
                          <Text style={{ fontSize: 13, color: colors.warningText, lineHeight: 19 }}>{value}</Text>
                        </View>
                      ))}
                      {detailTenantSummary.attachments?.length ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                          {detailTenantSummary.attachments.map((att, idx) => (
                            <TouchableOpacity key={`${getAttachmentDisplayName(att, idx)}_${idx}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.warningBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }} onPress={() => openAttachment(att)}>
                              <Ionicons name={isImageAttachment(att) ? 'image-outline' : 'document-outline'} size={13} color={colors.warningText} />
                              <Text style={{ fontSize: 11, color: colors.warningText, fontWeight: '700' }} numberOfLines={1}>{getAttachmentDisplayName(att, idx)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )}

                  {/* Conversation */}
                  {!editMode && (
                    <View style={{ marginBottom: 14 }} testID="maintenance-conversation">
                      <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 8 }}>Conversation</Text>
                      <View style={styles.conversationThread}>
                        {chatItems.length === 0 ? (
                          <View style={{ backgroundColor: colors.surfaceSecondary, borderRadius: 12, padding: 18, alignItems: 'center', gap: 6 }}>
                            <Ionicons name="chatbubbles-outline" size={22} color={colors.textMuted} />
                            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 }}>
                              Your request has been submitted.{'\n'}Messages from Lilycrest staff will appear here.
                            </Text>
                          </View>
                        ) : (
                          <View style={{ gap: 4 }}>
                          {chatItems.map((item) => {
                            if (item.kind === 'date') {
                              return (
                                <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 }}>
                                  <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                                  <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700' }}>{item.label}</Text>
                                  <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                                </View>
                              );
                            }

                            const entry = item.entry;
                            const isTenant = entry.isTenant;
                            const isStatusOnly = !entry.message && !entry.isSummary && Boolean(entry.statusTo) && !entry.attachments?.length;
                            const showSeen = isTenant && entry.id === latestTenantEntryId;

                            if (isStatusOnly) {
                              return (
                                <View key={item.id} style={{ alignItems: 'center', marginVertical: 4 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surfaceSecondary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                                    <Ionicons name="git-branch-outline" size={11} color={colors.textMuted} />
                                    <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600' }}>
                                      {entry.title} • {entry.timestamp ? safeFormat(entry.timestamp, 'h:mm a') : ''}
                                    </Text>
                                  </View>
                                </View>
                              );
                            }

                            return (
                              <View key={item.id} style={[styles.conversationMessageRow, { alignItems: isTenant ? 'flex-end' : 'flex-start' }]}>
                                {item.showSender && !isTenant ? (
                                  <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '700', marginBottom: 3, marginLeft: 4 }} numberOfLines={1}>
                                    {entry.actorLabel || 'Lilycrest Staff'}
                                  </Text>
                                ) : null}
                                <View
                                  style={[styles.conversationBubble, {
                                    backgroundColor: isTenant ? colors.primary : colors.surfaceSecondary,
                                    borderRadius: 16,
                                    borderBottomRightRadius: isTenant ? 4 : 16,
                                    borderBottomLeftRadius: isTenant ? 16 : 4,
                                  }]}
                                >
                                  {entry.isSummary ? (
                                    <Text style={{ fontSize: 11, fontWeight: '800', color: isTenant ? colors.onPrimary : colors.text, marginBottom: 3, textTransform: 'uppercase', opacity: 0.8 }}>
                                      Maintenance Summary
                                    </Text>
                                  ) : null}
                                  {entry.message ? (
                                    <Text style={{ fontSize: 14, color: isTenant ? colors.onPrimary : colors.text, lineHeight: 20 }}>
                                      {entry.message}
                                    </Text>
                                  ) : null}
                                  {entry.attachments?.length > 0 ? (
                                    <ScrollView
                                      horizontal
                                      showsHorizontalScrollIndicator={false}
                                      style={{ height: 84, flexGrow: 0, marginTop: entry.message ? 8 : 0 }}
                                      contentContainerStyle={{ alignItems: 'center' }}
                                    >
                                      <View style={{ flexDirection: 'row' }}>
                                        {entry.attachments.map((att, idx) => (
                                          <TouchableOpacity
                                            key={`${getAttachmentDownloadUrl(att) || 'attachment'}_${idx}`}
                                            style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surface, marginRight: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' }}
                                            activeOpacity={0.85}
                                            onPress={() => openAttachment(att)}
                                          >
                                            {getAttachmentDownloadUrl(att) && isImageAttachment(att) ? (
                                              <Image source={{ uri: getAttachmentDownloadUrl(att) }} style={{ width: 84, height: 84 }} resizeMode="cover" onError={(event) => {
                                                const message = sanitizeAttachmentErrorMessage(event?.nativeEvent?.error || 'Attachment preview could not be loaded.');
                                                console.warn('[MaintenanceAttachment] image-preview-failure', { name: getAttachmentDisplayName(att, idx), mimeType: att?.mimeType || att?.type || 'image', hostname: (() => { try { return new URL(getAttachmentDownloadUrl(att)).hostname; } catch (_) { return ''; } })(), errorType: 'ReactNativeImageError', message });
                                                showBannerMessage('error', /code=402|HTTP code.*402/i.test(message)
                                                  ? 'File storage is unavailable because Firebase billing is disabled. Please contact the administrator.'
                                                  : `Image could not be opened: ${message}`);
                                              }} />
                                            ) : (
                                              <View style={{ paddingHorizontal: 6, alignItems: 'center', gap: 4 }}>
                                                <Ionicons name={isOpenableAttachment(att) ? 'document-text-outline' : 'alert-circle-outline'} size={20} color={colors.textMuted} />
                                                <Text style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center' }} numberOfLines={2}>
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
                                <Text
                                  accessibilityLabel={showSeen ? `Sent ${safeFormat(entry.timestamp, 'h:mm a')}, seen by staff` : undefined}
                                  style={styles.conversationTimestamp}
                                >
                                  {entry.timestamp ? safeFormat(entry.timestamp, 'h:mm a') : ''}
                                  {showSeen ? ` • ${entry.seenByAdmin ? 'Seen' : 'Sent'}` : ''}
                                </Text>
                              </View>
                            );
                          })}
                          </View>
                        )}

                  {/* Attachment Thumbnails */}
                  {!editMode && detailRequest.attachments?.length > 0 && (
                    <View style={{ marginBottom: 14 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>Original Request Attachments ({detailRequest.attachments.length})</Text>
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

                  {/* Reopen note if exists */}
                  {!editMode && detailRequest.reopen_note && (
                    <View style={{ backgroundColor: colors.infoBg, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.info }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Ionicons name="refresh" size={14} color={colors.infoText} />
                        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.infoText }}>Reopened</Text>
                      </View>
                      <Text style={{ fontSize: 13, color: colors.infoText }}>{detailRequest.reopen_note}</Text>
                    </View>
                  )}

                  {!editMode && detailAllowedActions.has(MAINTENANCE_ACTIONS.REPLY) && (
                    <View testID="maintenance-composer" style={styles.replyComposer}>
                      {replyAttachments.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                          {replyAttachments.map((file) => (
                            <TouchableOpacity key={getAttachmentDisplayName(file)} style={styles.previewChip} onLongPress={() => removeReplyAttachment(getAttachmentDisplayName(file))}>
                              <Text style={styles.previewText}>{getAttachmentDisplayName(file)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                      {replyUploadStatus ? <Text style={{ color: replyUploadStatus.includes('failed') ? colors.errorText : colors.textMuted, fontSize: 12, marginBottom: 6 }}>{replyUploadStatus}</Text> : null}
                      <View style={styles.replyComposerBar}>
                        <TouchableOpacity
                          accessibilityLabel="Add attachment"
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.replyAttachButton}
                          onPress={() => setShowReplyAttachMenu(true)}
                          disabled={sendingReply}
                        >
                          <Ionicons name="attach" size={19} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TextInput
                          style={styles.replyInput}
                          placeholder="Type a message..."
                          placeholderTextColor={colors.textMuted}
                          multiline
                          textAlignVertical="center"
                          value={replyMessage}
                          onChangeText={setReplyMessage}
                        />
                        <TouchableOpacity
                          accessibilityLabel="Send message"
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            justifyContent: 'center',
                            alignItems: 'center',
                            backgroundColor: (sendingReply || (!replyMessage.trim() && replyAttachments.length === 0)) ? colors.border : colors.primary,
                          }}
                          onPress={sendMaintenanceReply}
                          disabled={sendingReply || (!replyMessage.trim() && replyAttachments.length === 0)}
                        >
                          {sendingReply ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="send" size={16} color={colors.onPrimary} />}
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
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
                          {saving ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={{ fontWeight: '700', color: colors.onPrimary }}>Save Changes</Text>}
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <>
                        {(detailAllowedActions.has(MAINTENANCE_ACTIONS.EDIT) || detailAllowedActions.has(MAINTENANCE_ACTIONS.CANCEL)) && (
                          <>
                            {detailAllowedActions.has(MAINTENANCE_ACTIONS.EDIT) && (
                              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14 }} onPress={enterEditMode}>
                                <Ionicons name="create-outline" size={20} color={colors.onPrimary} />
                                <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: 15 }}>Edit Request</Text>
                              </TouchableOpacity>
                            )}
                            {detailAllowedActions.has(MAINTENANCE_ACTIONS.CANCEL) && (
                              <TouchableOpacity
                                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.errorBg, borderRadius: 12, paddingVertical: 14 }}
                                onPress={() => setShowCancelConfirm(true)}
                                accessibilityRole="button"
                                accessibilityLabel="Cancel maintenance request"
                                accessibilityHint="Opens a confirmation before cancelling this Stage 1 request"
                              >
                                <Ionicons name="close-circle-outline" size={20} color={colors.errorText} />
                                <Text style={{ color: colors.errorText, fontWeight: '700', fontSize: 15 }}>Cancel Request</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                        {!detailRequest.tenant_confirmed_resolved && (detailAllowedActions.has(MAINTENANCE_ACTIONS.CONFIRM_RESOLVED) || detailAllowedActions.has(MAINTENANCE_ACTIONS.REOPEN)) && (
                          <>
                            {detailAllowedActions.has(MAINTENANCE_ACTIONS.CONFIRM_RESOLVED) && (
                              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 12, paddingVertical: 14 }} onPress={handleConfirmResolved} disabled={saving}>
                                <Ionicons name="checkmark-done-circle-outline" size={20} color="#065F46" />
                                <Text style={{ color: '#065F46', fontWeight: '700', fontSize: 15 }}>Confirm Resolved</Text>
                              </TouchableOpacity>
                            )}
                            {detailAllowedActions.has(MAINTENANCE_ACTIONS.REOPEN) && (
                              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EFF6FF', borderRadius: 12, paddingVertical: 14 }} onPress={() => setShowReopenModal(true)}>
                                <Ionicons name="refresh" size={20} color="#2563EB" />
                                <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 15 }}>Still an Issue</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                        {detailAllowedActions.has(MAINTENANCE_ACTIONS.SUBMIT_SIMILAR) && (
                          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingVertical: 14 }} onPress={submitSimilar}>
                            <Ionicons name="copy-outline" size={20} color={colors.text} />
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>Submit Similar</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
          <AttachmentPickerSheet
            asOverlay
            visible={showReplyAttachMenu}
            onClose={() => setShowReplyAttachMenu(false)}
            onTakePhoto={() => handleReplyAttach(pickFromCamera)}
            onChoosePhoto={() => handleReplyAttach(pickFromLibrary)}
            onChooseDocument={() => handleReplyAttach(pickDocument)}
            disabled={sendingReply}
          />
          {previewAttachment ? (
            <View style={[styles.confirmOverlay, StyleSheet.absoluteFillObject]}>
              <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => { setPreviewAttachment(null); setPreviewAttachmentError(''); }} />
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => {}}
                style={{
                  width: '88%',
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  padding: 16,
                  gap: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Attachment Preview</Text>
                  <TouchableOpacity onPress={() => { setPreviewAttachment(null); setPreviewAttachmentError(''); }}>
                    <Ionicons name="close" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                {getAttachmentDownloadUrl(previewAttachment) ? (
                  <Image
                    source={{ uri: getAttachmentDownloadUrl(previewAttachment) }}
                    style={{ width: '100%', height: 340, borderRadius: 12, backgroundColor: colors.surfaceSecondary }}
                    resizeMode="contain"
                    onError={(event) => {
                      const message = sanitizeAttachmentErrorMessage(event?.nativeEvent?.error || 'Attachment preview could not be loaded.');
                      let hostname = '';
                      try { hostname = new URL(getAttachmentDownloadUrl(previewAttachment)).hostname; } catch (_) { hostname = ''; }
                      console.warn('[MaintenanceAttachment] image-preview-failure', { name: getAttachmentDisplayName(previewAttachment), mimeType: previewAttachment?.mimeType || previewAttachment?.type || 'image', hostname, errorType: 'ReactNativeImageError', message });
                      const visibleError = /code=402|HTTP code.*402/i.test(message)
                        ? 'File storage is unavailable because Firebase billing is disabled. Please contact the administrator.'
                        : `Image could not be opened: ${message}`;
                      setPreviewAttachmentError(visibleError);
                      showBannerMessage('error', visibleError);
                    }}
                  />
                ) : null}
                {previewAttachmentError ? (
                  <View style={{ backgroundColor: '#FEF2F2', borderColor: '#DC2626', borderWidth: 1, borderRadius: 10, padding: 10 }}>
                    <Text style={{ color: '#991B1B', fontSize: 12, lineHeight: 18 }}>{previewAttachmentError}</Text>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, color: colors.textMuted }}>
                  {previewAttachment ? getAttachmentDisplayName(previewAttachment) : 'Attachment preview'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>

      {/* Cancel Confirmation */}
      <StyledModal
        visible={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        title="Cancel this request?"
        message="This action will cancel your service request. You can submit a new one anytime."
        type="error"
        buttons={[
          { text: 'Keep Request', style: 'cancel', onPress: () => setShowCancelConfirm(false) },
          { text: 'Cancel Request', style: 'destructive', onPress: handleCancel, loading: saving },
        ]}
      />

      {/* Reopen Modal */}
      <StyledModal
        visible={showReopenModal}
        onClose={() => { setShowReopenModal(false); setReopenNote(''); }}
        title="Reopen this request?"
        message="The request will be set back to Pending so the team can review it again."
        type="info"
        buttons={[
          { text: 'Nevermind', style: 'cancel', onPress: () => { setShowReopenModal(false); setReopenNote(''); } },
          { text: 'Reopen', style: 'info', onPress: handleReopen, loading: saving },
        ]}
      >
        <TextInput
          style={styles.reopenInput}
          placeholder="Add a note (optional)..."
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          value={reopenNote}
          onChangeText={setReopenNote}
        />
      </StyledModal>
    </SafeAreaView>
  );
}

