-- copy_service_type_as() and archiving/restoring a service type.
-- Run with the migration applied first, rolled back:
--   { echo "begin;"; cat supabase/migrations/20261201050000_copy_service_type_as.sql;
--     cat supabase/tests/copy-archive-service-type.sql; echo "rollback;"; } |
--     docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 -q
--
-- Cast (seed): 1111 owner, 2222 Jordan scheduler (legacy: organization-wide
-- plans.edit, not an administrator), 3333 Sam member. Teams c1 Band,
-- c2 Production, c3 Hosts in service type b1.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select, insert on fx to authenticated, service_role;

insert into fx values
  ('org',    'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st',     'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band',   'cccccccc-0000-4000-8000-000000000001'),
  ('prod',   'cccccccc-0000-4000-8000-000000000002'),
  ('hosts',  'cccccccc-0000-4000-8000-000000000003'),
  ('folder', gen_random_uuid()),
  ('folder2', gen_random_uuid()),
  ('src',    gen_random_uuid());

-- A source service type inside a folder, served by Band and Hosts, with a
-- service-type grant for Sam that must never be copied.
insert into public.service_type_folders (id, organization_id, name)
values ((select id from fx where k = 'folder'), (select id from fx where k = 'org'), 'Copy suite folder'),
       ((select id from fx where k = 'folder2'), (select id from fx where k = 'org'), 'Copy suite other folder');
insert into public.service_types (id, organization_id, name, description, recurrence, sort_order, folder_id)
values ((select id from fx where k = 'src'), (select id from fx where k = 'org'), 'Copy suite source', 'Source notes', 'weekly', 7,
        (select id from fx where k = 'folder'));
insert into public.service_type_teams (service_type_id, team_id, organization_id)
values ((select id from fx where k = 'src'), (select id from fx where k = 'band'), (select id from fx where k = 'org')),
       ((select id from fx where k = 'src'), (select id from fx where k = 'hosts'), (select id from fx where k = 'org'))
