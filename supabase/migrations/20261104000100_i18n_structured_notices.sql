-- i18n: structured parameters for server-built notice and warning text.
--
-- These functions used to describe a situation only as an English sentence
-- with numbers, names or dates built in, so clients could not translate it.
-- Each such row/notice now also carries `params` (counts, dates, names,
-- enum values) alongside its unchanged `code` and English `message`/`detail`,
-- which stay for compatibility with older clients. Clients translate by
-- `code` + `params` and fall back to the English text for unknown codes.
--
--   * scheduling_preference_warnings: + `params jsonb` column
--       frequency {frequency}, monthly_max {served, max}, avoided_week {week},
--       availability_stale {reviewed_on: YYYY-MM-DD in the org zone}; others {}.
--     The return type changes, so the function is dropped and re-created in
--     this transaction with the same arguments, body and grants.
--   * private.plan_shift_preview: date_taken {service_type, date},
--       confirmed_kept {count}, conflicts {count}.
--   * private.plan_order_move_preview: item_discussion_removed {count, scope: moved|destination}.
--   * private.plan_template_preview: older_revision {revision, latest},
--       arrangement_missing {count}, item_discussion_removed {count, scope: current},
--       times_added {count}, already_applied {count}.
--
-- The private functions keep their signatures (jsonb result), so their grants
-- are unchanged. Bodies are otherwise copied verbatim from
-- 20261019000200_f03_preferences_and_requests.sql,
-- 20261027000100_f10_plan_reschedule.sql and 20261027000000_f10_plan_templates.sql.
-- A template preview computed before this migration hashes differently, so
-- applying it afterwards asks for a fresh preview once (template_preview_changed).

-- =============================================== preference warnings ======

drop function if exists public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[]);

