-- F07: volunteer signups, replacement offers and approved swaps.
-- All capacity-changing paths serialize on Person locks followed by one
-- plan/position advisory lock. Assignment triggers make the same rule apply to
-- manual scheduling, matrix/proposal commits and future writers.

create table public.signup_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  position_id uuid not null references public.team_positions(id) on delete cascade,
  applicable_time_ids uuid[] not null default '{}',
  capacity integer not null check (capacity between 1 and 200),
  approval_policy text not null check (approval_policy in ('direct','leader_approval')),
  closes_at timestamptz not null,
  reservation_minutes integer not null default 1440 check (reservation_minutes between 5 and 10080),
  state text not null default 'open' check (state in ('open','closed')),
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, position_id, applicable_time_ids)
);
create index signup_opportunities_org_state_idx on public.signup_opportunities(organization_id, state, closes_at);
create index signup_opportunities_plan_idx on public.signup_opportunities(plan_id);
create index signup_opportunities_team_idx on public.signup_opportunities(team_id);
create index signup_opportunities_position_idx on public.signup_opportunities(position_id);
create index signup_opportunities_creator_idx on public.signup_opportunities(created_by);

create table public.opportunity_claims (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.signup_opportunities(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null check (status in ('awaiting_approval','confirmed','cancelled','rejected','expired','superseded')),
  opportunity_version bigint not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  reservation_expires_at timestamptz,
  assignment_id uuid references public.assignments(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, person_id),
  unique (person_id, idempotency_key),
  check ((status = 'awaiting_approval') = (reservation_expires_at is not null))
);
create index opportunity_claims_opportunity_status_idx on public.opportunity_claims(opportunity_id, status, reservation_expires_at);
create index opportunity_claims_person_idx on public.opportunity_claims(person_id, created_at desc);
create index opportunity_claims_assignment_idx on public.opportunity_claims(assignment_id) where assignment_id is not null;
create index opportunity_claims_decider_idx on public.opportunity_claims(decided_by) where decided_by is not null;

create table public.replacement_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  original_assignment_id uuid not null references public.assignments(id) on delete restrict,
  requester_person_id uuid not null references public.people(id) on delete restrict,
  plan_id uuid not null references public.plans(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  position_id uuid not null references public.team_positions(id) on delete restrict,
  applicable_time_ids uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open','filled','cancelled','expired')),
  expires_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  filled_assignment_id uuid references public.assignments(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_person_id, idempotency_key)
);
create unique index replacement_requests_one_unresolved_idx on public.replacement_requests(original_assignment_id)
  where status = 'open';
create index replacement_requests_org_status_idx on public.replacement_requests(organization_id, status, created_at desc);
create index replacement_requests_plan_idx on public.replacement_requests(plan_id, status);
create index replacement_requests_team_idx on public.replacement_requests(team_id);
create index replacement_requests_position_idx on public.replacement_requests(position_id);
create index replacement_requests_filled_idx on public.replacement_requests(filled_assignment_id) where filled_assignment_id is not null;
create index replacement_requests_creator_idx on public.replacement_requests(created_by) where created_by is not null;

create table public.replacement_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.replacement_requests(id) on delete cascade,
  candidate_person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted_awaiting_approval','finalized','declined','rejected','expired','superseded')),
  request_version bigint not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  consented_at timestamptz,
  leader_approved_at timestamptz,
  leader_approved_by uuid references public.profiles(id) on delete set null,
  reservation_expires_at timestamptz,
  assignment_id uuid references public.assignments(id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, candidate_person_id),
  unique (candidate_person_id, idempotency_key),
  check (consented_at is not null or status not in ('accepted_awaiting_approval','finalized')),
  check (leader_approved_at is not null or status <> 'finalized')
);
create index replacement_offers_request_status_idx on public.replacement_offers(request_id, status, reservation_expires_at);
create index replacement_offers_candidate_idx on public.replacement_offers(candidate_person_id, created_at desc);
create index replacement_offers_assignment_idx on public.replacement_offers(assignment_id) where assignment_id is not null;
create index replacement_offers_approver_idx on public.replacement_offers(leader_approved_by) where leader_approved_by is not null;
create index replacement_offers_creator_idx on public.replacement_offers(created_by) where created_by is not null;

create table public.approved_swaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_assignment_id uuid not null references public.assignments(id) on delete restrict,
  second_assignment_id uuid not null references public.assignments(id) on delete restrict,
  first_person_id uuid not null references public.people(id) on delete restrict,
  second_person_id uuid not null references public.people(id) on delete restrict,
  first_revision bigint not null,
  second_revision bigint not null,
  first_consented_at timestamptz,
  second_consented_at timestamptz,
  leader_approved_at timestamptz,
  leader_approved_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','finalized','cancelled','expired','rejected')),
  expires_at timestamptz not null,
  version bigint not null default 1 check (version > 0),
  idempotency_key text not null,
  first_new_assignment_id uuid references public.assignments(id) on delete set null,
  second_new_assignment_id uuid references public.assignments(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (first_assignment_id <> second_assignment_id),
  check (first_person_id <> second_person_id)
);
create index approved_swaps_org_status_idx on public.approved_swaps(organization_id, status, created_at desc);
create index approved_swaps_first_assignment_idx on public.approved_swaps(first_assignment_id);
create index approved_swaps_second_assignment_idx on public.approved_swaps(second_assignment_id);
create index approved_swaps_first_person_idx on public.approved_swaps(first_person_id);
create index approved_swaps_second_person_idx on public.approved_swaps(second_person_id);
create index approved_swaps_approver_idx on public.approved_swaps(leader_approved_by) where leader_approved_by is not null;
create index approved_swaps_creator_idx on public.approved_swaps(created_by) where created_by is not null;

create table public.allocation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aggregate_type text not null check (aggregate_type in ('opportunity_claim','replacement_request','replacement_offer','swap')),
  aggregate_id uuid not null,
  transition text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index allocation_events_aggregate_idx on public.allocation_events(aggregate_type, aggregate_id, id);
create index allocation_events_org_idx on public.allocation_events(organization_id, created_at desc);
create index allocation_events_actor_idx on public.allocation_events(actor_id) where actor_id is not null;

create trigger signup_opportunities_updated before update on public.signup_opportunities
  for each row execute function public.set_updated_at();
create trigger opportunity_claims_updated before update on public.opportunity_claims
  for each row execute function public.set_updated_at();
create trigger replacement_requests_updated before update on public.replacement_requests
  for each row execute function public.set_updated_at();