on conflict do nothing;
insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id, created_by)
values ((select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333', 'plans.edit', 'service_type',
        (select id from fx where k = 'src'), '11111111-1111-4111-8111-111111111111');

-- ================================================ Jordan (not an admin) ====
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare
  v_src  uuid := (select id from fx where k = 'src');
  v_copy uuid;
  v_row  public.service_types;
  v_teams uuid[];
begin
  -- Chosen settings and exactly the chosen teams, in the source's folder.
  v_copy := public.copy_service_type_as(v_src, '  Copy suite evening  ', 'Evening notes', 'monthly',
                                        (select id from fx where k = 'folder'),
                                        array[(select id from fx where k = 'prod'), (select id from fx where k = 'prod')]);
  select * into v_row from public.service_types where id = v_copy;
  if v_row.name <> 'Copy suite evening' or v_row.description <> 'Evening notes' or v_row.recurrence <> 'monthly'
     or v_row.folder_id <> (select id from fx where k = 'folder') or v_row.sort_order <> 7 or v_row.archived_at is not null then
    raise exception 'copy did not take the chosen settings: %', row_to_json(v_row);
  end if;
  select array_agg(team_id order by team_id) into v_teams from public.service_type_teams where service_type_id = v_copy;
  if v_teams is distinct from array[(select id from fx where k = 'prod')] then
    raise exception 'copy should be served by Production only, got %', v_teams;
  end if;
  insert into fx values ('jordan_copy', v_copy);

  -- No teams chosen: none serve it; a blank description is stored as null.
  v_copy := public.copy_service_type_as(v_src, 'Copy suite bare', '   ', null, (select id from fx where k = 'folder'), null);
  select * into v_row from public.service_types where id = v_copy;
  if v_row.description is not null or v_row.recurrence <> 'weekly' then
    raise exception 'bare copy: blank description or default frequency wrong: %', row_to_json(v_row);
  end if;
  if exists (select 1 from public.service_type_teams where service_type_id = v_copy) then
    raise exception 'bare copy should have no teams';
  end if;

  -- Another folder places the copy under other grants: administrators only.
  begin
    perform public.copy_service_type_as(v_src, 'Copy suite moved', null, 'weekly', (select id from fx where k = 'folder2'), null);
    raise exception 'a non-admin put a copy in another folder';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.copy_service_type_as(v_src, 'Copy suite unfiled', null, 'weekly', null, null);
    raise exception 'a non-admin took a copy out of its folder';
  exception when insufficient_privilege then null;
  end;

  -- Invalid input.
  begin
    perform public.copy_service_type_as(v_src, '   ', null, 'weekly', (select id from fx where k = 'folder'), null);
    raise exception 'a blank name was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.copy_service_type_as(v_src, 'Copy suite stray team', null, 'weekly', (select id from fx where k = 'folder'),
                                        array[gen_random_uuid()]);
    raise exception 'a team outside the organization was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.copy_service_type_as(gen_random_uuid(), 'Copy suite ghost', null, 'weekly', null, null);
    raise exception 'copied a service type that does not exist';
  exception when no_data_found then null;
  end;

  -- Archive and restore (the API's /archive route is a plain update under RLS).
  update public.service_types set archived_at = now() where id = (select id from fx where k = 'jordan_copy');
  if not found then raise exception 'Jordan could not archive a service type'; end if;
  update public.service_types set archived_at = null where id = (select id from fx where k = 'jordan_copy');
  if not found then raise exception 'Jordan could not restore a service type'; end if;
end;
$$;

-- People and grants never come with a copy.
reset role;
do $$
begin
  if exists (select 1 from public.access_grants where service_type_id = (select id from fx where k = 'jordan_copy')) then
    raise exception 'a grant was copied';
  end if;
  if exists (select 1 from public.plans where service_type_id = (select id from fx where k = 'jordan_copy')) then
    raise exception 'a plan was copied';
  end if;
end;
$$;

-- ========================================================= owner (admin) ====
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

do $$
declare
  v_copy uuid;
begin
  v_copy := public.copy_service_type_as((select id from fx where k = 'src'), 'Copy suite other folder copy', null, 'biweekly',
                                        (select id from fx where k = 'folder2'),
                                        array[(select id from fx where k = 'band'), (select id from fx where k = 'hosts')]);
  if (select folder_id from public.service_types where id = v_copy) <> (select id from fx where k = 'folder2') then
    raise exception 'an admin could not choose another folder';
  end if;
  if (select count(*) from public.service_type_teams where service_type_id = v_copy) <> 2 then
    raise exception 'admin copy should be served by Band and Hosts';
  end if;
  v_copy := public.copy_service_type_as((select id from fx where k = 'src'), 'Copy suite unfiled copy', null, null, null, null);
  if (select folder_id from public.service_types where id = v_copy) is not null then
    raise exception 'an admin could not take the copy out of its folder';
  end if;
end;
$$;

-- ======================================================= Sam (member) =====
-- Sam holds plans.edit on the source service type only: not enough to create
-- a service type, and nothing at all on Jordan's copy.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $$
declare
  v_rows int;
begin
  begin
    perform public.copy_service_type_as((select id from fx where k = 'src'), 'Copy suite by Sam', null, 'weekly',
                                        (select id from fx where k = 'folder'), null);
    raise exception 'a member without organization-wide plans.edit copied a service type';
  exception when insufficient_privilege then null;
  end;
  update public.service_types set archived_at = now() where id = (select id from fx where k = 'jordan_copy');
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'a member archived a service type they cannot edit'; end if;
end;
$$;

-- An anonymous caller cannot run the function at all.
reset role;
set local role anon;
do $$
begin
  perform public.copy_service_type_as((select id from fx where k = 'src'), 'Copy suite anon', null, 'weekly', null, null);
  raise exception 'anon ran copy_service_type_as';
exception when insufficient_privilege then null;
end;
$$;

reset role;
select 'copy-archive-service-type: ok';
rollback;
