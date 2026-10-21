import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, type ColorValue } from 'react-native';
import { Icon, type IconName } from '../../src/components/icons';
import { fonts } from '../../src/lib/theme';
import { useTheme } from '../../src/lib/useTheme';

/** Tabs keep native navigation while using the website product colors. */
const tabIcon =
  (name: IconName) =>
  ({ color }: { color: ColorValue }) => <Icon name={name} size={22} color={color} />;

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation('common');
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.color.canvas },
        tabBarActiveTintColor: theme.color.brandText,
        tabBarInactiveTintColor: theme.color.inkFaint,
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontWeight: '500', fontSize: 11 },
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.color.border,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.mySchedule'), tabBarIcon: tabIcon('schedule') }} />
      <Tabs.Screen name="calendar" options={{ title: t('nav.calendar'), tabBarIcon: tabIcon('calendar') }} />
      <Tabs.Screen name="plans" options={{ title: t('nav.plans'), tabBarIcon: tabIcon('plans') }} />
      <Tabs.Screen name="songs" options={{ title: t('nav.songs'), tabBarIcon: tabIcon('music') }} />
      <Tabs.Screen name="profile" options={{ title: t('nav.settings'), tabBarIcon: tabIcon('person') }} />
    </Tabs>
  );
}
