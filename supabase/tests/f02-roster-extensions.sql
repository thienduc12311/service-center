-- F02 Pass C: reversible archive, roster audit, tag groups, previewed bulk changes.
-- Run against a seeded local database after the migration:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/f02-roster-extensions.sql
-- Everything runs inside one transaction and is rolled back.
--
-- Cast (seed): 1111 owner, 2222 Jordan scheduler (legacy), 3333 Sam member,
-- 4444 Riley member. Team c1 Worship Band.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select, insert on fx to authenticated, service_role;
insert into fx values
  ('org',  'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('guest', gen_random_uuid()),
  ('other_org', gen_random_uuid());

-- Every member has a Person (MOB-005 / F02 Pass A backfill).
do $$
begin
  if exists (select 1 from public.organization_members m
              where m.organization_id = (select id from fx where k = 'org')
                and not exists (select 1 from public.people p where p.organization_id = m.organization_id and p.profile_id = m.user_id)) then
    raise exception 'a member has no Person';
  end if;
end $$;

insert into fx select 'sam', id from public.people
 where organization_id = (select id from fx where k = 'org') and profile_id = '33333333-3333-4333-8333-333333333333';
insert into fx select 'riley', id from public.people
 where organization_id = (select id from fx where k = 'org') and profile_id = '44444444-4444-4444-8444-444444444444';

-- A no-login guest, created by the owner.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.people (id, organization_id, first_name, last_name, created_by)
values ((select id from fx where k = 'guest'), (select id from fx where k = 'org'), 'Gina', 'Guest', (select auth.uid()));

do $$
declare
  v_org   uuid := (select id from fx where k = 'org');
  v_guest uuid := (select id from fx where k = 'guest');
  v_sam   uuid := (select id from fx where k = 'sam');
  v_riley uuid := (select id from fx where k = 'riley');
  v_res   jsonb;
  v_n     int;
  v_group uuid;
begin
  -- Audit: creation recorded with the actor.
  if not exists (select 1 from public.person_roster_events
                  where person_id = v_guest and action = 'created'
                    and actor_id = '11111111-1111-4111-8111-111111111111') then
    raise exception 'guest creation not audited';
  end if;

  -- Archive stamps who did it, even when a different archived_by is supplied.
  update public.people set archived_at = now(), archived_by = '33333333-3333-4333-8333-333333333333' where id = v_guest;
  if (select archived_by from public.people where id = v_guest) <> '11111111-1111-4111-8111-111111111111' then
    raise exception 'archived_by not stamped from the caller';
  end if;
  if not exists (select 1 from public.person_roster_events where person_id = v_guest and action = 'archived') then
    raise exception 'archive not audited';
  end if;
  -- Still present (history kept), marked archived in the member projection.
  if (select archived_at from public.people_directory where id = v_guest) is null then
    raise exception 'directory does not show archive';
  end if;

  -- Bulk preview: archived guest cannot be tagged; unknown id is not found.
  select count(*) into v_n
    from public.preview_roster_bulk_change(v_org, array[v_guest, v_sam, gen_random_uuid()], 'add_tag', 'Bass')
   where outcome = 'error';
  if v_n <> 2 then
    raise exception 'expected 2 error rows, got %', v_n;
  end if;
  if (select problem from public.preview_roster_bulk_change(v_org, array[v_guest], 'add_tag', 'bass')) <> 'archived' then
    raise exception 'archived problem not reported';
  end if;

  -- Apply refuses a batch with an error row.
  begin
    perform public.apply_roster_bulk_change(v_org, array[v_guest, v_sam], 'add_tag', 'bass', null, null, 1, 'bulk-key-0001');
    raise exception 'batch with archived row applied';
  exception when sqlstate '22023' then null;
  end;

  -- Restore, then preview shows two changes; stale expected count is refused.
  update public.people set archived_at = null where id = v_guest;
  if (select archived_by from public.people where id = v_guest) is not null then
    raise exception 'restore kept archived_by';
  end if;
  begin
    perform public.apply_roster_bulk_change(v_org, array[v_guest, v_sam], 'add_tag', 'bass', null, null, 1, 'bulk-key-0002');
    raise exception 'stale preview applied';
  exception when sqlstate 'PT409' then null;
  end;

  v_res := public.apply_roster_bulk_change(v_org, array[v_guest, v_sam], 'add_tag', 'Bass', null, null, 2, 'bulk-key-0003');
  if (v_res->>'changed')::int <> 2 or (select count(*) from public.person_tags where tag = 'bass' and person_id in (v_guest, v_sam)) <> 2 then
    raise exception 'bulk tag not applied: %', v_res;
  end if;
  -- Same key, same request: replayed, nothing new.
  v_res := public.apply_roster_bulk_change(v_org, array[v_sam, v_guest], 'add_tag', 'bass', null, null, 0, 'bulk-key-0003');
  if not (v_res->>'replayed')::boolean then
    raise exception 'replay not detected';
  end if;
  -- Same key, different request: refused.
  begin
    perform public.apply_roster_bulk_change(v_org, array[v_sam], 'remove_tag', 'bass', null, null, 1, 'bulk-key-0003');
    raise exception 'key reuse accepted';
  exception when sqlstate 'PT409' then null;
  end;
  if (select count(*) from public.person_roster_events where action = 'tag_added' and detail->>'tag' = 'bass') <> 2 then
    raise exception 'tag changes not audited';
  end if;

  -- Team bulk: a no-login guest takes a team place like anyone else.
  v_res := public.apply_roster_bulk_change(v_org, array[v_guest], 'add_to_team', null, (select id from fx where k = 'band'), null, 1, 'bulk-key-guest');
  if not exists (select 1 from public.team_memberships where team_id = (select id from fx where k = 'band')
                  and person_id = v_guest and user_id is null) then
    raise exception 'guest team place not created';
  end if;
  if not exists (select 1 from public.team_candidates((select id from fx where k = 'band')) c where c.person_id = v_guest) then
    raise exception 'guest missing from candidates';
  end if;
  delete from public.team_memberships where team_id = (select id from fx where k = 'band')
    and user_id = '44444444-4444-4444-8444-444444444444';
  v_res := public.apply_roster_bulk_change(v_org, array[v_riley], 'add_to_team', null, (select id from fx where k = 'band'), null, 1, 'bulk-key-0004');
  if not exists (select 1 from public.team_memberships where team_id = (select id from fx where k = 'band')
                  and user_id = '44444444-4444-4444-8444-444444444444' and position_id is null) then
    raise exception 'bulk team add not applied';
  end if;
  if not exists (select 1 from public.person_roster_events where person_id = v_riley and action = 'team_added') then
    raise exception 'team add not audited';
  end if;

  -- Archived people take no new team places.
  update public.people set archived_at = now() where id = v_riley;
  begin
    insert into public.team_memberships (team_id, user_id, position_id)
    values ((select id from fx where k = 'band'), '44444444-4444-4444-8444-444444444444',
            (select id from public.team_positions where team_id = (select id from fx where k = 'band') limit 1));
    raise exception 'archived person joined a team';
  exception when sqlstate '22023' then null;
  end;
  -- ...and are not offered as candidates.
  if exists (select 1 from public.team_candidates((select id from fx where k = 'band')) c where c.person_id = v_riley) then
    raise exception 'archived person offered as candidate';
  end if;
  update public.people set archived_at = null where id = v_riley;

  -- Tag groups: a tag belongs to a group of the same organization only.
  insert into public.person_tag_groups (organization_id, name) values (v_org, 'Instruments') returning id into v_group;
  insert into public.person_tag_catalog (organization_id, tag, group_id) values (v_org, 'bass', v_group);
  begin
    insert into public.person_tag_groups (organization_id, name) values (v_org, 'instruments');
    raise exception 'duplicate group name accepted';
  exception when unique_violation then null;
  end;
  delete from public.person_tag_groups where id = v_group;
  if (select group_id from public.person_tag_catalog where organization_id = v_org and tag = 'bass') is not null then
    raise exception 'deleting a group did not ungroup its tags';
  end if;
end $$;

-- A member: no audit, no bulk, no tag groups, cannot archive.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  v_org uuid := (select id from fx where k = 'org');
  v_n   int;
begin
  if exists (select 1 from public.person_roster_events) then
    raise exception 'member reads roster audit';
  end if;
  begin
    perform public.preview_roster_bulk_change(v_org, array[(select id from fx where k = 'guest')], 'add_tag', 'x');
    raise exception 'member previewed a bulk change';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.apply_roster_bulk_change(v_org, array[(select id from fx where k = 'guest')], 'add_tag', 'x', null, null, 1, 'member-key-01');
    raise exception 'member applied a bulk change';
  exception when sqlstate '42501' then null;
  end;
  update public.people set archived_at = now() where id = (select id from fx where k = 'guest');
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    raise exception 'member archived a person';
  end if;
  begin
    insert into public.person_tag_groups (organization_id, name) values (v_org, 'Sneaky');
    raise exception 'member created a tag group';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.person_roster_events (organization_id, person_label, action) values (v_org, 'x', 'created');
    raise exception 'member wrote audit';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Another organization's admin cannot see or bulk-change this roster.
reset role;
insert into public.organizations (id, name, slug) values ((select id from fx where k = 'other_org'), 'Other', 'other-f02-' || substr(gen_random_uuid()::text, 1, 8));
insert into public.organization_members (organization_id, user_id, role)
values ((select id from fx where k = 'other_org'), '55555555-5555-4555-8555-555555555555', 'owner');
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
begin
  if (select problem from public.preview_roster_bulk_change(
        (select id from fx where k = 'other_org'), array[(select id from fx where k = 'sam')], 'add_tag', 'x'))
     <> 'not_found' then
    raise exception 'foreign person visible to bulk preview';
  end if;
  if exists (select 1 from public.person_roster_events where organization_id = (select id from fx where k = 'org')) then
    raise exception 'foreign admin reads audit';
  end if;
end $$;

-- Deleting an organization removes its audit without tripping the triggers.
reset role;
delete from public.organizations where id = (select id from fx where k = 'other_org');

select 'f02-roster-extensions: ok';
rollback;
