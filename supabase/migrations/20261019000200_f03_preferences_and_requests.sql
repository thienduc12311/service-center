-- ============================================================================
-- F03 Pass B — scheduling preferences and availability freshness
--
-- Builds on MOB-006 (Person-scoped `blockouts`, `private.can_manage_blockout`).
--
-- Preferences (per Person, optionally per team; a team row overrides the
-- person's all-teams row for that team). Unset fields mean "no preference"
-- and never warn:
--   frequency        every_week / every_other_week / every_third_week:
--                    warn when another served plan falls within 6 / 13 / 20
--                    days of the candidate date; once_a_month: another served
--                    plan in the same calendar month.
--   max_per_month    warn when the person already serves that many distinct
--                    plans in the candidate's calendar month.
--   preferred_weeks / avoided_weeks   week of month, 1–5 (day 1–7 = week 1).
--   preferred_dates / avoided_dates   explicit dates (at most 60 each).
--   preferred_times  local start times of service times (organization zone).
-- "Served" counts distinct plans (never positions) the person holds a
-- non-declined assignment on — in the same team for a team preference, any
-- team otherwise. Prepared rows count only for schedulers who can see them.
-- Preference results are warnings. Blockouts remain hard conflicts.
--
-- Freshness: one review row per Person, refreshed when the Person changes
-- their own availability or affirms it is up to date. Availability requests
-- go to a scoped audience through the shared F00 outbox; a recipient's next
-- review completes their request.
-- ============================================================================

alter type public.delivery_template add value if not exists 'availability_request';
alter type public.notification_type add value if not exists 'availability_request';

-- Someone may schedule on this team (F01 scope), the question every
-- team-scoped availability action asks.
create or replace function private.can_schedule_team(p_user uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.capability_for(p_user, t.organization_id, 'scheduling.manage', t.service_type_id, t.id)
      from public.teams t where t.id = p_team
  ), false);
$$;
revoke execute on function private.can_schedule_team(uuid, uuid) from public, anon;
grant execute on function private.can_schedule_team(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------- preferences ---

create table public.scheduling_preferences (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  team_id          uuid references public.teams (id) on delete cascade,
  frequency        text check (frequency in ('every_week', 'every_other_week', 'every_third_week', 'once_a_month')),
  max_per_month    smallint check (max_per_month between 1 and 31),
  preferred_weeks  smallint[] not null default '{}',
  avoided_weeks    smallint[] not null default '{}',
  preferred_dates  date[] not null default '{}',
  avoided_dates    date[] not null default '{}',
  preferred_times  time[] not null default '{}',
  revision         int not null default 1 check (revision > 0),
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scheduling_preferences_weeks check (
    preferred_weeks <@ '{1,2,3,4,5}'::smallint[] and avoided_weeks <@ '{1,2,3,4,5}'::smallint[]
    and not (preferred_weeks && avoided_weeks)
  ),
  constraint scheduling_preferences_dates check (
    cardinality(preferred_dates) <= 60 and cardinality(avoided_dates) <= 60
    and not (preferred_dates && avoided_dates)
  ),
  constraint scheduling_preferences_times check (cardinality(preferred_times) <= 12),
  constraint scheduling_preferences_one_per_scope unique nulls not distinct (person_id, team_id)
);
create index scheduling_preferences_org_idx on public.scheduling_preferences (organization_id);
create index scheduling_preferences_team_idx on public.scheduling_preferences (team_id);
create index scheduling_preferences_updated_by_idx on public.scheduling_preferences (updated_by);

create or replace function private.prepare_scheduling_preference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.people p
                  where p.id = new.person_id and p.organization_id = new.organization_id) then
    raise exception 'Person does not belong to this organization' using errcode = '22023';
  end if;
  if new.team_id is not null and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.organization_id = new.organization_id
  ) then
    raise exception 'Team does not belong to this organization' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct w order by w), '{}') into new.preferred_weeks from unnest(new.preferred_weeks) w;
  select coalesce(array_agg(distinct w order by w), '{}') into new.avoided_weeks from unnest(new.avoided_weeks) w;
  select coalesce(array_agg(distinct d order by d), '{}') into new.preferred_dates from unnest(new.preferred_dates) d;
  select coalesce(array_agg(distinct d order by d), '{}') into new.avoided_dates from unnest(new.avoided_dates) d;
  select coalesce(array_agg(distinct t order by t), '{}') into new.preferred_times from unnest(new.preferred_times) t;
  new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' then
    new.organization_id := old.organization_id;
    new.person_id := old.person_id;
    new.team_id := old.team_id;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function private.prepare_scheduling_preference() from public, anon, authenticated;
