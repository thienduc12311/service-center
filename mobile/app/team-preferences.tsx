import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type SchedulingFrequency, type SchedulingPreferenceRow } from '@service-center/shared';
import { api } from '../src/lib/api';
import { queryKeys } from '../src/lib/query-keys';
import {
  ALL_TEAMS,
  FREQUENCIES,
  WEEKS_OF_MONTH,
  draftFromRow,
  requestFromDraft,
  toggleWeek,
  type PreferenceDraft,
  type WeekList,
} from '../src/lib/preference-draft';
import { useAuth } from '../src/providers/AuthProvider';
import { activeReceivedGrant } from '../src/lib/delegations';
import { useDelegations } from '../src/lib/useDelegations';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  ListRow,
  Loading,
  Screen,
  Tag,
  screenPadding,
} from '../src/components/ui';
import type { Theme } from '../src/lib/theme';
import { useTheme, useThemedStyles } from '../src/lib/useTheme';

/** One selectable preference scope: all teams, or a team the user is on. */
interface ScopeOption {
  id: string;
  name: string;
  custom: boolean;
}

type FieldError = 'maxPerMonth' | 'preferredTimes' | null;

const isStale = (error: unknown): boolean => error instanceof ApiError && error.status === 409;

/**
 * MOB-007: the signed-in Person's own per-team preferences (F03 contract).
 * MOB-011: with `?delegation=`, the same form for the Person who granted the
 * signed-in account an availability right; only their teams are offered and
 * every save names them (`person_id`), rechecked against the live grant.
 * They are scheduler warnings only; blockouts stay the hard "unavailable".
 * Mounted under the session-generation Stack key, so switching organization
 * remounts it and drops any unsaved draft.
 */