create trigger replacement_offers_updated before update on public.replacement_offers
  for each row execute function public.set_updated_at();
create trigger approved_swaps_updated before update on public.approved_swaps
  for each row execute function public.set_updated_at();

create or replace function private.current_person(p_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.people p where p.organization_id = p_org and p.profile_id = (select auth.uid())
$$;
revoke execute on function private.current_person(uuid) from public, anon;
grant execute on function private.current_person(uuid) to authenticated, service_role;

create or replace function private.f07_lock_capacity(p_plan uuid, p_position uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('f07:' || p_plan::text || ':' || p_position::text, 0))
$$;
revoke execute on function private.f07_lock_capacity(uuid, uuid) from public, anon;
grant execute on function private.f07_lock_capacity(uuid, uuid) to authenticated, service_role;

create or replace function private.f07_scope_intersects(p_left uuid[], p_right uuid[])
returns boolean language sql immutable set search_path = '' as $$
  select cardinality(p_left) = 0 or cardinality(p_right) = 0 or p_left && p_right
$$;

create or replace function private.f07_assignment_time_ids(p_assignment uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when a.attendance_mode = 'all' then '{}'::uuid[]
              else coalesce(array_agg(aat.plan_time_id order by aat.plan_time_id), '{}') end
    from public.assignments a left join public.assignment_attendance_times aat on aat.assignment_id = a.id
   where a.id = p_assignment group by a.attendance_mode
$$;

create or replace function private.f07_expire_reservations(p_plan uuid, p_position uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  with changed as (
    update public.opportunity_claims c set status = 'expired', reservation_expires_at = null, version = c.version + 1
      from public.signup_opportunities o
     where c.opportunity_id = o.id and o.plan_id = p_plan and o.position_id = p_position
       and c.status = 'awaiting_approval' and c.reservation_expires_at <= statement_timestamp()
    returning c.id,o.organization_id
  ) insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
    select organization_id,'opportunity_claim',id,'expired',(select auth.uid()) from changed;
  with changed as (
    update public.replacement_offers f set status = 'expired', reservation_expires_at = null, version = f.version + 1
      from public.replacement_requests r
     where f.request_id = r.id and r.plan_id = p_plan and r.position_id = p_position
       and f.status = 'accepted_awaiting_approval' and f.reservation_expires_at <= statement_timestamp()
    returning f.id,r.organization_id
  ) insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
    select organization_id,'replacement_offer',id,'expired',(select auth.uid()) from changed;
end $$;

create or replace function private.f07_occupied(
  p_plan uuid, p_position uuid, p_times uuid[], p_exclude_assignment uuid default null
) returns integer language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.assignments a
      where a.plan_id = p_plan and a.position_id = p_position and a.status <> 'declined'
        and a.id is distinct from p_exclude_assignment
        and private.f07_scope_intersects(p_times, private.f07_assignment_time_ids(a.id)))
    +
    (select count(*)::integer from public.opportunity_claims c join public.signup_opportunities o on o.id = c.opportunity_id
      where o.plan_id = p_plan and o.position_id = p_position and c.status = 'awaiting_approval'
        and c.reservation_expires_at > statement_timestamp()
        and private.f07_scope_intersects(p_times, o.applicable_time_ids))
    +
    (select count(*)::integer from public.replacement_offers f join public.replacement_requests r on r.id = f.request_id
      where r.plan_id = p_plan and r.position_id = p_position and f.status = 'accepted_awaiting_approval'
        and f.reservation_expires_at > statement_timestamp()
        and private.f07_scope_intersects(p_times, r.applicable_time_ids))
$$;

create or replace function private.f07_is_eligible(p_person uuid, p_team uuid, p_position uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.people p
    join public.organization_members om on om.organization_id = p.organization_id and om.user_id = p.profile_id and om.status = 'active'
    join public.team_memberships tm on tm.person_id = p.id and tm.team_id = p_team
    join public.teams t on t.id = p_team and t.organization_id = p.organization_id
    where p.id = p_person and p.archived_at is null
      and (tm.position_id is null or tm.position_id = p_position)
      and (not t.requires_eligibility or exists (
        select 1 from public.person_eligibility_records e
         where e.user_id = p.profile_id and e.organization_id = p.organization_id
           and e.kind = t.eligibility_kind and e.status = 'clear'
           and (e.expires_at is null or e.expires_at > statement_timestamp())
      ))
  )
$$;

create or replace function private.f07_has_conflict(
  p_org uuid, p_person uuid, p_plan uuid, p_team uuid, p_position uuid, p_times uuid[], p_exclude uuid[] default '{}'
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.attendance_conflicts(
      p_org, null,
      jsonb_build_array(jsonb_build_object('person_id', p_person, 'plan_id', p_plan, 'team_id', p_team,
        'position_id', p_position, 'attendance_mode', case when cardinality(p_times)=0 then 'all' else 'selected' end,
        'time_ids', to_jsonb(p_times))), p_exclude
    ) c where c.severity = 'blocking'
  )
$$;

create or replace function private.f07_validate_opportunity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_team uuid; v_needed integer; v_occupied integer;
begin
  select p.organization_id into v_org from public.plans p where p.id = new.plan_id;
  select tp.team_id into v_team from public.team_positions tp where tp.id = new.position_id
    and (tp.plan_id is null or tp.plan_id = new.plan_id);
  select n.needed into v_needed from public.plan_position_needs n where n.plan_id = new.plan_id and n.position_id = new.position_id;
  if v_org is null or v_org <> new.organization_id or v_team is null or v_team <> new.team_id
     or not exists (select 1 from public.teams t where t.id = new.team_id and t.organization_id = v_org)
     or exists (select 1 from unnest(new.applicable_time_ids) x(id)
                 where not exists (select 1 from public.plan_times pt where pt.id=x.id and pt.plan_id=new.plan_id)) then
    raise exception 'Opportunity plan, team, position and times must share one organization' using errcode='22023';
  end if;
  if new.closes_at <= statement_timestamp() or v_needed is null or new.capacity > v_needed then
    raise exception 'Opportunity capacity must fit the current need and close in the future' using errcode='22023';
  end if;
  perform private.f07_lock_capacity(new.plan_id, new.position_id);
  perform private.f07_expire_reservations(new.plan_id, new.position_id);
  v_occupied := private.f07_occupied(new.plan_id, new.position_id, new.applicable_time_ids);
  if new.state='open' and v_occupied > new.capacity then
    raise exception 'Opportunity capacity is already occupied' using errcode='PT409', hint='capacity_full';
  end if;
  if tg_op='UPDATE' and (new.plan_id,new.team_id,new.position_id,new.applicable_time_ids) is distinct from
                         (old.plan_id,old.team_id,old.position_id,old.applicable_time_ids) then
    raise exception 'Close this opportunity and create another to change its scope' using errcode='PT409';
  end if;
  if tg_op='UPDATE' then new.version := old.version + 1; end if;
  return new;
end $$;
create trigger signup_opportunities_validate before insert or update on public.signup_opportunities
  for each row execute function private.f07_validate_opportunity();

create or replace function private.f07_enforce_assignment_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.signup_opportunities; v_times uuid[]; v_occupied integer; v_assignment public.assignments; v_id uuid;
begin
  if tg_table_name='assignments' then
    v_id := new.id;
  elsif tg_op='DELETE' then
    v_id := old.assignment_id;
  else
    v_id := new.assignment_id;
  end if;
  select * into v_assignment from public.assignments where id=v_id;
  if v_assignment.id is null or v_assignment.position_id is null or v_assignment.status='declined' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  perform private.f07_lock_capacity(v_assignment.plan_id,v_assignment.position_id);
  perform private.f07_expire_reservations(v_assignment.plan_id,v_assignment.position_id);
  v_times := private.f07_assignment_time_ids(v_assignment.id);
  for o in select * from public.signup_opportunities x
    where x.plan_id=v_assignment.plan_id and x.position_id=v_assignment.position_id and x.state='open'
      and x.closes_at > statement_timestamp() and private.f07_scope_intersects(x.applicable_time_ids,v_times)
    order by x.id
  loop
    v_occupied := private.f07_occupied(o.plan_id,o.position_id,o.applicable_time_ids);
    if v_occupied > o.capacity then
      raise exception 'This opening no longer has capacity' using errcode='PT409', hint='capacity_full';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create constraint trigger assignments_f07_capacity after insert or update of status,position_id,attendance_mode on public.assignments
  deferrable initially deferred for each row execute function private.f07_enforce_assignment_capacity();
create constraint trigger assignment_times_f07_capacity after insert or delete on public.assignment_attendance_times
  deferrable initially deferred for each row execute function private.f07_enforce_assignment_capacity();

create or replace function private.f07_guard_need_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_occupied integer;
begin
  perform private.f07_lock_capacity(new.plan_id,new.position_id);
  perform private.f07_expire_reservations(new.plan_id,new.position_id);
  v_occupied:=private.f07_occupied(new.plan_id,new.position_id,'{}');
  if new.needed < v_occupied then raise exception 'Needed count cannot be lower than committed or reserved capacity' using errcode='PT409',hint='capacity_full'; end if;
  update public.signup_opportunities set capacity=least(capacity,new.needed),state=case when new.needed=0 then 'closed' else state end
   where plan_id=new.plan_id and position_id=new.position_id and capacity>new.needed;
  return new;
end $$;
create trigger plan_position_needs_f07_capacity after insert or update of needed on public.plan_position_needs
  for each row execute function private.f07_guard_need_capacity();

create or replace function public.claim_signup_opportunity(
  p_opportunity uuid, p_expected_version bigint, p_idempotency_key text
) returns public.opportunity_claims
language plpgsql security definer set search_path = '' as $$
declare o public.signup_opportunities; v_person uuid; c public.opportunity_claims; a public.assignments;
begin
  select * into o from public.signup_opportunities where id=p_opportunity;
  if o.id is null then raise exception 'Opening not found' using errcode='P0002'; end if;
  v_person := private.current_person(o.organization_id);
  if v_person is null then
    raise exception 'You are not eligible for this opening' using errcode='42501';
  end if;
  select * into c from public.opportunity_claims where person_id=v_person and idempotency_key=p_idempotency_key;
  if c.id is not null then return c; end if;
  if not private.f07_is_eligible(v_person,o.team_id,o.position_id) then
    raise exception 'You are not eligible for this opening' using errcode='42501';
  end if;
  perform private.lock_scheduling_people(array[v_person]); perform private.f07_lock_capacity(o.plan_id,o.position_id);
  select * into o from public.signup_opportunities where id=p_opportunity for update;
  perform private.f07_expire_reservations(o.plan_id,o.position_id);
  select * into c from public.opportunity_claims where person_id=v_person and idempotency_key=p_idempotency_key;
  if c.id is not null then return c; end if;
  if o.state<>'open' or o.closes_at<=statement_timestamp() then raise exception 'This opening is closed' using errcode='PT409',hint='opportunity_closed'; end if;
  if o.version<>p_expected_version then raise exception 'This opening changed; refresh and review it again' using errcode='PT409',hint='opportunity_changed'; end if;
  if private.f07_has_conflict(o.organization_id,v_person,o.plan_id,o.team_id,o.position_id,o.applicable_time_ids) then
    raise exception 'This opening conflicts with your schedule' using errcode='PT409',hint='scheduling_conflict';
  end if;
  if private.f07_occupied(o.plan_id,o.position_id,o.applicable_time_ids)>=o.capacity then
    raise exception 'This opening is full' using errcode='PT409',hint='capacity_full';
  end if;
  insert into public.opportunity_claims(opportunity_id,person_id,status,opportunity_version,idempotency_key,reservation_expires_at)
  values(o.id,v_person,case when o.approval_policy='direct' then 'confirmed' else 'awaiting_approval' end,
         o.version,p_idempotency_key,case when o.approval_policy='leader_approval' then statement_timestamp()+make_interval(mins=>o.reservation_minutes) end)
  returning * into c;
  if o.approval_policy='direct' then
    insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
    select o.plan_id,v_person,p.profile_id,o.team_id,o.position_id,'confirmed',(select auth.uid()),'released',statement_timestamp(),
           case when cardinality(o.applicable_time_ids)=0 then 'all' else 'selected' end from public.people p where p.id=v_person
    returning * into a;
    insert into public.assignment_attendance_times(assignment_id,plan_time_id) select a.id,x from unnest(o.applicable_time_ids)x;
    update public.opportunity_claims set assignment_id=a.id where id=c.id returning * into c;
  end if;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
  values(o.organization_id,'opportunity_claim',c.id,c.status,(select auth.uid()));
  return c;
end $$;
revoke execute on function public.claim_signup_opportunity(uuid,bigint,text) from public,anon;
grant execute on function public.claim_signup_opportunity(uuid,bigint,text) to authenticated;

create or replace function public.decide_signup_claim(p_claim uuid,p_expected_version bigint,p_action text)
returns public.opportunity_claims language plpgsql security definer set search_path = '' as $$
declare c public.opportunity_claims; o public.signup_opportunities; a public.assignments;
begin
  select * into c from public.opportunity_claims where id=p_claim;
  select * into o from public.signup_opportunities where id=c.opportunity_id;
  if c.id is null then raise exception 'Claim not found' using errcode='P0002'; end if;
  if not public.can_schedule_on_plan(o.plan_id,o.team_id) then raise exception 'You cannot decide this claim' using errcode='42501'; end if;
  perform private.lock_scheduling_people(array[c.person_id]); perform private.f07_lock_capacity(o.plan_id,o.position_id);
  select * into c from public.opportunity_claims where id=p_claim for update;
  perform private.f07_expire_reservations(o.plan_id,o.position_id);
  if c.version<>p_expected_version or c.status<>'awaiting_approval' then raise exception 'This claim is no longer awaiting approval' using errcode='PT409'; end if;
  if p_action='reject' then
    update public.opportunity_claims set status='rejected',reservation_expires_at=null,decided_by=(select auth.uid()),decided_at=statement_timestamp(),version=version+1 where id=c.id returning * into c;
  elsif p_action='approve' then
    if c.reservation_expires_at<=statement_timestamp() or not private.f07_is_eligible(c.person_id,o.team_id,o.position_id)
       or private.f07_has_conflict(o.organization_id,c.person_id,o.plan_id,o.team_id,o.position_id,o.applicable_time_ids) then
      raise exception 'This claim is no longer eligible for approval' using errcode='PT409'; end if;
    update public.opportunity_claims set status='confirmed',reservation_expires_at=null,decided_by=(select auth.uid()),decided_at=statement_timestamp(),version=version+1 where id=c.id returning * into c;
    insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
    select o.plan_id,c.person_id,p.profile_id,o.team_id,o.position_id,'confirmed',(select auth.uid()),'released',statement_timestamp(),case when cardinality(o.applicable_time_ids)=0 then 'all' else 'selected' end from public.people p where p.id=c.person_id returning * into a;
    insert into public.assignment_attendance_times select a.id,x from unnest(o.applicable_time_ids)x;
    update public.opportunity_claims set assignment_id=a.id where id=c.id returning * into c;
  else raise exception 'Action is approve or reject' using errcode='22023'; end if;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(o.organization_id,'opportunity_claim',c.id,c.status,(select auth.uid()));
  return c;
end $$;
revoke execute on function public.decide_signup_claim(uuid,bigint,text) from public,anon;
grant execute on function public.decide_signup_claim(uuid,bigint,text) to authenticated;

create or replace function public.cancel_signup_claim(p_claim uuid,p_expected_version bigint)
returns public.opportunity_claims language plpgsql security definer set search_path = '' as $$
declare c public.opportunity_claims; o public.signup_opportunities; v_person uuid;
begin
  select * into c from public.opportunity_claims where id=p_claim; select * into o from public.signup_opportunities where id=c.opportunity_id;
  v_person:=private.current_person(o.organization_id);
  if c.id is null or (c.person_id is distinct from v_person and not public.can_schedule_on_plan(o.plan_id,o.team_id)) then raise exception 'Claim not found' using errcode='P0002'; end if;
  perform private.lock_scheduling_people(array[c.person_id]); perform private.f07_lock_capacity(o.plan_id,o.position_id);
  select * into c from public.opportunity_claims where id=p_claim for update;
  if c.status='cancelled' then return c; end if;
  if c.version<>p_expected_version or c.status not in ('awaiting_approval','confirmed') then raise exception 'This claim can no longer be cancelled' using errcode='PT409'; end if;
  if c.assignment_id is not null then update public.assignments set status='declined',responded_at=statement_timestamp() where id=c.assignment_id; end if;
  update public.opportunity_claims set status='cancelled',reservation_expires_at=null,version=version+1 where id=c.id returning * into c;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(o.organization_id,'opportunity_claim',c.id,'cancelled',(select auth.uid()));
  return c;
end $$;
revoke execute on function public.cancel_signup_claim(uuid,bigint) from public,anon;
grant execute on function public.cancel_signup_claim(uuid,bigint) to authenticated;

-- Bounded lazy cleanup keeps read models honest even before F08 installs its
-- durable scheduled runner. Every transition is idempotent: only a live row
-- can be expired, and its reservation is cleared in the same update.
create or replace function public.expire_f07_allocations(p_organization uuid,p_limit integer default 200)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer:=0; v_changed integer;
begin
  if not public.is_org_member(p_organization) then raise exception 'Organization access required' using errcode='42501'; end if;
  p_limit:=greatest(1,least(coalesce(p_limit,200),500));

  with due as (
    select c.id,o.organization_id from public.opportunity_claims c join public.signup_opportunities o on o.id=c.opportunity_id
     where o.organization_id=p_organization and c.status='awaiting_approval' and c.reservation_expires_at<=statement_timestamp()
     order by c.reservation_expires_at,c.id limit p_limit for update of c skip locked
  ), changed as (
    update public.opportunity_claims c set status='expired',reservation_expires_at=null,version=c.version+1
     where c.id in(select id from due) returning c.id
  ) insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
    select p_organization,'opportunity_claim',id,'expired',(select auth.uid()) from changed;
  get diagnostics v_changed=row_count; v_count:=v_count+v_changed;

  with due as (
    select f.id from public.replacement_offers f join public.replacement_requests r on r.id=f.request_id
     where r.organization_id=p_organization and f.status in('pending','accepted_awaiting_approval')
       and (r.expires_at<=statement_timestamp() or f.reservation_expires_at<=statement_timestamp())
     order by coalesce(f.reservation_expires_at,r.expires_at),f.id limit p_limit for update of f skip locked
  ), changed as (
    update public.replacement_offers f set status='expired',reservation_expires_at=null,version=f.version+1
     where f.id in(select id from due) returning f.id
  ) insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
    select p_organization,'replacement_offer',id,'expired',(select auth.uid()) from changed;
  get diagnostics v_changed=row_count; v_count:=v_count+v_changed;

  with due as (
    select r.id from public.replacement_requests r
     where r.organization_id=p_organization and r.status='open' and r.expires_at<=statement_timestamp()
     order by r.expires_at,r.id limit p_limit for update skip locked
  ), changed as (
    update public.replacement_requests r set status='expired',version=r.version+1
     where r.id in(select id from due) returning r.id
  ) insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
    select p_organization,'replacement_request',id,'expired',(select auth.uid()) from changed;
  get diagnostics v_changed=row_count; v_count:=v_count+v_changed;

  with due as (
    select s.id from public.approved_swaps s
     where s.organization_id=p_organization and s.status='pending' and s.expires_at<=statement_timestamp()
     order by s.expires_at,s.id limit p_limit for update skip locked
  ), changed as (
    update public.approved_swaps s set status='expired',version=s.version+1
     where s.id in(select id from due) returning s.id
  ) insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
    select p_organization,'swap',id,'expired',(select auth.uid()) from changed;
  get diagnostics v_changed=row_count; return v_count+v_changed;
end $$;
revoke execute on function public.expire_f07_allocations(uuid,integer) from public,anon;
grant execute on function public.expire_f07_allocations(uuid,integer) to authenticated,service_role;

create or replace function public.list_signup_opportunities(p_organization uuid,p_plan uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=(select auth.uid()); v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.is_org_member(p_organization) then raise exception 'Organization access required' using errcode='42501'; end if;
  perform public.expire_f07_allocations(p_organization,200);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'organization_id',o.organization_id,'plan_id',o.plan_id,'team_id',o.team_id,'position_id',o.position_id,
    'applicable_time_ids',o.applicable_time_ids,'capacity',o.capacity,'approval_policy',o.approval_policy,
    'closes_at',o.closes_at,'reservation_minutes',o.reservation_minutes,'state',o.state,'version',o.version,
    'created_by',o.created_by,'created_at',o.created_at,'updated_at',o.updated_at,
    'plan_title',p.title,'service_date',p.service_date,'team_name',t.name,'position_name',tp.name,
    'remaining_capacity',greatest(0,o.capacity-private.f07_occupied(o.plan_id,o.position_id,o.applicable_time_ids)),
    'eligibility',case when o.state<>'open' or o.closes_at<=statement_timestamp() then 'closed'
      when private.f07_occupied(o.plan_id,o.position_id,o.applicable_time_ids)>=o.capacity then 'full'
      when cp.id is null then 'eligible'
      when private.f07_has_conflict(o.organization_id,cp.id,o.plan_id,o.team_id,o.position_id,o.applicable_time_ids) then 'unavailable'
      else 'eligible' end,
    'times',coalesce((select jsonb_agg(jsonb_build_object('id',pt.id,'name',pt.name,'kind',pt.kind,'starts_at',pt.starts_at,'ends_at',pt.ends_at) order by pt.starts_at)
       from public.plan_times pt where pt.plan_id=o.plan_id and (cardinality(o.applicable_time_ids)=0 or pt.id=any(o.applicable_time_ids))),'[]'::jsonb),
    'my_claim',(select to_jsonb(c) from public.opportunity_claims c where c.opportunity_id=o.id and c.person_id=cp.id)
  ) order by p.service_date,o.created_at),'[]'::jsonb) into v_result
  from public.signup_opportunities o join public.plans p on p.id=o.plan_id join public.teams t on t.id=o.team_id
  join public.team_positions tp on tp.id=o.position_id
  left join public.people cp on cp.organization_id=o.organization_id and cp.profile_id=v_actor
  where o.organization_id=p_organization and (p_plan is null or o.plan_id=p_plan)
    and (private.can_schedule_on_plan(v_actor,o.plan_id,o.team_id)
         or (o.state='open' and o.closes_at>statement_timestamp() and private.f07_is_eligible(cp.id,o.team_id,o.position_id)));
  return v_result;
