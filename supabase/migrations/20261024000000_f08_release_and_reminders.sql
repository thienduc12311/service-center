-- F08: consolidated/scheduled release, scoped-link continuity, reminder
-- policies and durable reminder jobs.
--
-- Builds on MOB-005 (exact request snapshots, versioned release, atomic link
-- answers), F00 (delivery_effects/deliveries outbox and leased worker), F01
-- (scoped capabilities, prepared visibility), F02 (Person identity/archive)
-- and F04 (private.assignment_attendance). Additive; no historical migration
-- is edited. Functions replaced in place:
--   private.create_assignment_request_snapshot  (one snapshot per effect/Person/plan)
--   private.supersede_replaced_snapshot         (keeps the previous link usable)
--   public.respond_via_assignment_link          (accepts the previous token)
--   public.complete_delivery                    (Person-based bookkeeping, link promotion)
--
-- Release review = release scope: a batch stores the exact reviewed
-- (assignment, request_revision) pairs; execution re-checks every one and the
-- actor's capability, and fails whole rather than releasing a different set.
--
-- Reminder jobs are intent rows with a semantic key (kind, Person, plan,
-- request version, policy@revision, occurrence, channel). Materialization at
-- the due time turns one into one outbox effect + one delivery, so F00's
-- lease/retry/backoff/ambiguous handling applies unchanged.

alter type public.delivery_template add value if not exists 'service_reminder';

create type public.reminder_kind as enum ('pending_response', 'confirmed_service');
create type public.reminder_job_status as enum ('scheduled', 'enqueued', 'cancelled', 'skipped');
create type public.release_batch_status as enum ('scheduled', 'released', 'cancelled', 'failed');

-- ===================================================== snapshot scope =====
-- A consolidated release gives one Person one snapshot per plan in the same
-- effect, so each plan's link answers only that plan.
drop index if exists public.assignment_request_snapshots_effect_person_idx;
create unique index assignment_request_snapshots_effect_person_plan_idx
  on public.assignment_request_snapshots (effect_id, person_id, plan_id)
  where effect_id is not null;

create or replace function private.create_assignment_request_snapshot(
  p_effect uuid,
  p_person uuid,
  p_plan uuid,
  p_assignment_ids uuid[],
  p_actor uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot uuid;
  v_org uuid;
  v_expiry timestamptz;
begin
  select organization_id, greatest(service_date + interval '1 day', now() + interval '15 minutes')
    into v_org, v_expiry from public.plans where id = p_plan;
  if v_org is null or not exists (
    select 1 from public.people where id = p_person and organization_id = v_org
  ) then
    raise exception 'Snapshot recipient is not on this plan' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_assignment_ids) ids(id)
     where not exists (
       select 1 from public.assignments a
        where a.id = ids.id and a.plan_id = p_plan and a.person_id = p_person
          and a.visibility = 'released'
     )
  ) then
    raise exception 'Snapshot contains an unavailable request' using errcode = '22023';
  end if;

  insert into public.assignment_request_snapshots (
    organization_id, person_id, plan_id, effect_id, expires_at, created_by
  ) values (v_org, p_person, p_plan, p_effect, v_expiry, p_actor)
  on conflict (effect_id, person_id, plan_id) where effect_id is not null do nothing
  returning id into v_snapshot;

  if v_snapshot is null then
    select id into v_snapshot from public.assignment_request_snapshots
     where effect_id = p_effect and person_id = p_person and plan_id = p_plan;
    return v_snapshot;
  end if;

  insert into public.assignment_request_snapshot_items (
    snapshot_id, assignment_id, expected_request_revision, expected_status, plan_time_ids
  )
  select v_snapshot, a.id, a.request_revision, a.status, private.assignment_time_ids(a.id)
    from public.assignments a
   where a.id = any(p_assignment_ids) and a.person_id = p_person and a.plan_id = p_plan
   order by a.id;

  return v_snapshot;
end;
$$;
revoke execute on function private.create_assignment_request_snapshot(uuid, uuid, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function private.create_assignment_request_snapshot(uuid, uuid, uuid, uuid[], uuid) to service_role;

-- ===================================================== release batches ====

create table public.release_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash     text not null,
  notify           boolean not null default true,
  scheduled_for    timestamptz not null,
  status           public.release_batch_status not null default 'scheduled',
  item_count       int not null check (item_count between 1 and 500),
  plan_count       int not null check (plan_count >= 1),
  effect_id        uuid references public.delivery_effects (id) on delete set null,
  released_at      timestamptz,
  cancelled_at     timestamptz,
  failure_code     text check (failure_code is null or char_length(failure_code) <= 64),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint release_batches_key_unique unique (organization_id, created_by, idempotency_key),
  constraint release_batches_released_shape check ((status = 'released') = (released_at is not null))
);
create index release_batches_due_idx on public.release_batches (scheduled_for) where status = 'scheduled';
create index release_batches_org_created_idx on public.release_batches (organization_id, created_at desc);
create index release_batches_created_by_idx on public.release_batches (created_by);
create index release_batches_effect_idx on public.release_batches (effect_id);
create trigger set_updated_at before update on public.release_batches
  for each row execute function public.set_updated_at();

create table public.release_batch_items (
  batch_id                   uuid not null references public.release_batches (id) on delete cascade,
  assignment_id              uuid not null references public.assignments (id) on delete cascade,
  plan_id                    uuid not null references public.plans (id) on delete cascade,
  expected_request_revision  bigint not null,
  primary key (batch_id, assignment_id)
);
create index release_batch_items_assignment_idx on public.release_batch_items (assignment_id);
create index release_batch_items_plan_idx on public.release_batch_items (plan_id);

alter table public.delivery_effects
  add column release_batch_id uuid references public.release_batches (id) on delete set null;
create index delivery_effects_release_batch_idx on public.delivery_effects (release_batch_id);

alter table public.release_batches enable row level security;
alter table public.release_batch_items enable row level security;
create policy release_batches_select on public.release_batches
  for select to authenticated using (
    created_by = (select auth.uid()) or (select public.is_org_admin(organization_id))
  );
create policy release_batch_items_select on public.release_batch_items
  for select to authenticated using (
    exists (select 1 from public.release_batches b
             where b.id = batch_id
               and (b.created_by = (select auth.uid()) or public.is_org_admin(b.organization_id)))
  );
revoke insert, update, delete, truncate on public.release_batches, public.release_batch_items from anon, authenticated;

