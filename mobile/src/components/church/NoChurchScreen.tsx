import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { suggestedWelcomeChoice, type WelcomeChoice } from '@service-center/shared';
import { LanguageSelector } from '../../i18n';
import { queryKeys } from '../../lib/query-keys';
import { useChurchCreationPolicy, useMyChurchApplications } from '../../lib/useChurchApplications';
import { useMyChurchJoinRequests } from '../../lib/useChurchJoinRequests';
import { useAuth } from '../../providers/AuthProvider';
import type { Accent, Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { Button, Card, ErrorNotice, IconWell, ListRow, Screen, ScreenHeader, SectionHeader, screenPadding } from '../ui';
import { PressableScale, Reveal } from '../motion';
import { Icon, type IconName } from '../icons';
import { ChurchApplicationFlow } from './ChurchApplicationFlow';
import { ChurchJoinFlow } from './ChurchJoinFlow';
import { CreateChurchForm } from './CreateChurchForm';
import { DisabledChurchNotice } from './DisabledChurchNotice';

/**
 * What a signed-in person with no active church sees instead of the tabs:
 * any disabled church they belong to, then two choices: join a church that
 * already uses Service Center (a request its owner approves with an
 * invitation) or register a new one (the church application, and direct
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
  const joinRequests = useMyChurchJoinRequests();
  const applications = useMyChurchApplications();
  const [picked, setPicked] = useState<WelcomeChoice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown>(null);

  const disabled = user?.disabled_organizations ?? [];
  const selfServe = policy.data?.self_serve_allowed === true;
  // Open whichever choice already has a request to show, until the person picks.
  const choice = picked ?? suggestedWelcomeChoice(joinRequests.data ?? [], applications.data ?? []);

  /** An invitation accepted elsewhere, or an approval, shows up here. */
  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await Promise.all([
        refreshUser(),
        queryClient.invalidateQueries({ queryKey: queryKeys.churchApplications(user?.profile.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.churchJoinRequests(user?.profile.id) }),
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
            <SectionHeader title={t('churchJoin.choice.title')} />
            <Text style={styles.body}>{t('churchJoin.choice.intro')}</Text>
          </View>
        ) : (
          <ScreenHeader title={t('churchJoin.choice.title')} description={t('churchJoin.choice.intro')} />
        )}

        <ErrorNotice error={refreshError} />

        <Reveal index={1}>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('churchJoin.choice.label')} style={styles.choices}>
            <WelcomeChoiceRow
              icon="people"
              accent={theme.accent.blue}
              title={t('churchJoin.choice.join')}
              description={t('churchJoin.choice.joinDescription')}
              selected={choice === 'join'}
              onPress={() => setPicked('join')}
            />
            <WelcomeChoiceRow
              icon="plus"
              accent={theme.accent.green}
              title={t('churchJoin.choice.register')}
              description={
                selfServe ? t('churchJoin.choice.createDescription') : t('churchJoin.choice.registerDescription')
              }
              selected={choice === 'register'}
              onPress={() => setPicked('register')}
            />
          </View>
        </Reveal>

        {choice === 'join' ? (
          <Reveal index={2}>
            <ChurchJoinFlow />
          </Reveal>
        ) : null}

        {choice === 'register' ? (
          <Reveal index={2}>
            <View style={styles.section}>
              <Text style={styles.body}>{t('churchApplication.intro')}</Text>
              <ChurchApplicationFlow hasChurch={false} />
            </View>
          </Reveal>
        ) : null}

        {choice === 'register' && selfServe ? (
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

interface WelcomeChoiceRowProps {
  icon: IconName;
  accent: Accent;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}

/** One of the two ways to start, as a selectable card. */
const WelcomeChoiceRow = ({ icon, accent, title, description, selected, onPress }: WelcomeChoiceRowProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${description}`}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <IconWell name={icon} accent={accent} size={36} />
      <View style={styles.choiceText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowHint}>{description}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Icon name="check" size={12} color={theme.color.onBrand} /> : null}
      </View>
    </PressableScale>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    content: { gap: theme.space.xl },
    choices: { gap: theme.space.sm },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      padding: theme.space.lg,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    choiceSelected: { borderColor: theme.color.brand, borderWidth: 2 },
    choiceText: { flex: 1 },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
    section: { gap: theme.space.sm },
    rows: { paddingVertical: theme.space.xs },
    body: { ...theme.type.bodySmall, color: theme.color.inkMuted, paddingHorizontal: theme.space.xs },
    rowTitle: { ...theme.type.heading, color: theme.color.ink },
    rowHint: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 1 },
  });
