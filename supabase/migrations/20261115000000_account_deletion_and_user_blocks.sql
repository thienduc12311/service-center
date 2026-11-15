-- ============================================================================
-- Account deletion and user blocking (App Store Review Guidelines 5.1.1(v)
-- and 1.2).
--
-- Account deletion
--   The API deletes the auth user with the Supabase admin API; profiles and
--   everything that belongs only to the person cascades from there. Records
--   that belong to an organization (who created a blockout, an import, a
--   library merge) keep the record and forget the person, like every other
--   created_by column already does.
--   Before that, private.account_deletion_plan decides what happens to each
--   organization the person owns alone:
--     deleted  nobody else is an active member, so the organization goes too
--     blocked  other active members would be left without an owner; the
--              person must make someone else an owner first
--   public.prepare_account_deletion (service role only) re-checks that plan
--   under lock and deletes the organizations marked "deleted". It is
--   idempotent, so a retry after a failed auth deletion is safe.
--
-- User blocking
--   user_blocks is per person, not per organization: blocking someone hides
--   them everywhere the two people meet. A block hides the blocked person's
--   conversation messages and plan item comments from the blocker (RLS), keeps
--   them out of the blocker's unread counts, and stops their messages and
--   comments from notifying the blocker. The blocked person is never told.
-- ============================================================================

-- ------------------------------------------- deletable created_by refs ----

alter table public.blockout_series
  alter column created_by drop not null,
  drop constraint blockout_series_created_by_fkey,
  add constraint blockout_series_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.blockout_series_exceptions
  alter column created_by drop not null,
  drop constraint blockout_series_exceptions_created_by_fkey,
  add constraint blockout_series_exceptions_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.structured_import_jobs
  alter column created_by drop not null,
  drop constraint structured_import_jobs_created_by_fkey,
  add constraint structured_import_jobs_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.song_bulk_previews
  alter column created_by drop not null,
  drop constraint song_bulk_previews_created_by_fkey,
  add constraint song_bulk_previews_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.library_operations
  alter column actor_id drop not null,
  drop constraint library_operations_actor_id_fkey,
  add constraint library_operations_actor_id_fkey
    foreign key (actor_id) references auth.users (id) on delete set null;

-- Indexed so the set-null cascades do not scan these tables.
create index if not exists blockout_series_created_by_idx on public.blockout_series (created_by);
create index if not exists blockout_series_exceptions_created_by_idx on public.blockout_series_exceptions (created_by);
create index if not exists structured_import_jobs_created_by_idx on public.structured_import_jobs (created_by);
create index if not exists song_bulk_previews_created_by_idx on public.song_bulk_previews (created_by);
create index if not exists library_operations_actor_idx on public.library_operations (actor_id);

-- ------------------------------------------------------ account deletion --

create or replace function private.account_deletion_plan(p_user uuid)
returns table (organization_id uuid, organization_name text, outcome text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name,
         case when exists (select 1 from public.organization_members other
                            where other.organization_id = o.id and other.user_id <> p_user
                              and other.status = 'active')
              then 'blocked' else 'deleted' end
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = p_user
     and m.status = 'active'
     and m.role = 'owner'
     and not exists (select 1 from public.organization_members co
                      where co.organization_id = o.id and co.user_id <> p_user
                        and co.status = 'active' and co.role = 'owner')
   order by o.name, o.id;
$$;
revoke execute on function private.account_deletion_plan(uuid) from public, anon, authenticated;

-- What deleting the caller's account would do, for the confirmation screen.
create or replace function public.my_account_deletion_plan()
returns table (organization_id uuid, organization_name text, outcome text)
language sql stable security definer set search_path = '' as $$
  select * from private.account_deletion_plan((select auth.uid()));
$$;
revoke execute on function public.my_account_deletion_plan() from public, anon;
grant execute on function public.my_account_deletion_plan() to authenticated;

-- Re-checks the plan under lock and removes the organizations that would be
-- left with nobody in them. Returns their ids. Service role only: the API
-- calls it right before deleting the auth user.
create or replace function public.prepare_account_deletion(p_user uuid)
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if p_user is null then raise exception 'A user is required' using errcode = '22023'; end if;

  -- Serialize with membership changes in every organization the person
  -- owns, so nobody joins between the check and the delete.
  perform 1 from public.organizations o
   where o.id in (select m.organization_id from public.organization_members m
                   where m.user_id = p_user and m.status = 'active' and m.role = 'owner')
   order by o.id
     for update;

  if exists (select 1 from private.account_deletion_plan(p_user) where outcome = 'blocked') then
    raise exception 'Make someone else an owner of your organizations before deleting your account'
      using errcode = 'PT409', hint = 'account_deletion_blocked';
  end if;

  for v_org in select organization_id from private.account_deletion_plan(p_user) where outcome = 'deleted' loop
    -- Plans first: library records still used by a plan refuse deletion.
    delete from public.plans where organization_id = v_org;
    delete from public.organizations where id = v_org;
    return next v_org;
  end loop;

  -- The picture is deleted with the account; stop pointing at it.
  update public.people pe
     set avatar_url = null
   where pe.profile_id = p_user
     and pe.avatar_url is not distinct from (select p.avatar_url from public.profiles p where p.id = p_user);
end;
$$;
revoke execute on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- ---------------------------------------------------------- user blocks ---

create table public.user_blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
comment on table public.user_blocks is
  'A person hides another person''s messages and comments, and stops their notifications. Never shown to the blocked person.';
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

create policy user_blocks_select on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy user_blocks_delete on public.user_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));
-- Inserts go through block_user, which checks the two people share an
-- organization so a block can't be used to probe for profile ids.

