-- PERF-007. Run with ON_ERROR_STOP against an isolated local database.
-- The same expectations can run before and after the migration.
begin;

create function pg_temp.id(key text) returns uuid language sql immutable as $$
  select md5('perf-007/' || key)::uuid;
$$;

insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.id(actor), 'perf007-' || actor || '@example.test', jsonb_build_object('full_name', actor)
  from unnest(array['owner', 'admin', 'legacy', 'team-scheduler', 'service-scheduler', 'folder-scheduler',
                    'planner', 'team-member', 'assignee', 'outsider', 'disabled-owner', 'platform-admin']) actor;
insert into private.platform_admins (user_id) values (pg_temp.id('platform-admin'));

insert into public.organizations (id, name, slug, assignment_visibility)
values (pg_temp.id('main'), 'PERF-007 Main', 'perf007-main', 'teams'),
       (pg_temp.id('foreign'), 'PERF-007 Foreign', 'perf007-foreign', 'organization'),
       (pg_temp.id('disabled'), 'PERF-007 Disabled', 'perf007-disabled', 'organization');

insert into public.organization_members (organization_id, user_id, role, access_mode)
select pg_temp.id(org), pg_temp.id(actor), role::public.org_role, access_mode
  from (values
    ('main', 'owner', 'owner', 'legacy'),
    ('main', 'admin', 'admin', 'legacy'),
    ('main', 'legacy', 'scheduler', 'legacy'),
    ('main', 'team-scheduler', 'scheduler', 'scoped'),
    ('main', 'service-scheduler', 'scheduler', 'scoped'),
    ('main', 'folder-scheduler', 'scheduler', 'scoped'),
    ('main', 'planner', 'member', 'scoped'),
    ('main', 'team-member', 'member', 'legacy'),
    ('main', 'assignee', 'member', 'legacy'),
    ('foreign', 'outsider', 'owner', 'legacy'),
    ('foreign', 'team-member', 'member', 'legacy'),
    ('disabled', 'disabled-owner', 'owner', 'legacy')
  ) as actors(org, actor, role, access_mode);

insert into public.service_type_folders (id, organization_id, parent_id, name)
values (pg_temp.id('folder-root'), pg_temp.id('main'), null, 'Root'),
       (pg_temp.id('folder-child'), pg_temp.id('main'), pg_temp.id('folder-root'), 'Child');

insert into public.service_types (id, organization_id, folder_id, name)
values (pg_temp.id('service-main'), pg_temp.id('main'), pg_temp.id('folder-child'), 'Main service'),
       (pg_temp.id('service-other'), pg_temp.id('main'), null, 'Other service');

insert into public.teams (id, organization_id, name)
select pg_temp.id(team), pg_temp.id(org), team
  from (values ('band','main'), ('related','main'), ('other','main'),
               ('foreign-team','foreign'), ('disabled-team','disabled'), ('disabled-other','disabled')) teams(team, org);

insert into public.team_memberships (team_id, user_id)
values (pg_temp.id('band'), pg_temp.id('team-member'));

insert into public.team_related_visibility (organization_id, team_id, related_team_id)
values (pg_temp.id('main'), pg_temp.id('band'), pg_temp.id('related')),
       (pg_temp.id('main'), pg_temp.id('related'), pg_temp.id('other'));

insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id, service_type_id, folder_id)
values
 (pg_temp.id('main'), pg_temp.id('team-scheduler'), 'scheduling.manage', 'team', pg_temp.id('band'), null, null),
 (pg_temp.id('main'), pg_temp.id('service-scheduler'), 'scheduling.manage', 'service_type', null, pg_temp.id('service-main'), null),
 (pg_temp.id('main'), pg_temp.id('folder-scheduler'), 'scheduling.manage', 'folder', null, null, pg_temp.id('folder-root')),
 (pg_temp.id('main'), pg_temp.id('planner'), 'plans.edit', 'service_type', null, pg_temp.id('service-main'), null);

insert into public.plans (id, organization_id, service_type_id, title, service_date, status)
select pg_temp.id(plan), pg_temp.id(org), pg_temp.id(service_type), plan,
       '2030-01-01 10:00Z'::timestamptz + make_interval(days => day), 'published'
  from (values ('timed','main','service-main',0), ('other-plan','main','service-other',1),
               ('untimed','main',null,2), ('foreign-plan','foreign',null,0),
               ('disabled-plan','disabled',null,0)) plans(plan, org, service_type, day);

insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at)
select pg_temp.id(t.key), p.id, t.kind::public.plan_time_kind, t.name,
       p.service_date + t.offset_hours * interval '1 hour', p.service_date + (t.offset_hours + 1) * interval '1 hour'
  from (values ('service','timed','service',null,0), ('rehearsal','timed','rehearsal','Sound check',-2),
               ('other-time','other-plan','service','Midweek',0),
               ('foreign-time','foreign-plan','service','Foreign',0),
               ('disabled-time','disabled-plan','service','Disabled',0)) t(key, plan, kind, name, offset_hours)
  join public.plans p on p.id = pg_temp.id(t.plan);

create temp table perf007_requests (
  key text primary key, plan text, team text, assignee text, visibility text,
  attendance_mode text, intervals text[]
) on commit drop;
insert into perf007_requests values
  ('band-release', 'timed', 'band', 'owner', 'released', 'all', '{rehearsal,service}'),
  ('related-release', 'timed', 'related', 'owner', 'released', 'selected', '{rehearsal}'),
  ('other-release', 'timed', 'other', 'owner', 'released', 'all', '{rehearsal,service}'),
  ('assignee-release', 'timed', 'other', 'assignee', 'released', 'selected', '{service}'),
  ('assignee-prepared', 'timed', 'related', 'assignee', 'prepared', 'all', '{rehearsal,service}'),
  ('band-prepared', 'timed', 'band', 'admin', 'prepared', 'selected', '{service}'),
  ('related-prepared', 'timed', 'related', 'admin', 'prepared', 'all', '{rehearsal,service}'),
  ('other-plan-prepared', 'other-plan', 'band', 'owner', 'prepared', 'all', '{other-time}'),
  ('untimed-release', 'untimed', 'band', 'owner', 'released', 'all', '{fallback}'),
  ('empty-selected', 'timed', 'band', 'legacy', 'released', 'selected', '{}'),
  ('foreign-release', 'foreign-plan', 'foreign-team', 'outsider', 'released', 'all', '{foreign-time}'),
  -- Privileged setup models historical rows with mismatched plan and team tenants.
  ('cross-plan-prepared', 'timed', 'foreign-team', 'admin', 'prepared', 'all', '{rehearsal,service}'),
  ('cross-team-prepared', 'foreign-plan', 'band', 'outsider', 'prepared', 'all', '{foreign-time}'),
  ('disabled-own', 'disabled-plan', 'disabled-team', 'disabled-owner', 'released', 'selected', '{disabled-time}'),
  ('disabled-prepared', 'disabled-plan', 'disabled-other', 'disabled-owner', 'prepared', 'all', '{disabled-time}');

insert into public.assignments (id, plan_id, team_id, user_id, visibility, attendance_mode)
select pg_temp.id(key), pg_temp.id(plan), pg_temp.id(team), pg_temp.id(assignee), visibility, attendance_mode
  from perf007_requests;

insert into public.assignment_attendance_times (assignment_id, plan_time_id)
select pg_temp.id(r.key), pg_temp.id(t.key)
  from perf007_requests r cross join lateral unnest(r.intervals) t(key)
 where r.attendance_mode = 'selected';

-- One recorded response per timed assignment, including ones hidden by RLS.
insert into public.assignment_time_responses (assignment_id, plan_time_id, status)
select pg_temp.id(key),
       pg_temp.id(case plan when 'timed' then 'service' when 'other-plan' then 'other-time'
                            when 'foreign-plan' then 'foreign-time' else 'disabled-time' end), 'confirmed'
  from perf007_requests where plan <> 'untimed';

create temp table perf007_intervals on commit drop as
select r.key, jsonb_build_object(
         'assignment_id', a.id, 'plan_time_id', pt.id, 'kind', coalesce(pt.kind::text, 'service'), 'name', pt.name,
         'starts_at', coalesce(pt.starts_at, p.service_date),
         'ends_at', coalesce(pt.ends_at, p.service_date + interval '2 hours'),
         'source', case when t.key = 'fallback' then 'untimed_fallback' else 'plan_time' end
       ) as projection
  from perf007_requests r
  cross join lateral unnest(r.intervals) t(key)
  join public.assignments a on a.id = pg_temp.id(r.key)
  join public.plans p on p.id = a.plan_id
  left join public.plan_times pt on pt.id = pg_temp.id(t.key);

select public.set_organization_platform_status(pg_temp.id('platform-admin'), pg_temp.id('disabled'), 'disabled', 'PERF-007 fixture');

grant select on perf007_requests, perf007_intervals to authenticated, anon, service_role;

