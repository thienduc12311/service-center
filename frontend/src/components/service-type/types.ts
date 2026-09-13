import type { PlanRecurrence } from '@service-center/shared';

/** The three panels of the "Add a Service Type" wizard, in order. */
export type WizardStep = 'name' | 'times' | 'teams';

export const WIZARD_STEPS: readonly WizardStep[] = ['name', 'times', 'teams'];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  name: 'Name',
  times: 'Times',
  teams: 'Teams',
};

/**
 * One row of the "service times" step. Dates and times are held as the local
 * `YYYY-MM-DD` / `HH:mm` strings the native inputs produce, and only turned
 * into instants at submit time.
 */
export interface ServiceTimeDraft {
  /** Stable across re-renders so React keys survive a row being removed. */
  id: string;
  date: string;
  from: string;
  to: string;
}

export interface NameStepValue {
  name: string;
  recurrence: PlanRecurrence;
}