-- One effect for the whole batch; one snapshot per Person per plan; one
-- delivery per Person per channel. The email lists each plan with its own
-- link, so answering one plan never answers another.
create or replace function private.enqueue_release_batch_requests(p_batch uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.release_batches;
  v_effect uuid;
  v_ids uuid[];
  v_plans uuid[];
  v_recipient record;
  v_group record;
begin
  select * into v_batch from public.release_batches where id = p_batch;
  select coalesce(array_agg(a.id order by a.id), '{}'), coalesce(array_agg(distinct a.plan_id), '{}')
    into v_ids, v_plans
    from public.release_batch_items i
    join public.assignments a on a.id = i.assignment_id
   where i.batch_id = p_batch and a.visibility = 'released';
  if cardinality(v_ids) = 0 then return null; end if;

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids, created_by, release_batch_id
  ) values (
    v_batch.organization_id, 'release-batch:' || p_batch::text, 'assignment_request',
    case when cardinality(v_plans) = 1 then v_plans[1] end, v_ids, v_batch.created_by, p_batch
  )
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_batch.organization_id and effect_key = 'release-batch:' || p_batch::text;
    return v_effect;
  end if;

  for v_recipient in
    select a.person_id, p.profile_id
      from public.assignments a join public.people p on p.id = a.person_id
     where a.id = any(v_ids)
     group by a.person_id, p.profile_id
     order by a.person_id
  loop
    for v_group in
      select a.plan_id, array_agg(a.id order by a.id) ids
        from public.assignments a
       where a.id = any(v_ids) and a.person_id = v_recipient.person_id
       group by a.plan_id order by a.plan_id
    loop
      perform private.create_assignment_request_snapshot(
        v_effect, v_recipient.person_id, v_group.plan_id, v_group.ids, v_batch.created_by
      );
    end loop;
    insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
    values (v_batch.organization_id, v_effect, v_recipient.profile_id, v_recipient.person_id, 'email');
    if v_recipient.profile_id is not null then
      insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
      values (v_batch.organization_id, v_effect, v_recipient.profile_id, v_recipient.person_id, 'in_app'),
             (v_batch.organization_id, v_effect, v_recipient.profile_id, v_recipient.person_id, 'push');
    end if;
  end loop;
  return v_effect;
end;
$$;
revoke execute on function private.enqueue_release_batch_requests(uuid) from public, anon, authenticated;

-- Releases a batch now if it is still exactly what was reviewed and the
-- person who scheduled it may still release every row. Otherwise the batch
-- is marked failed and nothing is released. Returns the resulting status.
create or replace function private.execute_release_batch(p_batch uuid)
returns public.release_batch_status
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.release_batches;
  v_plan uuid;
  v_failure text;
  v_effect uuid;
begin
  select * into v_batch from public.release_batches where id = p_batch for update;
  if not found or v_batch.status <> 'scheduled' then
    return v_batch.status;
  end if;

  -- Same lock key, taken in plan order, as release_plan_assignments.
  for v_plan in
    select distinct i.plan_id from public.release_batch_items i where i.batch_id = p_batch order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('release:' || v_plan::text, 0));
  end loop;
  perform 1 from public.assignments a
    join public.release_batch_items i on i.assignment_id = a.id
   where i.batch_id = p_batch
   order by a.id
     for update of a;

  if (select count(*) from public.release_batch_items i
        join public.assignments a on a.id = i.assignment_id and a.plan_id = i.plan_id
       where i.batch_id = p_batch) <> v_batch.item_count then
    v_failure := 'scope_changed';
  elsif v_batch.created_by is null or not exists (
          select 1 from public.organization_members m
           where m.organization_id = v_batch.organization_id
             and m.user_id = v_batch.created_by and m.status = 'active')
        or exists (
          select 1 from public.release_batch_items i
            join public.assignments a on a.id = i.assignment_id
           where i.batch_id = p_batch
             and not private.can_schedule_on_plan(v_batch.created_by, a.plan_id, a.team_id)) then
    v_failure := 'actor_not_permitted';
  elsif exists (
          select 1 from public.release_batch_items i
            join public.assignments a on a.id = i.assignment_id
           where i.batch_id = p_batch
             and (a.visibility <> 'prepared' or a.request_revision <> i.expected_request_revision)) then
    v_failure := 'scope_changed';
  end if;

  if v_failure is not null then
    update public.release_batches set status = 'failed', failure_code = v_failure where id = p_batch;
    return 'failed';
  end if;

  perform set_config('app.releasing_assignments', 'on', true);
  update public.assignments a
     set visibility = 'released', released_at = now(), released_by = v_batch.created_by
    from public.release_batch_items i
   where i.batch_id = p_batch and i.assignment_id = a.id;
  perform set_config('app.releasing_assignments', '', true);

  if v_batch.notify then
    v_effect := private.enqueue_release_batch_requests(p_batch);
  end if;
  update public.release_batches
     set status = 'released', released_at = now(), effect_id = v_effect
   where id = p_batch;
  return 'released';
end;
$$;
revoke execute on function private.execute_release_batch(uuid) from public, anon, authenticated;

-- Create a reviewed batch across one or more plans. p_items is
-- [{assignment_id, request_revision}] exactly as reviewed. With no (or a
-- past) p_scheduled_for it is released in this transaction, and a stale
-- review raises PT409 with nothing committed. The same key returns the
-- same batch; reusing a key for different content is refused.
create or replace function public.create_release_batch(
  p_org             uuid,
  p_items           jsonb,
  p_notify          boolean,
  p_scheduled_for   timestamptz,
  p_idempotency_key text
)
returns public.release_batches
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_batch public.release_batches;
  v_hash text;
  v_count int;
  v_plans int;
  v_status public.release_batch_status;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then
    raise exception 'Choose between 1 and 500 requests to release' using errcode = '22023';
  end if;
  if p_scheduled_for is not null and p_scheduled_for > now() + interval '366 days' then
    raise exception 'A release can be scheduled at most a year ahead' using errcode = '22023';
  end if;

  select md5(coalesce(string_agg(r.assignment_id::text || ':' || r.request_revision, ',' order by r.assignment_id), '')
             || '|' || coalesce(p_notify, true)::text || '|' || coalesce(p_scheduled_for::text, 'now')),
         count(*), count(distinct r.assignment_id)
    into v_hash, v_count, v_plans
    from jsonb_to_recordset(p_items) r(assignment_id uuid, request_revision bigint);
  if v_count <> v_plans or exists (
    select 1 from jsonb_to_recordset(p_items) r(assignment_id uuid, request_revision bigint)
     where r.assignment_id is null or r.request_revision is null) then
    raise exception 'Each reviewed request must appear once with its revision' using errcode = '22023';
  end if;

  select * into v_batch from public.release_batches
   where organization_id = p_org and created_by = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> v_hash then
      raise exception 'That idempotency key was used for a different release' using errcode = 'PT409';
    end if;
    return v_batch;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) r(assignment_id uuid, request_revision bigint)
     where not exists (
       select 1 from public.assignments a join public.plans p on p.id = a.plan_id
        where a.id = r.assignment_id and p.organization_id = p_org
          and private.can_schedule_on_plan(v_actor, a.plan_id, a.team_id))
  ) then
    raise exception 'Some of those requests are not yours to release' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) r(assignment_id uuid, request_revision bigint)
      join public.assignments a on a.id = r.assignment_id
     where a.visibility <> 'prepared' or a.request_revision <> r.request_revision
  ) then
    raise exception 'Prepared requests changed since the release review' using errcode = 'PT409';
  end if;

  select count(distinct a.plan_id) into v_plans
    from jsonb_to_recordset(p_items) r(assignment_id uuid, request_revision bigint)
    join public.assignments a on a.id = r.assignment_id;

  insert into public.release_batches (
    organization_id, created_by, idempotency_key, request_hash, notify, scheduled_for, item_count, plan_count
  ) values (
    p_org, v_actor, p_idempotency_key, v_hash, coalesce(p_notify, true),
    coalesce(p_scheduled_for, now()), v_count, v_plans
  )
  on conflict (organization_id, created_by, idempotency_key) do nothing
  returning * into v_batch;
  if v_batch.id is null then
    -- A concurrent call with the same key won.
    select * into v_batch from public.release_batches
     where organization_id = p_org and created_by = v_actor and idempotency_key = p_idempotency_key;
    if v_batch.request_hash <> v_hash then
      raise exception 'That idempotency key was used for a different release' using errcode = 'PT409';
    end if;
    return v_batch;
  end if;

  insert into public.release_batch_items (batch_id, assignment_id, plan_id, expected_request_revision)
  select v_batch.id, a.id, a.plan_id, r.request_revision
    from jsonb_to_recordset(p_items) r(assignment_id uuid, request_revision bigint)
    join public.assignments a on a.id = r.assignment_id;

  if p_scheduled_for is null or p_scheduled_for <= now() then
    v_status := private.execute_release_batch(v_batch.id);
    if v_status <> 'released' then
      raise exception 'Prepared requests changed since the release review' using errcode = 'PT409';
    end if;
    select * into v_batch from public.release_batches where id = v_batch.id;
  end if;
  return v_batch;
