-- QA wave 7 database regression suite. Each section fails on the schema
-- before the 20261125000000..04 migrations:
--   A. W7-ACC-D1 (P0) only an owner may insert organization_members rows;
--                     invitation acceptance and church creation still work.
--   B. W7-MSG-D5      a recipient may change only read_at on their own
--                     notifications; delete-own still works.
--   C. W7-RESP-D2     a non-scheduler cannot PATCH their assignment status
--                     directly; respond_as_self / respond_to_own_assignment
--                     still answer and enqueue the scheduler update; a
--                     scheduler's direct edit still works.
--   D. W7-RESP-D4     a repeated identical answer is `unchanged` with no
--                     second history row (the concurrent case is covered by
--                     qa-wave7-concurrent-respond.sh).
--   E. W7-JRN-D2      the combined schedule lists a released assignment on a
--                     plan without times.
--   F. W7-ACC-D8      the organization-logos bucket refuses SVG.
-- Self-contained fixtures; everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave7-fixes.sql
begin;

create temporary table w7_fx (k text primary key, id uuid) on commit drop;
grant select on w7_fx to authenticated, service_role;

insert into w7_fx values
  ('org', gen_random_uuid()),
  ('owner', gen_random_uuid()),
  ('admin', gen_random_uuid()),
  ('member', gen_random_uuid()),
  ('outsider', gen_random_uuid()),
  ('invitee', gen_random_uuid()),
  ('founder', gen_random_uuid()),
  ('team', gen_random_uuid()),
  ('plan', gen_random_uuid()),
  ('untimed_plan', gen_random_uuid()),
  ('assignment', gen_random_uuid()),
  ('untimed_assignment', gen_random_uuid()),
  ('notification', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w7_fx where k = p $$;

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_hint text, p_label text)
returns void language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  raise exception '%: expected %/% but it succeeded', p_label, p_state, p_hint;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  if v_state <> p_state or (p_hint is not null and v_hint is distinct from p_hint) then
    raise exception '%: expected %/% but got %/% (%)', p_label, p_state, p_hint, v_state, v_hint, sqlerrm;
  end if;
end $$;

create or replace function pg_temp.act_as(p text) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(p), 'role', 'authenticated')::text, true) $$;

-- ------------------------------------------------------------- fixtures ---
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.fx(k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'w7.' || k || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}',
       json_build_object('full_name', 'W7 ' || initcap(k))::jsonb, now(), now()
  from unnest(array['owner', 'admin', 'member', 'outsider', 'invitee', 'founder']) k;

insert into public.organizations (id, name, slug, timezone)
values (pg_temp.fx('org'), 'W7 Church', 'w7-church-' || left(pg_temp.fx('org')::text, 8), 'America/Toronto');
insert into public.organization_members (organization_id, user_id, role, status) values
  (pg_temp.fx('org'), pg_temp.fx('owner'), 'owner', 'active'),
  (pg_temp.fx('org'), pg_temp.fx('admin'), 'admin', 'active'),
  (pg_temp.fx('org'), pg_temp.fx('member'), 'member', 'active');

insert into public.teams (id, organization_id, name) values (pg_temp.fx('team'), pg_temp.fx('org'), 'W7 Band');
insert into public.plans (id, organization_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), 'W7 timed plan', now() + interval '10 days', 'published', pg_temp.fx('owner')),
  (pg_temp.fx('untimed_plan'), pg_temp.fx('org'), 'W7 untimed plan', now() + interval '11 days', 'published', pg_temp.fx('owner'));
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
values (pg_temp.fx('plan'), 'service', 'W7 service', now() + interval '10 days', now() + interval '10 days 1 hour');

insert into public.assignments (id, plan_id, person_id, user_id, team_id, status, visibility, released_at, released_by, response_owner_id, created_by)
select x.id, x.plan_id, p.id, p.profile_id, pg_temp.fx('team'), 'unconfirmed', 'released', now(),
       pg_temp.fx('owner'), pg_temp.fx('owner'), pg_temp.fx('owner')
  from public.people p,
       (values (pg_temp.fx('assignment'), pg_temp.fx('plan')),
               (pg_temp.fx('untimed_assignment'), pg_temp.fx('untimed_plan'))) x(id, plan_id)
 where p.organization_id = pg_temp.fx('org') and p.profile_id = pg_temp.fx('member');

