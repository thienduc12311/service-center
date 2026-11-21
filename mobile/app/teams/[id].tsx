import { useMemo, useState } from 'react';
import { Alert, FlatList, Linking, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PEOPLE_PAGE_SIZE, flattenPeoplePages, rosterDetailLines, rosterDisplayName, uuid, type TeamWithPositions } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { keepScopedData, queryKeys } from '../../src/lib/query-keys';
import { canOpenPeopleDetails, directoryName, teamManageTarget } from '../../src/lib/directory';
import { needsListSearch } from '../../src/lib/list-search';
import {
  pruneQueue,
  teamAddCandidates,
  teamMemberSections,
  toggleQueued,
  type QueuedPerson,
  type TeamAddCandidate,
  type TeamMember,
  type TeamMemberSection,
} from '../../src/lib/team-roster';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  IconButton,
  SectionHeader,
  ListRow,
  Loading,
  Screen,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import { BottomSheet } from '../../src/components/BottomSheet';
import { SearchField } from '../../src/components/SearchField';
import { SearchableOptionPicker } from '../../src/components/SearchableOptionSheet';
import { Icon } from '../../src/components/icons';
import { PressableScale } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Matches the website's choice: a position, or explicitly none. */
const NO_POSITION = 'none';

/**
 * MOB-031: one team's roster (website `TeamsPage` card + add-member modal),
 * grouped by position with a search once it is long. Adds and removals use
 * `addTeamMember`/`removeTeamMember` on the existing Person id — never an
 * email match — and the list is re-read afterwards, so what is shown is what
 * the server saved. People to add come from the server-searched People pages.
 */
export default function TeamScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { t, i18n } = useTranslation(['teams', 'people', 'common']);
  const { queryScope, canEditRoster, role, generation, isCurrentGeneration } = useAuth();
  const owner = canOpenPeopleDetails(role);
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const teamId = uuid.safeParse(single(params.id));
  const [adding, setAdding] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');

  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope && teamId.success),
  });
  const team = teams.data?.find((entry) => teamId.success && entry.id === teamId.data) ?? null;
  const manageable = team ? canEditRoster(teamManageTarget(team)) : false;

  const refresh = async (): Promise<void> => {
    if (!isCurrentGeneration(generation)) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.teams(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.people(queryScope) }),
    ]);
  };

  const remove = useMutation({
    mutationFn: (member: TeamMember) => api.removeTeamMember(team?.id ?? '', member.membership_id),
    onSuccess: () => refresh(),
  });

  if (!teamId.success) {
    return (
      <Screen>
        <EmptyState icon="people" title={t('mobileTeams.notFound')} />
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
        <View style={screenPadding(theme)}>
          {teams.error ? <ErrorNotice error={teams.error} /> : <EmptyState icon="people" title={t('mobileTeams.notFound')} description={t('mobileTeams.goneDescription')} />}
        </View>
      </Screen>
    );
  }

  const memberName = (member: TeamMember): string =>
    rosterDisplayName(member.profile) ?? t('common:states.unknown');
  const sections = teamMemberSections(team.members, team.positions, memberQuery, {
    noPosition: t('teamsPage.addMember.noPosition'),
    memberName,
  });

  const openLink = (href: string): void => {
    Linking.openURL(href).catch((error: unknown) => {
      console.warn('[teams] could not open a roster link', error);
      Alert.alert(t('teams:mobileTeams.openLinkFailed'));
    });
  };

  const confirmRemove = (member: TeamMember): void => {
    const name = memberName(member);
    Alert.alert(t('mobileTeams.removeTitle', { name, team: team.name }), t('mobileTeams.removeMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('mobileTeams.remove'), style: 'destructive', onPress: () => remove.mutate(member) },
    ]);
  };

  const searchable = needsListSearch(team.members.length);
  const shownCount = sections.reduce((total, section) => total + section.data.length, 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: team.name }} />
      <SectionList<TeamMember, TeamMemberSection>
        sections={sections}
        keyExtractor={(member) => member.membership_id}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={teams.isRefetching} onRefresh={() => void teams.refetch()} />}
        ListHeaderComponent={
          <View style={styles.stack}>
            <Card style={styles.hero}>
              <View style={styles.heroTile}>
                <Icon name="people" size={26} color={team.color} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.title}>{team.name}</Text>
                {team.description ? <Text style={styles.muted}>{team.description}</Text> : null}
              </View>
            </Card>
            {manageable ? (
              <Button title={t('mobileTeams.addPeople')} icon="plus" variant="secondary" onPress={() => setAdding(true)} />
            ) : null}
            <View style={styles.section}>
              <SectionHeader title={t('common:count.people', { count: team.members.length })} />
              {searchable ? (
                <SearchField value={memberQuery} onChangeText={setMemberQuery} placeholder={t('mobileTeams.searchMembers')} />
              ) : null}
              <ErrorNotice error={remove.error} />
              {team.members.length === 0 ? <Text style={styles.muted}>{t('teamsPage.noMembers')}</Text> : null}
              {team.members.length > 0 && shownCount === 0 ? <Text style={styles.muted}>{t('people:mobileDirectory.noMatch')}</Text> : null}
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.groupTitle}>{t('mobileTeams.positionGroup', { position: section.title, count: section.data.length })}</Text>
        )}
        renderItem={({ item: member, index, section }) => {
          const name = memberName(member);
          return (
            <View
              style={[
                styles.memberRow,
                styles.groupRow,
                index === 0 && styles.groupFirst,
                index === section.data.length - 1 && styles.groupLast,
              ]}
            >
              <View style={styles.flex}>
                <ListRow
                  divided={index > 0}
                  showChevron={owner}
                  onPress={owner ? () => router.push({ pathname: '/people/[id]', params: { id: member.person_id } }) : undefined}
                  leading={<Avatar name={name} url={member.profile?.avatar_url} size={36} />}
                >
                  <Text style={styles.name}>{name}</Text>
                  {rosterDetailLines(member.profile, i18n.language).map((line) => (
                    <Text
                      key={line.kind}
                      style={styles.muted}
                      onPress={line.href ? () => openLink(line.href ?? '') : undefined}
                      accessibilityRole={line.href ? 'link' : undefined}
                    >
                      {line.value}
                    </Text>
                  ))}
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
        }}
      />
      {manageable ? (
        <AddMembersSheet
          visible={adding}
          team={team}
          onClose={() => setAdding(false)}
          onAdded={refresh}
        />
      ) : null}
    </Screen>
  );
}

