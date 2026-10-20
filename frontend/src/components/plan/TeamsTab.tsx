import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AssignmentDetail } from '@service-center/shared';
import { Avatar, Button, EmptyState } from '../ui';
import { assignmentDot } from '../../lib/format';
import type { PlanTeamPositionView, PlanTeamView } from './types';
import { attendanceSummary } from './attendance';

/** "All times" stays explicit so a later-added time's effect is visible. */
const attendanceLabel = (assignment: AssignmentDetail, t: TFunction<'staffing'>): string =>
  assignment.attendance_mode === 'all' && assignment.attendance.some((interval) => interval.source === 'plan_time')
    ? t('teamsTab.allTimesSummary', { summary: attendanceSummary(assignment.attendance) })
    : attendanceSummary(assignment.attendance);

export interface TeamsTabProps {
  teams: PlanTeamView[];
  /** scheduling.manage for this team on this plan (F01 scope). */
  canScheduleTeam: (teamId: string) => boolean;
  /** plans.edit: may change needed positions on every team. */
  canEditPlan: boolean;
  /** Releases exactly these reviewed prepared requests. */
  onRelease: (assignments: AssignmentDetail[]) => void;
  releasing: boolean;
  currentUserId: string | null;
  editingNeeds: boolean;
  onEditingNeedsChange: (editing: boolean) => void;
  onNeedChange: (positionId: string, needed: number) => void;
  onAddPeople: () => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
  /** F04: change which times one request covers. */
  onEditTimes: (assignment: AssignmentDetail) => void;
  /** F04: requests committed over a conflict, by assignment id → reason. */
  overrideReasons: ReadonlyMap<string, string>;
  showAllTeams: boolean;
  onToggleAllTeams: () => void;
}

export const TeamsTab = ({
  teams,
  canScheduleTeam,
  canEditPlan,
  onRelease,
  releasing,
  currentUserId,
  editingNeeds,
  onEditingNeedsChange,
  onNeedChange,
  onAddPeople,
  onRemoveAssignment,
  onRespond,
  onEditTimes,
  overrideReasons,
  showAllTeams,
  onToggleAllTeams,
}: TeamsTabProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  return (
  <div>
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={onToggleAllTeams}
        className="text-sm text-slate-500 hover:text-brand-600 hover:underline"
      >
        {showAllTeams ? t('teamsTab.showServiceTeams') : t('teamsTab.showAllTeams')}
      </button>
      {(canEditPlan || teams.some((team) => canScheduleTeam(team.team.id))) &&
        (editingNeeds ? (
          <Button onClick={() => onEditingNeedsChange(false)}>{t('common:actions.done')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onEditingNeedsChange(true)}>
              {t('teamsTab.neededPositions')}
            </Button>
            <Button variant="secondary" onClick={onAddPeople}>
              {t('teamsTab.addPeople')}
            </Button>
          </>
        ))}
    </div>

    {editingNeeds && (
      <div className="mb-4 flex items-start gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <span aria-hidden="true" className="text-slate-400">
          ⓘ
        </span>
        <div>
          <p className="font-medium text-slate-700">{t('teamsTab.editNeedsTitle')}</p>
          <p className="text-slate-500">
            <Trans t={t} i18nKey="teamsTab.editNeedsHint" components={[<strong key="done" className="font-medium" />]} />
          </p>
        </div>
      </div>
    )}

    {teams.length === 0 ? (
      <EmptyState
        title={t('teamsTab.emptyTitle')}
        description={t('teamsTab.emptyDescription')}
      />
    ) : (
      <div className="flex gap-3 overflow-x-auto pb-3">
        {teams.map((team) => (
          <TeamColumn
            key={team.team.id}
            team={team}
            canManage={canScheduleTeam(team.team.id)}
            canEditNeeds={canEditPlan || canScheduleTeam(team.team.id)}
            onRelease={onRelease}
            releasing={releasing}
            currentUserId={currentUserId}
            editingNeeds={editingNeeds}
            onNeedChange={onNeedChange}
            onRemoveAssignment={onRemoveAssignment}
            onRespond={onRespond}
            onEditTimes={onEditTimes}
            overrideReasons={overrideReasons}
          />
        ))}
      </div>
    )}
  </div>
  );
};

interface TeamColumnProps {
  team: PlanTeamView;
  canManage: boolean;
  canEditNeeds: boolean;
  onRelease: (assignments: AssignmentDetail[]) => void;
  releasing: boolean;
  currentUserId: string | null;
  editingNeeds: boolean;
  onNeedChange: (positionId: string, needed: number) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
  onEditTimes: (assignment: AssignmentDetail) => void;
  overrideReasons: ReadonlyMap<string, string>;
}

