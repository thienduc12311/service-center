-- Run after the owner_people_permissions migration against the seeded database.
begin;
-- Exercise each legacy role and explicit grants against the same member.
insert into public.access_grants (organization_id, user_id, capability, scope_type, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
 'people.manage', 'organization', '11111111-1111-4111-8111-111111111111') on conflict do nothing;

do $$
declare
  test_role public.org_role;
  org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  person_user uuid := '33333333-3333-4333-8333-333333333333';
begin
  foreach test_role in array array['member', 'scheduler', 'admin', 'owner']::public.org_role[] loop
    update public.organization_members set role = test_role, access_mode = 'legacy'
      where organization_id = org and user_id = person_user;
    if private.capability_for(person_user, org, 'people.manage') <> (test_role = 'owner')
       or private.capability_anywhere(person_user, org, 'people.view_private') <> (test_role = 'owner') then
      raise exception 'Wrong People capability for %', test_role;
    end if;
    if exists (select 1 from private.effective_access_rows(person_user, org)
       where capability in ('people.manage', 'people.view_private')) <> (test_role = 'owner') then
      raise exception 'Wrong effective People access for %', test_role;
    end if;
  end loop;
  update public.organization_members set role = 'admin'
    where organization_id = org and user_id = person_user;
end;
$$;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare n integer;
begin
  if exists (select id from public.people where profile_id is distinct from (select auth.uid())
    and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'Admin read another person private record';
  end if;
  update public.people set first_name = 'Forbidden' where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Admin changed a person'; end if;
  update public.organization_members set status = 'inactive'
    where user_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Admin changed another member'; end if;
  if not exists (select 1 from public.people_directory where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'Directory no longer visible';
  end if;
end;
$$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare n integer;
begin
  update public.people set campus = campus
    where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and profile_id = '22222222-2222-4222-8222-222222222222';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Owner cannot modify another person'; end if;
  if not exists (select 1 from public.member_contacts('aaaaaaaa-0000-4000-8000-000000000001',
    array['22222222-2222-4222-8222-222222222222']::uuid[])) then
    raise exception 'Owner cannot read another member contact';
  end if;
end;
$$;
rollback;
