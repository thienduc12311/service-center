-- MOB-020: the app-icon badge is a per-device choice. Push messages carry the
-- badge number, so the server must know it: a device that turned the badge off
-- receives `badge: 0`, never a count it chose not to show.
--
-- Additive and backward compatible: a constant default is a metadata-only
-- change, and older app builds that do not send the field keep the badge on
-- (the behaviour they already had).

alter table public.device_push_tokens
  add column show_badge boolean not null default true;

comment on column public.device_push_tokens.show_badge is
  'Whether pushes to this device set the app-icon badge to the unread count (false sends 0). Set on each registration.';
