-- Run after 20261127000300_w8_team_roster_basic_info. Seed owner 1111, members 3333/4444/5555.
begin;
insert into public.people (id, organization_id, first_name, last_name, email, phone, birthdate, address_line1, city, gender)
values ('f0a7a0a7-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Roster', 'Mate', 'mate@example.test', '+1 555 0100', '1990-04-05', '1 Secret St', 'Hidden', 'female');
insert into public.team_memberships (team_id, person_id)
values ('cccccccc-0000-4000-8000-000000000001', 'f0a7a0a7-0000-4000-8000-0000000000c1');

-- Other organization with member 5555 only.
insert into public.organizations (id, name, slug, timezone)
values ('aaaaaaaa-0000-4000-8000-0000000000b2', 'Other', 'w8-other', 'UTC');
insert into public.organization_members (organization_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-0000000000b2', '55555555-5555-4555-8555-555555555555', 'owner');
delete from public.organization_members
 where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = '55555555-5555-4555-8555-555555555555';
-- Inactive member.
update public.organization_members set status = 'inactive'
 where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = '44444444-4444-4444-8444-444444444444';

-- Non-owner active member (3333): sees basic info, not the rest.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare r record;
begin
  select * into r from public.team_roster_people('aaaaaaaa-0000-4000-8000-000000000001')
   where person_id = 'f0a7a0a7-0000-4000-8000-0000000000c1';
  if not found then raise exception 'Member cannot see teammate'; end if;
  if r.first_name <> 'Roster' or r.last_name <> 'Mate' or r.email <> 'mate@example.test'
     or r.phone <> '+1 555 0100' or r.birthdate <> date '1990-04-05' then
    raise exception 'Wrong basic info: %', r;
  end if;
  -- the function exposes no other private column
  if exists (select 1 from information_schema.parameters
      where specific_schema = 'public' and specific_name like 'team_roster_people%' and parameter_mode = 'OUT'
        and parameter_name not in ('team_id','person_id','first_name','last_name','avatar_url','email','phone','birthdate')) then
    raise exception 'Roster function exposes extra columns';
  end if;
  -- people itself stays owner-only
  if exists (select 1 from public.people where id = 'f0a7a0a7-0000-4000-8000-0000000000c1') then
    raise exception 'Non-owner can read people row';
  end if;
end;
$$;
reset role;

-- Other-org user and inactive member: nothing.
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$ begin
  if exists (select 1 from public.team_roster_people('aaaaaaaa-0000-4000-8000-000000000001')) then
    raise exception 'Other-org user sees roster'; end if;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists (select 1 from public.team_roster_people('aaaaaaaa-0000-4000-8000-000000000001')) then
    raise exception 'Inactive member sees roster'; end if;
end $$;
reset role;

-- Anon: no execute.
set local role anon;
do $$ begin
  begin
    perform * from public.team_roster_people('aaaaaaaa-0000-4000-8000-000000000001');
    raise exception 'Anon can call roster function';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Owner unchanged: full people row and roster rows.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  if not exists (select 1 from public.people where id = 'f0a7a0a7-0000-4000-8000-0000000000c1' and address_line1 = '1 Secret St') then
    raise exception 'Owner lost People access'; end if;
  if not exists (select 1 from public.team_roster_people('aaaaaaaa-0000-4000-8000-000000000001')
      where person_id = 'f0a7a0a7-0000-4000-8000-0000000000c1' and email = 'mate@example.test') then
    raise exception 'Owner cannot see roster info'; end if;
end $$;
reset role;
rollback;
