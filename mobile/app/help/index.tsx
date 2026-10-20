import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation } from '@tanstack/react-query';
import { addLocalDays, type DelegationSummary } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import {
  delegationRights,
  emptyGrantDraft,
  givenGrants,
  grantDraftReady,
  grantRequest,
  helperCandidates,
  householdPeople,
  replacesActiveGrant,
  type DelegationRight,
  type GrantDraft,
} from '../../src/lib/delegations';
import { useDelegations, useRefreshDelegations } from '../../src/lib/useDelegations';
import { useMyPersonId, usePeople } from '../../src/lib/useReplacements';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

/** Helpers shown at once; the search narrows a large roster. */
const HELPER_LIMIT = 12;
const pad = (value: number): string => String(value).padStart(2, '0');
const civilDate = (value: Date): string => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const pickerDate = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12);
};

/**
 * MOB-011: whose schedule to work on, and who may help with yours (F03 Pass C).
 * Only people who explicitly granted the signed-in account help appear in the
 * picker; a household or role grants nothing. Mounted under the
 * session-generation Stack key, so an account or organization change drops
 * the form and every delegated result.
 */
export default function HelpScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { calendarDate, date, list } = useFormatters();
  const { generation, isCurrentGeneration } = useAuth();
  const delegations = useDelegations();
  const people = usePeople();
  const myPersonId = useMyPersonId();
  const refreshDelegations = useRefreshDelegations();
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<GrantDraft>(emptyGrantDraft);
  const [search, setSearch] = useState('');
  const [pickingUntil, setPickingUntil] = useState(false);
  const [granted, setGranted] = useState<string | null>(null);

  const household = useMemo(() => householdPeople(delegations.data ?? []), [delegations.data]);
  const given = useMemo(() => givenGrants(delegations.data ?? []), [delegations.data]);
  const candidates = useMemo(() => helperCandidates(people.data ?? [], myPersonId), [people.data, myPersonId]);
  const query = search.trim().toLowerCase();
  const shown = candidates
    .filter((person) => !query || (person.full_name ?? '').toLowerCase().includes(query) || person.person_id === draft.delegatePersonId)
    .slice(0, HELPER_LIMIT);
  const chosen = candidates.find((person) => person.person_id === draft.delegatePersonId) ?? null;

  const rightsText = (rights: readonly DelegationRight[]): string =>
    list(rights.map((right) => t(`help.rights.${right}`)));

  const grant = useMutation({
    mutationFn: (request: GrantDraft) => api.grantDelegation(grantRequest(request)),
    onSuccess: async (created) => {
      if (!isCurrentGeneration(generation)) return;
      setDraft(emptyGrantDraft());
      setSearch('');
      setGranted(created.delegate_name);
      await refreshDelegations();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeDelegation(id),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshDelegations();
    },
  });

  const confirmStop = (delegation: DelegationSummary): void => {
    const given = delegation.direction === 'given';
    Alert.alert(
      t('help.stopConfirmTitle'),
      given ? t('help.stopConfirmGiven', { name: delegation.delegate_name }) : t('help.stopConfirmReceived', { name: delegation.target_name }),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: given ? t('help.stop') : t('help.stopHelping'), style: 'destructive', onPress: () => revoke.mutate(delegation.id) },
      ],
    );
  };

  const edit = (next: GrantDraft): void => {
    setDraft(next);
    setGranted(null);
    grant.reset();
  };

  const onUntilChange = (event: DateTimePickerEvent, value?: Date): void => {
    if (Platform.OS === 'android') setPickingUntil(false);
    if (event.type === 'dismissed' || !value) return;
    edit({ ...draft, until: civilDate(value) });
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await Promise.all([delegations.refetch(), people.refetch()]);
    if (isCurrentGeneration(generation)) setRefreshing(false);
  };

  const today = civilDate(new Date());

  return (
    <Screen>
      <Stack.Screen options={{ title: t('help.title') }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.color.inkFaint} />}
      >
        <ScreenHeader title={t('help.title')} description={t('help.description')} />
        <ErrorNotice error={delegations.error ?? revoke.error} />
        {delegations.isLoading ? <Loading /> : delegations.error ? (
          <Button title={t('common:actions.retry')} onPress={() => void delegations.refetch()} />
        ) : (
          <>
            <View style={styles.section}>
              <Label>{t('help.whoseSchedule')}</Label>
              <Card>
                <ListRow showChevron onPress={() => router.navigate('/(tabs)')}>
                  <View style={styles.row}>
                    <Avatar name={t('help.you')} />
                    <View style={styles.rowText}>
                      <Text style={styles.title}>{t('help.you')}</Text>
                      <Text style={styles.muted}>{t('help.yourSchedule')}</Text>
                    </View>
                  </View>
                </ListRow>
                {household.map((person) => (
                  <ListRow
                    key={person.delegationId}
                    divided
                    showChevron
                    onPress={() => router.push({ pathname: '/help/[id]', params: { id: person.delegationId } })}
                  >
                    <View style={styles.row}>
                      <Avatar name={person.name} />
                      <View style={styles.rowText}>
                        <Text style={styles.title}>{person.name}</Text>
                        <Text style={styles.muted}>{t('help.youCan', { rights: rightsText(person.rights) })}</Text>
                      </View>
                    </View>
                  </ListRow>
                ))}
              </Card>
              {household.length === 0 ? <Text style={styles.muted}>{t('help.nobodyToHelp')}</Text> : null}
            </View>

            <View style={styles.section}>
              <Label>{t('help.helpsMe')}</Label>
              <Card>
                {given.length === 0 ? <Text style={styles.muted}>{t('help.nobodyHelps')}</Text> : given.map((delegation, index) => (
                  <ListRow key={delegation.id} divided={index > 0}>
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.title}>{delegation.delegate_name}</Text>
                        <Text style={styles.muted}>
                          {[
                            t('help.theyCan', { rights: rightsText(delegationRights(delegation)) }),
                            delegation.expires_at ? t('help.until', { date: date(delegation.expires_at) }) : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                        {!delegation.active ? <Tag label={t('help.expired')} accent={theme.accent.neutral} /> : null}
                      </View>
                      <Button
                        title={t('help.stop')}
                        variant="quiet"
                        loading={revoke.isPending && revoke.variables === delegation.id}
                        onPress={() => confirmStop(delegation)}
                      />
                    </View>
                  </ListRow>
                ))}
              </Card>
            </View>

            <View style={styles.section}>
              <Label>{t('help.askSomeone')}</Label>
              <Card>
                <Field
                  label={t('help.who')}
                  value={search}
                  onChangeText={setSearch}
                  placeholder={t('help.searchPeople')}
                  autoCorrect={false}
                />
                {people.isLoading ? <Loading /> : null}
                <ErrorNotice error={people.error} />
                {!people.isLoading && shown.length === 0 ? <Text style={styles.muted}>{t('help.noMatches')}</Text> : null}
                {shown.map((person, index) => {
                  const selected = person.person_id === draft.delegatePersonId;
                  return (
                    <ListRow key={person.person_id} divided={index > 0} onPress={() => edit({ ...draft, delegatePersonId: selected ? '' : person.person_id! })}>
                      <View
                        style={styles.row}
                        accessible
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={person.full_name ?? t('common:fallback.unnamed')}
                      >
                        <Text style={[styles.body, selected && styles.selected]}>
                          {selected ? '● ' : '○ '}{person.full_name ?? t('common:fallback.unnamed')}
                        </Text>
                      </View>
                    </ListRow>
                  );
                })}
                <Text style={styles.hint}>{t('help.chooseSomeone')}</Text>
                {chosen && replacesActiveGrant(delegations.data ?? [], chosen.person_id!) ? (
                  <Text style={styles.hint}>{t('help.replaces', { name: chosen.full_name ?? t('common:fallback.unnamed') })}</Text>
                ) : null}

                <Label>{t('help.theyCanLegend')}</Label>
                <View style={styles.switchRow}>
                  <Text style={[styles.body, styles.flex]}>{t('help.allowRespond')}</Text>
                  <Switch
                    accessibilityLabel={t('help.allowRespond')}
                    value={draft.canRespond}
                    onValueChange={(canRespond) => edit({ ...draft, canRespond })}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Text style={[styles.body, styles.flex]}>{t('help.allowView')}</Text>
                  <Switch
                    accessibilityLabel={t('help.allowView')}
                    value={draft.canView || draft.canRespond}
                    disabled={draft.canRespond}
                    onValueChange={(canView) => edit({ ...draft, canView })}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Text style={[styles.body, styles.flex]}>{t('help.allowAvailability')}</Text>
                  <Switch
                    accessibilityLabel={t('help.allowAvailability')}
                    value={draft.canAvailability}
                    onValueChange={(canAvailability) => edit({ ...draft, canAvailability })}
                  />
                </View>
                <Text style={styles.hint}>{t('help.privateHint')}</Text>

                <Label>{`${t('help.untilLabel')} ${t('help.optional')}`}</Label>
                <View style={styles.untilRow}>
                  <Button
                    title={draft.until ? calendarDate(draft.until, 'medium') : t('help.noEnd')}
                    variant="secondary"
                    onPress={() => setPickingUntil(true)}
                  />
                  {draft.until ? (
                    <Button title={t('help.removeEnd')} variant="quiet" onPress={() => edit({ ...draft, until: null })} />
                  ) : null}
                </View>
                {pickingUntil ? (
                  <DateTimePicker
                    value={pickerDate(draft.until ?? addLocalDays(today, 30))}
                    minimumDate={pickerDate(today)}
                    maximumDate={pickerDate(addLocalDays(today, 729))}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    onChange={onUntilChange}
                  />
                ) : null}
                {pickingUntil && Platform.OS === 'ios' ? (
                  <Button title={t('common:actions.done')} variant="quiet" onPress={() => setPickingUntil(false)} />
                ) : null}

                <ErrorNotice error={grant.error} />
                {granted && !grant.isPending ? <Text style={styles.hint}>{t('help.granted', { name: granted })}</Text> : null}
                <Button
                  title={t('help.allow')}
                  onPress={() => grant.mutate(draft)}
                  loading={grant.isPending}
                  disabled={!grantDraftReady(draft)}
                />
              </Card>
            </View>
            {candidates.length === 0 && !people.isLoading && !people.error ? (
              <EmptyState title={t('help.noHelpers')} />
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.lg },
    section: { gap: theme.space.sm },
    flex: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    rowText: { flex: 1, gap: 2, alignItems: 'flex-start' },
    title: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    selected: { color: theme.color.brandText, fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    untilRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  });
