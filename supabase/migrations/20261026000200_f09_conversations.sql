-- ============================================================================
-- F09 Pass C — team and plan conversations.
--
-- Supported types (and only these): one conversation per team and one per
-- plan. Direct messages, group chats, reactions, read receipts and
-- attachments are not enabled (attachments wait for F13's file lifecycle).
--
-- Participants are derived from current state on every read and write, not
-- stored, so removing someone from a team or plan, deactivating or archiving
-- them ends their access at once — there is no membership row to forget and
-- no cached authorization:
--   team  active members on the team, plus people who schedule or manage it
--   plan  people with a released, not-declined request, plus plan leaders
-- Youth policy: Persons recorded as `child` are not participants and cannot
-- be mentioned until the organization adopts an explicit youth/guardian
-- messaging policy (none exists yet). This is enforced in the access
-- function, not in the client.
-- Moderators: administrators, plus team managers (team conversations) or
-- plan editors (plan conversations). They can hide/restore messages and
-- resolve reports; every action is audited.
-- Clients poll the authenticated API; no Realtime publication is added, so
-- there is no long-lived subscription that could outlive a revocation. Push
-- and feed notifications recheck access and mute when they are dispatched.
-- Retention: organizations.conversation_retention_days (null = keep). The
-- delivery worker purges older messages in bounded batches.
-- ============================================================================

alter type public.delivery_template add value if not exists 'conversation_message';
alter type public.notification_type add value if not exists 'conversation_mention';
alter type public.notification_type add value if not exists 'conversation_reply';

alter table public.organizations
  add column conversation_retention_days int
    check (conversation_retention_days is null or conversation_retention_days between 30 and 3650);
comment on column public.organizations.conversation_retention_days is
  'F09: conversation messages older than this are purged by the worker. Null keeps them.';

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('team', 'plan')),
  team_id          uuid,
  plan_id          uuid,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint conversations_shape check (
    (kind = 'team' and team_id is not null and plan_id is null)
    or (kind = 'plan' and plan_id is not null and team_id is null)
  ),
  constraint conversations_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade,
  constraint conversations_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade
);
create unique index conversations_team_key on public.conversations (team_id) where kind = 'team';
create unique index conversations_plan_key on public.conversations (plan_id) where kind = 'plan';
create unique index conversations_id_org_key on public.conversations (id, organization_id);
create index conversations_organization_idx on public.conversations (organization_id);
create index conversations_created_by_idx on public.conversations (created_by);

-- Not a youth participant (see header).
create or replace function private.is_adult_person(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people pe
     where pe.organization_id = p_org and pe.profile_id = p_user
       and pe.archived_at is null and pe.person_type <> 'child');
$$;

create or replace function private.can_access_conversation(p_user uuid, p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_active_member(p_user, c.organization_id)
       and private.is_adult_person(p_user, c.organization_id)
       and case c.kind
         when 'team' then private.is_on_team(p_user, c.team_id)
                       or private.can_schedule_team(p_user, c.team_id)
                       or private.can_manage_team(p_user, c.team_id)
         else private.is_plan_leader(p_user, c.plan_id)
           or private.is_scheduled_on_plan(p_user, c.plan_id, null)
       end
      from public.conversations c where c.id = p_conversation
  ), false);
$$;

create or replace function private.can_moderate_conversation(p_user uuid, p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_active_member(p_user, c.organization_id) and (
      exists (select 1 from public.organization_members m
               where m.organization_id = c.organization_id and m.user_id = p_user
                 and m.status = 'active' and m.role in ('owner', 'admin'))
      or (c.kind = 'team' and private.can_manage_team(p_user, c.team_id))
      or (c.kind = 'plan' and private.can_edit_plan(p_user, c.plan_id)))
      from public.conversations c where c.id = p_conversation
  ), false);
$$;

