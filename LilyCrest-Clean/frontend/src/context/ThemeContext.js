import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform } from 'react-native';
import { DARK_COLORS, LIGHT_COLORS } from '../theme/tokens';

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

  const colors = isDarkMode ? DARK_COLORS : LIGHT_COLORS;

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
  return useMemo(() => factory(colors, isDarkMode), [colors, factory, isDarkMode]);
}
