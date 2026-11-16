-- Super-admin user management (migration 20261118000000).
-- Run against the seeded local database; everything is rolled back:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/platform-user-management.sql
begin;

-- Fixtures:
--   Avery, Blake    super admins
--   Uma             a member of a church
--   Sol             sole owner of a church nobody else is in
--   Ora             sole owner of a church with another member (Mia)
--   Nia             email not confirmed yet
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'ad000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated',
   'avery.admin@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Avery Admin"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ad000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated',
   'blake.admin@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Blake Admin"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ee000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated',
   'uma.user@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Uma User"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ee000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated',
   'sol.owner@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Sol Owner"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ee000000-0000-4000-8000-0000000000e3', 'authenticated', 'authenticated',
   'ora.owner@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Ora Owner"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ee000000-0000-4000-8000-0000000000e4', 'authenticated', 'authenticated',
   'mia.member@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Mia Member"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ee000000-0000-4000-8000-0000000000e5', 'authenticated', 'authenticated',
   'nia.new@example.com', '', null, '', '', '', '', '{}'::jsonb, '{"full_name":"Nia New"}'::jsonb, now(), now());
insert into private.platform_admins (user_id) values
  ('ad000000-0000-4000-8000-0000000000a1'), ('ad000000-0000-4000-8000-0000000000b1');

insert into public.organizations (id, name, slug) values
  ('0e000000-0000-4000-8000-0000000000c1', 'Sol Solo Church', 'sol-solo-church'),
  ('0e000000-0000-4000-8000-0000000000c2', 'Ora Shared Church', 'ora-shared-church');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ee000000-0000-4000-8000-0000000000e1', 'member', 'active'),
  ('0e000000-0000-4000-8000-0000000000c1', 'ee000000-0000-4000-8000-0000000000e2', 'owner', 'active'),
  ('0e000000-0000-4000-8000-0000000000c2', 'ee000000-0000-4000-8000-0000000000e3', 'owner', 'active'),
  ('0e000000-0000-4000-8000-0000000000c2', 'ee000000-0000-4000-8000-0000000000e4', 'member', 'active');

-- Uma is signed in on one device.
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('5e000000-0000-4000-8000-0000000000e1', 'ee000000-0000-4000-8000-0000000000e1', now(), now());
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, session_id, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'uma-refresh-token', 'ee000000-0000-4000-8000-0000000000e1', false,
        '5e000000-0000-4000-8000-0000000000e1', now(), now());

-- ---------------------------------------------------------- privileges -----
set local role authenticated;
set local request.jwt.claim.sub = 'ee000000-0000-4000-8000-0000000000e1';
do $$
begin
  begin
    perform public.admin_block_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e2', 'x');
    raise exception 'A signed-in user could call admin_block_user';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.admin_user_summaries();
    raise exception 'A signed-in user could list every account';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.platform_user_blocks;
    raise exception 'A signed-in user could read platform_user_blocks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.platform_admin_invitations;
    raise exception 'A signed-in user could read platform_admin_invitations';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------- reading --
do $$
declare
  v_row record;
begin
  select * into v_row from public.admin_user_summaries('ee000000-0000-4000-8000-0000000000e3');
  if v_row.email <> 'ora.owner@example.com' or v_row.is_platform_admin or v_row.blocked_at is not null then
    raise exception 'Ora''s summary is wrong: %', v_row;
  end if;
  if jsonb_array_length(v_row.memberships) <> 1
     or v_row.memberships -> 0 ->> 'organization_name' <> 'Ora Shared Church'
     or v_row.memberships -> 0 ->> 'role' <> 'owner' then
    raise exception 'Ora''s churches are wrong: %', v_row.memberships;
  end if;
  if not (select is_platform_admin from public.admin_user_summaries('ad000000-0000-4000-8000-0000000000a1')) then
    raise exception 'Avery is not shown as a super admin';
  end if;
  if (select count(*) from public.admin_platform_admins()
       where user_id in ('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000b1')) <> 2 then
    raise exception 'admin_platform_admins misses someone';
  end if;
  if (select outcome from public.admin_user_deletion_plan('ee000000-0000-4000-8000-0000000000e3')) <> 'blocked' then
    raise exception 'Deleting Ora should be blocked';
  end if;
end;
$$;

-- --------------------------------------------------------------- blocking --
do $$
declare
  v_hint  text;
  v_audit public.platform_audit_log;
  v_user  auth.users;
