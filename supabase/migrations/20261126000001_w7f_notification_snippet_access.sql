-- W7-MSG-D4 / W3-MSG-D9: notification snippets must not outlive the message
-- or the recipient's access to it.
--
-- `notifications.body` holds an excerpt of the chat message. It survived (A)
-- the recipient losing access to the conversation (team roster removal, plan
-- unscheduling), (B) the author deleting the message and (C) a moderator
-- hiding it.
--
-- Decision (kept cheap for the feed):
--   * Content removal (B, C) is handled once, at write time: a trigger on
--     conversation_messages nulls `body` on every notification derived from
--     the message when it is soft-deleted, hidden, or hard-deleted. Links from
--     a notification to its message go through the dedupe key
--     `<delivery_effects.id>:<person id>` and the effect's
--     conversation_message_id (indexed), so no new column is needed. The
--     title (author and place) stays; the row remains markable/deletable and
--     is still pruned by prune_notifications. Restoring a hidden message does
--     not bring the excerpt back (the notification is a one-off snapshot).
--   * Access loss (A) cannot be a write-time cleanup (too many paths grant or
--     revoke access), so it is enforced on read: `notifications_select` hides
--     a conversation notification from a user who cannot currently open the
--     conversation. Doing it in the policy covers the API feed, unread
--     counts, direct PostgREST reads and Realtime alike; the predicate only
--     runs for rows with a conversation_id, and the feed is bounded by the
--     retention prune. If access is regained the notification reappears.
--   * Mark-read and delete-own stay intact for visible rows; hidden rows are
--     left to the service-role retention prune.
--
-- Existing rows are backfilled by the same rule.

create index if not exists notifications_conversation_idx
  on public.notifications (conversation_id) where conversation_id is not null;

create or replace function private.redact_message_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and not (
       (new.deleted_at is not null and old.deleted_at is null)
    or (new.hidden_at is not null and old.hidden_at is null)) then
    return new;
  end if;
  update public.notifications n set body = null
   where n.conversation_id = old.conversation_id
     and n.body is not null
     and exists (
       select 1 from public.delivery_effects e
        where e.conversation_message_id = old.id
          and n.dedupe_key like e.id::text || ':%');
  return coalesce(new, old);
end;
$$;
revoke execute on function private.redact_message_notifications() from public, anon, authenticated;

create trigger conversation_messages_redact_notifications
  after update of deleted_at, hidden_at on public.conversation_messages
  for each row execute function private.redact_message_notifications();
create trigger conversation_messages_redact_notifications_delete
  before delete on public.conversation_messages
  for each row execute function private.redact_message_notifications();

-- Backfill: messages already deleted or hidden.
update public.notifications n set body = null
 where n.body is not null and n.conversation_id is not null
   and exists (
     select 1 from public.delivery_effects e
       join public.conversation_messages m on m.id = e.conversation_message_id
      where n.dedupe_key like e.id::text || ':%'
        and (m.deleted_at is not null or m.hidden_at is not null));

drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (
    user_id = (select auth.uid())
    and public.is_org_member(organization_id)
    and (conversation_id is null
         or private.can_access_conversation((select auth.uid()), conversation_id)));
