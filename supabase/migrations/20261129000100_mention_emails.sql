-- ADR-0007: email a person when they are @mentioned in a team/plan chat or a
-- plan item discussion.
--
-- * `person_reminder_preferences.mention_email` is the personal opt-out
--   ("Email me when I'm @mentioned"), on by default.
-- * `post_conversation_message` / `post_item_comment` queue one `email`
--   delivery per mention resolved as `notified`, for people with an email
--   address who did not opt out, due `p_mention_email_delay_seconds` from now
--   (the API passes 600 when the scheduled worker is configured, else 0).
-- * While a queued mention email exists for the same person and the same
--   conversation / plan item, a further mention there queues nothing: that
--   email picks the newer mention up when it is sent (collapse).
-- * `mention_email_batch` tells the dispatcher, at send time, which of the
--   person's mentions in the thread are still unread since their last mention
--   email, so the email shows the latest one and "and N more".
--
-- Both post functions gain a parameter, so the old signatures are dropped
-- and recreated (otherwise PostgREST would see two overloads). Bodies are
-- otherwise identical to 20261115000000_account_deletion_and_user_blocks.sql.

alter table public.person_reminder_preferences
  add column mention_email boolean not null default true;

-- The collapse lookup: queued email deliveries of one person. Small (only
-- queued email rows), unlike the person's whole delivery history.
create index deliveries_queued_email_person_idx on public.deliveries (recipient_person_id)
  where status = 'queued' and channel = 'email';

-- ============================================================ chat ===

drop function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]);

create function public.post_conversation_message(
  p_message_id                  uuid,
  p_conversation                uuid,
  p_body                        text,
  p_reply_to                    uuid,
  p_mentions                    uuid[],
  p_mention_email_delay_seconds int default 600
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
  v_delay   int := greatest(coalesce(p_mention_email_delay_seconds, 600), 0);
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
  if v_delay > 86400 then
    raise exception 'The mention email delay is at most a day' using errcode = '22023';
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
                            where s.conversation_id = p_conversation and s.user_id = pe.profile_id and s.muted)
                or private.has_blocked(pe.profile_id, v_actor) then 'muted'
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
  -- team/plan scope and released attendance. Never notify the sender, or
  -- anyone who blocked them.
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
     and not private.has_blocked(pe.profile_id, v_actor)
     and not exists (
       select 1 from public.conversation_member_states s
        where s.conversation_id = p_conversation
          and s.user_id = pe.profile_id and s.muted
     )
  on conflict do nothing;

  -- ADR-0007: one delayed mention email per notified person, unless one is
  -- already queued for them in this conversation (collapse). The per-person
  -- lock, taken in person order, keeps two concurrent mentions from both
  -- queuing one.
  perform pg_advisory_xact_lock(hashtextextended('mention-email:' || s.person_id::text || ':' || p_conversation::text, 0))
     from (select m.person_id from public.conversation_message_mentions m
            where m.message_id = p_message_id and m.resolution = 'notified'
            order by m.person_id) s;

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel, next_attempt_at)
  select v_conv.organization_id, v_effect, pe.profile_id, pe.id, 'email', v_now + make_interval(secs => v_delay)
    from public.conversation_message_mentions m
    join public.people pe on pe.id = m.person_id
    left join public.profiles pr on pr.id = pe.profile_id
   where m.message_id = p_message_id
     and m.resolution = 'notified'
     and pe.profile_id is not null
     and coalesce(nullif(btrim(pr.email), ''), nullif(btrim(pe.email), '')) is not null
     and coalesce((select rp.mention_email from public.person_reminder_preferences rp where rp.person_id = pe.id), true)
     and not exists (
       select 1
         from public.deliveries d
         join public.delivery_effects e on e.id = d.effect_id
         join public.conversation_messages cm on cm.id = e.conversation_message_id
        where d.recipient_person_id = pe.id
          and d.channel = 'email' and d.status = 'queued'
          and cm.conversation_id = p_conversation
     )
  on conflict do nothing;

  return query select p_message_id, false, v_effect;
end;
$$;
revoke execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[], int) from public, anon;
grant execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[], int) to authenticated;

-- ==================================================== item comments ===

drop function public.post_item_comment(uuid, uuid, text, uuid[]);

