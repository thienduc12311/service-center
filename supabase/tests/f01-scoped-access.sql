-- F01 scoped access, private preparation, response ownership and extensions.
-- Run against a seeded local database:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/f01-scoped-access.sql
-- Everything runs inside one transaction and is rolled back.
--
-- Cast (seed): 1111 owner, 2222 Jordan scheduler (legacy), 3333 Sam member,
-- 4444 Riley member, 5555 Morgan member. Teams: c1 Worship Band ("Band"),
-- c2 Production, c3 Hospitality ("Hosts"), all in service type b1.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select, insert on fx to authenticated, service_role;

insert into fx values
  ('org',   'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st',    'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band',  'cccccccc-0000-4000-8000-000000000001'),
  ('prod',  'cccccccc-0000-4000-8000-000000000002'),
  ('hosts', 'cccccccc-0000-4000-8000-000000000003'),
  ('plan',  gen_random_uuid()),
  ('st2',   gen_random_uuid());

insert into public.plans (id, organization_id, service_type_id, title, service_date, status)
values ((select id from fx where k = 'plan'), (select id from fx where k = 'org'), (select id from fx where k = 'st'),
        'F01 fixture', now() + interval '20 days', 'published');
insert into public.service_types (id, organization_id, name)
values ((select id from fx where k = 'st2'), (select id from fx where k = 'org'), 'F01 Youth');

-- A Hosts assignment and a Band assignment someone else made.
insert into public.assignments (plan_id, user_id, team_id, status, created_by)
values ((select id from fx where k = 'plan'), '55555555-5555-4555-8555-555555555555', (select id from fx where k = 'hosts'), 'unconfirmed', '11111111-1111-4111-8111-111111111111');
insert into fx select 'hosts_assignment', id from public.assignments
 where plan_id = (select id from fx where k = 'plan') and team_id = (select id from fx where k = 'hosts');

-- Riley leads Band only.
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by) values
  ((select id from fx where k = 'org'), '44444444-4444-4444-8444-444444444444', 'scheduling.manage', 'team', (select id from fx where k = 'band'), '11111111-1111-4111-8111-111111111111'),
  ((select id from fx where k = 'org'), '44444444-4444-4444-8444-444444444444', 'teams.manage', 'team', (select id from fx where k = 'band'), '11111111-1111-4111-8111-111111111111');

-- =============================================================== Pass A ====
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

do $$
declare
  v_plan uuid := (select id from fx where k = 'plan');
  v_rows int;
