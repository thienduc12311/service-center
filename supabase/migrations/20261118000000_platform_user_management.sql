-- ============================================================================
-- Super-admin dashboard: user management and super-admin management.
-- Design: docs/plans/super-admin-dashboard.md ("Users and super admins").
--
--   platform_audit_log.target_user_id   the account an action was about
--   platform_user_blocks                why and by whom an account is blocked
--   platform_admin_invitations          pending super-admin invitations
--
-- Blocking an account (admin_block_user) bans its login and ends its sessions
-- in auth.users / auth.sessions, in the same transaction as the block record
-- and the audit line. Church memberships do not change.
--
-- Deleting an account (admin_delete_user) applies the same rules as deleting
-- your own (private.account_deletion_plan / public.prepare_account_deletion),
-- writes the audit line and deletes the auth user, all in one transaction.
--
-- A super admin is invited by email; the invitee signs in with a confirmed
-- address and accepts (accept_platform_admin_invitation). Super admins can't
-- be blocked or deleted, nobody can revoke themselves, and the last super
-- admin can't be removed. Losing super-admin access also ends any "enter as
-- owner" memberships.
--
-- Every function is service role only: the API calls them after checking the
-- session (two-factor included), and each re-checks the actor.
-- ============================================================================

-- ------------------------------------------------------- audit target -------

alter table public.platform_audit_log add column target_user_id uuid;
comment on column public.platform_audit_log.target_user_id is
  'The account the action was about. No foreign key: the record outlives a deleted account.';
create index platform_audit_log_target_user_idx
  on public.platform_audit_log (target_user_id, created_at desc) where target_user_id is not null;

