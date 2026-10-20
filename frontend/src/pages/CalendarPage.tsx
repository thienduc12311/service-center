import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  addMonths,
  endOfMonth,
  isSameDay,
  monthGrid,
  startOfMonth,
  toISODate,
  type CalendarEvent,
  type CalendarLayer,
  type CalendarLayerEvent,
} from '@service-center/shared';
import { useCalendar, useTeams } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { assignmentTone } from '../lib/format';
import { useFormatters } from '../i18n';
import {
  LayerToggles,
  ScopedFeedsPanel,
  layerEventDays,
  layerLabel,
  useCalendarLayers,
} from '../components/calendar/CalendarExtensions';

type View = 'month' | 'agenda';

const kindStyles: Record<CalendarEvent['kind'], string> = {
  service: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  rehearsal: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
  other: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
};

export const CalendarPage = () => {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState<View>('month');
  const [mine, setMine] = useState(false);
  const [teamId, setTeamId] = useState('');
  // F16: opt-in layers for the chosen team (the server applies current access).
  const [layers, setLayers] = useState<CalendarLayer[]>([]);

  const teams = useTeams();
  const { t } = useTranslation(['scheduling', 'common']);
  const f = useFormatters();
  // Sunday first: the week start is a scheduling rule, not a language one.
  const weekdays = f.weekdays('short');
  const shortMonths = f.months('short');

  // The month grid spills into the neighbouring months, so widen the window to
  // match what's actually on screen.
  const range = useMemo(() => {
    const days = monthGrid(cursor);
    return {
      from: (days[0] ?? startOfMonth(cursor)).toISOString(),
      to: (days.at(-1) ?? endOfMonth(cursor)).toISOString(),
    };
  }, [cursor]);

  const calendar = useCalendar({
    ...range,
    ...(mine ? { mine: true } : {}),
    ...(teamId ? { team_id: teamId } : {}),
  });

  const layerEvents = useCalendarLayers({
    teamId,
    from: toISODate(range.from),
    to: toISODate(range.to),
    layers,
  });
  const layersByDay = useMemo(() => {
    const map = new Map<string, CalendarLayerEvent[]>();
    for (const event of teamId ? layerEvents.data ?? [] : []) {
      for (const day of layerEventDays(event)) map.set(day, [...(map.get(day) ?? []), event]);
    }
    return map;
  }, [layerEvents.data, teamId]);

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
    <div>
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-300">
              {(['month', 'agenda'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={`px-3 py-1.5 text-sm font-medium transition ${
                    view === value ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t(`calendar.view.${value}`)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
                className="size-4 rounded border-slate-300"
              />
              {t('calendar.onlyMine')}
            </label>
            <select
              aria-label={t('calendar.filterByTeam')}
              className="input w-40"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">{t('calendar.allTeams')}</option>
              {(teams.data ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="secondary"
          aria-label={t('calendar.previousMonth')}
          onClick={() => setCursor(startOfMonth(addMonths(cursor, -1)))}
        >
          ‹
        </Button>
        <Button variant="secondary" onClick={() => setCursor(startOfMonth(new Date()))}>
          {t('common:states.today')}
        </Button>
        <Button
          variant="secondary"
          aria-label={t('calendar.nextMonth')}
          onClick={() => setCursor(startOfMonth(addMonths(cursor, 1)))}
        >
          ›
        </Button>
        <h2 className="ml-2 text-lg font-semibold">
          {f.date(cursor, 'monthYear')}
        </h2>
        {calendar.isFetching && <span className="text-xs text-slate-400">{t('calendar.updating')}</span>}
        <div className="ml-auto">
          <LayerToggles teamId={teamId} layers={layers} onChange={setLayers} />
        </div>
      </div>

      <ErrorNotice error={calendar.error ?? layerEvents.error} />

      {calendar.isLoading ? (
        <Loading />
      ) : view === 'month' ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {weekdays.map((day) => (
              <div key={day} className="px-2 py-2 text-center text-xs font-semibold text-slate-500">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const events = eventsByDay.get(toISODate(day)) ?? [];
              const inMonth = day.getMonth() === cursor.getMonth();
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-28 border-b border-r border-slate-100 p-1.5 ${
                    inMonth ? 'bg-white' : 'bg-slate-50/60'
                  }`}
                >
                  <div className="mb-1 flex justify-end">
                    <span
                      className={`grid size-6 place-items-center rounded-full text-xs ${
                        isSameDay(day, today)
                          ? 'bg-brand-600 font-semibold text-white'
                          : inMonth
                            ? 'text-slate-600'
                            : 'text-slate-300'
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
                        className="truncate rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-xs text-slate-500"
                      >
                        {layerLabel(event, t)}
                      </p>
                    ))}
                    {events.slice(0, 3).map((event) => (
                      <Link
                        key={event.id}
                        to={`/plans/${event.plan_id}`}
                        title={`${event.title} · ${f.time(event.starts_at)}`}
                        className={`block truncate rounded px-1.5 py-0.5 text-xs font-medium transition ${kindStyles[event.kind]}`}
                      >
                        {f.time(event.starts_at)} {event.title}
                      </Link>
                    ))}
                    {events.length > 3 && (
                      <p className="px-1.5 text-xs text-slate-400">{t('calendar.moreEvents', { count: events.length - 3 })}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (calendar.data ?? []).length === 0 ? (
        <EmptyState title={t('calendar.emptyMonth')} />
      ) : (
        <ul className="space-y-3">
          {(calendar.data ?? []).map((event) => (
            <li key={event.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="w-16 shrink-0 text-center">
                <p className="text-xs uppercase text-slate-400">
                  {shortMonths[new Date(event.starts_at).getMonth()]}
                </p>
                <p className="text-xl font-semibold">{new Date(event.starts_at).getDate()}</p>
              </div>
              <div className="min-w-0 flex-1">
                <Link to={`/plans/${event.plan_id}`} className="font-medium hover:underline">
                  {event.title}
                </Link>
                <p className="text-sm text-slate-500">
                  {t('common:format.dateRange', { start: f.time(event.starts_at), end: f.time(event.ends_at) })}
                  {event.location ? ` · ${event.location}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={kindStyles[event.kind]}>{t(`eventKind.${event.kind}`)}</Badge>
                {event.my_assignment_status && (
                  <Badge tone={assignmentTone[event.my_assignment_status]}>
                    {t(`common:assignmentStatus.${event.my_assignment_status}`)}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ScopedFeedsPanel />
    </div>
  );
};
