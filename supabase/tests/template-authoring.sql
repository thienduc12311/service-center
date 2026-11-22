-- Template authoring: an empty template made from scratch, content added by
-- hand, and duplicate_plan_template (copy, service-type change, unavailable
-- staffing, cross-organization and non-editor denial).
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table ta_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on ta_fx to authenticated, service_role;
insert into ta_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('midweek', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('leader', 'dddddddd-0000-4000-8000-000000000001'),
  ('song', 'eeeeeeee-0000-4000-8000-000000000001'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333')),
  ('general', gen_random_uuid()), ('general_pos', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_tpl', gen_random_uuid()), ('other_st', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from ta_fx where k = p $$;

-- A general team (serves no service type) and one of its positions.
insert into public.teams (id, organization_id, service_type_id, name)
values (pg_temp.fx('general'), pg_temp.fx('org'), null, 'TA general ' || left(gen_random_uuid()::text, 6));
insert into public.team_positions (id, team_id, name) values (pg_temp.fx('general_pos'), pg_temp.fx('general'), 'Greeter');

-- Riley may edit plans of Sunday Morning only.
insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id, created_by)
values (pg_temp.fx('org'), '44444444-4444-4444-8444-444444444444', 'plans.edit', 'service_type', pg_temp.fx('sunday'),
        '11111111-1111-4111-8111-111111111111');

-- Another organization's template.
insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'TA other', 'ta-other-' || left(gen_random_uuid()::text, 8));
insert into public.service_types (id, organization_id, name) values (pg_temp.fx('other_st'), pg_temp.fx('other_org'), 'Foreign type');
insert into public.plan_templates (id, organization_id, kind, name, current_revision)
values (pg_temp.fx('other_tpl'), pg_temp.fx('other_org'), 'plan', 'Foreign template', 1);
insert into public.plan_template_revisions (template_id, organization_id, revision, content)
values (pg_temp.fx('other_tpl'), pg_temp.fx('other_org'), 1, '{"version":1,"items":[],"needs":[],"roster":[],"times":[],"notes":null}');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ------------------------------------ create from scratch, then author ---
do $$
declare saved jsonb; tpl uuid; content jsonb;
begin
  -- An empty template: the create endpoint sends content with no entries.
  saved := public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('sunday'), 'TA blank', 'From scratch',
    '{"version":1}'::jsonb, null, null);
  tpl := (saved ->> 'template_id')::uuid;
  insert into ta_fx values ('blank', tpl);
  select r.content into content from public.plan_template_revisions r where r.template_id = tpl and r.revision = 1;
  if content <> '{"version":1,"notes":null,"times":[],"items":[],"needs":[],"roster":[]}'::jsonb then
    raise exception 'an empty template did not normalize to empty lists: %', content;
  end if;

  -- The editor adds a header, an item, a song (arrangement-less, own key), a
  -- need and two roster entries (one on the general team) as revision 2.
  saved := public.save_plan_template(pg_temp.fx('org'), tpl, 1, null, null, null, null, jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('item_type', 'header', 'title', 'Worship'),
      jsonb_build_object('item_type', 'song', 'song_id', pg_temp.fx('song'), 'key_override', 'G', 'length_seconds', 240),
      jsonb_build_object('item_type', 'item', 'title', 'Welcome', 'length_seconds', 120, 'description', 'Host reads notices')),
    'needs', jsonb_build_array(
      jsonb_build_object('position_id', pg_temp.fx('leader'), 'needed', 2),
      jsonb_build_object('position_id', pg_temp.fx('general_pos'), 'needed', 1)),
    'roster', jsonb_build_array(
      jsonb_build_object('person_id', pg_temp.fx('sam'), 'team_id', pg_temp.fx('band'), 'position_id', pg_temp.fx('leader')),
      jsonb_build_object('person_id', pg_temp.fx('sam'), 'team_id', pg_temp.fx('general'), 'position_id', null))
  ), null, null);
  if (saved ->> 'revision')::int <> 2 then raise exception 'authoring did not make revision 2: %', saved; end if;
  select r.content into content from public.plan_template_revisions r where r.template_id = tpl and r.revision = 2;
  if jsonb_array_length(content -> 'items') <> 3 or content #>> '{items,1,title}' is null
     or content #>> '{items,1,key_override}' <> 'G' or content #>> '{items,2,description}' <> 'Host reads notices' then
    raise exception 'authored items were not kept: %', content -> 'items';
  end if;

  -- A stale editor gets template_changed, not a silent overwrite.
  begin
    perform public.save_plan_template(pg_temp.fx('org'), tpl, 1, null, null, null, null, '{"items":[]}'::jsonb, null, null);
    raise exception 'a stale revision was saved';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

