create table public.assignment_notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  plan_id          uuid not null references public.plans (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  email            text not null,
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  sent_at          timestamptz,
  responded_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint assignment_notifications_expiry_valid check (expires_at > created_at)
);

create unique index assignment_notifications_one_live
  on public.assignment_notifications (plan_id, user_id)
  where responded_at is null;
create index assignment_notifications_plan_idx on public.assignment_notifications (plan_id);
create index assignment_notifications_user_idx on public.assignment_notifications (user_id);

create table public.calendar_feed_tokens (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  token_hash       text not null unique,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
create unique index calendar_feed_tokens_one_live
  on public.calendar_feed_tokens (organization_id, user_id)
  where revoked_at is null;
create index calendar_feed_tokens_user_idx on public.calendar_feed_tokens (user_id);

alter table public.plan_times add column ics_sequence int not null default 0;

create or replace function public.bump_plan_time_ics_sequence()
returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    new.ics_sequence = old.ics_sequence + 1;
  end if;
  return new;
end;
$$;

create trigger plan_times_bump_ics_sequence
  before update on public.plan_times
  for each row execute function public.bump_plan_time_ics_sequence();

alter table public.assignment_notifications enable row level security;
alter table public.calendar_feed_tokens enable row level security;

create policy assignment_notifications_select on public.assignment_notifications
  for select using (public.can_manage_org(organization_id));

create policy calendar_feed_tokens_select on public.calendar_feed_tokens
  for select using (user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy calendar_feed_tokens_insert on public.calendar_feed_tokens
  for insert with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy calendar_feed_tokens_update on public.calendar_feed_tokens
  for update using (user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));
