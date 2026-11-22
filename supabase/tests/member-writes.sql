-- SEC-003 regression suite (20261130000200_member_writes_via_functions).
-- Fails on the schema before that migration:
--   A. an owner cannot insert a membership for a user of another church
--      (the consent-free enrolment that copied their email into the roster).
--   B. an owner cannot repoint an existing membership's user_id or
--      organization_id; role, status and access_mode still update.
--   C. member_contacts returns nothing for a non-active membership row.
--   D. invitation acceptance (service role) still adds the member.
-- Self-contained fixtures; everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/member-writes.sql
begin;

create temporary table sec3_fx (k text primary key, id uuid) on commit drop;
grant select on sec3_fx to authenticated, service_role;

insert into sec3_fx values
  ('org', gen_random_uuid()),
  ('other_org', gen_random_uuid()),
  ('owner', gen_random_uuid()),
  ('member', gen_random_uuid()),
  ('inactive', gen_random_uuid()),
  ('victim', gen_random_uuid()),
  ('invitee', gen_random_uuid()),
  ('invitee_person', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from sec3_fx where k = p $$;

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  raise exception '%: expected % but it succeeded', p_label, p_state;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  if v_state <> p_state then
    raise exception '%: expected % but got % (%)', p_label, p_state, v_state, sqlerrm;
  end if;
end $$;

create or replace function pg_temp.act_as(p text) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx(p), 'role', 'authenticated')::text, true) $$;

-- ------------------------------------------------------------- fixtures ---
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.fx(k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'sec3.' || k || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}',
       json_build_object('full_name', 'Sec3 ' || initcap(k))::jsonb, now(), now()
  from unnest(array['owner', 'member', 'inactive', 'victim', 'invitee']) k;
update public.profiles set phone = '+1 555 0100' where id = pg_temp.fx('inactive');

insert into public.organizations (id, name, slug, timezone) values
  (pg_temp.fx('org'), 'Sec3 Church', 'sec3-church-' || left(pg_temp.fx('org')::text, 8), 'America/Toronto'),
  (pg_temp.fx('other_org'), 'Sec3 Other', 'sec3-other-' || left(pg_temp.fx('other_org')::text, 8), 'America/Toronto');
insert into public.organization_members (organization_id, user_id, role, status) values
  (pg_temp.fx('org'), pg_temp.fx('owner'), 'owner', 'active'),
  (pg_temp.fx('org'), pg_temp.fx('member'), 'member', 'active'),
  (pg_temp.fx('org'), pg_temp.fx('inactive'), 'member', 'inactive'),
  (pg_temp.fx('other_org'), pg_temp.fx('victim'), 'member', 'active');

insert into public.people (id, organization_id, first_name, last_name, email)
values (pg_temp.fx('invitee_person'), pg_temp.fx('org'), 'Sec3', 'Invitee', 'sec3.invitee@example.test');
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, created_by, expires_at)
values (pg_temp.fx('org'), pg_temp.fx('invitee_person'), 'sec3.invitee@example.test', 'member',
        'sec3-invitation-token-hash', pg_temp.fx('owner'), now() + interval '7 days');

-- ============================================ A. no direct enrolment
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.expect_error(format(
  'insert into public.organization_members (organization_id, user_id, role, status) values (%L, %L, ''member'', %L)',
  pg_temp.fx('org'), pg_temp.fx('victim'), s), '42501', 'A1 owner enrols another church''s user as ' || s)
  from unnest(array['active', 'inactive', 'invited']) s;

reset role;
do $$ begin
  if exists (select 1 from public.people where organization_id = pg_temp.fx('org')
             and email = 'sec3.victim@example.test') then
    raise exception 'A2 the victim''s email reached the owner''s roster';
  end if;
end $$;

-- ============================================ B. only role/status/access_mode
set local role authenticated;
select pg_temp.act_as('owner');
select pg_temp.expect_error(format(
  'update public.organization_members set user_id = %L where organization_id = %L and user_id = %L',
  pg_temp.fx('victim'), pg_temp.fx('org'), pg_temp.fx('member')), '42501', 'B1 owner repoints user_id');
select pg_temp.expect_error(format(
  'update public.organization_members set organization_id = %L where organization_id = %L and user_id = %L',
  pg_temp.fx('other_org'), pg_temp.fx('org'), pg_temp.fx('member')), '42501', 'B2 owner moves a row to another org');
select pg_temp.expect_error(format(
  'update public.organization_members set platform_access_expires_at = now() + interval ''1 day'' where organization_id = %L and user_id = %L',
  pg_temp.fx('org'), pg_temp.fx('member')), '42501', 'B3 owner sets platform access');

do $$
declare n integer;
begin
  update public.organization_members set role = 'admin', status = 'active', access_mode = access_mode
   where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('member');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B4 owner could not change role/status/access_mode (% rows)', n; end if;
end $$;

-- ============================================ C. contacts need an active row
do $$
declare n integer;
begin
  select count(*) into n from public.member_contacts(pg_temp.fx('org'), array[pg_temp.fx('inactive')]);
  if n <> 0 then raise exception 'C1 member_contacts returned an inactive member''s contacts'; end if;
  select count(*) into n from public.member_contacts(pg_temp.fx('org'), array[pg_temp.fx('member')]);
  if n <> 1 then raise exception 'C2 member_contacts lost an active member (% rows)', n; end if;
end $$;

-- ============================================ D. invitation acceptance works
reset role;
set local role service_role;
do $$
declare v_status text;
begin
  select out_status into v_status from public.accept_person_invitation('sec3-invitation-token-hash', pg_temp.fx('invitee'));
  if v_status is distinct from 'linked' then raise exception 'D1 invitation acceptance returned %', v_status; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.organization_members where organization_id = pg_temp.fx('org')
                 and user_id = pg_temp.fx('invitee') and status = 'active') then
    raise exception 'D2 invitation acceptance did not add the member';
  end if;
end $$;

select 'member-writes: all sections passed' as result;
rollback;