end $$;
revoke execute on function public.list_signup_opportunities(uuid,uuid) from public,anon;
grant execute on function public.list_signup_opportunities(uuid,uuid) to authenticated;

create or replace function public.create_replacement_request(p_assignment uuid,p_expected_revision bigint,p_idempotency_key text,p_expires_at timestamptz)
returns public.replacement_requests language plpgsql security definer set search_path = '' as $$
declare a public.assignments; r public.replacement_requests; v_times uuid[]; v_org uuid;
begin
  select * into a from public.assignments where id=p_assignment; select organization_id into v_org from public.plans where id=a.plan_id;
  if a.id is null or a.person_id is distinct from private.current_person(v_org) or a.status<>'declined' or a.position_id is null then raise exception 'Only the declined assignee can request a replacement' using errcode='42501'; end if;
  if a.request_revision<>p_expected_revision or p_expires_at<=statement_timestamp() then raise exception 'The assignment changed or expiry is invalid' using errcode='PT409'; end if;
  select * into r from public.replacement_requests where requester_person_id=a.person_id and idempotency_key=p_idempotency_key; if r.id is not null then return r; end if;
  if exists(select 1 from public.replacement_requests x where x.original_assignment_id=a.id and x.status='filled') then
    raise exception 'This vacancy was already filled' using errcode='PT409',hint='capacity_full';
  end if;
  v_times:=private.f07_assignment_time_ids(a.id);
  insert into public.replacement_requests(organization_id,original_assignment_id,requester_person_id,plan_id,team_id,position_id,applicable_time_ids,expires_at,idempotency_key,created_by)
  values(v_org,a.id,a.person_id,a.plan_id,a.team_id,a.position_id,v_times,p_expires_at,p_idempotency_key,(select auth.uid())) returning * into r;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(v_org,'replacement_request',r.id,'open',(select auth.uid()));
  return r;