create function pg_temp.check_access(actor text, expected text[], hidden_intervals text[] default '{}')
returns void language plpgsql security invoker as $$
declare
  ids uuid[] := array(select pg_temp.id(key) from perf007_requests);
  expected_ids uuid[] := array(select pg_temp.id(key) from unnest(expected) key order by 1);
  expected_responses uuid[] := array(
    select pg_temp.id(key) from perf007_requests where key = any(expected) and plan <> 'untimed' order by 1);
  expected_links uuid[] := array(
    select pg_temp.id(key) from perf007_requests
     where key = any(expected) and attendance_mode = 'selected' and cardinality(intervals) > 0 order by 1);
  attendance jsonb := coalesce((
    select jsonb_agg(projection order by projection->>'assignment_id', projection->>'starts_at', projection->>'plan_time_id')
      from perf007_intervals where key = any(expected) and key <> all(hidden_intervals)
  ), '[]');
  actual_ids uuid[];
  actual_attendance jsonb;
begin
  if actor is not null then
    perform set_config('request.jwt.claim.sub', pg_temp.id(actor)::text, true);
  end if;
  select array(select id from public.assignments where id = any(ids) order by id) into actual_ids;
  if actual_ids <> expected_ids then
    raise exception '% assignment visibility differs: % vs %', actor, actual_ids, expected_ids;
  end if;
  select array(select assignment_id from public.assignment_time_responses
                where assignment_id = any(ids) order by assignment_id) into actual_ids;
  if actual_ids <> expected_responses then
    raise exception '% response visibility differs: % vs %', actor, actual_ids, expected_responses;
  end if;
  select array(select assignment_id from public.assignment_attendance_times
                where assignment_id = any(ids) order by assignment_id) into actual_ids;
  if actual_ids <> expected_links then
    raise exception '% selected links differ: % vs %', actor, actual_ids, expected_links;
  end if;
  -- Duplicates, NULL and unknown IDs must not change the ordered projection.
  select coalesce(jsonb_agg(to_jsonb(t) - 'ordinality' order by t.ordinality), '[]') into actual_attendance
    from public.assignment_attendance_for(ids || ids[1] || null::uuid || pg_temp.id('missing')) with ordinality t;
  if actual_attendance <> attendance then
    raise exception '% attendance RPC differs: % vs %', actor, actual_attendance, attendance;
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) - array['person_id','plan_id','team_id','position_id','status','visibility','attendance_mode']
                           order by t.assignment_id, t.starts_at, t.plan_time_id), '[]') into actual_attendance
    from private.assignment_attendance t where t.assignment_id = any(ids);
  if actual_attendance <> attendance then
    raise exception '% attendance view differs: % vs %', actor, actual_attendance, attendance;
  end if;
end;
$$;

set local role authenticated;

