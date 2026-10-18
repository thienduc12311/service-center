-- ============================================================================
-- F03 Pass C — explicit delegated assistance
--
-- A Person (with a login) explicitly grants another member of the same
-- organization a set of separate rights over *their own* schedule:
--   respond         answer their released requests
--   view_schedule   see their released requests (title, date, times, role) —
--                   never plan items, notes, files or other people
--   availability    manage their blockouts and preferences
--   signup          reserved for F07 signups; stored, nothing consumes it yet
-- Consent: only the target Person can create a grant, so an adult's grant is
-- always their own act. A household relationship, a role, or an admin cannot
-- create one. A target without a login (for example a child) cannot be
-- delegated until a guardian policy exists — that branch fails closed.
-- Every action re-checks the grant (active, unexpired, both people still
-- active members and not archived). Revocation stops the next action; past
-- changes keep the delegate as their actor. Grants and delegated actions are
-- audited.
-- ============================================================================

create table public.schedule_delegations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  target_person_id     uuid not null references public.people (id) on delete cascade,
  delegate_person_id   uuid not null references public.people (id) on delete cascade,
  granted_by           uuid references public.profiles (id) on delete set null,
  can_respond          boolean not null default false,
  can_view_schedule    boolean not null default false,
  can_manage_availability boolean not null default false,
  can_signup           boolean not null default false,
  expires_at           timestamptz,
  revoked_at           timestamptz,
  revoked_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint schedule_delegations_distinct check (target_person_id <> delegate_person_id),
  constraint schedule_delegations_some_right check (
    can_respond or can_view_schedule or can_manage_availability or can_signup
  )
);
create unique index schedule_delegations_one_active
  on public.schedule_delegations (target_person_id, delegate_person_id) where revoked_at is null;
create index schedule_delegations_delegate_idx on public.schedule_delegations (delegate_person_id) where revoked_at is null;
create index schedule_delegations_target_idx on public.schedule_delegations (target_person_id);
create index schedule_delegations_org_idx on public.schedule_delegations (organization_id);
create index schedule_delegations_granted_by_idx on public.schedule_delegations (granted_by);
create index schedule_delegations_revoked_by_idx on public.schedule_delegations (revoked_by);

create table public.schedule_delegation_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  delegation_id    uuid not null references public.schedule_delegations (id) on delete cascade,
  actor_id         uuid references public.profiles (id) on delete set null,
  event            text not null check (event in ('granted', 'revoked', 'responded', 'availability_changed')),
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index schedule_delegation_events_delegation_idx on public.schedule_delegation_events (delegation_id, created_at);
create index schedule_delegation_events_org_idx on public.schedule_delegation_events (organization_id);
create index schedule_delegation_events_actor_idx on public.schedule_delegation_events (actor_id);

-- The one place a grant is evaluated. Called by RLS helpers and every
-- delegated function, so revocation/expiry/membership changes apply at the
-- next statement.
create or replace function private.delegation_for(p_user uuid, p_target uuid, p_right text)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.id
    from public.schedule_delegations d
    join public.people dp on dp.id = d.delegate_person_id
    join public.people tp on tp.id = d.target_person_id
   where d.target_person_id = p_target
     and dp.profile_id = p_user
     and p_user is not null
     and d.revoked_at is null
     and (d.expires_at is null or d.expires_at > now())
     and dp.archived_at is null and tp.archived_at is null
     and tp.profile_id is not null
     and exists (select 1 from public.organization_members m
                  where m.organization_id = d.organization_id and m.user_id = dp.profile_id and m.status = 'active')
     and exists (select 1 from public.organization_members m
                  where m.organization_id = d.organization_id and m.user_id = tp.profile_id and m.status = 'active')
     and case p_right
           when 'respond' then d.can_respond
           when 'view_schedule' then d.can_view_schedule or d.can_respond
           when 'availability' then d.can_manage_availability
           when 'signup' then d.can_signup
           else false end
   limit 1;
