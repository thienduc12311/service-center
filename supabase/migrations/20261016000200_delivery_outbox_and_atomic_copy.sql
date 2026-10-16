-- F00 — durable delivery outbox and atomic plan copy.
--
-- Delivery
--   An action that should reach people (scheduling someone, a reminder, an
--   answer the scheduler must hear about) records one *effect* in the same
--   transaction as the change that caused it. The effect is expanded right
--   there into one *delivery* per recipient per channel (in-app feed, push,
--   email). Providers are only contacted afterwards, by a worker that claims
--   due deliveries with a short lease (FOR UPDATE SKIP LOCKED), so:
--     * a crash after commit loses nothing — the next worker run finds it;
--     * two workers never hold the same delivery at once;
--     * the effect key is unique per organization, so retrying the action
--       returns the effect already recorded instead of sending twice.
--   A delivery whose lease expired *after* the provider call began is marked
--   `ambiguous`, never silently re-sent: neither transport here lets us ask
--   whether that call landed. `simulated` (no provider configured) is a
--   distinct outcome from `provider_accepted`; nothing here claims a message
--   reached a person's inbox or lock screen.
--
--   Clients never write these tables. Organization managers can read
--   deliveries (no addresses or message content are stored); attempt history
--   is service-role only.
--
-- Copy
--   Duplicating a plan, creating one from another, and importing another
--   plan's order/needs/team into an existing plan each run as a single
--   transaction with a durable idempotency key, so a failure part-way leaves
--   no partial plan and a retried request does not copy twice. Importing into
--   an existing plan can take the destination's content revision and fails
--   with 409 when the plan changed since it was read.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ======================================================== delivery =========

create type public.delivery_channel as enum ('in_app', 'push', 'email');

create type public.delivery_status as enum (
  'queued',             -- waiting for a worker (first try or a scheduled retry)
  'sending',            -- leased by a worker
  'simulated',          -- no provider configured; logged instead of sent
  'provider_accepted',  -- the provider accepted the message for delivery
  'delivered',          -- confirmed delivered (the in-app feed row exists)
  'failed',             -- gave up; an administrator may retry
  'ambiguous',          -- the provider call may or may not have landed
  'skipped',            -- nothing to deliver to (no address, no device)
  'cancelled'           -- no longer applicable when the worker got to it
);

create type public.delivery_template as enum (
  'assignment_request',
  'assignment_reminder',
  'scheduler_response'
);

create table public.delivery_effects (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  -- Semantic identity of the action: an idempotency key, or derived from the
  -- row that caused it (a response history row, a respond link).
  effect_key           text not null check (char_length(effect_key) between 1 and 200),
  template             public.delivery_template not null,
  plan_id              uuid references public.plans (id) on delete cascade,
  assignment_ids       uuid[] not null default '{}',
  -- Set for scheduler_response: who answered and how.
  responder_id         uuid references public.profiles (id) on delete set null,
  response_status      public.assignment_status,
  response_transition  text check (response_transition in ('response', 'withdrawal')),
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint delivery_effects_key_unique unique (organization_id, effect_key),
  constraint delivery_effects_response_shape check (
    (template = 'scheduler_response') = (response_status is not null and response_transition is not null)
  )
);

create index delivery_effects_plan_idx on public.delivery_effects (plan_id);
create index delivery_effects_responder_idx on public.delivery_effects (responder_id);
create index delivery_effects_created_by_idx on public.delivery_effects (created_by);
-- Finding the effect a response just recorded.
create index delivery_effects_assignments_idx on public.delivery_effects using gin (assignment_ids);

