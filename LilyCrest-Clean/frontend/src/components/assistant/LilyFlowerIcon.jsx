import { Animated, StyleSheet, View } from 'react-native';
import { useEffect, useRef } from 'react';

/**
 * LilyFlowerIcon — brand-aligned icon inspired by the LilyCrest logo.
 *
 * Recreates the diamond/geometric motif from the logo using pure Views:
 * a rotated square (diamond) with inner cross lines on a navy background,
 * matching the brand palette (navy #1E3A5F + golden amber #D4682A).
 *
 * Props:
 *   size  — overall width/height (default 36)
 *   glow  — render outer glow ring (default true)
 *   pulse — subtle breathing animation (default false)
 */

// Brand palette extracted from logo
const BRAND = {
  navy: '#1E3A5F',
  navyDark: '#14365A',
  gold: '#D4682A',
  goldLight: '#E0793A',
  goldBright: '#F5C35A',
};

export default function LilyFlowerIcon({ size = 36, glow = true, pulse = false }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 1200, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, scale]);

  const diamondSize = size * 0.52;
  const innerSize = diamondSize * 0.7;
  const glowRing = size * 1.3;
  const borderW = Math.max(1.5, size * 0.04);

  const Container = pulse ? Animated.View : View;
  const containerStyle = pulse ? { transform: [{ scale }] } : {};

  return (
    <Container style={[styles.container, { width: size, height: size }, containerStyle]}>
      {/* Soft outer glow */}
      {glow && (
        <View style={[styles.glow, { width: glowRing, height: glowRing, borderRadius: glowRing / 2 }]} />
      )}

      {/* Dark circular background */}
      <View style={[styles.background, { width: size, height: size, borderRadius: size / 2 }]}>
        {/* Outer diamond (rotated square) */}
        <View style={[styles.diamond, {
          width: diamondSize,
          height: diamondSize,
          borderWidth: borderW,
          borderRadius: diamondSize * 0.08,
          transform: [{ rotate: '45deg' }],
        }]}>
          {/* Inner diamond */}
          <View style={[styles.innerDiamond, {
            width: innerSize,
            height: innerSize,
            borderWidth: borderW * 0.8,
            borderRadius: innerSize * 0.06,
          }]} />
          {/* Horizontal line */}
          <View style={[styles.crossLine, styles.crossH, { height: borderW * 0.8 }]} />
          {/* Vertical line */}
          <View style={[styles.crossLine, styles.crossV, { width: borderW * 0.8 }]} />
        </View>
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: BRAND.gold,
    opacity: 0.12,
  },
  background: {
    position: 'absolute',
    backgroundColor: BRAND.navyDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BRAND.gold,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 6,
  },
  diamond: {
    position: 'absolute',
    borderColor: BRAND.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDiamond: {
    position: 'absolute',
    borderColor: BRAND.gold,
  },
  crossLine: {
    position: 'absolute',
    backgroundColor: BRAND.gold,
    opacity: 0.7,
  },
  crossH: {
    left: '10%',
    right: '10%',
  },
  crossV: {
    top: '10%',
    bottom: '10%',
  },
});
