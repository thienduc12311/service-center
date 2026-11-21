-- ADR-0006: publishing a plan is when the people on it are notified.
--
--   * Draft (and archived) plans are quiet: private.enqueue_assignment_requests
--     queues nothing and returns null for a plan that is not published, so
--     scheduling, releasing, attendance changes, time changes and "notify"
--     on a draft record nothing to send. Every caller already treats a null
--     effect as "nothing sent" (deliverEffectNow(null) is a no-op).
--   * A multi-plan release batch only gives published plans a section and a
--     snapshot; rows on draft plans are released silently.
--   * Reminders are only materialized for published plans, and a status
--     change recomputes the plan's reminders.
--   * public.publish_plan_notify publishes and asks everyone released, not declined
--     and never notified, plan-wide (a plan-level act, whatever teams the
--     publisher schedules). Past plans (service date in the organization's
--     time zone) publish silently. Re-publishing never re-asks.
--   * public.publish_plan_notify_preview: who would be emailed, who has no address.
--
-- The dispatcher also re-checks the plan's status at send time
-- (plan_not_published), so a plan moved back to draft stops what is queued.
-- No table changes; functions replaced from their latest definitions.

-- ============================================== assignment requests =====
-- Latest: 20261020000100_f04_assigned_times.sql. Adds the published check and
-- a second plan-level flag (publish) next to f04.plan_change_notify.
create or replace function private.enqueue_assignment_requests(
  p_plan_id uuid,
  p_template public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key text,
  p_actor uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_status public.plan_status;
  v_effect uuid;
  v_ids uuid[];
  v_recipient record;
  v_plan_change boolean := coalesce(current_setting('f04.plan_change_notify', true), '') = 'on'
                        or coalesce(current_setting('app.publish_notify', true), '') = 'on';
begin
  if p_template not in ('assignment_request', 'assignment_reminder') then
    raise exception 'Not an assignment request template' using errcode = '22023';
  end if;
  select organization_id, status into v_org, v_status from public.plans where id = p_plan_id;
  if v_org is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is not null and not v_plan_change and not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can notify this plan' using errcode = '42501';
  end if;
  -- ADR-0006: nothing is sent for a draft or archived plan. Publishing asks
  -- everyone released and not yet notified.
  if v_status <> 'published' then
    return null;
  end if;

  select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
    from public.assignments a
   where a.plan_id = p_plan_id and a.id = any(p_assignment_ids)
     and a.visibility = 'released'
     and ((select auth.uid()) is null or v_plan_change
          or private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id));

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids, created_by
  ) values (v_org, p_effect_key, p_template, p_plan_id, v_ids, p_actor)
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  for v_recipient in
    select a.person_id, p.profile_id, array_agg(a.id order by a.id) assignment_ids
      from public.assignments a
      join public.people p on p.id = a.person_id
     where a.id = any(v_ids)
     group by a.person_id, p.profile_id
  loop
    perform private.create_assignment_request_snapshot(
      v_effect, v_recipient.person_id, p_plan_id, v_recipient.assignment_ids, p_actor
    );
    insert into public.deliveries (
      organization_id, effect_id, recipient_id, recipient_person_id, channel
    ) values (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'email');
    if v_recipient.profile_id is not null then
      insert into public.deliveries (
        organization_id, effect_id, recipient_id, recipient_person_id, channel
      ) values
        (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'in_app'),
        (v_org, v_effect, v_recipient.profile_id, v_recipient.person_id, 'push');
    end if;
  end loop;
  return v_effect;
end;
$$;
revoke execute on function private.enqueue_assignment_requests(uuid, public.delivery_template, uuid[], text, uuid) from public;
grant execute on function private.enqueue_assignment_requests(uuid, public.delivery_template, uuid[], text, uuid) to authenticated, service_role;

