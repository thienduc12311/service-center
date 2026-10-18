-- F05 — bounded multi-plan staffing workspace and atomic reviewed batches.

alter table public.plans
  add column staffing_revision bigint not null default 0;

comment on column public.plans.staffing_revision is
  'Bumped whenever staffing, needs or time scope changes; F05 previews pin this value.';

create or replace function private.bump_plan_staffing_revision()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
declare v_plan uuid;
begin
  v_plan := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  update public.plans set staffing_revision = staffing_revision + 1 where id = v_plan;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function private.bump_plan_staffing_revision() from public, anon, authenticated;

create trigger assignments_bump_plan_staffing_revision
  after insert or update or delete on public.assignments
  for each row execute function private.bump_plan_staffing_revision();
create trigger plan_position_needs_bump_staffing_revision
  after insert or update or delete on public.plan_position_needs
  for each row execute function private.bump_plan_staffing_revision();
create trigger plan_times_bump_staffing_revision
  after insert or update or delete on public.plan_times
  for each row execute function private.bump_plan_staffing_revision();

create table public.staffing_matrix_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  filters jsonb not null check (jsonb_typeof(filters) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, owner_id, name)
);
create index staffing_matrix_views_owner_idx
  on public.staffing_matrix_views (organization_id, owner_id, updated_at desc);
