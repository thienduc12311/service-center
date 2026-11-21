-- W8-INT-D5: end a removed member's Realtime access within seconds.
--
-- Realtime v2.167.0 evaluates the realtime.messages SELECT policy at channel join and again
-- only when the client sends a fresh access_token. A DB-originated broadcast is delivered to
-- every socket already joined to the topic with no policy check, so deactivating a member did
-- not stop an open socket (up to the 900 s JWT lifetime). Nothing on the server can close that
-- socket, so the topic name itself is the credential:
--
--   topic = <kind>:<resource id>:<org realtime key>      (org:<org id>:<key> for the control topic)
--
-- * The key is a per-organization secret (244 bits) stored in private.org_realtime_keys and served
--   only to active members (public.realtime_topic_key, called by the API on every request).
-- * The join policy requires the key in the topic to be the organization's current key and the
--   caller to be an active member who can read the resource, so a re-join is refused.
-- * Every poke is sent to the topic carrying the current key. When a member is deactivated,
--   demoted, suspended (church disabled), removed or their auth session is deleted, the key rotates in the same transaction.
--   After commit no further poke reaches a socket on an old topic. Still-authorized clients
--   receive one id-free 'rekey' poke on the old control topic, refetch the key and rejoin;
--   the removed member's refetch is refused.
-- Pokes remain id + event only.

create table private.org_realtime_keys (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  key             text not null
                  default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  rotated_at      timestamptz not null default now(),
  constraint org_realtime_keys_key_format check (key ~ '^[0-9a-f]{64}$')
);
-- Row security on with no policies: only the security definer functions below can read it.
alter table private.org_realtime_keys enable row level security;
revoke all on private.org_realtime_keys from public, anon, authenticated;

insert into private.org_realtime_keys (organization_id)
select id from public.organizations
on conflict do nothing;

