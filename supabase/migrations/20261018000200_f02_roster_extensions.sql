-- F02 Pass C — roster extensions: reversible archive, audit, tag groups and
-- previewed bulk changes.
--
-- Archive
--   `archived_at` hides a Person from candidate pickers and new staffing
--   while keeping every historical assignment, answer and link exactly as it
--   was. Restoring clears it; nothing is recreated. Archive is distinct from
--   deletion (which is refused while history exists).
--
-- Audit
--   `person_roster_events` records who created, archived, restored, linked,
--   tagged or moved a Person between teams. Rows are written only by
--   triggers and readable only with people.view_private / people.manage.
--
-- Tag groups
--   Tags stay free text on `person_tags` (F01). `person_tag_catalog` may put
--   a tag in a named `person_tag_groups` group ("Instruments", "Languages").
--
-- Bulk changes
--   `preview_roster_bulk_change` reports, per person, whether a tag/team
--   change would apply, is already true, or cannot be made (and why);
--   `apply_roster_bulk_change` recomputes it, refuses if anything changed
--   since the preview or any row has a problem, and applies all rows in one
--   transaction under an idempotency key.

-- ============================================================ archive =====

alter table public.people
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null;
create index people_archived_by_idx on public.people (archived_by);
create index people_org_active_idx on public.people (organization_id) where archived_at is null;

grant select (archived_at, archived_by) on public.people to authenticated;

-- Archive bookkeeping is stamped, never supplied.
create or replace function private.stamp_person_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at then
    new.archived_by := case when new.archived_at is null then null else (select auth.uid()) end;
  elsif new.archived_by is distinct from old.archived_by then
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;
revoke execute on function private.stamp_person_archive() from public, anon, authenticated;

create trigger people_stamp_archive
  before update on public.people
  for each row execute function private.stamp_person_archive();

-- The member-visible projection gains the archive marker (appended column).
create or replace view public.people_directory
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.campus, p.person_type, p.created_at, p.updated_at,
         p.archived_at
    from public.people p
   where public.is_org_member(p.organization_id);

-- ============================================================== audit =====

create table public.person_roster_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Kept (as null) when the Person is later deleted; the label remains.
  person_id        uuid references public.people (id) on delete set null,
  person_label     text not null,
  action           text not null check (action in (
                     'created', 'archived', 'restored', 'linked', 'unlinked',
                     'tag_added', 'tag_removed', 'team_added', 'team_removed')),
  -- Small and non-private: tag text, team/position ids. Never contact data.
  detail           jsonb not null default '{}'::jsonb,
  actor_id         uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index person_roster_events_org_created_idx on public.person_roster_events (organization_id, created_at desc);
create index person_roster_events_person_idx on public.person_roster_events (person_id, created_at desc);
create index person_roster_events_actor_idx on public.person_roster_events (actor_id);

alter table public.person_roster_events enable row level security;
create policy person_roster_events_select on public.person_roster_events
  for select to authenticated using (
    (select public.has_capability(organization_id, 'people.view_private'))
    or (select public.has_capability(organization_id, 'people.manage'))
  );
revoke insert, update, delete, truncate on public.person_roster_events from anon, authenticated;

create or replace function private.log_roster_event(
  p_org    uuid,
  p_person uuid,
  p_action text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  -- Nothing to record while the organization itself is being deleted.
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    return;
  end if;
  select btrim(concat_ws(' ', p.first_name, p.last_name)) into v_label from public.people p where p.id = p_person;
  insert into public.person_roster_events (organization_id, person_id, person_label, action, detail, actor_id)
  values (
    p_org,
    case when exists (select 1 from public.people p where p.id = p_person) then p_person end,
    coalesce(nullif(v_label, ''), 'Removed person'),
    p_action, coalesce(p_detail, '{}'::jsonb), (select auth.uid())
  );
end;
$$;
revoke execute on function private.log_roster_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.audit_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_roster_event(new.organization_id, new.id, 'created');
    return null;
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform private.log_roster_event(new.organization_id, new.id,
      case when new.archived_at is null then 'restored' else 'archived' end);
  end if;
  if new.profile_id is distinct from old.profile_id then
    perform private.log_roster_event(new.organization_id, new.id,
      case when new.profile_id is null then 'unlinked' else 'linked' end);
  end if;
  return null;
end;
$$;
revoke execute on function private.audit_people() from public, anon, authenticated;

create trigger people_audit
  after insert or update of archived_at, profile_id on public.people
  for each row execute function private.audit_people();

create or replace function private.audit_person_tags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_roster_event(new.organization_id, new.person_id, 'tag_added', jsonb_build_object('tag', new.tag));
  else
    perform private.log_roster_event(old.organization_id, old.person_id, 'tag_removed', jsonb_build_object('tag', old.tag));
  end if;
  return null;
end;
$$;
revoke execute on function private.audit_person_tags() from public, anon, authenticated;

create trigger person_tags_audit
  after insert or delete on public.person_tags
  for each row execute function private.audit_person_tags();

create or replace function private.audit_team_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_memberships;
  v_org uuid;
begin
  v_row := case when tg_op = 'INSERT' then new else old end;
  select t.organization_id into v_org from public.teams t where t.id = v_row.team_id;
  if v_org is null then
    return null;
  end if;
  perform private.log_roster_event(
    v_org, v_row.person_id,
    case when tg_op = 'INSERT' then 'team_added' else 'team_removed' end,
    jsonb_build_object('team_id', v_row.team_id, 'position_id', v_row.position_id));
  return null;
end;
$$;
revoke execute on function private.audit_team_memberships() from public, anon, authenticated;

create trigger team_memberships_audit
  after insert or delete on public.team_memberships
  for each row execute function private.audit_team_memberships();

-- An archived Person takes no new team places.
create or replace function private.guard_archived_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.people p where p.id = new.person_id and p.archived_at is not null) then
    raise exception 'That person is archived; restore them first' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_archived_team_member() from public, anon, authenticated;

