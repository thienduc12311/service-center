-- MOB-009 Pass B: the signup states the native and web clients both read
-- from list_signup_opportunities — full, closed, stale version, cancel and
-- reject restoring capacity once, lazy expiry recorded once, one claim per
-- Person, and membership loss. Run against a seeded local database after
-- f07-signups-replacements.sql. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/mob009-signup-claims.sql
begin;

create temporary table m9_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on m9_fx to authenticated, service_role;

insert into m9_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('electric', 'dddddddd-0000-4000-8000-000000000003'),
  ('sam', (select id from public.people where profile_id='33333333-3333-4333-8333-333333333333')),
  ('riley', (select id from public.people where profile_id='44444444-4444-4444-8444-444444444444')),
  ('morgan', (select id from public.people where profile_id='55555555-5555-4555-8555-555555555555')),
  ('direct_plan', gen_random_uuid()), ('direct', gen_random_uuid()),
  ('approval_plan', gen_random_uuid()), ('approval', gen_random_uuid()),
  ('closed_plan', gen_random_uuid()), ('closed', gen_random_uuid()),
  ('expiry_plan', gen_random_uuid()), ('expiry', gen_random_uuid()), ('lapsed_claim', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from m9_fx where k=p $$;

-- The caller's view of one opening, exactly as both clients receive it.
create or replace function pg_temp.seen(p_opening uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.list_signup_opportunities(pg_temp.fx('org'), null)) e
   where (e->>'id')::uuid = p_opening
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

-- Everyone involved may serve on Electric.
insert into public.team_memberships(team_id,user_id,person_id,position_id) values
  (pg_temp.fx('band'),'44444444-4444-4444-8444-444444444444',pg_temp.fx('riley'),pg_temp.fx('electric')),
  (pg_temp.fx('band'),'55555555-5555-4555-8555-555555555555',pg_temp.fx('morgan'),pg_temp.fx('electric'))
on conflict do nothing;

insert into public.plans(id,organization_id,service_type_id,title,service_date,status,created_by)
select pg_temp.fx(k),pg_temp.fx('org'),'bbbbbbbb-0000-4000-8000-000000000001','MOB-009 '||k,now()+(d||' days')::interval,'published','22222222-2222-4222-8222-222222222222'
  from (values ('direct_plan',500),('approval_plan',501),('closed_plan',502),('expiry_plan',503)) v(k,d);
insert into public.plan_position_needs(plan_id,position_id,needed)
select pg_temp.fx(k),pg_temp.fx('electric'),1 from unnest(array['direct_plan','approval_plan','closed_plan','expiry_plan']) k;

insert into public.signup_opportunities(id,organization_id,plan_id,team_id,position_id,capacity,approval_policy,closes_at,created_by)
select pg_temp.fx(o),pg_temp.fx('org'),pg_temp.fx(p),pg_temp.fx('band'),pg_temp.fx('electric'),1,policy,now()+interval '30 days','22222222-2222-4222-8222-222222222222'
  from (values ('direct','direct_plan','direct'),('approval','approval_plan','leader_approval'),
               ('closed','closed_plan','direct'),('expiry','expiry_plan','leader_approval')) v(o,p,policy);
-- A hold that lapsed a minute ago; nothing has read the opening since.
insert into public.opportunity_claims(id,opportunity_id,person_id,status,opportunity_version,idempotency_key,reservation_expires_at)
values(pg_temp.fx('lapsed_claim'),pg_temp.fx('expiry'),pg_temp.fx('riley'),'awaiting_approval',1,'mob009-lapsed-claim',now()-interval '1 minute');

set local role authenticated;

-- 1. Direct: the last place is allocated once; the loser hears "full".
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
insert into m9_fx select 'sam_direct',id from public.claim_signup_opportunity(pg_temp.fx('direct'),1,'mob009-sam-direct');
do $$ begin
  if pg_temp.seen(pg_temp.fx('direct'))->'my_claim'->>'status' <> 'confirmed' then raise exception 'claimant does not read back confirmed'; end if;
  -- Retry with the same key after the response was lost returns the same claim.
  if (public.claim_signup_opportunity(pg_temp.fx('direct'),1,'mob009-sam-direct')).id <> pg_temp.fx('sam_direct') then
    raise exception 'retry with the same key made a second claim'; end if;
end $$;

set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$ begin
  if pg_temp.seen(pg_temp.fx('direct'))->>'eligibility' <> 'full' or (pg_temp.seen(pg_temp.fx('direct'))->>'remaining_capacity')::int <> 0 then
    raise exception 'other members do not read the opening as full'; end if;
end $$;
select pg_temp.expect_error($$select public.claim_signup_opportunity(pg_temp.fx('direct'),1,'mob009-riley-direct')$$,'PT409','capacity_full','full');

-- 2. Cancelling restores the place once; a repeated cancel is the same terminal row.
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select public.cancel_signup_claim(pg_temp.fx('sam_direct'),1);
do $$ begin
  if (public.cancel_signup_claim(pg_temp.fx('sam_direct'),1)).version <> 2 then raise exception 'repeated cancel changed the claim again'; end if;
  if pg_temp.seen(pg_temp.fx('direct'))->'my_claim'->>'status' <> 'cancelled' then raise exception 'cancel not read back'; end if;
  -- One claim per Person per opening: a new key cannot sign up again.
  perform pg_temp.expect_error($q$select public.claim_signup_opportunity(pg_temp.fx('direct'),1,'mob009-sam-again')$q$,'23505',null,'reclaim');
end $$;

-- 3. Stale review: the opening changed after Riley looked at it.
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
update public.signup_opportunities set reservation_minutes=60 where id=pg_temp.fx('direct');
set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$ begin
  if (pg_temp.seen(pg_temp.fx('direct'))->>'remaining_capacity')::int <> 1 or pg_temp.seen(pg_temp.fx('direct'))->>'eligibility' <> 'eligible' then
    raise exception 'cancelled place was not restored exactly once'; end if;
end $$;
select pg_temp.expect_error($$select public.claim_signup_opportunity(pg_temp.fx('direct'),1,'mob009-riley-direct')$$,'PT409','opportunity_changed','stale');
-- The same key, after a fresh review of version 2, now succeeds.
do $$ begin
  if (public.claim_signup_opportunity(pg_temp.fx('direct'),2,'mob009-riley-direct')).status <> 'confirmed' then raise exception 'fresh review did not confirm'; end if;
end $$;

-- 4. Approval: a hold occupies the place until rejected; then it is free once.
insert into m9_fx select 'riley_hold',id from public.claim_signup_opportunity(pg_temp.fx('approval'),1,'mob009-riley-hold');
do $$ begin
  if pg_temp.seen(pg_temp.fx('approval'))->'my_claim'->>'status' <> 'awaiting_approval'
     or pg_temp.seen(pg_temp.fx('approval'))->'my_claim'->>'reservation_expires_at' is null then
    raise exception 'hold is not visible with its end time'; end if;
end $$;
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
do $$ begin
  if pg_temp.seen(pg_temp.fx('approval'))->>'eligibility' <> 'full' then raise exception 'a live hold did not occupy the place'; end if;
  -- A member cannot decide claims.
  perform pg_temp.expect_error($q$select public.decide_signup_claim(pg_temp.fx('riley_hold'),1,'approve')$q$,'42501',null,'member decision');
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.decide_signup_claim(pg_temp.fx('riley_hold'),1,'reject');
select pg_temp.expect_error($$select public.decide_signup_claim(pg_temp.fx('riley_hold'),1,'approve')$$,'PT409',null,'stale decision');
set local request.jwt.claim.sub='55555555-5555-4555-8555-555555555555';
insert into m9_fx select 'morgan_hold',id from public.claim_signup_opportunity(pg_temp.fx('approval'),1,'mob009-morgan-hold');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select public.decide_signup_claim(pg_temp.fx('morgan_hold'),1,'approve');

-- 5. Closed: no one may claim, and members no longer see it.
update public.signup_opportunities set state='closed' where id=pg_temp.fx('closed');
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.expect_error($$select public.claim_signup_opportunity(pg_temp.fx('closed'),2,'mob009-sam-closed')$$,'PT409','opportunity_closed','closed');
do $$ begin
  if pg_temp.seen(pg_temp.fx('closed')) is not null then raise exception 'a closed opening is still listed for a member'; end if;
end $$;

-- 6. Lazy expiry: the lapsed hold is released by the first read, recorded once.
do $$ begin
  if pg_temp.seen(pg_temp.fx('expiry'))->>'eligibility' <> 'eligible' then raise exception 'lapsed hold still occupies the place'; end if;
  perform pg_temp.seen(pg_temp.fx('expiry'));
end $$;

-- 7. Membership loss: an inactive member can neither list nor claim.
reset role;
update public.organization_members set status='inactive'
 where organization_id=pg_temp.fx('org') and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
select pg_temp.expect_error($$select public.list_signup_opportunities(pg_temp.fx('org'),null)$$,'42501',null,'inactive list');
select pg_temp.expect_error($$select public.claim_signup_opportunity(pg_temp.fx('expiry'),1,'mob009-sam-inactive')$$,'42501',null,'inactive claim');

reset role;
do $$ begin
  if (select count(*) from public.assignments where plan_id=pg_temp.fx('direct_plan') and status<>'declined') <> 1 then
    raise exception 'direct opening does not hold exactly one commitment'; end if;
  if (select a.status from public.assignments a join public.opportunity_claims c on c.assignment_id=a.id where c.id=pg_temp.fx('sam_direct')) <> 'declined' then
    raise exception 'cancelled signup left its assignment active'; end if;
  if (select count(*) from public.assignments where plan_id=pg_temp.fx('approval_plan') and status<>'declined') <> 1 then
    raise exception 'approval opening does not hold exactly one commitment'; end if;
  if (select status from public.opportunity_claims where id=pg_temp.fx('lapsed_claim')) <> 'expired' then
    raise exception 'lapsed hold was not expired'; end if;
  if (select count(*) from public.allocation_events where aggregate_id=pg_temp.fx('lapsed_claim') and transition='expired') <> 1 then
    raise exception 'expiry was recorded more than once'; end if;
  if (select count(*) from public.allocation_events where aggregate_id=pg_temp.fx('sam_direct') and transition='cancelled') <> 1 then
    raise exception 'cancellation was recorded more than once'; end if;
end $$;

select 'mob009 signup claims: full, cancel, stale, approval, closed, expiry and membership loss verified' as result;
rollback;
