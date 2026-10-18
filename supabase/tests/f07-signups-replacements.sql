-- F07: signup, replacement, swap, RLS and history behavior.
-- Run against a seeded local database. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/f07-signups-replacements.sql
begin;

create temporary table f07_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on f07_fx to authenticated, service_role;

insert into f07_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('electric', 'dddddddd-0000-4000-8000-000000000003'),
  ('drums', 'dddddddd-0000-4000-8000-000000000005'),
  ('sam', (select id from public.people where profile_id='33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id='44444444-4444-4444-8444-444444444444')),
  ('replacement_plan', gen_random_uuid()), ('replacement_original', gen_random_uuid()),
  ('signup_plan', gen_random_uuid()), ('opportunity', gen_random_uuid()), ('expired_claim', gen_random_uuid()),
  ('swap_plan_a', gen_random_uuid()), ('swap_plan_b', gen_random_uuid()),
  ('swap_a', gen_random_uuid()), ('swap_b', gen_random_uuid()),
  ('stale_plan_a', gen_random_uuid()), ('stale_plan_b', gen_random_uuid()),
  ('stale_a', gen_random_uuid()), ('stale_b', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from f07_fx where k=p $$;

-- Both participants are eligible for both target positions used by the
-- replacement/swap fixtures. Existing memberships are retained.
insert into public.team_memberships(team_id,user_id,person_id,position_id)
values
  (pg_temp.fx('band'),'44444444-4444-4444-8444-444444444444',pg_temp.fx('riley'),pg_temp.fx('electric')),
  (pg_temp.fx('band'),'33333333-3333-4333-8333-333333333333',pg_temp.fx('sam'),pg_temp.fx('drums'))
on conflict do nothing;

insert into public.plans(id,organization_id,service_type_id,title,service_date,status,created_by)
values
  (pg_temp.fx('replacement_plan'),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','F07 replacement',now()+interval '400 days','published','22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('signup_plan'),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','F07 signup',now()+interval '410 days','published','22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('swap_plan_a'),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','F07 swap A',now()+interval '420 days','published','22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('swap_plan_b'),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','F07 swap B',now()+interval '421 days','published','22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('stale_plan_a'),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','F07 stale swap A',now()+interval '430 days','published','22222222-2222-4222-8222-222222222222'),
  (pg_temp.fx('stale_plan_b'),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','F07 stale swap B',now()+interval '431 days','published','22222222-2222-4222-8222-222222222222');

insert into public.plan_position_needs(plan_id,position_id,needed) values
  (pg_temp.fx('replacement_plan'),pg_temp.fx('electric'),1),
  (pg_temp.fx('signup_plan'),pg_temp.fx('electric'),1),
  (pg_temp.fx('swap_plan_a'),pg_temp.fx('electric'),1),
  (pg_temp.fx('swap_plan_b'),pg_temp.fx('drums'),1),
  (pg_temp.fx('stale_plan_a'),pg_temp.fx('electric'),1),
  (pg_temp.fx('stale_plan_b'),pg_temp.fx('drums'),1);

insert into public.assignments(id,plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
values
  (pg_temp.fx('replacement_original'),pg_temp.fx('replacement_plan'),pg_temp.fx('sam'),'33333333-3333-4333-8333-333333333333',pg_temp.fx('band'),pg_temp.fx('electric'),'declined','22222222-2222-4222-8222-222222222222','released',now(),'all'),
  (pg_temp.fx('swap_a'),pg_temp.fx('swap_plan_a'),pg_temp.fx('sam'),'33333333-3333-4333-8333-333333333333',pg_temp.fx('band'),pg_temp.fx('electric'),'confirmed','22222222-2222-4222-8222-222222222222','released',now(),'all'),
  (pg_temp.fx('swap_b'),pg_temp.fx('swap_plan_b'),pg_temp.fx('riley'),'44444444-4444-4444-8444-444444444444',pg_temp.fx('band'),pg_temp.fx('drums'),'confirmed','22222222-2222-4222-8222-222222222222','released',now(),'all'),
  (pg_temp.fx('stale_a'),pg_temp.fx('stale_plan_a'),pg_temp.fx('sam'),'33333333-3333-4333-8333-333333333333',pg_temp.fx('band'),pg_temp.fx('electric'),'confirmed','22222222-2222-4222-8222-222222222222','released',now(),'all'),
  (pg_temp.fx('stale_b'),pg_temp.fx('stale_plan_b'),pg_temp.fx('riley'),'44444444-4444-4444-8444-444444444444',pg_temp.fx('band'),pg_temp.fx('drums'),'confirmed','22222222-2222-4222-8222-222222222222','released',now(),'all');

insert into public.signup_opportunities(id,organization_id,plan_id,team_id,position_id,capacity,approval_policy,closes_at,created_by)
values(pg_temp.fx('opportunity'),pg_temp.fx('org'),pg_temp.fx('signup_plan'),pg_temp.fx('band'),pg_temp.fx('electric'),1,'leader_approval',now()+interval '30 days','22222222-2222-4222-8222-222222222222');
insert into public.opportunity_claims(id,opportunity_id,person_id,status,opportunity_version,idempotency_key,reservation_expires_at)
values(pg_temp.fx('expired_claim'),pg_temp.fx('opportunity'),pg_temp.fx('riley'),'awaiting_approval',1,'f07-expired-claim',now()-interval '1 minute');

set local role authenticated;
set local request.jwt.claim.sub='99999999-9999-4999-8999-999999999999';
do $$
begin
  perform public.create_replacement_request(pg_temp.fx('replacement_original'),0,'f07-unlinked-request',now()+interval '7 days');
  raise exception 'an unlinked profile created another Person''s replacement request';
exception when sqlstate '42501' then null;
end $$;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';

insert into f07_fx
select 'request',id from public.create_replacement_request(pg_temp.fx('replacement_original'),0,'f07-replacement-request',now()+interval '7 days');

-- A member sees only their own claim, not another member's candidate details.
insert into f07_fx
select 'claim',id from public.claim_signup_opportunity(pg_temp.fx('opportunity'),1,'f07-signup-claim');
do $$
begin
  if (select status from public.opportunity_claims where id=pg_temp.fx('expired_claim'))<>'expired' then
    raise exception 'due reservation did not release before allocation';
  end if;
end $$;

set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into f07_fx
select 'offer',id from public.issue_replacement_offer(pg_temp.fx('request'),pg_temp.fx('riley'),1,'f07-replacement-offer');
select public.decide_signup_claim(pg_temp.fx('claim'),1,'approve');

set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.act_on_replacement_offer(pg_temp.fx('offer'),1,'accept');

set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.act_on_replacement_offer(pg_temp.fx('offer'),2,'approve');

do $$
begin
  if (public.issue_replacement_offer(pg_temp.fx('request'),pg_temp.fx('riley'),1,'f07-replacement-offer')).id<>pg_temp.fx('offer') then
    raise exception 'replacement offer retry did not return the original row';
  end if;
end $$;

do $$
begin
  if (select status from public.replacement_requests where id=pg_temp.fx('request')) <> 'filled' then
    raise exception 'replacement request did not fill';
  end if;
  if (select status from public.assignments where id=pg_temp.fx('replacement_original')) <> 'declined' then
    raise exception 'replacement overwrote the original decline';
  end if;
  if not exists(select 1 from public.assignments where plan_id=pg_temp.fx('replacement_plan') and person_id=pg_temp.fx('riley') and status='confirmed') then
    raise exception 'replacement assignment was not confirmed';
  end if;
  if (select count(*) from public.assignments where plan_id=pg_temp.fx('signup_plan') and position_id=pg_temp.fx('electric') and status<>'declined') <> 1 then
    raise exception 'approved signup did not create exactly one commitment';
  end if;
end $$;

set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$
begin
  if (public.claim_signup_opportunity(pg_temp.fx('opportunity'),1,'f07-signup-claim')).id<>pg_temp.fx('claim') then
    raise exception 'confirmed claim retry did not return the original row';
  end if;
end $$;
do $$
begin
  perform public.create_replacement_request(pg_temp.fx('replacement_original'),0,'f07-second-filled-request',now()+interval '7 days');
  raise exception 'a filled vacancy accepted a second request';
exception when sqlstate 'PT409' then null;
end $$;

-- Leader approval before the second participant's consent must still finalize
-- atomically when the final required action arrives.
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into f07_fx
select 'swap',id from public.create_approved_swap(pg_temp.fx('swap_a'),pg_temp.fx('swap_b'),0,0,now()+interval '7 days','f07-approved-swap');

set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.act_on_approved_swap(pg_temp.fx('swap'),1,'approve');

set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.act_on_approved_swap(pg_temp.fx('swap'),2,'consent');

do $$
begin
  if (public.create_approved_swap(pg_temp.fx('swap_a'),pg_temp.fx('swap_b'),0,0,now()+interval '7 days','f07-approved-swap')).id<>pg_temp.fx('swap') then
    raise exception 'finalized swap retry did not return the original row';
  end if;
end $$;

do $$
begin
  if (select status from public.approved_swaps where id=pg_temp.fx('swap')) <> 'finalized' then
    raise exception 'approved swap did not finalize';
  end if;
  if exists(select 1 from public.assignments where id in(pg_temp.fx('swap_a'),pg_temp.fx('swap_b')) and status<>'declined') then
    raise exception 'swap originals were not preserved as declined records';
  end if;
  if (select count(*) from public.assignments where id in(
        (select first_new_assignment_id from public.approved_swaps where id=pg_temp.fx('swap')),
        (select second_new_assignment_id from public.approved_swaps where id=pg_temp.fx('swap'))
      ) and status='confirmed') <> 2 then
    raise exception 'swap did not create both new confirmed assignments';
  end if;
end $$;

-- A revision change on the second side rolls the whole final action back.
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into f07_fx
select 'stale_swap',id from public.create_approved_swap(pg_temp.fx('stale_a'),pg_temp.fx('stale_b'),0,0,now()+interval '7 days','f07-stale-swap');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.act_on_approved_swap(pg_temp.fx('stale_swap'),1,'approve');
update public.assignments set request_revision=1 where id=pg_temp.fx('stale_b');
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$
begin
  perform public.act_on_approved_swap(pg_temp.fx('stale_swap'),2,'consent');
  raise exception 'stale swap unexpectedly finalized';
exception when sqlstate 'PT409' then null;
end $$;
do $$
begin
  if exists(select 1 from public.assignments where id in(pg_temp.fx('stale_a'),pg_temp.fx('stale_b')) and status<>'confirmed')
     or exists(select 1 from public.approved_swaps where id=pg_temp.fx('stale_swap') and (status<>'pending' or first_new_assignment_id is not null or second_new_assignment_id is not null)) then
    raise exception 'stale swap partially reassigned a participant';
  end if;
end $$;

-- Cancelling an open request releases an accepted reservation exactly once
-- and leaves its original decline in place.
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
update public.assignments set status='declined',responded_at=now() where id=pg_temp.fx('stale_a');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into f07_fx select 'cancel_request',id from public.create_replacement_request(pg_temp.fx('stale_a'),0,'f07-cancel-request',now()+interval '7 days');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into f07_fx select 'cancel_offer',id from public.issue_replacement_offer(pg_temp.fx('cancel_request'),pg_temp.fx('riley'),1,'f07-cancel-offer');
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.act_on_replacement_offer(pg_temp.fx('cancel_offer'),1,'accept');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.cancel_replacement_request(pg_temp.fx('cancel_request'),1);
select public.cancel_replacement_request(pg_temp.fx('cancel_request'),1);
do $$
begin
  if (select status from public.replacement_requests where id=pg_temp.fx('cancel_request'))<>'cancelled'
     or exists(select 1 from public.replacement_offers where id=pg_temp.fx('cancel_offer') and (status<>'superseded' or reservation_expires_at is not null))
     or (select status from public.assignments where id=pg_temp.fx('stale_a'))<>'declined' then
    raise exception 'replacement cancellation did not release its reservation safely';
  end if;
end $$;

-- Direct-table RLS uses non-recursive request/offer visibility helpers.
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select count(*) from public.replacement_requests where id=pg_temp.fx('request');
select count(*) from public.replacement_offers where id=pg_temp.fx('offer');

-- An uninvolved member sees neither the request/offer nor another person's
-- claim; these counts also prove the RLS helpers do not recurse.
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
do $$
begin
  if exists(select 1 from public.replacement_requests where id=pg_temp.fx('request'))
     or exists(select 1 from public.replacement_offers where id=pg_temp.fx('offer'))
     or exists(select 1 from public.opportunity_claims where id=pg_temp.fx('claim')) then
    raise exception 'private allocation state leaked to an uninvolved member';
  end if;
end $$;

rollback;