begin
  -- Band: allowed.
  if not public.can_schedule_on_plan(v_plan, (select id from fx where k = 'band')) then
    raise exception 'Band leader cannot schedule Band';
  end if;
  insert into public.assignments (plan_id, user_id, team_id, created_by)
  values (v_plan, '33333333-3333-4333-8333-333333333333', (select id from fx where k = 'band'), (select auth.uid()));

  -- Hosts: denied directly, through the RPC, and by update/delete.
  begin
    insert into public.assignments (plan_id, user_id, team_id)
    values (v_plan, '33333333-3333-4333-8333-333333333333', (select id from fx where k = 'hosts'));
    raise exception 'Band leader inserted a Hosts assignment';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.schedule_plan_assignments(v_plan,
      jsonb_build_array(jsonb_build_object('user_id', '33333333-3333-4333-8333-333333333333', 'team_id', (select id from fx where k = 'hosts'))),
      false);
    raise exception 'Band leader scheduled Hosts through the RPC';
  exception when insufficient_privilege then null;
  end;
  update public.assignments set notes = 'hijacked' where id = (select id from fx where k = 'hosts_assignment');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Band leader edited a Hosts assignment'; end if;
  delete from public.assignments where id = (select id from fx where k = 'hosts_assignment');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Band leader deleted a Hosts assignment'; end if;

  -- Moving a Band assignment onto Hosts is refused by WITH CHECK.
  begin
    update public.assignments set team_id = (select id from fx where k = 'hosts')
     where plan_id = v_plan and team_id = (select id from fx where k = 'band');
    raise exception 'Band leader moved an assignment onto Hosts';
  exception when insufficient_privilege then null;
  end;

  -- Team settings: Band yes, Hosts no; Band cannot be re-homed or deleted.
  update public.teams set description = 'Band notes' where id = (select id from fx where k = 'band');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Band leader could not edit Band'; end if;
  update public.teams set description = 'x' where id = (select id from fx where k = 'hosts');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Band leader edited Hosts'; end if;
  begin
    update public.teams set service_type_id = (select id from fx where k = 'st2') where id = (select id from fx where k = 'band');
    raise exception 'Band leader re-homed Band into another service type';
  exception when insufficient_privilege then null;
  end;
  delete from public.teams where id = (select id from fx where k = 'band');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Band leader deleted Band'; end if;

  -- No plan content, library or grant administration.
  update public.plans set notes = 'x' where id = v_plan;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Band leader edited plan content'; end if;
  begin
    insert into public.plan_items (plan_id, title) values (v_plan, 'x');
    raise exception 'Band leader added a plan item';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.songs (organization_id, title) values ((select id from fx where k = 'org'), 'x');
    raise exception 'Band leader added a song (library is never implied by a team)';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.access_grants (organization_id, user_id, capability, scope_type, created_by)
    values ((select id from fx where k = 'org'), '44444444-4444-4444-8444-444444444444', 'plans.edit', 'organization', (select auth.uid()));
    raise exception 'Band leader issued themself a grant';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.replace_scope_grants((select id from fx where k = 'org'), 'team', (select id from fx where k = 'band'), '[]');
    raise exception 'Band leader administered grants';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.explain_capability((select id from fx where k = 'org'), '22222222-2222-4222-8222-222222222222', 'plans.edit');
    raise exception 'member read someone else''s access';
  exception when insufficient_privilege then null;
  end;

  -- Own explanation: why Band is allowed and Hosts is not.
  if not (public.explain_capability((select id from fx where k = 'org'), (select auth.uid()), 'scheduling.manage',
            (select id from fx where k = 'st'), (select id from fx where k = 'band')) ->> 'allowed')::boolean then
    raise exception 'explanation denies Band';
  end if;
  if public.explain_capability((select id from fx where k = 'org'), (select auth.uid()), 'scheduling.manage',
       (select id from fx where k = 'st'), (select id from fx where k = 'hosts')) ->> 'denial' <> 'grant_outside_scope' then
    raise exception 'explanation does not say why Hosts is denied';
  end if;
  -- Conflict checks are a scheduler tool; a plain member may not call them.
end $$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  begin
    perform * from public.scheduling_conflicts((select id from fx where k = 'org'), now(), now() + interval '1 year');
    raise exception 'member read blockout reasons through scheduling_conflicts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Legacy scheduler keeps everything; scoping them takes it away; a service
-- type grant gives back exactly that service type.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if not public.has_capability((select id from fx where k = 'org'), 'plans.edit', (select id from fx where k = 'st2')) then
    raise exception 'legacy scheduler lost plan editing';
  end if;
end $$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
update public.organization_members set access_mode = 'scoped'
 where organization_id = (select id from fx where k = 'org') and user_id = '22222222-2222-4222-8222-222222222222';
select 1 from public.replace_scope_grants((select id from fx where k = 'org'), 'service_type', (select id from fx where k = 'st'),
  jsonb_build_array(jsonb_build_object('user_id', '22222222-2222-4222-8222-222222222222', 'capability', 'plans.edit'),
                    jsonb_build_object('user_id', '22222222-2222-4222-8222-222222222222', 'capability', 'scheduling.manage')));
