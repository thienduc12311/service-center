-- F06 — versioned team rotations, immutable staffing-proposal snapshots and
-- an atomic, idempotent commit that creates PREPARED requests only.
--
-- Access model
--   * Rotations: readable by people who may schedule that team; written only
--     through `save_team_rotation` / `archive_team_rotation` (definer, re-checks
--     `scheduling.manage` for the team and validates every position/person).
--   * Proposals: private to their author. The author may insert a draft and
--     update reviewer edits/results (column grants), but the snapshot, seed,
--     rule version, input hash and base revisions are immutable, and only
--     `commit_staffing_proposal` may mark a proposal committed. The commit does
--     not trust the stored snapshot: it re-verifies plan revisions, rotation
--     revisions, position membership, archive state, capabilities and (via the
--     F04 deferred triggers) conflicts against live rows under sorted locks.

-- ------------------------------------------------------------- helpers --

create or replace function public.can_schedule_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = '' as $$
  select private.can_schedule_team((select auth.uid()), p_team);
$$;
revoke execute on function public.can_schedule_team(uuid) from public, anon;
grant execute on function public.can_schedule_team(uuid) to authenticated;

-- ----------------------------------------------------------- rotations --

create table public.team_rotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  cycle_weeks smallint not null check (cycle_weeks between 1 and 12),
  -- A civil date in the organization's IANA zone; week k covers anchor + 7k .. +7k+6.
  anchor_date date not null,
  substitute_policy text not null default 'vacancy' check (substitute_policy in ('vacancy','fairness')),
  revision bigint not null default 1,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index team_rotations_active_name_key
  on public.team_rotations (team_id, lower(name)) where archived_at is null;
create index team_rotations_org_idx on public.team_rotations (organization_id);
create index team_rotations_created_by_idx on public.team_rotations (created_by);

comment on table public.team_rotations is
  'F06 repeating Person/position pattern for one team. Suggests choices only; never bypasses membership or conflicts.';

