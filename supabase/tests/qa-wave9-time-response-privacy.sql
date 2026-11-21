-- W9-JRN-D1: a per-time decline reason (assignment_time_responses.response_note)
-- is readable only by the assignee, the response owner and schedulers of the
-- assignment; the per-time status stays visible to every roster reader.
-- Requires migration 20261128000000_w9_time_response_note_privacy. Everything rolls back.
begin;

create function pg_temp.id(key text) returns uuid language sql immutable as $$
  select md5('qa-w9-note/' || key)::uuid;
$$;

-- Notes the current caller may read for the fixture assignment.
create function pg_temp.visible_notes() returns text[] language sql as $$
  select coalesce(array_agg(n.response_note order by n.plan_time_id), '{}')
    from public.assignment_time_response_notes(array[md5('qa-w9-note/request')::uuid]) n;
$$;
grant execute on function pg_temp.visible_notes() to authenticated;

insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.id(actor), 'qa-w9-note-' || actor || '@example.test', jsonb_build_object('full_name', actor)
  from unnest(array['owner', 'scheduler', 'resp-owner', 'assignee', 'teammate', 'viewer',
                    'deactivated', 'outsider']) actor;

insert into public.organizations (id, name, slug, assignment_visibility)
values (pg_temp.id('main'), 'QA W9 Note Main', 'qa-w9-note-main', 'organization'),
       (pg_temp.id('foreign'), 'QA W9 Note Foreign', 'qa-w9-note-foreign', 'organization');

insert into public.organization_members (organization_id, user_id, role, access_mode)
select pg_temp.id(org), pg_temp.id(actor), role::public.org_role, 'scoped'
  from (values
    ('main', 'owner', 'owner'),
    ('main', 'scheduler', 'scheduler'),
    ('main', 'resp-owner', 'scheduler'),
    ('main', 'assignee', 'member'),
    ('main', 'teammate', 'member'),
    ('main', 'viewer', 'member'),
    ('main', 'deactivated', 'scheduler'),
    ('foreign', 'outsider', 'owner')
  ) as actors(org, actor, role);

insert into public.service_types (id, organization_id, name)
values (pg_temp.id('service'), pg_temp.id('main'), 'Note Sunday');
insert into public.teams (id, organization_id, name)
values (pg_temp.id('band'), pg_temp.id('main'), 'Note Band'),
       (pg_temp.id('other'), pg_temp.id('main'), 'Note Other');
insert into public.team_memberships (team_id, user_id)
values (pg_temp.id('band'), pg_temp.id('assignee')),
       (pg_temp.id('band'), pg_temp.id('teammate')),
       (pg_temp.id('band'), pg_temp.id('deactivated'));

-- The scheduler schedules the band. The response owner schedules only another
-- team, so only the response-owner rule can grant them the note. The
-- deactivated member scheduled the band before losing active membership.
insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id)
values (pg_temp.id('main'), pg_temp.id('scheduler'), 'scheduling.manage', 'team', pg_temp.id('band')),
       (pg_temp.id('main'), pg_temp.id('resp-owner'), 'scheduling.manage', 'team', pg_temp.id('other')),
       (pg_temp.id('main'), pg_temp.id('deactivated'), 'scheduling.manage', 'team', pg_temp.id('band'));

insert into public.plans (id, organization_id, service_type_id, title, service_date, status)
values (pg_temp.id('plan'), pg_temp.id('main'), pg_temp.id('service'), 'Note plan',
        now() + interval '30 days', 'published');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.id('t09'), pg_temp.id('plan'), 'service', '09:00', now() + interval '30 days', now() + interval '30 days 1 hour', 0),
  (pg_temp.id('t11'), pg_temp.id('plan'), 'service', '11:00', now() + interval '30 days 2 hours', now() + interval '30 days 3 hours', 1);

insert into public.assignments (id, plan_id, team_id, user_id, visibility, attendance_mode, created_by, response_owner_id)
values (pg_temp.id('request'), pg_temp.id('plan'), pg_temp.id('band'), pg_temp.id('assignee'),
        'released', 'all', pg_temp.id('scheduler'), pg_temp.id('resp-owner'));

-- The assignee answers through the snapshot flow (preview + commit).
set local role authenticated;
select set_config('request.jwt.claim.sub', md5('qa-w9-note/assignee')::uuid::text, true);

select id from public.preview_assignment_responses(md5('qa-w9-note/main')::uuid, array[md5('qa-w9-note/request')::uuid]);

