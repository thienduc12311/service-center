-- W7-NAT-D2 / W7-WEB-D5: plans.service_date follows the plan's earliest
-- service time, inside the same transaction as every time write (PATCH, the
-- replace_plan_times RPC, templates, generation, reschedule, duplicate).
-- Replaces the second, non-atomic write the API used to do after the RPC.
--
-- Statement-level triggers with transition tables: one extra plans update per
-- distinct plan per statement, none when the date already matches. A plan with
-- no service time keeps its date (rehearsals alone never move it). The plans
-- update touches only service_date, so content_revision (bumped by the
-- plan_times triggers) is not bumped twice and no notification is queued by
-- this function itself; reminders re-queue through the existing
-- plans_queue_reminders trigger, which is idempotent.
create or replace function private.sync_plan_service_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plans uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct plan_id) into v_plans from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct plan_id) into v_plans from old_rows;
  else
    select array_agg(distinct plan_id) into v_plans
      from (select plan_id from new_rows union select plan_id from old_rows) u;
  end if;
  if v_plans is null then return null; end if;

  update public.plans p
     set service_date = e.first_service
    from (
      select pt.plan_id, min(pt.starts_at) as first_service
        from public.plan_times pt
       where pt.plan_id = any (v_plans) and pt.kind = 'service'
       group by pt.plan_id
    ) e
   where p.id = e.plan_id
     and p.service_date is distinct from e.first_service;
  return null;
end;
$$;
revoke execute on function private.sync_plan_service_date() from public, anon, authenticated;

create trigger plan_times_sync_date_ins
  after insert on public.plan_times
  referencing new table as new_rows
  for each statement execute function private.sync_plan_service_date();
create trigger plan_times_sync_date_upd
  after update on public.plan_times
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.sync_plan_service_date();
create trigger plan_times_sync_date_del
  after delete on public.plan_times
  referencing old table as old_rows
  for each statement execute function private.sync_plan_service_date();
