import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PlanDetail } from '@service-center/shared';
import { Badge, Menu, MenuItem } from '../ui';
import { planTone } from '../../lib/format';
import { useFormatters } from '../../i18n';

export interface PlanWorkspaceHeaderProps {
  plan: PlanDetail;
  organizationName: string;
  /** plans.edit on this plan's service type: publish, delete, add the next plan. */
  canManage: boolean;
  /** scheduling.manage somewhere on this plan: send reminders. */
  canNotify: boolean;
  /** Sibling plans of the same service type, for the date arrows. */
  previousPlanId: string | null;
  nextPlanId: string | null;
  creatingNextPlan: boolean;
  onCreateNextPlan: () => void;
  onExportSongBook: () => void;
  onTogglePublished: () => void;
  onNotify: () => void;
  onDelete: () => void;
}

const NAV_BUTTON =
  'grid size-8 place-items-center rounded-lg text-slate-500 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-30';

export const PlanWorkspaceHeader = ({
  plan,
  organizationName,
  canManage,
  canNotify,
  previousPlanId,
  nextPlanId,
  creatingNextPlan,
  onCreateNextPlan,
  onExportSongBook,
  onTogglePublished,
  onNotify,
  onDelete,
}: PlanWorkspaceHeaderProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  return (
    <header className="border-b border-slate-200 pb-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{organizationName}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {plan.title}
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={planTone[plan.status]}>{t(`common:planStatus.${plan.status}`)}</Badge>
          <button
            type="button"
            onClick={onExportSongBook}
            className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"
          >
            {t('header.exportSongBook')}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            aria-label={t('header.printPlan')}
            className="grid size-8 place-items-center rounded-lg text-slate-500 ring-1 ring-slate-300 transition hover:bg-slate-50"
          >
            ⎙
          </button>
          {(canManage || canNotify) && (
            <Menu label={t('header.actions')}>
              {(close) => (
                <>
                  {canManage && (
                    <MenuItem
                      onClick={() => {
                        onTogglePublished();
                        close();
                      }}
                    >
                      {plan.status === 'published' ? t('header.unpublish') : t('header.publish')}
                    </MenuItem>
                  )}
                  {canNotify && (
                    <MenuItem
                      onClick={() => {
                        onNotify();
                        close();
                      }}
                    >
                      {t('header.sendNotifications')}
                    </MenuItem>
                  )}
                  {canManage && (
                    <MenuItem
                      tone="danger"
                      onClick={() => {
                        onDelete();
                        close();
                      }}
                    >
                      {t('header.deletePlan')}
                    </MenuItem>
                  )}
                </>
              )}
            </Menu>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {previousPlanId ? (
          <Link to={`/plans/${previousPlanId}`} aria-label={t('header.previousPlan')} className={NAV_BUTTON}>
            ‹
          </Link>
        ) : (
          <span className={`${NAV_BUTTON} opacity-30`} aria-hidden="true">
            ‹
          </span>
        )}
        {nextPlanId ? (
          <Link to={`/plans/${nextPlanId}`} aria-label={t('header.nextPlan')} className={NAV_BUTTON}>
            ›
          </Link>
        ) : (
          <span className={`${NAV_BUTTON} opacity-30`} aria-hidden="true">
            ›
          </span>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onCreateNextPlan}
            disabled={creatingNextPlan}
            aria-label={t('header.addNextPlan')}
            title={
              plan.service_type
                ? t('header.addNextPlanOfType', { serviceType: plan.service_type.name })
                : t('header.addNextPlan')
            }
            className={NAV_BUTTON}
          >
            +
          </button>
        )}
        <span className="rounded-lg px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-300 dark:text-slate-200">
          {format.date(plan.service_date, 'long')}
        </span>
        {plan.location && <span className="text-sm text-slate-400">{plan.location}</span>}
      </div>
    </header>
  );
};
