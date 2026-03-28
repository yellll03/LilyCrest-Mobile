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
    // Dark theme (black forward)
    background: '#000000',
    surface: '#111111',
    surfaceSecondary: '#1A1A1A',
    text: '#F5F5F5',
    textSecondary: '#A3A3A3',
    textMuted: '#737373',
    border: '#262626',
    primary: '#D4682A',
    primaryLight: '#F0CDA8',
    accent: '#E0793A',
    success: '#22C55E',
    error: '#EF4444',
    warning: '#F59E0B',
    cardBg: '#111111',
    inputBg: '#1A1A1A',
    headerBg: '#000000',
  } : {
    // Light theme
    background: '#F5F5F5',
    surface: '#FFFFFF',
    surfaceSecondary: '#F8FAFC',
    text: '#1E3A5F',
    textSecondary: '#4B5563',
    textMuted: '#9CA3AF',
    border: '#E5E7EB',
    primary: '#D4682A',
    primaryLight: '#FDF0EC',
    accent: '#1E3A5F',
    success: '#22C55E',
    error: '#EF4444',
    warning: '#F59E0B',
    cardBg: '#FFFFFF',
    inputBg: '#F3F4F6',
    headerBg: '#1E3A5F',
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
