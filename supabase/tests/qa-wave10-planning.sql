-- QA wave 10 planning fixes (W10-CD-D4, W10-CD-D8).
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

reset role;
rollback;