$$;
revoke execute on function private.delegation_for(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.delegation_for(uuid, uuid, text) to service_role;

create or replace function private.delegation_allows(p_user uuid, p_target uuid, p_right text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.delegation_for(p_user, p_target, p_right) is not null;
$$;
revoke execute on function private.delegation_allows(uuid, uuid, text) from public, anon;
grant execute on function private.delegation_allows(uuid, uuid, text) to authenticated, service_role;

alter table public.schedule_delegations enable row level security;
alter table public.schedule_delegation_events enable row level security;
-- Each side sees its grants; administrators see all for support.
create policy schedule_delegations_select on public.schedule_delegations
  for select to authenticated using (
    exists (select 1 from public.people p
             where p.id in (target_person_id, delegate_person_id) and p.profile_id = (select auth.uid()))
    or (select public.is_org_admin(organization_id))
  );
create policy schedule_delegation_events_select on public.schedule_delegation_events
  for select to authenticated using (
    exists (select 1 from public.schedule_delegations d where d.id = delegation_id)
  );
grant select on public.schedule_delegations, public.schedule_delegation_events to authenticated;
grant all on public.schedule_delegations, public.schedule_delegation_events to service_role;

-- ------------------------------------------------- availability helpers ---
-- MOB-006's single availability access check now also admits an explicit
-- availability delegate. Every blockout/series policy and RPC uses it.
create or replace function private.can_manage_blockout(p_org uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_member(p_org) and (
    exists (select 1 from public.people p where p.id = p_person and p.organization_id = p_org
             and p.profile_id = (select auth.uid()))
    or public.has_capability_anywhere(p_org, 'scheduling.manage')
    or private.delegation_allows((select auth.uid()), p_person, 'availability')
  );
$$;

create or replace function private.is_availability_reviewer(p_user uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    exists (select 1 from public.people p where p.id = p_person and p.profile_id = p_user)
    or private.delegation_allows(p_user, p_person, 'availability')
  );
$$;

-- Delegated blockout changes are audited on the grant.
create or replace function private.blockout_review_touch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := coalesce(new.person_id, old.person_id);
  v_delegation uuid;
begin
  if private.is_availability_reviewer((select auth.uid()), v_person) then
    perform private.record_availability_review(v_person, 'changed');
  end if;
  if not exists (select 1 from public.people p where p.id = v_person and p.profile_id = (select auth.uid())) then
    v_delegation := private.delegation_for((select auth.uid()), v_person, 'availability');
    if v_delegation is not null then
      insert into public.schedule_delegation_events (organization_id, delegation_id, actor_id, event, detail)
      values (coalesce(new.organization_id, old.organization_id), v_delegation, (select auth.uid()),
              'availability_changed', jsonb_build_object('op', lower(tg_op), 'blockout_id', coalesce(new.id, old.id)));
    end if;
  end if;
  return null;
end;
$$;

-- ------------------------------------------------------ grant / revoke ----

create or replace function public.grant_schedule_delegation(
  p_organization_id uuid,
  p_delegate_person_id uuid,
  p_can_respond boolean,
  p_can_view_schedule boolean,
  p_can_manage_availability boolean,
  p_can_signup boolean,
  p_expires_at timestamptz default null
)
returns public.schedule_delegations
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_target public.people;
  v_delegate public.people;
  v_row public.schedule_delegations;
begin
  if v_actor is null or not public.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  -- Consent: the grant is always made by the target themselves.
  select * into v_target from public.people
   where organization_id = p_organization_id and profile_id = v_actor and archived_at is null;
  if v_target.id is null then
    raise exception 'Only the person whose schedule it is can grant help' using errcode = '42501';
  end if;
  select * into v_delegate from public.people
   where id = p_delegate_person_id and organization_id = p_organization_id and archived_at is null;
  if v_delegate.id is null or v_delegate.profile_id is null or not exists (
       select 1 from public.organization_members m
        where m.organization_id = p_organization_id and m.user_id = v_delegate.profile_id and m.status = 'active') then
    raise exception 'The helper must be an active member with a login' using errcode = '22023';
  end if;
  if v_delegate.id = v_target.id then
    raise exception 'Choose someone else' using errcode = '22023';
  end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '2 years') then
    raise exception 'Expiry must be within the next two years' using errcode = '22023';
  end if;

  -- One active grant per pair: a new grant replaces the old one (audited).
  update public.schedule_delegations
     set revoked_at = now(), revoked_by = v_actor
   where target_person_id = v_target.id and delegate_person_id = v_delegate.id and revoked_at is null
  returning * into v_row;
  if v_row.id is not null then
    insert into public.schedule_delegation_events (organization_id, delegation_id, actor_id, event, detail)
    values (p_organization_id, v_row.id, v_actor, 'revoked', '{"reason":"replaced"}');
  end if;

  insert into public.schedule_delegations (
    organization_id, target_person_id, delegate_person_id, granted_by,
    can_respond, can_view_schedule, can_manage_availability, can_signup, expires_at
  ) values (
    p_organization_id, v_target.id, v_delegate.id, v_actor,
    coalesce(p_can_respond, false), coalesce(p_can_view_schedule, false),
    coalesce(p_can_manage_availability, false), coalesce(p_can_signup, false), p_expires_at
  ) returning * into v_row;
  insert into public.schedule_delegation_events (organization_id, delegation_id, actor_id, event, detail)
  values (p_organization_id, v_row.id, v_actor, 'granted', jsonb_build_object(
    'respond', v_row.can_respond, 'view_schedule', v_row.can_view_schedule,
    'availability', v_row.can_manage_availability, 'signup', v_row.can_signup,
    'expires_at', v_row.expires_at));
  return v_row;
end;
$$;
revoke execute on function public.grant_schedule_delegation(uuid, uuid, boolean, boolean, boolean, boolean, timestamptz) from public, anon;
grant execute on function public.grant_schedule_delegation(uuid, uuid, boolean, boolean, boolean, boolean, timestamptz) to authenticated;

-- The target, the delegate or an administrator may end a grant. Idempotent.
create or replace function public.revoke_schedule_delegation(p_delegation_id uuid)
returns public.schedule_delegations
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.schedule_delegations;
begin
  select * into v_row from public.schedule_delegations where id = p_delegation_id for update;
  if v_row.id is null or not (
       exists (select 1 from public.people p
                where p.id in (v_row.target_person_id, v_row.delegate_person_id) and p.profile_id = v_actor)
       or public.is_org_admin(v_row.organization_id)) then
    raise exception 'Delegation not found' using errcode = 'P0002';
  end if;
  if v_row.revoked_at is not null then return v_row; end if;
  update public.schedule_delegations set revoked_at = now(), revoked_by = v_actor
   where id = v_row.id returning * into v_row;
  insert into public.schedule_delegation_events (organization_id, delegation_id, actor_id, event)
  values (v_row.organization_id, v_row.id, v_actor, 'revoked');
  return v_row;
end;
$$;
revoke execute on function public.revoke_schedule_delegation(uuid) from public, anon;
grant execute on function public.revoke_schedule_delegation(uuid) to authenticated;

-- ---------------------------------------------------- delegated reading ---
-- Released requests only, with exactly the fields needed to answer them.
create or replace function public.delegated_schedule(
  p_organization_id uuid,
  p_person_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  assignment_id uuid,
  status public.assignment_status,
  plan_id uuid,
  plan_title text,
  service_date timestamptz,
  location text,
  team_name text,
  position_name text,
  times jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.people p where p.id = p_person_id and p.organization_id = p_organization_id)
     or not private.delegation_allows((select auth.uid()), p_person_id, 'view_schedule') then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  return query
  select a.id, a.status, p.id, p.title, p.service_date, p.location, t.name, tp.name,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', pt.id, 'kind', pt.kind, 'name', pt.name,
                                               'starts_at', pt.starts_at, 'ends_at', pt.ends_at)
                            order by pt.starts_at)
             from public.plan_times pt
            where pt.plan_id = p.id
              and (a.attendance_mode = 'all' or exists (
                select 1 from public.assignment_attendance_times aat
                 where aat.assignment_id = a.id and aat.plan_time_id = pt.id))
         ), '[]'::jsonb)
    from public.assignments a
    join public.plans p on p.id = a.plan_id
    left join public.teams t on t.id = a.team_id
    left join public.team_positions tp on tp.id = a.position_id
   where a.person_id = p_person_id
     and p.organization_id = p_organization_id
     and a.visibility = 'released'
     and p.service_date >= coalesce(p_from, current_date - 1)
     and p.service_date < coalesce(p_to, current_date + 366) + 1
   order by p.service_date, p.title;
