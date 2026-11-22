-- Richer plan items: service-time limits, long formatted details, and song
-- notes carried over from the song's last use.
--
-- * `plan_item_times` limits an item to some of its plan's SERVICE times. No
--   rows means the item belongs to every time. Both references are composite
--   (`(id, plan_id)`) so an item can only name a time of its own plan; a
--   trigger refuses rehearsal/other times, and a time that stops being a
--   service time drops out of every item's list. Deleting the item or the
--   time cascades. Readers of the plan order read the rows; plan editors
--   write them (the same rule as `plan_items`).
-- * `plan_items.details` is long Markdown text (at most 20,000 characters),
--   separate from the short `description`. Clients render it from text runs
--   only (shared parser), never as HTML. The public plan view does not
--   select it.
-- * `add_plan_item_with_details` / `update_plan_item_with_details` wrap the
--   F11 functions, so the item, its details, its times and (on add) the
--   carried notes are one transaction and one revision check. Wrapping
--   rather than redefining keeps whatever `add_plan_item`/`update_plan_item`
--   do now (validation, idempotency, plan lock).
-- * Carrying notes: the song's most recent earlier use is the latest plan of
--   the same service type dated before this plan that has an item for the
--   song (ties: plan id, then item position, then item id). Everything runs
--   as the caller, so plans and notes the caller cannot read are never found
--   or copied (RLS on `plans`, `plan_notes`, `plan_note_teams`).
-- * Copying a plan (duplicate / create-from / import / move) carries each
--   item's details and maps its times onto the copied (or matching) times;
--   a time with no counterpart is dropped.
-- * A Live run is one service time: its pinned snapshot leaves out items
--   limited to other times.

-- ============================================================== details ===

alter table public.plan_items
  add column details text,
  add constraint plan_items_details_length
    check (details is null or char_length(details) between 1 and 20000);

-- ========================================================= item ↔ times ===

create unique index if not exists plan_times_id_plan_key on public.plan_times (id, plan_id);
create unique index if not exists plan_items_id_plan_key on public.plan_items (id, plan_id);

create table public.plan_item_times (
  plan_id       uuid not null,
  plan_item_id  uuid not null,
  plan_time_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (plan_item_id, plan_time_id),
  constraint plan_item_times_plan_fk foreign key (plan_id)
    references public.plans (id) on delete cascade,
  constraint plan_item_times_item_fk foreign key (plan_item_id, plan_id)
    references public.plan_items (id, plan_id) on delete cascade,
  constraint plan_item_times_time_fk foreign key (plan_time_id, plan_id)
    references public.plan_times (id, plan_id) on delete cascade
);
-- The primary key serves item lookups; these serve time cascades and the
-- plan-scoped RLS checks / plan detail embed.
create index plan_item_times_time_idx on public.plan_item_times (plan_time_id);
create index plan_item_times_plan_idx on public.plan_item_times (plan_id);

comment on table public.plan_item_times is
  'Service times an item is limited to. No rows: the item belongs to every service time.';

-- Only a service time of the item's own plan (the composite keys are the
-- backstop for "own plan"; this gives the readable error first).
create or replace function private.validate_plan_item_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.plan_times t
     where t.id = new.plan_time_id and t.plan_id = new.plan_id and t.kind = 'service'
  ) then
    raise exception 'Choose a service time of this plan' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.validate_plan_item_time() from public, anon, authenticated;

create trigger plan_item_times_validate
  before insert or update on public.plan_item_times
  for each row execute function private.validate_plan_item_time();

-- A time changed to rehearsal/other no longer limits any item.
create or replace function private.drop_plan_item_times_for_non_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.plan_item_times where plan_time_id = new.id;
  return null;
end;
$$;
revoke execute on function private.drop_plan_item_times_for_non_service() from public, anon, authenticated;

create trigger plan_times_drop_item_limits
  after update of kind on public.plan_times
  for each row when (new.kind <> 'service')
  execute function private.drop_plan_item_times_for_non_service();

-- Part of the order: changing it moves the plan's content revision.
create trigger plan_item_times_bump_content_revision
  after insert or update or delete on public.plan_item_times
  for each row execute function private.bump_plan_content_revision();

alter table public.plan_item_times enable row level security;

