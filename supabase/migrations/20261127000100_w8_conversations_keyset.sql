-- W8-PERF-D3: public.my_conversations silently stops at 100 rows, so a member
-- of more than 100 conversations can never reach the rest. The list is now
-- keyset-paged. my_conversations(uuid) keeps its signature and behaviour; the
-- API calls the paged variant below.
--
-- Sort key (unchanged from my_conversations, plus id as the final tiebreaker so
-- the order is total):
--   coalesce(last_message_at, '-infinity') desc, created_at desc, id desc
-- The cursor is that triple of the last row shown. `p_after_id is null` means
-- "first page". Returns created_at so the caller can build the next cursor.
-- Access is decided exactly as before by private.can_access_conversation;
-- the function is security definer with an empty search_path.

create or replace function public.my_conversations_page(
  p_organization_id  uuid,
  p_limit            int default 50,
  p_after_last       timestamptz default null,
  p_after_created    timestamptz default null,
  p_after_id         uuid default null
)
returns table (
  id uuid, kind text, team_id uuid, plan_id uuid, title text, service_date timestamptz,
  last_message_at timestamptz, unread_count int, muted boolean, can_moderate boolean, open_reports int,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select c.id, c.kind, c.team_id, c.plan_id, c.created_at,
           coalesce(t.name, p.title) as title, p.service_date, s.last_read_at, s.muted
      from public.conversations c
      left join public.teams t on t.id = c.team_id
      left join public.plans p on p.id = c.plan_id
      left join public.conversation_member_states s
             on s.conversation_id = c.id and s.user_id = (select auth.uid())
     where c.organization_id = p_organization_id
       and private.can_access_conversation((select auth.uid()), c.id)
  ), keyed as (
    select m.*,
           (select max(x.created_at) from public.conversation_messages x
             where x.conversation_id = m.id
               and not private.has_blocked((select auth.uid()), x.author_id)) as last_message_at
      from mine m
  )
  select k.id, k.kind, k.team_id, k.plan_id, k.title, k.service_date,
         k.last_message_at,
         (select count(*)::int from public.conversation_messages x
           where x.conversation_id = k.id and x.author_id <> (select auth.uid())
             and x.deleted_at is null and x.hidden_at is null
             and (k.last_read_at is null or x.created_at > k.last_read_at)
             and not private.has_blocked((select auth.uid()), x.author_id)),
         coalesce(k.muted, false),
         private.can_moderate_conversation((select auth.uid()), k.id),
         case when private.can_moderate_conversation((select auth.uid()), k.id)
              then (select count(*)::int from public.conversation_message_reports r
                     where r.conversation_id = k.id and r.status = 'open')
              else 0 end,
         k.created_at
    from keyed k
   where p_after_id is null
      or (coalesce(k.last_message_at, '-infinity'::timestamptz), k.created_at, k.id)
         < (coalesce(p_after_last, '-infinity'::timestamptz), p_after_created, p_after_id)
   order by coalesce(k.last_message_at, '-infinity'::timestamptz) desc, k.created_at desc, k.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 101);
$$;

revoke execute on function public.my_conversations_page(uuid, int, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.my_conversations_page(uuid, int, timestamptz, timestamptz, uuid) to authenticated;
