-- QA wave 3 regression suite. Each section fails on the schema before the
-- wave 3 migrations:
--   A. W3-REL-D1 (P0)  is_org_admin returns false (not NULL) for outsiders,
--                      blocking cross-org calls to all 20 admin-guarded RPCs
--                      and org-level reminder policy writes.
-- Run against a seeded local database. Everything rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave3-fixes.sql
begin;

create temporary table w3_fx (k text primary key, id uuid) on commit drop;
grant select, insert, update, delete on w3_fx to authenticated, service_role;

insert into w3_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('sunday', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('band', 'cccccccc-0000-4000-8000-000000000001'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('scheduler', '22222222-2222-4222-8222-222222222222'),
  ('sam_user', '33333333-3333-4333-8333-333333333333'),
  ('sam', (select id from public.people where profile_id = '33333333-3333-4333-8333-333333333333'
             and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('riley', (select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444'
             and organization_id = 'aaaaaaaa-0000-4000-8000-000000000001')),
  ('outsider_user', gen_random_uuid()),
  ('outsider_org', gen_random_uuid()),
  ('cred', gen_random_uuid()),
  ('endpoint', gen_random_uuid()),
  ('wh_event', gen_random_uuid()),
  ('wh_delivery', gen_random_uuid()),
  ('effect', gen_random_uuid()),
  ('delivery', gen_random_uuid()),
  ('batch', gen_random_uuid()),
  ('folder_a', gen_random_uuid()),
  ('folder_b', gen_random_uuid()),
  ('reconciliation', gen_random_uuid()),
  ('message', gen_random_uuid()),
  ('delegation', gen_random_uuid());

create or replace function pg_temp.fx(p text) returns uuid language sql stable as
  $$ select id from w3_fx where k = p $$;

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_hint text, p_label text)
returns void language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  raise exception '%: expected %/% but it succeeded', p_label, p_state, p_hint;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  if v_state <> p_state or (p_hint is not null and v_hint is distinct from p_hint) then
    raise exception '%: expected %/% but got %/% (%)', p_label, p_state, p_hint, v_state, v_hint, sqlerrm;
  end if;
end $$;

-- ------------------------------------------------------------- fixtures ---
-- An authenticated user belonging only to another organization.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (pg_temp.fx('outsider_user'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'w3.outsider@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"W3 Outsider"}', now(), now());
insert into public.organizations (id, name, slug, timezone)
values (pg_temp.fx('outsider_org'), 'W3 Outsider Church', 'w3-outsider-church', 'America/Toronto');
insert into public.organization_members (organization_id, user_id, role, status)
values (pg_temp.fx('outsider_org'), pg_temp.fx('outsider_user'), 'owner', 'active');

-- Target org A records for each admin-guarded RPC.
insert into public.api_credentials (id, organization_id, name, key_prefix, secret_hash, scopes, created_by, idempotency_key)
values (pg_temp.fx('cred'), pg_temp.fx('org'), 'W3 Target Key', repeat('a', 16), repeat('b', 64),
        array['plans.read'], pg_temp.fx('owner'), 'w3-fixture-cred');

insert into public.webhook_endpoints (id, organization_id, url, description, event_types, secret_ciphertext, secret_hint, created_by, idempotency_key)
values (pg_temp.fx('endpoint'), pg_temp.fx('org'), 'https://example.test/w3-hook', 'W3 Hook',
        array['plan.published'], repeat('c', 24), 'abcd', pg_temp.fx('owner'), 'w3-fixture-hook');

insert into public.webhook_events (id, organization_id, event_type, source_key, data)
values (pg_temp.fx('wh_event'), pg_temp.fx('org'), 'plan.published', 'w3-wh-event', '{}'::jsonb);

insert into public.webhook_deliveries (id, organization_id, event_id, endpoint_id, status, attempts, completed_at)
values (pg_temp.fx('wh_delivery'), pg_temp.fx('org'), pg_temp.fx('wh_event'), pg_temp.fx('endpoint'), 'failed', 1, now());

insert into public.operational_messages (id, organization_id, audience, audience_hash, request_hash, subject, body, recipient_count, excluded_count, idempotency_key, created_by)
values (pg_temp.fx('message'), pg_temp.fx('org'), '{"kind":"teams"}'::jsonb, repeat('a', 32), repeat('b', 32),
        'W3 Subject', 'W3 Body', 1, 0, 'w3-fixture-msg', pg_temp.fx('owner'));

insert into public.delivery_effects (id, organization_id, effect_key, template, operational_message_id, created_by)
values (pg_temp.fx('effect'), pg_temp.fx('org'), 'w3-effect-key', 'operational_message', pg_temp.fx('message'), pg_temp.fx('owner'));

insert into public.deliveries (id, organization_id, effect_id, recipient_id, recipient_person_id, channel, status, attempts, completed_at)
values (pg_temp.fx('delivery'), pg_temp.fx('org'), pg_temp.fx('effect'), pg_temp.fx('sam_user'), pg_temp.fx('sam'),
        'email', 'failed', 1, now());

insert into public.release_batches (id, organization_id, created_by, idempotency_key, request_hash, scheduled_for, status, item_count, plan_count)
values (pg_temp.fx('batch'), pg_temp.fx('org'), pg_temp.fx('owner'), 'w3-fixture-batch', 'w3-batch-hash',
        now() + interval '1 day', 'scheduled', 1, 1);

insert into public.service_type_folders (id, organization_id, name, created_by) values
  (pg_temp.fx('folder_a'), pg_temp.fx('org'), 'W3 Folder A', pg_temp.fx('owner')),
  (pg_temp.fx('folder_b'), pg_temp.fx('org'), 'W3 Folder B', pg_temp.fx('owner'));

insert into public.person_identity_reconciliations (id, organization_id, profile_id, person_id, candidate_person_id, reason, status)
values (pg_temp.fx('reconciliation'), pg_temp.fx('org'), pg_temp.fx('sam_user'), pg_temp.fx('sam'), pg_temp.fx('riley'),
        'email_match', 'open');

insert into public.schedule_delegations (id, organization_id, target_person_id, delegate_person_id, granted_by, can_respond)
values (pg_temp.fx('delegation'), pg_temp.fx('org'), pg_temp.fx('sam'), pg_temp.fx('riley'), pg_temp.fx('owner'), true);

-- ======================================== A. W3-REL-D1 NULL-safe is_org_admin
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  if public.is_org_admin(pg_temp.fx('org')) is distinct from true then
    raise exception 'Active owner is not recognized as org admin';
  end if;
end $$;

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if public.is_org_admin(pg_temp.fx('org')) is distinct from false then
    raise exception 'Scheduler must get false from is_org_admin';
  end if;
end $$;

-- Switch to the outsider (owner of outsider_org, non-member of org A).
select set_config('request.jwt.claim.sub', pg_temp.fx('outsider_user')::text, true);

do $$ begin
  if public.is_org_admin(pg_temp.fx('org')) is distinct from false then
    raise exception 'Outsider must get false (not %) from is_org_admin', public.is_org_admin(pg_temp.fx('org'));
  end if;
  if public.is_org_admin(null) is distinct from false then
    raise exception 'is_org_admin(null) must return false';
  end if;
end $$;

-- 1. create_api_credential
select pg_temp.expect_error(
  $$select public.create_api_credential(pg_temp.fx('org'), 'Hijack', array['plans.read'], repeat('d', 16), repeat('e', 64), null, 60, 'w3-outsider-cred')$$,
  '42501', null, 'outsider create_api_credential');

-- 2. revoke_api_credential
select pg_temp.expect_error(
  $$select public.revoke_api_credential(pg_temp.fx('cred'))$$,
  'P0002', null, 'outsider revoke_api_credential');

-- 3. create_webhook_endpoint
select pg_temp.expect_error(
  $$select public.create_webhook_endpoint(pg_temp.fx('org'), 'https://example.test/evil', 'evil', array['plan.published'], repeat('f', 24), 'efgh', 'w3-outsider-hook')$$,
  '42501', null, 'outsider create_webhook_endpoint');

-- 4. set_webhook_endpoint_enabled
select pg_temp.expect_error(
  $$select public.set_webhook_endpoint_enabled(pg_temp.fx('endpoint'), false, 1)$$,
  'P0002', null, 'outsider set_webhook_endpoint_enabled');

-- 5. send_webhook_test
select pg_temp.expect_error(
  $$select public.send_webhook_test(pg_temp.fx('endpoint'))$$,
  'P0002', null, 'outsider send_webhook_test');

-- 6. retry_webhook_delivery
select pg_temp.expect_error(
  $$select public.retry_webhook_delivery(pg_temp.fx('wh_delivery'))$$,
  'P0002', null, 'outsider retry_webhook_delivery');

-- 7. revoke_webhook_endpoint
select pg_temp.expect_error(
  $$select public.revoke_webhook_endpoint(pg_temp.fx('endpoint'))$$,
  'P0002', null, 'outsider revoke_webhook_endpoint');

-- 8. retry_delivery
select pg_temp.expect_error(
  $$select public.retry_delivery(pg_temp.fx('delivery'))$$,
  'P0002', null, 'outsider retry_delivery');

-- 9. cancel_release_batch
select pg_temp.expect_error(
  $$select public.cancel_release_batch(pg_temp.fx('batch'))$$,
  'P0002', null, 'outsider cancel_release_batch');

-- 10. replace_scope_grants
select pg_temp.expect_error(
  $$select * from public.replace_scope_grants(pg_temp.fx('org'), 'organization', null, '[]'::jsonb)$$,
  '42501', null, 'outsider replace_scope_grants');

-- 11. member_effective_access (for another user)
select pg_temp.expect_error(
  $$select * from public.member_effective_access(pg_temp.fx('org'), pg_temp.fx('sam_user'))$$,
  '42501', null, 'outsider member_effective_access');

-- 12. explain_capability (for another user)
select pg_temp.expect_error(
  $$select public.explain_capability(pg_temp.fx('org'), pg_temp.fx('sam_user'), 'plans.edit')$$,
  '42501', null, 'outsider explain_capability');

-- 13. preview_folder_move
select pg_temp.expect_error(
  $$select * from public.preview_folder_move(pg_temp.fx('folder_a'), pg_temp.fx('folder_b'))$$,
  'P0002', null, 'outsider preview_folder_move');

-- 14. preview_service_type_move
select pg_temp.expect_error(
  $$select * from public.preview_service_type_move(pg_temp.fx('sunday'), pg_temp.fx('folder_a'))$$,
  'P0002', null, 'outsider preview_service_type_move');

-- 15. move_service_type
select pg_temp.expect_error(
  $$select public.move_service_type(pg_temp.fx('sunday'), pg_temp.fx('folder_a'), true)$$,
  'P0002', null, 'outsider move_service_type');

-- 16. move_service_type_folder
select pg_temp.expect_error(
  $$select public.move_service_type_folder(pg_temp.fx('folder_a'), pg_temp.fx('folder_b'), 0, true)$$,
  'P0002', null, 'outsider move_service_type_folder');

-- 17. resolve_person_reconciliation
select pg_temp.expect_error(
  $$select public.resolve_person_reconciliation(pg_temp.fx('reconciliation'), 'keep_separate')$$,
  'P0002', null, 'outsider resolve_person_reconciliation');

-- 18. operational_message_outcomes
select pg_temp.expect_error(
  $$select * from public.operational_message_outcomes(pg_temp.fx('message'))$$,
  'P0002', null, 'outsider operational_message_outcomes');

-- 19. retry_operational_message
select pg_temp.expect_error(
  $$select public.retry_operational_message(pg_temp.fx('message'), null)$$,
  'P0002', null, 'outsider retry_operational_message');

-- 20. revoke_schedule_delegation
select pg_temp.expect_error(
  $$select public.revoke_schedule_delegation(pg_temp.fx('delegation'))$$,
  'P0002', null, 'outsider revoke_schedule_delegation');

-- 21. Org-level reminder_policies write (uses private.can_edit_reminder_policy -> is_org_admin)
select pg_temp.expect_error(
  $$insert into public.reminder_policies (organization_id, kind, offset_minutes, channels)
    values (pg_temp.fx('org'), 'pending_response', 1440, array['email']::public.delivery_channel[])$$,
  '42501', null, 'outsider insert org reminder_policy');

reset role;
do $$ begin
  if (select revoked_at from public.api_credentials where id = pg_temp.fx('cred')) is not null
     or (select revoked_at from public.webhook_endpoints where id = pg_temp.fx('endpoint')) is not null
     or not (select enabled from public.webhook_endpoints where id = pg_temp.fx('endpoint'))
     or (select status from public.webhook_deliveries where id = pg_temp.fx('wh_delivery')) <> 'failed'
     or (select status from public.deliveries where id = pg_temp.fx('delivery')) <> 'failed'
     or (select status from public.release_batches where id = pg_temp.fx('batch')) <> 'scheduled'
     or (select status from public.person_identity_reconciliations where id = pg_temp.fx('reconciliation')) <> 'open'
     or (select revoked_at from public.schedule_delegations where id = pg_temp.fx('delegation')) is not null then
    raise exception 'Outsider mutated an org A record';
  end if;
end $$;

select 'qa wave 3: NULL-safe is_org_admin and 20 admin-guarded RPCs verified' as result;
rollback;