create or replace function public.scheduling_preference_warnings(
  p_organization_id uuid,
  p_plan_id uuid,
  p_team_id uuid,
  p_person_ids uuid[],
  p_plan_time_ids uuid[] default null
)
returns table (person_id uuid, code text, detail text, preference_team_id uuid, params jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_plan public.plans;
  v_tz text;
  v_week int;
  v_date date;
begin
  select * into v_plan from public.plans where id = p_plan_id and organization_id = p_organization_id;
  if v_plan.id is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if v_actor is not null and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check warnings' using errcode = '42501';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.organization_id = p_organization_id) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(p_person_ids) ids(id)
              where not exists (select 1 from public.people p where p.id = ids.id and p.organization_id = p_organization_id)) then
    raise exception 'Warning scope crosses organizations' using errcode = '22023';
  end if;
  select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = p_organization_id;
  v_date := (v_plan.service_date at time zone v_tz)::date;
  v_week := (extract(day from v_date)::int - 1) / 7 + 1;

  return query
  with prefs as (
    select distinct on (sp.person_id) sp.*
      from public.scheduling_preferences sp
     where sp.person_id = any (p_person_ids)
       and (sp.team_id is null or sp.team_id = p_team_id)
     order by sp.person_id, (sp.team_id is null)
  ), served as (
    select a.person_id, a.team_id, p.id plan_id, (p.service_date at time zone v_tz)::date service_date
      from public.assignments a
      join public.plans p on p.id = a.plan_id
     where p.organization_id = p_organization_id
       and a.person_id = any (p_person_ids)
       and a.status <> 'declined'
       and p.id <> v_plan.id
       and p.service_date between v_plan.service_date - interval '40 days' and v_plan.service_date + interval '40 days'
       and (a.visibility = 'released' or v_actor is null
            or private.can_schedule_on_plan(v_actor, a.plan_id, a.team_id))
  ), counted as (
    select pr.person_id, pr.team_id preference_team_id, pr.frequency, pr.max_per_month,
           count(distinct s.plan_id) filter (where s.service_date between v_date - 6 and v_date + 6) w1,
           count(distinct s.plan_id) filter (where s.service_date between v_date - 13 and v_date + 13) w2,
           count(distinct s.plan_id) filter (where s.service_date between v_date - 20 and v_date + 20) w3,
           count(distinct s.plan_id) filter (where date_trunc('month', s.service_date) = date_trunc('month', v_date)) m
      from prefs pr
      left join served s on s.person_id = pr.person_id and (pr.team_id is null or s.team_id = pr.team_id)
     group by pr.person_id, pr.team_id, pr.frequency, pr.max_per_month
  )
  select c.person_id, 'frequency'::text,
         case c.frequency
           when 'every_week' then 'Prefers serving at most once a week'
           when 'every_other_week' then 'Prefers serving every other week'
           when 'every_third_week' then 'Prefers serving every third week'
           else 'Prefers serving once a month' end,
         c.preference_team_id,
         jsonb_build_object('frequency', c.frequency)
    from counted c
   where (c.frequency = 'every_week' and c.w1 > 0)
      or (c.frequency = 'every_other_week' and c.w2 > 0)
      or (c.frequency = 'every_third_week' and c.w3 > 0)
      or (c.frequency = 'once_a_month' and c.m > 0)
  union all
  select c.person_id, 'monthly_max', 'Already serving ' || c.m || ' of at most ' || c.max_per_month || ' this month',
         c.preference_team_id, jsonb_build_object('served', c.m, 'max', c.max_per_month)
    from counted c where c.max_per_month is not null and c.m >= c.max_per_month
  union all
  select pr.person_id, 'avoided_date', 'Asked not to serve on this date', pr.team_id, '{}'::jsonb
    from prefs pr where v_date = any (pr.avoided_dates)
  union all
  select pr.person_id, 'avoided_week', 'Asked not to serve in week ' || v_week || ' of the month', pr.team_id,
         jsonb_build_object('week', v_week)
    from prefs pr where v_week = any (pr.avoided_weeks)
  union all
  select pr.person_id, 'outside_preferred_weeks', 'Prefers other weeks of the month', pr.team_id, '{}'::jsonb
    from prefs pr where cardinality(pr.preferred_weeks) > 0 and not (v_week = any (pr.preferred_weeks))
  union all
  select pr.person_id, 'outside_preferred_dates', 'Prefers other dates', pr.team_id, '{}'::jsonb
    from prefs pr where cardinality(pr.preferred_dates) > 0 and not (v_date = any (pr.preferred_dates))
  union all
  select pr.person_id, 'time_not_preferred', 'Prefers other service times', pr.team_id, '{}'::jsonb
    from prefs pr
   where cardinality(pr.preferred_times) > 0
     and exists (
       select 1 from public.plan_times pt
        where pt.plan_id = v_plan.id and pt.kind = 'service'
          and (p_plan_time_ids is null or pt.id = any (p_plan_time_ids))
          and not (((pt.starts_at at time zone v_tz)::time) = any (pr.preferred_times)))
  union all
  select ids.id, case when r.person_id is null then 'availability_unknown' else 'availability_stale' end,
         case when r.person_id is null then 'Has never reviewed their availability'
              else 'Availability last reviewed ' || to_char(r.reviewed_at at time zone v_tz, 'YYYY-MM-DD') end,
         null::uuid,
         case when r.person_id is null then '{}'::jsonb
              else jsonb_build_object('reviewed_on', to_char(r.reviewed_at at time zone v_tz, 'YYYY-MM-DD')) end
    from unnest(p_person_ids) ids(id)
    left join public.person_availability_reviews r on r.person_id = ids.id
   where r.person_id is null or r.reviewed_at < now() - interval '90 days';
end;
$$;
revoke execute on function public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[]) to authenticated, service_role;

-- ======================================================= reschedule ======

create or replace function private.plan_shift_preview(p_org uuid, p_moves jsonb, p_reset boolean, p_notify boolean)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_tz        text;
  v_move      jsonb;
  v_plan      public.plans;
  v_new_date  date;
  v_old_date  date;
  v_service   timestamptz;
  v_times     jsonb;
  v_given     jsonb;
  v_time      public.plan_times;
  v_start     timestamptz;
  v_end       timestamptz;
  v_rows      jsonb := '[]'::jsonb;
  v_seen      uuid[] := '{}';
  v_warnings  jsonb;
  v_people    jsonb;
  v_reset     int;
  v_count     int;
  v_conflicts jsonb;
