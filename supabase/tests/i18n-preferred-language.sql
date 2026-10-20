-- i18n: people.preferred_language, self-service functions and delivery locale
-- capture, exercised as the real API roles.
-- Run against a seeded local database after the migrations:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/i18n-preferred-language.sql
-- Everything runs inside one transaction and is rolled back.
--
-- Cast (seed): 1111 owner (people.manage), 3333 Sam member, 4444 Riley
-- member, 5555 Morgan member, all in organization aaaa…0001.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select, insert on fx to authenticated, service_role;
insert into fx values
  ('org',       'aaaaaaaa-0000-4000-8000-000000000001'),
  ('owner',     '11111111-1111-4111-8111-111111111111'),
  ('sam',       '33333333-3333-4333-8333-333333333333'),
  ('riley',     '44444444-4444-4444-8444-444444444444'),
  ('morgan',    '55555555-5555-4555-8555-555555555555'),
  ('other_org', gen_random_uuid()),
  ('guest',     gen_random_uuid()),
  ('newbie',    gen_random_uuid()),
  ('effect',    gen_random_uuid());

-- ===================================== registry / constraint agreement =====
-- Must equal LOCALE_DEFINITIONS in packages/shared/src/i18n/locales.ts.
do $$
declare
  v_people text := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'people_preferred_language_check');
  v_deliveries text := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'deliveries_locale_check');
  v_expected text := 'CHECK ((preferred_language = ANY (ARRAY[''en''::text, ''vi''::text])))';
begin
  if v_people is distinct from v_expected then
    raise exception 'people constraint does not match the registry: %', v_people;
  end if;
  if v_deliveries is distinct from replace(v_expected, 'preferred_language', 'locale') then
    raise exception 'deliveries constraint does not match the registry: %', v_deliveries;
  end if;
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'people' and column_name = 'preferred_language') <> 'YES'
     or (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'people' and column_name = 'preferred_language') is not null then
    raise exception 'preferred_language must be nullable without a default';
  end if;
  -- No forced backfill: existing people stay Automatic.
  if exists (select 1 from public.people where preferred_language is not null) then
    raise exception 'existing people were assigned an explicit language';
  end if;
  -- Not exposed in the member-wide directory projection.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'people_directory' and column_name = 'preferred_language') then
    raise exception 'people_directory exposes preferred_language';
  end if;
end $$;

-- Fixtures created as the database owner.
insert into public.organizations (id, name, slug)
values ((select id from fx where k = 'other_org'), 'Other church', 'i18n-other-' || substr(gen_random_uuid()::text, 1, 8));
insert into public.people (id, organization_id, first_name, email)
values ((select id from fx where k = 'guest'), (select id from fx where k = 'org'), 'Lan', 'lan.i18n@example.com');

-- Riley is a legacy member without a linked Person.
update public.people set profile_id = null
 where organization_id = (select id from fx where k = 'org') and profile_id = (select id from fx where k = 'riley');

create temporary table sam_before on commit drop as
  select * from public.people where profile_id = '33333333-3333-4333-8333-333333333333' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ================================================ self-service (member) =====
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  v_org uuid := (select id from fx where k = 'org');
  r record;
  v_rows int;
