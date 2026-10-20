import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { PlanDetail } from '@service-center/shared';
import { Avatar, Button } from '../ui';
import { assignmentDot } from '../../lib/format';
import type { PlanTeamView } from './types';
import { PlanNotesPanel } from '../collaboration/PlanNotesPanel';
import { useFormatters } from '../../i18n';

export interface PlanSidebarProps {
  plan: PlanDetail;
  /** plans.edit on this plan's service type: times, notes, imports. */
  canEditPlan: boolean;
  /** scheduling.manage for at least one team on this plan. */
  canSchedule: boolean;
  /** Teams the signed-in person is on, or is scheduled for on this plan. */
  myTeams: PlanTeamView[];
  everyTeam: PlanTeamView[];
  showAllTeams: boolean;
  onToggleAllTeams: () => void;
  onEditTimes: () => void;
  onImportTemplate: () => void;
  onAddPeople: () => void;
  onEditNeededPositions: () => void;
}

interface SectionHeadingProps {
  icon: string;
  title: string;
  action?: ReactNode;
}

const SectionHeading = ({ icon, title, action }: SectionHeadingProps) => (
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
  canEditPlan,
  canSchedule,
  myTeams,
  everyTeam,
  showAllTeams,
  onToggleAllTeams,
  onEditTimes,
  onImportTemplate,
  onAddPeople,
  onEditNeededPositions,
}: PlanSidebarProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
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
          title={t('sidebar.times')}
          action={
            canEditPlan && (
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onEditTimes}>
                {t('common:actions.edit')}
              </Button>
            )
          }
        />
        {plan.times.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
            {t('sidebar.noTimes')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {plan.times.map((time) => (
              <li key={time.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <p className="font-medium text-slate-700">
                  {time.name ?? t(`timeKind.${time.kind}`)}
                </p>
                <p className="text-slate-500">
                  {t('sidebar.timeRange', {
                    date: format.date(time.starts_at),
                    start: format.time(time.starts_at),
                    end: format.time(time.ends_at),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ teams -- */}
      <section>
        <SectionHeading icon="⚇" title={t('sidebar.teams')} />

        <div className="card p-3">
          {scheduledCount === 0 ? (
            <div className="space-y-3 py-3 text-center">
              <p className="text-sm text-slate-500">
                {showAllTeams ? t('sidebar.noPeopleAnyTeam') : <Trans t={t} i18nKey="sidebar.noPeopleMyTeams" components={[<em key="your" />]} />}
              </p>
              {!showAllTeams && (
                <p className="text-xs italic leading-relaxed text-slate-400">
                  {t('sidebar.myTeamsHint')}
                </p>
              )}
              {(canEditPlan || canSchedule) && (
                <div className="flex flex-col items-stretch gap-1.5">
                  {canEditPlan && (
                    <Button variant="secondary" className="!py-1 text-xs" onClick={onImportTemplate}>
                      {t('sidebar.importTemplate')}
                    </Button>
                  )}
                  {canSchedule && (
                    <Button variant="secondary" className="!py-1 text-xs" onClick={onAddPeople}>
                      {t('sidebar.addPeople')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="!py-1 text-xs"
                    onClick={onEditNeededPositions}
                  >
                    {t('sidebar.neededPositions')}
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
                              {assignment.person?.full_name ?? assignment.person?.email ?? t('common:states.unknown')}
                              {assignment.position && (
                                <span className="block text-[11px] text-slate-400">
                                  {assignment.position.name}
                                </span>
                              )}
                            </span>
                            <span
                              className={`size-2 shrink-0 rounded-full ${assignmentDot[assignment.status]}`}
                              title={t(`common:assignmentStatus.${assignment.status}`)}
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
          {showAllTeams ? t('sidebar.showMyTeams') : t('sidebar.showAllTeams')}
        </button>
      </section>

      <PlanNotesPanel planId={plan.id} />
    </aside>
  );
};
