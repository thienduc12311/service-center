/**
 * F11: planned running-order timing and item responsibility, derived from
 * the plan rather than stored.
 *
 * Timing rules (Service Center choices, documented in the F11 ledger):
 * - Service items run back to back from the selected service time's start.
 * - Headers consume no time: they start and end where the next item starts.
 * - Before-service items end exactly at the service start (counted
 *   backwards); after-service items start at the planned finish. Neither
 *   counts toward the service's length.
 * - Running past the service time's end is a warning; no item is shortened.
 * All arithmetic is in whole seconds, so totals reconcile exactly.
 */

import type { AssignmentStatus, PlanItemRow, PlanItemSegment, PlanTimeRow } from '../types/database.js';
import type {
  ItemLeader,
  ItemLeaderHolder,
  PlanItemLeaderPerson,
  PlanSchedule,
  PlanScheduleWarning,
  PlannedItemTime,
} from '../types/plan-order.js';

/** The item fields timing reads. `service_segment` may be absent on older rows. */
export type ScheduleItem = Pick<PlanItemRow, 'id' | 'item_type' | 'length_seconds'> & {
  service_segment?: PlanItemSegment | null;
};

/** The time fields timing reads. */
export type ScheduleTime = Pick<PlanTimeRow, 'id' | 'kind' | 'name' | 'starts_at' | 'ends_at'>;

export interface ComputePlanScheduleInput {
  /** Items in running order (the plan detail's order). */
  items: readonly ScheduleItem[];
  time: ScheduleTime | null;
}

const segmentOf = (item: ScheduleItem): PlanItemSegment => item.service_segment ?? 'service';
const durationOf = (item: ScheduleItem): number =>
  item.item_type === 'header' ? 0 : Math.max(0, Math.trunc(item.length_seconds));
const iso = (ms: number): string => new Date(ms).toISOString();

/** Service times in start order; rehearsals and other times are not timed against. */
export const serviceTimesOf = <T extends ScheduleTime>(times: readonly T[]): T[] =>
  times
    .filter((time) => time.kind === 'service')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));

/**
 * The requested service time, or the first one. `undefined` when an id was
 * asked for that is not one of this plan's service times.
 */
export const selectServiceTime = <T extends ScheduleTime>(
  times: readonly T[],
  timeId?: string | null,
): T | null | undefined => {
  const services = serviceTimesOf(times);
  if (timeId) return services.find((time) => time.id === timeId);
  return services[0] ?? null;
};

export const computePlanSchedule = ({ items, time }: ComputePlanScheduleInput): PlanSchedule => {
  const warnings: PlanScheduleWarning[] = [];
  const bySegment = (segment: PlanItemSegment) => items.filter((item) => segmentOf(item) === segment);
  const pre = bySegment('pre');
  const service = bySegment('service');
  const post = bySegment('post');
  const total = (list: readonly ScheduleItem[]) => list.reduce((sum, item) => sum + durationOf(item), 0);
  const preSeconds = total(pre);
  const serviceSeconds = total(service);
  const postSeconds = total(post);

  // A before item listed after the first service item (or an after item
  // before the last one) still times by its segment; flag the listing.
  const firstService = items.findIndex((item) => segmentOf(item) === 'service');
  const lastService = items.length - 1 - [...items].reverse().findIndex((item) => segmentOf(item) === 'service');
  items.forEach((item, index) => {
    if (firstService === -1) return;
    if ((segmentOf(item) === 'pre' && index > firstService) || (segmentOf(item) === 'post' && index < lastService)) {
      warnings.push({ code: 'segment_out_of_order', item_id: item.id });
    }
  });

  if (!time) {
    warnings.push({ code: 'no_service_time' });
    return {
      time_id: null,
      service_starts_at: null,
      service_scheduled_end: null,
      planned_finish_at: null,
      pre_seconds: preSeconds,
      service_seconds: serviceSeconds,
      post_seconds: postSeconds,
      items: [],
      warnings,
    };
  }

  const start = Date.parse(time.starts_at);
  const rows = new Map<string, PlannedItemTime>();
  const lay = (list: readonly ScheduleItem[], segment: PlanItemSegment, fromSeconds: number) => {
    let cursor = fromSeconds;
    for (const item of list) {
      const duration = durationOf(item);
      rows.set(item.id, {
        item_id: item.id,
        segment,
        starts_at: iso(start + cursor * 1000),
        ends_at: iso(start + (cursor + duration) * 1000),
        offset_seconds: cursor,
        duration_seconds: duration,
      });
      cursor += duration;
    }
  };
  lay(pre, 'pre', -preSeconds);
  lay(service, 'service', 0);
  lay(post, 'post', serviceSeconds);

  const finish = start + serviceSeconds * 1000;
  const scheduledEnd = Date.parse(time.ends_at);
  if (finish > scheduledEnd) warnings.push({ code: 'runs_over', seconds: Math.round((finish - scheduledEnd) / 1000) });

  return {
    time_id: time.id,
    service_starts_at: iso(start),
    service_scheduled_end: iso(scheduledEnd),
    planned_finish_at: iso(finish),
    pre_seconds: preSeconds,
    service_seconds: serviceSeconds,
    post_seconds: postSeconds,
    // Running order, not segment order: each item keeps its place in the list.
    items: items.flatMap((item) => (rows.has(item.id) ? [rows.get(item.id)!] : [])),
    warnings,
  };
};