create policy plan_item_times_select on public.plan_item_times
  for select to authenticated
  using ((select public.is_org_member(public.org_of_plan(plan_id))));
create policy plan_item_times_insert on public.plan_item_times
  for insert to authenticated
  with check ((select public.can_edit_plan(plan_id)));
create policy plan_item_times_delete on public.plan_item_times
  for delete to authenticated
  using ((select public.can_edit_plan(plan_id)));

revoke all on public.plan_item_times from anon;
revoke update, truncate on public.plan_item_times from authenticated;
grant select, insert, delete on public.plan_item_times to authenticated;
grant all on public.plan_item_times to service_role;

-- ============================================================ save paths ===

/**
 * Applies `details` and `time_ids` when the body has those keys (absent keys
 * are kept). `time_ids` is the full list; an empty list means every time.
 * Security invoker: the plan_items / plan_item_times policies decide.
 */
create or replace function private.apply_plan_item_extras(p_plan_id uuid, p_item_id uuid, p_body jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_times uuid[];
begin
  if p_body ? 'details' then
    update public.plan_items
       -- Blank is "no details"; otherwise kept as typed (Markdown indentation matters).
       set details = case when btrim(coalesce(p_body ->> 'details', '')) = '' then null else p_body ->> 'details' end,
           updated_at = now()
     where id = p_item_id and plan_id = p_plan_id;
  end if;

  if p_body ? 'time_ids' then
    if jsonb_typeof(p_body -> 'time_ids') is distinct from 'array' then
      raise exception 'Send the service times as a list' using errcode = '22023';
    end if;
    v_times := coalesce((
      select array_agg(distinct t.value::uuid) from jsonb_array_elements_text(p_body -> 'time_ids') t
    ), '{}');
    if cardinality(v_times) > 50 then
      raise exception 'Choose at most 50 service times' using errcode = '22023';
    end if;
    delete from public.plan_item_times
     where plan_item_id = p_item_id and plan_time_id <> all (v_times);
    insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
    select p_plan_id, p_item_id, t from unnest(v_times) t
    on conflict do nothing;
  end if;
end;
$$;
revoke execute on function private.apply_plan_item_extras(uuid, uuid, jsonb) from public, anon;
grant execute on function private.apply_plan_item_extras(uuid, uuid, jsonb) to authenticated, service_role;

/** The saved item with its time limits, as the API returns it. */
create or replace function private.plan_item_json(p_item_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(i) || jsonb_build_object('item_times', coalesce((
           select jsonb_agg(jsonb_build_object('plan_time_id', t.plan_time_id) order by t.plan_time_id)
             from public.plan_item_times t where t.plan_item_id = i.id
         ), '[]'::jsonb))
    from public.plan_items i where i.id = p_item_id;
$$;
revoke execute on function private.plan_item_json(uuid) from public, anon;
grant execute on function private.plan_item_json(uuid) to authenticated, service_role;

/**
 * `update_plan_item` plus `details` and `time_ids`, in one transaction and
 * one revision check. Returns `{ item, content_revision }`; the item carries
 * `item_times`.
 */
create or replace function public.update_plan_item_with_details(
  p_plan_id uuid,
  p_item_id uuid,
  p_patch jsonb,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Send the fields to change' using errcode = '22023';
  end if;
  -- Locks the plan, checks the revision and that the item is in the plan.
  perform public.update_plan_item(p_plan_id, p_item_id, p_patch - 'details' - 'time_ids', p_expected_revision);
  perform private.apply_plan_item_extras(p_plan_id, p_item_id, p_patch);
  return jsonb_build_object(
    'item', private.plan_item_json(p_item_id),
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;
revoke execute on function public.update_plan_item_with_details(uuid, uuid, jsonb, bigint) from public, anon;
grant execute on function public.update_plan_item_with_details(uuid, uuid, jsonb, bigint) to authenticated, service_role;

-- ========================================================= carried notes ===

/**
 * The song's most recent earlier use for a plan: the latest plan of the same
 * service type (and organization) dated before it with an item for the song.
 * Runs as the caller, so only plans the caller can read are considered.
 */
create or replace function private.song_previous_use(p_plan_id uuid, p_song_id uuid)
returns table (item_id uuid, plan_id uuid, plan_title text, service_date timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, p.id, p.title, p.service_date
    from public.plans cur
    join public.plans p
      on p.organization_id = cur.organization_id
     and p.service_type_id is not distinct from cur.service_type_id
     and p.service_date < cur.service_date
    join public.plan_items i on i.plan_id = p.id and i.song_id = p_song_id
   where cur.id = p_plan_id
   order by p.service_date desc, p.id desc, i.sort_order, i.id
   limit 1;
$$;
revoke execute on function private.song_previous_use(uuid, uuid) from public, anon;
grant execute on function private.song_previous_use(uuid, uuid) to authenticated, service_role;

/**
 * What "Bring notes from last time" would copy: the earlier use and how many
 * of its item notes the caller can read. Null when the song has no earlier
 * use in this service type.
 */
create or replace function public.song_last_use(p_plan_id uuid, p_song_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'plan_id', u.plan_id,
           'plan_title', u.plan_title,
           'service_date', u.service_date,
           'item_id', u.item_id,
           'note_count', (select count(*) from public.plan_notes n
                           where n.plan_id = u.plan_id and n.plan_item_id = u.item_id))
    from private.song_previous_use(p_plan_id, p_song_id) u;
$$;
revoke execute on function public.song_last_use(uuid, uuid) from public, anon;
grant execute on function public.song_last_use(uuid, uuid) to authenticated, service_role;

/**
 * Copies the item notes of the song's last use onto a new item: category
 * (dropped if archived since), audience, team targets and text. Only notes
 * the caller can read are seen. Returns `{ count, source_plan_id,
 * service_date }`, or null when there is no earlier use.
 */
create or replace function private.carry_song_notes(p_plan_id uuid, p_item_id uuid, p_song_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src record;
  v_note record;
  v_new uuid;
  v_count int := 0;
  v_org uuid;
begin
  select * into v_src from private.song_previous_use(p_plan_id, p_song_id);
  if not found then
    return null;
  end if;
  select organization_id into v_org from public.plans where id = p_plan_id;

  for v_note in
    select n.id, n.category_id, n.audience, n.body
      from public.plan_notes n
     where n.plan_id = v_src.plan_id and n.plan_item_id = v_src.item_id
     order by n.created_at, n.id
  loop
    -- A team note whose teams the caller cannot see (or that lost them) is skipped.
    if v_note.audience = 'teams'
       and not exists (select 1 from public.plan_note_teams nt where nt.note_id = v_note.id) then
      continue;
    end if;
    insert into public.plan_notes (organization_id, plan_id, plan_item_id, category_id, audience, body, created_by, updated_by)
    values (
      v_org, p_plan_id, p_item_id,
      case when exists (select 1 from public.note_categories c where c.id = v_note.category_id and c.archived_at is null)
           then v_note.category_id end,
      v_note.audience, v_note.body, (select auth.uid()), (select auth.uid()))
    returning id into v_new;
    -- A separate statement per note, so the team policy sees the new note.
    insert into public.plan_note_teams (note_id, organization_id, team_id)
    select v_new, v_org, nt.team_id from public.plan_note_teams nt where nt.note_id = v_note.id
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('count', v_count, 'source_plan_id', v_src.plan_id, 'service_date', v_src.service_date);
end;
$$;
revoke execute on function private.carry_song_notes(uuid, uuid, uuid) from public, anon;
grant execute on function private.carry_song_notes(uuid, uuid, uuid) to authenticated, service_role;

/**
 * `add_plan_item` plus `details`, `time_ids` and, for a song with
 * `carry_notes_from_last_use: true`, the notes of its last use — one
 * transaction. The whole body (these keys included) is what an idempotency
 * key is compared against; a replay returns the first item and copies
 * nothing again. Returns `{ item, content_revision, replayed, carried_notes }`.
 */
create or replace function public.add_plan_item_with_details(
  p_plan_id uuid,
  p_item jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_item_id uuid;
  v_carried jsonb;
begin
  v_result := public.add_plan_item(p_plan_id, p_item, p_idempotency_key);
  v_item_id := (v_result -> 'item' ->> 'id')::uuid;
  if not coalesce((v_result ->> 'replayed')::boolean, false) then
    perform private.apply_plan_item_extras(p_plan_id, v_item_id, p_item);
    if jsonb_typeof(p_item -> 'carry_notes_from_last_use') = 'boolean'
       and (p_item ->> 'carry_notes_from_last_use')::boolean
       and v_result -> 'item' ->> 'item_type' = 'song' then
      v_carried := private.carry_song_notes(p_plan_id, v_item_id, (v_result -> 'item' ->> 'song_id')::uuid);
    end if;
  end if;
  return jsonb_build_object(
    'item', private.plan_item_json(v_item_id),
    'content_revision', (select content_revision from public.plans where id = p_plan_id),
    'replayed', coalesce((v_result ->> 'replayed')::boolean, false),
    'carried_notes', v_carried);
end;
$$;
revoke execute on function public.add_plan_item_with_details(uuid, jsonb, text) from public, anon;
grant execute on function public.add_plan_item_with_details(uuid, jsonb, text) to authenticated, service_role;

-- ============================================================== copying ===

/**
 * After `copy_plan_children` appended the source's items at `p_base`, gives
 * each copy its source item's time limits through `p_time_map` (source time
 * id → target time id). A limit with no counterpart is dropped.
 */
create or replace function private.copy_plan_item_times(
  p_source uuid,
  p_target uuid,
  p_base int,
  p_time_map jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  with source_items as (
    select i.id, (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1 as n
      from public.plan_items i where i.plan_id = p_source
  ), pairs as (
    select s.id as source_id, t.id as target_id
      from source_items s
      join public.plan_items t on t.plan_id = p_target and t.sort_order = p_base + s.n
  )
  insert into public.plan_item_times (plan_id, plan_item_id, plan_time_id)
  select p_target, pr.target_id, (p_time_map ->> pit.plan_time_id::text)::uuid
    from pairs pr
    join public.plan_item_times pit on pit.plan_item_id = pr.source_id
   where p_time_map ? pit.plan_time_id::text
     and exists (select 1 from public.plan_times tt
                  where tt.id = (p_time_map ->> pit.plan_time_id::text)::uuid
                    and tt.plan_id = p_target and tt.kind = 'service')
  on conflict do nothing;
$$;
revoke execute on function private.copy_plan_item_times(uuid, uuid, int, jsonb) from public, anon;
grant execute on function private.copy_plan_item_times(uuid, uuid, int, jsonb) to authenticated, service_role;

-- Same as 20261126000300_w7f_copy_without_people_visibility, plus: items
-- carry `details`, and their time limits follow the time mapping.
create or replace function private.copy_plan_children(
  p_source       uuid,
  p_target       uuid,
  p_items        boolean,
  p_needs        boolean,
  p_assignments  boolean,
  p_time_offset  interval
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base int;
  v_map jsonb := '{}'::jsonb;
  v_source_date timestamptz;
  v_target_date timestamptz;
  v_people uuid[];
  v_selected jsonb;
  v_active_people uuid[] := private.plan_active_people(p_source);
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order,
      sequence_override, leader_person_id, leader_position_id, service_segment, media_id, details
    )
    -- A legacy row naming another song's arrangement copies as "no
    -- arrangement chosen" instead of failing the whole copy.
    select p_target, i.item_type, i.title, i.song_id,
           case when i.item_type = 'song' and exists (
             select 1 from public.arrangements a where a.id = i.arrangement_id and a.song_id = i.song_id
           ) then i.arrangement_id end,
           i.key_override,
           i.length_seconds, i.description,
           v_base + (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1,
           case when i.item_type = 'song' then i.sequence_override end,
           case when i.leader_person_id = any(v_active_people) then i.leader_person_id end,
           case when exists (select 1 from public.team_positions tp where tp.id = i.leader_position_id and tp.plan_id is null)
                then i.leader_position_id end,
           i.service_segment,
           -- F14: media carries over unless it was archived since (pickers hide it too).
           case when i.item_type = 'item' and exists (
             select 1 from public.media m where m.id = i.media_id and not private.media_is_archived(m)
           ) then i.media_id end,
           i.details
      from public.plan_items i
     where i.plan_id = p_source;
  end if;

  if p_time_offset is not null then
    with source_times as (
      select t.*, gen_random_uuid() new_id from public.plan_times t where t.plan_id = p_source
    ), copied as (
      insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order)
      select s.new_id, p_target, s.kind, s.name, s.starts_at + p_time_offset, s.ends_at + p_time_offset, s.sort_order
        from source_times s
      returning id
    )
    select coalesce(jsonb_object_agg(s.id::text, s.new_id), '{}'::jsonb) into v_map
      from source_times s where s.new_id in (select id from copied);
  else
    select service_date into v_source_date from public.plans where id = p_source;
    select service_date into v_target_date from public.plans where id = p_target;
    select coalesce(jsonb_object_agg(s.id::text, m.id), '{}'::jsonb) into v_map
      from public.plan_times s
      cross join lateral (
        select t.id from public.plan_times t
         where t.plan_id = p_target and t.kind = s.kind
           and coalesce(t.name, '') = coalesce(s.name, '')
           and t.starts_at - v_target_date = s.starts_at - v_source_date
           and t.ends_at - t.starts_at = s.ends_at - s.starts_at
         order by t.sort_order, t.id limit 1
      ) m
     where s.plan_id = p_source;
  end if;

  if p_items then
    perform private.copy_plan_item_times(p_source, p_target, v_base, v_map);
  end if;

  if p_needs then
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_target, n.position_id, n.needed
      from public.plan_position_needs n
      join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
     where n.plan_id = p_source and n.needed > 0
       and (public.can_edit_plan(p_target)
            or public.can_schedule_on_plan(p_target, private.position_team(n.position_id)))
    on conflict (plan_id, position_id) do nothing;
  end if;

  if p_assignments then
    select coalesce(array_agg(distinct a.person_id), '{}') into v_people
      from public.assignments a where a.plan_id = p_source;
    perform private.lock_scheduling_people(v_people);

    with eligible as (
      select a.*,
             case when a.attendance_mode = 'selected' then array(
               select (v_map->>aat.plan_time_id::text)::uuid
                 from public.assignment_attendance_times aat
                where aat.assignment_id = a.id and v_map ? aat.plan_time_id::text
             ) end mapped_times
        from public.assignments a
       where a.plan_id = p_source
         and exists (select 1 from private.resolve_scheduling_person(p_target, a.person_id, null))
         and (a.position_id is null
              or exists (select 1 from public.team_positions tp where tp.id = a.position_id and tp.plan_id is null))
         and public.can_schedule_on_plan(p_target, a.team_id)
    ), inserted as (
      insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by, attendance_mode)
      select p_target, e.person_id, e.team_id, e.position_id, 'unconfirmed', (select auth.uid()), e.attendance_mode
        from eligible e
       where e.attendance_mode = 'all' or cardinality(e.mapped_times) > 0
      on conflict do nothing
      returning id, person_id, team_id, position_id
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'times', to_jsonb(e.mapped_times))), '[]'::jsonb)
      into v_selected
      from inserted i
      join eligible e on e.person_id = i.person_id and e.team_id = i.team_id
                     and e.position_id is not distinct from i.position_id
     where e.attendance_mode = 'selected';

    -- A separate statement: the policy on selections must see the new rows.
    insert into public.assignment_attendance_times (assignment_id, plan_time_id)
    select (x->>'id')::uuid, t.id::uuid
      from jsonb_array_elements(v_selected) x
      cross join jsonb_array_elements_text(x->'times') t(id)
    on conflict do nothing;

    perform private.check_pending_conflicts();
  end if;
end;
$$;

-- ================================================================= live ===

-- A run is one service time: when its snapshot is pinned (create, or refresh
-- while ready), items limited to other times are left out.
create or replace function private.live_run_snapshot_for_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan_time_id is null
     or (tg_op = 'UPDATE' and new.snapshot is not distinct from old.snapshot) then
    return new;
  end if;
  new.snapshot := coalesce((
    select jsonb_agg(x.item order by x.ord)
      from jsonb_array_elements(new.snapshot) with ordinality x(item, ord)
     where not exists (
             select 1 from public.plan_item_times pit where pit.plan_item_id = (x.item ->> 'id')::uuid)
        or exists (
             select 1 from public.plan_item_times pit
              where pit.plan_item_id = (x.item ->> 'id')::uuid and pit.plan_time_id = new.plan_time_id)
  ), '[]'::jsonb);
  return new;
end;
$$;
revoke execute on function private.live_run_snapshot_for_time() from public, anon, authenticated;

create trigger live_runs_snapshot_for_time
  before insert or update of snapshot on public.live_runs
  for each row execute function private.live_run_snapshot_for_time();
