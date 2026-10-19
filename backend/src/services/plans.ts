import type {
  AssignmentDetail,
  CreatePlanInput,
  DuplicatePlanInput,
  ImportPlanContentsInput,
  PlanDetail,
  PlanItemDetail,
  PlanPositionNeed,
  PlanSummary,
  TeamPositionRow,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { NO_CONTACT, contactsFor } from './contacts.js';
import { attendanceFor } from './attendance.js';
import { defaultArrangementsFor } from './plan-items.js';
import {
  PLAN_ITEM_MEDIA_COLUMNS,
  organizationToday,
  toRehearsalMediaRef,
  type PlanItemMediaEmbed,
} from '../model/media.model.js';

/**
 * `person:profiles!assignments_user_id_fkey` is spelled out because
 * `assignments` has several foreign keys into `profiles`, which PostgREST
 * cannot disambiguate on its own. Contact details are merged in afterwards
 * from `member_contacts` (people.view_private only). Prepared assignments are
 * present only for callers who schedule that team (RLS).
 */
export const PLAN_DETAIL_SELECT = `
  *,
  service_type:service_types(id, name, recurrence),
  times:plan_times(*),
  items:plan_items(
    *,
    song:songs(id, title, author, copyright, default_key, default_bpm),
    arrangement:arrangements(
      id, song_id, name, song_key, bpm, sequence, chord_chart,
      chart_columns, chart_font, chart_font_size, chart_chord_color, is_default, length_seconds
    ),
    media:media(${PLAN_ITEM_MEDIA_COLUMNS})
  ),
  assignments:assignments(
    *,
    team:teams(id, name, color),
    position:team_positions(id, name),
    person:profiles!assignments_user_id_fkey(id, full_name, avatar_url),
    response_owner:profiles!assignments_response_owner_id_fkey(id, full_name),
    attendance_times:assignment_attendance_times(plan_time_id),
    time_responses:assignment_time_responses(*)
  ),
  position_needs:plan_position_needs(
    needed,
    position:team_positions(id, team_id)
  ),
  plan_positions:team_positions(*)
`;

export const PLAN_SUMMARY_SELECT = `
  *,
  service_type:service_types(id, name, recurrence),
  times:plan_times(*),
  items:plan_items(id, item_type),
  assignments:assignments(id, status, visibility)
`;

type RawPositionNeed = {
  needed: number;
  position: { id: string; team_id: string } | null;
};

type RawPlan = Record<string, unknown> & {
  plan_positions?: TeamPositionRow[];
  items?: Array<{ item_type?: string }>;
  assignments?: Array<{ status?: string; visibility?: string }>;
  times?: Array<Record<string, unknown>>;
  position_needs?: RawPositionNeed[];
};

/**
 * The team is read back off the joined position rather than stored on the need
 * row, so a need can never claim a team the position doesn't belong to. A need
 * whose position has been deleted is dropped.
 */
export const shapePositionNeeds = (rows: readonly RawPositionNeed[] = []): PlanPositionNeed[] =>
  rows
    .filter((row): row is RawPositionNeed & { position: { id: string; team_id: string } } =>
      Boolean(row.position),
    )
    .map((row) => ({
      position_id: row.position.id,
      team_id: row.position.team_id,
      needed: row.needed,
    }));

const byKind = (times: RawPlan['times'] = []) =>
  [...times].sort(
    (a, b) => new Date(String(a.starts_at)).getTime() - new Date(String(b.starts_at)).getTime(),
  );

export const shapePlanSummary = (row: RawPlan): PlanSummary => {
  const items = row.items ?? [];
  // Prepared rows (visible to their schedulers only) are counted apart, so
  // "awaiting reply" never includes requests nobody has received.
  const all = row.assignments ?? [];
  const assignments = all.filter((a) => a.visibility !== 'prepared');
  return {
    ...(row as object),
    times: byKind(row.times),
    counts: {
      items: items.length,
      songs: items.filter((i) => i.item_type === 'song').length,
      confirmed: assignments.filter((a) => a.status === 'confirmed').length,
      unconfirmed: assignments.filter((a) => a.status === 'unconfirmed').length,
      declined: assignments.filter((a) => a.status === 'declined').length,
      prepared: all.length - assignments.length,
    },
  } as unknown as PlanSummary;
};

export const shapePlanDetail = (row: RawPlan): PlanDetail => {
  const items = ([...((row.items as PlanItemDetail[] | undefined) ?? [])] as PlanItemDetail[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const assignments = ([...((row.assignments as AssignmentDetail[] | undefined) ?? [])] as AssignmentDetail[]).sort(
    (a, b) =>
      (a.team?.name ?? '').localeCompare(b.team?.name ?? '') ||
      (a.position?.name ?? '').localeCompare(b.position?.name ?? '') ||
      (a.person?.full_name ?? '').localeCompare(b.person?.full_name ?? ''),
  );

  const summary = shapePlanSummary(row);
  const planPositions = [...((row.plan_positions as TeamPositionRow[] | undefined) ?? [])].sort(
    (a, b) => a.team_id.localeCompare(b.team_id) || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  return {
    ...summary,
    items,
    assignments,
    plan_positions: planPositions,
    position_needs: shapePositionNeeds(row.position_needs),
    total_length_seconds: items.reduce((sum, item) => sum + (item.length_seconds ?? 0), 0),
  };
};

export const fetchPlanDetail = async (db: Db, orgId: string, planId: string): Promise<PlanDetail> => {
  const row = (await unwrap(
    raw(db)
      .from('plans')
      .select(PLAN_DETAIL_SELECT)
      .eq('id', planId)
      .eq('organization_id', orgId)
      .maybeSingle(),
  )) as RawPlan | null;

  if (!row) throw HttpError.notFound('Plan not found');
  const detail = shapePlanDetail(row);
  // F11: direct item leaders are named from the same roster directory.
  const leaderIds = detail.items.flatMap((item) => (item.leader_person_id ? [item.leader_person_id] : []));
  const personIds = [...new Set([...detail.assignments.map((assignment) => assignment.person_id), ...leaderIds])];
  const userIds = detail.assignments.flatMap((assignment) => assignment.user_id ? [assignment.user_id] : []);
  const inheriting = detail.items.flatMap((item) =>
    item.item_type === 'song' && item.song_id && !item.arrangement_id ? [item.song_id] : [],
  );
  // F14: archive dates are the organization's local dates.
  const withMedia = detail.items.some((item) => Boolean(item.media));
  const [contacts, directory, attendance, defaults, organization] = await Promise.all([
    contactsFor(db, orgId, userIds),
    personIds.length
      ? unwrap(db.from('people_directory').select('*').in('id', personIds))
      : Promise.resolve([]),
    attendanceFor(db, detail.assignments.map((assignment) => assignment.id)),
    defaultArrangementsFor(db, inheriting),
    withMedia
      ? unwrap(db.from('organizations').select('timezone').eq('id', orgId).maybeSingle())
      : Promise.resolve(null),
  ]);
  const today = organizationToday(organization?.timezone);
  const people = new Map((directory ?? []).map((person) => [person.id, person]));
  const fullName = (id: string): string | null => {
    const person = people.get(id);
    return person ? [person.first_name, person.last_name].filter(Boolean).join(' ') : null;
  };
  return {
    ...detail,
    items: detail.items.map((item) => ({
      ...item,
      default_arrangement: item.song_id && !item.arrangement_id ? (defaults.get(item.song_id) ?? null) : null,
      leader_person: item.leader_person_id ? { id: item.leader_person_id, full_name: fullName(item.leader_person_id) } : null,
      media: item.media ? toRehearsalMediaRef(item.media as unknown as PlanItemMediaEmbed, today) : null,
    })),
    assignments: detail.assignments.map((assignment) => ({
      ...assignment,
      attendance: attendance.get(assignment.id) ?? [],
      person: people.has(assignment.person_id)
        ? {
            id: assignment.person_id,
            full_name: [people.get(assignment.person_id)?.first_name, people.get(assignment.person_id)?.last_name]
              .filter(Boolean)
              .join(' '),
            avatar_url: people.get(assignment.person_id)?.avatar_url ?? null,
            ...(assignment.user_id ? contacts.get(assignment.user_id) ?? NO_CONTACT : NO_CONTACT),
            role: 'member',
          }
        : assignment.person
          ? { ...assignment.person, ...(assignment.user_id ? contacts.get(assignment.user_id) ?? NO_CONTACT : NO_CONTACT) }
          : null,
    })),
  };
};

/** The plan id a create/copy function returned. */
const requireId = async (query: PromiseLike<{ data: string | null; error: { code?: string; message: string; details?: string | null; hint?: string | null } | null }>): Promise<string> => {
  const id = await unwrap(query);
  if (!id) throw HttpError.notFound('Plan not found');
  return id;
};

export interface CreatePlanAtomicallyInput {
  db: Db;
  orgId: string;
  input: CreatePlanInput;
}

/** Plan, times and optional copy in one transaction (`create_plan`). */
export const createPlanAtomically = async ({ db, orgId, input }: CreatePlanAtomicallyInput): Promise<string> => {
  const { times, copy_from_plan_id, copy_assignments, idempotency_key, conflict_override_reason, ...plan } = input;
  return requireId(
    db.rpc('create_plan', {
      p_organization_id: orgId,
      p_plan: plan,
      p_times: times.map((time) => ({ kind: time.kind, name: time.name ?? null, starts_at: time.starts_at, ends_at: time.ends_at })),
      p_copy_from: copy_from_plan_id ?? null,
      p_copy_assignments: copy_assignments,
      p_idempotency_key: idempotency_key ?? null,
      p_conflict_override_reason: conflict_override_reason ?? null,
    }),
  );
};

export interface DuplicatePlanAtomicallyInput {
  db: Db;
  sourcePlanId: string;
  input: DuplicatePlanInput;
}

/** New draft plan from an existing one in one transaction (`duplicate_plan`). */
export const duplicatePlanAtomically = async ({ db, sourcePlanId, input }: DuplicatePlanAtomicallyInput): Promise<string> =>
  requireId(
    db.rpc('duplicate_plan', {
      p_source_plan_id: sourcePlanId,
      p_service_date: input.service_date,
      p_title: input.title ?? null,
      p_copy_assignments: input.copy_assignments,
      p_idempotency_key: input.idempotency_key ?? null,
      p_conflict_override_reason: input.conflict_override_reason ?? null,
    }),
  );

export const STALE_PLAN_CODE = 'plan_revision_stale';

export interface ImportPlanContentsServiceInput {
  db: Db;
  orgId: string;
  targetPlanId: string;
  input: ImportPlanContentsInput;
}

/**
 * Another plan's order/needs/team into this plan in one transaction
 * (`import_plan_contents`). Returns the plan's new content revision; a stale
 * `expected_revision` is a 409 the client resolves by re-reading the plan.
 */
export const importPlanContents = async ({
  db,
  orgId,
  targetPlanId,
  input,
}: ImportPlanContentsServiceInput): Promise<number> => {
  const target = await unwrap(
    db.from('plans').select('id').eq('id', targetPlanId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!target) throw HttpError.notFound('Plan not found');

  const { data, error } = await db.rpc('import_plan_contents', {
    p_target_plan_id: targetPlanId,
    p_source_plan_id: input.source_plan_id,
    p_items: input.items,
    p_needs: input.position_needs,
    p_assignments: input.assignments,
    p_expected_revision: input.expected_revision ?? null,
    p_idempotency_key: input.idempotency_key ?? null,
    p_conflict_override_reason: input.conflict_override_reason ?? null,
  });
  if (error?.code === 'PT409' && error.hint === 'scheduling_conflict') throw fromPostgrestError(error);
  if (error?.code === 'PT409') {
    throw new HttpError(409, 'This plan changed since you opened it. Review it and import again.', STALE_PLAN_CODE);
  }
  if (error) throw fromPostgrestError(error);
  return data;
};

export interface ApplyPositionNeedsInput {
  db: Db;
  orgId: string;
  planId: string;
  needs: ReadonlyArray<{ position_id: string; needed: number }>;
}

/** Last value wins when the editor sends the same position twice. */
export const dedupePositionNeeds = (
  needs: ReadonlyArray<{ position_id: string; needed: number }>,
): Array<{ position_id: string; needed: number }> => [
  ...new Map(needs.map((need) => [need.position_id, need])).values(),
];

/**
 * Applies the "needed positions" editor. A need of 0 is the absence of a need,
 * so those rows are deleted rather than stored — the table then only ever
 * holds positions somebody actually asked for.
 */
export const setPlanPositionNeeds = async (
  input: ApplyPositionNeedsInput,
): Promise<PlanPositionNeed[]> => {
  const plan = await unwrap(
    input.db
      .from('plans')
      .select('id')
      .eq('id', input.planId)
      .eq('organization_id', input.orgId)
      .maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const needs = dedupePositionNeeds(input.needs);

  if (needs.length) {
    // RLS on plan_position_needs only checks the plan's organization, so the
    // positions have to be checked against this org explicitly.
    const known = await unwrap(
      raw(input.db)
        .from('team_positions')
        .select('id, teams!inner(organization_id)')
        .in('id', needs.map((need) => need.position_id))
        .eq('teams.organization_id', input.orgId),
    );
    const knownIds = new Set(((known ?? []) as Array<{ id: string }>).map((row) => row.id));
    const unknown = needs.filter((need) => !knownIds.has(need.position_id));
    if (unknown.length) {
      throw HttpError.badRequest('Some positions do not belong to this organization', {
        unknown: unknown.map((need) => need.position_id),
      });
    }
  }

  const cleared = needs.filter((need) => need.needed === 0).map((need) => need.position_id);
  if (cleared.length) {
    await unwrap(
      input.db
        .from('plan_position_needs')
        .delete()
        .eq('plan_id', input.planId)
        .in('position_id', cleared),
    );
  }

  const wanted = needs.filter((need) => need.needed > 0);
  if (wanted.length) {
    await unwrap(
      input.db.from('plan_position_needs').upsert(
        wanted.map((need) => ({
          plan_id: input.planId,
          position_id: need.position_id,
          needed: need.needed,
        })),
        { onConflict: 'plan_id,position_id' },
      ),
    );
  }

  const rows = await unwrap(
    raw(input.db)
      .from('plan_position_needs')
      .select('needed, position:team_positions(id, team_id)')
      .eq('plan_id', input.planId),
  );
  // `raw()` is untyped, so PostgREST's to-one embed is inferred as an array.
  return shapePositionNeeds((rows ?? []) as unknown as RawPositionNeed[]);
};