end $$;
revoke execute on function public.create_replacement_request(uuid,bigint,text,timestamptz) from public,anon;
grant execute on function public.create_replacement_request(uuid,bigint,text,timestamptz) to authenticated;

create or replace function public.cancel_replacement_request(p_request uuid,p_expected_version bigint)
returns public.replacement_requests language plpgsql security definer set search_path = '' as $$
declare r public.replacement_requests; v_person uuid;
begin
  select * into r from public.replacement_requests where id=p_request;
  if r.id is null then raise exception 'Replacement request not found' using errcode='P0002'; end if;
  v_person:=private.current_person(r.organization_id);
  if v_person is distinct from r.requester_person_id and not public.can_schedule_on_plan(r.plan_id,r.team_id) then
    raise exception 'Replacement request not found' using errcode='P0002';
  end if;
  perform private.lock_scheduling_people(array[r.requester_person_id]);
  perform private.f07_lock_capacity(r.plan_id,r.position_id);
  select * into r from public.replacement_requests where id=p_request for update;
  if r.status='cancelled' then return r; end if;
  if r.version<>p_expected_version or r.status<>'open' then
    raise exception 'This replacement request can no longer be cancelled' using errcode='PT409';
  end if;
  update public.replacement_offers set status='superseded',reservation_expires_at=null,version=version+1
   where request_id=r.id and status in('pending','accepted_awaiting_approval');
  update public.replacement_requests set status='cancelled',version=version+1 where id=r.id returning * into r;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id)
  values(r.organization_id,'replacement_request',r.id,'cancelled',(select auth.uid()));
  return r;