-- ============================================ multi-plan release batch ==
-- Latest: 20261024000000_f08_release_and_reminders.sql. Only rows on
-- published plans join the effect; rows on drafts are released silently and
-- are asked when their plan is published.
create or replace function private.enqueue_release_batch_requests(p_batch uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.release_batches;
  v_effect uuid;
  v_ids uuid[];
  v_plans uuid[];
  v_recipient record;
  v_group record;
begin
  select * into v_batch from public.release_batches where id = p_batch;
  select coalesce(array_agg(a.id order by a.id), '{}'), coalesce(array_agg(distinct a.plan_id), '{}')
    into v_ids, v_plans
    from public.release_batch_items i
    join public.assignments a on a.id = i.assignment_id
    join public.plans p on p.id = a.plan_id
   where i.batch_id = p_batch and a.visibility = 'released' and p.status = 'published';
  if cardinality(v_ids) = 0 then return null; end if;

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids, created_by, release_batch_id
  ) values (
    v_batch.organization_id, 'release-batch:' || p_batch::text, 'assignment_request',
    case when cardinality(v_plans) = 1 then v_plans[1] end, v_ids, v_batch.created_by, p_batch
  )
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_batch.organization_id and effect_key = 'release-batch:' || p_batch::text;
    return v_effect;
  end if;

  for v_recipient in
    select a.person_id, p.profile_id
      from public.assignments a join public.people p on p.id = a.person_id
     where a.id = any(v_ids)
     group by a.person_id, p.profile_id
     order by a.person_id
  loop
    for v_group in
      select a.plan_id, array_agg(a.id order by a.id) ids
        from public.assignments a
       where a.id = any(v_ids) and a.person_id = v_recipient.person_id
       group by a.plan_id order by a.plan_id
    loop
      perform private.create_assignment_request_snapshot(
        v_effect, v_recipient.person_id, v_group.plan_id, v_group.ids, v_batch.created_by
      );
    end loop;
    insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
    values (v_batch.organization_id, v_effect, v_recipient.profile_id, v_recipient.person_id, 'email');
    if v_recipient.profile_id is not null then
      insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
      values (v_batch.organization_id, v_effect, v_recipient.profile_id, v_recipient.person_id, 'in_app'),
             (v_batch.organization_id, v_effect, v_recipient.profile_id, v_recipient.person_id, 'push');
    end if;
  end loop;
  return v_effect;
end;
$$;
revoke execute on function private.enqueue_release_batch_requests(uuid) from public, anon, authenticated;

-- ============================================================ reminders ==
-- Latest: 20261024000000_f08_release_and_reminders.sql. A plan that is not
-- published wants no reminders, so recompute cancels its scheduled jobs and
-- reminder_job_is_current refuses enqueued ones.
create or replace function private.desired_plan_reminders(p_plan uuid)
returns table (
  person_id uuid, kind public.reminder_kind, channel public.delivery_channel,
  policy_id uuid, policy_revision bigint, request_version text, assignment_ids uuid[],
  occurrence_time_id uuid, occurrence_starts_at timestamptz, due_at timestamptz,
  timezone text, quiet_start time, quiet_end time, max_per_day int, semantic_key text
)
language sql stable security definer set search_path = '' as $$
  with plan as (
    select p.id, p.organization_id, p.service_type_id, coalesce(o.timezone, 'UTC') tz
      from public.plans p join public.organizations o on o.id = p.organization_id
     where p.id = p_plan and p.status = 'published'
  ), eligible as (
    select a.id, a.person_id, a.team_id, a.status, a.request_revision, pe.profile_id,
           case a.status when 'unconfirmed' then 'pending_response' else 'confirmed_service' end::public.reminder_kind kind
      from public.assignments a
      join public.people pe on pe.id = a.person_id
     where a.plan_id = p_plan and a.visibility = 'released'
       and a.status in ('unconfirmed', 'confirmed')
       and pe.archived_at is null
       and (pe.profile_id is null or exists (
             select 1 from public.organization_members m
              where m.organization_id = pe.organization_id and m.user_id = pe.profile_id and m.status = 'active'))
  ), with_policy as (
    select e.*, ep.policy_id, ep.revision, ep.offset_minutes, ep.channels, ep.quiet_start, ep.quiet_end, ep.max_per_day
      from eligible e
     cross join plan
     cross join lateral private.effective_reminder_policy(plan.organization_id, plan.service_type_id, e.team_id, e.kind) ep
     where ep.enabled
  ), grouped as (
    select w.person_id, w.profile_id, w.kind, w.policy_id, w.revision, w.offset_minutes, w.channels,
           w.quiet_start, w.quiet_end, w.max_per_day,
           array_agg(w.id order by w.id) ids,
           md5(string_agg(w.id::text || ':' || w.request_revision || ':' || w.status, ',' order by w.id)) version
      from with_policy w
     group by w.person_id, w.profile_id, w.kind, w.policy_id, w.revision, w.offset_minutes, w.channels,
              w.quiet_start, w.quiet_end, w.max_per_day
  ), anchored as (
    select g.*, o.plan_time_id, o.starts_at
      from grouped g
     cross join lateral (
       select v.plan_time_id, v.starts_at
         from private.assignment_attendance v
        where v.assignment_id = any(g.ids)
        order by (g.kind = 'pending_response' and v.kind <> 'service'), v.starts_at, v.plan_time_id
        limit 1
     ) o
  ), channelled as (
    select a.*, c.channel
      from anchored a
     cross join lateral unnest(a.channels) c(channel)
     where (c.channel = 'email' or a.profile_id is not null)
       and coalesce((select case c.channel when 'email' then pr.email when 'push' then pr.push else pr.in_app end
                       from public.person_reminder_preferences pr where pr.person_id = a.person_id), true)
  )
  select c.person_id, c.kind, c.channel, c.policy_id, c.revision, c.version, c.ids,
         c.plan_time_id, c.starts_at,
         private.reminder_quiet_shift(c.starts_at - make_interval(mins => c.offset_minutes), plan.tz, c.quiet_start, c.quiet_end),
         plan.tz, c.quiet_start, c.quiet_end, c.max_per_day,
         concat_ws(':', c.kind::text, c.person_id::text, p_plan::text, c.version,
                   coalesce(c.policy_id::text, 'default') || '@' || c.revision::text,
                   coalesce(c.plan_time_id::text, 'untimed') || '@' || floor(extract(epoch from c.starts_at))::bigint::text,
                   c.channel::text)
    from channelled c cross join plan;
