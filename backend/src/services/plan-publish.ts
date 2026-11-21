import type { PlanPublishPreview } from '@service-center/shared';
import { unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import type { PublishPlanInput, PublishPlanOutcome, PublishPlanRpcRow } from '../model/plan-publish.model.js';

/**
 * ADR-0006: publishes the plan and, unless told not to or the service date has
 * passed, records one request per Person for everyone released and never
 * notified — plan-wide, whatever teams the caller schedules. Publishing a plan
 * that is already published changes nothing and asks nobody.
 */
export const publishPlan = async (db: Db, input: PublishPlanInput): Promise<PublishPlanOutcome> => {
  const rows: PublishPlanRpcRow[] | null = await unwrap(
    db.rpc('publish_plan_notify', {
      p_plan: input.planId,
      p_notify: input.notify,
      p_effect_key: input.effectKey,
    }),
  );
  const row = rows?.[0];
  if (!row) throw HttpError.notFound('Plan not found');
  return { plan: row.plan, effectId: row.effect_id };
};

/** Who publishing would email right now, and who has no address. */
export const planPublishPreview = async (db: Db, planId: string): Promise<PlanPublishPreview> => {
  const rows: PlanPublishPreview[] | null = await unwrap(db.rpc('publish_plan_notify_preview', { p_plan: planId }));
  const row = rows?.[0];
  return { will_notify: row?.will_notify ?? 0, no_email: row?.no_email ?? [] };
};
