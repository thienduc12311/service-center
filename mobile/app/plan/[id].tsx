import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_STATUS_LABELS,
  formatDateTime,
  formatDuration,
  type AssignmentDetail,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Divider,
  ErrorNotice,
  KeyCap,
  Label,
  Loading,
  Screen,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import { Reveal } from '../../src/components/motion';
import { statusAccent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

type ResponseStatus = 'confirmed' | 'declined';

interface RespondInput {
  assignmentId: string;
  status: ResponseStatus;
}

/** One team, and everyone on it for this plan. */
interface TeamGroup {
  name: string;
  assignments: AssignmentDetail[];
}

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, organizationId } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const plan = useQuery({
    queryKey: ['plan', organizationId, id],
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && organizationId),
  });

  const respond = useMutation({
    mutationFn: ({ assignmentId, status }: RespondInput) =>
      api.respondToAssignment(assignmentId, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan', organizationId, id] });
      void queryClient.invalidateQueries({ queryKey: ['schedule', organizationId] });
    },
  });

  const detail = plan.data;

  const teams = useMemo<TeamGroup[]>(() => {
    const groups = new Map<string, AssignmentDetail[]>();
    for (const assignment of detail?.assignments ?? []) {
      const key = assignment.team?.name ?? 'Unassigned';
      groups.set(key, [...(groups.get(key) ?? []), assignment]);
    }
    return [...groups.entries()].map(([name, assignments]) => ({ name, assignments }));
  }, [detail?.assignments]);

  if (plan.isLoading) {
    return (
      <Screen>
        <Loading label="Opening the plan" />
      </Screen>
    );
  }
  if (plan.error) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <ErrorNotice error={plan.error} />
        </View>
      </Screen>
    );
  }
  if (!detail) return null;

  const mine = detail.assignments.find((assignment) => assignment.user_id === user?.profile.id);

  return (
    <Screen>
      <Stack.Screen options={{ title: detail.title }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Reveal>
          <View style={styles.hero}>
            <Text style={styles.heroDate}>
              {formatDateTime(detail.service_date).toUpperCase()}
            </Text>
            <Text style={styles.heroTitle}>{detail.title}</Text>
            <Text style={styles.heroMeta}>
              {[
                detail.location,
                `${formatDuration(detail.total_length_seconds)} programmed`,
                `${detail.counts.songs} songs`,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>

            {detail.times.length ? (
              <View style={styles.times}>
                {detail.times.map((time) => (
                  <Tag
                    key={time.id}
                    label={`${time.name ?? time.kind} · ${formatDateTime(time.starts_at)}`}
                    accent={time.kind === 'service' ? theme.accent.blue : theme.accent.yellow}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Reveal>

        {mine && mine.status === 'unconfirmed' ? (
          <Reveal index={1}>
            <Card>
              <Label>Awaiting your reply</Label>
              <Text style={styles.inviteText}>
                {[mine.team?.name, mine.position?.name].filter(Boolean).join(' — ')}
              </Text>
              <ErrorNotice error={respond.error} />
              <View style={styles.actionRow}>
                <Button
                  title="Decline"
                  variant="secondary"
                  style={styles.flex}
                  loading={respond.isPending}
                  onPress={() => respond.mutate({ assignmentId: mine.id, status: 'declined' })}
                />
                <Button
                  title="Accept"
                  icon="check"
                  style={styles.flex}
                  loading={respond.isPending}
                  onPress={() => respond.mutate({ assignmentId: mine.id, status: 'confirmed' })}
                />
              </View>
            </Card>
          </Reveal>
        ) : null}

        <Reveal index={2}>
          <Card>
            <Label>Order of service</Label>
            {detail.items.length ? (
              <View>
                {detail.items.map((item, index) =>
                  item.item_type === 'header' ? (
                    <Text key={item.id} style={styles.orderHeader}>
                      {item.title.toUpperCase()}
                    </Text>
                  ) : (
                    <View key={item.id}>
                      {index > 0 ? <Divider /> : null}
                      <Pressable
                        accessibilityRole="button"
                        disabled={!item.song}
                        onPress={() => item.song && router.push(`/song/${item.song.id}`)}
                        style={({ pressed }) => [
                          styles.orderItem,
                          pressed ? { opacity: 0.6 } : null,
                        ]}
                      >
                        <Text style={styles.ordinal}>
                          {String(index + 1).padStart(2, '0')}
                        </Text>
                        <View style={styles.flex}>
                          <Text style={[styles.itemTitle, item.song ? styles.itemLink : null]}>
                            {item.title}
                          </Text>
                          {item.description ? (
                            <Text style={styles.itemNote}>{item.description}</Text>
                          ) : null}
                        </View>
                        {item.item_type === 'song' ? (
                          <KeyCap>
                            {item.key_override ??
                              item.arrangement?.song_key ??
                              item.song?.default_key ??
                              '—'}
                          </KeyCap>
                        ) : null}
                        <Text style={styles.itemLength}>{formatDuration(item.length_seconds)}</Text>
                      </Pressable>
                    </View>
                  ),
                )}
              </View>
            ) : (
              <Text style={styles.muted}>Nothing has been added to the order yet.</Text>
            )}
          </Card>
        </Reveal>

        <Reveal index={3}>
          <Card>
            <Label>Who is serving</Label>
            {teams.length ? (
              teams.map((group) => (
                <View key={group.name} style={styles.teamGroup}>
                  <Text style={styles.teamName}>{group.name}</Text>
                  {group.assignments.map((assignment) => (
                    <View key={assignment.id} style={styles.person}>
                      <Avatar
                        name={assignment.person?.full_name ?? assignment.person?.email}
                        size={32}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.personName}>
                          {assignment.person?.full_name ?? assignment.person?.email ?? 'Unknown'}
                        </Text>
                        {assignment.position ? (
                          <Text style={styles.personRole}>{assignment.position.name}</Text>
                        ) : null}
                      </View>
                      <Tag
                        label={ASSIGNMENT_STATUS_LABELS[assignment.status]}
                        accent={statusAccent(theme, assignment.status)}
                      />
                    </View>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.muted}>Nobody is scheduled yet.</Text>
            )}
          </Card>
        </Reveal>

        {detail.notes ? (
          <Reveal index={4}>
            <Card>
              <Label>Notes</Label>
              <Text style={styles.notes}>{detail.notes}</Text>
            </Card>
          </Reveal>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    errorWrap: { padding: theme.space.xl },

    hero: { gap: theme.space.sm },
    heroDate: { ...theme.type.label, color: theme.color.inkMuted },
    heroTitle: { ...theme.type.display, color: theme.color.ink },
    heroMeta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    times: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.md },

    inviteText: { ...theme.type.body, color: theme.color.ink },
    actionRow: { flexDirection: 'row', gap: theme.space.md },

    orderHeader: {
      ...theme.type.label,
      color: theme.color.inkFaint,
      marginTop: theme.space.xl,
      marginBottom: theme.space.sm,
    },
    orderItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    ordinal: { ...theme.type.numeric, color: theme.color.inkFaint },
    itemTitle: { ...theme.type.body, color: theme.color.ink },
    itemLink: { fontFamily: theme.type.heading.fontFamily },
    itemNote: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    itemLength: { ...theme.type.numeric, color: theme.color.inkFaint, width: 46, textAlign: 'right' },

    teamGroup: { gap: theme.space.md },
    teamName: { ...theme.type.heading, color: theme.color.ink },
    person: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    personName: { ...theme.type.body, color: theme.color.ink },
    personRole: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    notes: { ...theme.type.body, color: theme.color.inkMuted },
  });
