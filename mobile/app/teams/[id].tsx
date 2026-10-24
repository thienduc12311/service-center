import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { uuid, type RosterPerson, type TeamWithPositions } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { addableTeamPeople, canOpenPeopleDetails, directoryName, filterDirectory, teamManageTarget } from '../../src/lib/directory';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  IconButton,
  Label,
  ListRow,
  Loading,
  Screen,
  screenPadding,
} from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

type TeamMember = TeamWithPositions['members'][number];

/** Matches the website's choice: a position, or explicitly none. */
const NO_POSITION = 'none';

/**
 * MOB-031: one team's roster (website `TeamsPage` card + add-member modal).
 * Adds and removals use `addTeamMember`/`removeTeamMember` on the existing
 * Person id — never an email match — and the list is re-read afterwards, so
 * what is shown is what the server saved.
 */
export default function TeamScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation(['teams', 'people', 'common']);
  const { queryScope, canEditRoster, role, generation, isCurrentGeneration } = useAuth();
  const owner = canOpenPeopleDetails(role);
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const teamId = uuid.safeParse(single(params.id));
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [positionChoice, setPositionChoice] = useState<string>(NO_POSITION);

  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope && teamId.success),
  });
  const team = teams.data?.find((entry) => teamId.success && entry.id === teamId.data) ?? null;
  const manageable = team ? canEditRoster(teamManageTarget(team)) : false;

  const people = useQuery({
    queryKey: queryKeys.directory(queryScope, false),
    queryFn: () => api.listPeople(),
    enabled: Boolean(queryScope && adding && manageable),
  });
  const candidates = useMemo(
    () => addableTeamPeople(filterDirectory(people.data ?? [], query)),
    [people.data, query],
  );

  const refresh = async (): Promise<void> => {
    if (!isCurrentGeneration(generation)) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.teams(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.people(queryScope) }),
    ]);
  };

  const add = useMutation({
    mutationFn: (person: RosterPerson & { person_id: string }) =>
      api.addTeamMember(team?.id ?? '', {
        person_id: person.person_id,
        position_id: positionChoice === NO_POSITION ? null : positionChoice,
      }),
    onSuccess: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: (member: TeamMember) => api.removeTeamMember(team?.id ?? '', member.membership_id),
    onSuccess: () => refresh(),
  });

  if (!teamId.success) {
    return (
      <Screen>
        <EmptyState title={t('mobileTeams.notFound')} />
      </Screen>
    );
  }
  if (teams.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (!team) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('teamsPage.title') }} />
        <View style={{ padding: 24, gap: 16 }}>
          {teams.error ? <ErrorNotice error={teams.error} /> : <EmptyState title={t('mobileTeams.notFound')} description={t('mobileTeams.goneDescription')} />}
        </View>
      </Screen>
    );
  }

  const memberName = (member: TeamMember): string =>
    member.profile?.full_name || member.profile?.email || t('common:states.unknown');
  const positionName = (positionId: string | null): string | null =>
    team.positions.find((position) => position.id === positionId)?.name ?? null;

  const confirmRemove = (member: TeamMember): void => {
    const name = memberName(member);
    Alert.alert(t('mobileTeams.removeTitle', { name, team: team.name }), t('mobileTeams.removeMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('mobileTeams.remove'), style: 'destructive', onPress: () => remove.mutate(member) },
    ]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: team.name }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.stack]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={teams.isRefetching} onRefresh={() => void teams.refetch()} />}
      >
        <View style={styles.hero}>
          <View style={[styles.swatch, { backgroundColor: team.color }]} />
          <Text style={styles.title}>{team.name}</Text>
        </View>
        {team.description ? <Text style={styles.muted}>{team.description}</Text> : null}

        <Card>
          <Label>{t('common:count.people', { count: team.members.length })}</Label>
          <ErrorNotice error={remove.error} />
          {team.members.length ? (
            team.members.map((member, index) => {
              const name = memberName(member);
              const position = positionName(member.position_id);
              return (
                <View key={member.membership_id} style={styles.memberRow}>
                  <View style={styles.flex}>
                    <ListRow
                      divided={index > 0}
                      showChevron={owner}
                      onPress={owner ? () => router.push({ pathname: '/people/[id]', params: { id: member.person_id } }) : undefined}
                    >
                      <View style={styles.personLine}>
                        <Avatar name={name} url={member.profile?.avatar_url} size={28} />
                        <View style={styles.flex}>
                          <Text style={styles.body}>{name}</Text>
                          {position ? <Text style={styles.muted}>{position}</Text> : null}
                        </View>
                      </View>
                    </ListRow>
                  </View>
                  {manageable ? (
                    <IconButton
                      name="trash"
                      accessibilityLabel={t('mobileTeams.removeLabel', { name, team: team.name })}
                      disabled={remove.isPending}
                      onPress={() => confirmRemove(member)}
                    />
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.muted}>{t('teamsPage.noMembers')}</Text>
          )}
        </Card>

        {manageable ? (
          <Card>
            <Label>{t('teamsPage.addMember.title', { team: team.name })}</Label>
            {adding ? (
              <>
                <Text style={styles.muted}>{t('teamsPage.addMember.hint')}</Text>
                {team.positions.length ? (
                  <View style={styles.chips}>
                    <Chip
                      label={t('teamsPage.addMember.noPosition')}
                      active={positionChoice === NO_POSITION}
                      onPress={() => setPositionChoice(NO_POSITION)}
                    />
                    {team.positions.map((position) => (
                      <Chip
                        key={position.id}
                        label={position.name}
                        active={positionChoice === position.id}
                        onPress={() => setPositionChoice(position.id)}
                      />
                    ))}
                  </View>
                ) : null}
                <Field
                  accessibilityLabel={t('people:mobileDirectory.searchLabel')}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('people:mobileDirectory.searchPlaceholder')}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                <ErrorNotice error={people.error ?? add.error} />
                {people.isLoading ? <Loading /> : null}
                {candidates.slice(0, 50).map((person, index) => {
                  const name = directoryName(person) ?? t('common:fallback.unnamed');
                  return (
                    <View key={person.id} style={[styles.memberRow, index > 0 && styles.divided]}>
                      <Avatar name={name} size={28} />
                      <Text style={[styles.body, styles.flex]}>{name}</Text>
                      <Button
                        title={t('common:actions.add')}
                        variant="secondary"
                        accessibilityLabel={t('mobileTeams.addLabel', { name, team: team.name })}
                        loading={add.isPending && add.variables?.person_id === person.person_id}
                        disabled={add.isPending}
                        onPress={() => add.mutate(person)}
                      />
                    </View>
                  );
                })}
                {!people.isLoading && !candidates.length ? <Text style={styles.muted}>{t('people:mobileDirectory.noMatch')}</Text> : null}
                {candidates.length > 50 ? <Text style={styles.muted}>{t('mobileTeams.refineSearch')}</Text> : null}
                <Button title={t('common:actions.done')} variant="secondary" onPress={() => { add.reset(); setAdding(false); }} />
              </>
            ) : (
              <Button title={t('mobileTeams.addPerson')} icon="plus" variant="secondary" onPress={() => setAdding(true)} />
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: theme.space.lg },
    hero: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    swatch: { width: 14, height: 14, borderRadius: 7 },
    title: { ...theme.type.title, color: theme.color.ink, flexShrink: 1 },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    personLine: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
    divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.border, paddingTop: theme.space.sm },
  });