end;
$$;
revoke execute on function public.delegated_schedule(uuid, uuid, date, date) from public, anon;
grant execute on function public.delegated_schedule(uuid, uuid, date, date) to authenticated;

-- --------------------------------------------------- delegated response ---
-- The scheduler-update outbox accepts a response made under a live respond
-- grant; the effect is still attributed to the assignee's Profile.
create or replace function private.enqueue_scheduler_responses(
  p_assignment_ids uuid[],
  p_responder uuid,
  p_status public.assignment_status,
  p_transition text,
  p_effect_key text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_plan uuid;
  v_person uuid;
  v_plans int;
  v_effect uuid;
begin
  select min(p.organization_id::text)::uuid, min(a.plan_id::text)::uuid,
         min(a.person_id::text)::uuid, count(distinct a.plan_id)
    into v_org, v_plan, v_person, v_plans
    from public.assignments a join public.plans p on p.id = a.plan_id
   where a.id = any(p_assignment_ids)
     and (p_responder is null or a.user_id = p_responder);
  if v_plans = 0 then return null; end if;
  if v_plans > 1 then raise exception 'One response effect covers one plan' using errcode = '22023'; end if;
  if (select auth.uid()) is not null and (select auth.uid()) is distinct from p_responder
     and not private.delegation_allows((select auth.uid()), v_person, 'respond') then
    raise exception 'Only the assignee can answer' using errcode = '42501';
  end if;

  insert into public.delivery_effects (
    organization_id, effect_key, template, plan_id, assignment_ids,
    responder_id, responder_person_id, response_status, response_transition, created_by
  )
  select v_org, p_effect_key, 'scheduler_response', v_plan,
         array_agg(a.id order by a.id), p_responder, v_person, p_status, p_transition, p_responder
    from public.assignments a where a.id = any(p_assignment_ids) and a.person_id = v_person
  on conflict (organization_id, effect_key) do nothing
  returning id into v_effect;
  if v_effect is null then
    select id into v_effect from public.delivery_effects
     where organization_id = v_org and effect_key = p_effect_key;
    return v_effect;
  end if;

  insert into public.deliveries (
    organization_id, effect_id, recipient_id, recipient_person_id, channel
  )
  select v_org, v_effect, owners.owner_id, people.id, channels.channel
    from (
      select distinct coalesce(a.response_owner_id, a.created_by) owner_id
        from public.assignments a
       where a.id = any(p_assignment_ids)
         and coalesce(a.response_owner_id, a.created_by) is not null
         and coalesce(a.response_owner_id, a.created_by) is distinct from p_responder
    ) owners
    join public.people people on people.organization_id = v_org and people.profile_id = owners.owner_id
    cross join unnest(
      case when p_status = 'declined'
           then array['in_app','push','email']::public.delivery_channel[]
           else array['in_app','push']::public.delivery_channel[] end
    ) channels(channel);
  return v_effect;
end;
$$;

-- Answer one released request for the target under a respond grant. Same
-- transitions as a self-response (MOB-004): unconfirmed -> confirmed/declined,
-- confirmed -> declined (withdrawal); repeating the current answer is a
-- no-op. History records the delegate as actor.
create or replace function public.respond_as_delegate(
  p_organization_id uuid,
  p_person_id uuid,
  p_assignment_id uuid,
  p_status public.assignment_status,
  p_expected_status public.assignment_status,
  p_reason text default null
)
returns table (assignment_id uuid, status public.assignment_status, transition text, effect_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_delegation uuid;
  v_row public.assignments;
  v_profile uuid;
  v_history uuid;
  v_effect uuid;
  v_transition text;
begin
  v_delegation := private.delegation_for(v_actor, p_person_id, 'respond');
  if v_delegation is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if p_status = 'unconfirmed' then raise exception 'An answer is either confirmed or declined' using errcode = '22023'; end if;
  if p_reason is not null and (p_status <> 'declined' or char_length(p_reason) > 500) then
    raise exception 'A reason can only accompany a decline' using errcode = '22023';
  end if;

  select a.* into v_row
    from public.assignments a join public.plans p on p.id = a.plan_id
   where a.id = p_assignment_id and a.person_id = p_person_id
     and p.organization_id = p_organization_id and a.visibility = 'released'
   for update of a;
  if v_row.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if v_row.status = p_status then
    return query select v_row.id, v_row.status, 'unchanged'::text, null::uuid; return;
  end if;
  if v_row.status <> p_expected_status then
    raise exception 'This request changed; refresh and try again' using errcode = 'PT409';
  end if;
  if v_row.status = 'declined' then
    raise exception 'A declined request needs a new scheduler request' using errcode = 'PT409';
  end if;
  v_transition := case when v_row.status = 'confirmed' then 'withdrawal' else 'response' end;

  perform set_config('app.assignment_response_note', coalesce(nullif(btrim(p_reason), ''), ''), true);
  update public.assignments set status = p_status, responded_at = now()
   where id = v_row.id returning * into v_row;
  perform set_config('app.assignment_response_note', '', true);

  select profile_id into v_profile from public.people where id = p_person_id;
  select h.id into v_history from public.assignment_responses h
   where h.assignment_id = v_row.id order by h.created_at desc, h.id desc limit 1;
  v_effect := private.enqueue_scheduler_responses(
    array[v_row.id], v_profile, p_status, v_transition, 'assignment-response:' || v_history::text);

  insert into public.schedule_delegation_events (organization_id, delegation_id, actor_id, event, detail)
  values (p_organization_id, v_delegation, v_actor, 'responded',
          jsonb_build_object('assignment_id', v_row.id, 'status', p_status, 'transition', v_transition));
  return query select v_row.id, v_row.status, v_transition, v_effect;
end;
$$;
revoke execute on function public.respond_as_delegate(uuid, uuid, uuid, public.assignment_status, public.assignment_status, text) from public, anon;
grant execute on function public.respond_as_delegate(uuid, uuid, uuid, public.assignment_status, public.assignment_status, text) to authenticated;
