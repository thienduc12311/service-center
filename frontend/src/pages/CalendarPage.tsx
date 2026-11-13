import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  DEFAULT_CALENDAR_FILTERS,
  addMonths,
  calendarLayerEventDays,
  calendarLayersRequestFor,
  calendarQueryFor,
  endOfMonth,
  isSameDay,
  monthGrid,
  startOfMonth,
  toISODate,
  withCalendarTeam,
  type CalendarEvent,
  type CalendarFilters,
  type CalendarLayerEvent,
} from '@service-center/shared';
import { useCalendar, useTeams } from '../hooks/queries';
import {
  Badge,
  Button,
  DateTile,
  EmptyState,
  ErrorNotice,
  IconButton,
  Loading,
  PageHeader,
  Segmented,
  SkeletonList,
  Spinner,
} from '../components/ui';
import { Icon } from '../components/icons';
import { assignmentTone } from '../lib/format';
import { useFormatters } from '../i18n';
import {
  LayerToggles,
  ScopedFeedsPanel,
  layerLabel,
  useCalendarLayers,
} from '../components/calendar/CalendarExtensions';

type View = 'month' | 'agenda';

const kindStyles: Record<CalendarEvent['kind'], string> = {
  service:
    'bg-brand-50 text-brand-700 ring-brand-600/15 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/25 dark:hover:bg-brand-500/25',
  rehearsal:
    'bg-amber-50 text-amber-700 ring-amber-600/20 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/25 dark:hover:bg-amber-500/25',
  other:
    'bg-slate-100 text-slate-600 ring-slate-500/20 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40 dark:hover:bg-slate-700',
};

/** A solid marker per kind, for the event chips' leading dot. */
const kindDots: Record<CalendarEvent['kind'], string> = {
  service: 'bg-brand-500',
  rehearsal: 'bg-amber-500',
  other: 'bg-slate-400',
};

