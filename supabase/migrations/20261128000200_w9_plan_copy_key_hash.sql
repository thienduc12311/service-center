-- W9-API-D1: `duplicate_plan` and `import_plan_contents` claimed their idempotency key without a
-- request hash, so `claim_plan_copy_key` (which compares hashes only when both sides have one)
-- replayed the first copy for the same key with a different body (e.g. another service_date).
-- Both now hash their request exactly as `create_plan` does (20261127000004): md5 of a jsonb
-- object, whose canonical key order makes equal payloads hash equally. Same key + same body
-- replays; same key + another body is PT409 / hint idempotency_key_reused.
--
-- Rows claimed before this migration have request_hash null and keep replaying (no backfill:
-- the original body is not recoverable). `claim_plan_copy_key` itself and its grants are
-- unchanged. Signatures are unchanged, so CREATE OR REPLACE keeps the existing grants.
--
-- expected_revision is a precondition, not part of the request: a retry that re-read the plan
-- (and now sends the post-import revision) still replays.

create or replace function public.duplicate_plan(
  p_source_plan_id uuid,
  p_service_date timestamptz,
  p_title text default null,
  p_copy_assignments boolean default true,
  p_idempotency_key text default null,
  p_conflict_override_reason text default null
)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_source   public.plans;
  v_target   uuid := gen_random_uuid();
  v_existing uuid;
  v_hash     text;
begin
  select * into v_source from public.plans where id = p_source_plan_id;
  if not found or not public.can_manage_org(v_source.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;

  v_hash := md5(jsonb_build_object(
    'service_date', p_service_date,
    'title', coalesce(nullif(btrim(p_title), ''), ''),
    'copy_assignments', coalesce(p_copy_assignments, true),
    'override_reason', coalesce(p_conflict_override_reason, ''))::text);

  v_existing := private.claim_plan_copy_key(
    v_source.organization_id, p_idempotency_key, 'duplicate', v_source.id, v_target, v_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
  values (v_target, v_source.organization_id, v_source.service_type_id,
          coalesce(nullif(btrim(p_title), ''), v_source.title), p_service_date,
          v_source.location, 'draft', v_source.notes, (select auth.uid()));

  perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
  perform private.copy_plan_children(
    v_source.id, v_target, true, true, coalesce(p_copy_assignments, true),
    p_service_date - v_source.service_date);
  perform set_config('f04.conflict_override_reason', '', true);
  return v_target;
end;
$$;

create or replace function public.import_plan_contents(
  p_target_plan_id uuid,
  p_source_plan_id uuid,
  p_items boolean,
  p_needs boolean,
  p_assignments boolean,
  p_expected_revision bigint default null,
  p_idempotency_key text default null,
  p_conflict_override_reason text default null
)
returns bigint
language plpgsql set search_path = '' as $$
declare
  v_target   public.plans;
  v_source   uuid;
  v_existing uuid;
  v_revision bigint;
  v_hash     text;
begin
  select * into v_target from public.plans where id = p_target_plan_id for update;
  if not found or not public.can_manage_org(v_target.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select id into v_source from public.plans
   where id = p_source_plan_id and organization_id = v_target.organization_id;
  if v_source is null or v_source = v_target.id then
    raise exception 'Plan to copy from not found' using errcode = 'P0002';
  end if;

  v_hash := md5(jsonb_build_object(
    'items', coalesce(p_items, false),
    'needs', coalesce(p_needs, false),
    'assignments', coalesce(p_assignments, false),
    'override_reason', coalesce(p_conflict_override_reason, ''))::text);

  v_existing := private.claim_plan_copy_key(
    v_target.organization_id, p_idempotency_key, 'import', v_source, v_target.id, v_hash);
  if v_existing is not null then
    select content_revision into v_revision from public.plans where id = v_target.id;
    return v_revision;
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_target.content_revision then
    raise exception 'This plan changed since you opened it' using errcode = 'PT409';
  end if;

  perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
  perform private.copy_plan_children(v_source, v_target.id, p_items, p_needs, p_assignments, null);
  perform set_config('f04.conflict_override_reason', '', true);

  select content_revision into v_revision from public.plans where id = v_target.id;
  return v_revision;
end;
$$;
