import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  ImageBackground,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../src/context/AuthContext';
import { clearCredentials, getSessionToken, hasStoredCredentials } from '../src/services/secureCredentials';

const { width, height } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    icon: 'home-outline',
    label: 'Smart Living',
    title: 'Smart Living',
    description:
      'Experience modern dormitory life with seamless digital solutions designed for your comfort and convenience.',
  },
  {
    id: '2',
    icon: 'shield-checkmark-outline',
    label: 'Secure Stay',
    title: 'Secure Stay',
    description:
      'Your safety is our top priority. Verified tenants, secure access, and real-time communication with admin.',
  },
  {
    id: '3',
    icon: 'bar-chart-outline',
    label: 'Easy Management',
    title: 'Easy Management',
    description:
      'Pay bills, file maintenance requests, and manage your entire stay — all from the palm of your hand.',
  },
];

const NAVY = '#0A1628';
const ACCENT = '#D4AF37';
const ACCENT_LIGHT = '#B9921F';

export default function OnboardingScreen() {
  const router = useRouter();
  const { authStatus, checkAuth } = useAuth();
  const [isAutoBiometricLoading, setIsAutoBiometricLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideUpAnim = useRef(new Animated.Value(40)).current;

  // ── Auth check + auto biometric ──────────────────────────────────────────
  const tryAutoBiometric = useCallback(async () => {
    try {
      const bioSetting = await AsyncStorage.getItem('biometricLogin');
      if (bioSetting !== 'true') return;
      const hasBiometricSession = await hasStoredCredentials();
      if (!hasBiometricSession) return;
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return;
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to LilyCrest',
        cancelLabel: 'Use Password',
        disableDeviceFallback: false,
      });
      if (!authResult.success) return;
      const restored = await checkAuth();
      if (!restored?.authenticated || restored?.restoredFromCache) {
        await clearCredentials({ disableBiometric: false });
      }
    } catch (err) {
      console.warn('[AutoBiometric] Skipped:', err?.message);
    }
  }, [checkAuth]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(slideUpAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideUpAnim]);

  const hasAttemptedAutoBiometric = useRef(false);
  useEffect(() => {
    if (authStatus !== 'unauthenticated' || hasAttemptedAutoBiometric.current) return undefined;

    let cancelled = false;

    const maybeAutoLogin = async () => {
      hasAttemptedAutoBiometric.current = true;
      const token = await getSessionToken();
      if (!token) return;

      if (!cancelled) setIsAutoBiometricLoading(true);
      await tryAutoBiometric();
      if (!cancelled) setIsAutoBiometricLoading(false);
    };

    maybeAutoLogin();

    return () => {
      cancelled = true;
    };
  }, [authStatus, tryAutoBiometric]);

  const checking = authStatus === 'initializing' || isAutoBiometricLoading;

  // ── Slide render ─────────────────────────────────────────────────────────
  const renderSlide = useCallback(({ item }) => (
    <View style={styles.slide}>
      <View style={styles.slideIconWrap}>
        <Ionicons name={item.icon} size={44} color={ACCENT} />
      </View>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideDesc}>{item.description}</Text>
    </View>
  ), []);

  const handleScroll = useCallback((e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex(idx);
  }, []);

  const goNext = useCallback(() => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      router.replace('/login');
    }
  }, [activeIndex, router]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (checking) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor={NAVY} />
        <Image
          source={require('../assets/images/lilycrest-wordmark.png')}
          style={styles.loadingLogo}
          resizeMode="contain"
          accessibilityLabel="LilyCrest logo"
        />
        <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <ImageBackground
      source={require('../assets/images/RD-Lounge-Area.jpg')}
      style={styles.bg}
      resizeMode="cover"
    >
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Dark overlay */}
      <View style={styles.overlay} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Animated.View style={[styles.inner, { opacity: fadeAnim, transform: [{ translateY: slideUpAnim }] }]}>

          {/* ── Logo section ─────────────────────────────────────────── */}
          <View style={styles.logoSection}>
            <Image
              source={require('../assets/images/lilycrest-wordmark.png')}
              style={styles.onboardingLogo}
              resizeMode="contain"
              accessibilityLabel="LilyCrest logo"
            />
          </View>

          {/* ── Slide carousel ───────────────────────────────────────── */}
          <View style={styles.carouselSection}>
            <FlatList
              ref={flatListRef}
              data={SLIDES}
              renderItem={renderSlide}
              keyExtractor={(item) => item.id}
              initialNumToRender={1}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleScroll}
              bounces={false}
              removeClippedSubviews
            />
          </View>

          {/* ── Feature icons row ─────────────────────────────────────── */}
          <View style={styles.featuresRow}>
            {SLIDES.map((s, i) => (
              <View key={s.id} style={styles.featureItem}>
                <View style={[styles.featureIconBox, activeIndex === i && styles.featureIconBoxActive]}>
                  <Ionicons name={s.icon} size={22} color={activeIndex === i ? NAVY : ACCENT} />
                </View>
                <Text style={[styles.featureLabel, activeIndex === i && styles.featureLabelActive]}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>

          {/* ── Divider ───────────────────────────────────────────────── */}
          <View style={styles.divider} />

          {/* ── Pagination dots + CTA ─────────────────────────────────── */}
          <View style={styles.footer}>
            <View style={styles.dots}>
              {SLIDES.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.dot, activeIndex === i && styles.dotActive]}
                  onPress={() => flatListRef.current?.scrollToIndex({ index: i, animated: true })}
                />
              ))}
            </View>

            <TouchableOpacity style={styles.ctaBtn} onPress={goNext} activeOpacity={0.85}>
              <Text style={styles.ctaBtnText}>
                {activeIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
              </Text>
              <View style={styles.ctaArrow}>
                <Ionicons name="arrow-forward" size={18} color={NAVY} />
              </View>
            </TouchableOpacity>
          </View>

        </Animated.View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  // ── Loading ──
  loadingScreen: {
    flex: 1,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogo: {
    width: 212,
    height: 168,
  },

  // ── Main layout ──
  bg: {
    flex: 1,
    width,
    height,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 18, 40, 0.82)',
  },
  safe: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 8 : 0,
  },

  // ── Logo ──
  logoSection: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 8,
  },
  onboardingLogo: {
    width: 144,
    height: 112,
  },
  // ── Carousel ──
  carouselSection: {
    flex: 1,
    marginBottom: 8,
  },
  slide: {
    width: width - 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 16,
  },
  slideIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(212,175,55,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(212,175,55,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  slideDesc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    lineHeight: 23,
    paddingHorizontal: 8,
  },

  // ── Feature icons row ──
  featuresRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  featureItem: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  featureIconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(212,175,55,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIconBoxActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT_LIGHT,
  },
  featureLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  featureLabelActive: {
    color: ACCENT_LIGHT,
    fontWeight: '700',
  },

  // ── Divider ──
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 20,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    width: 24,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 14,
    paddingLeft: 24,
    paddingRight: 16,
    borderRadius: 8,
    gap: 10,
  },
  ctaBtnText: {
    color: NAVY,
    fontSize: 16,
    fontWeight: '700',
  },
  ctaArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
