import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../src/context/ThemeContext';

function TabBarItem({ focused, iconName, focusedIconName, label, colors, styles, badgeCount = 0 }) {
  return (
    <View style={styles.tabItem}>
      <View style={[styles.iconWrapper, focused && styles.iconWrapperActive]}>
        <Ionicons
          name={focused ? focusedIconName : iconName}
          size={22}
          color={focused ? colors.primary : colors.textMuted}
        />
        {badgeCount > 0 && (
          <View style={styles.badgeDot}>
            <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Tabs
      initialRouteName="home"
      backBehavior="initialRoute"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="services"
        options={{
          title: 'Services',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              focused={focused}
              iconName="construct-outline"
              focusedIconName="construct"
              label="Services"
              colors={colors}
              styles={styles}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="announcements"
        options={{
          title: 'News',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              focused={focused}
              iconName="megaphone-outline"
              focusedIconName="megaphone"
              label="News"
              colors={colors}
              styles={styles}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              focused={focused}
              iconName="home-outline"
              focusedIconName="home"
              label="Home"
              colors={colors}
              styles={styles}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: 'Billings',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              focused={focused}
              iconName="card-outline"
              focusedIconName="card"
              label="Billings"
              colors={colors}
              styles={styles}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabBarItem
              focused={focused}
              iconName="person-outline"
              focusedIconName="person"
              label="Profile"
              colors={colors}
              styles={styles}
            />
          ),
        }}
      />
      {/* Hidden tabs - accessible via navigation but not shown in tab bar */}
      <Tabs.Screen
        name="dashboard"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="chatbot"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const createStyles = (colors) => StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    height: Platform.OS === 'ios' ? 88 : 72,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    paddingHorizontal: 8,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#0A1628',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: '0 -2px 8px rgba(10,22,40,0.08)',
      },
    }),
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    minWidth: 60,
  },
  iconWrapper: {
    width: 44,
    height: 32,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  iconWrapperActive: {
    backgroundColor: colors.primaryLight,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  badgeDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 12,
  },
});