end;
$$;
revoke execute on function public.create_release_batch(uuid, jsonb, boolean, timestamptz, text) from public, anon;
grant execute on function public.create_release_batch(uuid, jsonb, boolean, timestamptz, text) to authenticated;

-- The creator or an administrator cancels a batch that has not run yet.
-- Cancelling twice is a no-op; a released or failed batch is reported as is.
create or replace function public.cancel_release_batch(p_batch uuid)
returns public.release_batches
language plpgsql security definer set search_path = '' as $$
declare v_batch public.release_batches;
begin
  select * into v_batch from public.release_batches where id = p_batch for update;
  if not found or not (v_batch.created_by = (select auth.uid()) or public.is_org_admin(v_batch.organization_id)) then
    raise exception 'Release not found' using errcode = 'P0002';
  end if;
  if v_batch.status = 'scheduled' then
    update public.release_batches set status = 'cancelled', cancelled_at = now()
     where id = p_batch returning * into v_batch;
  end if;
  return v_batch;
end;
$$;
revoke execute on function public.cancel_release_batch(uuid) from public, anon;
grant execute on function public.cancel_release_batch(uuid) to authenticated;

-- Worker: run due scheduled releases. SKIP LOCKED, so concurrent runs never
-- execute the same batch; each batch runs in its own subtransaction.
create or replace function public.run_due_release_batches(p_limit int default 20)
returns table (batch_id uuid, status public.release_batch_status, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in
    select b.id from public.release_batches b
     where b.status = 'scheduled' and b.scheduled_for <= now()
     order by b.scheduled_for, b.id
     limit least(greatest(p_limit, 1), 100)
     for update skip locked
  loop
    begin
      perform private.execute_release_batch(v_id);
    exception when others then
      update public.release_batches set status = 'failed', failure_code = 'internal_error' where id = v_id;
    end;
    return query select b.id, b.status, b.effect_id from public.release_batches b where b.id = v_id;
  end loop;
end;
$$;
revoke execute on function public.run_due_release_batches(int) from public, anon, authenticated;
grant execute on function public.run_due_release_batches(int) to service_role;

-- ===================================================== link continuity ====
-- A resend issues a fresh token but the last token the provider accepted
-- keeps working until the replacement itself is accepted. Answering through
-- either consumes the row (both tokens), so there is still one answer.

alter table public.assignment_notifications
  add column previous_token_hash  text,
  add column previous_snapshot_id uuid references public.assignment_request_snapshots (id) on delete set null,
  add column previous_expires_at  timestamptz,
  add column issued_delivery_id   uuid references public.deliveries (id) on delete set null,
  add constraint assignment_notifications_previous_shape check (
    (previous_token_hash is null) = (previous_expires_at is null)
  );
create unique index assignment_notifications_previous_token_idx
  on public.assignment_notifications (previous_token_hash) where previous_token_hash is not null;
create index assignment_notifications_previous_snapshot_idx
  on public.assignment_notifications (previous_snapshot_id) where previous_snapshot_id is not null;
create index assignment_notifications_issued_delivery_idx
  on public.assignment_notifications (issued_delivery_id) where issued_delivery_id is not null;

create or replace function private.supersede_replaced_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.snapshot_id is not null and new.snapshot_id is distinct from old.snapshot_id
     and old.snapshot_id is distinct from new.previous_snapshot_id then
    update public.assignment_request_snapshots set superseded_at = now()
     where id = old.snapshot_id and consumed_at is null and superseded_at is null;
  end if;
  if old.previous_snapshot_id is not null
     and new.previous_snapshot_id is distinct from old.previous_snapshot_id
     and old.previous_snapshot_id is distinct from new.snapshot_id then
    update public.assignment_request_snapshots set superseded_at = now()
     where id = old.previous_snapshot_id and consumed_at is null and superseded_at is null;
  end if;
  return null;
end;
$$;
revoke execute on function private.supersede_replaced_snapshot() from public, anon, authenticated;
drop trigger if exists assignment_notifications_supersede_snapshot on public.assignment_notifications;
create trigger assignment_notifications_supersede_snapshot
  after update of snapshot_id, previous_snapshot_id on public.assignment_notifications
  for each row execute function private.supersede_replaced_snapshot();

-- Called by the worker immediately before an email that carries a link.
-- Rotation: an accepted current token becomes the previous one; a current
-- token that was never accepted is simply replaced, keeping the previous.
-- Re-issuing the same token (same delivery, deterministic token) is a no-op.
create or replace function public.issue_assignment_link(
  p_delivery   uuid,
  p_snapshot   uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_email      text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_delivery public.deliveries;
  v_snapshot public.assignment_request_snapshots;
  v_effect public.delivery_effects;
  v_link public.assignment_notifications;
  v_profile uuid;
begin
  select * into v_delivery from public.deliveries where id = p_delivery;
  select * into v_snapshot from public.assignment_request_snapshots where id = p_snapshot;
  select * into v_effect from public.delivery_effects where id = v_delivery.effect_id;
  if v_delivery.id is null or v_snapshot.id is null or v_snapshot.effect_id is distinct from v_delivery.effect_id
     or v_snapshot.person_id <> v_delivery.recipient_person_id then
    raise exception 'Link does not match its delivery' using errcode = '22023';
  end if;
  select profile_id into v_profile from public.people where id = v_snapshot.person_id;

  perform pg_advisory_xact_lock(hashtextextended(
    'assignment-link:' || v_snapshot.plan_id::text || ':' || v_snapshot.person_id::text, 0));
  select * into v_link from public.assignment_notifications
   where plan_id = v_snapshot.plan_id and person_id = v_snapshot.person_id and responded_at is null
   for update;

  if not found then
    insert into public.assignment_notifications (
      organization_id, plan_id, person_id, user_id, snapshot_id, email, token_hash,
      expires_at, created_by, issued_delivery_id
    ) values (
      v_snapshot.organization_id, v_snapshot.plan_id, v_snapshot.person_id, v_profile, p_snapshot,
      p_email, p_token_hash, p_expires_at, v_effect.created_by, p_delivery
    ) returning * into v_link;
    return v_link.id;
  end if;

  if v_link.token_hash = p_token_hash then
    return v_link.id;
  end if;

  update public.assignment_notifications
     set previous_token_hash  = case when v_link.sent_at is not null then v_link.token_hash else v_link.previous_token_hash end,
         previous_snapshot_id = case when v_link.sent_at is not null then v_link.snapshot_id else v_link.previous_snapshot_id end,
         previous_expires_at  = case when v_link.sent_at is not null then v_link.expires_at else v_link.previous_expires_at end,
         token_hash = p_token_hash,
         snapshot_id = p_snapshot,
         expires_at = p_expires_at,
         email = p_email,
         sent_at = null,
         issued_delivery_id = p_delivery,
         created_by = coalesce(v_effect.created_by, created_by)
   where id = v_link.id;
  return v_link.id;
end;
$$;
revoke execute on function public.issue_assignment_link(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.issue_assignment_link(uuid, uuid, text, timestamptz, text) to service_role;

create or replace function public.respond_via_assignment_link(
  p_token_hash text,
  p_status public.assignment_status
)
returns table (outcome text, assignments_updated int, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_link public.assignment_notifications;
  v_snapshot public.assignment_request_snapshots;
  v_snapshot_id uuid;
  v_answers jsonb;
  v_apply record;
begin
  if p_status not in ('confirmed','declined') then
    raise exception 'An answer is either confirmed or declined' using errcode = '22023';
  end if;
  select * into v_link from public.assignment_notifications
   where token_hash = p_token_hash or previous_token_hash = p_token_hash
   for update;
  if not found then return query select 'not_found'::text, 0, null::uuid; return; end if;
  if v_link.responded_at is not null then return query select 'used'::text, 0, null::uuid; return; end if;
  if v_link.token_hash = p_token_hash then
    if v_link.expires_at <= now() then return query select 'expired'::text, 0, null::uuid; return; end if;
    v_snapshot_id := v_link.snapshot_id;
  else
    if v_link.previous_expires_at <= now() then return query select 'expired'::text, 0, null::uuid; return; end if;
    v_snapshot_id := v_link.previous_snapshot_id;
  end if;
  select * into v_snapshot from public.assignment_request_snapshots where id = v_snapshot_id;
  if not found or v_snapshot.superseded_at is not null then
    return query select 'stale'::text, 0, null::uuid; return;
  end if;

  select jsonb_agg(jsonb_build_object(
    'assignment_id', i.assignment_id,
    'plan_time_id', times.time_id,
    'status', p_status::text,
    'reason', null
  ) order by i.assignment_id, times.time_id) into v_answers
    from public.assignment_request_snapshot_items i
    cross join lateral unnest(
      case when cardinality(i.plan_time_ids) = 0 then array[null::uuid] else i.plan_time_ids end
    ) times(time_id)
   where i.snapshot_id = v_snapshot.id;

  begin
    select * into v_apply from private.apply_assignment_snapshot_response(
      v_snapshot.id, v_snapshot.version, v_answers, null,
      'assignment-link-response:' || v_link.id::text
    );
  exception
    when sqlstate 'PT409' then
      return query select 'stale'::text, 0, null::uuid; return;
    when sqlstate 'PT410' then
      return query select 'expired'::text, 0, null::uuid; return;
  end;

  update public.assignment_notifications set responded_at = now() where id = v_link.id;
  return query select 'ok'::text, v_apply.assignments_updated,
    case when cardinality(v_apply.effect_ids) > 0 then v_apply.effect_ids[1] else null end;
end;
$$;
revoke execute on function public.respond_via_assignment_link(text, public.assignment_status) from public, anon, authenticated;
grant execute on function public.respond_via_assignment_link(text, public.assignment_status) to service_role;

-- ===================================================== reminder policies ==

create table public.reminder_policies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  service_type_id  uuid references public.service_types (id) on delete cascade,
  team_id          uuid references public.teams (id) on delete cascade,
  kind             public.reminder_kind not null,
  enabled          boolean not null default true,
  -- How long before the first applicable time the reminder is due.
  offset_minutes   int not null check (offset_minutes between 15 and 43200),
  channels         public.delivery_channel[] not null default '{in_app,push,email}',
  -- Local wall-clock quiet window in the organization's time zone; may
  -- cross midnight. Both null = no quiet hours.
  quiet_start      time,
  quiet_end        time,
  -- Frequency cap: reminders per Person per channel per rolling 24 hours.
  max_per_day      int not null default 2 check (max_per_day between 1 and 10),
  revision         bigint not null default 1,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reminder_policies_one_scope check (service_type_id is null or team_id is null),
  constraint reminder_policies_channels check (cardinality(channels) between 1 and 3),
  constraint reminder_policies_quiet_shape check (
    (quiet_start is null) = (quiet_end is null) and (quiet_start is null or quiet_start <> quiet_end)
  ),
  constraint reminder_policies_scope_unique unique nulls not distinct (organization_id, kind, service_type_id, team_id)
);
create index reminder_policies_service_type_idx on public.reminder_policies (service_type_id) where service_type_id is not null;
create index reminder_policies_team_idx on public.reminder_policies (team_id) where team_id is not null;
create index reminder_policies_updated_by_idx on public.reminder_policies (updated_by);

-- Scope must belong to the organization; revision bumps on every change.
create or replace function private.guard_reminder_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.service_type_id is not null and not exists (
       select 1 from public.service_types where id = new.service_type_id and organization_id = new.organization_id)
     or new.team_id is not null and not exists (
       select 1 from public.teams where id = new.team_id and organization_id = new.organization_id) then
    raise exception 'Reminder policy scope is not in this organization' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.kind <> old.kind
       or new.service_type_id is distinct from old.service_type_id or new.team_id is distinct from old.team_id then
      raise exception 'A reminder policy keeps its scope' using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.guard_reminder_policy() from public, anon, authenticated;
create trigger reminder_policies_guard
  before insert or update on public.reminder_policies
  for each row execute function private.guard_reminder_policy();

create or replace function private.can_edit_reminder_policy(p_org uuid, p_service_type uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_team is not null then
      private.capability_for((select auth.uid()), p_org, 'scheduling.manage', null, p_team)
      or private.capability_for((select auth.uid()), p_org, 'teams.manage', null, p_team)
    when p_service_type is not null then
      private.capability_for((select auth.uid()), p_org, 'scheduling.manage', p_service_type, null)
      or private.capability_for((select auth.uid()), p_org, 'plans.edit', p_service_type, null)
    else public.is_org_admin(p_org)
  end;
$$;
revoke execute on function private.can_edit_reminder_policy(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_edit_reminder_policy(uuid, uuid, uuid) to authenticated, service_role;

alter table public.reminder_policies enable row level security;
create policy reminder_policies_select on public.reminder_policies
  for select to authenticated using ((select public.can_manage_org(organization_id)));
create policy reminder_policies_insert on public.reminder_policies
  for insert to authenticated with check ((select private.can_edit_reminder_policy(organization_id, service_type_id, team_id)));
create policy reminder_policies_update on public.reminder_policies
  for update to authenticated
  using ((select private.can_edit_reminder_policy(organization_id, service_type_id, team_id)))
  with check ((select private.can_edit_reminder_policy(organization_id, service_type_id, team_id)));
create policy reminder_policies_delete on public.reminder_policies
  for delete to authenticated using ((select private.can_edit_reminder_policy(organization_id, service_type_id, team_id)));
grant select, insert, update, delete on public.reminder_policies to authenticated;

-- Team → service type → organization → built-in default. The built-in
-- Service Center defaults: one pending-response reminder 72 h before the
-- first applicable service time; one confirmed-service reminder 24 h
-- before the first applicable attendance time; all channels; no quiet
-- hours; at most 2 per Person per channel per day.
create or replace function private.effective_reminder_policy(
  p_org uuid, p_service_type uuid, p_team uuid, p_kind public.reminder_kind
)
returns table (
  policy_id uuid, source text, revision bigint, enabled boolean, offset_minutes int,
  channels public.delivery_channel[], quiet_start time, quiet_end time, max_per_day int
)
language sql stable security definer set search_path = '' as $$
  select x.policy_id, x.source, x.revision, x.enabled, x.offset_minutes, x.channels,
         x.quiet_start, x.quiet_end, x.max_per_day
    from (
      select rp.id policy_id,
             case when rp.team_id is not null then 'team'
                  when rp.service_type_id is not null then 'service_type'
                  else 'organization' end source,
             rp.revision, rp.enabled, rp.offset_minutes, rp.channels, rp.quiet_start, rp.quiet_end, rp.max_per_day,
             case when rp.team_id is not null then 1 when rp.service_type_id is not null then 2 else 3 end rank
        from public.reminder_policies rp
       where rp.organization_id = p_org and rp.kind = p_kind
         and ((rp.team_id is not null and rp.team_id = p_team)
           or (rp.service_type_id is not null and rp.service_type_id = p_service_type)
           or (rp.team_id is null and rp.service_type_id is null))
      union all
      select null, 'default', 0, true,
             case p_kind when 'pending_response' then 4320 else 1440 end,
             '{in_app,push,email}'::public.delivery_channel[], null::time, null::time, 2, 4
    ) x
   order by x.rank
   limit 1;
$$;
revoke execute on function private.effective_reminder_policy(uuid, uuid, uuid, public.reminder_kind) from public, anon;
grant execute on function private.effective_reminder_policy(uuid, uuid, uuid, public.reminder_kind) to authenticated, service_role;

-- What a leader sees as "the policy in effect" for a scope.
create or replace function public.effective_reminder_policies(p_org uuid, p_service_type uuid, p_team uuid)
returns table (
  kind public.reminder_kind, policy_id uuid, source text, revision bigint, enabled boolean,
  offset_minutes int, channels public.delivery_channel[], quiet_start time, quiet_end time, max_per_day int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_org(p_org) then
    raise exception 'Reminder policies not found' using errcode = 'P0002';
  end if;
  return query
    select k.kind, e.* from unnest(enum_range(null::public.reminder_kind)) k(kind)
     cross join lateral private.effective_reminder_policy(
       p_org,
       coalesce(p_service_type, (select t.service_type_id from public.teams t where t.id = p_team and t.organization_id = p_org)),
       p_team, k.kind) e;
end;
$$;
revoke execute on function public.effective_reminder_policies(uuid, uuid, uuid) from public, anon;
grant execute on function public.effective_reminder_policies(uuid, uuid, uuid) to authenticated;

-- Person-level channel opt-outs for reminders (requests are not affected).
create table public.person_reminder_preferences (
  person_id        uuid primary key references public.people (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            boolean not null default true,
  push             boolean not null default true,
  in_app           boolean not null default true,
  updated_at       timestamptz not null default now()
);
create index person_reminder_preferences_org_idx on public.person_reminder_preferences (organization_id);

create or replace function private.stamp_person_reminder_preferences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select organization_id into new.organization_id from public.people where id = new.person_id;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.stamp_person_reminder_preferences() from public, anon, authenticated;
create trigger person_reminder_preferences_stamp
  before insert or update on public.person_reminder_preferences
  for each row execute function private.stamp_person_reminder_preferences();

alter table public.person_reminder_preferences enable row level security;
create policy person_reminder_preferences_own on public.person_reminder_preferences
  for all to authenticated
  using (exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid())))
  with check (exists (select 1 from public.people p where p.id = person_id and p.profile_id = (select auth.uid())));
grant select, insert, update, delete on public.person_reminder_preferences to authenticated;

-- ======================================================== reminder jobs ===

create table public.reminder_jobs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  plan_id               uuid not null references public.plans (id) on delete cascade,
  person_id             uuid not null references public.people (id) on delete cascade,
  kind                  public.reminder_kind not null,
  channel               public.delivery_channel not null,
  policy_id             uuid references public.reminder_policies (id) on delete set null,
  policy_revision       bigint not null,
  -- md5 of the sorted (assignment, request_revision, status) set it covers.
  request_version       text not null,
  assignment_ids        uuid[] not null,
  occurrence_time_id    uuid,
  occurrence_starts_at  timestamptz not null,
  semantic_key          text not null,
  due_at                timestamptz not null,
  timezone              text not null,
  quiet_start           time,
  quiet_end             time,
  max_per_day           int not null,
  status                public.reminder_job_status not null default 'scheduled',
  status_reason         text check (status_reason is null or char_length(status_reason) <= 64),
  effect_id             uuid references public.delivery_effects (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint reminder_jobs_key_unique unique (organization_id, semantic_key),
  constraint reminder_jobs_enqueued_shape check (status <> 'enqueued' or effect_id is not null)
);
create index reminder_jobs_due_idx on public.reminder_jobs (due_at) where status = 'scheduled';
create index reminder_jobs_plan_person_idx on public.reminder_jobs (plan_id, person_id);
create index reminder_jobs_person_channel_idx on public.reminder_jobs (person_id, channel);
create index reminder_jobs_policy_idx on public.reminder_jobs (policy_id) where policy_id is not null;
create index reminder_jobs_effect_idx on public.reminder_jobs (effect_id) where effect_id is not null;
create trigger set_updated_at before update on public.reminder_jobs
  for each row execute function public.set_updated_at();

alter table public.delivery_effects
  add column reminder_job_id uuid references public.reminder_jobs (id) on delete set null;
create index delivery_effects_reminder_job_idx on public.delivery_effects (reminder_job_id);

alter table public.reminder_jobs enable row level security;
create policy reminder_jobs_select on public.reminder_jobs
  for select to authenticated using (
    (select public.is_org_admin(organization_id))
    or exists (select 1 from public.assignments a
                where a.id = any(assignment_ids) and public.can_schedule_on_plan(a.plan_id, a.team_id))
  );
revoke insert, update, delete, truncate on public.reminder_jobs from anon, authenticated;

-- Plans whose reminders must be recomputed. Written by triggers, drained by
-- the worker (and by plan reads), never by clients.
create table public.reminder_recompute_queue (
  plan_id          uuid primary key references public.plans (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  queued_at        timestamptz not null default now()
);
create index reminder_recompute_queue_org_idx on public.reminder_recompute_queue (organization_id);
alter table public.reminder_recompute_queue enable row level security;
revoke all on public.reminder_recompute_queue from anon, authenticated;

-- Shift an instant out of a local quiet window. Wall-clock arithmetic is in
-- the organization's zone, so DST days keep the local end time (08:00 stays
-- 08:00 local whether the day has 23 or 25 hours).
create or replace function private.reminder_quiet_shift(p_at timestamptz, p_tz text, p_start time, p_end time)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp;
  v_time time;
  v_day date;
begin
  if p_start is null or p_end is null then return p_at; end if;
  v_local := p_at at time zone p_tz;
  v_time := v_local::time;
  v_day := v_local::date;
  if p_start < p_end then
    if v_time >= p_start and v_time < p_end then return (v_day + p_end) at time zone p_tz; end if;
  else
    if v_time >= p_start then return ((v_day + 1) + p_end) at time zone p_tz; end if;
    if v_time < p_end then return (v_day + p_end) at time zone p_tz; end if;
  end if;
  return p_at;
end;
$$;
revoke execute on function private.reminder_quiet_shift(timestamptz, text, time, time) from public, anon;
grant execute on function private.reminder_quiet_shift(timestamptz, text, time, time) to authenticated, service_role;

-- The reminder jobs a plan should have right now. Pending-response
-- reminders anchor on the first applicable service time (any time if the
-- request has none); confirmed-service reminders on the first applicable
-- attendance time, rehearsals included. Rows are grouped per Person and
-- effective policy, so a Person with three positions gets one reminder.
create or replace function private.desired_plan_reminders(p_plan uuid)
returns table (
  person_id uuid, kind public.reminder_kind, channel public.delivery_channel,
  policy_id uuid, policy_revision bigint, request_version text, assignment_ids uuid[],
  occurrence_time_id uuid, occurrence_starts_at timestamptz, due_at timestamptz,
  timezone text, quiet_start time, quiet_end time, max_per_day int, semantic_key text
)
language sql stable security definer set search_path = '' as $$
  with plan as (
    select p.id, p.organization_id, p.service_type_id, coalesce(o.timezone, 'UTC') tz
      from public.plans p join public.organizations o on o.id = p.organization_id
     where p.id = p_plan
  ), eligible as (
    select a.id, a.person_id, a.team_id, a.status, a.request_revision, pe.profile_id,
           case a.status when 'unconfirmed' then 'pending_response' else 'confirmed_service' end::public.reminder_kind kind
      from public.assignments a
      join public.people pe on pe.id = a.person_id
     where a.plan_id = p_plan and a.visibility = 'released'
       and a.status in ('unconfirmed', 'confirmed')
       and pe.archived_at is null
       and (pe.profile_id is null or exists (
             select 1 from public.organization_members m
              where m.organization_id = pe.organization_id and m.user_id = pe.profile_id and m.status = 'active'))
  ), with_policy as (
    select e.*, ep.policy_id, ep.revision, ep.offset_minutes, ep.channels, ep.quiet_start, ep.quiet_end, ep.max_per_day
      from eligible e
     cross join plan
     cross join lateral private.effective_reminder_policy(plan.organization_id, plan.service_type_id, e.team_id, e.kind) ep
     where ep.enabled
  ), grouped as (
    select w.person_id, w.profile_id, w.kind, w.policy_id, w.revision, w.offset_minutes, w.channels,
           w.quiet_start, w.quiet_end, w.max_per_day,
           array_agg(w.id order by w.id) ids,
           md5(string_agg(w.id::text || ':' || w.request_revision || ':' || w.status, ',' order by w.id)) version
      from with_policy w
     group by w.person_id, w.profile_id, w.kind, w.policy_id, w.revision, w.offset_minutes, w.channels,
              w.quiet_start, w.quiet_end, w.max_per_day
  ), anchored as (
    select g.*, o.plan_time_id, o.starts_at
      from grouped g
     cross join lateral (
       select v.plan_time_id, v.starts_at
         from private.assignment_attendance v
        where v.assignment_id = any(g.ids)
        order by (g.kind = 'pending_response' and v.kind <> 'service'), v.starts_at, v.plan_time_id
        limit 1
     ) o
  ), channelled as (
    select a.*, c.channel
      from anchored a
     cross join lateral unnest(a.channels) c(channel)
     where (c.channel = 'email' or a.profile_id is not null)
       and coalesce((select case c.channel when 'email' then pr.email when 'push' then pr.push else pr.in_app end
                       from public.person_reminder_preferences pr where pr.person_id = a.person_id), true)
  )
  select c.person_id, c.kind, c.channel, c.policy_id, c.revision, c.version, c.ids,
         c.plan_time_id, c.starts_at,
         private.reminder_quiet_shift(c.starts_at - make_interval(mins => c.offset_minutes), plan.tz, c.quiet_start, c.quiet_end),
         plan.tz, c.quiet_start, c.quiet_end, c.max_per_day,
         concat_ws(':', c.kind::text, c.person_id::text, p_plan::text, c.version,
                   coalesce(c.policy_id::text, 'default') || '@' || c.revision::text,
                   coalesce(c.plan_time_id::text, 'untimed') || '@' || floor(extract(epoch from c.starts_at))::bigint::text,
                   c.channel::text)
    from channelled c cross join plan;
$$;
revoke execute on function private.desired_plan_reminders(uuid) from public, anon, authenticated;

-- Bring a plan's jobs in line with its current state: add new intents,
-- cancel scheduled ones that no longer apply, and cancel enqueued ones whose
-- deliveries have not been sent yet. Returns the number of scheduled jobs.
create or replace function private.recompute_plan_reminders(p_plan uuid)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_keys text[];
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('reminders:' || p_plan::text, 0));
  delete from public.reminder_recompute_queue where plan_id = p_plan;
  select organization_id into v_org from public.plans where id = p_plan;
  if v_org is null then return 0; end if;

  select coalesce(array_agg(d.semantic_key), '{}') into v_keys from private.desired_plan_reminders(p_plan) d;

  insert into public.reminder_jobs (
    organization_id, plan_id, person_id, kind, channel, policy_id, policy_revision, request_version,
    assignment_ids, occurrence_time_id, occurrence_starts_at, semantic_key, due_at, timezone,
    quiet_start, quiet_end, max_per_day, status, status_reason
  )
  select v_org, p_plan, d.person_id, d.kind, d.channel, d.policy_id, d.policy_revision, d.request_version,
         d.assignment_ids, d.occurrence_time_id, d.occurrence_starts_at, d.semantic_key, d.due_at, d.timezone,
         d.quiet_start, d.quiet_end, d.max_per_day,
         case when d.due_at >= d.occurrence_starts_at or d.due_at <= now() then 'skipped' else 'scheduled' end::public.reminder_job_status,
         case when d.due_at >= d.occurrence_starts_at then 'quiet_hours'
              when d.due_at <= now() then 'due_passed' end
    from private.desired_plan_reminders(p_plan) d
  on conflict (organization_id, semantic_key) do update
     set status = 'scheduled', status_reason = null, due_at = excluded.due_at
   where public.reminder_jobs.status = 'cancelled' and excluded.status = 'scheduled';

  update public.reminder_jobs j
     set status = 'cancelled', status_reason = 'no_longer_applicable'
   where j.plan_id = p_plan
     and not (j.semantic_key = any(v_keys))
     and (j.status = 'scheduled'
          or (j.status = 'enqueued' and exists (
                select 1 from public.deliveries d
                 where d.effect_id = j.effect_id and d.status in ('queued', 'sending'))));

  select count(*) into v_count from public.reminder_jobs where plan_id = p_plan and status = 'scheduled';
  return v_count;
end;
$$;
revoke execute on function private.recompute_plan_reminders(uuid) from public, anon, authenticated;

-- A scheduler's view of a plan's reminders: recomputes first, so it is
-- current, then returns the jobs they may see.
create or replace function public.plan_reminder_jobs(p_plan uuid)
returns setof public.reminder_jobs
language plpgsql security definer set search_path = '' as $$
begin
  -- No caller identity = the service role (anon cannot execute this).
  if not exists (
    select 1 from public.plans p
     where p.id = p_plan and ((select auth.uid()) is null or public.can_manage_org(p.organization_id))
  ) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  perform private.recompute_plan_reminders(p_plan);
  return query
    select j.* from public.reminder_jobs j
     where j.plan_id = p_plan
       and ((select auth.uid()) is null or public.is_org_admin(j.organization_id)
            or exists (select 1 from public.assignments a
                        where a.id = any(j.assignment_ids)
                          and private.can_schedule_on_plan((select auth.uid()), a.plan_id, a.team_id)))
     order by j.due_at, j.person_id, j.channel;
end;
$$;
revoke execute on function public.plan_reminder_jobs(uuid) from public, anon;
grant execute on function public.plan_reminder_jobs(uuid) to authenticated, service_role;

-- True only while a materialized job is still the current intent. The
-- dispatcher asks this immediately before a provider call, so an answer,
-- removal, archive, time or policy change committed after enqueue
-- suppresses the obsolete reminder even if no recompute has run yet.
create or replace function public.reminder_job_is_current(p_job uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.reminder_jobs j
     where j.id = p_job and j.status = 'enqueued'
       and j.occurrence_starts_at > now()
       and exists (select 1 from private.desired_plan_reminders(j.plan_id) d
                    where d.semantic_key = j.semantic_key)
  );
$$;
revoke execute on function public.reminder_job_is_current(uuid) from public, anon, authenticated;
grant execute on function public.reminder_job_is_current(uuid) to service_role;

-- Worker: drain the recompute queue (bounded), then turn due jobs into
-- outbox effects. SKIP LOCKED plus the unique effect key mean two workers
-- can never materialize the same job twice.
create or replace function public.materialize_due_reminders(p_limit int default 50)
returns table (job_id uuid, outcome text, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_plan uuid;
  v_job public.reminder_jobs;
  v_now timestamptz := now();
  v_shift timestamptz;
  v_sent int;
  v_oldest timestamptz;
  v_effect uuid;
  v_profile uuid;
begin
  for v_plan in
    select q.plan_id from public.reminder_recompute_queue q
     order by q.queued_at limit 50
       for update skip locked
  loop
    perform private.recompute_plan_reminders(v_plan);
  end loop;

  for v_job in
    select * from public.reminder_jobs j
     where j.status = 'scheduled' and j.due_at <= v_now
     order by j.due_at, j.id
     limit least(greatest(p_limit, 1), 200)
       for update skip locked
  loop
    if v_job.occurrence_starts_at <= v_now then
      update public.reminder_jobs set status = 'skipped', status_reason = 'occurrence_started' where id = v_job.id;
      job_id := v_job.id; outcome := 'skipped'; effect_id := null; return next; continue;
    end if;
    if not exists (select 1 from private.desired_plan_reminders(v_job.plan_id) d
                    where d.semantic_key = v_job.semantic_key) then
      update public.reminder_jobs set status = 'cancelled', status_reason = 'no_longer_applicable' where id = v_job.id;
      job_id := v_job.id; outcome := 'cancelled'; effect_id := null; return next; continue;
    end if;

    -- A worker that was down may reach the job inside quiet hours.
    v_shift := private.reminder_quiet_shift(v_now, v_job.timezone, v_job.quiet_start, v_job.quiet_end);
    if v_shift > v_now then
      if v_shift >= v_job.occurrence_starts_at then
        update public.reminder_jobs set status = 'skipped', status_reason = 'quiet_hours' where id = v_job.id;
        job_id := v_job.id; outcome := 'skipped';
      else
        update public.reminder_jobs set due_at = v_shift where id = v_job.id;
        job_id := v_job.id; outcome := 'deferred';
      end if;
      effect_id := null; return next; continue;
    end if;

    select count(*), min(e.created_at) into v_sent, v_oldest
      from public.delivery_effects e
      join public.reminder_jobs other on other.id = e.reminder_job_id
     where other.person_id = v_job.person_id and other.channel = v_job.channel
       and e.created_at > v_now - interval '24 hours';
    if v_sent >= v_job.max_per_day then
      v_shift := v_oldest + interval '24 hours';
      if v_shift >= v_job.occurrence_starts_at then
        update public.reminder_jobs set status = 'skipped', status_reason = 'frequency_cap' where id = v_job.id;
        job_id := v_job.id; outcome := 'skipped';
      else
        update public.reminder_jobs set due_at = v_shift where id = v_job.id;
        job_id := v_job.id; outcome := 'deferred';
      end if;
      effect_id := null; return next; continue;
    end if;

    insert into public.delivery_effects (
      organization_id, effect_key, template, plan_id, assignment_ids, reminder_job_id
    ) values (
      v_job.organization_id, 'reminder:' || v_job.id::text,
      case v_job.kind when 'pending_response' then 'assignment_reminder' else 'service_reminder' end::public.delivery_template,
      v_job.plan_id, v_job.assignment_ids, v_job.id
    )
    on conflict (organization_id, effect_key) do nothing
    returning id into v_effect;
    if v_effect is null then
      select e.id into v_effect from public.delivery_effects e
       where e.organization_id = v_job.organization_id and e.effect_key = 'reminder:' || v_job.id::text;
    else
      if v_job.kind = 'pending_response' and v_job.channel = 'email' then
        perform private.create_assignment_request_snapshot(
          v_effect, v_job.person_id, v_job.plan_id, v_job.assignment_ids, null
        );
      end if;
      select profile_id into v_profile from public.people where id = v_job.person_id;
      insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
      values (v_job.organization_id, v_effect, v_profile, v_job.person_id, v_job.channel)
      on conflict do nothing;
    end if;
    update public.reminder_jobs set status = 'enqueued', effect_id = v_effect where id = v_job.id;
    job_id := v_job.id; outcome := 'enqueued'; effect_id := v_effect; return next;
  end loop;
end;
$$;
revoke execute on function public.materialize_due_reminders(int) from public, anon, authenticated;
grant execute on function public.materialize_due_reminders(int) to service_role;

-- --------------------------------------------------- recompute triggers ---

create or replace function private.queue_plan_reminders(p_plan uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.reminder_recompute_queue (plan_id, organization_id)
  select p.id, p.organization_id from public.plans p where p.id = p_plan
  on conflict (plan_id) do nothing;
$$;
revoke execute on function private.queue_plan_reminders(uuid) from public, anon, authenticated;

-- Upcoming plans a Person is on (bounded to plans not yet over).
create or replace function private.queue_person_reminders(p_person uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.reminder_recompute_queue (plan_id, organization_id)
  select distinct p.id, p.organization_id
    from public.assignments a join public.plans p on p.id = a.plan_id
   where a.person_id = p_person and p.service_date >= now() - interval '1 day'
  on conflict (plan_id) do nothing;
$$;
revoke execute on function private.queue_person_reminders(uuid) from public, anon, authenticated;

create or replace function private.reminders_on_assignment_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.queue_plan_reminders(old.plan_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.plan_id is distinct from old.plan_id) then
    perform private.queue_plan_reminders(new.plan_id);
  end if;
  return null;
end;
$$;
revoke execute on function private.reminders_on_assignment_change() from public, anon, authenticated;
create trigger assignments_queue_reminders
  after insert or delete or update of status, visibility, request_revision, person_id, plan_id, team_id
  on public.assignments
  for each row execute function private.reminders_on_assignment_change();

create or replace function private.reminders_on_plan_time_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_plan_reminders(coalesce(new.plan_id, old.plan_id));
  return null;
end;
$$;
revoke execute on function private.reminders_on_plan_time_change() from public, anon, authenticated;
create trigger plan_times_queue_reminders
  after insert or delete or update of starts_at, ends_at, kind on public.plan_times
  for each row execute function private.reminders_on_plan_time_change();

create or replace function private.reminders_on_plan_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_plan_reminders(new.id);
  return null;
end;
$$;
revoke execute on function private.reminders_on_plan_change() from public, anon, authenticated;
create trigger plans_queue_reminders
  after update of service_date, service_type_id on public.plans
  for each row execute function private.reminders_on_plan_change();

create or replace function private.reminders_on_person_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_person_reminders(coalesce(new.person_id, old.person_id));
  return null;
end;
$$;
revoke execute on function private.reminders_on_person_change() from public, anon, authenticated;
create trigger person_reminder_preferences_queue_reminders
  after insert or update or delete on public.person_reminder_preferences
  for each row execute function private.reminders_on_person_change();

create or replace function private.reminders_on_people_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_person_reminders(new.id);
  return null;
end;
$$;
revoke execute on function private.reminders_on_people_change() from public, anon, authenticated;
create trigger people_queue_reminders
  after update of archived_at, profile_id on public.people
  for each row execute function private.reminders_on_people_change();

create or replace function private.reminders_on_membership_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_person uuid;
begin
  for v_person in
    select p.id from public.people p
     where p.organization_id = coalesce(new.organization_id, old.organization_id)
       and p.profile_id = coalesce(new.user_id, old.user_id)
  loop
    perform private.queue_person_reminders(v_person);
  end loop;
  return null;
end;
$$;
revoke execute on function private.reminders_on_membership_change() from public, anon, authenticated;
create trigger organization_members_queue_reminders
  after update of status or delete on public.organization_members
  for each row execute function private.reminders_on_membership_change();

create or replace function private.reminders_on_policy_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_st uuid := coalesce(new.service_type_id, old.service_type_id);
  v_team uuid := coalesce(new.team_id, old.team_id);
begin
  insert into public.reminder_recompute_queue (plan_id, organization_id)
  select p.id, p.organization_id from public.plans p
   where p.organization_id = v_org and p.service_date >= now() - interval '1 day'
     and (v_st is null or p.service_type_id = v_st)
     and (v_team is null or exists (select 1 from public.assignments a where a.plan_id = p.id and a.team_id = v_team))
  on conflict (plan_id) do nothing;
  return null;
end;
$$;
revoke execute on function private.reminders_on_policy_change() from public, anon, authenticated;
create trigger reminder_policies_queue_reminders
  after insert or update or delete on public.reminder_policies
  for each row execute function private.reminders_on_policy_change();

-- Existing upcoming plans get their first computation on the next worker run.
insert into public.reminder_recompute_queue (plan_id, organization_id)
select p.id, p.organization_id from public.plans p
 where p.service_date >= now() - interval '1 day'
on conflict (plan_id) do nothing;

-- ==================================================== outbox bookkeeping ==

-- Replaces F00's: an accepted request/reminder email marks that Person's
-- rows notified (by Person, so no-login guests count too) and promotes the
-- link it carried: the previous token stops working only now.
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

  if v_row.channel = 'email' and v_status = 'provider_accepted' then
    select * into v_effect from public.delivery_effects where id = v_row.effect_id;
    if v_effect.template in ('assignment_request', 'assignment_reminder') then
      update public.assignment_notifications
         set sent_at = now(),
             previous_token_hash = null,
             previous_snapshot_id = null,
             previous_expires_at = null
       where issued_delivery_id = v_row.id and responded_at is null;
      update public.assignments
         set notified_at = now()
       where id = any(v_effect.assignment_ids) and person_id = v_row.recipient_person_id;
    end if;
  end if;

  return v_row;
end;
$$;
revoke execute on function public.complete_delivery(uuid, text, public.delivery_status, text, text, int) from public, anon, authenticated;
grant execute on function public.complete_delivery(uuid, text, public.delivery_status, text, text, int) to service_role;

-- ================================================= scheduler visibility ==
-- Leaders see delivery outcomes for requests they schedule (per Person and
-- channel), not only effects they created themselves. Rows carry ids and
-- codes only, never addresses or message content.
create policy delivery_effects_select_scheduler on public.delivery_effects
  for select to authenticated using (
    exists (select 1 from public.assignments a
             where a.id = any(assignment_ids) and public.can_schedule_on_plan(a.plan_id, a.team_id))
  );
create policy deliveries_select_scheduler on public.deliveries
  for select to authenticated using (
    exists (select 1 from public.delivery_effects e
              join public.assignments a on a.id = any(e.assignment_ids)
             where e.id = effect_id and a.person_id = recipient_person_id
               and public.can_schedule_on_plan(a.plan_id, a.team_id))
  );
