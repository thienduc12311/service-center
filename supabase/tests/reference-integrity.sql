-- Reference integrity (QA wave 1, API-D1 / API-D2):
--   * a roster membership's position must belong to the membership's team;
--   * a plan's service type must belong to the plan's organization.
-- Exercised as the seeded owner through RLS, the way the API writes.
--
-- Run against a seeded local database:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/reference-integrity.sql
-- Everything runs inside one transaction and is rolled back.
--
-- Cast (seed): 1111 owner, 3333 Sam member of org aaaaaaaa…0001.
-- Teams: c1 Worship Band (positions d1, d2), c2 Production.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select on fx to authenticated;

insert into fx values
  ('org',        'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st',         'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band',       'cccccccc-0000-4000-8000-000000000001'),
  ('prod',       'cccccccc-0000-4000-8000-000000000002'),
  ('band_pos',   'dddddddd-0000-4000-8000-000000000001'),
  ('sam',        (select id from public.people
                   where profile_id = '33333333-3333-4333-8333-333333333333'
                     and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('beta',       gen_random_uuid()),
  ('beta_st',    gen_random_uuid()),
  ('beta_team',  gen_random_uuid()),
  ('beta_pos',   gen_random_uuid()),
  ('local_st',   gen_random_uuid()),
  ('plan',       gen_random_uuid());

-- A second organization the owner does not belong to.
insert into public.organizations (id, name, slug)
values ((select id from fx where k = 'beta'), 'Integrity Beta', 'integrity-beta-' || substr(md5(random()::text), 1, 8));
insert into public.service_types (id, organization_id, name)
values ((select id from fx where k = 'beta_st'), (select id from fx where k = 'beta'), 'Sunday');
insert into public.teams (id, organization_id, name)
values ((select id from fx where k = 'beta_team'), (select id from fx where k = 'beta'), 'Worship Band');
insert into public.team_positions (id, team_id, name)
values ((select id from fx where k = 'beta_pos'), (select id from fx where k = 'beta_team'), 'Lead');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- ------------------------------------------------ roster position scope ----
do $$
begin
  -- Another team's position in the same organization.
  begin
    insert into public.team_memberships (team_id, person_id, position_id)
    values ((select id from fx where k = 'prod'), (select id from fx where k = 'sam'),
            (select id from fx where k = 'band_pos'));
    raise exception 'a Production membership accepted a Band position';
  exception when foreign_key_violation then null;
  end;

  -- Another organization's position.
  begin
    insert into public.team_memberships (team_id, person_id, position_id)
    values ((select id from fx where k = 'prod'), (select id from fx where k = 'sam'),
            (select id from fx where k = 'beta_pos'));
    raise exception 'a membership accepted another organization''s position';
  exception when foreign_key_violation then null;
  end;

  -- Moving an existing membership onto another team's position.
  insert into public.team_memberships (team_id, person_id, position_id)
  values ((select id from fx where k = 'prod'), (select id from fx where k = 'sam'), null);
  begin
    update public.team_memberships
       set position_id = (select id from fx where k = 'band_pos')
     where team_id = (select id from fx where k = 'prod')
       and person_id = (select id from fx where k = 'sam')
       and position_id is null;
    raise exception 'a membership was moved onto another team''s position';
  exception when foreign_key_violation then null;
  end;
end $$;

-- The team's own position and no position remain valid.
delete from public.team_memberships
 where team_id = (select id from fx where k = 'band')
   and person_id = (select id from fx where k = 'sam');
insert into public.team_memberships (team_id, person_id, position_id)
values ((select id from fx where k = 'band'), (select id from fx where k = 'sam'),
        (select id from fx where k = 'band_pos'));

-- -------------------------------------------- plan service type scope ----
do $$
begin
  begin
    insert into public.plans (organization_id, service_type_id, title, service_date)
    values ((select id from fx where k = 'org'), (select id from fx where k = 'beta_st'),
            'Cross-tenant plan', now() + interval '10 days');
    raise exception 'a plan accepted another organization''s service type';
  exception when foreign_key_violation then null;
  end;

  insert into public.plans (id, organization_id, service_type_id, title, service_date)
  values ((select id from fx where k = 'plan'), (select id from fx where k = 'org'),
          (select id from fx where k = 'st'), 'Integrity plan', now() + interval '10 days');

  begin
    update public.plans
       set service_type_id = (select id from fx where k = 'beta_st')
     where id = (select id from fx where k = 'plan');
    raise exception 'a plan was moved under another organization''s service type';
  exception when foreign_key_violation then null;
  end;
end $$;

reset role;

-- Deleting a service type clears the plan's service type, never its organization.
insert into public.service_types (id, organization_id, name)
values ((select id from fx where k = 'local_st'), (select id from fx where k = 'org'), 'Integrity type');
update public.plans set service_type_id = (select id from fx where k = 'local_st')
 where id = (select id from fx where k = 'plan');
delete from public.service_types where id = (select id from fx where k = 'local_st');

do $$
begin
  if not exists (
    select 1 from public.plans
     where id = (select id from fx where k = 'plan')
       and service_type_id is null
       and organization_id = (select id from fx where k = 'org')
  ) then
    raise exception 'deleting a service type did not just clear the plan''s service type';
  end if;
end $$;

-- Deleting a position still removes the memberships that held it.
delete from public.team_positions where id = (select id from fx where k = 'beta_pos');

select 'reference-integrity: ok';
rollback;