export const CalendarPage = () => {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState<View>('month');
  // Same filters and requests as the native calendar (MOB-022). F16 layers
  // apply to the chosen team; the server applies current access.
  const [filters, setFilters] = useState<CalendarFilters>(DEFAULT_CALENDAR_FILTERS);
  const teamId = filters.teamId ?? '';

  const teams = useTeams();
  const { t } = useTranslation(['scheduling', 'common']);
  const f = useFormatters();
  // Sunday first: the week start is a scheduling rule, not a language one.
  const weekdays = f.weekdays('short');

  // The month grid spills into the neighbouring months, so widen the window to
  // match what's actually on screen.
  const range = useMemo(() => {
    const days = monthGrid(cursor);
    return {
      from: (days[0] ?? startOfMonth(cursor)).toISOString(),
      to: (days.at(-1) ?? endOfMonth(cursor)).toISOString(),
    };
  }, [cursor]);

  const calendar = useCalendar(calendarQueryFor(filters, range));

  const layersRequest = calendarLayersRequestFor(filters, range);
  const layerEvents = useCalendarLayers(layersRequest);
  const layersByDay = useMemo(() => {
    const map = new Map<string, CalendarLayerEvent[]>();
    for (const event of layersRequest ? layerEvents.data ?? [] : []) {
      for (const day of calendarLayerEventDays(event)) map.set(day, [...(map.get(day) ?? []), event]);
    }
    return map;
  }, [layerEvents.data, layersRequest]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of calendar.data ?? []) {
      const key = toISODate(event.starts_at);
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [calendar.data]);

  const days = useMemo(() => monthGrid(cursor), [cursor]);
  const today = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        actions={
          <Segmented<View>
            label={t('calendar.title')}
            value={view}
            onChange={setView}
            items={[
              { value: 'month', label: t('calendar.view.month') },
              { value: 'agenda', label: t('calendar.view.agenda') },
            ]}
          />
        }
      />

      <div className="card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            <IconButton
              icon="chevronLeft"
              label={t('calendar.previousMonth')}
              onClick={() => setCursor(startOfMonth(addMonths(cursor, -1)))}
            />
            <IconButton
              icon="chevronRight"
              label={t('calendar.nextMonth')}
              onClick={() => setCursor(startOfMonth(addMonths(cursor, 1)))}
            />
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {f.date(cursor, 'monthYear')}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            {t('common:states.today')}
          </Button>
          {calendar.isFetching && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <Spinner className="size-3.5" />
              {t('calendar.updating')}
            </span>
          )}

          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800">
              <input
                type="checkbox"
                checked={filters.mine}
                onChange={(e) => setFilters({ ...filters, mine: e.target.checked })}
                className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600"
              />
              {t('calendar.onlyMine')}
            </label>
            <select
              aria-label={t('calendar.filterByTeam')}
              className="input min-w-0 flex-1 sm:w-44 sm:flex-none"
              value={teamId}
              onChange={(e) => setFilters(withCalendarTeam(filters, e.target.value || null))}
            >
              <option value="">{t('calendar.allTeams')}</option>
              {(teams.data ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="border-t border-app-border pt-3">
          <LayerToggles teamId={teamId} layers={filters.layers} onChange={(layers) => setFilters({ ...filters, layers })} />
        </div>
      </div>

      <ErrorNotice error={calendar.error ?? layerEvents.error} />

      {calendar.isLoading ? (
        view === 'month' ? <Loading /> : <SkeletonList rows={4} />
      ) : view === 'month' ? (
        <div className="card scrollbar-thin overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-7 border-b border-app-border bg-slate-50/80 dark:bg-slate-900/50">
              {weekdays.map((day) => (
                <div key={day} className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, index) => {
                const events = eventsByDay.get(toISODate(day)) ?? [];
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-28 border-b border-app-border p-1.5 ${(index + 1) % 7 === 0 ? '' : 'border-r'} ${
                      isToday
                        ? 'bg-brand-50/40 dark:bg-brand-500/5'
                        : inMonth
                          ? 'bg-app-surface'
                          : 'bg-slate-50/60 dark:bg-slate-950/40'
                    }`}
                  >
                    <div className="mb-1 flex justify-end">
                      <span
                        className={`grid size-6 place-items-center rounded-full text-xs tabular-nums ${
                          isToday
                            ? 'bg-brand-600 font-semibold text-white'
                            : inMonth
                              ? 'font-medium text-slate-700 dark:text-slate-300'
                              : 'text-slate-300 dark:text-slate-600'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(layersByDay.get(toISODate(day)) ?? []).slice(0, 2).map((event) => (
                        <p
                          key={event.id}
                          title={layerLabel(event, t)}
                          className="truncate rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 dark:border-slate-600 dark:text-slate-400"
                        >
                          {layerLabel(event, t)}
                        </p>
                      ))}
                      {events.slice(0, 3).map((event) => (
                        <Link
                          key={event.id}
                          to={`/plans/${event.plan_id}`}
                          title={`${event.title} · ${f.time(event.starts_at)}`}
                          className={`flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset transition ${kindStyles[event.kind]}`}
                        >
                          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${kindDots[event.kind]}`} />
                          <span className="truncate">
                            <span className="tabular-nums opacity-75">{f.time(event.starts_at)}</span> {event.title}
                          </span>
                        </Link>
                      ))}
                      {events.length > 3 && (
                        <p className="px-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                          {t('calendar.moreEvents', { count: events.length - 3 })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (calendar.data ?? []).length === 0 ? (
        <EmptyState icon="calendar" title={t('calendar.emptyMonth')} />
      ) : (
        <ul className="space-y-3">
          {(calendar.data ?? []).map((event) => {
            const past = new Date(event.ends_at) < today;
            return (
              <li key={event.id}>
                <Link
                  to={`/plans/${event.plan_id}`}
                  className="card card-interactive flex items-center gap-4 p-3 sm:p-4"
                >
                  <DateTile value={event.starts_at} muted={past} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">{event.title}</span>
                      <Badge tone={kindStyles[event.kind]}>{t(`eventKind.${event.kind}`)}</Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="clock" className="size-3.5" />
                        {t('common:format.dateRange', { start: f.time(event.starts_at), end: f.time(event.ends_at) })}
                      </span>
                      {event.location && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Icon name="mapPin" className="size-3.5" />
                          <span className="truncate">{event.location}</span>
                        </span>
                      )}
                    </p>
                  </div>
                  {event.my_assignment_status && (
                    <Badge tone={assignmentTone[event.my_assignment_status]}>
                      {t(`common:assignmentStatus.${event.my_assignment_status}`)}
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ScopedFeedsPanel />
    </div>
  );
};
