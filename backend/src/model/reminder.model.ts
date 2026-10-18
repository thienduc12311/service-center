import type {
  PlanReminderJob,
  PlanTimeRow,
  ReleaseReviewChannels,
  ReleaseReviewPlan,
  ReleaseReviewRecipient,
  ReminderJobRow,
} from '@service-center/shared';

/** A prepared request as read for a release review (database shape, already joined). */
export interface ReleaseCandidateRow {
  id: string;
  plan_id: string;
  person_id: string;
  request_revision: number;
  team: { name: string } | null;
  position: { name: string } | null;
  plan: { title: string; service_date: string } | null;
}

/** What `person_delivery_readiness` says about a recipient. */
export interface PersonReadiness {
  person_id: string;
  has_login: boolean;
  has_email: boolean;
  active: boolean;
}

/** Per-request applicable times, already resolved by the F04 attendance resolver. */
export interface ReleaseCandidateTimes {
  times: PlanTimeRow[];
  untimed: boolean;
}

/**
 * Which channels a released request can reach. In-app and push need a
 * login; push may still be skipped later when no device is registered,
 * which is only known at send time.
 */
export const releaseChannels = (readiness: PersonReadiness | undefined): { channels: ReleaseReviewChannels; skipped: string[] } => {
  const channels: ReleaseReviewChannels = {
    email: Boolean(readiness?.has_email),
    in_app: Boolean(readiness?.has_login),
    push: Boolean(readiness?.has_login),
  };
  const skipped: string[] = [];
  if (!readiness?.active) skipped.push('recipient_not_eligible');
  if (!channels.email) skipped.push('no_email_address');
  if (!channels.in_app) skipped.push('no_login');
  return { channels, skipped };
};

/**
 * Groups a reviewed set into one message per Person, each with one section
 * (and later one response action) per plan, in service-date order.
 */
export const groupReleaseRecipients = (
  rows: readonly ReleaseCandidateRow[],
  names: ReadonlyMap<string, string>,
  readiness: ReadonlyMap<string, PersonReadiness>,
  times: ReadonlyMap<string, ReleaseCandidateTimes>,
): ReleaseReviewRecipient[] => {
  const byPerson = new Map<string, ReleaseCandidateRow[]>();
  for (const row of rows) byPerson.set(row.person_id, [...(byPerson.get(row.person_id) ?? []), row]);

  return [...byPerson.entries()]
    .map(([personId, personRows]) => {
      const plans = new Map<string, ReleaseReviewPlan>();
      for (const row of personRows) {
        const plan = plans.get(row.plan_id) ?? {
          plan_id: row.plan_id,
          plan_title: row.plan?.title ?? 'Plan',
          service_date: row.plan?.service_date ?? '',
          assignments: [],
        };
        plan.assignments.push({
          assignment_id: row.id,
          request_revision: row.request_revision,
          team_name: row.team?.name ?? 'Team',
          position_name: row.position?.name ?? null,
          times: times.get(row.id)?.times ?? [],
          untimed: times.get(row.id)?.untimed ?? false,
        });
        plans.set(row.plan_id, plan);
      }
      const { channels, skipped } = releaseChannels(readiness.get(personId));
      return {
        person_id: personId,
        person_name: names.get(personId) ?? 'Person',
        channels,
        skipped,
        plans: [...plans.values()].sort((a, b) => a.service_date.localeCompare(b.service_date) || a.plan_id.localeCompare(b.plan_id)),
      };
    })
    .sort((a, b) => a.person_name.localeCompare(b.person_name) || a.person_id.localeCompare(b.person_id));
};

export const toPlanReminderJob = (row: ReminderJobRow, names: ReadonlyMap<string, string>): PlanReminderJob => ({
  id: row.id,
  person_id: row.person_id,
  person_name: names.get(row.person_id) ?? 'Person',
  kind: row.kind,
  channel: row.channel,
  status: row.status,
  status_reason: row.status_reason,
  due_at: row.due_at,
  occurrence_starts_at: row.occurrence_starts_at,
  policy_source: row.policy_id ? 'policy' : 'default',
});

export const personDisplayName = (person: { first_name: string | null; last_name: string | null }): string =>
  [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Person';
