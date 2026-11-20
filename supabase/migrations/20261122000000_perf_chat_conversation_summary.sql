-- Thread reads resolve a single conversation with the same metadata and
-- caller access as my_conversations, independently of the list's limit.
create function public.my_conversation(p_organization_id uuid, p_conversation_id uuid)
returns table (
  id uuid, kind text, team_id uuid, plan_id uuid, title text, service_date timestamptz,
  last_message_at timestamptz, unread_count int, muted boolean, can_moderate boolean, open_reports int
)
language sql stable security definer set search_path = '' as $$
  with target as materialized (
    select c.id, c.kind, c.team_id, c.plan_id, (select auth.uid()) as user_id,
           private.can_moderate_conversation((select auth.uid()), c.id) as can_moderate
      from public.conversations c
     where c.id = p_conversation_id
       and c.organization_id = p_organization_id
       and private.can_access_conversation((select auth.uid()), c.id)
  )
  select c.id, c.kind, c.team_id, c.plan_id,
         coalesce(t.name, p.title), p.service_date,
         stats.last_message_at, stats.unread_count,
         coalesce(s.muted, false), c.can_moderate,
         case when c.can_moderate
              then (select count(*)::int from public.conversation_message_reports r
                     where r.conversation_id = c.id and r.status = 'open')
              else 0 end
    from target c
    left join public.teams t on t.id = c.team_id
    left join public.plans p on p.id = c.plan_id
    left join public.conversation_member_states s on s.conversation_id = c.id and s.user_id = c.user_id
    cross join lateral (
      select max(m.created_at) as last_message_at,
             (count(*) filter (where m.author_id <> c.user_id
                               and m.deleted_at is null and m.hidden_at is null
                               and (s.last_read_at is null or m.created_at > s.last_read_at)))::int as unread_count
        from public.conversation_messages m
       where m.conversation_id = c.id
         and not private.has_blocked(c.user_id, m.author_id)
    ) stats;
$$;

revoke execute on function public.my_conversation(uuid, uuid) from public, anon, service_role;
grant execute on function public.my_conversation(uuid, uuid) to authenticated;
