-- W10-CD-D1 follow-up: time edits and reschedules now refuse a double-booking
-- unless the caller may override conflicts and gives a reason
-- (20261201000202). The reschedule preview's English fallback still said
-- overlaps "are not refused"; restate it. Only the comment and the fallback
-- message change; clients render the structured code with their own strings.
CREATE OR REPLACE FUNCTION private.plan_shift_preview(p_org uuid, p_moves jsonb, p_reset boolean, p_notify boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
    -- Time edits refuse a double-booking unless overridden (W10-CD-D1);
    -- overlaps are previewed here. Plans moved in the same batch are
    -- compared at their current times.
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
        'message', format('%s person/plan overlap(s) at the new time; saving is refused unless you may override conflicts and give a reason.', jsonb_array_length(v_conflicts))));
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
$function$

;
