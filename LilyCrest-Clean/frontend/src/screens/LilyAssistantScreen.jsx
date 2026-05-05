import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InquiryCard from '../components/assistant/InquiryCard';
import LilyFlowerIcon from '../components/assistant/LilyFlowerIcon';
import MessageBubble from '../components/assistant/MessageBubble';
import { useAuth } from '../context/AuthContext';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { apiService } from '../services/api';
import { pickDocument, pickFromCamera, pickFromLibrary } from '../utils/attachmentPicker';

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
          <Ionicons name="chatbubble-ellipses-outline" size={13} color="#ff9000" />
          <Text style={followupStyles.text}>{suggestion.label}</Text>
          <Ionicons name="chevron-forward" size={12} color="#ff9000" />
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
    backgroundColor: '#FDF6EC',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0D9A8',
  },
  text: {
    color: '#8B6914',
    fontWeight: '600',
    fontSize: 12,
  },
});

function TypingIndicator({ label = 'Lily is thinking...' }) {
  return (
    <View style={typingStyles.row}>
      <View style={typingStyles.avatar}>
        <LilyFlowerIcon size={20} glow={false} />
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
    backgroundColor: '#16213b',
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
    borderColor: '#e2e8f0',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#204b7e',
  },
  label: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
  },
});

const QUICK_ACTIONS = [
  { id: 'billing', label: 'Billing', icon: 'card-outline', prompt: 'Show my latest billing details.' },
  { id: 'maintenance', label: 'Maintenance', icon: 'construct-outline', prompt: 'I need maintenance help.' },
  { id: 'documents', label: 'Documents', icon: 'document-text-outline', prompt: 'How do I download my contract?' },
  { id: 'rules', label: 'House Rules', icon: 'shield-checkmark-outline', prompt: 'What are the quiet hours?' },
  { id: 'penalties', label: 'Penalties', icon: 'warning-outline', prompt: 'Explain penalty rules.' },
  { id: 'admin', label: 'Talk to Admin', icon: 'headset-outline', prompt: 'Connect me to an admin.' },
];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'solved', label: 'Solved' },
];

const HERO_TOPICS = [
  { id: 'billing', label: 'Billing', prompt: 'Show my latest bill and how to pay.' },
  { id: 'maintenance', label: 'Maintenance', prompt: 'I need to report a maintenance issue.' },
  { id: 'documents', label: 'Documents', prompt: 'How do I download my lease contract?' },
  { id: 'house-rules', label: 'House Rules', prompt: 'What are the house rules and curfew?' },
  { id: 'account', label: 'Account & Support', prompt: 'Help me update my account or contact admin.' },
];

const SUGGESTED_QUESTIONS = [
  'How much do I need to pay this month?',
  'Comply with move-in requirements',
  'Curfew and visitor policy',
  'File a complaint to admin',
];

const ADMIN_KEYWORDS = [
  'connect me to an admin',
  'talk to admin',
  'contact admin',
  'speak to admin',
  'escalate',
  'complaint to admin',
  'file a complaint',
  'submit inquiry',
  'human help',
];