const TeamColumn = ({
  team,
  canManage,
  canEditNeeds,
  onRelease,
  releasing,
  currentUserId,
  editingNeeds,
  onNeedChange,
  onRemoveAssignment,
  onRespond,
  onEditTimes,
  overrideReasons,
}: TeamColumnProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  // Outside the editor a position only shows when it is staffed or wanted, so
  // a team can have positions and still have nothing worth drawing.
  const hasVisibleRows =
    editingNeeds ||
    team.unpositioned.length > 0 ||
    team.positions.some((position) => position.scheduled.length > 0 || position.needed > 0);

  return (
  <section className="card w-72 shrink-0 overflow-hidden">
    <header className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: team.team.color }}
          aria-hidden="true"
        />
        <h3 className="font-semibold">{team.team.name}</h3>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
        <span title={t('common:assignmentStatus.confirmed')}>
          <span className="mr-1 text-emerald-600">✓</span>
          {team.confirmed}
        </span>
        <span title={t('common:assignmentStatus.declined')}>
          <span className="mr-1 text-rose-500">✕</span>
          {team.declined}
        </span>
        <span title={t('teamsTab.awaitingReply')}>
          <span className="mr-1 text-amber-500">?</span>
          {team.pending}
        </span>
        {team.prepared.length > 0 && (
          <span title={t('teamsTab.preparedTitle')} className="text-slate-600">
            <span className="mr-1" aria-hidden="true">◌</span>
            {t('teamsTab.preparedCount', { count: team.prepared.length })}
          </span>
        )}
      </div>
      {canManage && team.prepared.length > 0 && (
        <ReleaseReview prepared={team.prepared} releasing={releasing} onRelease={onRelease} />
      )}
    </header>

    {team.positions.length === 0 && team.unpositioned.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-slate-400">
        {t('teamsTab.noPositions')}
      </p>
    ) : !hasVisibleRows ? (
      <p className="px-4 py-6 text-center text-xs text-slate-400">
        {t('teamsTab.nothingNeeded')}
      </p>
    ) : (
      <div>
        {team.positions.map((position) => (
          <PositionBlock
            key={position.position.id}
            position={position}
            canManage={canManage}
            canEditNeeds={canEditNeeds}
            currentUserId={currentUserId}
            editingNeeds={editingNeeds}
            onNeedChange={onNeedChange}
            onRemoveAssignment={onRemoveAssignment}
            onRespond={onRespond}
            onEditTimes={onEditTimes}
            overrideReasons={overrideReasons}
          />
        ))}

        {team.unpositioned.length > 0 && (
          <div>
            <p className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">
              {t('teamsTab.noPosition')}
            </p>
            <ul className="divide-y divide-slate-50">
              {team.unpositioned.map((assignment) => (
                <ScheduledPerson
                  key={assignment.id}
                  assignment={assignment}
                  canManage={canManage}
                  currentUserId={currentUserId}
                  onRemove={() => onRemoveAssignment(assignment.id)}
                  onRespond={onRespond}
                  onEditTimes={() => onEditTimes(assignment)}
                  overrideReason={overrideReasons.get(assignment.id) ?? null}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    )}
  </section>
  );
};

interface PositionBlockProps {
  position: PlanTeamPositionView;
  canManage: boolean;
  canEditNeeds: boolean;
  currentUserId: string | null;
  editingNeeds: boolean;
  onNeedChange: (positionId: string, needed: number) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
  onEditTimes: (assignment: AssignmentDetail) => void;
  overrideReasons: ReadonlyMap<string, string>;
}

const PositionBlock = ({
  position,
  canManage,
  canEditNeeds,
  currentUserId,
  editingNeeds,
  onNeedChange,
  onRemoveAssignment,
  onRespond,
  onEditTimes,
  overrideReasons,
}: PositionBlockProps) => {
  const { t } = useTranslation('staffing');
  // A position with nobody on it and nothing asked for is noise outside the editor.
  if (!editingNeeds && position.scheduled.length === 0 && position.needed === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between bg-slate-50 px-4 py-1.5">
        <p className="text-xs font-medium text-slate-500">
          {position.position.name}
          {position.planOnly && <span className="ml-1.5 font-normal text-slate-400">{t('teamsTab.planOnlySuffix')}</span>}
        </p>
        {!editingNeeds && position.needed > 0 && (
          <p
            className={`text-xs tabular-nums ${
              position.scheduled.length >= position.needed ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {t('teamsTab.staffedOfNeeded', { scheduled: position.scheduled.length, needed: position.needed })}
          </p>
        )}
      </div>

      {editingNeeds && (
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs text-slate-400">
            {t('teamsTab.scheduledCount', { count: position.scheduled.length })}
          </span>
          <NeededStepper
            label={position.position.name}
            needed={position.needed}
            disabled={!canEditNeeds}
            onChange={(needed) => onNeedChange(position.position.id, needed)}
          />
        </div>
      )}

      {position.scheduled.length > 0 && (
        <ul className="divide-y divide-slate-50">
          {position.scheduled.map((assignment) => (
            <ScheduledPerson
              key={assignment.id}
              assignment={assignment}
              canManage={canManage}
              currentUserId={currentUserId}
              onRemove={() => onRemoveAssignment(assignment.id)}
              onRespond={onRespond}
              onEditTimes={() => onEditTimes(assignment)}
              overrideReason={overrideReasons.get(assignment.id) ?? null}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const STEPPER_BUTTON =
  'grid size-6 place-items-center rounded border border-slate-300 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30';

interface NeededStepperProps {
  label: string;
  needed: number;
  disabled: boolean;
  onChange: (needed: number) => void;
}

const NeededStepper = ({ label, needed, disabled, onChange }: NeededStepperProps) => {
  const { t } = useTranslation('staffing');
  return (
  <div className="flex items-center gap-1.5 text-xs">
    <span className="text-slate-500">{t('teamsTab.needed')}</span>
    <button
      type="button"
      aria-label={t('teamsTab.oneFewer', { position: label })}
      className={STEPPER_BUTTON}
      disabled={disabled || needed === 0}
      onClick={() => onChange(needed - 1)}
    >
      −
    </button>
    <span aria-live="polite" className="w-5 text-center tabular-nums text-slate-700">
      {needed}
    </span>
    <button
      type="button"
      aria-label={t('teamsTab.oneMore', { position: label })}
      className={STEPPER_BUTTON}
      disabled={disabled || needed >= 99}
      onClick={() => onChange(needed + 1)}
    >
      +
    </button>
  </div>
  );
};

interface ScheduledPersonProps {
  assignment: AssignmentDetail;
  canManage: boolean;
  currentUserId: string | null;
  onRemove: () => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
  onEditTimes: () => void;
  /** Set when this request was committed over a conflict. */
  overrideReason: string | null;
}

const ScheduledPerson = ({
  assignment,
  canManage,
  currentUserId,
  onRemove,
  onRespond,
  onEditTimes,
  overrideReason,
}: ScheduledPersonProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const name = assignment.person?.full_name ?? assignment.person?.email ?? t('common:states.unknown');
  const isMine = assignment.user_id === currentUserId;
  const prepared = assignment.visibility === 'prepared';
  const ownerName = assignment.response_owner?.full_name;

  return (
    <li className="flex items-center gap-2 px-4 py-2">
      <Avatar name={name} url={assignment.person?.avatar_url} size="sm" />
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-sm"
          title={canManage && ownerName ? t('teamsTab.answersGoTo', { name: ownerName }) : undefined}
        >
          {name}
          {overrideReason && (
            <span className="ml-1 text-amber-600" title={t('teamsTab.overConflictReason', { reason: overrideReason })} aria-label={t('teamsTab.overConflict')}>
              ⚠
            </span>
          )}
        </span>
        {/* F04: the times this request actually covers, from the shared resolver. */}
        {canManage ? (
          <button
            type="button"
            onClick={onEditTimes}
            className="block max-w-full truncate text-left text-[11px] text-slate-500 hover:text-brand-600 hover:underline"
            title={t('teamsTab.changeTimes')}
          >
            {attendanceLabel(assignment, t)}
          </button>
        ) : (
          <span className="block truncate text-[11px] text-slate-500">{attendanceLabel(assignment, t)}</span>
        )}
      </span>
      {prepared && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          {t('teamsTab.prepared')}
        </span>
      )}

      {isMine && !prepared && assignment.status === 'unconfirmed' ? (
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onRespond(assignment.id, 'confirmed')}
            className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white"
          >
            {t('teamsTab.accept')}
          </button>
          <button
            type="button"
            onClick={() => onRespond(assignment.id, 'declined')}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-300"
          >
            {t('common:actions.decline')}
          </button>
        </span>
      ) : (
        <span
          className={`size-2 shrink-0 rounded-full ${assignmentDot[assignment.status]}`}
          title={t(`common:assignmentStatus.${assignment.status}`)}
        />
      )}

      {canManage && (
        <button
          type="button"
          aria-label={t('teamsTab.removePerson', { name })}
          onClick={onRemove}
          className="text-slate-300 hover:text-rose-500"
        >
          ×
        </button>
      )}
    </li>
  );
};

/**
 * Lists exactly who a release will reach before it happens. The ids shown
 * are the ids sent, so a refresh in between cannot widen what goes out.
 */
interface ReleaseReviewProps {
  prepared: AssignmentDetail[];
  releasing: boolean;
  onRelease: (assignments: AssignmentDetail[]) => void;
}

const ReleaseReview = ({ prepared, releasing, onRelease }: ReleaseReviewProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const [reviewing, setReviewing] = useState<AssignmentDetail[] | null>(null);

  if (!reviewing) {
    return (
      <Button variant="secondary" className="mt-2 !py-1 text-xs" onClick={() => setReviewing(prepared)}>
        {t('teamsTab.reviewAndRelease', { count: prepared.length })}
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
      <p className="font-medium text-slate-700">{t('teamsTab.willBeNotified')}</p>
      <ul className="mt-1 list-disc pl-4 text-slate-600">
        {reviewing.map((assignment) => (
          <li key={assignment.id}>{assignment.person?.full_name ?? t('common:states.unknown')}</li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button
          className="!py-1 text-xs"
          loading={releasing}
          onClick={() => {
            onRelease(reviewing);
            setReviewing(null);
          }}
        >
          {t('teamsTab.release')}
        </Button>
        <Button variant="ghost" className="!py-1 text-xs" onClick={() => setReviewing(null)}>
          {t('common:actions.cancel')}
        </Button>
      </div>
    </div>
  );
};
