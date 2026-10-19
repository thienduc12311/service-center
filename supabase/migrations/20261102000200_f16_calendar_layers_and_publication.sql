-- F16 Pass C — scoped calendar feeds, opt-in personal-date layers, and
-- deliberate public plan / set-list publication.
--
-- Scoped feeds
-- * `calendar_scoped_feeds`: a subscriber's own service-type or team feed,
--   separate from the personal feed (`calendar_feed_tokens`, unchanged, keeps
--   its own rotation). The token is stored hashed. Every fetch re-checks the
--   subscriber's *current* access (`private.scoped_feed_access`): an inactive
--   membership, or a lost team role, makes the feed 404. Rotation = revoke and
--   create; revocation is immediate for future fetches. External calendar
--   clients decide when they poll.
-- * Content: released plan times only (service, and rehearsals if chosen).
--   Names of scheduled people appear only to a subscriber who schedules that
--   team. Layers (team feeds only): blockouts (schedulers of the team; never
--   the reason) and birthdays/anniversaries (people on the team who opted in;
--   month/day only, never the year).
--
-- Personal dates
-- * `person_calendar_sharing`: an explicit opt-in per Person. A birthdate or
--   anniversary on the profile alone never puts anything on a calendar. The
--   Person (or a roster manager, for no-login people) sets it.
--
-- Publication
-- * `plan_publications`: a plan editor publishes an allowlisted projection
--   (fields chosen from a fixed list that cannot include people, contacts,
--   notes, files or chat), now or from the start of the service day
--   (organization timezone), and can revoke it. The public slug is random.
-- * `public_set_list_links`: stable per-service-type "upcoming"/"most recent"
--   links resolving to the nearest *published, eligible* plan only.
-- * Public reads are done by the API with the service role through one
--   allowlisted projection; nobody reads these tables anonymously.

-- ====================================================== scoped feeds =====

create table public.calendar_scoped_feeds (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  scope_type          text not null,
  service_type_id     uuid,
  team_id             uuid,
  include_rehearsals  boolean not null default true,
  layers              text[] not null default '{}',
  label               text,
  token_hash          text not null unique,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  constraint calendar_scoped_feeds_member_fk foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id) on delete cascade,
  constraint calendar_scoped_feeds_service_type_fk foreign key (service_type_id, organization_id)
    references public.service_types (id, organization_id) on delete cascade,
  constraint calendar_scoped_feeds_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade,
  constraint calendar_scoped_feeds_scope check (
    (scope_type = 'service_type' and service_type_id is not null and team_id is null)
    or (scope_type = 'team' and team_id is not null and service_type_id is null)
  ),
  constraint calendar_scoped_feeds_layers check (
    layers <@ array['blockouts', 'birthdays', 'anniversaries']::text[]
    and (scope_type = 'team' or cardinality(layers) = 0)
  ),
  constraint calendar_scoped_feeds_label check (label is null or char_length(label) <= 80)
);

create index calendar_scoped_feeds_user_idx on public.calendar_scoped_feeds (organization_id, user_id) where revoked_at is null;
create index calendar_scoped_feeds_service_type_idx on public.calendar_scoped_feeds (service_type_id);
create index calendar_scoped_feeds_team_idx on public.calendar_scoped_feeds (team_id);

comment on table public.calendar_scoped_feeds is
  'F16: a subscriber''s service-type or team calendar feed. Access is re-checked on every fetch.';

