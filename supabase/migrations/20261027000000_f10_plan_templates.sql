-- ============================================================================
-- F10 — saved plan templates, reusable sections and bounded plan generation.
--
-- Concepts kept apart
--   service type      the recurring service (unchanged)
--   plan              a real scheduled service (unchanged)
--   plan template     a named, service-type template (kind 'plan') whose
--                     content lives in immutable revisions
--   section template  a reusable run of order items (kind 'section'); it
--                     holds items only and applies items only
--
-- Template content (one jsonb document per revision, validated here and by
-- the shared Zod schema; every reference is checked against the template's
-- organization when saved and again when applied):
--   notes   text | null
--   times   [{kind, name, day_offset, local_start 'HH:MM', duration_minutes}]
--           wall-clock intent relative to the plan's local service date in
--           the organization's IANA timezone — never a fixed UTC offset
--   items   [{item_type, title, song_id, arrangement_id, key_override,
--             length_seconds, description}]
--   needs   [{position_id, needed}]
--   roster  [{person_id, team_id, position_id}]   optional roster pattern
--
-- Contract
--   save_plan_template           create, edit (new revision) or snapshot a
--                                plan; an edit names the revision it read
--                                (PT409 template_changed otherwise)
--   set_plan_template_archived   archive/restore; nothing is deleted
--   preview_plan_template_apply  writes nothing; returns exactly what would
--                                be added/removed/kept/skipped plus a hash
--   apply_plan_template          one transaction: locks the plan, checks its
--                                content revision and the preview hash,
--                                applies, records provenance. A repeated
--                                idempotency key returns the first result.
--   preview_plan_generation      up to 12 new plans from one revision
--   generate_plans_from_template one transaction for the whole batch
--                                (atomic, not resumable); replay by key
--
-- Never inherited: answers (roster rows are new prepared/unconfirmed
-- requests), notification/delivery timestamps, release state, actual run
-- timing, item discussion. Editing a template never touches a plan: plans
-- hold copies, and provenance rows only point at the revision used.
-- ============================================================================

-- ------------------------------------------------------------- tables ------

create table public.plan_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Null: available to every service type (needs organization-wide
  -- plans.edit to change). A template belongs to its service type.
  service_type_id  uuid references public.service_types (id) on delete cascade,
  kind             text not null default 'plan' check (kind in ('plan', 'section')),
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  description      text check (description is null or char_length(description) <= 2000),
  current_revision int not null default 0 check (current_revision >= 0),
  archived_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index plan_templates_name_key
  on public.plan_templates (organization_id, service_type_id, kind, lower(btrim(name))) nulls not distinct
  where archived_at is null;
create index plan_templates_service_type_idx on public.plan_templates (service_type_id);
create index plan_templates_created_by_idx on public.plan_templates (created_by);
create index plan_templates_updated_by_idx on public.plan_templates (updated_by);

create trigger set_updated_at before update on public.plan_templates
  for each row execute function public.set_updated_at();

create table public.plan_template_revisions (
  id                    uuid primary key default gen_random_uuid(),
  template_id           uuid not null references public.plan_templates (id) on delete cascade,
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  revision              int not null check (revision > 0),
  content               jsonb not null check (jsonb_typeof(content) = 'object'),
  -- Provenance when the revision was saved from a real plan.
  source_plan_id        uuid references public.plans (id) on delete set null,
  source_plan_revision  bigint,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint plan_template_revisions_unique unique (template_id, revision)
);
create index plan_template_revisions_org_idx on public.plan_template_revisions (organization_id);
create index plan_template_revisions_source_idx on public.plan_template_revisions (source_plan_id);
create index plan_template_revisions_created_by_idx on public.plan_template_revisions (created_by);

create table public.plan_generation_batches (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  template_id           uuid references public.plan_templates (id) on delete set null,
  template_revision_id  uuid references public.plan_template_revisions (id) on delete set null,
  idempotency_key       text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash          text not null,
  -- The local-date series as the scheduler reviewed it (timezone, dates,
  -- exclusions); kept for audit, never re-expanded.
  series                jsonb not null default '{}'::jsonb,
  plan_ids              uuid[] not null,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint plan_generation_batches_key_unique unique (organization_id, idempotency_key)
);
create index plan_generation_batches_template_idx on public.plan_generation_batches (template_id);
create index plan_generation_batches_revision_idx on public.plan_generation_batches (template_revision_id);
create index plan_generation_batches_created_by_idx on public.plan_generation_batches (created_by);

-- Provenance and idempotency of every template application (single plan or
-- generated). Name and revision number are copied so history survives a
-- deleted service type.
create table public.plan_template_applications (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  plan_id               uuid not null references public.plans (id) on delete cascade,
  template_id           uuid references public.plan_templates (id) on delete set null,
  template_revision_id  uuid references public.plan_template_revisions (id) on delete set null,
  template_name         text not null,
  template_kind         text not null check (template_kind in ('plan', 'section')),
  template_revision     int not null,
  -- Deferred: a batch row is written after the plans it lists.
  batch_id              uuid references public.plan_generation_batches (id) on delete set null
                        deferrable initially deferred,
  mode                  text not null check (mode in ('append', 'replace')),
  components            text[] not null,
  idempotency_key       text check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  request_hash          text not null,
  result                jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now()
);
create unique index plan_template_applications_key
  on public.plan_template_applications (organization_id, idempotency_key)
  where idempotency_key is not null;
create index plan_template_applications_plan_idx on public.plan_template_applications (plan_id, created_at desc);
create index plan_template_applications_template_idx on public.plan_template_applications (template_id);
create index plan_template_applications_revision_idx on public.plan_template_applications (template_revision_id);
create index plan_template_applications_batch_idx on public.plan_template_applications (batch_id);
create index plan_template_applications_created_by_idx on public.plan_template_applications (created_by);

-- --------------------------------------------------------------- access ----

-- Reading: plans.edit at the template's service type, or anywhere for an
-- organization-wide template. Writing: plans.edit at exactly that scope.
create or replace function private.plan_template_access(
  p_user uuid, p_org uuid, p_service_type uuid, p_write boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.capability_for(p_user, p_org, 'plans.edit', p_service_type, null)
      or (not p_write and p_service_type is null
          and private.capability_anywhere(p_user, p_org, 'plans.edit'));
$$;
revoke execute on function private.plan_template_access(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function private.plan_template_access(uuid, uuid, uuid, boolean) to authenticated, service_role;

alter table public.plan_templates enable row level security;
alter table public.plan_template_revisions enable row level security;
alter table public.plan_generation_batches enable row level security;
alter table public.plan_template_applications enable row level security;

create policy plan_templates_select on public.plan_templates
  for select to authenticated
  using (private.plan_template_access((select auth.uid()), organization_id, service_type_id, false));
create policy plan_templates_insert on public.plan_templates
  for insert to authenticated
  with check (
    private.plan_template_access((select auth.uid()), organization_id, service_type_id, true)
    and created_by = (select auth.uid())
  );
create policy plan_templates_update on public.plan_templates
  for update to authenticated
  using (private.plan_template_access((select auth.uid()), organization_id, service_type_id, true))
  with check (private.plan_template_access((select auth.uid()), organization_id, service_type_id, true));
revoke delete, truncate on public.plan_templates from anon, authenticated;
-- Kind, scope and organization are fixed once created.
revoke update on public.plan_templates from anon, authenticated;
grant update (name, description, current_revision, archived_at, updated_by) on public.plan_templates to authenticated;

-- Revisions are immutable.
create policy plan_template_revisions_select on public.plan_template_revisions
  for select to authenticated
  using (exists (select 1 from public.plan_templates t where t.id = plan_template_revisions.template_id));
create policy plan_template_revisions_insert on public.plan_template_revisions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.plan_templates t
       where t.id = plan_template_revisions.template_id
         and t.organization_id = plan_template_revisions.organization_id
         and private.plan_template_access((select auth.uid()), t.organization_id, t.service_type_id, true)
    )
  );
