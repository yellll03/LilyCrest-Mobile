import { useEffect, useRef } from 'react';
import { Animated, Modal, Platform, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useThemedStyles } from '../context/ThemeContext';

/**
 * StyledModal — premium replacement for Alert.alert
 *
 * Props:
 *  visible     - boolean
 *  onClose     - function
 *  title       - string
 *  message     - string (supports \n line breaks)
 *  icon        - Ionicons name (optional, e.g. 'checkmark-circle')
 *  iconColor   - string (optional, default uses theme accent)
 *  buttons     - [{text, onPress, style}] (optional, default is single "OK" button)
 *  type        - 'success' | 'error' | 'warning' | 'info' (optional, sets icon + color automatically)
 */
export default function StyledModal({
  visible = false,
  onClose,
  title = '',
  message = '',
  icon,
  iconColor,
  buttons,
  type,
}) {
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const { colors } = useTheme();

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 100, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  const typeConfig = {
    success: { icon: 'checkmark-circle', color: '#22C55E' },
    error: { icon: 'close-circle', color: '#EF4444' },
    warning: { icon: 'warning', color: '#F59E0B' },
    info: { icon: 'information-circle', color: '#3B82F6' },
  };

  const cfg = type ? typeConfig[type] : null;
  const resolvedIcon = icon || cfg?.icon;
  const resolvedColor = iconColor || cfg?.color;

  const actionButtons = buttons || [{ text: 'OK', onPress: onClose }];

  const styles = useThemedStyles((c, isDark) =>
    StyleSheet.create({
      overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 28,
      },
      card: {
        width: '100%',
        maxWidth: 340,
        backgroundColor: c.surface,
        borderRadius: 20,
        overflow: 'hidden',
        ...Platform.select({
          ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20 },
          android: { elevation: 12 },
        }),
      },
      accentBar: {
        height: 4,
        backgroundColor: resolvedColor || c.primary || '#204b7e',
      },
      body: {
        paddingHorizontal: 24,
        paddingTop: 28,
        paddingBottom: 8,
        alignItems: 'center',
      },
      iconWrap: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: `${resolvedColor || c.primary || '#204b7e'}18`,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
      },
      title: {
        fontSize: 18,
        fontWeight: '700',
        color: c.text,
        textAlign: 'center',
        marginBottom: 8,
      },
      message: {
        fontSize: 14,
        lineHeight: 20,
        color: c.textSecondary,
        textAlign: 'center',
        marginBottom: 20,
      },
      divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      },
      btnRow: {
        flexDirection: 'row',
      },
      btn: {
        flex: 1,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
      },
      btnDivider: {
        width: StyleSheet.hairlineWidth,
        backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      },
      btnText: {
        fontSize: 15,
        fontWeight: '600',
        color: c.primary || '#204b7e',
      },
      btnTextCancel: {
        color: c.textSecondary,
        fontWeight: '500',
      },
      btnTextDestructive: {
        color: '#EF4444',
      },
    })
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <Animated.View style={[styles.card, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
              <View style={styles.accentBar} />
              <View style={styles.body}>
                {resolvedIcon && (
                  <View style={styles.iconWrap}>
                    <Ionicons name={resolvedIcon} size={28} color={resolvedColor || colors.primary || '#204b7e'} />
                  </View>
                )}
                {title ? <Text style={styles.title}>{title}</Text> : null}
                {message ? <Text style={styles.message}>{message}</Text> : null}
              </View>
              <View style={styles.divider} />
              <View style={styles.btnRow}>
                {actionButtons.map((btn, idx) => (
                  <View key={idx} style={{ flex: 1, flexDirection: 'row' }}>
                    {idx > 0 && <View style={styles.btnDivider} />}
                    <TouchableOpacity
                      style={styles.btn}
                      onPress={() => {
                        if (btn.onPress) btn.onPress();
                        else if (onClose) onClose();
                      }}
                      activeOpacity={0.6}
                    >
                      <Text
                        style={[
                          styles.btnText,
                          btn.style === 'cancel' && styles.btnTextCancel,
                          btn.style === 'destructive' && styles.btnTextDestructive,
                        ]}
                      >
                        {btn.text}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