create trigger scheduling_preferences_prepare
  before insert or update on public.scheduling_preferences
  for each row execute function private.prepare_scheduling_preference();

alter table public.scheduling_preferences enable row level security;
-- Readers: the Person, anyone who schedules (they act on it) and roster
-- managers. Writers: whoever may manage the Person's availability (self,
-- schedulers, and in Pass C an explicit delegate) or roster managers.
create policy scheduling_preferences_select on public.scheduling_preferences
  for select to authenticated using (
    private.can_manage_blockout(organization_id, person_id)
    or (select public.has_capability(organization_id, 'people.manage'))
  );
create policy scheduling_preferences_write on public.scheduling_preferences
  for all to authenticated
  using (
    private.can_manage_blockout(organization_id, person_id)
    or (select public.has_capability(organization_id, 'people.manage'))
  )
  with check (
    private.can_manage_blockout(organization_id, person_id)
    or (select public.has_capability(organization_id, 'people.manage'))
  );
grant select, insert, update, delete on public.scheduling_preferences to authenticated;
grant all on public.scheduling_preferences to service_role;

-- Overrides recorded when a scheduler proceeds despite preference warnings.
create table public.assignment_preference_overrides (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  assignment_id    uuid not null references public.assignments (id) on delete cascade,
  warning_codes    text[] not null check (cardinality(warning_codes) between 1 and 20),
  reason           text check (reason is null or char_length(reason) <= 500),
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now()
);
create index assignment_preference_overrides_assignment_idx on public.assignment_preference_overrides (assignment_id);
create index assignment_preference_overrides_org_idx on public.assignment_preference_overrides (organization_id);
create index assignment_preference_overrides_created_by_idx on public.assignment_preference_overrides (created_by);

alter table public.assignment_preference_overrides enable row level security;
create policy assignment_preference_overrides_select on public.assignment_preference_overrides
  for select to authenticated using (private.can_schedule_assignment((select auth.uid()), assignment_id));
create policy assignment_preference_overrides_insert on public.assignment_preference_overrides
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and private.can_schedule_assignment((select auth.uid()), assignment_id)
    and organization_id = (select p.organization_id from public.assignments a
                             join public.plans p on p.id = a.plan_id where a.id = assignment_id)
  );
grant select, insert on public.assignment_preference_overrides to authenticated;
grant all on public.assignment_preference_overrides to service_role;

-- ------------------------------------------------------------ freshness ---

