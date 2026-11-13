import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { PlanDetail } from '@service-center/shared';
import { Avatar, Button } from '../ui';
import { Icon, type IconName } from '../icons';
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
  icon: IconName;
  title: string;
  action?: ReactNode;
}

const SectionHeading = ({ icon, title, action }: SectionHeadingProps) => (
  <div className="mb-2.5 flex min-h-8 items-center gap-2">
    <Icon name={icon} className="size-4 text-slate-400 dark:text-slate-500" />
    <h2 className="section-label">{title}</h2>
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
          icon="clock"
          title={t('sidebar.times')}
          action={
            canEditPlan && (
              <Button variant="ghost" size="sm" icon="pencil" onClick={onEditTimes}>
                {t('common:actions.edit')}
              </Button>
            )
          }
        />
        {plan.times.length === 0 ? (
          <p className="surface-inset px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
            {t('sidebar.noTimes')}
          </p>
        ) : (
          <ul className="card row-list overflow-hidden">
            {plan.times.map((time) => (
              <li key={time.id} className="flex items-start gap-2.5 px-3 py-2.5 text-xs">
                <span
                  aria-hidden="true"
                  className={`mt-1 size-2 shrink-0 rounded-full ${
                    time.kind === 'service' ? 'bg-brand-500' : time.kind === 'rehearsal' ? 'bg-amber-400' : 'bg-slate-400'
                  }`}
                />
                <div className="min-w-0">
                <p className="font-medium text-slate-800 dark:text-slate-100">
                  {time.name ?? t(`timeKind.${time.kind}`)}
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  {t('sidebar.timeRange', {
                    date: format.date(time.starts_at),
                    start: format.time(time.starts_at),
                    end: format.time(time.ends_at),
                  })}
                </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ teams -- */}
      <section>
        <SectionHeading icon="team" title={t('sidebar.teams')} />

        <div className="card p-3.5">
          {scheduledCount === 0 ? (
            <div className="space-y-3 py-3 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {showAllTeams ? t('sidebar.noPeopleAnyTeam') : <Trans t={t} i18nKey="sidebar.noPeopleMyTeams" components={[<em key="your" />]} />}
              </p>
              {!showAllTeams && (
                <p className="text-xs italic leading-relaxed text-slate-400 dark:text-slate-500">
                  {t('sidebar.myTeamsHint')}
                </p>
              )}
              {(canEditPlan || canSchedule) && (
                <div className="flex flex-col items-stretch gap-1.5">
                  {canEditPlan && (
                    <Button variant="secondary" size="sm" icon="document" onClick={onImportTemplate}>
                      {t('sidebar.importTemplate')}
                    </Button>
                  )}
                  {canSchedule && (
                    <Button variant="secondary" size="sm" icon="plus" onClick={onAddPeople}>
                      {t('sidebar.addPeople')}
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" icon="people" onClick={onEditNeededPositions}>
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
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{team.team.name}</span>
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
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
                              {assignment.person?.full_name ?? assignment.person?.email ?? t('common:states.unknown')}
                              {assignment.position && (
                                <span className="block text-[11px] text-slate-400 dark:text-slate-500">
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
          className="mt-2 w-full rounded-lg py-1 text-center text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-brand-200"
        >
          {showAllTeams ? t('sidebar.showMyTeams') : t('sidebar.showAllTeams')}
        </button>
      </section>

      <PlanNotesPanel planId={plan.id} />
    </aside>
  );
};
