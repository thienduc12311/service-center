import type { PlanTimeKind } from '@service-center/shared';

/** The part of a submitted plan time that decides the plan's own date. */
export interface PlanTimeStart {
  kind?: PlanTimeKind;
  starts_at: string;
}

/**
 * The instant `plans.service_date` should show for a full list of times: the
 * earliest service time, as an ISO string. Null when there is no service time
 * (rehearsals alone never move the plan's date).
 */
export const earliestServiceStart = (times: readonly PlanTimeStart[]): string | null => {
  let earliest: number | null = null;
  for (const time of times) {
    if ((time.kind ?? 'service') !== 'service') continue;
    const at = Date.parse(time.starts_at);
    if (!Number.isNaN(at) && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
};
