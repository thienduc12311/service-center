import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  isFreshnessWarning,
  type AssignmentVisibility,
  type AttendanceConflict,
  type PreferenceWarning,
  type RosterPerson,
  type TeamPositionRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useDeliveryReadiness, useInvalidateOrg, usePeoplePage, usePlan, useTeams } from '../../hooks/queries';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useAuth } from '../../providers/AuthProvider';
import { Avatar, Button, ErrorNotice, IconButton, Modal, Segmented } from '../ui';
import { Icon } from '../icons';
import { ListFooter } from '../ListFooter';
import { SearchableSelect } from '../SearchableSelect';
import { useFormatters, useStructuredText } from '../../i18n';
import { preferenceWarningText } from '@service-center/shared';
import { AddGuestForm } from './AddGuestForm';
import { ALL_TIMES, ConflictList, isScopeComplete, TimeScopePicker, type TimeScope } from './attendance';

/** Sentinel option value for "create a plan-only position". */
const NEW_POSITION = '__new__';

/** Past this many teams, the team picker becomes a searchable select. */
const TEAM_SELECT_THRESHOLD = 10;
/** Up to this many positions are shown as chips; more use a select. */
const POSITION_CHIP_LIMIT = 8;

/** Whose names the people list shows once a team is chosen. */
type PeopleScope = 'team' | 'everyone';

/** A ticked person, kept with what the chips show after a new search hides their row. */
interface SelectedPerson {
  personId: string;
  name: string;
  avatarUrl: string | null;
}

/** A roster row that can be scheduled (has a Person record). */
type SchedulablePerson = RosterPerson & { person_id: string };