select public.respond_to_assignment_snapshots(
  md5('qa-w9-note/main')::uuid,
  jsonb_build_array(jsonb_build_object(
    'snapshot_id', (select s.id from public.assignment_request_snapshots s
                     where s.plan_id = md5('qa-w9-note/plan')::uuid and s.consumed_at is null
                     order by s.created_at desc limit 1),
    'version', 1,
    'answers', jsonb_build_array(
      jsonb_build_object('assignment_id', md5('qa-w9-note/request')::uuid, 'plan_time_id', md5('qa-w9-note/t09')::uuid,
                         'status', 'confirmed', 'reason', null),
      jsonb_build_object('assignment_id', md5('qa-w9-note/request')::uuid, 'plan_time_id', md5('qa-w9-note/t11')::uuid,
                         'status', 'declined', 'reason', 'Out of town at 11')
    )
  )), 'qa-w9-note-commit'
);

-- The assignee reads their own note; a direct column read is refused even to them.
do $$ begin
  if pg_temp.visible_notes() <> array['Out of town at 11'] then
    raise exception 'assignee cannot read own note: %', pg_temp.visible_notes();
  end if;
  begin
    perform response_note from public.assignment_time_responses;
    raise exception 'response_note column is directly selectable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.assignment_time_responses;
    raise exception 'select * on assignment_time_responses is allowed for authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Writer still stores the note (current row and history).
reset role;
do $$ begin
  if (select response_note from public.assignment_time_responses
       where assignment_id = pg_temp.id('request') and plan_time_id = pg_temp.id('t11')) is distinct from 'Out of town at 11'
     or (select status from public.assignment_time_responses
       where assignment_id = pg_temp.id('request') and plan_time_id = pg_temp.id('t11')) <> 'declined' then
    raise exception 'snapshot commit did not write the per-time note';
  end if;
  if not exists (select 1 from public.assignment_time_response_history
                  where assignment_id = pg_temp.id('request') and response_note = 'Out of town at 11') then
    raise exception 'snapshot commit did not write the note to history';
  end if;
end $$;
update public.organization_members set status = 'inactive'
 where organization_id = pg_temp.id('main') and user_id = pg_temp.id('deactivated');

create temporary table qa_w9_note_expect (actor text primary key, sees_note boolean, sees_status boolean) on commit drop;
grant select on qa_w9_note_expect to authenticated;
insert into qa_w9_note_expect values
  ('assignee', true, true),
  ('scheduler', true, true),
  ('resp-owner', true, true),
  ('owner', true, true),
  ('teammate', false, true),
  ('viewer', false, true),
  ('deactivated', false, false),
  ('outsider', false, false);

set local role authenticated;
do $$
declare
  e record;
  v_notes text[];
  v_statuses text[];
begin
  for e in select * from qa_w9_note_expect order by actor loop
    perform set_config('request.jwt.claim.sub', md5('qa-w9-note/' || e.actor)::uuid::text, true);
    v_notes := pg_temp.visible_notes();
    select coalesce(array_agg(r.status::text order by r.plan_time_id), '{}') into v_statuses
      from public.assignment_time_responses r
     where r.assignment_id = md5('qa-w9-note/request')::uuid;
    if e.sees_note and v_notes <> array['Out of town at 11'] then
      raise exception '% should read the note, got %', e.actor, v_notes;
    end if;
    if not e.sees_note and cardinality(v_notes) <> 0 then
      raise exception '% must not read the note, got %', e.actor, v_notes;
    end if;
    if e.sees_status and cardinality(v_statuses) <> 2 then
      raise exception '% lost the per-time status rows (roster), got %', e.actor, v_statuses;
    end if;
    if not e.sees_status and cardinality(v_statuses) <> 0 then
      raise exception '% reads per-time status rows outside their scope, got %', e.actor, v_statuses;
    end if;
  end loop;
end $$;

-- anon reads no rows, never the note column, and cannot call the notes function.
reset role;
set local role anon;
do $$ begin
  if exists (select 1 from public.assignment_time_responses where assignment_id = md5('qa-w9-note/request')::uuid) then
    raise exception 'anon reads per-time responses';
  end if;
  begin
    perform response_note from public.assignment_time_responses;
    raise exception 'anon can select response_note';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.assignment_time_response_notes(array[md5('qa-w9-note/request')::uuid]);
    raise exception 'anon can call assignment_time_response_notes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
