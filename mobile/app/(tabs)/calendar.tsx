import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  addMonths,
  endOfMonth,
  formatDate,
  formatTime,
  startOfMonth,
  toISODate,
  type CalendarEvent,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import { Badge, EmptyState, ErrorNotice, Loading } from '../../src/components/ui';
import { statusColors, theme } from '../../src/lib/theme';

/**
 * An agenda grouped by day reads far better on a phone than a month grid, so
 * mobile shows the same data in list form.
 */
export default function CalendarScreen() {
  const { organizationId } = useAuth();
  const router = useRouter();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [mineOnly, setMineOnly] = useState(false);

  const range = useMemo(
    () => ({ from: startOfMonth(cursor).toISOString(), to: endOfMonth(cursor).toISOString() }),
    [cursor],
  );

  const calendar = useQuery({
    queryKey: ['calendar', organizationId, range, mineOnly],
    queryFn: () => api.calendar({ ...range, ...(mineOnly ? { mine: true } : {}) }),
    enabled: Boolean(organizationId),
  });

  const sections = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();
    for (const event of calendar.data ?? []) {
      const key = toISODate(event.starts_at);
      const list = groups.get(key);
      if (list) list.push(event);
      else groups.set(key, [event]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ title: date, data }));
  }, [calendar.data]);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => setCursor(startOfMonth(addMonths(cursor, -1)))} style={styles.navButton}>
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{formatDate(cursor, { month: 'long', year: 'numeric' })}</Text>
        <Pressable onPress={() => setCursor(startOfMonth(addMonths(cursor, 1)))} style={styles.navButton}>
          <Text style={styles.navText}>›</Text>
        </Pressable>
        <View style={styles.mineToggle}>
          <Text style={styles.mineLabel}>Mine</Text>
          <Switch value={mineOnly} onValueChange={setMineOnly} />
        </View>
      </View>

      <ErrorNotice error={calendar.error} />

      {calendar.isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(event) => event.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={<EmptyState title="Nothing scheduled this month" />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>
              {formatDate(`${section.title}T12:00:00`, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable style={styles.event} onPress={() => router.push(`/plan/${item.plan_id}`)}>
              <View
                style={[
                  styles.kindBar,
                  { backgroundColor: item.kind === 'service' ? theme.colors.brand : theme.colors.warning },
                ]}
              />
              <View style={styles.flex}>
                <Text style={styles.eventTitle}>{item.title}</Text>
                <Text style={styles.eventTime}>
                  {formatTime(item.starts_at)} – {formatTime(item.ends_at)}
                  {item.location ? ` · ${item.location}` : ''}
                </Text>
              </View>
              {item.my_assignment_status && (
                <Badge
                  label={item.my_assignment_status}
                  bg={statusColors[item.my_assignment_status].bg}
                  fg={statusColors[item.my_assignment_status].fg}
                />
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  navButton: { paddingHorizontal: 10, paddingVertical: 4 },
  navText: { fontSize: 22, color: theme.colors.brand, lineHeight: 24 },
  month: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  mineToggle: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  mineLabel: { fontSize: 13, color: theme.colors.textMuted },
  list: { padding: 16, paddingBottom: 32 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textMuted,
    marginTop: 16,
    marginBottom: 6,
  },
  event: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    marginBottom: 8,
  },
  kindBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  eventTime: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
});
