import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
import {
  Card,
  Divider,
  EmptyState,
  ErrorNotice,
  IconButton,
  Loading,
  Screen,
  SegmentedControl,
  Tag,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { Reveal } from '../../src/components/motion';
import { statusAccent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

type CalendarScope = 'all' | 'mine';

const SCOPES: readonly SegmentOption<CalendarScope>[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'mine', label: 'Only me' },
];

/** One day, and everything happening on it. */
interface AgendaDay {
  isoDate: string;
  events: CalendarEvent[];
}

/**
 * An agenda grouped by day reads far better on a phone than a month grid, so
 * mobile shows the same data as a run of dated cards.
 */
export default function CalendarScreen() {
  const { organizationId } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [scope, setScope] = useState<CalendarScope>('all');

  const range = useMemo(
    () => ({ from: startOfMonth(cursor).toISOString(), to: endOfMonth(cursor).toISOString() }),
    [cursor],
  );

  const calendar = useQuery({
    queryKey: ['calendar', organizationId, range, scope],
    queryFn: () => api.calendar({ ...range, ...(scope === 'mine' ? { mine: true } : {}) }),
    enabled: Boolean(organizationId),
  });

  const days = useMemo<AgendaDay[]>(() => {
    const groups = new Map<string, CalendarEvent[]>();
    for (const event of calendar.data ?? []) {
      const key = toISODate(event.starts_at);
      const list = groups.get(key);
      if (list) list.push(event);
      else groups.set(key, [event]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([isoDate, events]) => ({ isoDate, events }));
  }, [calendar.data]);

  return (
    <Screen safeTop>
      <NotificationBell />
      <View style={styles.toolbar}>
        <View style={styles.monthRow}>
          <View style={styles.monthLabel}>
            <Text style={styles.monthName}>{formatDate(cursor, { month: 'long' })}</Text>
            <Text style={styles.monthYear}>{formatDate(cursor, { year: 'numeric' })}</Text>
          </View>
          <IconButton
            name="chevronLeft"
            accessibilityLabel="Previous month"
            onPress={() => setCursor(startOfMonth(addMonths(cursor, -1)))}
          />
          <IconButton
            name="chevronRight"
            accessibilityLabel="Next month"
            onPress={() => setCursor(startOfMonth(addMonths(cursor, 1)))}
          />
        </View>
        <SegmentedControl options={SCOPES} value={scope} onChange={setScope} />
      </View>

      <FlatList
        data={days}
        keyExtractor={(day) => day.isoDate}
        contentContainerStyle={screenPadding(theme)}
        ListHeaderComponent={<ErrorNotice error={calendar.error} />}
        ListEmptyComponent={
          calendar.isLoading ? (
            <Loading />
          ) : (
            <EmptyState
              title="An open month"
              description={`Nothing is on the calendar for ${formatDate(cursor, { month: 'long', year: 'numeric' })}.`}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <AgendaDayCard day={item} onOpen={(planId) => router.push(`/plan/${planId}`)} />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface AgendaDayCardProps {
  day: AgendaDay;
  onOpen: (planId: string) => void;
}

const AgendaDayCard = ({ day, onOpen }: AgendaDayCardProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const date = `${day.isoDate}T12:00:00`;

  return (
    <Card>
      <View style={styles.dayHeader}>
        <Text style={styles.dayNumber}>{formatDate(date, { day: 'numeric' })}</Text>
        <View>
          <Text style={styles.dayWeekday}>
            {formatDate(date, { weekday: 'long' }).toUpperCase()}
          </Text>
          <Text style={styles.dayMonth}>{formatDate(date, { month: 'long' })}</Text>
        </View>
      </View>

      <View>
        {day.events.map((event, index) => (
          <View key={event.id}>
            {index > 0 ? <Divider /> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpen(event.plan_id)}
              style={({ pressed }) => [styles.event, pressed ? { opacity: 0.6 } : null]}
            >
              <View
                style={[
                  styles.kindBar,
                  {
                    backgroundColor:
                      event.kind === 'service' ? theme.color.ink : theme.accent.yellow.fg,
                  },
                ]}
              />
              <View style={styles.flex}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventTime}>
                  {formatTime(event.starts_at)} – {formatTime(event.ends_at)}
                  {event.location ? `  ${event.location}` : ''}
                </Text>
              </View>
              {event.my_assignment_status ? (
                <Tag
                  label={event.my_assignment_status}
                  accent={statusAccent(theme, event.my_assignment_status)}
                />
              ) : null}
            </Pressable>
          </View>
        ))}
      </View>
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },

    toolbar: {
      gap: theme.space.lg,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.xl,
      paddingBottom: theme.space.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border,
    },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    monthLabel: { flex: 1 },
    monthName: { ...theme.type.display, fontSize: 30, lineHeight: 34, color: theme.color.ink },
    monthYear: { ...theme.type.label, color: theme.color.inkFaint },

    dayHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    dayNumber: { ...theme.type.display, fontSize: 40, lineHeight: 42, color: theme.color.ink },
    dayWeekday: { ...theme.type.label, color: theme.color.ink },
    dayMonth: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    event: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    kindBar: { width: 2, alignSelf: 'stretch', borderRadius: 1 },
    eventTitle: { ...theme.type.heading, color: theme.color.ink },
    eventTime: { ...theme.type.numeric, color: theme.color.inkMuted, marginTop: 3 },
  });
