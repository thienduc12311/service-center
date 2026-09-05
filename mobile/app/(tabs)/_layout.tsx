import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '../../src/lib/theme';

/**
 * Text glyphs keep the scaffold icon-library-free; swap in @expo/vector-icons
 * when you settle on an icon set.
 */
const icon = (glyph: string) =>
  ({ color, size }: { color: string; size: number }) => (
    <Text style={{ color, fontSize: size - 4 }}>{glyph}</Text>
  );

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textFaint,
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTitleStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'My Schedule', tabBarIcon: icon('✓') }}
      />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="songs" options={{ title: 'Songs', tabBarIcon: icon('♪') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('☺') }} />
    </Tabs>
  );
}
