import { useCallback, useMemo, useState } from 'react';
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
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorNotice,
  Loading,
  Screen,
  ScreenHeader,
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

export default function MyScheduleScreen() {
  const { organizationId } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const schedule = useQuery({
    queryKey: ['schedule', organizationId],
    queryFn: () => api.mySchedule(),
    enabled: Boolean(organizationId),
  });

  const respond = useMutation({
    mutationFn: ({ assignmentId, status }: RespondInput) =>
      api.respondToAssignment(assignmentId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule', organizationId] }),
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await schedule.refetch();
    setRefreshing(false);
  }, [schedule]);

  const entries = useMemo(() => schedule.data ?? [], [schedule.data]);
  const awaiting = entries.filter((entry) => entry.assignment.status === 'unconfirmed').length;

  const summary = entries.length
    ? `${entries.length} upcoming${awaiting ? ` · ${awaiting} awaiting your reply` : ''}`
    : undefined;

  return (
    <Screen safeTop>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.assignment.id}
        contentContainerStyle={screenPadding(theme)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.color.inkFaint}
          />
        }
        ListHeaderComponent={
          <View>
            <ScreenHeader
              eyebrow={summary}
              title="Where you're serving"
              description="Everything you have been scheduled for, newest first."
            />
            <ErrorNotice error={schedule.error ?? respond.error} />
          </View>
        }
        ListEmptyComponent={
          schedule.isLoading ? (
            <Loading label="Loading your schedule" />
          ) : (
            <EmptyState
              title="Nothing scheduled"
              description="When someone puts you on a plan it lands here, and you can accept or decline without leaving this screen."
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <ScheduleCard
              entry={item}
              onOpen={() => router.push(`/plan/${item.plan.id}`)}
              onRespond={(status) =>
                respond.mutate({ assignmentId: item.assignment.id, status })
              }
              busy={respond.isPending}
            />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface ScheduleCardProps {
  entry: MyScheduleEntry;
  onOpen: () => void;
  onRespond: (status: ResponseStatus) => void;
  busy: boolean;
}

const ScheduleCard = ({ entry, onOpen, onRespond, busy }: ScheduleCardProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = statusAccent(theme, entry.assignment.status);
  const rehearsal = entry.times.find((time) => time.kind === 'rehearsal');
  const needsReply = entry.assignment.status === 'unconfirmed';

  const details = [entry.position?.name, entry.plan.location].filter(Boolean).join(' · ');

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => (pressed ? { opacity: 0.65 } : null)}
      >
        <View style={styles.topRow}>
          <Text style={styles.date}>{formatDateTime(entry.plan.service_date).toUpperCase()}</Text>
          <Tag label={ASSIGNMENT_STATUS_LABELS[entry.assignment.status]} accent={accent} />
        </View>

        <Text style={styles.title}>{entry.plan.title}</Text>

        <View style={styles.metaRow}>
          {entry.team ? (
            <View style={styles.teamChip}>
              <View style={[styles.dot, { backgroundColor: entry.team.color }]} />
              <Text style={styles.meta}>{entry.team.name}</Text>
            </View>
          ) : null}
          {details ? <Text style={styles.meta}>{details}</Text> : null}
        </View>

        {rehearsal ? (
          <Text style={styles.rehearsal}>
            Rehearsal {formatDate(rehearsal.starts_at)},{' '}
            {new Date(rehearsal.starts_at).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        ) : null}
      </Pressable>

      {needsReply ? (
        <View style={styles.actions}>
          <Divider bleed={theme.space.xl} />
          <View style={styles.actionRow}>
            <Button
              title="Decline"
              variant="secondary"
              onPress={() => onRespond('declined')}
              loading={busy}
              style={styles.flex}
            />
            <Button
              title="Accept"
              icon="check"
              onPress={() => onRespond('confirmed')}
              loading={busy}
              style={styles.flex}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
      marginBottom: theme.space.md,
    },
    date: { ...theme.type.label, color: theme.color.inkMuted, flex: 1 },
    title: { ...theme.type.title, color: theme.color.ink },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.space.md,
      marginTop: theme.space.md,
    },
    teamChip: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    dot: { width: 7, height: 7, borderRadius: theme.radius.pill },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    rehearsal: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, marginTop: theme.space.sm },
    actions: { gap: theme.space.lg },
    actionRow: { flexDirection: 'row', gap: theme.space.md },
  });
