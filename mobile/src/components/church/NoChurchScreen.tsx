import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LanguageSelector } from '../../i18n';
import { queryKeys } from '../../lib/query-keys';
import { useChurchCreationPolicy } from '../../lib/useChurchApplications';
import { useAuth } from '../../providers/AuthProvider';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { Button, Card, ErrorNotice, IconWell, ListRow, Screen, ScreenHeader, SectionHeader, screenPadding } from '../ui';
import { Reveal } from '../motion';
import { ChurchApplicationFlow } from './ChurchApplicationFlow';
import { CreateChurchForm } from './CreateChurchForm';
import { DisabledChurchNotice } from './DisabledChurchNotice';

/**
 * What a signed-in person with no active church sees instead of the tabs:
 * any disabled church they belong to, the church application (and direct
 * creation while the platform still allows it), and their account actions.
 * Accepting an invitation still works through its link.
 */
export const NoChurchScreen = () => {
  const { t } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, generation, isCurrentGeneration, refreshUser, signOut } = useAuth();
  const policy = useChurchCreationPolicy();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);

  const disabled = user?.disabled_organizations ?? [];
  const selfServe = policy.data?.self_serve_allowed === true;

  /** An invitation accepted elsewhere, or an approval, shows up here. */
  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await Promise.all([
        refreshUser(),
        queryClient.invalidateQueries({ queryKey: queryKeys.churchApplications(user?.profile.id) }),
      ]);
    } catch (error) {
      if (isCurrentGeneration(generation)) setRefreshError(error);
    } finally {
      if (isCurrentGeneration(generation)) setRefreshing(false);
    }
  };

  const submitSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (error) {
      if (!isCurrentGeneration(generation)) return;
      setSignOutError(error);
      setSigningOut(false);
    }
  };

  const confirmSignOut = (): void => {
    Alert.alert(t('about.signOutTitle'), t('about.signOutMessage', { email: user?.profile.email ?? '' }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.signOut'), style: 'destructive', onPress: () => void submitSignOut() },
    ]);
  };

  return (
    <Screen safeTop>
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.content]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {disabled.length ? (
          <View style={styles.section}>
            {disabled.map((organization) => (
              <Reveal key={organization.organization_id}>
                <DisabledChurchNotice organization={organization} />
              </Reveal>
            ))}
          </View>
        ) : null}

        {disabled.length ? (
          <View style={styles.section}>
            <SectionHeader title={t('churchApplication.title')} />
            <Text style={styles.body}>{t('churchApplication.intro')}</Text>
          </View>
        ) : (
          <ScreenHeader title={t('churchApplication.title')} description={t('churchApplication.intro')} />
        )}

        <ErrorNotice error={refreshError} />

        <Reveal index={1}>
          <ChurchApplicationFlow hasChurch={false} />
        </Reveal>

        {selfServe ? (
          <Reveal index={2}>
            <View style={styles.section}>
              <SectionHeader title={t('organization.new')} />
              <Card>
                <CreateChurchForm />
              </Card>
            </View>
          </Reveal>
        ) : null}

        <Reveal index={3}>
          <View style={styles.section}>
            <SectionHeader title={t('common:language.bilingualLabel')} />
            <Card>
              <LanguageSelector />
            </Card>
          </View>
        </Reveal>

        <Reveal index={4}>
          <View style={styles.section}>
            <SectionHeader title={t('account.entry')} />
            <Card compact style={styles.rows}>
              <ListRow
                showChevron
                onPress={() => router.push('/about')}
                leading={<IconWell name="info" accent={theme.accent.neutral} size={34} />}
              >
                <Text style={styles.rowTitle}>{t('about.entry')}</Text>
                <Text style={styles.rowHint}>{t('about.entryDescription')}</Text>
              </ListRow>
              <ListRow
                divided
                showChevron
                onPress={() => router.push('/delete-account')}
                leading={<IconWell name="trash" accent={theme.accent.red} size={34} />}
              >
                <Text style={styles.rowTitle}>{t('account.deleteEntry')}</Text>
                <Text style={styles.rowHint}>{t('account.deleteEntryDescription')}</Text>
              </ListRow>
            </Card>
          </View>
        </Reveal>

        <Reveal index={5}>
          <View style={styles.section}>
            <ErrorNotice error={signOutError} />
            <Button
              title={t('common:actions.signOut')}
              icon="signOut"
              variant="danger"
              loading={signingOut}
              onPress={confirmSignOut}
            />
          </View>
        </Reveal>
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { gap: theme.space.xl },
    section: { gap: theme.space.sm },
    rows: { paddingVertical: theme.space.xs },
    body: { ...theme.type.bodySmall, color: theme.color.inkMuted, paddingHorizontal: theme.space.xs },
    rowTitle: { ...theme.type.heading, color: theme.color.ink },
    rowHint: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 1 },
  });
