import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '../../src/lib/theme';
import { useColorScheme } from 'nativewind';

/**
 * Text glyphs keep the scaffold icon-library-free; swap in @expo/vector-icons
 * when you settle on an icon set.
 */
const icon = (glyph: string) =>
  ({ color, size }: { color: string; size: number }) => (
    <Text style={{ color, fontSize: size - 4 }}>{glyph}</Text>
  );

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textFaint,
        headerStyle: { backgroundColor: dark ? '#0f172a' : theme.colors.surface },
        headerTintColor: dark ? '#f8fafc' : theme.colors.text,
        headerTitleStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: dark ? '#020617' : theme.colors.background },
        tabBarStyle: { backgroundColor: dark ? '#0f172a' : '#ffffff', borderTopColor: dark ? '#1e293b' : '#e2e8f0' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'My Schedule', tabBarIcon: icon('✓') }}
      />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="songs" options={{ title: 'Songs', tabBarIcon: icon('♪') }} />
      <Tabs.Screen name="songbooks" options={{ title: 'Books', tabBarIcon: icon('♫') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('☺') }} />
    </Tabs>
  );
}
