import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Easing,
    ImageBackground,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { getCredentials, hasStoredCredentials } from '../src/services/secureCredentials';

const { width, height } = Dimensions.get('window');

export default function SplashScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, checkAuth, loginWithEmail } = useAuth();
  const { colors } = useTheme();
  const [checking, setChecking] = useState(true);
  const [showContent, setShowContent] = useState(false);

  // Auto-biometric: try to authenticate with stored credentials on app launch
  const tryAutoBiometric = async () => {
    try {
      const bioSetting = await AsyncStorage.getItem('biometricLogin');
      if (bioSetting !== 'true') return;

      const hasCreds = await hasStoredCredentials();
      if (!hasCreds) return;

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return;

      // Prompt biometric
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to LilyCrest',
        cancelLabel: 'Use Password',
        disableDeviceFallback: false,
      });

      if (!authResult.success) return; // User cancelled — proceed to login screen

      // Retrieve and use stored credentials
      const creds = await getCredentials();
      if (!creds) return;

      const result = await loginWithEmail(creds.email, creds.password);
      if (result.success) {
        console.log('[AutoBiometric] ✓ Signed in automatically');
        // User will be redirected by the useEffect that watches `user`
      } else {
        console.log('[AutoBiometric] Stored credentials invalid — user will see login');
      }
    } catch (err) {
      console.warn('[AutoBiometric] Skipped:', err?.message);
    }
  };
  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const buttonFade = useRef(new Animated.Value(0)).current;
  const logoRotate = useRef(new Animated.Value(0)).current;

  // Use native driver only on native platforms
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    const init = async () => {
      await checkAuth();

      // If no valid session, try auto-biometric login
      const token = await AsyncStorage.getItem('session_token');
      if (!token) {
        await tryAutoBiometric();
      }

      setChecking(false);
    };
    init();

    // Show content after a short delay for web
    setTimeout(() => setShowContent(true), 100);

    // Start animations
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver,
          easing: Easing.out(Easing.back(1.5)),
        }),
      ]),
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(buttonFade, {
          toValue: 1,
          duration: 600,
          useNativeDriver,
        }),
      ]),
    ]).start();

    // Subtle logo rotation (only on native)
    if (Platform.OS !== 'web') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(logoRotate, {
            toValue: 1,
            duration: 3000,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.sin),
          }),
          Animated.timing(logoRotate, {
            toValue: 0,
            duration: 3000,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.sin),
          }),
        ])
      ).start();
    }
  }, []);

  // Auto-redirect to home if user is already authenticated (app launch only)
  const hasRedirected = useRef(false);
  useEffect(() => {
    if (!checking && !isLoading && user && !hasRedirected.current) {
      hasRedirected.current = true;
      const timeout = setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [checking, isLoading, user]);

  if (checking || isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingLogo}>
          <View style={styles.logoIconLarge}>
            <Ionicons name="home" size={48} color="#D4682A" />
          </View>
          <Text style={styles.loadingText}>Lilycrest</Text>
        </View>
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      </View>
    );
  }

  const spin = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-5deg', '5deg'],
  });

  return (
    <ImageBackground
      source={require('../assets/images/splash-image.png')}
      style={styles.background}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        {/* Logo Section at Top */}
        <Animated.View style={[
          styles.logoSection,
          { 
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }]
          }
        ]}>
          <View style={styles.logoContainer}>
            <View style={styles.logoIcon}>
              <Ionicons name="home" size={32} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.brandName}>Lilycrest</Text>
          <Text style={styles.brandTagline}>Dormitory</Text>
        </Animated.View>

        {/* Content Section at Bottom */}
        <View style={styles.content}>
          {/* Text Section */}
          <Animated.View style={[
            styles.textContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}>
            <Text style={styles.title}>
              Find Your Perfect{"\n"}Space in the City
            </Text>
            <Text style={styles.subtitle}>
              Premium co-living spaces designed for students and young professionals. Your comfort is our priority.
            </Text>
          </Animated.View>
          
          {/* Button Section */}
          <Animated.View style={[styles.buttonContainer, { opacity: buttonFade }]}>
            <TouchableOpacity 
              style={styles.getStartedButton}
              onPress={() => router.push('/login')}
              activeOpacity={0.9}
            >
              <Text style={styles.getStartedText}>Get Started</Text>
              <View style={styles.buttonIcon}>
                <Ionicons name="arrow-forward" size={20} color="#ffffff" />
              </View>
            </TouchableOpacity>

            {/* Features */}
            <View style={styles.featuresRow}>
              <View style={styles.featureItem}>
                <Ionicons name="shield-checkmark" size={16} color="#D4682A" />
                <Text style={styles.featureText}>Secure</Text>
              </View>
              <View style={styles.featureDot} />
              <View style={styles.featureItem}>
                <Ionicons name="wifi" size={16} color="#D4682A" />
                <Text style={styles.featureText}>Connected</Text>
              </View>
              <View style={styles.featureDot} />
              <View style={styles.featureItem}>
                <Ionicons name="home" size={16} color="#D4682A" />
                <Text style={styles.featureText}>Comfortable</Text>
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    width: width,
    height: height,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 58, 95, 0.85)',
    justifyContent: 'space-between',
    paddingTop: 80,
  },
  content: {
    paddingHorizontal: 28,
    paddingBottom: 60,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoContainer: {
    marginBottom: 12,
  },
  logoIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#D4682A',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      web: {
        boxShadow: '0 8px 16px rgba(212, 148, 42, 0.4)',
      },
      default: {
        shadowColor: '#D4682A',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  brandName: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 16,
    color: '#D4682A',
    fontWeight: '500',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  textContainer: {
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 24,
  },
  buttonContainer: {
    alignItems: 'center',
  },
  getStartedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    ...Platform.select({
      web: {
        boxShadow: '0 8px 16px rgba(0, 0, 0, 0.15)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  getStartedText: {
    color: '#1E3A5F',
    fontSize: 17,
    fontWeight: '700',
    marginRight: 12,
  },
  buttonIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#D4682A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featuresRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 8,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  featureText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  featureDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingLogo: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoIconLarge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#FDF6EC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1E3A5F',
  },
  spinner: {
    marginTop: 20,
  },
});
