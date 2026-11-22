-- QA wave 10 planning fixes (W10-CD-D4, W10-CD-D8).
-- Needs migrations 20261201000200 and 20261201000201.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table w10p_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w10p_fx to authenticated, service_role;
insert into w10p_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('dest', gen_random_uuid()),
  ('live_song', gen_random_uuid()), ('live_default', gen_random_uuid()), ('live_old', gen_random_uuid()),
  ('gone_song', gen_random_uuid()), ('gone_default', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w10p_fx where k = p $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('dest'), pg_temp.fx('org'), pg_temp.fx('st'), 'W10 template destination',
   ('2027-05-02'::date + '10:00'::time) at time zone 'America/Toronto', 'draft', '22222222-2222-4222-8222-222222222222');
insert into public.songs (id, organization_id, title) values
  (pg_temp.fx('live_song'), pg_temp.fx('org'), 'W10 live song'),
  (pg_temp.fx('gone_song'), pg_temp.fx('org'), 'W10 archived song');
insert into public.arrangements (id, song_id, name, is_default) values
  (pg_temp.fx('live_default'), pg_temp.fx('live_song'), 'Default', true),
  (pg_temp.fx('live_old'), pg_temp.fx('live_song'), 'Old', false),
  (pg_temp.fx('gone_default'), pg_temp.fx('gone_song'), 'Default', true);

-- ============================================ W10-CD-D4 =================
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare saved jsonb;
begin
  saved := public.save_plan_template(pg_temp.fx('org'), null, null, 'plan', pg_temp.fx('st'), 'W10 archived library', null,
    jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('item_type', 'song', 'title', 'Archived song', 'song_id', pg_temp.fx('gone_song')),
      jsonb_build_object('item_type', 'song', 'title', 'Old arrangement', 'song_id', pg_temp.fx('live_song'), 'arrangement_id', pg_temp.fx('live_old')),
      jsonb_build_object('item_type', 'item', 'title', 'Welcome'))), null, null);
  insert into w10p_fx values ('rev', (select id from public.plan_template_revisions
    where template_id = (saved ->> 'template_id')::uuid and revision = 1));
end $$;

-- Archive the song and the non-default arrangement after the template saved them.
reset role;
update public.songs set archived_at = now() where id = pg_temp.fx('gone_song');
update public.arrangements set is_default = false, archived_at = now() where id = pg_temp.fx('gone_default');
update public.arrangements set archived_at = now() where id = pg_temp.fx('live_old');
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
declare preview jsonb; result jsonb;
begin
  preview := public.preview_plan_template_apply(pg_temp.fx('dest'), pg_temp.fx('rev'), 'append', array['items'], '[]'::jsonb, null);
  if preview #> '{items,skipped}' <> jsonb_build_array(jsonb_build_object('title', 'Archived song', 'reason', 'song_archived')) then
    raise exception 'preview must skip the archived song: %', preview -> 'items';
  end if;
  if jsonb_array_length(preview #> '{items,add}') <> 2
     or preview #>> '{items,add,0,arrangement_id}' is not null then
    raise exception 'archived arrangement must fall back to the song default: %', preview #> '{items,add}';
  end if;
  if not exists (select 1 from jsonb_array_elements(preview -> 'warnings') w
                  where w ->> 'code' = 'arrangement_archived' and (w #>> '{params,count}')::int = 1) then
    raise exception 'preview must warn about the archived arrangement: %', preview -> 'warnings';
  end if;

  -- Apply does exactly what the preview said: no "Restore the song" failure.
  result := public.apply_plan_template(pg_temp.fx('dest'), pg_temp.fx('rev'), 'append', array['items'],
    preview ->> 'preview_hash', '[]'::jsonb, null, (preview ->> 'destination_revision')::bigint, 'w10-d4-apply', null);
  if (select count(*) from public.plan_items where plan_id = pg_temp.fx('dest')) <> 2 then
    raise exception 'apply must add the two schedulable items';
  end if;
  if exists (select 1 from public.plan_items where plan_id = pg_temp.fx('dest')
              and (song_id = pg_temp.fx('gone_song') or arrangement_id = pg_temp.fx('live_old'))) then
    raise exception 'apply scheduled archived library content';
  end if;
end $$;

-- ============================================ W10-CD-D8 =================
-- Jordan becomes a scheduler scoped to service type `st` only. A shared team
-- (no service type) is scheduled on `st` plans, so its candidates are listed;
-- a team of another service type stays hidden, as it does for a member.
reset role;
insert into w10p_fx values ('st2', gen_random_uuid()), ('shared', gen_random_uuid()), ('other_team', gen_random_uuid());
insert into public.service_types (id, organization_id, name) values (pg_temp.fx('st2'), pg_temp.fx('org'), 'W10 other type');
insert into public.teams (id, organization_id, service_type_id, name) values
  (pg_temp.fx('shared'), pg_temp.fx('org'), null, 'W10 shared band'),
  (pg_temp.fx('other_team'), pg_temp.fx('org'), pg_temp.fx('st2'), 'W10 other type team');
insert into public.team_memberships (team_id, person_id)
select t.id, p.id from public.people p cross join (values (pg_temp.fx('shared')), (pg_temp.fx('other_team'))) t(id)
 where p.profile_id = '33333333-3333-4333-8333-333333333333';
update public.organization_members set access_mode = 'scoped'
 where organization_id = pg_temp.fx('org') and user_id = '22222222-2222-4222-8222-222222222222';
delete from public.access_grants
 where organization_id = pg_temp.fx('org') and user_id = '22222222-2222-4222-8222-222222222222';
insert into public.access_grants (organization_id, user_id, capability, scope_type, service_type_id) values
  (pg_temp.fx('org'), '22222222-2222-4222-8222-222222222222', 'scheduling.manage', 'service_type', pg_temp.fx('st'));

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
begin
  if not exists (select 1 from public.team_candidates(pg_temp.fx('shared')) c
                  where c.profile_id = '33333333-3333-4333-8333-333333333333') then
    raise exception 'a service-type scheduler must list the shared team''s candidates';
  end if;
  begin
    perform public.team_candidates(pg_temp.fx('other_team'));
    raise exception 'a scheduler scoped to st listed a team of another service type';
  exception when no_data_found then null;
  end;
end $$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  perform public.team_candidates(pg_temp.fx('shared'));
  raise exception 'a member listed the shared team''s candidates';
exception when no_data_found then null;
end $$;

reset role;
rollback;
