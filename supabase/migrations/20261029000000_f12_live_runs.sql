-- F12 — authoritative Live runs and actual timing.
--
-- * A run is one actual occurrence of one service time. It pins a snapshot of
--   the running order (and the plan's content revision) when it is created;
--   later plan edits never change a run, and a run never writes planned
--   lengths. Another service time gets its own run and history. At most one
--   non-discarded run exists per service time; "reset" is discard (with a
--   reason, recorded) followed by a new run.
-- * The run row holds only the visible state (status, current item, when it
--   became current, pause bookkeeping) and a revision. Countdowns and finish
--   estimates are derived from those server timestamps by the shared
--   `deriveLiveView`, so nothing is written per second.
-- * Every state change goes through `live_run_action`: it locks the run row,
--   checks the caller's plan editing capability, the controller lease (user
--   plus client instance), the expected revision and a durable per-run action
--   id, then appends one transition in the same short transaction. A stale,
--   replayed or uncontrolled command can therefore never apply twice or
--   behind another controller's back.
-- * Control is a lease (90 s, renewed by the controlling client). Taking
--   control of a vacant/expired lease is `take_control`; replacing a live
--   controller is a separate, deliberate `take_over`, recorded with the
--   previous controller.
-- * Transitions are append-only. Mistaken times of an ended run are corrected
--   by appending a correction (previous value, new value, actor, reason);
--   actuals use the latest correction. Planned lengths are never touched.
-- * Members read runs, transitions and corrections of their organization's
--   plans (the same audience that reads the plan order). Nobody writes the
--   tables directly; only the functions below do, after their own checks.

-- ============================================================= tables =====

create unique index if not exists plan_times_id_plan_key on public.plan_times (id, plan_id);

