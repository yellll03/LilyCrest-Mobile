import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, useEffect, useCallback } from 'react';
import {
  Dimensions,
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W * 0.72;
const CARD_H = 180;
const CARD_GAP = 10;

// ── Property photos ──
const PROPERTY_ITEMS = [
  { key: 'elevator', label: 'Lobby & Elevator', icon: 'business-outline', image: require('../../assets/images/G_F-elevator-lobby.jpg') },
  { key: 'rooftop-cafe', label: 'Rooftop Lounge', icon: 'cafe-outline', image: require('../../assets/images/RD-Lounge-Area-2.jpg') },
  { key: 'rooftop-lounge', label: 'Rooftop Area', icon: 'sunny-outline', image: require('../../assets/images/RD-Lounge-Area.jpg') },
  { key: 'lounge-common', label: 'Common Lounge', icon: 'leaf-outline', image: require('../../assets/images/Lounge-common.jpg') },
  { key: 'quad-room', label: 'Quadruple Sharing Room', icon: 'people-outline', image: require('../../assets/images/Pic-quad.jpg') },
  { key: 'double-room1', label: 'Double Sharing Room', icon: 'bed-outline', image: require('../../assets/images/Double-sharing-room1.jpg') },
  { key: 'double-room2', label: 'Double Sharing Room', icon: 'bed-outline', image: require('../../assets/images/Double-sharing-rm3.jpg') },
  { key: 'private-room', label: 'Private Room', icon: 'home-outline', image: require('../../assets/images/private-room-copy.jpg') },
  { key: 'front-desk', label: 'Security & Front Desk', icon: 'shield-checkmark-outline', image: require('../../assets/images/G_F-security-counter.jpg') },
  { key: 'seating', label: 'Ground Floor Seating', icon: 'chatbubbles-outline', image: require('../../assets/images/G_F-seating-area.jpg') },
  { key: 'bathroom', label: 'Common Restroom', icon: 'water-outline', image: require('../../assets/images/Quad-double-Common-CR.jpg') },
  { key: 'bathroom2', label: 'Shower Cubicles', icon: 'water-outline', image: require('../../assets/images/Quad-double-Common-CR2.jpg') },
];

export default function PropertyShowcase() {
  const { colors, isDarkMode } = useTheme();
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const intervalRef = useRef(null);
  const startAutoScroll = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % PROPERTY_ITEMS.length;
        scrollRef.current?.scrollTo({ x: next * (CARD_W + CARD_GAP), animated: true });
        return next;
      });
    }, 4000);
  }, []);

  useEffect(() => {
    startAutoScroll();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [startAutoScroll]);

  const handleScrollEnd = (e) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / (CARD_W + CARD_GAP));
    setActiveIndex(Math.max(0, Math.min(idx, PROPERTY_ITEMS.length - 1)));
    startAutoScroll();
  };

  const s = createStyles(colors, isDarkMode);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Ionicons name="images-outline" size={16} color={colors.primary} />
        <Text style={s.headerTitle}>Our Property</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + CARD_GAP}
        decelerationRate="fast"
        contentContainerStyle={s.scrollContent}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {PROPERTY_ITEMS.map((item) => (
          <ImageBackground
            key={item.key}
            source={item.image}
            style={s.card}
            imageStyle={s.cardImageStyle}
            resizeMode="cover"
          >
            <View style={s.labelContainer}>
              <Ionicons name={item.icon} size={13} color="rgba(255,255,255,0.85)" />
              <Text style={s.labelText}>{item.label}</Text>
            </View>
          </ImageBackground>
        ))}
      </ScrollView>

      <View style={s.dots}>
        {PROPERTY_ITEMS.map((item, idx) => (
          <View
            key={item.key}
            style={[s.dot, idx === activeIndex && s.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

function createStyles(c, isDarkMode) {
  return StyleSheet.create({
    container: { marginBottom: 8 },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 16, marginBottom: 10,
    },
    headerTitle: { fontSize: 15, fontWeight: '700', color: c.text },
    scrollContent: { paddingHorizontal: 16, gap: CARD_GAP },
    card: {
      width: CARD_W, height: CARD_H, borderRadius: 16, overflow: 'hidden',
      backgroundColor: '#1a2a3a',
      justifyContent: 'flex-end',
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8 },
        android: { elevation: 4 },
      }),
    },
    cardImageStyle: { borderRadius: 16 },
    labelContainer: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    labelText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
    dots: {
      flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
      gap: 5, marginTop: 10,
    },
    dot: {
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
    },
    dotActive: { width: 18, borderRadius: 4, backgroundColor: c.primary },
  });
}