revoke execute on function private.is_adult_person(uuid, uuid) from public, anon;
revoke execute on function private.can_access_conversation(uuid, uuid) from public, anon;
revoke execute on function private.can_moderate_conversation(uuid, uuid) from public, anon;
grant execute on function private.is_adult_person(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_access_conversation(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_moderate_conversation(uuid, uuid) to authenticated, service_role;

create or replace function public.user_can_access_conversation(p_user uuid, p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_conversation(p_user, p_conversation);
$$;
revoke execute on function public.user_can_access_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_can_access_conversation(uuid, uuid) to service_role;

create table public.conversation_messages (
  -- Chosen by the client, so a retried send is one message.
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  conversation_id   uuid not null,
  author_id         uuid not null references public.profiles (id) on delete cascade,
  author_person_id  uuid references public.people (id) on delete set null,
  reply_to_id       uuid references public.conversation_messages (id) on delete set null,
  body              text not null,
  search            tsvector generated always as (to_tsvector('simple', body)) stored,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  hidden_at         timestamptz,
  hidden_by         uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint conversation_messages_conversation_fk foreign key (conversation_id, organization_id)
    references public.conversations (id, organization_id) on delete cascade,
  constraint conversation_messages_body check (
    (deleted_at is null and hidden_at is null and char_length(btrim(body)) between 1 and 4000)
    or ((deleted_at is not null or hidden_at is not null) and body = '')
  )
);
create index conversation_messages_history_idx on public.conversation_messages (conversation_id, created_at desc, id desc);
create index conversation_messages_search_idx on public.conversation_messages using gin (search);
create index conversation_messages_organization_created_idx on public.conversation_messages (organization_id, created_at);
create index conversation_messages_author_idx on public.conversation_messages (author_id, created_at desc);
create index conversation_messages_author_person_idx on public.conversation_messages (author_person_id);
create index conversation_messages_reply_to_idx on public.conversation_messages (reply_to_id) where reply_to_id is not null;
create index conversation_messages_hidden_by_idx on public.conversation_messages (hidden_by) where hidden_by is not null;

create table public.conversation_message_mentions (
  message_id       uuid not null references public.conversation_messages (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  resolution       text not null check (resolution in ('notified', 'no_access', 'no_login', 'muted')),
  primary key (message_id, person_id)
);
create index conversation_message_mentions_person_idx on public.conversation_message_mentions (person_id);
create index conversation_message_mentions_organization_idx on public.conversation_message_mentions (organization_id);

create table public.conversation_member_states (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  last_read_at     timestamptz,
  muted            boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_member_states_user_idx on public.conversation_member_states (user_id);
create index conversation_member_states_organization_idx on public.conversation_member_states (organization_id);

create table public.conversation_message_reports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  message_id       uuid not null references public.conversation_messages (id) on delete cascade,
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  reason           text not null check (reason in ('spam', 'harassment', 'inappropriate', 'safety', 'other')),
  details          text check (details is null or char_length(details) <= 1000),
  status           text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolved_by      uuid references public.profiles (id) on delete set null,
  resolved_at      timestamptz,
  resolution_note  text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at       timestamptz not null default now(),
  constraint conversation_message_reports_one_per_reporter unique (message_id, reporter_id),
  constraint conversation_message_reports_resolution check ((status = 'open') = (resolved_at is null))
);
create index conversation_message_reports_open_idx on public.conversation_message_reports (conversation_id, created_at) where status = 'open';
create index conversation_message_reports_organization_idx on public.conversation_message_reports (organization_id, status);
create index conversation_message_reports_reporter_idx on public.conversation_message_reports (reporter_id);
create index conversation_message_reports_resolved_by_idx on public.conversation_message_reports (resolved_by);

alter table public.delivery_effects
  add column conversation_message_id uuid references public.conversation_messages (id) on delete cascade;
create index delivery_effects_conversation_message_idx on public.delivery_effects (conversation_message_id)
  where conversation_message_id is not null;

alter table public.notifications
  add column conversation_id uuid references public.conversations (id) on delete cascade;
create index notifications_conversation_idx on public.notifications (conversation_id) where conversation_id is not null;

-- ------------------------------------------------------------ actions ------

-- Opens (creating on first use) the conversation for a team or plan the
-- caller participates in.
create or replace function public.open_conversation(p_kind text, p_target uuid)
returns public.conversations
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_row   public.conversations;
begin
  if p_kind = 'team' then
    select organization_id into v_org from public.teams where id = p_target;
  elsif p_kind = 'plan' then
    select organization_id into v_org from public.plans where id = p_target;
  else
    raise exception 'Unsupported conversation type' using errcode = '22023';
  end if;
  if v_org is null then raise exception 'Conversation not found' using errcode = 'P0002'; end if;

  select * into v_row from public.conversations c
   where (p_kind = 'team' and c.kind = 'team' and c.team_id = p_target)
      or (p_kind = 'plan' and c.kind = 'plan' and c.plan_id = p_target);
  if not found then
    insert into public.conversations (organization_id, kind, team_id, plan_id, created_by)
    values (v_org, p_kind, case when p_kind = 'team' then p_target end,
            case when p_kind = 'plan' then p_target end, v_actor)
    on conflict do nothing;
    select * into v_row from public.conversations c
     where (p_kind = 'team' and c.kind = 'team' and c.team_id = p_target)
        or (p_kind = 'plan' and c.kind = 'plan' and c.plan_id = p_target);
  end if;
  if not private.can_access_conversation(v_actor, v_row.id) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;
revoke execute on function public.open_conversation(text, uuid) from public, anon;
grant execute on function public.open_conversation(text, uuid) to authenticated;

-- Posts a message (stable id), resolves mentions under current access and
-- enqueues notifications in one transaction. At most 20 messages a minute
-- per author per conversation.
create or replace function public.post_conversation_message(
  p_message_id    uuid,
  p_conversation  uuid,
  p_body          text,
  p_reply_to      uuid,
  p_mentions      uuid[]
)
returns table (message_id uuid, replayed boolean, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_actor   uuid := (select auth.uid());
  v_conv    public.conversations;
  v_found   public.conversation_messages;
  v_reply   public.conversation_messages;
  v_person  uuid;
  v_effect  uuid;
  v_body    text := btrim(coalesce(p_body, ''));
  v_now     timestamptz := now();
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or not private.can_access_conversation(v_actor, p_conversation) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'A message needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_mentions, '{}')) > 20 then
    raise exception 'Mention at most 20 people' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('conversation-message:' || p_message_id::text, 0));
  select * into v_found from public.conversation_messages where id = p_message_id;
  if found then
    if v_found.author_id <> v_actor or v_found.conversation_id <> p_conversation then
      raise exception 'This message id is already used' using errcode = 'PT409', hint = 'message_id_conflict';
    end if;
    return query select v_found.id, true,
      (select e.id from public.delivery_effects e where e.conversation_message_id = v_found.id limit 1);
    return;
  end if;

  if (select count(*) from public.conversation_messages m
       where m.conversation_id = p_conversation and m.author_id = v_actor
         and m.created_at > v_now - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too quickly' using errcode = 'PT429', hint = 'rate_limited';
  end if;

  if p_reply_to is not null then
    select * into v_reply from public.conversation_messages where id = p_reply_to and conversation_id = p_conversation;
    if not found then raise exception 'Reply target not found' using errcode = 'P0002'; end if;
  end if;

  v_person := private.current_person(v_conv.organization_id);
  insert into public.conversation_messages (id, organization_id, conversation_id, author_id, author_person_id, reply_to_id, body)
  values (p_message_id, v_conv.organization_id, p_conversation, v_actor, v_person, p_reply_to, v_body);

  -- Sending reads everything before it.
  insert into public.conversation_member_states (conversation_id, user_id, organization_id, last_read_at)
  values (p_conversation, v_actor, v_conv.organization_id, v_now)
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(public.conversation_member_states.last_read_at, excluded.last_read_at), updated_at = now();

  insert into public.conversation_message_mentions (message_id, organization_id, person_id, resolution)
  select p_message_id, v_conv.organization_id, pe.id,
         case when pe.profile_id is null then 'no_login'
              when not private.can_access_conversation(pe.profile_id, p_conversation) then 'no_access'
              when exists (select 1 from public.conversation_member_states s
                            where s.conversation_id = p_conversation and s.user_id = pe.profile_id and s.muted) then 'muted'
              else 'notified' end
    from public.people pe
   where pe.id = any (coalesce(p_mentions, '{}'))
     and pe.organization_id = v_conv.organization_id
     and pe.id is distinct from v_person;

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, conversation_message_id, created_by)
  values (v_conv.organization_id, 'conversation-message:' || p_message_id, 'conversation_message',
          v_conv.plan_id, p_message_id, v_actor)
  returning id into v_effect;

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select v_conv.organization_id, v_effect, pe.profile_id, pe.id, c.channel
    from public.conversation_message_mentions m
    join public.people pe on pe.id = m.person_id
    cross join unnest(array['in_app', 'push']::public.delivery_channel[]) c(channel)
   where m.message_id = p_message_id and m.resolution = 'notified';

  -- The author of the message replied to, when they still have access and
  -- have not muted the conversation (feed only).
  if v_reply.id is not null and v_reply.author_id <> v_actor and v_reply.deleted_at is null
     and private.can_access_conversation(v_reply.author_id, p_conversation)
     and not exists (select 1 from public.conversation_member_states s
                      where s.conversation_id = p_conversation and s.user_id = v_reply.author_id and s.muted) then
    insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
    select v_conv.organization_id, v_effect, pe.profile_id, pe.id, 'in_app'
      from public.people pe
     where pe.organization_id = v_conv.organization_id and pe.profile_id = v_reply.author_id
    on conflict do nothing;
  end if;

  return query select p_message_id, false, v_effect;
end;
$$;
revoke execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]) to authenticated;

create or replace function public.edit_conversation_message(p_message_id uuid, p_body text)
returns public.conversation_messages
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.conversation_messages;
  v_body  text := btrim(coalesce(p_body, ''));
begin
  select * into v_row from public.conversation_messages where id = p_message_id for update;
  if not found or not private.can_access_conversation(v_actor, v_row.conversation_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_actor then
    raise exception 'Only the author can edit a message' using errcode = '42501';
  end if;
  if v_row.deleted_at is not null or v_row.hidden_at is not null then
    raise exception 'This message was removed' using errcode = 'PT409', hint = 'message_removed';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'A message needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if v_body = v_row.body then return v_row; end if;
  insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id, previous_body)
  values (v_row.organization_id, 'conversation_message', v_row.id, 'edited', v_actor, v_row.body);
  update public.conversation_messages set body = v_body, edited_at = now() where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.delete_conversation_message(p_message_id uuid)
returns public.conversation_messages
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.conversation_messages;
begin
  select * into v_row from public.conversation_messages where id = p_message_id for update;
  if not found or not private.can_access_conversation(v_actor, v_row.conversation_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_actor and not private.can_moderate_conversation(v_actor, v_row.conversation_id) then
    raise exception 'Only the author or a moderator can delete a message' using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then return v_row; end if;
  insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id, previous_body)
  values (v_row.organization_id, 'conversation_message', v_row.id, 'deleted', v_actor, nullif(v_row.body, ''));
  update public.conversation_messages set body = '', deleted_at = now() where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

-- Read position only moves forward.
create or replace function public.mark_conversation_read(p_conversation uuid, p_read_at timestamptz)
returns public.conversation_member_states
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_conv  public.conversations;
  v_row   public.conversation_member_states;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or not private.can_access_conversation(v_actor, p_conversation) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  insert into public.conversation_member_states (conversation_id, user_id, organization_id, last_read_at)
  values (p_conversation, v_actor, v_conv.organization_id, least(coalesce(p_read_at, now()), now()))
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(public.conversation_member_states.last_read_at, excluded.last_read_at), updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_conversation_muted(p_conversation uuid, p_muted boolean)
returns public.conversation_member_states
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_conv  public.conversations;
  v_row   public.conversation_member_states;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or not private.can_access_conversation(v_actor, p_conversation) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  insert into public.conversation_member_states (conversation_id, user_id, organization_id, muted)
  values (p_conversation, v_actor, v_conv.organization_id, coalesce(p_muted, false))
  on conflict (conversation_id, user_id) do update set muted = excluded.muted, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- A participant reports someone else's message. Reporting twice returns the
-- first report.
create or replace function public.report_conversation_message(p_message_id uuid, p_reason text, p_details text)
returns public.conversation_message_reports
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_msg   public.conversation_messages;
  v_row   public.conversation_message_reports;
begin
  select * into v_msg from public.conversation_messages where id = p_message_id;
  if not found or not private.can_access_conversation(v_actor, v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if v_msg.author_id = v_actor then
    raise exception 'You cannot report your own message' using errcode = '22023';
  end if;
  insert into public.conversation_message_reports (organization_id, conversation_id, message_id, reporter_id, reason, details)
  values (v_msg.organization_id, v_msg.conversation_id, v_msg.id, v_actor, p_reason, nullif(btrim(p_details), ''))
  on conflict (message_id, reporter_id) do nothing;
  select * into v_row from public.conversation_message_reports where message_id = p_message_id and reporter_id = v_actor;
  return v_row;
end;
$$;

-- Moderator decision on a report: dismiss it, or hide the message (which
-- also closes every other open report on it).
create or replace function public.resolve_conversation_report(p_report uuid, p_action text, p_note text)
returns public.conversation_message_reports
language plpgsql security definer set search_path = '' as $$
declare
  v_actor  uuid := (select auth.uid());
  v_report public.conversation_message_reports;
  v_msg    public.conversation_messages;
begin
  select * into v_report from public.conversation_message_reports where id = p_report for update;
  if not found or not private.can_moderate_conversation(v_actor, v_report.conversation_id) then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if p_action not in ('dismiss', 'hide') then
    raise exception 'Choose dismiss or hide' using errcode = '22023';
  end if;
  if v_report.status <> 'open' then return v_report; end if;

  if p_action = 'hide' then
    select * into v_msg from public.conversation_messages where id = v_report.message_id for update;
    if v_msg.hidden_at is null and v_msg.deleted_at is null then
      insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id, previous_body, reason)
      values (v_msg.organization_id, 'conversation_message', v_msg.id, 'hidden', v_actor, v_msg.body, nullif(btrim(p_note), ''));
      update public.conversation_messages set body = '', hidden_at = now(), hidden_by = v_actor where id = v_msg.id;
    end if;
    update public.conversation_message_reports
       set status = 'actioned', resolved_by = v_actor, resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
     where message_id = v_report.message_id and status = 'open';
  else
    insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id, reason)
    values (v_report.organization_id, 'conversation_message', v_report.message_id, 'report_dismissed', v_actor, nullif(btrim(p_note), ''));
    update public.conversation_message_reports
       set status = 'dismissed', resolved_by = v_actor, resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
     where id = p_report;
  end if;
  select * into v_report from public.conversation_message_reports where id = p_report;
  return v_report;
end;
$$;

-- Moderator restores a hidden message from its audit record.
create or replace function public.restore_conversation_message(p_message_id uuid)
returns public.conversation_messages
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.conversation_messages;
  v_body  text;
begin
  select * into v_row from public.conversation_messages where id = p_message_id for update;
  if not found or not private.can_moderate_conversation(v_actor, v_row.conversation_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if v_row.hidden_at is null then return v_row; end if;
  select a.previous_body into v_body from public.discussion_audit_events a
   where a.subject_type = 'conversation_message' and a.subject_id = v_row.id and a.action = 'hidden'
   order by a.created_at desc limit 1;
  if nullif(v_body, '') is null then
    raise exception 'The hidden text is no longer available' using errcode = 'PT409', hint = 'message_unrecoverable';
  end if;
  insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id)
  values (v_row.organization_id, 'conversation_message', v_row.id, 'restored', v_actor);
  update public.conversation_messages set body = v_body, hidden_at = null, hidden_by = null
   where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

-- The caller's conversations in one organization with unread counts.
create or replace function public.my_conversations(p_organization_id uuid)
returns table (
  id uuid, kind text, team_id uuid, plan_id uuid, title text, service_date timestamptz,
  last_message_at timestamptz, unread_count int, muted boolean, can_moderate boolean, open_reports int
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.team_id, c.plan_id,
         coalesce(t.name, p.title) as title, p.service_date,
         (select max(m.created_at) from public.conversation_messages m where m.conversation_id = c.id),
         (select count(*)::int from public.conversation_messages m
           where m.conversation_id = c.id and m.author_id <> (select auth.uid())
             and m.deleted_at is null and m.hidden_at is null
             and (s.last_read_at is null or m.created_at > s.last_read_at)),
         coalesce(s.muted, false),
         private.can_moderate_conversation((select auth.uid()), c.id),
         case when private.can_moderate_conversation((select auth.uid()), c.id)
              then (select count(*)::int from public.conversation_message_reports r
                     where r.conversation_id = c.id and r.status = 'open')
              else 0 end
    from public.conversations c
    left join public.teams t on t.id = c.team_id
    left join public.plans p on p.id = c.plan_id
    left join public.conversation_member_states s on s.conversation_id = c.id and s.user_id = (select auth.uid())
   where c.organization_id = p_organization_id
     and private.can_access_conversation((select auth.uid()), c.id)
   order by 7 desc nulls last, c.created_at desc
   limit 100;
$$;

-- Bounded retention purge for the worker. Returns how many were removed.
create or replace function public.purge_expired_conversation_messages(p_limit int default 500)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  with doomed as (
    select m.id from public.conversation_messages m
      join public.organizations o on o.id = m.organization_id
     where o.conversation_retention_days is not null
       and m.created_at < now() - make_interval(days => o.conversation_retention_days)
     order by m.created_at
     limit least(greatest(p_limit, 1), 5000)
     for update of m skip locked
  ), removed as (
    delete from public.conversation_messages m using doomed where m.id = doomed.id returning m.id
  )
  select count(*) into v_count from removed;
  return v_count;
end;
$$;

revoke execute on function public.edit_conversation_message(uuid, text) from public, anon;
revoke execute on function public.delete_conversation_message(uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid, timestamptz) from public, anon;
revoke execute on function public.set_conversation_muted(uuid, boolean) from public, anon;
revoke execute on function public.report_conversation_message(uuid, text, text) from public, anon;
revoke execute on function public.resolve_conversation_report(uuid, text, text) from public, anon;
revoke execute on function public.restore_conversation_message(uuid) from public, anon;
revoke execute on function public.my_conversations(uuid) from public, anon;
revoke execute on function public.purge_expired_conversation_messages(int) from public, anon, authenticated;
grant execute on function public.edit_conversation_message(uuid, text) to authenticated;
grant execute on function public.delete_conversation_message(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid, timestamptz) to authenticated;
grant execute on function public.set_conversation_muted(uuid, boolean) to authenticated;
grant execute on function public.report_conversation_message(uuid, text, text) to authenticated;
grant execute on function public.resolve_conversation_report(uuid, text, text) to authenticated;
grant execute on function public.restore_conversation_message(uuid) to authenticated;
grant execute on function public.my_conversations(uuid) to authenticated;
grant execute on function public.purge_expired_conversation_messages(int) to service_role;

-- ------------------------------------------------------------------ rls ----
alter table public.conversations                 enable row level security;
alter table public.conversation_messages         enable row level security;
alter table public.conversation_message_mentions enable row level security;
alter table public.conversation_member_states    enable row level security;
alter table public.conversation_message_reports  enable row level security;

create policy conversations_select on public.conversations
  for select to authenticated using (private.can_access_conversation((select auth.uid()), id));
create policy conversation_messages_select on public.conversation_messages
  for select to authenticated using (private.can_access_conversation((select auth.uid()), conversation_id));
create policy conversation_message_mentions_select on public.conversation_message_mentions
  for select to authenticated using (exists (
    select 1 from public.conversation_messages m
     where m.id = message_id and private.can_access_conversation((select auth.uid()), m.conversation_id)));
create policy conversation_member_states_select on public.conversation_member_states
  for select to authenticated using (
    user_id = (select auth.uid()) and private.can_access_conversation((select auth.uid()), conversation_id));
create policy conversation_message_reports_select on public.conversation_message_reports
  for select to authenticated using (
    (reporter_id = (select auth.uid()) and private.is_active_member((select auth.uid()), organization_id))
    or private.can_moderate_conversation((select auth.uid()), conversation_id));

grant select on public.conversations, public.conversation_messages, public.conversation_message_mentions,
  public.conversation_member_states, public.conversation_message_reports to authenticated;
revoke insert, update, delete, truncate on public.conversations, public.conversation_messages,
  public.conversation_message_mentions, public.conversation_member_states, public.conversation_message_reports
  from authenticated;
revoke all on public.conversations, public.conversation_messages, public.conversation_message_mentions,
  public.conversation_member_states, public.conversation_message_reports from anon;
grant all on public.conversations, public.conversation_messages, public.conversation_message_mentions,
  public.conversation_member_states, public.conversation_message_reports to service_role;

-- Who the caller can usefully mention: current participants of an item
-- thread (p_plan) or a conversation (p_conversation), names only. The caller
-- must be a participant. Mentioning anyone else is still allowed but is
-- recorded as no_access and notifies nobody.
create or replace function public.discussion_mention_candidates(p_plan uuid, p_conversation uuid)
returns table (person_id uuid, first_name text, last_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if (p_plan is null) = (p_conversation is null) then
    raise exception 'Choose a plan or a conversation' using errcode = '22023';
  end if;
  if p_plan is not null then
    select organization_id into v_org from public.plans where id = p_plan;
    if v_org is null or not private.can_read_item_thread(v_actor, p_plan) then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  else
    select organization_id into v_org from public.conversations where id = p_conversation;
    if v_org is null or not private.can_access_conversation(v_actor, p_conversation) then
      raise exception 'Conversation not found' using errcode = 'P0002';
    end if;
  end if;
  return query
  select pe.id, pe.first_name, pe.last_name
    from public.people pe
   where pe.organization_id = v_org and pe.profile_id is not null and pe.archived_at is null
     and pe.profile_id <> v_actor
     and case when p_plan is not null then private.can_read_item_thread(pe.profile_id, p_plan)
              else private.can_access_conversation(pe.profile_id, p_conversation) end
   order by pe.first_name, pe.last_name nulls last, pe.id
   limit 300;
end;
$$;
revoke execute on function public.discussion_mention_candidates(uuid, uuid) from public, anon;
grant execute on function public.discussion_mention_candidates(uuid, uuid) to authenticated;
