import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, type ColorValue } from 'react-native';
import { Icon, type IconName } from '../../src/components/icons';
import { fonts } from '../../src/lib/theme';
import { useTheme } from '../../src/lib/useTheme';

/** Tabs keep native navigation while using the website product colors. */
const tabIcon =
  (name: IconName) =>
  ({ color }: { color: ColorValue }) => <Icon name={name} size={22} color={color} />;

interface TabLabelProps {
  color: ColorValue;
  children: string;
}

/**
 * Six tabs leave ~65pt per label: shrink a long one ("My schedule", Vietnamese
 * labels) to fit on one line rather than truncating it.
 */
const TabLabel = ({ color, children }: TabLabelProps) => (
  <Text
    numberOfLines={1}
    adjustsFontSizeToFit
    minimumFontScale={0.75}
    maxFontSizeMultiplier={1.3}
    style={[styles.label, { color }]}
  >
    {children}
  </Text>
);

const styles = StyleSheet.create({
  label: { fontFamily: fonts.sansMedium, fontWeight: '500', fontSize: 11, paddingHorizontal: 2 },
});

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
        tabBarLabel: ({ color, children }) => <TabLabel color={color}>{children}</TabLabel>,
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
      <Tabs.Screen name="inbox" options={{ title: t('nav.messages'), tabBarIcon: tabIcon('chat') }} />
      <Tabs.Screen name="profile" options={{ title: t('nav.settings'), tabBarIcon: tabIcon('person') }} />
    </Tabs>
  );
}
