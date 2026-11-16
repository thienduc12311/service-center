-- ============================================================================
-- Join a church by its URL slug.
--
-- A signed-in person in no church types a church's slug (`organizations.slug`),
-- sees its name, and asks to join with an optional message. The church's
-- owners (the people who may send invitations today: `private.is_people_owner`,
-- see 20261109000000) approve or decline. Approving does NOT add a membership:
-- it picks or creates the church's roster person for the requester and the API
-- then sends the normal person invitation, which the requester accepts at
-- /accept-invite like anyone invited.
--
--   church_join_requests                   one row per request; one pending per
--                                          (church, requester)
--   find_church_by_slug(slug)              id and name of an active church
--   request_to_join_church(slug, message)  the only way to insert a request
--   my_church_join_requests(id)            the requester's requests, with the
--                                          church name they can't otherwise read
--   approve_church_join_request(id)        owner: roster person + approved
--   record_church_join_request_invitation  owner: the invitation the API sent
--   decline_church_join_request(id, why)   owner
--
-- Where approval is atomic. approve_church_join_request() locks the request,
-- checks the owner, chooses or creates the roster person and marks the request
-- approved in one transaction. The invitation itself is created by the
-- existing API invitation code (the raw token never reaches the database),
-- which reuses a live invitation to the same address instead of sending a
-- second one; record_church_join_request_invitation() then stores its id. A
-- retry after a failure between the two steps finds the request approved with
-- no invitation and sends it then; once an invitation is recorded, approving
-- again changes nothing and sends nothing.
--
-- Refusals use the same message for an unknown and a disabled church so a slug
-- can't be probed for a disabled status.
-- ============================================================================

create type public.church_join_request_status as enum ('pending', 'approved', 'declined', 'withdrawn');

create table public.church_join_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  requester_id     uuid not null references public.profiles (id) on delete cascade,
  status           public.church_join_request_status not null default 'pending',
  message          text check (message is null or char_length(btrim(message)) between 1 and 500),
  -- What the requester shared with the church when asking: owners can't read
  -- the profile of someone who isn't a member yet.
  requester_name   text check (requester_name is null or char_length(requester_name) <= 200),
  requester_email  text not null check (char_length(requester_email) between 3 and 320),
  decline_reason   text check (decline_reason is null or char_length(btrim(decline_reason)) between 1 and 500),
  -- Set on approval: the roster person invited, and the invitation sent.
  person_id        uuid references public.people (id) on delete set null,
  invitation_id    uuid references public.person_invitations (id) on delete set null,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint church_join_requests_decision_shape check (
    (status in ('approved', 'declined')) = (decided_at is not null)
  ),
  constraint church_join_requests_decline_shape check (
    decline_reason is null or status = 'declined'
  )
);
comment on table public.church_join_requests is
  'A signed-in person asks to join a church by its slug. An owner approves (a roster person is chosen or created and the normal invitation is sent) or declines.';

-- One open request per person and church.
create unique index church_join_requests_one_pending
  on public.church_join_requests (organization_id, requester_id) where status = 'pending';
-- The requester's list and the rate limit.
create index church_join_requests_requester_idx
  on public.church_join_requests (requester_id, created_at desc);
-- The owners' queue: pending first, then recent decisions.
create index church_join_requests_queue_idx
  on public.church_join_requests (organization_id, status, created_at desc);
create index church_join_requests_person_idx
  on public.church_join_requests (person_id) where person_id is not null;
create index church_join_requests_invitation_idx
  on public.church_join_requests (invitation_id) where invitation_id is not null;
create index church_join_requests_decided_by_idx
  on public.church_join_requests (decided_by) where decided_by is not null;

create trigger church_join_requests_updated_at before update on public.church_join_requests
  for each row execute function public.set_updated_at();

-- Asking, withdrawing and asking again in a loop would fill owners' queues.
create or replace function private.limit_church_join_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.church_join_requests r
       where r.requester_id = new.requester_id and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have sent several join requests today; try again tomorrow'
      using errcode = 'PT429', hint = 'rate_limited';
  end if;
  return new;
end;
$$;
revoke execute on function private.limit_church_join_requests() from public, anon, authenticated;
create trigger church_join_requests_limit before insert on public.church_join_requests
  for each row execute function private.limit_church_join_requests();

-- ------------------------------------------------------------------- RLS ----

alter table public.church_join_requests enable row level security;

create policy church_join_requests_requester_select on public.church_join_requests
  for select to authenticated using (requester_id = (select auth.uid()));
-- The people who may invite to the church are the ones who see who asks.
create policy church_join_requests_owner_select on public.church_join_requests
  for select to authenticated using (private.is_people_owner(organization_id));
-- The requester withdraws a pending request; nothing else changes it directly.
create policy church_join_requests_requester_withdraw on public.church_join_requests
  for update to authenticated
  using (requester_id = (select auth.uid()) and status = 'pending')
  with check (requester_id = (select auth.uid()) and status = 'withdrawn');