interface AddMembersSheetProps {
  visible: boolean;
  team: TeamWithPositions;
  onClose: () => void;
  /** Re-reads the team and People after each saved add. */
  onAdded: () => Promise<void>;
}

/**
 * Add several people in one go: search the People list on the server, tap to
 * queue, choose a position, then one Add. Each person is a separate
 * `addTeamMember`; a failure stops there and keeps the rest queued.
 */
function AddMembersSheet({ visible, team, onClose, onAdded }: AddMembersSheetProps) {
  const { t } = useTranslation(['teams', 'people', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim());
  const [positionChoice, setPositionChoice] = useState<string>(NO_POSITION);
  const [queue, setQueue] = useState<QueuedPerson[]>([]);
  const positionId = positionChoice === NO_POSITION ? null : positionChoice;

  const people = useInfiniteQuery({
    queryKey: queryKeys.peoplePicker(queryScope, search),
    queryFn: ({ pageParam }) =>
      api.listPeoplePage({ limit: PEOPLE_PAGE_SIZE, cursor: pageParam, ...(search ? { q: search } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // Keep the last results on screen while the next search loads.
    placeholderData: keepScopedData(queryScope),
    enabled: Boolean(queryScope && visible),
  });
  const candidates = useMemo(
    () => teamAddCandidates(people.data ? flattenPeoplePages(people.data.pages) : [], team.members, positionId),
    [people.data, positionId, team.members],
  );

  const add = useMutation({
    mutationFn: async (people: readonly QueuedPerson[]) => {
      for (const person of people) {
        await api.addTeamMember(team.id, { person_id: person.person_id, position_id: positionId });
        if (!isCurrentGeneration(generation)) return;
        setQueue((current) => current.filter((entry) => entry.person_id !== person.person_id));
      }
    },
    onSettled: () => onAdded(),
  });

  const close = () => {
    add.reset();
    setQuery('');
    onClose();
  };
  const choosePosition = (next: string) => {
    setPositionChoice(next);
    setQueue((current) => pruneQueue(current, team.members, next === NO_POSITION ? null : next));
  };

  const positionOptions = [
    { value: NO_POSITION, label: t('teamsPage.addMember.noPosition') },
    ...team.positions.filter((position) => !position.plan_id).map((position) => ({ value: position.id, label: position.name })),
  ];

  const renderCandidate = ({ item }: { item: TeamAddCandidate }) => {
    const name = directoryName(item.person) ?? t('common:fallback.unnamed');
    const queued = queue.some((entry) => entry.person_id === item.person.person_id);
    return (
      <PressableScale
        accessibilityRole="checkbox"
        accessibilityState={{ checked: queued }}
        accessibilityLabel={t('mobileTeams.addLabel', { name, team: team.name })}
        onPress={() => setQueue((current) => toggleQueued(current, { person_id: item.person.person_id, name }))}
        pressedOpacity={0.6}
        style={styles.candidate}
      >
        <View style={[styles.box, queued && styles.boxOn]}>
          {queued ? <Icon name="check" size={13} color={theme.color.onBrand} strokeWidth={2.4} /> : null}
        </View>
        <Avatar name={name} url={item.person.avatar_url} size={32} />
        <Text style={[styles.body, styles.flex]}>{name}</Text>
        {item.onTeam ? <Tag label={t('mobileTeams.onTeam')} accent={theme.accent.neutral} /> : null}
      </PressableScale>
    );
  };

  return (
    <BottomSheet
      visible={visible}
      title={t('teamsPage.addMember.title', { team: team.name })}
      onClose={close}
      footer={
        <>
          <Button title={t('common:actions.done')} variant="secondary" onPress={close} />
          <View style={styles.flex} />
          <Button
            title={t('mobileTeams.addQueued', { count: queue.length })}
            icon="plus"
            disabled={queue.length === 0}
            loading={add.isPending}
            onPress={() => add.mutate(queue)}
          />
        </>
      }
    >
      {team.positions.length ? (
        <SearchableOptionPicker
          title={t('teamsPage.addMember.hint')}
          options={positionOptions}
          selected={[positionChoice]}
          mode="single"
          onChange={(next) => choosePosition(next[0] ?? NO_POSITION)}
        />
      ) : null}
      {queue.length ? (
        <View style={styles.chips}>
          {queue.map((entry) => (
            <Chip
              key={entry.person_id}
              label={`${entry.name}  ×`}
              active
              onPress={() => setQueue((current) => toggleQueued(current, entry))}
            />
          ))}
        </View>
      ) : null}
      <SearchField value={query} onChangeText={setQuery} placeholder={t('people:mobileDirectory.searchPlaceholder')} />
      <ErrorNotice error={add.error ?? people.error} />
      {add.isSuccess && queue.length === 0 ? <Text style={styles.success}>{t('mobileTeams.added')}</Text> : null}
      <FlatList
        style={styles.flex}
        data={candidates}
        keyExtractor={(candidate) => candidate.person.id}
        renderItem={renderCandidate}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={() => {
          if (people.hasNextPage && !people.isFetching) void people.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          people.isLoading ? <Loading /> : <Text style={styles.muted}>{t('people:mobileDirectory.noMatch')}</Text>
        }
        ListFooterComponent={
          people.hasNextPage ? (
            <Button
              title={t('people:list.loadMore')}
              variant="quiet"
              loading={people.isFetchingNextPage}
              onPress={() => void people.fetchNextPage()}
            />
          ) : null
        }
      />
    </BottomSheet>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: theme.space.lg, marginBottom: theme.space.sm },
    section: { gap: theme.space.sm },
    hero: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    heroTile: {
      width: 52,
      height: 52,
      borderRadius: theme.radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.surfaceInset,
      borderWidth: 1,
      borderColor: theme.color.border,
    },
    title: { ...theme.type.title, color: theme.color.ink, flexShrink: 1 },
    name: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    groupTitle: { ...theme.type.label, color: theme.color.inkMuted, paddingTop: theme.space.md, paddingBottom: theme.space.xs },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    groupRow: {
      backgroundColor: theme.color.surface,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.color.border,
      paddingHorizontal: theme.space.md,
    },
    groupFirst: {
      borderTopWidth: 1,
      borderTopLeftRadius: theme.radius.lg + 2,
      borderTopRightRadius: theme.radius.lg + 2,
    },
    groupLast: {
      borderBottomWidth: 1,
      borderBottomLeftRadius: theme.radius.lg + 2,
      borderBottomRightRadius: theme.radius.lg + 2,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs },
    candidate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      minHeight: 48,
      paddingVertical: theme.space.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
    success: {
      ...theme.type.bodySmall,
      color: theme.accent.green.fg,
      backgroundColor: theme.accent.green.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
