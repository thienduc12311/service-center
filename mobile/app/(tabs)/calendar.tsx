import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  addMonths,
  endOfMonth,
  startOfMonth,
  toISODate,
  type CalendarEvent,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
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
import { PressableScale, Reveal } from '../../src/components/motion';
import { statusAccent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

type CalendarScope = 'all' | 'mine';

const SCOPES: readonly CalendarScope[] = ['all', 'mine'];

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
  const { queryScope } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [scope, setScope] = useState<CalendarScope>('all');
  const { t } = useTranslation('scheduling');
  const f = useFormatters();
  const scopeOptions = useMemo<readonly SegmentOption<CalendarScope>[]>(
    () => SCOPES.map((value) => ({ value, label: t(`calendar.scope.${value}`) })),
    [t],
  );

  const range = useMemo(
    () => ({ from: startOfMonth(cursor).toISOString(), to: endOfMonth(cursor).toISOString() }),
    [cursor],
  );

  const calendar = useQuery({
    queryKey: queryKeys.calendar(queryScope, range, scope),
    queryFn: () => api.calendar({ ...range, ...(scope === 'mine' ? { mine: true } : {}) }),
    enabled: Boolean(queryScope),
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
            <Text style={styles.monthName}>{f.months('long')[cursor.getMonth()]}</Text>
            <Text style={styles.monthYear}>{f.number(cursor.getFullYear(), { useGrouping: false })}</Text>
          </View>
          <IconButton
            name="chevronLeft"
            accessibilityLabel={t('calendar.previousMonth')}
            onPress={() => setCursor(startOfMonth(addMonths(cursor, -1)))}
          />
          <IconButton
            name="chevronRight"
            accessibilityLabel={t('calendar.nextMonth')}
            onPress={() => setCursor(startOfMonth(addMonths(cursor, 1)))}
          />
        </View>
        <SegmentedControl options={scopeOptions} value={scope} onChange={setScope} />
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
              title={t('calendar.openMonthTitle')}
              description={t('calendar.openMonthDescription', { month: f.date(cursor, 'monthYear') })}
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
  const { t } = useTranslation('common');
  const f = useFormatters();
  // Local noon of the civil day, as before, so the weekday never shifts.
  const date = new Date(`${day.isoDate}T12:00:00`);

  return (
    <Card>
      <View style={styles.dayHeader}>
        <Text style={styles.dayNumber}>{f.number(date.getDate())}</Text>
        <View>
          <Text style={styles.dayWeekday}>
            {f.weekdays('long')[date.getDay()]}
          </Text>
          <Text style={styles.dayMonth}>{f.months('long')[date.getMonth()]}</Text>
        </View>
      </View>

      <View>
        {day.events.map((event, index) => (
          <View key={event.id}>
            {index > 0 ? <Divider /> : null}
            <PressableScale
              onPress={() => onOpen(event.plan_id)}
              pressedOpacity={0.6}
              style={styles.event}
            >
              <View
                style={[
                  styles.kindBar,
                  {
                    backgroundColor:
                      event.kind === 'service' ? theme.color.brand : theme.accent.yellow.fg,
                  },
                ]}
              />
              <View style={styles.flex}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventTime}>
                  {t('format.dateRange', { start: f.time(event.starts_at), end: f.time(event.ends_at) })}
                  {event.location ? ` · ${event.location}` : ''}
                </Text>
              </View>
              {event.my_assignment_status ? (
                <Tag
                  label={t(`assignmentStatus.${event.my_assignment_status}`)}
                  accent={statusAccent(theme, event.my_assignment_status)}
                />
              ) : null}
            </PressableScale>
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
