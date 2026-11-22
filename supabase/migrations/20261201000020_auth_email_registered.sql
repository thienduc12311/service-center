-- W10-SEC-D4: concurrent accepts of one invitation answer cleanly.
--
-- Two submissions of a fresh invitation both try to create the login. Auth
-- lets one win; the others fail on the users_email_partial_key unique index,
-- which Auth reports as a bare 500 without an error code, so the API could
-- only answer 502 "try again". This lets the API ask whether an account now
-- holds the address (confirmed or not) and answer the loser with 409/410.
--
-- Answers a boolean only (never which account), for the service role only.
-- Unlike confirmed_user_id_by_email it also matches unconfirmed signups, so it
-- must never be used to link or authorise anything.

create or replace function public.auth_email_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(p_email))
       and u.deleted_at is null);
$$;
comment on function public.auth_email_registered(text) is
  'Service role: whether any login (confirmed or not) holds this email. For choosing an error answer only; never for linking.';
revoke execute on function public.auth_email_registered(text) from public, anon, authenticated;
grant execute on function public.auth_email_registered(text) to service_role;
