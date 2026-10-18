-- F02 Pass B — guest staffing and account continuity.
--
-- Plan-only positions
--   A scheduler can add a position that exists on one plan only ("Guest
--   speaker", "Extra camera"). It is a `team_positions` row with `plan_id`
--   set, owned by a team, so staffing needs, assignments, answers and
--   delivery reuse every existing path. The team's normal position list
--   (`plan_id is null`) does not change. Such a position, its needs and its
--   assignments can only ever refer to that plan; copies skip them.
--
-- Account continuity
--   Accepting an invitation links the login to the invited Person. All of
--   that Person's assignments, links and history follow through the Pass A
--   triggers — same ids, new access. Linking stops (and is reported) when the
--   login already has a different Person in the organization, the Person is
--   already linked to another login, or the invitation is no longer valid.
--   Two concurrent acceptances for the same login and organization are
--   serialized; the loser sees the conflict.

-- ============================================== plan-only positions =====

alter table public.team_positions
  add column plan_id uuid references public.plans (id) on delete cascade,
  add column created_by uuid references public.profiles (id) on delete set null;
create index team_positions_plan_idx on public.team_positions (plan_id) where plan_id is not null;
create index team_positions_created_by_idx on public.team_positions (created_by);

-- Names stay unique within a team's normal list and within one plan's
-- additions; a plan-only "Vocals 3" does not collide with another plan's.
alter table public.team_positions drop constraint team_positions_team_id_name_key;
create unique index team_positions_team_name_unique
  on public.team_positions (team_id, name) where plan_id is null;
create unique index team_positions_plan_team_name_unique
  on public.team_positions (plan_id, team_id, name) where plan_id is not null;

-- A plan-only position is used only on its plan, and its team must belong to
-- that plan's organization.
create or replace function private.guard_plan_only_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  if tg_table_name = 'team_positions' then
    if new.plan_id is not null and not exists (
         select 1 from public.plans p join public.teams t on t.organization_id = p.organization_id
          where p.id = new.plan_id and t.id = new.team_id) then
      raise exception 'That team is not in this plan''s organization' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and new.plan_id is distinct from old.plan_id then
      raise exception 'A position cannot move between plans' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.position_id is null then
    return new;
  end if;
  select tp.plan_id into v_plan from public.team_positions tp where tp.id = new.position_id;
  if v_plan is not null and v_plan <> new.plan_id then
    raise exception 'That position belongs to another plan' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_plan_only_position() from public, anon, authenticated;

create trigger team_positions_guard_plan
  before insert or update on public.team_positions
  for each row execute function private.guard_plan_only_position();
create trigger assignments_guard_plan_position
  before insert or update of position_id, plan_id on public.assignments
  for each row execute function private.guard_plan_only_position();
create trigger plan_position_needs_guard_plan_position
  before insert or update of position_id, plan_id on public.plan_position_needs
  for each row execute function private.guard_plan_only_position();

-- Anyone who schedules the team on the plan may add or remove its plan-only
-- positions; editing a team's normal positions still needs teams.manage.
create or replace function public.create_plan_position(p_plan uuid, p_team uuid, p_name text, p_needed int default 1)
returns public.team_positions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_positions;
begin
  if (select auth.uid()) is null
     or not private.can_schedule_on_plan((select auth.uid()), p_plan, p_team) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Name the position (up to 80 characters)' using errcode = '22023';
  end if;
  if p_needed is null or p_needed not between 0 and 50 then
    raise exception 'Needed is between 0 and 50' using errcode = '22023';
  end if;

  insert into public.team_positions (team_id, name, sort_order, plan_id, created_by)
  values (
    p_team, btrim(p_name),
    1000 + (select count(*) from public.team_positions where plan_id = p_plan and team_id = p_team)::int,
    p_plan, (select auth.uid())
  )
  returning * into v_row;

  if p_needed > 0 then
    insert into public.plan_position_needs (plan_id, position_id, needed)
    values (p_plan, v_row.id, p_needed);
  end if;
  return v_row;
exception
  when unique_violation then
    raise exception 'This plan already has a position with that name on that team' using errcode = 'PT409';
end;
$$;
revoke execute on function public.create_plan_position(uuid, uuid, text, int) from public, anon;
grant execute on function public.create_plan_position(uuid, uuid, text, int) to authenticated;

-- Removing a plan-only position that someone is assigned to would orphan
-- their request; remove the assignment first.
create or replace function public.delete_plan_position(p_position uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.team_positions;
begin
  select * into v_row from public.team_positions where id = p_position;
  if not found or v_row.plan_id is null or (select auth.uid()) is null
     or not private.can_schedule_on_plan((select auth.uid()), v_row.plan_id, v_row.team_id) then
    raise exception 'Position not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.assignments a where a.position_id = p_position) then
    raise exception 'Remove the people scheduled in this position first' using errcode = 'PT409';
  end if;
  delete from public.team_positions where id = p_position;
end;
$$;
revoke execute on function public.delete_plan_position(uuid) from public, anon;
grant execute on function public.delete_plan_position(uuid) to authenticated;

-- Copies leave plan-only positions (and their needs and requests) behind.
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
    insert into public.assignments (plan_id, person_id, team_id, position_id, status, created_by)
    select p_target, a.person_id, a.team_id, a.position_id, 'unconfirmed', (select auth.uid())
      from public.assignments a
     where a.plan_id = p_source
       and exists (select 1 from private.resolve_scheduling_person(p_target, a.person_id, null))
       and (a.position_id is null
            or exists (select 1 from public.team_positions tp where tp.id = a.position_id and tp.plan_id is null))
       and public.can_schedule_on_plan(p_target, a.team_id)
    on conflict do nothing;
  end if;
end;
$$;

-- ================================================== invitation linking =====

drop function if exists public.accept_person_invitation(text, uuid);

-- Called by the backend's service-role client after it has located or
-- created the login. Returns an outcome instead of raising so a conflict can
-- be recorded for an administrator in the same transaction.
--   linked           the login now uses the invited Person (or already did)
--   invalid          not found, used, revoked or expired
--   person_linked    the Person already belongs to a different login
--   identity_conflict the login already has another Person here; reported
--   person_archived  the Person is archived (Pass C)
create or replace function public.accept_person_invitation(
  p_token_hash  text,
  p_new_user_id uuid
)
returns table (out_status text, out_organization_id uuid, out_person_id uuid, out_role public.org_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv      public.person_invitations;
  v_person public.people;
  v_other  uuid;
begin
  select * into inv
    from public.person_invitations
   where token_hash = p_token_hash
   for update;
  if not found or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    return query select 'invalid'::text, null::uuid, null::uuid, null::public.org_role;
    return;
  end if;

  -- One link decision at a time per login and organization.
  perform pg_advisory_xact_lock(hashtextextended('person-link:' || inv.organization_id::text || ':' || p_new_user_id::text, 0));

  select * into v_person from public.people where id = inv.person_id for update;
  if not found or v_person.organization_id <> inv.organization_id then
    return query select 'invalid'::text, null::uuid, null::uuid, null::public.org_role;
    return;
  end if;
  if v_person.profile_id is not null and v_person.profile_id <> p_new_user_id then
    return query select 'person_linked'::text, inv.organization_id, inv.person_id, inv.role;
    return;
  end if;

  select id into v_other from public.people
   where organization_id = inv.organization_id and profile_id = p_new_user_id and id <> inv.person_id;
  if v_other is not null then
    insert into public.person_identity_reconciliations (organization_id, profile_id, person_id, candidate_person_id, reason)
    values (inv.organization_id, p_new_user_id, v_other, inv.person_id, 'invitation_conflict')
    on conflict do nothing;
    return query select 'identity_conflict'::text, inv.organization_id, inv.person_id, inv.role;
    return;
  end if;

  if v_person.profile_id is null then
    update public.people set profile_id = p_new_user_id where id = inv.person_id;
  end if;

  -- An existing active membership keeps its role; otherwise join as invited.
  insert into public.organization_members (organization_id, user_id, role, status)
  values (inv.organization_id, p_new_user_id, inv.role, 'active')
  on conflict (organization_id, user_id) do update
    set role = case when public.organization_members.status = 'active'
                    then public.organization_members.role else excluded.role end,
        status = 'active';

  update public.person_invitations set accepted_at = now() where id = inv.id;

  return query select 'linked'::text, inv.organization_id, inv.person_id, inv.role;
end;
$$;
revoke execute on function public.accept_person_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_person_invitation(text, uuid) to service_role;

-- ========================================== reconciliation resolution =====
-- An administrator decides whether two Person records are one human.
--   keep_separate  nothing moves; the report is closed
--   merge          the no-login candidate's staffing, team places, tags and
--                  links move to the linked Person, then the candidate is
--                  removed. Refused when both are on the same request.
create or replace function public.resolve_person_reconciliation(p_id uuid, p_action text)
returns public.person_identity_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.person_identity_reconciliations;
  v_keep  public.people;
  v_drop  public.people;
begin
  select * into v_row from public.person_identity_reconciliations where id = p_id for update;
  if not found or not public.is_org_admin(v_row.organization_id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    return v_row;
  end if;
  if p_action not in ('keep_separate', 'merge') then
    raise exception 'Choose keep_separate or merge' using errcode = '22023';
  end if;

  if p_action = 'merge' then
    select * into v_keep from public.people where id = v_row.person_id for update;
    select * into v_drop from public.people where id = v_row.candidate_person_id for update;
    if v_drop.profile_id is not null then
      raise exception 'Only a person without a login can be merged into another' using errcode = 'PT409';
    end if;
    if exists (
      select 1 from public.assignments a
        join public.assignments b on b.plan_id = a.plan_id and b.team_id = a.team_id
                                 and b.position_id is not distinct from a.position_id
       where a.person_id = v_drop.id and b.person_id = v_keep.id) then
      raise exception 'Both records are on the same request; remove one first' using errcode = 'PT409';
    end if;

    -- Per-request records keyed by Person must not collide either.
    if exists (select 1 from public.assignment_request_snapshots a
                 join public.assignment_request_snapshots b on b.effect_id = a.effect_id
                where a.person_id = v_drop.id and b.person_id = v_keep.id)
       or exists (select 1 from public.deliveries a
                    join public.deliveries b on b.effect_id = a.effect_id and b.channel = a.channel
                   where a.recipient_person_id = v_drop.id and b.recipient_person_id = v_keep.id)
       or exists (select 1 from public.assignment_notifications a
                    join public.assignment_notifications b on b.plan_id = a.plan_id
                   where a.person_id = v_drop.id and b.person_id = v_keep.id
                     and a.responded_at is null and b.responded_at is null) then
      raise exception 'Both records have requests in flight for the same plan; wait for them to be answered'
        using errcode = 'PT409';
    end if;

    update public.assignments set person_id = v_keep.id, user_id = v_keep.profile_id where person_id = v_drop.id;
    update public.assignment_responses set assignee_person_id = v_keep.id, assignee_id = v_keep.profile_id
     where assignee_person_id = v_drop.id;
    update public.assignment_time_response_history set assignee_person_id = v_keep.id
     where assignee_person_id = v_drop.id;
    delete from public.team_memberships tm
     where tm.person_id = v_drop.id
       and exists (select 1 from public.team_memberships k
                    where k.person_id = v_keep.id and k.team_id = tm.team_id
                      and k.position_id is not distinct from tm.position_id);
    update public.team_memberships set person_id = v_keep.id, user_id = v_keep.profile_id where person_id = v_drop.id;
    insert into public.person_tags (organization_id, person_id, tag, created_by)
    select organization_id, v_keep.id, tag, created_by from public.person_tags where person_id = v_drop.id
    on conflict do nothing;
    -- Outstanding respond links keep working for the requests they named.
    update public.assignment_notifications set person_id = v_keep.id, user_id = v_keep.profile_id
     where person_id = v_drop.id;
    update public.assignment_request_snapshots set person_id = v_keep.id where person_id = v_drop.id;
    update public.assignment_response_operations set person_id = v_keep.id where person_id = v_drop.id
       and not exists (select 1 from public.assignment_response_operations k
                        where k.person_id = v_keep.id and k.idempotency_key = assignment_response_operations.idempotency_key);
    update public.deliveries set recipient_person_id = v_keep.id where recipient_person_id = v_drop.id;
    update public.delivery_effects set responder_person_id = v_keep.id where responder_person_id = v_drop.id;
    update public.person_identity_reconciliations
       set status = 'kept_separate', resolved_by = (select auth.uid()), resolved_at = now()
     where id <> v_row.id and status = 'open'
       and (person_id = v_drop.id or candidate_person_id = v_drop.id);
    delete from public.people where id = v_drop.id;
  end if;

  update public.person_identity_reconciliations
     set status = case when p_action = 'merge' then 'merged' else 'kept_separate' end,
         resolved_by = (select auth.uid()), resolved_at = now()
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.resolve_person_reconciliation(uuid, text) from public, anon;
grant execute on function public.resolve_person_reconciliation(uuid, text) to authenticated;

-- ================================================ delivery readiness =====
-- What a scheduler needs before sending a request, without the address:
-- does the Person have a login, any email, and an active membership.
create or replace function public.person_delivery_readiness(p_org uuid, p_person_ids uuid[])
returns table (person_id uuid, has_login boolean, has_email boolean, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         p.profile_id is not null,
         nullif(btrim(coalesce(pr.email, p.email, '')), '') is not null,
         p.profile_id is null or exists (
           select 1 from public.organization_members m
            where m.organization_id = p.organization_id and m.user_id = p.profile_id and m.status = 'active')
    from public.people p
    left join public.profiles pr on pr.id = p.profile_id
   where p.organization_id = p_org
     and p.id = any (p_person_ids)
     and (public.has_capability_anywhere(p_org, 'scheduling.manage')
          or public.has_capability(p_org, 'people.view_private'));
$$;
revoke execute on function public.person_delivery_readiness(uuid, uuid[]) from public, anon;
grant execute on function public.person_delivery_readiness(uuid, uuid[]) to authenticated;

-- ===================================================== guest creation =====
-- A scheduler may add a minimal no-login Person (name, optional email) while
-- staffing, without people.manage. Full roster editing still needs it. The
-- email is contact only: no invitation is sent and nothing is merged by it.
create or replace function public.create_guest_person(
  p_org        uuid,
  p_first_name text,
  p_last_name  text default null,
  p_email      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if (select auth.uid()) is null
     or not (public.has_capability_anywhere(p_org, 'scheduling.manage')
             or public.has_capability(p_org, 'people.manage')) then
    raise exception 'You cannot add people to this organization' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_first_name, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_last_name, ''))) > 80 then
    raise exception 'Give a first name (and optional last name) up to 80 characters' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'That email address does not look right' using errcode = '22023';
  end if;

  insert into public.people (organization_id, first_name, last_name, email, created_by)
  values (p_org, btrim(p_first_name), nullif(btrim(coalesce(p_last_name, '')), ''), v_email, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_guest_person(uuid, text, text, text) from public, anon;
grant execute on function public.create_guest_person(uuid, text, text, text) to authenticated;

comment on column public.team_positions.plan_id is
  'F02: set for a plan-only position; the team''s normal list is plan_id is null.';
