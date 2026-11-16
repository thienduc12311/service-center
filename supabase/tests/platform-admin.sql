-- Super-admin dashboard (migrations 20261116000000 and 20261116000100).
-- Run against the seeded local database; everything is rolled back:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/platform-admin.sql
begin;

-- Fixtures: someone applying for a church and a super admin.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a1a1a1-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'applicant.platform@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Ada Applicant"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ad000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'admin.platform@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Pat Platform"}'::jsonb, now(), now());
insert into private.platform_admins (user_id) values ('ad000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------- defaults --
do $$
begin
  if (select allow_self_serve_church_creation from public.platform_settings) then
    raise exception 'Self-serve church creation should start off';
  end if;
  if (select default_storage_quota_bytes from public.platform_settings) <> 209715200 then
    raise exception 'Default quota should be 200 MB';
  end if;
  if not exists (select 1 from public.organization_platform_controls
                  where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'active') then
    raise exception 'An existing church has no active controls row';
  end if;
end;
$$;

-- --------------------------------------------- applicant, under RLS ----------
set local role authenticated;
set local request.jwt.claim.sub = 'a1a1a1a1-0000-4000-8000-000000000001';
do $$
declare
  v_id uuid;
  v_hint text;
  n int;
begin
  begin
    perform public.create_organization('Not Allowed', 'not-allowed');
    raise exception 'Self-serve creation was allowed while switched off';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'church_application_required' then
      raise exception 'Self-serve refusal has hint %', v_hint;
    end if;
  end;
  if (select self_serve_allowed from public.church_creation_policy()) then
    raise exception 'Creation policy says self-serve is allowed';
  end if;

  insert into public.church_applications (church_name, leader_name, city, country, timezone)
  values ('Grace Test Church', 'Pastor Test', 'Atlanta', 'USA', 'America/New_York')
  returning id into v_id;

  begin
    insert into public.church_applications (church_name, leader_name, city, country)
    values ('Second Church', 'Pastor Two', 'Atlanta', 'USA');
    raise exception 'A second pending application was accepted';
  exception when unique_violation then null;
  end;

  begin
    update public.church_applications set status = 'approved' where id = v_id;
    raise exception 'The applicant approved their own application';
  exception when insufficient_privilege then null;
  end;

  begin
    perform reviewed_by from public.church_applications;
    raise exception 'The applicant can read who reviewed it';
  exception when insufficient_privilege then null;
  end;

  update public.church_applications set note = 'We meet on Sundays' where id = v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'The applicant could not edit a pending application'; end if;

  perform set_config('test.application', v_id::text, true);
end;
$$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if exists (select 1 from public.church_applications) then
    raise exception 'Another person saw an application';
  end if;
end;
$$;
reset role;

-- ------------------------------------------------------------- approval -----
do $$
declare
  v_app uuid := current_setting('test.application')::uuid;
  v_org public.organizations;
begin
  begin
    perform public.approve_church_application('11111111-1111-4111-8111-111111111111', v_app, 'grace-test');
    raise exception 'A church owner who is not a platform admin approved an application';
  exception when insufficient_privilege then null;
  end;

  v_org := public.approve_church_application('ad000000-0000-4000-8000-000000000001', v_app, 'grace-test');
  if v_org.timezone <> 'America/New_York' or v_org.city <> 'Atlanta' then
    raise exception 'The church did not take the application details';
  end if;
  if not exists (select 1 from public.organization_members
                  where organization_id = v_org.id and user_id = 'a1a1a1a1-0000-4000-8000-000000000001'
                    and role = 'owner' and status = 'active') then
    raise exception 'The applicant is not the owner of the new church';
  end if;
  if not exists (select 1 from public.church_applications
                  where id = v_app and status = 'approved' and organization_id = v_org.id and reviewed_at is not null) then
    raise exception 'The application was not marked approved';
  end if;
  if not exists (select 1 from public.organization_platform_controls where organization_id = v_org.id and status = 'active') then
    raise exception 'The new church has no controls row';
  end if;
  if not exists (select 1 from public.platform_audit_log
                  where action = 'application.approved' and application_id = v_app and organization_id = v_org.id) then
    raise exception 'Approval was not audited';
  end if;

  begin
    perform public.approve_church_application('ad000000-0000-4000-8000-000000000001', v_app, 'grace-test-2');
    raise exception 'An application was approved twice';
  exception when sqlstate 'PT409' then null;
  end;
end;
$$;

-- ------------------------------------------------------------ disabling -----
do $$
declare
  v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_admin uuid := 'ad000000-0000-4000-8000-000000000001';
begin
  update public.organization_members set status = 'inactive'
   where organization_id = v_org and user_id = '44444444-4444-4444-8444-444444444444';

  begin
    perform public.set_organization_platform_status(v_admin, v_org, 'disabled', '  ');
    raise exception 'A church was disabled without a reason';
  exception when invalid_parameter_value then null;
  end;

  perform public.set_organization_platform_status(v_admin, v_org, 'disabled', 'Testing');
  if exists (select 1 from public.organization_members where organization_id = v_org and status = 'active') then
    raise exception 'A disabled church still has an active member';
  end if;
  if (select status from public.organization_members
       where organization_id = v_org and user_id = '44444444-4444-4444-8444-444444444444') <> 'inactive' then
    raise exception 'An inactive member was suspended';
  end if;

  -- Activating someone while the church is disabled (an accepted invitation) suspends them.
  update public.organization_members set status = 'active'
   where organization_id = v_org and user_id = '44444444-4444-4444-8444-444444444444';
  if (select status from public.organization_members
       where organization_id = v_org and user_id = '44444444-4444-4444-8444-444444444444') <> 'suspended' then
    raise exception 'A member was activated in a disabled church';
  end if;

  if not exists (select 1 from private.account_deletion_plan('11111111-1111-4111-8111-111111111111')
                  where organization_id = v_org and outcome = 'blocked') then
    raise exception 'Deleting the owner would delete a disabled church that still has members';
  end if;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if public.is_org_member('aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'A suspended member is still a member';
  end if;
  if exists (select 1 from public.plans where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'A suspended member can read plans';
  end if;
  if not exists (select 1 from public.my_disabled_organizations()
                  where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and disabled_reason is null) then
    raise exception 'A member does not see the disabled church, or sees the reason';
  end if;
end;
$$;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  if (select disabled_reason from public.my_disabled_organizations()
       where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') is distinct from 'Testing' then
    raise exception 'The owner does not see the reason';
  end if;
end;
$$;
reset role;

do $$
declare
  v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform public.set_organization_platform_status('ad000000-0000-4000-8000-000000000001', v_org, 'active', null);
  if exists (select 1 from public.organization_members where organization_id = v_org and status = 'suspended') then
    raise exception 'Enabling left members suspended';
  end if;
  if (select count(*) from public.platform_audit_log
       where organization_id = v_org and action in ('church.disabled', 'church.enabled')) <> 2 then
    raise exception 'Disable/enable was not audited';
  end if;

  begin
    update public.organization_members set status = 'suspended'
     where organization_id = v_org and user_id = '33333333-3333-4333-8333-333333333333';
    raise exception 'A member was suspended in an active church';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- ------------------------------------------------------- enter as owner -----
do $$
declare
  v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_admin uuid := 'ad000000-0000-4000-8000-000000000001';
  r record;
begin
  select * into r from public.grant_platform_access(v_admin, v_org, 8);
  if r.outcome <> 'granted' or r.expires_at is null then raise exception 'Access was not granted'; end if;
  if exists (select 1 from public.people where organization_id = v_org and profile_id = v_admin) then
    raise exception 'Entering a church put the super admin on its roster';
  end if;
  if not private.capability_for(v_admin, v_org, 'people.manage', null, null) then
    raise exception 'The super admin does not have owner powers inside the church';
  end if;
  if (select accounts from public.admin_organization_summaries() where organization_id = v_org) <> 5 then
    raise exception 'Platform access is counted as an account';
  end if;
  -- The real owner is still the only owner: platform access is not a co-owner.
  if not exists (select 1 from private.account_deletion_plan('11111111-1111-4111-8111-111111111111')
                  where organization_id = v_org) then
    raise exception 'Platform access counts as another owner';
  end if;

  select * into r from public.grant_platform_access(v_admin, v_org, 2);
  if r.outcome <> 'extended' then raise exception 'Entering again did not extend access'; end if;

  begin
    select * into r from public.grant_platform_access('11111111-1111-4111-8111-111111111111', v_org, 8);
    raise exception 'A church owner who is not a platform admin got platform access';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare n int;
begin
  if exists (select 1 from public.organization_members where user_id = 'ad000000-0000-4000-8000-000000000001') then
    raise exception 'The church owner sees the platform access membership';
  end if;
  delete from public.organization_members where user_id = 'ad000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'The church owner removed the platform access membership'; end if;
end;
$$;
set local request.jwt.claim.sub = 'ad000000-0000-4000-8000-000000000001';
do $$
declare n int;
begin
  if not public.is_org_member('aaaaaaaa-0000-4000-8000-000000000001') then
    raise exception 'The super admin is not a member while inside';
  end if;
  update public.organization_members set platform_access_expires_at = now() + interval '1 year'
   where user_id = 'ad000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'The super admin extended their own access through the API'; end if;
end;
$$;
reset role;

do $$
declare
  v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_admin uuid := 'ad000000-0000-4000-8000-000000000001';
begin
  update public.organization_members set platform_access_expires_at = now() - interval '1 minute'
   where organization_id = v_org and user_id = v_admin;
  if public.purge_expired_platform_access() <> 1 then raise exception 'Expired access was not purged'; end if;
  if exists (select 1 from public.organization_members where organization_id = v_org and user_id = v_admin) then
    raise exception 'Expired access is still there';
  end if;
  if not exists (select 1 from public.platform_audit_log where organization_id = v_org and action = 'church.access_expired') then
    raise exception 'Expiry was not audited';
  end if;
end;
$$;

-- ----------------------------------------------------------- media quota ----
-- Relative to what the seeded church already stores.
do $$
declare
  v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_admin uuid := 'ad000000-0000-4000-8000-000000000001';
  v_base bigint := private.organization_storage_used('aaaaaaaa-0000-4000-8000-000000000001');
begin
  insert into storage.objects (bucket_id, name, metadata)
  values ('songbooks', v_org::text || '/quota-test.pdf', '{"size": 1000}'::jsonb),
         ('report-exports', v_org::text || '/u/export.csv', '{"size": 5000}'::jsonb),
         ('avatars', 'users/11111111-1111-4111-8111-111111111111/quota-test.png', '{"size": 7000}'::jsonb),
         ('avatars', 'orgs/' || v_org::text || '/people/p/quota-test.png', '{"size": 300}'::jsonb);

  if private.organization_storage_used(v_org) - v_base <> 1300 then
    raise exception 'Storage grew by %, expected 1300 (report exports and personal avatars excluded)',
      private.organization_storage_used(v_org) - v_base;
  end if;

  perform public.set_organization_storage_quota(v_admin, v_org, v_base + 1200);
  if private.storage_upload_within_quota('songbooks', v_org::text || '/next.pdf') then
    raise exception 'A direct upload was allowed over quota';
  end if;
  if not private.storage_upload_within_quota('avatars', 'users/11111111-1111-4111-8111-111111111111/new.png') then
    raise exception 'A personal avatar was held to the church quota';
  end if;

  perform public.set_organization_storage_quota(v_admin, v_org, v_base + 2000);
  if not private.storage_upload_within_quota('songbooks', v_org::text || '/next.pdf') then
    raise exception 'A direct upload under quota was refused';
  end if;
  perform set_config('test.storage_base', v_base::text, true);
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_base bigint := current_setting('test.storage_base')::bigint;
  v_used bigint;
  v_quota bigint;
begin
  select used_bytes, quota_bytes into v_used, v_quota
    from public.my_organization_storage('aaaaaaaa-0000-4000-8000-000000000001');
  if v_used <> v_base + 1300 or v_quota <> v_base + 2000 then
    raise exception 'Members see % of %', v_used, v_quota;
  end if;

  -- 1300 more used + 800 declared > 2000 more allowed.
  begin
    perform public.create_file_upload_intent('service_type', 'bbbbbbbb-0000-4000-8000-000000000001', null, null,
      'big.pdf', 'application/pdf', 800, null, 'document', 'organization', null, null, 'quota-test-over');
    raise exception 'An attachment upload over quota was accepted';
  exception when sqlstate 'PT413' then null;
  end;

  perform public.create_file_upload_intent('service_type', 'bbbbbbbb-0000-4000-8000-000000000001', null, null,
    'small.pdf', 'application/pdf', 600, null, 'document', 'organization', null, null, 'quota-test-under');
end;
$$;
reset role;

do $$
begin
  perform public.set_organization_storage_quota('ad000000-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001', null);
  if private.organization_storage_quota('aaaaaaaa-0000-4000-8000-000000000001') <> 209715200 then
    raise exception 'Clearing the override did not return to the default';
  end if;
  if (select count(*) from public.platform_audit_log where action = 'church.quota_changed') <> 3 then
    raise exception 'Quota changes were not audited';
  end if;
end;
$$;

-- ------------------------------------------------- self-serve switched on ---
do $$
begin
  perform public.update_platform_settings('ad000000-0000-4000-8000-000000000001', null, true);
end;
$$;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare v_org public.organizations;
begin
  v_org := public.create_organization('Self Serve Church', 'self-serve-church');
  if not exists (select 1 from public.organization_members
                  where organization_id = v_org.id and user_id = (select auth.uid()) and role = 'owner') then
    raise exception 'Self-serve creation did not make the creator owner';
  end if;
end;
$$;
reset role;

rollback;
