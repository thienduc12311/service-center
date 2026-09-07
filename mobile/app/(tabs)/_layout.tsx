import { Tabs } from 'expo-router';
import { StyleSheet, type ColorValue } from 'react-native';
import { Icon, type IconName } from '../../src/components/icons';
import { fonts } from '../../src/lib/theme';
import { useTheme } from '../../src/lib/useTheme';

/** Every tab renders its own editorial header, so the nav bar stays out of it. */
const tabIcon =
  (name: IconName) =>
  ({ color }: { color: ColorValue }) => <Icon name={name} size={22} color={color} />;

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.color.canvas },
        tabBarActiveTintColor: theme.color.ink,
        tabBarInactiveTintColor: theme.color.inkFaint,
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 10.5, letterSpacing: 0.1 },
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Schedule', tabBarIcon: tabIcon('schedule') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: tabIcon('calendar') }} />
      <Tabs.Screen name="songs" options={{ title: 'Songs', tabBarIcon: tabIcon('music') }} />
      <Tabs.Screen name="songbooks" options={{ title: 'Books', tabBarIcon: tabIcon('book') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person') }} />
    </Tabs>
  );
}
