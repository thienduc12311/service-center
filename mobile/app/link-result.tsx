import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  navigationFailureReasonSchema,
  type NavigationFailureReason,
} from '@service-center/shared';
import { Button, Card, Screen } from '../src/components/ui';
import { useAuth } from '../src/providers/AuthProvider';
import { useThemedStyles } from '../src/lib/useTheme';
import type { Theme } from '../src/lib/theme';

const MESSAGE: Record<NavigationFailureReason, string> = {
  invalid: "This link isn't a supported Service Center link.",
  'no-access': "You don't have access to the organization for this link.",
  unavailable: 'This item was deleted, is no longer available, or you cannot open it.',
  network: "We couldn't verify this link right now. Check your connection and try again.",
};

export default function LinkResultScreen() {
  const params = useLocalSearchParams<{ reason?: string | string[] }>();
  const parsed = navigationFailureReasonSchema.safeParse(params.reason);
  const reason: NavigationFailureReason = parsed.success ? parsed.data : 'invalid';
  const { session } = useAuth();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen>
      <Card style={styles.card}>
        <Text style={styles.title}>Unable to open link</Text>
        <Text style={styles.body}>{MESSAGE[reason]}</Text>
        <Button
          title={session ? 'Go to the app' : 'Go to sign in'}
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
