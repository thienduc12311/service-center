-- QA wave 2 (W2-AVAIL-D3): availability access was granted to anyone holding
-- `scheduling.manage` at *any* scope, so a leader of one team could read every
-- member's blockouts (including private reasons) and edit them.
--
-- After this migration:
--   * Managing a Person's availability (blockouts, series, preferences,
--     reviews) is allowed to the Person, an owner/admin, an explicit
--     availability delegate, or someone who can schedule (F01 scope) on a team
--     the Person belongs to.
--   * Reading the raw rows (which carry the private reason) is reserved to the
--     Person, an owner/admin and an availability delegate. Team leaders read
--     their members' blockouts through `list_blockouts`, which redacts the
--     reason, and change them through the security-definer RPCs below.
--   * Conflict checks are unaffected: they already run as security definer
--     and never return reasons.

-- ------------------------------------------------------------- helpers ---

-- Someone can schedule on at least one team the Person belongs to.
create or replace function private.can_schedule_person(p_user uuid, p_org uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1
      from public.team_memberships tm
      join public.teams t on t.id = tm.team_id and t.organization_id = p_org
      join public.people p on p.id = tm.person_id and p.organization_id = p_org and p.archived_at is null
     where tm.person_id = p_person
       and private.capability_for(p_user, p_org, 'scheduling.manage', t.service_type_id, t.id)
  );
$$;
revoke execute on function private.can_schedule_person(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_schedule_person(uuid, uuid, uuid) to authenticated, service_role;

-- Who may read a blockout's private reason: self, owner/admin, delegate.
create or replace function private.can_read_blockout_reason(p_org uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_org_member(p_org) and (
    exists (select 1 from public.people p where p.id = p_person and p.organization_id = p_org
             and p.profile_id = (select auth.uid()))
    or public.is_org_admin(p_org)
    or private.delegation_allows((select auth.uid()), p_person, 'availability')
  );
$$;
revoke execute on function private.can_read_blockout_reason(uuid, uuid) from public, anon;
grant execute on function private.can_read_blockout_reason(uuid, uuid) to authenticated, service_role;

-- Same name and signature, so every existing policy and RPC picks up the
-- narrowed rule.
create or replace function private.can_manage_blockout(p_org uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_read_blockout_reason(p_org, p_person)
    or (public.is_org_member(p_org)
        and private.can_schedule_person((select auth.uid()), p_org, p_person));
$$;

-- ------------------------------------------------------------- policies ---

drop policy if exists blockouts_select on public.blockouts;
create policy blockouts_select on public.blockouts for select to authenticated using (
  private.can_read_blockout_reason(organization_id, person_id)
);
drop policy if exists blockout_series_select on public.blockout_series;
create policy blockout_series_select on public.blockout_series for select to authenticated using (
  private.can_read_blockout_reason(organization_id, person_id)
);

-- ------------------------------------------------------------------ RPCs ---

-- Blockouts the caller may manage; the reason is withheld unless the caller
-- may read it.
create or replace function public.list_blockouts(
  p_organization_id uuid,
  p_person_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns setof public.blockouts
language sql stable security definer set search_path = '' as $$
  select (jsonb_populate_record(
            null::public.blockouts,
            case when private.can_read_blockout_reason(b.organization_id, b.person_id)
                 then to_jsonb(b) else to_jsonb(b) || '{"reason": null}'::jsonb end
         )).*
    from public.blockouts b
   where (select auth.uid()) is not null
     and b.organization_id = p_organization_id
     and (p_person_id is null or b.person_id = p_person_id)
     and (p_from is null or b.ends_at > p_from)
     and (p_to is null or b.starts_at < p_to)
     and private.can_manage_blockout(b.organization_id, b.person_id)
   order by b.starts_at;
$$;
revoke execute on function public.list_blockouts(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_blockouts(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Was security invoker; with reasons hidden from team leaders the row is no
-- longer selectable for them, so the access check moves inside.
create or replace function public.update_blockout(
  p_blockout_id uuid, p_expected_revision bigint, p_payload jsonb
)
returns public.blockouts language plpgsql security definer set search_path = '' as $$
declare v_row public.blockouts;
begin
  select * into v_row from public.blockouts where id = p_blockout_id and series_id is null for update;
  if not found or (select auth.uid()) is null
     or not private.can_manage_blockout(v_row.organization_id, v_row.person_id) then
    raise exception 'Blockout not found' using errcode = 'P0002';
  end if;
  if v_row.revision <> p_expected_revision then raise exception 'This blockout changed; refresh and try again' using errcode = 'PT409'; end if;
  update public.blockouts set starts_at = (p_payload->>'starts_at')::timestamptz,
    ends_at = (p_payload->>'ends_at')::timestamptz, reason = p_payload->>'reason',
    timezone = p_payload->>'timezone', all_day = (p_payload->>'all_day')::boolean,
    local_start_date = (p_payload->>'local_start_date')::date,
    local_start_time = (p_payload->>'local_start_time')::time,
    local_end_date = (p_payload->>'local_end_date')::date,
    local_end_time = (p_payload->>'local_end_time')::time
   where id = p_blockout_id returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.update_blockout(uuid, bigint, jsonb) from public, anon;
grant execute on function public.update_blockout(uuid, bigint, jsonb) to authenticated;

-- Deletes a one-off blockout the caller may manage. Returns the id, or null
-- when the row is absent, foreign, part of a series or at another revision.
create or replace function public.delete_blockout(p_blockout_id uuid, p_expected_revision bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_row public.blockouts;
begin
  select * into v_row from public.blockouts where id = p_blockout_id and series_id is null for update;
  if not found or (select auth.uid()) is null
     or not private.can_manage_blockout(v_row.organization_id, v_row.person_id)
     or (p_expected_revision is not null and v_row.revision <> p_expected_revision) then
    return null;
  end if;
  delete from public.blockouts where id = p_blockout_id;
  return p_blockout_id;
end $$;
revoke execute on function public.delete_blockout(uuid, bigint) from public, anon;
grant execute on function public.delete_blockout(uuid, bigint) to authenticated;

-- The API's own target check mirrors this rule so an out-of-scope Person is a
-- 404 before any read or write (the policies above still decide).
create or replace function public.can_manage_availability(p_organization_id uuid, p_person_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and private.can_manage_blockout(p_organization_id, p_person_id);
$$;
revoke execute on function public.can_manage_availability(uuid, uuid) from public, anon;
grant execute on function public.can_manage_availability(uuid, uuid) to authenticated;
