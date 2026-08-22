import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useLocalSearchParams, useRouter } from 'expo-router';
import InquiryCard from '../components/assistant/InquiryCard';
import AttachmentPickerSheet from '../components/AttachmentPickerSheet';
import LilyFlowerIcon from '../components/assistant/LilyFlowerIcon';
import MessageBubble from '../components/assistant/MessageBubble';
import { useAuth } from '../context/AuthContext';
import { useTheme, useThemedStyles } from '../context/ThemeContext';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { apiService } from '../services/api';
import { getChatErrorMessage } from '../utils/chatErrorMessage';
import {
  IMAGE_UPLOAD_MIME_TYPES,
  ensureFirebaseStorageAttachments,
  getAttachmentDisplayName,
} from '../services/firebaseStorageUpload';
import { pickDocument, pickFromCamera, pickFromLibrary } from '../utils/attachmentPicker';
import { openChatAttachment } from '../utils/chatAttachmentViewer';
import { subscribeCanonicalRealtime } from '../services/realtime';
import {
  getLatestOutgoingMessageId,
  inquiryTicketLabel,
  supportStatusGroup,
  supportStatusLabel,
} from '../utils/supportConversationPresentation';
import { getLilyTopicSuggestions, LILY_TOPICS } from '../utils/lilyTopicSuggestions';

const ASSISTANT_UPLOAD_MIME_TYPES = [...IMAGE_UPLOAD_MIME_TYPES, 'application/pdf'];
const SUPPORT_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

function FollowupChips({ suggestions, onSelect }) {
  if (!suggestions?.length) return null;

  return (
    <View style={followupStyles.container}>
      {suggestions.map((suggestion, index) => (
        <Pressable
          key={`${suggestion.label}-${index}`}
          style={followupStyles.chip}
          onPress={() => onSelect(suggestion.prompt)}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={13} color="#D4AF37" />
          <Text style={followupStyles.text}>{suggestion.label}</Text>
          <Ionicons name="chevron-forward" size={12} color="#D4AF37" />
        </Pressable>
      ))}
    </View>
  );
}

const followupStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    marginBottom: 10,
    paddingLeft: 48,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F3E4B0',
  },
  text: {
    color: '#92400E',
    fontWeight: '600',
    fontSize: 12,
  },
});

function TypingIndicator({ label = 'Lily is thinking...' }) {
  return (
    <View style={typingStyles.row}>
      <View style={typingStyles.avatar}>
        <LilyFlowerIcon size={20} />
      </View>
      <View style={typingStyles.bubble}>
        <View style={typingStyles.dot} />
        <View style={typingStyles.dot} />
        <View style={typingStyles.dot} />
      </View>
      <Text style={typingStyles.label}>{label}</Text>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#0A1628',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bubble: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#0A1628',
  },
  label: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
  },
});

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'solved', label: 'Solved' },
];

const ADMIN_KEYWORDS = [
  'connect me to admin',
  'connect me to the admin',
  'connect me to an admin',
  'i want to talk to admin',
  'talk to admin',
  'talk to the admin',
  'contact admin',
  'notify admin',
  'notify the admin',
  'message admin',
  'ask admin',
  'branch admin',
  'owner',
  'speak to admin',
  'escalate',
  'complain',
  'reklamo',
  'noisy neighbor',
  'maingay',
  'complaint to admin',
  'file a complaint',
  'report to admin',
  'submit inquiry',
  'someone assist',
  'can someone assist me',
  'human help',
  'human agent',
  'real person',
  'kausapin admin',
  'ipaalam sa admin',
  'sabihin sa admin',
  'ireport sa admin',
  'i-report sa admin',
];

const MAX_CHAT_INPUT_CHARS = 800;
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ASSISTANT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_SUPPORT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const LIVE_CHAT_POLL_MS = 5000;
const SEND_RATE_LIMIT_MS = 900;
const CHAT_MODE = {
  AI: 'ai',
  NEEDS_ADMIN: 'needs_admin',
  WAITING: 'waiting',
  ACTIVE: 'active',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  RESOLVED: 'resolved',
  UNAVAILABLE: 'unavailable',
  CLOSED: 'closed',
};

const normalizeKey = (text = '') =>
  text
    .trim()
    .toLowerCase()
    .replace(/[?.!]/g, '')
    .replace(/\s+/g, ' ');

const isAdminEscalation = (text = '') =>
  ADMIN_KEYWORDS.some((phrase) => normalizeKey(text).includes(phrase));

const sanitizeChatInput = (text = '') =>
  text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

const attachmentKey = (file = {}) => `${file.name || 'file'}::${file.size || 0}::${file.uri || ''}`;

const formatTimestamp = (date) =>
  date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const formatTime = (date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const getTypingLabel = (intent = 'general') => {
  switch (intent) {
    case 'billing':
      return 'Let me check your account...';
    case 'maintenance':
      return 'Let me look up your request...';
    case 'profile':
      return 'Let me pull up your details...';
    default:
      return 'Lily is thinking...';
  }
};

const normalizeSupportCategory = (text = '', intent = '') => {
  const source = `${text} ${intent}`.toLowerCase();
  if (/complaint|complain|reklamo|noisy|maingay|unsafe|harass|legal|danger|urgent|emergency|threat|abuse|violation/.test(source)) return 'urgent_issue';
  if (/billing|late fee|overdue|payment|paymongo|invoice|bill|balance|bayarin|bayad|rent|due date|paid already|already paid/.test(source)) return 'billing_concern';
  if (/maintenance|repair|leak|electrical|no power|no water|plumbing|sira|fix|admin reply|repair request/.test(source)) return 'maintenance_concern';
  if (/reservation|move in|move-in|room slot|bed slot|booking/.test(source)) return 'reservation_concern';
  if (/gcash|maya|bank transfer|payment proof|proof of payment/.test(source)) return 'payment_concern';
  return 'general_inquiry';
};

const normalizeSupportPriority = (category = 'general_inquiry', text = '') => {
  const source = String(text || '').toLowerCase();
  if (category === 'urgent_issue') return 'urgent';
  if (/complaint|dispute|escalate|urgent|asap|immediately/.test(source)) return 'high';
  return 'normal';
};

const supportTitle = (category = '') => {
  const normalized = String(category || '').trim();
  if (!normalized) return 'Admin Support';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase());
};

const toSupportFeedMessage = (message) => ({
  id: `support-${message.id}`,
  sender: message.senderRole === 'tenant' ? 'user' : 'admin',
  text: message.message || '',
  time: formatTime(message.createdAt ? new Date(message.createdAt) : new Date()),
  avatar: message.senderRole === 'tenant' ? 'U' : 'A',
  avatarUri: message.senderProfileImage || '',
  attachments: Array.isArray(message.attachments) ? message.attachments : [],
  readAt: message.readAt || null,
});

const toSupportThreadMessage = (message) => ({
  id: message.id || `thread-${Date.now()}`,
  sender: message.senderRole === 'tenant' ? 'user' : 'admin',
  text: message.message || '',
  time: formatTime(message.createdAt ? new Date(message.createdAt) : new Date()),
  attachments: Array.isArray(message.attachments) ? message.attachments : [],
  avatarUri: message.senderProfileImage || '',
  readAt: message.readAt || null,
});

const toInquiryCard = (conversation) => {
  const created = conversation.createdAt ? new Date(conversation.createdAt) : new Date();
  const last = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : created;
  return {
    id: conversation.id,
    ticketId: inquiryTicketLabel(conversation.ticketId),
    title: supportTitle(conversation.category),
    status: supportStatusGroup(conversation.status),
    canonicalStatus: conversation.status || 'open',
    timestamp: formatTimestamp(last),
    preview:
      conversation.lastMessage
      || (conversation.status === 'resolved'
        ? 'Admin support resolved this concern.'
        : conversation.status === 'closed'
          ? 'This support conversation is closed.'
          : 'Admin support is active for this concern.'),
    conversation,
    thread: [],
  };
};

