import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InquiryCard from '../components/assistant/InquiryCard';
import LilyFlowerIcon from '../components/assistant/LilyFlowerIcon';
import MessageBubble from '../components/assistant/MessageBubble';
import { useAuth } from '../context/AuthContext';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { apiService } from '../services/api';
import { pickDocument, pickFromCamera, pickFromLibrary } from '../utils/attachmentPicker';

// ── Follow-up suggestion chips rendered below bot messages ──
function FollowupChips({ suggestions, onSelect }) {
  if (!suggestions?.length) return null;
  return (
    <View style={followupStyles.container}>
      {suggestions.map((s, i) => (
        <Pressable key={`${s.label}-${i}`} style={followupStyles.chip} onPress={() => onSelect(s.prompt)}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color="#D4682A" />
          <Text style={followupStyles.text}>{s.label}</Text>
          <Ionicons name="chevron-forward" size={12} color="#E0793A" />
        </Pressable>
      ))}
    </View>
  );
}

const followupStyles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 10, paddingLeft: 48 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FDF6EC', borderRadius: 20, borderWidth: 1, borderColor: '#F0D9A8' },
  text: { color: '#8B6914', fontWeight: '600', fontSize: 12 },
});

// ── Animated typing indicator ──
function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (dot, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ])
      );
    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 180);
    const a3 = pulse(dot3, 360);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  return (
    <View style={typingStyles.row}>
      <View style={typingStyles.avatarSmall}><LilyFlowerIcon size={16} glow={false} /></View>
      <View style={typingStyles.bubble}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View key={i} style={[typingStyles.dot, { opacity: dot }]} />
        ))}
      </View>
      <Text style={typingStyles.label}>Lily is thinking…</Text>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8 },
  avatarSmall: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  bubble: { flexDirection: 'row', gap: 6, backgroundColor: '#ffffff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E0793A' },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: '600', fontStyle: 'italic' },
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
];

const MAX_CHAT_INPUT_CHARS = 800;
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const normalizeKey = (text = '') =>
  text
    .trim()
    .toLowerCase()
    .replace(/[?.!]/g, '')
    .replace(/\s+/g, ' ');

const isAdminEscalation = (text = '') => ADMIN_KEYWORDS.some((phrase) => normalizeKey(text).includes(phrase));

const sanitizeChatInput = (text = '') => text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

const attachmentKey = (file = {}) => `${file.name || 'file'}::${file.size || 0}::${file.uri || ''}`;