revoke update, delete, truncate on public.plan_template_revisions from anon, authenticated;

create policy plan_generation_batches_select on public.plan_generation_batches
  for select to authenticated using ((select public.can_manage_org(organization_id)));
create policy plan_generation_batches_insert on public.plan_generation_batches
  for insert to authenticated
  with check (
    (select public.has_capability_anywhere(organization_id, 'plans.edit'))
    and created_by = (select auth.uid())
  );
revoke update, delete, truncate on public.plan_generation_batches from anon, authenticated;

create policy plan_template_applications_select on public.plan_template_applications
  for select to authenticated using ((select public.can_manage_org(organization_id)));
create policy plan_template_applications_insert on public.plan_template_applications
  for insert to authenticated
  with check ((select public.can_edit_plan(plan_id)) and created_by = (select auth.uid()));
revoke update, delete, truncate on public.plan_template_applications from anon, authenticated;

-- ----------------------------------------------------------- validation ----

create or replace function private.f10_bad(p_message text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = '22023', hint = 'template_invalid';
end;
$$;

-- An integer in [lo, hi] or an error naming the field.
create or replace function private.f10_int(p_value jsonb, p_lo int, p_hi int, p_field text)
returns int language plpgsql immutable set search_path = '' as $$
declare v int;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^-?[0-9]+$' then
    perform private.f10_bad(format('%s must be a whole number', p_field));
  end if;
  v := (p_value #>> '{}')::int;
  if v < p_lo or v > p_hi then
    perform private.f10_bad(format('%s must be between %s and %s', p_field, p_lo, p_hi));
  end if;
  return v;
end;
$$;

-- Trimmed text (null when absent/blank) no longer than p_max.
create or replace function private.f10_text(p_value jsonb, p_max int, p_field text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'string' then perform private.f10_bad(format('%s must be text', p_field)); end if;
  v := nullif(btrim(p_value #>> '{}'), '');
  if char_length(v) > p_max then
    perform private.f10_bad(format('%s must be at most %s characters', p_field, p_max));
  end if;
  return v;
end;
$$;

create or replace function private.f10_uuid(p_value jsonb, p_field text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'string'
     or (p_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform private.f10_bad(format('%s must be an id', p_field));
  end if;
  return (p_value #>> '{}')::uuid;
end;
$$;

-- Validates template content and checks that every song, arrangement,
-- position, team and Person belongs to the organization. Definer so it can
-- see People the caller's RLS hides; it reveals only "not in this
-- organization" and is reached only through the invoker writers below,
-- after their own write check.
create or replace function private.plan_template_normalize(p_org uuid, p_kind text, p_content jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key     text;
  v_el      jsonb;
  v_i       bigint;
  v_times   jsonb := '[]'::jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_needs   jsonb := '[]'::jsonb;
  v_roster  jsonb := '[]'::jsonb;
  v_notes   text;
  v_type    text;
  v_title   text;
  v_song    uuid;
  v_arr     uuid;
  v_team    uuid;
  v_pos     uuid;
  v_person  uuid;
  v_seen    text[] := '{}';
  v_tag     text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    perform private.f10_bad('Template content must be an object');
  end if;
  for v_key in select jsonb_object_keys(p_content) loop
    if v_key not in ('version', 'notes', 'times', 'items', 'needs', 'roster') then
      perform private.f10_bad(format('Unknown template component "%s"', v_key));
    end if;
  end loop;
  foreach v_key in array array['times', 'items', 'needs', 'roster'] loop
    if p_content ? v_key and jsonb_typeof(p_content -> v_key) not in ('array', 'null') then
      perform private.f10_bad(format('%s must be a list', v_key));
    end if;
  end loop;

  v_notes := private.f10_text(p_content -> 'notes', 8000, 'Notes');

  if jsonb_array_length(coalesce(nullif(p_content -> 'times', 'null'::jsonb), '[]')) > 20 then
    perform private.f10_bad('A template can hold at most 20 times');
  end if;
  for v_el, v_i in
    select value, ordinality from jsonb_array_elements(coalesce(nullif(p_content -> 'times', 'null'::jsonb), '[]')) with ordinality
  loop
    v_type := coalesce(private.f10_text(v_el -> 'kind', 20, 'Time kind'), 'service');
    if v_type not in ('service', 'rehearsal', 'other') then
      perform private.f10_bad('Time kind must be service, rehearsal or other');
    end if;
    if jsonb_typeof(v_el -> 'local_start') is distinct from 'string'
       or (v_el ->> 'local_start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      perform private.f10_bad(format('Time %s needs a local start like 09:30', v_i));
    end if;
    v_times := v_times || jsonb_build_array(jsonb_build_object(
      'kind', v_type,
      'name', private.f10_text(v_el -> 'name', 120, 'Time name'),
      'day_offset', private.f10_int(coalesce(v_el -> 'day_offset', '0'::jsonb), -14, 14, 'Day offset'),
      'local_start', v_el ->> 'local_start',
      'duration_minutes', private.f10_int(v_el -> 'duration_minutes', 1, 1440, 'Duration')
    ));
  end loop;

  if jsonb_array_length(coalesce(nullif(p_content -> 'items', 'null'::jsonb), '[]')) > 200 then
    perform private.f10_bad('A template can hold at most 200 items');
  end if;
  for v_el, v_i in
    select value, ordinality from jsonb_array_elements(coalesce(nullif(p_content -> 'items', 'null'::jsonb), '[]')) with ordinality
  loop
    v_type := coalesce(private.f10_text(v_el -> 'item_type', 10, 'Item type'), 'item');
    if v_type not in ('song', 'header', 'item') then
      perform private.f10_bad('Item type must be song, header or item');
    end if;
    v_song := private.f10_uuid(v_el -> 'song_id', 'Song');
    v_arr := private.f10_uuid(v_el -> 'arrangement_id', 'Arrangement');
    v_title := private.f10_text(v_el -> 'title', 200, 'Item title');
    if v_type = 'song' and v_song is null then
      perform private.f10_bad(format('Song item %s needs a song', v_i));
    end if;
    if v_song is not null then
      select coalesce(v_title, s.title) into v_title
        from public.songs s where s.id = v_song and s.organization_id = p_org;
      if not found then
        perform private.f10_bad(format('Item %s uses a song that is not in this organization', v_i));
      end if;
    end if;
    if v_arr is not null and not exists (
      select 1 from public.arrangements a where a.id = v_arr and a.song_id = v_song
    ) then
      perform private.f10_bad(format('Item %s uses an arrangement of a different song', v_i));
    end if;
    if v_title is null then
      perform private.f10_bad(format('Item %s needs a title', v_i));
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item_type', v_type,
      'title', v_title,
      'song_id', v_song,
      'arrangement_id', v_arr,
      'key_override', private.f10_text(v_el -> 'key_override', 8, 'Key'),
      'length_seconds', private.f10_int(coalesce(v_el -> 'length_seconds', '0'::jsonb), 0, 36000, 'Length'),
      'description', private.f10_text(v_el -> 'description', 4000, 'Item description')
    ));
  end loop;

  if jsonb_array_length(coalesce(nullif(p_content -> 'needs', 'null'::jsonb), '[]')) > 200 then
    perform private.f10_bad('A template can hold at most 200 needed positions');
  end if;
  for v_el in select value from jsonb_array_elements(coalesce(nullif(p_content -> 'needs', 'null'::jsonb), '[]')) loop
    v_pos := private.f10_uuid(v_el -> 'position_id', 'Position');
    if v_pos is null or not exists (
      select 1 from public.team_positions tp join public.teams t on t.id = tp.team_id
       where tp.id = v_pos and tp.plan_id is null and t.organization_id = p_org
    ) then
      perform private.f10_bad('A needed position is not in this organization');
    end if;
    if ('need:' || v_pos) = any(v_seen) then
      perform private.f10_bad('A position is listed twice in needed positions');
    end if;
    v_seen := v_seen || ('need:' || v_pos);
    v_needs := v_needs || jsonb_build_array(jsonb_build_object(
      'position_id', v_pos,
      'needed', private.f10_int(v_el -> 'needed', 1, 99, 'Needed')
    ));
  end loop;

  if jsonb_array_length(coalesce(nullif(p_content -> 'roster', 'null'::jsonb), '[]')) > 200 then
    perform private.f10_bad('A template can hold at most 200 roster entries');
  end if;
  for v_el in select value from jsonb_array_elements(coalesce(nullif(p_content -> 'roster', 'null'::jsonb), '[]')) loop
    v_person := private.f10_uuid(v_el -> 'person_id', 'Person');
    v_team := private.f10_uuid(v_el -> 'team_id', 'Team');
    v_pos := private.f10_uuid(v_el -> 'position_id', 'Position');
    if v_person is null or not exists (
      select 1 from public.people p
       where p.id = v_person and p.organization_id = p_org and p.archived_at is null
    ) then
      perform private.f10_bad('A roster person is not an active person in this organization');
    end if;
    if v_team is null or not exists (
      select 1 from public.teams t where t.id = v_team and t.organization_id = p_org
    ) then
      perform private.f10_bad('A roster team is not in this organization');
    end if;
    if v_pos is not null and not exists (
      select 1 from public.team_positions tp where tp.id = v_pos and tp.team_id = v_team and tp.plan_id is null
    ) then
      perform private.f10_bad('A roster position does not belong to its team');
    end if;
    v_tag := format('roster:%s:%s:%s', v_person, v_team, coalesce(v_pos::text, '-'));
    if v_tag = any(v_seen) then
      perform private.f10_bad('A roster entry is listed twice');
    end if;
    v_seen := v_seen || v_tag;
    v_roster := v_roster || jsonb_build_array(jsonb_build_object(
      'person_id', v_person, 'team_id', v_team, 'position_id', v_pos
    ));
  end loop;

  if p_kind = 'section' and (v_notes is not null or jsonb_array_length(v_times) > 0
     or jsonb_array_length(v_needs) > 0 or jsonb_array_length(v_roster) > 0) then
    perform private.f10_bad('A section template holds order items only');
  end if;
  if p_kind = 'section' and jsonb_array_length(v_items) = 0 then
    perform private.f10_bad('A section template needs at least one item');
  end if;

  return jsonb_build_object(
    'version', 1, 'notes', v_notes, 'times', v_times,
    'items', v_items, 'needs', v_needs, 'roster', v_roster
  );
end;
$$;

-- A plan's selected components as template content. Invoker: the caller
-- copies only what RLS lets them read (prepared requests stay with their
-- schedulers). Declined requests and archived People are left out; times
-- become wall-clock offsets from the plan's local service date.
create or replace function private.plan_template_content_from_plan(p_plan uuid, p_components text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan   public.plans;
  v_tz     text;
  v_anchor date;
  v_out    jsonb := jsonb_build_object('version', 1);
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organizations where id = v_plan.organization_id;
  v_anchor := (v_plan.service_date at time zone v_tz)::date;

  if 'notes' = any(p_components) then
    v_out := v_out || jsonb_build_object('notes', nullif(btrim(v_plan.notes), ''));
  end if;
  if 'times' = any(p_components) then
    if exists (
      select 1 from public.plan_times t
       where t.plan_id = p_plan and abs((t.starts_at at time zone v_tz)::date - v_anchor) > 14
    ) then
      perform private.f10_bad('A time on this plan is more than 14 days from its service date');
    end if;
    v_out := v_out || jsonb_build_object('times', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', t.kind,
               'name', t.name,
               'day_offset', (t.starts_at at time zone v_tz)::date - v_anchor,
               'local_start', to_char(t.starts_at at time zone v_tz, 'HH24:MI'),
               'duration_minutes', least(1440, greatest(1, round(extract(epoch from t.ends_at - t.starts_at) / 60)::int))
             ) order by t.sort_order, t.starts_at, t.id)
        from public.plan_times t where t.plan_id = p_plan
    ), '[]'::jsonb));
  end if;
  if 'items' = any(p_components) then
    v_out := v_out || jsonb_build_object('items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_type', i.item_type, 'title', i.title, 'song_id', i.song_id,
               'arrangement_id', i.arrangement_id, 'key_override', i.key_override,
               'length_seconds', i.length_seconds, 'description', i.description
             ) order by i.sort_order, i.created_at, i.id)
        from public.plan_items i where i.plan_id = p_plan
    ), '[]'::jsonb));
  end if;
  if 'needs' = any(p_components) then
    v_out := v_out || jsonb_build_object('needs', coalesce((
      select jsonb_agg(jsonb_build_object('position_id', n.position_id, 'needed', n.needed) order by n.position_id)
        from public.plan_position_needs n
        join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
       where n.plan_id = p_plan and n.needed > 0
    ), '[]'::jsonb));
  end if;
  if 'roster' = any(p_components) then
    v_out := v_out || jsonb_build_object('roster', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'team_id', r.team_id, 'position_id', r.position_id)
                       order by r.team_id, r.position_id, r.person_id)
        from (
          select distinct a.person_id, a.team_id, a.position_id
            from public.assignments a
            join public.people p on p.id = a.person_id and p.archived_at is null
            left join public.team_positions tp on tp.id = a.position_id
           where a.plan_id = p_plan and a.status <> 'declined'
             and (a.position_id is null or tp.plan_id is null)
        ) r
    ), '[]'::jsonb));
  end if;
  return v_out;
