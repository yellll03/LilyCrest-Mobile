import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform } from 'react-native';

const ThemeContext = createContext(undefined);

// ── Font configuration ──
// Uses platform-native formal fonts with slightly bigger sizes
const fonts = {
  // Font families — formal, clean, professional
  family: Platform.select({
    ios: 'System',        // San Francisco (iOS system font — clean & formal)
    android: 'Roboto',     // Roboto (Android system font — clean & formal)
    web: '"Inter", "Segoe UI", "Roboto", "Helvetica Neue", sans-serif',
    default: 'System',
  }),
  familyMedium: Platform.select({
    ios: 'System',
    android: 'Roboto',
    web: '"Inter", "Segoe UI", "Roboto", "Helvetica Neue", sans-serif',
    default: 'System',
  }),
  // Font sizes — slightly bigger for mobile readability
  size: {
    xs: 12,
    sm: 13,
    base: 15,       // was ~14 default
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    heading: 32,
  },
  // Font weights
  weight: {
    regular: '400',
    medium: '500',
    semiBold: '600',
    bold: '700',
    extraBold: '800',
  },
  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.65,
  },
  // Letter spacing
  letterSpacing: {
    tight: -0.3,
    normal: 0,
    wide: 0.3,
    wider: 0.8,
    widest: 1.2,
  },
};

export function ThemeProvider({ children }) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem('darkMode');
      if (savedTheme !== null) {
        setIsDarkMode(savedTheme === 'true');
      } else {
        const systemPrefersDark = Appearance.getColorScheme() === 'dark';
        setIsDarkMode(systemPrefersDark);
      }
    } catch (error) {
      console.error('Error loading theme:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDarkMode = async () => {
    try {
      const newValue = !isDarkMode;
      setIsDarkMode(newValue);
      await AsyncStorage.setItem('darkMode', newValue.toString());
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  };

  const colors = isDarkMode ? {
    // Dark theme — near-black base, blue primary, orange accent
    background: '#0D0D0D',
    surface: '#141820',
    surfaceSecondary: '#1c2130',
    text: '#F2F2F2',
    textSecondary: '#A8B4C8',
    textMuted: '#5a6a80',
    border: 'rgba(255,255,255,0.12)',
    primary: '#4d8ec4',
    primaryLight: '#0d1f35',
    primaryHover: '#3a7ab0',
    accent: '#ff9000',
    accentLight: '#2a1e00',
    success: '#22C55E',
    error: '#EF4444',
    warning: '#F59E0B',
    info: '#4d8ec4',
    disabled: '#3a3a4a',
    cardBg: '#141820',
    inputBg: '#1c2130',
    headerBg: '#0a1220',
  } : {
    // Light theme — white surfaces, dark text, blue primary, orange accent
    background: '#F4F6FA',
    surface: '#FFFFFF',
    surfaceSecondary: '#EEF2F8',
    text: '#1a2744',
    textSecondary: '#4a5568',
    textMuted: '#8a97aa',
    border: '#D8E2F0',
    primary: '#204b7e',
    primaryLight: '#e8f0fa',
    primaryHover: '#163966',
    accent: '#ff9000',
    accentLight: '#fff3e0',
    success: '#22C55E',
    error: '#EF4444',
    warning: '#F59E0B',
    info: '#204b7e',
    disabled: '#c0cad8',
    cardBg: '#FFFFFF',
    inputBg: '#F0F4FA',
    headerBg: '#204b7e',
  };

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode, colors, fonts, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function useThemedStyles(factory) {
  const { colors, isDarkMode } = useTheme();
  return useMemo(() => factory(colors, isDarkMode), [colors, isDarkMode]);
}
