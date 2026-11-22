-- SEC-010 (20261130000300): the organization-logos bucket's rows are readable
-- only by members of the folder's organization; anon can no longer list it.
-- Fails before that migration (anon and outsiders saw every logo row).
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/organization-logos-listing.sql
begin;

create temporary table logo_fx (k text primary key, id uuid) on commit drop;
grant select on logo_fx to anon, authenticated;
insert into logo_fx values ('org', gen_random_uuid()), ('member', gen_random_uuid()), ('outsider', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from logo_fx where k = p $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.fx(k), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'logo.' || k || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now()
  from unnest(array['member', 'outsider']) k;
insert into public.organizations (id, name, slug, timezone)
values (pg_temp.fx('org'), 'Logo Church', 'logo-church-' || left(pg_temp.fx('org')::text, 8), 'America/Toronto');
insert into public.organization_members (organization_id, user_id, role, status)
values (pg_temp.fx('org'), pg_temp.fx('member'), 'member', 'active');
insert into storage.objects (bucket_id, name, owner)
values ('organization-logos', pg_temp.fx('org')::text || '/logo.png', pg_temp.fx('member'));

create or replace function pg_temp.visible_logos() returns integer language sql as $$
  select count(*)::integer from storage.objects
   where bucket_id = 'organization-logos' and name = pg_temp.fx('org')::text || '/logo.png'
$$;

set local role anon;
do $$ begin
  if pg_temp.visible_logos() <> 0 then raise exception 'anon can list organization logos'; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('outsider'), 'role', 'authenticated')::text, true);
do $$ begin
  if pg_temp.visible_logos() <> 0 then raise exception 'a non-member can list another church''s logo'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('member'), 'role', 'authenticated')::text, true);
do $$ begin
  if pg_temp.visible_logos() <> 1 then raise exception 'a member cannot see their own church''s logo row'; end if;
end $$;
reset role;

select 'organization-logos-listing: all checks passed' as result;
rollback;
