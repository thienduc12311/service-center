-- QA wave 10 file fixes. Fails on the schema before the named migration:
--   D5 (20261201000300_attachment_object_requires_live_intent): a signed upload
--      PUT after abandon / expiry is refused. Storage writes a signed upload as
--      the table owner (RLS bypassed), simulated here with a BYPASSRLS role.
--   D6 (20261201000200_file_content_request_hash): a link or document create
--      that reuses an idempotency key with another payload is PT409
--      idempotency_key_reused; the same payload still replays.
-- Run against the seeded local database (Jordan: scheduler of the seeded
-- church, legacy = every capability). Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave10-files.sql
begin;

create temporary table w10f_fx (k text primary key, id uuid, path text) on commit drop;
grant select, insert on w10f_fx to authenticated, service_role;
insert into w10f_fx (k, id) values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('plan', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from w10f_fx where k = p $$;
create or replace function pg_temp.p(p text) returns text language sql stable as $$ select path from w10f_fx where k = p $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from w10f_fx where k = p), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from w10f_fx where k = p), 'role', 'authenticated')::text, true);
$$;
-- What Storage does for a signed upload: insert the object row as the table owner.
create or replace function pg_temp.signed_put(p_path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('attachments', p_path, pg_temp.fx('jordan')::text, jsonb_build_object('size', 10, 'mimetype', 'application/pdf'));
$$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  raise exception '%: expected % but it succeeded', p_label, p_state;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  if v_state <> p_state then
    raise exception '%: expected % but got % (%)', p_label, p_state, v_state, sqlerrm;
  end if;
end $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'W10 Files', '2027-06-06 14:00+00', 'published', pg_temp.fx('jordan'));

-- ===================================================== D5. abandon / expiry
set local role authenticated;
select pg_temp.as_user('jordan');
do $$
declare r jsonb;
begin
  -- A new file, abandoned before its bytes arrive (the attachment goes away).
  r := public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Gone.pdf', 'application/pdf', 10,
    null, 'other', 'organization', '{}', '{}', 'w10-d5-abandon-new');
  insert into w10f_fx values ('abandon_new', (r->'version'->>'id')::uuid, r->'version'->>'storage_path');
  perform public.abandon_file_version(pg_temp.fx('abandon_new'));
  -- A live intent whose upload is still expected.
  r := public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Live.pdf', 'application/pdf', 10,
    null, 'other', 'organization', '{}', '{}', 'w10-d5-live');
  insert into w10f_fx values ('live', (r->'version'->>'id')::uuid, r->'version'->>'storage_path');
  -- An intent that will expire.
  r := public.create_file_upload_intent('plan', pg_temp.fx('plan'), null, null, 'Late.pdf', 'application/pdf', 10,
    null, 'other', 'organization', '{}', '{}', 'w10-d5-expired');
  insert into w10f_fx values ('expired', (r->'version'->>'id')::uuid, r->'version'->>'storage_path');
end $$;
reset role;
update public.attachment_versions set upload_expires_at = now() - interval '1 second' where id = pg_temp.fx('expired');

set local role service_role;
select pg_temp.expect_error(format('select pg_temp.signed_put(%L)', pg_temp.p('abandon_new')), '42501', 'D5.1 signed PUT after abandon');
select pg_temp.expect_error(format('select pg_temp.signed_put(%L)', pg_temp.p('expired')), '42501', 'D5.2 signed PUT after expiry');
select pg_temp.expect_error(format('select pg_temp.signed_put(%L)', pg_temp.fx('org')::text || '/guess/file.pdf'), '42501', 'D5.3 signed PUT to a path with no intent');
-- The live intent still uploads and finalizes.
select pg_temp.signed_put(pg_temp.p('live'));
-- Renaming an object onto an abandoned path is refused too.
select pg_temp.expect_error(format('update storage.objects set name = %L where bucket_id = ''attachments'' and name = %L',
  pg_temp.p('abandon_new'), pg_temp.p('live')), '42501', 'D5.4 rename onto an abandoned path');