const isSchedulable = (person: RosterPerson): person is SchedulablePerson => Boolean(person.person_id);

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
  const plan = usePlan(planId);
  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const [filter, setFilter] = useState('');
  const [addingGuest, setAddingGuest] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selectedPeople, setSelectedPeople] = useState<readonly SelectedPerson[]>([]);
  const selected = useMemo(() => selectedPeople.map((person) => person.personId), [selectedPeople]);
  const [peopleScope, setPeopleScope] = useState<PeopleScope>('team');
  const [scope, setScope] = useState<TimeScope>(ALL_TIMES);
  /** Conflicts the server reported at commit time (e.g. someone else got there first). */
  const [commitConflicts, setCommitConflicts] = useState<AttendanceConflict[] | null>(null);
  const [conflictReason, setConflictReason] = useState('');
  /** Null follows the team's default. */
  const [visibilityChoice, setVisibilityChoice] = useState<AssignmentVisibility | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const team = teams.data?.find((item) => item.id === teamId);
  const teamMemberIds = useMemo(() => new Set((team?.members ?? []).map((member) => member.person_id)), [team]);
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
      setSelectedPeople([]);
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

  const toggle = (person: SelectedPerson) => {
    setCommitConflicts(null);
    setSelectedPeople((current) =>
      current.some((entry) => entry.personId === person.personId)
        ? current.filter((entry) => entry.personId !== person.personId)
        : [...current, person],
    );
  };

  const changeTeam = (nextTeamId: string) => {
    setTeamId(nextTeamId);
    setPositionId('');
    setCommitConflicts(null);
    // Team members are who you usually want; a team nobody is on yet starts on everyone.
    const nextTeam = teams.data?.find((item) => item.id === nextTeamId);
    setPeopleScope(nextTeam && nextTeam.members.length === 0 ? 'everyone' : 'team');
  };

  // F02: the list is searched and paged on the server (accent-insensitive
  // words over name, campus, email); archived people are never offered.
  const search = useDebouncedValue(filter.trim());
  const teamScoped = Boolean(team) && peopleScope === 'team';
  const roster = usePeoplePage({ q: search, includeArchived: false, teamId: teamScoped ? teamId : '' }, { enabled: open });
  // The "Everyone (N)" count; shares its cache with the People page's first page.
  const everyone = usePeoplePage({ q: '', includeArchived: false }, { enabled: open && Boolean(team) });
  const candidates = (roster.data ?? []).filter(isSchedulable);
  const onPlan = useMemo(() => new Set((plan.data?.assignments ?? []).map((assignment) => assignment.person_id)), [plan.data?.assignments]);

  const displayName = (person: RosterPerson): string => person.full_name ?? person.email ?? t('common:fallback.someone');
  const nameOf = (personId: string): string =>
    selectedPeople.find((person) => person.personId === personId)?.name ?? t('common:fallback.someone');

  /** The team's usual positions, then the ones added for this plan. */
  const positionChoices: readonly TeamPositionRow[] = team ? [...team.positions, ...planPositions] : [];
  const choosePosition = (next: string) => {
    setCommitConflicts(null);
    setPositionId(next);
  };

  return (
    <Modal open={open} title={t('schedulePeople.title')} onClose={onClose}>
      <div className="space-y-4">
        {(teams.data?.length ?? 0) > TEAM_SELECT_THRESHOLD ? (
          <SearchableSelect
            id="schedule-team"
            label={t('schedulePeople.team')}
            value={teamId}
            onChange={changeTeam}
            options={(teams.data ?? []).map((item) => ({ id: item.id, label: item.name }))}
            placeholder={t('schedulePeople.chooseTeam')}
          />
        ) : (
          <div>
            <label className="label" htmlFor="schedule-team">
              {t('schedulePeople.team')}
            </label>
            <select id="schedule-team" className="input" value={teamId} onChange={(e) => changeTeam(e.target.value)}>
              <option value="">{t('schedulePeople.chooseTeam')}</option>
              {(teams.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {team && (
          <div>
            {positionChoices.length <= POSITION_CHIP_LIMIT ? (
              <div role="radiogroup" aria-labelledby="schedule-position-label">
                <span id="schedule-position-label" className="label">
                  {t('schedulePeople.position')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: '', label: t('schedulePeople.noSpecificPosition'), planOnly: false },
                    ...positionChoices.map((position) => ({ id: position.id, label: position.name, planOnly: position.plan_id !== null })),
                    { id: NEW_POSITION, label: t('schedulePeople.newPlanPositionChip'), planOnly: false },
                  ].map((choice) => (
                    <button
                      key={choice.id || 'none'}
                      type="button"
                      role="radio"
                      aria-checked={positionId === choice.id}
                      onClick={() => choosePosition(choice.id)}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition ${
                        positionId === choice.id
                          ? 'bg-brand-600 text-white ring-brand-600'
                          : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800'
                      }`}
                    >
                      {choice.label}
                      {choice.planOnly && <span className="text-[11px] font-normal opacity-80">· {t('schedulePeople.planOnlyGroup')}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <label className="label" htmlFor="schedule-position">
                  {t('schedulePeople.position')}
                </label>
                <select id="schedule-position" className="input" value={positionId} onChange={(e) => choosePosition(e.target.value)}>
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
              </>
            )}
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
                <p className="text-xs text-slate-500 dark:text-slate-400">
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
                  setSelectedPeople((current) => [...current, { personId: person.id, name: displayName(person), avatarUrl: person.avatar_url }]);
                  await invalidate();
                }}
                onCancel={() => setAddingGuest(false)}
              />
            </div>
          )}
          {selectedPeople.length > 0 && (
            <ul className="mb-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label={t('schedulePeople.selectedLabel')}>
              {selectedPeople.map((person) => (
                <li key={person.personId} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pr-1 pl-0.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/10 dark:text-brand-100 dark:ring-brand-500/30">
                  <Avatar name={person.name} url={person.avatarUrl} size="sm" />
                  <span className="max-w-40 truncate">{person.name}</span>
                  <IconButton icon="close" size="sm" label={t('schedulePeople.unselect', { name: person.name })} onClick={() => toggle(person)} />
                </li>
              ))}
            </ul>
          )}
          {team && (
            <Segmented<PeopleScope>
              className="mb-2"
              label={t('schedulePeople.scopeLabel')}
              value={peopleScope}
              onChange={setPeopleScope}
              items={[
                { value: 'team', label: t('schedulePeople.scopeTeam'), count: teamMemberIds.size },
                { value: 'everyone', label: t('schedulePeople.scopeEveryone'), ...(everyone.total !== null ? { count: everyone.total } : {}) },
              ]}
            />
          )}
          <div className="relative mb-1">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label={t('schedulePeople.findPerson')}
              className="input !pl-9"
              placeholder={t('schedulePeople.findPerson')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <ErrorNotice error={roster.error} />
          <div className="max-h-56 overflow-y-auto rounded-xl border border-app-border p-1" aria-busy={roster.isFetching}>
            {candidates.length === 0 && !roster.isLoading ? (
              <p className="px-2 py-3 text-center text-sm text-slate-500 dark:text-slate-400">
                {search ? t('schedulePeople.noMatches') : teamScoped ? t('schedulePeople.noTeamMembers') : t('schedulePeople.noPeople')}
              </p>
            ) : (
              <ul className="space-y-1">
                {candidates.map((person) => {
                  const personId = person.person_id;
                  const name = displayName(person);
                  return (
                    <li key={personId}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input
                          type="checkbox"
                          checked={selected.includes(personId)}
                          onChange={() => toggle({ personId, name, avatarUrl: person.avatar_url })}
                          className="size-4 rounded border-slate-300 dark:border-slate-700"
                        />
                        <Avatar name={name} url={person.avatar_url} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                        {onPlan.has(personId) && <span className="text-xs text-amber-700 dark:text-amber-300">{t('schedulePeople.onPlan')}</span>}
                        {!person.has_login && <span className="text-xs text-slate-500 dark:text-slate-400">{t('schedulePeople.noLogin')}</span>}
                        {!teamScoped && teamMemberIds.has(personId) && <span className="text-xs text-brand-600">{t('schedulePeople.onTeam')}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <ListFooter
              shown={candidates.length}
              total={roster.total}
              onShowMore={roster.hasNextPage ? () => void roster.fetchNextPage() : undefined}
              loading={roster.isFetchingNextPage}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300 dark:border-slate-700"
            checked={visibility === 'prepared'}
            onChange={(e) => setVisibilityChoice(e.target.checked ? 'prepared' : 'released')}
          />
          <span>
            {t('schedulePeople.preparePrivately')}
            <span className="block text-xs text-slate-500 dark:text-slate-400">
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
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('schedulePeople.cannotOverride')}
          </p>
        ))}

        {warningsByPerson.size > 0 && (
          <div role="status" className="surface-inset p-3 text-sm text-slate-700 dark:text-slate-200">
            <p className="font-medium">{t('schedulePeople.preferencesTitle')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('schedulePeople.preferencesHint')}</p>
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
