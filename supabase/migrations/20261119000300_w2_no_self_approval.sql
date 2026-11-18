-- QA wave 2 (W2-RESP-D2): leader approval is the independent second control on
-- signup claims, replacement offers and approved swaps, but the approval RPCs
-- only checked that the approver may schedule the team. A team leader who was
-- also the claimant / replacement candidate / swap participant could approve
-- their own request.
--
-- The rule is enforced on the rows themselves (BEFORE UPDATE), so every path
-- that records an approval -- `decide_signup_claim`, `act_on_replacement_offer`
-- and `act_on_approved_swap` today -- is covered. Errcode 42501 surfaces as
-- 403 through the API's error mapping. Rejecting, declining, cancelling and
-- consenting are unaffected (a beneficiary may always withdraw).

create or replace function private.is_person_of_user(p_person uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_person is not null and p_user is not null
     and exists (select 1 from public.people p where p.id = p_person and p.profile_id = p_user);
$$;
revoke execute on function private.is_person_of_user(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_person_of_user(uuid, uuid) to service_role;

create or replace function private.guard_claim_self_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'awaiting_approval' and new.status = 'confirmed'
     and private.is_person_of_user(new.person_id, coalesce(new.decided_by, (select auth.uid()))) then
    raise exception 'You cannot approve your own claim' using errcode = '42501', hint = 'self_approval';
  end if;
  return new;
end $$;
revoke execute on function private.guard_claim_self_approval() from public, anon, authenticated;
drop trigger if exists opportunity_claims_no_self_approval on public.opportunity_claims;
create trigger opportunity_claims_no_self_approval
  before update of status on public.opportunity_claims
  for each row execute function private.guard_claim_self_approval();

create or replace function private.guard_offer_self_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.leader_approved_at is not null and old.leader_approved_at is null
     and private.is_person_of_user(new.candidate_person_id, coalesce(new.leader_approved_by, (select auth.uid()))) then
    raise exception 'You cannot approve a replacement offered to you' using errcode = '42501', hint = 'self_approval';
  end if;
  return new;
end $$;
revoke execute on function private.guard_offer_self_approval() from public, anon, authenticated;
drop trigger if exists replacement_offers_no_self_approval on public.replacement_offers;
create trigger replacement_offers_no_self_approval
  before update of leader_approved_at, leader_approved_by on public.replacement_offers
  for each row execute function private.guard_offer_self_approval();

create or replace function private.guard_swap_self_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coalesce(new.leader_approved_by, (select auth.uid()));
begin
  if new.leader_approved_at is not null and old.leader_approved_at is null
     and (private.is_person_of_user(new.first_person_id, v_user)
          or private.is_person_of_user(new.second_person_id, v_user)) then
    raise exception 'You cannot approve a swap you are part of' using errcode = '42501', hint = 'self_approval';
  end if;
  return new;
end $$;
revoke execute on function private.guard_swap_self_approval() from public, anon, authenticated;
drop trigger if exists approved_swaps_no_self_approval on public.approved_swaps;
create trigger approved_swaps_no_self_approval
  before update of leader_approved_at, leader_approved_by on public.approved_swaps
  for each row execute function private.guard_swap_self_approval();
