-- F00 Pass C: duplicate / create-from / import run as one transaction with an
-- idempotency key; a failing child row leaves nothing behind; wrong-org
-- sources are refused; a stale destination revision is refused.
--
-- Run against a seeded local database:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/atomic-plan-copy.sql
-- Everything runs inside one transaction and is rolled back.
begin;

-- Source: a seeded plan that has items, times and assignments; give it a
-- need and mark its answers so the reset is visible.
create temporary table fixture on commit drop as
select p.id as source_id, p.service_date as source_date
  from public.plans p
 where p.organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
   and exists (select 1 from public.plan_items i where i.plan_id = p.id)
   and exists (select 1 from public.plan_times t where t.plan_id = p.id)
   and exists (select 1 from public.assignments a where a.plan_id = p.id)
 order by p.service_date
 limit 1;
grant select on fixture to authenticated;

insert into public.plan_position_needs (plan_id, position_id, needed)
select source_id, 'dddddddd-0000-4000-8000-000000000003', 2 from fixture
on conflict (plan_id, position_id) do update set needed = 2;
update public.assignments set status = 'confirmed', responded_at = now(), notified_at = now()
 where plan_id = (select source_id from fixture);

-- Another organization's plan.
insert into public.organizations (id, name, slug, timezone)
values ('aaaaaaaa-0000-4000-8000-0000000000f1', 'Elsewhere', 'elsewhere-copy-test', 'UTC');
insert into public.plans (id, organization_id, title, service_date)
values ('eeeeeeee-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-0000000000f1', 'Foreign', now());
insert into public.organization_members (organization_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-0000000000f1', '22222222-2222-4222-8222-222222222222', 'scheduler');

-- A trigger that fails one specific copied child row on demand.
create function public.test_fail_copied_item() returns trigger language plpgsql as $$
begin
  if new.title = 'FORCE COPY FAILURE' then
    raise exception 'forced child-row failure';
  end if;
  return new;
end $$;
create trigger test_fail_copied_item before insert on public.plan_items
  for each row execute function public.test_fail_copied_item();

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare
  v_source  uuid := (select source_id from fixture);
  v_new     uuid;
  v_again   uuid;
  v_plans   int;
  v_offset  interval := interval '7 days';
begin
  v_new := public.duplicate_plan(v_source, (select source_date from fixture) + v_offset, 'Copied plan', true, 'dup-key-0001');
  v_again := public.duplicate_plan(v_source, (select source_date from fixture) + v_offset, 'Copied plan', true, 'dup-key-0001');
  if v_new <> v_again then raise exception 'the same key produced a second plan'; end if;
  if (select count(*) from public.plans where title = 'Copied plan') <> 1 then
    raise exception 'idempotent duplicate created more than one plan';
  end if;

  if (select count(*) from public.plan_items where plan_id = v_new)
     <> (select count(*) from public.plan_items where plan_id = v_source) then
    raise exception 'items not copied';
  end if;
  if exists (
    select 1 from public.plan_times s
     where s.plan_id = v_source
       and not exists (select 1 from public.plan_times t
                        where t.plan_id = v_new and t.kind = s.kind
                          and t.starts_at = s.starts_at + v_offset and t.ends_at = s.ends_at + v_offset)
  ) then
    raise exception 'times not shifted by the date delta';
  end if;
  if not exists (select 1 from public.plan_position_needs where plan_id = v_new
                  and position_id = 'dddddddd-0000-4000-8000-000000000003' and needed = 2) then
    raise exception 'needs not copied';
  end if;
  if (select count(*) from public.assignments where plan_id = v_new)
     <> (select count(*) from public.assignments where plan_id = v_source) then
    raise exception 'team not copied';
  end if;
  if exists (select 1 from public.assignments where plan_id = v_new
              and (status <> 'unconfirmed' or responded_at is not null or notified_at is not null)) then
    raise exception 'copied staffing kept answers or delivery bookkeeping';
  end if;
  if exists (select 1 from public.delivery_effects where plan_id = v_new) then
    raise exception 'copying sent notifications';
  end if;
  -- Source history is untouched.
  if exists (select 1 from public.assignments where plan_id = v_source and status <> 'confirmed') then
    raise exception 'the source plan changed';
  end if;

  -- Forced child-row failure: nothing of the new plan survives.
  select count(*) into v_plans from public.plans;
  update public.plan_items set title = 'FORCE COPY FAILURE'
   where id = (select id from public.plan_items where plan_id = v_source order by sort_order desc limit 1);
  begin
    perform public.duplicate_plan(v_source, now(), 'Should not exist', true, 'dup-key-0002');
    raise exception 'the forced failure did not fail';
  exception when raise_exception then
    if sqlerrm <> 'forced child-row failure' then raise; end if;
  end;
  if (select count(*) from public.plans) <> v_plans
     or exists (select 1 from public.plans where title = 'Should not exist')
     or exists (select 1 from public.plan_copy_operations where idempotency_key = 'dup-key-0002') then
    raise exception 'a failed duplicate left a partial plan behind';
  end if;

  -- The same failure in create-from-copy rolls back the plan and its times.
  begin
    perform public.create_plan('aaaaaaaa-0000-4000-8000-000000000001',
      '{"title":"Created copy","service_date":"2027-01-03T10:00:00Z"}',
      '[{"kind":"service","starts_at":"2027-01-03T10:00:00Z","ends_at":"2027-01-03T11:00:00Z"}]',
      v_source, true, 'create-key-0001');
    raise exception 'the forced failure did not fail';
  exception when raise_exception then
    if sqlerrm <> 'forced child-row failure' then raise; end if;
  end;
  if exists (select 1 from public.plans where title = 'Created copy') then
    raise exception 'a failed create left a partial plan behind';
  end if;
  update public.plan_items set title = 'Restored' where plan_id = v_source and title = 'FORCE COPY FAILURE';

  -- Source and destination in different organizations: refused as not found.
  -- (Jordan schedules in both organizations, so only the pairing is wrong.)
  -- A duplicate always stays in its source's organization.
  if (select organization_id from public.plans
       where id = public.duplicate_plan('eeeeeeee-0000-4000-8000-0000000000f1', now(), null, true, 'dup-key-0003'))
     <> 'aaaaaaaa-0000-4000-8000-0000000000f1' then
    raise exception 'a duplicate moved to another organization';
  end if;
  begin
    perform public.import_plan_contents(v_new, 'eeeeeeee-0000-4000-8000-0000000000f1', true, true, true);
    raise exception 'imported from another organization';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.create_plan('aaaaaaaa-0000-4000-8000-000000000001',
      '{"title":"Cross-org","service_date":"2027-01-03T10:00:00Z"}', '[]',
      'eeeeeeee-0000-4000-8000-0000000000f1', false, null);
    raise exception 'created a plan from another organization''s plan';
  exception when sqlstate 'P0002' then null;
  end;

  -- A key reused for a different operation is a conflict, not a silent hit.
  begin
    perform public.duplicate_plan(v_new, now(), null, true, 'dup-key-0001');
    raise exception 'a reused key for a different source was accepted';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

-- ----------------------------------------------------- import ------------
do $$
declare
  v_source uuid := (select source_id from fixture);
  v_target uuid;
  v_rev    bigint;
  v_rev2   bigint;
  v_items  int;
begin
  v_target := public.create_plan('aaaaaaaa-0000-4000-8000-000000000001',
    '{"title":"Import target","service_date":"2027-02-07T10:00:00Z"}', '[]', null, false, null);
  insert into public.plan_items (plan_id, title, sort_order) values (v_target, 'Existing welcome', 0);
  select content_revision into v_rev from public.plans where id = v_target;

  -- Someone edits the plan after it was read.
  insert into public.plan_items (plan_id, title, sort_order) values (v_target, 'Late edit', 1);
  begin
    perform public.import_plan_contents(v_target, v_source, true, true, true, v_rev, 'import-key-01');
    raise exception 'a stale revision was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  if (select count(*) from public.plan_items where plan_id = v_target) <> 2 then
    raise exception 'a refused import changed the plan';
  end if;

  select content_revision into v_rev from public.plans where id = v_target;
  v_rev2 := public.import_plan_contents(v_target, v_source, true, true, true, v_rev, 'import-key-02');
  if v_rev2 <= v_rev then raise exception 'the revision did not advance'; end if;
  select count(*) into v_items from public.plan_items where plan_id = v_target;
  if v_items <> 2 + (select count(*) from public.plan_items where plan_id = v_source) then
    raise exception 'import did not append the source order';
  end if;
  -- Appended after what was there, in source order.
  if (select min(sort_order) from public.plan_items where plan_id = v_target
       and title not in ('Existing welcome', 'Late edit')) <> 2 then
    raise exception 'imported items were not appended';
  end if;

  -- Retrying the same request (now "stale") returns the result, copies nothing.
  if public.import_plan_contents(v_target, v_source, true, true, true, v_rev, 'import-key-02') <> v_rev2
     or (select count(*) from public.plan_items where plan_id = v_target) <> v_items then
    raise exception 'an idempotent retry copied again';
  end if;
end $$;

-- A member cannot copy.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  begin
    perform public.duplicate_plan((select source_id from fixture), now(), null, true, 'dup-key-0004');
    raise exception 'a member duplicated a plan';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- Deleting a plan still cascades with the revision triggers in place.
reset role;
delete from public.plans where title = 'Copied plan';

rollback;
