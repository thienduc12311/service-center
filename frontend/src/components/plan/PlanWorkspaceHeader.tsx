import { Link } from 'react-router-dom';
import { PLAN_STATUS_LABELS, formatDate, type PlanDetail } from '@service-center/shared';
import { Badge, Menu, MenuItem } from '../ui';
import { planTone } from '../../lib/format';

export interface PlanWorkspaceHeaderProps {
  plan: PlanDetail;
  organizationName: string;
  canManage: boolean;
  /** Sibling plans of the same service type, for the date arrows. */
  previousPlanId: string | null;
  nextPlanId: string | null;
  creatingNextPlan: boolean;
  onCreateNextPlan: () => void;
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
  previousPlanId,
  nextPlanId,
  creatingNextPlan,
  onCreateNextPlan,
  onTogglePublished,
  onNotify,
  onDelete,
}: PlanWorkspaceHeaderProps) => (
  <header className="border-b border-slate-200 pb-4 dark:border-slate-800">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm text-slate-400">{organizationName}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {plan.title}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <Badge tone={planTone[plan.status]}>{PLAN_STATUS_LABELS[plan.status]}</Badge>
        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Print this plan"
          className="grid size-8 place-items-center rounded-lg text-slate-500 ring-1 ring-slate-300 transition hover:bg-slate-50"
        >
          ⎙
        </button>
        {canManage && (
          <Menu label="Actions">
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    onTogglePublished();
                    close();
                  }}
                >
                  {plan.status === 'published' ? 'Unpublish' : 'Publish'}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    onNotify();
                    close();
                  }}
                >
                  Send notifications
                </MenuItem>
                <MenuItem
                  tone="danger"
                  onClick={() => {
                    onDelete();
                    close();
                  }}
                >
                  Delete plan
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2">
      {previousPlanId ? (
        <Link to={`/plans/${previousPlanId}`} aria-label="Previous plan" className={NAV_BUTTON}>
          ‹
        </Link>
      ) : (
        <span className={`${NAV_BUTTON} opacity-30`} aria-hidden="true">
          ‹
        </span>
      )}
      {nextPlanId ? (
        <Link to={`/plans/${nextPlanId}`} aria-label="Next plan" className={NAV_BUTTON}>
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
          aria-label="Add the next plan"
          title={
            plan.service_type
              ? `Add the next ${plan.service_type.name} plan`
              : 'Add the next plan'
          }
          className={NAV_BUTTON}
        >
          +
        </button>
      )}
      <span className="rounded-lg px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-300 dark:text-slate-200">
        {formatDate(plan.service_date, { month: 'long', day: 'numeric', year: 'numeric' })}
      </span>
      {plan.location && <span className="text-sm text-slate-400">{plan.location}</span>}
    </div>
  </header>
);
