-- W8-RES-D3: keyed note create is idempotent. Everything rolls back.
--   (apply 20261127000200_w8_note_idempotency.sql first)
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-notes-idempotency.sql
begin;

create temporary table w8_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w8_fx to authenticated, service_role;

insert into w8_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('production', 'cccccccc-0000-4000-8000-000000000002'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam_u', '33333333-3333-4333-8333-333333333333'),
  ('plan', gen_random_uuid()), ('item', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w8_fx where k = p $$;

create or replace function pg_temp.check(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W8 notes idempotency check failed: %', message; end if;
end $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'W8 plan', now() + interval '600 days', 'published', pg_temp.fx('jordan'));
insert into public.plan_items (id, plan_id, item_type, title, sort_order)
values (pg_temp.fx('item'), pg_temp.fx('plan'), 'item', 'Welcome', 0);

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- First keyed create: 201-equivalent, not replayed.
create temporary table w8_r (k text primary key, r jsonb) on commit drop;
grant all on w8_r to authenticated;
insert into w8_r select 'first', public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Doors at 8', null, 'draft-key-0001');
select pg_temp.check((select r ->> 'replayed' from w8_r where k = 'first') = 'false', 'first create is not a replay');

-- Same key, same body (whitespace trimmed): the original note, no second row.
insert into w8_r select 'again', public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, '  Doors at 8  ', null, 'draft-key-0001');
select pg_temp.check((select r ->> 'replayed' from w8_r where k = 'again') = 'true', 'retry is a replay');
select pg_temp.check((select r -> 'note' ->> 'id' from w8_r where k = 'again') = (select r -> 'note' ->> 'id' from w8_r where k = 'first'),
  'retry returns the original note');
select pg_temp.check((select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan') and body = 'Doors at 8') = 1,
  'exactly one note exists after the retry');

-- Same key, different body or different shape: refused with the stable hint.
do $$ declare v_hint text; begin
  begin
    perform public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Doors at 9', null, 'draft-key-0001');
    raise exception 'expected the reused key to be refused';
  exception when sqlstate 'PT409' then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  perform pg_temp.check(v_hint = 'idempotency_key_reused', 'different body: idempotency_key_reused');
  begin
    perform public.save_plan_note(pg_temp.fx('plan'), null, pg_temp.fx('item'), null, 'organization', null, 'Doors at 8', null, 'draft-key-0001');
    raise exception 'expected the reused key to be refused';
  exception when sqlstate 'PT409' then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  perform pg_temp.check(v_hint = 'idempotency_key_reused', 'different item: idempotency_key_reused');
end $$;

-- Item notes and team notes are keyed the same way; team order does not matter.
insert into w8_r select 'item', public.save_plan_note(pg_temp.fx('plan'), null, pg_temp.fx('item'), null, 'organization', null, 'Item cue', null, 'item-key-0001');
insert into w8_r select 'item2', public.save_plan_note(pg_temp.fx('plan'), null, pg_temp.fx('item'), null, 'organization', null, 'Item cue', null, 'item-key-0001');
select pg_temp.check((select r -> 'note' ->> 'id' from w8_r where k = 'item') = (select r -> 'note' ->> 'id' from w8_r where k = 'item2'), 'item note replays');
insert into w8_r select 'team', public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'teams', array[pg_temp.fx('band'), pg_temp.fx('production')], 'Teams cue', null, 'team-key-0001');
insert into w8_r select 'team2', public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'teams', array[pg_temp.fx('production'), pg_temp.fx('band')], 'Teams cue', null, 'team-key-0001');
select pg_temp.check((select r ->> 'replayed' from w8_r where k = 'team2') = 'true', 'team order does not change the request');
select pg_temp.check((select count(*) from public.plan_note_teams where note_id = (select (r -> 'note' ->> 'id')::uuid from w8_r where k = 'team')) = 2,
  'team note keeps its two teams once');

-- Unkeyed creates are never deduplicated.
select public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Same words', null);
select public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Same words', null);
select pg_temp.check((select count(*) from public.plan_notes where plan_id = pg_temp.fx('plan') and body = 'Same words') = 2,
  'unkeyed creates stay independent');

-- Too-short keys cannot be stored.
do $$ begin
  begin
    perform public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Short key', null, 'abc');
    raise exception 'expected the short key to be refused';
  exception when check_violation then null;
  end;
end $$;

-- The key is scoped to its author: another editor's identical key is a new create.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into w8_r select 'owner', public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Doors at 8', null, 'draft-key-0001');
select pg_temp.check((select r ->> 'replayed' from w8_r where k = 'owner') = 'false', 'another author with the same key creates their own note');
select pg_temp.check((select r -> 'note' ->> 'id' from w8_r where k = 'owner') <> (select r -> 'note' ->> 'id' from w8_r where k = 'first'),
  'the two authors have separate notes');

-- A caller who cannot edit the plan learns nothing, key or not.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.save_plan_note(pg_temp.fx('plan'), null, null, null, 'organization', null, 'Doors at 8', null, 'draft-key-0001');
    raise exception 'expected a non-editor to be refused';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

rollback;