const MAX_CHAT_INPUT_CHARS = 800;
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const LIVE_CHAT_POLL_MS = 5000;
const SEND_RATE_LIMIT_MS = 900;
const CHAT_MODE = {
  AI: 'ai',
  NEEDS_ADMIN: 'needs_admin',
  WAITING: 'waiting',
  ACTIVE: 'active',
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
  if (/complaint|unsafe|harass|legal|danger|urgent|emergency|threat|abuse/.test(source)) return 'urgent_issue';
  if (/billing|late fee|overdue|payment|paymongo|invoice|bill/.test(source)) return 'billing_concern';
  if (/maintenance|repair|leak|electrical|no power|no water|plumbing/.test(source)) return 'maintenance_concern';
  if (/reservation|move in|move-in|room slot|bed slot|booking/.test(source)) return 'reservation_concern';
  if (/gcash|maya|bank transfer|payment proof/.test(source)) return 'payment_concern';
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

const supportInquiryStatus = (status = '') => {
  if (status === 'resolved' || status === 'closed') return 'solved';
  return 'pending';
};

const toSupportFeedMessage = (message) => ({
  id: `support-${message.id}`,
  sender: message.senderRole === 'tenant' ? 'user' : 'admin',
  text: message.message || '',
  time: formatTime(message.createdAt ? new Date(message.createdAt) : new Date()),
  avatar: message.senderRole === 'tenant' ? 'U' : 'A',
});

const toSupportThreadMessage = (message) => ({
  id: message.id || `thread-${Date.now()}`,
  sender: message.senderRole === 'tenant' ? 'user' : 'admin',
  text: message.message || '',
  time: formatTime(message.createdAt ? new Date(message.createdAt) : new Date()),
});

const toInquiryCard = (conversation) => {
  const created = conversation.createdAt ? new Date(conversation.createdAt) : new Date();
  const last = conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : created;
  return {
    id: conversation.id,
    title: supportTitle(conversation.category),
    status: supportInquiryStatus(conversation.status),
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
      return CHAT_MODE.ACTIVE;
    case 'open':
    case 'in_review':
      return CHAT_MODE.WAITING;
    default:
      return CHAT_MODE.AI;
  }
};

const isSupportMode = (mode) => mode === CHAT_MODE.WAITING || mode === CHAT_MODE.ACTIVE;

export default function LilyAssistantScreen() {
  const scrollRef = useRef(null);
  const adminScrollRef = useRef(null);
  const seenSupportMsgIds = useRef(new Set());
  const sendGuardRef = useRef(false);
  const escalationGuardRef = useRef(false);
  const sendCooldownRef = useRef(0);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('chat');
  const [filter, setFilter] = useState('all');
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [chatMode, setChatMode] = useState(CHAT_MODE.AI);
  const [pendingAdminReason, setPendingAdminReason] = useState('');
  const [pendingAdminIntent, setPendingAdminIntent] = useState('general');
  const [liveAdminName, setLiveAdminName] = useState('');
  const [supportConversationId, setSupportConversationId] = useState(null);
  const [supportConversation, setSupportConversation] = useState(null);
  const [isEscalating, setIsEscalating] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [selectedInquiry, setSelectedInquiry] = useState(null);

  const initialSession = useMemo(
    () => `${user?.user_id || 'guest'}-chat-${Date.now()}`,
    [user?.user_id]
  );
  const chat = useAssistantChat(initialSession);
  const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 72;

  const markInteracted = () => {
    if (!hasInteracted) setHasInteracted(true);
  };

  const statusLabel = useMemo(() => {
    switch (chatMode) {
      case CHAT_MODE.WAITING:
        return 'Admin Support';
      case CHAT_MODE.ACTIVE:
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
        return { backgroundColor: '#f59e0b' };
      case CHAT_MODE.ACTIVE:
        return { backgroundColor: '#38bdf8' };
      case CHAT_MODE.RESOLVED:
      case CHAT_MODE.CLOSED:
        return { backgroundColor: '#22c55e' };
      case CHAT_MODE.UNAVAILABLE:
        return { backgroundColor: '#ef4444' };
      default:
        return { backgroundColor: '#22c55e' };
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
      const additions = [];
      rawMessages.forEach((item) => {
        if (item.senderRole === 'tenant' || seenSupportMsgIds.current.has(item.id)) return;
        seenSupportMsgIds.current.add(item.id);
        additions.push(toSupportFeedMessage(item));
      });
      if (additions.length) {
        setMessages((prev) => [...prev, ...additions]);
      }
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
      const detail =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        'Admin support could not be started right now.';
      setChatMode(CHAT_MODE.UNAVAILABLE);
      setNetworkError(detail);
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

  const closeSupportConversation = async () => {
    let closedConversation = supportConversation;

    try {
      if (supportConversationId) {
        const { data } = await apiService.closeSupportChat(
          supportConversationId,
          'Closed by tenant from Lily Assistant.'
        );
        closedConversation = data?.conversation || closedConversation;
      }
    } catch (error) {
      console.warn('[Support Chat] Close failed:', error?.message);
    } finally {
      if (closedConversation) {
        updateInquiryRecord(
          closedConversation.status === 'closed'
            ? closedConversation
            : { ...closedConversation, status: 'closed' },
          selectedInquiry?.id === closedConversation.id ? selectedInquiry.thread : null
        );
      }

      setSupportConversation(closedConversation ? { ...closedConversation, status: 'closed' } : null);
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
    }
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

  const sendSupportMessage = async (text) => {
    const now = Date.now();
    if (now - sendCooldownRef.current < SEND_RATE_LIMIT_MS) {
      setNetworkError('Please wait a moment before sending again.');
      return;
    }

    if (!supportConversationId) {
      setNetworkError('Admin support is not active right now.');
      return;
    }

    sendCooldownRef.current = now;
    setIsSending(true);
    setNetworkError(null);

    try {
      await apiService.sendSupportMessage(supportConversationId, text);
      await refreshSupportConversation(supportConversationId, { replaceMainFeed: false, scroll: true });
      await loadSupportInquiries();
    } catch (error) {
      setNetworkError(
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        'Failed to send your message to admin support.'
      );
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    chat.loadPersistedSession();
  }, [chat.loadPersistedSession]);

  useEffect(() => {
    const bootstrapSupport = async () => {
      if (!user) {
        setNetworkError('Please sign in to use Lily Assistant.');
        return;
      }

      try {
        const conversations = await loadSupportInquiries({ preserveSelection: false });
        const activeConversation = conversations.find((item) => item.status !== 'closed');
        if (activeConversation) {
          await refreshSupportConversation(activeConversation.id, { replaceMainFeed: true });
        }
      } catch (error) {
        console.warn('[Support Chat] Bootstrap failed:', error?.message);
        setNetworkError('Unable to load your support conversations right now.');
      }
    };

    bootstrapSupport();
  }, [user?.user_id]);

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
  }, [supportConversationId, chatMode]);

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

    if (isSupportMode(chatMode) && attachments.length) {
      setNetworkError('Attachments are not supported in admin support yet.');
      return;
    }

    if (chatMode === CHAT_MODE.UNAVAILABLE || chatMode === CHAT_MODE.CLOSED) {
      setChatMode(CHAT_MODE.AI);
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: text || 'Shared attachments',
      time: formatTime(new Date()),
      avatar: 'U',
      attachments,
    };

    sendGuardRef.current = true;
    markInteracted();
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    setNetworkError(null);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      if (supportConversationId && isSupportMode(chatMode) && text) {
        await sendSupportMessage(text);
        return;
      }

      if (!text) {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-attachment-${Date.now()}`,
            sender: 'bot',
            text: 'Attachment received. Please add a short message so I can understand your concern.',
            time: formatTime(new Date()),
            avatar: 'L',
            meta: { intent: 'attachment-only', confidence: 1 },
          },
        ]);
        return;
      }

      if (isAdminEscalation(text)) {
        await requestAdminSupport(text, { intent: 'general' });
        return;
      }

      setIsSending(true);
      const { response, intent, metadata, needsAdmin, suggestions, error } = await chat.sendMessage(text);

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
        setPendingAdminReason(text);
        setPendingAdminIntent(intent || metadata?.intent || 'general');
        setChatMode(CHAT_MODE.NEEDS_ADMIN);
      }
    } finally {
      setIsSending(false);
      sendGuardRef.current = false;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  };

  const sendReply = async () => {
    const text = sanitizeChatInput(replyText).slice(0, MAX_CHAT_INPUT_CHARS);
    if (!text || !selectedInquiry) return;

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
      console.warn('[Support Chat] Inquiry reply failed:', error?.message);
    } finally {
      setIsSendingReply(false);
      setTimeout(() => adminScrollRef.current?.scrollToEnd({ animated: true }), 80);
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

      if (file.size && file.size > MAX_ATTACHMENT_BYTES) {
        setNetworkError('Attachment exceeds 10MB limit. Please choose a smaller file.');
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
    setAttachments((prev) => prev.filter((item) => item.name !== name));
  };

  const handleQuickAction = (action) => {
    const prompt = action.prompt || '';
    setInputValue(prompt);
    markInteracted();
    handleSend(prompt);
  };

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

    if (chatMode === CHAT_MODE.RESOLVED) {
      return (
        <View style={styles.supportBannerActive}>
          <View style={styles.supportBannerContent}>
            <Text style={styles.supportBannerTitle}>Admin support resolved this concern.</Text>
            <Text style={styles.supportBannerText}>
              {supportConversation?.closingNote || 'Lily Assistant is available again after this support conversation is closed.'}
            </Text>
          </View>
          <View style={styles.supportBannerActions}>
            <Pressable
              style={styles.supportGhostButton}
              onPress={() => returnToLilyAssistant({ closeConversation: true })}
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
    const isActive = supportConversationId === selectedInquiry.id && isSupportMode(chatMode);

    return (
      <View style={styles.detailScreen}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Pressable style={styles.backButton} onPress={() => setSelectedInquiry(null)}>
            <Ionicons name="arrow-back" size={22} color="#f8fafc" />
          </Pressable>
          <View style={styles.detailHeaderInfo}>
            <Text style={styles.headerTitle}>Admin Support</Text>
            <Text style={styles.headerSubtitle}>{selectedInquiry.title}</Text>
          </View>
          <View style={[styles.statusChip, isSolved ? styles.statusChipSolved : null]}>
            <Text style={[styles.statusChipText, isSolved ? styles.statusChipTextSolved : null]}>
              {isSolved ? 'Solved' : 'Pending'}
            </Text>
          </View>
        </View>

        <ScrollView
          ref={adminScrollRef}
          style={styles.detailMessages}
          contentContainerStyle={styles.detailMessagesContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => adminScrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={styles.systemRow}>
            <View style={styles.systemLine} />
            <Text style={styles.systemText}>You are now chatting with admin support.</Text>
            <View style={styles.systemLine} />
          </View>

          {selectedInquiry.thread.map((item) => {
            const isUser = item.sender === 'user';
            return (
              <View
                key={item.id}
                style={[
                  styles.threadRow,
                  isUser ? styles.threadRowUser : styles.threadRowAdmin,
                ]}
              >
                {!isUser ? (
                  <View style={styles.threadAvatar}>
                    <Text style={styles.threadAvatarText}>A</Text>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.threadBubble,
                    isUser ? styles.threadBubbleUser : styles.threadBubbleAdmin,
                  ]}
                >
                  {!isUser ? <Text style={styles.threadLabel}>Admin Support</Text> : null}
                  <Text style={[styles.threadText, isUser ? styles.threadTextUser : null]}>
                    {item.text}
                  </Text>
                  <Text style={[styles.threadTime, isUser ? styles.threadTimeUser : null]}>
                    {item.time}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.detailFooter}>
          {isSolved ? (
            <View style={styles.resolvedNotice}>
              <Ionicons name="checkmark-circle" size={16} color="#15803d" />
              <Text style={styles.resolvedNoticeText}>This support conversation is resolved.</Text>
            </View>
          ) : isActive ? (
            <Pressable
              style={styles.primaryFooterButton}
              onPress={() => {
                setSelectedInquiry(null);
                setActiveTab('chat');
              }}
            >
              <Ionicons name="arrow-forward-circle-outline" size={15} color="#ffffff" />
              <Text style={styles.primaryFooterButtonText}>Continue in Chat</Text>
            </Pressable>
          ) : (
            <View style={styles.replyBar}>
              <TextInput
                style={styles.replyInput}
                placeholder="Reply to admin support..."
                placeholderTextColor="#94a3b8"
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

  const hasStartedChat = useMemo(
    () => hasInteracted || messages.length > 0 || inputValue.trim().length > 0 || attachments.length > 0,
    [attachments.length, hasInteracted, inputValue, messages.length]
  );

  const isInputDisabled = isSending || isEscalating || chatMode === CHAT_MODE.RESOLVED;
  const canAttach = chatMode === CHAT_MODE.AI;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? TAB_BAR_HEIGHT : 0}
      >
        {selectedInquiry ? (
          renderInquiryDetail()
        ) : (
          <View style={[styles.screen, { paddingBottom: TAB_BAR_HEIGHT }]}>
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
              <View style={styles.headerLeft}>
                <View style={styles.headerAvatar}>
                  <LilyFlowerIcon size={50} glow={false} pulse={isSending} />
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
                    setHasInteracted(false);
                    setNetworkError(null);
                    clearEscalationPrompt();
                  }}
                >
                  <Ionicons name="refresh-outline" size={16} color="#ff9000" />
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
                  {activeTab === tab ? <View style={styles.tabIndicator} /> : null}
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
                >
                  <View style={styles.heroCard}>
                    <View style={styles.heroRow}>
                      <View style={styles.heroBadge}>
                        <LilyFlowerIcon size={58} glow={false} pulse />
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
                      {HERO_TOPICS.map((topic) => (
                        <Pressable
                          key={topic.id}
                          style={styles.heroTopic}
                          onPress={() => handleSend(topic.prompt)}
                        >
                          <Text style={styles.heroTopicText}>{topic.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.suggestSection}>
                    <Text style={styles.suggestLabel}>You may want to ask:</Text>
                    <View style={styles.suggestChips}>
                      {SUGGESTED_QUESTIONS.map((question) => (
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

                  {messages.map((message) => (
                    <View key={message.id}>
                      <MessageBubble message={message} isUser={message.sender === 'user'} />
                      {message.sender === 'bot' && message.suggestions?.length ? (
                        <FollowupChips suggestions={message.suggestions} onSelect={handleSend} />
                      ) : null}
                    </View>
                  ))}

                  {chat.isTyping ? <TypingIndicator label={getTypingLabel(chat.typingIntent)} /> : null}
                </ScrollView>

                <View style={styles.bottomZone}>
                  {renderSupportBanner()}

                  {!hasStartedChat && chatMode === CHAT_MODE.AI ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.quickActions}
                    >
                      {QUICK_ACTIONS.map((action) => (
                        <Pressable
                          key={action.id}
                          style={styles.quickAction}
                          onPress={() => handleQuickAction(action)}
                        >
                          <Ionicons name={action.icon} size={15} color="#ff9000" />
                          <Text style={styles.quickActionText}>{action.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}

                  {attachments.length ? (
                    <View style={styles.attachmentRow}>
                      {attachments.map((file) => (
                        <Pressable
                          key={attachmentKey(file)}
                          style={styles.attachmentChip}
                          onLongPress={() => removeAttachment(file.name)}
                        >
                          <Text style={styles.attachmentChipText}>{file.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.inputBar}>
                    <View style={styles.attachWrapper}>
                      <Pressable
                        style={styles.attachButton}
                        onPress={() => setShowAttachMenu((value) => !value)}
                        disabled={isInputDisabled || !canAttach}
                      >
                        <Ionicons name="attach" size={20} color="#1a2744" />
                      </Pressable>
                    </View>

                    <TextInput
                      style={styles.input}
                      placeholder={
                        isSupportMode(chatMode)
                          ? 'Message admin support...'
                          : chatMode === CHAT_MODE.RESOLVED
                            ? 'Continue with Lily when ready.'
                            : 'Type your concern here...'
                      }
                      placeholderTextColor="#94a3b8"
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

                {showAttachMenu ? (
                  <View pointerEvents="box-none" style={styles.attachOverlay}>
                    <Pressable style={styles.attachBackdrop} onPress={() => setShowAttachMenu(false)} />
                    <View style={styles.attachMenu}>
                      <Pressable
                        style={[styles.attachMenuItem, styles.attachMenuDivider]}
                        onPress={() => handleAttach(pickFromLibrary)}
                        disabled={isSending}
                      >
                        <View style={styles.attachMenuRow}>
                          <Ionicons name="images-outline" size={18} color="#f8fafc" />
                          <Text style={styles.attachMenuText}>Upload Image</Text>
                        </View>
                      </Pressable>
                      <Pressable
                        style={[styles.attachMenuItem, styles.attachMenuDivider]}
                        onPress={() => handleAttach(pickDocument)}
                        disabled={isSending}
                      >
                        <View style={styles.attachMenuRow}>
                          <Ionicons name="document-text-outline" size={18} color="#f8fafc" />
                          <Text style={styles.attachMenuText}>Upload Document</Text>
                        </View>
                      </Pressable>
                      <Pressable
                        style={styles.attachMenuItem}
                        onPress={() => handleAttach(pickFromCamera)}
                        disabled={isSending}
                      >
                        <View style={styles.attachMenuRow}>
                          <Ionicons name="camera-outline" size={18} color="#f8fafc" />
                          <Text style={styles.attachMenuText}>Take Photo</Text>
                        </View>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
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
                          color="#94a3b8"
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
                        preview={item.preview}
                        status={item.status}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  screen: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#1e293b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  headerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#16213b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
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
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(212,148,42,0.15)',
    borderRadius: 10,
  },
  newChatButtonText: {
    color: '#ff9000',
    fontWeight: '700',
    fontSize: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    position: 'relative',
  },
  tabText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#f8fafc',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 3,
    borderRadius: 2,
    backgroundColor: '#204b7e',
  },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  errorBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    padding: 10,
    borderRadius: 12,
  },
  errorBannerText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },
  messages: {
    flex: 1,
    backgroundColor: '#faf8f5',
    borderRadius: 12,
  },
  messagesContent: {
    padding: 14,
    paddingBottom: 24,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  heroBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#16213b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212,226,255,0.2)',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    color: '#1a2744',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  heroSubtitle: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
  },
  heroTopics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroTopic: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#faf8f5',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  heroTopicText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
  },
  suggestSection: {
    marginBottom: 16,
    gap: 10,
  },
  suggestLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  suggestChipText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 13,
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
    backgroundColor: '#fff7ed',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fdba74',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  supportBannerActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#eff6ff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  supportBannerWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
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
    color: '#1a2744',
  },
  supportBannerText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  supportBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  supportPrimaryButton: {
    backgroundColor: '#204b7e',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  supportPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  supportGhostButton: {
    backgroundColor: 'rgba(15,23,42,0.06)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  supportGhostButtonText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 12,
  },
  supportDangerButton: {
    backgroundColor: '#ef4444',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  supportDangerButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  quickActions: {
    gap: 8,
    paddingVertical: 2,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FDF6EC',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0D9A8',
  },
  quickActionText: {
    color: '#8B6914',
    fontWeight: '700',
    fontSize: 12,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
  },
  attachmentChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  attachmentChipText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  attachWrapper: {
    position: 'relative',
    zIndex: 5,
  },
  attachButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingVertical: 6,
    fontSize: 14,
    color: '#1e293b',
  },
  sendButton: {
    backgroundColor: '#204b7e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  attachOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
  },
  attachBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  attachMenu: {
    position: 'absolute',
    left: 16,
    bottom: 100,
    width: 210,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 6,
  },
  attachMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  attachMenuDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  attachMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attachMenuText: {
    color: '#f1f5f9',
    fontWeight: '600',
    fontSize: 14,
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
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  filterChipActive: {
    backgroundColor: '#1e293b',
    borderColor: '#1e293b',
  },
  filterText: {
    fontSize: 13,
    color: '#334155',
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
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  emptyStateText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  backButton: {
    paddingRight: 12,
    paddingVertical: 8,
  },
  detailHeaderInfo: {
    flex: 1,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  statusChipSolved: {
    borderColor: '#86efac',
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fed7aa',
  },
  statusChipTextSolved: {
    color: '#86efac',
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
    backgroundColor: '#c9cdd4',
  },
  systemText: {
    fontSize: 11,
    color: '#8a8f99',
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
    backgroundColor: '#204b7e',
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
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
  },
  threadBubbleUser: {
    backgroundColor: '#E07840',
    borderBottomRightRadius: 4,
  },
  threadLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ff9000',
    marginBottom: 4,
  },
  threadText: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 20,
  },
  threadTextUser: {
    color: '#ffffff',
  },
  threadTime: {
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'right',
    marginTop: 4,
  },
  threadTimeUser: {
    color: 'rgba(255,255,255,0.65)',
  },
  detailFooter: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  resolvedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  resolvedNoticeText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#15803d',
  },
  primaryFooterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#204b7e',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  primaryFooterButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
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
    backgroundColor: '#f0f2f5',
    borderRadius: 22,
    fontSize: 14,
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  replySendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#204b7e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replySendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
});
