import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MOBILE_GUIDE_STEPS, mobileGuideKey } from '../config/mobileGuide';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { resetToHome } from '../utils/navigation';

const GuideContext = createContext({ replay: () => {} });
export const useMobileGuide = () => useContext(GuideContext);
export function MobileGuideProvider({ children }) {
  const { user, authReady, authStatus } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const isHome = pathname === '/home' || (pathname === '/' && segments.includes('(tabs)') && segments.includes('home'));
  const account = authReady && authStatus === 'authenticated' ? user?.user_id || user?._id : null;
  const [owner, setOwner] = useState(null);
  const [index, setIndex] = useState(null);
  const [pendingFirst, setPendingFirst] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const saveGuard = useRef(null);
  const accountRef = useRef(account);
  accountRef.current = account;
  const visible = Boolean(account && owner === account && index !== null);
  useEffect(() => {
    const token = ++generation.current;
    setIndex(null); setOwner(account); setPendingFirst(false); setError('');
    saveGuard.current = null; setSaving(false);
    if (account) AsyncStorage.getItem(mobileGuideKey(account)).then((done) => {
      if (token === generation.current) setPendingFirst(!done);
    }).catch(() => { if (token === generation.current) setPendingFirst(true); });
    return () => { generation.current += 1; };
  }, [account]);
  // Wait for authenticated Home, preserving notification deep links.
  useEffect(() => {
    if (pendingFirst && account && owner === account && isHome) {
      setPendingFirst(false); setIndex(0);
    }
  }, [pendingFirst, account, owner, isHome]);
  const replay = useCallback(() => {
    if (!account) return;
    generation.current += 1; // A late initial storage read must not restart replay.
    saveGuard.current = null; setSaving(false);
    setOwner(account); setIndex(0); setError(''); setPendingFirst(false);
    resetToHome(router);
  }, [account, router]);
  const move = (next) => {
    setIndex(next); setError('');
    router.replace(MOBILE_GUIDE_STEPS[next].route);
    AccessibilityInfo.announceForAccessibility(`${next + 1} of ${MOBILE_GUIDE_STEPS.length}. ${MOBILE_GUIDE_STEPS[next].title}`);
  };
  const finish = async () => {
    if (!account || accountRef.current !== account || saveGuard.current !== null) return;
    const token = ++generation.current;
    setPendingFirst(false);
    saveGuard.current = token; setSaving(true); setError('');
    try {
      await AsyncStorage.setItem(mobileGuideKey(account), 'completed');
      if (token === generation.current && accountRef.current === account) { setIndex(null); resetToHome(router); }
    } catch (_) { if (token === generation.current) setError('Could not save your guide preference. Please try again.'); }
    finally { if (saveGuard.current === token) { saveGuard.current = null; setSaving(false); } }
  };
  const button = (label, onPress) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: saving }} disabled={saving} onPress={onPress} style={{ minHeight: 48, minWidth: 64, padding: 14, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border }}><Text style={{ color: colors.interactive, fontSize: 16 }}>{label}</Text></Pressable>;
  const step = MOBILE_GUIDE_STEPS[index ?? 0];
  return <GuideContext.Provider value={{ replay }}>{children}
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => { if (!saving) { if (index > 0) move(index - 1); else finish(); } }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', padding: 16 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20, maxHeight: '90%', width: '100%', maxWidth: 600, alignSelf: 'center' }}>
          <ScrollView>
            <Text style={{ color: colors.textMuted, fontSize: 14 }}>App Guide · {(index ?? 0) + 1} of {MOBILE_GUIDE_STEPS.length}</Text>
            <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 23, fontWeight: '700', marginVertical: 12 }}>{step.title}</Text>
            <Text style={{ color: colors.text, fontSize: 17, marginBottom: 20 }}>{step.body}</Text>
            {error ? <Text accessibilityRole="alert" style={{ color: colors.errorText }}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {button('Skip', finish)}
              {index > 0 ? button('Back', () => move(index - 1)) : null}
              {index === MOBILE_GUIDE_STEPS.length - 1 ? button('Finish', finish) : button('Next', () => move(index + 1))}
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </GuideContext.Provider>;
}
