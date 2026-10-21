-- F11: keyed, atomic item create (`add_plan_item`). Same key returns the
-- first item, a different key adds a new one, a reused key with another body
-- is refused, a member is refused, and references are still validated.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f11c_fx (k text primary key, id uuid) on commit drop;
grant select on f11c_fx to authenticated, service_role;
insert into f11c_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('grace', 'eeeeeeee-0000-4000-8000-000000000001'),
  ('holy_d', 'ffffffff-0000-4000-8000-000000000002'),
  ('plan', gen_random_uuid()), ('first', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f11c_fx where k = p $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'F11 keyed add', '2027-05-02 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.plan_items (id, plan_id, item_type, title, length_seconds, sort_order) values
  (pg_temp.fx('first'), pg_temp.fx('plan'), 'item', 'Welcome', 60, 0);

set local role authenticated;

-- A member cannot add, keyed or not, and leaves no key behind.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"x"}', 'member-key-0001');
    raise exception 'FAIL: member added an item';
  exception when sqlstate 'P0002' then null; end;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_first jsonb;
  v_again jsonb;
  v_other jsonb;
  v_song jsonb;
  v_unkeyed jsonb;
begin
  v_first := public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"Prayer","length_seconds":120}', 'f11-key-000001');
  if (v_first -> 'item' ->> 'sort_order')::int <> 1 or (v_first ->> 'replayed')::boolean then
    raise exception 'FAIL: first add not appended: %', v_first;
  end if;

  -- Same key and body: the same item, not a second one.
  v_again := public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"Prayer","length_seconds":120}', 'f11-key-000001');
  if v_again -> 'item' ->> 'id' <> v_first -> 'item' ->> 'id' or not (v_again ->> 'replayed')::boolean then
    raise exception 'FAIL: retry with same key did not replay: %', v_again;
  end if;
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('plan') and title = 'Prayer') <> 1 then
    raise exception 'FAIL: retry added a duplicate';
  end if;

  -- Same key, different body: refused, nothing written.
  begin
    perform public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"Offering"}', 'f11-key-000001');
    raise exception 'FAIL: reused key with another body accepted';
  exception when sqlstate 'PT409' then
    declare v_hint text; begin
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'idempotency_key_reused' then raise exception 'FAIL: wrong hint %', v_hint; end if;
    end;
  end;

  -- A different key is a new item, appended after the first.
  v_other := public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"Prayer","length_seconds":120}', 'f11-key-000002');
  if v_other -> 'item' ->> 'id' = v_first -> 'item' ->> 'id' or (v_other -> 'item' ->> 'sort_order')::int <> 2 then
    raise exception 'FAIL: different key did not add a new item: %', v_other;
  end if;

  -- A song without a title takes the song's; unkeyed adds still work.
  v_song := public.add_plan_item(pg_temp.fx('plan'),
    jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('grace'), 'key_override', 'D'), 'f11-key-000003');
  if v_song -> 'item' ->> 'title' <> 'Amazing Grace' or (v_song -> 'item' ->> 'sort_order')::int <> 3 then
    raise exception 'FAIL: song add: %', v_song;
  end if;
  v_unkeyed := public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"header","title":"Response"}', null);
  if (v_unkeyed -> 'item' ->> 'sort_order')::int <> 4 then
    raise exception 'FAIL: unkeyed add: %', v_unkeyed;
  end if;
  if (v_unkeyed ->> 'content_revision')::bigint <= (v_first ->> 'content_revision')::bigint then
    raise exception 'FAIL: revision did not advance';
  end if;

  -- plan_items_validate_refs still applies: another song's arrangement.
  begin
    perform public.add_plan_item(pg_temp.fx('plan'),
      jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('grace'), 'arrangement_id', pg_temp.fx('holy_d')), 'f11-key-000004');
    raise exception 'FAIL: invalid arrangement accepted';
  exception when sqlstate '22023' then null; end;

  -- Once the keyed item is removed, a replay reports it gone instead of re-adding.
  perform public.delete_plan_item(pg_temp.fx('plan'), (v_first -> 'item' ->> 'id')::uuid, null);
  begin
    perform public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"Prayer","length_seconds":120}', 'f11-key-000001');
    raise exception 'FAIL: replay after removal re-added';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- Keys are per caller: another editor's same key is their own new item, and
-- the first editor's key record is not visible to them.
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare v_mine jsonb;
begin
  if exists (select 1 from public.plan_item_create_operations where plan_id = pg_temp.fx('plan')) then
    raise exception 'FAIL: another caller''s keys are visible';
  end if;
  v_mine := public.add_plan_item(pg_temp.fx('plan'), '{"item_type":"item","title":"Offering"}', 'f11-key-000002');
  if (v_mine ->> 'replayed')::boolean then
    raise exception 'FAIL: key shared across callers';
  end if;
end $$;

-- Direct writes to the key ledger are not allowed.
do $$ begin
  begin
    update public.plan_item_create_operations set item_id = null;
    raise exception 'FAIL: key ledger updated directly';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'PASS: f11 idempotent item create';
rollback;
