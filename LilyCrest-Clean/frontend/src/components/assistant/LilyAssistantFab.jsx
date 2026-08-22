import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import LilyFlowerIcon from './LilyFlowerIcon';

const FAB_SIZE = 52;

export default function LilyAssistantFab() {
  const router = useRouter();
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <TouchableOpacity
      style={[styles.button, { bottom: tabBarHeight + 12 }]}
      onPress={() => router.push('/(tabs)/chatbot')}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel="Open Lily Assistant"
      accessibilityHint="Opens the Lily Assistant chat"
      hitSlop={8}
    >
      <LilyFlowerIcon size={38} imageScale={1.28} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#D4AF37',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
    ...Platform.select({
      ios: {
        shadowColor: '#0A1628',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
      web: { boxShadow: '0 3px 12px rgba(10,22,40,0.2)' },
    }),
  },
});
