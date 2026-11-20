-- Performance follow-up to 20261126000001 (W7-MSG-D4).
--
-- `notifications_select` called private.can_access_conversation() once per
-- notification row that has a conversation_id. Measured locally: ~0.2 ms per
-- row, so a user with 99 conversation notifications paid ~25 ms on every feed
-- page and unread count, growing with the inbox size.
--
-- Same rule, evaluated once per statement: a security-definer helper lists the
-- caller's notification conversations they can no longer open (normally an
-- empty array), checking each distinct conversation once. Measured on the same user
-- (99 conversation notifications, 2 conversations): unread count 22 ms -> 2.8 ms,
-- feed page 21 ms -> 1.2 ms. The policy wraps it
-- in a scalar subquery so Postgres runs it as an initplan.
--
-- The helper only ever inspects the calling user's own notifications, so it
-- reveals nothing beyond what the caller could already see.

create or replace function private.my_inaccessible_notification_conversations()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  -- MATERIALIZED keeps the planner from pushing the access check below the
  -- DISTINCT, which would run it once per notification row again.
  with conversation_ids as materialized (
    select distinct n.conversation_id
      from public.notifications n
     where n.user_id = (select auth.uid())
       and n.conversation_id is not null
  )
  select coalesce(array_agg(c.conversation_id), '{}'::uuid[])
    from conversation_ids c
   where not private.can_access_conversation((select auth.uid()), c.conversation_id);
$$;

revoke execute on function private.my_inaccessible_notification_conversations() from public, anon;
grant execute on function private.my_inaccessible_notification_conversations() to authenticated;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (
    user_id = (select auth.uid())
    and public.is_org_member(organization_id)
    and (conversation_id is null
         or not (conversation_id = any (coalesce((select private.my_inaccessible_notification_conversations()), '{}'::uuid[])))));