const getConversationMode = (conversation) => {
  switch (conversation?.status) {
    case 'resolved':
      return CHAT_MODE.RESOLVED;
    case 'closed':
      return CHAT_MODE.CLOSED;
    case 'waiting_tenant':
      return CHAT_MODE.AWAITING_CONFIRMATION;
    case 'open':
    case 'in_review':
      return CHAT_MODE.WAITING;
    default:
      return CHAT_MODE.AI;
  }
};

const isSupportMode = (mode) => [
  CHAT_MODE.WAITING,
  CHAT_MODE.ACTIVE,
  CHAT_MODE.AWAITING_CONFIRMATION,
].includes(mode);

export default function LilyAssistantScreen() {
  const router = useRouter();
  const {
    conversationId: notificationConversationIdParam,
    messageId: notificationMessageIdParam,
  } = useLocalSearchParams();
  const notificationConversationId = Array.isArray(notificationConversationIdParam)
    ? notificationConversationIdParam[0]
    : notificationConversationIdParam;
  const notificationMessageId = Array.isArray(notificationMessageIdParam)
    ? notificationMessageIdParam[0]
    : notificationMessageIdParam;
  const scrollRef = useRef(null);
  const adminScrollRef = useRef(null);
  const seenSupportMsgIds = useRef(new Set());
  const sendGuardRef = useRef(false);
  const escalationGuardRef = useRef(false);
  const replyGuardRef = useRef(false);
  const reopenGuardRef = useRef(false);
  const resolutionGuardRef = useRef(false);
  const sendCooldownRef = useRef(0);
  const handledNotificationConversationRef = useRef('');
  const { user, authReady } = useAuth();
  const { colors } = useTheme();
  const styles = useThemedStyles(createAssistantStyles);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('chat');
  const [filter, setFilter] = useState('all');
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [attachmentUploadStatus, setAttachmentUploadStatus] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isReopeningInquiry, setIsReopeningInquiry] = useState(false);
  const [isConfirmingResolution, setIsConfirmingResolution] = useState(false);
  const [satisfactionRating, setSatisfactionRating] = useState(0);
  const [satisfactionFeedback, setSatisfactionFeedback] = useState('');
  const [chatMode, setChatMode] = useState(CHAT_MODE.AI);
  const [pendingAdminReason, setPendingAdminReason] = useState('');
  const [pendingAdminIntent, setPendingAdminIntent] = useState('general');
  const [liveAdminName, setLiveAdminName] = useState('');
  const [supportConversationId, setSupportConversationId] = useState(null);
  const [supportConversation, setSupportConversation] = useState(null);
  const [isEscalating, setIsEscalating] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [selectedInquiry, setSelectedInquiry] = useState(null);
  const [refreshingSupport, setRefreshingSupport] = useState(false);

  const initialSession = useMemo(
    () => `${user?.user_id || 'guest'}-chat-${Date.now()}`,
    [user?.user_id]
  );
  const chat = useAssistantChat(initialSession);
  const tabBarHeight = useBottomTabBarHeight();
  const suggestedQuestions = useMemo(
    () => getLilyTopicSuggestions(selectedTopic),
    [selectedTopic],
  );

  const markInteracted = () => {
    if (!hasInteracted) setHasInteracted(true);
  };

  const statusLabel = useMemo(() => {
    switch (chatMode) {
      case CHAT_MODE.WAITING:
        return 'Admin Support';
      case CHAT_MODE.ACTIVE:
      case CHAT_MODE.AWAITING_CONFIRMATION:
        return liveAdminName ? `Admin Support - ${liveAdminName}` : 'Admin Support';
      case CHAT_MODE.RESOLVED:
        return 'Support Resolved';
      default:
        return 'Lily AI Assistant';
    }
  }, [chatMode, liveAdminName]);

  const statusDotStyle = useMemo(() => {
    switch (chatMode) {
      case CHAT_MODE.WAITING:
      case CHAT_MODE.NEEDS_ADMIN:
        return { backgroundColor: '#D97706' };
      case CHAT_MODE.ACTIVE:
      case CHAT_MODE.AWAITING_CONFIRMATION:
        return { backgroundColor: '#2563EB' };
      case CHAT_MODE.RESOLVED:
      case CHAT_MODE.CLOSED:
        return { backgroundColor: '#059669' };
      case CHAT_MODE.UNAVAILABLE:
        return { backgroundColor: '#DC2626' };
      default:
        return { backgroundColor: '#059669' };
    }
  }, [chatMode]);

  const clearEscalationPrompt = () => {
    setPendingAdminReason('');
    setPendingAdminIntent('general');
  };

  const updateInquiryRecord = (conversation, thread = null) => {
    if (!conversation?.id) return;
    const mapped = toInquiryCard(conversation);
    const nextRecord = { ...mapped, thread: thread || mapped.thread };

    setInquiries((prev) => {
      const others = prev.filter((item) => item.id !== nextRecord.id);
      return [nextRecord, ...others].sort((left, right) => {
        const leftTime = new Date(left.conversation?.lastMessageAt || 0).getTime();
        const rightTime = new Date(right.conversation?.lastMessageAt || 0).getTime();
        return rightTime - leftTime;
      });
    });

    setSelectedInquiry((prev) => {
      if (!prev || prev.id !== nextRecord.id) return prev;
      return {
        ...nextRecord,
        thread: thread || prev.thread || [],
      };
    });
  };

  const syncConversationState = (conversation, options = {}) => {
    if (!conversation) return;
    const { preserveClosed = false } = options;

    setSupportConversation(conversation);
    setSupportConversationId(conversation.status === 'closed' ? null : conversation.id || null);
    if (conversation.assignedAdminName) {
      setLiveAdminName(conversation.assignedAdminName);
    }

    const nextMode = getConversationMode(conversation);
    if (nextMode === CHAT_MODE.CLOSED && preserveClosed) return;
    setChatMode(nextMode);
  };

  const loadSupportInquiries = async (options = {}) => {
    const { preserveSelection = true } = options;
    const { data } = await apiService.getMySupportChats();
    const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
    setInquiries(conversations.map(toInquiryCard));

    if (preserveSelection && selectedInquiry?.id) {
      const match = conversations.find((item) => item.id === selectedInquiry.id);
      if (!match) {
        setSelectedInquiry(null);
      } else {
        setSelectedInquiry((prev) => ({
          ...toInquiryCard(match),
          thread: prev?.thread || [],
        }));
      }
    }

    return conversations;
  };

  const refreshSupportConversation = async (conversationId, options = {}) => {
    if (!conversationId) return { conversation: null, thread: [] };
    const { replaceMainFeed = false, scroll = false } = options;
    const { data } = await apiService.getSupportChatMessages(conversationId);
    const conversation = data?.conversation || null;
    const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
    const thread = rawMessages.map(toSupportThreadMessage);

    if (replaceMainFeed) {
      rawMessages.forEach((item) => seenSupportMsgIds.current.add(item.id));
      setMessages(rawMessages.map(toSupportFeedMessage));
    } else {
      rawMessages.forEach((item) => seenSupportMsgIds.current.add(item.id));
      const canonicalSupportMessages = rawMessages.map(toSupportFeedMessage);
      setMessages((prev) => [
        ...prev.filter((item) => !String(item.id || '').startsWith('support-')),
        ...canonicalSupportMessages,
      ]);
    }

    if (conversation) {
      syncConversationState(conversation);
      updateInquiryRecord(conversation, thread);
    }

    if (scroll) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
        adminScrollRef.current?.scrollToEnd({ animated: true });
      }, 120);
    }

    return { conversation, thread };
  };

  const handlePullToRefresh = async (view = activeTab) => {
    if (refreshingSupport) return;

    setRefreshingSupport(true);
    setNetworkError(null);

    try {
      const conversations = await loadSupportInquiries({ preserveSelection: view !== 'chat' });
      const shouldRefreshSupportChat =
        view !== 'chat' || isSupportMode(chatMode) || chatMode === CHAT_MODE.RESOLVED;
      const activeConversation =
        conversations.find((item) => item.id === selectedInquiry?.id)
        || (shouldRefreshSupportChat
          ? conversations.find((item) => item.id === supportConversationId)
            || conversations.find((item) => item.status !== 'closed')
          : null);

      if (view === 'detail' && selectedInquiry?.id) {
        await refreshSupportConversation(selectedInquiry.id, { replaceMainFeed: false, scroll: false });
      } else if (view === 'chat' && shouldRefreshSupportChat && activeConversation?.id) {
        await refreshSupportConversation(activeConversation.id, {
          replaceMainFeed:
            activeConversation.id === supportConversationId
            && (isSupportMode(chatMode) || chatMode === CHAT_MODE.RESOLVED),
          scroll: false,
        });
      }
    } catch (error) {
      setNetworkError(getChatErrorMessage(error, 'Unable to refresh support data right now.'));
    } finally {
      setRefreshingSupport(false);
    }
  };

  const requestAdminSupport = async (reason, options = {}) => {
    if (escalationGuardRef.current || isEscalating) return;
    if (supportConversationId && isSupportMode(chatMode)) return;

    escalationGuardRef.current = true;
    setIsEscalating(true);
    setNetworkError(null);

    try {
      const normalizedReason = sanitizeChatInput(reason || pendingAdminReason).slice(0, MAX_CHAT_INPUT_CHARS);
      const normalizedIntent = options.intent || pendingAdminIntent || 'general';
      const category = normalizeSupportCategory(normalizedReason, normalizedIntent);
      const priority = normalizeSupportPriority(category, normalizedReason);

      const { data } = await apiService.startSupportChat({
        category,
        priority,
        initialMessage: normalizedReason || undefined,
        assistantSessionId: chat.sessionId,
      });

      const conversation = data?.conversation;
      if (!conversation?.id) {
        throw new Error('Admin support could not be started.');
      }

      syncConversationState(conversation);
      updateInquiryRecord(conversation);
      clearEscalationPrompt();
      setActiveTab('chat');
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-support-${Date.now()}`,
          sender: 'system',
          text: data?.reusedExisting ? 'Admin support is now active.' : 'Your concern has been sent to the admin.',
        },
      ]);

      await refreshSupportConversation(conversation.id, { replaceMainFeed: false, scroll: true });
      await loadSupportInquiries();
    } catch (error) {
      setChatMode(CHAT_MODE.UNAVAILABLE);
      setNetworkError(getChatErrorMessage(error, 'Admin support could not be started right now.'));
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-support-error-${Date.now()}`,
          sender: 'system',
          text: 'Admin support could not be started right now.',
        },
      ]);
    } finally {
      escalationGuardRef.current = false;
      setIsEscalating(false);
    }
  };

  const performCloseSupportConversation = async () => {
    if (!supportConversationId) return;
    setNetworkError(null);
    try {
      const { data } = await apiService.closeSupportChat(
        supportConversationId,
        'Closed by tenant from Lily Assistant.'
      );
      const closedConversation = data?.conversation;
      if (!closedConversation || closedConversation.status !== 'closed') {
        throw new Error('Support did not confirm that this conversation was closed.');
      }
      updateInquiryRecord(
        closedConversation,
        selectedInquiry?.id === closedConversation.id ? selectedInquiry.thread : null
      );
      setSupportConversation(closedConversation);
      setSupportConversationId(null);
      setLiveAdminName('');
      clearEscalationPrompt();
      setChatMode(CHAT_MODE.CLOSED);
      seenSupportMsgIds.current.clear();
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-support-closed-${Date.now()}`,
          sender: 'system',
          text: 'Lily Assistant is available again after this support conversation is closed.',
        },
      ]);
    } catch (error) {
      setNetworkError(getChatErrorMessage(error, 'Unable to close this support conversation.'));
    }
  };

  const closeSupportConversation = () => {
    if (!supportConversationId) return;
    Alert.alert(
      'Close support conversation?',
      'This ends the current thread. You can reopen it later from My Inquiries if the concern returns.',
      [
        { text: 'Keep Open', style: 'cancel' },
        { text: 'Close', style: 'destructive', onPress: performCloseSupportConversation },
      ],
    );
  };

  const returnToLilyAssistant = async (options = {}) => {
    const { closeConversation = false } = options;

    if (closeConversation && supportConversationId) {
      try {
        const { data } = await apiService.closeSupportChat(
          supportConversationId,
          'Closed after tenant returned to Lily Assistant.'
        );
        if (data?.conversation) {
          setSupportConversation(data.conversation);
          updateInquiryRecord(
            data.conversation,
            selectedInquiry?.id === data.conversation.id ? selectedInquiry.thread : null
          );
        }
      } catch (error) {
        console.warn('[Support Chat] Return to Lily close failed:', error?.message);
      }
    }

    if (closeConversation || chatMode === CHAT_MODE.CLOSED) {
      setSupportConversationId(null);
      setLiveAdminName('');
    }

    clearEscalationPrompt();
    setNetworkError(null);
    setChatMode(CHAT_MODE.AI);
  };

  const sendSupportMessage = async (text, supportAttachments = []) => {
    const now = Date.now();
    if (now - sendCooldownRef.current < SEND_RATE_LIMIT_MS) {
      throw new Error('Please wait a moment before sending again.');
    }

    if (!supportConversationId) {
      throw new Error('Admin support is not active right now.');
    }

    sendCooldownRef.current = now;
    setIsSending(true);
    setNetworkError(null);

    try {
      await apiService.sendSupportMessage(supportConversationId, text, supportAttachments);
      await refreshSupportConversation(supportConversationId, { replaceMainFeed: false, scroll: true });
      await loadSupportInquiries();
    } catch (error) {
      setNetworkError(getChatErrorMessage(error, 'Failed to send your message to admin support.'));
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    chat.loadPersistedSession();
    // Load the persisted assistant session only once for this hook instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.loadPersistedSession]);

  useEffect(() => {
    const bootstrapSupport = async () => {
      if (!authReady) return;

      if (!user) {
        setNetworkError('Please sign in to use Lily Assistant.');
        return;
      }

      try {
        setNetworkError(null);
        const conversations = await loadSupportInquiries({ preserveSelection: false });
        const targetConversationId = String(notificationConversationId || '').trim();
        const targetConversation = conversations.find(
          (conversation) => String(conversation.id) === targetConversationId,
        );
        if (
          targetConversation
          && handledNotificationConversationRef.current !== targetConversationId
        ) {
          handledNotificationConversationRef.current = targetConversationId;
          setActiveTab('chat');
          await refreshSupportConversation(targetConversationId, {
            replaceMainFeed: true,
            scroll: true,
          });
        }
      } catch (error) {
        setInquiries([]);
        setNetworkError(getChatErrorMessage(error, 'Unable to initialize admin support right now.'));
      }
    };

    bootstrapSupport();
    // These support helpers intentionally use the latest selected conversation refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, notificationConversationId, user?.user_id]);

  useEffect(() => {
    if (!supportConversationId) return;
    if (!isSupportMode(chatMode) && chatMode !== CHAT_MODE.RESOLVED) return;

    let cancelled = false;
    const poll = async () => {
      try {
        if (cancelled) return;
        await refreshSupportConversation(supportConversationId, { replaceMainFeed: false, scroll: true });
      } catch (error) {
        if (!cancelled) {
          console.warn('[Support Chat] Poll failed:', error?.message);
        }
      }
    };

    poll();
    const interval = setInterval(poll, LIVE_CHAT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Polling uses the current conversation id and mode; helper identity is not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportConversationId, chatMode]);

  useEffect(() => {
    if (!user?.user_id) return undefined;
    const refreshFromRealtime = async (payload = {}) => {
      const conversationId = String(payload.conversationId || payload.id || '').trim();
      const messageId = String(payload.message?.id || '').trim();
      if (messageId && seenSupportMsgIds.current.has(messageId)) return;
      if (messageId) seenSupportMsgIds.current.add(messageId);
      await loadSupportInquiries().catch(() => undefined);
      const visibleConversationId = selectedInquiry?.id || supportConversationId;
      if (conversationId && conversationId === visibleConversationId) {
        await refreshSupportConversation(conversationId, {
          replaceMainFeed: !selectedInquiry && conversationId === supportConversationId,
          scroll: true,
        }).catch(() => undefined);
      }
    };
    const unsubscribeMessage = subscribeCanonicalRealtime('chat:message-new', refreshFromRealtime);
    const unsubscribeConversation = subscribeCanonicalRealtime('chat:conversation-updated', refreshFromRealtime);
    return () => {
      unsubscribeMessage();
      unsubscribeConversation();
    };
    // Rebind only when the visible canonical conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInquiry?.id, supportConversationId, user?.user_id]);

  const handleSend = async (presetText) => {
    if (sendGuardRef.current || isEscalating) return;

    const text = sanitizeChatInput(presetText || inputValue);
    if (!text && !attachments.length) return;

    if (text.length > MAX_CHAT_INPUT_CHARS) {
      setNetworkError(`Message is too long. Please keep it under ${MAX_CHAT_INPUT_CHARS} characters.`);
      return;
    }

    if (chatMode === CHAT_MODE.RESOLVED) {
      setNetworkError('This support conversation is resolved. Continue with Lily Assistant or close the conversation first.');
      return;
    }

    if (chatMode === CHAT_MODE.NEEDS_ADMIN) {
      setChatMode(CHAT_MODE.AI);
      clearEscalationPrompt();
    }

    if (chatMode === CHAT_MODE.AWAITING_CONFIRMATION) {
      setNetworkError('Please choose YES or NO before continuing this support conversation.');
      return;
    }

    if (chatMode === CHAT_MODE.UNAVAILABLE || chatMode === CHAT_MODE.CLOSED) {
      setChatMode(CHAT_MODE.AI);
    }

    sendGuardRef.current = true;
    setNetworkError(null);
    let optimisticMessageId = '';

    try {
      let uploadedAttachments = attachments;
      if (attachments.length) {
        setIsSending(true);
        setAttachmentUploadStatus('Uploading attachment...');
        if (isSupportMode(chatMode)) {
          uploadedAttachments = [];
          for (let index = 0; index < attachments.length; index += 1) {
            setAttachmentUploadStatus(`Uploading attachment ${index + 1} of ${attachments.length}...`);
            const response = await apiService.uploadSupportAttachment(
              supportConversationId,
              attachments[index],
            );
            if (!response.data?.attachment) throw new Error('Attachment upload did not complete.');
            uploadedAttachments.push(response.data.attachment);
          }
        } else {
          uploadedAttachments = await ensureFirebaseStorageAttachments(attachments, {
            allowedMimeTypes: ASSISTANT_UPLOAD_MIME_TYPES,
            entityId: chat.sessionId || initialSession,
            folder: 'ai-assistant-attachments',
            maxBytes: MAX_ASSISTANT_ATTACHMENT_BYTES,
            tenantId: user?.user_id || user?.id || 'unknown-tenant',
          });
        }
        setAttachmentUploadStatus('Attachment uploaded');
      } else {
        setAttachmentUploadStatus('');
      }

      const userMessage = {
        id: `${supportConversationId && isSupportMode(chatMode) ? 'support-local' : 'user'}-${Date.now()}`,
        sender: 'user',
        text,
        time: formatTime(new Date()),
        avatar: 'U',
        attachments: uploadedAttachments,
      };
      optimisticMessageId = userMessage.id;

      markInteracted();
      setMessages((prev) => [...prev, userMessage]);
      setInputValue('');
      setAttachments([]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

      if (supportConversationId && isSupportMode(chatMode)) {
        await sendSupportMessage(text, uploadedAttachments);
        return;
      }

      const assistantText = text || 'Please read this attachment and summarize the useful information you can verify.';

      if (isAdminEscalation(assistantText)) {
        await requestAdminSupport(assistantText, { intent: 'general' });
        return;
      }

      setIsSending(true);
      const { response, intent, metadata, needsAdmin, suggestions, error } = await chat.sendMessage(assistantText, uploadedAttachments);

      if (error) {
        setNetworkError(error.detail || 'Unable to reach Lily Assistant right now.');
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-error-${Date.now()}`,
            sender: 'bot',
            text: 'I could not connect to Lily Assistant. Please try again.',
            time: formatTime(new Date()),
            avatar: 'L',
            meta: { intent: 'fallback', confidence: null },
          },
        ]);
        return;
      }

      if (!response) {
        setNetworkError('Lily Assistant did not return a response. Please try again.');
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: 'bot',
          text: response,
          time: formatTime(new Date()),
          avatar: 'L',
          suggestions: suggestions || [],
          meta: {
            intent: intent || metadata?.intent || 'general',
            confidence: metadata?.confidence ?? null,
            embeddingId: metadata?.embedding_id || null,
          },
        },
      ]);

      if (needsAdmin) {
        setPendingAdminReason(assistantText);
        setPendingAdminIntent(intent || metadata?.intent || 'general');
        setChatMode(CHAT_MODE.NEEDS_ADMIN);
      }
    } catch (error) {
      if (optimisticMessageId.startsWith('support-local-')) {
        setMessages((prev) => prev.filter((item) => item.id !== optimisticMessageId));
        setInputValue(text);
        setAttachments(attachments);
      }
      if (attachments.length) {
        setAttachmentUploadStatus('Upload failed, please retry');
      }
      setNetworkError(getChatErrorMessage(error, 'Unable to send your message. Please try again.'));
    } finally {
      setIsSending(false);
      sendGuardRef.current = false;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  };

  const sendReply = async () => {
    const text = sanitizeChatInput(replyText).slice(0, MAX_CHAT_INPUT_CHARS);
    if (!text || !selectedInquiry || replyGuardRef.current) return;

    replyGuardRef.current = true;
    setIsSendingReply(true);
    setReplyText('');

    const optimisticMessage = {
      id: `reply-${Date.now()}`,
      sender: 'user',
      text,
      time: formatTime(new Date()),
    };

    setSelectedInquiry((prev) => (
      prev
        ? { ...prev, thread: [...(prev.thread || []), optimisticMessage] }
        : prev
    ));

    try {
      await apiService.sendSupportMessage(selectedInquiry.id, text);
      await refreshSupportConversation(selectedInquiry.id, { replaceMainFeed: false, scroll: true });
      await loadSupportInquiries();
    } catch (error) {
      setReplyText(text);
      setNetworkError(getChatErrorMessage(error, 'Failed to send your message to admin support.'));
      setSelectedInquiry((prev) => (
        prev
          ? { ...prev, thread: (prev.thread || []).filter((item) => item.id !== optimisticMessage.id) }
          : prev
      ));
      await refreshSupportConversation(selectedInquiry.id, {
        replaceMainFeed: false,
        scroll: false,
      }).catch(() => undefined);
    } finally {
      replyGuardRef.current = false;
      setIsSendingReply(false);
      setTimeout(() => adminScrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const performReopenSelectedInquiry = async (conversationId) => {
    if (!conversationId || isReopeningInquiry || reopenGuardRef.current) return;
    reopenGuardRef.current = true;
    setIsReopeningInquiry(true);
    setNetworkError(null);
    try {
      const { data } = await apiService.reopenSupportChat(
        conversationId,
        'Tenant reports that the concern persists; conversation reopened.',
      );
      const conversation = data?.conversation;
      if (conversation) {
        syncConversationState(conversation);
        updateInquiryRecord(
          conversation,
          selectedInquiry?.id === conversationId ? selectedInquiry.thread || [] : null,
        );
      }
      await refreshSupportConversation(conversationId, {
        replaceMainFeed: conversationId === supportConversationId,
        scroll: true,
      });
      await loadSupportInquiries();
    } catch (error) {
      setNetworkError(getChatErrorMessage(error, 'Failed to reopen this support conversation.'));
    } finally {
      reopenGuardRef.current = false;
      setIsReopeningInquiry(false);
    }
  };

  const confirmInquiryResolution = async (resolved, conversationId = null, satisfaction = {}) => {
    const targetId = conversationId || selectedInquiry?.id || supportConversationId;
    if (!targetId || isConfirmingResolution || resolutionGuardRef.current) return;
    resolutionGuardRef.current = true;
    setIsConfirmingResolution(true);
    setNetworkError(null);
    try {
      const { data } = await apiService.confirmSupportResolution(
        targetId,
        resolved,
        resolved ? '' : 'My concern is not resolved yet.',
        satisfaction,
      );
      if (data?.conversation) {
        syncConversationState(data.conversation);
        updateInquiryRecord(data.conversation, selectedInquiry?.thread || null);
      }
      await refreshSupportConversation(targetId, {
        replaceMainFeed: targetId === supportConversationId,
        scroll: true,
      });
      await loadSupportInquiries();
      if (resolved) {
        setSatisfactionRating(0);
        setSatisfactionFeedback('');
      }
    } catch (error) {
      setNetworkError(getChatErrorMessage(error, 'Unable to save your resolution choice.'));
    } finally {
      resolutionGuardRef.current = false;
      setIsConfirmingResolution(false);
    }
  };

  const handleOpenChatAttachment = async (attachment) => {
    setNetworkError(null);
    try {
      await openChatAttachment(attachment);
    } catch (error) {
      setNetworkError(error?.message || 'Unable to open this attachment.');
    }
  };

  const handleSelectInquiry = async (item) => {
    try {
      const { data } = await apiService.getSupportChatMessages(item.id);
      const conversation = data?.conversation || item.conversation;
      const thread = Array.isArray(data?.messages) ? data.messages.map(toSupportThreadMessage) : [];
      updateInquiryRecord(conversation, thread);
      setSelectedInquiry({
        ...toInquiryCard(conversation),
        thread,
      });
    } catch (error) {
      console.warn('[Support Chat] Load thread failed:', error?.message);
      setSelectedInquiry(item);
    }
  };

  const handleAttach = async (pickerFn) => {
    try {
      const file = await pickerFn();
      if (!file) {
        setShowAttachMenu(false);
        return;
      }

      if (!file.uri || !file.name) {
        setNetworkError('Invalid attachment. Please try another file.');
        setShowAttachMenu(false);
        return;
      }

      const selectedMimeType = String(file.mimeType || file.type || '').toLowerCase();
      const selectedExtension = String(file.name).toLowerCase().split('.').pop();
      const supportedByExtension = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'].includes(selectedExtension);
      if (
        isSupportMode(chatMode)
        && !SUPPORT_UPLOAD_MIME_TYPES.includes(selectedMimeType)
        && !((!selectedMimeType || selectedMimeType === 'application/octet-stream') && supportedByExtension)
      ) {
        setNetworkError('Support attachments must be a JPG, PNG, WebP, HEIC/HEIF image, or PDF.');
        setShowAttachMenu(false);
        return;
      }

      const maxAttachmentBytes = isSupportMode(chatMode)
        ? MAX_SUPPORT_ATTACHMENT_BYTES
        : MAX_ASSISTANT_ATTACHMENT_BYTES;
      if (file.size && file.size > maxAttachmentBytes) {
        setNetworkError(`Attachment exceeds ${Math.round(maxAttachmentBytes / (1024 * 1024))}MB limit. Please choose a smaller file.`);
        setShowAttachMenu(false);
        return;
      }

      setAttachments((prev) => {
        const duplicate = prev.some((item) => attachmentKey(item) === attachmentKey(file));
        if (duplicate) {
          setNetworkError('That attachment is already added.');
          return prev;
        }
        if (prev.length >= MAX_ATTACHMENT_COUNT) {
          setNetworkError(`You can attach up to ${MAX_ATTACHMENT_COUNT} files only.`);
          return prev;
        }
        setAttachmentUploadStatus('');
        setNetworkError(null);
        return [...prev, file];
      });
      markInteracted();
    } catch (error) {
      setNetworkError(error?.message || 'Attachment failed.');
    }

    setShowAttachMenu(false);
  };

  const removeAttachment = (name) => {
    setAttachmentUploadStatus('');
    setAttachments((prev) => prev.filter((item) => getAttachmentDisplayName(item) !== name));
  };

  const reopenSelectedInquiry = (conversationId = selectedInquiry?.id) => {
    if (!conversationId || isReopeningInquiry) return;
    Alert.alert(
      'Reopen this concern?',
      'The same support conversation will become active again so you can explain what still needs attention.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reopen', onPress: () => performReopenSelectedInquiry(conversationId) },
      ],
    );
  };

  const renderContractContext = (conversation) => {
    const context = conversation?.context;
    if (context?.entityType !== 'contract' || !context?.entityId) return null;
    return (
      <Pressable
        style={styles.contextCard}
        onPress={() => router.push({
          pathname: '/contract-viewer',
          params: { contractId: context.entityId },
        })}
        accessibilityRole="button"
        accessibilityLabel="View related contract"
      >
        <Ionicons name="document-text-outline" size={17} color="#D4AF37" />
        <View style={styles.contextCopy}>
          <Text style={styles.contextTitle}>Related to Contract</Text>
          <Text style={styles.contextAction}>View Contract</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#D4AF37" />
      </Pressable>
    );
  };

  const renderResolutionConfirmation = (conversationId) => (
    <View style={styles.resolutionCard}>
      <Text style={styles.resolutionLabel}>Optional satisfaction rating</Text>
      <View style={styles.ratingRow} accessibilityLabel="Satisfaction rating from one to five">
        {[1, 2, 3, 4, 5].map((rating) => (
          <Pressable
            key={rating}
            onPress={() => setSatisfactionRating(rating)}
            accessibilityRole="button"
            accessibilityLabel={`${rating} star${rating === 1 ? '' : 's'}`}
          >
            <Ionicons
              name={rating <= satisfactionRating ? 'star' : 'star-outline'}
              size={24}
              color="#D4AF37"
            />
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.feedbackInput}
        value={satisfactionFeedback}
        onChangeText={setSatisfactionFeedback}
        placeholder="Optional feedback"
        placeholderTextColor="#6B7280"
        maxLength={1000}
        multiline
      />
      <View style={styles.supportBannerActions}>
        <Pressable
          style={[styles.supportPositiveButton, isConfirmingResolution && styles.buttonDisabled]}
          onPress={() => confirmInquiryResolution(true, conversationId, {
            rating: satisfactionRating || undefined,
            feedback: satisfactionFeedback,
          })}
          disabled={isConfirmingResolution}
        >
          <Text style={styles.supportPrimaryButtonText}>Yes, resolved</Text>
        </Pressable>
        <Pressable
          style={[styles.supportGhostButton, isConfirmingResolution && styles.buttonDisabled]}
          onPress={() => confirmInquiryResolution(false, conversationId)}
          disabled={isConfirmingResolution}
        >
          <Text style={styles.supportGhostButtonText}>No, continue</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderSupportBanner = () => {
    if (chatMode === CHAT_MODE.NEEDS_ADMIN) {
      return (
        <View style={styles.supportBanner}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>I&apos;ll connect you with the admin for this concern.</Text>
            <Text style={styles.supportBannerText}>If you want, I can start admin support now.</Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable
              style={[styles.supportPrimaryButton, isEscalating && styles.buttonDisabled]}
              onPress={() => requestAdminSupport(pendingAdminReason, { intent: pendingAdminIntent })}
              disabled={isEscalating}
            >
              <Text style={styles.supportPrimaryButtonText}>
                {isEscalating ? 'Connecting...' : 'Connect'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.supportGhostButton}
              onPress={() => {
                setChatMode(CHAT_MODE.AI);
                clearEscalationPrompt();
              }}
            >
              <Text style={styles.supportGhostButtonText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (chatMode === CHAT_MODE.WAITING) {
      return (
        <View style={styles.supportBanner}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>Admin support is now active.</Text>
            <Text style={styles.supportBannerText}>Your concern has been sent to the admin.</Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable style={styles.supportGhostButton} onPress={closeSupportConversation}>
              <Text style={styles.supportGhostButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (chatMode === CHAT_MODE.ACTIVE) {
      return (
        <View style={styles.supportBannerActive}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>You are now chatting with admin support.</Text>
            <Text style={styles.supportBannerText}>
              {liveAdminName
                ? `${liveAdminName} is handling this concern.`
                : 'Send your message here and the admin will reply in this conversation.'}
            </Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable style={styles.supportDangerButton} onPress={closeSupportConversation}>
              <Text style={styles.supportDangerButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (chatMode === CHAT_MODE.AWAITING_CONFIRMATION) {
      return (
        <View style={[styles.supportBannerActive, styles.supportBannerStacked]}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>Was your concern resolved?</Text>
            <Text style={styles.supportBannerText}>
              Please confirm whether the administrator&apos;s response solved your concern.
            </Text>
          </View>
          {renderResolutionConfirmation(supportConversationId)}
        </View>
      );
    }

    if (chatMode === CHAT_MODE.RESOLVED) {
      const resolvedTimestamp = supportConversation?.resolvedAt
        ? formatTimestamp(new Date(supportConversation.resolvedAt))
        : '';
      return (
        <View style={styles.supportBannerActive}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>You confirmed this concern was resolved.</Text>
            <Text style={styles.supportBannerText}>
              {resolvedTimestamp ? `Resolved on ${resolvedTimestamp}. ` : ''}
              Reopen the same conversation if the concern persists.
            </Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable
              style={[styles.supportPrimaryButton, isReopeningInquiry && styles.buttonDisabled]}
              onPress={() => reopenSelectedInquiry(supportConversationId)}
              disabled={isReopeningInquiry}
            >
              <Text style={styles.supportPrimaryButtonText}>
                {isReopeningInquiry ? 'Reopening...' : 'Reopen Concern'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.supportGhostButton}
              onPress={() => returnToLilyAssistant()}
            >
              <Text style={styles.supportGhostButtonText}>Continue with Lily</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (chatMode === CHAT_MODE.UNAVAILABLE) {
      return (
        <View style={styles.supportBannerWarn}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>Admin support could not be started.</Text>
            <Text style={styles.supportBannerText}>You can continue with Lily Assistant here.</Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable style={styles.supportGhostButton} onPress={() => returnToLilyAssistant()}>
              <Text style={styles.supportGhostButtonText}>Back to Lily</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (chatMode === CHAT_MODE.CLOSED) {
      return (
        <View style={styles.supportBannerWarn}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>Lily Assistant is available again.</Text>
            <Text style={styles.supportBannerText}>You can continue with Lily Assistant for a new concern.</Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable style={styles.supportGhostButton} onPress={() => returnToLilyAssistant()}>
              <Text style={styles.supportGhostButtonText}>Continue with Lily</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return null;
  };

  const renderInquiryDetail = () => {
    if (!selectedInquiry) return null;

    const isSolved = selectedInquiry.status === 'solved';
    const isAwaitingConfirmation = selectedInquiry.conversation?.status === 'waiting_tenant';
    const resolvedTimestamp = selectedInquiry.conversation?.resolvedAt
      ? formatTimestamp(new Date(selectedInquiry.conversation.resolvedAt))
      : '';
    const latestOutgoingMessageId = getLatestOutgoingMessageId(selectedInquiry.thread);
    return (
      <View style={[styles.detailScreen, { paddingBottom: tabBarHeight }]}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Pressable style={styles.backButton} onPress={() => setSelectedInquiry(null)}>
            <Ionicons name="arrow-back" size={22} color="#f8fafc" />
          </Pressable>
          <View style={styles.detailHeaderInfo}>
            <Text style={styles.headerTitle}>Admin Support</Text>
            <Text style={styles.headerTicketId}>{selectedInquiry.ticketId}</Text>
            <Text style={styles.headerSubtitle}>{selectedInquiry.title}</Text>
          </View>
          <View style={[styles.statusChip, isSolved ? styles.statusChipSolved : null]}>
            <Text style={[styles.statusChipText, isSolved ? styles.statusChipTextSolved : null]}>
              {supportStatusLabel(selectedInquiry.canonicalStatus)}
            </Text>
          </View>
        </View>

        <ScrollView
          ref={adminScrollRef}
          style={styles.detailMessages}
          contentContainerStyle={styles.detailMessagesContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => adminScrollRef.current?.scrollToEnd({ animated: false })}
          refreshControl={(
            <RefreshControl
              refreshing={refreshingSupport}
              onRefresh={() => handlePullToRefresh('detail')}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          )}
        >
          <View style={styles.systemRow}>
            <View style={styles.systemLine} />
            <Text style={styles.systemText}>You are now chatting with admin support.</Text>
            <View style={styles.systemLine} />
          </View>

          {renderContractContext(selectedInquiry.conversation)}

          {networkError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{networkError}</Text>
            </View>
          ) : null}

          {selectedInquiry.thread.map((item) => (
            <MessageBubble
              key={item.id}
              message={item}
              isUser={item.sender === 'user'}
              showDeliveryStatus={item.id === latestOutgoingMessageId}
              onOpenAttachment={handleOpenChatAttachment}
              highlighted={String(item.id) === String(notificationMessageId || '')}
            />
          ))}
        </ScrollView>

        <View style={styles.detailFooter}>
          {isSolved ? (
            <View style={styles.resolvedActions}>
              <View style={styles.resolvedNotice}>
                <Ionicons name="checkmark-circle" size={16} color="#065F46" />
                <Text style={styles.resolvedNoticeText}>This support conversation is resolved.</Text>
              </View>
              {resolvedTimestamp ? (
                <Text style={styles.reopenPrompt}>Resolved on {resolvedTimestamp}</Text>
              ) : null}
              <Text style={styles.reopenPrompt}>Still having this issue?</Text>
              <Pressable
                style={[styles.primaryFooterButton, isReopeningInquiry && styles.buttonDisabled]}
                onPress={() => reopenSelectedInquiry()}
                disabled={isReopeningInquiry}
                accessibilityRole="button"
                accessibilityLabel="Reopen inquiry"
              >
                <Ionicons name="refresh-circle-outline" size={17} color="#ffffff" />
                <Text style={styles.primaryFooterButtonText}>
                  {isReopeningInquiry ? 'Reopening...' : 'Reopen Inquiry'}
                </Text>
              </Pressable>
            </View>
          ) : isAwaitingConfirmation ? (
            <View style={styles.resolvedActions}>
              <Text style={styles.resolvedNoticeText}>Was your concern resolved?</Text>
              <Text style={styles.reopenPrompt}>Continue the same inquiry if the administrator&apos;s response did not solve it.</Text>
              {renderResolutionConfirmation(selectedInquiry.id)}
            </View>
          ) : (
            <View style={styles.replyBar}>
              <TextInput
                style={styles.replyInput}
                placeholder="Reply to admin support..."
                placeholderTextColor="#6B7280"
                value={replyText}
                onChangeText={setReplyText}
                multiline
                editable={!isSendingReply}
              />
              <Pressable
                style={[
                  styles.replySendButton,
                  (!replyText.trim() || isSendingReply) && styles.buttonDisabled,
                ]}
                onPress={sendReply}
                disabled={!replyText.trim() || isSendingReply}
              >
                <Text style={styles.replySendButtonText}>{isSendingReply ? '...' : 'Send'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    );
  };

  const filteredInquiries = useMemo(
    () => inquiries.filter((item) => (filter === 'all' ? true : item.status === filter)),
    [filter, inquiries]
  );

  const isInputDisabled = isSending
    || isEscalating
    || chatMode === CHAT_MODE.RESOLVED
    || chatMode === CHAT_MODE.AWAITING_CONFIRMATION;
  const canAttach = chatMode === CHAT_MODE.AI
    || chatMode === CHAT_MODE.WAITING
    || chatMode === CHAT_MODE.ACTIVE;
  const latestSupportOutgoingMessageId = getLatestOutgoingMessageId(
    messages.filter((message) => String(message.id || '').startsWith('support-')),
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? tabBarHeight : 0}
      >
        {selectedInquiry ? (
          renderInquiryDetail()
        ) : (
          <View style={[styles.screen, { paddingBottom: tabBarHeight }]}>
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
              <View style={styles.headerLeft}>
                <View style={styles.headerAvatar}>
                  <LilyFlowerIcon size={38} pulse={isSending} />
                </View>
                <View style={styles.headerTextWrap}>
                  <Text style={styles.headerTitle}>Lily</Text>
                  <View style={styles.headerStatusRow}>
                    <View style={[styles.statusDot, statusDotStyle]} />
                    <Text style={styles.headerSubtitle}>{statusLabel}</Text>
                  </View>
                </View>
              </View>

              {hasInteracted && chatMode === CHAT_MODE.AI ? (
                <Pressable
                  style={styles.newChatButton}
                  onPress={async () => {
                    await chat.resetSession();
                    setMessages([]);
                    setInputValue('');
                    setAttachments([]);
                    setAttachmentUploadStatus('');
                    setHasInteracted(false);
                    setNetworkError(null);
                    clearEscalationPrompt();
                  }}
                >
                  <Ionicons name="refresh-outline" size={16} color="#D4AF37" />
                  <Text style={styles.newChatButtonText}>New</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.tabs}>
              {['chat', 'inquiries'].map((tab) => (
                <Pressable key={tab} style={styles.tab} onPress={() => setActiveTab(tab)}>
                  <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : null]}>
                    {tab === 'chat' ? 'Chat' : 'My Inquiries'}
                  </Text>
                  {activeTab === tab ? <View style={[styles.tabIndicator, { backgroundColor: '#D4AF37' }]} /> : null}
                </Pressable>
              ))}
            </View>

            {activeTab === 'chat' ? (
              <View style={styles.body}>
                {networkError ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorBannerText}>{networkError}</Text>
                  </View>
                ) : null}

                <ScrollView
                  ref={scrollRef}
                  style={styles.messages}
                  contentContainerStyle={styles.messagesContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  refreshControl={(
                    <RefreshControl
                      refreshing={refreshingSupport}
                      onRefresh={() => handlePullToRefresh('chat')}
                      colors={[colors.primary]}
                      tintColor={colors.primary}
                    />
                  )}
                >
                  <View style={styles.heroCard}>
                    <View style={styles.heroRow}>
                      <View style={styles.heroBadge}>
                        <LilyFlowerIcon size={46} pulse />
                      </View>
                      <View style={styles.heroTextWrap}>
                        <Text style={styles.heroTitle}>
                          Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!
                        </Text>
                        <Text style={styles.heroSubtitle}>
                          I&apos;m Lily, your AI assistant. How can I help you today?
                        </Text>
                      </View>
                    </View>

                    <View style={styles.heroTopics}>
                      {LILY_TOPICS.map((topic) => (
                        <Pressable
                          key={topic.id}
                          style={[styles.heroTopic, selectedTopic === topic.id && styles.heroTopicSelected]}
                          onPress={() => setSelectedTopic(topic.id)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: selectedTopic === topic.id }}
                          accessibilityLabel={`${topic.label} topic`}
                        >
                          <Text style={[styles.heroTopicText, selectedTopic === topic.id && styles.heroTopicTextSelected]}>{topic.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.suggestSection}>
                    <Text style={styles.suggestLabel}>You may want to ask:</Text>
                    <View style={styles.suggestChips}>
                      {suggestedQuestions.map((question) => (
                        <Pressable
                          key={question}
                          style={styles.suggestChip}
                          onPress={() => handleSend(question)}
                        >
                          <Text style={styles.suggestChipText}>{question}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {renderContractContext(supportConversation)}

                  {messages.map((message) => (
                    <View key={message.id}>
                      <MessageBubble
                        message={message}
                        isUser={message.sender === 'user'}
                        showDeliveryStatus={message.id === latestSupportOutgoingMessageId}
                        onOpenAttachment={String(message.id).startsWith('support-')
                          ? handleOpenChatAttachment
                          : undefined}
                        highlighted={String(message.id) === `support-${notificationMessageId}`}
                      />
                      {message.sender === 'bot' && message.suggestions?.length ? (
                        <FollowupChips suggestions={message.suggestions} onSelect={handleSend} />
                      ) : null}
                    </View>
                  ))}

                  {chat.isTyping ? <TypingIndicator label={getTypingLabel(chat.typingIntent)} /> : null}
                </ScrollView>

                <View style={styles.bottomZone}>
                  {renderSupportBanner()}

                  {attachments.length ? (
                    <View style={styles.attachmentRow}>
                      {attachments.map((file) => (
                        <Pressable
                          key={attachmentKey(file)}
                          style={styles.attachmentChip}
                          onLongPress={() => removeAttachment(getAttachmentDisplayName(file))}
                        >
                          <Text style={styles.attachmentChipText}>{getAttachmentDisplayName(file)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {attachmentUploadStatus ? (
                    <Text style={styles.attachmentStatusText}>{attachmentUploadStatus}</Text>
                  ) : null}

                  <View style={styles.inputBar}>
                    {canAttach ? <View style={styles.attachWrapper}>
                      <Pressable
                        style={styles.attachButton}
                        onPress={() => setShowAttachMenu((value) => !value)}
                        disabled={isInputDisabled || !canAttach}
                        accessibilityRole="button"
                        accessibilityLabel="Add attachment"
                      >
                        <Ionicons name="attach" size={19} color="#0A1628" />
                      </Pressable>
                    </View> : null}

                    <TextInput
                      style={styles.input}
                      placeholder={
                        isSupportMode(chatMode)
                          ? 'Message admin support...'
                          : chatMode === CHAT_MODE.RESOLVED
                            ? 'Continue with Lily when ready.'
                            : 'Type your concern here...'
                      }
                      placeholderTextColor="#6B7280"
                      value={inputValue}
                      onChangeText={(value) => {
                        setInputValue(value);
                        if (value.trim().length) markInteracted();
                      }}
                      onFocus={() => setShowAttachMenu(false)}
                      multiline
                      editable={!isInputDisabled}
                    />

                    <Pressable
                      style={[styles.sendButton, isInputDisabled && styles.buttonDisabled]}
                      onPress={() => handleSend()}
                      disabled={isInputDisabled}
                    >
                      <Text style={styles.sendButtonText}>{isSending ? 'Sending...' : 'Send'}</Text>
                    </Pressable>
                  </View>
                </View>

              </View>
            ) : (
              <View style={styles.body}>
                <View style={styles.filterRow}>
                  {FILTERS.map((item) => (
                    <Pressable
                      key={item.id}
                      style={[styles.filterChip, filter === item.id ? styles.filterChipActive : null]}
                      onPress={() => setFilter(item.id)}
                    >
                      <Text style={[styles.filterText, filter === item.id ? styles.filterTextActive : null]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <ScrollView
                  style={styles.inquiryList}
                  contentContainerStyle={styles.inquiryContent}
                  showsVerticalScrollIndicator={false}
                  refreshControl={(
                    <RefreshControl
                      refreshing={refreshingSupport}
                      onRefresh={() => handlePullToRefresh('inquiries')}
                      colors={[colors.primary]}
                      tintColor={colors.primary}
                    />
                  )}
                >
                  {filteredInquiries.length === 0 ? (
                    <View style={styles.emptyState}>
                      <View style={styles.emptyStateIcon}>
                        <Ionicons
                          name={
                            filter === 'solved'
                              ? 'checkmark-done-circle-outline'
                              : filter === 'pending'
                                ? 'hourglass-outline'
                                : 'chatbubbles-outline'
                          }
                          size={36}
                          color="#6B7280"
                        />
                      </View>
                      <Text style={styles.emptyStateTitle}>
                        {filter === 'solved'
                          ? 'No solved conversations'
                          : filter === 'pending'
                            ? 'No pending conversations'
                            : 'No support conversations yet'}
                      </Text>
                      <Text style={styles.emptyStateText}>
                        {filter === 'solved'
                          ? 'Resolved support conversations will appear here.'
                          : filter === 'pending'
                            ? 'You have no active admin support conversations right now.'
                            : 'When admin support starts, the conversation will appear here.'}
                      </Text>
                    </View>
                  ) : (
                    filteredInquiries.map((item) => (
                      <InquiryCard
                        key={item.id}
                        title={item.title}
                        ticketId={item.ticketId}
                        preview={item.preview}
                        status={item.status}
                        canonicalStatus={item.canonicalStatus}
                        timestamp={item.timestamp}
                        onPress={() => handleSelectInquiry(item)}
                      />
                    ))
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
      <AttachmentPickerSheet
        visible={showAttachMenu && canAttach}
        onClose={() => setShowAttachMenu(false)}
        onTakePhoto={() => handleAttach(pickFromCamera)}
        onChoosePhoto={() => handleAttach(pickFromLibrary)}
        onChooseDocument={() => handleAttach(pickDocument)}
        disabled={isSending}
      />
    </View>
  );
}

// styles defined inside component via useThemedStyles — see component body
const _stylesPlaceholder = null; // eslint-disable-line
// ─── THEMED STYLES FACTORY ───────────────────────────────────────────────────
function createAssistantStyles(c, dark) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.background,
  },
  screen: {
    flex: 1,
    backgroundColor: c.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: c.headerBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
    borderBottomWidth: 3,
    borderBottomColor: '#D4AF37',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.9)',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  headerSubtitle: {
    color: '#D0D7E2',
    fontSize: 12,
    fontWeight: '500',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderRadius: 8,
  },
  newChatButtonText: {
    color: '#D4AF37',
    fontWeight: '700',
    fontSize: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: c.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    position: 'relative',
  },
  tabText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#D4AF37',
  },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#DC2626',
    borderWidth: 1,
    padding: 10,
    borderRadius: 12,
  },
  errorBannerText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
  },
  messages: {
    flex: 1,
    backgroundColor: c.background,
    borderRadius: 12,
  },
  messagesContent: {
    padding: 14,
    paddingBottom: 24,
  },
  heroCard: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: c.border,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  heroBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: dark ? c.surfaceSecondary : '#FBF7EA',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    color: c.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  heroSubtitle: {
    color: c.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  heroTopics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroTopic: {
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTopicSelected: {
    backgroundColor: dark ? '#3D3214' : '#FFFBEB',
    borderColor: '#D4AF37',
  },
  heroTopicText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.text,
  },
  heroTopicTextSelected: {
    color: dark ? '#F6D86B' : '#7C5D0B',
  },
  suggestSection: {
    marginBottom: 16,
    gap: 10,
  },
  suggestLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestChips: {
    alignItems: 'flex-start',
    gap: 8,
  },
  suggestChip: {
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: c.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
  suggestChipText: {
    color: c.text,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
  },
  bottomZone: {
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  supportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F3E4B0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  supportBannerActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  supportBannerStacked: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  supportBannerWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DC2626',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  supportBannerContent: {
    flex: 1,
    gap: 2,
  },
  supportBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.text,
  },
  supportBannerText: {
    fontSize: 12,
    color: c.textSecondary,
    lineHeight: 16,
  },
  supportBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resolutionCard: {
    width: '100%',
    gap: 8,
  },
  resolutionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: c.textSecondary,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 6,
  },
  feedbackInput: {
    minHeight: 42,
    maxHeight: 80,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    backgroundColor: c.inputBg,
    color: c.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: dark ? c.surfaceSecondary : '#FBF7EA',
    borderWidth: 1,
    borderColor: '#F3E4B0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  contextCopy: {
    flex: 1,
  },
  contextTitle: {
    color: c.text,
    fontSize: 12,
    fontWeight: '700',
  },
  contextAction: {
    color: c.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  supportPrimaryButton: {
    backgroundColor: '#0A1628',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  supportPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  supportPositiveButton: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  supportGhostButton: {
    backgroundColor: c.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  supportGhostButtonText: {
    color: c.textSecondary,
    fontWeight: '700',
    fontSize: 12,
  },
  supportDangerButton: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  supportDangerButtonText: {
    color: '#991B1B',
    fontWeight: '700',
    fontSize: 12,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: c.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    padding: 10,
  },
  attachmentChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: c.surfaceSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
  },
  attachmentChipText: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '500',
  },
  attachmentStatusText: {
    color: c.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: c.border,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 8,
  },
  attachWrapper: {
    position: 'relative',
    zIndex: 5,
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingVertical: 6,
    fontSize: 14,
    color: c.text,
  },
  sendButton: {
    backgroundColor: '#0A1628',
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  filterChipActive: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  filterText: {
    fontSize: 13,
    color: c.text,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#f8fafc',
  },
  inquiryList: {
    flex: 1,
  },
  inquiryContent: {
    paddingVertical: 10,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyStateIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: c.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    marginBottom: 6,
  },
  emptyStateText: {
    fontSize: 13,
    color: c.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: c.background,
  },
  backButton: {
    paddingRight: 12,
    paddingVertical: 8,
  },
  detailHeaderInfo: {
    flex: 1,
  },
  headerTicketId: {
    color: '#F3E4B0',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#D97706',
  },
  statusChipSolved: {
    backgroundColor: '#ECFDF5',
    borderColor: '#059669',
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  statusChipTextSolved: {
    color: '#065F46',
  },
  detailMessages: {
    flex: 1,
  },
  detailMessagesContent: {
    padding: 14,
    paddingBottom: 20,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  systemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 16,
    paddingHorizontal: 4,
  },
  systemLine: {
    flex: 1,
    height: 1,
    backgroundColor: c.border,
  },
  systemText: {
    fontSize: 11,
    color: c.textMuted,
    textAlign: 'center',
    flexShrink: 1,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  threadRowUser: {
    justifyContent: 'flex-end',
  },
  threadRowAdmin: {
    justifyContent: 'flex-start',
  },
  threadAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0A1628',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  threadAvatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 11,
  },
  threadBubble: {
    maxWidth: '75%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 7,
  },
  threadBubbleAdmin: {
    backgroundColor: c.surface,
    borderBottomLeftRadius: 4,
  },
  threadBubbleUser: {
    backgroundColor: '#0A1628',
    borderBottomRightRadius: 4,
  },
  threadLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D4AF37',
    marginBottom: 4,
  },
  threadText: {
    fontSize: 14,
    color: c.text,
    lineHeight: 20,
  },
  threadTextUser: {
    color: '#ffffff',
  },
  threadTime: {
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 4,
  },
  threadTimeUser: {
    color: 'rgba(255,255,255,0.65)',
  },
  detailFooter: {
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  resolvedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  resolvedActions: {
    gap: 10,
  },
  reopenPrompt: {
    textAlign: 'center',
    fontSize: 13,
    color: c.textMuted,
  },
  resolvedNoticeText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#065F46',
  },
  primaryFooterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0A1628',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  primaryFooterButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  positiveFooterButton: {
    backgroundColor: '#059669',
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  replyInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: c.inputBg,
    borderRadius: 22,
    fontSize: 14,
    color: c.text,
    borderWidth: 1,
    borderColor: c.border,
  },
  replySendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  replySendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  });
}
