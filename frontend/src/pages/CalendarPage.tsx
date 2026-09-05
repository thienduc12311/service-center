import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addMonths,
  endOfMonth,
  formatDate,
  formatTime,
  isSameDay,
  monthGrid,
  startOfMonth,
  toISODate,
  type CalendarEvent,
} from '@service-center/shared';
import { useCalendar, useTeams } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { assignmentTone } from '../lib/format';

type View = 'month' | 'agenda';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

  const teams = useTeams();

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
        title="Calendar"
        subtitle="Services and rehearsals across every team."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-300">
              {(['month', 'agenda'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={`px-3 py-1.5 text-sm font-medium capitalize transition ${
                    view === value ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {value}
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
              Only mine
            </label>
            <select
              aria-label="Filter by team"
              className="input w-40"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">All teams</option>
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
        <Button variant="secondary" onClick={() => setCursor(startOfMonth(addMonths(cursor, -1)))}>
          ‹
        </Button>
        <Button variant="secondary" onClick={() => setCursor(startOfMonth(new Date()))}>
          Today
        </Button>
        <Button variant="secondary" onClick={() => setCursor(startOfMonth(addMonths(cursor, 1)))}>
          ›
        </Button>
        <h2 className="ml-2 text-lg font-semibold">
          {formatDate(cursor, { month: 'long', year: 'numeric' })}
        </h2>
        {calendar.isFetching && <span className="text-xs text-slate-400">updating…</span>}
      </div>

      <ErrorNotice error={calendar.error} />

      {calendar.isLoading ? (
        <Loading />
      ) : view === 'month' ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((day) => (
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
                    {events.slice(0, 3).map((event) => (
                      <Link
                        key={event.id}
                        to={`/plans/${event.plan_id}`}
                        title={`${event.title} · ${formatTime(event.starts_at)}`}
                        className={`block truncate rounded px-1.5 py-0.5 text-xs font-medium transition ${kindStyles[event.kind]}`}
                      >
                        {formatTime(event.starts_at)} {event.title}
                      </Link>
                    ))}
                    {events.length > 3 && (
                      <p className="px-1.5 text-xs text-slate-400">+{events.length - 3} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (calendar.data ?? []).length === 0 ? (
        <EmptyState title="Nothing scheduled this month" />
      ) : (
        <ul className="space-y-3">
          {(calendar.data ?? []).map((event) => (
            <li key={event.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="w-16 shrink-0 text-center">
                <p className="text-xs uppercase text-slate-400">
                  {formatDate(event.starts_at, { month: 'short' })}
                </p>
                <p className="text-xl font-semibold">{new Date(event.starts_at).getDate()}</p>
              </div>
              <div className="min-w-0 flex-1">
                <Link to={`/plans/${event.plan_id}`} className="font-medium hover:underline">
                  {event.title}
                </Link>
                <p className="text-sm text-slate-500">
                  {formatTime(event.starts_at)} – {formatTime(event.ends_at)}
                  {event.location ? ` · ${event.location}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={kindStyles[event.kind]}>{event.kind}</Badge>
                {event.my_assignment_status && (
                  <Badge tone={assignmentTone[event.my_assignment_status]}>
                    {event.my_assignment_status}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