-- ----------------------------------------------------- duplicate: copy ---
do $$
declare saved jsonb; copy uuid; content jsonb; src jsonb; t public.plan_templates;
begin
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA blank copy');
  copy := (saved ->> 'template_id')::uuid;
  if copy is null or copy = pg_temp.fx('blank') or (saved ->> 'revision')::int <> 1 then
    raise exception 'duplicate did not make a new template at revision 1: %', saved;
  end if;
  select * into t from public.plan_templates where id = copy;
  if t.name <> 'TA blank copy' or t.service_type_id is distinct from pg_temp.fx('sunday') or t.kind <> 'plan'
     or t.description <> 'From scratch' or t.created_by <> '22222222-2222-4222-8222-222222222222' then
    raise exception 'duplicate did not keep kind/scope/description: %', to_jsonb(t);
  end if;
  select r.content into content from public.plan_template_revisions r where r.template_id = copy and r.revision = 1;
  select r.content into src from public.plan_template_revisions r where r.template_id = pg_temp.fx('blank') and r.revision = 2;
  if content <> src then raise exception 'copied content differs: % vs %', content, src; end if;
  if saved -> 'unavailable' <> '{"needs":0,"roster":0}'::jsonb then
    raise exception 'nothing should have been left out: %', saved;
  end if;
  -- The source is untouched.
  if (select current_revision from public.plan_templates where id = pg_temp.fx('blank')) <> 2 then
    raise exception 'duplicating changed the source';
  end if;

  -- No name: "(copy)" is appended; a name already in use is refused.
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'));
  if (select name from public.plan_templates where id = (saved ->> 'template_id')::uuid) <> 'TA blank (copy)' then
    raise exception 'default copy name not applied';
  end if;
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'ta BLANK copy');
    raise exception 'a duplicate active name was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ------------------------------ duplicate into another service type ---
do $$
declare saved jsonb; content jsonb; before_count int;
begin
  select count(*) into before_count from public.plan_templates where organization_id = pg_temp.fx('org');
  -- Midweek is not served by the band: the leader need and Sam's band entry
  -- do not apply there. Nothing is written until the caller agrees.
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA midweek', true, pg_temp.fx('midweek'));
  if saved ->> 'template_id' is not null or saved -> 'unavailable' <> '{"needs":1,"roster":1}'::jsonb then
    raise exception 'unavailable staffing was not reported: %', saved;
  end if;
  if (select count(*) from public.plan_templates where organization_id = pg_temp.fx('org')) <> before_count then
    raise exception 'a refused copy wrote a template';
  end if;

  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA midweek', true, pg_temp.fx('midweek'), true);
  select r.content into content from public.plan_template_revisions r
   where r.template_id = (saved ->> 'template_id')::uuid and r.revision = 1;
  if (select service_type_id from public.plan_templates where id = (saved ->> 'template_id')::uuid) <> pg_temp.fx('midweek') then
    raise exception 'copy is not filed under the target service type';
  end if;
  if content -> 'needs' <> jsonb_build_array(jsonb_build_object('position_id', pg_temp.fx('general_pos'), 'needed', 1))
     or jsonb_array_length(content -> 'roster') <> 1 or content #>> '{roster,0,team_id}' <> pg_temp.fx('general')::text
     or jsonb_array_length(content -> 'items') <> 3 then
    raise exception 'only the staffing that applies to midweek should be copied: %', content;
  end if;

  -- Once the band serves midweek too, everything applies.
  insert into public.service_type_teams (service_type_id, team_id, organization_id)
  values (pg_temp.fx('midweek'), pg_temp.fx('band'), pg_temp.fx('org'));
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA midweek full', true, pg_temp.fx('midweek'));
  if saved ->> 'template_id' is null or saved -> 'unavailable' <> '{"needs":0,"roster":0}'::jsonb then
    raise exception 'a team serving the target type was treated as unavailable: %', saved;
  end if;

  -- An organization-wide copy accepts every team.
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA everywhere', true, null);
  if saved ->> 'template_id' is null
     or (select service_type_id from public.plan_templates where id = (saved ->> 'template_id')::uuid) is not null then
    raise exception 'organization-wide copy failed: %', saved;
  end if;

  -- An unknown service type is not found.
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA nowhere', true, gen_random_uuid());
    raise exception 'an unknown service type was accepted';
  exception when no_data_found then null;
  end;