do $$
begin
  -- Ceiling: a member-level capability cannot be granted at a team scope.
  begin
    perform public.replace_scope_grants((select id from fx where k = 'org'), 'team', (select id from fx where k = 'band'),
      jsonb_build_array(jsonb_build_object('user_id', '33333333-3333-4333-8333-333333333333', 'capability', 'people.view_private')));
    raise exception 'people.view_private was granted at team scope';
  exception when check_violation then null;
  end;
  -- Grants only for active members of this organization.
  begin
    perform public.replace_scope_grants((select id from fx where k = 'org'), 'organization', null,
      jsonb_build_array(jsonb_build_object('user_id', gen_random_uuid(), 'capability', 'songs.manage')));
    raise exception 'granted to a non-member';
  exception when invalid_parameter_value then null;
  end;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if not public.has_capability((select id from fx where k = 'org'), 'plans.edit', (select id from fx where k = 'st')) then
    raise exception 'scoped scheduler lost their granted service type';
  end if;
  if public.has_capability((select id from fx where k = 'org'), 'plans.edit', (select id from fx where k = 'st2')) then
    raise exception 'scoped scheduler kept another service type';
  end if;
  if public.has_capability((select id from fx where k = 'org'), 'songs.manage') then
    raise exception 'scoped scheduler kept the song library';
  end if;
  begin
    update public.plans set service_type_id = (select id from fx where k = 'st2') where id = (select id from fx where k = 'plan');
    raise exception 'plan moved into a service type the caller cannot edit';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Revocation takes effect on the next statement.
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select 1 from public.replace_scope_grants((select id from fx where k = 'org'), 'team', (select id from fx where k = 'band'), '[]');
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
begin
  if public.can_schedule_on_plan((select id from fx where k = 'plan'), (select id from fx where k = 'band')) then
    raise exception 'revoked grant still authorizes';
  end if;
end $$;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select 1 from public.replace_scope_grants((select id from fx where k = 'org'), 'team', (select id from fx where k = 'band'),
  jsonb_build_array(jsonb_build_object('user_id', '44444444-4444-4444-8444-444444444444', 'capability', 'scheduling.manage'),
                    jsonb_build_object('user_id', '44444444-4444-4444-8444-444444444444', 'capability', 'teams.manage')));
reset role;

-- =============================================================== Pass B ====
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

-- Riley prepares Morgan for Band, asking to notify (prepared rows never are).
insert into fx
select 'prepared', id from public.schedule_plan_assignments(
  (select id from fx where k = 'plan'),
  jsonb_build_array(jsonb_build_object('user_id', '55555555-5555-4555-8555-555555555555', 'team_id', (select id from fx where k = 'band'))),
  true, 'f01-test-prepare', 'prepared');

do $$
declare v_rows int;
begin
  if (select visibility from public.assignments where id = (select id from fx where k = 'prepared')) <> 'prepared' then
    raise exception 'row is not prepared';
  end if;
  if (select response_owner_id from public.assignments where id = (select id from fx where k = 'prepared'))
     <> '44444444-4444-4444-8444-444444444444' then
    raise exception 'response owner did not default to the scheduling actor';
  end if;
  if exists (select 1 from public.delivery_effects where effect_key = 'f01-test-prepare') then
    raise exception 'a prepared request was enqueued';
  end if;
  -- Release only through the release function.
  begin
    update public.assignments set visibility = 'released', released_at = now() where id = (select id from fx where k = 'prepared');
    raise exception 'released directly without the release function';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The recipient and other members cannot find it anywhere.
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
declare v_rows int;
begin
  if exists (select 1 from public.assignments where id = (select id from fx where k = 'prepared')) then
    raise exception 'recipient can read their prepared request';
  end if;
  if (select count(*) from public.assignments a where a.plan_id = (select id from fx where k = 'plan')
        and a.team_id = (select id from fx where k = 'band') and a.user_id = (select auth.uid())) <> 0 then
    raise exception 'recipient counts include the prepared request';
  end if;
  if exists (select 1 from public.respond_to_own_assignment((select id from fx where k = 'prepared'), 'confirmed', 'unconfirmed')) then
    raise exception 'recipient answered a prepared request';
  end if;
  update public.assignments set status = 'confirmed' where id = (select id from fx where k = 'prepared');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'recipient updated a prepared request directly'; end if;
end $$;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.assignments where id = (select id from fx where k = 'prepared')) then
    raise exception 'another member can read a prepared request';
  end if;
end $$;
reset role;

-- The respond link path (service role) does not answer prepared rows.
insert into public.assignment_notifications (organization_id, plan_id, user_id, email, token_hash, expires_at)
values ((select id from fx where k = 'org'), (select id from fx where k = 'plan'), '55555555-5555-4555-8555-555555555555',
        'morgan@example.com', 'f01-test-token', now() + interval '1 day');
