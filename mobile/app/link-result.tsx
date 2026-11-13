import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  navigationFailureReasonSchema,
  type NavigationFailureReason,
} from '@service-center/shared';
import { Button, Card, IconWell, Screen } from '../src/components/ui';
import { useAuth } from '../src/providers/AuthProvider';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';
import type { Theme } from '../src/lib/theme';

const MESSAGE_KEY = {
  invalid: 'link.reasons.invalid',
  'no-access': 'link.reasons.noAccess',
  unavailable: 'link.reasons.unavailable',
  network: 'link.reasons.network',
} as const satisfies Record<NavigationFailureReason, string>;

export default function LinkResultScreen() {
  const params = useLocalSearchParams<{ reason?: string | string[] }>();
  const parsed = navigationFailureReasonSchema.safeParse(params.reason);
  const reason: NavigationFailureReason = parsed.success ? parsed.data : 'invalid';
  const { t } = useTranslation('auth');
  const { session } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen>
      <Card style={styles.card}>
        <IconWell name="alert" accent={theme.accent.yellow} size={52} />
        <Text accessibilityRole="header" style={styles.title}>{t('link.unableTitle')}</Text>
        <Text style={styles.body}>{t(MESSAGE_KEY[reason])}</Text>
        <Button
          title={session ? t('invite.goToApp') : t('invite.goToSignIn')}
          onPress={() => router.replace(session ? '/(tabs)' : '/(auth)/login')}
          style={styles.action}
        />
      </Card>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      margin: theme.space.lg,
      marginTop: theme.space.hero,
      alignItems: 'center',
      paddingVertical: theme.space.xl,
    },
    title: { ...theme.type.title, color: theme.color.ink, textAlign: 'center' },
    body: { ...theme.type.body, color: theme.color.inkMuted, textAlign: 'center' },
    action: { alignSelf: 'stretch' },
  });