/** The assignment fields leader resolution reads. */
export interface LeaderAssignment {
  person_id: string;
  position_id: string | null;
  status: AssignmentStatus;
  visibility?: string | null;
  person: { full_name: string | null } | null;
  position?: { id: string; name: string } | null;
}

export interface ResolveItemLeaderInput {
  item: Pick<PlanItemRow, 'leader_person_id' | 'leader_position_id'> & {
    leader_person?: PlanItemLeaderPerson | null;
  };
  /** The plan's assignments the reader can see (prepared ones only for its schedulers). */
  assignments: readonly LeaderAssignment[];
  /** Position names known from the plan or teams, for an unfilled position. */
  positionNames?: ReadonlyMap<string, string>;
}

/**
 * A direct Person stays the leader whatever the staffing. A position leader
 * is whoever holds it on this plan now: none (unfilled), one, or several —
 * each listed, never silently narrowed to one. Declined requests do not lead.
 */
export const resolveItemLeader = ({ item, assignments, positionNames }: ResolveItemLeaderInput): ItemLeader => {
  if (item.leader_person_id) {
    return { kind: 'person', person_id: item.leader_person_id, name: item.leader_person?.full_name ?? null };
  }
  if (!item.leader_position_id) return { kind: 'none' };
  const positionId = item.leader_position_id;
  const holding = assignments.filter((a) => a.position_id === positionId && a.status !== 'declined');
  const seen = new Set<string>();
  const holders: ItemLeaderHolder[] = [];
  for (const assignment of holding) {
    if (seen.has(assignment.person_id)) continue;
    seen.add(assignment.person_id);
    holders.push({
      person_id: assignment.person_id,
      name: assignment.person?.full_name ?? null,
      status: assignment.status === 'confirmed' ? 'confirmed' : 'unconfirmed',
      prepared: assignment.visibility === 'prepared',
    });
  }
  holders.sort((a, b) => Number(a.prepared) - Number(b.prepared) || (a.name ?? '').localeCompare(b.name ?? ''));
  const named = assignments.find((a) => a.position?.id === positionId)?.position?.name;
  return {
    kind: 'position',
    position_id: positionId,
    position_name: named ?? positionNames?.get(positionId) ?? null,
    holders,
  };
};

/** One line for a leader: "Sam Rivera", "Worship Leader: unfilled", "Keys: A, B". */
export const describeItemLeader = (leader: ItemLeader): string | null => {
  switch (leader.kind) {
    case 'none':
      return null;
    case 'person':
      return leader.name ?? 'Someone on the roster';
    case 'position': {
      const label = leader.position_name ?? 'Position';
      if (leader.holders.length === 0) return `${label}: unfilled`;
      const names = leader.holders.map((holder) => `${holder.name ?? 'Someone'}${holder.prepared ? ' (not yet asked)' : ''}`);
      return `${label}: ${names.join(', ')}`;
    }
  }
};
