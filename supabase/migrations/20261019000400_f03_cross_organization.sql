-- ============================================================================
-- F03 Pass D (optional) — own-organizations aggregation
--
-- * A user opts in to a combined schedule of their own memberships. Each
--   organization is read separately through that organization's normal RLS,
--   so no new cross-organization authority exists; the API reports a
--   per-organization outcome.
-- * Separately, a user may opt in to sharing *busy intervals* with schedulers
--   in their other organizations. Those schedulers see only start/end times —
--   never titles, organization names, reasons or plan ids.
-- * Copying availability to another organization is explicit: the API
--   re-checks membership in each target and writes through MOB-006's
--   create_blockout under that organization's rules.
-- ============================================================================

create table public.user_schedule_settings (
  user_id                 uuid primary key references public.profiles (id) on delete cascade,
  combined_schedule       boolean not null default false,
  share_busy_across_orgs  boolean not null default false,
  updated_at              timestamptz not null default now()
);
alter table public.user_schedule_settings enable row level security;
create policy user_schedule_settings_own on public.user_schedule_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update on public.user_schedule_settings to authenticated;
grant all on public.user_schedule_settings to service_role;

-- The caller's own released requests and blockouts in one organization.
-- Invoker: assignment/blockout RLS decides; nothing about anyone else.
create or replace function public.my_organization_schedule(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  kind text,
  item_id uuid,
  title text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  plan_id uuid
)
language plpgsql stable security invoker set search_path = '' as $$
declare v_person uuid;
begin
  if p_to <= p_from or p_to - p_from > interval '92 days' then
    raise exception 'Choose a window of at most 92 days' using errcode = '22023';
  end if;
  if not coalesce((select s.combined_schedule from public.user_schedule_settings s
                    where s.user_id = (select auth.uid())), false) then
    raise exception 'Turn on the combined schedule first' using errcode = '42501';
  end if;
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  select p.id into v_person from public.people p
   where p.organization_id = p_organization_id and p.profile_id = (select auth.uid());
  if v_person is null then return; end if;

  return query
  select 'assignment'::text, a.id, p.title, a.status::text, pt.starts_at, pt.ends_at, p.id
    from public.assignments a
    join public.plans p on p.id = a.plan_id
    join public.plan_times pt on pt.plan_id = a.plan_id
     and (a.attendance_mode = 'all' or exists (
       select 1 from public.assignment_attendance_times aat
        where aat.assignment_id = a.id and aat.plan_time_id = pt.id))
   where a.person_id = v_person and p.organization_id = p_organization_id
     and a.visibility = 'released' and a.status <> 'declined'
     and pt.starts_at < p_to and pt.ends_at > p_from
  union all
  select 'blockout'::text, b.id, coalesce(b.reason, 'Unavailable'), null::text, b.starts_at, b.ends_at, null::uuid
    from public.blockouts b
   where b.person_id = v_person and b.organization_id = p_organization_id
     and b.starts_at < p_to and b.ends_at > p_from
   order by 5;
end;
$$;
revoke execute on function public.my_organization_schedule(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.my_organization_schedule(uuid, timestamptz, timestamptz) to authenticated;

-- Redacted busy intervals from a candidate's *other* organizations, for a
-- scheduler in this one, only when the candidate opted in.
create or replace function public.cross_organization_busy(
  p_organization_id uuid,
  p_person_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
returns table (person_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null
     and not public.has_capability_anywhere(p_organization_id, 'scheduling.manage') then
    raise exception 'Only a scheduler can check conflicts' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '92 days' then
    raise exception 'Choose a window of at most 92 days' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select p.id person_id, p.profile_id
      from public.people p
      join public.user_schedule_settings s on s.user_id = p.profile_id and s.share_busy_across_orgs
     where p.id = any (p_person_ids) and p.organization_id = p_organization_id
       and exists (select 1 from public.organization_members m
                    where m.organization_id = p_organization_id and m.user_id = p.profile_id and m.status = 'active')
  ), elsewhere as (
    select c.person_id, op.id other_person_id, op.organization_id
      from candidates c
      join public.people op on op.profile_id = c.profile_id and op.organization_id <> p_organization_id
      join public.organization_members m
        on m.organization_id = op.organization_id and m.user_id = c.profile_id and m.status = 'active'
  )
  select distinct e.person_id, b.starts_at, b.ends_at
    from elsewhere e
    join public.blockouts b on b.person_id = e.other_person_id
   where b.starts_at < p_to and b.ends_at > p_from
  union
  select distinct e.person_id, pt.starts_at, pt.ends_at
    from elsewhere e
    join public.assignments a on a.person_id = e.other_person_id
    join public.plan_times pt on pt.plan_id = a.plan_id
     and (a.attendance_mode = 'all' or exists (
       select 1 from public.assignment_attendance_times aat
        where aat.assignment_id = a.id and aat.plan_time_id = pt.id))
   where a.visibility = 'released' and a.status <> 'declined'
     and pt.starts_at < p_to and pt.ends_at > p_from;
end;
$$;
revoke execute on function public.cross_organization_busy(uuid, uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.cross_organization_busy(uuid, uuid[], timestamptz, timestamptz) to authenticated, service_role;
