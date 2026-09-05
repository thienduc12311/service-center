-- ============================================================================
-- Row Level Security
--
-- Everything is scoped to an organization. Membership is resolved through
-- SECURITY DEFINER helpers so that policies on `organization_members` don't
-- recurse into themselves.
-- ============================================================================

create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.org_role_of(org uuid)
returns public.org_role language sql stable security definer set search_path = public as $$
  select m.role from public.organization_members m
  where m.organization_id = org
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

-- Owners, admins and schedulers may edit plans, songs, teams and schedules.
create or replace function public.can_manage_org(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.org_role_of(org) in ('owner', 'admin', 'scheduler');
$$;

-- Only owners/admins may change membership and org settings.
create or replace function public.is_org_admin(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.org_role_of(org) in ('owner', 'admin');
$$;

-- Convenience resolvers for tables that reach the org through a parent row.
create or replace function public.org_of_team(t uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.teams where id = t;
$$;

create or replace function public.org_of_song(s uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.songs where id = s;
$$;

create or replace function public.org_of_plan(p uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.plans where id = p;
$$;

create or replace function public.org_of_arrangement(a uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.organization_id
  from public.arrangements ar
  join public.songs s on s.id = ar.song_id
  where ar.id = a;
$$;

-- --------------------------------------------------------------- enable ----
alter table public.organizations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;
alter table public.service_types        enable row level security;
alter table public.teams                enable row level security;
alter table public.team_positions       enable row level security;
alter table public.team_memberships     enable row level security;
alter table public.songs                enable row level security;
alter table public.arrangements         enable row level security;
alter table public.plans                enable row level security;
alter table public.plan_times           enable row level security;
alter table public.plan_items           enable row level security;
alter table public.assignments          enable row level security;
alter table public.blockouts            enable row level security;
alter table public.attachments          enable row level security;

-- -------------------------------------------------------- organizations ----
create policy org_select on public.organizations
  for select using (public.is_org_member(id));
create policy org_update on public.organizations
  for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));
-- Creation goes through public.create_organization() so the creator also lands
-- in organization_members in the same transaction.

-- ------------------------------------------------------------ profiles -----
-- You can see yourself, plus anyone you share an organization with.
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_members me
      join public.organization_members them
        on them.organization_id = me.organization_id
      where me.user_id = auth.uid()
        and me.status = 'active'
        and them.user_id = public.profiles.id
    )
  );
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------- organization_members ----
create policy members_select on public.organization_members
  for select using (public.is_org_member(organization_id) or user_id = auth.uid());
create policy members_insert on public.organization_members
  for insert with check (public.is_org_admin(organization_id));
create policy members_update on public.organization_members
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
create policy members_delete on public.organization_members
  for delete using (public.is_org_admin(organization_id));

-- ------------------------------------- org-scoped tables: read / manage -----
do $$
declare t text;
begin
  foreach t in array array['service_types','teams','songs','plans','attachments'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select using (public.is_org_member(organization_id));
      create policy %1$s_write on public.%1$I
        for all using (public.can_manage_org(organization_id))
        with check (public.can_manage_org(organization_id));
    $f$, t);
  end loop;
end $$;

-- ------------------------------------------------ tables reached via FK -----
create policy team_positions_select on public.team_positions
  for select using (public.is_org_member(public.org_of_team(team_id)));
create policy team_positions_write on public.team_positions
  for all using (public.can_manage_org(public.org_of_team(team_id)))
  with check (public.can_manage_org(public.org_of_team(team_id)));

create policy team_memberships_select on public.team_memberships
  for select using (public.is_org_member(public.org_of_team(team_id)));
create policy team_memberships_write on public.team_memberships
  for all using (public.can_manage_org(public.org_of_team(team_id)))
  with check (public.can_manage_org(public.org_of_team(team_id)));

create policy arrangements_select on public.arrangements
  for select using (public.is_org_member(public.org_of_song(song_id)));
create policy arrangements_write on public.arrangements
  for all using (public.can_manage_org(public.org_of_song(song_id)))
  with check (public.can_manage_org(public.org_of_song(song_id)));

create policy plan_times_select on public.plan_times
  for select using (public.is_org_member(public.org_of_plan(plan_id)));
create policy plan_times_write on public.plan_times
  for all using (public.can_manage_org(public.org_of_plan(plan_id)))
  with check (public.can_manage_org(public.org_of_plan(plan_id)));

create policy plan_items_select on public.plan_items
  for select using (public.is_org_member(public.org_of_plan(plan_id)));
create policy plan_items_write on public.plan_items
  for all using (public.can_manage_org(public.org_of_plan(plan_id)))
  with check (public.can_manage_org(public.org_of_plan(plan_id)));

-- --------------------------------------------------------- assignments -----
create policy assignments_select on public.assignments
  for select using (public.is_org_member(public.org_of_plan(plan_id)));
create policy assignments_insert on public.assignments
  for insert with check (public.can_manage_org(public.org_of_plan(plan_id)));
create policy assignments_delete on public.assignments
  for delete using (public.can_manage_org(public.org_of_plan(plan_id)));
-- Schedulers may edit anything; a scheduled person may only respond to their own.
create policy assignments_update on public.assignments
  for update using (
    public.can_manage_org(public.org_of_plan(plan_id)) or user_id = auth.uid()
  ) with check (
    public.can_manage_org(public.org_of_plan(plan_id)) or user_id = auth.uid()
  );

-- ----------------------------------------------------------- blockouts -----
-- Schedulers need to see everyone's blockouts to schedule around them, but
-- only the person themselves may create or remove one.
create policy blockouts_select on public.blockouts
  for select using (
    user_id = auth.uid() or public.can_manage_org(organization_id)
  );
-- You may always manage your own; schedulers may also record one for someone
-- else (e.g. relayed by phone), which mirrors what the API allows.
create policy blockouts_write on public.blockouts
  for all using (
    public.is_org_member(organization_id)
    and (user_id = auth.uid() or public.can_manage_org(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and (user_id = auth.uid() or public.can_manage_org(organization_id))
  );

-- ================================================================= RPC =====

-- Creating an org and joining it as owner must be atomic, otherwise RLS would
-- lock the creator out of the row they just made.
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text default 'America/Toronto')
returns public.organizations
language plpgsql security definer set search_path = public as $$
declare
  org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, timezone)
  values (p_name, p_slug, p_timezone)
  returning * into org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (org.id, auth.uid(), 'owner', 'active');

  return org;
end;
$$;

-- Who is unavailable / already booked for a given window?
-- Used by the scheduler UI before it commits an assignment.
create or replace function public.scheduling_conflicts(
  p_organization_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_user_ids uuid[] default null
)
returns table (
  user_id uuid,
  conflict_type text,
  detail text,
  starts_at timestamptz,
  ends_at timestamptz,
  plan_id uuid
)
language sql stable security definer set search_path = public as $$
  with candidates as (
    select m.user_id
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.status = 'active'
      and (p_user_ids is null or m.user_id = any (p_user_ids))
  )
  select b.user_id,
         'blockout'::text,
         coalesce(b.reason, 'Unavailable'),
         b.starts_at,
         b.ends_at,
         null::uuid
  from public.blockouts b
  join candidates c on c.user_id = b.user_id
  where b.organization_id = p_organization_id
    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')

  union all

  select a.user_id,
         'double_booked'::text,
         p.title,
         pt.starts_at,
         pt.ends_at,
         p.id
  from public.assignments a
  join candidates c   on c.user_id = a.user_id
  join public.plans p on p.id = a.plan_id
  join public.plan_times pt on pt.plan_id = p.id and pt.kind = 'service'
  where p.organization_id = p_organization_id
    and a.status <> 'declined'
    and tstzrange(pt.starts_at, pt.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');
$$;

grant execute on function public.create_organization(text, text, text)                     to authenticated;
grant execute on function public.scheduling_conflicts(uuid, timestamptz, timestamptz, uuid[]) to authenticated;

-- ============================================================= storage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments',  'attachments',  false, 26214400, null),
  ('chord-sheets', 'chord-sheets', false, 26214400,
     array['image/png','image/jpeg','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

-- Objects are laid out as <bucket>/<organization_id>/<...>, so the first path
-- segment is the tenant key.
create policy "org members read attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('attachments', 'chord-sheets')
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org members write attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('attachments', 'chord-sheets')
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org managers delete attachments" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('attachments', 'chord-sheets')
    and public.can_manage_org(((storage.foldername(name))[1])::uuid)
  );
