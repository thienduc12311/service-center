-- W7-MSG-D5: a recipient may change only the read state of their own
-- notifications.
--
-- `notifications_update` (20260907000000_notifications.sql) limits UPDATE to
-- the caller's own rows, but `authenticated` held table-wide UPDATE, so a
-- user could rewrite title, body, type and the target columns of their own
-- notifications through PostgREST. Column privileges close that: the only
-- client write is `read_at` (the API's mark-read and the apps' bell). Rows
-- are written by the service role and SECURITY DEFINER functions, which keep
-- their own privileges. Deleting your own notification (notifications_delete)
-- is unchanged.
--
-- `anon` never owns a notification; it loses UPDATE entirely.

revoke update on table public.notifications from anon, authenticated;
grant update (read_at) on table public.notifications to authenticated;
