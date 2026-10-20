-- MOB-010 Pass B: the replacement states the native and web clients both read
-- through GET /replacement-requests (lazy expiry, then the RLS-scoped
-- request + offers select). Covers request retry/stale/one-open, per-role
-- visibility, consent-first and approval-first finalization, the consent hold
-- against competing accept/manual fill (the 20261106000000 fix), lazy expiry,
-- decline, cancel/superseded and re-request. Run against a seeded local
-- database after f07-signups-replacements.sql. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/mob010-replacements.sql
begin;

create temporary table m10_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on m10_fx to authenticated, service_role;

insert into m10_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('electric', 'dddddddd-0000-4000-8000-000000000003'),
  ('sam', (select id from public.people where profile_id='33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id='44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id='55555555-5555-4555-8555-555555555555')),
  ('consent_plan', gen_random_uuid()), ('consent_orig', gen_random_uuid()), ('t_rehearsal', gen_random_uuid()), ('t_service', gen_random_uuid()),
  ('approve_plan', gen_random_uuid()), ('approve_orig', gen_random_uuid()),
  ('expiry_plan', gen_random_uuid()), ('expiry_orig', gen_random_uuid()),
  ('cancel_plan', gen_random_uuid()), ('cancel_orig', gen_random_uuid()),
  ('lapse_plan', gen_random_uuid()), ('lapse_orig', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from m10_fx where k=p $$;

-- The caller's view of one request, as GET /replacement-requests returns it.
create or replace function pg_temp.seen(p_request uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform public.expire_f07_allocations(pg_temp.fx('org'), 200);
  select to_jsonb(r) || jsonb_build_object('offers', coalesce((
    select jsonb_agg(to_jsonb(f) order by f.created_at, f.id) from public.replacement_offers f where f.request_id = r.id
  ), '[]'::jsonb)) into v
    from public.replacement_requests r where r.id = p_request and r.organization_id = pg_temp.fx('org');
  return v;
end $$;

-- The assignment's current request revision (attendance edits bump it).
create or replace function pg_temp.rev(p_assignment uuid) returns bigint language sql stable as
  $$ select request_revision from public.assignments where id=p_assignment $$;

create or replace function pg_temp.offer(p_request uuid, p_person uuid) returns jsonb language sql as $$
  select o from jsonb_array_elements(pg_temp.seen(p_request)->'offers') o where (o->>'candidate_person_id')::uuid = p_person
$$;

-- Asserts a call fails with this SQLSTATE and (when given) this PT409 hint.
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_hint text, p_label text)
returns void language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  raise exception '%: expected %/% but it succeeded', p_label, p_state, p_hint;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  if v_state <> p_state or (p_hint is not null and v_hint is distinct from p_hint) then
    raise exception '%: expected %/% but got %/%', p_label, p_state, p_hint, v_state, v_hint;
  end if;
end $$;

-- Riley and Morgan may both serve on Electric.
insert into public.team_memberships(team_id,user_id,person_id,position_id) values
  (pg_temp.fx('band'),'44444444-4444-4444-8444-444444444444',pg_temp.fx('riley'),pg_temp.fx('electric')),
  (pg_temp.fx('band'),'55555555-5555-4555-8555-555555555555',pg_temp.fx('morgan'),pg_temp.fx('electric'))
on conflict do nothing;

insert into public.plans(id,organization_id,service_type_id,title,service_date,status,created_by)
select pg_temp.fx(k),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','MOB-010 '||k,now()+(d||' days')::interval,'published','22222222-2222-4222-8222-222222222222'
  from (values ('consent_plan',700),('approve_plan',701),('expiry_plan',702),('cancel_plan',703),('lapse_plan',704)) v(k,d);
insert into public.plan_position_needs(plan_id,position_id,needed)
select pg_temp.fx(k),pg_temp.fx('electric'),1 from unnest(array['consent_plan','approve_plan','expiry_plan','cancel_plan','lapse_plan']) k;
insert into public.plan_times(id,plan_id,kind,name,starts_at,ends_at) values
  (pg_temp.fx('t_rehearsal'),pg_temp.fx('consent_plan'),'rehearsal',null,now()+interval '699 days',now()+interval '699 days 2 hours'),
  (pg_temp.fx('t_service'),pg_temp.fx('consent_plan'),'service',null,now()+interval '700 days',now()+interval '700 days 2 hours');

-- Sam declined each of these; on the consent plan Sam was asked for the service time only.
insert into public.assignments(id,plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
select pg_temp.fx(o),pg_temp.fx(p),pg_temp.fx('sam'),'33333333-3333-4333-8333-333333333333',pg_temp.fx('band'),pg_temp.fx('electric'),'declined','22222222-2222-4222-8222-222222222222','released',now(),m
  from (values ('consent_orig','consent_plan','selected'),('approve_orig','approve_plan','all'),('expiry_orig','expiry_plan','all'),
               ('cancel_orig','cancel_plan','all'),('lapse_orig','lapse_plan','all')) v(o,p,m);
insert into public.assignment_attendance_times(assignment_id,plan_time_id) values (pg_temp.fx('consent_orig'),pg_temp.fx('t_service'));

set local role authenticated;

-- 1. Requesting: only the declined assignee; one key per request; one open request.
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select pg_temp.expect_error($$select public.create_replacement_request(pg_temp.fx('consent_orig'),pg_temp.rev(pg_temp.fx('consent_orig')),'mob010-riley-for-sam',now()+interval '7 days')$$,'42501',null,'not the assignee');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.expect_error($$select public.create_replacement_request(pg_temp.fx('consent_orig'),pg_temp.rev(pg_temp.fx('consent_orig'))+5,'mob010-sam-stale',now()+interval '7 days')$$,'PT409',null,'stale revision');
insert into m10_fx select 'consent_req',id from public.create_replacement_request(pg_temp.fx('consent_orig'),pg_temp.rev(pg_temp.fx('consent_orig')),'mob010-sam-consent',now()+interval '7 days');
do $$ begin
  if (public.create_replacement_request(pg_temp.fx('consent_orig'),pg_temp.rev(pg_temp.fx('consent_orig')),'mob010-sam-consent',now()+interval '7 days')).id <> pg_temp.fx('consent_req') then
    raise exception 'a retry with the same key made a second request'; end if;
  perform pg_temp.expect_error($q$select public.create_replacement_request(pg_temp.fx('consent_orig'),pg_temp.rev(pg_temp.fx('consent_orig')),'mob010-sam-second',now()+interval '7 days')$q$,'23505',null,'second open request');
  -- The request carries exactly the times Sam was asked for, not the whole plan.
  if pg_temp.seen(pg_temp.fx('consent_req'))->'applicable_time_ids' <> jsonb_build_array(pg_temp.fx('t_service')) then
    raise exception 'request times are not the original assignment''s times'; end if;
end $$;

-- 2. Visibility: an uninvolved member sees nothing; members cannot offer.
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
do $$ begin
  if pg_temp.seen(pg_temp.fx('consent_req')) is not null then raise exception 'an uninvolved member can read the request'; end if;
  perform pg_temp.expect_error($q$select public.issue_replacement_offer(pg_temp.fx('consent_req'),pg_temp.fx('morgan'),1,'mob010-self-offer')$q$,'42501',null,'member offer');
end $$;

-- 3. Consent first: Riley's consent holds the place against Morgan and a manual fill.
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into m10_fx select 'riley_offer',id from public.issue_replacement_offer(pg_temp.fx('consent_req'),pg_temp.fx('riley'),1,'mob010-offer-riley');
insert into m10_fx select 'morgan_offer',id from public.issue_replacement_offer(pg_temp.fx('consent_req'),pg_temp.fx('morgan'),1,'mob010-offer-morgan');
do $$ begin
  -- Re-offering the same candidate returns the same offer, whatever the key.
  if (public.issue_replacement_offer(pg_temp.fx('consent_req'),pg_temp.fx('riley'),1,'mob010-offer-riley-2')).id <> pg_temp.fx('riley_offer') then
    raise exception 're-offer made a second offer'; end if;
end $$;
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$ begin
  if jsonb_array_length(pg_temp.seen(pg_temp.fx('consent_req'))->'offers') <> 1 then raise exception 'a candidate can see other candidates'' offers'; end if;
  perform pg_temp.expect_error($q$select public.act_on_replacement_offer(pg_temp.fx('riley_offer'),1,'approve')$q$,'42501',null,'candidate approval');
end $$;
select public.act_on_replacement_offer(pg_temp.fx('riley_offer'),1,'accept');
do $$ begin
  if pg_temp.offer(pg_temp.fx('consent_req'),pg_temp.fx('riley'))->>'status' <> 'accepted_awaiting_approval'
     or pg_temp.offer(pg_temp.fx('consent_req'),pg_temp.fx('riley'))->>'reservation_expires_at' is null
     or pg_temp.offer(pg_temp.fx('consent_req'),pg_temp.fx('riley'))->>'consented_at' is null then
    raise exception 'consent is not read back as awaiting approval with a hold'; end if;
  -- A replayed accept carries the old version and is refused; the client re-reads.
  perform pg_temp.expect_error($q$select public.act_on_replacement_offer(pg_temp.fx('riley_offer'),1,'accept')$q$,'PT409',null,'replayed accept');
end $$;
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
select pg_temp.expect_error($$select public.act_on_replacement_offer(pg_temp.fx('morgan_offer'),1,'accept')$$,'PT409','capacity_full','held place');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
  if jsonb_array_length(pg_temp.seen(pg_temp.fx('consent_req'))->'offers') <> 2 then raise exception 'the requester cannot track every offer'; end if;
end $$;
reset role;
select pg_temp.expect_error($$
  insert into public.assignments(plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode)
  values (pg_temp.fx('consent_plan'),pg_temp.fx('morgan'),'55555555-5555-4555-8555-555555555555',pg_temp.fx('band'),pg_temp.fx('electric'),'confirmed','22222222-2222-4222-8222-222222222222','released',now(),'all');
  set constraints all immediate$$,'PT409','capacity_full','manual fill over a consent hold');
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.act_on_replacement_offer(pg_temp.fx('riley_offer'),2,'approve');
select pg_temp.expect_error($$select public.act_on_replacement_offer(pg_temp.fx('riley_offer'),2,'approve')$$,'PT409',null,'stale approval');
do $$ begin
  if pg_temp.seen(pg_temp.fx('consent_req'))->>'status' <> 'filled'
     or pg_temp.offer(pg_temp.fx('consent_req'),pg_temp.fx('riley'))->>'status' <> 'finalized'
     or pg_temp.offer(pg_temp.fx('consent_req'),pg_temp.fx('morgan'))->>'status' <> 'superseded' then
    raise exception 'finalization did not fill the request and supersede the competitor'; end if;
end $$;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.expect_error($$select public.create_replacement_request(pg_temp.fx('consent_orig'),pg_temp.rev(pg_temp.fx('consent_orig')),'mob010-sam-after-fill',now()+interval '7 days')$$,'PT409','capacity_full','request after fill');

-- 4. Approval first: the leader approves a pending offer; the candidate's consent finalizes it.
insert into m10_fx select 'approve_req',id from public.create_replacement_request(pg_temp.fx('approve_orig'),pg_temp.rev(pg_temp.fx('approve_orig')),'mob010-sam-approve',now()+interval '7 days');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into m10_fx select 'approve_offer',id from public.issue_replacement_offer(pg_temp.fx('approve_req'),pg_temp.fx('riley'),1,'mob010-approve-riley');
select public.act_on_replacement_offer(pg_temp.fx('approve_offer'),1,'approve');
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$ begin
  if pg_temp.offer(pg_temp.fx('approve_req'),pg_temp.fx('riley'))->>'status' <> 'pending'
     or pg_temp.offer(pg_temp.fx('approve_req'),pg_temp.fx('riley'))->>'leader_approved_at' is null then
    raise exception 'leader approval before consent is not read back as pending + approved'; end if;
  if (public.act_on_replacement_offer(pg_temp.fx('approve_offer'),2,'accept')).status <> 'finalized' then
    raise exception 'consent after approval did not finalize'; end if;
end $$;

-- 5. Lazy expiry: a lapsed consent hold is released by the next read and cannot be approved.
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into m10_fx select 'expiry_req',id from public.create_replacement_request(pg_temp.fx('expiry_orig'),pg_temp.rev(pg_temp.fx('expiry_orig')),'mob010-sam-expiry',now()+interval '7 days');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into m10_fx select 'expiry_offer',id from public.issue_replacement_offer(pg_temp.fx('expiry_req'),pg_temp.fx('riley'),1,'mob010-expiry-riley');
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.act_on_replacement_offer(pg_temp.fx('expiry_offer'),1,'accept');
reset role;
update public.replacement_offers set reservation_expires_at=now()-interval '1 minute' where id=pg_temp.fx('expiry_offer');
set local role authenticated;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
  if pg_temp.offer(pg_temp.fx('expiry_req'),pg_temp.fx('riley'))->>'status' <> 'expired' then raise exception 'lapsed hold is not read back as expired'; end if;
  perform pg_temp.seen(pg_temp.fx('expiry_req'));
  if pg_temp.seen(pg_temp.fx('expiry_req'))->>'status' <> 'open' then raise exception 'an expired hold closed the request'; end if;
  perform pg_temp.expect_error($q$select public.act_on_replacement_offer(pg_temp.fx('expiry_offer'),2,'approve')$q$,'PT409',null,'approve expired');
end $$;
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select pg_temp.expect_error($$select public.act_on_replacement_offer(pg_temp.fx('expiry_offer'),3,'accept')$$,'PT409',null,'accept expired');

-- 6. Decline, then cancel: pending offers become superseded; cancel repeats safely; a new request may follow.
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into m10_fx select 'cancel_req',id from public.create_replacement_request(pg_temp.fx('cancel_orig'),pg_temp.rev(pg_temp.fx('cancel_orig')),'mob010-sam-cancel',now()+interval '7 days');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into m10_fx select 'declined_offer',id from public.issue_replacement_offer(pg_temp.fx('cancel_req'),pg_temp.fx('riley'),1,'mob010-cancel-riley');
insert into m10_fx select 'superseded_offer',id from public.issue_replacement_offer(pg_temp.fx('cancel_req'),pg_temp.fx('morgan'),1,'mob010-cancel-morgan');
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
select public.act_on_replacement_offer(pg_temp.fx('declined_offer'),1,'decline');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.cancel_replacement_request(pg_temp.fx('cancel_req'),1);
do $$ begin
  if (public.cancel_replacement_request(pg_temp.fx('cancel_req'),1)).version <> 2 then raise exception 'repeated cancel changed the request again'; end if;
  if pg_temp.offer(pg_temp.fx('cancel_req'),pg_temp.fx('riley'))->>'status' <> 'declined'
     or pg_temp.offer(pg_temp.fx('cancel_req'),pg_temp.fx('morgan'))->>'status' <> 'superseded' then
    raise exception 'cancel did not keep the decline and supersede the pending offer'; end if;
end $$;
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
select pg_temp.expect_error($$select public.act_on_replacement_offer(pg_temp.fx('superseded_offer'),2,'accept')$$,'PT409',null,'accept superseded');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into m10_fx select 'rerequest',id from public.create_replacement_request(pg_temp.fx('cancel_orig'),pg_temp.rev(pg_temp.fx('cancel_orig')),'mob010-sam-again',now()+interval '7 days');

-- 7. Request lapse: the request and its pending offer expire on the next read.
insert into m10_fx select 'lapse_req',id from public.create_replacement_request(pg_temp.fx('lapse_orig'),pg_temp.rev(pg_temp.fx('lapse_orig')),'mob010-sam-lapse',now()+interval '7 days');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
insert into m10_fx select 'lapse_offer',id from public.issue_replacement_offer(pg_temp.fx('lapse_req'),pg_temp.fx('riley'),1,'mob010-lapse-riley');
reset role;
update public.replacement_requests set expires_at=now()-interval '1 minute' where id=pg_temp.fx('lapse_req');
set local role authenticated;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
  if pg_temp.seen(pg_temp.fx('lapse_req'))->>'status' <> 'expired'
     or pg_temp.offer(pg_temp.fx('lapse_req'),pg_temp.fx('riley'))->>'status' <> 'expired' then
    raise exception 'a lapsed request is not read back as expired'; end if;
end $$;

reset role;
do $$ begin
  -- The original declines and their history survive; the replacements are their own assignments.
  if exists(select 1 from public.assignments where id in (pg_temp.fx('consent_orig'),pg_temp.fx('approve_orig')) and status <> 'declined') then
    raise exception 'a replacement overwrote the original decline'; end if;
  if (select count(*) from public.assignments where plan_id=pg_temp.fx('consent_plan') and status<>'declined') <> 1
     or (select attendance_mode from public.assignments a join public.replacement_offers f on f.assignment_id=a.id where f.id=pg_temp.fx('riley_offer')) <> 'selected'
     or (select array_agg(plan_time_id) from public.assignment_attendance_times t join public.replacement_offers f on f.assignment_id=t.assignment_id where f.id=pg_temp.fx('riley_offer')) <> array[pg_temp.fx('t_service')] then
    raise exception 'the replacement is not one confirmed assignment for exactly the original times'; end if;
  if (select person_id from public.assignments a join public.replacement_offers f on f.assignment_id=a.id where f.id=pg_temp.fx('approve_offer')) <> pg_temp.fx('riley') then
    raise exception 'approval-first replacement is not Riley''s own assignment'; end if;
  if (select count(*) from public.allocation_events where aggregate_id=pg_temp.fx('expiry_offer') and transition='expired') <> 1 then
    raise exception 'expiry was recorded more than once'; end if;
  if (select count(*) from public.allocation_events where aggregate_id=pg_temp.fx('cancel_req') and transition='cancelled') <> 1 then
    raise exception 'cancellation was recorded more than once'; end if;
end $$;

select 'mob010 replacements: request retry, visibility, consent/approval order, hold vs accept/manual, expiry, decline, cancel and lapse verified' as result;
rollback;