-- Whether the user may currently read a scoped feed, and what it may show.
-- Returns null when the feed must not be served at all.
create or replace function private.scoped_feed_access(p_user uuid, p_org uuid, p_scope text, p_service_type uuid, p_team uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.is_active_member(p_user, p_org) then null
    when p_scope = 'service_type' then
      case when exists (select 1 from public.service_types st where st.id = p_service_type and st.organization_id = p_org)
           then jsonb_build_object('names', false, 'blockouts', false, 'personal_dates', false)
      end
    when p_scope = 'team' then (
      select case
        when private.capability_for(p_user, p_org, 'scheduling.manage', t.service_type_id, t.id)
          then jsonb_build_object('names', true, 'blockouts', true, 'personal_dates', true)
        when private.is_on_team(p_user, t.id)
          then jsonb_build_object('names', false, 'blockouts', false, 'personal_dates', true)
      end
        from public.teams t where t.id = p_team and t.organization_id = p_org)
  end;
$$;
revoke execute on function private.scoped_feed_access(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function private.scoped_feed_access(uuid, uuid, text, uuid, uuid) to authenticated, service_role;

alter table public.calendar_scoped_feeds enable row level security;

create policy calendar_scoped_feeds_select on public.calendar_scoped_feeds
  for select to authenticated using (user_id = (select auth.uid()));
create policy calendar_scoped_feeds_insert on public.calendar_scoped_feeds
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and revoked_at is null
    and (select private.scoped_feed_access((select auth.uid()), organization_id, scope_type, service_type_id, team_id)) is not null
  );
-- Only revocation is an update; scope and token never change in place.
create policy calendar_scoped_feeds_update on public.calendar_scoped_feeds
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and revoked_at is not null);

revoke all on public.calendar_scoped_feeds from anon;
revoke update, delete, truncate on public.calendar_scoped_feeds from authenticated;
grant select, insert on public.calendar_scoped_feeds to authenticated;
grant update (revoked_at) on public.calendar_scoped_feeds to authenticated;
grant all on public.calendar_scoped_feeds to service_role;

-- ============================================== personal-date opt-in =====

create table public.person_calendar_sharing (
  person_id          uuid primary key,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  share_birthday     boolean not null default false,
  share_anniversary  boolean not null default false,
  updated_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now(),
  constraint person_calendar_sharing_person_fk foreign key (person_id, organization_id)
    references public.people (id, organization_id) on delete cascade
);
create index person_calendar_sharing_org_idx on public.person_calendar_sharing (organization_id);
create index person_calendar_sharing_updated_by_idx on public.person_calendar_sharing (updated_by);

comment on table public.person_calendar_sharing is
  'F16: explicit opt-in to show a Person''s birthday / anniversary (month and day only) on team calendars.';

create or replace function private.can_set_calendar_sharing(p_user uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.people pe
     where pe.id = p_person
       and (pe.profile_id = p_user
            or private.capability_for(p_user, pe.organization_id, 'people.manage', null, null)));
$$;
revoke execute on function private.can_set_calendar_sharing(uuid, uuid) from public, anon;
grant execute on function private.can_set_calendar_sharing(uuid, uuid) to authenticated, service_role;

alter table public.person_calendar_sharing enable row level security;

create policy person_calendar_sharing_select on public.person_calendar_sharing
  for select to authenticated
  using ((select private.can_set_calendar_sharing((select auth.uid()), person_id)));
create policy person_calendar_sharing_insert on public.person_calendar_sharing
  for insert to authenticated
  with check ((select private.can_set_calendar_sharing((select auth.uid()), person_id)) and updated_by = (select auth.uid()));
create policy person_calendar_sharing_update on public.person_calendar_sharing
  for update to authenticated
  using ((select private.can_set_calendar_sharing((select auth.uid()), person_id)))
  with check ((select private.can_set_calendar_sharing((select auth.uid()), person_id)) and updated_by = (select auth.uid()));

revoke all on public.person_calendar_sharing from anon;
revoke delete, truncate on public.person_calendar_sharing from authenticated;
grant select, insert, update on public.person_calendar_sharing to authenticated;
grant all on public.person_calendar_sharing to service_role;

-- ======================================================= layer events =====

