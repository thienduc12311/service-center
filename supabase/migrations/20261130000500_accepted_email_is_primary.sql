-- ============================================================================
-- SEC-013: the email an invitation was accepted with is the person's primary
-- email, and stops being editable.
--
-- Before: once a Person was linked to a login, three copies of their address
-- could drift apart. The roster copy (`people.email`) stayed editable by the
-- owner through the API (the web form only greyed it out), and the login
-- email could still be changed through Supabase Auth's self-service endpoint
-- (PUT /auth/v1/user), which no screen offers. So the address a church sees
-- and contacts was not necessarily the one that proved itself by accepting.
--
-- After:
--   1. A linked Person's `people.email` always equals their login email. It is
--      set when the login is linked (accept_person_invitation, or any other
--      link) and refused (PT409 person_email_locked) when a client role tries
--      to change it. Existing linked rows are brought into line once.
--   2. When the login email itself changes — only possible through the Auth
--      admin API now, i.e. a super admin or the Supabase dashboard — the
--      roster copies follow (extends private.sync_auth_email_to_profile).
--   3. A login that has accepted an invitation (it is linked to a Person)
--      cannot start a self-service email change: Auth's request sets
--      `auth.users.email_change`, which is refused. The admin API sets
--      `email` directly and is unaffected, so support can still fix an
--      address that really changed.
-- Unlinked Persons (no login yet) keep an editable email: that is the address
-- an invitation is sent to.
-- ============================================================================

-- ------------------------------------------- 1. roster email follows login --

-- Two triggers, in this order (BEFORE triggers fire by name):
--   people_email_1_guard   SECURITY INVOKER, so current_user is the caller's
--                          role (like guard_person_link): a client role may not
--                          change a linked Person's email. It must run before
--                          the value is overwritten, or the edit would just be
--                          dropped silently instead of refused.
--   people_email_2_follow  SECURITY DEFINER (reads auth.users): copies the
--                          login email onto any linked row being written.

create or replace function private.guard_linked_person_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.profile_id is not null
     and new.email is distinct from old.email then
    raise exception 'This person''s email is the one they accepted their invitation with and can''t be changed here'
      using errcode = 'PT409', hint = 'person_email_locked';
  end if;
  return new;
end;
$$;

create or replace function private.people_email_follows_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login_email text;
begin
  if new.profile_id is null then
    return new;
  end if;
  select lower(btrim(u.email)) into v_login_email from auth.users u where u.id = new.profile_id;
  if v_login_email is not null and v_login_email <> '' then
    new.email := v_login_email;
  end if;
  return new;
end;
$$;
revoke execute on function private.people_email_follows_login() from public, anon, authenticated;

drop trigger if exists people_email_1_guard on public.people;
create trigger people_email_1_guard
  before update of email on public.people
  for each row execute function private.guard_linked_person_email();

drop trigger if exists people_email_2_follow on public.people;
create trigger people_email_2_follow
  before insert or update of email, profile_id on public.people
  for each row execute function private.people_email_follows_login();

-- Existing linked Persons take their login email once (the trigger above
-- supplies the value; this runs as the migration owner, not a client role).
update public.people p
   set email = lower(btrim(u.email))
  from auth.users u
 where u.id = p.profile_id
   and nullif(btrim(u.email), '') is not null
   and p.email is distinct from lower(btrim(u.email));

-- ------------------------------------- 2. an admin email change propagates --

create or replace function private.sync_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  -- Linked roster copies follow too (people_email_follows_login sets the value).
  update public.people set email = lower(btrim(new.email))
   where profile_id = new.id and email is distinct from lower(btrim(new.email));
  return new;
end;
$$;
revoke execute on function private.sync_auth_email_to_profile() from public, anon, authenticated;

-- ---------------------------- 3. no self-service change once accepted ------

create or replace function private.refuse_accepted_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.people p where p.profile_id = new.id) then
    raise exception 'Your email is the one you accepted your invitation with and can''t be changed. Ask your church or a platform admin if it really changed.'
      using errcode = '42501', hint = 'email_change_locked';
  end if;
  return new;
end;
$$;
revoke execute on function private.refuse_accepted_email_change() from public, anon, authenticated;

drop trigger if exists refuse_accepted_email_change on auth.users;
create trigger refuse_accepted_email_change
  before update of email_change on auth.users
  for each row
  when (coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change)
  execute function private.refuse_accepted_email_change();