end $$;

-- An archived Person in the roster is left out like a team that does not apply.
reset role;
update public.people set archived_at = now() where id = pg_temp.fx('sam');
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare saved jsonb;
begin
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA without archived');
  if saved ->> 'template_id' is not null or saved -> 'unavailable' <> '{"needs":0,"roster":2}'::jsonb then
    raise exception 'archived roster people were not reported: %', saved;
  end if;
end $$;
reset role;
update public.people set archived_at = null where id = pg_temp.fx('sam');
set local role authenticated;

-- -------------------------------------------------- cross-organization ---
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('other_tpl'), 'Stolen');
    raise exception 'another organization''s template was copied';
  exception when no_data_found then null;
  end;
  begin
    perform public.duplicate_plan_template(pg_temp.fx('other_org'), pg_temp.fx('other_tpl'), 'Stolen');
    raise exception 'a non-member copied a template in another organization';
  exception when no_data_found then null;
  end;
  -- A service type of another organization is not a target either.
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA foreign type', true,
      pg_temp.fx('other_st'));
    raise exception 'a foreign service type was accepted';
  exception when no_data_found then null;
  end;
end $$;

-- ---------------------------------------------------------- non-editor ---
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'Member copy');
    raise exception 'a member without plans.edit copied a template';
  exception when no_data_found then null;  -- RLS hides the template entirely
  end;
end $$;

-- A Sunday-only editor can copy within Sunday but not into Midweek or org-wide.
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare saved jsonb;
begin
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA riley copy');
  if saved ->> 'template_id' is null then raise exception 'a Sunday editor could not copy within Sunday: %', saved; end if;
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA riley midweek', true, pg_temp.fx('midweek'), true);
    raise exception 'a Sunday-only editor copied into Midweek';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA riley everywhere', true, null);
    raise exception 'a Sunday-only editor made an organization-wide copy';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Archived templates stay readable and restorable; a copy of one is active.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare saved jsonb;
begin
  perform public.set_plan_template_archived(pg_temp.fx('blank'), true);
  saved := public.duplicate_plan_template(pg_temp.fx('org'), pg_temp.fx('blank'), 'TA from archived');
  if (select archived_at from public.plan_templates where id = (saved ->> 'template_id')::uuid) is not null then
    raise exception 'a copy of an archived template should be active';
  end if;
  perform public.set_plan_template_archived(pg_temp.fx('blank'), false);
  if (select archived_at from public.plan_templates where id = pg_temp.fx('blank')) is not null then
    raise exception 'restore did not clear archived_at';
  end if;
end $$;

-- Direct execution is not open to anonymous callers.
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.duplicate_plan_template(uuid, uuid, text, boolean, uuid, boolean)', 'execute') then
    raise exception 'anon can execute duplicate_plan_template';
  end if;
  if has_function_privilege('anon', 'private.plan_template_entry_applies(uuid, uuid, uuid, uuid, uuid)', 'execute') then
    raise exception 'anon can execute plan_template_entry_applies';
  end if;
end $$;

rollback;