-- Opt-in personal dates and blockouts of the people on one team, for a user
-- whose current access allows each layer. Bounded to 400 days. Blockout
-- reasons are never returned. Birthdays/anniversaries carry month/day only;
-- 29 February falls on 28 February in other years.
create or replace function private.team_calendar_layers(
  p_user uuid, p_team uuid, p_from date, p_to date, p_layers text[]
)
returns table (
  layer       text,
  source_id   uuid,
  person_id   uuid,
  person_name text,
  on_date     date,
  starts_at   timestamptz,
  ends_at     timestamptz,
  all_day     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_access jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a range of at most 400 days' using errcode = '22023';
  end if;
  select t.organization_id into v_org from public.teams t where t.id = p_team;
  if v_org is null then
    return;
  end if;
  v_access := private.scoped_feed_access(p_user, v_org, 'team', null, p_team);
  if v_access is null then
    return;
  end if;

  if 'blockouts' = any(p_layers) and (v_access ->> 'blockouts')::boolean then
    return query
      select 'blockouts'::text, b.id, pe.id,
             btrim(pe.first_name || ' ' || coalesce(pe.last_name, '')),
             null::date, b.starts_at, b.ends_at, b.all_day
        from public.blockouts b
        join public.people pe on pe.id = b.person_id and pe.archived_at is null
       where b.organization_id = v_org
         and exists (select 1 from public.team_memberships tm where tm.team_id = p_team and tm.person_id = pe.id)
         and b.starts_at < (p_to + 1)::timestamptz + interval '1 day'
         and b.ends_at > p_from::timestamptz - interval '1 day'
       order by b.starts_at
       limit 2000;
  end if;

  if (v_access ->> 'personal_dates')::boolean
     and ('birthdays' = any(p_layers) or 'anniversaries' = any(p_layers)) then
    return query
      with candidates as (
        select pe.id, btrim(pe.first_name || ' ' || coalesce(pe.last_name, '')) as name,
               'birthdays'::text as layer, pe.birthdate as d
          from public.people pe
          join public.person_calendar_sharing s on s.person_id = pe.id and s.share_birthday
         where pe.organization_id = v_org and pe.archived_at is null and pe.birthdate is not null
           and 'birthdays' = any(p_layers)
           and exists (select 1 from public.team_memberships tm where tm.team_id = p_team and tm.person_id = pe.id)
        union all
        select pe.id, btrim(pe.first_name || ' ' || coalesce(pe.last_name, '')),
               'anniversaries', pe.anniversary_date
          from public.people pe
          join public.person_calendar_sharing s on s.person_id = pe.id and s.share_anniversary
         where pe.organization_id = v_org and pe.archived_at is null and pe.anniversary_date is not null
           and 'anniversaries' = any(p_layers)
           and exists (select 1 from public.team_memberships tm where tm.team_id = p_team and tm.person_id = pe.id)
      ), occurrences as (
        select c.layer, c.id, c.name,
               make_date(y, extract(month from c.d)::int,
                 least(extract(day from c.d)::int,
                       extract(day from (make_date(y, extract(month from c.d)::int, 1) + interval '1 month' - interval '1 day'))::int)) as on_date
          from candidates c
         cross join generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y
      )
      select o.layer, null::uuid, o.id, o.name, o.on_date, null::timestamptz, null::timestamptz, true
        from occurrences o
       where o.on_date between p_from and p_to
       order by o.on_date, o.name
       limit 2000;
  end if;
end;
$$;
revoke execute on function private.team_calendar_layers(uuid, uuid, date, date, text[]) from public, anon, authenticated;
grant execute on function private.team_calendar_layers(uuid, uuid, date, date, text[]) to service_role;

-- Caller-bound wrapper for the signed-in calendar.
create or replace function public.team_calendar_layers(p_team uuid, p_from date, p_to date, p_layers text[])
returns table (
  layer       text,
  source_id   uuid,
  person_id   uuid,
  person_name text,
  on_date     date,
  starts_at   timestamptz,
  ends_at     timestamptz,
  all_day     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.team_calendar_layers((select auth.uid()), p_team, p_from, p_to, p_layers);
$$;
revoke execute on function public.team_calendar_layers(uuid, date, date, text[]) from public, anon;
grant execute on function public.team_calendar_layers(uuid, date, date, text[]) to authenticated, service_role;

-- ======================================================= publication =====

create or replace function private.public_slug()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;
revoke execute on function private.public_slug() from public, anon, authenticated;
grant execute on function private.public_slug() to service_role;

create table public.plan_publications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  plan_id          uuid not null unique,
  slug             text not null unique default private.public_slug(),
  fields           text[] not null default array['title', 'date', 'times', 'songs']::text[],
  publish_mode     text not null default 'now',
  published_at     timestamptz not null default now(),
  revoked_at       timestamptz,
  revision         bigint not null default 1,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint plan_publications_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint plan_publications_fields check (
    cardinality(fields) between 1 and 10
    and fields <@ array['title', 'date', 'times', 'location', 'service_type', 'order', 'item_lengths', 'songs', 'song_authors', 'song_keys']::text[]
  ),
  constraint plan_publications_mode check (publish_mode in ('now', 'service_day'))
);
create index plan_publications_org_idx on public.plan_publications (organization_id);
create index plan_publications_created_by_idx on public.plan_publications (created_by);
create index plan_publications_updated_by_idx on public.plan_publications (updated_by);

comment on table public.plan_publications is
  'F16: a deliberately published, allowlisted public projection of one plan. People, contacts, notes, files and chat cannot be selected.';

create table public.public_set_list_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  service_type_id  uuid not null,
  kind             text not null,
  slug             text not null unique default private.public_slug(),
  revoked_at       timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint public_set_list_links_service_type_fk foreign key (service_type_id, organization_id)
    references public.service_types (id, organization_id) on delete cascade,
  constraint public_set_list_links_kind check (kind in ('upcoming', 'recent'))
);
create unique index public_set_list_links_one_live on public.public_set_list_links (service_type_id, kind) where revoked_at is null;
create index public_set_list_links_org_idx on public.public_set_list_links (organization_id);
create index public_set_list_links_created_by_idx on public.public_set_list_links (created_by);

