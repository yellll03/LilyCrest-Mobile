import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LilyFlowerIcon from '../components/assistant/LilyFlowerIcon';
import MessageBubble from '../components/assistant/MessageBubble';
import { useAuth } from '../context/AuthContext';
import { chatApi } from '../services/chatApi';

const MAX_MESSAGE_CHARS = 1000;
const MESSAGE_POLL_MS = 7000;
const LIST_POLL_MS = 12000;

const QUICK_PROMPTS = [
  'We need help with a billing concern.',
  'Please assist with a maintenance concern.',
  'I have a payment concern.',
  'Please provide more details about my concern.',
];

const CATEGORY_OPTIONS = [
  { value: 'billing_concern', label: 'Billing Concern' },
  { value: 'maintenance_concern', label: 'Maintenance Concern' },
  { value: 'reservation_concern', label: 'Reservation Concern' },
  { value: 'payment_concern', label: 'Payment Concern' },
  { value: 'general_inquiry', label: 'General Inquiry' },
  { value: 'urgent_issue', label: 'Urgent Issue' },
];

const STATUS_LABELS = {
  open: 'Open',
  in_review: 'In Review',
  waiting_tenant: 'Waiting for Tenant',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS = {
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const ACTIVE_STATUSES = new Set(['open', 'in_review', 'waiting_tenant', 'resolved']);

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function mapMessage(message) {
  return {
    id: message.id,
    sender: message.senderRole === 'tenant' ? 'user' : 'admin',
    text: message.message,
    time: formatTime(message.createdAt),
    avatar: message.senderRole === 'tenant' ? 'U' : 'A',
  };
}

function conversationPreview(conversation) {
  return conversation.lastMessage || 'No messages yet';
}

function getCategoryLabel(category) {
  return CATEGORY_OPTIONS.find((item) => item.value === category)?.label || 'General Inquiry';
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || 'Open';
}

function getPriorityLabel(priority) {
  return PRIORITY_LABELS[priority] || 'Normal';
}

function getStatusMessage(status) {
  if (status === 'waiting_tenant') return 'Admin replied and may be waiting for your response.';
  if (status === 'in_review') return 'Admin is reviewing your concern.';
  if (status === 'resolved') return 'This concern is marked resolved. You can reply if you still need help.';
  if (status === 'closed') return 'Conversation closed.';
  return 'Admin is reviewing your concern.';
}

function roomLabel(conversation) {
  return [conversation.roomNumber, conversation.roomBed].filter(Boolean).join(' / ') || 'No room assigned';
}

function getErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.response?.data?.error || error?.message || fallback;
}

export default function TenantSupportChatScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const messagesRef = useRef([]);
  const conversationRef = useRef(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [conversation, setConversation] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [historyMessages, setHistoryMessages] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [inlineError, setInlineError] = useState('');

  const isClosed = conversation?.status === 'closed';
  const needsCategory = !conversation?.id;
  const canSend =
    inputValue.trim().length > 0 &&
    !sending &&
    !loading &&
    !isClosed &&
    (!needsCategory || Boolean(selectedCategory));
  const bottomPadding = insets.bottom + (Platform.OS === 'ios' ? 88 : 72);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const loadConversations = useCallback(async () => {
    const data = await chatApi.getMyConversations();
    const nextConversations = data.conversations || [];
    setConversations(nextConversations);
    setConversation((current) => {
      if (!current?.id) return current;
      return nextConversations.find((item) => item.id === current.id) || current;
    });
  }, []);

  const loadMessages = useCallback(async (conversationId, { silent = false } = {}) => {
    if (!conversationId) return;
    const data = await chatApi.getMessages(conversationId);
    const nextMessages = data.messages || [];

    if (silent) {
      const currentIds = new Set(messagesRef.current.map((item) => item.id));
      const hasNewAdminReply = nextMessages.some(
        (item) => !currentIds.has(item.id) && item.senderRole !== 'tenant',
      );
      if (hasNewAdminReply) {
        setSuccess('New admin reply received.');
      }
    }

    setMessages(nextMessages);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !silent }), 80);
  }, []);

  const initializeChat = useCallback(async ({ silent = false } = {}) => {
    if (!user) {
      setLoading(false);
      setError('Please sign in to message LilyCrest Admin.');
      return;
    }

    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await chatApi.getMyConversations();
      const nextConversations = data.conversations || [];
      setConversations(nextConversations);
      const activeConversation = nextConversations.find((item) => ACTIVE_STATUSES.has(item.status || 'open'));

      if (activeConversation) {
        setConversation(activeConversation);
        setSelectedCategory(activeConversation.category || '');
        await loadMessages(activeConversation.id, { silent });
      } else {
        setConversation(null);
        setMessages([]);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load support chat.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [loadMessages, user]);

  useFocusEffect(
    useCallback(() => {
      initializeChat();
      const messageInterval = setInterval(() => {
        const current = conversationRef.current;
        if (current?.id) {
          loadMessages(current.id, { silent: true }).catch(() => {});
        }
      }, MESSAGE_POLL_MS);
      const listInterval = setInterval(() => {
        loadConversations().catch(() => {});
      }, LIST_POLL_MS);

      return () => {
        clearInterval(messageInterval);
        clearInterval(listInterval);
      };
    }, [initializeChat, loadConversations, loadMessages]),
  );

  const handleSend = async (presetText) => {
    const text = (presetText || inputValue).trim();
    setInlineError('');
    setSuccess('');

    if (!conversation?.id) {
      if (!selectedCategory) {
        setInlineError('Category is required.');
        return;
      }
    }
    if (!text) {
      setInlineError('Message cannot be empty.');
      return;
    }
    if (text.length > MAX_MESSAGE_CHARS) {
      setInlineError(`Message must be ${MAX_MESSAGE_CHARS} characters or fewer.`);
      return;
    }
    if (isClosed) {
      setInlineError('This conversation has been closed.');
      return;
    }
    if (sending) return;

    setSending(true);
    try {
      let activeConversation = conversation;
      if (!activeConversation?.id) {
        const startData = await chatApi.startConversation({
          category: selectedCategory,
          priority: selectedCategory === 'urgent_issue' ? 'urgent' : 'normal',
        });
        activeConversation = startData.conversation;
        setConversation(activeConversation);
      }

      const data = await chatApi.sendMessage(activeConversation.id, text);
      setConversation(data.conversation);
      setInputValue('');
      setSuccess('Message sent.');
      await Promise.all([
        loadMessages(activeConversation.id),
        loadConversations(),
      ]);
    } catch (err) {
      setInlineError(getErrorMessage(err, 'Failed to send message.'));
    } finally {
      setSending(false);
    }
  };

  const openHistoryConversation = async (item) => {
    setSelectedHistory(item);
    setHistoryLoading(true);
    setError('');
    try {
      const data = await chatApi.getMessages(item.id);
      setHistoryMessages(data.messages || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load conversation history.'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const unreadCount = useMemo(
    () => conversations.reduce((total, item) => total + (item.unreadTenantCount || 0), 0),
    [conversations],
  );
  const categoryInlineError =
    needsCategory && inputValue.trim().length > 0 && !selectedCategory
      ? 'Category is required.'
      : '';

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 82 : 0}
      >
        <View style={[styles.container, { paddingBottom: bottomPadding }]}>
          <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <View style={styles.headerLeft}>
              <View style={styles.headerAvatar}>
                <LilyFlowerIcon size={46} glow={false} pulse={sending} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.headerTitle}>LilyCrest Support</Text>
                <View style={styles.statusRow}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusText}>Tenant admin chat</Text>
                </View>
              </View>
            </View>
            <Pressable
              style={styles.refreshButton}
              onPress={() => initializeChat({ silent: true })}
              disabled={loading || sending}
            >
              <Ionicons name="refresh-outline" size={18} color="#D4682A" />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable style={styles.tab} onPress={() => setActiveTab('chat')}>
              <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>Chat</Text>
              {unreadCount > 0 ? <Text style={styles.unreadPill}>{unreadCount}</Text> : null}
              {activeTab === 'chat' ? <View style={styles.tabIndicator} /> : null}
            </Pressable>
            <Pressable style={styles.tab} onPress={() => setActiveTab('history')}>
              <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History</Text>
              {activeTab === 'history' ? <View style={styles.tabIndicator} /> : null}
            </Pressable>
          </View>

          {activeTab === 'chat' ? (
            <View style={styles.body}>
              {error ? (
                <View style={styles.bannerError}>
                  <Ionicons name="alert-circle-outline" size={16} color="#991B1B" />
                  <Text style={styles.bannerErrorText}>{error}</Text>
                </View>
              ) : null}
              {success ? (
                <View style={styles.bannerSuccess}>
                  <Ionicons name="checkmark-circle-outline" size={16} color="#166534" />
                  <Text style={styles.bannerSuccessText}>{success}</Text>
                </View>
              ) : null}

              <View style={styles.contextPanel}>
                {conversation ? (
                  <>
                    <View style={styles.badgeRow}>
                      <Text style={styles.categoryBadge}>{getCategoryLabel(conversation.category)}</Text>
                      <Text
                        style={[
                          styles.priorityBadge,
                          conversation.priority === 'urgent' && styles.priorityBadgeUrgent,
                          conversation.priority === 'high' && styles.priorityBadgeHigh,
                        ]}
                      >
                        {getPriorityLabel(conversation.priority)}
                      </Text>
                      <Text style={styles.statusBadge}>{getStatusLabel(conversation.status)}</Text>
                    </View>
                    <Text style={styles.contextText}>{getStatusMessage(conversation.status)}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.contextTitle}>Select a category to start support chat</Text>
                    <View style={styles.categoryGrid}>
                      {CATEGORY_OPTIONS.map((category) => (
                        <Pressable
                          key={category.value}
                          style={[
                            styles.categoryChip,
                            selectedCategory === category.value && styles.categoryChipActive,
                          ]}
                          onPress={() => {
                            setSelectedCategory(category.value);
                            if (inlineError === 'Category is required.') setInlineError('');
                          }}
                          disabled={sending || loading}
                        >
                          <Text
                            style={[
                              styles.categoryChipText,
                              selectedCategory === category.value && styles.categoryChipTextActive,
                            ]}
                          >
                            {category.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.contextText}>Your first message will open a new support conversation.</Text>
                  </>
                )}
              </View>

              <ScrollView
                ref={scrollRef}
                style={styles.messages}
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {loading ? (
                  <View style={styles.emptyState}>
                    <ActivityIndicator color="#D4682A" />
                    <Text style={styles.emptyTitle}>Loading support chat...</Text>
                  </View>
                ) : messages.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="chatbubbles-outline" size={34} color="#94A3B8" />
                    <Text style={styles.emptyTitle}>Start a conversation with LilyCrest Admin.</Text>
                    <Text style={styles.emptyText}>Your messages and admin replies will stay here.</Text>
                  </View>
                ) : (
                  messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={mapMessage(message)}
                      isUser={message.senderRole === 'tenant'}
                    />
                  ))
                )}
              </ScrollView>

              <View style={styles.quickRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.quickContent}>
                    {QUICK_PROMPTS.map((prompt) => (
                      <Pressable
                        key={prompt}
                        style={styles.quickChip}
                        onPress={() => {
                          setInputValue(prompt);
                          setInlineError('');
                        }}
                        disabled={sending || loading || isClosed}
                      >
                        <Text style={styles.quickText}>{prompt}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {isClosed ? (
                <View style={styles.closedBanner}>
                  <Ionicons name="lock-closed-outline" size={16} color="#475569" />
                  <Text style={styles.closedText}>This conversation has been closed.</Text>
                </View>
              ) : null}

              {inlineError || categoryInlineError ? (
                <View style={styles.inlineError}>
                  <Ionicons name="alert-circle-outline" size={15} color="#B91C1C" />
                  <Text style={styles.inlineErrorText}>{inlineError || categoryInlineError}</Text>
                </View>
              ) : null}

              <View style={styles.inputBar}>
                <TextInput
                  style={styles.input}
                  placeholder="Message LilyCrest Admin"
                  placeholderTextColor="#94A3B8"
                  value={inputValue}
                  onChangeText={(text) => {
                    setInputValue(text);
                    if (inlineError) setInlineError('');
                  }}
                  editable={!sending && !loading && !isClosed}
                  multiline
                  maxLength={MAX_MESSAGE_CHARS}
                />
                <Pressable
                  style={[styles.sendButton, !canSend && styles.buttonDisabled]}
                  onPress={() => handleSend()}
                  disabled={!canSend}
                >
                  {sending ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Ionicons name="send" size={18} color="#FFFFFF" />
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.body}>
              {selectedHistory ? (
                <View style={styles.historyDetail}>
                  <View style={styles.historyHeader}>
                    <Pressable onPress={() => setSelectedHistory(null)} style={styles.backButton}>
                      <Ionicons name="arrow-back" size={21} color="#0F172A" />
                    </Pressable>
                    <View style={styles.historyHeaderCopy}>
                      <Text style={styles.historyTitle}>LilyCrest Admin</Text>
                      <Text style={styles.historyMeta}>
                        {getStatusLabel(selectedHistory.status)} - {roomLabel(selectedHistory)}
                      </Text>
                    </View>
                  </View>
                  <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
                    {historyLoading ? (
                      <View style={styles.emptyState}>
                        <ActivityIndicator color="#D4682A" />
                        <Text style={styles.emptyTitle}>Loading conversation...</Text>
                      </View>
                    ) : historyMessages.length === 0 ? (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>No messages yet.</Text>
                      </View>
                    ) : (
                      historyMessages.map((message) => (
                        <MessageBubble
                          key={message.id}
                          message={mapMessage(message)}
                          isUser={message.senderRole === 'tenant'}
                        />
                      ))
                    )}
                  </ScrollView>
                  {ACTIVE_STATUSES.has(selectedHistory.status || 'open') ? (
                    <Pressable
                      style={styles.continueButton}
                      onPress={() => {
                        setSelectedHistory(null);
                        setActiveTab('chat');
                      }}
                    >
                      <Text style={styles.continueText}>Continue in Chat</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.closedBanner}>
                      <Ionicons name="lock-closed-outline" size={16} color="#475569" />
                      <Text style={styles.closedText}>This conversation has been closed.</Text>
                    </View>
                  )}
                </View>
              ) : conversations.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="file-tray-outline" size={34} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No conversations yet.</Text>
                  <Text style={styles.emptyText}>Your support chat history will appear here.</Text>
                </View>
              ) : (
                <ScrollView style={styles.historyList} contentContainerStyle={styles.historyContent}>
                  {conversations.map((item) => (
                    <Pressable
                      key={item.id}
                      style={styles.historyItem}
                      onPress={() => openHistoryConversation(item)}
                    >
                      <View style={styles.historyIcon}>
                        <Ionicons name="chatbubble-ellipses-outline" size={20} color="#D4682A" />
                      </View>
                      <View style={styles.historyTextWrap}>
                        <View style={styles.historyTopLine}>
                          <Text style={styles.historyTitle}>LilyCrest Admin</Text>
                          <Text style={styles.historyDate}>{formatDateTime(item.lastMessageAt || item.updatedAt)}</Text>
                        </View>
                        <Text style={styles.historyMeta}>{roomLabel(item)}</Text>
                        <Text style={styles.historyMeta}>
                          {getCategoryLabel(item.category)} - {getPriorityLabel(item.priority)}
                        </Text>
                        <Text style={styles.historyPreview} numberOfLines={1}>{conversationPreview(item)}</Text>
                      </View>
                      <View style={styles.historySide}>
                        {item.unreadTenantCount > 0 ? (
                          <Text style={styles.historyUnread}>{item.unreadTenantCount}</Text>
                        ) : null}
                        <Text style={[styles.historyStatus, item.status === 'closed' && styles.historyStatusClosed]}>
                          {getStatusLabel(item.status)}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#FAF8F5' },
  container: { flex: 1, backgroundColor: '#FAF8F5' },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#16213B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerCopy: { flex: 1 },
  headerTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22C55E' },
  statusText: { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(212,104,42,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 13, position: 'relative', flexDirection: 'row', justifyContent: 'center', gap: 7 },
  tabText: { fontSize: 13, color: '#94A3B8', fontWeight: '800' },
  tabTextActive: { color: '#F8FAFC' },
  tabIndicator: { position: 'absolute', left: '24%', right: '24%', bottom: 0, height: 3, borderRadius: 2, backgroundColor: '#D4682A' },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 5,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    lineHeight: 20,
  },
  body: { flex: 1, padding: 12, gap: 10 },
  contextPanel: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 9,
  },
  contextTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  contextText: { color: '#64748B', fontSize: 12, fontWeight: '600', lineHeight: 18 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryBadge: {
    color: '#075985',
    backgroundColor: '#E0F2FE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  priorityBadge: {
    color: '#475569',
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  priorityBadgeHigh: { color: '#92400E', backgroundColor: '#FEF3C7' },
  priorityBadgeUrgent: { color: '#991B1B', backgroundColor: '#FEE2E2' },
  statusBadge: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  categoryChipActive: { borderColor: '#D4682A', backgroundColor: '#FFF7ED' },
  categoryChipText: { color: '#334155', fontSize: 12, fontWeight: '800' },
  categoryChipTextActive: { color: '#C2410C' },
  messages: { flex: 1, backgroundColor: '#FAF8F5' },
  messagesContent: { padding: 12, paddingBottom: 18 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 54, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { color: '#334155', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: '#64748B', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  bannerError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  bannerErrorText: { color: '#991B1B', fontSize: 12, fontWeight: '700', flex: 1 },
  bannerSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  bannerSuccessText: { color: '#166534', fontSize: 12, fontWeight: '700', flex: 1 },
  quickRow: { minHeight: 42 },
  quickContent: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  quickChip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 18,
  },
  quickText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 10,
  },
  closedText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  inlineErrorText: { color: '#B91C1C', fontSize: 12, fontWeight: '700', flex: 1 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 3 }, shadowRadius: 10 },
      android: { elevation: 4 },
      web: { boxShadow: '0 4px 14px rgba(15,23,42,0.08)' },
    }),
  },
  input: { flex: 1, minHeight: 38, maxHeight: 110, paddingVertical: 8, color: '#0F172A', fontSize: 14 },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D4682A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.45 },
  historyList: { flex: 1 },
  historyContent: { gap: 10, paddingBottom: 18 },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  historyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyTextWrap: { flex: 1, minWidth: 0, gap: 3 },
  historyTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  historyTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  historyMeta: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  historyPreview: { color: '#334155', fontSize: 13 },
  historyDate: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  historySide: { alignItems: 'flex-end', gap: 6 },
  historyUnread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 5,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 20,
    overflow: 'hidden',
  },
  historyStatus: {
    color: '#166534',
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    overflow: 'hidden',
  },
  historyStatusClosed: { color: '#475569', backgroundColor: '#E2E8F0' },
  historyDetail: { flex: 1, gap: 10 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  historyHeaderCopy: { flex: 1 },
  continueButton: {
    backgroundColor: '#D4682A',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  continueText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