create function private.create_org_realtime_key()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into private.org_realtime_keys (organization_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.create_org_realtime_key() from public, anon, authenticated;

create trigger organizations_realtime_key
  after insert on public.organizations
  for each row execute function private.create_org_realtime_key();

-- True when p_key is the organization's current key.
create function private.realtime_key_is_current(p_org uuid, p_key text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.org_realtime_keys k
     where k.organization_id = p_org and k.key = p_key);
$$;
revoke all on function private.realtime_key_is_current(uuid, text) from public, anon, authenticated;
grant execute on function private.realtime_key_is_current(uuid, text) to authenticated;

-- Served by the API to active members only; anyone else gets null.
create function public.realtime_topic_key(p_org uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select k.key
    from private.org_realtime_keys k
   where k.organization_id = p_org
     and private.is_active_member((select auth.uid()), p_org);
$$;
revoke all on function public.realtime_topic_key(uuid) from public, anon;
grant execute on function public.realtime_topic_key(uuid) to authenticated;

create function private.rotate_org_realtime_key(p_org uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old text;
  v_rotated timestamptz;
begin
  select k.key, k.rotated_at into v_old, v_rotated
    from private.org_realtime_keys k where k.organization_id = p_org for update;
  if not found then
    insert into private.org_realtime_keys (organization_id) values (p_org) on conflict do nothing;
    return;
  end if;
  -- One rotation per transaction is enough: nobody sees the new key before commit.
  if v_rotated = now() then
    return;
  end if;
  -- Tell sockets on the old control topic to refetch the key. Clients listen for 'changed' on
  -- every topic; the payload carries no data.
  perform realtime.send(jsonb_build_object('event', 'rekey'), 'changed', 'org:' || p_org || ':' || v_old, true);
  update private.org_realtime_keys
     set key = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         rotated_at = now()
   where organization_id = p_org;
end;
$$;
revoke all on function private.rotate_org_realtime_key(uuid) from public, anon, authenticated;

create function private.rotate_on_member_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'active' then
      perform private.rotate_org_realtime_key(old.organization_id);
    end if;
  elsif old.status = 'active'
        and (new.status is distinct from old.status or new.role is distinct from old.role) then
    perform private.rotate_org_realtime_key(old.organization_id);
  end if;
  return null;
end;
$$;
revoke all on function private.rotate_on_member_change() from public, anon, authenticated;

create trigger organization_members_realtime_rotate
  after update of status, role or delete on public.organization_members
  for each row execute function private.rotate_on_member_change();

-- A deleted auth session (sign-out, global sign-out, revocation) rotates the key of every
-- organization the user is an active member of. This trigger must never block a sign-out.
create function private.rotate_on_session_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  for v_org in
    select m.organization_id from public.organization_members m
     where m.user_id = old.user_id and m.status = 'active'
  loop
    perform private.rotate_org_realtime_key(v_org);
  end loop;
  return null;
exception when others then
  raise warning 'realtime key rotation after session delete failed: %', sqlerrm;
  return null;
end;
$$;
revoke all on function private.rotate_on_session_delete() from public, anon, authenticated;

-- Hosted projects may not let the migration role add triggers to auth tables. Membership
-- changes above still rotate the key, so a missing privilege must not fail the migration;
-- it leaves only the sign-out rotation unavailable and says so.
do $$
begin
  create trigger auth_sessions_realtime_rotate
    after delete on auth.sessions
    for each row execute function private.rotate_on_session_delete();
exception when insufficient_privilege then
  raise warning 'auth.sessions trigger not created (insufficient privilege): sign-out will not rotate realtime keys';
end;
$$;

-- Join policy: the key in the topic must be current, the caller an active member, and the
-- resource readable by the caller (plan and run reads go through row security).
create or replace function private.can_receive_resource_poke(p_topic text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_kind text;
  v_id uuid;
  v_key text;
  v_org uuid;
begin
  if p_topic is null
     or p_topic !~ '^(conversation|live_run|live_plan|org):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:[0-9a-f]{64}$' then
    return false;
  end if;
  v_kind := split_part(p_topic, ':', 1);
  v_id := split_part(p_topic, ':', 2)::uuid;
  v_key := split_part(p_topic, ':', 3);

  case v_kind
    when 'org' then
      v_org := v_id;
    when 'conversation' then
      select c.organization_id into v_org from public.conversations c where c.id = v_id;
      if v_org is null or not private.can_access_conversation(auth.uid(), v_id) then
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
    and private.realtime_key_is_current(v_org, v_key);
end;
$$;

-- Pokes go to the topic with the organization's current key. p_org avoids a lookup (and
-- survives a delete trigger, where the row is already gone).
drop function private.send_resource_poke(text, uuid);
create function private.send_resource_poke(p_resource text, p_id uuid, p_org uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid := p_org;
  v_key text;
begin
  if v_org is null then
    v_org := case p_resource
      when 'conversation' then (select c.organization_id from public.conversations c where c.id = p_id)
      when 'live_run' then (select r.organization_id from public.live_runs r where r.id = p_id)
      when 'live_plan' then (select p.organization_id from public.plans p where p.id = p_id)
    end;
  end if;
  select k.key into v_key from private.org_realtime_keys k where k.organization_id = v_org;
  if v_key is null then
    return;
  end if;
  perform realtime.send(
    jsonb_build_object('id', p_id, 'event', 'changed'),
    'changed',
    p_resource || ':' || p_id || ':' || v_key,
    true
  );
end;
$$;
revoke all on function private.send_resource_poke(text, uuid, uuid) from public, anon, authenticated;

create or replace function private.broadcast_live_run_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
begin
  if tg_op <> 'UPDATE' then
    perform private.send_resource_poke('live_run', coalesce(new.id, old.id), v_org);
    perform private.send_resource_poke('live_plan', coalesce(new.plan_id, old.plan_id), v_org);
  else
    if new.revision is distinct from old.revision
       or new.controller_lease_expires_at is distinct from old.controller_lease_expires_at
       or new.plan_time_id is distinct from old.plan_time_id then
      perform private.send_resource_poke('live_run', new.id, v_org);
    end if;
    if new.status is distinct from old.status or new.plan_time_id is distinct from old.plan_time_id then
      perform private.send_resource_poke('live_plan', new.plan_id, v_org);
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.broadcast_live_plan_revision()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.send_resource_poke('live_plan', new.id, new.organization_id);
  perform private.send_resource_poke('live_run', r.id, new.organization_id)
    from public.live_runs r
   where r.plan_id = new.id and r.status in ('ready', 'live', 'paused');
  return null;
end;
$$;
