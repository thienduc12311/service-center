-- SEC-013 (20261130000500): the email an invitation was accepted with is the
-- linked Person's primary email and can't be edited by clients.
--   A. linking copies the login email onto the Person.
--   B. the owner can't change a linked Person's email (PT409
--      person_email_locked) but can still edit their other fields, and can
--      still edit an unlinked Person's email.
--   C. accepting an invitation sent to an overridden address makes that
--      address the Person's email.
--   D. a login email changed through the Auth admin path follows onto
--      profiles and people.
--   E. a linked login can't start a self-service email change; an unlinked
--      one still can.
-- Uses the seed church Riverside and its owner 1111…; everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/accepted-email-primary.sql
begin;

create temporary table sec13_fx (k text primary key, id uuid) on commit drop;
grant select on sec13_fx to authenticated, service_role;
insert into sec13_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('linked_user', gen_random_uuid()),
  ('invitee_user', gen_random_uuid()),
  ('loner', gen_random_uuid()),
  ('linked_person', gen_random_uuid()),
  ('unlinked_person', gen_random_uuid()),
  ('invited_person', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from sec13_fx where k = p $$;
create or replace function pg_temp.email_of(p text) returns text language sql stable as
  $$ select email from public.people where id = pg_temp.fx(p) $$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_hint text, p_label text)
returns void language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  raise exception '%: expected % but it succeeded', p_label, p_state;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  if v_state <> p_state or (p_hint is not null and v_hint is distinct from p_hint) then
    raise exception '%: expected %/% but got %/% (%)', p_label, p_state, p_hint, v_state, v_hint, sqlerrm;
  end if;
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.fx(k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, 'x', now(), '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now()
  from (values ('linked_user', 'Sec13.Linked@Example.test'), ('invitee_user', 'sec13.accepted@example.test'),
               ('loner', 'sec13.loner@example.test')) v(k, e);

-- ============================================ A. linking copies the login email
insert into public.people (id, organization_id, first_name, last_name, email, profile_id) values
  (pg_temp.fx('linked_person'), pg_temp.fx('org'), 'Lin', 'Ked', 'typo.roster@example.test', pg_temp.fx('linked_user')),
  (pg_temp.fx('unlinked_person'), pg_temp.fx('org'), 'Un', 'Linked', 'unlinked@example.test', null);
-- The Person exists first, so the membership does not create a second one.
insert into public.organization_members (organization_id, user_id, role, status)
values (pg_temp.fx('org'), pg_temp.fx('linked_user'), 'member', 'active');
do $$ begin
  if pg_temp.email_of('linked_person') <> 'sec13.linked@example.test' then
    raise exception 'A: linked person email is % instead of the login email', pg_temp.email_of('linked_person');
  end if;
end $$;

-- ============================================ B. owner edits
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select pg_temp.expect_error(format(
  'update public.people set email = ''hijack@example.test'' where id = %L', pg_temp.fx('linked_person')),
  'PT409', 'person_email_locked', 'B1 owner changes a linked person''s email');
do $$
declare n integer;
begin
  update public.people set city = 'Still editable' where id = pg_temp.fx('linked_person');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B2 owner could not edit a linked person''s other fields'; end if;
  -- Re-sending the same email (as the person form does) is not a change.
  update public.people set email = 'sec13.linked@example.test', city = 'Same email' where id = pg_temp.fx('linked_person');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'B3 re-sending the unchanged email was refused'; end if;
  update public.people set email = 'corrected@example.test' where id = pg_temp.fx('unlinked_person');
  if pg_temp.email_of('unlinked_person') <> 'corrected@example.test' then
    raise exception 'B4 owner could not edit an unlinked person''s email';
  end if;
end $$;
reset role;

-- ============================================ C. the accepted address wins
insert into public.people (id, organization_id, first_name, last_name, email)
values (pg_temp.fx('invited_person'), pg_temp.fx('org'), 'In', 'Vited', 'old.roster@example.test');
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, created_by, expires_at)
values (pg_temp.fx('org'), pg_temp.fx('invited_person'), 'sec13.accepted@example.test', 'member',
        'sec13-invitation-token-hash', pg_temp.fx('owner'), now() + interval '7 days');
set local role service_role;
do $$
declare v_status text;
begin
  select out_status into v_status from public.accept_person_invitation('sec13-invitation-token-hash', pg_temp.fx('invitee_user'));
  if v_status <> 'linked' then raise exception 'C1 accept returned %', v_status; end if;
end $$;
reset role;
do $$ begin
  if pg_temp.email_of('invited_person') <> 'sec13.accepted@example.test' then
    raise exception 'C2 accepted person email is % instead of the accepted address', pg_temp.email_of('invited_person');
  end if;
end $$;

-- ============================================ D. admin email change follows
update auth.users set email = 'sec13.renamed@example.test' where id = pg_temp.fx('linked_user');
do $$ begin
  if pg_temp.email_of('linked_person') <> 'sec13.renamed@example.test' then
    raise exception 'D1 people.email did not follow the login email';
  end if;
  if (select email from public.profiles where id = pg_temp.fx('linked_user')) <> 'sec13.renamed@example.test' then
    raise exception 'D2 profiles.email did not follow the login email';
  end if;
end $$;

-- ============================================ E. self-service change blocked
select pg_temp.expect_error(format(
  'update auth.users set email_change = ''elsewhere@example.test'' where id = %L', pg_temp.fx('linked_user')),
  '42501', 'email_change_locked', 'E1 linked login starts an email change');
do $$ begin
  update auth.users set email_change = 'loner.new@example.test' where id = pg_temp.fx('loner');
  update auth.users set email_change = '' where id = pg_temp.fx('loner');
end $$;

select 'accepted-email-primary: all sections passed' as result;
rollback;
