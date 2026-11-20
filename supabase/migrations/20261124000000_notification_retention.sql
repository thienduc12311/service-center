-- Notification clean-up.
--
-- Users can already delete their own notifications (`notifications_delete`
-- policy). This adds the automatic retention the scheduled worker runs: read
-- notifications older than `p_read_days` and unread ones older than
-- `p_unread_days` are removed, oldest first, in bounded batches so a single
-- run never holds locks on a large slice of the table.
--
-- A notification is only a per-recipient pointer; the assignment, message or
-- conversation it points at lives in its own table and is untouched.

-- The retention scan reads across every recipient by age, which the
-- per-recipient inbox index cannot serve.
create index notifications_created_at_idx on public.notifications (created_at);

create or replace function public.prune_notifications(
  p_read_days int default 90,
  p_unread_days int default 180,
  p_limit int default 1000
)
returns int
language sql
security definer
set search_path = ''
as $$
  with old as (
    select n.id from public.notifications n
     where (n.read_at is not null and n.created_at < now() - make_interval(days => greatest(1, p_read_days)))
        or (n.read_at is null and n.created_at < now() - make_interval(days => greatest(1, p_unread_days)))
     order by n.created_at
     limit greatest(1, least(p_limit, 5000))
  ), gone as (
    delete from public.notifications n using old where n.id = old.id returning 1
  )
  select count(*)::int from gone;
$$;

comment on function public.prune_notifications(int, int, int) is
  'Deletes read notifications older than p_read_days and unread ones older than p_unread_days, at most p_limit per call. Service role only.';

revoke execute on function public.prune_notifications(int, int, int) from public, anon, authenticated;
grant execute on function public.prune_notifications(int, int, int) to service_role;
