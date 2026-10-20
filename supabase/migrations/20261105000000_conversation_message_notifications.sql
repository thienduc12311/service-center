-- Notify every eligible, unmuted conversation participant for new messages.
-- Reuse F09 access and F00 transactional outbox; no backfill of old messages.
-- Dispatch rechecks access, mute and message visibility before provider calls.
alter type public.notification_type add value if not exists 'conversation_message';

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

  -- All current participants receive one feed entry and one push job. The
  -- canonical access predicate includes active membership, youth policy,
  -- team/plan scope and released attendance. Never notify the sender.
  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select v_conv.organization_id, v_effect, pe.profile_id, pe.id, c.channel
    from public.people pe
    cross join unnest(array['in_app', 'push']::public.delivery_channel[]) c(channel)
   where pe.organization_id = v_conv.organization_id
     and pe.profile_id is not null
     and pe.profile_id <> v_actor
     and pe.archived_at is null
     and pe.person_type <> 'child'
     and private.can_access_conversation(pe.profile_id, p_conversation)
     and not exists (
       select 1 from public.conversation_member_states s
        where s.conversation_id = p_conversation
          and s.user_id = pe.profile_id and s.muted
     )
  on conflict do nothing;

  return query select p_message_id, false, v_effect;
end;
$$;
revoke execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]) to authenticated;

