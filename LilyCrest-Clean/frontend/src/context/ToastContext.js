import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './ThemeContext';

const ToastContext = createContext(undefined);

const TOAST_COLORS = {
  success: {
    icon: 'checkmark-circle',
    background: '#ECFDF3',
    border: '#BBF7D0',
    iconColor: '#15803D',
    titleColor: '#166534',
    messageColor: '#166534',
  },
  error: {
    icon: 'close-circle',
    background: '#FEF2F2',
    border: '#FECACA',
    iconColor: '#B91C1C',
    titleColor: '#991B1B',
    messageColor: '#991B1B',
  },
  warning: {
    icon: 'warning',
    background: '#FFF8EC',
    border: '#FFD88A',
    iconColor: '#B45309',
    titleColor: '#7a3d00',
    messageColor: '#7a3d00',
  },
  info: {
    icon: 'information-circle',
    background: '#E8F0FA',
    border: '#B8D0EC',
    iconColor: '#204b7e',
    titleColor: '#163966',
    messageColor: '#163966',
  },
};

export function ToastProvider({ children }) {
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;
  const hideTimerRef = useRef(null);

  const dismissToast = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 18,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setToast(null);
      }
    });
  }, [opacity, translateY]);

  const showToast = useCallback((options) => {
    const nextToast = typeof options === 'string'
      ? { message: options, type: 'info' }
      : {
          title: options?.title || '',
          message: options?.message || '',
          type: options?.type || 'info',
          duration: options?.duration ?? 2800,
        };

    if (!nextToast.message && !nextToast.title) return;

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    opacity.stopAnimation();
    translateY.stopAnimation();
    opacity.setValue(0);
    translateY.setValue(18);
    setToast(nextToast);
  }, [opacity, translateY]);

  useEffect(() => {
    if (!toast) return undefined;

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();

    hideTimerRef.current = setTimeout(() => {
      dismissToast();
    }, toast.duration);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [toast, dismissToast, opacity, translateY]);

  const toastConfig = useMemo(() => {
    if (!toast) return null;

    const preset = TOAST_COLORS[toast.type] || TOAST_COLORS.info;
    if (isDarkMode) {
      return {
        ...preset,
        background: colors.surface,
        border: colors.border,
        titleColor: colors.text,
        messageColor: colors.textSecondary,
      };
    }

    return preset;
  }, [colors.border, colors.surface, colors.text, colors.textSecondary, isDarkMode, toast]);

  const styles = useMemo(() => StyleSheet.create({
    overlay: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: Math.max(insets.bottom, 12) + 14,
      zIndex: 999,
      pointerEvents: 'box-none',
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        },
        android: { elevation: 8 },
        web: { boxShadow: '0 10px 30px rgba(15, 23, 42, 0.16)' },
      }),
    },
    content: {
      flex: 1,
    },
    title: {
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 2,
    },
    message: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '500',
    },
    closeButton: {
      padding: 2,
      marginTop: 1,
    },
  }), [insets.bottom]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {toast && toastConfig ? (
        <View pointerEvents="box-none" style={styles.overlay}>
          <Animated.View
            style={[
              styles.card,
              {
                backgroundColor: toastConfig.background,
                borderColor: toastConfig.border,
                opacity,
                transform: [{ translateY }],
              },
            ]}
          >
            <Ionicons name={toastConfig.icon} size={20} color={toastConfig.iconColor} />
            <Pressable style={styles.content} onPress={dismissToast}>
              {toast.title ? (
                <Text style={[styles.title, { color: toastConfig.titleColor }]}>{toast.title}</Text>
              ) : null}
              <Text style={[styles.message, { color: toastConfig.messageColor }]}>{toast.message}</Text>
            </Pressable>
            <Pressable style={styles.closeButton} onPress={dismissToast} hitSlop={10}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
