-- QA wave 8: owner People search matches the contact the list displays.
--   The People list shows a has-login member's login-profile email/phone; the
--   people row may hold a stale email and no phone (the member trigger copies
--   the email once, never the phone). people_owner_search exposes
--   contact_email/contact_phone = coalesce(profile, person) to owners only.
-- Run against a seeded local database with the migration loaded. Rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-people-contact-search.sql
-- (before the migration is applied, paste
--  supabase/migrations/20261127000900_w8_people_contact_search.sql right after `begin;`)
-- Seed: owner 1111 and member 3333 (Sam Rivera) in org aaaa…0001.
begin;

-- Member 3333 changed their login email and added a phone; their People row
-- still has the email copied at join time and no phone.
update public.profiles set email = 'sam.login@example.test', phone = '+1 555 0199'
 where id = '33333333-3333-4333-8333-333333333333';
update public.people set email = 'sam.stale@example.test', phone = null
 where profile_id = '33333333-3333-4333-8333-333333333333' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
-- A no-login person: contact comes from the People row.
insert into public.people (id, organization_id, first_name, last_name, email, phone, address_line1)
values ('f0a7a0a7-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Solo', 'Person', 'solo@example.test', '+1 555 0142', '1 Secret St');
-- Another organization owned by 5555, with its own person.
insert into public.organizations (id, name, slug, timezone)
values ('aaaaaaaa-0000-4000-8000-0000000000b3', 'Other', 'w8-contact-other', 'UTC');
insert into public.organization_members (organization_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-0000000000b3', '55555555-5555-4555-8555-555555555555', 'owner');
insert into public.people (id, organization_id, first_name, email)
values ('f0a7a0a7-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000b3', 'Elsewhere', 'elsewhere@example.test');

-- The view exposes only the listed columns.
do $$ begin
  if exists (select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'people_owner_search'
       and column_name not in ('id','organization_id','profile_id','first_name','last_name','avatar_url',
                               'email','phone','campus','archived_at','sort_name','contact_email','contact_phone')) then
    raise exception 'people_owner_search exposes extra columns';
  end if;
end $$;

-- Owner 1111: search finds what the list shows.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from public.people_owner_search
      where organization_id = v_org and contact_phone ilike '%555 0199%' and sort_name = 'sam rivera') then
    raise exception 'Owner search misses the member phone shown in the list';
  end if;
  if not exists (select 1 from public.people_owner_search
      where organization_id = v_org and contact_email ilike '%sam.login%') then
    raise exception 'Owner search misses the member login email shown in the list';
  end if;
  if exists (select 1 from public.people_owner_search
      where organization_id = v_org and contact_email ilike '%sam.stale%') then
    raise exception 'Owner search matched a stale email the list does not show';
  end if;
  if not exists (select 1 from public.people_owner_search
      where organization_id = v_org and contact_email ilike '%solo@%' and contact_phone ilike '%0142%') then
    raise exception 'Owner search misses a no-login person''s own contact';
  end if;
  if exists (select 1 from public.people_owner_search where organization_id <> v_org) then
    raise exception 'Owner sees another organization''s people';
  end if;
end $$;
reset role;

-- Non-owner member 3333 (even searching for themselves) and the other org's owner: nothing.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if exists (select 1 from public.people_owner_search) then
    raise exception 'Non-owner member reads people_owner_search';
  end if;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$ begin
  if exists (select 1 from public.people_owner_search where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'Other-org owner reads this organization''s people';
  end if;
  if not exists (select 1 from public.people_owner_search where id = 'f0a7a0a7-0000-4000-8000-0000000000d2') then
    raise exception 'Other-org owner cannot read their own people';
  end if;
end $$;
reset role;

-- Inactive owner: nothing.
update public.organization_members set status = 'inactive'
 where organization_id = 'aaaaaaaa-0000-4000-8000-0000000000b3' and user_id = '55555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$ begin
  if exists (select 1 from public.people_owner_search) then
    raise exception 'Inactive owner reads people_owner_search';
  end if;
end $$;
reset role;

-- Anon: no access. Authenticated: read-only.
set local role anon;
do $$ begin
  begin
    perform 1 from public.people_owner_search;
    raise exception 'Anon can read people_owner_search';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  begin
    update public.people_owner_search set contact_email = 'x@example.test' where id = 'f0a7a0a7-0000-4000-8000-0000000000d1';
    raise exception 'people_owner_search is writable';
  exception when insufficient_privilege or feature_not_supported or object_not_in_prerequisite_state then null;
  end;
end $$;
reset role;
rollback;
