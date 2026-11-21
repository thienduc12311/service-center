-- W7F-COPY: duplicating a plan and saving a template from a plan read
-- public.people as the caller. Since 20261109000000 (people_owner_privacy) a
-- non-owner scheduler sees only their own Person, so the copy silently dropped
-- every item leader and the template roster came out empty.
--
-- Both copies only need to know which Person ids already referenced by the
-- SOURCE plan are still active. private.plan_active_people answers exactly
-- that (ids only, no Person fields), gated on org membership and on the caller
-- being able to edit or schedule on the plan. People visibility is unchanged.

create or replace function private.plan_active_people(p_plan uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  select organization_id into v_org from public.plans where id = p_plan;
  if v_org is null or v_uid is null then
    return '{}';
  end if;
  if not exists (
    select 1 from public.organization_members m
     where m.organization_id = v_org and m.user_id = v_uid and m.status = 'active'
  ) then
    return '{}';
  end if;
  if not (private.can_edit_plan(v_uid, p_plan)
          or exists (select 1 from public.teams t
                      where t.organization_id = v_org and public.can_schedule_on_plan(p_plan, t.id))) then
    return '{}';
  end if;
  return coalesce((
    select array_agg(distinct p.id)
      from public.people p
     where p.organization_id = v_org and p.archived_at is null
       and (p.id in (select i.leader_person_id from public.plan_items i where i.plan_id = p_plan)
            or p.id in (select a.person_id from public.assignments a where a.plan_id = p_plan))
  ), '{}');
end;
$$;

revoke execute on function private.plan_active_people(uuid) from public, anon;
grant execute on function private.plan_active_people(uuid) to authenticated;

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
  v_active_people uuid[] := private.plan_active_people(p_source);
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order,
      sequence_override, leader_person_id, leader_position_id, service_segment, media_id
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
           case when i.leader_person_id = any(v_active_people) then i.leader_person_id end,
           case when exists (select 1 from public.team_positions tp where tp.id = i.leader_position_id and tp.plan_id is null)
                then i.leader_position_id end,
           i.service_segment,
           -- F14: media carries over unless it was archived since (pickers hide it too).
           case when i.item_type = 'item' and exists (
             select 1 from public.media m where m.id = i.media_id and not private.media_is_archived(m)
           ) then i.media_id end
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

create or replace function private.plan_template_content_from_plan(p_plan uuid, p_components text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan   public.plans;
  v_tz     text;
  v_anchor date;
  v_out    jsonb := jsonb_build_object('version', 1);
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organizations where id = v_plan.organization_id;
  v_anchor := (v_plan.service_date at time zone v_tz)::date;

  if 'notes' = any(p_components) then
    v_out := v_out || jsonb_build_object('notes', nullif(btrim(v_plan.notes), ''));
  end if;
  if 'times' = any(p_components) then
    if exists (
      select 1 from public.plan_times t
       where t.plan_id = p_plan and abs((t.starts_at at time zone v_tz)::date - v_anchor) > 14
    ) then
      perform private.f10_bad('A time on this plan is more than 14 days from its service date');
    end if;
    v_out := v_out || jsonb_build_object('times', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', t.kind,
               'name', t.name,
               'day_offset', (t.starts_at at time zone v_tz)::date - v_anchor,
               'local_start', to_char(t.starts_at at time zone v_tz, 'HH24:MI'),
               'duration_minutes', least(1440, greatest(1, round(extract(epoch from t.ends_at - t.starts_at) / 60)::int))
             ) order by t.sort_order, t.starts_at, t.id)
        from public.plan_times t where t.plan_id = p_plan
    ), '[]'::jsonb));
  end if;
  if 'items' = any(p_components) then
    v_out := v_out || jsonb_build_object('items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_type', i.item_type, 'title', i.title, 'song_id', i.song_id,
               'arrangement_id', i.arrangement_id, 'key_override', i.key_override,
               'length_seconds', i.length_seconds, 'description', i.description
             ) order by i.sort_order, i.created_at, i.id)
        from public.plan_items i where i.plan_id = p_plan
    ), '[]'::jsonb));
  end if;
  if 'needs' = any(p_components) then
    v_out := v_out || jsonb_build_object('needs', coalesce((
      select jsonb_agg(jsonb_build_object('position_id', n.position_id, 'needed', n.needed) order by n.position_id)
        from public.plan_position_needs n
        join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
       where n.plan_id = p_plan and n.needed > 0
    ), '[]'::jsonb));
  end if;
  if 'roster' = any(p_components) then
    v_out := v_out || jsonb_build_object('roster', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'team_id', r.team_id, 'position_id', r.position_id)
                       order by r.team_id, r.position_id, r.person_id)
        from (
          select distinct a.person_id, a.team_id, a.position_id
            from public.assignments a
            left join public.team_positions tp on tp.id = a.position_id
           where a.plan_id = p_plan and a.status <> 'declined'
             and a.person_id = any(private.plan_active_people(p_plan))
             and (a.position_id is null or tp.plan_id is null)
        ) r
    ), '[]'::jsonb));
  end if;
  return v_out;
end;
$$;
