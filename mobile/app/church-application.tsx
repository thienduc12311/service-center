import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { ChurchApplicationFlow } from '../src/components/church/ChurchApplicationFlow';
import { Screen, screenPadding } from '../src/components/ui';
import { useAuth } from '../src/providers/AuthProvider';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

/** Profile's "Register another church": the application for someone already in a church. */
export default function ChurchApplicationScreen() {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { organizationId } = useAuth();
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.intro}>{t('churchApplication.intro')}</Text>
        <ChurchApplicationFlow hasChurch={Boolean(organizationId)} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    intro: { ...theme.type.body, color: theme.color.inkMuted },
  });
