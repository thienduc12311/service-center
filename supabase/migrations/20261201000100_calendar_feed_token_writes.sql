-- W10-FGH-D7 / W10-FGH-D8: personal calendar feed tokens are written only by
-- SECURITY DEFINER functions.
--
-- `calendar_feed_tokens_insert` / `_update` (20260906000000) let a member
-- write their own rows through PostgREST: overwrite `token_hash` with a value
-- of their choosing, and set `revoked_at = null` on a revoked token so an old
-- (possibly leaked) feed URL served again. The API now rotates and revokes
-- through the functions below; client roles keep only a narrow SELECT.
--
-- * `rotate_calendar_feed_token(p_org)`: revokes the caller's live token in
--   that church and issues a new one. The token is generated here (32 random
--   bytes, base64url) and only its SHA-256 hex is stored — the same hash the
--   API's `hashInviteToken` computes when a feed is fetched. The raw token is
--   returned once.
-- * `revoke_calendar_feed_token(p_org)`: revokes the caller's live token
--   without issuing a replacement (D8). Idempotent; returns whether a live
--   token was revoked.
--
-- Both require an active membership of `p_org` (`public.is_org_member`) and
-- serialize per (church, user) so concurrent rotations never trip the
-- one-live-token unique index.

drop policy if exists calendar_feed_tokens_insert on public.calendar_feed_tokens;
drop policy if exists calendar_feed_tokens_update on public.calendar_feed_tokens;

revoke insert, update, delete, truncate, references, trigger on public.calendar_feed_tokens from anon, authenticated;
-- The hash never leaves the database for a client: it is only compared server-side.
revoke select on public.calendar_feed_tokens from anon, authenticated;
grant select (id, organization_id, user_id, created_at, last_used_at, revoked_at)
  on public.calendar_feed_tokens to authenticated;

create or replace function public.rotate_calendar_feed_token(p_org uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_token text;
begin
  if v_user is null or p_org is null or not public.is_org_member(p_org) then
    raise exception 'Choose an organization before managing your schedule feed'
      using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar_feed_tokens:' || p_org::text || ':' || v_user::text, 0));

  update public.calendar_feed_tokens
     set revoked_at = now()
   where organization_id = p_org and user_id = v_user and revoked_at is null;

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into public.calendar_feed_tokens (organization_id, user_id, token_hash)
  values (p_org, v_user, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  return v_token;
end;
$$;

create or replace function public.revoke_calendar_feed_token(p_org uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or p_org is null or not public.is_org_member(p_org) then
    raise exception 'Choose an organization before managing your schedule feed'
      using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar_feed_tokens:' || p_org::text || ':' || v_user::text, 0));

  update public.calendar_feed_tokens
     set revoked_at = now()
   where organization_id = p_org and user_id = v_user and revoked_at is null;
  return found;
end;
$$;

revoke all on function public.rotate_calendar_feed_token(uuid) from public, anon;
revoke all on function public.revoke_calendar_feed_token(uuid) from public, anon;
grant execute on function public.rotate_calendar_feed_token(uuid) to authenticated;
grant execute on function public.revoke_calendar_feed_token(uuid) to authenticated;

comment on function public.rotate_calendar_feed_token(uuid) is
  'W10-FGH-D7: the only way a member issues a personal calendar feed token; generated and hashed in the database, raw token returned once.';
comment on function public.revoke_calendar_feed_token(uuid) is
  'W10-FGH-D8: revokes the caller''s personal calendar feed without issuing a replacement.';
