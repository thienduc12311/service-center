-- W7-JRN-D2: the combined (cross-organization) schedule left out released
-- assignments on plans that have no times, while `/schedule/mine` lists them.
--
-- `private.assignment_attendance` is the one definition of the interval an
-- assignment commits a Person to; for a plan without times it yields a single
-- `untimed_fallback` row (service_date .. +2 hours) with a null plan_time_id.
-- The F04 version of `my_organization_schedule` joined only rows with a
-- plan_time_id, which dropped exactly those. Fallback rows exist only for
-- plans with no times, so including them cannot duplicate a timed entry.
-- Everything else is unchanged from 20261020000100_f04_assigned_times.sql.

create or replace function public.my_organization_schedule(p_organization_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(kind text, item_id uuid, title text, status text, starts_at timestamp with time zone, ends_at timestamp with time zone, plan_id uuid)
 language plpgsql
 stable
 set search_path to ''
as $function$
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
    join private.assignment_attendance pt on pt.assignment_id = a.id
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
$function$;