end $$;
revoke execute on function public.cancel_replacement_request(uuid,bigint) from public,anon;
grant execute on function public.cancel_replacement_request(uuid,bigint) to authenticated;

create or replace function public.issue_replacement_offer(p_request uuid,p_candidate uuid,p_expected_version bigint,p_idempotency_key text)
returns public.replacement_offers language plpgsql security definer set search_path = '' as $$
declare r public.replacement_requests; f public.replacement_offers;
begin
  select * into r from public.replacement_requests where id=p_request;
  if r.id is null then raise exception 'Replacement request not found' using errcode='P0002'; end if;
  if not public.can_schedule_on_plan(r.plan_id,r.team_id) then raise exception 'You cannot offer this replacement' using errcode='42501'; end if;
  select * into f from public.replacement_offers where request_id=r.id and candidate_person_id=p_candidate;
  if f.id is not null then return f; end if;
  if r.status<>'open' or r.version<>p_expected_version or r.expires_at<=statement_timestamp() or not private.f07_is_eligible(p_candidate,r.team_id,r.position_id) then raise exception 'This replacement or candidate is no longer eligible' using errcode='PT409'; end if;
  insert into public.replacement_offers(request_id,candidate_person_id,request_version,idempotency_key,created_by)
  values(r.id,p_candidate,r.version,p_idempotency_key,(select auth.uid())) on conflict(request_id,candidate_person_id) do update set request_id=excluded.request_id returning * into f;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(r.organization_id,'replacement_offer',f.id,'pending',(select auth.uid())); return f;
