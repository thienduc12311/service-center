import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_STATUS_LABELS,
  formatDate,
  formatDateTime,
  type MyScheduleEntry,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorNotice, Loading } from '../../src/components/ui';
import { statusColors, theme } from '../../src/lib/theme';

export default function MyScheduleScreen() {
  const { organizationId } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const schedule = useQuery({
    queryKey: ['schedule', organizationId],
    queryFn: () => api.mySchedule(),
    enabled: Boolean(organizationId),
  });

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'declined' }) =>
      api.respondToAssignment(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule', organizationId] }),
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await schedule.refetch();
    setRefreshing(false);
  }, [schedule]);

  if (schedule.isLoading) return <Loading label="Loading your schedule…" />;

  return (
    <FlatList
      data={schedule.data ?? []}
      keyExtractor={(entry) => entry.assignment.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListHeaderComponent={<ErrorNotice error={schedule.error ?? respond.error} />}
      ListEmptyComponent={
        <EmptyState
          title="Nothing scheduled"
          description="When someone schedules you, it shows up here and you can accept or decline."
        />
      }
      renderItem={({ item }) => (
        <ScheduleCard
          entry={item}
          onOpen={() => router.push(`/plan/${item.plan.id}`)}
          onRespond={(status) => respond.mutate({ id: item.assignment.id, status })}
          busy={respond.isPending}
        />
      )}
    />
  );
}

const ScheduleCard = ({
  entry,
  onOpen,
  onRespond,
  busy,
}: {
  entry: MyScheduleEntry;
  onOpen: () => void;
  onRespond: (status: 'confirmed' | 'declined') => void;
  busy: boolean;
}) => {
  const tone = statusColors[entry.assignment.status];
  const rehearsal = entry.times.find((time) => time.kind === 'rehearsal');

  return (
    <Card style={styles.card}>
      <Pressable onPress={onOpen}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.title}>{entry.plan.title}</Text>
            <Text style={styles.subtitle}>{formatDateTime(entry.plan.service_date)}</Text>
          </View>
          <Badge label={ASSIGNMENT_STATUS_LABELS[entry.assignment.status]} bg={tone.bg} fg={tone.fg} />
        </View>

        <View style={styles.metaRow}>
          {entry.team && (
            <View style={styles.teamChip}>
              <View style={[styles.dot, { backgroundColor: entry.team.color }]} />
              <Text style={styles.meta}>{entry.team.name}</Text>
            </View>
          )}
          {entry.position && <Text style={styles.meta}>{entry.position.name}</Text>}
          {entry.plan.location && <Text style={styles.meta}>{entry.plan.location}</Text>}
        </View>

        {rehearsal && (
          <Text style={styles.rehearsal}>
            Rehearsal · {formatDate(rehearsal.starts_at)}{' '}
            {new Date(rehearsal.starts_at).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        )}
      </Pressable>

      {entry.assignment.status === 'unconfirmed' && (
        <View style={styles.actions}>
          <Button
            title="Decline"
            variant="secondary"
            onPress={() => onRespond('declined')}
            loading={busy}
            style={styles.flex}
          />
          <Button title="Accept" onPress={() => onRespond('confirmed')} loading={busy} style={styles.flex} />
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: { gap: 10 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  teamChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  meta: { fontSize: 13, color: theme.colors.textMuted },
  rehearsal: { fontSize: 13, color: theme.colors.warning },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