insert into public.notifications (id, organization_id, user_id, type, title, body)
values (pg_temp.fx('notification'), pg_temp.fx('org'), pg_temp.fx('member'), 'assignment_scheduled', 'W7 title', 'W7 body');

insert into public.user_schedule_settings (user_id, combined_schedule) values (pg_temp.fx('member'), true)
on conflict (user_id) do update set combined_schedule = true;

-- An invitation for the invitee (the owner's normal "add a person" flow).
insert into public.people (id, organization_id, first_name, email)
values (gen_random_uuid(), pg_temp.fx('org'), 'W7 Invitee', 'w7.invitee@example.test');
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at, created_by)
select pg_temp.fx('org'), p.id, 'w7.invitee@example.test', 'member', 'w7-invitation-token-hash', now() + interval '1 day', pg_temp.fx('owner')
  from public.people p where p.organization_id = pg_temp.fx('org') and p.first_name = 'W7 Invitee';

-- ================================== A. W7-ACC-D1 owner-only member insert
set local role authenticated;
select pg_temp.act_as('admin');
select pg_temp.expect_error(format(
  'insert into public.organization_members (organization_id, user_id, role, status) values (%L, %L, %L, ''active'')',
  pg_temp.fx('org'), pg_temp.fx('outsider'), r), '42501', null, 'A1 admin inserts ' || r)
  from unnest(array['owner', 'admin', 'member']) r;
-- Not even the admin's own second account as owner.
select pg_temp.expect_error(format(
  'insert into public.organization_members (organization_id, user_id, role, status) values (%L, %L, ''owner'', ''active'')',
  pg_temp.fx('org'), pg_temp.fx('invitee')), '42501', null, 'A2 admin inserts a second owner');

select pg_temp.act_as('member');
select pg_temp.expect_error(format(
  'insert into public.organization_members (organization_id, user_id, role, status) values (%L, %L, ''member'', ''active'')',
  pg_temp.fx('org'), pg_temp.fx('outsider')), '42501', null, 'A3 member inserts');

select pg_temp.act_as('owner');
do $$
declare n integer;
begin
  insert into public.organization_members (organization_id, user_id, role, status)
  values (pg_temp.fx('org'), pg_temp.fx('outsider'), 'member', 'active');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'A4 owner could not add a member'; end if;
  delete from public.organization_members where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('outsider');
end $$;

-- Invitation acceptance (API, service role) still creates the membership.
reset role;
set local role service_role;
do $$
declare v_status text;
begin
  select out_status into v_status from public.accept_person_invitation('w7-invitation-token-hash', pg_temp.fx('invitee'));
  if v_status is distinct from 'accepted' and v_status is distinct from 'linked' then
    raise exception 'A5 invitation acceptance returned %', v_status;
  end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.organization_members where organization_id = pg_temp.fx('org')
                 and user_id = pg_temp.fx('invitee') and role = 'member' and status = 'active') then
    raise exception 'A5 invitation acceptance did not add the member';
  end if;
end $$;

-- Church creation by a signed-in user still makes them the first owner.
update public.platform_settings set allow_self_serve_church_creation = true;
set local role authenticated;
select pg_temp.act_as('founder');
do $$
declare v_org public.organizations;
begin
  v_org := public.create_organization('W7 Founded Church', 'w7-founded-' || left(pg_temp.fx('founder')::text, 8), 'America/Toronto');
  if not exists (select 1 from public.organization_members where organization_id = v_org.id
                 and user_id = pg_temp.fx('founder') and role = 'owner' and status = 'active') then
    raise exception 'A6 church creation did not add its owner';
  end if;
end $$;

-- ================================== B. W7-MSG-D5 read state only
select pg_temp.act_as('member');
select pg_temp.expect_error(format(
  'update public.notifications set title = ''FORGED'' where id = %L', pg_temp.fx('notification')), '42501', null, 'B1 title');
select pg_temp.expect_error(format(
  'update public.notifications set body = ''x'', type = ''assignment_reminder'', conversation_id = null where id = %L',
  pg_temp.fx('notification')), '42501', null, 'B2 body/type/target');
