-- Run after the member_avatars_and_team_rosters migration against the seeded database.
-- Owner 1111, legacy scheduler 2222, member 3333 (made a Production team leader below).
begin;
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
 'teams.manage', 'team', 'cccccccc-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111');

do $$
declare
  org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  band uuid := 'cccccccc-0000-4000-8000-000000000001';
  production uuid := 'cccccccc-0000-4000-8000-000000000002';
begin
  if not private.can_edit_team_roster('11111111-1111-4111-8111-111111111111', band) then
    raise exception 'Owner cannot edit a roster';
  end if;
  if private.can_edit_team_roster('22222222-2222-4222-8222-222222222222', band) then
    raise exception 'Legacy scheduler can still edit a roster';
  end if;
  if not private.can_edit_team_roster('33333333-3333-4333-8333-333333333333', production)
     or private.can_edit_team_roster('33333333-3333-4333-8333-333333333333', band) then
    raise exception 'Team leader roster access is not limited to their team';
  end if;
  if private.can_edit_team_roster('44444444-4444-4444-8444-444444444444', production) then
    raise exception 'Plain member can edit a roster';
  end if;
  -- Admins keep it.
  update public.organization_members set role = 'admin'
    where organization_id = org and user_id = '55555555-5555-4555-8555-555555555555';
  if not private.can_edit_team_roster('55555555-5555-4555-8555-555555555555', band) then
    raise exception 'Admin cannot edit a roster';
  end if;
end;
$$;

-- Scheduler: may read rosters, may not add or remove.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare n integer;
begin
  if not exists (select 1 from public.team_memberships where team_id = 'cccccccc-0000-4000-8000-000000000001') then
    raise exception 'Scheduler can no longer read rosters';
  end if;
  delete from public.team_memberships where team_id = 'cccccccc-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Scheduler removed a team member'; end if;
  begin
    insert into public.team_memberships (team_id, person_id)
    values ('cccccccc-0000-4000-8000-000000000003', '4da49417-cce0-4dd3-b227-75f0d52e8254');
    raise exception 'Scheduler added a team member';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Team leader: adds and removes on their team only.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare n integer; added uuid;
begin
  insert into public.team_memberships (team_id, person_id)
  values ('cccccccc-0000-4000-8000-000000000002', '4da49417-cce0-4dd3-b227-75f0d52e8254')
  returning id into added;
  delete from public.team_memberships where id = added;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Team leader cannot remove from their team'; end if;
  delete from public.team_memberships where team_id = 'cccccccc-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Team leader removed from another team'; end if;
end;
$$;

-- Own avatar: only under users/<self>/, and it follows onto the linked Person.
do $$
begin
  if not private.can_write_avatar_object('users/33333333-3333-4333-8333-333333333333/a.png')
     or private.can_write_avatar_object('users/22222222-2222-4222-8222-222222222222/a.png')
     or private.can_write_avatar_object('orgs/aaaaaaaa-0000-4000-8000-000000000001/a.png')
     or private.can_write_avatar_object('orgs/not-a-uuid/a.png')
     or private.can_write_avatar_object('a.png') then
    raise exception 'Member avatar paths are wrong';
  end if;
  update public.profiles set avatar_url = 'https://example.test/me.png'
   where id = '33333333-3333-4333-8333-333333333333';
end;
$$;
reset role;
do $$
begin
  if exists (select 1 from public.people
     where profile_id = '33333333-3333-4333-8333-333333333333'
       and avatar_url is distinct from 'https://example.test/me.png') then
    raise exception 'Profile avatar did not follow onto the linked Person';
  end if;
end;
$$;

-- Owner (people.manage): any Person's picture under orgs/<org>/.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  if not private.can_write_avatar_object('orgs/aaaaaaaa-0000-4000-8000-000000000001/p.png') then
    raise exception 'Owner cannot upload a Person avatar';
  end if;
end;
$$;
rollback;