end $$;
revoke execute on function public.issue_replacement_offer(uuid,uuid,bigint,text) from public,anon;
grant execute on function public.issue_replacement_offer(uuid,uuid,bigint,text) to authenticated;

create or replace function private.f07_finalize_offer(p_offer uuid)
returns public.replacement_offers language plpgsql security definer set search_path = '' as $$
declare f public.replacement_offers; r public.replacement_requests; a public.assignments;
begin
  select * into f from public.replacement_offers where id=p_offer for update; select * into r from public.replacement_requests where id=f.request_id for update;
  if f.consented_at is null or f.leader_approved_at is null or r.status<>'open' or f.status not in ('pending','accepted_awaiting_approval') then return f; end if;
  if r.expires_at<=statement_timestamp() or not private.f07_is_eligible(f.candidate_person_id,r.team_id,r.position_id)
     or private.f07_has_conflict(r.organization_id,f.candidate_person_id,r.plan_id,r.team_id,r.position_id,r.applicable_time_ids,array[r.original_assignment_id]) then raise exception 'The replacement is no longer eligible' using errcode='PT409'; end if;
  update public.replacement_offers set status='finalized',reservation_expires_at=null,version=version+1 where id=f.id returning * into f;
  insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
  select r.plan_id,f.candidate_person_id,p.profile_id,r.team_id,r.position_id,'confirmed',(select auth.uid()),'released',statement_timestamp(),case when cardinality(r.applicable_time_ids)=0 then 'all' else 'selected' end from public.people p where p.id=f.candidate_person_id returning * into a;
  insert into public.assignment_attendance_times select a.id,x from unnest(r.applicable_time_ids)x;
  update public.replacement_offers set assignment_id=a.id where id=f.id returning * into f;
  update public.replacement_requests set status='filled',filled_assignment_id=a.id,version=version+1 where id=r.id;
  update public.replacement_offers set status='superseded',reservation_expires_at=null,version=version+1 where request_id=r.id and id<>f.id and status in ('pending','accepted_awaiting_approval');
  return f;
end $$;

create or replace function public.act_on_replacement_offer(p_offer uuid,p_expected_version bigint,p_action text)
returns public.replacement_offers language plpgsql security definer set search_path = '' as $$
declare f public.replacement_offers; r public.replacement_requests; v_person uuid;
begin
  select * into f from public.replacement_offers where id=p_offer; select * into r from public.replacement_requests where id=f.request_id;
  if f.id is null then raise exception 'Offer not found' using errcode='P0002'; end if;
  v_person:=private.current_person(r.organization_id);
  perform private.lock_scheduling_people(array[f.candidate_person_id]); perform private.f07_lock_capacity(r.plan_id,r.position_id);
  perform private.f07_expire_reservations(r.plan_id,r.position_id); select * into f from public.replacement_offers where id=p_offer for update;
  if f.version<>p_expected_version or f.status not in ('pending','accepted_awaiting_approval') then raise exception 'This offer changed' using errcode='PT409'; end if;
  if p_action in ('accept','decline') and v_person is distinct from f.candidate_person_id then raise exception 'Only the candidate can answer this offer' using errcode='42501'; end if;
  if p_action in ('approve','reject') and not public.can_schedule_on_plan(r.plan_id,r.team_id) then raise exception 'You cannot decide this offer' using errcode='42501'; end if;
  if p_action='decline' then update public.replacement_offers set status='declined',reservation_expires_at=null,version=version+1 where id=f.id returning * into f;
  elsif p_action='reject' then update public.replacement_offers set status='rejected',reservation_expires_at=null,version=version+1 where id=f.id returning * into f;
  elsif p_action='approve' then update public.replacement_offers set leader_approved_at=statement_timestamp(),leader_approved_by=(select auth.uid()),version=version+1 where id=f.id returning * into f;
  elsif p_action='accept' then
    if not private.f07_is_eligible(f.candidate_person_id,r.team_id,r.position_id) or private.f07_has_conflict(r.organization_id,f.candidate_person_id,r.plan_id,r.team_id,r.position_id,r.applicable_time_ids,array[r.original_assignment_id]) then raise exception 'You are no longer eligible for this replacement' using errcode='PT409'; end if;
    if private.f07_occupied(r.plan_id,r.position_id,r.applicable_time_ids,r.original_assignment_id) >= coalesce((select needed from public.plan_position_needs where plan_id=r.plan_id and position_id=r.position_id),1) then raise exception 'This vacancy is already filled' using errcode='PT409',hint='capacity_full'; end if;
    update public.replacement_offers set consented_at=statement_timestamp(),status='accepted_awaiting_approval',reservation_expires_at=least(r.expires_at,statement_timestamp()+interval '24 hours'),version=version+1 where id=f.id returning * into f;
  else raise exception 'Unknown offer action' using errcode='22023'; end if;
  f:=private.f07_finalize_offer(f.id);
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(r.organization_id,'replacement_offer',f.id,f.status,(select auth.uid())); return f;
end $$;
revoke execute on function public.act_on_replacement_offer(uuid,bigint,text) from public,anon;
grant execute on function public.act_on_replacement_offer(uuid,bigint,text) to authenticated;

