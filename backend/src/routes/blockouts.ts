import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  affectedAssignmentsPreviewSchema, blockoutSchema, createBlockoutSeriesSchema,
  expandBlockoutRecurrence, maintainBlockoutSeriesSchema, previewBlockoutSeriesSchema,
  possibleInstantsForLocalDateTime, resolveOneOffBlockout, updateBlockoutSchema, canAccessAnywhere,
  type AffectedAssignmentPreview, type BlockoutIntentInput, type BlockoutOccurrencePreview,
  type BlockoutSeriesDetail, type BlockoutSeriesSaveResult, type CreateBlockoutSeriesInput,
  type MaintainBlockoutSeriesInput, type PreviewBlockoutSeriesInput, type UpdateBlockoutInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { resolveAvailabilityTarget } from '../services/availability.js';

export const blockoutsRouter: Router = Router();

const listQuerySchema = z.object({
  person_id: z.string().uuid().optional(), user_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  scope: z.enum(['mine', 'organization']).default('mine'),
});
const deleteQuerySchema = z.object({ expected_revision: z.coerce.number().int().min(0).optional() });

interface ResolvedTarget { personId: string; profileId: string | null }

/** Self, a scheduler, or an explicit availability delegate (F03); RLS re-checks. */
const resolveTarget = async (req: Request, personId?: string, legacyUserId?: string): Promise<ResolvedTarget> =>
  resolveAvailabilityTarget({ db: req.db, orgId: req.orgId, userId: req.auth.userId, access: req.access }, personId, legacyUserId);

const occurrencePreview = (occurrence: ReturnType<typeof resolveOneOffBlockout>): BlockoutOccurrencePreview => ({
  occurrence_key: occurrence.occurrenceKey, local_start_date: occurrence.localStartDate,
  local_start_time: occurrence.localStartTime, local_end_date: occurrence.localEndDate,
  local_end_time: occurrence.localEndTime, starts_at: occurrence.startsAt,
  ends_at: occurrence.endsAt, utc_offset_minutes: occurrence.utcOffsetMinutes,
});

const resolveIntent = (input: BlockoutIntentInput): BlockoutOccurrencePreview => occurrencePreview(resolveOneOffBlockout({
  allDay: input.all_day, timeZone: input.timezone, localStartDate: input.local_start_date,
  localStartTime: input.local_start_time, localEndDate: input.local_end_date,
  localEndTime: input.local_end_time, ambiguousTimePolicy: input.ambiguous_time_policy,
}));

const resolveSeries = (input: PreviewBlockoutSeriesInput): BlockoutOccurrencePreview[] =>
  expandBlockoutRecurrence({
    allDay: input.all_day, timeZone: input.timezone, localStartDate: input.local_start_date,
    localStartTime: input.local_start_time, localEndDate: input.local_end_date,
    localEndTime: input.local_end_time, frequency: input.recurrence.frequency,
    interval: input.recurrence.interval,
    end: input.recurrence.end.type === 'count'
      ? { type: 'count', count: input.recurrence.end.count }
      : { type: 'until', untilDate: input.recurrence.end.until_date },
    monthlyMissingDate: input.recurrence.monthly_missing_date,
    ambiguousTimePolicy: input.ambiguous_time_policy,
  }).map(occurrencePreview);

const affectedAssignments = async (
  req: Request, personId: string,
  occurrences: readonly Pick<BlockoutOccurrencePreview, 'starts_at' | 'ends_at'>[],
): Promise<AffectedAssignmentPreview[]> => {
  const { data, error } = await raw(req.db).rpc('blockout_affected_assignments', {
    p_organization_id: req.orgId, p_person_id: personId,
    p_ranges: occurrences.map(({ starts_at, ends_at }) => ({ starts_at, ends_at })),
  });
  if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message, error.code);
  return (data ?? []) as AffectedAssignmentPreview[];
};