set local role service_role;
set local request.jwt.claim.sub = '';
select outcome from public.respond_via_assignment_link('f01-test-token', 'confirmed');
reset role;
do $$
begin
  if (select status from public.assignments where id = (select id from fx where k = 'prepared')) <> 'unconfirmed' then
    raise exception 'respond link answered a prepared request';
  end if;
  if (select status from public.assignments where id = (select id from fx where k = 'hosts_assignment')) <> 'confirmed' then
    raise exception 'respond link did not answer the released Hosts request';
  end if;
end $$;

-- Reassigning the owner: never to someone who cannot schedule it.
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
begin
  begin
    perform public.set_assignment_response_owner(array[(select id from fx where k = 'prepared')], '33333333-3333-4333-8333-333333333333');
    raise exception 'owner reassigned to a plain member';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_assignment_response_owner(array[(select id from fx where k = 'hosts_assignment')], '44444444-4444-4444-8444-444444444444');
    raise exception 'Band leader reassigned a Hosts request';
  exception when no_data_found then null;
  end;
end $$;
select 1 from public.set_assignment_response_owner(array[(select id from fx where k = 'prepared')], '11111111-1111-4111-8111-111111111111');
do $$
begin
  if (select count(*) from public.assignment_owner_changes where assignment_id = (select id from fx where k = 'prepared')
        and previous_owner_id = '44444444-4444-4444-8444-444444444444'
        and new_owner_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'owner change was not audited';
  end if;
end $$;

-- Release exactly the reviewed row, with its effect, once.
select 1 from public.release_plan_assignments((select id from fx where k = 'plan'), array[(select id from fx where k = 'prepared')], true, 'f01-test-release');
do $$
begin
  if (select count(*) from public.release_plan_assignments((select id from fx where k = 'plan'),
        array[(select id from fx where k = 'prepared')], true, 'f01-test-release')) <> 0 then
    raise exception 'a repeated release released again';
  end if;
  begin
    perform public.release_plan_assignments((select id from fx where k = 'plan'), array[(select id from fx where k = 'hosts_assignment')], false, null);
    raise exception 'Band leader released a Hosts request';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.assignments set visibility = 'prepared' where id = (select id from fx where k = 'prepared');
    raise exception 'a released request was made private again';
  exception when sqlstate 'PT409' then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.delivery_effects where effect_key = 'f01-test-release') <> 1 then
    raise exception 'release did not record exactly one effect';
  end if;
  if (select array_agg(distinct d.recipient_id) from public.deliveries d
        join public.delivery_effects e on e.id = d.effect_id where e.effect_key = 'f01-test-release')
     <> array['55555555-5555-4555-8555-555555555555'::uuid] then
    raise exception 'release effect is not for the recipient only';
  end if;
end $$;

-- Morgan declines; the update goes to the response owner (the owner), not
-- the leader who scheduled it, and the reason is visible to schedulers of
-- Band only.
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
select 1 from public.respond_to_own_assignment((select id from fx where k = 'prepared'), 'declined', 'unconfirmed', 'Away');
reset role;
do $$
begin
  if (select array_agg(distinct d.recipient_id) from public.deliveries d
        join public.delivery_effects e on e.id = d.effect_id
       where e.template = 'scheduler_response' and (select id from fx where k = 'prepared') = any(e.assignment_ids))
     <> array['11111111-1111-4111-8111-111111111111'::uuid] then
    raise exception 'answer did not route to the response owner';
  end if;