begin
  if p_moves is null or jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) not between 1 and 12 then
    perform private.f10_bad('Move between 1 and 12 plans at a time');
  end if;
  select timezone into v_tz from public.organizations where id = p_org;

  for v_move in select value from jsonb_array_elements(p_moves) loop
    begin
      select * into v_plan from public.plans
       where id = (v_move ->> 'plan_id')::uuid and organization_id = p_org;
      v_new_date := (v_move ->> 'new_local_date')::date;
      v_service := (v_move ->> 'service_date')::timestamptz;
    exception when others then
      perform private.f10_bad('Each move needs a plan and a new date');
    end;
    if v_plan.id is null or not private.can_edit_plan(v_uid, v_plan.id) then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
    if v_plan.id = any(v_seen) then
      perform private.f10_bad('A plan is listed twice');
    end if;
    v_seen := v_seen || v_plan.id;
    v_old_date := (v_plan.service_date at time zone v_tz)::date;
    if v_new_date = v_old_date then
      perform private.f10_bad(format('%s is already on %s', v_plan.title, v_new_date));
    end if;
    -- Same wall-clock time of day, on the new local date.
    if v_service is null or (v_service at time zone v_tz)
       <> v_new_date + (v_plan.service_date at time zone v_tz)::time then
      perform private.f10_bad('Preview the new dates again');
    end if;

    v_given := coalesce(v_move -> 'times', '[]'::jsonb);
    if jsonb_typeof(v_given) <> 'array'
       or jsonb_array_length(v_given) <> (select count(*) from public.plan_times where plan_id = v_plan.id) then
      perform private.f10_bad('Preview the new dates again');
    end if;
    v_times := '[]'::jsonb;
    for v_time in select * from public.plan_times where plan_id = v_plan.id order by sort_order, starts_at, id loop
      select (g ->> 'starts_at')::timestamptz, (g ->> 'ends_at')::timestamptz into v_start, v_end
        from jsonb_array_elements(v_given) g where (g ->> 'id')::uuid = v_time.id;
      if v_start is null
         or (v_start at time zone v_tz) <> (v_time.starts_at at time zone v_tz) + (v_new_date - v_old_date) * interval '1 day'
         or v_end - v_start <> v_time.ends_at - v_time.starts_at then
        perform private.f10_bad('Preview the new dates again');
      end if;
      v_times := v_times || jsonb_build_array(jsonb_build_object(
        'id', v_time.id, 'kind', v_time.kind, 'name', v_time.name, 'sort_order', v_time.sort_order,
        'from_starts_at', v_time.starts_at, 'starts_at', v_start, 'ends_at', v_end,
        'from_local', to_char(v_time.starts_at at time zone v_tz, 'YYYY-MM-DD HH24:MI'),
        'to_local', to_char(v_start at time zone v_tz, 'YYYY-MM-DD HH24:MI')));
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
             'assignment_id', a.id, 'person_id', a.person_id, 'team_id', a.team_id,
             'status', a.status, 'visibility', a.visibility,
             'resets', p_reset and a.visibility = 'released' and a.status <> 'unconfirmed')
             order by a.team_id, a.person_id, a.id), '[]'::jsonb)
      into v_people
      from public.assignments a where a.plan_id = v_plan.id;
    select count(*) into v_reset from jsonb_array_elements(v_people) p where (p ->> 'resets')::boolean;

    v_warnings := '[]'::jsonb;
    if exists (
      select 1 from public.plans o
       where o.organization_id = p_org and o.id <> v_plan.id
         and o.service_type_id is not distinct from v_plan.service_type_id
         and (o.service_date at time zone v_tz)::date = v_new_date
         and not (o.id = any(select (m ->> 'plan_id')::uuid from jsonb_array_elements(p_moves) m))
    ) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'date_taken',
        'params', jsonb_build_object('service_type', coalesce((select name from public.service_types where id = v_plan.service_type_id), ''), 'date', v_new_date),
        'message', format('Another %s plan is already on %s.', coalesce((select name from public.service_types where id = v_plan.service_type_id), ''), v_new_date)));
    end if;
    select count(*) into v_count from jsonb_array_elements(v_people) p
     where p ->> 'visibility' = 'released' and p ->> 'status' = 'confirmed';
    if v_count > 0 and not p_reset then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'confirmed_kept', 'params', jsonb_build_object('count', v_count),
        'message', format('%s confirmed answer(s) stay confirmed for the new date.', v_count)));
    end if;
    -- Time edits never refuse over a conflict (F04); overlaps are shown so
    -- the scheduler decides. Plans moved in the same batch are compared at
    -- their current times.
    select coalesce(jsonb_agg(c order by c ->> 'person_id', c ->> 'plan_id'), '[]'::jsonb) into v_conflicts
      from (
        select distinct jsonb_build_object('person_id', a.person_id, 'plan_id', o.plan_id, 'plan_title', op.title) c
          from public.assignments a
          join public.assignments o on o.person_id = a.person_id and o.plan_id <> a.plan_id and o.status <> 'declined'
          join public.plans op on op.id = o.plan_id
          join public.plan_times ot on ot.plan_id = o.plan_id
          join jsonb_array_elements(v_times) nt
            on tstzrange((nt ->> 'starts_at')::timestamptz, (nt ->> 'ends_at')::timestamptz)
               && tstzrange(ot.starts_at, ot.ends_at)
         where a.plan_id = v_plan.id and a.status <> 'declined'
      ) x;
    if jsonb_array_length(v_conflicts) > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'conflicts', 'params', jsonb_build_object('count', jsonb_array_length(v_conflicts)),
        'message', format('%s person/plan overlap(s) at the new time; they are not refused.', jsonb_array_length(v_conflicts))));
    end if;
    if p_reset and not p_notify and v_reset > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'reset_silent',
        'message', 'Answers are reset but nobody is told; they stay unconfirmed until you send the requests again.'));
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'plan_id', v_plan.id, 'title', v_plan.title,
      'content_revision', v_plan.content_revision, 'staffing_revision', v_plan.staffing_revision,
      'from_local_date', v_old_date, 'to_local_date', v_new_date,
      'from_service_date', v_plan.service_date, 'service_date', v_service,
      'times', v_times,
      'people', v_people,
      'conflicts', v_conflicts,
      'counts', jsonb_build_object(
        'confirmed', (select count(*) from jsonb_array_elements(v_people) p where p ->> 'visibility' = 'released' and p ->> 'status' = 'confirmed'),
        'unconfirmed', (select count(*) from jsonb_array_elements(v_people) p where p ->> 'visibility' = 'released' and p ->> 'status' = 'unconfirmed'),
        'declined', (select count(*) from jsonb_array_elements(v_people) p where p ->> 'visibility' = 'released' and p ->> 'status' = 'declined'),
        'prepared', (select count(*) from jsonb_array_elements(v_people) p where p ->> 'visibility' = 'prepared'),
        'responses_reset', v_reset,
        'requests_resent', case when p_notify then (
          select count(*) from jsonb_array_elements(v_people) p
           where p ->> 'visibility' = 'released' and (p ->> 'status' <> 'declined' or (p ->> 'resets')::boolean)) else 0 end,
        'links_invalidated', (
          select count(*) from public.assignment_request_snapshots s
           where s.plan_id = v_plan.id and s.consumed_at is null and s.superseded_at is null),
        'reminder_jobs_recalculated', (
          select count(*) from public.reminder_jobs j where j.plan_id = v_plan.id and j.status = 'scheduled'),
        'calendar_entries_moved', (
          select count(distinct p ->> 'person_id') from jsonb_array_elements(v_people) p
           where p ->> 'visibility' = 'released' and p ->> 'status' <> 'declined'),
        'deliveries_pending', (
          select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
           where e.plan_id = v_plan.id and d.status in ('queued', 'sending'))),
      'warnings', v_warnings));
  end loop;

  return jsonb_build_object('mode', 'shift', 'timezone', v_tz, 'reset_responses', p_reset,
                            'notify', p_notify, 'plans', v_rows);