const seriesPayload = (input: PreviewBlockoutSeriesInput): Record<string, unknown> => ({
  timezone: input.timezone, all_day: input.all_day, local_start_date: input.local_start_date,
  local_start_time: input.all_day ? null : input.local_start_time,
  local_end_date: input.local_end_date, local_end_time: input.all_day ? null : input.local_end_time,
  reason: input.reason ?? null, frequency: input.recurrence.frequency,
  interval_count: input.recurrence.interval, end_type: input.recurrence.end.type,
  until_date: input.recurrence.end.type === 'until' ? input.recurrence.end.until_date : null,
  occurrence_count: input.recurrence.end.type === 'count' ? input.recurrence.end.count : null,
  ambiguous_time_policy: input.ambiguous_time_policy,
});

blockoutsRouter.get('/', validateQuery(listQuerySchema), async (req, res) => {
  const { person_id, user_id, from, to, scope } = parsedQuery<z.infer<typeof listQuerySchema>>(res);
  let query = req.db.from('blockouts').select('*').eq('organization_id', req.orgId).order('starts_at');
  if (scope === 'organization') {
    if (!canAccessAnywhere(req.access, 'scheduling.manage')) throw HttpError.forbidden('Only schedulers can see everyone’s blockouts');
    if (person_id) query = query.eq('person_id', person_id);
    if (user_id) query = query.eq('user_id', user_id);
  } else query = query.eq('person_id', (await resolveTarget(req, person_id)).personId);
  if (from) query = query.gt('ends_at', from);
  if (to) query = query.lt('starts_at', to);
  res.json((await unwrap(query)) ?? []);
});

blockoutsRouter.post('/affected-assignments', validateBody(affectedAssignmentsPreviewSchema), async (req, res) => {
  const body = req.body as z.infer<typeof affectedAssignmentsPreviewSchema>;
  const target = await resolveTarget(req, body.person_id);
  res.json(await affectedAssignments(req, target.personId, body.occurrences));
});

blockoutsRouter.post('/series/preview', validateBody(previewBlockoutSeriesSchema), async (req, res) => {
  const input = req.body as PreviewBlockoutSeriesInput;
  const target = await resolveTarget(req, input.person_id);
  const occurrences = resolveSeries(input);
  res.json({ occurrences, affected_assignments: await affectedAssignments(req, target.personId, occurrences) });
});

blockoutsRouter.post('/series', validateBody(createBlockoutSeriesSchema), async (req, res) => {
  const input = req.body as CreateBlockoutSeriesInput;
  const target = await resolveTarget(req, input.person_id);
  const occurrences = resolveSeries(input);
  const { data, error } = await raw(req.db).rpc('create_blockout_series', {
    p_organization_id: req.orgId, p_person_id: target.personId, p_series: seriesPayload(input),
    p_occurrences: occurrences, p_idempotency_key: input.idempotency_key,
  });
  if (error) throw new HttpError(error.code === '23505' ? 409 : 400, error.message, error.code);
  res.status(201).json({ series: data, occurrences,
    affected_assignments: await affectedAssignments(req, target.personId, occurrences),
  } satisfies BlockoutSeriesSaveResult);
});

blockoutsRouter.get('/series/:id', async (req, res) => {
  const series = await unwrap(req.db.from('blockout_series').select('*').eq('id', param(req, 'id')).maybeSingle());
  if (!series) throw HttpError.notFound('Repeating blockout not found');
  const [rows, exceptions] = await Promise.all([
    unwrap(req.db.from('blockouts').select('*').eq('series_id', series.id).order('starts_at')),
    unwrap(req.db.from('blockout_series_exceptions').select('*').eq('series_id', series.id).order('created_at')),
  ]);
  const occurrences = (rows ?? []).map((row) => {
    const startTime = row.local_start_time?.slice(0, 5) ?? '00:00';
    const resolved = possibleInstantsForLocalDateTime(row.local_start_date!, startTime, series.timezone)
      .find((item) => item.instant === row.starts_at);
    return {
      occurrence_key: row.occurrence_key!, local_start_date: row.local_start_date!,
      local_start_time: row.local_start_time, local_end_date: row.local_end_date!,
      local_end_time: row.local_end_time, starts_at: row.starts_at, ends_at: row.ends_at,
      utc_offset_minutes: resolved?.utcOffsetMinutes ?? 0,
    };
  });
  res.json({ series, occurrences, exceptions: exceptions ?? [] } satisfies BlockoutSeriesDetail);
});

