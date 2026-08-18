import { Image, Platform, StyleSheet, Text, View } from 'react-native';

const ACCENT = '#D4AF37';
const PRIMARY_TEXT = '#0A1628';

export default function BrandHeader({
  compact = false,
  showWordmark = true,
  showTagline = true,
  theme = 'dark',
  style,
}) {
  const isLightTheme = theme === 'light';

  return (
    <View
      style={[
        styles.wrap,
        compact && styles.wrapCompact,
        !showWordmark && styles.wrapBadgeOnly,
        style,
      ]}
    >
      <View style={[styles.badge, compact && styles.badgeCompact]}>
        <Image
          source={require('../../assets/images/logo-main.png')}
          style={[styles.badgeImage, compact && styles.badgeImageCompact]}
          resizeMode="cover"
          accessibilityLabel="LilyCrest logo"
        />
      </View>

      {showWordmark ? (
        <View style={styles.textWrap}>
          <Text style={[styles.wordmark, compact && styles.wordmarkCompact]}>
            <Text style={isLightTheme ? styles.wordmarkLightOnLight : styles.wordmarkLightOnDark}>
              Lily
            </Text>
            <Text style={styles.wordmarkAccent}>Crest</Text>
          </Text>

          {showTagline ? (
            <Text
              style={[
                styles.tagline,
                compact && styles.taglineCompact,
                isLightTheme ? styles.taglineLightTheme : styles.taglineDarkTheme,
              ]}
            >
              Dormitory Management App
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 12,
  },
  wrapCompact: {
    gap: 10,
  },
  wrapBadgeOnly: {
    gap: 0,
  },
  badge: {
    width: 132,
    height: 132,
    borderRadius: 12,
    backgroundColor: '#0A1628',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowOffset: { width: 0, height: 3 },
        shadowRadius: 6,
      },
      android: { elevation: 3 },
      web: { boxShadow: '0 3px 10px rgba(0,0,0,0.18)' },
    }),
  },
  badgeCompact: {
    width: 110,
    height: 110,
    borderRadius: 12,
  },
  badgeImage: {
    width: 180,
    height: 180,
    transform: [{ translateY: -24 }],
  },
  badgeImageCompact: {
    width: 152,
    height: 152,
    transform: [{ translateY: -20 }],
  },
  textWrap: {
    alignItems: 'center',
    gap: 4,
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  wordmarkCompact: {
    fontSize: 24,
  },
  wordmarkLightOnDark: {
    color: '#FFFFFF',
  },
  wordmarkLightOnLight: {
    color: PRIMARY_TEXT,
  },
  wordmarkAccent: {
    color: ACCENT,
  },
  tagline: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  taglineCompact: {
    fontSize: 10,
    letterSpacing: 2.2,
  },
  taglineDarkTheme: {
    color: 'rgba(255,255,255,0.74)',
  },
  taglineLightTheme: {
    color: '#4B5563',
  },
});
