import {
  buildPublicPlanProjection,
  publicationState,
  publicationVisibleFrom,
  type PlanPublicationRow,
  type PlanPublicationView,
  type PlanStatus,
  type PlanTimeKind,
  type PublicPlanProjection,
  type PublicPlanSource,
  type PublicSetListLinkRow,
  type PublishPlanInput,
  type ServiceTypePublicLinks,
  type SetPublicLinkInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { adminDb, raw, unwrap, type Db } from '../lib/supabase.js';

/** The caller's RLS-bound client and active organization. */
export interface PublicationCaller {
  db: Db;
  orgId: string;
}

interface SourcePlanRow {
  id: string;
  title: string;
  service_date: string;
  status: PlanStatus;
  location: string | null;
  service_type_id: string | null;
  organization: { name: string; timezone: string } | null;
  service_type: { name: string } | null;
}

interface SourceItemRow {
  item_type: 'header' | 'song' | 'item';
  title: string;
  length_seconds: number;
  key_override: string | null;
  service_segment: 'pre' | 'service' | 'post';
  song: { title: string; author: string | null; default_key: string | null } | null;
  arrangement: { song_key: string | null } | null;
}

interface SourceTimeRow {
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

/**
 * Everything a projection could ever use — nothing about people, notes,
 * descriptions, files or chat is selected at all.
 */
const loadSource = async (db: Db, planId: string): Promise<{ plan: SourcePlanRow; source: PublicPlanSource } | null> => {
  const plan = (await unwrap(
    raw(db)
      .from('plans')
      .select('id, title, service_date, status, location, service_type_id, organization:organizations(name, timezone), service_type:service_types(name)')
      .eq('id', planId)
      .maybeSingle(),
  )) as unknown as SourcePlanRow | null;
  if (!plan?.organization) return null;
  const [times, items] = await Promise.all([
    unwrap(raw(db).from('plan_times').select('kind, name, starts_at, ends_at').eq('plan_id', planId).order('starts_at')),
    unwrap(
      raw(db)
        .from('plan_items')
        .select('item_type, title, length_seconds, key_override, service_segment, song:songs(title, author, default_key), arrangement:arrangements(song_key)')
        .eq('plan_id', planId)
        .order('sort_order'),
    ),
  ]);
  return {
    plan,
    source: {
      organization_name: plan.organization.name,
      timezone: plan.organization.timezone,
      plan: {
        title: plan.title,
        service_date: plan.service_date,
        status: plan.status,
        location: plan.location,
        service_type_name: plan.service_type?.name ?? null,
      },
      times: ((times ?? []) as SourceTimeRow[]).map((time) => ({ ...time })),
      // Pre-/post-service segments are internal running notes; only the service itself is public.
      items: ((items ?? []) as unknown as SourceItemRow[])
        .filter((item) => item.service_segment === 'service')
        .map((item) => ({
          item_type: item.item_type,
          title: item.title,
          length_seconds: item.length_seconds,
          song: item.song ? { title: item.song.title, author: item.song.author } : null,
          key: item.song ? item.key_override ?? item.arrangement?.song_key ?? item.song.default_key ?? null : null,
        })),
    },
  };
};

const toView = (
  publication: PlanPublicationRow | null,
  loaded: { plan: SourcePlanRow; source: PublicPlanSource },
  nowMs: number,
): PlanPublicationView => {
  if (!publication) {
    return {
      publication: null,
      state: 'unpublished',
      visible_from: null,
      public_path: null,
      preview: null,
      ineligible_reason: loaded.plan.status === 'published' ? null : 'Only published plans can be shared publicly.',
    };
  }
  const window = {
    publish_mode: publication.publish_mode,
    published_at: publication.published_at,
    revoked_at: publication.revoked_at,
    plan_status: loaded.plan.status,
    service_date: loaded.plan.service_date,
    timezone: loaded.source.timezone,
  };
  const state = publicationState(window, nowMs);
  return {
    publication,
    state,
    visible_from: publicationVisibleFrom(window),
    public_path: publication.revoked_at ? null : `/p/${publication.slug}`,
    preview: publication.revoked_at ? null : buildPublicPlanProjection(loaded.source, publication.fields),
    ineligible_reason: state === 'ineligible' ? 'The plan is not published (drafts and archived plans are never public).' : null,
  };
};

const editorView = async ({ db, orgId }: PublicationCaller, planId: string): Promise<PlanPublicationView> => {
  const plan = await unwrap(db.from('plans').select('id').eq('id', planId).eq('organization_id', orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');
  const canEdit = await unwrap(db.rpc('can_edit_plan', { p_plan: planId }));
  if (canEdit !== true) throw HttpError.forbidden('Only this plan\'s editors manage public sharing');
  const [loaded, publication] = await Promise.all([
    loadSource(db, planId),
    unwrap(db.from('plan_publications').select('*').eq('plan_id', planId).maybeSingle()),
  ]);
  if (!loaded) throw HttpError.notFound('Plan not found');
  return toView((publication as PlanPublicationRow | null) ?? null, loaded, Date.now());
};

export const getPlanPublication = editorView;

export const publishPlan = async (caller: PublicationCaller, planId: string, input: PublishPlanInput): Promise<PlanPublicationView> => {
  await editorView(caller, planId);
  const { error } = await caller.db.rpc('publish_plan', {
    p_plan: planId,
    p_fields: [...new Set(input.fields)],
    p_mode: input.publish_mode,
    p_expected_revision: input.expected_revision,
    p_new_slug: input.new_link,
  });
  if (error) throw fromPostgrestError(error);
  return editorView(caller, planId);
};

export const revokePlanPublication = async (
  caller: PublicationCaller,
  planId: string,
  expectedRevision: number,
): Promise<PlanPublicationView> => {
  await editorView(caller, planId);
  const { error } = await caller.db.rpc('revoke_plan_publication', { p_plan: planId, p_expected_revision: expectedRevision });
  if (error) throw fromPostgrestError(error);
  return editorView(caller, planId);
};

export const servicePublicLinks = async ({ db, orgId }: PublicationCaller, serviceTypeId: string): Promise<ServiceTypePublicLinks> => {
  const st = await unwrap(db.from('service_types').select('id').eq('id', serviceTypeId).eq('organization_id', orgId).maybeSingle());
  if (!st) throw HttpError.notFound('Service type not found');
  const links = (await unwrap(
    db.from('public_set_list_links').select('*').eq('service_type_id', serviceTypeId).is('revoked_at', null).order('kind'),
  )) as PublicSetListLinkRow[] | null;
  return { service_type_id: serviceTypeId, links: links ?? [] };
};

export const setServicePublicLink = async (
  { db, orgId }: PublicationCaller,
  serviceTypeId: string,
  input: SetPublicLinkInput,
): Promise<PublicSetListLinkRow> => {
  const st = await unwrap(db.from('service_types').select('id').eq('id', serviceTypeId).eq('organization_id', orgId).maybeSingle());
  if (!st) throw HttpError.notFound('Service type not found');
  const { data, error } = await db.rpc('set_public_set_list_link', { p_service_type: serviceTypeId, p_kind: input.kind, p_action: input.action });
  if (error) throw fromPostgrestError(error);
  return data;
};

// --------------------------------------------------------- anonymous reads

/** A published, eligible, unrevoked plan's projection; anything else is "not found". */
export const resolvePublicPlan = async (slug: string, nowMs: number = Date.now()): Promise<PublicPlanProjection | null> => {
  const publication = (await unwrap(
    adminDb.from('plan_publications').select('*').eq('slug', slug).is('revoked_at', null).maybeSingle(),
  )) as PlanPublicationRow | null;
  if (!publication) return null;
  const loaded = await loadSource(adminDb, publication.plan_id);
  if (!loaded) return null;
  const view = toView(publication, loaded, nowMs);
  return view.state === 'live' ? view.preview : null;
};

interface CandidateRow {
  plan_id: string;
  plan: { id: string; service_date: string; status: PlanStatus; service_type_id: string | null } | null;
}

const CANDIDATE_WINDOW_DAYS = 180;

/** Nearest upcoming / most recent *live* published plan of the link's service type. */
export const resolvePublicSetList = async (slug: string, nowMs: number = Date.now()): Promise<PublicPlanProjection | null> => {
  const link = (await unwrap(
    adminDb.from('public_set_list_links').select('*').eq('slug', slug).is('revoked_at', null).maybeSingle(),
  )) as PublicSetListLinkRow | null;
  if (!link) return null;
  const candidates = ((await unwrap(
    raw(adminDb)
      .from('plan_publications')
      .select('plan_id, plan:plans!inner(id, service_date, status, service_type_id)')
      .eq('organization_id', link.organization_id)
      .is('revoked_at', null)
      .eq('plan.service_type_id', link.service_type_id)
      .eq('plan.status', 'published')
      .gte('plan.service_date', new Date(nowMs - CANDIDATE_WINDOW_DAYS * 86_400_000).toISOString())
      .lte('plan.service_date', new Date(nowMs + CANDIDATE_WINDOW_DAYS * 86_400_000).toISOString())
      .limit(200),
  )) ?? []) as unknown as CandidateRow[];
  // Upcoming: the earliest plan whose service has not finished (service date + 3 h); recent: the latest that has started.
  const SERVICE_GRACE_MS = 3 * 3_600_000;
  const ordered = candidates
    .flatMap((candidate) => (candidate.plan ? [candidate.plan] : []))
    .filter((plan) =>
      link.kind === 'upcoming'
        ? Date.parse(plan.service_date) + SERVICE_GRACE_MS >= nowMs
        : Date.parse(plan.service_date) <= nowMs,
    )
    .sort((a, b) =>
      link.kind === 'upcoming' ? a.service_date.localeCompare(b.service_date) : b.service_date.localeCompare(a.service_date),
    );
  for (const plan of ordered) {
    const publication = (await unwrap(
      adminDb.from('plan_publications').select('slug').eq('plan_id', plan.id).is('revoked_at', null).maybeSingle(),
    )) as Pick<PlanPublicationRow, 'slug'> | null;
    if (!publication) continue;
    // Not yet visible (service-day publication before its day) → try the next one.
    const projection = await resolvePublicPlan(publication.slug, nowMs);
    if (projection) return projection;
  }
  return null;
};