-- Runs after MOB-005's sync trigger has resolved person_id ('t' > 's').
create trigger team_memberships_t_guard_archived
  before insert on public.team_memberships
  for each row execute function private.guard_archived_team_member();

-- Archived people take no new staffing (the F02 Pass A resolver, plus archive).
create or replace function private.resolve_scheduling_person(
  p_plan_id    uuid,
  p_person_id  uuid,
  p_profile_id uuid
)
returns table (person_id uuid, profile_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.profile_id
    from public.plans pl
    join public.people p on p.organization_id = pl.organization_id
   where pl.id = p_plan_id
     and public.is_org_member(pl.organization_id)
     and p.archived_at is null
     and (p_person_id is null or p.id = p_person_id)
     and (p_profile_id is null or p.profile_id = p_profile_id)
     and (p_person_id is not null or p_profile_id is not null)
     and (p.profile_id is null or exists (
           select 1 from public.organization_members m
            where m.organization_id = p.organization_id and m.user_id = p.profile_id and m.status = 'active'))
   limit 1;
$$;
revoke execute on function private.resolve_scheduling_person(uuid, uuid, uuid) from public, anon;
grant execute on function private.resolve_scheduling_person(uuid, uuid, uuid) to authenticated, service_role;

-- Team candidates by Person: team places (logins or not) plus tag matches,
-- archived people excluded. Same signature and audience as F01.
create or replace function public.team_candidates(p_team uuid)
returns table (person_id uuid, profile_id uuid, display_name text, source text, eligible boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team;
  if not found or not (
       public.can_manage_team(p_team)
       or public.has_capability(v_team.organization_id, 'scheduling.manage', v_team.service_type_id, p_team)) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  return query
  with members as (
    select distinct tm.person_id from public.team_memberships tm where tm.team_id = p_team
  ), tagged as (
    select distinct pt.person_id
      from public.team_tag_rules r
      join public.person_tags pt on pt.organization_id = r.organization_id and pt.tag = r.tag
     where r.team_id = p_team
       and pt.person_id not in (select m.person_id from members m)
  ), candidates as (
    select m.person_id, 'membership'::text as source from members m
    union all
    select t.person_id, 'tag'::text from tagged t
  )
  select p.id, p.profile_id,
         coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unnamed'),
         c.source,
         coalesce(private.is_eligible_for_team(p.profile_id, p_team), false)
    from candidates c
    join public.people p on p.id = c.person_id
   where p.archived_at is null;
end;
$$;

-- ========================================================== tag groups =====

create table public.person_tag_groups (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  constraint person_tag_groups_id_org_key unique (id, organization_id)
);
create unique index person_tag_groups_org_name_unique on public.person_tag_groups (organization_id, lower(name));

create table public.person_tag_catalog (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  tag              text not null check (char_length(btrim(tag)) between 1 and 60 and tag = lower(tag)),
  group_id         uuid,
  created_at       timestamptz not null default now(),
  primary key (organization_id, tag),
  constraint person_tag_catalog_group_fk foreign key (group_id, organization_id)
    references public.person_tag_groups (id, organization_id) on delete set null (group_id)
);
create index person_tag_catalog_group_idx on public.person_tag_catalog (group_id);

alter table public.person_tag_groups enable row level security;
alter table public.person_tag_catalog enable row level security;

-- Same audience as the tags themselves.
create policy person_tag_groups_select on public.person_tag_groups
  for select to authenticated using (
    (select public.can_manage_org(organization_id))
    or (select public.has_capability(organization_id, 'people.view_private'))
  );
create policy person_tag_groups_write on public.person_tag_groups
  for all to authenticated
  using ((select public.has_capability(organization_id, 'people.manage')))
  with check ((select public.has_capability(organization_id, 'people.manage')));
create policy person_tag_catalog_select on public.person_tag_catalog
  for select to authenticated using (
    (select public.can_manage_org(organization_id))
    or (select public.has_capability(organization_id, 'people.view_private'))
  );
create policy person_tag_catalog_write on public.person_tag_catalog
  for all to authenticated
  using ((select public.has_capability(organization_id, 'people.manage')))
  with check ((select public.has_capability(organization_id, 'people.manage')));

-- ======================================================== bulk changes =====

create table public.roster_bulk_operations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  -- The normalized request, so a reused key with different input is refused.
  request          jsonb not null,
  result           jsonb not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint roster_bulk_operations_key_unique unique (organization_id, idempotency_key)
);
create index roster_bulk_operations_created_by_idx on public.roster_bulk_operations (created_by);

alter table public.roster_bulk_operations enable row level security;
create policy roster_bulk_operations_select on public.roster_bulk_operations
  for select to authenticated using (created_by = (select auth.uid()) or (select public.is_org_admin(organization_id)));
create policy roster_bulk_operations_insert on public.roster_bulk_operations
  for insert to authenticated with check (
    created_by = (select auth.uid()) and (select public.is_org_member(organization_id))
  );
revoke update, delete, truncate on public.roster_bulk_operations from anon, authenticated;

-- One row per requested person. Security invoker: the caller's own RLS
-- decides which people and tags exist for them, so an id they cannot see is
-- reported as not found rather than described.
--   outcome: change | unchanged | error
--   problem: not_found | archived | not_eligible
create or replace function public.preview_roster_bulk_change(
  p_org         uuid,
  p_person_ids  uuid[],
  p_action      text,
  p_tag         text default null,
  p_team        uuid default null,
  p_position    uuid default null
)
returns table (person_id uuid, display_name text, outcome text, problem text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tag text := lower(btrim(coalesce(p_tag, '')));
begin
  if p_action not in ('add_tag', 'remove_tag', 'add_to_team', 'remove_from_team') then
    raise exception 'Unknown bulk action' using errcode = '22023';
  end if;
  if p_person_ids is null or cardinality(p_person_ids) = 0 or cardinality(p_person_ids) > 500 then
    raise exception 'Choose between 1 and 500 people' using errcode = '22023';
  end if;
  if p_action in ('add_tag', 'remove_tag') then
    if char_length(v_tag) not between 1 and 60 then
      raise exception 'Name the tag (up to 60 characters)' using errcode = '22023';
    end if;
    if not public.has_capability(p_org, 'people.manage') then
      raise exception 'You cannot change tags in this organization' using errcode = '42501';
    end if;
  else
    if p_team is null or not exists (select 1 from public.teams t where t.id = p_team and t.organization_id = p_org) then
      raise exception 'Team not found' using errcode = 'P0002';
    end if;
    if not public.can_manage_team(p_team) then
      raise exception 'You cannot change this team''s roster' using errcode = '42501';
    end if;
    if p_position is not null and not exists (
         select 1 from public.team_positions tp where tp.id = p_position and tp.team_id = p_team) then
      raise exception 'That position is not on this team' using errcode = '22023';
    end if;
  end if;

  return query
  with wanted as (
    select distinct w.id from unnest(p_person_ids) as w(id)
  ), people as (
    select w.id, d.id as found, d.profile_id, d.archived_at,
           btrim(concat_ws(' ', d.first_name, d.last_name)) as label
      from wanted w
      left join public.people_directory d on d.id = w.id and d.organization_id = p_org
  )
  select p.id,
         coalesce(nullif(p.label, ''), case when p.found is null then null else 'Unnamed' end),
         case
           when p.found is null then 'error'
           when p_action in ('add_tag', 'add_to_team') and p.archived_at is not null then 'error'
           when p_action = 'add_to_team' and not coalesce(private.is_eligible_for_team(p.profile_id, p_team), true) then 'error'
           when p_action = 'add_tag' and exists (
                  select 1 from public.person_tags t where t.person_id = p.id and t.tag = v_tag) then 'unchanged'
           when p_action = 'remove_tag' and not exists (
                  select 1 from public.person_tags t where t.person_id = p.id and t.tag = v_tag) then 'unchanged'
           when p_action = 'add_to_team' and exists (
                  select 1 from public.team_memberships m
                   where m.team_id = p_team and m.person_id = p.id
                     and m.position_id is not distinct from p_position) then 'unchanged'
           when p_action = 'remove_from_team' and not exists (
                  select 1 from public.team_memberships m
                   where m.team_id = p_team and m.person_id = p.id
                     and (p_position is null or m.position_id = p_position)) then 'unchanged'
           else 'change'
         end,
         case
           when p.found is null then 'not_found'
           when p_action in ('add_tag', 'add_to_team') and p.archived_at is not null then 'archived'
           when p_action = 'add_to_team' and not coalesce(private.is_eligible_for_team(p.profile_id, p_team), true) then 'not_eligible'
         end
    from people p
   order by 2 nulls last, 1;
end;
$$;
revoke execute on function public.preview_roster_bulk_change(uuid, uuid[], text, text, uuid, uuid) from public, anon;
grant execute on function public.preview_roster_bulk_change(uuid, uuid[], text, text, uuid, uuid) to authenticated;

-- Applies exactly what the preview showed. p_expected_changes is the number
-- of `change` rows the caller reviewed; a different number now means the
-- roster moved underneath them (409). Any error row refuses the whole batch.
create or replace function public.apply_roster_bulk_change(
  p_org              uuid,
  p_person_ids       uuid[],
  p_action           text,
  p_tag              text,
  p_team             uuid,
  p_position         uuid,
  p_expected_changes int,
  p_idempotency_key  text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request jsonb;
  v_prior   public.roster_bulk_operations;
  v_ids     uuid[];
  v_errors  int;
  v_same    int;
  v_tag     text := lower(btrim(coalesce(p_tag, '')));
  v_result  jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;
  v_request := jsonb_build_object(
    'action', p_action, 'tag', nullif(v_tag, ''), 'team_id', p_team, 'position_id', p_position,
    'person_ids', (select jsonb_agg(x order by x) from (select distinct unnest(p_person_ids) as x) s));

  perform pg_advisory_xact_lock(hashtextextended('roster-bulk:' || p_org::text || ':' || p_idempotency_key, 0));
  select * into v_prior from public.roster_bulk_operations
   where organization_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.request <> v_request then
      raise exception 'That idempotency key was used for a different change' using errcode = 'PT409';
    end if;
    return v_prior.result || jsonb_build_object('replayed', true);
  end if;

  select coalesce(array_agg(r.person_id) filter (where r.outcome = 'change'), '{}'),
         count(*) filter (where r.outcome = 'error'),
         count(*) filter (where r.outcome = 'unchanged')
    into v_ids, v_errors, v_same
    from public.preview_roster_bulk_change(p_org, p_person_ids, p_action, p_tag, p_team, p_position) r;

  if v_errors > 0 then
    raise exception '% of the selected people cannot be changed; preview again', v_errors using errcode = '22023';
  end if;
  if p_expected_changes is distinct from cardinality(v_ids) then
    raise exception 'The roster changed since the preview; preview again' using errcode = 'PT409';
  end if;

  if p_action = 'add_tag' then
    insert into public.person_tags (organization_id, person_id, tag, created_by)
    select p_org, x, v_tag, (select auth.uid()) from unnest(v_ids) x
    on conflict do nothing;
  elsif p_action = 'remove_tag' then
    delete from public.person_tags where person_id = any(v_ids) and tag = v_tag;
  elsif p_action = 'add_to_team' then
    insert into public.team_memberships (team_id, person_id, position_id)
    select p_team, x, p_position from unnest(v_ids) x
    on conflict do nothing;
  else
    delete from public.team_memberships m
     where m.person_id = any(v_ids) and m.team_id = p_team
       and (p_position is null or m.position_id = p_position);
  end if;

  v_result := jsonb_build_object('changed', cardinality(v_ids), 'unchanged', v_same, 'replayed', false);
  insert into public.roster_bulk_operations (organization_id, idempotency_key, request, result, created_by)
  values (p_org, p_idempotency_key, v_request, v_result, (select auth.uid()));
  return v_result;
end;
$$;
revoke execute on function public.apply_roster_bulk_change(uuid, uuid[], text, text, uuid, uuid, int, text) from public, anon;
grant execute on function public.apply_roster_bulk_change(uuid, uuid[], text, text, uuid, uuid, int, text) to authenticated;

comment on column public.people.archived_at is
  'F02: archived people are excluded from pickers and new staffing; history is kept and restore clears this.';
comment on table public.person_roster_events is
  'F02: roster audit (created/archived/restored/linked/tags/teams); trigger-written, people.view_private/manage readable.';