end;
$$;

-- --------------------------------------------------- create / edit / archive

create or replace function public.save_plan_template(
  p_organization_id   uuid,
  p_template_id       uuid default null,
  p_expected_revision int default null,
  p_kind              text default 'plan',
  p_service_type_id   uuid default null,
  p_name              text default null,
  p_description       text default null,
  p_content           jsonb default null,
  p_source_plan_id    uuid default null,
  p_source_components text[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_tpl      public.plan_templates;
  v_content  jsonb;
  v_source   public.plans;
  v_revision public.plan_template_revisions;
  v_name     text := nullif(btrim(p_name), '');
begin
  if p_template_id is null then
    if p_kind not in ('plan', 'section') then
      perform private.f10_bad('Template kind must be plan or section');
    end if;
    if p_service_type_id is not null and not exists (
      select 1 from public.service_types s where s.id = p_service_type_id and s.organization_id = p_organization_id
    ) then
      raise exception 'Service type not found' using errcode = 'P0002';
    end if;
    if not private.plan_template_access(v_uid, p_organization_id, p_service_type_id, true) then
      raise exception 'Only a plan editor for this service type can save templates' using errcode = '42501';
    end if;
    if v_name is null then
      perform private.f10_bad('Give the template a name');
    end if;
    insert into public.plan_templates (organization_id, service_type_id, kind, name, description, created_by, updated_by)
    values (p_organization_id, p_service_type_id, p_kind, v_name, nullif(btrim(p_description), ''), v_uid, v_uid)
    returning * into v_tpl;
  else
    select * into v_tpl from public.plan_templates
     where id = p_template_id and organization_id = p_organization_id for update;
    if not found or not private.plan_template_access(v_uid, v_tpl.organization_id, v_tpl.service_type_id, true) then
      raise exception 'Template not found' using errcode = 'P0002';
    end if;
    if v_tpl.archived_at is not null then
      perform private.f10_bad('Restore this template before editing it');
    end if;
    if p_expected_revision is null or p_expected_revision <> v_tpl.current_revision then
      raise exception 'This template changed since you opened it' using errcode = 'PT409', hint = 'template_changed';
    end if;
    update public.plan_templates
       set name = coalesce(v_name, name),
           description = case when p_description is null then description else nullif(btrim(p_description), '') end,
           updated_by = v_uid
     where id = v_tpl.id
    returning * into v_tpl;
  end if;

  if p_source_plan_id is not null then
    select * into v_source from public.plans
     where id = p_source_plan_id and organization_id = p_organization_id;
    if not found then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
    if p_source_components is null or cardinality(p_source_components) = 0
       or not (p_source_components <@ array['times', 'notes', 'items', 'needs', 'roster']) then
      perform private.f10_bad('Choose what to save from the plan');
    end if;
    if v_tpl.kind = 'section' and p_source_components <> array['items'] then
      perform private.f10_bad('A section template saves order items only');
    end if;
    v_content := private.plan_template_content_from_plan(v_source.id, p_source_components);
  else
    v_content := p_content;
  end if;

  if v_content is not null then
    v_content := private.plan_template_normalize(v_tpl.organization_id, v_tpl.kind, v_content);
    update public.plan_templates set current_revision = current_revision + 1, updated_by = v_uid
     where id = v_tpl.id returning * into v_tpl;
    insert into public.plan_template_revisions (
      template_id, organization_id, revision, content, source_plan_id, source_plan_revision, created_by
    ) values (
      v_tpl.id, v_tpl.organization_id, v_tpl.current_revision, v_content,
      v_source.id, v_source.content_revision, v_uid
    ) returning * into v_revision;
  elsif v_tpl.current_revision = 0 then
    perform private.f10_bad('A new template needs content');
  end if;

  return jsonb_build_object('template_id', v_tpl.id, 'revision', v_tpl.current_revision);
end;
$$;

create or replace function public.set_plan_template_archived(p_template_id uuid, p_archived boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tpl public.plan_templates;
begin
  select * into v_tpl from public.plan_templates where id = p_template_id for update;
  if not found or not private.plan_template_access((select auth.uid()), v_tpl.organization_id, v_tpl.service_type_id, true) then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if not p_archived and v_tpl.archived_at is not null and exists (
    select 1 from public.plan_templates t
     where t.organization_id = v_tpl.organization_id and t.kind = v_tpl.kind
       and t.service_type_id is not distinct from v_tpl.service_type_id
       and t.archived_at is null and lower(btrim(t.name)) = lower(btrim(v_tpl.name))
  ) then
    raise exception 'Another active template already uses this name' using errcode = 'PT409', hint = 'template_changed';
  end if;
  update public.plan_templates
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         updated_by = (select auth.uid())
   where id = v_tpl.id;
end;
$$;

-- --------------------------------------------------------------- preview ---

-- What applying one template revision would do to a plan (p_plan) or to a
-- plan about to be created (p_plan null, generation). Reads only. Every
-- reference is rechecked here, so something deleted since the template was
-- saved is listed as skipped instead of failing the whole apply. Arrays are
-- in a fixed order so the jsonb (and its md5) is reproducible.
create or replace function private.plan_template_preview(
  p_org          uuid,
  p_service_type uuid,
  p_plan         uuid,
  p_anchor       date,
  p_revision_id  uuid,
  p_mode         text,
  p_components   text[],
  p_times        jsonb,
  p_insert_at    int
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_rev       public.plan_template_revisions;
  v_tpl       public.plan_templates;
  v_tz        text;
  v_content   jsonb;
  v_plan      public.plans;
  v_out       jsonb;
  v_blocking  jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  v_el        jsonb;
  v_given     jsonb;
  v_i         bigint;
  v_add       jsonb;
  v_skipped   jsonb;
  v_kept      jsonb;
  v_existing  int;
  v_count     int;
  v_missing   int;
  v_title     text;
  v_arr       uuid;
  v_team      uuid;
  v_pos       uuid;
  v_notes     text;
  v_template_notes text;
  v_assigned  int := 0;
  v_expected  timestamp;
  v_start     timestamptz;
  v_end       timestamptz;
begin
  if p_mode is null or p_mode not in ('append', 'replace') then
    perform private.f10_bad('Choose append or replace');
  end if;
  if p_components is null or cardinality(p_components) = 0
     or not (p_components <@ array['times', 'notes', 'items', 'needs', 'roster']) then
    perform private.f10_bad('Choose at least one part of the template');
  end if;
  if not private.capability_for(v_uid, p_org, 'plans.edit', p_service_type, null) then
    raise exception 'Only a plan editor can apply templates here' using errcode = '42501';
  end if;

  select * into v_rev from public.plan_template_revisions where id = p_revision_id;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  select * into v_tpl from public.plan_templates where id = v_rev.template_id;
  if not found or v_tpl.organization_id <> p_org then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.archived_at is not null then
    perform private.f10_bad('Restore this template before applying it');
  end if;
  if v_tpl.kind = 'section' and p_components <> array['items'] then
    perform private.f10_bad('A section template applies order items only');
  end if;
  if v_tpl.service_type_id is not null and v_tpl.service_type_id is distinct from p_service_type then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'other_service_type', 'message', 'This template belongs to a different service type.'));
  end if;
  if v_rev.revision <> v_tpl.current_revision then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'older_revision', 'message', format('Revision %s is not the latest (%s).', v_rev.revision, v_tpl.current_revision)));
  end if;

  v_content := v_rev.content;
  select timezone into v_tz from public.organizations where id = p_org;
  if p_plan is not null then
    select * into v_plan from public.plans where id = p_plan;
    select count(*) into v_assigned from public.assignments where plan_id = p_plan;
  end if;

  v_out := jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_tpl.id, 'name', v_tpl.name, 'kind', v_tpl.kind,
      'revision', v_rev.revision, 'revision_id', v_rev.id, 'latest_revision', v_tpl.current_revision),
    'plan_id', p_plan,
    'destination_revision', v_plan.content_revision,
    'anchor_date', p_anchor,
    'timezone', v_tz,
    'mode', p_mode,
    'components', to_jsonb(p_components)
  );

  -- ------------------------------------------------------------ items
  if 'items' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_missing := 0;
    for v_el in select value from jsonb_array_elements(v_content -> 'items') loop
      v_title := v_el ->> 'title';
      if (v_el ->> 'song_id') is not null and not exists (
        select 1 from public.songs s where s.id = (v_el ->> 'song_id')::uuid and s.organization_id = p_org
      ) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('title', v_title, 'reason', 'song_missing'));
        continue;
      end if;
      v_arr := (v_el ->> 'arrangement_id')::uuid;
      if v_arr is not null and not exists (select 1 from public.arrangements a where a.id = v_arr) then
        v_arr := null;
        v_missing := v_missing + 1;
      end if;
      v_add := v_add || jsonb_build_array(v_el || jsonb_build_object('arrangement_id', v_arr));
    end loop;
    if v_missing > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'arrangement_missing',
        'message', format('%s item(s) use an arrangement that no longer exists; they keep the song default.', v_missing)));
    end if;
    select count(*) into v_existing from public.plan_items where plan_id = p_plan;
    if p_mode = 'replace' and v_existing > 0 then
      select count(distinct x.plan_item_id) into v_count from (
        select c.plan_item_id from public.plan_item_comments c where c.plan_id = p_plan
        union all
        select n.plan_item_id from public.plan_notes n where n.plan_id = p_plan and n.plan_item_id is not null
      ) x;
      if v_count > 0 then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed',
          'message', format('%s current item(s) have notes or comments that are removed with them.', v_count)));
      end if;
    end if;
    if p_insert_at is not null and (p_mode = 'replace' or p_insert_at < 0 or p_insert_at > v_existing) then
      perform private.f10_bad('Choose a place inside the current order');
    end if;
    v_out := v_out || jsonb_build_object('items', jsonb_build_object(
      'add', v_add, 'skipped', v_skipped,
      'remove_count', case when p_mode = 'replace' then v_existing else 0 end,
      'existing_count', v_existing,
      'insert_at', case when p_mode = 'replace' then 0 else coalesce(p_insert_at, v_existing) end));
  end if;

  -- ------------------------------------------------------------ times
  if 'times' = any(p_components) then
    v_given := coalesce(p_times, '[]'::jsonb);
    if jsonb_typeof(v_given) <> 'array' or jsonb_array_length(v_given) <> jsonb_array_length(v_content -> 'times') then
      perform private.f10_bad('Preview the template times again');
    end if;
    v_add := '[]'::jsonb;
    for v_el, v_i in select value, ordinality from jsonb_array_elements(v_content -> 'times') with ordinality loop
      begin
        v_start := (v_given -> (v_i::int - 1) ->> 'starts_at')::timestamptz;
        v_end := (v_given -> (v_i::int - 1) ->> 'ends_at')::timestamptz;
      exception when others then
        perform private.f10_bad('Preview the template times again');
      end;
      -- The resolved instant must show the template's wall-clock time on the
      -- intended local date; either side of a DST fold is accepted, a
      -- skipped (spring-forward) time never matches.
      v_expected := (p_anchor + (v_el ->> 'day_offset')::int) + (v_el ->> 'local_start')::time;
      if v_start is null or v_end is null or (v_start at time zone v_tz) <> v_expected
         or v_end - v_start <> make_interval(mins => (v_el ->> 'duration_minutes')::int) then
        perform private.f10_bad('Preview the template times again');
      end if;
      v_add := v_add || jsonb_build_array(jsonb_build_object(
        'kind', v_el ->> 'kind', 'name', v_el -> 'name', 'starts_at', v_start, 'ends_at', v_end,
        'local_date', (p_anchor + (v_el ->> 'day_offset')::int), 'local_start', v_el ->> 'local_start'));
    end loop;
    select count(*) into v_existing from public.plan_times where plan_id = p_plan;
    if p_mode = 'replace' and v_existing > 0 and v_assigned > 0 then
      v_blocking := v_blocking || jsonb_build_array(jsonb_build_object('code', 'times_in_use',
        'message', 'People are scheduled on this plan. Change its times in the plan''s time editor so they are asked again, or append.'));
    elsif p_mode = 'append' and v_existing > 0 and jsonb_array_length(v_add) > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'times_added',
        'message', format('The plan keeps its %s time(s); the template''s are added.', v_existing)));
    end if;
    v_out := v_out || jsonb_build_object('times', jsonb_build_object(
      'add', v_add, 'remove_count', case when p_mode = 'replace' then v_existing else 0 end));
  end if;

  -- ------------------------------------------------------------ notes
  if 'notes' = any(p_components) then
    v_template_notes := v_content ->> 'notes';
    v_notes := nullif(btrim(v_plan.notes), '');
    v_out := v_out || jsonb_build_object('notes', case
      when v_template_notes is null then jsonb_build_object('action', 'none', 'value', v_notes)
      when p_mode = 'replace' or v_notes is null then jsonb_build_object('action', 'set', 'value', v_template_notes)
      else jsonb_build_object('action', 'append', 'value', v_notes || E'\n\n' || v_template_notes)
    end);
    if (v_out #>> '{notes,action}') = 'append' and char_length(v_out #>> '{notes,value}') > 8000 then
      v_blocking := v_blocking || jsonb_build_array(jsonb_build_object('code', 'notes_too_long',
        'message', 'The combined notes would be longer than 8000 characters. Replace them instead.'));
    end if;
  end if;

  -- ------------------------------------------------------------ needs
  if 'needs' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_kept := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_content -> 'needs') loop
      v_pos := (v_el ->> 'position_id')::uuid;
      select tp.team_id into v_team
        from public.team_positions tp join public.teams t on t.id = tp.team_id
       where tp.id = v_pos and tp.plan_id is null and t.organization_id = p_org;
      if v_team is null then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('position_id', v_pos, 'reason', 'position_missing'));
        continue;
      end if;
      select n.needed into v_count from public.plan_position_needs n where n.plan_id = p_plan and n.position_id = v_pos;
      if p_mode = 'append' and found then
        v_kept := v_kept || jsonb_build_array(jsonb_build_object(
          'position_id', v_pos, 'needed', v_count, 'template_needed', (v_el ->> 'needed')::int));
      else
        v_add := v_add || jsonb_build_array(jsonb_build_object('position_id', v_pos, 'needed', (v_el ->> 'needed')::int));
      end if;
    end loop;
    select count(*) into v_existing from public.plan_position_needs where plan_id = p_plan;
    v_out := v_out || jsonb_build_object('needs', jsonb_build_object(
      'add', v_add, 'kept', v_kept, 'skipped', v_skipped,
      'remove_count', case when p_mode = 'replace' then v_existing else 0 end));
  end if;

  -- ----------------------------------------------------------- roster
  if 'roster' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_existing := 0;
    for v_el in select value from jsonb_array_elements(v_content -> 'roster') loop
      v_team := (v_el ->> 'team_id')::uuid;
      v_pos := (v_el ->> 'position_id')::uuid;
      if not exists (
        select 1 from public.people p
         where p.id = (v_el ->> 'person_id')::uuid and p.organization_id = p_org and p.archived_at is null
      ) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'person_unavailable'));
      elsif not exists (select 1 from public.teams t where t.id = v_team and t.organization_id = p_org)
         or (v_pos is not null and not exists (
           select 1 from public.team_positions tp where tp.id = v_pos and tp.team_id = v_team and tp.plan_id is null)) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'position_missing'));
      elsif not private.capability_for(v_uid, p_org, 'scheduling.manage', p_service_type, v_team) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'not_permitted'));
      elsif exists (
        select 1 from public.assignments a
         where a.plan_id = p_plan and a.person_id = (v_el ->> 'person_id')::uuid
           and a.team_id = v_team and a.position_id is not distinct from v_pos
      ) then
        v_existing := v_existing + 1;
      else
        v_add := v_add || jsonb_build_array(v_el);
      end if;
    end loop;
    if p_mode = 'replace' then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'roster_appended',
        'message', 'Scheduled people are never removed by a template; roster entries are added as prepared requests.'));
    end if;
    v_out := v_out || jsonb_build_object('roster', jsonb_build_object(
      'add', v_add, 'skipped', v_skipped, 'existing_count', v_existing));
  end if;

  if p_plan is not null then
    select count(*) into v_count from public.plan_template_applications a
     where a.plan_id = p_plan and a.template_id = v_tpl.id;
    if v_count > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'already_applied',
        'message', format('This template was already applied to this plan %s time(s). Applying again adds its content again.', v_count)));
    end if;
  end if;

  return v_out || jsonb_build_object('blocking', v_blocking, 'warnings', v_warnings);