create table public.team_rotation_slots (
  rotation_id uuid not null references public.team_rotations(id) on delete cascade,
  week_index smallint not null check (week_index between 0 and 11),
  position_id uuid not null references public.team_positions(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (rotation_id, week_index, position_id, person_id)
);
create index team_rotation_slots_position_idx on public.team_rotation_slots (position_id);
create index team_rotation_slots_person_idx on public.team_rotation_slots (person_id);

create table public.team_rotation_exceptions (
  id uuid primary key default gen_random_uuid(),
  rotation_id uuid not null references public.team_rotations(id) on delete cascade,
  local_date date not null,
  position_id uuid not null references public.team_positions(id) on delete cascade,
  -- NULL = skip the rotation that date for this position (fairness decides).
  person_id uuid references public.people(id) on delete cascade,
  note text check (note is null or char_length(note) <= 200),
  unique nulls not distinct (rotation_id, local_date, position_id, person_id)
);
create index team_rotation_exceptions_position_idx on public.team_rotation_exceptions (position_id);
create index team_rotation_exceptions_person_idx on public.team_rotation_exceptions (person_id);

create table public.team_rotation_versions (
  rotation_id uuid not null references public.team_rotations(id) on delete cascade,
  revision bigint not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  saved_by uuid references public.profiles(id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (rotation_id, revision)
);
create index team_rotation_versions_saved_by_idx on public.team_rotation_versions (saved_by);

alter table public.team_rotations enable row level security;
alter table public.team_rotation_slots enable row level security;
alter table public.team_rotation_exceptions enable row level security;
alter table public.team_rotation_versions enable row level security;

create policy team_rotations_select on public.team_rotations
  for select to authenticated using ((select public.can_schedule_team(team_id)));
create policy team_rotation_slots_select on public.team_rotation_slots
  for select to authenticated using (exists (
    select 1 from public.team_rotations r where r.id = rotation_id and (select public.can_schedule_team(r.team_id))));
create policy team_rotation_exceptions_select on public.team_rotation_exceptions
  for select to authenticated using (exists (
    select 1 from public.team_rotations r where r.id = rotation_id and (select public.can_schedule_team(r.team_id))));
create policy team_rotation_versions_select on public.team_rotation_versions
  for select to authenticated using (exists (
    select 1 from public.team_rotations r where r.id = rotation_id and (select public.can_schedule_team(r.team_id))));

revoke all on public.team_rotations, public.team_rotation_slots,
  public.team_rotation_exceptions, public.team_rotation_versions from anon, authenticated;
grant select on public.team_rotations, public.team_rotation_slots,
  public.team_rotation_exceptions, public.team_rotation_versions to authenticated;

/**
 * Create (p_rotation_id null) or replace a rotation's whole definition.
 * Expected revision guards competing edits; every save appends a version.
 */
create or replace function public.save_team_rotation(
  p_rotation_id uuid,
  p_team_id uuid,
  p_expected_revision bigint,
  p_name text,
  p_cycle_weeks integer,
  p_anchor_date date,
  p_substitute_policy text,
  p_slots jsonb,
  p_exceptions jsonb
)
returns public.team_rotations
language plpgsql
security definer
set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_team public.teams;
  v_rotation public.team_rotations;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_slots, '[]')) <> 'array' or jsonb_typeof(coalesce(p_exceptions, '[]')) <> 'array' then
    raise exception 'Slots and exceptions must be lists' using errcode = '22023';
  end if;
  if p_cycle_weeks not between 1 and 12 then
    raise exception 'A rotation cycle is 1 to 12 weeks' using errcode = '22023';
  end if;

  if p_rotation_id is null then
    select * into v_team from public.teams where id = p_team_id;
  else
    select * into v_rotation from public.team_rotations where id = p_rotation_id for update;
    if v_rotation.id is null then raise exception 'Rotation not found' using errcode = 'P0002'; end if;
    select * into v_team from public.teams where id = v_rotation.team_id;
  end if;
  if v_team.id is null or not private.can_schedule_team(v_actor, v_team.id) then
    raise exception 'You cannot manage rotations for this team' using errcode = '42501';
  end if;
  if v_rotation.id is not null then
    if v_rotation.archived_at is not null then
      raise exception 'This rotation is archived' using errcode = 'PT409', hint = 'rotation_changed';
    end if;
    if v_rotation.revision <> p_expected_revision then
      raise exception 'The rotation changed since you opened it' using errcode = 'PT409', hint = 'rotation_changed';
    end if;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_slots, '[]')) as s(week_index int, position_id uuid, person_id uuid)
     where s.week_index is null or s.week_index < 0 or s.week_index >= p_cycle_weeks
        or not exists (select 1 from public.team_positions tp where tp.id = s.position_id and tp.team_id = v_team.id)
        or not exists (select 1 from public.people p where p.id = s.person_id and p.organization_id = v_team.organization_id)
  ) or exists (
    select 1 from jsonb_to_recordset(coalesce(p_exceptions, '[]')) as e(local_date date, position_id uuid, person_id uuid)
     where e.local_date is null
        or not exists (select 1 from public.team_positions tp where tp.id = e.position_id and tp.team_id = v_team.id)
        or (e.person_id is not null and not exists (
             select 1 from public.people p where p.id = e.person_id and p.organization_id = v_team.organization_id))
  ) then
    raise exception 'Every slot and exception must use this team''s positions and people in this organization'
      using errcode = '22023';
  end if;

  if v_rotation.id is null then
    insert into public.team_rotations
      (organization_id, team_id, name, cycle_weeks, anchor_date, substitute_policy, created_by)
    values (v_team.organization_id, v_team.id, btrim(p_name), p_cycle_weeks, p_anchor_date,
            coalesce(p_substitute_policy, 'vacancy'), v_actor)
    returning * into v_rotation;
  else
    update public.team_rotations
       set name = btrim(p_name), cycle_weeks = p_cycle_weeks, anchor_date = p_anchor_date,
           substitute_policy = coalesce(p_substitute_policy, 'vacancy'),
           revision = revision + 1, updated_at = now()
     where id = v_rotation.id
    returning * into v_rotation;
    delete from public.team_rotation_slots where rotation_id = v_rotation.id;
    delete from public.team_rotation_exceptions where rotation_id = v_rotation.id;
  end if;

  insert into public.team_rotation_slots (rotation_id, week_index, position_id, person_id)
  select distinct v_rotation.id, s.week_index, s.position_id, s.person_id
    from jsonb_to_recordset(coalesce(p_slots, '[]')) as s(week_index int, position_id uuid, person_id uuid);
  insert into public.team_rotation_exceptions (rotation_id, local_date, position_id, person_id, note)
  select distinct on (e.local_date, e.position_id, e.person_id)
         v_rotation.id, e.local_date, e.position_id, e.person_id, nullif(btrim(e.note), '')
    from jsonb_to_recordset(coalesce(p_exceptions, '[]')) as e(local_date date, position_id uuid, person_id uuid, note text);

  insert into public.team_rotation_versions (rotation_id, revision, definition, saved_by)
  values (v_rotation.id, v_rotation.revision, jsonb_build_object(
    'name', v_rotation.name, 'cycle_weeks', v_rotation.cycle_weeks, 'anchor_date', v_rotation.anchor_date,
    'substitute_policy', v_rotation.substitute_policy,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('week_index', week_index, 'position_id', position_id, 'person_id', person_id)
                         order by week_index, position_id, person_id)
                         from public.team_rotation_slots where rotation_id = v_rotation.id), '[]'),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('local_date', local_date, 'position_id', position_id, 'person_id', person_id, 'note', note)
                         order by local_date, position_id, person_id)
                         from public.team_rotation_exceptions where rotation_id = v_rotation.id), '[]')
  ), v_actor);
  return v_rotation;
