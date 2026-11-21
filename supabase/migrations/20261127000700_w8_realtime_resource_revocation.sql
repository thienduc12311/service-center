-- W8-INT-D5 follow-up: end a person's Realtime access to ONE conversation within seconds of
-- losing access to it, without rotating the whole organization's key.
--
-- 20261127000400 keys every topic by an organization secret that rotates when organization
-- membership changes. Losing access to a single team or plan conversation (removed from the
-- team, assignment deleted / declined / un-released, plan leader capability removed...) leaves
-- the organization key unchanged, so that person's open socket kept receiving pokes, and they
-- could rejoin with the key they already knew.
--
-- What grants access to each topic kind (checked, not assumed):
--   conversation  private.can_access_conversation: team conversation = on the team, or may
--                 schedule / manage the team; plan conversation = plan leader (plans.edit or
--                 scheduling.manage) or a released, not-declined assignment; plus an active,
--                 adult, unarchived person. This is a per-resource right and is what changes.
--   live_plan /   readable by every active member of the organization (row security on plans and
--   live_run      live_runs is is_org_member). A removed assignee can still read the plan and
--                 its live run through the API, so there is no per-resource access to lose
--                 there; the organization key already ends them when membership ends.
--
-- Design: a conversation topic is
--     conversation:<id>:<organization key>:<conversation key>
-- The conversation key lives in private.conversation_realtime_keys, is created the first time
-- a member is issued the topic, and rotates in the same transaction as the access loss. Before
-- rotating, one id-free 'rekey' poke goes to the old topic, so teammates who still have access
-- refetch the topic through the API (which checks access on every request) and rejoin; the
-- person who lost access is refused. The join policy requires both keys to be current. The
-- organization key stays in the topic, so an organization rotation still invalidates every
-- conversation topic.
--
-- Write amplification: only a row that existed as a grant is a loss (assignments need to have
-- been released and not declined; inserts and gains never rotate). A rotation touches only a
-- conversation that has a key row, i.e. one somebody has opened, and happens at most once per
-- conversation per transaction, so bulk scheduling and bulk removal cost one send plus one
-- update per affected conversation. Capability grants that are not team-scoped, and moves of a
-- service type between folders, are rare administrative actions and rotate the organization key
-- instead of fanning out over conversations.

create table private.conversation_realtime_keys (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  key             text not null
                  default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  rotated_at      timestamptz not null default now(),
  constraint conversation_realtime_keys_key_format check (key ~ '^[0-9a-f]{64}$')
);
-- Row security on with no policies: only the security definer functions below can read it.
alter table private.conversation_realtime_keys enable row level security;
revoke all on private.conversation_realtime_keys from public, anon, authenticated;

-- True when p_key is the conversation's current key.
create function private.conversation_key_is_current(p_conversation uuid, p_key text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.conversation_realtime_keys k
     where k.conversation_id = p_conversation and k.key = p_key);
$$;
revoke all on function private.conversation_key_is_current(uuid, text) from public, anon, authenticated;
grant execute on function private.conversation_key_is_current(uuid, text) to authenticated;

-- Topic names for resources the caller may currently use (the API calls this on every request).
-- Resources the caller cannot use are simply absent, so a person who lost access learns nothing.
-- A conversation key is created on first issue; nothing is stored for the other kinds.
create function public.realtime_resource_topics(p_org uuid, p_resource text, p_ids uuid[])
returns table (resource_id uuid, topic text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org_key text;
  v_ok uuid[];
begin
  if p_resource is null or p_resource not in ('conversation', 'live_plan', 'live_run') then
    raise exception 'unsupported realtime resource' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) > 100 then
    raise exception 'at most 100 ids per request' using errcode = '22023';
  end if;
  if not private.is_active_member(v_user, p_org) then
    return;
  end if;
  select k.key into v_org_key from private.org_realtime_keys k where k.organization_id = p_org;
  if v_org_key is null then
    return;
  end if;

  if p_resource = 'conversation' then
    select coalesce(array_agg(c.id), '{}') into v_ok
      from public.conversations c
     where c.id = any (p_ids) and c.organization_id = p_org
       and private.can_access_conversation(v_user, c.id);
    insert into private.conversation_realtime_keys (conversation_id)
    select unnest(v_ok)
    on conflict do nothing;
    return query
      select k.conversation_id, 'conversation:' || k.conversation_id || ':' || v_org_key || ':' || k.key
        from private.conversation_realtime_keys k
       where k.conversation_id = any (v_ok);
  elsif p_resource = 'live_plan' then
    return query
      select p.id, 'live_plan:' || p.id || ':' || v_org_key
        from public.plans p
       where p.id = any (p_ids) and p.organization_id = p_org;
  else
    return query
      select r.id, 'live_run:' || r.id || ':' || v_org_key
        from public.live_runs r
        join public.plans p on p.id = r.plan_id
       where r.id = any (p_ids) and r.organization_id = p_org;
  end if;
