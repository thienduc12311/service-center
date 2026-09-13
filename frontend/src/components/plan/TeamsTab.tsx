import { ASSIGNMENT_STATUS_LABELS, type AssignmentDetail } from '@service-center/shared';
import { Avatar, Button, EmptyState } from '../ui';
import { assignmentDot } from '../../lib/format';
import type { PlanTeamPositionView, PlanTeamView } from './types';

export interface TeamsTabProps {
  teams: PlanTeamView[];
  canManage: boolean;
  currentUserId: string | null;
  editingNeeds: boolean;
  onEditingNeedsChange: (editing: boolean) => void;
  onNeedChange: (positionId: string, needed: number) => void;
  onAddPeople: () => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
  showAllTeams: boolean;
  onToggleAllTeams: () => void;
}

export const TeamsTab = ({
  teams,
  canManage,
  currentUserId,
  editingNeeds,
  onEditingNeedsChange,
  onNeedChange,
  onAddPeople,
  onRemoveAssignment,
  onRespond,
  showAllTeams,
  onToggleAllTeams,
}: TeamsTabProps) => (
  <div>
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={onToggleAllTeams}
        className="text-sm text-slate-500 hover:text-brand-600 hover:underline"
      >
        {showAllTeams ? 'Show this service’s teams' : 'Show all teams'}
      </button>
      {canManage &&
        (editingNeeds ? (
          <Button onClick={() => onEditingNeedsChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onEditingNeedsChange(true)}>
              Needed positions
            </Button>
            <Button variant="secondary" onClick={onAddPeople}>
              Add people
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
          <p className="font-medium text-slate-700">Edit needed positions</p>
          <p className="text-slate-500">
            Changes save as you go. Click <strong className="font-medium">Done</strong> when you’re
            finished.
          </p>
        </div>
      </div>
    )}

    {teams.length === 0 ? (
      <EmptyState
        title="No teams for this service yet"
        description="Teams created for this service type show up here. Add one from the Teams page, or turn on “Show all teams”."
      />
    ) : (
      <div className="flex gap-3 overflow-x-auto pb-3">
        {teams.map((team) => (
          <TeamColumn
            key={team.team.id}
            team={team}
            canManage={canManage}
            currentUserId={currentUserId}
            editingNeeds={editingNeeds}
            onNeedChange={onNeedChange}
            onRemoveAssignment={onRemoveAssignment}
            onRespond={onRespond}
          />
        ))}
      </div>
    )}
  </div>
);

interface TeamColumnProps {
  team: PlanTeamView;
  canManage: boolean;
  currentUserId: string | null;
  editingNeeds: boolean;
  onNeedChange: (positionId: string, needed: number) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
}

const TeamColumn = ({
  team,
  canManage,
  currentUserId,
  editingNeeds,
  onNeedChange,
  onRemoveAssignment,
  onRespond,
}: TeamColumnProps) => {
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
        <span title="Confirmed">
          <span className="mr-1 text-emerald-600">✓</span>
          {team.confirmed}
        </span>
        <span title="Declined">
          <span className="mr-1 text-rose-500">✕</span>
          {team.declined}
        </span>
        <span title="Awaiting reply">
          <span className="mr-1 text-amber-500">?</span>
          {team.pending}
        </span>
      </div>
    </header>

    {team.positions.length === 0 && team.unpositioned.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-slate-400">
        This team has no positions yet.
      </p>
    ) : !hasVisibleRows ? (
      <p className="px-4 py-6 text-center text-xs text-slate-400">
        Nobody scheduled, and no positions needed.
      </p>
    ) : (
      <div>
        {team.positions.map((position) => (
          <PositionBlock
            key={position.position.id}
            position={position}
            canManage={canManage}
            currentUserId={currentUserId}
            editingNeeds={editingNeeds}
            onNeedChange={onNeedChange}
            onRemoveAssignment={onRemoveAssignment}
            onRespond={onRespond}
          />
        ))}

        {team.unpositioned.length > 0 && (
          <div>
            <p className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">
              No position
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
  currentUserId: string | null;
  editingNeeds: boolean;
  onNeedChange: (positionId: string, needed: number) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
}

const PositionBlock = ({
  position,
  canManage,
  currentUserId,
  editingNeeds,
  onNeedChange,
  onRemoveAssignment,
  onRespond,
}: PositionBlockProps) => {
  // A position with nobody on it and nothing asked for is noise outside the editor.
  if (!editingNeeds && position.scheduled.length === 0 && position.needed === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between bg-slate-50 px-4 py-1.5">
        <p className="text-xs font-medium text-slate-500">{position.position.name}</p>
        {!editingNeeds && position.needed > 0 && (
          <p
            className={`text-xs tabular-nums ${
              position.scheduled.length >= position.needed ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {position.scheduled.length}/{position.needed}
          </p>
        )}
      </div>

      {editingNeeds && (
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs text-slate-400">
            {position.scheduled.length} scheduled
          </span>
          <NeededStepper
            label={position.position.name}
            needed={position.needed}
            disabled={!canManage}
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
            />
          ))}
        </ul>
      )}
    </div>
  );
};

const STEPPER_BUTTON =
  'grid size-6 place-items-center rounded border border-slate-300 text-slate-500 transition hover:bg-slate-50 disabled:opacity-30';

const NeededStepper = ({
  label,
  needed,
  disabled,
  onChange,
}: {
  label: string;
  needed: number;
  disabled: boolean;
  onChange: (needed: number) => void;
}) => (
  <div className="flex items-center gap-1.5 text-xs">
    <span className="text-slate-500">Needed</span>
    <button
      type="button"
      aria-label={`One fewer ${label}`}
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
      aria-label={`One more ${label}`}
      className={STEPPER_BUTTON}
      disabled={disabled || needed >= 99}
      onClick={() => onChange(needed + 1)}
    >
      +
    </button>
  </div>
);

const ScheduledPerson = ({
  assignment,
  canManage,
  currentUserId,
  onRemove,
  onRespond,
}: {
  assignment: AssignmentDetail;
  canManage: boolean;
  currentUserId: string | null;
  onRemove: () => void;
  onRespond: (assignmentId: string, status: 'confirmed' | 'declined') => void;
}) => {
  const name = assignment.person?.full_name ?? assignment.person?.email ?? 'Unknown';
  const isMine = assignment.user_id === currentUserId;

  return (
    <li className="flex items-center gap-2 px-4 py-2">
      <Avatar name={name} url={assignment.person?.avatar_url} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>

      {isMine && assignment.status === 'unconfirmed' ? (
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => onRespond(assignment.id, 'confirmed')}
            className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => onRespond(assignment.id, 'declined')}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-300"
          >
            Decline
          </button>
        </span>
      ) : (
        <span
          className={`size-2 shrink-0 rounded-full ${assignmentDot[assignment.status]}`}
          title={ASSIGNMENT_STATUS_LABELS[assignment.status]}
        />
      )}

      {canManage && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="text-slate-300 hover:text-rose-500"
        >
          ×
        </button>
      )}
    </li>
  );
};