blockoutsRouter.post('/series/:id/change', validateBody(maintainBlockoutSeriesSchema), async (req, res) => {
  const input = req.body as MaintainBlockoutSeriesInput;
  let payload: Record<string, unknown> | null = null;
  let occurrences: BlockoutOccurrencePreview[] = [];
  if (input.action === 'update' && input.replacement) {
    payload = input.scope === 'occurrence'
      ? { ...input.replacement, reason: input.replacement.reason ?? null }
      : seriesPayload(input.replacement as PreviewBlockoutSeriesInput);
    occurrences = input.scope === 'occurrence'
      ? [resolveIntent(input.replacement as BlockoutIntentInput)]
      : resolveSeries(input.replacement as PreviewBlockoutSeriesInput);
  }
  const { data, error } = await raw(req.db).rpc('change_blockout_series', {
    p_series_id: param(req, 'id'), p_expected_revision: input.expected_series_revision,
    p_scope: input.scope, p_occurrence_id: input.scope === 'series' ? null : input.occurrence_id,
    p_action: input.action, p_series: payload, p_occurrences: occurrences,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw new HttpError(error.code === 'PT409' ? 409 : 400, error.message, error.code);
  res.json(data);
});

blockoutsRouter.post('/', validateBody(blockoutSchema), async (req, res) => {
  const body = req.body as z.infer<typeof blockoutSchema>;
  if ('starts_at' in body) {
    const target = await resolveTarget(req, undefined, body.user_id);
    const created = await unwrapOne(req.db.from('blockouts').insert({
      starts_at: body.starts_at, ends_at: body.ends_at, reason: body.reason ?? null,
      organization_id: req.orgId, person_id: target.personId, user_id: target.profileId,
    }).select('*').single());
    res.status(201).json(created);
    return;
  }
  const target = await resolveTarget(req, body.person_id);
  const occurrence = resolveIntent(body);
  const { data, error } = await raw(req.db).rpc('create_blockout', {
    p_organization_id: req.orgId, p_person_id: target.personId,
    p_payload: { ...occurrence, reason: body.reason ?? null, timezone: body.timezone, all_day: body.all_day },
    p_idempotency_key: body.idempotency_key ?? null,
  });
  if (error) throw new HttpError(400, error.message, error.code);
  res.status(201).json({ blockout: data,
    affected_assignments: await affectedAssignments(req, target.personId, [occurrence]) });
});

blockoutsRouter.patch('/:id', validateBody(updateBlockoutSchema), async (req, res) => {
  const input = req.body as UpdateBlockoutInput;
  const target = await resolveTarget(req, input.person_id);
  const occurrence = resolveIntent(input);
  const { data, error } = await raw(req.db).rpc('update_blockout', {
    p_blockout_id: param(req, 'id'), p_expected_revision: input.expected_revision,
    p_payload: { ...occurrence, reason: input.reason ?? null, timezone: input.timezone, all_day: input.all_day },
  });
  if (error) throw new HttpError(error.code === 'PT409' ? 409 : 400, error.message, error.code);
  res.json({ blockout: data, affected_assignments: await affectedAssignments(req, target.personId, [occurrence]) });
});

blockoutsRouter.delete('/:id', validateQuery(deleteQuerySchema), async (req, res) => {
  const { expected_revision } = parsedQuery<z.infer<typeof deleteQuerySchema>>(res);
  let query = req.db.from('blockouts').delete().eq('id', param(req, 'id')).is('series_id', null);
  if (expected_revision != null) query = query.eq('revision', expected_revision);
  const deleted = await unwrap(query.select('id').maybeSingle());
  if (!deleted) throw HttpError.conflict('This blockout changed or is part of a repeating series');
  res.status(204).end();
});