end;
$$;

-- ------------------------------------------------------------------ write --

-- Applies a preview inside the caller's transaction. Invoker: RLS decides
-- every row. Roster rows are new prepared, unconfirmed requests for every
-- time; People are locked and conflict-checked like every other writer.
create or replace function private.plan_template_write(p_plan uuid, p_preview jsonb, p_conflict_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_replace boolean := (p_preview ->> 'mode') = 'replace';
  v_at      int;
  v_n       int;
  v_items   int := 0;
  v_times   int := 0;
  v_needs   int := 0;
  v_roster  int := 0;
  v_people  uuid[];
begin
  if p_preview ? 'items' then
    if v_replace then
      delete from public.plan_items where plan_id = p_plan;
    end if;
    v_at := (p_preview #>> '{items,insert_at}')::int;
    v_n := jsonb_array_length(p_preview #> '{items,add}');
    if v_n > 0 then
      -- Renumber 0..k-1 first so an insertion point is exact.
      with ordered as (
        select id, (row_number() over (order by sort_order, created_at, id))::int - 1 pos
          from public.plan_items where plan_id = p_plan
      )
      update public.plan_items i
         set sort_order = case when o.pos >= v_at then o.pos + v_n else o.pos end
        from ordered o
       where i.id = o.id
         and i.sort_order is distinct from case when o.pos >= v_at then o.pos + v_n else o.pos end;
      insert into public.plan_items (
        plan_id, item_type, title, song_id, arrangement_id, key_override, length_seconds, description, sort_order
      )
      select p_plan, (e.value ->> 'item_type')::public.plan_item_type, e.value ->> 'title',
             (e.value ->> 'song_id')::uuid, (e.value ->> 'arrangement_id')::uuid, e.value ->> 'key_override',
             (e.value ->> 'length_seconds')::int, e.value ->> 'description', v_at + e.ord::int - 1
        from jsonb_array_elements(p_preview #> '{items,add}') with ordinality e(value, ord);
      get diagnostics v_items = row_count;
    end if;
  end if;

  if p_preview ? 'times' then
    if v_replace then
      delete from public.plan_times where plan_id = p_plan;
    end if;
    select coalesce(max(sort_order) + 1, 0) into v_at from public.plan_times where plan_id = p_plan;
    insert into public.plan_times (plan_id, kind, name, starts_at, ends_at, sort_order)
    select p_plan, (e.value ->> 'kind')::public.plan_time_kind, e.value ->> 'name',
           (e.value ->> 'starts_at')::timestamptz, (e.value ->> 'ends_at')::timestamptz, v_at + e.ord::int - 1
      from jsonb_array_elements(p_preview #> '{times,add}') with ordinality e(value, ord);
    get diagnostics v_times = row_count;
  end if;

  if p_preview ? 'notes' and (p_preview #>> '{notes,action}') <> 'none' then
    update public.plans set notes = p_preview #>> '{notes,value}' where id = p_plan;
  end if;

  if p_preview ? 'needs' then
    if v_replace then
      delete from public.plan_position_needs where plan_id = p_plan;
    end if;
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_plan, (e ->> 'position_id')::uuid, (e ->> 'needed')::int
      from jsonb_array_elements(p_preview #> '{needs,add}') e
    on conflict (plan_id, position_id) do nothing;
    get diagnostics v_needs = row_count;
  end if;

  if p_preview ? 'roster' and jsonb_array_length(p_preview #> '{roster,add}') > 0 then
    select coalesce(array_agg(distinct (e ->> 'person_id')::uuid), '{}') into v_people
      from jsonb_array_elements(p_preview #> '{roster,add}') e;
    perform private.lock_scheduling_people(v_people);
    perform set_config('f04.conflict_override_reason', coalesce(p_conflict_reason, ''), true);
    insert into public.assignments (plan_id, person_id, team_id, position_id, status, visibility, created_by, attendance_mode)
    select p_plan, (e ->> 'person_id')::uuid, (e ->> 'team_id')::uuid, (e ->> 'position_id')::uuid,
           'unconfirmed', 'prepared', v_uid, 'all'
      from jsonb_array_elements(p_preview #> '{roster,add}') e
    on conflict do nothing;
    get diagnostics v_roster = row_count;
    perform private.check_pending_conflicts();
    perform set_config('f04.conflict_override_reason', '', true);
  end if;

  return jsonb_build_object('items', v_items, 'times', v_times, 'needs', v_needs, 'roster', v_roster);
end;
$$;

-- --------------------------------------------------- single-plan apply ----

create or replace function public.preview_plan_template_apply(
  p_plan_id     uuid,
  p_revision_id uuid,
  p_mode        text,
  p_components  text[],
  p_times       jsonb default '[]'::jsonb,
  p_insert_at   int default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan    public.plans;
  v_tz      text;
  v_preview jsonb;
begin
  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not public.can_edit_plan(p_plan_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organizations where id = v_plan.organization_id;
  v_preview := private.plan_template_preview(
    v_plan.organization_id, v_plan.service_type_id, v_plan.id, (v_plan.service_date at time zone v_tz)::date,
    p_revision_id, p_mode, p_components, p_times, p_insert_at);
  return v_preview || jsonb_build_object('preview_hash', md5(v_preview::text));
end;
$$;

create or replace function public.apply_plan_template(
  p_plan_id                  uuid,
  p_revision_id              uuid,
  p_mode                     text,
  p_components               text[],
  p_preview_hash             text,
  p_times                    jsonb default '[]'::jsonb,
  p_insert_at                int default null,
  p_expected_revision        bigint default null,
  p_idempotency_key          text default null,
  p_conflict_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan     public.plans;
  v_tz       text;
  v_request  text;
  v_existing public.plan_template_applications;
  v_preview  jsonb;
  v_result   jsonb;
  v_app      uuid;
begin
  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not public.can_edit_plan(p_plan_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  v_request := md5(jsonb_build_object(
    'plan', p_plan_id, 'revision', p_revision_id, 'mode', p_mode, 'components', to_jsonb(p_components),
    'times', coalesce(p_times, '[]'::jsonb), 'insert_at', p_insert_at)::text);

  if p_idempotency_key is not null then
    if char_length(p_idempotency_key) not between 8 and 200 then
      perform private.f10_bad('The request key must be 8 to 200 characters');
    end if;
    -- Serializes retries of one key; the loser sees the winner's row.
    perform pg_advisory_xact_lock(hashtextextended('f10:' || v_plan.organization_id || ':' || p_idempotency_key, 0));
    select * into v_existing from public.plan_template_applications
     where organization_id = v_plan.organization_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash <> v_request then
        raise exception 'That request key was used for a different change' using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      return jsonb_build_object(
        'application_id', v_existing.id, 'replayed', true, 'result', v_existing.result,
        'content_revision', (select content_revision from public.plans where id = p_plan_id));
    end if;
  end if;

  select * into v_plan from public.plans where id = p_plan_id for update;
  if p_expected_revision is not null and p_expected_revision <> v_plan.content_revision then
    raise exception 'This plan changed since you previewed the template' using errcode = 'PT409', hint = 'plan_changed';
  end if;
  select timezone into v_tz from public.organizations where id = v_plan.organization_id;
  v_preview := private.plan_template_preview(
    v_plan.organization_id, v_plan.service_type_id, v_plan.id, (v_plan.service_date at time zone v_tz)::date,
    p_revision_id, p_mode, p_components, p_times, p_insert_at);
  if p_preview_hash is null or p_preview_hash <> md5(v_preview::text) then
    raise exception 'What this template would change is different now. Review it again.'
      using errcode = 'PT409', hint = 'template_preview_changed';
  end if;
  if jsonb_array_length(v_preview -> 'blocking') > 0 then
    perform private.f10_bad(v_preview #>> '{blocking,0,message}');
  end if;

  v_result := private.plan_template_write(v_plan.id, v_preview, p_conflict_override_reason);

  insert into public.plan_template_applications (
    organization_id, plan_id, template_id, template_revision_id, template_name, template_kind,
    template_revision, mode, components, idempotency_key, request_hash, result, created_by
  ) values (
    v_plan.organization_id, v_plan.id, (v_preview #>> '{template,id}')::uuid, p_revision_id,
    v_preview #>> '{template,name}', v_preview #>> '{template,kind}', (v_preview #>> '{template,revision}')::int,
    p_mode, p_components, p_idempotency_key, v_request, v_result, (select auth.uid())
  ) returning id into v_app;

  return jsonb_build_object(
    'application_id', v_app, 'replayed', false, 'result', v_result,
    'content_revision', (select content_revision from public.plans where id = v_plan.id));
end;
$$;

-- ------------------------------------------------------ bounded generation

-- p_plans: [{local_date 'YYYY-MM-DD', title, service_date, times:[{starts_at, ends_at}]}]
-- resolved by the API from the template's wall-clock times in the
-- organization's timezone; each is re-verified against that intent here.
create or replace function private.plan_generation_preview(
  p_org         uuid,
  p_revision_id uuid,
  p_components  text[],
  p_plans       jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tpl     public.plan_templates;
  v_tz      text;
  v_el      jsonb;
  v_date    date;
  v_service timestamptz;
  v_title   text;
  v_rows    jsonb := '[]'::jsonb;
  v_preview jsonb;
  v_dates   date[] := '{}';
begin
  select t.* into v_tpl
    from public.plan_template_revisions r join public.plan_templates t on t.id = r.template_id
   where r.id = p_revision_id and t.organization_id = p_org;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.kind <> 'plan' then
    perform private.f10_bad('Only a plan template can create plans');
  end if;
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) not between 1 and 12 then
    perform private.f10_bad('Create between 1 and 12 plans at a time');
  end if;
  select timezone into v_tz from public.organizations where id = p_org;

  for v_el in select value from jsonb_array_elements(p_plans) loop
    begin
      v_date := (v_el ->> 'local_date')::date;
      v_service := (v_el ->> 'service_date')::timestamptz;
    exception when others then
      perform private.f10_bad('Each plan needs a date');
    end;
    if v_date is null or v_service is null or (v_service at time zone v_tz)::date <> v_date then
      perform private.f10_bad('Preview the dates again');
    end if;
    if v_date = any(v_dates) then
      perform private.f10_bad(format('%s is listed twice', v_date));
    end if;
    v_dates := v_dates || v_date;
    v_title := nullif(btrim(v_el ->> 'title'), '');
    if v_title is null or char_length(v_title) > 200 then
      perform private.f10_bad('Each plan needs a title of at most 200 characters');
    end if;
    v_preview := private.plan_template_preview(
      p_org, v_tpl.service_type_id, null, v_date, p_revision_id, 'append',
      array(select distinct c from unnest(p_components || array['times']) c order by c),
      coalesce(v_el -> 'times', '[]'::jsonb), null);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'local_date', v_date, 'title', v_title, 'service_date', v_service, 'preview', v_preview,
      'existing_plans', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.service_date, p.id)
          from public.plans p
         where p.organization_id = p_org and p.service_type_id is not distinct from v_tpl.service_type_id
           and (p.service_date at time zone v_tz)::date = v_date
      ), '[]'::jsonb)));
  end loop;

  return jsonb_build_object(
    'template_id', v_tpl.id, 'service_type_id', v_tpl.service_type_id, 'revision_id', p_revision_id,
    'timezone', v_tz, 'plans', v_rows);
end;
$$;

create or replace function public.preview_plan_generation(
  p_organization_id uuid,
  p_revision_id     uuid,
  p_components      text[],
  p_plans           jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_preview jsonb := private.plan_generation_preview(p_organization_id, p_revision_id, p_components, p_plans);
begin
  return v_preview || jsonb_build_object('preview_hash', md5(v_preview::text));
end;
$$;

create or replace function public.generate_plans_from_template(
  p_organization_id          uuid,
  p_revision_id              uuid,
  p_components               text[],
  p_plans                    jsonb,
  p_preview_hash             text,
  p_idempotency_key          text,
  p_series                   jsonb default '{}'::jsonb,
  p_conflict_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_request  text;
  v_existing public.plan_generation_batches;
  v_preview  jsonb;
  v_row      jsonb;
  v_batch    uuid := gen_random_uuid();
  v_plan     uuid;
  v_ids      uuid[] := '{}';
  v_result   jsonb;
  v_comps    text[] := array(select distinct c from unnest(p_components || array['times']) c order by c);
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    perform private.f10_bad('A request key of 8 to 200 characters is required');
  end if;
  v_request := md5(jsonb_build_object(
    'revision', p_revision_id, 'components', to_jsonb(v_comps), 'plans', p_plans)::text);
  perform pg_advisory_xact_lock(hashtextextended('f10:' || p_organization_id || ':' || p_idempotency_key, 0));
  select * into v_existing from public.plan_generation_batches
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request then
      raise exception 'That request key was used for a different batch' using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('batch_id', v_existing.id, 'plan_ids', to_jsonb(v_existing.plan_ids), 'replayed', true);
  end if;

  v_preview := private.plan_generation_preview(p_organization_id, p_revision_id, v_comps, p_plans);
  if p_preview_hash is null or p_preview_hash <> md5(v_preview::text) then
    raise exception 'The template or the dates changed. Review the plans again.'
      using errcode = 'PT409', hint = 'template_preview_changed';
  end if;

  for v_row in select value from jsonb_array_elements(v_preview -> 'plans') loop
    if jsonb_array_length(v_row #> '{preview,blocking}') > 0 then
      perform private.f10_bad(format('%s: %s', v_row ->> 'local_date', v_row #>> '{preview,blocking,0,message}'));
    end if;
    insert into public.plans (organization_id, service_type_id, title, service_date, status, created_by)
    values (p_organization_id, (v_preview ->> 'service_type_id')::uuid, v_row ->> 'title',
            (v_row ->> 'service_date')::timestamptz, 'draft', v_uid)
    returning id into v_plan;
    v_result := private.plan_template_write(v_plan, v_row -> 'preview', p_conflict_override_reason);
    insert into public.plan_template_applications (
      organization_id, plan_id, template_id, template_revision_id, template_name, template_kind,
      template_revision, batch_id, mode, components, request_hash, result, created_by
    ) values (
      p_organization_id, v_plan, (v_preview ->> 'template_id')::uuid, p_revision_id,
      v_row #>> '{preview,template,name}', 'plan', (v_row #>> '{preview,template,revision}')::int,
      v_batch, 'append', v_comps, v_request, v_result, v_uid
    );
    v_ids := v_ids || v_plan;
  end loop;

  insert into public.plan_generation_batches (
    id, organization_id, template_id, template_revision_id, idempotency_key, request_hash, series, plan_ids, created_by
  ) values (
    v_batch, p_organization_id, (v_preview ->> 'template_id')::uuid, p_revision_id, p_idempotency_key,
    v_request, coalesce(p_series, '{}'::jsonb), v_ids, v_uid
  );

  return jsonb_build_object('batch_id', v_batch, 'plan_ids', to_jsonb(v_ids), 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------- grants ---

revoke execute on function private.f10_bad(text) from public, anon;
revoke execute on function private.f10_int(jsonb, int, int, text) from public, anon;
revoke execute on function private.f10_text(jsonb, int, text) from public, anon;
revoke execute on function private.f10_uuid(jsonb, text) from public, anon;
revoke execute on function private.plan_template_normalize(uuid, text, jsonb) from public, anon;
revoke execute on function private.plan_template_content_from_plan(uuid, text[]) from public, anon;
revoke execute on function private.plan_template_preview(uuid, uuid, uuid, date, uuid, text, text[], jsonb, int) from public, anon;
revoke execute on function private.plan_template_write(uuid, jsonb, text) from public, anon;
revoke execute on function private.plan_generation_preview(uuid, uuid, text[], jsonb) from public, anon;
grant execute on function private.f10_bad(text) to authenticated;
grant execute on function private.f10_int(jsonb, int, int, text) to authenticated;
grant execute on function private.f10_text(jsonb, int, text) to authenticated;
grant execute on function private.f10_uuid(jsonb, text) to authenticated;
grant execute on function private.plan_template_normalize(uuid, text, jsonb) to authenticated;
grant execute on function private.plan_template_content_from_plan(uuid, text[]) to authenticated;
grant execute on function private.plan_template_preview(uuid, uuid, uuid, date, uuid, text, text[], jsonb, int) to authenticated;
grant execute on function private.plan_template_write(uuid, jsonb, text) to authenticated;
grant execute on function private.plan_generation_preview(uuid, uuid, text[], jsonb) to authenticated;

revoke execute on function public.save_plan_template(uuid, uuid, int, text, uuid, text, text, jsonb, uuid, text[]) from public, anon;
revoke execute on function public.set_plan_template_archived(uuid, boolean) from public, anon;
revoke execute on function public.preview_plan_template_apply(uuid, uuid, text, text[], jsonb, int) from public, anon;
revoke execute on function public.apply_plan_template(uuid, uuid, text, text[], text, jsonb, int, bigint, text, text) from public, anon;
revoke execute on function public.preview_plan_generation(uuid, uuid, text[], jsonb) from public, anon;
revoke execute on function public.generate_plans_from_template(uuid, uuid, text[], jsonb, text, text, jsonb, text) from public, anon;
grant execute on function public.save_plan_template(uuid, uuid, int, text, uuid, text, text, jsonb, uuid, text[]) to authenticated;
grant execute on function public.set_plan_template_archived(uuid, boolean) to authenticated;
grant execute on function public.preview_plan_template_apply(uuid, uuid, text, text[], jsonb, int) to authenticated;
grant execute on function public.apply_plan_template(uuid, uuid, text, text[], text, jsonb, int, bigint, text, text) to authenticated;
grant execute on function public.preview_plan_generation(uuid, uuid, text[], jsonb) to authenticated;
grant execute on function public.generate_plans_from_template(uuid, uuid, text[], jsonb, text, text, jsonb, text) to authenticated;
