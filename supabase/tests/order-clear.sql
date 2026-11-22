-- Clear the whole order (`clear_plan_items`): editors only, atomic, the same
-- cascade as removing items one by one, revision-checked, refused while the
-- plan runs live. Run against the seeded local database. Everything rolls back.
begin;

create temporary table oc_fx (k text primary key, id uuid) on commit drop;
grant select on oc_fx to authenticated, service_role, anon;
insert into oc_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('editor', '22222222-2222-4222-8222-222222222222'),
  ('member', '33333333-3333-4333-8333-333333333333'),
  ('plan', gen_random_uuid()), ('other_plan', gen_random_uuid()), ('empty_plan', gen_random_uuid()),
  ('h', gen_random_uuid()), ('i1', gen_random_uuid()), ('i2', gen_random_uuid()), ('keep', gen_random_uuid()),
  ('note', gen_random_uuid()), ('plan_note', gen_random_uuid()), ('comment', gen_random_uuid()),
  ('plan_file', gen_random_uuid()), ('item_file', gen_random_uuid()), ('link', gen_random_uuid()),
  ('media', gen_random_uuid()), ('op', gen_random_uuid()), ('run', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from oc_fx where k = p $$;
grant execute on function pg_temp.fx(text) to authenticated, anon;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'Clear me', '2027-04-04 15:00+00', 'draft', pg_temp.fx('editor')),
  (pg_temp.fx('other_plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'Leave me', '2027-04-11 15:00+00', 'draft', pg_temp.fx('editor')),
  (pg_temp.fx('empty_plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'Already empty', '2027-04-18 15:00+00', 'draft', pg_temp.fx('editor'));
insert into public.media (id, organization_id, title) values (pg_temp.fx('media'), pg_temp.fx('org'), 'Countdown');
insert into public.plan_items (id, plan_id, item_type, title, length_seconds, sort_order, media_id) values
  (pg_temp.fx('h'), pg_temp.fx('plan'), 'header', 'Worship', 0, 0, null),
  (pg_temp.fx('i1'), pg_temp.fx('plan'), 'item', 'Welcome', 180, 1, pg_temp.fx('media')),
  (pg_temp.fx('i2'), pg_temp.fx('plan'), 'item', 'Sermon', 2100, 2, null),
  (pg_temp.fx('keep'), pg_temp.fx('other_plan'), 'item', 'Other plan item', 60, 0, null);

-- What hangs off an item: a note, a comment, an item-owned file, a link to a
-- plan file, an add-item idempotency record; plus a plan-level note.
insert into public.plan_notes (id, organization_id, plan_id, plan_item_id, body) values
  (pg_temp.fx('note'), pg_temp.fx('org'), pg_temp.fx('plan'), pg_temp.fx('i1'), 'Item note'),
  (pg_temp.fx('plan_note'), pg_temp.fx('org'), pg_temp.fx('plan'), null, 'Plan note');
insert into public.plan_item_comments (id, organization_id, plan_id, plan_item_id, author_id, body) values
  (pg_temp.fx('comment'), pg_temp.fx('org'), pg_temp.fx('plan'), pg_temp.fx('i1'), pg_temp.fx('editor'), 'Comment');
insert into public.attachments (id, organization_id, owner_kind, plan_id, plan_item_id, title, filename) values
  (pg_temp.fx('plan_file'), pg_temp.fx('org'), 'plan', pg_temp.fx('plan'), null, 'Run sheet', 'run.pdf'),
  (pg_temp.fx('item_file'), pg_temp.fx('org'), 'plan_item', pg_temp.fx('plan'), pg_temp.fx('i2'), 'Notes', 'notes.pdf');
insert into public.attachment_links (id, organization_id, attachment_id, plan_id, plan_item_id) values
  (pg_temp.fx('link'), pg_temp.fx('org'), pg_temp.fx('plan_file'), pg_temp.fx('plan'), pg_temp.fx('i2'));
insert into public.plan_item_create_operations (id, plan_id, created_by, idempotency_key, request, item_id) values
  (pg_temp.fx('op'), pg_temp.fx('plan'), pg_temp.fx('editor'), 'order-clear-key', '{}', pg_temp.fx('i2'));

set local role authenticated;

-- A member who cannot edit the plan is told it does not exist; nothing goes.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.clear_plan_items(pg_temp.fx('plan'), null);
    raise exception 'FAIL: member cleared the order';
  exception when sqlstate 'P0002' then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('plan')) <> 3 then
    raise exception 'FAIL: a denied clear removed items';
  end if;
end $$;

-- anon may not call it at all.
set local role anon;
do $$ begin
  begin
    perform public.clear_plan_items(pg_temp.fx('plan'), null);
    raise exception 'FAIL: anon cleared the order';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- A live (then paused) run of the plan blocks the clear.
insert into public.live_runs (id, organization_id, plan_id, time_starts_at, time_ends_at, snapshot, snapshot_revision, idempotency_key)
  values (pg_temp.fx('run'), pg_temp.fx('org'), pg_temp.fx('plan'), now(), now() + interval '1 hour', '[]', 1, 'order-clear-run');
update public.live_runs set status = 'live', current_index = 0, current_started_at = now(), started_at = now(),
   revision = revision + 1 where id = pg_temp.fx('run');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare v_hint text;
begin
  begin
    perform public.clear_plan_items(pg_temp.fx('plan'), null);
    raise exception 'FAIL: cleared during a live run';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'live_run_active' then raise exception 'FAIL: wrong hint %', v_hint; end if;
  end;
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('plan')) <> 3 then
    raise exception 'FAIL: a refused clear removed items';
  end if;
end $$;
reset role;
update public.live_runs set status = 'paused', paused_at = now(), revision = revision + 1 where id = pg_temp.fx('run');
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  begin
    perform public.clear_plan_items(pg_temp.fx('plan'), null);
    raise exception 'FAIL: cleared during a paused run';
  exception when sqlstate 'PT409' then null; end;
end $$;
reset role;
-- An ended run no longer blocks.
update public.live_runs set status = 'ended', ended_at = now(), paused_at = null, current_index = null, revision = revision + 1 where id = pg_temp.fx('run');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_rev bigint;
  v_result jsonb;
  v_hint text;
begin
  select content_revision into v_rev from public.plans where id = pg_temp.fx('plan');

  -- A stale revision is refused and removes nothing.
  begin
    perform public.clear_plan_items(pg_temp.fx('plan'), v_rev - 1);
    raise exception 'FAIL: stale clear accepted';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'plan_changed' then raise exception 'FAIL: wrong hint %', v_hint; end if;
  end;
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('plan')) <> 3 then
    raise exception 'FAIL: a stale clear removed items';
  end if;

  -- The editor clears with the revision they read.
  v_result := public.clear_plan_items(pg_temp.fx('plan'), v_rev);
  if (v_result ->> 'removed')::int <> 3 then raise exception 'FAIL: removed count %', v_result; end if;
  if (v_result ->> 'content_revision')::bigint <= v_rev then raise exception 'FAIL: revision did not advance'; end if;
  if (v_result ->> 'content_revision')::bigint <> (select content_revision from public.plans where id = pg_temp.fx('plan')) then
    raise exception 'FAIL: returned revision is not the plan''s';
  end if;

  -- A retry (any revision) of a clear that already happened succeeds again.
  v_result := public.clear_plan_items(pg_temp.fx('plan'), v_rev);
  if (v_result ->> 'removed')::int <> 0 then raise exception 'FAIL: replay removed %', v_result; end if;
  v_result := public.clear_plan_items(pg_temp.fx('empty_plan'), null);
  if (v_result ->> 'removed')::int <> 0 then raise exception 'FAIL: empty plan %', v_result; end if;
end $$;
reset role;

-- The cascade matches removing items one by one.
do $$ begin
  if exists (select 1 from public.plan_items where plan_id = pg_temp.fx('plan')) then
    raise exception 'FAIL: items left behind';
  end if;
  if not exists (select 1 from public.plan_items where id = pg_temp.fx('keep')) then
    raise exception 'FAIL: another plan''s item was removed';
  end if;
  if exists (select 1 from public.plan_notes where id = pg_temp.fx('note')) then
    raise exception 'FAIL: item note kept';
  end if;
  if not exists (select 1 from public.plan_notes where id = pg_temp.fx('plan_note')) then
    raise exception 'FAIL: plan-level note removed';
  end if;
  if exists (select 1 from public.plan_item_comments where id = pg_temp.fx('comment')) then
    raise exception 'FAIL: item comment kept';
  end if;
  if exists (select 1 from public.attachments where id = pg_temp.fx('item_file')) then
    raise exception 'FAIL: item-owned file kept';
  end if;
  if exists (select 1 from public.attachment_links where id = pg_temp.fx('link')) then
    raise exception 'FAIL: link to a cleared item kept';
  end if;
  if not exists (select 1 from public.attachments where id = pg_temp.fx('plan_file')) then
    raise exception 'FAIL: the linked plan file was removed';
  end if;
  if not exists (select 1 from public.media where id = pg_temp.fx('media')) then
    raise exception 'FAIL: the linked media bundle was removed';
  end if;
  if (select item_id from public.plan_item_create_operations where id = pg_temp.fx('op')) is not null then
    raise exception 'FAIL: the add record still names a removed item';
  end if;
end $$;

select 'order-clear: all assertions passed' as result;
rollback;
