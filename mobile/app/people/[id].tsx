import { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, uuid, type PersonDetail, type RosterPerson } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import {
  contactIsLoginManaged,
  directoryBadges,
  directoryName,
  hasPersonChanges,
  parseTagText,
  personEditBody,
  personEditDraft,
  canOpenPeopleDetails,
  tagText,
  teamManageTarget,
  teamsForPerson,
  type PersonEditDraft,
  type PersonTeamMembership,
} from '../../src/lib/directory';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  IconButton,
  Label,
  ListRow,
  Loading,
  Screen,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * MOB-031: one Person (website `PersonPage`), for the organization owner
 * only: the API refuses every other role (403) and RLS hides other people's
 * rows, so anyone else is sent back to the directory, as the website does. A
 * record that has gone (404) falls back to its directory row when there is one.
 */
export default function PersonScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation(['people', 'common']);
  const { queryScope, role } = useAuth();
  const owner = canOpenPeopleDetails(role);
  const personId = uuid.safeParse(single(params.id));
  const id = personId.success ? personId.data : null;

  const directory = useQuery({
    queryKey: queryKeys.directory(queryScope, true),
    queryFn: () => api.listPeople({ include_archived: true }),
    enabled: Boolean(queryScope && id && owner),
  });
  const record = useQuery({
    queryKey: queryKeys.person(queryScope, id),
    queryFn: () => api.getPerson(id ?? ''),
    enabled: Boolean(queryScope && id && owner),
  });
  const row = directory.data?.find((entry) => entry.person_id === id) ?? null;

  if (!owner) return <Redirect href="/people" />;

  if (!id) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('list.title') }} />
        <EmptyState title={t('mobileDirectory.notFound')} />
      </Screen>
    );
  }
  if (record.isLoading || directory.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const privateRecord = record.error instanceof ApiError && record.error.status === 404;
  if (privateRecord && !row) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('list.title') }} />
        <EmptyState title={t('mobileDirectory.notFound')} description={t('mobileDirectory.goneDescription')} />
      </Screen>
    );
  }
  if ((record.error && !privateRecord) || (!record.data && !row)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('list.title') }} />
        <View style={{ padding: 24, gap: 16 }}>
          <ErrorNotice error={record.error ?? directory.error} />
          <Button title={t('common:actions.retry')} onPress={() => void record.refetch()} />
        </View>
      </Screen>
    );
  }
  return (
    <PersonView
      personId={id}
      person={record.data ?? null}
      row={row}
      refreshing={record.isRefetching}
      onRefresh={() => {
        void record.refetch();
        void directory.refetch();
      }}
    />
  );
}

interface PersonViewProps {
  personId: string;
  /** Null when the record no longer exists (404) and only its directory row is left. */
  person: PersonDetail | null;
  row: RosterPerson | null;
  refreshing: boolean;
  onRefresh: () => void;
}

interface DetailLine {
  label: string;
  value: string;
}

