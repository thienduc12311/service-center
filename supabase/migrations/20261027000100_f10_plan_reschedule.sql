-- ============================================================================
-- F10 Pass C — deliberate bulk rescheduling.
--
-- Two modes, never mixed:
--   shift       move whole plans (service date and every time) to new local
--               dates. Wall-clock times are kept in the organization's IANA
--               timezone; the API resolves instants, this file re-verifies
--               them. Each plan goes through F04's apply_plan_time_changes
--               with the same time ids, so live request links go stale, ICS
--               sequences bump, reminders are recomputed and (if chosen)
--               released people are asked again. Answers stay as they are
--               unless the scheduler explicitly chooses reset_responses:
--               then released confirmed/declined requests become unconfirmed,
--               recorded in assignment_responses with the scheduler as actor.
--   order_only  move one plan's order items into another plan, keeping both
--               rosters, times, answers, reminders and feeds untouched. It
--               never resets anything; reset_responses is refused.
--
-- Contract
--   preview_plan_reschedule  writes nothing; per plan: times old → new,
--                            People by answer, which answers would reset,
--                            stale links, re-sent requests, recalculated
--                            reminder jobs, calendar-feed entries that move,
--                            queued deliveries, warnings; plus a hash.
--   reschedule_plans         one transaction for ≤ 12 plans: sorted plan
--                            locks, the same preview recomputed and compared
--                            to the hash (PT409 template_preview_changed),
--                            then applied. A repeated idempotency key returns
--                            the first result; a different request with the
--                            same key is refused.
-- No template linkage, grant or Person copying happens here.
-- ============================================================================

create table public.plan_reschedule_operations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash     text not null,
  mode             text not null check (mode in ('shift', 'order_only')),
  plan_ids         uuid[] not null,
  reset_responses  boolean not null default false,
  result           jsonb not null default '{}'::jsonb,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint plan_reschedule_operations_key_unique unique (organization_id, idempotency_key),
  constraint plan_reschedule_operations_reset_shift check (not reset_responses or mode = 'shift')
);
create index plan_reschedule_operations_created_by_idx on public.plan_reschedule_operations (created_by);

alter table public.plan_reschedule_operations enable row level security;
create policy plan_reschedule_operations_select on public.plan_reschedule_operations
  for select to authenticated using ((select public.can_manage_org(organization_id)));
create policy plan_reschedule_operations_insert on public.plan_reschedule_operations
  for insert to authenticated
  with check (
    (select public.has_capability_anywhere(organization_id, 'plans.edit'))
    and created_by = (select auth.uid())
  );
revoke update, delete, truncate on public.plan_reschedule_operations from anon, authenticated;

-- ------------------------------------------------------------- previews ----

-- p_moves: [{plan_id, new_local_date, service_date, times:[{id, starts_at, ends_at}]}]
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
        'message', format('Another %s plan is already on %s.', coalesce((select name from public.service_types where id = v_plan.service_type_id), ''), v_new_date)));
    end if;
    select count(*) into v_count from jsonb_array_elements(v_people) p
     where p ->> 'visibility' = 'released' and p ->> 'status' = 'confirmed';
    if v_count > 0 and not p_reset then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'confirmed_kept',
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
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'conflicts',
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

-- p_order: {source_plan_id, destination_plan_id, items_mode 'append'|'replace', remove_from_source}
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
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed',
        'message', format('%s moved item(s) have notes or comments; those stay with the old items and are removed.', v_count)));
    end if;
  end if;
  if v_mode = 'replace' then
    select count(distinct x.plan_item_id) into v_count from (
      select c.plan_item_id from public.plan_item_comments c where c.plan_id = v_dest.id
      union all select n.plan_item_id from public.plan_notes n where n.plan_id = v_dest.id and n.plan_item_id is not null) x;
    if v_count > 0 then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed',
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