begin
  -- Not a super admin.
  begin
    perform public.admin_block_user('ee000000-0000-4000-8000-0000000000e2', 'ee000000-0000-4000-8000-0000000000e1', 'spam');
    raise exception 'A non-admin blocked someone';
  exception when insufficient_privilege then null;
  end;
  -- Yourself.
  begin
    perform public.admin_block_user('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000a1', 'oops');
    raise exception 'A super admin blocked themselves';
  exception when invalid_parameter_value then null;
  end;
  -- Another super admin.
  begin
    perform public.admin_block_user('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000b1', 'no');
    raise exception 'A super admin was blocked';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'target_is_platform_admin' then raise exception 'Wrong hint %', v_hint; end if;
  end;
  -- No reason.
  begin
    perform public.admin_block_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1', '  ');
    raise exception 'Blocked without a reason';
  exception when invalid_parameter_value then null;
  end;

  perform public.admin_block_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1', ' Spam messages ');
  select * into v_user from auth.users where id = 'ee000000-0000-4000-8000-0000000000e1';
  if v_user.banned_until is null or v_user.banned_until < now() + interval '50 years' then
    raise exception 'Uma''s login is not banned';
  end if;
  if exists (select 1 from auth.sessions where user_id = 'ee000000-0000-4000-8000-0000000000e1')
     or exists (select 1 from auth.refresh_tokens where user_id = 'ee000000-0000-4000-8000-0000000000e1') then
    raise exception 'Uma is still signed in';
  end if;
  if (select status from public.organization_members
       where user_id = 'ee000000-0000-4000-8000-0000000000e1' and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') <> 'active' then
    raise exception 'Blocking changed Uma''s membership';
  end if;
  select * into v_audit from public.platform_audit_log where action = 'user.blocked' order by id desc limit 1;
  if v_audit.actor_id <> 'ad000000-0000-4000-8000-0000000000a1'
     or v_audit.target_user_id <> 'ee000000-0000-4000-8000-0000000000e1'
     or v_audit.details ->> 'reason' <> 'Spam messages'
     or (v_audit.details ->> 'sessions_ended')::int <> 1 then
    raise exception 'user.blocked audit is wrong: %', row_to_json(v_audit);
  end if;
  if (select block_reason from public.admin_user_summaries('ee000000-0000-4000-8000-0000000000e1')) <> 'Spam messages' then
    raise exception 'The summary does not show the block';
  end if;

  -- Blocking again changes nothing and logs nothing.
  perform public.admin_block_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1', 'Again');
  if (select count(*) from public.platform_audit_log where action = 'user.blocked'
        and target_user_id = 'ee000000-0000-4000-8000-0000000000e1') <> 1 then
    raise exception 'A repeated block was logged';
  end if;
  if (select reason from public.platform_user_blocks where user_id = 'ee000000-0000-4000-8000-0000000000e1') <> 'Spam messages' then
    raise exception 'A repeated block changed the reason';
  end if;

  -- A blocked account can't be invited.
  begin
    perform public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'uma.user@example.com');
    raise exception 'A blocked account was invited';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'user_blocked' then raise exception 'Wrong hint %', v_hint; end if;
  end;

  -- Unblock.
  if not public.admin_unblock_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1') then
    raise exception 'Unblocking reported no change';
  end if;
  if (select banned_until from auth.users where id = 'ee000000-0000-4000-8000-0000000000e1') is not null
     or exists (select 1 from public.platform_user_blocks where user_id = 'ee000000-0000-4000-8000-0000000000e1') then
    raise exception 'Uma is still blocked';
  end if;
  select * into v_audit from public.platform_audit_log where action = 'user.unblocked' order by id desc limit 1;
  if v_audit.target_user_id <> 'ee000000-0000-4000-8000-0000000000e1' or v_audit.details ->> 'blocked_reason' <> 'Spam messages' then
    raise exception 'user.unblocked audit is wrong: %', row_to_json(v_audit);
  end if;
  if public.admin_unblock_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1') then
    raise exception 'Unblocking an unblocked account reported a change';
  end if;
end;
$$;

-- --------------------------------------------------------------- deleting --
do $$
declare
  v_hint    text;
  v_before  int := (select count(*) from public.platform_audit_log);
  v_deleted record;
  v_audit   public.platform_audit_log;
