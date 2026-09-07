-- ============================================================================
-- In-app notification centre + device push tokens
--
-- `notifications` is the feed behind the bell icon in the mobile app: one row
-- per recipient per event, written by the API with the service role (a manager
-- scheduling someone has no rights to insert a row owned by that person).
-- `device_push_tokens` holds the Expo push tokens a signed-in user's devices
-- have registered, so the same event can also be pushed to the phone.
-- ============================================================================

create type public.notification_type as enum (
  'assignment_scheduled',
  'assignment_reminder',
  'assignment_response',
  'plan_updated'
);

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- The recipient, not the actor.
  user_id          uuid not null references public.profiles (id) on delete cascade,
  type             public.notification_type not null,
  title            text not null,
  body             text,
  -- Where tapping the notification should take the reader. Both optional so a
  -- future notification kind that points nowhere still fits.
  plan_id          uuid references public.plans (id) on delete cascade,
  assignment_id    uuid references public.assignments (id) on delete cascade,
  read_at          timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint notifications_title_not_blank check (length(btrim(title)) > 0)
);

-- The feed query: one person's notifications in one org, newest first.
create index notifications_inbox_idx
  on public.notifications (user_id, organization_id, created_at desc);
-- The badge count only ever looks at unread rows, so keep that index small.
create index notifications_unread_idx
  on public.notifications (user_id, organization_id)
  where read_at is null;
create index notifications_plan_idx on public.notifications (plan_id);
create index notifications_assignment_idx on public.notifications (assignment_id);

create table public.device_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- An Expo push token identifies a device+app install, so it is globally
  -- unique: re-registering after a reinstall must move it to the new user.
  token         text not null unique,
  platform      text not null check (platform in ('ios', 'android', 'web')),
  device_name   text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index device_push_tokens_user_idx on public.device_push_tokens (user_id);

-- ------------------------------------------------------------------ rls ----
alter table public.notifications      enable row level security;
alter table public.device_push_tokens enable row level security;

-- A notification is private to its recipient. There is deliberately no insert
-- policy: only the service role writes rows.
create policy notifications_select on public.notifications
  for select using (
    user_id = (select auth.uid()) and public.is_org_member(organization_id)
  );
-- Marking as read is the only update a reader makes; the API never exposes the
-- other columns for update.
create policy notifications_update on public.notifications
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications
  for delete using (user_id = (select auth.uid()));

-- A device belongs to a person across every organization they are in, so these
-- rows are not org-scoped.
create policy device_push_tokens_select on public.device_push_tokens
  for select using (user_id = (select auth.uid()));
create policy device_push_tokens_insert on public.device_push_tokens
  for insert with check (user_id = (select auth.uid()));
create policy device_push_tokens_update on public.device_push_tokens
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy device_push_tokens_delete on public.device_push_tokens
  for delete using (user_id = (select auth.uid()));
