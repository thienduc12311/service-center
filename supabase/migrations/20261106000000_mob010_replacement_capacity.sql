-- MOB-010 Pass B (shared F07 fix): replacement capacity holds against every
-- competing path.
--
-- Found while tracing the native replacement flow. Under F07 as shipped:
--   * a manual fill (or any other assignment writer) only checked capacity
--     when the position had an open signup opening, so it was accepted while
--     a replacement candidate held a live consent reservation; and
--   * finalization (consent + leader approval) never rechecked capacity, so
--     the leader's approval then confirmed a second person for one place.
-- Both now use the same occupancy (`private.f07_occupied`) and per-plan need
-- (`plan_position_needs.needed`, 1 when unset — the value the consent step
-- already uses) under the existing plan/position advisory lock. Nothing
-- changes when no replacement reservation is live. Function bodies are
-- replaced in place; no table, policy or grant changes.

create or replace function private.f07_finalize_offer(p_offer uuid)
returns public.replacement_offers language plpgsql security definer set search_path = '' as $$
declare f public.replacement_offers; r public.replacement_requests; a public.assignments; v_occupied integer;
begin
  select * into f from public.replacement_offers where id=p_offer for update; select * into r from public.replacement_requests where id=f.request_id for update;
  if f.consented_at is null or f.leader_approved_at is null or r.status<>'open' or f.status not in ('pending','accepted_awaiting_approval') then return f; end if;
  if r.expires_at<=statement_timestamp() or not private.f07_is_eligible(f.candidate_person_id,r.team_id,r.position_id)
     or private.f07_has_conflict(r.organization_id,f.candidate_person_id,r.plan_id,r.team_id,r.position_id,r.applicable_time_ids,array[r.original_assignment_id]) then raise exception 'The replacement is no longer eligible' using errcode='PT409'; end if;
  -- Everyone else holding this place, not counting this offer's own live hold.
  v_occupied := private.f07_occupied(r.plan_id,r.position_id,r.applicable_time_ids,r.original_assignment_id)
    - case when f.status='accepted_awaiting_approval' and f.reservation_expires_at>statement_timestamp() then 1 else 0 end;
  if v_occupied >= coalesce((select needed from public.plan_position_needs where plan_id=r.plan_id and position_id=r.position_id),1) then
    raise exception 'This vacancy is already filled' using errcode='PT409',hint='capacity_full';
  end if;
  update public.replacement_offers set status='finalized',reservation_expires_at=null,version=version+1 where id=f.id returning * into f;
  insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
  select r.plan_id,f.candidate_person_id,p.profile_id,r.team_id,r.position_id,'confirmed',(select auth.uid()),'released',statement_timestamp(),case when cardinality(r.applicable_time_ids)=0 then 'all' else 'selected' end from public.people p where p.id=f.candidate_person_id returning * into a;
  insert into public.assignment_attendance_times select a.id,x from unnest(r.applicable_time_ids)x;
  update public.replacement_offers set assignment_id=a.id where id=f.id returning * into f;
  update public.replacement_requests set status='filled',filled_assignment_id=a.id,version=version+1 where id=r.id;
  update public.replacement_offers set status='superseded',reservation_expires_at=null,version=version+1 where request_id=r.id and id<>f.id and status in ('pending','accepted_awaiting_approval');
  return f;
end $$;
revoke execute on function private.f07_finalize_offer(uuid) from public,anon,authenticated;

create or replace function private.f07_enforce_assignment_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.signup_opportunities; v_times uuid[]; v_occupied integer; v_assignment public.assignments; v_id uuid;
begin
  if tg_table_name='assignments' then
    v_id := new.id;
  elsif tg_op='DELETE' then
    v_id := old.assignment_id;
  else
    v_id := new.assignment_id;
  end if;
  select * into v_assignment from public.assignments where id=v_id;
  if v_assignment.id is null or v_assignment.position_id is null or v_assignment.status='declined' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  perform private.f07_lock_capacity(v_assignment.plan_id,v_assignment.position_id);
  perform private.f07_expire_reservations(v_assignment.plan_id,v_assignment.position_id);
  v_times := private.f07_assignment_time_ids(v_assignment.id);
  for o in select * from public.signup_opportunities x
    where x.plan_id=v_assignment.plan_id and x.position_id=v_assignment.position_id and x.state='open'
      and x.closes_at > statement_timestamp() and private.f07_scope_intersects(x.applicable_time_ids,v_times)
    order by x.id
  loop
    v_occupied := private.f07_occupied(o.plan_id,o.position_id,o.applicable_time_ids);
    if v_occupied > o.capacity then
      raise exception 'This opening no longer has capacity' using errcode='PT409', hint='capacity_full';
    end if;
  end loop;
  -- A replacement candidate who has consented holds the place until the leader
  -- decides or the hold lapses; no other writer may take it meanwhile.
  if exists (
    select 1 from public.replacement_offers f join public.replacement_requests r on r.id=f.request_id
     where r.plan_id=v_assignment.plan_id and r.position_id=v_assignment.position_id
       and f.status='accepted_awaiting_approval' and f.reservation_expires_at>statement_timestamp()
       and private.f07_scope_intersects(r.applicable_time_ids,v_times)
  ) then
    v_occupied := private.f07_occupied(v_assignment.plan_id,v_assignment.position_id,v_times);
    if v_occupied > coalesce((select needed from public.plan_position_needs where plan_id=v_assignment.plan_id and position_id=v_assignment.position_id),1) then
      raise exception 'A replacement is holding this place' using errcode='PT409', hint='capacity_full';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke execute on function private.f07_enforce_assignment_capacity() from public,anon,authenticated;
