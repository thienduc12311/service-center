-- W8-RES-D5: POST /plans replayed an idempotency key without comparing the
-- body, so same key + different payload returned the first plan with 201.
-- Same pattern as the other idempotent RPCs: store a request hash with the key;
-- a replay with a different hash is PT409 / hint idempotency_key_reused.
-- Legacy rows (request_hash null) and callers that pass no hash keep the old
-- behaviour.
alter table public.plan_copy_operations add column request_hash text
  check (request_hash is null or char_length(request_hash) = 32);

drop function if exists private.claim_plan_copy_key(uuid, text, text, uuid, uuid);
create or replace function private.claim_plan_copy_key(
  p_org           uuid,
  p_key           text,
  p_kind          text,
  p_source        uuid,
  p_target        uuid,
  p_request_hash  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.plan_copy_operations;
  v_claimed  uuid;
begin
  if p_key is null then
    return null;
  end if;
  insert into public.plan_copy_operations (organization_id, idempotency_key, kind, source_plan_id, target_plan_id, created_by, request_hash)
  values (p_org, p_key, p_kind, p_source, p_target, (select auth.uid()), p_request_hash)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_claimed;
  if v_claimed is not null then
    return null;
  end if;

  select * into v_existing from public.plan_copy_operations
   where organization_id = p_org and idempotency_key = p_key;
  if v_existing.kind <> p_kind or v_existing.source_plan_id is distinct from p_source
     or (p_kind = 'import' and v_existing.target_plan_id <> p_target)
     or (v_existing.request_hash is not null and p_request_hash is not null
         and v_existing.request_hash <> p_request_hash) then
    raise exception 'That idempotency key was used for a different request'
      using errcode = 'PT409', hint = 'idempotency_key_reused';
  end if;
  return v_existing.target_plan_id;
end;
$$;

create or replace function public.create_plan(
  p_organization_id uuid,
  p_plan jsonb,
  p_times jsonb default '[]',
  p_copy_from uuid default null,
  p_copy_assignments boolean default false,
  p_idempotency_key text default null,
  p_conflict_override_reason text default null
)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_target   uuid := gen_random_uuid();
  v_existing uuid;
  v_source   uuid;
  v_hash     text;
begin
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Only a scheduler can create plans' using errcode = '42501';
  end if;
  if p_copy_from is not null then
    select id into v_source from public.plans
     where id = p_copy_from and organization_id = p_organization_id;
    if v_source is null then
      raise exception 'Plan to copy from not found' using errcode = 'P0002';
    end if;
  end if;

  -- jsonb renders with a canonical key order, so equal payloads hash equally.
  v_hash := md5(jsonb_build_object(
    'plan', coalesce(p_plan, '{}'::jsonb),
    'times', coalesce(p_times, '[]'::jsonb),
    'copy_from', p_copy_from,
    'copy_assignments', coalesce(p_copy_assignments, false),
    'override_reason', coalesce(p_conflict_override_reason, ''))::text);

  v_existing := private.claim_plan_copy_key(p_organization_id, p_idempotency_key, 'create', v_source, v_target, v_hash);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
  select v_target, p_organization_id, (p_plan->>'service_type_id')::uuid, p_plan->>'title',
         (p_plan->>'service_date')::timestamptz, p_plan->>'location',
         coalesce((p_plan->>'status')::public.plan_status, 'draft'), p_plan->>'notes', (select auth.uid());

  insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order)
  select v_target, coalesce(t.kind, 'service'), t.name, t.starts_at, t.ends_at, (e.ord - 1)::int
    from jsonb_array_elements(coalesce(p_times, '[]')) with ordinality as e(value, ord)
    cross join lateral jsonb_to_record(e.value) as t(
      kind public.plan_time_kind, name text, starts_at timestamptz, ends_at timestamptz);

  if v_source is not null then
    perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
    perform private.copy_plan_children(v_source, v_target, true, true, coalesce(p_copy_assignments, false), null);
    perform set_config('f04.conflict_override_reason', '', true);
  end if;
  return v_target;
end;
$$;
revoke execute on function public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text, text) from public, anon;
grant execute on function public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text, text) to authenticated;
