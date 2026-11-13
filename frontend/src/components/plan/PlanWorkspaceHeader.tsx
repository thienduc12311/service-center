import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PlanDetail } from '@service-center/shared';
import { Badge, Button, DateTile, IconButton, Menu, MenuItem } from '../ui';
import { Icon } from '../icons';
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

/** A square nav target sized to match `IconButton size="sm"`, with a hairline ring. */
const NAV_BUTTON =
  'grid size-8 place-items-center text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white';

interface PlanNavLinkProps {
  planId: string | null;
  label: string;
  children: ReactNode;
}

const PlanNavLink = ({ planId, label, children }: PlanNavLinkProps) =>
  planId ? (
    <Link to={`/plans/${planId}`} aria-label={label} title={label} className={NAV_BUTTON}>
      {children}
    </Link>
  ) : (
    <span className={`${NAV_BUTTON} pointer-events-none opacity-30`} aria-hidden="true">
      {children}
    </span>
  );

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
    <header className="space-y-4">
      <Link
        to="/plans"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-200"
      >
        <Icon name="chevronLeft" className="size-4" />
        {t('common:nav.plans')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          <DateTile value={plan.service_date} className="hidden sm:flex" />
          <div className="min-w-0">
            <p className="section-label text-brand-600 dark:text-brand-200">{organizationName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-[28px] sm:leading-9 dark:text-white">
                {plan.title}
              </h1>
              <Badge tone={planTone[plan.status]}>{t(`common:planStatus.${plan.status}`)}</Badge>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="calendar" className="size-4" />
                {format.date(plan.service_date, 'long')}
              </span>
              {plan.location && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="mapPin" className="size-4" />
                  {plan.location}
                </span>
              )}
              {plan.service_type && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="plans" className="size-4" />
                  {plan.service_type.name}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex divide-x divide-slate-200 overflow-hidden rounded-xl bg-white shadow-sm shadow-slate-900/5 ring-1 ring-inset ring-slate-300 dark:divide-slate-700 dark:bg-slate-900 dark:ring-slate-700">
            <PlanNavLink planId={previousPlanId} label={t('header.previousPlan')}>
              <Icon name="chevronLeft" className="size-4" />
            </PlanNavLink>
            <PlanNavLink planId={nextPlanId} label={t('header.nextPlan')}>
              <Icon name="chevronRight" className="size-4" />
            </PlanNavLink>
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
                className={`${NAV_BUTTON} disabled:opacity-30`}
              >
                <Icon name="plus" className="size-4" />
              </button>
            )}
          </div>

          <Button variant="secondary" icon="music" onClick={onExportSongBook}>
            <span className="hidden sm:inline">{t('header.exportSongBook')}</span>
            <span className="sr-only sm:hidden">{t('header.exportSongBook')}</span>
          </Button>
          <IconButton
            icon="document"
            label={t('header.printPlan')}
            onClick={() => window.print()}
            className="ring-1 ring-inset ring-slate-300 dark:ring-slate-700"
          />
          {(canManage || canNotify) && (
            <Menu label={t('header.actions')}>
              {(close) => (
                <>
                  {canManage && (
                    <MenuItem
                      icon={plan.status === 'published' ? 'close' : 'check'}
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
                      icon="bell"
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
                      icon="trash"
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
    </header>
  );
};
