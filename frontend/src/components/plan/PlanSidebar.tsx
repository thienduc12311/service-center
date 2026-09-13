import type { ReactNode } from 'react';
import { ASSIGNMENT_STATUS_LABELS, formatDate, formatTime, type PlanDetail } from '@service-center/shared';
import { Avatar, Button } from '../ui';
import { assignmentDot } from '../../lib/format';
import type { PlanTeamView } from './types';

export interface PlanSidebarProps {
  plan: PlanDetail;
  canManage: boolean;
  /** Teams the signed-in person is on, or is scheduled for on this plan. */
  myTeams: PlanTeamView[];
  everyTeam: PlanTeamView[];
  showAllTeams: boolean;
  onToggleAllTeams: () => void;
  onEditTimes: () => void;
  onImportTemplate: () => void;
  onAddPeople: () => void;
  onEditNeededPositions: () => void;
  onEditNotes: () => void;
}

const SectionHeading = ({
  icon,
  title,
  action,
}: {
  icon: string;
  title: string;
  action?: ReactNode;
}) => (
  <div className="mb-2 flex items-center gap-2">
    <span aria-hidden="true" className="text-slate-400">
      {icon}
    </span>
    <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</h2>
    {action && <div className="ml-auto">{action}</div>}
  </div>
);

export const PlanSidebar = ({
  plan,
  canManage,
  myTeams,
  everyTeam,
  showAllTeams,
  onToggleAllTeams,
  onEditTimes,
  onImportTemplate,
  onAddPeople,
  onEditNeededPositions,
  onEditNotes,
}: PlanSidebarProps) => {
  const teams = showAllTeams ? everyTeam : myTeams;
  const scheduledCount = teams.reduce(
    (total, team) => total + team.confirmed + team.declined + team.pending,
    0,
  );

  return (
    <aside className="space-y-6">
      {/* ------------------------------------------------------------ times -- */}
      <section>
        <SectionHeading
          icon="◷"
          title="Times"
          action={
            canManage && (
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onEditTimes}>
                Edit
              </Button>
            )
          }
        />
        {plan.times.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            No times on this plan yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {plan.times.map((time) => (
              <li key={time.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <p className="font-medium text-slate-700">
                  {time.name ?? (time.kind === 'service' ? 'Service' : time.kind)}
                </p>
                <p className="text-slate-500">
                  {formatDate(time.starts_at)} · {formatTime(time.starts_at)}–
                  {formatTime(time.ends_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ teams -- */}
      <section>
        <SectionHeading icon="⚇" title="Teams" />

        <div className="card p-3">
          {scheduledCount === 0 ? (
            <div className="space-y-3 py-3 text-center">
              <p className="text-sm text-slate-500">
                No people scheduled to {showAllTeams ? 'any team' : <em>your</em>} teams.
              </p>
              {!showAllTeams && (
                <p className="text-xs italic leading-relaxed text-slate-400">
                  “My Teams” are teams in which you are a leader, assigned to a position, or
                  scheduled for this plan.
                </p>
              )}
              {canManage && (
                <div className="flex flex-col items-stretch gap-1.5">
                  <Button variant="secondary" className="!py-1 text-xs" onClick={onImportTemplate}>
                    Import Template
                  </Button>
                  <Button variant="secondary" className="!py-1 text-xs" onClick={onAddPeople}>
                    Add People
                  </Button>
                  <Button
                    variant="secondary"
                    className="!py-1 text-xs"
                    onClick={onEditNeededPositions}
                  >
                    Needed Positions
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {teams
                .filter((team) => team.confirmed + team.declined + team.pending > 0)
                .map((team) => (
                  <li key={team.team.id}>
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: team.team.color }}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-slate-700">{team.team.name}</span>
                    </div>
                    <ul className="space-y-1">
                      {[...team.positions.flatMap((position) => position.scheduled), ...team.unpositioned].map(
                        (assignment) => (
                          <li key={assignment.id} className="flex items-center gap-2">
                            <Avatar
                              name={assignment.person?.full_name ?? assignment.person?.email}
                              url={assignment.person?.avatar_url}
                              size="sm"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs">
                              {assignment.person?.full_name ?? assignment.person?.email ?? 'Unknown'}
                              {assignment.position && (
                                <span className="block text-[11px] text-slate-400">
                                  {assignment.position.name}
                                </span>
                              )}
                            </span>
                            <span
                              className={`size-2 shrink-0 rounded-full ${assignmentDot[assignment.status]}`}
                              title={ASSIGNMENT_STATUS_LABELS[assignment.status]}
                            />
                          </li>
                        ),
                      )}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleAllTeams}
          className="mt-2 w-full text-center text-xs text-slate-500 hover:text-brand-600 hover:underline"
        >
          {showAllTeams ? 'Show my teams' : 'Show all teams'}
        </button>
      </section>

      {/* ------------------------------------------------------------ notes -- */}
      <section>
        <SectionHeading
          icon="🗒"
          title="Notes"
          action={
            canManage && (
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onEditNotes}>
                {plan.notes ? 'Edit' : 'Add'}
              </Button>
            )
          }
        />
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
          {plan.notes ? (
            <p className="whitespace-pre-wrap text-slate-600">{plan.notes}</p>
          ) : (
            <p className="text-slate-400">There are no notes for this plan.</p>
          )}
        </div>
      </section>
    </aside>
  );
};