create table public.person_availability_reviews (
  person_id        uuid primary key references public.people (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  reviewed_at      timestamptz not null default now(),
  kind             text not null check (kind in ('changed', 'affirmed')),
  reviewed_by      uuid references public.profiles (id) on delete set null
);
create index person_availability_reviews_org_idx on public.person_availability_reviews (organization_id);
create index person_availability_reviews_reviewed_by_idx on public.person_availability_reviews (reviewed_by);

alter table public.person_availability_reviews enable row level security;
create policy person_availability_reviews_select on public.person_availability_reviews
  for select to authenticated using (private.can_manage_blockout(organization_id, person_id));
grant select on public.person_availability_reviews to authenticated;
grant all on public.person_availability_reviews to service_role;

-- Who counts as the Person reviewing their own availability: the Person's
-- login. Pass C adds explicit availability delegates.
create or replace function private.is_availability_reviewer(p_user uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.people p where p.id = p_person and p.profile_id = p_user
  );
$$;
revoke execute on function private.is_availability_reviewer(uuid, uuid) from public, anon, authenticated;

create or replace function private.record_availability_review(p_person uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.people where id = p_person;
  if v_org is null then return; end if;
  insert into public.person_availability_reviews (person_id, organization_id, reviewed_at, kind, reviewed_by)
  values (p_person, v_org, now(), p_kind, (select auth.uid()))
  on conflict (person_id) do update
    set reviewed_at = excluded.reviewed_at, kind = excluded.kind, reviewed_by = excluded.reviewed_by;
  update public.availability_request_recipients
     set responded_at = now(), response_kind = p_kind
   where person_id = p_person and responded_at is null;
end;
$$;
revoke execute on function private.record_availability_review(uuid, text) from public, anon, authenticated;

-- A Person's own change to their blockouts counts as a review. A scheduler
-- recording a blockout for someone does not.
create or replace function private.blockout_review_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_person uuid := coalesce(new.person_id, old.person_id);
begin
  if private.is_availability_reviewer((select auth.uid()), v_person) then
    perform private.record_availability_review(v_person, 'changed');
  end if;
  return null;
end;
$$;
revoke execute on function private.blockout_review_touch() from public, anon, authenticated;

-- ----------------------------------------------- availability requests ----

create table public.availability_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  team_id          uuid references public.teams (id) on delete set null,
  message          text check (message is null or char_length(message) <= 1000),
  window_start     date not null,
  window_end       date not null,
  respond_by       date,
  recipient_count  int not null default 0 check (recipient_count >= 0),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint availability_requests_window check (window_end >= window_start and window_end - window_start <= 366),
  constraint availability_requests_key unique (organization_id, created_by, idempotency_key)
);
create index availability_requests_org_idx on public.availability_requests (organization_id, created_at desc);
create index availability_requests_team_idx on public.availability_requests (team_id);
create index availability_requests_created_by_idx on public.availability_requests (created_by);

create table public.availability_request_recipients (
  request_id       uuid not null references public.availability_requests (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  responded_at     timestamptz,
  response_kind    text check (response_kind in ('changed', 'affirmed')),
  primary key (request_id, person_id)
);
create index availability_request_recipients_person_idx
  on public.availability_request_recipients (person_id) where responded_at is null;
create index availability_request_recipients_person_all_idx on public.availability_request_recipients (person_id);
create index availability_request_recipients_org_idx on public.availability_request_recipients (organization_id);

alter table public.delivery_effects
  add column availability_request_id uuid references public.availability_requests (id) on delete cascade;
create index delivery_effects_availability_request_idx on public.delivery_effects (availability_request_id);

create trigger blockouts_review_touch
  after insert or update or delete on public.blockouts
  for each row execute function private.blockout_review_touch();

-- Visible to its author, administrators and anyone who schedules the team.
create or replace function private.can_read_availability_request(p_user uuid, p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.availability_requests r
     where r.id = p_request
       and (r.created_by = p_user
            or private.capability_for(p_user, r.organization_id, 'people.manage')
            or (r.team_id is not null and private.can_schedule_team(p_user, r.team_id)))
  );
$$;
revoke execute on function private.can_read_availability_request(uuid, uuid) from public, anon;
grant execute on function private.can_read_availability_request(uuid, uuid) to authenticated, service_role;

alter table public.availability_requests enable row level security;
alter table public.availability_request_recipients enable row level security;
create policy availability_requests_select on public.availability_requests
  for select to authenticated using (
    private.can_read_availability_request((select auth.uid()), id)
    or exists (select 1 from public.availability_request_recipients rr
                join public.people p on p.id = rr.person_id
               where rr.request_id = availability_requests.id and p.profile_id = (select auth.uid()))
  );
create policy availability_request_recipients_select on public.availability_request_recipients
  for select to authenticated using (
    private.can_read_availability_request((select auth.uid()), request_id)
    or exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid()))
  );
grant select on public.availability_requests, public.availability_request_recipients to authenticated;
grant all on public.availability_requests, public.availability_request_recipients to service_role;

-- Audience a scheduler may ask: active, non-archived members of a team they
-- schedule. Returns readiness booleans and freshness, never addresses.
create or replace function public.preview_availability_request(p_organization_id uuid, p_team_id uuid)
returns table (
  person_id uuid,
  first_name text,
  last_name text,
  has_login boolean,
  has_email boolean,
  reviewed_at timestamptz,
  review_kind text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.organization_id = p_organization_id)
     or not private.can_schedule_team((select auth.uid()), p_team_id) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  return query
  select distinct on (p.id) p.id, p.first_name, p.last_name, p.profile_id is not null,
         (p.email is not null or exists (select 1 from public.profiles pr where pr.id = p.profile_id and pr.email is not null)),
         r.reviewed_at, r.kind
    from public.team_memberships tm
    join public.people p on p.id = tm.person_id
    left join public.person_availability_reviews r on r.person_id = p.id
   where tm.team_id = p_team_id
     and p.archived_at is null
     and (p.profile_id is null or exists (
       select 1 from public.organization_members m
        where m.organization_id = p_organization_id and m.user_id = p.profile_id and m.status = 'active'))
   order by p.id;
end;
$$;
revoke execute on function public.preview_availability_request(uuid, uuid) from public, anon;
grant execute on function public.preview_availability_request(uuid, uuid) to authenticated;