begin
  select * into r from public.my_language_preference(v_org);
  if r.person_linked is not true or r.preferred_language is not null then
    raise exception 'initial self read: % %', r.person_linked, r.preferred_language;
  end if;

  select * into r from public.set_my_language_preference(v_org, 'vi');
  if r.person_linked is not true or r.preferred_language <> 'vi' then
    raise exception 'self save returned % %', r.person_linked, r.preferred_language;
  end if;
  if (select preferred_language from public.my_language_preference(v_org)) <> 'vi' then
    raise exception 'self save not persisted';
  end if;

  -- Explicit null clears to Automatic; last write wins.
  perform public.set_my_language_preference(v_org, null);
  perform public.set_my_language_preference(v_org, 'en');
  perform public.set_my_language_preference(v_org, 'vi');
  if (select preferred_language from public.my_language_preference(v_org)) <> 'vi' then
    raise exception 'last write did not win';
  end if;

  -- Invalid codes fail in the database too (the API rejects them first).
  begin
    perform public.set_my_language_preference(v_org, 'vi-VN');
    raise exception 'regional tag accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.set_my_language_preference(v_org, 'fr');
    raise exception 'unsupported code accepted';
  exception when sqlstate '22023' then null;
  end;

  -- A church the caller does not belong to reads as not found.
  begin
    perform public.my_language_preference((select id from fx where k = 'other_org'));
    raise exception 'foreign church readable';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.set_my_language_preference((select id from fx where k = 'other_org'), 'vi');
    raise exception 'foreign church writable';
  exception when sqlstate 'P0002' then null;
  end;

  -- The general update policy is not loosened: a member still cannot update
  -- their own Person directly, neither the language nor any other field.
  update public.people set preferred_language = 'en' where profile_id = (select id from fx where k = 'sam');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'member updated own Person directly'; end if;
  update public.people set first_name = 'Mallory', medical_note = 'x' where profile_id = (select id from fx where k = 'sam');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'member updated other Person fields'; end if;

  -- The caller reads their own saved value through the column grant.
  if (select preferred_language from public.people where profile_id = (select id from fx where k = 'sam') and organization_id = v_org) <> 'vi' then
    raise exception 'own Person row not readable';
  end if;
end $$;
reset role;

-- Self-service changed only the language (and updated_at).
do $$
declare
  v_after public.people;
  v_before public.people;
begin
  select * into v_before from sam_before;
  select * into v_after from public.people where id = v_before.id;
  if (to_jsonb(v_after) - 'preferred_language' - 'updated_at') <> (to_jsonb(v_before) - 'preferred_language' - 'updated_at') then
    raise exception 'self-service changed other Person fields';
  end if;
  if v_after.preferred_language <> 'vi' then
    raise exception 'self-service value missing';
  end if;
end $$;

-- ======================================= unrelated and inactive members =====
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
declare
  v_rows int;
begin
  -- Morgan cannot see or change Sam's preference.
  if exists (select 1 from public.people where profile_id = (select id from fx where k = 'sam') and preferred_language is not null) then
    raise exception 'unrelated member read another preference';
  end if;
  update public.people set preferred_language = 'en' where profile_id = (select id from fx where k = 'sam');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'unrelated member changed another preference'; end if;
  -- The self-service function only ever touches the caller's own Person.
  perform public.set_my_language_preference((select id from fx where k = 'org'), 'en');
end $$;
reset role;

do $$
begin
  if (select preferred_language from public.people where profile_id = (select id from fx where k = 'sam')) <> 'vi' then
    raise exception 'another member''s save reached Sam';
  end if;
  if (select preferred_language from public.people where profile_id = (select id from fx where k = 'morgan')) <> 'en' then
    raise exception 'Morgan''s own save missing';
  end if;
end $$;

update public.organization_members set status = 'inactive'
 where organization_id = (select id from fx where k = 'org') and user_id = (select id from fx where k = 'morgan');

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
begin
  begin
    perform public.my_language_preference((select id from fx where k = 'org'));
    raise exception 'inactive member read';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.set_my_language_preference((select id from fx where k = 'org'), 'vi');
    raise exception 'inactive member wrote';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- Anonymous callers cannot execute the functions at all.
set local role anon;
do $$
begin
  begin
    perform public.my_language_preference((select id from fx where k = 'org'));
    raise exception 'anon executed my_language_preference';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ============================================== member without a Person =====
create temporary table people_count on commit drop as select count(*) as n from public.people;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare
  r record;
begin
  select * into r from public.my_language_preference((select id from fx where k = 'org'));
  if r.person_linked is not false or r.preferred_language is not null then
    raise exception 'unlinked read: % %', r.person_linked, r.preferred_language;
  end if;
  select * into r from public.set_my_language_preference((select id from fx where k = 'org'), 'vi');
  if r.person_linked is not false then
    raise exception 'unlinked save reported success';
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.people) <> (select n from people_count) then
    raise exception 'self-service created a Person';
  end if;
end $$;