-- No insert or delete policy: requests are created by request_to_join_church().

revoke all on public.church_join_requests from anon, authenticated;
-- decided_by is not readable: the requester doesn't learn which owner decided.
grant select (id, organization_id, requester_id, status, message, requester_name, requester_email,
              decline_reason, person_id, invitation_id, decided_at, created_at, updated_at)
  on public.church_join_requests to authenticated;
grant update (status) on public.church_join_requests to authenticated;
grant select, insert, update on public.church_join_requests to service_role;

-- ------------------------------------------------------------- lookup -------

-- An active church by slug, for a signed-in caller: id and name only.
create or replace function public.find_church_by_slug(p_slug text)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name
    from public.organizations o
    join public.organization_platform_controls c on c.organization_id = o.id
   where (select auth.uid()) is not null
     and o.slug = lower(btrim(p_slug))
     and c.status = 'active';
$$;
revoke execute on function public.find_church_by_slug(text) from public, anon;
grant execute on function public.find_church_by_slug(text) to authenticated;

-- --------------------------------------------------------------- request ----

create or replace function public.request_to_join_church(p_slug text, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_org      uuid;
  v_profile  public.profiles;
  v_message  text := nullif(btrim(coalesce(p_message, '')), '');
  v_id       uuid;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select o.id into v_org
    from public.organizations o
    join public.organization_platform_controls c on c.organization_id = o.id
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and c.status = 'active';
  if v_org is null then
    -- Same answer for unknown and disabled churches.
    raise exception 'No church uses that address' using errcode = 'P0002', hint = 'church_not_found';
  end if;

  if exists (select 1 from public.organization_members m
              where m.organization_id = v_org and m.user_id = v_user) then
    raise exception 'You are already part of this church'
      using errcode = 'PT409', hint = 'already_church_member';
  end if;

  if exists (select 1 from public.church_join_requests r
              where r.organization_id = v_org and r.requester_id = v_user and r.status = 'pending') then
    raise exception 'You already asked to join this church'
      using errcode = 'PT409', hint = 'join_request_pending';
  end if;

  if v_message is not null and char_length(v_message) > 500 then
    raise exception 'Keep the message to 500 characters' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = v_user;
  if v_profile.id is null or nullif(btrim(coalesce(v_profile.email, '')), '') is null then
    raise exception 'Your account needs an email address to be invited' using errcode = '22023';
  end if;

  begin
    insert into public.church_join_requests (organization_id, requester_id, message, requester_name, requester_email)
    values (v_org, v_user, v_message, nullif(btrim(coalesce(v_profile.full_name, '')), ''), btrim(v_profile.email))
    returning id into v_id;
  exception when unique_violation then
    -- A concurrent request for the same church won.
    raise exception 'You already asked to join this church'
      using errcode = 'PT409', hint = 'join_request_pending';
  end;
  return v_id;
end;
$$;
revoke execute on function public.request_to_join_church(text, text) from public, anon;
grant execute on function public.request_to_join_church(text, text) to authenticated;

-- The caller's own requests, newest first, with the church's name (the
-- requester isn't a member, so organizations RLS hides it). One when p_id is set.
create or replace function public.my_church_join_requests(p_id uuid default null)
returns table (
  id                 uuid,
  organization_id    uuid,
  organization_name  text,
  organization_slug  text,
  status             public.church_join_request_status,
  message            text,
  decline_reason     text,
  decided_at         timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.organization_id, o.name, o.slug, r.status, r.message, r.decline_reason,
         r.decided_at, r.created_at, r.updated_at
    from public.church_join_requests r
    join public.organizations o on o.id = r.organization_id
   where r.requester_id = (select auth.uid())
     and (p_id is null or r.id = p_id)
   order by r.created_at desc;
$$;
revoke execute on function public.my_church_join_requests(uuid) from public, anon;
grant execute on function public.my_church_join_requests(uuid) to authenticated;

-- ------------------------------------------------------------- decisions ----

-- Owner only. Picks the roster person to invite, in this order:
--   1. the person already linked to the requester's login here (a former
--      member; restored if archived),
--   2. the oldest unlinked, not archived person with the requester's email,
--   3. a new person named from the profile.
-- Then marks the request approved. Returns what the API needs to send the
-- invitation; out_newly_approved is false when it was already approved.
create or replace function public.approve_church_join_request(p_request uuid)
returns table (
  out_request_id          uuid,
  out_organization_id     uuid,
  out_person_id           uuid,
  out_invitation_id       uuid,
  out_email               text,
  out_first_name          text,
  out_last_name           text,
  out_preferred_language  text,
  out_newly_approved      boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_request  public.church_join_requests;
  v_profile  public.profiles;
  v_email    text;
  v_name     text;
  v_person   public.people;
  v_newly    boolean := false;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_request from public.church_join_requests where id = p_request for update;
  if not found or not private.is_people_owner(v_request.organization_id) then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;

  if v_request.status = 'pending' then
    if exists (select 1 from public.organization_members m
                where m.organization_id = v_request.organization_id
                  and m.user_id = v_request.requester_id and m.status = 'active') then
      raise exception 'This person is already part of the church'
        using errcode = 'PT409', hint = 'already_church_member';
    end if;

    select * into v_profile from public.profiles where id = v_request.requester_id;
    v_email := coalesce(nullif(btrim(coalesce(v_profile.email, '')), ''), v_request.requester_email);
    v_name := coalesce(nullif(btrim(coalesce(v_profile.full_name, '')), ''), v_request.requester_name,
                       split_part(v_email, '@', 1));

    -- Same lock as accept_person_invitation: one link decision at a time per
    -- login and church.
    perform pg_advisory_xact_lock(hashtextextended(
      'person-link:' || v_request.organization_id::text || ':' || v_request.requester_id::text, 0));

    select * into v_person from public.people
     where organization_id = v_request.organization_id and profile_id = v_request.requester_id
     for update;
    if found then
      if v_person.archived_at is not null then
        update public.people set archived_at = null where id = v_person.id;
      end if;
    else
      select * into v_person from public.people
       where organization_id = v_request.organization_id and profile_id is null and archived_at is null
         and lower(btrim(email)) = lower(v_email)
       order by created_at, id
       limit 1
       for update;
      if not found then
        insert into public.people (organization_id, first_name, last_name, email, created_by)
        values (
          v_request.organization_id,
          coalesce(nullif(split_part(btrim(v_name), ' ', 1), ''), 'Person'),
          case when position(' ' in btrim(v_name)) > 0
               then nullif(btrim(substring(btrim(v_name) from position(' ' in btrim(v_name)) + 1)), '') end,
          v_email,
          v_user
        )
        returning * into v_person;
      end if;
    end if;

    update public.church_join_requests
       set status = 'approved', person_id = v_person.id, decided_by = v_user, decided_at = now()
     where id = v_request.id
    returning * into v_request;
    v_newly := true;
  elsif v_request.status = 'approved' then
    select * into v_person from public.people where id = v_request.person_id;
    select * into v_profile from public.profiles where id = v_request.requester_id;
    v_email := coalesce(nullif(btrim(coalesce(v_profile.email, '')), ''), v_request.requester_email);
  else
    raise exception 'This request was already declined or withdrawn'
      using errcode = 'PT409', hint = 'join_request_not_pending';
  end if;

  if v_person.id is null then
    -- The roster person was deleted after approval; nothing left to invite.
    raise exception 'This request was already decided' using errcode = 'PT409', hint = 'join_request_not_pending';
  end if;

  return query select v_request.id, v_request.organization_id, v_person.id, v_request.invitation_id,
                      v_email, v_person.first_name, v_person.last_name, v_person.preferred_language, v_newly;
end;
$$;
revoke execute on function public.approve_church_join_request(uuid) from public, anon;
grant execute on function public.approve_church_join_request(uuid) to authenticated;

-- Owner only: records the invitation the API sent for an approved request.
-- The invitation must be for the request's person in the same church. Keeps
-- an invitation already recorded (a retry never replaces it).
create or replace function public.record_church_join_request_invitation(p_request uuid, p_invitation uuid)
returns public.church_join_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.church_join_requests;
begin
  select * into v_request from public.church_join_requests where id = p_request for update;
  if not found or not private.is_people_owner(v_request.organization_id) then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'This request is not approved' using errcode = 'PT409', hint = 'join_request_not_pending';
  end if;
  if not exists (select 1 from public.person_invitations i
                  where i.id = p_invitation and i.organization_id = v_request.organization_id
                    and i.person_id = v_request.person_id) then
    raise exception 'That invitation is not for this request' using errcode = '22023';
  end if;
  if v_request.invitation_id is null then
    update public.church_join_requests set invitation_id = p_invitation where id = v_request.id
    returning * into v_request;
  end if;
  return v_request;
end;
$$;
revoke execute on function public.record_church_join_request_invitation(uuid, uuid) from public, anon;
grant execute on function public.record_church_join_request_invitation(uuid, uuid) to authenticated;

-- Owner only. Declining again returns the request unchanged.
create or replace function public.decline_church_join_request(p_request uuid, p_reason text default null)
returns public.church_join_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_request public.church_join_requests;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_request from public.church_join_requests where id = p_request for update;
  if not found or not private.is_people_owner(v_request.organization_id) then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;
  if v_request.status = 'declined' then
    return v_request;
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request was already decided or withdrawn'
      using errcode = 'PT409', hint = 'join_request_not_pending';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters' using errcode = '22023';
  end if;
  update public.church_join_requests
     set status = 'declined', decline_reason = v_reason, decided_by = v_user, decided_at = now()
   where id = v_request.id
  returning * into v_request;
  return v_request;
end;
$$;
revoke execute on function public.decline_church_join_request(uuid, text) from public, anon;
grant execute on function public.decline_church_join_request(uuid, text) to authenticated;
