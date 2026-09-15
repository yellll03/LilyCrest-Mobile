import { usePathname, useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import StyledModal from '../components/StyledModal';
import { MOBILE_GUIDE_STEPS } from '../config/mobileGuide';
import { apiService } from '../services/api';
import { resetToHome } from '../utils/navigation';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';

const GuideContext = createContext({ replay: () => {} });
export const useMobileGuide = () => useContext(GuideContext);

export function MobileGuideProvider({ children }) {
  const { user, authReady, authStatus, updateUser } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const isHome = pathname === '/home' || (pathname === '/' && segments.includes('(tabs)') && segments.includes('home'));

  // `tenantOnboardingSeen` is server-authoritative (see backend/utils/normalizeUser.js);
  // it only exists on `user` once AuthContext has loaded the account's canonical
  // profile, and authStatus only becomes 'authenticated' at that point — so this
  // can never decide to show the guide before the account's real onboarding
  // state is known, and never from device storage alone.
  const ready = authReady && authStatus === 'authenticated' && Boolean(user?.user_id);
  const account = ready ? user.user_id : null;
  const neverSeen = ready && user.tenantOnboardingSeen === false;

  const [owner, setOwner] = useState(null);
  const [index, setIndex] = useState(null);
  const [pendingFirst, setPendingFirst] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const accountRef = useRef(account);
  accountRef.current = account;

  const visible = Boolean(account && owner === account && index !== null);

  useEffect(() => {
    generation.current += 1;
    setOwner(account);
    setIndex(null);
    setError('');
    setSaving(false);
    setPendingFirst(Boolean(account) && neverSeen);
  }, [account, neverSeen]);

  // Wait for authenticated Home, preserving notification deep links.
  useEffect(() => {
    if (pendingFirst && account && owner === account && isHome) {
      setPendingFirst(false);
      setIndex(0);
    }
  }, [pendingFirst, account, owner, isHome]);

  const replay = useCallback(() => {
    if (!account) return;
    generation.current += 1; // An in-flight save must not reopen or reset after this.
    setSaving(false);
    setOwner(account);
    setIndex(0);
    setError('');
    setPendingFirst(false);
    resetToHome(router);
  }, [account, router]);

  const move = (next) => {
    setIndex(next);
    setError('');
    router.replace(MOBILE_GUIDE_STEPS[next].route);
    AccessibilityInfo.announceForAccessibility(`${next + 1} of ${MOBILE_GUIDE_STEPS.length}. ${MOBILE_GUIDE_STEPS[next].title}`);
  };

  const finish = async () => {
    if (!account || saving) return;
    const token = ++generation.current;
    setPendingFirst(false);
    setSaving(true);
    setError('');
    try {
      const response = await apiService.markTenantGuideSeen();
      // A different account may have signed in while this request was in
      // flight — only the account that asked for this write may apply it.
      if (accountRef.current !== account) return;
      updateUser(response.data);
      if (token === generation.current) {
        setIndex(null);
        resetToHome(router);
      }
    } catch (_error) {
      if (token === generation.current) {
        setError('Could not save your guide preference. Please try again.');
      }
    } finally {
      if (token === generation.current) setSaving(false);
    }
  };

  const stepIndex = index ?? 0;
  const step = MOBILE_GUIDE_STEPS[stepIndex];
  const isLast = stepIndex === MOBILE_GUIDE_STEPS.length - 1;

  const buttons = [
    { text: 'Skip', style: 'cancel', onPress: finish, disabled: saving },
    ...(stepIndex > 0 ? [{ text: 'Back', onPress: () => move(stepIndex - 1), disabled: saving }] : []),
    { text: isLast ? 'Finish' : 'Next', onPress: isLast ? finish : () => move(stepIndex + 1), disabled: saving },
  ];

  return (
    <GuideContext.Provider value={{ replay }}>
      {children}
      <StyledModal
        visible={visible}
        onClose={() => {
          if (saving) return;
          if (stepIndex > 0) move(stepIndex - 1);
          else finish();
        }}
        title={step.title}
        message={step.body}
        icon={step.icon}
        iconColor={colors.accentHover}
        buttons={buttons}
      >
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 10 }}>
            Step {stepIndex + 1} of {MOBILE_GUIDE_STEPS.length}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {MOBILE_GUIDE_STEPS.map((guideStep, i) => (
              <View
                key={guideStep.title}
                style={{
                  width: i === stepIndex ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i === stepIndex ? colors.accent : colors.border,
                }}
              />
            ))}
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.errorText, fontSize: 12, marginTop: 10, textAlign: 'center' }}>
              {error}
            </Text>
          ) : null}
        </View>
      </StyledModal>
    </GuideContext.Provider>
  );
}