export default function TeamPreferencesScreen() {
  const { t } = useTranslation(['settings', 'home', 'common']);
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { user, queryScope, generation, isCurrentGeneration } = useAuth();
  const { delegation: delegationId } = useLocalSearchParams<{ delegation?: string }>();
  const delegations = useDelegations();
  const grant = delegationId ? activeReceivedGrant(delegations.data, delegationId) : null;
  const personId = grant?.can_manage_availability ? grant.target_person_id : null;
  const waitingForGrant = Boolean(delegationId) && !personId;

  const preferences = useQuery({
    queryKey: queryKeys.schedulingPreferences(queryScope, personId),
    queryFn: () => api.listSchedulingPreferences(personId ? { person_id: personId } : undefined),
    enabled: Boolean(queryScope) && !waitingForGrant,
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });

  const [scope, setScope] = useState(ALL_TEAMS);
  const current = preferences.data?.find((row) => (row.team_id ?? ALL_TEAMS) === scope);
  const [draft, setDraft] = useState<PreferenceDraft>(() => draftFromRow(undefined));
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const [saved, setSaved] = useState(false);

  // Reset the form only when the scope or the saved revision changes, so a
  // refetch after a failed save never discards what the user typed.
  const currentKey = current ? `${current.id}:${current.revision}` : 'none';
  useEffect(() => {
    setDraft(draftFromRow(current));
    setFieldError(null);
  }, [scope, currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const scopes = useMemo<ScopeOption[]>(() => {
    const myTeams = (teams.data ?? []).filter((team) =>
      team.members.some((member) => (personId ? member.person_id === personId : member.user_id === user?.profile.id)));
    const customized = (teamId: string): boolean =>
      Boolean(preferences.data?.some((row: SchedulingPreferenceRow) => row.team_id === teamId));
    return [
      { id: ALL_TEAMS, name: t('preferences.allTeams'), custom: false },
      ...myTeams.map((team) => ({ id: team.id, name: team.name, custom: customized(team.id) })),
    ];
  }, [teams.data, preferences.data, personId, user?.profile.id, t]);

  const save = useMutation({
    mutationFn: (request: Parameters<typeof api.saveSchedulingPreference>[0]) =>
      api.saveSchedulingPreference(request),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedulingPreferences(queryScope, personId) });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSchedulingPreference(id),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedulingPreferences(queryScope, personId) });
    },
  });

  const edit = (next: PreferenceDraft): void => {
    setDraft(next);
    setSaved(false);
    setFieldError(null);
  };

  const submit = (): void => {
    const result = requestFromDraft(draft, scope, current, personId);
    if (!result.ok) {
      setFieldError(result.field);
      return;
    }
    save.mutate(result.request);
  };

  const reloadLatest = async (): Promise<void> => {
    save.reset();
    await queryClient.invalidateQueries({ queryKey: queryKeys.schedulingPreferences(queryScope, personId) });
    if (!isCurrentGeneration(generation)) return;
    const latest = queryClient.getQueryData<SchedulingPreferenceRow[]>(queryKeys.schedulingPreferences(queryScope, personId));
    setDraft(draftFromRow(latest?.find((row) => (row.team_id ?? ALL_TEAMS) === scope)));
  };

  const title = grant ? t('home:help.title', { name: grant.target_name }) : t('preferences.screenTitle');

  if (delegations.isLoading && delegationId) return <Loading />;
  if (waitingForGrant) {
    // Stopped, expired, never ours, or no availability right: nothing to edit here.
    return (
      <Screen>
        <View style={styles.padded}>
          <EmptyState title={t('home:help.notFoundTitle')} description={t('home:help.notFoundDescription')} />
        </View>
      </Screen>
    );
  }
  if (preferences.isLoading || teams.isLoading) return <Loading />;

  if (preferences.error instanceof ApiError && preferences.error.status === 404) {
    return (
      <Screen>
        <View style={styles.padded}>
          <EmptyState title={t('preferences.screenTitle')} description={t('preferences.noPerson')} />
        </View>
      </Screen>
    );
  }

  const loadError = preferences.error ?? teams.error;
  if (loadError) {
    return (
      <Screen>
        <View style={[styles.padded, styles.gap]}>
          <ErrorNotice error={loadError} />
          <Button
            title={t('common:actions.retry')}
            onPress={() => { void preferences.refetch(); void teams.refetch(); }}
          />
        </View>
      </Screen>
    );
  }

  const weekRow = (list: WeekList, label: string, a11y: 'preferWeek' | 'avoidWeek') => (
    <View style={styles.weekRow}>
      <Text style={styles.weekLabel}>{label}</Text>
      {WEEKS_OF_MONTH.map((week) => {
        const on = draft[list].includes(week);
        return (
          <Pressable
            key={week}
            onPress={() => edit(toggleWeek(draft, list, week))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t(`preferences.${a11y}`, { week })}
            style={[styles.weekChip, on && styles.weekChipOn]}
          >
            <Text style={[styles.weekChipText, on && styles.weekChipTextOn]}>{t(`preferences.weekOrdinal.${week}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={[styles.padded, styles.gap]} keyboardShouldPersistTaps="handled">
        {grant ? <Text style={styles.hint}>{t('home:help.subtitle')}</Text> : null}
        <Text style={styles.body}>{t('preferences.warningVsUnavailable')}</Text>

        <Card>
          <Label>{t('preferences.appliesTo')}</Label>
          {scopes.map((option, index) => (
            <ListRow key={option.id || 'all'} divided={index > 0} onPress={() => { setScope(option.id); setSaved(false); save.reset(); }}>
              <View style={styles.scopeRow}>
                <Text style={[styles.body, option.id === scope && styles.selected]}>
                  {option.id === scope ? '● ' : '○ '}{option.name}
                </Text>
                {option.custom ? <Tag label={t('preferences.custom')} accent={theme.accent.blue} /> : null}
              </View>
            </ListRow>
          ))}
          {scopes.length === 1 ? <Text style={styles.hint}>{t('preferences.noTeams')}</Text> : null}
          {scope && !current ? <Text style={styles.hint}>{t('preferences.inheritsHint')}</Text> : null}
        </Card>

        <Card>
          <Label>{t('preferences.howOften')}</Label>
          {(['', ...FREQUENCIES] as const).map((frequency: SchedulingFrequency | '', index) => (
            <ListRow key={frequency || 'none'} divided={index > 0} onPress={() => edit({ ...draft, frequency })}>
              <Text style={[styles.body, draft.frequency === frequency && styles.selected]}>
                {draft.frequency === frequency ? '● ' : '○ '}
                {frequency ? t(`preferences.frequency.${frequency}`) : t('preferences.noPreference')}
              </Text>
            </ListRow>
          ))}

          <Field
            label={t('preferences.maxPerMonth')}
            value={draft.maxPerMonth}
            onChangeText={(maxPerMonth) => edit({ ...draft, maxPerMonth })}
            placeholder={t('preferences.noLimit')}
            keyboardType="number-pad"
          />
          <Text style={fieldError === 'maxPerMonth' ? styles.error : styles.hint}>
            {fieldError === 'maxPerMonth' ? t('preferences.invalidMax') : t('preferences.maxPerMonthHint')}
          </Text>
        </Card>

        <Card>
          <Label>{t('preferences.weeksOfMonth')}</Label>
          {weekRow('preferredWeeks', t('preferences.prefer'), 'preferWeek')}
          {weekRow('avoidedWeeks', t('preferences.avoid'), 'avoidWeek')}
        </Card>

        <Card>
          <Field
            label={t('preferences.preferredTimes')}
            value={draft.preferredTimes}
            onChangeText={(preferredTimes) => edit({ ...draft, preferredTimes })}
            placeholder="09:00, 11:00"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Text style={fieldError === 'preferredTimes' ? styles.error : styles.hint}>
            {fieldError === 'preferredTimes' ? t('preferences.invalidTimes') : t('preferences.preferredTimesHint')}
          </Text>
          {current && (current.preferred_dates.length || current.avoided_dates.length) ? (
            <Text style={styles.hint}>{t('preferences.datesOnWebsite')}</Text>
          ) : null}
        </Card>

        {isStale(save.error) ? (
          <Card>
            <Text style={styles.body}>{t('preferences.stale')}</Text>
            <Button title={t('preferences.reload')} variant="quiet" onPress={() => void reloadLatest()} />
          </Card>
        ) : (
          <ErrorNotice error={save.error ?? remove.error} />
        )}
        {saved && !save.isPending ? <Text style={styles.hint}>{t('preferences.saved')}</Text> : null}

        <Button title={t('preferences.save')} onPress={submit} loading={save.isPending} />
        {scope && current ? (
          <Button
            title={t('preferences.useAllTeams')}
            variant="quiet"
            loading={remove.isPending}
            onPress={() => remove.mutate(current.id)}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  padded: { ...screenPadding(theme) },
  gap: { gap: 16 },
  body: { color: theme.color.ink, fontSize: 15, lineHeight: 21 },
  selected: { color: theme.color.brandText, fontWeight: '600' },
  hint: { color: theme.color.inkMuted, fontSize: 13, lineHeight: 18 },
  error: { color: theme.color.danger, fontSize: 13, lineHeight: 18 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekLabel: { width: 52, color: theme.color.inkMuted, fontSize: 13 },
  weekChip: {
    flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface,
  },
  weekChipOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  weekChipText: { color: theme.color.ink, fontSize: 14 },
  weekChipTextOn: { color: theme.color.onBrand, fontWeight: '600' },
});