create or replace function public.create_approved_swap(p_first uuid,p_second uuid,p_first_revision bigint,p_second_revision bigint,p_expires_at timestamptz,p_idempotency_key text)
returns public.approved_swaps language plpgsql security definer set search_path = '' as $$
declare a public.assignments; b public.assignments; s public.approved_swaps; v_org uuid; v_person uuid;
begin
  select * into a from public.assignments where id=p_first; select * into b from public.assignments where id=p_second;
  select organization_id into v_org from public.plans where id=a.plan_id; v_person:=private.current_person(v_org);
  if a.id is null or b.id is null or a.person_id=b.person_id
    or not (v_person is not distinct from a.person_id or v_person is not distinct from b.person_id)
    or not exists(select 1 from public.plans p where p.id=b.plan_id and p.organization_id=v_org) then raise exception 'These assignments cannot be swapped' using errcode='PT409'; end if;
  select * into s from public.approved_swaps where organization_id=v_org and idempotency_key=p_idempotency_key;
  if s.id is not null then return s; end if;
  if a.status<>'confirmed' or b.status<>'confirmed' or a.request_revision<>p_first_revision or b.request_revision<>p_second_revision
     or p_expires_at<=statement_timestamp() then raise exception 'These assignments cannot be swapped' using errcode='PT409'; end if;
  insert into public.approved_swaps(organization_id,first_assignment_id,second_assignment_id,first_person_id,second_person_id,first_revision,second_revision,first_consented_at,second_consented_at,expires_at,idempotency_key,created_by)
  values(v_org,a.id,b.id,a.person_id,b.person_id,p_first_revision,p_second_revision,case when v_person=a.person_id then statement_timestamp() end,case when v_person=b.person_id then statement_timestamp() end,p_expires_at,p_idempotency_key,(select auth.uid()))
  on conflict(organization_id,idempotency_key) do update set organization_id=excluded.organization_id returning * into s;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(v_org,'swap',s.id,'pending',(select auth.uid()));
  return s;
end $$;
revoke execute on function public.create_approved_swap(uuid,uuid,bigint,bigint,timestamptz,text) from public,anon;
grant execute on function public.create_approved_swap(uuid,uuid,bigint,bigint,timestamptz,text) to authenticated;

create or replace function public.act_on_approved_swap(p_swap uuid,p_expected_version bigint,p_action text)
returns public.approved_swaps language plpgsql security definer set search_path = '' as $$
declare s public.approved_swaps; a public.assignments; b public.assignments; na public.assignments; nb public.assignments;
        v_person uuid; v_ids uuid[]; v_plan uuid; v_position uuid;
begin
  select * into s from public.approved_swaps where id=p_swap;
  if s.id is null then raise exception 'Swap not found' using errcode='P0002'; end if;
  v_person:=private.current_person(s.organization_id);
  perform private.lock_scheduling_people(array[s.first_person_id,s.second_person_id]);
  for v_plan,v_position in
    select distinct x.plan_id,x.position_id from public.assignments x where x.id in(s.first_assignment_id,s.second_assignment_id) order by 1,2
  loop perform private.f07_lock_capacity(v_plan,v_position); end loop;
  select * into s from public.approved_swaps where id=p_swap for update;
  select * into a from public.assignments where id=s.first_assignment_id for update;
  select * into b from public.assignments where id=s.second_assignment_id for update;
  if s.version<>p_expected_version or s.status<>'pending' or s.expires_at<=statement_timestamp() then raise exception 'This swap changed or expired' using errcode='PT409'; end if;
  if p_action='consent' then
    if v_person=s.first_person_id then update public.approved_swaps set first_consented_at=statement_timestamp(),version=version+1 where id=s.id returning * into s;
    elsif v_person=s.second_person_id then update public.approved_swaps set second_consented_at=statement_timestamp(),version=version+1 where id=s.id returning * into s;
    else raise exception 'Only a participant can consent' using errcode='42501'; end if;
  elsif p_action='approve' then
    if not public.can_schedule_on_plan(a.plan_id,a.team_id) or not public.can_schedule_on_plan(b.plan_id,b.team_id) then raise exception 'You cannot approve both sides of this swap' using errcode='42501'; end if;
    update public.approved_swaps set leader_approved_at=statement_timestamp(),leader_approved_by=(select auth.uid()),version=version+1 where id=s.id returning * into s;
  elsif p_action in ('cancel','reject') then
    if not (v_person is not distinct from s.first_person_id or v_person is not distinct from s.second_person_id)
       and (not public.can_schedule_on_plan(a.plan_id,a.team_id) or not public.can_schedule_on_plan(b.plan_id,b.team_id)) then raise exception 'You cannot cancel this swap' using errcode='42501'; end if;
    update public.approved_swaps set status=case when p_action='reject' then 'rejected' else 'cancelled' end,version=version+1 where id=s.id returning * into s;
  else raise exception 'Unknown swap action' using errcode='22023'; end if;

  if s.status='pending' and s.first_consented_at is not null and s.second_consented_at is not null and s.leader_approved_at is not null then
    if a.status<>'confirmed' or b.status<>'confirmed' or a.request_revision<>s.first_revision or b.request_revision<>s.second_revision then raise exception 'One side changed; neither assignment was swapped' using errcode='PT409'; end if;
    if not private.f07_is_eligible(s.first_person_id,b.team_id,b.position_id)
       or not private.f07_is_eligible(s.second_person_id,a.team_id,a.position_id) then
      raise exception 'One side is no longer eligible; neither assignment was swapped' using errcode='PT409';
    end if;
    if private.f07_has_conflict(s.organization_id,s.first_person_id,b.plan_id,b.team_id,b.position_id,private.f07_assignment_time_ids(b.id),array[a.id,b.id])
       or private.f07_has_conflict(s.organization_id,s.second_person_id,a.plan_id,a.team_id,a.position_id,private.f07_assignment_time_ids(a.id),array[a.id,b.id]) then
      raise exception 'One side now has a conflict; neither assignment was swapped' using errcode='PT409'; end if;
    -- Old answers stay in append-only response history; the new assignments
    -- are separate records backed by each participant's explicit swap consent.
    update public.assignments set status='declined',responded_at=statement_timestamp() where id in(a.id,b.id);
    insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
      select b.plan_id,a.person_id,p.profile_id,b.team_id,b.position_id,'confirmed',(select auth.uid()),'released',statement_timestamp(),b.attendance_mode from public.people p where p.id=a.person_id returning * into na;
    insert into public.assignment_attendance_times select na.id,x from unnest(private.f07_assignment_time_ids(b.id))x;
    insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
      select a.plan_id,b.person_id,p.profile_id,a.team_id,a.position_id,'confirmed',(select auth.uid()),'released',statement_timestamp(),a.attendance_mode from public.people p where p.id=b.person_id returning * into nb;
    insert into public.assignment_attendance_times select nb.id,x from unnest(private.f07_assignment_time_ids(a.id))x;
    update public.approved_swaps set status='finalized',first_new_assignment_id=na.id,second_new_assignment_id=nb.id,version=version+1 where id=s.id returning * into s;
  end if;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(s.organization_id,'swap',s.id,s.status,(select auth.uid()));
  return s;