end;
$$;
revoke execute on function public.save_team_rotation(uuid, uuid, bigint, text, integer, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_team_rotation(uuid, uuid, bigint, text, integer, date, text, jsonb, jsonb) to authenticated;

create or replace function public.archive_team_rotation(p_rotation_id uuid, p_expected_revision bigint)
returns public.team_rotations
language plpgsql
security definer
set search_path = '' as $$
declare v_rotation public.team_rotations;
begin
  select * into v_rotation from public.team_rotations where id = p_rotation_id for update;
  if v_rotation.id is null or not private.can_schedule_team((select auth.uid()), v_rotation.team_id) then
    raise exception 'Rotation not found' using errcode = 'P0002';
  end if;
  if v_rotation.archived_at is not null then return v_rotation; end if;
  if v_rotation.revision <> p_expected_revision then
    raise exception 'The rotation changed since you opened it' using errcode = 'PT409', hint = 'rotation_changed';
  end if;
  update public.team_rotations set archived_at = now(), revision = revision + 1, updated_at = now()
   where id = p_rotation_id returning * into v_rotation;
  return v_rotation;
end;
$$;
revoke execute on function public.archive_team_rotation(uuid, bigint) from public, anon;
grant execute on function public.archive_team_rotation(uuid, bigint) to authenticated;

-- ----------------------------------------------------------- proposals --

create table public.staffing_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','committed','superseded')),
  revision bigint not null default 0,
  rule_version text not null check (char_length(rule_version) between 1 and 40),
  seed text not null check (seed ~ '^[A-Za-z0-9_-]{4,64}$'),
  lookback_days integer not null check (lookback_days between 7 and 365),
  plan_ids uuid[] not null check (cardinality(plan_ids) between 1 and 12),
  team_ids uuid[] not null check (cardinality(team_ids) between 1 and 20),
  -- [{plan_id, staffing_revision}] captured with the snapshot.
  base_revisions jsonb not null check (jsonb_typeof(base_revisions) = 'array'),
  -- [{rotation_id, revision}] used by the snapshot.
  rotation_versions jsonb not null default '[]' check (jsonb_typeof(rotation_versions) = 'array'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  input_hash text not null default '' ,
  edits jsonb not null default '{"locks":[],"exclusions":[]}' check (jsonb_typeof(edits) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  expires_at timestamptz not null default now() + interval '24 hours',
  superseded_by uuid references public.staffing_proposals(id) on delete set null,
  commit_key text check (commit_key is null or char_length(commit_key) between 8 and 200),
  committed_at timestamptz,
  commit_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staffing_proposals_commit_shape check (
    (status = 'committed') = (committed_at is not null and commit_key is not null and commit_result is not null))
);
create index staffing_proposals_author_idx
  on public.staffing_proposals (organization_id, author_id, created_at desc);
create index staffing_proposals_superseded_by_idx on public.staffing_proposals (superseded_by);
create index staffing_proposals_author_id_idx on public.staffing_proposals (author_id);

comment on table public.staffing_proposals is
  'F06 reviewed staffing proposals. Snapshot/seed/rule version are immutable; preview has no staffing or delivery effects.';

create or replace function private.guard_staffing_proposal()
returns trigger
language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- The hash is computed here, never accepted from the client.
    new.input_hash := encode(extensions.digest(
      new.snapshot::text || '|' || new.rule_version || '|' || new.seed, 'sha256'), 'hex');
    if new.status <> 'draft' or new.revision <> 0 or new.commit_key is not null
       or new.committed_at is not null or new.commit_result is not null or new.superseded_by is not null then
      raise exception 'A proposal starts as an uncommitted draft' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.snapshot is distinct from old.snapshot or new.input_hash is distinct from old.input_hash
     or new.seed is distinct from old.seed or new.rule_version is distinct from old.rule_version
     or new.base_revisions is distinct from old.base_revisions or new.plan_ids is distinct from old.plan_ids
     or new.team_ids is distinct from old.team_ids or new.rotation_versions is distinct from old.rotation_versions
     or new.organization_id is distinct from old.organization_id or new.author_id is distinct from old.author_id
     or new.lookback_days is distinct from old.lookback_days or new.expires_at is distinct from old.expires_at then
    raise exception 'A proposal snapshot is immutable; refresh to create a new proposal' using errcode = 'PT409', hint = 'proposal_changed';
  end if;
  if old.status <> 'draft' then
    raise exception 'This proposal is no longer a draft' using errcode = 'PT409', hint = 'proposal_changed';
  end if;
  if new.status = 'committed' and coalesce(current_setting('f06.committing', true), '') <> new.id::text then
    raise exception 'Commit a proposal through commit_staffing_proposal' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger staffing_proposals_guard
  before insert or update on public.staffing_proposals
  for each row execute function private.guard_staffing_proposal();

alter table public.staffing_proposals enable row level security;
create policy staffing_proposals_author_select on public.staffing_proposals
  for select to authenticated
  using (author_id = (select auth.uid()) and (select public.is_org_member(organization_id)));
create policy staffing_proposals_author_insert on public.staffing_proposals
  for insert to authenticated
  with check (author_id = (select auth.uid())
    and (select public.has_capability_anywhere(organization_id, 'scheduling.manage')));
create policy staffing_proposals_author_update on public.staffing_proposals
  for update to authenticated
  using (author_id = (select auth.uid()) and status = 'draft'
    and (select public.has_capability_anywhere(organization_id, 'scheduling.manage')))
  with check (author_id = (select auth.uid()));

revoke all on public.staffing_proposals from anon, authenticated;
grant select on public.staffing_proposals to authenticated;
grant insert (organization_id, author_id, rule_version, seed, lookback_days, plan_ids, team_ids,
  base_revisions, rotation_versions, snapshot, edits, result) on public.staffing_proposals to authenticated;
grant update (edits, result, revision, status, superseded_by) on public.staffing_proposals to authenticated;

/**
 * Atomically create the reviewed proposal's new choices as PREPARED requests.
 * Idempotent per (proposal, key). Stale plans, rotations, membership or a new
 * conflict abort the whole commit — nothing partial, nothing released, nothing
 * delivered. Release is a separate, explicit action.
 */
create or replace function public.commit_staffing_proposal(
  p_proposal_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_proposal public.staffing_proposals;
  v_choice jsonb;
  v_index integer := 0;
  v_created public.assignments;
  v_ids uuid[] := '{}';
  v_before integer;
  v_people uuid[];
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_proposal from public.staffing_proposals
   where id = p_proposal_id and author_id = v_actor for update;
  if v_proposal.id is null or not public.is_org_member(v_proposal.organization_id) then
    raise exception 'Proposal not found' using errcode = 'P0002';
  end if;
  if v_proposal.status = 'committed' then
    if v_proposal.commit_key = p_idempotency_key then return v_proposal.commit_result; end if;
    raise exception 'This proposal was already committed' using errcode = 'PT409', hint = 'proposal_changed';
  end if;
  if v_proposal.status = 'superseded' then
    raise exception 'This proposal was replaced by a refreshed one' using errcode = 'PT409', hint = 'proposal_stale';
  end if;
  if v_proposal.revision <> p_expected_revision then
    raise exception 'The proposal changed since you reviewed it' using errcode = 'PT409', hint = 'proposal_changed';
  end if;
  if v_proposal.expires_at <= now() then
    raise exception 'This proposal expired. Refresh it to recompute from current staffing.'
      using errcode = 'PT409', hint = 'proposal_expired';
  end if;

  -- Sorted plan locks (same order as F05), then compare every input revision.
  perform 1 from public.plans p where p.id = any(v_proposal.plan_ids) order by p.id for update;
  if (select count(*) from public.plans p
       where p.id = any(v_proposal.plan_ids) and p.organization_id = v_proposal.organization_id)
       <> cardinality(v_proposal.plan_ids)
     or exists (
       select 1 from jsonb_to_recordset(v_proposal.base_revisions) as r(plan_id uuid, staffing_revision bigint)
         left join public.plans p on p.id = r.plan_id
        where p.id is null or p.staffing_revision <> r.staffing_revision)
     or (select count(*) from jsonb_to_recordset(v_proposal.base_revisions) as r(plan_id uuid, staffing_revision bigint))
        <> cardinality(v_proposal.plan_ids) then
    raise exception 'Staffing changed since this proposal was computed. Refresh and review again.'
      using errcode = 'PT409', hint = 'proposal_stale';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_proposal.rotation_versions) as r(rotation_id uuid, revision bigint)
      left join public.team_rotations t on t.id = r.rotation_id
     where t.id is null or t.revision <> r.revision or t.archived_at is not null
  ) then
    raise exception 'A rotation changed since this proposal was computed. Refresh and review again.'
      using errcode = 'PT409', hint = 'proposal_stale';
  end if;

  -- Validate every new choice before the first write.
  for v_choice in
    select value from jsonb_array_elements(v_proposal.result->'choices') where value->>'source' <> 'existing'
  loop
    if not ((v_choice->>'plan_id')::uuid = any(v_proposal.plan_ids))
       or not ((v_choice->>'team_id')::uuid = any(v_proposal.team_ids)) then
      raise exception 'A proposed choice is outside the reviewed scope' using errcode = '22023';
    end if;
    if not public.can_schedule_on_plan((v_choice->>'plan_id')::uuid, (v_choice->>'team_id')::uuid) then
      raise exception 'You can no longer schedule one of these teams' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.team_memberships tm
        join public.people p on p.id = tm.person_id
       where tm.team_id = (v_choice->>'team_id')::uuid
         and tm.position_id = (v_choice->>'position_id')::uuid
         and tm.person_id = (v_choice->>'person_id')::uuid
         and p.organization_id = v_proposal.organization_id
         and p.archived_at is null
    ) then
      raise exception 'Team membership changed since this proposal was computed. Refresh and review again.'
        using errcode = 'PT409', hint = 'proposal_stale';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(v_proposal.result->'choices') c
     where c->>'source' <> 'existing'
     group by c->>'plan_id', c->>'person_id' having count(*) > 1
  ) then
    raise exception 'A person is proposed twice on one plan' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct (c->>'person_id')::uuid), '{}') into v_people
    from jsonb_array_elements(v_proposal.result->'choices') c where c->>'source' <> 'existing';
  perform private.lock_scheduling_people(v_people);

  for v_choice in
    select value from jsonb_array_elements(v_proposal.result->'choices') where value->>'source' <> 'existing'
  loop
    v_index := v_index + 1;
    v_before := cardinality(v_ids);
    -- Never an override reason: an automated proposal cannot commit over a conflict.
    for v_created in select * from public.schedule_plan_assignments(
      (v_choice->>'plan_id')::uuid,
      jsonb_build_array(jsonb_build_object(
        'person_id', v_choice->>'person_id', 'team_id', v_choice->>'team_id',
        'position_id', v_choice->>'position_id', 'notes', null,
        'visibility', 'prepared', 'attendance_mode', 'all', 'time_ids', '[]'::jsonb)),
      false, 'proposal:' || v_proposal.id::text || ':' || v_index::text, 'prepared', null, null
    ) loop v_ids := array_append(v_ids, v_created.id); end loop;
    if cardinality(v_ids) = v_before then
      raise exception 'A proposed request already exists. Refresh and review again.'
        using errcode = 'PT409', hint = 'proposal_stale';
    end if;
  end loop;
  perform private.check_pending_conflicts();

  v_result := jsonb_build_object(
    'proposal_id', v_proposal.id,
    'committed_at', now(),
    'assignment_ids', to_jsonb(v_ids),
    'affected_plan_ids', to_jsonb(v_proposal.plan_ids),
    'visibility', 'prepared'
  );
  perform set_config('f06.committing', v_proposal.id::text, true);
  update public.staffing_proposals
     set status = 'committed', committed_at = now(), commit_key = p_idempotency_key, commit_result = v_result
   where id = v_proposal.id;
  perform set_config('f06.committing', '', true);
  return v_result;
end;
$$;
revoke execute on function public.commit_staffing_proposal(uuid, bigint, text) from public, anon;
grant execute on function public.commit_staffing_proposal(uuid, bigint, text) to authenticated;

comment on function public.commit_staffing_proposal(uuid, bigint, text) is
  'F06 atomic, idempotent prepared commit. Rechecks plans, rotations, membership, capability and conflicts; no delivery.';