create or replace function private.plan_reschedule_preview(
  p_org uuid, p_mode text, p_moves jsonb, p_order jsonb, p_reset boolean, p_notify boolean
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.capability_anywhere((select auth.uid()), p_org, 'plans.edit') then
    raise exception 'Only a plan editor can reschedule plans' using errcode = '42501';
  end if;
  if p_mode = 'shift' then
    return private.plan_shift_preview(p_org, p_moves, coalesce(p_reset, false), coalesce(p_notify, true));
  elsif p_mode = 'order_only' then
    if coalesce(p_reset, false) then
      perform private.f10_bad('Moving only the order never resets answers');
    end if;
    return private.plan_order_move_preview(p_org, p_order);
  end if;
  perform private.f10_bad('Choose shift or order_only');
  return null;
end;
$$;

create or replace function public.preview_plan_reschedule(
  p_organization_id uuid,
  p_mode            text,
  p_moves           jsonb default null,
  p_order           jsonb default null,
  p_reset_responses boolean default false,
  p_notify          boolean default true
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_preview jsonb := private.plan_reschedule_preview(
    p_organization_id, p_mode, p_moves, p_order, p_reset_responses, p_notify);
begin
  return v_preview || jsonb_build_object('preview_hash', md5(v_preview::text));
end;
$$;

-- ---------------------------------------------------------------- commit ---

create or replace function public.reschedule_plans(
  p_organization_id          uuid,
  p_mode                     text,
  p_preview_hash             text,
  p_idempotency_key          text,
  p_moves                    jsonb default null,
  p_order                    jsonb default null,
  p_reset_responses          boolean default false,
  p_notify                   boolean default true,
  p_conflict_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_request  text;
  v_existing public.plan_reschedule_operations;
  v_preview  jsonb;
  v_row      jsonb;
  v_ids      uuid[];
  v_op       uuid := gen_random_uuid();
  v_change   jsonb;
  v_effects  uuid[] := '{}';
  v_reset    int := 0;
  v_n        int;
  v_result   jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    perform private.f10_bad('A request key of 8 to 200 characters is required');
  end if;
  v_request := md5(jsonb_build_object(
    'mode', p_mode, 'moves', p_moves, 'order', p_order,
    'reset', coalesce(p_reset_responses, false), 'notify', coalesce(p_notify, true))::text);
  perform pg_advisory_xact_lock(hashtextextended('f10:' || p_organization_id || ':' || p_idempotency_key, 0));
  select * into v_existing from public.plan_reschedule_operations
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request then
      raise exception 'That request key was used for a different change' using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return v_existing.result || jsonb_build_object('operation_id', v_existing.id, 'replayed', true);
  end if;

  -- Sorted plan locks: two overlapping reschedules cannot deadlock.
  if p_mode = 'shift' then
    select array_agg(distinct (m ->> 'plan_id')::uuid order by (m ->> 'plan_id')::uuid) into v_ids
      from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m;
  else
    select array_agg(x order by x) into v_ids from unnest(array[
      (p_order ->> 'source_plan_id')::uuid, (p_order ->> 'destination_plan_id')::uuid]) x;
  end if;
  perform 1 from public.plans where id = any(coalesce(v_ids, '{}')) and organization_id = p_organization_id
   order by id for update;

  -- The hash exists only because this review once succeeded, so a review
  -- that no longer validates means the plans changed: stale, not invalid.
  begin
    v_preview := private.plan_reschedule_preview(
      p_organization_id, p_mode, p_moves, p_order, p_reset_responses, p_notify);
  exception when invalid_parameter_value then
    raise exception 'The plans changed since you reviewed them. Review again.'
      using errcode = 'PT409', hint = 'template_preview_changed';
  end;
  if p_preview_hash is null or p_preview_hash <> md5(v_preview::text) then
    raise exception 'The plans changed since you reviewed them. Review again.'
      using errcode = 'PT409', hint = 'template_preview_changed';
  end if;

  if p_mode = 'shift' then
    for v_row in select value from jsonb_array_elements(v_preview -> 'plans') loop
      if p_reset_responses then
        -- An explicit, audited reset: history records the scheduler as actor.
        perform set_config('app.assignment_response_note', 'Reset because the plan was rescheduled', true);
        update public.assignments
           set status = 'unconfirmed'
         where plan_id = (v_row ->> 'plan_id')::uuid and visibility = 'released' and status <> 'unconfirmed';
        get diagnostics v_n = row_count;
        v_reset := v_reset + v_n;
        perform set_config('app.assignment_response_note', '', true);
      end if;
      update public.plans set service_date = (v_row ->> 'service_date')::timestamptz
       where id = (v_row ->> 'plan_id')::uuid;
      perform set_config('f04.conflict_override_reason', coalesce(p_conflict_override_reason, ''), true);
      v_change := public.apply_plan_time_changes(
        (v_row ->> 'plan_id')::uuid,
        coalesce((select jsonb_agg(jsonb_build_object(
                    'id', t ->> 'id', 'kind', t ->> 'kind', 'name', t ->> 'name', 'sort_order', (t ->> 'sort_order')::int,
                    'starts_at', t ->> 'starts_at', 'ends_at', t ->> 'ends_at'))
                    from jsonb_array_elements(v_row -> 'times') t), '[]'::jsonb),
        null, null, '[]'::jsonb, coalesce(p_notify, true),
        'reschedule:' || v_op || ':' || (v_row ->> 'plan_id'));
      perform set_config('f04.conflict_override_reason', '', true);
      if (v_change ->> 'effect_id') is not null then
        v_effects := v_effects || (v_change ->> 'effect_id')::uuid;
      end if;
    end loop;
    v_result := jsonb_build_object('mode', 'shift', 'plan_ids', to_jsonb(v_ids),
                                   'responses_reset', v_reset, 'effect_ids', to_jsonb(v_effects));
  else
    if (v_preview ->> 'items_mode') = 'replace' then
      delete from public.plan_items where plan_id = (v_preview #>> '{destination,plan_id}')::uuid;
    end if;
    perform private.copy_plan_children(
      (v_preview #>> '{source,plan_id}')::uuid, (v_preview #>> '{destination,plan_id}')::uuid,
      true, false, false, null);
    if (v_preview ->> 'remove_from_source')::boolean then
      delete from public.plan_items where plan_id = (v_preview #>> '{source,plan_id}')::uuid;
    end if;
    v_result := jsonb_build_object('mode', 'order_only', 'plan_ids', to_jsonb(v_ids),
                                   'responses_reset', 0, 'effect_ids', '[]'::jsonb);
  end if;

  insert into public.plan_reschedule_operations (
    id, organization_id, idempotency_key, request_hash, mode, plan_ids, reset_responses, result, created_by
  ) values (
    v_op, p_organization_id, p_idempotency_key, v_request, p_mode, v_ids,
    coalesce(p_reset_responses, false), v_result, v_uid
  );
  return v_result || jsonb_build_object('operation_id', v_op, 'replayed', false);
end;
$$;

revoke execute on function private.plan_shift_preview(uuid, jsonb, boolean, boolean) from public, anon;
revoke execute on function private.plan_order_move_preview(uuid, jsonb) from public, anon;
revoke execute on function private.plan_reschedule_preview(uuid, text, jsonb, jsonb, boolean, boolean) from public, anon;
grant execute on function private.plan_shift_preview(uuid, jsonb, boolean, boolean) to authenticated;
grant execute on function private.plan_order_move_preview(uuid, jsonb) to authenticated;
grant execute on function private.plan_reschedule_preview(uuid, text, jsonb, jsonb, boolean, boolean) to authenticated;
revoke execute on function public.preview_plan_reschedule(uuid, text, jsonb, jsonb, boolean, boolean) from public, anon;
revoke execute on function public.reschedule_plans(uuid, text, text, text, jsonb, jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.preview_plan_reschedule(uuid, text, jsonb, jsonb, boolean, boolean) to authenticated;
grant execute on function public.reschedule_plans(uuid, text, text, text, jsonb, jsonb, boolean, boolean, text) to authenticated;