grant select, delete on public.user_blocks to authenticated;
revoke insert, update, truncate on public.user_blocks from authenticated;
revoke all on public.user_blocks from anon;
grant all on public.user_blocks to service_role;

create or replace function private.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks b where b.blocker_id = p_blocker and b.blocked_id = p_blocked);
$$;
revoke execute on function private.has_blocked(uuid, uuid) from public, anon;
grant execute on function private.has_blocked(uuid, uuid) to authenticated, service_role;

create or replace function public.block_user(p_user uuid)
returns public.user_blocks
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.user_blocks;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_user is null or p_user = v_actor then
    raise exception 'You can''t block yourself' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
     where mine.user_id = v_actor and mine.status = 'active' and theirs.user_id = p_user
  ) then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id) values (v_actor, p_user)
  on conflict (blocker_id, blocked_id) do nothing;
  select * into v_row from public.user_blocks where blocker_id = v_actor and blocked_id = p_user;
  return v_row;
end;
$$;
revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- The caller's blocks with the name they knew the person by.
create or replace function public.my_blocked_users()
returns table (user_id uuid, full_name text, avatar_url text, blocked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.blocked_id, p.full_name, p.avatar_url, b.created_at
    from public.user_blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = (select auth.uid())
   order by b.created_at desc;
$$;
revoke execute on function public.my_blocked_users() from public, anon;
grant execute on function public.my_blocked_users() to authenticated;

-- ------------------------------------------- hide blocked people's content --

drop policy conversation_messages_select on public.conversation_messages;
create policy conversation_messages_select on public.conversation_messages
  for select to authenticated using (
    private.can_access_conversation((select auth.uid()), conversation_id)
    and not exists (select 1 from public.user_blocks b
                     where b.blocker_id = (select auth.uid()) and b.blocked_id = author_id));

drop policy plan_item_comments_select on public.plan_item_comments;
create policy plan_item_comments_select on public.plan_item_comments
  for select to authenticated using (
    private.can_read_item_thread((select auth.uid()), plan_id)
    and not exists (select 1 from public.user_blocks b
                     where b.blocker_id = (select auth.uid()) and b.blocked_id = author_id));

-- Unread counts skip blocked authors (otherwise identical to F09).
create or replace function public.my_conversations(p_organization_id uuid)
returns table (
  id uuid, kind text, team_id uuid, plan_id uuid, title text, service_date timestamptz,
  last_message_at timestamptz, unread_count int, muted boolean, can_moderate boolean, open_reports int
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.kind, c.team_id, c.plan_id,
         coalesce(t.name, p.title) as title, p.service_date,
         (select max(m.created_at) from public.conversation_messages m
           where m.conversation_id = c.id
             and not private.has_blocked((select auth.uid()), m.author_id)),
         (select count(*)::int from public.conversation_messages m
           where m.conversation_id = c.id and m.author_id <> (select auth.uid())
             and m.deleted_at is null and m.hidden_at is null
             and (s.last_read_at is null or m.created_at > s.last_read_at)
             and not private.has_blocked((select auth.uid()), m.author_id)),
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

-- Messages don't notify people who blocked the author (otherwise identical
-- to 20261105000000). A blocker who is mentioned reads as "muted" to the
-- author, so the block itself is never revealed.
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

  return query select p_message_id, false, v_effect;
end;
$$;
revoke execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.post_conversation_message(uuid, uuid, text, uuid, uuid[]) to authenticated;

-- Item comments don't notify people who blocked the author (otherwise
-- identical to F09). A blocker who is mentioned reads as "no access".
create or replace function public.post_item_comment(
  p_comment_id   uuid,
  p_plan_item    uuid,
  p_body         text,
  p_mentions     uuid[]
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

  return query select p_comment_id, false, v_effect;
end;
$$;
revoke execute on function public.post_item_comment(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.post_item_comment(uuid, uuid, text, uuid[]) to authenticated;
