-- F11 — order item editing, effective charts and planned timing.
--
-- * Plan-only song sequence (`sequence_override`, null inherits the
--   arrangement's), item leader (a Person, or a team position resolved from
--   that plan's staffing) and the timing segment (pre-service / service /
--   post-service) live on the item. Library arrangements are never written.
-- * Every reference an item names is checked against the plan's organization
--   (and an arrangement against the item's song) when it is written. Rows
--   written before this migration are left as they are until those columns
--   change, so legacy data never blocks an unrelated edit.
-- * Edit, reorder and remove run in one short transaction that locks the plan
--   and compares `plans.content_revision` with the revision the editor read
--   (PT409 `plan_changed`). Reorder is one statement, not one request per row.
-- * Planned start/end times are derived (shared `computePlanSchedule`), never
--   stored, so they cannot drift from durations or service times.

-- ============================================================ columns ======

alter table public.plan_items
  add column sequence_override text[],
  add column leader_person_id uuid references public.people (id) on delete set null,
  add column leader_position_id uuid references public.team_positions (id) on delete set null,
  add column service_segment text not null default 'service';

alter table public.plan_items
  add constraint plan_items_sequence_override_size
    check (sequence_override is null or cardinality(sequence_override) <= 60),
  add constraint plan_items_single_leader
    check (leader_person_id is null or leader_position_id is null),
  add constraint plan_items_service_segment
    check (service_segment in ('pre', 'service', 'post'));

-- Foreign-key lookups (person/position deletes set these to null).
create index plan_items_leader_person_idx on public.plan_items (leader_person_id)
  where leader_person_id is not null;
create index plan_items_leader_position_idx on public.plan_items (leader_position_id)
  where leader_position_id is not null;

-- ================================================ reference validation =====

create or replace function private.validate_plan_item_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_ok boolean;
begin
  select organization_id into v_org from public.plans where id = new.plan_id;

  if tg_op = 'INSERT'
     or new.item_type is distinct from old.item_type
     or new.song_id is distinct from old.song_id
     or new.arrangement_id is distinct from old.arrangement_id
     or new.sequence_override is distinct from old.sequence_override then
    if new.item_type <> 'song' and (new.arrangement_id is not null or new.sequence_override is not null) then
      raise exception 'Only a song item can have an arrangement or sequence' using errcode = '22023';
    end if;
    if new.song_id is not null then
      select exists (select 1 from public.songs s where s.id = new.song_id and s.organization_id = v_org) into v_ok;
      if not v_ok then
        raise exception 'That song is not in this organization''s library' using errcode = '22023';
      end if;
    end if;
    if new.arrangement_id is not null then
      select exists (
        select 1 from public.arrangements a where a.id = new.arrangement_id and a.song_id = new.song_id
      ) into v_ok;
      if not v_ok then
        raise exception 'That arrangement belongs to a different song' using errcode = '22023';
      end if;
    end if;
    if new.sequence_override is not null and exists (
      select 1 from unnest(new.sequence_override) s(label)
       where s.label is null or char_length(btrim(s.label)) not between 1 and 20
    ) then
      raise exception 'Each sequence step needs 1 to 20 characters' using errcode = '22023';
    end if;
  end if;

  if new.leader_person_id is not null
     and (tg_op = 'INSERT' or new.leader_person_id is distinct from old.leader_person_id) then
    select exists (
      select 1 from public.people p
       where p.id = new.leader_person_id and p.organization_id = v_org and p.archived_at is null
    ) into v_ok;
    if not v_ok then
      raise exception 'That person is not on this organization''s roster' using errcode = '22023';
    end if;
  end if;

  if new.leader_position_id is not null
     and (tg_op = 'INSERT' or new.leader_position_id is distinct from old.leader_position_id) then
    select exists (
      select 1 from public.team_positions tp
        join public.teams t on t.id = tp.team_id
       where tp.id = new.leader_position_id and t.organization_id = v_org
         and (tp.plan_id is null or tp.plan_id = new.plan_id)
    ) into v_ok;
    if not v_ok then
      raise exception 'That position is not available on this plan' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function private.validate_plan_item_refs() from public, anon, authenticated;

create trigger plan_items_validate_refs
  before insert or update on public.plan_items
  for each row execute function private.validate_plan_item_refs();

-- ================================================== edit with revision =====

create or replace function private.lock_plan_for_order_edit(p_plan_id uuid, p_expected_revision bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revision bigint;
begin
  if not public.can_edit_plan(p_plan_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select content_revision into v_revision from public.plans where id = p_plan_id for update;
  if not found then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_revision then
    raise exception 'This plan changed since you opened it. Review the order and try again.'
      using errcode = 'PT409', hint = 'plan_changed';
  end if;
  return v_revision;
end;
$$;
revoke execute on function private.lock_plan_for_order_edit(uuid, bigint) from public, anon;
grant execute on function private.lock_plan_for_order_edit(uuid, bigint) to authenticated, service_role;

/**
 * Applies the keys present in `p_patch` to one item; absent keys are kept and
 * JSON null clears a nullable field. Returns the saved row and the plan's new
 * content revision.
 */
create or replace function public.update_plan_item(
  p_plan_id uuid,
  p_item_id uuid,
  p_patch jsonb,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.plan_items;
  v_seq text[];
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Send the fields to change' using errcode = '22023';
  end if;
  perform private.lock_plan_for_order_edit(p_plan_id, p_expected_revision);

  select * into v_item from public.plan_items where id = p_item_id and plan_id = p_plan_id for update;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;

  if p_patch ? 'sequence_override' and jsonb_typeof(p_patch -> 'sequence_override') = 'array' then
    v_seq := array(select jsonb_array_elements_text(p_patch -> 'sequence_override'));
  end if;

  update public.plan_items i set
    item_type = case when p_patch ? 'item_type' then (p_patch ->> 'item_type')::public.plan_item_type else i.item_type end,
    title = case when p_patch ? 'title' then p_patch ->> 'title' else i.title end,
    song_id = case when p_patch ? 'song_id' then (p_patch ->> 'song_id')::uuid else i.song_id end,
    arrangement_id = case when p_patch ? 'arrangement_id' then (p_patch ->> 'arrangement_id')::uuid else i.arrangement_id end,
    key_override = case when p_patch ? 'key_override' then p_patch ->> 'key_override' else i.key_override end,
    sequence_override = case when p_patch ? 'sequence_override' then v_seq else i.sequence_override end,
    length_seconds = case when p_patch ? 'length_seconds' then (p_patch ->> 'length_seconds')::int else i.length_seconds end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else i.description end,
    leader_person_id = case when p_patch ? 'leader_person_id' then (p_patch ->> 'leader_person_id')::uuid else i.leader_person_id end,
    leader_position_id = case when p_patch ? 'leader_position_id' then (p_patch ->> 'leader_position_id')::uuid else i.leader_position_id end,
    service_segment = case when p_patch ? 'service_segment' then p_patch ->> 'service_segment' else i.service_segment end,
    updated_at = now()
  where i.id = p_item_id
  returning * into v_item;

  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;
revoke execute on function public.update_plan_item(uuid, uuid, jsonb, bigint) from public, anon;
grant execute on function public.update_plan_item(uuid, uuid, jsonb, bigint) to authenticated, service_role;

/** The full order, every item id once. Only rows whose position changes are written. */
create or replace function public.reorder_plan_items(
  p_plan_id uuid,
  p_item_ids uuid[],
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_known int;
  v_matched int;
begin
  perform private.lock_plan_for_order_edit(p_plan_id, p_expected_revision);

  select count(*) into v_known from public.plan_items where plan_id = p_plan_id;
  select count(distinct i.id) into v_matched
    from unnest(p_item_ids) x(id) join public.plan_items i on i.id = x.id and i.plan_id = p_plan_id;
  if cardinality(p_item_ids) <> v_known or v_matched <> v_known then
    raise exception 'Send every item in the plan exactly once, in the new order' using errcode = '22023';
  end if;

  update public.plan_items i
     set sort_order = x.ord::int - 1
    from unnest(p_item_ids) with ordinality x(id, ord)
   where i.id = x.id and i.plan_id = p_plan_id and i.sort_order <> x.ord::int - 1;

  return jsonb_build_object(
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;
revoke execute on function public.reorder_plan_items(uuid, uuid[], bigint) from public, anon;
grant execute on function public.reorder_plan_items(uuid, uuid[], bigint) to authenticated, service_role;

create or replace function public.delete_plan_item(
  p_plan_id uuid,
  p_item_id uuid,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.lock_plan_for_order_edit(p_plan_id, p_expected_revision);
  delete from public.plan_items where id = p_item_id and plan_id = p_plan_id;
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;
revoke execute on function public.delete_plan_item(uuid, uuid, bigint) from public, anon;
grant execute on function public.delete_plan_item(uuid, uuid, bigint) to authenticated, service_role;

-- ======================================================= copying ==========

-- Same as the F04 definition, plus the F11 item fields: a duplicated or
-- imported order keeps its sequence, leader and segment. A plan-only leader
-- position does not exist on the other plan, so it is not carried over.
create or replace function private.copy_plan_children(
  p_source       uuid,
  p_target       uuid,
  p_items        boolean,
  p_needs        boolean,
  p_assignments  boolean,
  p_time_offset  interval
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base int;
  v_map jsonb := '{}'::jsonb;
  v_source_date timestamptz;
  v_target_date timestamptz;
  v_people uuid[];
  v_selected jsonb;
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order,
      sequence_override, leader_person_id, leader_position_id, service_segment
    )
    -- A legacy row naming another song's arrangement copies as "no
    -- arrangement chosen" instead of failing the whole copy.
    select p_target, i.item_type, i.title, i.song_id,
           case when i.item_type = 'song' and exists (
             select 1 from public.arrangements a where a.id = i.arrangement_id and a.song_id = i.song_id
           ) then i.arrangement_id end,
           i.key_override,
           i.length_seconds, i.description,
           v_base + (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1,
           case when i.item_type = 'song' then i.sequence_override end,
           case when exists (select 1 from public.people p where p.id = i.leader_person_id and p.archived_at is null)
                then i.leader_person_id end,
           case when exists (select 1 from public.team_positions tp where tp.id = i.leader_position_id and tp.plan_id is null)
                then i.leader_position_id end,
           i.service_segment
      from public.plan_items i
     where i.plan_id = p_source;
  end if;

  if p_time_offset is not null then
    with source_times as (
      select t.*, gen_random_uuid() new_id from public.plan_times t where t.plan_id = p_source
    ), copied as (
      insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order)
      select s.new_id, p_target, s.kind, s.name, s.starts_at + p_time_offset, s.ends_at + p_time_offset, s.sort_order
        from source_times s
      returning id
    )
    select coalesce(jsonb_object_agg(s.id::text, s.new_id), '{}'::jsonb) into v_map
      from source_times s where s.new_id in (select id from copied);
  else
    select service_date into v_source_date from public.plans where id = p_source;
    select service_date into v_target_date from public.plans where id = p_target;
    select coalesce(jsonb_object_agg(s.id::text, m.id), '{}'::jsonb) into v_map
      from public.plan_times s
      cross join lateral (
        select t.id from public.plan_times t
         where t.plan_id = p_target and t.kind = s.kind
           and coalesce(t.name, '') = coalesce(s.name, '')
           and t.starts_at - v_target_date = s.starts_at - v_source_date
           and t.ends_at - t.starts_at = s.ends_at - s.starts_at
         order by t.sort_order, t.id limit 1
      ) m
     where s.plan_id = p_source;
  end if;

  if p_needs then
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_target, n.position_id, n.needed
      from public.plan_position_needs n
      join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
     where n.plan_id = p_source and n.needed > 0
       and (public.can_edit_plan(p_target)
            or public.can_schedule_on_plan(p_target, private.position_team(n.position_id)))
    on conflict (plan_id, position_id) do nothing;
  end if;

  if p_assignments then
    select coalesce(array_agg(distinct a.person_id), '{}') into v_people
      from public.assignments a where a.plan_id = p_source;
    perform private.lock_scheduling_people(v_people);

    with eligible as (
      select a.*,
             case when a.attendance_mode = 'selected' then array(
               select (v_map->>aat.plan_time_id::text)::uuid
                 from public.assignment_attendance_times aat
                where aat.assignment_id = a.id and v_map ? aat.plan_time_id::text
             ) end mapped_times
        from public.assignments a
       where a.plan_id = p_source
         and exists (select 1 from private.resolve_scheduling_person(p_target, a.person_id, null))
         and (a.position_id is null
              or exists (select 1 from public.team_positions tp where tp.id = a.position_id and tp.plan_id is null))
         and public.can_schedule_on_plan(p_target, a.team_id)
    ), inserted as (
      insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by, attendance_mode)
      select p_target, e.person_id, e.team_id, e.position_id, 'unconfirmed', (select auth.uid()), e.attendance_mode
        from eligible e
       where e.attendance_mode = 'all' or cardinality(e.mapped_times) > 0
      on conflict do nothing
      returning id, person_id, team_id, position_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'times', to_jsonb(e.mapped_times))), '[]'::jsonb)
      into v_selected
      from inserted i
      join eligible e on e.person_id = i.person_id and e.team_id = i.team_id
                     and e.position_id is not distinct from i.position_id
     where e.attendance_mode = 'selected';

    -- A separate statement: the policy on selections must see the new rows.
    insert into public.assignment_attendance_times (assignment_id, plan_time_id)
    select (x->>'id')::uuid, t.id::uuid
      from jsonb_array_elements(v_selected) x
      cross join jsonb_array_elements_text(x->'times') t(id)
    on conflict do nothing;

    perform private.check_pending_conflicts();
  end if;
end;
$$;
