-- QA wave 8 database fixes. Uses the seed org/people of
-- supabase/tests/f09-notes-messages-chat.sql. Everything rolls back.
--   A. W8-INT-D1  a webhook retry without Retry-After backs off by the schedule
--                 (5 s first), not 24 h; a given Retry-After still wins when
--                 larger, and is clamped to 24 h.
--   B. W8-INT-D2  a plan created as 'published' emits plan.published once; a
--                 later update does not emit a duplicate; a draft emits nothing
--                 until published.
--   C. W8-PERF-D1 song text columns reject values past the shared Zod limits.
--   D. W8-RES-D4 / W8-RT-D1  update_plan_with_times is atomic (a failing field
--                 write rolls back the times, checked with a top-level failing
--                 statement inside a savepoint), and with both service_date and
--                 times the times win.
--   E. W8-RES-D5  create_plan replays an identical idempotency key and refuses
--                 the same key with a different payload (PT409,
--                 idempotency_key_reused).
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-db.sql
-- (requires migrations 20261127000000..04 to be applied or loaded first)
begin;

create temporary table w8_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w8_fx to authenticated, service_role;

insert into w8_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('endpoint', gen_random_uuid()), ('draft_plan', gen_random_uuid()), ('pub_plan', gen_random_uuid()),
  ('song', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w8_fx where k = p $$;
create or replace function pg_temp.check(ok boolean, message text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'W8 check failed: %', message; end if;
end $$;
create or replace function pg_temp.act_as(p text) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(p), 'role', 'authenticated')::text, true) $$;

-- ================================================================ Pass A ===
update public.webhook_endpoints set enabled = false, disabled_reason = 'administrator' where enabled;
insert into public.webhook_endpoints (id, organization_id, url, event_types, secret_ciphertext, secret_hint, created_by, idempotency_key)
values (pg_temp.fx('endpoint'), pg_temp.fx('org'), 'https://hooks.example.com/w8', array['plan.published'],
        repeat('c', 40), 'abcd', pg_temp.fx('owner'), 'w8-endpoint-key');

create temporary table w8_events (id uuid primary key default gen_random_uuid(), tag text) on commit drop;

do $$
declare
  v_event uuid;
  v_del   uuid;
  v_next  timestamptz;
begin
  -- Three deliveries, each leased with attempt 1 (first backoff step is 5 s).
  for i in 1..3 loop
    insert into public.webhook_events (organization_id, event_type, source_key, data)
    values (pg_temp.fx('org'), 'plan.published', 'w8-a-' || i, '{}') returning id into v_event;
    insert into public.webhook_deliveries (organization_id, event_id, endpoint_id, status, attempts, lease_expires_at)
    values (pg_temp.fx('org'), v_event, pg_temp.fx('endpoint'), 'sending', 1, now() + interval '1 minute')
    returning id into v_del;
    insert into w8_events (id, tag) values (v_del, 'a' || i);
  end loop;

  -- No Retry-After (the bug: this used to schedule ~24 h out).
  perform public.complete_webhook_delivery((select id from w8_events where tag = 'a1'), 1, 'retry', 503, 'http_5xx', now(), 10, null);
  select next_attempt_at into v_next from public.webhook_deliveries where id = (select id from w8_events where tag = 'a1');
  perform pg_temp.check(v_next < now() + interval '10 seconds', 'retry without Retry-After backs off ~5 s, not 24 h');

  -- A larger Retry-After wins.
  perform public.complete_webhook_delivery((select id from w8_events where tag = 'a2'), 1, 'retry', 429, 'http_429', now(), 10, 120);
  select next_attempt_at into v_next from public.webhook_deliveries where id = (select id from w8_events where tag = 'a2');
  perform pg_temp.check(v_next between now() + interval '100 seconds' and now() + interval '140 seconds', 'Retry-After 120 is honoured');

  -- Absurd Retry-After is capped at 24 h (the delay then gets +/-10% jitter: 77760..95040 s).
  perform public.complete_webhook_delivery((select id from w8_events where tag = 'a3'), 1, 'retry', 429, 'http_429', now(), 10, 9999999);
  select next_attempt_at into v_next from public.webhook_deliveries where id = (select id from w8_events where tag = 'a3');
  perform pg_temp.check(v_next between now() + interval '77000 seconds' and now() + interval '95100 seconds', 'Retry-After is capped at 24 h');
