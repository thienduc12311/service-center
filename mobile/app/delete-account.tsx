import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AccountDeletionOrganization } from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import { useAuth } from '../src/providers/AuthProvider';
import { Button, Card, ErrorNotice, Field, Loading, Screen, SectionHeader, screenPadding } from '../src/components/ui';
import { Icon } from '../src/components/icons';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

interface OrganizationListProps {
  organizations: readonly AccountDeletionOrganization[];
}

const OrganizationList = ({ organizations }: OrganizationListProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.list}>
      {organizations.map((org) => (
        <Text key={org.organization_id} style={styles.listItem}>• {org.organization_name}</Text>
      ))}
    </View>
  );
};

/**
 * In-app account deletion (App Store Review Guideline 5.1.1(v)). Shows what
 * is deleted, refuses while an organization would be left without an owner,
 * asks for a typed confirmation and an alert, then signs out.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user, signOut } = useAuth();
  const userId = user?.profile.id;
  const [typed, setTyped] = useState('');

  const plan = useQuery({
    queryKey: queryKeys.accountDeletionPlan(userId),
    queryFn: () => api.accountDeletionPlan(),
    enabled: Boolean(userId),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      // The login no longer exists; clear this device and return to sign-in.
      try {
        await signOut();
      } finally {
        Alert.alert(t('account.deleteDoneTitle'), t('account.deleteDoneMessage'));
      }
    },
    // A refusal can mean someone joined an organization since the plan was read.
    onError: () => void plan.refetch(),
  });

  const confirmWord = t('account.deleteConfirmWord');
  const confirmed = typed.trim().toUpperCase() === confirmWord.toUpperCase();
  const blocked = plan.data?.organizations.filter((org) => org.outcome === 'blocked') ?? [];
  const deleted = plan.data?.organizations.filter((org) => org.outcome === 'deleted') ?? [];

  const confirmDelete = (): void => {
    Alert.alert(t('account.deleteAlertTitle'), t('account.deleteAlertMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('account.deleteButton'), style: 'destructive', onPress: () => remove.mutate() },
    ]);
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Card>
          <View style={styles.heading}>
            <Icon name="alert" size={22} color={theme.color.danger} />
            <Text accessibilityRole="header" style={styles.title}>{t('account.deleteScreenTitle')}</Text>
          </View>
          <Text style={styles.body}>{t('account.deleteIntro', { email: user?.profile.email ?? '' })}</Text>
        </Card>

        <View style={styles.section}>
          <SectionHeader title={t('account.deleteWhatHappens')} />
          <Card>
            <Text style={styles.body}>• {t('account.deleteItemProfile')}</Text>
            <Text style={styles.body}>• {t('account.deleteItemActivity')}</Text>
            <Text style={styles.body}>• {t('account.deleteItemMemberships')}</Text>
          </Card>
        </View>

        {plan.isLoading ? <Loading /> : null}
        <ErrorNotice error={plan.error} />

        {deleted.length ? (
          <View style={styles.section}>
            <SectionHeader title={t('account.deleteOrganizationsTitle')} />
            <Card>
              <Text style={styles.body}>{t('account.deleteOrganizationsDescription')}</Text>
              <OrganizationList organizations={deleted} />
            </Card>
          </View>
        ) : null}

        {blocked.length ? (
          <View style={styles.section}>
            <SectionHeader title={t('account.deleteBlockedTitle')} />
            <Card>
              <Text style={styles.body}>{t('account.deleteBlockedDescription')}</Text>
              <OrganizationList organizations={blocked} />
            </Card>
          </View>
        ) : null}

        {plan.data?.can_delete ? (
          <Card>
            <Field
              label={t('account.deleteConfirmLabel')}
              value={typed}
              onChangeText={setTyped}
              placeholder={confirmWord}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={t('account.deleteConfirmLabel')}
            />
            <ErrorNotice error={remove.error} />
            <Button
              title={t('account.deleteButton')}
              icon="trash"
              variant="danger"
              loading={remove.isPending}
              disabled={!confirmed || remove.isPending}
              onPress={confirmDelete}
            />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.lg },
    section: { gap: theme.space.sm },
    heading: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    title: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    body: { ...theme.type.body, color: theme.color.inkMuted },
    list: { gap: theme.space.xs },
    listItem: { ...theme.type.body, color: theme.color.ink },
  });