create table public.live_runs (
  id                           uuid primary key default gen_random_uuid(),
  organization_id              uuid not null references public.organizations (id) on delete cascade,
  plan_id                      uuid not null,
  plan_time_id                 uuid,
  -- The service time as it was when the run was created; kept if the time is
  -- later moved or deleted so the history still reads correctly.
  time_name                    text,
  time_starts_at               timestamptz not null,
  time_ends_at                 timestamptz not null,
  status                       text not null default 'ready',
  countdown_policy             text not null default 'item',
  snapshot                     jsonb not null,
  snapshot_revision            bigint not null,
  snapshot_at                  timestamptz not null default now(),
  current_index                int,
  current_started_at           timestamptz,
  paused_at                    timestamptz,
  -- Paused milliseconds already accumulated on the current item.
  current_paused_ms            bigint not null default 0,
  started_at                   timestamptz,
  ended_at                     timestamptz,
  revision                     bigint not null default 1,
  controller_user_id           uuid references public.profiles (id) on delete set null,
  controller_client_id         text,
  controller_name              text,
  controller_lease_expires_at  timestamptz,
  discarded_reason             text,
  idempotency_key              text not null,
  created_by                   uuid references public.profiles (id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint live_runs_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint live_runs_time_fk foreign key (plan_time_id, plan_id)
    references public.plan_times (id, plan_id) on delete set null (plan_time_id),
  constraint live_runs_status check (status in ('ready', 'live', 'paused', 'ended', 'discarded')),
  constraint live_runs_policy check (countdown_policy in ('item', 'planned_end', 'service_end')),
  constraint live_runs_snapshot_array check (jsonb_typeof(snapshot) = 'array'),
  constraint live_runs_index check (current_index is null or current_index >= 0),
  constraint live_runs_paused_ms check (current_paused_ms >= 0),
  constraint live_runs_key_length check (char_length(idempotency_key) between 1 and 200),
  constraint live_runs_client_length check (controller_client_id is null or char_length(controller_client_id) between 1 and 100),
  constraint live_runs_controller_shape check (
    (controller_user_id is null) = (controller_lease_expires_at is null)
    and (controller_user_id is null) = (controller_client_id is null)
  ),
  constraint live_runs_state_shape check (
    case status
      when 'ready' then current_index is null and started_at is null and ended_at is null and paused_at is null
      when 'live' then current_index is not null and current_started_at is not null and started_at is not null and paused_at is null and ended_at is null
      when 'paused' then current_index is not null and current_started_at is not null and started_at is not null and paused_at is not null and ended_at is null
      when 'ended' then current_index is null and started_at is not null and ended_at is not null and paused_at is null and controller_user_id is null
      else current_index is null and paused_at is null and controller_user_id is null
    end
  )
);

-- One authoritative run per service occurrence (discarded runs stay as history).
create unique index live_runs_one_per_time on public.live_runs (plan_time_id)
  where plan_time_id is not null and status <> 'discarded';
create unique index live_runs_idempotency on public.live_runs (plan_id, idempotency_key);
create index live_runs_org_idx on public.live_runs (organization_id);
create index live_runs_controller_idx on public.live_runs (controller_user_id) where controller_user_id is not null;
create index live_runs_created_by_idx on public.live_runs (created_by);

comment on table public.live_runs is
  'F12: one actual run of one service time, with a pinned order snapshot and revisioned visible state.';

create table public.live_run_transitions (
  id                bigint generated always as identity primary key,
  run_id            uuid not null references public.live_runs (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- The run's revision after this transition.
  revision          bigint not null,
  action            text not null,
  from_index        int,
  to_index          int,
  -- The snapshot item that became current, when one did.
  item_id           uuid,
  status_after      text not null,
  occurred_at       timestamptz not null default now(),
  actor_user_id     uuid references public.profiles (id) on delete set null,
  actor_name        text,
  client_action_id  text,
  reason            text,
  details           jsonb not null default '{}'::jsonb,
  constraint live_run_transitions_action check (action in (
    'create', 'start', 'advance', 'jump', 'pause', 'resume', 'end',
    'take_control', 'take_over', 'release_control', 'set_policy', 'refresh_snapshot', 'discard'
  )),
  constraint live_run_transitions_action_id_length check (client_action_id is null or char_length(client_action_id) between 1 and 200),
  constraint live_run_transitions_reason_length check (reason is null or char_length(reason) <= 500)
);

create unique index live_run_transitions_revision on public.live_run_transitions (run_id, revision);
create unique index live_run_transitions_action_id on public.live_run_transitions (run_id, client_action_id)
  where client_action_id is not null;
create index live_run_transitions_org_idx on public.live_run_transitions (organization_id);
create index live_run_transitions_actor_idx on public.live_run_transitions (actor_user_id);

comment on table public.live_run_transitions is
  'F12: append-only history of a run. Actual item times are derived from it (plus corrections).';

create table public.live_run_corrections (
  id               bigint generated always as identity primary key,
  run_id           uuid not null references public.live_runs (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  transition_id    bigint not null references public.live_run_transitions (id) on delete cascade,
  revision         bigint not null,
  previous_at      timestamptz not null,
  corrected_at     timestamptz not null,
  reason           text not null,
  actor_user_id    uuid references public.profiles (id) on delete set null,
  actor_name       text,
  created_at       timestamptz not null default now(),
  constraint live_run_corrections_reason check (char_length(btrim(reason)) between 1 and 500)
);

create index live_run_corrections_run_idx on public.live_run_corrections (run_id, id);
create index live_run_corrections_transition_idx on public.live_run_corrections (transition_id, id);
create index live_run_corrections_org_idx on public.live_run_corrections (organization_id);
create index live_run_corrections_actor_idx on public.live_run_corrections (actor_user_id);

comment on table public.live_run_corrections is
  'F12: audited corrections of recorded transition times. The transition row itself is never rewritten.';

-- History is append-only even for code that bypasses the API.
create or replace function private.refuse_live_history_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Live history is append-only' using errcode = 'PT409';
end;
$$;
revoke execute on function private.refuse_live_history_update() from public, anon, authenticated;

create trigger live_run_transitions_append_only
  before update on public.live_run_transitions
  for each row execute function private.refuse_live_history_update();
create trigger live_run_corrections_append_only
  before update on public.live_run_corrections
  for each row execute function private.refuse_live_history_update();

-- ================================================================ RLS =====

alter table public.live_runs enable row level security;
alter table public.live_run_transitions enable row level security;
alter table public.live_run_corrections enable row level security;

create policy live_runs_select on public.live_runs
  for select to authenticated using ((select public.is_org_member(organization_id)));
create policy live_run_transitions_select on public.live_run_transitions
  for select to authenticated using ((select public.is_org_member(organization_id)));
create policy live_run_corrections_select on public.live_run_corrections
  for select to authenticated using ((select public.is_org_member(organization_id)));

revoke insert, update, delete, truncate on public.live_runs, public.live_run_transitions, public.live_run_corrections
  from anon, authenticated;
revoke all on public.live_runs, public.live_run_transitions, public.live_run_corrections from anon;
grant select on public.live_runs, public.live_run_transitions, public.live_run_corrections to authenticated;
grant all on public.live_runs, public.live_run_transitions, public.live_run_corrections to service_role;

-- ============================================================ helpers =====

/** The caller's display name in this organization (roster first, then profile). */
create or replace function private.live_actor_name(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
       from public.people p
      where p.organization_id = p_org and p.profile_id = (select auth.uid())
      limit 1),
    (select nullif(btrim(pr.full_name), '') from public.profiles pr where pr.id = (select auth.uid())),
    'Someone');
$$;
revoke execute on function private.live_actor_name(uuid) from public, anon, authenticated;

/**
 * The running order as a run pins it. Only what every member of the
 * organization may already read on the plan order; no people, notes or files.
 */
create or replace function private.live_snapshot(p_plan uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'item_type', i.item_type,
           'title', i.title,
           'length_seconds', greatest(0, coalesce(i.length_seconds, 0)),
           'service_segment', i.service_segment,
           'song_id', i.song_id,
           'key_override', i.key_override,
           'description', i.description
         ) order by i.sort_order, i.created_at, i.id), '[]'::jsonb)
    from public.plan_items i
   where i.plan_id = p_plan;