end;
$$;

create or replace function private.plan_order_move_preview(p_org uuid, p_order jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_source  public.plans;
  v_dest    public.plans;
  v_mode    text := coalesce(p_order ->> 'items_mode', 'append');
  v_remove  boolean := coalesce((p_order ->> 'remove_from_source')::boolean, true);
  v_warn    jsonb := '[]'::jsonb;
  v_count   int;
  v_roster  jsonb;
begin
  if v_mode not in ('append', 'replace') then
    perform private.f10_bad('Choose append or replace');
  end if;
  begin
    select * into v_source from public.plans where id = (p_order ->> 'source_plan_id')::uuid and organization_id = p_org;
    select * into v_dest from public.plans where id = (p_order ->> 'destination_plan_id')::uuid and organization_id = p_org;
  exception when others then
    perform private.f10_bad('Choose the plan to move from and the plan to move to');
  end;
  if v_source.id is null or v_dest.id is null
     or not private.can_edit_plan(v_uid, v_source.id) or not private.can_edit_plan(v_uid, v_dest.id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if v_source.id = v_dest.id then
    perform private.f10_bad('Choose two different plans');
  end if;
  select count(*) into v_count from public.plan_items where plan_id = v_source.id;
  if v_count = 0 then
    perform private.f10_bad('The plan to move from has no order items');
  end if;

  if v_remove then
    select count(distinct x.plan_item_id) into v_count from (
      select c.plan_item_id from public.plan_item_comments c where c.plan_id = v_source.id
      union all select n.plan_item_id from public.plan_notes n where n.plan_id = v_source.id and n.plan_item_id is not null) x;
    if v_count > 0 then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed', 'params', jsonb_build_object('count', v_count, 'scope', 'moved'),
        'message', format('%s moved item(s) have notes or comments; those stay with the old items and are removed.', v_count)));
    end if;
  end if;
  if v_mode = 'replace' then
    select count(distinct x.plan_item_id) into v_count from (
      select c.plan_item_id from public.plan_item_comments c where c.plan_id = v_dest.id
      union all select n.plan_item_id from public.plan_notes n where n.plan_id = v_dest.id and n.plan_item_id is not null) x;
    if v_count > 0 then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed', 'params', jsonb_build_object('count', v_count, 'scope', 'destination'),
        'message', format('%s item(s) on the destination have notes or comments that are removed with them.', v_count)));
    end if;
  end if;

  select jsonb_build_object(
           'confirmed', count(*) filter (where a.visibility = 'released' and a.status = 'confirmed'),
           'unconfirmed', count(*) filter (where a.visibility = 'released' and a.status = 'unconfirmed'),
           'declined', count(*) filter (where a.visibility = 'released' and a.status = 'declined'),
           'prepared', count(*) filter (where a.visibility = 'prepared'))
    into v_roster from public.assignments a where a.plan_id = v_dest.id;

  return jsonb_build_object(
    'mode', 'order_only',
    'items_mode', v_mode,
    'remove_from_source', v_remove,
    'source', jsonb_build_object(
      'plan_id', v_source.id, 'title', v_source.title, 'content_revision', v_source.content_revision,
      'items', (select coalesce(jsonb_agg(i.title order by i.sort_order, i.created_at, i.id), '[]'::jsonb)
                  from public.plan_items i where i.plan_id = v_source.id)),
    'destination', jsonb_build_object(
      'plan_id', v_dest.id, 'title', v_dest.title, 'content_revision', v_dest.content_revision,
      'staffing_revision', v_dest.staffing_revision,
      'items_removed', case when v_mode = 'replace' then (select count(*) from public.plan_items where plan_id = v_dest.id) else 0 end,
      'items_kept', case when v_mode = 'append' then (select count(*) from public.plan_items where plan_id = v_dest.id) else 0 end,
      'roster_kept', v_roster),
    -- Order-only never touches these; stated so the review shows it.
    'unchanged', jsonb_build_array('times', 'roster', 'answers', 'reminder_jobs', 'calendar_feeds', 'notes'),
    'warnings', v_warn);
