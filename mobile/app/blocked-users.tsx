import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BlockedUser } from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import { useAuth } from '../src/providers/AuthProvider';
import { useFormatters } from '../src/i18n';
import { Avatar, Button, Card, Divider, EmptyState, ErrorNotice, Loading, Screen, screenPadding } from '../src/components/ui';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

interface BlockedRowProps {
  person: BlockedUser;
  busy: boolean;
  onUnblock: () => void;
}

const BlockedRow = ({ person, busy, onUnblock }: BlockedRowProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const format = useFormatters();
  const styles = useThemedStyles(makeStyles);
  const name = person.full_name ?? t('common:fallback.someone');
  return (
    <View style={styles.row}>
      <Avatar name={name} url={person.avatar_url} size={40} />
      <View style={styles.flex}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.hint}>{t('account.blockedSince', { date: format.date(person.blocked_at) })}</Text>
      </View>
      <Button title={t('account.unblock')} variant="secondary" loading={busy} disabled={busy} onPress={onUnblock} />
    </View>
  );
};

/** The people this account blocked (App Store Review Guideline 1.2), with unblock. */
export default function BlockedUsersScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();
  const { user, queryScope, generation, isCurrentGeneration } = useAuth();
  const userId = user?.profile.id;

  const blocked = useQuery({
    queryKey: queryKeys.blockedUsers(userId),
    queryFn: () => api.blockedUsers(),
    enabled: Boolean(userId),
  });

  const unblock = useMutation({
    mutationFn: (blockedId: string) => api.unblockUser(blockedId),
    onSettled: () => {
      if (!isCurrentGeneration(generation)) return;
      // Their messages and comments come back everywhere.
      void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.privateRoot(queryScope) });
    },
  });

  const people = blocked.data ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.gap]}>
        <Text style={styles.body}>{t('account.blockedDescription')}</Text>
        {blocked.isLoading ? <Loading /> : null}
        <ErrorNotice error={blocked.error ?? unblock.error} />
        {blocked.isSuccess && people.length === 0 ? (
          <EmptyState icon="people" title={t('account.blockedScreenTitle')} description={t('account.blockedEmpty')} />
        ) : null}
        {people.length ? (
          <Card>
            {people.map((person, index) => (
              <View key={person.user_id}>
                {index > 0 ? <Divider /> : null}
                <BlockedRow
                  person={person}
                  busy={unblock.isPending && unblock.variables === person.user_id}
                  onUnblock={() => unblock.mutate(person.user_id)}
                />
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.sm },
    flex: { flex: 1, gap: 2 },
    name: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
  });