-- Storage's metadata write on the object it just stored is not affected.
update storage.objects set metadata = metadata || '{"eTag": "x"}' where bucket_id = 'attachments' and name = pg_temp.p('live');
reset role;

set local role authenticated;
select pg_temp.as_user('jordan');
do $$
declare r jsonb;
begin
  r := public.finalize_file_version(pg_temp.fx('live'));
  if r->>'outcome' <> 'ready' then raise exception 'D5.5 the live upload did not finalize: %', r; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'attachments' and name in (pg_temp.p('abandon_new'), pg_temp.p('expired'))) then
    raise exception 'D5.6 an object was stored for an abandoned or expired intent';
  end if;
end $$;
-- Other buckets are untouched by the trigger.
set local role service_role;
insert into storage.objects (bucket_id, name, metadata) values ('report-exports', 'w10-d5/other-bucket.csv', '{}');
reset role;

-- ===================================================== D6. reused keys
set local role authenticated;
select pg_temp.as_user('jordan');
do $$
declare r jsonb; v_first uuid;
begin
  -- Links.
  r := public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'link', 'Rehearsal video',
    'https://example.com/watch?v=1', null, 'video', 'organization', '{}', '{}', 'w10-d6-link');
  v_first := (r->'attachment'->>'id')::uuid;
  r := public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'link', 'Rehearsal video',
    'https://example.com/watch?v=1', null, 'video', 'organization', '{}', '{}', 'w10-d6-link');
  if not (r->>'replayed')::boolean or (r->'attachment'->>'id')::uuid <> v_first then
    raise exception 'D6.1 the same link request did not replay: %', r;
  end if;
  begin
    perform public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'link', 'Rehearsal video',
      'https://example.com/watch?v=2', null, 'video', 'organization', '{}', '{}', 'w10-d6-link');
    raise exception 'D6.2 a reused link key with another URL replayed';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%already used%' then raise; end if;
  end;
  begin
    perform public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'link', 'Another title',
      'https://example.com/watch?v=1', null, 'video', 'organization', '{}', '{}', 'w10-d6-link');
    raise exception 'D6.3 a reused link key with another title replayed';
  exception when sqlstate 'PT409' then null; end;

  -- Documents.
  r := public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'document', 'Stage notes', null,
    'Body one', 'other', 'organization', '{}', '{}', 'w10-d6-doc');
  v_first := (r->'attachment'->>'id')::uuid;
  r := public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'document', 'Stage notes', null,
    'Body one', 'other', 'organization', '{}', '{}', 'w10-d6-doc');
  if not (r->>'replayed')::boolean or (r->'attachment'->>'id')::uuid <> v_first then
    raise exception 'D6.4 the same document request did not replay: %', r;
  end if;
  begin
    perform public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'document', 'Stage notes', null,
      'Body two', 'other', 'organization', '{}', '{}', 'w10-d6-doc');
    raise exception 'D6.5 a reused document key with another body replayed';
  exception when sqlstate 'PT409' then null; end;

  -- A key first used for an upload intent is not a link's key.
  begin
    perform public.save_file_content('plan', pg_temp.fx('plan'), null, null, 'link', 'Not the upload',
      'https://example.com/x', null, 'video', 'organization', '{}', '{}', 'w10-d5-live');
    raise exception 'D6.6 an upload key replayed as a link';
  exception when sqlstate 'PT409' then null; end;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.attachments where plan_id = pg_temp.fx('plan') and kind in ('link', 'document')) <> 2 then
    raise exception 'D6.7 expected exactly one link and one document';
  end if;
  if exists (select 1 from public.attachments where plan_id = pg_temp.fx('plan') and external_url = 'https://example.com/watch?v=2') then
    raise exception 'D6.8 the refused payload was stored';
  end if;
end $$;
-- The hash table is not reachable by clients.
set local role authenticated;
select pg_temp.expect_error('select * from private.file_content_requests', '42501', 'D6.9 client reads request hashes');
reset role;

select 'qa-wave10-files: all sections passed' as result;
rollback;