const formatTimestamp = (date) => {
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatTime = (date) => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function LilyAssistantScreen() {
  const scrollRef = useRef(null);
  const adminScrollRef = useRef(null);
  const seenAdminMsgIds = useRef(new Set());
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
  const [activeTicket, setActiveTicket] = useState(null); // { id, status } when admin chat is live
  const [networkError, setNetworkError] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const initialSession = useMemo(() => `${user?.user_id || 'guest'}-chat-${Date.now()}`, [user?.user_id]);
  const chat = useAssistantChat(initialSession);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const headerShift = useRef(new Animated.Value(0)).current;
  const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 72;
  const bottomOffset = insets.bottom + TAB_BAR_HEIGHT;

  const initialMessages = useMemo(() => [], []);

  const [messages, setMessages] = useState(initialMessages);
  const [inquiries, setInquiries] = useState([]);
  const [selectedInquiry, setSelectedInquiry] = useState(null);

  const markInteracted = () => {
    if (!hasInteracted) setHasInteracted(true);
  };

  const mapTicketToInquiry = (ticket) => {
    const created = ticket?.created_at ? new Date(ticket.created_at) : new Date();
    const responses = Array.isArray(ticket?.responses) ? ticket.responses : [];
    return {
      id: ticket?.ticket_id || ticket?.id || `ticket-${Date.now()}`,
      title: ticket?.subject || 'Support Request',
      status: ticket?.status === 'open' ? 'pending' : ticket?.status || 'pending',
      timestamp: formatTimestamp(created),
      attachments: [],
      thread: [
        {
          id: 'msg-0',
          sender: 'user',
          text: ticket?.message || 'Shared a request.',
          time: formatTime(created),
        },
        ...responses.map((resp, idx) => {
          const respTime = resp?.created_at ? new Date(resp.created_at) : created;
          return {
            id: `resp-${idx}`,
            sender: resp?.sender === 'user' ? 'user' : 'admin',
            text: resp?.message || resp?.text || 'Response received.',
            time: formatTime(respTime),
          };
        }),
      ],
    };
  };

  // Load session (no persistence; always fresh)
  useEffect(() => {
    chat.loadPersistedSession();
  }, []);

  useEffect(() => {
    Animated.timing(headerShift, {
      toValue: isInputFocused ? -6 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [headerShift, isInputFocused]);

  // Reset backend session when session id changes
  useEffect(() => {
    const resetSession = async () => {
      if (!user) return;
      try {
        await apiService.resetChatSession(chat.sessionId);
      } catch (err) {
        console.warn('Gemini session reset skipped:', err?.message);
      }
    };
    resetSession();
  }, [chat.sessionId, user?.user_id]);

  useEffect(() => {
    const loadTickets = async () => {
      if (!user) {
        setNetworkError('Please sign in to view your inquiries.');
        return;
      }
      try {
        const { data } = await apiService.getMyTickets();
        setInquiries(data.map(mapTicketToInquiry));
      } catch (err) {
        console.warn('Unable to load inquiries', err?.message);
        if (!networkError) setNetworkError('Unable to load your inquiries right now.');
      }
    };
    loadTickets();
  }, [user?.user_id, networkError]);

  // Poll for admin replies when a ticket is active
  useEffect(() => {
    if (!activeTicket?.id) return;
    const poll = async () => {
      try {
        const { data } = await apiService.getTicket(activeTicket.id);
        const responses = Array.isArray(data.responses) ? data.responses : [];
        const adminResponses = responses.filter((r) => r.sender !== 'user');
        const newMsgs = [];
        for (const resp of adminResponses) {
          const rid = String(resp._id || resp.id || `${resp.message}-${resp.created_at}`);
          if (!seenAdminMsgIds.current.has(rid)) {
            seenAdminMsgIds.current.add(rid);
            newMsgs.push({
              id: `admin-${rid}`,
              sender: 'admin',
              text: resp.message || resp.text || '',
              time: formatTime(resp.created_at ? new Date(resp.created_at) : new Date()),
              avatar: 'A',
            });
          }
        }
        if (newMsgs.length) {
          setMessages((prev) => [...prev, ...newMsgs]);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
        }
        if (data.status === 'solved' || data.status === 'closed') {
          setMessages((prev) => [
            ...prev,
            { id: `sys-resolved-${Date.now()}`, sender: 'system', text: 'Your inquiry has been resolved. Thank you!' },
          ]);
          setActiveTicket(null);
        }
      } catch (err) {
        console.warn('Admin poll failed:', err?.message);
      }
    };
    poll();
    const interval = setInterval(poll, 8000);
    return () => clearInterval(interval);
  }, [activeTicket?.id]);

  const handleSend = async (presetText) => {
    const text = sanitizeChatInput(presetText || inputValue);
    const attachmentNames = attachments.map((file) => file.name);
    if (!text && !attachments.length) return;
    if (text.length > MAX_CHAT_INPUT_CHARS) {
      setNetworkError(`Message is too long. Please keep it under ${MAX_CHAT_INPUT_CHARS} characters.`);
      return;
    }

    const userMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: text || 'Shared attachments',
      time: formatTime(new Date()),
      avatar: 'U',
      attachments,
    };

    markInteracted();
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setAttachments([]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    // ── Active admin ticket: route message to ticket instead of Gemini ──
    if (activeTicket?.id && text) {
      setIsSending(true);
      try {
        await apiService.respondToTicket(activeTicket.id, { message: text, sender: 'user' });
      } catch (err) {
        setNetworkError('Failed to send message to admin. Please try again.');
      } finally {
        setIsSending(false);
      }
      return;
    }

    if (!text) {
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: 'Attachment received po. Please add a short message so I can process your concern accurately.',
          time: formatTime(new Date()),
          avatar: 'L',
          meta: { intent: 'attachment-only', confidence: 1 },
        },
      ]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
      return;
    }

    if (isAdminEscalation(text)) {
      await escalateToAdmin(text, attachmentNames);
      return;
    }

    setIsSending(true);
    setNetworkError(null);
    const { response, metadata, needsAdmin, suggestions, error } = await chat.sendMessage(text);
    setIsSending(false);

    if (error) {
      setNetworkError(error.detail || 'Unable to reach Gemini right now.');
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: 'I could not connect to the assistant. Please retry or check your connection.',
          time: formatTime(new Date()),
          avatar: 'L',
          meta: { intent: 'fallback', confidence: null },
        },
      ]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      return;
    }

    if (!response) {
      setNetworkError('Assistant did not return a response. Please try again.');
      return;
    }

    // If backend flagged needs_admin, auto-escalate via ticket
    if (needsAdmin) {
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: response,
          time: formatTime(new Date()),
          avatar: 'L',
          meta: { intent: metadata?.intent || 'admin-escalation', confidence: metadata?.confidence ?? null },
        },
      ]);
      // Trigger admin ticket creation automatically
      await escalateToAdmin(text, []);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `b-${Date.now()}`,
        sender: 'bot',
        text: response,
        time: formatTime(new Date()),
        avatar: 'L',
        suggestions: suggestions || [],
        meta: {
          intent: metadata?.intent || 'general',
          confidence: metadata?.confidence ?? null,
          embeddingId: metadata?.embedding_id || null,
        },
      },
    ]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
  };

  const escalateToAdmin = async (text, attached = []) => {
    if (activeTicket) return; // already connected to admin
    setIsSending(true);
    const safeText = sanitizeChatInput(text).slice(0, MAX_CHAT_INPUT_CHARS);
    const attachmentNote = attached.length ? `\nAttachments: ${attached.join(', ')}` : '';
    try {
      const { data } = await apiService.createTicket({
        subject: 'Admin assistance request',
        message: `${safeText}${attachmentNote}`,
        category: 'Admin',
      });

      const inquiry = mapTicketToInquiry(data);
      setInquiries((prev) => [inquiry, ...prev.filter((item) => item.id !== inquiry.id)]);

      const ticketId = data.ticket_id || data.id || inquiry.id;
      setActiveTicket({ id: ticketId, status: 'open' });

      setMessages((prev) => [
        ...prev,
        {
          id: `b-esc-${Date.now()}`,
          sender: 'bot',
          text: 'Sorry, I am not able to respond to your query. You will be transferred to an admin for better assistance. Thank you for your patience.',
          time: formatTime(new Date()),
          avatar: 'L',
          meta: { intent: 'admin-escalation', confidence: 1 },
        },
        {
          id: `sys-transfer-${Date.now()}`,
          sender: 'system',
          text: 'Chat has been transferred to admin, who will assist you',
        },
      ]);
    } catch (error) {
      const detail = error?.response?.data?.detail || 'Could not connect to admin. Please try again.';
      setNetworkError(detail);
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: 'I attempted to reach an admin but could not create a ticket. Please retry shortly.',
          time: formatTime(new Date()),
          avatar: 'L',
          meta: { intent: 'admin-escalation-failed', confidence: 0 },
        },
      ]);
    } finally {
      setIsSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  const sendReply = async () => {
    const text = sanitizeChatInput(replyText).slice(0, MAX_CHAT_INPUT_CHARS);
    if (!text || !selectedInquiry) return;
    setIsSendingReply(true);
    setReplyText('');
    const newMsg = {
      id: `u-reply-${Date.now()}`,
      sender: 'user',
      text,
      time: formatTime(new Date()),
    };
    setSelectedInquiry((prev) => ({ ...prev, thread: [...prev.thread, newMsg] }));
    setInquiries((prev) =>
      prev.map((item) =>
        item.id === selectedInquiry.id ? { ...item, thread: [...item.thread, newMsg] } : item
      )
    );
    try {
      await apiService.respondToTicket(selectedInquiry.id, { message: text, sender: 'user' });
    } catch (err) {
      console.warn('Reply failed:', err?.message);
    } finally {
      setIsSendingReply(false);
      setTimeout(() => adminScrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const handleAttach = async (pickerFn) => {
    try {
      const file = await pickerFn();
      if (file) {
        if (!file?.uri || !file?.name) {
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
      }
    } catch (err) {
      setNetworkError(err?.message || 'Attachment failed');
    }
    setShowAttachMenu(false);
  };

  const removeAttachment = (name) => {
    setAttachments((prev) => prev.filter((item) => item.name !== name));
  };

  const handleQuickAction = (action) => {
    if (action.id === 'admin') {
      markInteracted();
      escalateToAdmin('Please connect me to an admin.', []);
      return;
    }

    const prompt = action.prompt || '';
    setInputValue(prompt);
    markInteracted();
    handleSend(prompt);
  };

  const filteredInquiries = inquiries.filter((item) => (filter === 'all' ? true : item.status === filter));

  const renderInquiryDetail = () => {
    if (!selectedInquiry) return null;
    const isSolved = selectedInquiry.status === 'solved';
    const isActive = activeTicket?.id === selectedInquiry.id;
    return (
      <View style={styles.adminChatContainer}>
        {/* Header */}
        <View style={styles.adminChatHeader}>
          <Pressable style={styles.adminBackBtn} onPress={() => setSelectedInquiry(null)}>
            <Ionicons name="arrow-back" size={22} color="#f8fafc" />
          </Pressable>
          <View style={styles.adminAvatarWrap}>
            <Text style={styles.adminAvatarText}>A</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.adminHeaderName}>LilyCrest Admin</Text>
            <View style={styles.adminHeaderStatusRow}>
              {!isSolved && <View style={styles.adminOnlineDot} />}
              <Text style={styles.adminHeaderStatus}>{isSolved ? 'Resolved' : 'Pending'}</Text>
            </View>
          </View>
          <View style={[styles.adminStatusChip, isSolved && styles.adminStatusSolved]}>
            <Text style={[styles.adminStatusChipText, isSolved && styles.adminStatusSolvedText]}>
              {isSolved ? 'Solved' : 'Pending'}
            </Text>
          </View>
        </View>

        {/* Read-only thread */}
        <ScrollView
          ref={adminScrollRef}
          style={styles.adminChatScroll}
          contentContainerStyle={[styles.adminChatContent, { flexGrow: 1, justifyContent: 'flex-end' }]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => adminScrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={styles.systemMsgRow}>
            <View style={styles.systemMsgLine} />
            <Text style={styles.systemMsgText}>Chat has been transferred to admin, who will assist you</Text>
            <View style={styles.systemMsgLine} />
          </View>

          {selectedInquiry.thread.map((item) => {
            const isUser = item.sender === 'user';
            return (
              <View key={item.id} style={[styles.threadBubbleRow, isUser ? styles.threadBubbleRowRight : styles.threadBubbleRowLeft]}>
                {!isUser && (
                  <View style={styles.threadAdminAvatar}>
                    <Text style={styles.threadAdminAvatarText}>A</Text>
                  </View>
                )}
                <View style={[styles.threadBubble, isUser ? styles.threadBubbleUser : styles.threadBubbleAdmin]}>
                  <Text style={[styles.threadBubbleText, isUser ? styles.threadBubbleTextUser : styles.threadBubbleTextAdmin]}>
                    {item.text}
                  </Text>
                  <Text style={[styles.threadBubbleTime, isUser && styles.threadBubbleTimeUser]}>{item.time}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* Footer — go to Chat tab to continue, or "Resolved" notice */}
        <View style={styles.inquiryDetailFooter}>
          {isSolved ? (
            <View style={styles.inquiryResolvedNotice}>
              <Ionicons name="checkmark-circle" size={16} color="#15803d" />
              <Text style={styles.inquiryResolvedText}>This inquiry has been resolved</Text>
            </View>
          ) : isActive ? (
            <Pressable
              style={styles.goToChatBtn}
              onPress={() => {
                setSelectedInquiry(null);
                setActiveTab('chat');
              }}
            >
              <Ionicons name="arrow-forward-circle-outline" size={15} color="#ffffff" />
              <Text style={styles.goToChatText}>Continue in Chat</Text>
            </Pressable>
          ) : (
            <View style={styles.inquiryResolvedNotice}>
              <Ionicons name="information-circle-outline" size={16} color="#64748b" />
              <Text style={[styles.inquiryResolvedText, { color: '#64748b' }]}>Go to Chat tab to talk to admin</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const hasStartedChat = hasInteracted || messages.length > 0 || inputValue.trim().length > 0 || attachments.length > 0;
  const showIntro = true; // keep header + suggested questions visible even after chat starts

  return (
    <View style={{ flex: 1, backgroundColor: '#faf8f5' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? TAB_BAR_HEIGHT : 0}>
      <View style={[styles.screen, { paddingBottom: TAB_BAR_HEIGHT }]}>
      {/* Header */}
      <Animated.View style={[styles.header, { paddingTop: insets.top + 10, transform: [{ translateY: headerShift }] }]}>
        <View style={styles.headerLeft}>
          <View style={styles.headerAvatar}>
            <LilyFlowerIcon size={28} glow={false} pulse={isSending} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Lily</Text>
            <View style={styles.headerStatusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusLabel}>Your dormitory assistant</Text>
            </View>
          </View>
        </View>
        {hasInteracted ? (
          <Pressable
            style={styles.newChatBtn}
            onPress={async () => {
              await chat.resetSession();
              setMessages([]);
              setHasInteracted(false);
              setNetworkError(null);
              setActiveTicket(null);
              seenAdminMsgIds.current.clear();
            }}
          >
            <Ionicons name="refresh-outline" size={16} color="#D4682A" />
            <Text style={styles.newChatText}>New</Text>
          </Pressable>
        ) : null}
      </Animated.View>

      {/* Tabs from HTML nav */}
      <View style={styles.tabs}>
        {['chat', 'inquiries'].map((tab) => (
          <Pressable key={tab} style={styles.tab} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'chat' ? 'Chat' : 'My Inquiries'}</Text>
            {activeTab === tab ? <View style={styles.tabIndicator} /> : null}
          </Pressable>
        ))}
      </View>

      {activeTab === 'chat' ? (
        <View style={styles.body}>
          {/* Chat messages area */}
          {networkError ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{networkError}</Text>
            </View>
          ) : null}

          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={[styles.messagesContent, { paddingBottom: 20 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {showIntro ? (
              <View style={styles.heroCard}>
                <View style={styles.heroRow}>
                  <View style={styles.heroBadge}>
                    <LilyFlowerIcon size={32} glow={false} pulse />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroTitle}>Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!</Text>
                    <Text style={styles.heroSubtitle}>I'm Lily, your AI assistant. How can I help you today?</Text>
                  </View>
                </View>
                <View style={styles.heroTopics}>
                  {HERO_TOPICS.map((topic) => (
                    <Pressable
                      key={topic.id}
                      style={styles.heroTopic}
                      onPress={() => {
                        markInteracted();
                        handleSend(topic.prompt);
                      }}
                    >
                      <Text style={styles.heroTopicText}>{topic.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {showIntro ? (
              <View style={styles.suggestSection}>
                <Text style={styles.suggestLabel}>You may want to ask:</Text>
                <View style={styles.suggestChips}>
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <Pressable
                      key={q}
                      style={styles.suggestChip}
                      onPress={() => {
                        markInteracted();
                        handleSend(q);
                      }}
                    >
                      <Text style={styles.suggestChipText}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {messages.map((message) => (
              <View key={message.id}>
                <MessageBubble message={message} isUser={message.sender === 'user'} />
                {message.sender === 'bot' && message.suggestions?.length ? (
                  <FollowupChips suggestions={message.suggestions} onSelect={(prompt) => handleSend(prompt)} />
                ) : null}
              </View>
            ))}
            {chat.isTyping ? <TypingIndicator /> : null}
          </ScrollView>

          <View style={styles.bottomZone}>
            {/* Admin connected banner */}
            {activeTicket ? (
              <View style={styles.adminConnectedBanner}>
                <View style={styles.adminConnectedDot} />
                <Text style={styles.adminConnectedText}>Connected to LilyCrest Admin</Text>
                <Pressable
                  onPress={() => {
                    setMessages((prev) => [
                      ...prev,
                      { id: `sys-end-${Date.now()}`, sender: 'system', text: 'You have ended the admin chat.' },
                    ]);
                    setActiveTicket(null);
                    seenAdminMsgIds.current.clear();
                  }}
                >
                  <Text style={styles.adminEndText}>End</Text>
                </Pressable>
              </View>
            ) : null}

            {!hasStartedChat && !activeTicket ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickActionsBar}>
                {QUICK_ACTIONS.map((action) => (
                  <Pressable key={action.id} style={styles.quickActionPill} onPress={() => handleQuickAction(action)}>
                    <Ionicons name={action.icon} size={15} color="#D4682A" />
                    <Text style={styles.quickActionText}>{action.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {attachments.length ? (
              <View style={styles.attachmentRow}>
                {attachments.map((file) => (
                  <Pressable key={file.name} style={styles.previewChip} onLongPress={() => removeAttachment(file.name)}>
                    <Text style={styles.previewText}>{file.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={styles.inputBarContainer}>
              <View style={styles.attachWrapper}>
                <Pressable style={styles.attachButton} onPress={() => setShowAttachMenu((v) => !v)} disabled={isSending}>
                  <Ionicons name="attach" size={20} color="#0f172a" />
                </Pressable>
              </View>
              <TextInput
                style={styles.input}
                placeholder={activeTicket ? 'Message admin…' : 'You may type your concern here…'}
                placeholderTextColor="#94a3b8"
                value={inputValue}
                onChangeText={(text) => {
                  setInputValue(text);
                  if (text.trim().length) markInteracted();
                }}
                onFocus={() => {
                  setShowAttachMenu(false);
                  setIsInputFocused(true);
                }}
                onBlur={() => setIsInputFocused(false)}
                multiline
                editable={!isSending}
              />
              <Pressable style={[styles.sendButton, isSending && styles.buttonDisabled]} onPress={() => handleSend()} disabled={isSending}>
                <Text style={styles.sendText}>{isSending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          </View>
          {showAttachMenu ? (
            <View pointerEvents="box-none" style={styles.attachOverlay}>
              <Pressable style={styles.attachBackdrop} onPress={() => setShowAttachMenu(false)} />
              <View style={[styles.attachMenu, { bottom: 100 }]}> 
                <Pressable style={[styles.attachItem, styles.attachDivider]} onPress={() => handleAttach(pickFromLibrary)} disabled={isSending}>
                  <View style={styles.attachRow}>
                    <Ionicons name="images-outline" size={18} color="#f8fafc" style={styles.attachIcon} />
                    <Text style={styles.attachText}>Upload Image</Text>
                  </View>
                </Pressable>
                <Pressable style={[styles.attachItem, styles.attachDivider]} onPress={() => handleAttach(pickDocument)} disabled={isSending}>
                  <View style={styles.attachRow}>
                    <Ionicons name="document-text-outline" size={18} color="#f8fafc" style={styles.attachIcon} />
                    <Text style={styles.attachText}>Upload Document</Text>
                  </View>
                </Pressable>
                <Pressable style={styles.attachItem} onPress={() => handleAttach(pickFromCamera)} disabled={isSending}>
                  <View style={styles.attachRow}>
                    <Ionicons name="videocam-outline" size={18} color="#f8fafc" style={styles.attachIcon} />
                    <Text style={styles.attachText}>Upload Video</Text>
                  </View>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : selectedInquiry ? renderInquiryDetail() : (
        <View style={styles.body}>
          {/* Filter pills */}
          <View style={styles.filterRow}>
            {FILTERS.map((item) => (
              <Pressable key={item.id} style={[styles.filterChip, filter === item.id && styles.filterChipActive]} onPress={() => setFilter(item.id)}>
                <Text style={[styles.filterText, filter === item.id && styles.filterTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={styles.inquiryList} contentContainerStyle={styles.inquiryContent} showsVerticalScrollIndicator={false}>
            {filteredInquiries.length === 0 ? (
              <View style={styles.emptyInquiries}>
                <View style={styles.emptyInquiriesIcon}>
                  <Ionicons
                    name={filter === 'solved' ? 'checkmark-done-circle-outline' : filter === 'pending' ? 'hourglass-outline' : 'chatbubbles-outline'}
                    size={36}
                    color="#94a3b8"
                  />
                </View>
                <Text style={styles.emptyInquiriesTitle}>
                  {filter === 'solved' ? 'No solved inquiries' : filter === 'pending' ? 'No pending inquiries' : 'No inquiries yet'}
                </Text>
                <Text style={styles.emptyInquiriesText}>
                  {filter === 'solved'
                    ? 'None of your inquiries have been resolved yet. Hang tight!'
                    : filter === 'pending'
                    ? 'You have no open inquiries at the moment.'
                    : 'When you ask Lily to connect you to an admin, your inquiry will appear here.'}
                </Text>
              </View>
            ) : filteredInquiries.map((item) => (
              <InquiryCard
                key={item.id}
                title={item.title}
                preview={item.thread?.[0]?.text || ''}
                status={item.status}
                timestamp={item.timestamp}
                onPress={() => setSelectedInquiry(item)}
              />
            ))}
          </ScrollView>
        </View>
      )}
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#faf8f5',
  },
  // ─── Header ───
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: '#1e293b',
    zIndex: 20,
    elevation: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Platform.select({
      ios: { shadowColor: '#0f172a', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 4 }, shadowRadius: 8 },
    }),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  headerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(212,148,42,0.4)',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  statusLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(212,148,42,0.15)',
    borderRadius: 10,
  },
  newChatText: {
    color: '#E0793A',
    fontWeight: '700',
    fontSize: 12,
  },
  // ─── Tabs ───
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
    backgroundColor: '#E0793A',
  },
  // ─── Body ───
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
    position: 'relative',
  },
  messages: {
    flex: 1,
    backgroundColor: '#faf8f5',
    borderRadius: 12,
  },
  messagesContent: {
    padding: 14,
  },
  withIntroPadding: { paddingBottom: 40 },
  withoutIntroPadding: { paddingBottom: 80 },
  // ─── Hero Card ───
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.06)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 4 }, shadowRadius: 16 },
      android: { elevation: 4 },
    }),
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  heroBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(212,148,42,0.3)',
  },
  heroTitle: { color: '#0f172a', fontSize: 20, fontWeight: '800', marginBottom: 2 },
  heroSubtitle: { color: '#64748b', fontSize: 13, lineHeight: 19 },
  heroTopics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroTopic: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#faf8f5',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  heroTopicText: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  // ─── Attachment ───
  attachWrapper: { position: 'relative', zIndex: 50 },
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
  attachOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 80 },
  attachBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  attachMenu: {
    position: 'absolute',
    left: 16,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 6,
    width: 210,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16 },
      android: { elevation: 14 },
    }),
  },
  attachItem: { paddingVertical: 12, paddingHorizontal: 14 },
  attachDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  attachIcon: { width: 20 },
  attachText: { color: '#f1f5f9', fontWeight: '600', fontSize: 14 },
  // ─── Suggestions ───
  quickLabel: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  suggestSection: { marginBottom: 16, gap: 10 },
  suggestLabel: { fontSize: 12, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3 },
      android: { elevation: 1 },
    }),
  },
  suggestChipText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.3,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
  previewChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  previewText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  // ─── Bottom Input Zone ───
  bottomZone: {
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  inputBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.06)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12 },
      android: { elevation: 6 },
    }),
  },
  iconGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  banner: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    padding: 10,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#cbd5e1' },
  typingText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    paddingVertical: 6,
    fontSize: 14,
    color: '#1e293b',
  },
  sendButton: {
    backgroundColor: '#D4682A',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  buttonDisabled: { opacity: 0.5 },
  sendText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  attachmentActions: { flexDirection: 'row', gap: 12, paddingHorizontal: 4 },
  linkBtn: { color: '#0ea5e9', fontWeight: '700' },
  attachmentActionsFloating: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 84,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowOffset: { width: 0, height: 6 }, shadowRadius: 14 },
      android: { elevation: 10 },
    }),
  },
  // ─── Quick Actions ───
  quickActionsBar: { gap: 8, paddingVertical: 2 },
  quickActionPill: {
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
  quickActionText: { color: '#8B6914', fontWeight: '700', fontSize: 12 },
  // ─── Inquiries ───
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
  detailCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    gap: 10,
    marginBottom: 10,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  detailTime: {
    fontSize: 12,
    color: '#94a3b8',
  },
  detailAttachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailChipText: {
    fontSize: 12,
    color: '#334155',
  },
  detailThread: {
    gap: 8,
  },
  threadRow: {
    backgroundColor: '#faf8f5',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  threadAdmin: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  threadUser: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  threadLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  threadText: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 20,
    marginBottom: 4,
  },
  threadTime: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
  },
  // ─── Empty Inquiries ───
  emptyInquiries: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyInquiriesIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyInquiriesTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  emptyInquiriesText: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
  },
  // ─── Inquiry Detail Footer ───
  inquiryDetailFooter: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inquiryResolvedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  inquiryResolvedText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#15803d',
  },
  goToChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#D4682A',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  goToChatText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  // ─── Admin Connected Banner ───
  adminConnectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f0f9f4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  adminConnectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  adminConnectedText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#15803d',
  },
  adminEndText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
    paddingLeft: 8,
  },
  // ─── Admin Chat (Shopee-style) ───
  adminChatContainer: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  adminChatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  adminBackBtn: {
    padding: 6,
    marginRight: 2,
  },
  adminAvatarWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#D4682A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminAvatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  adminHeaderName: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  adminHeaderStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  adminOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  adminHeaderStatus: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
  },
  adminStatusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  adminStatusChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fed7aa',
  },
  adminStatusSolved: {
    borderColor: '#86efac',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  adminStatusSolvedText: {
    color: '#86efac',
  },
  adminChatScroll: {
    flex: 1,
  },
  adminChatContent: {
    padding: 14,
    paddingBottom: 20,
  },
  // System transfer notice
  systemMsgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 16,
    paddingHorizontal: 4,
  },
  systemMsgLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#c9cdd4',
  },
  systemMsgText: {
    fontSize: 11,
    color: '#8a8f99',
    fontWeight: '400',
    textAlign: 'center',
    flexShrink: 1,
  },
  // Bubble rows
  threadBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 4,
  },
  threadBubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  threadBubbleRowRight: {
    justifyContent: 'flex-end',
  },
  threadAdminAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#D4682A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
    flexShrink: 0,
  },
  threadAdminAvatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 11,
  },
  threadBubble: {
    maxWidth: '72%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 7,
  },
  threadBubbleAdmin: {
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3 },
      android: { elevation: 1 },
    }),
  },
  threadBubbleUser: {
    backgroundColor: '#E07840',
    borderBottomRightRadius: 4,
  },
  threadBubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  threadBubbleTextAdmin: {
    color: '#1e293b',
  },
  threadBubbleTextUser: {
    color: '#ffffff',
  },
  threadBubbleTime: {
    fontSize: 10,
    color: '#94a3b8',
    alignSelf: 'flex-end',
    marginTop: 3,
  },
  threadBubbleTimeUser: {
    color: 'rgba(255,255,255,0.65)',
  },
  // Reply input bar
  adminInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e8eaed',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  adminInput: {
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
  adminSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D4682A',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  adminSendBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
});