$$;
revoke execute on function private.desired_plan_reminders(uuid) from public, anon, authenticated;

-- Publishing, unpublishing and archiving change which reminders apply.
drop trigger if exists plans_queue_reminders on public.plans;
create trigger plans_queue_reminders
  after update of service_date, service_type_id, status on public.plans
  for each row execute function private.reminders_on_plan_change();

-- =============================================================== publish ==
-- Publishes a plan the caller may edit. When p_notify and the plan's
-- service date (organization time zone) is today or later, asks everyone
-- released, not declined and never notified, as one request per Person,
-- whatever teams the caller schedules: publishing is a plan-level act.
-- Replies still go to each request's response owner. Publishing a plan that
-- is already published changes nothing and sends nothing. The same
-- p_effect_key returns the effect the first call recorded.
create or replace function public.publish_plan_notify(p_plan uuid, p_notify boolean, p_effect_key text)
returns table (plan public.plans, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_tz text;
  v_ids uuid[];
  v_effect uuid;
begin
  if (select auth.uid()) is not null and not private.can_edit_plan((select auth.uid()), p_plan) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_effect_key is null or btrim(p_effect_key) = '' then
    raise exception 'An effect key is required' using errcode = '22023';
  end if;

  select * into v_plan from public.plans where id = p_plan for update;
  if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;

  -- A retry of a publish that already notified.
  select e.id into v_effect from public.delivery_effects e
   where e.organization_id = v_plan.organization_id and e.effect_key = p_effect_key;
  if v_effect is not null or v_plan.status = 'published' then
    plan := v_plan; effect_id := v_effect; return next; return;
  end if;

  update public.plans set status = 'published' where id = p_plan returning * into v_plan;

  select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = v_plan.organization_id;
  if coalesce(p_notify, true)
     and (v_plan.service_date at time zone v_tz)::date >= (now() at time zone v_tz)::date then
    select coalesce(array_agg(a.id order by a.id), '{}') into v_ids
      from public.assignments a
     where a.plan_id = p_plan and a.visibility = 'released'
       and a.status <> 'declined' and a.notified_at is null;
    if cardinality(v_ids) > 0 then
      perform set_config('app.publish_notify', 'on', true);
      v_effect := private.enqueue_assignment_requests(
        p_plan, 'assignment_request', v_ids, p_effect_key, (select auth.uid())
      );
      perform set_config('app.publish_notify', '', true);
    end if;
  end if;

  plan := v_plan; effect_id := v_effect; return next;
end;
$$;
revoke execute on function public.publish_plan_notify(uuid, boolean, text) from public, anon;
grant execute on function public.publish_plan_notify(uuid, boolean, text) to authenticated, service_role;

-- Who publishing would email right now, and who has no address. Inlines the
-- person_delivery_readiness address test, since a plan editor may not hold
-- the scheduling or private-people capability that function requires; only
-- names leave this function, never addresses. Nobody is counted for a plan
-- that is already published or whose service date has passed.
create or replace function public.publish_plan_notify_preview(p_plan uuid)
returns table (will_notify int, no_email text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_tz text;
begin
  if (select auth.uid()) is not null and not private.can_edit_plan((select auth.uid()), p_plan) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select * into v_plan from public.plans where id = p_plan;
  if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = v_plan.organization_id;

  if v_plan.status = 'published'
     or (v_plan.service_date at time zone v_tz)::date < (now() at time zone v_tz)::date then
    will_notify := 0; no_email := '{}'; return next; return;
  end if;

  return query
    with recipients as (
      select distinct p.id,
             nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') person_name,
             nullif(btrim(coalesce(pr.email, p.email, '')), '') is not null has_email
        from public.assignments a
        join public.people p on p.id = a.person_id
        left join public.profiles pr on pr.id = p.profile_id
       where a.plan_id = p_plan and a.visibility = 'released'
         and a.status <> 'declined' and a.notified_at is null
         and p.archived_at is null
    )
    select (count(*) filter (where r.has_email))::int,
           coalesce(array_agg(coalesce(r.person_name, 'Person') order by r.person_name)
                      filter (where not r.has_email), '{}')
      from recipients r;
end;
$$;
revoke execute on function public.publish_plan_notify_preview(uuid) from public, anon;
grant execute on function public.publish_plan_notify_preview(uuid) to authenticated, service_role;
