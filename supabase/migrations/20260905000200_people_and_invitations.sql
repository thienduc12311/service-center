-- A "person" is a roster entry that can exist without a login. Adding one
-- records their profile up front; inviting them later (see
-- person_invitations below) is what links them to a real auth user.
create table public.people (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  profile_id        uuid references public.profiles (id) on delete set null,

  first_name        text not null check (length(trim(first_name)) > 0),
  last_name         text,
  avatar_url        text,

  email             text,
  phone             text,
  phone_carrier     text,

  address_line1     text,
  address_line2     text,
  city              text,
  state_province    text,
  postal_code       text,
  country           text,

  campus            text,
  person_type       text not null default 'adult' check (person_type in ('adult', 'child')),
  gender            text,
  birthdate         date,
  marital_status    text,
  anniversary_date  date,
  school            text,
  medical_note      text,

  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A given login is "the same person" at most once per organization.
create unique index people_org_profile_unique
  on public.people (organization_id, profile_id) where profile_id is not null;
create index people_organization_idx on public.people (organization_id);
create index people_profile_idx on public.people (profile_id);
create index people_org_email_idx on public.people (organization_id, lower(email));

create trigger set_updated_at before update on public.people
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- invitations ----
create table public.person_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  email            text not null,
  role             public.org_role not null default 'member' check (role <> 'owner'),
  -- Not an enum: sending is email-only for now, but the accept flow already
  -- treats "channel" as generic, so adding 'phone' later is a constraint
  -- change, not a type migration.
  channel          text not null default 'email' check (channel in ('email')),
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  constraint person_invitations_expiry_valid check (expires_at > created_at)
);
create index person_invitations_person_idx on public.person_invitations (person_id);
create index person_invitations_org_idx on public.person_invitations (organization_id);
-- At most one live invitation per person, so "resend" is unambiguous.
create unique index person_invitations_one_pending
  on public.person_invitations (person_id)
  where accepted_at is null and revoked_at is null;

alter table public.people enable row level security;
alter table public.person_invitations enable row level security;

-- Roster CRUD mirrors the existing org-scoped table pattern (teams/songs):
-- any member reads, scheduler+ manages. `medical_note` is redacted for
-- non-admins at the API layer, not via RLS.
create policy people_select on public.people
  for select using (public.is_org_member(organization_id));
create policy people_write on public.people
  for all using (public.can_manage_org(organization_id))
  with check (public.can_manage_org(organization_id));

-- Invitations are membership-adjacent (they grant a role on acceptance), so
-- admin-only, same tier as organization_members.
create policy person_invitations_select on public.person_invitations
  for select using (public.is_org_admin(organization_id));
create policy person_invitations_insert on public.person_invitations
  for insert with check (public.is_org_admin(organization_id));
create policy person_invitations_update on public.person_invitations
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
create policy person_invitations_delete on public.person_invitations
  for delete using (public.is_org_admin(organization_id));
-- No policy lets an unauthenticated caller read/accept by token — the
-- accept endpoint always uses the service-role client and treats token
-- possession itself as the authorization check, same as the existing
-- adminDb.auth.admin.* calls elsewhere in this codebase.

-- Atomically links a (new or pre-existing) auth user to the invited person,
-- grants org membership, and consumes the invitation. Called only by the
-- backend via the service-role client, after it has already created (or
-- located) the auth user through the GoTrue admin API — that step can't
-- happen inside Postgres, so this function covers everything that can.
create or replace function public.accept_person_invitation(
  p_token_hash text,
  p_new_user_id uuid
)
-- Output columns are prefixed to avoid shadowing `person_invitations`'
-- identically-named columns, which plpgsql cannot disambiguate — an
-- unprefixed `role`/`organization_id` OUT parameter makes every reference to
-- those columns in the function body ambiguous, even when table-qualified.
returns table (out_organization_id uuid, out_person_id uuid, out_role public.org_role)
language plpgsql security definer set search_path = public as $$
declare
  inv public.person_invitations;
begin
  select * into inv
  from public.person_invitations
  where token_hash = p_token_hash
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invitation not found or no longer valid' using errcode = 'P0001';
  end if;

  update public.people set profile_id = p_new_user_id where id = inv.person_id;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (inv.organization_id, p_new_user_id, inv.role, 'active')
  on conflict (organization_id, user_id) do update
    set role = excluded.role, status = 'active';

  update public.person_invitations set accepted_at = now() where id = inv.id;

  return query select inv.organization_id, inv.person_id, inv.role;
end;
$$;

-- Only the backend's service-role client calls this (see accept flow); it
-- trusts its caller entirely, unlike the RLS-gated tables above.
grant execute on function public.accept_person_invitation(text, uuid) to service_role;
