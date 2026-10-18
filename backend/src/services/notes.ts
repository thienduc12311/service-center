import type {
  CreateNoteCategoryInput,
  NoteCategoryRow,
  PlanNote,
  PlanNoteRow,
  PlanNotesResponse,
  SavePlanNoteInput,
  UpdateNoteCategoryInput,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { toPlanNote, type CollaborationCaller } from '../model/collaboration.model.js';

/**
 * F09 notes. Every read goes through the caller's RLS-bound client: the
 * policies on plan_notes/plan_note_teams decide which notes (and which team
 * lists) exist for this caller, so nothing here filters by audience itself.
 */

const decorate = async (caller: CollaborationCaller, rows: readonly PlanNoteRow[]): Promise<PlanNote[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const authorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const [teams, authors] = await Promise.all([
    unwrap(caller.db.from('plan_note_teams').select('note_id, team_id').in('note_id', ids)),
    authorIds.length
      ? unwrap(caller.db.from('profiles').select('id, full_name').in('id', authorIds))
      : Promise.resolve([]),
  ]);
  const teamsByNote = new Map<string, string[]>();
  for (const link of teams ?? []) {
    teamsByNote.set(link.note_id, [...(teamsByNote.get(link.note_id) ?? []), link.team_id]);
  }
  const names = new Map((authors ?? []).map((author) => [author.id, author.full_name]));
  return rows.map((row) => toPlanNote(row, teamsByNote.get(row.id) ?? [], row.created_by ? names.get(row.created_by) ?? null : null));
};

const loadPlan = async (caller: CollaborationCaller, planId: string): Promise<{ id: string; service_type_id: string | null }> =>
  unwrapOne(
    caller.db.from('plans').select('id, service_type_id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle(),
  );

export const listPlanNotes = async (caller: CollaborationCaller, planId: string): Promise<PlanNotesResponse> => {
  const plan = await loadPlan(caller, planId);
  let categoryQuery = caller.db
    .from('note_categories')
    .select('*')
    .eq('organization_id', caller.orgId)
    .is('archived_at', null);
  categoryQuery = plan.service_type_id
    ? categoryQuery.or(`service_type_id.is.null,service_type_id.eq.${plan.service_type_id}`)
    : categoryQuery.is('service_type_id', null);
  const [rows, categories, canEdit] = await Promise.all([
    unwrap(
      caller.db.from('plan_notes').select('*').eq('plan_id', plan.id)
        .order('plan_item_id', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true }),
    ),
    unwrap(categoryQuery.order('sort_order').order('name')),
    unwrap(raw(caller.db).rpc('can_edit_plan', { p_plan: plan.id })),
  ]);
  return {
    notes: await decorate(caller, rows ?? []),
    categories: categories ?? [],
    can_edit: canEdit === true,
  };
};

/** Creates (`noteId` null) or replaces a note in one database call. */
export const savePlanNote = async (
  caller: CollaborationCaller,
  planId: string,
  noteId: string | null,
  input: SavePlanNoteInput,
): Promise<PlanNote> => {
  await loadPlan(caller, planId);
  const row = (await unwrap(
    raw(caller.db).rpc('save_plan_note', {
      p_plan: planId,
      p_note: noteId,
      p_item: input.plan_item_id,
      p_category: input.category_id,
      p_audience: input.audience,
      p_team_ids: input.audience === 'teams' ? input.team_ids : [],
      p_body: input.body,
      p_expected_revision: input.expected_revision ?? null,
    }),
  )) as PlanNoteRow;
  const [note] = await decorate(caller, [row]);
  if (!note) throw HttpError.notFound('Note not found');
  return note;
};

/** Deletes only the revision the editor saw. */
export const deletePlanNote = async (
  caller: CollaborationCaller,
  planId: string,
  noteId: string,
  expectedRevision: number,
): Promise<void> => {
  const deleted = await unwrap(
    caller.db.from('plan_notes').delete().eq('id', noteId).eq('plan_id', planId)
      .eq('revision', expectedRevision).select('id'),
  );
  if ((deleted ?? []).length > 0) return;
  const current = await unwrap(caller.db.from('plan_notes').select('id').eq('id', noteId).eq('plan_id', planId).maybeSingle());
  if (current) throw new HttpError(409, 'This note changed since you opened it', 'note_stale');
  throw HttpError.notFound('Note not found');
};

export const listNoteCategories = async (
  caller: CollaborationCaller,
  serviceTypeId: string | undefined,
): Promise<NoteCategoryRow[]> => {
  let query = caller.db.from('note_categories').select('*').eq('organization_id', caller.orgId);
  if (serviceTypeId) query = query.or(`service_type_id.is.null,service_type_id.eq.${serviceTypeId}`);
  return (await unwrap(query.order('archived_at', { ascending: true, nullsFirst: true }).order('sort_order').order('name'))) ?? [];
};

export const createNoteCategory = async (caller: CollaborationCaller, input: CreateNoteCategoryInput): Promise<NoteCategoryRow> =>
  unwrapOne(
    caller.db.from('note_categories').insert({
      organization_id: caller.orgId,
      service_type_id: input.service_type_id,
      name: input.name,
      default_audience: input.default_audience,
      sort_order: input.sort_order,
      created_by: caller.userId,
    }).select('*').single(),
  );

export const updateNoteCategory = async (
  caller: CollaborationCaller,
  id: string,
  input: UpdateNoteCategoryInput,
): Promise<NoteCategoryRow> => {
  const { archived, ...rest } = input;
  const patch: Partial<NoteCategoryRow> = { ...rest };
  if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null;
  const row = await unwrap(
    caller.db.from('note_categories').update(patch).eq('id', id).eq('organization_id', caller.orgId).select('*').maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Category not found');
  return row;
};
