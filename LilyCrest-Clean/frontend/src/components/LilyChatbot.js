import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const SUGGESTIONS = [
  'Billing & Payments',
  'Maintenance Requests',
  'Dormitory Rules',
  'My Room & Stay',
  'Talk to Admin',
];

const PREDEFINED = {
  billing: 'For billing amounts and schedules, please check your latest statement in the Billing tab. Late payments may incur penalties as stated in dorm policies.',
  payments: 'You can pay via the official channels listed in the Billing screen. Keep proof of payment for verification.',
  penalties: 'Penalties follow the dormitory policy. Late fees and violations are applied as published in the house rules.',
  rules: 'Dormitory rules cover quiet hours, guests, cleanliness, and safety. You can review them in the House Rules section.',
  maintenance: 'To file maintenance, go to Services > Submit New Inquiry. Provide details and photos for faster handling.',
  room: 'Room and stay details are available in your dashboard. For changes, please coordinate with the admin.',
  admin: 'This concern requires administrator assistance. I’ll forward this to the admin.',
  fallback: 'I’m not fully certain about this. Let me forward your concern to the administrator.',
};

function detectPredefined(intent) {
  if (!intent) return null;
  const key = intent.toLowerCase();
  if (key.includes('bill')) return 'billing';
  if (key.includes('pay')) return 'payments';
  if (key.includes('penalt')) return 'penalties';
  if (key.includes('rule') || key.includes('policy')) return 'rules';
  if (key.includes('maint')) return 'maintenance';
  if (key.includes('room') || key.includes('stay')) return 'room';
  if (key.includes('admin')) return 'admin';
  return null;
}

export default function LilyChatbot() {
  const scrollRef = useRef(null);
  const [sessionId] = useState(() => `sess-${Date.now()}`);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'bot',
      text: 'Hi, I’m Lily, your dormitory assistant. I can help you with your stay, billing, and concerns.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const appendMessage = (msg) => setMessages((prev) => [...prev, msg]);

  const handleSend = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text) return;
    setShowSuggestions(false);
    setInput('');
    const userMsg = { id: `u-${Date.now()}`, sender: 'user', text, time: timeNow() };
    appendMessage(userMsg);

    setIsSending(true);
    const intentResult = await classifyIntentLocal(text);
    const predefinedKey = detectPredefined(intentResult.intent);
    if (predefinedKey) {
      appendMessage({ id: `b-${Date.now()}`, sender: 'bot', text: PREDEFINED[predefinedKey], time: timeNow() });
      setIsSending(false);
      return;
    }

    if (intentResult.escalate) {
      appendMessage({ id: `b-${Date.now()}`, sender: 'bot', text: PREDEFINED.admin, time: timeNow(), escalate: true });
      setIsSending(false);
      return;
    }

    const aiText = await generateAIResponse(text, intentResult.intent);
    appendMessage({ id: `b-${Date.now()}`, sender: 'bot', text: aiText || PREDEFINED.fallback, time: timeNow() });
    setIsSending(false);
  };

  const classifyIntentLocal = async (text) => {
    const lower = text.toLowerCase();
    if (lower.includes('admin') || lower.includes('human')) return { intent: 'admin_escalation', escalate: true };
    if (lower.includes('bill') || lower.includes('pay')) return { intent: 'billing', escalate: false };
    if (lower.includes('rule') || lower.includes('policy')) return { intent: 'rules', escalate: false };
    if (lower.includes('maint') || lower.includes('fix') || lower.includes('repair')) return { intent: 'maintenance', escalate: false };
    return { intent: 'general', escalate: false };
  };

  const generateAIResponse = async (userText, intent) => {
    try {
      const res = await callBackendAI({ sessionId, userText, intent });
      return res?.text;
    } catch (_err) {
      return null;
    }
  };

  // Placeholder: wire this to your backend endpoint
  const callBackendAI = async ({ sessionId: sid, userText, intent }) => {
    // Example fetch
    // const resp = await fetch(`${API_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, text: userText, intent }) });
    // return resp.json();
    return { text: null };
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.avatar}><Text style={styles.avatarText}>L</Text></View>
            <View>
              <Text style={styles.title}>Lily – Dormitory Assistant</Text>
              <Text style={styles.subtitle}>Online</Text>
            </View>
          </View>

          <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={{ padding: 12 }}>
            {messages.map((m) => (
              <View key={m.id} style={[styles.row, m.sender === 'user' ? styles.rowUser : styles.rowBot]}>
                {m.sender === 'bot' && <View style={styles.botAvatar}><Text style={styles.botAvatarText}>L</Text></View>}
                <View style={[styles.bubble, m.sender === 'user' ? styles.userBubble : styles.botBubble]}>
                  <Text style={[styles.text, m.sender === 'user' && styles.userText]}>{m.text}</Text>
                  <Text style={[styles.time, m.sender === 'user' && styles.userTime]}>{m.time}</Text>
                </View>
              </View>
            ))}
            {showSuggestions && (
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} style={styles.chip} onPress={() => handleSend(s)}>
                    <Ionicons name="sparkles" size={14} color="#204b7e" />
                    <Text style={styles.chipText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Type your concern..."
              placeholderTextColor="#94a3b8"
              value={input}
              onChangeText={setInput}
              multiline
            />
            <Pressable style={[styles.sendBtn, isSending && styles.disabled]} onPress={() => handleSend()} disabled={isSending}>
              <Text style={styles.sendText}>{isSending ? '...' : 'Send'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FA' },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#D8E2F0' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#204b7e', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '800', color: '#1a2744' },
  subtitle: { fontSize: 12, color: '#22c55e', fontWeight: '700' },
  messages: { flex: 1 },
  row: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  rowUser: { alignSelf: 'flex-end' },
  rowBot: { alignSelf: 'flex-start' },
  botAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#204b7e', alignItems: 'center', justifyContent: 'center' },
  botAvatarText: { color: '#fff', fontWeight: '800' },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1 },
  botBubble: { backgroundColor: '#f8fafc', borderColor: '#D8E2F0' },
  userBubble: { backgroundColor: '#204b7e', borderColor: '#204b7e' },
  text: { color: '#1a2744', fontSize: 15, lineHeight: 20 },
  userText: { color: '#ffffff' },
  time: { marginTop: 6, fontSize: 11, color: '#64748b', textAlign: 'right' },
  userTime: { color: '#cbd5e1' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#e8f0fa', borderRadius: 14 },
  chipText: { color: '#204b7e', fontWeight: '700', fontSize: 13 },
  inputBar: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#D8E2F0' },
  input: { flex: 1, minHeight: 40, maxHeight: 140, paddingVertical: 8, color: '#1a2744' },
  sendBtn: { backgroundColor: '#204b7e', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  disabled: { opacity: 0.6 },
});
