-- profiles.email is not writable by API roles, and identity lookups use the
-- confirmed auth.users email (migration 20261130000000).
-- Run against the seeded local database; everything is rolled back:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/profiles-column-grants.sql
-- Seed: Riverside aaaa…0001, owner 1111….
begin;

-- Fixtures: a confirmed user, an unconfirmed signup, and a confirmed joiner.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'b0b0b0b0-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'grant.one@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Grant One"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0b0b0b0-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'grant.unconfirmed@example.com', '', null, '', '', '', '', '{}'::jsonb, '{"full_name":"Not Yet"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0b0b0b0-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'grant.joiner@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Jo Joiner"}'::jsonb, now(), now());

-- Two unlinked roster people in Riverside: one with someone else's address
-- (what a spoofed profile email would point at), one with the joiner's real one.
insert into public.people (id, organization_id, first_name, last_name, email)
values
  ('b0b0b0b0-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Vic', 'Tim', 'victim.roster@example.com'),
  ('b0b0b0b0-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Jo', 'Roster', 'Grant.Joiner@example.com');

create temporary table grants_test (key text primary key, id uuid, email text) on commit drop;
grant select, insert, update on grants_test to authenticated;

-- --------------------------------------------- column grants, as the user --
set local role authenticated;
set local request.jwt.claim.sub = 'b0b0b0b0-0000-4000-8000-000000000001';
do $$
declare
  n int;
begin
  -- Identity and bookkeeping columns are not writable, even on your own row.
  begin
    update public.profiles set email = 'victim@example.org' where id = auth.uid();
    raise exception 'Updated my own profiles.email';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set id = gen_random_uuid() where id = auth.uid();
    raise exception 'Updated my own profiles.id';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set created_at = now() - interval '1 year' where id = auth.uid();
    raise exception 'Updated my own profiles.created_at';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set updated_at = now() - interval '1 year' where id = auth.uid();
    raise exception 'Updated my own profiles.updated_at';
  exception when insufficient_privilege then null;
  end;
  -- Rows come from the signup trigger only.
  begin
    insert into public.profiles (id, email) values (gen_random_uuid(), 'made.up@example.com');
    raise exception 'Inserted a profile';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = auth.uid();
    raise exception 'Deleted my profile';
  exception when insufficient_privilege then null;
  end;

  -- What the profile screen edits still saves (PATCH /me).
  update public.profiles
     set full_name = 'Grant Uno', phone = '+1 555 0100', avatar_url = 'https://example.test/g.png'
   where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Own profile save touched % rows', n; end if;

  -- Someone else's row is still out of reach (RLS).
  update public.profiles set full_name = 'Hijacked' where id = 'b0b0b0b0-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Updated another user''s profile'; end if;

  -- The lookup by email is service-role only.
  begin
    perform public.confirmed_user_id_by_email('grant.one@example.com');
    raise exception 'authenticated ran confirmed_user_id_by_email';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if (select full_name from public.profiles where id = 'b0b0b0b0-0000-4000-8000-000000000001') <> 'Grant Uno'
     or (select email from public.profiles where id = 'b0b0b0b0-0000-4000-8000-000000000001') <> 'grant.one@example.com' then
    raise exception 'Own profile save did not land as expected';
  end if;
  if (select full_name from public.profiles where id = 'b0b0b0b0-0000-4000-8000-000000000003') <> 'Jo Joiner' then
    raise exception 'Another user''s profile changed';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    update public.profiles set full_name = 'Anon' where true;
    raise exception 'anon updated profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.confirmed_user_id_by_email('grant.one@example.com');
    raise exception 'anon ran confirmed_user_id_by_email';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ------------------------------------------ lookup by confirmed email -----

-- Even if a profile copy says otherwise (only a superuser can write it now).
update public.profiles set email = 'spoofed@example.com' where id = 'b0b0b0b0-0000-4000-8000-000000000001';

set local role service_role;
do $$
begin
  if public.confirmed_user_id_by_email('  GRANT.One@Example.COM ') is distinct from 'b0b0b0b0-0000-4000-8000-000000000001' then
    raise exception 'Confirmed email did not resolve (case-insensitive, trimmed)';
  end if;
  if public.confirmed_user_id_by_email('grant.unconfirmed@example.com') is not null then
    raise exception 'An unconfirmed signup was returned';
  end if;
  if public.confirmed_user_id_by_email('spoofed@example.com') is not null then
    raise exception 'A profiles.email value was treated as a login email';
  end if;
  if public.confirmed_user_id_by_email('nobody@example.com') is not null then
    raise exception 'An unknown email resolved';
  end if;
end;
$$;
reset role;

-- ------------------------------------- join request uses the auth email ----

update public.profiles set email = 'victim.roster@example.com' where id = 'b0b0b0b0-0000-4000-8000-000000000003';

set local role authenticated;
set local request.jwt.claim.sub = 'b0b0b0b0-0000-4000-8000-000000000003';
do $$
begin
  insert into grants_test (key, id) values ('request', public.request_to_join_church('riverside', null));
end;
$$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_row record;
begin
  select * into v_row from public.approve_church_join_request((select id from grants_test where key = 'request'));
  insert into grants_test (key, id, email) values ('approved', v_row.out_person_id, v_row.out_email);
end;
$$;
reset role;

do $$
begin
  if (select requester_email from public.church_join_requests
       where id = (select id from grants_test where key = 'request')) <> 'grant.joiner@example.com' then
    raise exception 'requester_email came from profiles, not auth.users';
  end if;
  if (select email from grants_test where key = 'approved') <> 'grant.joiner@example.com' then
    raise exception 'Approval invites % instead of the login email', (select email from grants_test where key = 'approved');
  end if;
  if (select id from grants_test where key = 'approved') <> 'b0b0b0b0-0000-4000-8000-0000000000a2' then
    raise exception 'Approval picked the roster person matching profiles.email';
  end if;
end;
$$;

-- An unconfirmed signup can't ask to join (no confirmed address to invite).
set local role authenticated;
set local request.jwt.claim.sub = 'b0b0b0b0-0000-4000-8000-000000000002';
do $$
begin
  begin
    perform public.request_to_join_church('riverside', null);
    raise exception 'An unconfirmed signup asked to join';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;

-- ----------------------------------------- profiles.email follows login ----

update auth.users set email = 'grant.renamed@example.com' where id = 'b0b0b0b0-0000-4000-8000-000000000001';
do $$
begin
  if (select email from public.profiles where id = 'b0b0b0b0-0000-4000-8000-000000000001') <> 'grant.renamed@example.com' then
    raise exception 'profiles.email did not follow the login email';
  end if;
end;
$$;

rollback;
