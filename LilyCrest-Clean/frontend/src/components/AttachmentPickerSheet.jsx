import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';

export default function AttachmentPickerSheet({
  visible,
  onClose,
  onTakePhoto,
  onChoosePhoto,
  onChooseDocument,
  disabled = false,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const select = (handler) => {
    if (disabled || !handler) return;
    onClose?.();
    handler();
  };

  const options = [
    { label: 'Take Photo', icon: 'camera-outline', onPress: onTakePhoto },
    { label: 'Choose Photo', icon: 'images-outline', onPress: onChoosePhoto },
    { label: 'Choose Document', icon: 'document-text-outline', onPress: onChooseDocument },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close attachment options"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.heading }]}>Add attachment</Text>
          {options.map((option) => (
            <Pressable
              key={option.label}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: pressed ? colors.surfaceSecondary : colors.surface },
              ]}
              onPress={() => select(option.onPress)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={option.label}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name={option.icon} size={19} color={colors.text} />
              </View>
              <Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.cancel, { borderColor: colors.border }]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.38)',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  option: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cancel: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
