import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  SCHEDULING_FREQUENCY_LABELS,
  type SchedulingFrequency,
  type SchedulingPreferenceRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, usePeople, useSchedulingPreferences, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../ui';

export interface SchedulingPreferencesProps {
  /** A person you help (F03 delegate); omitted for yourself. */
  personId?: string;
  /** Teams to offer; defaults to every team that has this person as a member. */
  memberPersonId?: string | null;
}

const ALL_TEAMS = '';
const WEEKS = [1, 2, 3, 4, 5] as const;
const FREQUENCIES = Object.keys(SCHEDULING_FREQUENCY_LABELS) as SchedulingFrequency[];

interface PreferenceDraft {
  frequency: SchedulingFrequency | '';
  maxPerMonth: string;
  preferredWeeks: number[];
  avoidedWeeks: number[];
  preferredTimes: string;
  avoidedDates: string;
}

const draftFrom = (row: SchedulingPreferenceRow | undefined): PreferenceDraft => ({
  frequency: row?.frequency ?? '',
  maxPerMonth: row?.max_per_month ? String(row.max_per_month) : '',
  preferredWeeks: row?.preferred_weeks ?? [],
  avoidedWeeks: row?.avoided_weeks ?? [],
  preferredTimes: (row?.preferred_times ?? []).map((time) => time.slice(0, 5)).join(', '),
  avoidedDates: (row?.avoided_dates ?? []).join(', '),
});

const splitList = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

/**
 * F03 Pass B preferences. One all-teams scope plus optional per-team scopes;
 * a team's own settings replace the all-teams ones for that team. These are
 * warnings for schedulers, never hard blocks — blockouts are the hard "no".
 */
export const SchedulingPreferences = ({ personId, memberPersonId }: SchedulingPreferencesProps) => {
  const invalidate = useInvalidateOrg();
  const preferences = useSchedulingPreferences(personId);
  const teams = useTeams();
  const people = usePeople({ enabled: !personId && !memberPersonId });
  const { user } = useAuth();
  const [scope, setScope] = useState(ALL_TEAMS);
  const current = preferences.data?.find((row) => (row.team_id ?? ALL_TEAMS) === scope);
  const [draft, setDraft] = useState<PreferenceDraft>(draftFrom(undefined));
  useEffect(() => setDraft(draftFrom(current)), [current, scope]);

  const teamOptions = useMemo(() => {
    const me = memberPersonId ?? personId
      ?? people.data?.find((person) => person.profile_id === user?.profile.id)?.person_id;
    if (!me) return [];
    return (teams.data ?? []).filter((team) => team.members.some((member) => member.person_id === me));
  }, [teams.data, memberPersonId, personId, people.data, user?.profile.id]);

  const save = useMutation({
    mutationFn: () => api.saveSchedulingPreference({
      ...(personId ? { person_id: personId } : {}),
      team_id: scope || null,
      frequency: draft.frequency || null,
      max_per_month: draft.maxPerMonth ? Number(draft.maxPerMonth) : null,
      preferred_weeks: draft.preferredWeeks,
      avoided_weeks: draft.avoidedWeeks,
      preferred_times: splitList(draft.preferredTimes),
      avoided_dates: splitList(draft.avoidedDates),
      ...(current ? { expected_revision: current.revision } : {}),
    }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSchedulingPreference(id),
    onSuccess: invalidate,
  });

  const toggleWeek = (key: 'preferredWeeks' | 'avoidedWeeks', week: number) =>
    setDraft((value) => {
      const other = key === 'preferredWeeks' ? 'avoidedWeeks' : 'preferredWeeks';
      const has = value[key].includes(week);
      return {
        ...value,
        [key]: has ? value[key].filter((w) => w !== week) : [...value[key], week].sort(),
        [other]: value[other].filter((w) => w !== week),
      };
    });

  if (preferences.isLoading) return <Loading />;

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(); }}
    >
      <label className="label">
        Applies to
        <select className="input mt-1" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value={ALL_TEAMS}>All my teams</option>
          {teamOptions.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}{preferences.data?.some((row) => row.team_id === team.id) ? ' (custom)' : ''}
            </option>
          ))}
        </select>
      </label>
      {scope && !current && (
        <p className="text-xs text-slate-500">Uses your all-teams preferences until you save something specific to this team.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">
          How often
          <select className="input mt-1" value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as SchedulingFrequency | '' })}>
            <option value="">No preference</option>
            {FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{SCHEDULING_FREQUENCY_LABELS[frequency]}</option>)}
          </select>
        </label>
        <label className="label">
          At most per month
          <input className="input mt-1" type="number" min={1} max={31} placeholder="No limit" value={draft.maxPerMonth}
            onChange={(e) => setDraft({ ...draft, maxPerMonth: e.target.value })} />
        </label>
      </div>
      <fieldset>
        <legend className="label">Weeks of the month</legend>
        <div className="mt-1 grid grid-cols-[auto_repeat(5,minmax(0,1fr))] items-center gap-x-2 gap-y-1 text-sm">
          <span />
          {WEEKS.map((week) => <span key={week} className="text-center text-xs text-slate-500">{week === 5 ? '5th' : `${week}${['st', 'nd', 'rd', 'th'][week - 1]}`}</span>)}
          <span className="text-xs text-slate-600">Prefer</span>
          {WEEKS.map((week) => (
            <label key={`p${week}`} className="flex min-h-11 justify-center">
              <input type="checkbox" aria-label={`Prefer week ${week}`} checked={draft.preferredWeeks.includes(week)} onChange={() => toggleWeek('preferredWeeks', week)} />
            </label>
          ))}
          <span className="text-xs text-slate-600">Avoid</span>
          {WEEKS.map((week) => (
            <label key={`a${week}`} className="flex min-h-11 justify-center">
              <input type="checkbox" aria-label={`Avoid week ${week}`} checked={draft.avoidedWeeks.includes(week)} onChange={() => toggleWeek('avoidedWeeks', week)} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">
          Preferred service start times
          <input className="input mt-1" placeholder="09:00, 11:00" value={draft.preferredTimes}
            onChange={(e) => setDraft({ ...draft, preferredTimes: e.target.value })} />
        </label>
        <label className="label">
          Dates to avoid
          <input className="input mt-1" placeholder="2027-12-24, 2027-12-31" value={draft.avoidedDates}
            onChange={(e) => setDraft({ ...draft, avoidedDates: e.target.value })} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Schedulers see these as warnings. Use blockout dates for times you truly can’t serve.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>Save preferences</Button>
        {scope && current && (
          <Button type="button" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(current.id)}>
            Use all-teams preferences
          </Button>
        )}
      </div>
      <ErrorNotice error={preferences.error ?? save.error ?? remove.error} />
    </form>
  );
};