comment on table public.public_set_list_links is
  'F16: stable public links to the nearest upcoming / most recent published plan of one service type.';

create or replace function private.can_publish_plan(p_user uuid, p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit_plan(p_user, p_plan);
$$;
revoke execute on function private.can_publish_plan(uuid, uuid) from public, anon;
grant execute on function private.can_publish_plan(uuid, uuid) to authenticated, service_role;

alter table public.plan_publications enable row level security;
alter table public.public_set_list_links enable row level security;

create policy plan_publications_select on public.plan_publications
  for select to authenticated using ((select private.can_publish_plan((select auth.uid()), plan_id)));
create policy public_set_list_links_select on public.public_set_list_links
  for select to authenticated
  using ((select public.has_capability(organization_id, 'plans.edit', service_type_id)));

revoke all on public.plan_publications, public.public_set_list_links from anon;
revoke insert, update, delete, truncate on public.plan_publications, public.public_set_list_links from authenticated;
grant select on public.plan_publications, public.public_set_list_links to authenticated;
grant all on public.plan_publications, public.public_set_list_links to service_role;

-- Publish (or change) with the revision you saw (0 = not published yet).
-- Re-publishing a revoked publication keeps its slug unless p_new_slug.
create or replace function public.publish_plan(
  p_plan uuid,
  p_fields text[],
  p_mode text,
  p_expected_revision bigint,
  p_new_slug boolean default false
)
returns public.plan_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_org  uuid;
  v_row  public.plan_publications%rowtype;
begin
  select p.organization_id into v_org from public.plans p where p.id = p_plan for update;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if not private.can_publish_plan(v_user, p_plan) then
    raise exception 'You cannot publish this plan' using errcode = '42501';
  end if;
  select * into v_row from public.plan_publications where plan_id = p_plan for update;
  if not found then
    if p_expected_revision <> 0 then
      raise exception 'The publication changed since you loaded it' using errcode = 'PT409', hint = 'publication_changed';
    end if;
    insert into public.plan_publications (organization_id, plan_id, fields, publish_mode, created_by, updated_by)
    values (v_org, p_plan, (select array_agg(distinct f order by f) from unnest(p_fields) f), p_mode, v_user, v_user)
    returning * into v_row;
    return v_row;
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception 'The publication changed since you loaded it' using errcode = 'PT409', hint = 'publication_changed';
  end if;
  update public.plan_publications
     set fields = (select array_agg(distinct f order by f) from unnest(p_fields) f),
         publish_mode = p_mode,
         published_at = case when revoked_at is not null then now() else published_at end,
         revoked_at = null,
         slug = case when p_new_slug then private.public_slug() else slug end,
         revision = revision + 1,
         updated_by = v_user,
         updated_at = now()
   where id = v_row.id
   returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.publish_plan(uuid, text[], text, bigint, boolean) from public, anon;
grant execute on function public.publish_plan(uuid, text[], text, bigint, boolean) to authenticated, service_role;

create or replace function public.revoke_plan_publication(p_plan uuid, p_expected_revision bigint)
returns public.plan_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plan_publications%rowtype;
begin
  if not private.can_publish_plan((select auth.uid()), p_plan) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select * into v_row from public.plan_publications where plan_id = p_plan for update;
  if not found then
    raise exception 'This plan is not published' using errcode = 'P0002';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception 'The publication changed since you loaded it' using errcode = 'PT409', hint = 'publication_changed';
  end if;
  update public.plan_publications
     set revoked_at = now(), revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
   where id = v_row.id
   returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.revoke_plan_publication(uuid, bigint) from public, anon;
grant execute on function public.revoke_plan_publication(uuid, bigint) to authenticated, service_role;

-- Create (or rotate) the stable link of one kind; revoking leaves no live link.
create or replace function public.set_public_set_list_link(p_service_type uuid, p_kind text, p_action text)
returns public.public_set_list_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.public_set_list_links%rowtype;
begin
  select st.organization_id into v_org from public.service_types st where st.id = p_service_type;
  if v_org is null or not public.has_capability(v_org, 'plans.edit', p_service_type) then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  if p_kind not in ('upcoming', 'recent') or p_action not in ('create', 'rotate', 'revoke') then
    raise exception 'Unknown link kind or action' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public_set_list_link:' || p_service_type::text || ':' || p_kind, 0));
  select * into v_row from public.public_set_list_links
   where service_type_id = p_service_type and kind = p_kind and revoked_at is null;
  if found and p_action = 'create' then
    return v_row;
  end if;
  if found then
    update public.public_set_list_links set revoked_at = now() where id = v_row.id returning * into v_row;
  end if;
  if p_action = 'revoke' then
    return v_row;
  end if;
  insert into public.public_set_list_links (organization_id, service_type_id, kind, created_by)
  values (v_org, p_service_type, p_kind, (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.set_public_set_list_link(uuid, text, text) from public, anon;
grant execute on function public.set_public_set_list_link(uuid, text, text) to authenticated, service_role;

-- ============================================ service-role feed access =====
-- The public `.ics` endpoint has no signed-in user: it resolves the token's
-- owner and asks with that user explicitly. Service role only.

create or replace function public.scoped_feed_access_for(
  p_user uuid, p_org uuid, p_scope text, p_service_type uuid, p_team uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.scoped_feed_access(p_user, p_org, p_scope, p_service_type, p_team);
$$;
revoke execute on function public.scoped_feed_access_for(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.scoped_feed_access_for(uuid, uuid, text, uuid, uuid) to service_role;

create or replace function public.team_calendar_layers_for(
  p_user uuid, p_team uuid, p_from date, p_to date, p_layers text[]
)
returns table (
  layer       text,
  source_id   uuid,
  person_id   uuid,
  person_name text,
  on_date     date,
  starts_at   timestamptz,
  ends_at     timestamptz,
  all_day     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.team_calendar_layers(p_user, p_team, p_from, p_to, p_layers);
$$;
revoke execute on function public.team_calendar_layers_for(uuid, uuid, date, date, text[]) from public, anon, authenticated;
grant execute on function public.team_calendar_layers_for(uuid, uuid, date, date, text[]) to service_role;

create or replace function public.can_set_person_calendar_sharing(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_set_calendar_sharing((select auth.uid()), p_person);
$$;
revoke execute on function public.can_set_person_calendar_sharing(uuid) from public, anon;
grant execute on function public.can_set_person_calendar_sharing(uuid) to authenticated, service_role;
