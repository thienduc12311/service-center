-- F11: revisioned item edit/reorder/remove, reference validation, plan-only
-- sequence and leader fields, and copy compatibility.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f11_fx (k text primary key, id uuid) on commit drop;
grant select on f11_fx to authenticated, service_role;
insert into f11_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('grace', 'eeeeeeee-0000-4000-8000-000000000001'),
  ('grace_g', 'ffffffff-0000-4000-8000-000000000001'),
  ('holy_d', 'ffffffff-0000-4000-8000-000000000002'),
  ('leader_pos', 'dddddddd-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('other_org', gen_random_uuid()), ('other_song', gen_random_uuid()), ('other_person', gen_random_uuid()),
  ('grace_c', gen_random_uuid()),
  ('a', gen_random_uuid()), ('b', gen_random_uuid()),
  ('i1', gen_random_uuid()), ('i2', gen_random_uuid()), ('i3', gen_random_uuid()), ('legacy', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f11_fx where k = p $$;

-- Another organization with its own song and Person (cross-organization refs).
insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'F11 Other', 'f11-other-' || substr(md5(random()::text), 1, 6));
insert into public.songs (id, organization_id, title) values (pg_temp.fx('other_song'), pg_temp.fx('other_org'), 'Elsewhere');
insert into public.people (id, organization_id, first_name) values (pg_temp.fx('other_person'), pg_temp.fx('other_org'), 'Outsider');
-- A second, non-default arrangement of Amazing Grace written in C.
insert into public.arrangements (id, song_id, name, song_key, sequence, chord_chart, is_default)
values (pg_temp.fx('grace_c'), pg_temp.fx('grace'), 'F11 in C', 'C', array['V1','C'], '[C]Amazing [F]grace', false);

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('a'), pg_temp.fx('org'), pg_temp.fx('st'), 'F11 A', '2027-03-07 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('b'), pg_temp.fx('org'), pg_temp.fx('st'), 'F11 B', '2027-03-14 15:00+00', 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.plan_items (id, plan_id, item_type, title, song_id, arrangement_id, key_override, length_seconds, sort_order) values
  (pg_temp.fx('i1'), pg_temp.fx('a'), 'header', 'Worship', null, null, null, 0, 0),
  (pg_temp.fx('i2'), pg_temp.fx('a'), 'song', 'Amazing Grace', pg_temp.fx('grace'), pg_temp.fx('grace_c'), 'D', 300, 1),
  (pg_temp.fx('i3'), pg_temp.fx('a'), 'item', 'Welcome', null, null, null, 120, 2);

-- Legacy row written before validation existed: another song's arrangement.
alter table public.plan_items disable trigger plan_items_validate_refs;
insert into public.plan_items (id, plan_id, item_type, title, song_id, arrangement_id, sort_order) values
  (pg_temp.fx('legacy'), pg_temp.fx('b'), 'song', 'Legacy', pg_temp.fx('grace'), pg_temp.fx('holy_d'), 0);
alter table public.plan_items enable trigger plan_items_validate_refs;

-- Reference validation (as the database owner: the trigger, not RLS).
do $$ begin
  begin
    update public.plan_items set arrangement_id = pg_temp.fx('holy_d') where id = pg_temp.fx('i2');
    raise exception 'FAIL: arrangement of another song accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.plan_items set song_id = pg_temp.fx('other_song'), arrangement_id = null where id = pg_temp.fx('i2');
    raise exception 'FAIL: song from another organization accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.plan_items set leader_person_id = pg_temp.fx('other_person') where id = pg_temp.fx('i3');
    raise exception 'FAIL: leader from another organization accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.plan_items set leader_person_id = pg_temp.fx('sam'), leader_position_id = pg_temp.fx('leader_pos') where id = pg_temp.fx('i3');
    raise exception 'FAIL: two leaders accepted';
  exception when check_violation then null; end;
  begin
    update public.plan_items set sequence_override = array['V1'] where id = pg_temp.fx('i3');
    raise exception 'FAIL: sequence on a non-song item accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.plan_items set sequence_override = array['V1', ''] where id = pg_temp.fx('i2');
    raise exception 'FAIL: blank sequence step accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.plan_items set service_segment = 'later' where id = pg_temp.fx('i3');
    raise exception 'FAIL: unknown segment accepted';
  exception when check_violation then null; end;
  -- The legacy row stays editable for fields that do not touch its references.
  update public.plan_items set title = 'Legacy renamed' where id = pg_temp.fx('legacy');
end $$;

set local role authenticated;

-- A member cannot edit, reorder or remove.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i3'), '{"title":"x"}', null);
    raise exception 'FAIL: member edited an item';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.reorder_plan_items(pg_temp.fx('a'), array[pg_temp.fx('i3'), pg_temp.fx('i2'), pg_temp.fx('i1')], null);
    raise exception 'FAIL: member reordered';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.delete_plan_item(pg_temp.fx('a'), pg_temp.fx('i3'), null);
    raise exception 'FAIL: member removed an item';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- The scheduler (plans.edit) edits with the revision they read.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_rev bigint;
  v_result jsonb;
  v_item public.plan_items;
  v_lib public.arrangements;
begin
  select content_revision into v_rev from public.plans where id = pg_temp.fx('a');

  v_result := public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i2'),
    jsonb_build_object('key_override', 'E', 'sequence_override', jsonb_build_array('V1', 'C', 'C'),
                       'length_seconds', 330, 'description', 'Big ending', 'leader_position_id', pg_temp.fx('leader_pos')),
    v_rev);
  select * into v_item from public.plan_items where id = pg_temp.fx('i2');
  if v_item.key_override <> 'E' or v_item.sequence_override <> array['V1','C','C'] or v_item.length_seconds <> 330
     or v_item.description <> 'Big ending' or v_item.leader_position_id <> pg_temp.fx('leader_pos')
     or v_item.sort_order <> 1 or v_item.title <> 'Amazing Grace' then
    raise exception 'FAIL: edit did not persist on the same item: %', to_jsonb(v_item);
  end if;
  if (v_result ->> 'content_revision')::bigint <= v_rev then
    raise exception 'FAIL: revision did not advance';
  end if;
  -- The library arrangement is untouched.
  select * into v_lib from public.arrangements where id = pg_temp.fx('grace_c');
  if v_lib.song_key <> 'C' or v_lib.sequence <> array['V1','C'] then
    raise exception 'FAIL: library arrangement changed';
  end if;

  -- A stale revision is refused with plan_changed and changes nothing.
  begin
    perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i2'), '{"key_override":"F"}', v_rev);
    raise exception 'FAIL: stale edit accepted';
  exception when sqlstate 'PT409' then
    declare v_hint text; begin
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'plan_changed' then raise exception 'FAIL: wrong hint %', v_hint; end if;
    end;
  end;
  if (select key_override from public.plan_items where id = pg_temp.fx('i2')) <> 'E' then
    raise exception 'FAIL: stale edit wrote';
  end if;

  -- An invalid arrangement through the RPC is refused.
  begin
    perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i2'),
      jsonb_build_object('arrangement_id', pg_temp.fx('holy_d')), null);
    raise exception 'FAIL: invalid arrangement accepted through RPC';
  exception when sqlstate '22023' then null; end;

  -- Clearing the override inherits the arrangement's sequence again.
  perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i2'), '{"sequence_override":null}', null);
  if (select sequence_override from public.plan_items where id = pg_temp.fx('i2')) is not null then
    raise exception 'FAIL: sequence override not cleared';
  end if;

  -- Cross-plan: an item id from plan B through plan A is not found.
  begin
    perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('legacy'), '{"title":"x"}', null);
    raise exception 'FAIL: cross-plan item edited';
  exception when sqlstate 'P0002' then null; end;

  -- Reorder: atomic, revisioned, every id once.
  select content_revision into v_rev from public.plans where id = pg_temp.fx('a');
  begin
    perform public.reorder_plan_items(pg_temp.fx('a'), array[pg_temp.fx('i3'), pg_temp.fx('i1')], v_rev);
    raise exception 'FAIL: partial reorder accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.reorder_plan_items(pg_temp.fx('a'), array[pg_temp.fx('i3'), pg_temp.fx('i1'), pg_temp.fx('legacy')], v_rev);
    raise exception 'FAIL: foreign item in reorder accepted';
  exception when sqlstate '22023' then null; end;
  v_result := public.reorder_plan_items(pg_temp.fx('a'), array[pg_temp.fx('i3'), pg_temp.fx('i1'), pg_temp.fx('i2')], v_rev);
  if (select array_agg(id order by sort_order) from public.plan_items where plan_id = pg_temp.fx('a'))
     <> array[pg_temp.fx('i3'), pg_temp.fx('i1'), pg_temp.fx('i2')] then
    raise exception 'FAIL: reorder not applied';
  end if;
  begin
    perform public.reorder_plan_items(pg_temp.fx('a'), array[pg_temp.fx('i1'), pg_temp.fx('i2'), pg_temp.fx('i3')], v_rev);
    raise exception 'FAIL: stale reorder accepted';
  exception when sqlstate 'PT409' then null; end;

  -- Remove with the current revision; a stale remove is refused.
  begin
    perform public.delete_plan_item(pg_temp.fx('a'), pg_temp.fx('i1'), v_rev);
    raise exception 'FAIL: stale remove accepted';
  exception when sqlstate 'PT409' then null; end;
  perform public.delete_plan_item(pg_temp.fx('a'), pg_temp.fx('i1'), (v_result ->> 'content_revision')::bigint);
  if exists (select 1 from public.plan_items where id = pg_temp.fx('i1')) then
    raise exception 'FAIL: remove did not delete';
  end if;

  -- Set fields that must survive a copy, then import A's order into B.
  perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i2'),
    jsonb_build_object('sequence_override', jsonb_build_array('C'), 'service_segment', 'service'), null);
  perform public.update_plan_item(pg_temp.fx('a'), pg_temp.fx('i3'),
    jsonb_build_object('leader_person_id', pg_temp.fx('sam'), 'service_segment', 'pre'), null);
