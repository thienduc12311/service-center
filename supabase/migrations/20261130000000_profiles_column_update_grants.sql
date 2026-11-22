-- ============================================================================
-- profiles.email is not an identity; the confirmed login email is.
--
-- The bug. `profiles_update_self` (20260101000100) lets a user update their own
-- row, and the API roles still held table-level UPDATE on every column (only
-- SELECT was narrowed, in 20261017000100). So a signed-in user could
--   PATCH /rest/v1/profiles?id=eq.<self>  {"email": "victim@example.org"}
-- and every service-role path that looked a login up by `profiles.email` (the
-- invitation accept, a super admin creating a church, church join requests)
-- would treat them as the victim. `profiles.email` is not unique either, so a
-- second row with the same address also made the real owner's lookup fail.
--
-- The fix, in three parts:
--   1. The API roles may update only the columns a person edits about
--      themselves (`updateProfileSchema`: full_name, phone, avatar_url).
--      `updated_at` is stamped by the set_updated_at trigger and needs no
--      grant; id, email and created_at are not writable at all. Rows are made
--      by handle_new_user() (security definer), and there is no insert or
--      delete policy, so INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER go too.
--   2. confirmed_user_id_by_email(email): the service-role lookup of a login
--      by its confirmed auth.users email, for the backend to use instead of
--      `profiles.email`.
--   3. The church join-request functions take the requester's email from
--      auth.users (confirmed) rather than from profiles.
-- And, so profiles.email stays a faithful copy for display and delivery, it
-- now follows auth.users.email when the login email changes, and any value
-- that drifted (or was spoofed before this migration) is put back.
-- ============================================================================

-- ------------------------------------------------------------ 1. grants ----

revoke insert, update, delete, truncate, references, trigger on public.profiles from anon, authenticated;
-- SELECT stays as 20261017000100 left it (no contact columns). Writing needs
-- SELECT on the columns a WHERE reads; `id` is already selectable.
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------- 2. login by email ----

-- The login whose email is `p_email`, matched case-insensitively, only when
-- that email has been confirmed. An unconfirmed signup proves nothing about who
-- reads the inbox, so it is never returned: callers that would link someone to
-- an existing login must not pick a squatter's unconfirmed account. Service
-- role only — it reveals whether an address has an account.
create or replace function public.confirmed_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.email_confirmed_at is not null
     and u.deleted_at is null
   order by u.created_at, u.id
   limit 1;
$$;
comment on function public.confirmed_user_id_by_email(text) is
  'Service role: the login with this confirmed email (case-insensitive), or null. Never matches an unconfirmed signup.';
revoke execute on function public.confirmed_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.confirmed_user_id_by_email(text) to service_role;

-- The confirmed login email of one user, or null. Internal helper for the
-- join-request functions below.
create or replace function private.confirmed_auth_email(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(u.email), '')
    from auth.users u
   where u.id = p_user
     and u.email_confirmed_at is not null
     and u.deleted_at is null;
$$;
revoke execute on function private.confirmed_auth_email(uuid) from public, anon, authenticated;

-- ------------------------------------------------ 3. church join requests ----