end;
$$;
revoke all on function public.realtime_resource_topics(uuid, text, uuid[]) from public, anon;
grant execute on function public.realtime_resource_topics(uuid, text, uuid[]) to authenticated;

-- Rotate one conversation's key. A conversation nobody was issued a topic for has no key row and
-- nobody to cut off, so nothing happens. Once per transaction is enough: nobody sees the new key
-- before commit.
create function private.rotate_conversation_realtime_key(p_conversation uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old text;
  v_rotated timestamptz;
  v_org uuid;
  v_org_key text;
begin
  select k.key, k.rotated_at into v_old, v_rotated
    from private.conversation_realtime_keys k
   where k.conversation_id = p_conversation for update;
  if not found or v_rotated = now() then
    return;
  end if;
  -- Teammates still holding access refetch their topic from this id-free poke. The conversation
  -- may already be gone (cascade delete); then there is nobody left to tell.
  select c.organization_id into v_org from public.conversations c where c.id = p_conversation;
  select k.key into v_org_key from private.org_realtime_keys k where k.organization_id = v_org;
  if v_org_key is not null then
    perform realtime.send(
      jsonb_build_object('event', 'rekey'),
      'changed',
      'conversation:' || p_conversation || ':' || v_org_key || ':' || v_old,
      true
    );
  end if;
  update private.conversation_realtime_keys
     set key = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         rotated_at = now()
   where conversation_id = p_conversation;
end;
$$;
revoke all on function private.rotate_conversation_realtime_key(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ access-loss triggers ---

-- Leaving (or being removed from) a team ends access to the team conversation.
create function private.rotate_on_team_membership_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.rotate_conversation_realtime_key(c.id)
     from public.conversations c
    where c.kind = 'team' and c.team_id = old.team_id;
  return null;
end;
$$;
revoke all on function private.rotate_on_team_membership_delete() from public, anon, authenticated;

create trigger team_memberships_realtime_rotate
  after delete on public.team_memberships
  for each row execute function private.rotate_on_team_membership_delete();

-- A released, not-declined assignment grants the plan conversation. It is lost when the
-- assignment is deleted, declined, un-released, or moved to another person or plan.
create function private.rotate_on_assignment_loss()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.rotate_conversation_realtime_key(c.id)
     from public.conversations c
    where c.kind = 'plan' and c.plan_id = old.plan_id;
  return null;
end;
$$;
revoke all on function private.rotate_on_assignment_loss() from public, anon, authenticated;

create trigger assignments_realtime_rotate_delete
  after delete on public.assignments
  for each row
  when (old.visibility = 'released' and old.status <> 'declined')
  execute function private.rotate_on_assignment_loss();

create trigger assignments_realtime_rotate_update
  after update of visibility, status, person_id, plan_id on public.assignments
  for each row
  when (old.visibility = 'released' and old.status <> 'declined'
        and not (new.visibility = 'released' and new.status <> 'declined'
                 and new.person_id = old.person_id and new.plan_id = old.plan_id))
  execute function private.rotate_on_assignment_loss();

-- Conversation access also needs an active, adult, unarchived person linked to the account.
-- Archiving, unlinking the account or marking the person a child ends it everywhere that person
-- was on a team or assigned to a plan.
create function private.rotate_on_person_access_loss()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.rotate_conversation_realtime_key(k.conversation_id)
     from private.conversation_realtime_keys k
     join public.conversations c on c.id = k.conversation_id
    where c.organization_id = old.organization_id
      and ((c.kind = 'team' and exists (
              select 1 from public.team_memberships tm
               where tm.team_id = c.team_id and tm.person_id = old.id))
        or (c.kind = 'plan' and exists (
              select 1 from public.assignments a
               where a.plan_id = c.plan_id and a.person_id = old.id
                 and a.visibility = 'released' and a.status <> 'declined')));
  return null;
end;
$$;
revoke all on function private.rotate_on_person_access_loss() from public, anon, authenticated;

create trigger people_realtime_rotate
  after update of archived_at, profile_id, person_type on public.people
  for each row
  when (old.profile_id is not null
        and ((old.archived_at is null and new.archived_at is not null)
             or new.profile_id is distinct from old.profile_id
             or (old.person_type <> 'child' and new.person_type = 'child')))
  execute function private.rotate_on_person_access_loss();

-- Moving a plan or team to another service type changes who holds a service-type-scoped grant.
create function private.rotate_on_plan_scope_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.rotate_conversation_realtime_key(c.id)
     from public.conversations c
    where c.kind = 'plan' and c.plan_id = old.id;
  return null;
end;
$$;
revoke all on function private.rotate_on_plan_scope_change() from public, anon, authenticated;

create trigger plans_realtime_rotate
  after update of service_type_id on public.plans
  for each row
  when (old.service_type_id is distinct from new.service_type_id)
  execute function private.rotate_on_plan_scope_change();

create function private.rotate_on_team_scope_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.rotate_conversation_realtime_key(c.id)
     from public.conversations c
    where c.kind = 'team' and c.team_id = old.id;
  return null;
end;
$$;
revoke all on function private.rotate_on_team_scope_change() from public, anon, authenticated;

create trigger teams_realtime_rotate
  after update of service_type_id on public.teams
  for each row
  when (old.service_type_id is distinct from new.service_type_id)
  execute function private.rotate_on_team_scope_change();

-- Plan leaders and team schedulers / managers hold their access through capability grants.
-- A team-scoped grant only reaches that team's conversation; any wider grant (organization,
-- service type, folder) could reach many, so removing one rotates the organization key.
create function private.rotate_on_grant_loss()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.scope_type = 'team' then
    perform private.rotate_conversation_realtime_key(c.id)
       from public.conversations c
      where c.kind = 'team' and c.team_id = old.team_id;
  else
    perform private.rotate_org_realtime_key(old.organization_id);
  end if;
  return null;
end;
$$;
revoke all on function private.rotate_on_grant_loss() from public, anon, authenticated;

create trigger access_grants_realtime_rotate_delete
  after delete on public.access_grants
  for each row
  when (old.capability in ('plans.edit', 'scheduling.manage', 'teams.manage'))
  execute function private.rotate_on_grant_loss();

create trigger access_grants_realtime_rotate_update
  after update of capability, scope_type, service_type_id, team_id, folder_id, user_id on public.access_grants
  for each row
  when (old.capability in ('plans.edit', 'scheduling.manage', 'teams.manage'))
  execute function private.rotate_on_grant_loss();

-- Folder-scoped grants follow the service type's place in the folder tree.
create function private.rotate_on_folder_move()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.rotate_org_realtime_key(old.organization_id);
  return null;
end;
$$;
revoke all on function private.rotate_on_folder_move() from public, anon, authenticated;

create trigger service_types_realtime_rotate
  after update of folder_id on public.service_types
  for each row
  when (old.folder_id is distinct from new.folder_id)
  execute function private.rotate_on_folder_move();

create trigger service_type_folders_realtime_rotate
  after update of parent_id on public.service_type_folders
  for each row
  when (old.parent_id is distinct from new.parent_id)
  execute function private.rotate_on_folder_move();

-- A scheduler in the legacy access mode holds the capabilities without grants; leaving that mode
-- loses them. Member status and role already rotated the organization key.
create or replace function private.rotate_on_member_change()
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
        and (new.status is distinct from old.status
             or new.role is distinct from old.role
             or new.access_mode is distinct from old.access_mode) then
    perform private.rotate_org_realtime_key(old.organization_id);
  end if;
  return null;
end;
$$;

drop trigger organization_members_realtime_rotate on public.organization_members;
create trigger organization_members_realtime_rotate
  after update of status, role, access_mode or delete on public.organization_members
  for each row execute function private.rotate_on_member_change();

-- ----------------------------------------------------------------------- join policy ---

-- Conversation topics carry both keys; the other kinds carry the organization key only. The
-- caller must be an active member and must be able to read the resource right now.
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

-- Pokes go to the topic with the current keys. A conversation nobody was issued a topic for has
-- no key row and no subscriber, so there is nothing to send to.
create or replace function private.send_resource_poke(p_resource text, p_id uuid, p_org uuid default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org uuid := p_org;
  v_key text;
  v_conversation_key text;
  v_topic text;
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
  v_topic := p_resource || ':' || p_id || ':' || v_key;
  if p_resource = 'conversation' then
    select k.key into v_conversation_key
      from private.conversation_realtime_keys k where k.conversation_id = p_id;
    if v_conversation_key is null then
      return;
    end if;
    v_topic := v_topic || ':' || v_conversation_key;
  end if;
  perform realtime.send(
    jsonb_build_object('id', p_id, 'event', 'changed'),
    'changed',
    v_topic,
    true
  );
end;
$$;
