import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PlanSummary } from '@service-center/shared';
import { Badge, DateTile } from '../ui';
import { Icon } from '../icons';
import { assignmentTone, planTone } from '../../lib/format';
import { useFormatters } from '../../i18n';

export interface PlanListCardProps {
  plan: PlanSummary;
  /** Show the service type and its recurrence under the title (the full plans list). */
  showServiceType?: boolean;
  /** Show a declined-count badge beside the pending one. */
  showDeclined?: boolean;
}

/**
 * One plan in a dated list: a date tile, title and status, a time/location
 * meta line, and staffing counts. The whole card links to the plan.
 */
export const PlanListCard = ({ plan, showServiceType = false, showDeclined = false }: PlanListCardProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const past = new Date(plan.service_date) < new Date();

  return (
    <Link
      to={`/plans/${plan.id}`}
      className="card card-interactive @container block"
    >
      {/* Laid out by the card's own width, not the viewport: it also sits in narrow dashboard columns. */}
      <div className="flex items-center gap-4 p-3 @lg:p-4">
        <DateTile value={plan.service_date} muted={past || plan.status === 'archived'} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-semibold text-slate-900 dark:text-white">{plan.title}</span>
            <Badge tone={planTone[plan.status]}>{t(`common:planStatus.${plan.status}`)}</Badge>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" className="size-3.5" />
              {format.time(plan.service_date)}
            </span>
            {plan.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Icon name="mapPin" className="size-3.5" />
                <span className="truncate">{plan.location}</span>
              </span>
            )}
            {showServiceType && plan.service_type && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {t(`plansPage.serviceTypeRecurrence.${plan.service_type.recurrence}`, { name: plan.service_type.name })}
              </span>
            )}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500 @lg:hidden dark:text-slate-400">
            <PlanCounts plan={plan} showDeclined={showDeclined} />
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-3 text-sm text-slate-500 @lg:flex dark:text-slate-400">
          <PlanCounts plan={plan} showDeclined={showDeclined} />
        </div>

        <Icon name="chevronRight" className="hidden size-4 shrink-0 text-slate-300 @lg:block dark:text-slate-600" />
      </div>
    </Link>
  );
};

interface PlanCountsProps {
  plan: PlanSummary;
  showDeclined: boolean;
}

const PlanCounts = ({ plan, showDeclined }: PlanCountsProps) => {
  const { t } = useTranslation(['plans', 'common']);
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Icon name="music" className="size-3.5" />
        {t('common:count.songs', { count: plan.counts.songs })}
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon name="check" className="size-3.5" />
        {t('plansPage.confirmedCount', { number: plan.counts.confirmed })}
      </span>
      {plan.counts.unconfirmed > 0 && (
        <Badge tone={assignmentTone.unconfirmed}>
          {t('plansPage.pendingCount', { number: plan.counts.unconfirmed })}
        </Badge>
      )}
      {showDeclined && plan.counts.declined > 0 && (
        <Badge tone={assignmentTone.declined}>
          {t('plansPage.declinedCount', { number: plan.counts.declined })}
        </Badge>
      )}
    </>
  );
};