-- ================================================== manager (people.manage) =====
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_rows int;
begin
  -- A manager sets a no-login Person's language before any invitation.
  update public.people set preferred_language = 'vi' where id = (select id from fx where k = 'guest');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'manager could not set language'; end if;
  -- Managers read it through the existing private-detail access.
  if (select preferred_language from public.people where id = (select id from fx where k = 'guest')) <> 'vi' then
    raise exception 'manager cannot read language';
  end if;
  -- Invalid codes fail at the constraint.
  begin
    update public.people set preferred_language = 'xx' where id = (select id from fx where k = 'guest');
    raise exception 'constraint allowed an unsupported code';
  exception when check_violation then null;
  end;
  -- Managers cannot reach another church's Person.
  update public.people set preferred_language = 'vi' where organization_id = (select id from fx where k = 'other_org');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'manager changed another church'; end if;
end $$;
reset role;

-- ======================================= invitation acceptance keeps it =====
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', (select id from fx where k = 'newbie'), 'authenticated', 'authenticated',
  'lan.i18n@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Lan Tran"}'::jsonb, now(), now());
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at)
values ((select id from fx where k = 'org'), (select id from fx where k = 'guest'), 'lan.i18n@example.com', 'member', 'i18n-token-lan', now() + interval '7 days');

set local role service_role;
do $$
begin
  if (select out_status from public.accept_person_invitation('i18n-token-lan', (select id from fx where k = 'newbie'))) <> 'linked' then
    raise exception 'invitation not accepted';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from fx where k = 'newbie'), true);
do $$
declare
  r record;
begin
  select * into r from public.my_language_preference((select id from fx where k = 'org'));
  if r.person_linked is not true or r.preferred_language <> 'vi' then
    raise exception 'preference lost on invitation acceptance: % %', r.person_linked, r.preferred_language;
  end if;
end $$;
reset role;

-- ================================================ delivery locale capture =====
insert into public.delivery_effects (id, organization_id, effect_key, template)
values ((select id from fx where k = 'effect'), (select id from fx where k = 'org'), 'i18n-test-' || gen_random_uuid(), 'assignment_request');

do $$
declare
  v_org uuid := (select id from fx where k = 'org');
  v_effect uuid := (select id from fx where k = 'effect');
  v_sam uuid := (select id from public.people where profile_id = (select id from fx where k = 'sam') and organization_id = v_org);
  v_owner uuid := (select id from public.people where profile_id = (select id from fx where k = 'owner') and organization_id = v_org);
  v_lan uuid := (select id from fx where k = 'guest');
  v_delivery uuid;
begin
  -- Recipients with different preferences in the same effect.
  insert into public.deliveries (organization_id, effect_id, recipient_person_id, channel) values (v_org, v_effect, v_sam, 'email') returning id into v_delivery;
  if (select locale from public.deliveries where id = v_delivery) <> 'vi' then raise exception 'Vietnamese recipient not captured'; end if;
  insert into public.deliveries (organization_id, effect_id, recipient_person_id, channel) values (v_org, v_effect, v_owner, 'email');
  if (select locale from public.deliveries where effect_id = v_effect and recipient_person_id = v_owner) <> 'en' then
    raise exception 'Automatic recipient not rendered in English';
  end if;

  -- Retries keep the captured language after the preference changes.
  update public.people set preferred_language = 'en' where id = v_sam;
  update public.deliveries set attempts = attempts + 1, status = 'queued' where id = v_delivery;
  if (select locale from public.deliveries where id = v_delivery) <> 'vi' then raise exception 'retry changed the captured locale'; end if;

  -- An explicit locale is kept; an unsupported one is refused.
  insert into public.deliveries (organization_id, effect_id, recipient_person_id, channel, locale) values (v_org, v_effect, v_lan, 'email', 'en');
  if (select locale from public.deliveries where effect_id = v_effect and recipient_person_id = v_lan) <> 'en' then
    raise exception 'explicit locale overwritten';
  end if;
  begin
    insert into public.deliveries (organization_id, effect_id, recipient_person_id, channel, locale) values (v_org, v_effect, v_lan, 'push', 'fr');
    raise exception 'unsupported delivery locale accepted';
  exception when check_violation then null;
  end;
end $$;

select 'i18n-preferred-language: ok';
rollback;