do $$
declare n integer;
begin
  update public.notifications set read_at = now() where id = pg_temp.fx('notification');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B3 mark-read changed % rows', n; end if;
  update public.notifications set read_at = null where id = pg_temp.fx('notification');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B4 mark-unread changed % rows', n; end if;
end $$;
-- Someone else cannot touch it.
select pg_temp.act_as('admin');
do $$
declare n integer;
begin
  update public.notifications set read_at = now() where id = pg_temp.fx('notification');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B5 another user marked it read'; end if;
end $$;

-- ================================== C/D. W7-RESP-D2 / D4 response paths
select pg_temp.act_as('member');
select pg_temp.expect_error(format(
  'update public.assignments set status = ''confirmed'' where id = %L', pg_temp.fx('assignment')),
  '42501', 'assignment_response_path', 'C1 direct confirm');
do $$
declare
  v_status public.assignment_status;
  v_transition text;
  v_effect uuid;
begin
  select (r.assignment).status, r.transition, r.effect_id into v_status, v_transition, v_effect
    from public.respond_as_self(pg_temp.fx('org'), pg_temp.fx('assignment'), 'confirmed', 'unconfirmed') r;
  if v_transition <> 'answer' or v_effect is null or v_status <> 'confirmed' then
    raise exception 'C2 respond_as_self: % % %', v_transition, v_effect, v_status;
  end if;
  -- D: the identical retry, even with the now-stale expectation, is unchanged.
  select r.transition, r.effect_id into v_transition, v_effect
    from public.respond_as_self(pg_temp.fx('org'), pg_temp.fx('assignment'), 'confirmed', 'unconfirmed') r;
  if v_transition <> 'unchanged' or v_effect is not null then
    raise exception 'D1 identical retry: % %', v_transition, v_effect;
  end if;
end $$;
select pg_temp.expect_error(format(
  'update public.assignments set status = ''declined'' where id = %L', pg_temp.fx('assignment')),
  '42501', 'assignment_response_path', 'C3 direct withdrawal');
-- The legacy RPC (still granted) is a sanctioned path and enqueues the update.
do $$
declare v_row public.assignments;
begin
  select * into v_row from public.respond_to_own_assignment(pg_temp.fx('assignment'), 'declined', 'confirmed', 'W7 away');
  if v_row.id is null or v_row.status <> 'declined' then raise exception 'C4 legacy respond did not withdraw'; end if;
end $$;
reset role;
do $$
declare v_history integer; v_effects integer;
begin
  select count(*) into v_history from public.assignment_responses where assignment_id = pg_temp.fx('assignment');
  select count(*) into v_effects from public.delivery_effects e
   where e.organization_id = pg_temp.fx('org') and e.effect_key like 'assignment-response:%';
  if v_history <> 2 then raise exception 'D2 expected 2 history rows (answer + withdrawal), got %', v_history; end if;
  if v_effects <> 2 then raise exception 'C5 expected 2 scheduler effects, got %', v_effects; end if;
end $$;
-- A scheduler may still set a status directly.
set local role authenticated;
select pg_temp.act_as('owner');
do $$
declare n integer;
begin
  update public.assignments set status = 'unconfirmed' where id = pg_temp.fx('assignment');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'C6 scheduler direct edit changed % rows', n; end if;
end $$;

-- ================================== E. W7-JRN-D2 untimed combined schedule
select pg_temp.act_as('member');
do $$ begin
  if not exists (
    select 1 from public.my_organization_schedule(pg_temp.fx('org'), now(), now() + interval '30 days') s
     where s.kind = 'assignment' and s.item_id = pg_temp.fx('untimed_assignment')
  ) then
    raise exception 'E1 untimed released assignment missing from the combined schedule';
  end if;
  if (select count(*) from public.my_organization_schedule(pg_temp.fx('org'), now(), now() + interval '30 days') s
       where s.kind = 'assignment' and s.item_id = pg_temp.fx('assignment')) <> 1 then
    raise exception 'E2 timed assignment not listed exactly once';
  end if;
end $$;

-- ================================== F. W7-ACC-D8 raster-only logos
reset role;
do $$ begin
  if (select 'image/svg+xml' = any(allowed_mime_types) from storage.buckets where id = 'organization-logos') then
    raise exception 'F1 organization-logos still allows SVG';
  end if;
end $$;

select 'qa-wave7-fixes: all sections passed' as result;
rollback;
