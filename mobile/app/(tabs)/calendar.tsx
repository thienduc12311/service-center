import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  CALENDAR_LAYERS,
  DEFAULT_CALENDAR_FILTERS,
  addMonths,
  calendarLayersRequestFor,
  calendarQueryFor,
  endOfMonth,
  startOfMonth,
  toISODate,
  toggleCalendarLayer,
  withCalendarTeam,
  type CalendarFilters,
  type CalendarLayerEvent,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { agendaDays, type AgendaDay } from '../../src/lib/calendar-sharing';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Card,
  Chip,
  DateBadge,
  Divider,
  EmptyState,
  ErrorNotice,
  IconButton,
  Loading,
  Meta,
  Screen,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  Tag,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { Icon, type IconName } from '../../src/components/icons';
import { NotificationBell } from '../../src/components/NotificationBell';
import { PressableScale, Reveal } from '../../src/components/motion';
import { statusAccent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

type CalendarScope = 'all' | 'mine';

const SCOPES: readonly CalendarScope[] = ['all', 'mine'];

/**
 * An agenda grouped by day reads far better on a phone than a month grid, so
 * mobile shows the same data as a run of dated cards.
 */
export default function CalendarScreen() {
  const { queryScope, canAnywhere } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  // MOB-022: the website's filters and requests (shared helpers), so both
  // clients ask the server the same question and read back the same answer.
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_CALENDAR_FILTERS);
  const { t } = useTranslation(['scheduling', 'reports']);
  const f = useFormatters();
  const scopeOptions = useMemo<readonly SegmentOption<CalendarScope>[]>(
    () => SCOPES.map((value) => ({ value, label: t(`calendar.scope.${value}`) })),
    [t],
  );

  const range = useMemo(
    () => ({ from: startOfMonth(cursor).toISOString(), to: endOfMonth(cursor).toISOString() }),
    [cursor],
  );
  const calendarQuery = calendarQueryFor(filters, range);
  const layersQuery = calendarLayersRequestFor(filters, range);

  const calendar = useQuery({
    queryKey: queryKeys.calendar(queryScope, calendarQuery),
    queryFn: () => api.calendar(calendarQuery),
    enabled: Boolean(queryScope),
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  // F16 layers: only for a chosen team; the server decides which the viewer may see.
  const layers = useQuery({
    queryKey: queryKeys.calendarLayers(queryScope, layersQuery),
    queryFn: () => api.calendarLayers(layersQuery!),
    enabled: Boolean(queryScope && layersQuery),
  });

  const days = useMemo<AgendaDay[]>(
    () => agendaDays(calendar.data ?? [], layersQuery ? layers.data ?? [] : [], range),
    [calendar.data, layers.data, layersQuery, range],
  );
  const canRunReports = canAnywhere('scheduling.manage');

  const today = toISODate(new Date());
  const eventCount = days.reduce((total, day) => total + day.events.length, 0);

  return (
    <Screen safeTop>
      <FlatList
        data={days}
        keyExtractor={(day) => day.isoDate}
        contentContainerStyle={[screenPadding(theme), styles.list]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader
              title={t('calendar.title')}
              description={t('calendar.subtitle')}
              trailing={
                <View style={styles.headerActions}>
                  <IconButton
                    name="calendar"
                    accessibilityLabel={t('mobileSubscription.open')}
                    onPress={() => router.push('/calendar-subscription')}
                  />
                  {canRunReports ? (
                    <IconButton
                      name="document"
                      accessibilityLabel={t('reports:mobileReport.open')}
                      onPress={() => router.push('/schedule-report')}
                    />
                  ) : null}
                  <NotificationBell bar={false} />
                </View>
              }
            />

            <View style={styles.monthRow}>
              <IconButton
                name="chevronLeft"
                accessibilityLabel={t('calendar.previousMonth')}
                onPress={() => setCursor(startOfMonth(addMonths(cursor, -1)))}
              />
              <View style={styles.monthLabel} accessible accessibilityRole="header">
                <Text style={styles.monthName}>{f.months('long')[cursor.getMonth()]}</Text>
                <Text style={styles.monthYear}>{f.number(cursor.getFullYear(), { useGrouping: false })}</Text>
              </View>
              <IconButton
                name="chevronRight"
                accessibilityLabel={t('calendar.nextMonth')}
                onPress={() => setCursor(startOfMonth(addMonths(cursor, 1)))}
              />
            </View>

            <View style={styles.filters}>
              <SegmentedControl
                options={scopeOptions}
                value={filters.mine ? 'mine' : 'all'}
                onChange={(value) => setFilters({ ...filters, mine: value === 'mine' })}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityLabel={t('calendar.filterByTeam')}
                style={styles.chipScroller}
                contentContainerStyle={styles.chipRow}
              >
                <Chip
                  label={t('calendar.allTeams')}
                  active={!filters.teamId}
                  onPress={() => setFilters(withCalendarTeam(filters, null))}
                />
                {(teams.data ?? []).map((team) => (
                  <Chip
                    key={team.id}
                    label={team.name}
                    active={filters.teamId === team.id}
                    onPress={() => setFilters(withCalendarTeam(filters, team.id))}
                  />
                ))}
              </ScrollView>
              {filters.teamId ? (
                <View style={styles.chips} accessibilityLabel={t('layers.legend')}>
                  {CALENDAR_LAYERS.map((layer) => (
                    <Chip
                      key={layer}
                      toggle
                      label={t(`layers.label.${layer}`)}
                      active={filters.layers.includes(layer)}
                      onPress={() => setFilters(toggleCalendarLayer(filters, layer))}
                    />
                  ))}
                </View>
              ) : (
                <Meta>{t('layers.chooseTeam')}</Meta>
              )}
            </View>

            <ErrorNotice error={calendar.error ?? teams.error ?? layers.error} />
            {filters.layers.length && filters.teamId ? <Meta>{t('mobileCalendar.layersNote')}</Meta> : null}
            {days.length ? <SectionHeader title={f.date(cursor, 'monthYear')} count={eventCount} /> : null}
          </View>
        }
        ListEmptyComponent={
          calendar.isLoading ? (
            <Loading />
          ) : (
            <EmptyState
              icon="calendar"
              title={t('calendar.openMonthTitle')}
              description={t('calendar.openMonthDescription', { month: f.date(cursor, 'monthYear') })}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <AgendaDayCard
              day={item}
              past={item.isoDate < today}
              onOpen={(planId) => router.push(`/plan/${planId}`)}
            />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface AgendaDayCardProps {
  day: AgendaDay;
  /** Days before today are drawn muted. */
  past: boolean;
  onOpen: (planId: string) => void;
}

const AgendaDayCard = ({ day, past, onOpen }: AgendaDayCardProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  const f = useFormatters();
  // Local noon of the civil day, as before, so the weekday never shifts.
  const date = new Date(`${day.isoDate}T12:00:00`);

  return (
    <Card style={styles.dayCard}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={f.date(date, 'long')}
      >
        <DateBadge date={date.toISOString()} muted={past} />
      </View>

      <View style={styles.dayBody}>
        {day.layers.length ? (
          <View style={styles.layerList}>
            {day.layers.map((layer) => (
              <LayerRow key={`${layer.id}:${day.isoDate}`} event={layer} />
            ))}
          </View>
        ) : null}

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
              <View style={styles.eventBody}>
                <View style={styles.eventTitleRow}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  {event.my_assignment_status ? (
                    <Tag
                      label={t(`assignmentStatus.${event.my_assignment_status}`)}
                      accent={statusAccent(theme, event.my_assignment_status)}
                    />
                  ) : null}
                </View>
                <MetaItem
                  icon="clock"
                  label={t('format.dateRange', { start: f.time(event.starts_at), end: f.time(event.ends_at) })}
                />
                {event.location ? <MetaItem icon="mapPin" label={event.location} /> : null}
              </View>
            </PressableScale>
          </View>
        ))}
      </View>
    </Card>
  );
};

interface MetaItemProps {
  icon: IconName;
  label: string;
}

/** One line of supporting detail with a small leading glyph. */
const MetaItem = ({ icon, label }: MetaItemProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metaRow}>
      <Icon name={icon} size={14} color={theme.color.inkFaint} />
      <Text style={styles.metaText}>{label}</Text>
    </View>
  );
};

interface LayerRowProps {
  event: CalendarLayerEvent;
}

/** An opt-in layer entry: dashed and not tappable, like the website's grid (never a blockout reason). */
const LayerRow = ({ event }: LayerRowProps) => {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation(['scheduling', 'common']);
  const f = useFormatters();
  const label = t(`layers.event.${event.layer}`, { name: event.person_name });
  const when = !event.all_day && event.starts_at && event.ends_at
    ? t('common:format.dateRange', { start: f.dateTime(event.starts_at), end: f.dateTime(event.ends_at) })
    : null;
  return (
    <View style={styles.layerRow} accessible accessibilityLabel={when ? `${label}, ${when}` : label}>
      <Text style={styles.layerLabel}>{label}</Text>
      {when ? <Text style={styles.layerTime}>{when}</Text> : null}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.space.md },
    header: { gap: theme.space.lg },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xs },

    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      padding: theme.space.xs,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    monthLabel: { flex: 1, alignItems: 'center' },
    monthName: { ...theme.type.title, color: theme.color.ink, textAlign: 'center' },
    monthYear: { ...theme.type.label, color: theme.color.inkFaint },

    filters: { gap: theme.space.md },
    chipScroller: { marginHorizontal: -theme.space.lg, flexGrow: 0 },
    chipRow: { gap: theme.space.sm, paddingHorizontal: theme.space.lg },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },

    dayCard: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    dayBody: { flex: 1, gap: theme.space.sm },

    layerList: { gap: theme.space.xs },
    layerRow: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
    },
    layerLabel: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    layerTime: { ...theme.type.numeric, color: theme.color.inkFaint },

    event: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: theme.space.md,
      paddingVertical: theme.space.sm,
      minHeight: 44,
    },
    kindBar: { width: 3, borderRadius: 2 },
    eventBody: { flex: 1, gap: theme.space.xs },
    eventTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm },
    eventTitle: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metaText: { ...theme.type.numeric, color: theme.color.inkMuted, flexShrink: 1 },
  });