end $$;

-- ================================================================ Pass B ===
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values (pg_temp.fx('pub_plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'W8 published at birth', now() + interval '700 days', 'published', pg_temp.fx('jordan')),
       (pg_temp.fx('draft_plan'), pg_temp.fx('org'), pg_temp.fx('sunday'), 'W8 draft', now() + interval '701 days', 'draft', pg_temp.fx('jordan'));

select pg_temp.check((select count(*) from public.webhook_events
                       where event_type = 'plan.published' and data->>'plan_id' = pg_temp.fx('pub_plan')::text) = 1,
  'a plan inserted as published emits plan.published once');
select pg_temp.check((select count(*) from public.webhook_deliveries d join public.webhook_events e on e.id = d.event_id
                       where d.endpoint_id = pg_temp.fx('endpoint') and e.data->>'plan_id' = pg_temp.fx('pub_plan')::text) = 1,
  'the event is queued for the endpoint');
select pg_temp.check((select count(*) from public.webhook_events where data->>'plan_id' = pg_temp.fx('draft_plan')::text) = 0,
  'a draft plan emits nothing');

update public.plans set title = 'W8 renamed' where id = pg_temp.fx('pub_plan');
update public.plans set status = 'published' where id = pg_temp.fx('pub_plan');
select pg_temp.check((select count(*) from public.webhook_events
                       where event_type = 'plan.published' and data->>'plan_id' = pg_temp.fx('pub_plan')::text) = 1,
  'later updates of a published plan do not duplicate plan.published');

update public.plans set status = 'published' where id = pg_temp.fx('draft_plan');
select pg_temp.check((select count(*) from public.webhook_events
                       where event_type = 'plan.published' and data->>'plan_id' = pg_temp.fx('draft_plan')::text) = 1,
  'publishing a draft still emits plan.published once');

-- ================================================================ Pass C ===
insert into public.songs (id, organization_id, title) values (pg_temp.fx('song'), pg_temp.fx('org'), repeat('t', 200));
do $$
begin
  begin
    update public.songs set title = repeat('t', 201) where id = pg_temp.fx('song');
    raise exception 'W8 check failed: 201-char title accepted';
  exception when check_violation then null;
  end;
  begin
    update public.songs set author = repeat('a', 201) where id = pg_temp.fx('song');
    raise exception 'W8 check failed: 201-char author accepted';
  exception when check_violation then null;
  end;
  begin
    update public.songs set notes = repeat('n', 4001) where id = pg_temp.fx('song');
    raise exception 'W8 check failed: 4001-char notes accepted';
  exception when check_violation then null;
  end;
  update public.songs set author = repeat('a', 200), notes = repeat('n', 4000), ccli_number = repeat('1', 40) where id = pg_temp.fx('song');
end $$;
select pg_temp.check((select bool_and(convalidated) from pg_constraint
                       where conrelid = 'public.songs'::regclass and conname like 'songs\_%\_len'),
  'the length checks are validated');

-- ================================================================ Pass D ===
set local role authenticated;
select pg_temp.act_as('jordan');

create temporary table w8_plan as
select public.create_plan(pg_temp.fx('org'),
  jsonb_build_object('title', 'W8 patch', 'service_type_id', pg_temp.fx('sunday'), 'service_date', (now() + interval '720 days')::text),
  jsonb_build_array(jsonb_build_object('kind', 'service', 'name', 'Main',
    'starts_at', (date_trunc('hour', now()) + interval '720 days')::text,
    'ends_at', (date_trunc('hour', now()) + interval '720 days 1 hour')::text)),
  null, false, null, null) as id;
grant select on w8_plan to authenticated, service_role;

-- The time list every atomicity call below sends: rename the service time and move it.
create temporary table w8_patch as
select p.content_revision as rev,
       jsonb_build_array(jsonb_build_object('id', t.id, 'kind', 'service', 'name', 'Moved',
         'starts_at', (date_trunc('hour', now()) + interval '730 days')::text,
         'ends_at', (date_trunc('hour', now()) + interval '730 days 1 hour')::text, 'sort_order', 0)) as times
  from public.plans p join public.plan_times t on t.plan_id = p.id
 where p.id = (select id from w8_plan);
grant select on w8_patch to authenticated, service_role;

-- Control: the times write on its own does persist, so "no 'Moved' time" below is evidence of a
-- rollback and not of a times write that never happened.
savepoint w8_times_alone;
select public.apply_plan_time_changes((select id from w8_plan), (select times from w8_patch),
  (select rev from w8_patch), null, '[]'::jsonb, true, null);
select pg_temp.check((select count(*) from public.plan_times where plan_id = (select id from w8_plan) and name = 'Moved') = 1,
  'the times write alone persists');
rollback to savepoint w8_times_alone;

-- Times plus a failing field write (invalid status) as ONE top-level statement, not wrapped in a
-- PL/pgSQL exception block (whose subtransaction would roll back the times even for a
-- non-atomic implementation). The statement must fail; the savepoint lets the script go on.
savepoint w8_atomic;
\set ON_ERROR_STOP 0
select public.update_plan_with_times((select id from w8_plan), jsonb_build_object('status', 'bogus'),
  (select times from w8_patch), (select rev from w8_patch));
\set ON_ERROR_STOP 1
rollback to savepoint w8_atomic;
select pg_temp.check(:'LAST_ERROR_SQLSTATE' = '22P02', 'the invalid status failed the whole call (22P02)');
select pg_temp.check((select count(*) from public.plan_times where plan_id = (select id from w8_plan) and name = 'Moved') = 0,
  'times were not persisted when the field write failed');
select pg_temp.check((select content_revision from public.plans where id = (select id from w8_plan)) = (select rev from w8_patch),
  'revision unchanged, so a retry with expected_revision is not a false 409');

do $$
declare
  v_plan  uuid := (select id from w8_plan);
  v_rev   bigint := (select rev from w8_patch);
  v_tid   uuid;
  v_first timestamptz;
  v_new   timestamptz := date_trunc('hour', now()) + interval '730 days';
begin
  select id into v_tid from public.plan_times where plan_id = v_plan;

  -- Both service_date and times: times win.
  perform public.update_plan_with_times(v_plan,
    jsonb_build_object('title', 'W8 patched', 'service_date', (v_new + interval '50 days')::text),
    jsonb_build_array(jsonb_build_object('id', v_tid, 'kind', 'service', 'name', 'Moved', 'starts_at', v_new::text, 'ends_at', (v_new + interval '1 hour')::text, 'sort_order', 0)),
    v_rev);
  select service_date into v_first from public.plans where id = v_plan;
  perform pg_temp.check(v_first = v_new, 'service_date equals the earliest service time when both are sent');
  perform pg_temp.check((select title from public.plans where id = v_plan) = 'W8 patched', 'the title saved in the same call');

  -- Fields only (no times).
  perform public.update_plan_with_times(v_plan, jsonb_build_object('location', 'Hall B', 'notes', null), null, null);
  perform pg_temp.check((select location from public.plans where id = v_plan) = 'Hall B', 'fields-only update works');
  perform pg_temp.check((select count(*) from public.plan_times where plan_id = v_plan and name = 'Moved') = 1, 'times untouched by a fields-only update');
end $$;

-- ================================================================ Pass E ===
do $$
declare
  v_a uuid;
  v_b uuid;
  v_date text := (now() + interval '740 days')::text;
begin
  v_a := public.create_plan(pg_temp.fx('org'),
    jsonb_build_object('title', 'W8 idem', 'service_date', v_date, 'status', 'draft'),
    '[]'::jsonb, null, false, 'w8-create-key-1', null);
  v_b := public.create_plan(pg_temp.fx('org'),
    jsonb_build_object('status', 'draft', 'service_date', v_date, 'title', 'W8 idem'),
    '[]'::jsonb, null, false, 'w8-create-key-1', null);
  perform pg_temp.check(v_a = v_b, 'an identical replay returns the first plan');

  begin
    perform public.create_plan(pg_temp.fx('org'),
      jsonb_build_object('title', 'W8 different', 'service_date', v_date, 'status', 'draft'),
      '[]'::jsonb, null, false, 'w8-create-key-1', null);
    raise exception 'W8 check failed: same key with a different payload was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  perform pg_temp.check((select count(*) from public.plans where title = 'W8 different') = 0, 'no second plan was created');
end $$;

rollback;