begin
  -- Ora would leave Mia without an owner.
  begin
    perform * from public.admin_delete_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e3');
    raise exception 'Ora was deleted while Mia would be left without an owner';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'account_deletion_blocked' then raise exception 'Wrong hint %', v_hint; end if;
  end;
  if not exists (select 1 from auth.users where id = 'ee000000-0000-4000-8000-0000000000e3')
     or (select count(*) from public.platform_audit_log) <> v_before then
    raise exception 'A refused deletion changed something';
  end if;

  -- Super admins and yourself.
  begin
    perform * from public.admin_delete_user('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000b1');
    raise exception 'A super admin was deleted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform * from public.admin_delete_user('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000a1');
    raise exception 'A super admin deleted themselves';
  exception when invalid_parameter_value then null;
  end;

  -- Sol's church goes with Sol.
  select * into v_deleted from public.admin_delete_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e2');
  if v_deleted.organization_id <> '0e000000-0000-4000-8000-0000000000c1' or v_deleted.organization_name <> 'Sol Solo Church' then
    raise exception 'Wrong deleted church: %', v_deleted;
  end if;
  if exists (select 1 from auth.users where id = 'ee000000-0000-4000-8000-0000000000e2')
     or exists (select 1 from public.profiles where id = 'ee000000-0000-4000-8000-0000000000e2')
     or exists (select 1 from public.organizations where id = '0e000000-0000-4000-8000-0000000000c1') then
    raise exception 'Sol or Sol''s church still exists';
  end if;
  select * into v_audit from public.platform_audit_log where action = 'user.deleted' order by id desc limit 1;
  if v_audit.target_user_id <> 'ee000000-0000-4000-8000-0000000000e2'
     or v_audit.details ->> 'email' <> 'sol.owner@example.com'
     or v_audit.details ->> 'full_name' <> 'Sol Owner'
     or v_audit.details -> 'deleted_organizations' -> 0 ->> 'name' <> 'Sol Solo Church' then
    raise exception 'user.deleted audit is wrong: %', row_to_json(v_audit);
  end if;

  begin
    perform * from public.admin_delete_user('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e2');
    raise exception 'Deleted a missing account';
  exception when no_data_found then null;
  end;
end;
$$;

-- ----------------------------------------------------------- super admins --
do $$
declare
  v_hint   text;
  v_first  public.platform_admin_invitations;
  v_again  public.platform_admin_invitations;
  v_nia    public.platform_admin_invitations;
  v_audit  public.platform_audit_log;
