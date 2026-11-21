import type { PlanRow, PlanStatus } from '@service-center/shared';

/** ADR-0006: what publishing a plan should do. */
export interface PublishPlanInput {
  planId: string;
  /** Ask everyone released and never notified (ignored for a past plan). */
  notify: boolean;
  /** Stable for a retried publish so it never asks twice. */
  effectKey: string;
}

/** The published plan and the request effect publishing recorded, if anyone was asked. */
export interface PublishPlanOutcome {
  plan: PlanRow;
  effectId: string | null;
}

/** The row `publish_plan_notify` returns. */
export interface PublishPlanRpcRow {
  plan: PlanRow;
  effect_id: string | null;
}

/**
 * ADR-0006: scheduling on a plan that isn't published sends nothing; everyone
 * released is asked when it is published.
 */
export const isHeldUntilPublish = (status: PlanStatus): boolean => status !== 'published';

/** The effect key a publish records, so a retried request finds the first one. */
export const publishEffectKey = (planId: string, clientKey: string): string => `publish:${planId}:${clientKey}`;
