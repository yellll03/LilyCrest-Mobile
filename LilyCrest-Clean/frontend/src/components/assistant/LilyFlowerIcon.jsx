import { Animated, Image, StyleSheet, View } from 'react-native';
import { useEffect, useRef } from 'react';

const BASE_BG = '#0A1628';

/**
 * LilyFlowerIcon — renders the Lily robot assistant avatar.
 * Props:
 *   size  — width/height in dp (default 36)
 *   pulse — breathing scale animation while Lily is thinking (default false)
 */
export default function LilyFlowerIcon({ size = 36, pulse = false }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.07, duration: 1100, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 1100, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, scale]);

  const imageScale = 1.48;
  const Container = pulse ? Animated.View : View;
  const animStyle = pulse ? { transform: [{ scale }] } : {};

  return (
    <Container style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, animStyle]}>
      {/* Tight crop keeps the assistant identifiable without extra decoration. */}
      <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
        <Image
          source={require('../../../assets/images/lily-assistant.png')}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale: imageScale }],
          }}
          resizeMode="cover"
        />
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: BASE_BG,
    overflow: 'hidden',
  },
});