alter table public.staffing_matrix_views enable row level security;
create policy staffing_matrix_views_owner_select on public.staffing_matrix_views
  for select to authenticated
  using (owner_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy staffing_matrix_views_owner_insert on public.staffing_matrix_views
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy staffing_matrix_views_owner_update on public.staffing_matrix_views
  for update to authenticated
  using (owner_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (owner_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy staffing_matrix_views_owner_delete on public.staffing_matrix_views
  for delete to authenticated
  using (owner_id = (select auth.uid()) and public.is_org_member(organization_id));
grant select, insert, update, delete on public.staffing_matrix_views to authenticated;
revoke all on public.staffing_matrix_views from anon;

create table public.staffing_matrix_commits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  operation_id text not null check (operation_id ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, actor_id, idempotency_key)
);
create index staffing_matrix_commits_actor_idx
  on public.staffing_matrix_commits (organization_id, actor_id, created_at desc);
alter table public.staffing_matrix_commits enable row level security;
create policy staffing_matrix_commits_owner_select on public.staffing_matrix_commits
  for select to authenticated
  using (actor_id = (select auth.uid()) and public.is_org_member(organization_id));
grant select on public.staffing_matrix_commits to authenticated;
revoke insert, update, delete, truncate on public.staffing_matrix_commits from anon, authenticated;

create or replace function public.staffing_matrix_operation_id(
  p_actions jsonb,
  p_base_revisions jsonb
)
returns text
language sql
immutable
set search_path = '' as $$
  select encode(extensions.digest(p_actions::text || '|' || p_base_revisions::text, 'sha256'), 'hex');
$$;
revoke execute on function public.staffing_matrix_operation_id(jsonb, jsonb) from public, anon;
grant execute on function public.staffing_matrix_operation_id(jsonb, jsonb) to authenticated;

create or replace function public.commit_staffing_matrix(
  p_organization_id uuid,
  p_operation_id text,
  p_actions jsonb,
  p_base_revisions jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.staffing_matrix_commits;
  v_plan_ids uuid[];
  v_person_ids uuid[];
  v_action jsonb;
  v_index integer := 0;
  v_assignment public.assignments;
  v_created public.assignments;
  v_assignment_ids uuid[] := '{}';
  v_effect_ids uuid[] := '{}';
  v_effect uuid;
  v_result jsonb;
  v_before_count integer;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_actions) <> 'array' or jsonb_array_length(p_actions) not between 1 and 200 then
    raise exception 'Choose 1 to 200 matrix changes' using errcode = '22023';
  end if;
  if jsonb_typeof(p_base_revisions) <> 'array' then
    raise exception 'Base revisions must be a list' using errcode = '22023';
  end if;
  if char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  if p_operation_id <> public.staffing_matrix_operation_id(p_actions, p_base_revisions) then
    raise exception 'The staffing preview does not match this commit' using errcode = 'PT409', hint = 'matrix_changed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'staffing-matrix:' || p_organization_id::text || ':' || v_actor::text || ':' || p_idempotency_key, 0
  ));
  select * into v_existing from public.staffing_matrix_commits
   where organization_id = p_organization_id and actor_id = v_actor and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.operation_id <> p_operation_id then
      raise exception 'That idempotency key belongs to another staffing operation'
        using errcode = 'PT409', hint = 'matrix_changed';
    end if;
    return v_existing.result;
  end if;

  select coalesce(array_agg(distinct plan_id order by plan_id), '{}') into v_plan_ids
  from (
    select case
      when action->>'kind' in ('assign','remove','release') then (action->>'plan_id')::uuid
      when action->>'kind' = 'copy' then (action->>'destination_plan_id')::uuid
    end plan_id
    from jsonb_array_elements(p_actions) action
    union
    select a.plan_id from jsonb_array_elements(p_actions) action
      join public.assignments a on a.id = (action->>'source_assignment_id')::uuid
     where action->>'kind' = 'copy'
  ) plans where plan_id is not null;
  if cardinality(v_plan_ids) not between 1 and 12 then
    raise exception 'A staffing matrix contains 1 to 12 plans' using errcode = '22023';
  end if;

  perform 1 from public.plans p where p.id = any(v_plan_ids) order by p.id for update;
  if (select count(*) from public.plans p where p.id = any(v_plan_ids) and p.organization_id = p_organization_id)
       <> cardinality(v_plan_ids)
     or (select count(*) from jsonb_to_recordset(p_base_revisions)
           as r(plan_id uuid, staffing_revision bigint)) <> cardinality(v_plan_ids)
     or exists (
       select 1 from unnest(v_plan_ids) u(plan_id)
       left join jsonb_to_recordset(p_base_revisions) as r(plan_id uuid, staffing_revision bigint) using (plan_id)
       left join public.plans p on p.id = u.plan_id
       where r.plan_id is null or p.staffing_revision <> r.staffing_revision
     ) then
    raise exception 'Staffing changed since the preview. Refresh and review again.'
      using errcode = 'PT409', hint = 'matrix_changed';
  end if;

  -- Validate every declared cell before the first write. No operation may be
  -- silently skipped, including an assignment that appeared after preview.
  for v_action in select value from jsonb_array_elements(p_actions) loop
    if v_action->>'kind' = 'assign' then
      if not public.can_schedule_on_plan((v_action->>'plan_id')::uuid, (v_action->>'team_id')::uuid) then
        raise exception 'You cannot schedule one of those cells' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.assignments a where a.plan_id = (v_action->>'plan_id')::uuid
          and a.person_id = (v_action->>'person_id')::uuid
          and a.team_id = (v_action->>'team_id')::uuid
          and a.position_id is not distinct from nullif(v_action->>'position_id', '')::uuid
      ) then raise exception 'A selected cell is already staffed' using errcode = 'PT409', hint = 'matrix_changed'; end if;
    elsif v_action->>'kind' in ('remove','release') then
      select * into v_assignment from public.assignments a
       where a.id = (v_action->>'assignment_id')::uuid and a.plan_id = (v_action->>'plan_id')::uuid;
      if v_assignment.id is null or v_assignment.request_revision <> (v_action->>'expected_request_revision')::bigint
         or (v_action->>'kind' = 'release' and v_assignment.visibility <> 'prepared') then
        raise exception 'A selected request changed since the preview' using errcode = 'PT409', hint = 'matrix_changed';
      end if;
      if not public.can_schedule_on_plan(v_assignment.plan_id, v_assignment.team_id) then
        raise exception 'You cannot change one of those cells' using errcode = '42501';
      end if;
    elsif v_action->>'kind' = 'copy' then
      select * into v_assignment from public.assignments a where a.id = (v_action->>'source_assignment_id')::uuid;
      if v_assignment.id is null or v_assignment.request_revision <> (v_action->>'expected_source_revision')::bigint then
        raise exception 'The source request changed since the preview' using errcode = 'PT409', hint = 'matrix_changed';
      end if;
      if not public.can_schedule_on_plan(v_assignment.plan_id, v_assignment.team_id)
         or not public.can_schedule_on_plan((v_action->>'destination_plan_id')::uuid, v_assignment.team_id) then
        raise exception 'You cannot copy one of those cells' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.assignments a where a.plan_id = (v_action->>'destination_plan_id')::uuid
          and a.person_id = v_assignment.person_id and a.team_id = v_assignment.team_id
          and a.position_id is not distinct from v_assignment.position_id
      ) then raise exception 'A copied cell is already staffed' using errcode = 'PT409', hint = 'matrix_changed'; end if;
    else
      raise exception 'Unknown staffing matrix action' using errcode = '22023';
    end if;
  end loop;

  select coalesce(array_agg(distinct person_id), '{}') into v_person_ids from (
    select (action->>'person_id')::uuid person_id from jsonb_array_elements(p_actions) action
      where action->>'kind' = 'assign'
    union
    select a.person_id from jsonb_array_elements(p_actions) action join public.assignments a
      on a.id = coalesce(nullif(action->>'assignment_id',''), nullif(action->>'source_assignment_id',''))::uuid
      where action->>'kind' in ('remove','release','copy')
  ) people;
  perform private.lock_scheduling_people(v_person_ids);

  for v_action in select value from jsonb_array_elements(p_actions) loop
    v_index := v_index + 1;
    if v_action->>'kind' = 'assign' then
      v_before_count := cardinality(v_assignment_ids);
      for v_created in select * from public.schedule_plan_assignments(
        (v_action->>'plan_id')::uuid,
        jsonb_build_array(jsonb_build_object(
          'person_id', v_action->>'person_id', 'team_id', v_action->>'team_id',
          'position_id', v_action->>'position_id', 'notes', null,
          'visibility', v_action->>'visibility', 'attendance_mode', v_action->>'attendance_mode',
          'time_ids', coalesce(v_action->'time_ids', '[]'::jsonb)
        )),
        coalesce((v_action->>'notify')::boolean, false),
        'matrix:' || p_operation_id || ':' || v_index::text,
        v_action->>'visibility', null, null
      ) loop v_assignment_ids := array_append(v_assignment_ids, v_created.id); end loop;
      if cardinality(v_assignment_ids) = v_before_count then
        raise exception 'A selected cell changed before it was staffed' using errcode = 'PT409', hint = 'matrix_changed';
      end if;
    elsif v_action->>'kind' = 'copy' then
      select * into v_assignment from public.assignments where id = (v_action->>'source_assignment_id')::uuid;
      v_before_count := cardinality(v_assignment_ids);
      for v_created in select * from public.schedule_plan_assignments(
        (v_action->>'destination_plan_id')::uuid,
        jsonb_build_array(jsonb_build_object(
          'person_id', v_assignment.person_id, 'team_id', v_assignment.team_id,
          'position_id', v_assignment.position_id, 'notes', v_assignment.notes,
          'visibility', v_action->>'visibility', 'attendance_mode', v_action->>'destination_attendance_mode',
          'time_ids', coalesce(v_action->'destination_time_ids', '[]'::jsonb)
        )),
        coalesce((v_action->>'notify')::boolean, false),
        'matrix:' || p_operation_id || ':' || v_index::text,
        v_action->>'visibility', null, null
      ) loop v_assignment_ids := array_append(v_assignment_ids, v_created.id); end loop;
      if cardinality(v_assignment_ids) = v_before_count then
        raise exception 'A copied cell changed before it was staffed' using errcode = 'PT409', hint = 'matrix_changed';
      end if;
    elsif v_action->>'kind' = 'remove' then
      delete from public.assignments where id = (v_action->>'assignment_id')::uuid;
    elsif v_action->>'kind' = 'release' then
      for v_created in select * from public.release_plan_assignments_versioned(
        (v_action->>'plan_id')::uuid,
        array[(v_action->>'assignment_id')::uuid],
        jsonb_build_array(jsonb_build_object(
          'assignment_id', v_action->>'assignment_id',
          'request_revision', (v_action->>'expected_request_revision')::bigint
        )),
        coalesce((v_action->>'notify')::boolean, true),
        'matrix:' || p_operation_id || ':' || v_index::text
      ) loop v_assignment_ids := array_append(v_assignment_ids, v_created.id); end loop;
    end if;
    select id into v_effect from public.delivery_effects
      where organization_id = p_organization_id and effect_key = 'matrix:' || p_operation_id || ':' || v_index::text;
    if v_effect is not null then v_effect_ids := array_append(v_effect_ids, v_effect); end if;
    v_effect := null;
  end loop;

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'committed_at', now(),
    'assignment_ids', to_jsonb(v_assignment_ids),
    'affected_plan_ids', to_jsonb(v_plan_ids),
    'delivery_effect_ids', to_jsonb(v_effect_ids)
  );
  insert into public.staffing_matrix_commits
    (organization_id, actor_id, idempotency_key, operation_id, result)
  values (p_organization_id, v_actor, p_idempotency_key, p_operation_id, v_result);
  return v_result;
end;
$$;
revoke execute on function public.commit_staffing_matrix(uuid, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.commit_staffing_matrix(uuid, text, jsonb, jsonb, text) to authenticated;

comment on function public.commit_staffing_matrix(uuid, text, jsonb, jsonb, text) is
  'F05 atomic reviewed staffing batch. Locks plans and People in sorted order; stale/invalid scope aborts the whole batch.';