const PersonView = ({ personId, person, row, refreshing, onRefresh }: PersonViewProps) => {
  const { t } = useTranslation(['people', 'teams', 'common']);
  const { queryScope, user, canEditRoster, role: callerRole, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const canManagePeople = canOpenPeopleDetails(callerRole);
  const isSelf = Boolean(person?.profile_id && person.profile_id === user?.profile.id);
  const name =
    (person ? [person.first_name, person.last_name].filter(Boolean).join(' ') : null) ||
    (row ? directoryName(row) : null) ||
    t('common:fallback.unnamed');
  const archived = Boolean(person?.archived_at ?? row?.archived);

  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  const tags = useQuery({
    queryKey: queryKeys.personTags(queryScope, personId),
    queryFn: () => api.personTags(personId),
    enabled: Boolean(queryScope),
  });
  const memberships = teamsForPerson(teams.data ?? [], personId);

  const refreshRoster = async (): Promise<void> => {
    if (!isCurrentGeneration(generation)) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.people(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.teams(queryScope) }),
    ]);
  };

  const [draft, setDraft] = useState<PersonEditDraft | null>(person ? personEditDraft(person) : null);
  const [editing, setEditing] = useState(false);
  // A fresh read replaces the draft only while it is not being edited.
  useEffect(() => {
    if (person && !editing) setDraft(personEditDraft(person));
  }, [person, editing]);

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof personEditBody>) => api.updatePerson(personId, body),
    onSuccess: async (saved) => {
      if (!isCurrentGeneration(generation)) return;
      queryClient.setQueryData(queryKeys.person(queryScope, personId), saved);
      setEditing(false);
      await refreshRoster();
    },
  });
  const submitEdit = (): void => {
    if (!person || !draft) return;
    let body: ReturnType<typeof personEditBody>;
    try {
      body = personEditBody(person, draft);
    } catch {
      // The shared schema refused a field (e.g. a malformed email); nothing is sent.
      Alert.alert(t('mobileDirectory.invalidTitle'), t('mobileDirectory.invalidMessage'));
      return;
    }
    if (!hasPersonChanges(body)) {
      setEditing(false);
      return;
    }
    save.mutate(body);
  };

  const lifecycle = useMutation({
    mutationFn: (archive: boolean) => (archive ? api.archivePerson(personId) : api.restorePerson(personId)),
    onSuccess: async (saved) => {
      if (!isCurrentGeneration(generation)) return;
      queryClient.setQueryData(queryKeys.person(queryScope, personId), saved);
      await refreshRoster();
    },
  });
  const confirmLifecycle = (): void => {
    const archive = !archived;
    Alert.alert(
      archive ? t('mobileDirectory.archiveTitle', { name }) : t('mobileDirectory.restoreTitle', { name }),
      archive ? t('mobileDirectory.archiveMessage') : t('mobileDirectory.restoreMessage'),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: archive ? t('common:actions.archive') : t('common:actions.restore'),
          style: archive ? 'destructive' : 'default',
          onPress: () => lifecycle.mutate(archive),
        },
      ],
    );
  };

  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const saveTags = useMutation({
    mutationFn: (next: string[]) => api.replacePersonTags(personId, next),
    onSuccess: (saved) => {
      if (!isCurrentGeneration(generation)) return;
      queryClient.setQueryData(queryKeys.personTags(queryScope, personId), saved);
      setTagDraft(null);
    },
  });
  const submitTags = (): void => {
    let next: string[];
    try {
      next = parseTagText(tagDraft ?? '');
    } catch {
      Alert.alert(t('mobileDirectory.invalidTitle'), t('mobileDirectory.tagsInvalid'));
      return;
    }
    saveTags.mutate(next);
  };

  const removeMembership = useMutation({
    mutationFn: (membership: PersonTeamMembership) => api.removeTeamMember(membership.teamId, membership.membershipId),
    onSuccess: () => refreshRoster(),
  });
  const confirmRemove = (membership: PersonTeamMembership): void => {
    Alert.alert(
      t('teams:mobileTeams.removeTitle', { name, team: membership.teamName }),
      t('teams:mobileTeams.removeMessage'),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        { text: t('teams:mobileTeams.remove'), style: 'destructive', onPress: () => removeMembership.mutate(membership) },
      ],
    );
  };

  const address = person
    ? [person.address_line1, person.address_line2, person.city, person.state_province, person.postal_code, person.country]
        .filter(Boolean)
        .join(', ')
    : '';
  // Only what the server returned to this caller; nothing is filled in.
  const lines: DetailLine[] = [
    { label: t('person.fields.email'), value: person?.email ?? row?.email ?? '' },
    { label: t('person.fields.phone'), value: person?.phone ?? row?.phone ?? '' },
    { label: t('person.fields.phoneCarrier'), value: person?.phone_carrier ?? '' },
    { label: t('person.sections.address'), value: address },
    { label: t('person.fields.campus'), value: person?.campus ?? row?.campus ?? '' },
    { label: t('person.fields.school'), value: person?.school ?? '' },
  ].filter((line) => line.value);
  const badgeLabel = { archived: t('list.archived'), inviteSent: t('list.inviteSent'), noLogin: t('list.noLogin') } as const;
  const role = person?.membership?.role ?? row?.role ?? null;

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.stack]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.hero}>
          <Avatar name={name} url={person?.avatar_url ?? row?.avatar_url} size={56} />
          <Text style={styles.title}>{name}</Text>
          <View style={styles.tags}>
            {role ? <Tag label={t(`common:roles.${role}`)} accent={theme.accent.blue} /> : null}
            {row
              ? directoryBadges(row).map((badge) => (
                  <Tag key={badge} label={badgeLabel[badge]} accent={badge === 'archived' ? theme.accent.yellow : theme.accent.neutral} />
                ))
              : null}
            {isSelf ? <Tag label={t('mobileDirectory.you')} accent={theme.accent.green} /> : null}
          </View>
        </View>

        {archived ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            {t('person.archivedSubtitle')}
          </Text>
        ) : null}

        <Card>
          <Label>{t('mobileDirectory.details')}</Label>
          {lines.length ? (
            lines.map((line) => (
              <View key={line.label} style={styles.line}>
                <Text style={styles.muted}>{line.label}</Text>
                <Text style={styles.body} selectable>
                  {line.value}
                </Text>
              </View>
            ))
          ) : null}
          {!person ? <Text style={styles.muted}>{t('mobileDirectory.privateRecord')}</Text> : null}
          {isSelf ? (
            <>
              <Text style={styles.muted}>{t('mobileDirectory.selfHint')}</Text>
              <Button title={t('mobileDirectory.editMyProfile')} variant="secondary" onPress={() => router.navigate('/(tabs)/profile')} />
            </>
          ) : null}
        </Card>

        {person && canManagePeople ? (
          <Card>
            <Label>{t('mobileDirectory.editRecord')}</Label>
            {editing && draft ? (
              <>
                <Field label={t('person.fields.firstName')} value={draft.first_name} onChangeText={(value) => setDraft({ ...draft, first_name: value })} />
                <Field label={t('person.fields.lastName')} value={draft.last_name} onChangeText={(value) => setDraft({ ...draft, last_name: value })} />
                {contactIsLoginManaged(person) ? (
                  <Text style={styles.muted}>{t('mobileDirectory.contactLoginManaged')}</Text>
                ) : (
                  <>
                    <Field
                      label={t('person.fields.email')}
                      value={draft.email}
                      onChangeText={(value) => setDraft({ ...draft, email: value })}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Field
                      label={t('person.fields.phone')}
                      value={draft.phone}
                      onChangeText={(value) => setDraft({ ...draft, phone: value })}
                      keyboardType="phone-pad"
                    />
                  </>
                )}
                <Field label={t('person.fields.campus')} value={draft.campus} onChangeText={(value) => setDraft({ ...draft, campus: value })} />
                <Text style={styles.muted}>{t('mobileDirectory.moreOnWebsite')}</Text>
                <ErrorNotice error={save.error} />
                <View style={styles.actions}>
                  <Button
                    title={t('common:actions.cancel')}
                    variant="secondary"
                    onPress={() => {
                      save.reset();
                      setEditing(false);
                      setDraft(personEditDraft(person));
                    }}
                  />
                  <Button title={t('common:actions.saveChanges')} loading={save.isPending} disabled={!draft.first_name.trim()} onPress={submitEdit} />
                </View>
              </>
            ) : (
              <Button title={t('common:actions.edit')} variant="secondary" icon="pencil" onPress={() => setEditing(true)} />
            )}
          </Card>
        ) : null}

        <Card>
          <Label>{t('teams:teamsPage.title')}</Label>
          {teams.isLoading ? <Loading /> : null}
          <ErrorNotice error={teams.error ?? removeMembership.error} />
          {memberships.length ? (
            memberships.map((membership, index) => {
              const team = teams.data?.find((entry) => entry.id === membership.teamId);
              const manageable = team ? canEditRoster(teamManageTarget(team)) : false;
              return (
                <View key={membership.membershipId} style={styles.memberRow}>
                  <View style={styles.flex}>
                    <ListRow divided={index > 0} showChevron onPress={() => router.push({ pathname: '/teams/[id]', params: { id: membership.teamId } })}>
                      <View style={styles.teamLine}>
                        <View style={[styles.swatch, { backgroundColor: membership.teamColor }]} />
                        <Text style={styles.body}>
                          {membership.positionName ? `${membership.teamName} · ${membership.positionName}` : membership.teamName}
                        </Text>
                      </View>
                    </ListRow>
                  </View>
                  {manageable ? (
                    <IconButton
                      name="trash"
                      accessibilityLabel={t('teams:mobileTeams.removeLabel', { name, team: membership.teamName })}
                      disabled={removeMembership.isPending}
                      onPress={() => confirmRemove(membership)}
                    />
                  ) : null}
                </View>
              );
            })
          ) : teams.isLoading ? null : (
            <Text style={styles.muted}>{t('mobileDirectory.noTeams')}</Text>
          )}
        </Card>

        <Card>
          <Label>{t('policy.tags')}</Label>
          <ErrorNotice error={tags.error} />
          {canManagePeople && tagDraft !== null ? (
            <>
              <Field
                accessibilityLabel={t('policy.tags')}
                value={tagDraft}
                onChangeText={setTagDraft}
                placeholder={t('policy.tagsPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ErrorNotice error={saveTags.error} />
              <View style={styles.actions}>
                <Button title={t('common:actions.cancel')} variant="secondary" onPress={() => { saveTags.reset(); setTagDraft(null); }} />
                <Button title={t('policy.saveTags')} loading={saveTags.isPending} onPress={submitTags} />
              </View>
            </>
          ) : (
            <>
              {tags.data?.length ? (
                <View style={styles.tags}>
                  {tags.data.map((tag) => (
                    <Tag key={tag} label={tag} accent={theme.accent.neutral} />
                  ))}
                </View>
              ) : tags.isLoading ? (
                <Loading />
              ) : (
                <Text style={styles.muted}>{t('mobileDirectory.noTags')}</Text>
              )}
              {canManagePeople && tags.data ? (
                <Button title={t('mobileDirectory.editTags')} variant="secondary" onPress={() => setTagDraft(tagText(tags.data))} />
              ) : null}
            </>
          )}
        </Card>

        {person && canManagePeople ? (
          <View style={styles.stack}>
            <ErrorNotice error={lifecycle.error} />
            <Button
              title={archived ? t('common:actions.restore') : t('common:actions.archive')}
              variant={archived ? 'secondary' : 'danger'}
              loading={lifecycle.isPending}
              onPress={confirmLifecycle}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    stack: { gap: theme.space.lg },
    hero: { alignItems: 'center', gap: theme.space.sm },
    title: { ...theme.type.title, color: theme.color.ink, textAlign: 'center' },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.space.xs },
    line: { gap: 2, marginBottom: theme.space.sm },
    actions: { flexDirection: 'row', gap: theme.space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    teamLine: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    swatch: { width: 10, height: 10, borderRadius: 5 },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