create function public.post_item_comment(
  p_comment_id                  uuid,
  p_plan_item                   uuid,
  p_body                        text,
  p_mentions                    uuid[],
  p_mention_email_delay_seconds int default 600
)
returns table (comment_id uuid, replayed boolean, effect_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor   uuid := (select auth.uid());
  v_item    public.plan_items;
  v_plan    public.plans;
  v_person  uuid;
  v_found   public.plan_item_comments;
  v_effect  uuid;
  v_body    text := btrim(coalesce(p_body, ''));
  v_delay   int := greatest(coalesce(p_mention_email_delay_seconds, 600), 0);
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_item from public.plan_items where id = p_plan_item;
  if found then select * into v_plan from public.plans where id = v_item.plan_id; end if;
  if v_item.id is null or not private.can_read_item_thread(v_actor, v_item.plan_id) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'A comment needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_mentions, '{}')) > 20 then
    raise exception 'Mention at most 20 people' using errcode = '22023';
  end if;
  if v_delay > 86400 then
    raise exception 'The mention email delay is at most a day' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('item-comment:' || p_comment_id::text, 0));
  select * into v_found from public.plan_item_comments where id = p_comment_id;
  if found then
    if v_found.author_id <> v_actor or v_found.plan_item_id <> p_plan_item then
      raise exception 'This comment id is already used' using errcode = 'PT409', hint = 'comment_id_conflict';
    end if;
    return query select v_found.id, true,
      (select e.id from public.delivery_effects e where e.comment_id = v_found.id limit 1);
    return;
  end if;

  v_person := private.current_person(v_plan.organization_id);
  insert into public.plan_item_comments (id, organization_id, plan_id, plan_item_id, author_id, author_person_id, body)
  values (p_comment_id, v_plan.organization_id, v_plan.id, v_item.id, v_actor, v_person, v_body);

  insert into public.plan_item_comment_mentions (comment_id, organization_id, person_id, resolution)
  select p_comment_id, v_plan.organization_id, pe.id,
         case when pe.profile_id is null then 'no_login'
              when private.can_read_item_thread(pe.profile_id, v_plan.id)
               and not private.has_blocked(pe.profile_id, v_actor) then 'notified'
              else 'no_access' end
    from public.people pe
   where pe.id = any (coalesce(p_mentions, '{}'))
     and pe.organization_id = v_plan.organization_id
     and pe.id is distinct from v_person;

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, comment_id, created_by)
  values (v_plan.organization_id, 'item-comment:' || p_comment_id, 'item_comment', v_plan.id, p_comment_id, v_actor)
  returning id into v_effect;

  -- Mentioned people with access: feed + push. Earlier participants in the
  -- thread who still have access and haven't blocked the author: feed only.
  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select v_plan.organization_id, v_effect, pe.profile_id, pe.id, c.channel
    from public.plan_item_comment_mentions m
    join public.people pe on pe.id = m.person_id
    cross join unnest(array['in_app', 'push']::public.delivery_channel[]) c(channel)
   where m.comment_id = p_comment_id and m.resolution = 'notified';

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select distinct v_plan.organization_id, v_effect, pe.profile_id, pe.id, 'in_app'::public.delivery_channel
    from public.plan_item_comments c
    join public.people pe on pe.organization_id = v_plan.organization_id and pe.profile_id = c.author_id
   where c.plan_item_id = v_item.id and c.id <> p_comment_id and c.deleted_at is null
     and c.author_id <> v_actor
     and private.can_read_item_thread(c.author_id, v_plan.id)
     and not private.has_blocked(c.author_id, v_actor)
     and not exists (select 1 from public.plan_item_comment_mentions m
                      where m.comment_id = p_comment_id and m.person_id = pe.id)
  on conflict do nothing;

  -- ADR-0007: one delayed mention email per notified person, unless one is
  -- already queued for them on this item (collapse).
  perform pg_advisory_xact_lock(hashtextextended('mention-email:' || s.person_id::text || ':' || v_item.id::text, 0))
     from (select m.person_id from public.plan_item_comment_mentions m
            where m.comment_id = p_comment_id and m.resolution = 'notified'
            order by m.person_id) s;

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel, next_attempt_at)
  select v_plan.organization_id, v_effect, pe.profile_id, pe.id, 'email', now() + make_interval(secs => v_delay)
    from public.plan_item_comment_mentions m
    join public.people pe on pe.id = m.person_id
    left join public.profiles pr on pr.id = pe.profile_id
   where m.comment_id = p_comment_id
     and m.resolution = 'notified'
     and pe.profile_id is not null
     and coalesce(nullif(btrim(pr.email), ''), nullif(btrim(pe.email), '')) is not null
     and coalesce((select rp.mention_email from public.person_reminder_preferences rp where rp.person_id = pe.id), true)
     and not exists (
       select 1
         from public.deliveries d
         join public.delivery_effects e on e.id = d.effect_id
         join public.plan_item_comments ic on ic.id = e.comment_id
        where d.recipient_person_id = pe.id
          and d.channel = 'email' and d.status = 'queued'
          and ic.plan_item_id = v_item.id
     )
  on conflict do nothing;

  return query select p_comment_id, false, v_effect;
end;
$$;
revoke execute on function public.post_item_comment(uuid, uuid, text, uuid[], int) from public, anon;
grant execute on function public.post_item_comment(uuid, uuid, text, uuid[], int) to authenticated;

-- ============================================== send-time batch ===