begin
  -- Existing super admins can't be invited.
  begin
    perform public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'Blake.Admin@example.com');
    raise exception 'A super admin was invited';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'already_platform_admin' then raise exception 'Wrong hint %', v_hint; end if;
  end;
  begin
    perform public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'not an email');
    raise exception 'An invalid email was invited';
  exception when invalid_parameter_value then null;
  end;

  v_first := public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000a1', ' Uma.User@Example.com ');
  if v_first.email <> 'uma.user@example.com' or v_first.expires_at < now() + interval '6 days' then
    raise exception 'Invitation is wrong: %', row_to_json(v_first);
  end if;
  v_again := public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000b1', 'uma.user@example.com', 14);
  if v_again.id <> v_first.id or v_again.expires_at < now() + interval '13 days' then
    raise exception 'Re-inviting did not extend the open invitation';
  end if;
  select * into v_audit from public.platform_audit_log where action = 'admin.invited' order by id desc limit 1;
  if v_audit.target_user_id <> 'ee000000-0000-4000-8000-0000000000e1' or not (v_audit.details ->> 'resent')::boolean then
    raise exception 'admin.invited audit is wrong: %', row_to_json(v_audit);
  end if;
  if (select id from public.my_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e1')) <> v_first.id then
    raise exception 'Uma does not see her invitation';
  end if;

  -- Only the invited, confirmed address can accept.
  begin
    perform public.accept_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e4', v_first.id);
    raise exception 'Someone else accepted Uma''s invitation';
  exception when no_data_found then null;
  end;
  v_nia := public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'nia.new@example.com');
  if exists (select 1 from public.my_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e5')) then
    raise exception 'An unconfirmed address sees an invitation';
  end if;
  begin
    perform public.accept_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e5', v_nia.id);
    raise exception 'An unconfirmed address accepted';
  exception when no_data_found then null;
  end;

  -- Revoking an invitation.
  perform public.admin_revoke_platform_admin_invitation('ad000000-0000-4000-8000-0000000000a1', v_nia.id);
  if not exists (select 1 from public.platform_audit_log where action = 'admin.invitation_revoked'
                  and details ->> 'invitation_id' = v_nia.id::text) then
    raise exception 'admin.invitation_revoked was not logged';
  end if;
  begin
    perform public.admin_revoke_platform_admin_invitation('ad000000-0000-4000-8000-0000000000a1', v_nia.id);
    raise exception 'A closed invitation was revoked again';
  exception when sqlstate 'PT409' then null;
  end;

  -- An expired invitation is closed and a new one opened.
  update public.platform_admin_invitations
     set created_at = now() - interval '10 days', expires_at = now() - interval '1 day'
   where id = v_first.id;
  begin
    perform public.accept_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e1', v_first.id);
    raise exception 'An expired invitation was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  v_again := public.admin_invite_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'uma.user@example.com');
  if v_again.id = v_first.id or (select revoked_at from public.platform_admin_invitations where id = v_first.id) is null then
    raise exception 'The expired invitation was not replaced';
  end if;

  -- Uma accepts.
  perform public.accept_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e1', v_again.id);
  if not private.is_platform_admin('ee000000-0000-4000-8000-0000000000e1') then
    raise exception 'Accepting did not make Uma a super admin';
  end if;
  select * into v_audit from public.platform_audit_log where action = 'admin.granted' order by id desc limit 1;
  if v_audit.actor_id <> 'ad000000-0000-4000-8000-0000000000a1' or v_audit.target_user_id <> 'ee000000-0000-4000-8000-0000000000e1' then
    raise exception 'admin.granted audit is wrong: %', row_to_json(v_audit);
  end if;
  begin
    perform public.accept_platform_admin_invitation('ee000000-0000-4000-8000-0000000000e1', v_again.id);
    raise exception 'An invitation was accepted twice';
  exception when sqlstate 'PT409' then null;
  end;

  -- Uma enters a church as owner, then loses super-admin access.
  perform public.grant_platform_access('ee000000-0000-4000-8000-0000000000e1', '0e000000-0000-4000-8000-0000000000c2', 2);
  if not exists (select 1 from public.organization_members where user_id = 'ee000000-0000-4000-8000-0000000000e1'
                  and platform_access_expires_at is not null) then
    raise exception 'Uma could not enter a church';
  end if;
  begin
    perform public.admin_revoke_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000a1');
    raise exception 'A super admin revoked themselves';
  exception when invalid_parameter_value then null;
  end;
  perform public.admin_revoke_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1');
  if private.is_platform_admin('ee000000-0000-4000-8000-0000000000e1')
     or exists (select 1 from public.organization_members where user_id = 'ee000000-0000-4000-8000-0000000000e1'
                 and platform_access_expires_at is not null) then
    raise exception 'Revoking left Uma with super-admin or owner access';
  end if;
  select * into v_audit from public.platform_audit_log where action = 'admin.revoked' order by id desc limit 1;
  if v_audit.target_user_id <> 'ee000000-0000-4000-8000-0000000000e1' or (v_audit.details ->> 'platform_access_removed')::int <> 1 then
    raise exception 'admin.revoked audit is wrong: %', row_to_json(v_audit);
  end if;
  begin
    perform public.admin_revoke_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'ee000000-0000-4000-8000-0000000000e1');
    raise exception 'Revoked someone who is not a super admin';
  exception when no_data_found then null;
  end;
end;
$$;

-- -------------------------------------------------- the last super admin ---
-- The last super admin can't be removed: they can't revoke themselves and
-- nobody else is a super admin to do it.
do $$
declare
  v_hint text;
begin
  delete from private.platform_admins where user_id <> 'ad000000-0000-4000-8000-0000000000a1';
  insert into private.platform_admins (user_id) values ('ad000000-0000-4000-8000-0000000000b1');
  -- Two left: Avery revokes Blake; then nobody can revoke Avery.
  perform public.admin_revoke_platform_admin('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-0000000000b1');
  begin
    perform public.admin_revoke_platform_admin('ad000000-0000-4000-8000-0000000000b1', 'ad000000-0000-4000-8000-0000000000a1');
    raise exception 'A former super admin revoked the last one';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from private.platform_admins) <> 1 then
    raise exception 'The last super admin was removed';
  end if;
end;
$$;

select 'platform-user-management: all checks passed' as result;
rollback;
