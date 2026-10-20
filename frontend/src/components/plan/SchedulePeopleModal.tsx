import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  isFreshnessWarning,
  type AssignmentVisibility,
  type AttendanceConflict,
  type PreferenceWarning,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useDeliveryReadiness, useInvalidateOrg, usePeople, usePlan, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Avatar, Button, ErrorNotice, Modal } from '../ui';
import { useFormatters, useStructuredText } from '../../i18n';
import { preferenceWarningText } from '@service-center/shared';
import { AddGuestForm } from './AddGuestForm';
import { ALL_TIMES, ConflictList, isScopeComplete, TimeScopePicker, type TimeScope } from './attendance';

/** Sentinel option value for "create a plan-only position". */
const NEW_POSITION = '__new__';

export interface SchedulePeopleModalProps {
  open: boolean;
  planId: string;
  /** The plan's service type: scheduling rights can be granted per service type. */
  serviceTypeId: string | null;
  /** Pre-selects the team the scheduler was already looking at. */
  initialTeamId?: string | null;
  onClose: () => void;
}

export const SchedulePeopleModal = ({
  open,
  planId,
  serviceTypeId,
  initialTeamId,
  onClose,
}: SchedulePeopleModalProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const { list: formatList } = useFormatters();
  const structured = useStructuredText();
  const invalidate = useInvalidateOrg();
  const { can, organizationId } = useAuth();
  const allTeams = useTeams();
  // Only the teams this person may schedule on this plan; the server refuses the rest.
  const teams = {
    ...allTeams,
    data: allTeams.data?.filter((item) => can('scheduling.manage', { serviceTypeId, teamId: item.id })),
  };
  const people = usePeople();
  const plan = usePlan(planId);
  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const [filter, setFilter] = useState('');
  const [addingGuest, setAddingGuest] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<TimeScope>(ALL_TIMES);
  /** Conflicts the server reported at commit time (e.g. someone else got there first). */
  const [commitConflicts, setCommitConflicts] = useState<AttendanceConflict[] | null>(null);
  const [conflictReason, setConflictReason] = useState('');
  /** Null follows the team's default. */
  const [visibilityChoice, setVisibilityChoice] = useState<AssignmentVisibility | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const team = teams.data?.find((item) => item.id === teamId);
  const realPositionId = positionId && positionId !== NEW_POSITION ? positionId : null;

  // F04: actual attendance intervals, checked as the scheduler chooses. The
  // server re-checks at commit, so this preview is advisory, never trusted.
  const conflictQuery = {
    team_id: teamId,
    position_id: realPositionId,
    people: [...selected].sort(),
    mode: scope.mode,
    time_ids: [...scope.timeIds].sort(),
  };
  const conflictCheck = useQuery({
    queryKey: keys.conflictCheck(organizationId, { plan: planId, ...conflictQuery }),
    queryFn: () =>
      api.checkAssignmentConflicts({
        candidates: selected.map((personId) => ({
          key: personId,
          person_id: personId,
          plan_id: planId,
          team_id: teamId,
          position_id: realPositionId,
          attendance_mode: scope.mode,
          time_ids: scope.mode === 'selected' ? scope.timeIds : [],
        })),
      }),
    enabled: open && Boolean(teamId) && selected.length > 0 && isScopeComplete(scope),
  });
  const conflicts = commitConflicts ?? conflictCheck.data?.conflicts ?? [];
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking');
  const mayOverride =
    can('scheduling.override_conflicts', { serviceTypeId, teamId }) &&
    (commitConflicts !== null || conflictCheck.data?.override_permitted !== false);
  const visibility: AssignmentVisibility = visibilityChoice ?? team?.default_visibility ?? 'released';
  /** Positions added for this plan only (F02); the team's normal list is untouched. */
  const planPositions = (plan.data?.plan_positions ?? []).filter((position) => position.team_id === teamId);

  // Who a released request cannot reach: no login and no email on file.
  const readiness = useDeliveryReadiness(selected);
  const unreachable = (readiness.data ?? []).filter((entry) => !entry.has_login && !entry.has_email);

  // F03: preference and freshness warnings never block; they explain.
  const warningQuery = { plan_id: planId, team_id: teamId, person_ids: [...selected].sort() };
  const warnings = useQuery({
    queryKey: keys.preferenceWarnings(organizationId, warningQuery),
    queryFn: () => api.preferenceWarnings(warningQuery),
    enabled: open && Boolean(teamId) && selected.length > 0,
  });
  const warningsByPerson = useMemo(() => {
    const grouped = new Map<string, PreferenceWarning[]>();
    for (const warning of warnings.data ?? []) grouped.set(warning.person_id, [...(grouped.get(warning.person_id) ?? []), warning]);
    return grouped;
  }, [warnings.data]);
  const hasPreferenceWarnings = (warnings.data ?? []).some((warning) => !isFreshnessWarning(warning.code));

  const addPlanPosition = useMutation({
    mutationFn: () => api.createPlanPosition(planId, { team_id: teamId, name: newPositionName, needed: 1 }),
    onSuccess: async (position) => {
      await invalidate();
      setPositionId(position.id);
      setNewPositionName('');
    },
  });

  const schedule = useMutation({
    mutationFn: () =>
      api.createAssignments(planId, {
        assignments: selected.map((personId) => ({
          person_id: personId,
          team_id: teamId,
          position_id: realPositionId,
          attendance_mode: scope.mode,
          time_ids: scope.mode === 'selected' ? scope.timeIds : [],
        })),
        notify: true,
        visibility,
        preference_override_reason: overrideReason.trim() || null,
        conflict_override_reason: blocking.length > 0 ? conflictReason.trim() || null : null,
      }),
    onSuccess: async () => {
      await invalidate();
      setSelected([]);
      setScope(ALL_TIMES);
      setCommitConflicts(null);
      setConflictReason('');
      setVisibilityChoice(null);
      setOverrideReason('');
      onClose();
    },
    onError: (error) => {
      // A 409 at commit means the picture changed since the check (or a
      // reason is needed): show exactly what the server found.
      if (error instanceof ApiError && error.status === 409 && error.code === 'scheduling_conflict') {
        setCommitConflicts((error.details as AttendanceConflict[] | undefined) ?? []);
      }
    },
  });

  const toggle = (personId: string) => {
    setCommitConflicts(null);
    setSelected((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );
  };

  // Members of the chosen team come first — they're who you usually want.
  // Archived people are not in this list (the server leaves them out).
  const candidates = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = (people.data ?? []).filter(
      (person) => person.person_id && (!needle || (person.full_name ?? person.email ?? '').toLowerCase().includes(needle)),
    );
    if (!team) return all;
    const onTeam = new Set(team.members.map((m) => m.person_id));
    return [...all].sort(
      (a, b) => Number(onTeam.has(b.person_id!)) - Number(onTeam.has(a.person_id!)),
    );
  }, [people.data, team, filter]);

  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? t('common:fallback.someone');

  return (
    <Modal open={open} title={t('schedulePeople.title')} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="schedule-team">
            {t('schedulePeople.team')}
          </label>
          <select
            id="schedule-team"
            className="input"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setPositionId('');
              setCommitConflicts(null);
            }}
          >
            <option value="">{t('schedulePeople.chooseTeam')}</option>
            {(teams.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        {team && (
          <div>
            <label className="label" htmlFor="schedule-position">
              {t('schedulePeople.position')}
            </label>
            <select
              id="schedule-position"
              className="input"
              value={positionId}
              onChange={(e) => {
              setCommitConflicts(null);
              setPositionId(e.target.value);
            }}
            >
              <option value="">{t('schedulePeople.noSpecificPosition')}</option>
              {team.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
              {planPositions.length > 0 && (
                <optgroup label={t('schedulePeople.planOnlyGroup')}>
                  {planPositions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={NEW_POSITION}>{t('schedulePeople.newPlanPosition')}</option>
            </select>
            {positionId === NEW_POSITION && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-2">
                  <input
                    aria-label={t('schedulePeople.planPositionName')}
                    className="input flex-1"
                    placeholder={t('schedulePeople.planPositionPlaceholder')}
                    maxLength={80}
                    value={newPositionName}
                    onChange={(e) => setNewPositionName(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    loading={addPlanPosition.isPending}
                    disabled={!newPositionName.trim()}
                    onClick={() => addPlanPosition.mutate()}
                  >
                    {t('common:actions.add')}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  {t('schedulePeople.planPositionHint', { team: team.name })}
                </p>
                {addPlanPosition.error && <ErrorNotice error={addPlanPosition.error} />}
              </div>
            )}
          </div>
        )}

        {team && (
          <TimeScopePicker
            idPrefix="schedule-times"
            times={plan.data?.times ?? []}
            value={scope}
            onChange={(next) => {
              setCommitConflicts(null);
              setScope(next);
            }}
          />
        )}

        <div>
          <div className="flex items-center justify-between">
            <span className="label">{t('schedulePeople.people')}</span>
            {!addingGuest && (
              <button type="button" className="text-xs font-medium text-brand-600" onClick={() => setAddingGuest(true)}>
                {t('schedulePeople.someoneNew')}
              </button>
            )}
          </div>
          {addingGuest && (
            <div className="mb-2">
              <AddGuestForm
                onCreated={async (person) => {
                  setAddingGuest(false);
                  setSelected((current) => [...current, person.id]);
                  await invalidate();
                }}
                onCancel={() => setAddingGuest(false)}
              />
            </div>
          )}
          <input
            aria-label={t('schedulePeople.findPerson')}
            className="input mb-1"
            placeholder={t('schedulePeople.findPerson')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {candidates.map((person) => {
              const personId = person.person_id!;
              const onTeam = team?.members.some((m) => m.person_id === personId);
              return (
                <label
                  key={personId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(personId)}
                    onChange={() => toggle(personId)}
                    className="size-4 rounded border-slate-300"
                  />
                  <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
                  <span className="flex-1 text-sm">{person.full_name ?? person.email}</span>
                  {!person.has_login && <span className="text-xs text-slate-500">{t('schedulePeople.noLogin')}</span>}
                  {onTeam && <span className="text-xs text-brand-600">{t('schedulePeople.onTeam')}</span>}
                </label>
              );
            })}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            checked={visibility === 'prepared'}
            onChange={(e) => setVisibilityChoice(e.target.checked ? 'prepared' : 'released')}
          />
          <span>
            {t('schedulePeople.preparePrivately')}
            <span className="block text-xs text-slate-500">
              {t('schedulePeople.preparePrivatelyHint')}
            </span>
          </span>
        </label>

        {visibility === 'released' && unreachable.length > 0 && (
          <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
            <p className="font-medium">{t('schedulePeople.unreachableTitle')}</p>
            <p className="mt-1 text-xs">
              {t('schedulePeople.unreachableBody', {
                count: unreachable.length,
                names: formatList(unreachable.map((entry) => nameOf(entry.person_id))),
              })}
            </p>
          </div>
        )}

        {conflicts.length > 0 && <ConflictList conflicts={conflicts} nameOf={nameOf} />}
        {blocking.length > 0 && (mayOverride ? (
          <input
            aria-label={t('schedulePeople.conflictReasonLabel')}
            className="input"
            placeholder={t('schedulePeople.conflictReasonPlaceholder')}
            maxLength={500}
            value={conflictReason}
            onChange={(e) => setConflictReason(e.target.value)}
          />
        ) : (
          <p className="text-xs text-slate-500">
            {t('schedulePeople.cannotOverride')}
          </p>
        ))}

        {warningsByPerson.size > 0 && (
          <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-300/60">
            <p className="font-medium">{t('schedulePeople.preferencesTitle')}</p>
            <p className="text-xs text-slate-500">{t('schedulePeople.preferencesHint')}</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {[...warningsByPerson.entries()].map(([personId, list]) => (
                <li key={personId}>
                  <span className="font-medium">{nameOf(personId)}</span>
                  {' — '}
                  {list
                    .map((warning) =>
                      warning.code === 'busy_elsewhere'
                        ? t(`preferenceWarning.${warning.code}`)
                        : t('schedulePeople.warningWithDetail', { label: t(`preferenceWarning.${warning.code}`), detail: preferenceWarningText(warning, structured) }),
                    )
                    .join(t('schedulePeople.warningSeparator'))}
                </li>
              ))}
            </ul>
            {hasPreferenceWarnings && (
              <input
                aria-label={t('schedulePeople.preferenceReasonLabel')}
                className="input mt-2"
                placeholder={t('schedulePeople.preferenceReasonPlaceholder')}
                maxLength={500}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            )}
          </div>
        )}

        {schedule.error && !(schedule.error instanceof ApiError && schedule.error.code === 'scheduling_conflict') && (
          <ErrorNotice error={schedule.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            loading={schedule.isPending}
            disabled={
              !teamId ||
              selected.length === 0 ||
              positionId === NEW_POSITION ||
              !isScopeComplete(scope) ||
              (blocking.length > 0 && (!mayOverride || !conflictReason.trim()))
            }
            onClick={() => schedule.mutate()}
          >
            {blocking.length > 0
              ? t('schedulePeople.scheduleAnyway')
              : selected.length === 0
                ? t(visibility === 'prepared' ? 'schedulePeople.prepare' : 'schedulePeople.schedule')
                : t(visibility === 'prepared' ? 'schedulePeople.prepareCount' : 'schedulePeople.scheduleCount', { count: selected.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