-- For one mention email delivery: the recipient's mentions in the same
-- conversation / plan item that are still worth emailing — posted after
-- their last sent mention email there (always including this delivery's
-- own mention), not deleted or hidden, not by someone they blocked, and not
-- yet seen (chat: past their read position; both: feed row not marked
-- read). `mention_count = 0` means everything was seen. The latest mention
-- is returned for the excerpt. Service role only (the delivery worker).
create or replace function public.mention_email_batch(p_delivery uuid)
returns table (
  mention_count     int,
  latest_id         uuid,
  latest_body       text,
  latest_author_id  uuid,
  latest_author_person_id uuid,
  latest_created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_delivery  public.deliveries;
  v_effect    public.delivery_effects;
  v_thread    uuid;
  v_since     timestamptz;
  v_read      timestamptz;
begin
  select * into v_delivery from public.deliveries where id = p_delivery;
  if not found or v_delivery.channel <> 'email' or v_delivery.recipient_id is null then
    return query select 0, null::uuid, null::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  select * into v_effect from public.delivery_effects where id = v_delivery.effect_id;

  if v_effect.template = 'conversation_message' then
    select m.conversation_id into v_thread from public.conversation_messages m where m.id = v_effect.conversation_message_id;
    select max(coalesce(d.accepted_at, d.completed_at)) into v_since
      from public.deliveries d
      join public.delivery_effects e on e.id = d.effect_id
      join public.conversation_messages m on m.id = e.conversation_message_id
     where d.recipient_person_id = v_delivery.recipient_person_id
       and d.channel = 'email' and d.id <> v_delivery.id
       and d.status in ('simulated', 'provider_accepted', 'delivered')
       and m.conversation_id = v_thread;
    select s.last_read_at into v_read from public.conversation_member_states s
     where s.conversation_id = v_thread and s.user_id = v_delivery.recipient_id;

    return query
    with candidates as (
      select m.id, m.body, m.author_id, m.author_person_id, m.created_at
        from public.conversation_message_mentions mm
        join public.conversation_messages m on m.id = mm.message_id
       where mm.person_id = v_delivery.recipient_person_id
         and mm.resolution = 'notified'
         and m.conversation_id = v_thread
         and m.deleted_at is null and m.hidden_at is null
         and (m.id = v_effect.conversation_message_id or v_since is null or m.created_at > v_since)
         and not private.has_blocked(v_delivery.recipient_id, m.author_id)
         and (v_read is null or m.created_at > v_read)
         and not exists (
           select 1 from public.delivery_effects e
             join public.notifications n on n.dedupe_key = e.id::text || ':' || v_delivery.recipient_person_id::text
            where e.conversation_message_id = m.id and n.read_at is not null)
    )
    select (select count(*)::int from candidates), c.id, c.body, c.author_id, c.author_person_id, c.created_at
      from (select 1) one
      left join lateral (select * from candidates order by created_at desc, id desc limit 1) c on true;
    return;
  end if;

  if v_effect.template = 'item_comment' then
    select ic.plan_item_id into v_thread from public.plan_item_comments ic where ic.id = v_effect.comment_id;
    select max(coalesce(d.accepted_at, d.completed_at)) into v_since
      from public.deliveries d
      join public.delivery_effects e on e.id = d.effect_id
      join public.plan_item_comments ic on ic.id = e.comment_id
     where d.recipient_person_id = v_delivery.recipient_person_id
       and d.channel = 'email' and d.id <> v_delivery.id
       and d.status in ('simulated', 'provider_accepted', 'delivered')
       and ic.plan_item_id = v_thread;

    return query
    with candidates as (
      select ic.id, ic.body, ic.author_id, ic.author_person_id, ic.created_at
        from public.plan_item_comment_mentions mm
        join public.plan_item_comments ic on ic.id = mm.comment_id
       where mm.person_id = v_delivery.recipient_person_id
         and mm.resolution = 'notified'
         and ic.plan_item_id = v_thread
         and ic.deleted_at is null
         and (ic.id = v_effect.comment_id or v_since is null or ic.created_at > v_since)
         and not private.has_blocked(v_delivery.recipient_id, ic.author_id)
         and not exists (
           select 1 from public.delivery_effects e
             join public.notifications n on n.dedupe_key = e.id::text || ':' || v_delivery.recipient_person_id::text
            where e.comment_id = ic.id and n.read_at is not null)
    )
    select (select count(*)::int from candidates), c.id, c.body, c.author_id, c.author_person_id, c.created_at
      from (select 1) one
      left join lateral (select * from candidates order by created_at desc, id desc limit 1) c on true;
    return;
  end if;

  return query select 0, null::uuid, null::text, null::uuid, null::uuid, null::timestamptz;
end;
$$;
revoke execute on function public.mention_email_batch(uuid) from public, anon, authenticated;
grant execute on function public.mention_email_batch(uuid) to service_role;
