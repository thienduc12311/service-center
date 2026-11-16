-- ============================================================================
-- Super-admin dashboard, part 2: behaviour.
-- Design: docs/plans/super-admin-dashboard.md
--
--   * Church creation goes through private.create_church. Self-serve
--     create_organization refuses unless platform_settings allows it.
--   * Applications are approved or rejected by service-role functions.
--   * Disabling a church suspends its members; every RLS check already
--     requires status = 'active', so they are blocked everywhere.
--   * A super admin "enters" a church through a temporary owner membership
--     that creates no roster person and is hidden from other members.
--   * Media quota: attachments are checked when the upload is requested;
--     direct uploads while the church is under quota.
--
-- Every function that changes platform state takes the acting super admin,
-- re-checks that they are one, and writes platform_audit_log in the same
-- transaction. All of them are service role only: the API calls them after
-- checking the session (MFA included).
-- ============================================================================

-- ------------------------------------------------------------- audit -------

create or replace function private.platform_audit(
  p_actor        uuid,
  p_action       text,
  p_organization uuid,
  p_application  uuid,
  p_details      jsonb
)
returns void language sql security definer set search_path = '' as $$
  insert into public.platform_audit_log (actor_id, action, organization_id, application_id, details)
  values (p_actor, p_action, p_organization, p_application, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function private.platform_audit(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function private.require_platform_admin(p_actor uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not private.is_platform_admin(p_actor) then
    raise exception 'Only platform admins can do that' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function private.require_platform_admin(uuid) from public, anon, authenticated;

-- For actions the API performs itself (editing an application, requests made
-- while inside a church as a platform admin).
create or replace function public.record_platform_audit(
  p_actor        uuid,
  p_action       text,
  p_organization uuid,
  p_application  uuid,
  p_details      jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_platform_admin(p_actor);
  perform private.platform_audit(p_actor, p_action, p_organization, p_application, p_details);
end;
$$;
revoke execute on function public.record_platform_audit(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_platform_audit(uuid, text, uuid, uuid, jsonb) to service_role;

create or replace function public.is_platform_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin(p_user);
$$;
revoke execute on function public.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;

-- Who to email about a new application.
create or replace function public.platform_admin_user_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select a.user_id from private.platform_admins a order by a.created_at;
$$;
revoke execute on function public.platform_admin_user_ids() from public, anon, authenticated;
grant execute on function public.platform_admin_user_ids() to service_role;

-- ---------------------------------------------------------- creating -------

create or replace function private.create_church(
  p_owner           uuid,
  p_name            text,
  p_slug            text,
  p_timezone        text,
  p_address_line1   text default null,
  p_address_line2   text default null,
  p_city            text default null,
  p_state_province  text default null,
  p_postal_code     text default null,
  p_country         text default null,
  p_member_count    int  default null
)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
begin
  if p_owner is null or not exists (select 1 from public.profiles p where p.id = p_owner) then
    raise exception 'The owner has no account' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'A church name needs 1 to 120 characters' using errcode = '22023';
  end if;
  if coalesce(p_timezone, '') = '' or not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = p_timezone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;

  insert into public.organizations (
    name, slug, timezone, address_line1, address_line2, city, state_province, postal_code, country, member_count
  ) values (
    btrim(p_name), p_slug, p_timezone, p_address_line1, p_address_line2, p_city, p_state_province,
    p_postal_code, p_country, p_member_count
  ) returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org.id, p_owner, 'owner', 'active');

  return v_org;
end;
$$;
revoke execute on function private.create_church(uuid, text, text, text, text, text, text, text, text, text, int)
  from public, anon, authenticated;

-- Self-serve creation (the original flow) only while the platform allows it.
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text default 'America/Toronto')
returns public.organizations
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not coalesce((select s.allow_self_serve_church_creation from public.platform_settings s), false) then
    raise exception 'New churches need an approved application' using errcode = '42501', hint = 'church_application_required';
  end if;
  return private.create_church((select auth.uid()), p_name, p_slug, p_timezone);
end;
$$;

-- Whether the app should offer "Create a church" or "Apply for a church".
create or replace function public.church_creation_policy()
returns table (self_serve_allowed boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.allow_self_serve_church_creation from public.platform_settings s), false);
$$;
revoke execute on function public.church_creation_policy() from public, anon;
grant execute on function public.church_creation_policy() to authenticated, service_role;

-- A super admin creates a church directly and names its owner.
create or replace function public.admin_create_church(
  p_actor           uuid,
  p_owner           uuid,
  p_name            text,
  p_slug            text,
  p_timezone        text,
  p_address_line1   text,
  p_address_line2   text,
  p_city            text,
  p_state_province  text,
  p_postal_code     text,
  p_country         text,
  p_member_count    int
)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
begin
  perform private.require_platform_admin(p_actor);
  v_org := private.create_church(p_owner, p_name, p_slug, p_timezone, p_address_line1, p_address_line2,
                                 p_city, p_state_province, p_postal_code, p_country, p_member_count);
  perform private.platform_audit(p_actor, 'church.created', v_org.id, null,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'owner_id', p_owner));
  return v_org;
end;
$$;
revoke execute on function public.admin_create_church(uuid, uuid, text, text, text, text, text, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.admin_create_church(uuid, uuid, text, text, text, text, text, text, text, text, text, int)
  to service_role;

-- -------------------------------------------------------- applications -----

create or replace function public.approve_church_application(p_actor uuid, p_application uuid, p_slug text)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_app public.church_applications;
  v_org public.organizations;
begin
  perform private.require_platform_admin(p_actor);
  select * into v_app from public.church_applications where id = p_application for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if v_app.status <> 'pending' then
    raise exception 'This application was already decided or withdrawn' using errcode = 'PT409', hint = 'application_not_pending';
  end if;

  v_org := private.create_church(v_app.applicant_id, v_app.church_name, p_slug, v_app.timezone,
                                 v_app.address_line1, v_app.address_line2, v_app.city, v_app.state_province,
                                 v_app.postal_code, v_app.country, v_app.expected_member_count);

  update public.church_applications
     set status = 'approved', organization_id = v_org.id, reviewed_by = p_actor, reviewed_at = now()
   where id = p_application;

  perform private.platform_audit(p_actor, 'application.approved', v_org.id, p_application,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug, 'owner_id', v_app.applicant_id));
  return v_org;
end;
$$;
revoke execute on function public.approve_church_application(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.approve_church_application(uuid, uuid, text) to service_role;

create or replace function public.reject_church_application(p_actor uuid, p_application uuid, p_reason text)
returns public.church_applications
language plpgsql security definer set search_path = '' as $$
declare
  v_app public.church_applications;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require_platform_admin(p_actor);
  if char_length(v_reason) not between 1 and 1000 then
    raise exception 'A reason of 1 to 1000 characters is required' using errcode = '22023';
  end if;
  select * into v_app from public.church_applications where id = p_application for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if v_app.status <> 'pending' then
    raise exception 'This application was already decided or withdrawn' using errcode = 'PT409', hint = 'application_not_pending';
  end if;

  update public.church_applications
     set status = 'rejected', rejection_reason = v_reason, reviewed_by = p_actor, reviewed_at = now()
   where id = p_application
  returning * into v_app;

  perform private.platform_audit(p_actor, 'application.rejected', null, p_application,
    jsonb_build_object('church_name', v_app.church_name, 'reason', v_reason));
  return v_app;
end;
$$;
revoke execute on function public.reject_church_application(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_church_application(uuid, uuid, text) to service_role;

-- ---------------------------------------------------- disabling a church ---
-- Only set_organization_platform_status may move a membership into or out of
-- 'suspended'; it marks the transaction with app.platform_status_change.
-- Anything that activates a membership while the church is disabled (an
-- accepted invitation, an admin edit from the service role) gets 'suspended'.

create or replace function private.guard_member_suspension()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_by_platform boolean := coalesce(current_setting('app.platform_status_change', true), '') = 'on';
  v_disabled    boolean;
begin
  if v_by_platform or new.platform_access_expires_at is not null then
    return new;
  end if;

  select c.status = 'disabled' into v_disabled
    from public.organization_platform_controls c where c.organization_id = new.organization_id;

  if coalesce(v_disabled, false) and new.status = 'active' then
    new.status := 'suspended';
    return new;
  end if;
  if new.status = 'suspended' and (tg_op = 'INSERT' or old.status is distinct from 'suspended')
     and not coalesce(v_disabled, false) then
    raise exception 'Members are suspended only when a church is disabled' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_member_suspension() from public, anon, authenticated;
create trigger organization_members_guard_suspension
  before insert or update of status on public.organization_members
  for each row execute function private.guard_member_suspension();

create or replace function public.set_organization_platform_status(
  p_actor  uuid,
  p_org    uuid,
  p_status public.organization_platform_status,
  p_reason text
)
returns public.organization_platform_controls
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.organization_platform_controls;
  v_after  public.organization_platform_controls;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_count  int;
begin
  perform private.require_platform_admin(p_actor);
  select * into v_before from public.organization_platform_controls where organization_id = p_org for update;
  if not found then raise exception 'Church not found' using errcode = 'P0002'; end if;
  if v_before.status = p_status then
    return v_before;
  end if;

  perform set_config('app.platform_status_change', 'on', true);
  if p_status = 'disabled' then
    if v_reason is null or char_length(v_reason) > 500 then
      raise exception 'A reason of 1 to 500 characters is required' using errcode = '22023';
    end if;
    update public.organization_platform_controls
       set status = 'disabled', disabled_reason = v_reason, disabled_at = now(), disabled_by = p_actor
     where organization_id = p_org
    returning * into v_after;
    update public.organization_members
       set status = 'suspended'
     where organization_id = p_org and status = 'active' and platform_access_expires_at is null;
  else
    update public.organization_platform_controls
       set status = 'active', disabled_reason = null, disabled_at = null, disabled_by = null
     where organization_id = p_org
    returning * into v_after;
    update public.organization_members
       set status = 'active'
     where organization_id = p_org and status = 'suspended';
  end if;
  get diagnostics v_count = row_count;
  perform set_config('app.platform_status_change', 'off', true);

  perform private.platform_audit(p_actor,
    case when p_status = 'disabled' then 'church.disabled' else 'church.enabled' end,
    p_org, null,
    jsonb_build_object('reason', coalesce(v_reason, v_before.disabled_reason), 'memberships_changed', v_count));
  return v_after;
end;
$$;
revoke execute on function public.set_organization_platform_status(uuid, uuid, public.organization_platform_status, text)
  from public, anon, authenticated;
grant execute on function public.set_organization_platform_status(uuid, uuid, public.organization_platform_status, text)
  to service_role;

-- The churches the caller belongs to that are disabled, for the "church
-- disabled" screen. Only owners see the reason.
create or replace function public.my_disabled_organizations()
returns table (organization_id uuid, organization_name text, role public.org_role,
               disabled_reason text, disabled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name, m.role,
         case when m.role = 'owner' then c.disabled_reason end,
         c.disabled_at
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    join public.organization_platform_controls c on c.organization_id = m.organization_id
   where m.user_id = (select auth.uid())
     and m.status = 'suspended'
     and c.status = 'disabled'
   order by o.name;
$$;
revoke execute on function public.my_disabled_organizations() from public, anon;
grant execute on function public.my_disabled_organizations() to authenticated;

-- ------------------------------------------------------- enter as owner ----

-- Never put a super admin on the church's roster: the roster trigger skips
-- platform access memberships (the function itself is unchanged, see F02).
drop trigger organization_members_ensure_person on public.organization_members;
create trigger organization_members_ensure_person
  after insert or update of organization_id, user_id on public.organization_members
  for each row when (new.platform_access_expires_at is null)
  execute function private.ensure_organization_member_person();

-- Other members never see, change or remove a platform access membership,
-- and nobody turns a real membership into one through the API.
create policy members_hide_platform_access on public.organization_members as restrictive
  for select to authenticated
  using (platform_access_expires_at is null or user_id = (select auth.uid()));
create policy members_platform_access_insert on public.organization_members as restrictive
  for insert to authenticated with check (platform_access_expires_at is null);
create policy members_platform_access_update on public.organization_members as restrictive
  for update to authenticated
  using (platform_access_expires_at is null)
  with check (platform_access_expires_at is null);
create policy members_platform_access_delete on public.organization_members as restrictive
  for delete to authenticated using (platform_access_expires_at is null);

create or replace function public.grant_platform_access(p_actor uuid, p_org uuid, p_hours int)
returns table (outcome text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_member  public.organization_members;
  v_expires timestamptz := now() + make_interval(hours => p_hours);
begin
  perform private.require_platform_admin(p_actor);
  if p_hours is null or p_hours not between 1 and 24 then
    raise exception 'Access lasts 1 to 24 hours' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'Church not found' using errcode = 'P0002';
  end if;

  select * into v_member from public.organization_members m
   where m.organization_id = p_org and m.user_id = p_actor for update;

  if found and v_member.platform_access_expires_at is null then
    -- Already a real member: nothing to add.
    return query select 'already_member'::text, null::timestamptz;
    return;
  end if;

  if found then
    update public.organization_members set platform_access_expires_at = v_expires
     where id = v_member.id;
    perform private.platform_audit(p_actor, 'church.access_extended', p_org, null,
      jsonb_build_object('expires_at', v_expires));
    return query select 'extended'::text, v_expires;
    return;
  end if;

  insert into public.organization_members (organization_id, user_id, role, status, platform_access_expires_at)
  values (p_org, p_actor, 'owner', 'active', v_expires);
  perform private.platform_audit(p_actor, 'church.access_granted', p_org, null,
    jsonb_build_object('expires_at', v_expires));
  return query select 'granted'::text, v_expires;
end;
$$;
revoke execute on function public.grant_platform_access(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.grant_platform_access(uuid, uuid, int) to service_role;

create or replace function public.revoke_platform_access(p_actor uuid, p_org uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_removed int;
begin
  perform private.require_platform_admin(p_actor);
  delete from public.organization_members
   where organization_id = p_org and user_id = p_actor and platform_access_expires_at is not null;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then
    perform private.platform_audit(p_actor, 'church.access_revoked', p_org, null, '{}'::jsonb);
  end if;
  return v_removed > 0;
end;
$$;
revoke execute on function public.revoke_platform_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_platform_access(uuid, uuid) to service_role;

-- Removes expired access windows. Called by the delivery worker run and on
-- every admin request; the API also refuses an expired one on its own.
create or replace function public.purge_expired_platform_access()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.organization_members;
  v_count int := 0;
begin
  for v_row in
    delete from public.organization_members
     where platform_access_expires_at is not null and platform_access_expires_at <= now()
    returning *
  loop
    perform private.platform_audit(null, 'church.access_expired', v_row.organization_id, null,
      jsonb_build_object('user_id', v_row.user_id, 'expired_at', v_row.platform_access_expires_at));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_platform_access() from public, anon, authenticated;
grant execute on function public.purge_expired_platform_access() to service_role;

-- ------------------------------------------------------ account deletion ---
-- Members of a disabled church are suspended, not gone: they still count, so
-- deleting an owner's account can't delete a disabled church that still has
-- people in it. Platform access memberships never count.
-- Otherwise identical to 20261115000000.

create or replace function private.account_deletion_plan(p_user uuid)
returns table (organization_id uuid, organization_name text, outcome text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name,
         case when exists (select 1 from public.organization_members other
                            where other.organization_id = o.id and other.user_id <> p_user
                              and other.status in ('active', 'suspended')
                              and other.platform_access_expires_at is null)
              then 'blocked' else 'deleted' end
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = p_user
     and m.status in ('active', 'suspended')
     and m.role = 'owner'
     and m.platform_access_expires_at is null
     and not exists (select 1 from public.organization_members co
                      where co.organization_id = o.id and co.user_id <> p_user
                        and co.status in ('active', 'suspended') and co.role = 'owner'
                        and co.platform_access_expires_at is null)
   order by o.name, o.id;
$$;

create or replace function public.prepare_account_deletion(p_user uuid)
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if p_user is null then raise exception 'A user is required' using errcode = '22023'; end if;

  perform 1 from public.organizations o
   where o.id in (select m.organization_id from public.organization_members m
                   where m.user_id = p_user and m.status in ('active', 'suspended') and m.role = 'owner'
                     and m.platform_access_expires_at is null)
   order by o.id
     for update;

  if exists (select 1 from private.account_deletion_plan(p_user) where outcome = 'blocked') then
    raise exception 'Make someone else an owner of your organizations before deleting your account'
      using errcode = 'PT409', hint = 'account_deletion_blocked';
  end if;

  for v_org in select organization_id from private.account_deletion_plan(p_user) where outcome = 'deleted' loop
    delete from public.plans where organization_id = v_org;
    delete from public.organizations where id = v_org;
    return next v_org;
  end loop;

  update public.people pe
     set avatar_url = null
   where pe.profile_id = p_user
     and pe.avatar_url is not distinct from (select p.avatar_url from public.profiles p where p.id = p_user);
end;
$$;

-- ---------------------------------------------------------- media quota ----

create or replace function private.organization_storage_quota(p_org uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.storage_quota_bytes from public.organization_platform_controls c where c.organization_id = p_org),
    (select s.default_storage_quota_bytes from public.platform_settings s),
    209715200
  );
$$;
revoke execute on function private.organization_storage_quota(uuid) from public, anon;
grant execute on function private.organization_storage_quota(uuid) to authenticated, service_role;

-- Exact check for attachments: used + the declared size must fit.
create or replace function private.check_attachment_storage_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.organization_storage_used(new.organization_id) + new.declared_size
       > private.organization_storage_quota(new.organization_id) then
    raise exception 'Your church is out of storage space. Remove some files or ask for more space.'
      using errcode = 'PT413', hint = 'storage_quota_exceeded';
  end if;
  return new;
end;
$$;
revoke execute on function private.check_attachment_storage_quota() from public, anon, authenticated;
create trigger attachment_versions_storage_quota
  before insert on public.attachment_versions
  for each row when (new.storage_path is not null)
  execute function private.check_attachment_storage_quota();

-- Direct uploads (logo, songbooks, church-uploaded avatars) carry no size
-- before the bytes arrive, so they are allowed while the church is under its
-- quota. One last file can overshoot by at most its bucket's size limit.
create or replace function private.storage_upload_within_quota(p_bucket text, p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.storage_object_organization(p_bucket, p_name);
begin
  if v_org is null then return true; end if;
  return private.organization_storage_used(v_org) < private.organization_storage_quota(v_org);
end;
$$;
revoke execute on function private.storage_upload_within_quota(text, text) from public, anon;
grant execute on function private.storage_upload_within_quota(text, text) to authenticated;

create policy "church storage quota on upload" on storage.objects as restrictive
  for insert to authenticated
  with check (private.storage_upload_within_quota(bucket_id, name));
create policy "church storage quota on replace" on storage.objects as restrictive
  for update to authenticated
  using (true)
  with check (private.storage_upload_within_quota(bucket_id, name));

-- A member's view of their church's storage, for the usage bar.
create or replace function public.my_organization_storage(p_org uuid)
returns table (used_bytes bigint, quota_bytes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'Church not found' using errcode = 'P0002';
  end if;
  return query select private.organization_storage_used(p_org), private.organization_storage_quota(p_org);
end;
$$;
revoke execute on function public.my_organization_storage(uuid) from public, anon;
grant execute on function public.my_organization_storage(uuid) to authenticated;

create or replace function public.set_organization_storage_quota(p_actor uuid, p_org uuid, p_quota_bytes bigint)
returns public.organization_platform_controls
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.organization_platform_controls;
  v_after  public.organization_platform_controls;
begin
  perform private.require_platform_admin(p_actor);
  if p_quota_bytes is not null and p_quota_bytes <= 0 then
    raise exception 'The quota must be more than 0 bytes' using errcode = '22023';
  end if;
  select * into v_before from public.organization_platform_controls where organization_id = p_org for update;
  if not found then raise exception 'Church not found' using errcode = 'P0002'; end if;

  update public.organization_platform_controls set storage_quota_bytes = p_quota_bytes
   where organization_id = p_org
  returning * into v_after;

  perform private.platform_audit(p_actor, 'church.quota_changed', p_org, null,
    jsonb_build_object('before', v_before.storage_quota_bytes, 'after', p_quota_bytes));
  return v_after;
end;
$$;
revoke execute on function public.set_organization_storage_quota(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.set_organization_storage_quota(uuid, uuid, bigint) to service_role;

-- Null keeps a setting as it is.
create or replace function public.update_platform_settings(
  p_actor                      uuid,
  p_default_storage_quota      bigint,
  p_allow_self_serve_creation  boolean
)
returns public.platform_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_before public.platform_settings;
  v_after  public.platform_settings;
begin
  perform private.require_platform_admin(p_actor);
  if p_default_storage_quota is not null and p_default_storage_quota <= 0 then
    raise exception 'The quota must be more than 0 bytes' using errcode = '22023';
  end if;
  select * into v_before from public.platform_settings where id for update;

  update public.platform_settings
     set default_storage_quota_bytes = coalesce(p_default_storage_quota, default_storage_quota_bytes),
         allow_self_serve_church_creation = coalesce(p_allow_self_serve_creation, allow_self_serve_church_creation),
         updated_by = p_actor
   where id  -- the single row; API sessions refuse an UPDATE without WHERE
  returning * into v_after;

  perform private.platform_audit(p_actor, 'settings.updated', null, null, jsonb_build_object(
    'before', jsonb_build_object('default_storage_quota_bytes', v_before.default_storage_quota_bytes,
                                 'allow_self_serve_church_creation', v_before.allow_self_serve_church_creation),
    'after',  jsonb_build_object('default_storage_quota_bytes', v_after.default_storage_quota_bytes,
                                 'allow_self_serve_church_creation', v_after.allow_self_serve_church_creation)));
  return v_after;
end;
$$;
revoke execute on function public.update_platform_settings(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.update_platform_settings(uuid, bigint, boolean) to service_role;

-- -------------------------------------------------------- dashboard reads --

create or replace function public.admin_organization_summaries()
returns table (
  organization_id      uuid,
  name                 text,
  slug                 text,
  created_at           timestamptz,
  status               public.organization_platform_status,
  disabled_reason      text,
  disabled_at          timestamptz,
  owner_id             uuid,
  owner_name           text,
  owner_email          text,
  accounts             int,
  invited              int,
  people               int,
  storage_used_bytes   bigint,
  storage_quota_bytes  bigint,
  quota_is_custom      boolean,
  last_activity_at     timestamptz
)
language sql stable security definer set search_path = '' as $$
  with usage as (
    select private.storage_object_organization(o.bucket_id, o.name) as organization_id,
           sum(coalesce((o.metadata ->> 'size')::bigint, 0))::bigint as used
      from storage.objects o
     group by 1
  ),
  members as (
    select m.organization_id,
           count(*) filter (where m.status in ('active', 'suspended'))::int as accounts,
           count(*) filter (where m.status = 'invited')::int as invited
      from public.organization_members m
     where m.platform_access_expires_at is null
     group by 1
  ),
  roster as (
    select pe.organization_id, count(*)::int as people
      from public.people pe where pe.archived_at is null group by 1
  ),
  activity as (
    select pl.organization_id, max(pl.updated_at) as last_plan_at from public.plans pl group by 1
  ),
  owners as (
    select distinct on (m.organization_id) m.organization_id, m.user_id, p.full_name, p.email
      from public.organization_members m
      join public.profiles p on p.id = m.user_id
     where m.role = 'owner' and m.status in ('active', 'suspended') and m.platform_access_expires_at is null
     order by m.organization_id, m.created_at
  )
  select o.id, o.name, o.slug, o.created_at,
         c.status, c.disabled_reason, c.disabled_at,
         ow.user_id, ow.full_name, ow.email,
         coalesce(mb.accounts, 0), coalesce(mb.invited, 0), coalesce(r.people, 0),
         coalesce(u.used, 0),
         private.organization_storage_quota(o.id),
         c.storage_quota_bytes is not null,
         greatest(o.updated_at, a.last_plan_at)
    from public.organizations o
    join public.organization_platform_controls c on c.organization_id = o.id
    left join usage u on u.organization_id = o.id
    left join members mb on mb.organization_id = o.id
    left join roster r on r.organization_id = o.id
    left join activity a on a.organization_id = o.id
    left join owners ow on ow.organization_id = o.id
   order by o.name, o.id;
$$;
revoke execute on function public.admin_organization_summaries() from public, anon, authenticated;
grant execute on function public.admin_organization_summaries() to service_role;

create or replace function public.admin_organization_storage(p_org uuid)
returns table (bucket_id text, object_count int, used_bytes bigint)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, count(*)::int, sum(coalesce((o.metadata ->> 'size')::bigint, 0))::bigint
    from storage.objects o
   where (o.bucket_id not in ('report-exports', 'avatars') and o.name like p_org::text || '/%')
      or (o.bucket_id = 'avatars' and o.name like 'orgs/' || p_org::text || '/%')
   group by o.bucket_id
   order by 3 desc;
$$;
revoke execute on function public.admin_organization_storage(uuid) from public, anon, authenticated;
grant execute on function public.admin_organization_storage(uuid) to service_role;