end $$;
revoke execute on function public.act_on_approved_swap(uuid,bigint,text) from public,anon;
grant execute on function public.act_on_approved_swap(uuid,bigint,text) to authenticated;

-- RLS exposes only reviewed opening fields to eligible People. Private roster,
-- counts and other candidates never flow through these policies.
alter table public.signup_opportunities enable row level security;
alter table public.opportunity_claims enable row level security;
alter table public.replacement_requests enable row level security;
alter table public.replacement_offers enable row level security;
alter table public.approved_swaps enable row level security;
alter table public.allocation_events enable row level security;

create policy signup_opportunities_select on public.signup_opportunities for select to authenticated using (
  (state='open' and closes_at>statement_timestamp() and private.f07_is_eligible(private.current_person(organization_id),team_id,position_id))
  or (select public.can_schedule_on_plan(plan_id,team_id))
);
create policy signup_opportunities_insert on public.signup_opportunities for insert to authenticated with check (
  created_by=(select auth.uid()) and (select public.can_schedule_on_plan(plan_id,team_id))
);
create policy signup_opportunities_update on public.signup_opportunities for update to authenticated using (
  (select public.can_schedule_on_plan(plan_id,team_id))
) with check ((select public.can_schedule_on_plan(plan_id,team_id)));

create policy opportunity_claims_select on public.opportunity_claims for select to authenticated using (
  person_id=private.current_person((select organization_id from public.signup_opportunities where id=opportunity_id))
  or exists(select 1 from public.signup_opportunities o where o.id=opportunity_id and public.can_schedule_on_plan(o.plan_id,o.team_id))
);

-- Keep request/offer RLS from recursively consulting the other protected
-- table. These definer helpers expose only a boolean and preserve the same
-- requester/candidate/scheduler visibility contract.
create or replace function private.f07_can_read_request(p_request uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.replacement_requests r
     where r.id=p_request and (
       r.requester_person_id=private.current_person(r.organization_id)
       or private.can_schedule_on_plan(p_actor,r.plan_id,r.team_id)
       or exists(select 1 from public.replacement_offers f
                  where f.request_id=r.id and f.candidate_person_id=private.current_person(r.organization_id))
     )
  )
$$;
create or replace function private.f07_can_read_offer(p_offer uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.replacement_offers f
    join public.replacement_requests r on r.id=f.request_id
     where f.id=p_offer and (
       f.candidate_person_id=private.current_person(r.organization_id)
       or r.requester_person_id=private.current_person(r.organization_id)
       or private.can_schedule_on_plan(p_actor,r.plan_id,r.team_id)
     )
  )
$$;
create policy replacement_requests_select on public.replacement_requests for select to authenticated using (
  private.f07_can_read_request(id,(select auth.uid()))
);
create policy replacement_offers_select on public.replacement_offers for select to authenticated using (
  private.f07_can_read_offer(id,(select auth.uid()))
);
create policy approved_swaps_select on public.approved_swaps for select to authenticated using (
  private.current_person(organization_id) in(first_person_id,second_person_id)
  or exists(select 1 from public.assignments a where a.id=first_assignment_id and public.can_schedule_on_plan(a.plan_id,a.team_id))
);
create policy allocation_events_select on public.allocation_events for select to authenticated using (
  actor_id=(select auth.uid()) or public.can_manage_org(organization_id)
);

grant select,insert,update on public.signup_opportunities to authenticated;
grant select on public.opportunity_claims,public.replacement_requests,public.replacement_offers,public.approved_swaps,public.allocation_events to authenticated;
revoke insert,update,delete on public.opportunity_claims,public.replacement_requests,public.replacement_offers,public.approved_swaps,public.allocation_events from authenticated,anon;
grant usage,select on sequence public.allocation_events_id_seq to authenticated,service_role;

revoke execute on function private.f07_scope_intersects(uuid[],uuid[]) from public,anon,authenticated;
revoke execute on function private.f07_assignment_time_ids(uuid) from public,anon,authenticated;
revoke execute on function private.f07_expire_reservations(uuid,uuid) from public,anon,authenticated;
revoke execute on function private.f07_occupied(uuid,uuid,uuid[],uuid) from public,anon,authenticated;
revoke execute on function private.f07_is_eligible(uuid,uuid,uuid) from public,anon;
grant execute on function private.f07_is_eligible(uuid,uuid,uuid) to authenticated,service_role;
revoke execute on function private.f07_has_conflict(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]) from public,anon,authenticated;
revoke execute on function private.f07_validate_opportunity() from public,anon,authenticated;
revoke execute on function private.f07_enforce_assignment_capacity() from public,anon,authenticated;
revoke execute on function private.f07_guard_need_capacity() from public,anon,authenticated;
revoke execute on function private.f07_finalize_offer(uuid) from public,anon,authenticated;
revoke execute on function private.f07_can_read_request(uuid,uuid) from public,anon;
revoke execute on function private.f07_can_read_offer(uuid,uuid) from public,anon;
grant execute on function private.f07_can_read_request(uuid,uuid) to authenticated,service_role;
grant execute on function private.f07_can_read_offer(uuid,uuid) to authenticated,service_role;