end $$;

reset role;
-- Copy carries the F11 fields and repairs a legacy mismatched arrangement.
do $$ begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  set local role authenticated;
  perform private.copy_plan_children(pg_temp.fx('a'), pg_temp.fx('b'), true, false, false, null);
  perform private.copy_plan_children(pg_temp.fx('b'), pg_temp.fx('a'), true, false, false, null);
  reset role;
  if not exists (select 1 from public.plan_items where plan_id = pg_temp.fx('b') and title = 'Amazing Grace'
                  and sequence_override = array['C'] and key_override = 'E' and arrangement_id = pg_temp.fx('grace_c')) then
    raise exception 'FAIL: copy dropped sequence/key/arrangement';
  end if;
  if not exists (select 1 from public.plan_items where plan_id = pg_temp.fx('b') and title = 'Welcome'
                  and leader_person_id = pg_temp.fx('sam') and service_segment = 'pre') then
    raise exception 'FAIL: copy dropped leader/segment';
  end if;
  if not exists (select 1 from public.plan_items where plan_id = pg_temp.fx('a') and title = 'Legacy renamed' and arrangement_id is null) then
    raise exception 'FAIL: legacy mismatched arrangement was not cleared on copy';
  end if;
end $$;

select 'f11-order-editing: all checks passed' as result;
rollback;