-- One logical request: the request, its exact recipients and one outbox
-- effect, in one transaction. A replay with the same key returns the same
-- request; recipients outside the previewed audience refuse the whole call.
create or replace function public.create_availability_request(
  p_organization_id uuid,
  p_team_id uuid,
  p_person_ids uuid[],
  p_message text,
  p_window_start date,
  p_window_end date,
  p_respond_by date,
  p_idempotency_key text
)
returns table (request_id uuid, effect_id uuid, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_request public.availability_requests;
  v_effect uuid;
  v_count int;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_person_ids is null or cardinality(p_person_ids) = 0 or cardinality(p_person_ids) > 500 then
    raise exception 'Choose 1 to 500 people' using errcode = '22023';
  end if;
  -- Concurrent retries with one key wait here, then replay the first.
  perform pg_advisory_xact_lock(hashtextextended(
    'availability-request:' || p_organization_id || ':' || v_actor || ':' || p_idempotency_key, 0));

  select * into v_request from public.availability_requests
   where organization_id = p_organization_id and created_by = v_actor and idempotency_key = p_idempotency_key;
  if found then
    return query select v_request.id,
      (select e.id from public.delivery_effects e where e.availability_request_id = v_request.id limit 1), true;
    return;
  end if;

  select count(distinct ids.id) into v_count
    from unnest(p_person_ids) ids(id)
    join public.preview_availability_request(p_organization_id, p_team_id) a on a.person_id = ids.id;
  if v_count <> (select count(distinct id) from unnest(p_person_ids) id) then
    raise exception 'The team changed since the preview; review the recipients again'
      using errcode = 'PT409', detail = 'audience_changed';
  end if;

  insert into public.availability_requests (
    organization_id, team_id, message, window_start, window_end, respond_by,
    recipient_count, idempotency_key, created_by
  ) values (
    p_organization_id, p_team_id, nullif(btrim(p_message), ''), p_window_start, p_window_end, p_respond_by,
    v_count, p_idempotency_key, v_actor
  ) returning * into v_request;

  insert into public.availability_request_recipients (request_id, organization_id, person_id)
  select distinct v_request.id, p_organization_id, id from unnest(p_person_ids) id;

  insert into public.delivery_effects (
    organization_id, effect_key, template, availability_request_id, created_by
  ) values (
    p_organization_id, 'availability-request:' || v_request.id, 'availability_request', v_request.id, v_actor
  ) returning id into v_effect;

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select p_organization_id, v_effect, p.profile_id, p.id, c.channel
    from public.people p
    cross join lateral unnest(
      case when p.profile_id is null then array['email']::public.delivery_channel[]
           else array['in_app', 'push', 'email']::public.delivery_channel[] end
    ) c(channel)
   where p.id = any (p_person_ids);

  return query select v_request.id, v_effect, false;
end;
$$;
revoke execute on function public.create_availability_request(uuid, uuid, uuid[], text, date, date, date, text) from public, anon;
grant execute on function public.create_availability_request(uuid, uuid, uuid[], text, date, date, date, text) to authenticated;

-- "My availability is up to date": records a review without any blockout.
create or replace function public.affirm_availability(p_organization_id uuid, p_person_id uuid)
returns public.person_availability_reviews
language plpgsql security definer set search_path = '' as $$
declare v_row public.person_availability_reviews;
begin
  if not exists (select 1 from public.people p where p.id = p_person_id and p.organization_id = p_organization_id)
     or not public.is_org_member(p_organization_id)
     or not private.is_availability_reviewer((select auth.uid()), p_person_id) then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  perform private.record_availability_review(p_person_id, 'affirmed');
  select * into v_row from public.person_availability_reviews where person_id = p_person_id;
  return v_row;
end;
$$;
revoke execute on function public.affirm_availability(uuid, uuid) from public, anon;
grant execute on function public.affirm_availability(uuid, uuid) to authenticated;

-- ------------------------------------------------------------- warnings ---
-- Typed preference and freshness warnings for candidates on one plan/team.
-- Never includes blockout reasons or another person's private data.
create or replace function public.scheduling_preference_warnings(
  p_organization_id uuid,
  p_plan_id uuid,
  p_team_id uuid,
  p_person_ids uuid[],
  p_plan_time_ids uuid[] default null
)
returns table (person_id uuid, code text, detail text, preference_team_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_plan public.plans;
  v_tz text;
  v_week int;
  v_date date;
begin
  select * into v_plan from public.plans where id = p_plan_id and organization_id = p_organization_id;
  if v_plan.id is null then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if v_actor is not null and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check warnings' using errcode = '42501';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.organization_id = p_organization_id) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(p_person_ids) ids(id)
              where not exists (select 1 from public.people p where p.id = ids.id and p.organization_id = p_organization_id)) then
    raise exception 'Warning scope crosses organizations' using errcode = '22023';
  end if;
  select coalesce(o.timezone, 'UTC') into v_tz from public.organizations o where o.id = p_organization_id;
  v_date := (v_plan.service_date at time zone v_tz)::date;
  v_week := (extract(day from v_date)::int - 1) / 7 + 1;

  return query
  with prefs as (
    select distinct on (sp.person_id) sp.*
      from public.scheduling_preferences sp
     where sp.person_id = any (p_person_ids)
       and (sp.team_id is null or sp.team_id = p_team_id)
     order by sp.person_id, (sp.team_id is null)
  ), served as (
    select a.person_id, a.team_id, p.id plan_id, (p.service_date at time zone v_tz)::date service_date
      from public.assignments a
      join public.plans p on p.id = a.plan_id
     where p.organization_id = p_organization_id
       and a.person_id = any (p_person_ids)
       and a.status <> 'declined'
       and p.id <> v_plan.id
       and p.service_date between v_plan.service_date - interval '40 days' and v_plan.service_date + interval '40 days'
       and (a.visibility = 'released' or v_actor is null
            or private.can_schedule_on_plan(v_actor, a.plan_id, a.team_id))
  ), counted as (
    select pr.person_id, pr.team_id preference_team_id, pr.frequency, pr.max_per_month,
           count(distinct s.plan_id) filter (where s.service_date between v_date - 6 and v_date + 6) w1,
           count(distinct s.plan_id) filter (where s.service_date between v_date - 13 and v_date + 13) w2,
           count(distinct s.plan_id) filter (where s.service_date between v_date - 20 and v_date + 20) w3,
           count(distinct s.plan_id) filter (where date_trunc('month', s.service_date) = date_trunc('month', v_date)) m
      from prefs pr
      left join served s on s.person_id = pr.person_id and (pr.team_id is null or s.team_id = pr.team_id)
     group by pr.person_id, pr.team_id, pr.frequency, pr.max_per_month
  )
  select c.person_id, 'frequency'::text,
         case c.frequency
           when 'every_week' then 'Prefers serving at most once a week'
           when 'every_other_week' then 'Prefers serving every other week'
           when 'every_third_week' then 'Prefers serving every third week'
           else 'Prefers serving once a month' end,
         c.preference_team_id
    from counted c
   where (c.frequency = 'every_week' and c.w1 > 0)
      or (c.frequency = 'every_other_week' and c.w2 > 0)
      or (c.frequency = 'every_third_week' and c.w3 > 0)
      or (c.frequency = 'once_a_month' and c.m > 0)
  union all
  select c.person_id, 'monthly_max', 'Already serving ' || c.m || ' of at most ' || c.max_per_month || ' this month',
         c.preference_team_id
    from counted c where c.max_per_month is not null and c.m >= c.max_per_month
  union all
  select pr.person_id, 'avoided_date', 'Asked not to serve on this date', pr.team_id
    from prefs pr where v_date = any (pr.avoided_dates)
  union all
  select pr.person_id, 'avoided_week', 'Asked not to serve in week ' || v_week || ' of the month', pr.team_id
    from prefs pr where v_week = any (pr.avoided_weeks)
  union all
  select pr.person_id, 'outside_preferred_weeks', 'Prefers other weeks of the month', pr.team_id
    from prefs pr where cardinality(pr.preferred_weeks) > 0 and not (v_week = any (pr.preferred_weeks))
  union all
  select pr.person_id, 'outside_preferred_dates', 'Prefers other dates', pr.team_id
    from prefs pr where cardinality(pr.preferred_dates) > 0 and not (v_date = any (pr.preferred_dates))
  union all
  select pr.person_id, 'time_not_preferred', 'Prefers other service times', pr.team_id
    from prefs pr
   where cardinality(pr.preferred_times) > 0
     and exists (
       select 1 from public.plan_times pt
        where pt.plan_id = v_plan.id and pt.kind = 'service'
          and (p_plan_time_ids is null or pt.id = any (p_plan_time_ids))
          and not (((pt.starts_at at time zone v_tz)::time) = any (pr.preferred_times)))
  union all
  select ids.id, case when r.person_id is null then 'availability_unknown' else 'availability_stale' end,
         case when r.person_id is null then 'Has never reviewed their availability'
              else 'Availability last reviewed ' || to_char(r.reviewed_at at time zone v_tz, 'YYYY-MM-DD') end,
         null::uuid
    from unnest(p_person_ids) ids(id)
    left join public.person_availability_reviews r on r.person_id = ids.id
   where r.person_id is null or r.reviewed_at < now() - interval '90 days';
end;
$$;
revoke execute on function public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.scheduling_preference_warnings(uuid, uuid, uuid, uuid[], uuid[]) to authenticated, service_role;
