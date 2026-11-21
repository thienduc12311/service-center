-- W9-RT-D1: the Realtime join policy (realtime.messages SELECT, `resource_pokes_receive`) did not
-- check session liveness, so a signed-out token that still held valid topic keys could join a
-- private topic until `exp`. Every other surface refuses a dead session (ADR 0005: the PostgREST
-- pre-request hook and the restrictive storage.objects policy).
--
-- `private.can_receive_resource_poke` is the only authorization function behind the single
-- policy on realtime.messages; it covers every topic kind (org control, live_plan, live_run,
-- conversation). Same body as 20261127000700, with `private.session_live()` checked first: one
-- primary-key lookup on auth.sessions, evaluated once per join / access_token refresh (the policy
-- wraps the call in an initplan), and a dead session skips the membership and key lookups.
-- Signature, volatility and security mode are unchanged, so CREATE OR REPLACE keeps the grants
-- (authenticated only).
create or replace function private.can_receive_resource_poke(p_topic text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_kind text;
  v_id uuid;
  v_org_key text;
  v_org uuid;
begin
  if p_topic is null then
    return false;
  end if;
  if not private.session_live() then
    return false;
  end if;
  if p_topic ~ '^conversation:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{64}:[0-9a-f]{64}$' then
    v_kind := 'conversation';
  elsif p_topic ~ '^(live_run|live_plan|org):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{64}$' then
    v_kind := split_part(p_topic, ':', 1);
  else
    return false;
  end if;
  v_id := split_part(p_topic, ':', 2)::uuid;
  v_org_key := split_part(p_topic, ':', 3);

  case v_kind
    when 'org' then
      v_org := v_id;
    when 'conversation' then
      select c.organization_id into v_org from public.conversations c where c.id = v_id;
      if v_org is null
         or not private.can_access_conversation(auth.uid(), v_id)
         or not private.conversation_key_is_current(v_id, split_part(p_topic, ':', 4)) then
        return false;
      end if;
    when 'live_run' then
      select r.organization_id into v_org
        from public.live_runs r
        join public.plans p on p.id = r.plan_id
       where r.id = v_id;
    when 'live_plan' then
      select p.organization_id into v_org from public.plans p where p.id = v_id;
  end case;

  return v_org is not null
    and private.is_active_member(auth.uid(), v_org)
    and private.realtime_key_is_current(v_org, v_org_key);
end;
$$;