end;
$$;

-- ============================================== template preview ======

create or replace function private.plan_template_preview(
  p_org          uuid,
  p_service_type uuid,
  p_plan         uuid,
  p_anchor       date,
  p_revision_id  uuid,
  p_mode         text,
  p_components   text[],
  p_times        jsonb,
  p_insert_at    int
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_rev       public.plan_template_revisions;
  v_tpl       public.plan_templates;
  v_tz        text;
  v_content   jsonb;
  v_plan      public.plans;
  v_out       jsonb;
  v_blocking  jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  v_el        jsonb;
  v_given     jsonb;
  v_i         bigint;
  v_add       jsonb;
  v_skipped   jsonb;
  v_kept      jsonb;
  v_existing  int;
  v_count     int;
  v_missing   int;
  v_title     text;
  v_arr       uuid;
  v_team      uuid;
  v_pos       uuid;
  v_notes     text;
  v_template_notes text;
  v_assigned  int := 0;
  v_expected  timestamp;
  v_start     timestamptz;
  v_end       timestamptz;
begin
  if p_mode is null or p_mode not in ('append', 'replace') then
    perform private.f10_bad('Choose append or replace');
  end if;
  if p_components is null or cardinality(p_components) = 0
     or not (p_components <@ array['times', 'notes', 'items', 'needs', 'roster']) then
    perform private.f10_bad('Choose at least one part of the template');
  end if;
  if not private.capability_for(v_uid, p_org, 'plans.edit', p_service_type, null) then
    raise exception 'Only a plan editor can apply templates here' using errcode = '42501';
  end if;

  select * into v_rev from public.plan_template_revisions where id = p_revision_id;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  select * into v_tpl from public.plan_templates where id = v_rev.template_id;
  if not found or v_tpl.organization_id <> p_org then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.archived_at is not null then
    perform private.f10_bad('Restore this template before applying it');
  end if;
  if v_tpl.kind = 'section' and p_components <> array['items'] then
    perform private.f10_bad('A section template applies order items only');
  end if;
  if v_tpl.service_type_id is not null and v_tpl.service_type_id is distinct from p_service_type then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'other_service_type', 'message', 'This template belongs to a different service type.'));
  end if;
  if v_rev.revision <> v_tpl.current_revision then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'older_revision', 'params', jsonb_build_object('revision', v_rev.revision, 'latest', v_tpl.current_revision), 'message', format('Revision %s is not the latest (%s).', v_rev.revision, v_tpl.current_revision)));
  end if;

  v_content := v_rev.content;
  select timezone into v_tz from public.organizations where id = p_org;
  if p_plan is not null then
    select * into v_plan from public.plans where id = p_plan;
    select count(*) into v_assigned from public.assignments where plan_id = p_plan;
  end if;

  v_out := jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_tpl.id, 'name', v_tpl.name, 'kind', v_tpl.kind,
      'revision', v_rev.revision, 'revision_id', v_rev.id, 'latest_revision', v_tpl.current_revision),
    'plan_id', p_plan,
    'destination_revision', v_plan.content_revision,
    'anchor_date', p_anchor,
    'timezone', v_tz,
    'mode', p_mode,
    'components', to_jsonb(p_components)
  );

  -- ------------------------------------------------------------ items
  if 'items' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_missing := 0;
    for v_el in select value from jsonb_array_elements(v_content -> 'items') loop
      v_title := v_el ->> 'title';
      if (v_el ->> 'song_id') is not null and not exists (
        select 1 from public.songs s where s.id = (v_el ->> 'song_id')::uuid and s.organization_id = p_org
      ) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('title', v_title, 'reason', 'song_missing'));
        continue;
      end if;
      v_arr := (v_el ->> 'arrangement_id')::uuid;
      if v_arr is not null and not exists (select 1 from public.arrangements a where a.id = v_arr) then
        v_arr := null;
        v_missing := v_missing + 1;
      end if;
      v_add := v_add || jsonb_build_array(v_el || jsonb_build_object('arrangement_id', v_arr));
    end loop;
    if v_missing > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'arrangement_missing', 'params', jsonb_build_object('count', v_missing),
        'message', format('%s item(s) use an arrangement that no longer exists; they keep the song default.', v_missing)));
    end if;
    select count(*) into v_existing from public.plan_items where plan_id = p_plan;
    if p_mode = 'replace' and v_existing > 0 then
      select count(distinct x.plan_item_id) into v_count from (
        select c.plan_item_id from public.plan_item_comments c where c.plan_id = p_plan
        union all
        select n.plan_item_id from public.plan_notes n where n.plan_id = p_plan and n.plan_item_id is not null
      ) x;
      if v_count > 0 then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed', 'params', jsonb_build_object('count', v_count, 'scope', 'current'),
          'message', format('%s current item(s) have notes or comments that are removed with them.', v_count)));
      end if;
    end if;
    if p_insert_at is not null and (p_mode = 'replace' or p_insert_at < 0 or p_insert_at > v_existing) then
      perform private.f10_bad('Choose a place inside the current order');
    end if;
    v_out := v_out || jsonb_build_object('items', jsonb_build_object(
      'add', v_add, 'skipped', v_skipped,
      'remove_count', case when p_mode = 'replace' then v_existing else 0 end,
      'existing_count', v_existing,
      'insert_at', case when p_mode = 'replace' then 0 else coalesce(p_insert_at, v_existing) end));
  end if;

  -- ------------------------------------------------------------ times
  if 'times' = any(p_components) then
    v_given := coalesce(p_times, '[]'::jsonb);
    if jsonb_typeof(v_given) <> 'array' or jsonb_array_length(v_given) <> jsonb_array_length(v_content -> 'times') then
      perform private.f10_bad('Preview the template times again');
    end if;
    v_add := '[]'::jsonb;
    for v_el, v_i in select value, ordinality from jsonb_array_elements(v_content -> 'times') with ordinality loop
      begin
        v_start := (v_given -> (v_i::int - 1) ->> 'starts_at')::timestamptz;
        v_end := (v_given -> (v_i::int - 1) ->> 'ends_at')::timestamptz;
      exception when others then
        perform private.f10_bad('Preview the template times again');
      end;
      -- The resolved instant must show the template's wall-clock time on the
      -- intended local date; either side of a DST fold is accepted, a
      -- skipped (spring-forward) time never matches.
      v_expected := (p_anchor + (v_el ->> 'day_offset')::int) + (v_el ->> 'local_start')::time;
      if v_start is null or v_end is null or (v_start at time zone v_tz) <> v_expected
         or v_end - v_start <> make_interval(mins => (v_el ->> 'duration_minutes')::int) then
        perform private.f10_bad('Preview the template times again');
      end if;
      v_add := v_add || jsonb_build_array(jsonb_build_object(
        'kind', v_el ->> 'kind', 'name', v_el -> 'name', 'starts_at', v_start, 'ends_at', v_end,
        'local_date', (p_anchor + (v_el ->> 'day_offset')::int), 'local_start', v_el ->> 'local_start'));
    end loop;
    select count(*) into v_existing from public.plan_times where plan_id = p_plan;
    if p_mode = 'replace' and v_existing > 0 and v_assigned > 0 then
      v_blocking := v_blocking || jsonb_build_array(jsonb_build_object('code', 'times_in_use',
        'message', 'People are scheduled on this plan. Change its times in the plan''s time editor so they are asked again, or append.'));
    elsif p_mode = 'append' and v_existing > 0 and jsonb_array_length(v_add) > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'times_added', 'params', jsonb_build_object('count', v_existing),
        'message', format('The plan keeps its %s time(s); the template''s are added.', v_existing)));
    end if;
    v_out := v_out || jsonb_build_object('times', jsonb_build_object(
      'add', v_add, 'remove_count', case when p_mode = 'replace' then v_existing else 0 end));
  end if;

  -- ------------------------------------------------------------ notes
  if 'notes' = any(p_components) then
    v_template_notes := v_content ->> 'notes';
    v_notes := nullif(btrim(v_plan.notes), '');
    v_out := v_out || jsonb_build_object('notes', case
      when v_template_notes is null then jsonb_build_object('action', 'none', 'value', v_notes)
      when p_mode = 'replace' or v_notes is null then jsonb_build_object('action', 'set', 'value', v_template_notes)
      else jsonb_build_object('action', 'append', 'value', v_notes || E'\n\n' || v_template_notes)
    end);
    if (v_out #>> '{notes,action}') = 'append' and char_length(v_out #>> '{notes,value}') > 8000 then
      v_blocking := v_blocking || jsonb_build_array(jsonb_build_object('code', 'notes_too_long',
        'message', 'The combined notes would be longer than 8000 characters. Replace them instead.'));
    end if;
  end if;

  -- ------------------------------------------------------------ needs
  if 'needs' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_kept := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_content -> 'needs') loop
      v_pos := (v_el ->> 'position_id')::uuid;
      select tp.team_id into v_team
        from public.team_positions tp join public.teams t on t.id = tp.team_id
       where tp.id = v_pos and tp.plan_id is null and t.organization_id = p_org;
      if v_team is null then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('position_id', v_pos, 'reason', 'position_missing'));
        continue;
      end if;
      select n.needed into v_count from public.plan_position_needs n where n.plan_id = p_plan and n.position_id = v_pos;
      if p_mode = 'append' and found then
        v_kept := v_kept || jsonb_build_array(jsonb_build_object(
          'position_id', v_pos, 'needed', v_count, 'template_needed', (v_el ->> 'needed')::int));
      else
        v_add := v_add || jsonb_build_array(jsonb_build_object('position_id', v_pos, 'needed', (v_el ->> 'needed')::int));
      end if;
    end loop;
    select count(*) into v_existing from public.plan_position_needs where plan_id = p_plan;
    v_out := v_out || jsonb_build_object('needs', jsonb_build_object(
      'add', v_add, 'kept', v_kept, 'skipped', v_skipped,
      'remove_count', case when p_mode = 'replace' then v_existing else 0 end));
  end if;

  -- ----------------------------------------------------------- roster
  if 'roster' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_existing := 0;
    for v_el in select value from jsonb_array_elements(v_content -> 'roster') loop
      v_team := (v_el ->> 'team_id')::uuid;
      v_pos := (v_el ->> 'position_id')::uuid;
      if not exists (
        select 1 from public.people p
         where p.id = (v_el ->> 'person_id')::uuid and p.organization_id = p_org and p.archived_at is null
      ) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'person_unavailable'));
      elsif not exists (select 1 from public.teams t where t.id = v_team and t.organization_id = p_org)
         or (v_pos is not null and not exists (
           select 1 from public.team_positions tp where tp.id = v_pos and tp.team_id = v_team and tp.plan_id is null)) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'position_missing'));
      elsif not private.capability_for(v_uid, p_org, 'scheduling.manage', p_service_type, v_team) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'not_permitted'));
      elsif exists (
        select 1 from public.assignments a
         where a.plan_id = p_plan and a.person_id = (v_el ->> 'person_id')::uuid
           and a.team_id = v_team and a.position_id is not distinct from v_pos
      ) then
        v_existing := v_existing + 1;
      else
        v_add := v_add || jsonb_build_array(v_el);
      end if;
    end loop;
    if p_mode = 'replace' then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'roster_appended',
        'message', 'Scheduled people are never removed by a template; roster entries are added as prepared requests.'));
    end if;
    v_out := v_out || jsonb_build_object('roster', jsonb_build_object(
      'add', v_add, 'skipped', v_skipped, 'existing_count', v_existing));
  end if;

  if p_plan is not null then
    select count(*) into v_count from public.plan_template_applications a
     where a.plan_id = p_plan and a.template_id = v_tpl.id;
    if v_count > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'already_applied', 'params', jsonb_build_object('count', v_count),
        'message', format('This template was already applied to this plan %s time(s). Applying again adds its content again.', v_count)));
    end if;
  end if;

  return v_out || jsonb_build_object('blocking', v_blocking, 'warnings', v_warnings);
end;
$$;