create or replace function public.request_to_join_church(p_slug text, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_org      uuid;
  v_profile  public.profiles;
  v_email    text;
  v_message  text := nullif(btrim(coalesce(p_message, '')), '');
  v_id       uuid;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select o.id into v_org
    from public.organizations o
    join public.organization_platform_controls c on c.organization_id = o.id
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and c.status = 'active';
  if v_org is null then
    -- Same answer for unknown and disabled churches.
    raise exception 'No church uses that address' using errcode = 'P0002', hint = 'church_not_found';
  end if;

  if exists (select 1 from public.organization_members m
              where m.organization_id = v_org and m.user_id = v_user) then
    raise exception 'You are already part of this church'
      using errcode = 'PT409', hint = 'already_church_member';
  end if;

  if exists (select 1 from public.church_join_requests r
              where r.organization_id = v_org and r.requester_id = v_user and r.status = 'pending') then
    raise exception 'You already asked to join this church'
      using errcode = 'PT409', hint = 'join_request_pending';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'Keep the message to 500 characters' using errcode = '22023';
  end if;

  -- The address the church will invite is the login's confirmed email, never
  -- the profile copy.
  v_email := private.confirmed_auth_email(v_user);
  select * into v_profile from public.profiles where id = v_user;
  if v_profile.id is null or v_email is null then
    raise exception 'Your account needs an email address to be invited' using errcode = '22023';
  end if;

  begin
    insert into public.church_join_requests (organization_id, requester_id, message, requester_name, requester_email)
    values (v_org, v_user, v_message, nullif(btrim(coalesce(v_profile.full_name, '')), ''), v_email)
    returning id into v_id;
  exception when unique_violation then
    -- A concurrent request for the same church won.
    raise exception 'You already asked to join this church'
      using errcode = 'PT409', hint = 'join_request_pending';
  end;
  return v_id;
end;
$$;
revoke execute on function public.request_to_join_church(text, text) from public, anon;
grant execute on function public.request_to_join_church(text, text) to authenticated;

create or replace function public.approve_church_join_request(p_request uuid)
returns table (
  out_request_id          uuid,
  out_organization_id     uuid,
  out_person_id           uuid,
  out_invitation_id       uuid,
  out_email               text,
  out_first_name          text,
  out_last_name           text,
  out_preferred_language  text,
  out_newly_approved      boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_request  public.church_join_requests;
  v_profile  public.profiles;
  v_email    text;
  v_name     text;
  v_person   public.people;
  v_newly    boolean := false;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_request from public.church_join_requests where id = p_request for update;
  if not found or not private.is_people_owner(v_request.organization_id) then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;

  if v_request.status = 'pending' then
    if exists (select 1 from public.organization_members m
                where m.organization_id = v_request.organization_id
                  and m.user_id = v_request.requester_id and m.status = 'active') then
      raise exception 'This person is already part of the church'
        using errcode = 'PT409', hint = 'already_church_member';
    end if;

    -- The login's current confirmed email decides which roster person is
    -- linked and where the invitation goes; the address recorded at request
    -- time (itself from auth.users) covers a login whose email went away.
    select * into v_profile from public.profiles where id = v_request.requester_id;
    v_email := coalesce(private.confirmed_auth_email(v_request.requester_id), v_request.requester_email);
    v_name := coalesce(nullif(btrim(coalesce(v_profile.full_name, '')), ''), v_request.requester_name,
                       split_part(v_email, '@', 1));

    -- Same lock as accept_person_invitation: one link decision at a time per
    -- login and church.
    perform pg_advisory_xact_lock(hashtextextended(
      'person-link:' || v_request.organization_id::text || ':' || v_request.requester_id::text, 0));

    select * into v_person from public.people
     where organization_id = v_request.organization_id and profile_id = v_request.requester_id
     for update;
    if found then
      if v_person.archived_at is not null then
        update public.people set archived_at = null where id = v_person.id;
      end if;
    else
      select * into v_person from public.people
       where organization_id = v_request.organization_id and profile_id is null and archived_at is null
         and lower(btrim(email)) = lower(v_email)
       order by created_at, id
       limit 1
       for update;
      if not found then
        insert into public.people (organization_id, first_name, last_name, email, created_by)
        values (
          v_request.organization_id,
          coalesce(nullif(split_part(btrim(v_name), ' ', 1), ''), 'Person'),
          case when position(' ' in btrim(v_name)) > 0
               then nullif(btrim(substring(btrim(v_name) from position(' ' in btrim(v_name)) + 1)), '') end,
          v_email,
          v_user
        )
        returning * into v_person;
      end if;
    end if;

    update public.church_join_requests
       set status = 'approved', person_id = v_person.id, decided_by = v_user, decided_at = now()
     where id = v_request.id
    returning * into v_request;
    v_newly := true;
  elsif v_request.status = 'approved' then
    select * into v_person from public.people where id = v_request.person_id;
    v_email := coalesce(private.confirmed_auth_email(v_request.requester_id), v_request.requester_email);
  else
    raise exception 'This request was already declined or withdrawn'
      using errcode = 'PT409', hint = 'join_request_not_pending';
  end if;

  if v_person.id is null then
    -- The roster person was deleted after approval; nothing left to invite.
    raise exception 'This request was already decided' using errcode = 'PT409', hint = 'join_request_not_pending';
  end if;

  return query select v_request.id, v_request.organization_id, v_person.id, v_request.invitation_id,
                      v_email, v_person.first_name, v_person.last_name, v_person.preferred_language, v_newly;
end;
$$;
revoke execute on function public.approve_church_join_request(uuid) from public, anon;
grant execute on function public.approve_church_join_request(uuid) to authenticated;

-- ------------------------------------------- profiles.email follows login ----

-- handle_new_user() copies the email once, at signup. When the login email
-- changes (after confirmation, with double_confirm_changes) the copy follows,
-- so delivery and display never use a stale address.
create or replace function private.sync_auth_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end;
$$;
revoke execute on function private.sync_auth_email_to_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.sync_auth_email_to_profile();

-- Put back any copy that drifted from the login email (a changed login email,
-- or an address written through the old column grant).
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;