create or replace function private.platform_audit_user(
  p_actor   uuid,
  p_action  text,
  p_target  uuid,
  p_details jsonb
)
returns void language sql security definer set search_path = '' as $$
  insert into public.platform_audit_log (actor_id, action, target_user_id, details)
  values (p_actor, p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;
revoke execute on function private.platform_audit_user(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------- user blocks -----

create table public.platform_user_blocks (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  reason      text not null check (char_length(btrim(reason)) between 1 and 500),
  blocked_by  uuid references auth.users (id) on delete set null,
  blocked_at  timestamptz not null default now()
);
comment on table public.platform_user_blocks is
  'Accounts a super admin blocked. The login ban itself is auth.users.banned_until; this keeps why and who.';
create index platform_user_blocks_blocked_by_idx on public.platform_user_blocks (blocked_by) where blocked_by is not null;

alter table public.platform_user_blocks enable row level security;
revoke all on public.platform_user_blocks from anon, authenticated;
grant select on public.platform_user_blocks to service_role;

-- ------------------------------------------------ super-admin invitations ---

create table public.platform_admin_invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users (id) on delete set null,
  constraint platform_admin_invitations_one_outcome check (accepted_at is null or revoked_at is null),
  constraint platform_admin_invitations_accepted_shape check ((accepted_at is null) = (accepted_by is null)),
  constraint platform_admin_invitations_expiry check (expires_at > created_at)
);
comment on table public.platform_admin_invitations is
  'Invitations to become a super admin. Open while neither accepted nor revoked and not expired.';
-- One open invitation per address; an expired one is closed (revoked) before re-inviting.
create unique index platform_admin_invitations_open_email_idx
  on public.platform_admin_invitations (email) where accepted_at is null and revoked_at is null;
create index platform_admin_invitations_invited_by_idx on public.platform_admin_invitations (invited_by) where invited_by is not null;
create index platform_admin_invitations_accepted_by_idx on public.platform_admin_invitations (accepted_by) where accepted_by is not null;
create index platform_admin_invitations_revoked_by_idx on public.platform_admin_invitations (revoked_by) where revoked_by is not null;

alter table public.platform_admin_invitations enable row level security;
revoke all on public.platform_admin_invitations from anon, authenticated;
grant select on public.platform_admin_invitations to service_role;

-- -------------------------------------------------------------- helpers -----

-- Ends every "enter as owner" membership the person holds; returns how many.
create or replace function private.remove_platform_access(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  delete from public.organization_members
   where user_id = p_user and platform_access_expires_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function private.remove_platform_access(uuid) from public, anon, authenticated;

-- Signs the person out everywhere: refresh tokens stop working and the auth
-- server refuses access tokens whose session is gone. Returns how many.
create or replace function private.end_auth_sessions(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function private.end_auth_sessions(uuid) from public, anon, authenticated;

-- Refuses actions a super admin may not take on this account.
create or replace function private.require_manageable_user(p_actor uuid, p_user uuid, p_verb text)
returns auth.users language plpgsql security definer set search_path = '' as $$
declare
  v_user auth.users;
begin
  perform private.require_platform_admin(p_actor);
  if p_user is null then raise exception 'A user is required' using errcode = '22023'; end if;
  if p_user = p_actor then
    raise exception 'You can''t % your own account here', p_verb using errcode = '22023', hint = 'cannot_target_self';
  end if;
  select * into v_user from auth.users where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if private.is_platform_admin(p_user) then
    raise exception 'Revoke their super-admin access first' using errcode = 'PT409', hint = 'target_is_platform_admin';
  end if;
  return v_user;
end;
$$;
revoke execute on function private.require_manageable_user(uuid, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------- reading ------

-- Every account, with its churches (not "enter as owner" memberships). Pass
-- a user to read just that one.
create or replace function public.admin_user_summaries(p_user uuid default null)
returns table (
  user_id             uuid,
  email               text,
  full_name           text,
  created_at          timestamptz,
  last_sign_in_at     timestamptz,
  email_confirmed_at  timestamptz,
  banned_until        timestamptz,
  blocked_at          timestamptz,
  block_reason        text,
  blocked_by          uuid,
  blocked_by_name     text,
  is_platform_admin   boolean,
  memberships         jsonb
)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, p.full_name, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
         u.banned_until, b.blocked_at, b.reason, b.blocked_by, bp.full_name,
         exists (select 1 from private.platform_admins a where a.user_id = u.id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'organization_id', o.id, 'organization_name', o.name,
                    'role', m.role, 'status', m.status, 'joined_at', m.created_at)
                  order by o.name, o.id)
             from public.organization_members m
             join public.organizations o on o.id = m.organization_id
            where m.user_id = u.id and m.platform_access_expires_at is null
         ), '[]'::jsonb)
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.platform_user_blocks b on b.user_id = u.id
    left join public.profiles bp on bp.id = b.blocked_by
   where (p_user is null or u.id = p_user)
     and u.deleted_at is null
   order by lower(coalesce(nullif(btrim(p.full_name), ''), u.email)), u.id;
$$;
revoke execute on function public.admin_user_summaries(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_summaries(uuid) to service_role;

-- What deleting this account would do, for the confirmation dialog.
create or replace function public.admin_user_deletion_plan(p_user uuid)
returns table (organization_id uuid, organization_name text, outcome text)
language sql stable security definer set search_path = '' as $$
  select * from private.account_deletion_plan(p_user);
$$;
revoke execute on function public.admin_user_deletion_plan(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_deletion_plan(uuid) to service_role;

-- Super admins, with whether they finished setting up two-factor login.
create or replace function public.admin_platform_admins()
returns table (
  user_id          uuid,
  email            text,
  full_name        text,
  note             text,
  created_at       timestamptz,
  last_sign_in_at  timestamptz,
  has_mfa          boolean
)
language sql stable security definer set search_path = '' as $$
  select a.user_id, u.email::text, p.full_name, a.note, a.created_at, u.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified')
    from private.platform_admins a
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
   order by a.created_at, a.user_id;
$$;
revoke execute on function public.admin_platform_admins() from public, anon, authenticated;
grant execute on function public.admin_platform_admins() to service_role;

-- Open (pending, not expired) invitations, newest first.
create or replace function public.admin_platform_admin_invitations()
returns table (
  id               uuid,
  email            text,
  invited_by       uuid,
  invited_by_name  text,
  created_at       timestamptz,
  expires_at       timestamptz
)
language sql stable security definer set search_path = '' as $$
  select i.id, i.email, i.invited_by, p.full_name, i.created_at, i.expires_at
    from public.platform_admin_invitations i
    left join public.profiles p on p.id = i.invited_by
   where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
   order by i.created_at desc, i.id;
$$;
revoke execute on function public.admin_platform_admin_invitations() from public, anon, authenticated;
grant execute on function public.admin_platform_admin_invitations() to service_role;

-- ------------------------------------------------------------- blocking -----

create or replace function public.admin_block_user(p_actor uuid, p_user uuid, p_reason text)
returns public.platform_user_blocks
language plpgsql security definer set search_path = '' as $$
declare
  v_user     auth.users;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_block    public.platform_user_blocks;
  v_sessions int;
  v_access   int;
  v_invites  int;
begin
  v_user := private.require_manageable_user(p_actor, p_user, 'block');
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'A reason of 1 to 500 characters is required' using errcode = '22023';
  end if;

  select * into v_block from public.platform_user_blocks where user_id = p_user;
  if found then
    return v_block;
  end if;

  insert into public.platform_user_blocks (user_id, reason, blocked_by)
  values (p_user, v_reason, p_actor)
  returning * into v_block;

  -- The same ban the Auth admin API sets for ban_duration '876000h'.
  update auth.users set banned_until = now() + interval '100 years', updated_at = now() where id = p_user;
  v_sessions := private.end_auth_sessions(p_user);
  v_access := private.remove_platform_access(p_user);
  update public.platform_admin_invitations
     set revoked_at = now(), revoked_by = p_actor
   where email = lower(v_user.email) and accepted_at is null and revoked_at is null;
  get diagnostics v_invites = row_count;

  perform private.platform_audit_user(p_actor, 'user.blocked', p_user, jsonb_build_object(
    'email', v_user.email, 'reason', v_reason, 'sessions_ended', v_sessions,
    'platform_access_removed', v_access, 'invitations_revoked', v_invites));
  return v_block;
end;
$$;
revoke execute on function public.admin_block_user(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_block_user(uuid, uuid, text) to service_role;

-- Returns whether anything changed.
create or replace function public.admin_unblock_user(p_actor uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_user  auth.users;
  v_block public.platform_user_blocks;
begin
  perform private.require_platform_admin(p_actor);
  select * into v_user from auth.users where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;

  delete from public.platform_user_blocks where user_id = p_user returning * into v_block;
  if v_block.user_id is null and (v_user.banned_until is null or v_user.banned_until <= now()) then
    return false;
  end if;

  update auth.users set banned_until = null, updated_at = now() where id = p_user;
  perform private.platform_audit_user(p_actor, 'user.unblocked', p_user, jsonb_build_object(
    'email', v_user.email, 'blocked_reason', v_block.reason, 'blocked_at', v_block.blocked_at));
  return true;
end;
$$;
revoke execute on function public.admin_unblock_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_unblock_user(uuid, uuid) to service_role;

-- -------------------------------------------------------------- deleting ----

-- Deletes the account under the same rules as deleting your own: refused
-- (PT409 account_deletion_blocked) while a church would be left without an
-- owner; churches nobody else is in go with it. The API removes the person's
-- pictures from storage first. Returns the deleted churches.
create or replace function public.admin_delete_user(p_actor uuid, p_user uuid)
returns table (organization_id uuid, organization_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user    auth.users;
  v_name    text;
  v_plan    jsonb;
  v_deleted uuid[];
begin
  v_user := private.require_manageable_user(p_actor, p_user, 'delete');
  select p.full_name into v_name from public.profiles p where p.id = p_user;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.organization_id, 'name', d.organization_name)), '[]'::jsonb)
    into v_plan
    from private.account_deletion_plan(p_user) d where d.outcome = 'deleted';

  -- Locks the churches, re-checks the plan and deletes the empty ones.
  select coalesce(array_agg(x), '{}') into v_deleted from public.prepare_account_deletion(p_user) x;

  update public.platform_admin_invitations
     set revoked_at = now(), revoked_by = p_actor
   where email = lower(v_user.email) and accepted_at is null and revoked_at is null;

  perform private.platform_audit_user(p_actor, 'user.deleted', p_user, jsonb_build_object(
    'email', v_user.email, 'full_name', v_name,
    'deleted_organizations', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_plan) e
                                where (e ->> 'id')::uuid = any (v_deleted))));

  -- Profiles and personal rows cascade; church records forget the person.
  delete from auth.users where id = p_user;

  return query
    select (e ->> 'id')::uuid, e ->> 'name'
      from jsonb_array_elements(v_plan) e
     where (e ->> 'id')::uuid = any (v_deleted);
end;
$$;
revoke execute on function public.admin_delete_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to service_role;

-- ---------------------------------------------------------- super admins ----

-- Invites by email. Re-inviting an address with an open invitation extends
-- it. Returns the invitation.
create or replace function public.admin_invite_platform_admin(p_actor uuid, p_email text, p_days int default 7)
returns public.platform_admin_invitations
language plpgsql security definer set search_path = '' as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_existing   auth.users;
  v_invitation public.platform_admin_invitations;
  v_resent     boolean := false;
begin
  perform private.require_platform_admin(p_actor);
  if v_email !~ '^[^@\s]+@[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'An invitation lasts 1 to 30 days' using errcode = '22023';
  end if;

  select * into v_existing from auth.users u where lower(u.email) = v_email and u.deleted_at is null limit 1;
  if found then
    if private.is_platform_admin(v_existing.id) then
      raise exception 'That person is already a super admin' using errcode = 'PT409', hint = 'already_platform_admin';
    end if;
    if exists (select 1 from public.platform_user_blocks b where b.user_id = v_existing.id)
       or v_existing.banned_until > now() then
      raise exception 'That account is blocked; unblock it first' using errcode = 'PT409', hint = 'user_blocked';
    end if;
  end if;

  -- Serializes invitations to the same address.
  perform pg_advisory_xact_lock(hashtextextended('platform_admin_invitation:' || v_email, 0));

  -- An expired invitation is closed so the address can be invited again.
  update public.platform_admin_invitations
     set revoked_at = expires_at
   where email = v_email and accepted_at is null and revoked_at is null and expires_at <= now();

  update public.platform_admin_invitations
     set expires_at = now() + make_interval(days => p_days)
   where email = v_email and accepted_at is null and revoked_at is null
  returning * into v_invitation;
  v_resent := found;

  if not v_resent then
    insert into public.platform_admin_invitations (email, invited_by, expires_at)
    values (v_email, p_actor, now() + make_interval(days => p_days))
    returning * into v_invitation;
  end if;

  perform private.platform_audit_user(p_actor, 'admin.invited', v_existing.id, jsonb_build_object(
    'email', v_email, 'invitation_id', v_invitation.id, 'expires_at', v_invitation.expires_at,
    'resent', v_resent, 'has_account', v_existing.id is not null));
  return v_invitation;
end;
$$;
revoke execute on function public.admin_invite_platform_admin(uuid, text, int) from public, anon, authenticated;
grant execute on function public.admin_invite_platform_admin(uuid, text, int) to service_role;

create or replace function public.admin_revoke_platform_admin_invitation(p_actor uuid, p_invitation uuid)
returns public.platform_admin_invitations
language plpgsql security definer set search_path = '' as $$
declare
  v_invitation public.platform_admin_invitations;
begin
  perform private.require_platform_admin(p_actor);
  select * into v_invitation from public.platform_admin_invitations where id = p_invitation for update;
  if not found then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if v_invitation.accepted_at is not null or v_invitation.revoked_at is not null then
    raise exception 'That invitation is no longer open' using errcode = 'PT409', hint = 'invitation_not_open';
  end if;

  update public.platform_admin_invitations
     set revoked_at = now(), revoked_by = p_actor
   where id = p_invitation
  returning * into v_invitation;
  perform private.platform_audit_user(p_actor, 'admin.invitation_revoked',
    (select u.id from auth.users u where lower(u.email) = v_invitation.email and u.deleted_at is null limit 1),
    jsonb_build_object('email', v_invitation.email, 'invitation_id', v_invitation.id));
  return v_invitation;
end;
$$;
revoke execute on function public.admin_revoke_platform_admin_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_platform_admin_invitation(uuid, uuid) to service_role;

-- The open invitation for this person's confirmed email, if any.
create or replace function public.my_platform_admin_invitation(p_user uuid)
returns table (id uuid, email text, invited_by_name text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.email, p.full_name, i.created_at, i.expires_at
    from auth.users u
    join public.platform_admin_invitations i on i.email = lower(u.email)
    left join public.profiles p on p.id = i.invited_by
   where u.id = p_user
     and u.email_confirmed_at is not null
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     and not private.is_platform_admin(p_user);
$$;
revoke execute on function public.my_platform_admin_invitation(uuid) from public, anon, authenticated;
grant execute on function public.my_platform_admin_invitation(uuid) to service_role;

-- The invitee accepts. The audit line's actor is whoever invited them.
create or replace function public.accept_platform_admin_invitation(p_user uuid, p_invitation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user       auth.users;
  v_invitation public.platform_admin_invitations;
  v_inviter    text;
begin
  select * into v_user from auth.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;

  select * into v_invitation from public.platform_admin_invitations where id = p_invitation for update;
  if not found or v_invitation.email is distinct from lower(v_user.email) or v_user.email_confirmed_at is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if v_invitation.accepted_at is not null or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() then
    raise exception 'That invitation is no longer open' using errcode = 'PT409', hint = 'invitation_not_open';
  end if;
  if v_user.banned_until > now() or exists (select 1 from public.platform_user_blocks b where b.user_id = p_user) then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  select p.full_name into v_inviter from public.profiles p where p.id = v_invitation.invited_by;
  insert into private.platform_admins (user_id, note)
  values (p_user, left('Invited by ' || coalesce(v_inviter, 'a super admin') || ' on '
                       || to_char(v_invitation.created_at, 'YYYY-MM-DD'), 200))
  on conflict (user_id) do nothing;

  update public.platform_admin_invitations
     set accepted_at = now(), accepted_by = p_user
   where id = p_invitation;

  perform private.platform_audit_user(v_invitation.invited_by, 'admin.granted', p_user, jsonb_build_object(
    'email', v_invitation.email, 'invitation_id', v_invitation.id));
end;
$$;
revoke execute on function public.accept_platform_admin_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_platform_admin_invitation(uuid, uuid) to service_role;

create or replace function public.admin_revoke_platform_admin(p_actor uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email  text;
  v_access int;
begin
  perform private.require_platform_admin(p_actor);
  if p_user = p_actor then
    raise exception 'You can''t revoke your own super-admin access' using errcode = '22023', hint = 'cannot_target_self';
  end if;

  -- Lock every super admin so two revocations can't remove the last two.
  perform 1 from private.platform_admins order by user_id for update;
  if not exists (select 1 from private.platform_admins where user_id = p_user) then
    raise exception 'That person is not a super admin' using errcode = 'P0002';
  end if;
  if (select count(*) from private.platform_admins) <= 1 then
    raise exception 'The last super admin can''t be removed' using errcode = 'PT409', hint = 'last_platform_admin';
  end if;

  delete from private.platform_admins where user_id = p_user;
  v_access := private.remove_platform_access(p_user);
  select u.email into v_email from auth.users u where u.id = p_user;

  perform private.platform_audit_user(p_actor, 'admin.revoked', p_user, jsonb_build_object(
    'email', v_email, 'platform_access_removed', v_access));
end;
$$;
revoke execute on function public.admin_revoke_platform_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_platform_admin(uuid, uuid) to service_role;
