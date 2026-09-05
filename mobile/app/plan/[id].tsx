import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
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
import { Avatar, Badge, Button, Card, ErrorNotice, Loading, SectionTitle } from '../../src/components/ui';
import { statusColors, theme } from '../../src/lib/theme';

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, organizationId } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const plan = useQuery({
    queryKey: ['plan', organizationId, id],
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && organizationId),
  });

  const respond = useMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: 'confirmed' | 'declined' }) =>
      api.respondToAssignment(assignmentId, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plan', organizationId, id] });
      void queryClient.invalidateQueries({ queryKey: ['schedule', organizationId] });
    },
  });

  if (plan.isLoading) return <Loading />;
  if (plan.error) return <ErrorNotice error={plan.error} />;
  if (!plan.data) return null;

  const detail = plan.data;
  const mine = detail.assignments.find((a) => a.user_id === user?.profile.id);

  const teams = detail.assignments.reduce<Map<string, AssignmentDetail[]>>((groups, assignment) => {
    const key = assignment.team?.name ?? 'Unassigned';
    groups.set(key, [...(groups.get(key) ?? []), assignment]);
    return groups;
  }, new Map());

  return (
    <>
      <Stack.Screen options={{ title: detail.title }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <Text style={styles.title}>{detail.title}</Text>
          <Text style={styles.subtitle}>{formatDateTime(detail.service_date)}</Text>
          {detail.location && <Text style={styles.subtitle}>{detail.location}</Text>}
          <Text style={styles.runtime}>
            {formatDuration(detail.total_length_seconds)} programmed · {detail.counts.songs} songs
          </Text>

          {detail.times.length > 0 && (
            <View style={styles.times}>
              {detail.times.map((time) => (
                <View
                  key={time.id}
                  style={[
                    styles.timeChip,
                    {
                      backgroundColor:
                        time.kind === 'service' ? theme.colors.brandSoft : theme.colors.warningSoft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.timeText,
                      { color: time.kind === 'service' ? theme.colors.brand : theme.colors.warning },
                    ]}
                  >
                    {time.name ?? time.kind} · {formatDateTime(time.starts_at)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {mine && mine.status === 'unconfirmed' && (
          <Card style={styles.card}>
            <SectionTitle>You’re invited</SectionTitle>
            <Text style={styles.muted}>
              {mine.team?.name}
              {mine.position ? ` — ${mine.position.name}` : ''}
            </Text>
            <ErrorNotice error={respond.error} />
            <View style={styles.actions}>
              <Button
                title="Decline"
                variant="secondary"
                style={styles.flex}
                loading={respond.isPending}
                onPress={() => respond.mutate({ assignmentId: mine.id, status: 'declined' })}
              />
              <Button
                title="Accept"
                style={styles.flex}
                loading={respond.isPending}
                onPress={() => respond.mutate({ assignmentId: mine.id, status: 'confirmed' })}
              />
            </View>
          </Card>
        )}

        <Card style={styles.card}>
          <SectionTitle>Order of service</SectionTitle>
          {detail.items.map((item, index) =>
            item.item_type === 'header' ? (
              <Text key={item.id} style={styles.header}>
                {item.title}
              </Text>
            ) : (
              <Pressable
                key={item.id}
                disabled={!item.song}
                onPress={() => item.song && router.push(`/song/${item.song.id}`)}
                style={styles.item}
              >
                <Text style={styles.itemIndex}>{index + 1}</Text>
                <View style={styles.flex}>
                  <Text style={[styles.itemTitle, item.song && styles.link]}>{item.title}</Text>
                  {item.description && <Text style={styles.itemNote}>{item.description}</Text>}
                </View>
                {item.item_type === 'song' && (
                  <Text style={styles.itemKey}>
                    {item.key_override ?? item.arrangement?.song_key ?? item.song?.default_key ?? '—'}
                  </Text>
                )}
                <Text style={styles.itemLength}>{formatDuration(item.length_seconds)}</Text>
              </Pressable>
            ),
          )}
          {detail.items.length === 0 && <Text style={styles.muted}>Nothing in the order yet.</Text>}
        </Card>

        <Card style={styles.card}>
          <SectionTitle>Team</SectionTitle>
          {[...teams.entries()].map(([teamName, assignments]) => (
            <View key={teamName} style={styles.teamGroup}>
              <Text style={styles.teamName}>{teamName}</Text>
              {assignments.map((assignment) => {
                const tone = statusColors[assignment.status];
                return (
                  <View key={assignment.id} style={styles.person}>
                    <Avatar name={assignment.person?.full_name ?? assignment.person?.email} size={30} />
                    <View style={styles.flex}>
                      <Text style={styles.personName}>
                        {assignment.person?.full_name ?? assignment.person?.email ?? 'Unknown'}
                      </Text>
                      {assignment.position && (
                        <Text style={styles.personRole}>{assignment.position.name}</Text>
                      )}
                    </View>
                    <Badge label={ASSIGNMENT_STATUS_LABELS[assignment.status]} bg={tone.bg} fg={tone.fg} />
                  </View>
                );
              })}
            </View>
          ))}
          {detail.assignments.length === 0 && <Text style={styles.muted}>Nobody scheduled yet.</Text>}
        </Card>

        {detail.notes && (
          <Card style={styles.card}>
            <SectionTitle>Notes</SectionTitle>
            <Text style={styles.muted}>{detail.notes}</Text>
          </Card>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  card: { gap: 8 },
  flex: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textMuted },
  runtime: { fontSize: 13, color: theme.colors.textFaint },
  times: { gap: 6, marginTop: 6 },
  timeChip: { borderRadius: theme.radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  timeText: { fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  header: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.colors.textFaint,
    marginTop: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  itemIndex: { width: 18, fontSize: 12, color: theme.colors.textFaint, textAlign: 'right' },
  itemTitle: { fontSize: 15, color: theme.colors.text },
  link: { color: theme.colors.brand, fontWeight: '600' },
  itemNote: { fontSize: 12, color: theme.colors.textMuted },
  itemKey: { fontSize: 13, fontWeight: '700', color: theme.colors.brand, width: 32, textAlign: 'center' },
  itemLength: { fontSize: 13, color: theme.colors.textFaint, width: 46, textAlign: 'right' },
  teamGroup: { gap: 6, marginBottom: 10 },
  teamName: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  personName: { fontSize: 14, color: theme.colors.text },
  personRole: { fontSize: 12, color: theme.colors.textMuted },
  muted: { color: theme.colors.textMuted, fontSize: 14 },
});
