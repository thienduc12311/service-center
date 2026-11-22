-- SEC-012: an approved-swap idempotency key replays only the swap it created.
--
-- create_approved_swap (20261023000000) replayed by (organization_id,
-- idempotency_key) alone, both in its early lookup and through
-- `on conflict ... do update ... returning *`. A caller who reused another
-- member's key (for a different pair of assignments) got that member's swap
-- row back, and a concurrent duplicate wrote a second 'pending' allocation
-- event. The sibling functions already scope their keys to the caller.
--
-- A stored swap is now returned only for the same pair of assignments (the
-- caller has already been checked to be one of its two participants); a key
-- reused for a different pair is refused with PT409. A concurrent duplicate
-- returns the winner's row without another event. Body otherwise unchanged.

create or replace function public.create_approved_swap(
  p_first uuid, p_second uuid, p_first_revision bigint, p_second_revision bigint,
  p_expires_at timestamptz, p_idempotency_key text)
returns public.approved_swaps
language plpgsql
security definer
set search_path = ''
as $$
declare a public.assignments; b public.assignments; s public.approved_swaps; v_org uuid; v_person uuid;
begin
  select * into a from public.assignments where id=p_first; select * into b from public.assignments where id=p_second;
  select organization_id into v_org from public.plans where id=a.plan_id; v_person:=private.current_person(v_org);
  if a.id is null or b.id is null or a.person_id=b.person_id
    or not (v_person is not distinct from a.person_id or v_person is not distinct from b.person_id)
    or not exists(select 1 from public.plans p where p.id=b.plan_id and p.organization_id=v_org) then raise exception 'These assignments cannot be swapped' using errcode='PT409'; end if;
  select * into s from public.approved_swaps where organization_id=v_org and idempotency_key=p_idempotency_key;
  if s.id is not null then
    if s.first_assignment_id<>a.id or s.second_assignment_id<>b.id then
      raise exception 'That request key was already used for a different swap' using errcode='PT409';
    end if;
    return s;
  end if;
  if a.status<>'confirmed' or b.status<>'confirmed' or a.request_revision<>p_first_revision or b.request_revision<>p_second_revision
     or p_expires_at<=statement_timestamp() then raise exception 'These assignments cannot be swapped' using errcode='PT409'; end if;
  insert into public.approved_swaps(organization_id,first_assignment_id,second_assignment_id,first_person_id,second_person_id,first_revision,second_revision,first_consented_at,second_consented_at,expires_at,idempotency_key,created_by)
  values(v_org,a.id,b.id,a.person_id,b.person_id,p_first_revision,p_second_revision,case when v_person=a.person_id then statement_timestamp() end,case when v_person=b.person_id then statement_timestamp() end,p_expires_at,p_idempotency_key,(select auth.uid()))
  on conflict(organization_id,idempotency_key) do nothing returning * into s;
  if s.id is null then
    -- A concurrent call with the same key won; replay it under the same rule.
    select * into s from public.approved_swaps where organization_id=v_org and idempotency_key=p_idempotency_key;
    if s.first_assignment_id<>a.id or s.second_assignment_id<>b.id then
      raise exception 'That request key was already used for a different swap' using errcode='PT409';
    end if;
    return s;
  end if;
  insert into public.allocation_events(organization_id,aggregate_type,aggregate_id,transition,actor_id) values(v_org,'swap',s.id,'pending',(select auth.uid()));
  return s;
end $$;
revoke execute on function public.create_approved_swap(uuid,uuid,bigint,bigint,timestamptz,text) from public, anon;
grant execute on function public.create_approved_swap(uuid,uuid,bigint,bigint,timestamptz,text) to authenticated;
