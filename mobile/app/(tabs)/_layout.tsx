import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { Icon, type IconName } from '../../src/components/icons';
import { fonts } from '../../src/lib/theme';
import { useTheme } from '../../src/lib/useTheme';

/** Tabs keep native navigation while using the website product colors. */
interface TabIconProps {
  color: ColorValue;
  focused: boolean;
}

/** The active tab's glyph sits on a soft brand pill, like the website's sidebar. */
const tabIcon =
  (name: IconName) =>
  ({ color, focused }: TabIconProps) => <TabIcon name={name} color={color} focused={focused} />;

interface TabIconViewProps extends TabIconProps {
  name: IconName;
}

const TabIcon = ({ name, color, focused }: TabIconViewProps) => {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.iconPill,
        focused && { backgroundColor: theme.accent.blue.bg },
      ]}
    >
      <Icon name={name} size={22} color={color} strokeWidth={focused ? 2.1 : 1.75} />
    </View>
  );
};

interface TabLabelProps {
  color: ColorValue;
  children: string;
}

/**
 * Six tabs leave ~64pt per item, so tab labels are kept to one short word
 * (see `nav.mySchedulePhoneTab`) and share one size — a single shrunken label
 * made the bar look uneven. Shrinking stays only as a last resort for longer
 * translations. Like UIKit's own tab bar, labels barely grow with Dynamic Type.
 */
const TabLabel = ({ color, children }: TabLabelProps) => (
  <Text
    numberOfLines={1}
    adjustsFontSizeToFit
    minimumFontScale={0.85}
    maxFontSizeMultiplier={1.15}
    style={[styles.label, { color }]}
  >
    {children}
  </Text>
);

/** Keeps the outermost tabs clear of the display's rounded corners. */
const TAB_BAR_SIDE_INSET = 10;

const styles = StyleSheet.create({
  iconPill: { width: 44, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.sansMedium, fontWeight: '600', fontSize: 11, letterSpacing: 0, marginTop: 3 },
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
          paddingTop: 6,
          paddingHorizontal: TAB_BAR_SIDE_INSET,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.mySchedulePhoneTab'),
          tabBarAccessibilityLabel: t('nav.mySchedule'),
          tabBarIcon: tabIcon('schedule'),
        }}
      />
      <Tabs.Screen name="calendar" options={{ title: t('nav.calendar'), tabBarIcon: tabIcon('calendar') }} />
      <Tabs.Screen name="plans" options={{ title: t('nav.plans'), tabBarIcon: tabIcon('plans') }} />
      <Tabs.Screen name="songs" options={{ title: t('nav.songs'), tabBarIcon: tabIcon('music') }} />
      <Tabs.Screen name="inbox" options={{ title: t('nav.messages'), tabBarIcon: tabIcon('chat') }} />
      <Tabs.Screen name="profile" options={{ title: t('nav.settings'), tabBarIcon: tabIcon('person') }} />
    </Tabs>
  );
}