create table public.deliveries (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations (id) on delete cascade,
  effect_id                 uuid not null references public.delivery_effects (id) on delete cascade,
  recipient_id              uuid not null references public.profiles (id) on delete cascade,
  channel                   public.delivery_channel not null,
  status                    public.delivery_status not null default 'queued',
  attempts                  int not null default 0 check (attempts >= 0),
  max_attempts              int not null default 5 check (max_attempts > 0),
  next_attempt_at           timestamptz not null default now(),
  lease_owner               text,
  lease_expires_at          timestamptz,
  provider_call_started_at  timestamptz,
  provider_message_id       text,
  accepted_at               timestamptz,
  delivered_at              timestamptz,
  completed_at              timestamptz,
  -- A short machine code (`no_email_address`, `provider_rate_limited`, ...);
  -- never provider text, which can echo addresses back.
  last_error_code           text check (last_error_code is null or char_length(last_error_code) <= 64),
  manual_retries            int not null default 0 check (manual_retries >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint deliveries_one_per_channel unique (effect_id, recipient_id, channel),
  constraint deliveries_lease_matches_status check ((status = 'sending') = (lease_expires_at is not null)),
  constraint deliveries_accepted_only_when_accepted check (
    accepted_at is null or status in ('provider_accepted', 'delivered')
  )
);

-- Worker scans: due work and expired leases. Both stay small.
create index deliveries_due_idx on public.deliveries (next_attempt_at) where status = 'queued';
create index deliveries_lease_idx on public.deliveries (lease_expires_at) where status = 'sending';
-- Administrator outcome list, newest first.
create index deliveries_org_created_idx on public.deliveries (organization_id, created_at desc);
create index deliveries_recipient_idx on public.deliveries (recipient_id);

create trigger set_updated_at before update on public.deliveries
  for each row execute function public.set_updated_at();

create table public.delivery_attempts (
  id                   uuid primary key default gen_random_uuid(),
  delivery_id          uuid not null references public.deliveries (id) on delete cascade,
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  attempt              int not null check (attempt > 0),
  started_at           timestamptz,
  finished_at          timestamptz not null default now(),
  outcome              public.delivery_status not null,
  error_code           text check (error_code is null or char_length(error_code) <= 64),
  provider_message_id  text,
  constraint delivery_attempts_one_per_attempt unique (delivery_id, attempt)
);
create index delivery_attempts_organization_idx on public.delivery_attempts (organization_id);

-- The feed row an in-app/push delivery writes, keyed so a retried delivery
-- never adds a second copy.
alter table public.notifications add column dedupe_key text;
-- Not partial (nulls never collide), so PostgREST's on_conflict can target it.
create unique index notifications_dedupe_key_idx on public.notifications (dedupe_key);

-- ------------------------------------------------------------------ rls ----
alter table public.delivery_effects  enable row level security;
alter table public.deliveries        enable row level security;
alter table public.delivery_attempts enable row level security;

create policy delivery_effects_select on public.delivery_effects
  for select to authenticated using ((select public.can_manage_org(organization_id)));
create policy deliveries_select on public.deliveries
  for select to authenticated using ((select public.can_manage_org(organization_id)));
-- delivery_attempts: no policy — service role only.

revoke insert, update, delete, truncate on public.delivery_effects  from anon, authenticated;
revoke insert, update, delete, truncate on public.deliveries        from anon, authenticated;
revoke all on public.delivery_attempts from anon, authenticated;

-- --------------------------------------------------------- enqueue ---------
-- Private (not exposed through PostgREST) and security definer, because the
-- outbox has no client write grants. Only the public functions below call
-- these, after doing their own authorization; each also re-checks the caller.

create or replace function private.enqueue_assignment_requests(
  p_plan_id        uuid,
  p_template       public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key     text,
  p_actor          uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_effect uuid;
  v_ids    uuid[];
begin
  if p_template not in ('assignment_request', 'assignment_reminder') then
    raise exception 'Not an assignment request template' using errcode = '22023';
  end if;

  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is not null and not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can notify this plan' using errcode = '42501';
  end if;

  -- Only assignments that really are on this plan.
  select coalesce(array_agg(a.id order by a.id), '{}')
    into v_ids
    from public.assignments a
   where a.plan_id = p_plan_id and a.id = any(p_assignment_ids);

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, assignment_ids, created_by)
  values (v_org, p_effect_key, p_template, p_plan_id, v_ids, p_actor)
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;

  if v_effect is null then
    -- Already recorded by an earlier attempt of the same action.
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  -- One recipient per person per plan, however many positions they hold.
  insert into public.deliveries (organization_id, effect_id, recipient_id, channel)
  select v_org, v_effect, r.user_id, c.channel
    from (select distinct user_id from public.assignments where id = any(v_ids)) r
   cross join unnest(array['in_app', 'push', 'email']::public.delivery_channel[]) as c(channel);

  return v_effect;
end;
$$;

-- Tells whoever scheduled each answered position. The same function serves
-- the signed-in app and the public respond link, so both follow one rule:
-- every scheduler (assignments.created_by, other than the responder) gets one
-- in-app/push update per action, and an email when the answer is a decline.
create or replace function private.enqueue_scheduler_responses(
  p_assignment_ids uuid[],
  p_responder      uuid,
  p_status         public.assignment_status,
  p_transition     text,
  p_effect_key     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_plan    uuid;
  v_plans   int;
  v_effect  uuid;
begin
  select min(p.organization_id::text)::uuid, min(a.plan_id::text)::uuid, count(distinct a.plan_id)
    into v_org, v_plan, v_plans
    from public.assignments a
    join public.plans p on p.id = a.plan_id
   where a.id = any(p_assignment_ids) and a.user_id = p_responder;

  if v_plans = 0 then
    return null;
  end if;
  if v_plans > 1 then
    raise exception 'One response covers one plan' using errcode = '22023';
  end if;
  if (select auth.uid()) is not null and (select auth.uid()) <> p_responder then
    raise exception 'Only the assignee can answer' using errcode = '42501';
  end if;

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids,
    responder_id, response_status, response_transition, created_by
  )
  select v_org, p_effect_key, 'scheduler_response', v_plan,
         array_agg(a.id order by a.id), p_responder, p_status, p_transition, p_responder
    from public.assignments a
   where a.id = any(p_assignment_ids) and a.user_id = p_responder
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;

  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  insert into public.deliveries (organization_id, effect_id, recipient_id, channel)
  select v_org, v_effect, s.created_by, c.channel
    from (
      select distinct a.created_by
        from public.assignments a
       where a.id = any(p_assignment_ids)
         and a.created_by is not null
         and a.created_by <> p_responder
    ) s
   cross join unnest(
     case when p_status = 'declined'
          then array['in_app', 'push', 'email']::public.delivery_channel[]
          else array['in_app', 'push']::public.delivery_channel[]
     end
   ) as c(channel);

  return v_effect;
end;
$$;

revoke execute on function private.enqueue_assignment_requests(uuid, public.delivery_template, uuid[], text, uuid) from public;
revoke execute on function private.enqueue_scheduler_responses(uuid[], uuid, public.assignment_status, text, text) from public;
grant execute on function private.enqueue_assignment_requests(uuid, public.delivery_template, uuid[], text, uuid) to authenticated, service_role;
grant execute on function private.enqueue_scheduler_responses(uuid[], uuid, public.assignment_status, text, text) to authenticated, service_role;

-- ------------------------------------------ writers that enqueue effects ---

-- Schedule people onto a plan and, when asked, record the request effect in
-- the same transaction. Security invoker: RLS decides who may insert. Rows
-- that already exist (either partial unique index) are skipped, as before.
create or replace function public.schedule_plan_assignments(
  p_plan_id     uuid,
  p_assignments jsonb,
  p_notify      boolean,
  p_effect_key  text default null
)
returns setof public.assignments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org     uuid;
  v_ids     uuid[];
  v_invalid int;
begin
  select organization_id into v_org from public.plans where id = p_plan_id;
  if v_org is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(v_org) then
    raise exception 'Only a scheduler can schedule people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a list' using errcode = '22023';
  end if;

  -- Every team, position and person must belong to this plan's organization.
  select count(*) into v_invalid
    from jsonb_to_recordset(p_assignments) as r(user_id uuid, team_id uuid, position_id uuid, notes text)
   where r.user_id is null or r.team_id is null
      or not exists (select 1 from public.teams t where t.id = r.team_id and t.organization_id = v_org)
      or (r.position_id is not null and not exists (
            select 1 from public.team_positions tp where tp.id = r.position_id and tp.team_id = r.team_id))
      or not exists (select 1 from public.organization_members m
                      where m.organization_id = v_org and m.user_id = r.user_id);
  if v_invalid > 0 then
    raise exception 'Some people, teams or positions do not belong to this organization'
      using errcode = '22023';
  end if;

  with requested as (
    select r.*, row_number() over () as ord
      from jsonb_to_recordset(p_assignments) as r(user_id uuid, team_id uuid, position_id uuid, notes text)
  ), inserted as (
    insert into public.assignments (plan_id, user_id, team_id, position_id, notes, status, created_by)
    select distinct on (r.user_id, r.team_id, r.position_id)
           p_plan_id, r.user_id, r.team_id, r.position_id, nullif(btrim(r.notes), ''), 'unconfirmed', (select auth.uid())
      from requested r
     order by r.user_id, r.team_id, r.position_id, r.ord
    on conflict do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from inserted;

  if p_notify and cardinality(v_ids) > 0 then
    perform private.enqueue_assignment_requests(
      p_plan_id, 'assignment_request', v_ids,
      coalesce(p_effect_key, 'assignments-scheduled:' || gen_random_uuid()::text),
      (select auth.uid())
    );
  end if;

  return query select a.* from public.assignments a where a.id = any(v_ids);
end;
$$;

-- A reminder, or a re-notification after a plan's time/location changed.
create or replace function public.enqueue_plan_notifications(
  p_plan_id        uuid,
  p_template       public.delivery_template,
  p_assignment_ids uuid[],
  p_effect_key     text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.can_manage_org(public.org_of_plan(p_plan_id)) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  return private.enqueue_assignment_requests(
    p_plan_id, p_template, p_assignment_ids, p_effect_key, (select auth.uid())
  );
end;
$$;

-- MOB-004's answer RPC, unchanged in behavior, now also records the scheduler
-- update in the same transaction as the answer.
create or replace function public.respond_to_own_assignment(
  p_assignment_id   uuid,
  p_status          public.assignment_status,
  p_expected_status public.assignment_status,
  p_reason          text default null
)
returns setof public.assignments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row     public.assignments;
  v_history uuid;
begin
  if p_status = 'unconfirmed' then
    raise exception 'An answer is either confirmed or declined' using errcode = '22023';
  end if;
  if p_reason is not null and p_status <> 'declined' then
    raise exception 'A reason can only accompany a decline' using errcode = '22023';
  end if;
  if char_length(p_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22001';
  end if;

  perform set_config('app.assignment_response_note', coalesce(p_reason, ''), true);

  update public.assignments
     set status = p_status, responded_at = now()
   where id = p_assignment_id
     and user_id = (select auth.uid())
     and status = p_expected_status
  returning * into v_row;

  perform set_config('app.assignment_response_note', '', true);

  if v_row.id is null then
    return;
  end if;

  select r.id into v_history
    from public.assignment_responses r
   where r.assignment_id = v_row.id
   order by r.created_at desc, r.id desc
   limit 1;

  perform private.enqueue_scheduler_responses(
    array[v_row.id], v_row.user_id, p_status,
    case when p_expected_status = 'confirmed' and p_status = 'declined' then 'withdrawal' else 'response' end,
    'assignment-response:' || v_history::text
  );

  return next v_row;
end;
$$;

-- The public respond link: verify, answer and enqueue in one transaction.
-- Locks the link row, so two submissions of the same link cannot both pass
-- the "not yet used" check. Called by the API with the service role only.
create or replace function public.respond_via_assignment_link(
  p_token_hash text,
  p_status     public.assignment_status
)
returns table (outcome text, assignments_updated int, effect_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link       public.assignment_notifications;
  v_ids        uuid[];
  v_withdrawal boolean;
  v_effect     uuid;
begin
  if p_status not in ('confirmed', 'declined') then
    raise exception 'An answer is either confirmed or declined' using errcode = '22023';
  end if;

  select * into v_link from public.assignment_notifications
   where token_hash = p_token_hash
   for update;
  if not found then
    return query select 'not_found'::text, 0, null::uuid;
    return;
  end if;
  if v_link.responded_at is not null then
    return query select 'used'::text, 0, null::uuid;
    return;
  end if;
  if v_link.expires_at <= now() then
    return query select 'expired'::text, 0, null::uuid;
    return;
  end if;

  -- Only positions that may still take this answer: a declined one is never
  -- re-accepted from a link, and a repeated answer writes nothing.
  select coalesce(array_agg(l.id), '{}'), coalesce(bool_and(l.status = 'confirmed'), false)
    into v_ids, v_withdrawal
    from (
      select a.id, a.status
        from public.assignments a
       where a.plan_id = v_link.plan_id
         and a.user_id = v_link.user_id
         and a.status = any(
           case when p_status = 'confirmed'
                then array['unconfirmed']::public.assignment_status[]
                else array['unconfirmed', 'confirmed']::public.assignment_status[]
           end)
       for update
    ) l;

  update public.assignments
     set status = p_status, responded_at = now()
   where id = any(v_ids);

  update public.assignment_notifications set responded_at = now() where id = v_link.id;

  if cardinality(v_ids) > 0 then
    v_effect := private.enqueue_scheduler_responses(
      v_ids, v_link.user_id, p_status,
      case when p_status = 'declined' and v_withdrawal then 'withdrawal' else 'response' end,
      'assignment-link-response:' || v_link.id::text
    );
  end if;

  return query select 'ok'::text, cardinality(v_ids), v_effect;
end;
$$;

-- ------------------------------------------------------------ worker -------

-- Claim up to p_limit due deliveries for p_lease_seconds. Expired leases are
-- recovered first: back to the queue when the provider was never called,
-- `ambiguous` when it was.
create or replace function public.claim_deliveries(
  p_worker        text,
  p_limit         int,
  p_lease_seconds int,
  p_effect_id     uuid default null
)
returns setof public.deliveries
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with expired as (
    select d.id from public.deliveries d
     where d.status = 'sending' and d.lease_expires_at < now()
       and (p_effect_id is null or d.effect_id = p_effect_id)
     for update skip locked
  ), recovered as (
    update public.deliveries d
       set status = case
             when d.provider_call_started_at is not null then 'ambiguous'
             when d.attempts >= d.max_attempts then 'failed'
             else 'queued' end::public.delivery_status,
           last_error_code = case
             when d.provider_call_started_at is not null then 'outcome_unknown'
             else 'worker_lease_expired' end,
           completed_at = case
             when d.provider_call_started_at is not null or d.attempts >= d.max_attempts then now() end,
           lease_owner = null,
           lease_expires_at = null
      from expired
     where d.id = expired.id
    returning d.id, d.organization_id, d.attempts, d.status, d.last_error_code, d.provider_call_started_at
  )
  insert into public.delivery_attempts (delivery_id, organization_id, attempt, started_at, outcome, error_code)
  select r.id, r.organization_id, r.attempts, r.provider_call_started_at, r.status, r.last_error_code
    from recovered r
   where r.attempts > 0
  on conflict (delivery_id, attempt) do nothing;

  return query
    update public.deliveries d
       set status = 'sending',
           attempts = d.attempts + 1,
           lease_owner = p_worker,
           lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 5)),
           provider_call_started_at = null
     where d.id in (
       select q.id from public.deliveries q
        where q.status = 'queued' and q.next_attempt_at <= now()
          and (p_effect_id is null or q.effect_id = p_effect_id)
        order by q.next_attempt_at, q.id
        limit least(greatest(p_limit, 1), 100)
        for update skip locked
     )
    returning d.*;
end;
$$;

-- Called immediately before the provider request. False when this worker no
-- longer holds the lease, in which case it must not call the provider.
create or replace function public.begin_delivery_provider_call(p_delivery_id uuid, p_worker text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with started as (
    update public.deliveries
       set provider_call_started_at = now()
     where id = p_delivery_id and status = 'sending'
       and lease_owner = p_worker and lease_expires_at > now()
    returning 1
  )
  select exists (select 1 from started);
$$;

-- Record a finished attempt. p_status 'queued' means "retry later": it
-- becomes 'failed' once attempts are used up. Security definer so the
-- accepted-email bookkeeping can update assignments, whose guard trigger
-- refuses notified_at changes from API roles.
create or replace function public.complete_delivery(
  p_delivery_id          uuid,
  p_worker               text,
  p_status               public.delivery_status,
  p_error_code           text default null,
  p_provider_message_id  text default null,
  p_retry_after_seconds  int default null
)
returns public.deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.deliveries;
  v_status public.delivery_status;
  v_effect public.delivery_effects;
begin
  if p_status = 'sending' then
    raise exception 'A finished attempt cannot be sending' using errcode = '22023';
  end if;

  select * into v_row from public.deliveries
   where id = p_delivery_id and status = 'sending' and lease_owner = p_worker
   for update;
  if not found then
    -- The lease was lost (expired and recovered by another run).
    return null;
  end if;

  v_status := case
    when p_status = 'queued' and v_row.attempts >= v_row.max_attempts then 'failed'
    else p_status end;

  insert into public.delivery_attempts (
    delivery_id, organization_id, attempt, started_at, outcome, error_code, provider_message_id
  ) values (
    v_row.id, v_row.organization_id, v_row.attempts, v_row.provider_call_started_at,
    v_status, left(p_error_code, 64), p_provider_message_id
  )
  on conflict (delivery_id, attempt) do nothing;

  update public.deliveries
     set status = v_status,
         lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = case when v_status = 'queued'
                                then now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 60), 1))
                                else next_attempt_at end,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         accepted_at = case when v_status in ('provider_accepted', 'delivered') then coalesce(accepted_at, now()) end,
         delivered_at = case when v_status = 'delivered' then now() end,
         completed_at = case when v_status <> 'queued' then now() end,
         last_error_code = left(p_error_code, 64)
   where id = v_row.id
  returning * into v_row;

  -- Only an email the provider accepted marks the person as notified.
  if v_row.channel = 'email' and v_status = 'provider_accepted' then
    select * into v_effect from public.delivery_effects where id = v_row.effect_id;
    if v_effect.template in ('assignment_request', 'assignment_reminder') then
      update public.assignment_notifications
         set sent_at = now()
       where plan_id = v_effect.plan_id and user_id = v_row.recipient_id and responded_at is null;
      update public.assignments
         set notified_at = now()
       where id = any(v_effect.assignment_ids) and user_id = v_row.recipient_id;
    end if;
  end if;

  return v_row;
end;
$$;

-- An administrator re-queues a failed or ambiguous delivery for one more
-- attempt. Repeating the call while it is queued or sending changes nothing.
create or replace function public.retry_delivery(p_delivery_id uuid)
returns public.deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.deliveries;
begin
  select * into v_row from public.deliveries where id = p_delivery_id for update;
  if not found or not public.is_org_admin(v_row.organization_id) then
    raise exception 'Delivery not found' using errcode = 'P0002';
  end if;
  if v_row.status in ('queued', 'sending') then
    return v_row;
  end if;
  if v_row.status not in ('failed', 'ambiguous') then
    raise exception 'Only a failed or uncertain delivery can be retried' using errcode = 'PT409';
  end if;

  update public.deliveries
     set status = 'queued',
         next_attempt_at = now(),
         max_attempts = v_row.attempts + 1,
         manual_retries = v_row.manual_retries + 1,
         completed_at = null,
         provider_call_started_at = null
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.schedule_plan_assignments(uuid, jsonb, boolean, text) to authenticated;
revoke execute on function public.enqueue_plan_notifications(uuid, public.delivery_template, uuid[], text) from public, anon;
grant execute on function public.enqueue_plan_notifications(uuid, public.delivery_template, uuid[], text) to authenticated;
revoke execute on function public.respond_via_assignment_link(text, public.assignment_status) from public, anon, authenticated;
grant execute on function public.respond_via_assignment_link(text, public.assignment_status) to service_role;
revoke execute on function public.claim_deliveries(text, int, int, uuid) from public, anon, authenticated;
grant execute on function public.claim_deliveries(text, int, int, uuid) to service_role;
revoke execute on function public.begin_delivery_provider_call(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_delivery_provider_call(uuid, text) to service_role;
revoke execute on function public.complete_delivery(uuid, text, public.delivery_status, text, text, int) from public, anon, authenticated;
grant execute on function public.complete_delivery(uuid, text, public.delivery_status, text, text, int) to service_role;
revoke execute on function public.retry_delivery(uuid) from public, anon;
grant execute on function public.retry_delivery(uuid) to authenticated;

-- ===================================================== atomic copy =========

-- Bumped whenever a plan's order, times or needs change, so an import into
-- an existing plan can refuse to apply over edits it never saw.
alter table public.plans add column content_revision bigint not null default 0;

create or replace function private.bump_plan_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.plans
     set content_revision = content_revision + 1
   where id = coalesce(new.plan_id, old.plan_id);
  return null;
end;
$$;
revoke execute on function private.bump_plan_content_revision() from public;

create trigger plan_items_bump_content_revision
  after insert or update or delete on public.plan_items
  for each row execute function private.bump_plan_content_revision();
create trigger plan_times_bump_content_revision
  after insert or update or delete on public.plan_times
  for each row execute function private.bump_plan_content_revision();
create trigger plan_position_needs_bump_content_revision
  after insert or update or delete on public.plan_position_needs
  for each row execute function private.bump_plan_content_revision();

create table public.plan_copy_operations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  kind             text not null check (kind in ('duplicate', 'create', 'import')),
  source_plan_id   uuid references public.plans (id) on delete set null,
  -- Deferred: a new plan's id is reserved before the plan row is written, so
  -- a concurrent retry waits on this key instead of creating a second plan.
  target_plan_id   uuid not null references public.plans (id) on delete cascade deferrable initially deferred,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint plan_copy_operations_key_unique unique (organization_id, idempotency_key)
);
create index plan_copy_operations_source_idx on public.plan_copy_operations (source_plan_id);
create index plan_copy_operations_target_idx on public.plan_copy_operations (target_plan_id);
create index plan_copy_operations_created_by_idx on public.plan_copy_operations (created_by);

alter table public.plan_copy_operations enable row level security;
create policy plan_copy_operations_select on public.plan_copy_operations
  for select to authenticated using ((select public.can_manage_org(organization_id)));
create policy plan_copy_operations_insert on public.plan_copy_operations
  for insert to authenticated with check (
    (select public.can_manage_org(organization_id)) and created_by = (select auth.uid())
  );
revoke update, delete, truncate on public.plan_copy_operations from anon, authenticated;

-- Claims an idempotency key. Returns the plan an earlier run of the same
-- operation produced, or null when this run owns the key.
create or replace function private.claim_plan_copy_key(
  p_org     uuid,
  p_key     text,
  p_kind    text,
  p_source  uuid,
  p_target  uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.plan_copy_operations;
  v_claimed  uuid;
begin
  if p_key is null then
    return null;
  end if;
  insert into public.plan_copy_operations (organization_id, idempotency_key, kind, source_plan_id, target_plan_id, created_by)
  values (p_org, p_key, p_kind, p_source, p_target, (select auth.uid()))
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_claimed;
  if v_claimed is not null then
    return null;
  end if;

  select * into v_existing from public.plan_copy_operations
   where organization_id = p_org and idempotency_key = p_key;
  if v_existing.kind <> p_kind or v_existing.source_plan_id is distinct from p_source
     or (p_kind = 'import' and v_existing.target_plan_id <> p_target) then
    raise exception 'That idempotency key was used for a different copy' using errcode = 'PT409';
  end if;
  return v_existing.target_plan_id;
end;
$$;

-- Copies the selected children of one plan into another plan of the same
-- organization. Security invoker: RLS still decides every read and write.
-- Copied staffing is a fresh request: unconfirmed, never notified, no answer.
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
begin
  if p_items then
    select coalesce(max(sort_order) + 1, 0) into v_base from public.plan_items where plan_id = p_target;
    insert into public.plan_items (
      plan_id, item_type, title, song_id, arrangement_id, key_override,
      length_seconds, description, sort_order
    )
    select p_target, i.item_type, i.title, i.song_id, i.arrangement_id, i.key_override,
           i.length_seconds, i.description,
           v_base + (row_number() over (order by i.sort_order, i.created_at, i.id))::int - 1
      from public.plan_items i
     where i.plan_id = p_source;
  end if;

  if p_time_offset is not null then
    insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
    select p_target, t.kind, t.name, t.starts_at + p_time_offset, t.ends_at + p_time_offset
      from public.plan_times t
     where t.plan_id = p_source;
  end if;

  if p_needs then
    -- A need the destination already has is the destination's decision.
    insert into public.plan_position_needs (plan_id, position_id, needed)
    select p_target, n.position_id, n.needed
      from public.plan_position_needs n
     where n.plan_id = p_source and n.needed > 0
    on conflict (plan_id, position_id) do nothing;
  end if;

  if p_assignments then
    insert into public.assignments (plan_id, user_id, team_id, position_id, status, created_by)
    select p_target, a.user_id, a.team_id, a.position_id, 'unconfirmed', (select auth.uid())
      from public.assignments a
     where a.plan_id = p_source
    on conflict do nothing;
  end if;
end;
$$;

revoke execute on function private.claim_plan_copy_key(uuid, text, text, uuid, uuid) from public;
revoke execute on function private.copy_plan_children(uuid, uuid, boolean, boolean, boolean, interval) from public;
grant execute on function private.claim_plan_copy_key(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function private.copy_plan_children(uuid, uuid, boolean, boolean, boolean, interval) to authenticated;

-- "Same as last week": a new draft plan with the source's order, times
-- (shifted by the same delta as the date), needs and, optionally, team.
create or replace function public.duplicate_plan(
  p_source_plan_id   uuid,
  p_service_date     timestamptz,
  p_title            text default null,
  p_copy_assignments boolean default true,
  p_idempotency_key  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source   public.plans;
  v_target   uuid := gen_random_uuid();
  v_existing uuid;
begin
  select * into v_source from public.plans where id = p_source_plan_id;
  if not found or not public.can_manage_org(v_source.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;

  v_existing := private.claim_plan_copy_key(
    v_source.organization_id, p_idempotency_key, 'duplicate', v_source.id, v_target);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
  values (v_target, v_source.organization_id, v_source.service_type_id,
          coalesce(nullif(btrim(p_title), ''), v_source.title), p_service_date,
          v_source.location, 'draft', v_source.notes, (select auth.uid()));

  perform private.copy_plan_children(
    v_source.id, v_target, true, true, coalesce(p_copy_assignments, true),
    p_service_date - v_source.service_date);
  return v_target;
end;
$$;

-- Create a plan with its times, optionally copying another plan's order and
-- needs (and team), in one transaction.
create or replace function public.create_plan(
  p_organization_id  uuid,
  p_plan             jsonb,
  p_times            jsonb default '[]',
  p_copy_from        uuid default null,
  p_copy_assignments boolean default false,
  p_idempotency_key  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target   uuid := gen_random_uuid();
  v_existing uuid;
  v_source   uuid;
begin
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Only a scheduler can create plans' using errcode = '42501';
  end if;
  if p_copy_from is not null then
    select id into v_source from public.plans
     where id = p_copy_from and organization_id = p_organization_id;
    if v_source is null then
      raise exception 'Plan to copy from not found' using errcode = 'P0002';
    end if;
  end if;

  v_existing := private.claim_plan_copy_key(p_organization_id, p_idempotency_key, 'create', v_source, v_target);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
  select v_target, p_organization_id, (p_plan->>'service_type_id')::uuid, p_plan->>'title',
         (p_plan->>'service_date')::timestamptz, p_plan->>'location',
         coalesce((p_plan->>'status')::public.plan_status, 'draft'), p_plan->>'notes', (select auth.uid());

  insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
  select v_target, coalesce(t.kind, 'service'), t.name, t.starts_at, t.ends_at
    from jsonb_to_recordset(coalesce(p_times, '[]')) as t(
      kind public.plan_time_kind, name text, starts_at timestamptz, ends_at timestamptz);

  if v_source is not null then
    perform private.copy_plan_children(v_source, v_target, true, true, coalesce(p_copy_assignments, false), null);
  end if;
  return v_target;
end;
$$;

-- Import another plan's order, needs and/or team into an existing plan.
-- Nothing on the destination is removed. With p_expected_revision, refuses
-- (409) when the destination's content changed since the caller read it.
create or replace function public.import_plan_contents(
  p_target_plan_id     uuid,
  p_source_plan_id     uuid,
  p_items              boolean,
  p_needs              boolean,
  p_assignments        boolean,
  p_expected_revision  bigint default null,
  p_idempotency_key    text default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target   public.plans;
  v_source   uuid;
  v_existing uuid;
  v_revision bigint;
begin
  -- Serializes imports into the same plan.
  select * into v_target from public.plans where id = p_target_plan_id for update;
  if not found or not public.can_manage_org(v_target.organization_id) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select id into v_source from public.plans
   where id = p_source_plan_id and organization_id = v_target.organization_id;
  if v_source is null or v_source = v_target.id then
    raise exception 'Plan to copy from not found' using errcode = 'P0002';
  end if;

  -- An idempotent retry is answered before the revision check: the first
  -- run is what moved the revision.
  v_existing := private.claim_plan_copy_key(v_target.organization_id, p_idempotency_key, 'import', v_source, v_target.id);
  if v_existing is not null then
    select content_revision into v_revision from public.plans where id = v_target.id;
    return v_revision;
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_target.content_revision then
    raise exception 'This plan changed since you opened it' using errcode = 'PT409';
  end if;

  perform private.copy_plan_children(v_source, v_target.id, p_items, p_needs, p_assignments, null);

  select content_revision into v_revision from public.plans where id = v_target.id;
  return v_revision;
end;
$$;

revoke execute on function public.duplicate_plan(uuid, timestamptz, text, boolean, text) from public, anon;
grant execute on function public.duplicate_plan(uuid, timestamptz, text, boolean, text) to authenticated;
revoke execute on function public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text) from public, anon;
grant execute on function public.create_plan(uuid, jsonb, jsonb, uuid, boolean, text) to authenticated;
revoke execute on function public.import_plan_contents(uuid, uuid, boolean, boolean, boolean, bigint, text) from public, anon;
grant execute on function public.import_plan_contents(uuid, uuid, boolean, boolean, boolean, bigint, text) to authenticated;

comment on table public.delivery_effects is
  'One logical side effect of an action (schedule, reminder, response), unique per organization by effect_key.';
comment on table public.deliveries is
  'Outbox: one row per effect recipient and channel, claimed by the delivery worker with a lease.';
comment on table public.delivery_attempts is
  'Per-attempt delivery history. Service role only.';
comment on table public.plan_copy_operations is
  'Idempotency keys for atomic plan copy, duplicate and import operations.';
