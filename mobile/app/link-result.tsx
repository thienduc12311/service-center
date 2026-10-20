import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  navigationFailureReasonSchema,
  type NavigationFailureReason,
} from '@service-center/shared';
import { Button, Card, Screen } from '../src/components/ui';
import { useAuth } from '../src/providers/AuthProvider';
import { useThemedStyles } from '../src/lib/useTheme';
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
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>{t('link.unableTitle')}</Text>
        <Text style={styles.body}>{t(MESSAGE_KEY[reason])}</Text>
        <Button
          title={session ? t('invite.goToApp') : t('invite.goToSignIn')}
          onPress={() => router.replace(session ? '/(tabs)' : '/(auth)/login')}
        />
      </Card>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      margin: theme.space.xl,
      marginTop: theme.space.hero,
    },
    title: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.inkMuted },
  });