select pg_temp.check_access(null, '{}');
select pg_temp.check_access('owner', '{band-release,related-release,other-release,assignee-release,assignee-prepared,band-prepared,related-prepared,other-plan-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('admin', '{band-release,related-release,other-release,assignee-release,assignee-prepared,band-prepared,related-prepared,other-plan-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('legacy', '{band-release,related-release,other-release,assignee-release,assignee-prepared,band-prepared,related-prepared,other-plan-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('team-scheduler', '{band-release,related-release,other-release,assignee-release,band-prepared,other-plan-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('service-scheduler', '{band-release,related-release,other-release,assignee-release,assignee-prepared,band-prepared,related-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('folder-scheduler', '{band-release,related-release,other-release,assignee-release,assignee-prepared,band-prepared,related-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('planner', '{band-release,related-release,other-release,assignee-release,untimed-release,empty-selected}');
select pg_temp.check_access('team-member', '{band-release,related-release,untimed-release,empty-selected,foreign-release}');
select pg_temp.check_access('assignee', '{assignee-release}');
select pg_temp.check_access('outsider', '{foreign-release}');
-- A suspended caller still sees their own released assignment and its links
-- and responses, but plan/time RLS removes its attendance projection.
select pg_temp.check_access('disabled-owner', '{disabled-own}', '{disabled-own}');

do $$
begin
  if exists (select 1 from public.assignment_attendance_for(null))
     or exists (select 1 from public.assignment_attendance_for('{}'))
     or exists (select 1 from public.assignment_attendance_for(array_fill(null::uuid, array[2000]))) then
    raise exception 'Empty attendance request returned data';
  end if;
  begin
    perform * from public.assignment_attendance_for(array_fill(null::uuid, array[2001]));
    raise exception 'Oversized attendance request succeeded';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- In-scope writes must still work with RETURNING, including assignment IDs
-- and selection links that do not exist when their INSERT checks run.
select set_config('request.jwt.claim.sub', pg_temp.id('team-scheduler')::text, true);
do $$
declare
  added uuid;
  changed uuid;
begin
  insert into public.assignments (id, plan_id, team_id, user_id, visibility, attendance_mode)
  values (pg_temp.id('write-test'), pg_temp.id('timed'), pg_temp.id('band'),
          pg_temp.id('team-scheduler'), 'prepared', 'selected') returning id into strict added;

  update public.assignments set notes = 'edited' where id = added returning id into strict changed;
  insert into public.assignment_attendance_times (assignment_id, plan_time_id)
  values (added, pg_temp.id('service')) returning assignment_id into strict changed;
  update public.assignment_attendance_times set created_at = now() where assignment_id = added
  returning assignment_id into strict changed;
  delete from public.assignment_attendance_times where assignment_id = added returning assignment_id into strict changed;
  update public.assignments set plan_id = pg_temp.id('other-plan') where id = added
  returning id into strict changed;
  begin
    update public.assignments set team_id = pg_temp.id('foreign-team') where id = added returning id into changed;
    raise exception 'Scheduler moved an assignment to a team in another organization';
  exception when insufficient_privilege then null;
  end;
  delete from public.assignments where id = added returning id into strict changed;

  begin
    insert into public.assignments (plan_id, team_id, user_id, visibility)
    values (pg_temp.id('timed'), pg_temp.id('related'), pg_temp.id('team-scheduler'), 'prepared');
    raise exception 'Scheduler inserted an assignment outside their scope';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.assignment_attendance_times (assignment_id, plan_time_id)
    values (pg_temp.id('related-release'), pg_temp.id('service'));
    raise exception 'Scheduler inserted a link outside their scope';
  exception when insufficient_privilege then null;
  end;
  update public.assignment_attendance_times set created_at = now()
   where assignment_id = pg_temp.id('related-release');
  if found then raise exception 'Scheduler updated a link outside their scope'; end if;
  delete from public.assignment_attendance_times where assignment_id = pg_temp.id('related-release');
  if found then raise exception 'Scheduler deleted a link outside their scope'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', pg_temp.id('assignee')::text, true);
do $$
declare
  changed uuid;
begin
  -- W7-RESP-D2: the row is reachable, but an answer must come through the
  -- response path so the scheduler update is recorded with it.
  begin
    update public.assignments set status = 'confirmed' where id = pg_temp.id('assignee-release');
    raise exception 'Assignee changed a status without the response path';
  exception when insufficient_privilege then null;
  end;
  select (r.assignment).id into strict changed
    from public.respond_as_self(pg_temp.id('main'), pg_temp.id('assignee-release'), 'confirmed', 'unconfirmed') r;
  update public.assignments set status = 'confirmed' where id = pg_temp.id('assignee-prepared');
  if found then raise exception 'Assignee updated a prepared assignment'; end if;
  begin
    update public.assignment_time_responses set status = 'declined' where assignment_id = changed;
    raise exception 'Direct response write succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
insert into public.access_grants (organization_id, user_id, capability, scope_type)
values (pg_temp.id('main'), pg_temp.id('team-scheduler'), 'scheduling.manage', 'organization');
select * from public.grant_platform_access(pg_temp.id('platform-admin'), pg_temp.id('disabled'), 1);
set local role authenticated;
select pg_temp.check_access('team-scheduler', '{band-release,related-release,other-release,assignee-release,assignee-prepared,band-prepared,related-prepared,other-plan-prepared,untimed-release,empty-selected}');
select pg_temp.check_access('platform-admin', '{disabled-own,disabled-prepared}');

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  if exists (select 1 from public.assignments where id in (select pg_temp.id(key) from perf007_requests))
     or exists (select 1 from public.assignment_time_responses where assignment_id in (select pg_temp.id(key) from perf007_requests))
     or exists (select 1 from public.assignment_attendance_times where assignment_id in (select pg_temp.id(key) from perf007_requests)) then
    raise exception 'Anonymous caller saw assignments, responses, or selected links';
  end if;
  begin
    perform * from public.assignment_attendance_for(array[pg_temp.id('band-release')]);
    raise exception 'Anonymous attendance RPC succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;
select pg_temp.check_access(null, array(select key from perf007_requests));
rollback;