end $$;
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, created_by)
values ((select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333', 'scheduling.manage', 'team', (select id from fx where k = 'hosts'), '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.assignment_responses where assignment_id = (select id from fx where k = 'prepared')) then
    raise exception 'a Hosts leader read a Band decline reason';
  end if;
end $$;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
begin
  if not exists (select 1 from public.assignment_responses where assignment_id = (select id from fx where k = 'prepared')
                   and response_note = 'Away') then
    raise exception 'the Band leader cannot read the Band decline reason';
  end if;
end $$;
reset role;

-- Private person details. MOB-005 guarantees that an organization member
-- already has exactly one Person, so enrich that stable row rather than
-- creating a second roster identity.
update public.people
   set first_name = 'Morgan', email = 'morgan@example.com', phone = '555-0100', medical_note = 'Allergy'
 where organization_id = (select id from fx where k = 'org')
   and profile_id = '55555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.people where profile_id = '55555555-5555-4555-8555-555555555555') then
    raise exception 'a member read another person''s private record';
  end if;
  if not exists (select 1 from public.people_directory where profile_id = '55555555-5555-4555-8555-555555555555') then
    raise exception 'the directory projection hides the person''s name';
  end if;
  if exists (select 1 from public.member_contacts((select id from fx where k = 'org'), array['55555555-5555-4555-8555-555555555555'::uuid])) then
    raise exception 'a member read another member''s contact details';
  end if;
  if not exists (select 1 from public.member_contacts((select id from fx where k = 'org'), array['33333333-3333-4333-8333-333333333333'::uuid])) then
    raise exception 'a member cannot read their own contact details';
  end if;
  begin
    perform email from public.profiles where id = '55555555-5555-4555-8555-555555555555';
    raise exception 'profile email selectable by API roles';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  -- Scoped Jordan has no people.view_private: no private record.
  if exists (select 1 from public.people where profile_id = '55555555-5555-4555-8555-555555555555') then
    raise exception 'scoped scheduler read a private record';
  end if;
  begin
    perform medical_note from public.people;
    raise exception 'medical note selectable by API roles';
  exception when insufficient_privilege then null;
  end;
  if public.person_medical_note((select id from public.people_directory where profile_id = '55555555-5555-4555-8555-555555555555')) is not null then
    raise exception 'non-admin read a medical note';
  end if;
end $$;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  if public.person_medical_note((select id from public.people where profile_id = '55555555-5555-4555-8555-555555555555')) <> 'Allergy' then
    raise exception 'admin cannot read the medical note';
  end if;
end $$;
reset role;

-- =============================================================== Pass C ====
-- Folders: same-org only, cycle-safe, inherited grants with previewed moves.
insert into fx values ('f_top', gen_random_uuid()), ('f_child', gen_random_uuid()), ('other_org', gen_random_uuid());
insert into public.organizations (id, name, slug) values ((select id from fx where k = 'other_org'), 'Other', 'f01-other-org');
insert into public.service_type_folders (id, organization_id, name) values
  ((select id from fx where k = 'f_top'), (select id from fx where k = 'org'), 'Campus A');
insert into public.service_type_folders (id, organization_id, parent_id, name) values
  ((select id from fx where k = 'f_child'), (select id from fx where k = 'org'), (select id from fx where k = 'f_top'), 'Youth');
do $$
begin
  begin
    insert into public.service_type_folders (organization_id, parent_id, name)
    values ((select id from fx where k = 'other_org'), (select id from fx where k = 'f_top'), 'Cross-tenant');
    raise exception 'a folder was placed under another organization''s folder';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.access_grants (organization_id, user_id, capability, scope_type, folder_id)
    values ((select id from fx where k = 'other_org'), '44444444-4444-4444-8444-444444444444', 'plans.edit', 'folder', (select id from fx where k = 'f_top'));
    raise exception 'a grant named another organization''s folder';
  exception when foreign_key_violation then null;
  end;
end $$;

update public.service_types set folder_id = (select id from fx where k = 'f_child') where id = (select id from fx where k = 'st2');
insert into public.access_grants (organization_id, user_id, capability, scope_type, folder_id)
values ((select id from fx where k = 'org'), '44444444-4444-4444-8444-444444444444', 'plans.edit', 'folder', (select id from fx where k = 'f_top'));

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
begin
  if not public.has_capability((select id from fx where k = 'org'), 'plans.edit', (select id from fx where k = 'st2')) then
    raise exception 'folder grant does not inherit to a nested service type';
  end if;
  if not exists (select 1 from public.my_effective_access((select id from fx where k = 'org'))
                  where capability = 'plans.edit' and scope_type = 'service_type'
                    and scope_id = (select id from fx where k = 'st2') and source = 'grant:folder') then
    raise exception 'effective access does not list the inherited service type';
  end if;
  -- Folder structure is administrator-only.
  begin
    perform public.move_service_type_folder((select id from fx where k = 'f_child'), null, null, true);
    raise exception 'a leader moved a folder';
  exception when no_data_found then null;
  end;
end $$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare v_rev bigint;
begin
  begin
    perform public.move_service_type_folder((select id from fx where k = 'f_top'), (select id from fx where k = 'f_child'), null, true);
    raise exception 'a folder moved inside its own child';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.service_type_folders set parent_id = null where id = (select id from fx where k = 'f_child');
    raise exception 'a folder was re-parented without the move function';
  exception when insufficient_privilege then null;
  end;
  -- Moving Youth out of Campus A would silently drop Riley's inherited access.
  if not exists (select 1 from public.preview_folder_move((select id from fx where k = 'f_child'), null)
                  where user_id = '44444444-4444-4444-8444-444444444444' and change = 'lose'
                    and service_type_id = (select id from fx where k = 'st2')) then
    raise exception 'preview does not show the lost inherited access';
  end if;
  begin
    perform public.move_service_type_folder((select id from fx where k = 'f_child'), null, null, false);
    raise exception 'an access-changing move ran without acknowledgement';
  exception when sqlstate 'PT409' then null;
  end;
  select revision into v_rev from public.service_type_folders where id = (select id from fx where k = 'f_child');
  begin
    perform public.move_service_type_folder((select id from fx where k = 'f_child'), null, v_rev + 7, true);
    raise exception 'a stale revision moved the folder';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.move_service_type_folder((select id from fx where k = 'f_child'), null, v_rev, true);
end $$;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
begin
  if public.has_capability((select id from fx where k = 'org'), 'plans.edit', (select id from fx where k = 'st2')) then
    raise exception 'inherited access survived moving the folder out';
  end if;
end $$;

-- Copying a service type copies settings and team links, never people/grants.
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select 1 from public.replace_scope_grants((select id from fx where k = 'org'), 'service_type', (select id from fx where k = 'st'),
  jsonb_build_array(jsonb_build_object('user_id', '22222222-2222-4222-8222-222222222222', 'capability', 'plans.edit')));
insert into fx select 'st_copy', public.copy_service_type((select id from fx where k = 'st'), 'F01 Copy', true);
do $$
begin
  if exists (select 1 from public.access_grants where service_type_id = (select id from fx where k = 'st_copy')) then
    raise exception 'copying a service type copied grants';
  end if;
  if (select count(*) from public.service_type_teams where service_type_id = (select id from fx where k = 'st_copy'))
     <> (select count(*) from public.service_type_teams where service_type_id = (select id from fx where k = 'st')) then
    raise exception 'copying a service type did not copy its team associations';
  end if;
end $$;
update public.service_types set archived_at = now() where id = (select id from fx where k = 'st_copy');
reset role;

-- Tag-derived candidates: computed on read; history untouched.
insert into fx select 'tagged_person', p.id from public.people p where p.profile_id = '55555555-5555-4555-8555-555555555555';
insert into public.team_tag_rules (team_id, organization_id, tag) values ((select id from fx where k = 'prod'), (select id from fx where k = 'org'), 'camera');
insert into public.person_tags (organization_id, person_id, tag) values ((select id from fx where k = 'org'), (select id from fx where k = 'tagged_person'), 'camera');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  if not exists (select 1 from public.team_candidates((select id from fx where k = 'prod'))
                  where profile_id = '55555555-5555-4555-8555-555555555555' and source = 'tag') then
    raise exception 'tag rule did not make the person a candidate';
  end if;
end $$;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  begin
    perform * from public.team_candidates((select id from fx where k = 'prod'));
    raise exception 'a member listed candidates';
  exception when no_data_found then null;
  end;
end $$;
reset role;
delete from public.person_tags where person_id = (select id from fx where k = 'tagged_person');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  if exists (select 1 from public.team_candidates((select id from fx where k = 'prod'))
              where profile_id = '55555555-5555-4555-8555-555555555555' and source = 'tag') then
    raise exception 'removing the tag did not revoke candidacy';
  end if;
  if not exists (select 1 from public.assignments where id = (select id from fx where k = 'prepared')) then
    raise exception 'a tag change rewrote history';
  end if;
end $$;
reset role;

-- Related-team visibility (organization opts in to team-restricted rosters).
update public.organizations set assignment_visibility = 'teams' where id = (select id from fx where k = 'org');
delete from public.access_grants where user_id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  -- Sam is on Band only: sees Band, not Hosts.
  if exists (select 1 from public.assignments where id = (select id from fx where k = 'hosts_assignment')) then
    raise exception 'restricted roster still shows another team';
  end if;
  if not exists (select 1 from public.assignments a where a.plan_id = (select id from fx where k = 'plan')
                   and a.team_id = (select id from fx where k = 'band')) then
    raise exception 'restricted roster hides the member''s own team';
  end if;
end $$;
reset role;
insert into public.team_related_visibility (team_id, related_team_id, organization_id)
values ((select id from fx where k = 'band'), (select id from fx where k = 'hosts'), (select id from fx where k = 'org')),
       ((select id from fx where k = 'hosts'), (select id from fx where k = 'prod'), (select id from fx where k = 'org'));
insert into public.assignments (plan_id, user_id, team_id, created_by)
values ((select id from fx where k = 'plan'), '44444444-4444-4444-8444-444444444444', (select id from fx where k = 'prod'), '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if not exists (select 1 from public.assignments where id = (select id from fx where k = 'hosts_assignment')) then
    raise exception 'related team is not visible';
  end if;
  -- Not transitive: Band -> Hosts -> Production does not show Production.
  if exists (select 1 from public.assignments a where a.plan_id = (select id from fx where k = 'plan')
               and a.team_id = (select id from fx where k = 'prod')) then
    raise exception 'related-team visibility is transitive';
  end if;
end $$;
reset role;
delete from public.team_related_visibility where team_id = (select id from fx where k = 'band');
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.assignments where id = (select id from fx where k = 'hosts_assignment')) then
    raise exception 'removing the relation did not revoke visibility';
  end if;
end $$;
reset role;
update public.organizations set assignment_visibility = 'organization' where id = (select id from fx where k = 'org');

-- Secure eligibility: fails closed when missing or expired.
update public.teams set requires_eligibility = true, eligibility_kind = 'background_check' where id = (select id from fx where k = 'hosts');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  begin
    insert into public.assignments (plan_id, user_id, team_id)
    values ((select id from fx where k = 'plan'), '33333333-3333-4333-8333-333333333333', (select id from fx where k = 'hosts'));
    raise exception 'scheduled onto a secure team without evidence';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.team_memberships (team_id, user_id) values ((select id from fx where k = 'hosts'), '33333333-3333-4333-8333-333333333333');
    raise exception 'joined a secure team without evidence';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.person_eligibility_records (organization_id, user_id, kind, status, provider, verified_at, expires_at, recorded_by)
values ((select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333', 'background_check', 'clear', 'manual',
        now() - interval '400 days', now() - interval '35 days', (select auth.uid()));
do $$
begin
  begin
    insert into public.assignments (plan_id, user_id, team_id)
    values ((select id from fx where k = 'plan'), '33333333-3333-4333-8333-333333333333', (select id from fx where k = 'hosts'));
    raise exception 'scheduled onto a secure team with expired evidence';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.person_eligibility_records (organization_id, user_id, kind, status, provider, verified_at, expires_at, recorded_by)
values ((select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333', 'background_check', 'clear', 'manual',
        now() - interval '1 day', now() + interval '1 year', (select auth.uid()));
insert into public.assignments (plan_id, user_id, team_id)
values ((select id from fx where k = 'plan'), '33333333-3333-4333-8333-333333333333', (select id from fx where k = 'hosts'));
-- A later "not clear" supersedes it: new scheduling fails closed again.
insert into public.person_eligibility_records (organization_id, user_id, kind, status, provider, verified_at, expires_at, recorded_by)
values ((select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333', 'background_check', 'not_clear', 'manual',
        now(), now() + interval '1 year', (select auth.uid()));
do $$
begin
  begin
    insert into public.team_memberships (team_id, user_id) values ((select id from fx where k = 'hosts'), '33333333-3333-4333-8333-333333333333');
    raise exception 'superseded evidence still allowed membership';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
