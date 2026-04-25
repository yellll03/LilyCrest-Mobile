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
import { getCredentials, hasStoredCredentials } from '../src/services/secureCredentials';

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

const NAVY = '#0D1B3E';
const ORANGE = '#D4682A';
const ORANGE_LIGHT = '#E07840';

export default function OnboardingScreen() {
  const router = useRouter();
  const { user, authStatus, loginWithEmail } = useAuth();
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
      const hasCreds = await hasStoredCredentials();
      if (!hasCreds) return;
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return;
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to LilyCrest',
        cancelLabel: 'Use Password',
        disableDeviceFallback: false,
      });
      if (!authResult.success) return;
      const creds = await getCredentials();
      if (!creds) return;
      await loginWithEmail(creds.email, creds.password, { biometricLogin: true });
    } catch (err) {
      console.warn('[AutoBiometric] Skipped:', err?.message);
    }
  }, [loginWithEmail]);

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
      const token = await AsyncStorage.getItem('session_token');
      if (token) return;

      if (!cancelled) setIsAutoBiometricLoading(true);
      await tryAutoBiometric();
      if (!cancelled) setIsAutoBiometricLoading(false);
    };

    maybeAutoLogin();

    return () => {
      cancelled = true;
    };
  }, [authStatus, tryAutoBiometric]);

  const hasRedirected = useRef(false);
  useEffect(() => {
    if (authStatus === 'authenticated' && user && !hasRedirected.current) {
      hasRedirected.current = true;
      setTimeout(() => router.replace('/(tabs)/home'), 100);
    }
  }, [authStatus, router, user]);

  const checking = authStatus === 'initializing' || isAutoBiometricLoading;

  // ── Slide render ─────────────────────────────────────────────────────────
  const renderSlide = useCallback(({ item }) => (
    <View style={styles.slide}>
      <View style={styles.slideIconWrap}>
        <Ionicons name={item.icon} size={44} color={ORANGE} />
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
      router.push('/login');
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
        <ActivityIndicator size="large" color={ORANGE} style={{ marginTop: 32 }} />
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
                  <Ionicons name={s.icon} size={22} color={activeIndex === i ? '#fff' : ORANGE} />
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
                <Ionicons name="arrow-forward" size={18} color="#fff" />
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
  brandWrap: {
    alignItems: 'center',
    gap: 12,
  },
  brandWrapCompact: {
    gap: 10,
  },
  brandBadge: {
    width: 132,
    height: 132,
    borderRadius: 36,
    backgroundColor: 'rgba(13, 27, 62, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18 },
      android: { elevation: 8 },
      web: { boxShadow: '0 12px 24px rgba(0,0,0,0.24)' },
    }),
  },
  brandBadgeCompact: {
    width: 110,
    height: 110,
    borderRadius: 30,
  },
  brandBadgeImage: {
    width: 180,
    height: 180,
    transform: [{ translateY: -24 }],
  },
  brandBadgeImageCompact: {
    width: 152,
    height: 152,
    transform: [{ translateY: -20 }],
  },
  brandTextWrap: {
    alignItems: 'center',
    gap: 4,
  },
  brandWordmark: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  brandWordmarkCompact: {
    fontSize: 24,
  },
  brandWordmarkLight: {
    color: '#FFFFFF',
  },
  brandWordmarkAccent: {
    color: ORANGE,
  },
  brandTagline: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.74)',
    letterSpacing: 2.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  brandTaglineCompact: {
    fontSize: 10,
    letterSpacing: 2.2,
  },
  logoImage: {
    width: width * 0.62,
    height: height * 0.22,
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
    backgroundColor: 'rgba(212,104,42,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(212,104,42,0.4)',
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
    borderColor: 'rgba(212,104,42,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIconBoxActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE_LIGHT,
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.5, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  featureLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  featureLabelActive: {
    color: '#FFFFFF',
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
    backgroundColor: ORANGE,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingVertical: 14,
    paddingLeft: 24,
    paddingRight: 16,
    borderRadius: 50,
    gap: 10,
    ...Platform.select({
      ios: { shadowColor: ORANGE, shadowOpacity: 0.45, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12 },
      android: { elevation: 8 },
    }),
  },
  ctaBtnText: {
    color: '#FFFFFF',
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