$$;
revoke execute on function private.live_snapshot(uuid) from public, anon, authenticated;

/**
 * The first item at or after `p_from` that is not a header (headers consume
 * no time, so Live never parks on one). Null when there is none.
 */
create or replace function private.live_next_runnable(p_snapshot jsonb, p_from int)
returns int
language sql
immutable
set search_path = ''
as $$
  select min(x.ord::int - 1)
    from jsonb_array_elements(p_snapshot) with ordinality x(item, ord)
   where x.ord::int - 1 >= p_from and x.item ->> 'item_type' <> 'header';
$$;
revoke execute on function private.live_next_runnable(jsonb, int) from public, anon, authenticated;

/** The time a transition counts as having happened at: its latest correction, else when it was recorded. */
create or replace function private.live_effective_at(p_transition bigint)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.corrected_at from public.live_run_corrections c where c.transition_id = p_transition order by c.id desc limit 1),
    (select t.occurred_at from public.live_run_transitions t where t.id = p_transition));
$$;
revoke execute on function private.live_effective_at(bigint) from public, anon, authenticated;

/** Plan editors run Live. Members get "forbidden"; anyone else "not found". */
create or replace function private.live_require_editor(p_plan uuid, p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.can_edit_plan(p_plan) then
    return;
  end if;
  if public.is_org_member(p_org) then
    raise exception 'Only people who can edit this plan can run Live' using errcode = '42501';
  end if;
  raise exception 'Run not found' using errcode = 'P0002';
end;
$$;
revoke execute on function private.live_require_editor(uuid, uuid) from public, anon, authenticated;

-- ============================================================= create =====

create or replace function public.create_live_run(
  p_plan_id uuid,
  p_plan_time_id uuid,
  p_countdown_policy text,
  p_idempotency_key text,
  p_client_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  v_time public.plan_times;
  v_run public.live_runs;
  v_name text;
begin
  select * into v_plan from public.plans where id = p_plan_id;
  if not found or not public.is_org_member(v_plan.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  perform private.live_require_editor(p_plan_id, v_plan.organization_id);
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'Send an idempotency key' using errcode = '22023';
  end if;
  if p_client_id is null or char_length(p_client_id) not between 1 and 100 then
    raise exception 'Send the controlling client id' using errcode = '22023';
  end if;
  if coalesce(p_countdown_policy, 'item') not in ('item', 'planned_end', 'service_end') then
    raise exception 'Unknown countdown policy' using errcode = '22023';
  end if;

  -- Serialize creation per service time (and per key, for replays).
  perform pg_advisory_xact_lock(hashtextextended('live-run:' || p_plan_time_id::text, 0));

  select * into v_run from public.live_runs where plan_id = p_plan_id and idempotency_key = p_idempotency_key;
  if found then
    if v_run.plan_time_id is distinct from p_plan_time_id then
      raise exception 'That request id was already used for another run' using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('run', to_jsonb(v_run), 'replayed', true);
  end if;

  select * into v_time from public.plan_times where id = p_plan_time_id and plan_id = p_plan_id and kind = 'service';
  if not found then
    raise exception 'Service time not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.live_runs where plan_time_id = p_plan_time_id and status <> 'discarded') then
    raise exception 'This service time already has a run. Open it, or discard it to start over.'
      using errcode = 'PT409', hint = 'run_exists';
  end if;

  v_name := private.live_actor_name(v_plan.organization_id);
  insert into public.live_runs (
    organization_id, plan_id, plan_time_id, time_name, time_starts_at, time_ends_at,
    countdown_policy, snapshot, snapshot_revision,
    controller_user_id, controller_client_id, controller_name, controller_lease_expires_at,
    idempotency_key, created_by
  ) values (
    v_plan.organization_id, p_plan_id, p_plan_time_id, v_time.name, v_time.starts_at, v_time.ends_at,
    coalesce(p_countdown_policy, 'item'), private.live_snapshot(p_plan_id), v_plan.content_revision,
    (select auth.uid()), p_client_id, v_name, now() + interval '90 seconds',
    p_idempotency_key, (select auth.uid())
  ) returning * into v_run;

  insert into public.live_run_transitions (run_id, organization_id, revision, action, status_after, actor_user_id, actor_name, details)
  values (v_run.id, v_run.organization_id, v_run.revision, 'create', v_run.status, (select auth.uid()), v_name,
          jsonb_build_object('snapshot_revision', v_run.snapshot_revision, 'countdown_policy', v_run.countdown_policy));

  return jsonb_build_object('run', to_jsonb(v_run), 'replayed', false);
end;
$$;
revoke execute on function public.create_live_run(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_live_run(uuid, uuid, text, text, text) to authenticated, service_role;

-- ============================================================ actions =====

/**
 * One serialized Live command. Returns `{ run, replayed }`.
 *
 * Errors: P0002 run not visible; 42501 not a plan editor; 22023 invalid
 * command for the order (e.g. advancing past the last item); PT409 with hint
 * `run_changed` (stale revision), `run_control_lost` (caller does not hold a
 * valid lease — nothing applied), `run_control_held` (someone else holds it;
 * use take_over), `run_state` (not allowed in this status) or
 * `idempotency_key_reused` (action id already used for another command).
 */
create or replace function public.live_run_action(
  p_run_id uuid,
  p_action text,
  p_expected_revision bigint,
  p_client_id text,
  p_action_id text,
  p_target_index int default null,
  p_reason text default null,
  p_countdown_policy text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.live_runs;
  v_prior public.live_run_transitions;
  v_me uuid := (select auth.uid());
  v_name text;
  v_count int;
  v_to int;
  v_from int;
  v_now timestamptz := now();
  v_holds boolean;
  v_details jsonb := '{}'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_run from public.live_runs where id = p_run_id for update;
  if not found or not public.is_org_member(v_run.organization_id) then
    raise exception 'Run not found' using errcode = 'P0002';
  end if;
  perform private.live_require_editor(v_run.plan_id, v_run.organization_id);

  if p_action not in ('start', 'advance', 'jump', 'pause', 'resume', 'end', 'take_control', 'take_over',
                      'release_control', 'renew', 'set_policy', 'refresh_snapshot', 'discard') then
    raise exception 'Unknown Live action' using errcode = '22023';
  end if;
  if p_client_id is null or char_length(p_client_id) not between 1 and 100 then
    raise exception 'Send the controlling client id' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;

  -- A repeated command (same action id) answers with the current state and
  -- changes nothing; the id cannot be reused for a different command.
  if p_action_id is not null then
    select * into v_prior from public.live_run_transitions where run_id = p_run_id and client_action_id = p_action_id;
    if found then
      if v_prior.action <> p_action or v_prior.actor_user_id is distinct from v_me then
        raise exception 'That action id was already used for a different command'
          using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      return jsonb_build_object('run', to_jsonb(v_run), 'replayed', true);
    end if;
  elsif p_action <> 'renew' then
    raise exception 'Send an action id' using errcode = '22023';
  end if;

  v_holds := v_run.controller_user_id = v_me
             and v_run.controller_client_id = p_client_id
             and v_run.controller_lease_expires_at > v_now;

  if p_action = 'renew' then
    if not v_holds then
      raise exception 'You are not controlling this run. Nothing was applied.'
        using errcode = 'PT409', hint = 'run_control_lost';
    end if;
    update public.live_runs set controller_lease_expires_at = v_now + interval '90 seconds'
     where id = p_run_id returning * into v_run;
    return jsonb_build_object('run', to_jsonb(v_run), 'replayed', false);
  end if;

  if p_expected_revision is null or p_expected_revision <> v_run.revision then
    raise exception 'The run changed since you last saw it. Nothing was applied.'
      using errcode = 'PT409', hint = 'run_changed';
  end if;

  v_name := private.live_actor_name(v_run.organization_id);
  v_count := jsonb_array_length(v_run.snapshot);
  v_from := v_run.current_index;

  if p_action in ('take_control', 'take_over') then
    if v_run.status in ('ended', 'discarded') then
      raise exception 'This run is over' using errcode = 'PT409', hint = 'run_state';
    end if;
    if p_action = 'take_control' and v_run.controller_user_id is not null
       and v_run.controller_lease_expires_at > v_now and not v_holds then
      raise exception '% is controlling this run. Take over deliberately to replace them.', coalesce(v_run.controller_name, 'Someone')
        using errcode = 'PT409', hint = 'run_control_held';
    end if;
    v_details := jsonb_build_object(
      'previous_controller_user_id', v_run.controller_user_id,
      'previous_controller_name', v_run.controller_name,
      'previous_lease_valid', coalesce(v_run.controller_lease_expires_at > v_now, false));
    update public.live_runs set
      controller_user_id = v_me, controller_client_id = p_client_id, controller_name = v_name,
      controller_lease_expires_at = v_now + interval '90 seconds'
     where id = p_run_id returning * into v_run;
  elsif p_action = 'discard' then
    if v_run.status = 'discarded' then
      raise exception 'This run was already discarded' using errcode = 'PT409', hint = 'run_state';
    end if;
    if v_reason is null then
      raise exception 'Say why the run is being discarded' using errcode = '22023';
    end if;
    -- An active run is discarded only by its controller; a ready or ended one by any plan editor.
    if v_run.status in ('live', 'paused') and not v_holds then
      raise exception 'You are not controlling this run. Nothing was applied.'
        using errcode = 'PT409', hint = 'run_control_lost';
    end if;
    update public.live_runs set
      status = 'discarded', current_index = null, paused_at = null, discarded_reason = v_reason,
      controller_user_id = null, controller_client_id = null, controller_name = null, controller_lease_expires_at = null
     where id = p_run_id returning * into v_run;
  else
    if not v_holds then
      raise exception 'You are not controlling this run. Nothing was applied.'
        using errcode = 'PT409', hint = 'run_control_lost';
    end if;

    case p_action
      when 'release_control' then
        update public.live_runs set
          controller_user_id = null, controller_client_id = null, controller_name = null, controller_lease_expires_at = null
         where id = p_run_id returning * into v_run;

      when 'set_policy' then
        if p_countdown_policy is null or p_countdown_policy not in ('item', 'planned_end', 'service_end') then
          raise exception 'Unknown countdown policy' using errcode = '22023';
        end if;
        v_details := jsonb_build_object('previous', v_run.countdown_policy, 'policy', p_countdown_policy);
        update public.live_runs set countdown_policy = p_countdown_policy
         where id = p_run_id returning * into v_run;

      when 'refresh_snapshot' then
        if v_run.status <> 'ready' then
          raise exception 'A started run keeps the order it started with' using errcode = 'PT409', hint = 'run_state';
        end if;
        v_details := jsonb_build_object(
          'previous_snapshot_revision', v_run.snapshot_revision,
          'snapshot_revision', (select content_revision from public.plans where id = v_run.plan_id));
        update public.live_runs set
          snapshot = private.live_snapshot(v_run.plan_id),
          snapshot_revision = (select content_revision from public.plans where id = v_run.plan_id),
          snapshot_at = v_now
         where id = p_run_id returning * into v_run;

      when 'start' then
        if v_run.status <> 'ready' then
          raise exception 'This run has already started' using errcode = 'PT409', hint = 'run_state';
        end if;
        v_to := private.live_next_runnable(v_run.snapshot, 0);
        if v_to is null then
          raise exception 'This order has nothing to run (only headers or no items)' using errcode = '22023';
        end if;
        update public.live_runs set
          status = 'live', current_index = v_to, current_started_at = v_now, current_paused_ms = 0, started_at = v_now
         where id = p_run_id returning * into v_run;

      when 'advance', 'jump' then
        if v_run.status not in ('live', 'paused') then
          raise exception 'Start the run first' using errcode = 'PT409', hint = 'run_state';
        end if;
        if p_action = 'advance' then
          v_to := private.live_next_runnable(v_run.snapshot, v_run.current_index + 1);
          if v_to is null then
            raise exception 'This is the last item. End the run instead.' using errcode = '22023';
          end if;
        else
          if p_target_index is null or p_target_index < 0 or p_target_index >= v_count then
            raise exception 'Choose an item in this run''s order' using errcode = '22023';
          end if;
          -- Jumping to a header lands on the first item under it.
          v_to := private.live_next_runnable(v_run.snapshot, p_target_index);
          if v_to is null then
            raise exception 'There is nothing to run after that header' using errcode = '22023';
          end if;
          if v_to = v_run.current_index then
            raise exception 'That item is already current' using errcode = '22023';
          end if;
        end if;
        -- A paused run stays paused on the new item (its clock starts at zero).
        update public.live_runs set
          current_index = v_to, current_started_at = v_now, current_paused_ms = 0,
          paused_at = case when v_run.status = 'paused' then v_now end
         where id = p_run_id returning * into v_run;

      when 'pause' then
        if v_run.status <> 'live' then
          raise exception 'Only a running service can be paused' using errcode = 'PT409', hint = 'run_state';
        end if;
        update public.live_runs set status = 'paused', paused_at = v_now
         where id = p_run_id returning * into v_run;

      when 'resume' then
        if v_run.status <> 'paused' then
          raise exception 'The run is not paused' using errcode = 'PT409', hint = 'run_state';
        end if;
        update public.live_runs set
          status = 'live',
          current_paused_ms = current_paused_ms + greatest(0, (extract(epoch from (v_now - paused_at)) * 1000)::bigint),
          paused_at = null
         where id = p_run_id returning * into v_run;

      when 'end' then
        if v_run.status not in ('live', 'paused') then
          raise exception 'Only a started run can be ended' using errcode = 'PT409', hint = 'run_state';
        end if;
        update public.live_runs set
          status = 'ended', ended_at = v_now, current_index = null, paused_at = null,
          controller_user_id = null, controller_client_id = null, controller_name = null, controller_lease_expires_at = null
         where id = p_run_id returning * into v_run;
    end case;
  end if;

  update public.live_runs set revision = revision + 1, updated_at = v_now
   where id = p_run_id returning * into v_run;

  insert into public.live_run_transitions (
    run_id, organization_id, revision, action, from_index, to_index, item_id, status_after,
    occurred_at, actor_user_id, actor_name, client_action_id, reason, details
  ) values (
    v_run.id, v_run.organization_id, v_run.revision, p_action, v_from, v_run.current_index,
    case when v_run.current_index is not null and v_run.current_index is distinct from v_from
         then (v_run.snapshot -> v_run.current_index ->> 'id')::uuid end,
    v_run.status, v_now, v_me, v_name, p_action_id, v_reason, v_details
  );

  return jsonb_build_object('run', to_jsonb(v_run), 'replayed', false);
end;
$$;
revoke execute on function public.live_run_action(uuid, text, bigint, text, text, int, text, text) from public, anon;
grant execute on function public.live_run_action(uuid, text, bigint, text, text, int, text, text) to authenticated, service_role;

-- ======================================================== corrections =====

/**
 * Corrects when one recorded timing transition of an ended run happened.
 * Appends a correction row (previous value, new value, actor, reason); the
 * transition is not rewritten and planned lengths are untouched. The new
 * time must keep the run's timing transitions in order.
 */
create or replace function public.correct_live_run_time(
  p_run_id uuid,
  p_transition_id bigint,
  p_corrected_at timestamptz,
  p_reason text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.live_runs;
  v_transition public.live_run_transitions;
  v_previous timestamptz;
  v_before timestamptz;
  v_after timestamptz;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_run from public.live_runs where id = p_run_id for update;
  if not found or not public.is_org_member(v_run.organization_id) then
    raise exception 'Run not found' using errcode = 'P0002';
  end if;
  perform private.live_require_editor(v_run.plan_id, v_run.organization_id);
  if v_run.status <> 'ended' then
    raise exception 'Correct recorded times after the run has ended' using errcode = 'PT409', hint = 'run_state';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_run.revision then
    raise exception 'The run changed since you last saw it. Nothing was applied.'
      using errcode = 'PT409', hint = 'run_changed';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'Say why the time is being corrected (up to 500 characters)' using errcode = '22023';
  end if;
  if p_corrected_at is null then
    raise exception 'Send the corrected time' using errcode = '22023';
  end if;

  select * into v_transition from public.live_run_transitions
   where id = p_transition_id and run_id = p_run_id
     and action in ('start', 'advance', 'jump', 'pause', 'resume', 'end');
  if not found then
    raise exception 'That is not a timing transition of this run' using errcode = 'P0002';
  end if;

  v_previous := private.live_effective_at(v_transition.id);
  select max(private.live_effective_at(t.id)) into v_before
    from public.live_run_transitions t
   where t.run_id = p_run_id and t.id < v_transition.id
     and t.action in ('start', 'advance', 'jump', 'pause', 'resume', 'end');
  select min(private.live_effective_at(t.id)) into v_after
    from public.live_run_transitions t
   where t.run_id = p_run_id and t.id > v_transition.id
     and t.action in ('start', 'advance', 'jump', 'pause', 'resume', 'end');
  if (v_before is not null and p_corrected_at < v_before) or (v_after is not null and p_corrected_at > v_after) then
    raise exception 'A corrected time must stay between the times recorded before and after it' using errcode = '22023';
  end if;
  if p_corrected_at = v_previous then
    raise exception 'That is already the recorded time' using errcode = '22023';
  end if;

  update public.live_runs set revision = revision + 1, updated_at = now()
   where id = p_run_id returning * into v_run;

  insert into public.live_run_corrections (
    run_id, organization_id, transition_id, revision, previous_at, corrected_at, reason, actor_user_id, actor_name
  ) values (
    v_run.id, v_run.organization_id, v_transition.id, v_run.revision, v_previous, p_corrected_at, v_reason,
    (select auth.uid()), private.live_actor_name(v_run.organization_id)
  );

  return jsonb_build_object('run', to_jsonb(v_run), 'replayed', false);
end;
$$;
revoke execute on function public.correct_live_run_time(uuid, bigint, timestamptz, text, bigint) from public, anon;
grant execute on function public.correct_live_run_time(uuid, bigint, timestamptz, text, bigint) to authenticated, service_role;

-- ============================================================== reads =====

/**
 * The run as the caller may see it, read through RLS (security invoker), with
 * the database clock — the same clock that stamps transitions — so clients
 * derive their offset from the authority, not from the API host. Null when
 * the run is not visible.
 */
create or replace function public.live_run_state(p_run_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'run', to_jsonb(r) - 'idempotency_key',
           'server_now', now(),
           'plan_content_revision', p.content_revision,
           'time', case when t.id is null then null
                        else jsonb_build_object('id', t.id, 'starts_at', t.starts_at, 'ends_at', t.ends_at) end,
           'can_control', public.can_edit_plan(r.plan_id))
    from public.live_runs r
    join public.plans p on p.id = r.plan_id
    left join public.plan_times t on t.id = r.plan_time_id
   where r.id = p_run_id;
$$;
revoke execute on function public.live_run_state(uuid) from public, anon;
grant execute on function public.live_run_state(uuid) to authenticated, service_role;

/** The database clock, for responses that carry no run (run lists, history). */
create or replace function public.live_server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now(); $$;
revoke execute on function public.live_server_now() from public, anon;
grant execute on function public.live_server_now() to authenticated, service_role;
