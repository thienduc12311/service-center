-- F17 stage D: API credentials (issue, hash-only storage, scopes, tenancy,
-- revocation, issuer demotion, rate windows) and webhooks (admin-only
-- registration, secret columns hidden, event emission on publication changes,
-- private drafts never emitted, claim/lease/complete, 410 and failure
-- disabling, retry, revoke) — exercised as each caller (role + JWT) against
-- the seeded local database. Everything rolls back.
--
-- Seeded: the owner (admin), Jordan (scheduler, not an admin), Sam (member).
-- A second organization is created with Sam as its owner.
begin;

create temporary table f17_fx (k text primary key, id uuid) on commit drop;
grant select, insert on f17_fx to authenticated, service_role;
insert into f17_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('jordan', '22222222-2222-4222-8222-222222222222'),
  ('sam', '33333333-3333-4333-8333-333333333333'),
  ('org2', gen_random_uuid()), ('plan_pub', gen_random_uuid()), ('plan_draft', gen_random_uuid()),
  ('plan_other', gen_random_uuid()), ('song', gen_random_uuid()), ('song_archived', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f17_fx where k = p $$;
create or replace function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from f17_fx where k = p), true);
  select set_config('request.jwt.claims', json_build_object('sub', (select id::text from f17_fx where k = p), 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.hash(p text) returns text language sql immutable as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

insert into public.organizations (id, name, slug) values (pg_temp.fx('org2'), 'Other Church', 'f17-other-church');
insert into public.organization_members (organization_id, user_id, role) values (pg_temp.fx('org2'), pg_temp.fx('sam'), 'owner');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan_pub'), pg_temp.fx('org'), pg_temp.fx('st'), 'F17 Published', '2027-09-05 14:00+00', 'published', pg_temp.fx('jordan')),
  (pg_temp.fx('plan_draft'), pg_temp.fx('org'), pg_temp.fx('st'), 'F17 Draft', '2027-09-06 14:00+00', 'draft', pg_temp.fx('jordan')),
  (pg_temp.fx('plan_other'), pg_temp.fx('org2'), null, 'Other tenant', '2027-09-05 14:00+00', 'published', pg_temp.fx('sam'));
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
values (pg_temp.fx('plan_pub'), 'service', '9am', '2027-09-05 14:00+00', '2027-09-05 15:00+00');
insert into public.plan_items (plan_id, item_type, title, description, sort_order)
values (pg_temp.fx('plan_pub'), 'item', 'Welcome', 'PRIVATE leader note', 1);
insert into public.songs (id, organization_id, title, archived_at) values
  (pg_temp.fx('song'), pg_temp.fx('org'), 'F17 Song', null),
  (pg_temp.fx('song_archived'), pg_temp.fx('org'), 'F17 Archived', now());

set local role authenticated;

-- ========================================================== credentials ====
-- A scheduler is not an administrator.
select pg_temp.as_user('jordan');
do $$ begin
  perform public.create_api_credential(pg_temp.fx('org'), 'Nope', array['plans.read'], repeat('a', 16), pg_temp.hash('x'), null, 60, 'key-jordan-1');
  raise exception 'FAIL: scheduler issued a credential';
exception when insufficient_privilege then null; end $$;

select pg_temp.as_user('owner');
do $$
declare r record; r2 record; n int;
begin
  select * into r from public.create_api_credential(pg_temp.fx('org'), ' Display ', array['songs.read', 'plans.read', 'plans.read'],
    '0123456789abcdef', pg_temp.hash('secret-one'), null, 2, 'key-owner-1');
  if r.replayed then raise exception 'FAIL: first create replayed'; end if;
  insert into f17_fx values ('cred', r.credential_id);
  -- Same key + same request → same credential, replayed.
  select * into r2 from public.create_api_credential(pg_temp.fx('org'), 'Display', array['plans.read', 'songs.read'],
    'fedcba9876543210', pg_temp.hash('other'), null, 2, 'key-owner-1');
  if r2.credential_id <> r.credential_id or not r2.replayed then raise exception 'FAIL: replay %', r2; end if;
  -- Same key, different request → refused.
  begin
    perform public.create_api_credential(pg_temp.fx('org'), 'Different', array['plans.read'], 'fedcba9876543210', pg_temp.hash('other'), null, 2, 'key-owner-1');
    raise exception 'FAIL: key reuse accepted';
  exception when sqlstate 'PT409' then null; end;
  -- Unknown scope → constraint.
  begin
    perform public.create_api_credential(pg_temp.fx('org'), 'Bad', array['people.write'], '1111111111111111', pg_temp.hash('b'), null, 60, 'key-owner-bad');
    raise exception 'FAIL: unknown scope accepted';
  exception when check_violation then null; end;
  -- Past expiry refused.
  begin
    perform public.create_api_credential(pg_temp.fx('org'), 'Old', array['plans.read'], '2222222222222222', pg_temp.hash('c'), now() - interval '1 day', 60, 'key-owner-old');
    raise exception 'FAIL: past expiry accepted';
  exception when invalid_parameter_value then null; end;
  -- A plans-only credential for scope checks.
  select * into r from public.create_api_credential(pg_temp.fx('org'), 'Plans only', array['plans.read'],
    '3333333333333333', pg_temp.hash('secret-plans'), null, 60, 'key-owner-2');
  insert into f17_fx values ('cred_plans', r.credential_id);

  -- Admin reads metadata; the hash column is not readable.
  select count(*) into n from public.api_credentials where organization_id = pg_temp.fx('org');
  if n <> 2 then raise exception 'FAIL: admin sees % credentials', n; end if;
  begin
    perform secret_hash from public.api_credentials limit 1;
    raise exception 'FAIL: secret_hash readable';
  exception when insufficient_privilege then null; end;
  -- No direct writes.
  begin
    update public.api_credentials set scopes = array['plans.read'] where id = pg_temp.fx('cred');
    raise exception 'FAIL: direct update allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- Non-admins see no credentials and cannot revoke.
select pg_temp.as_user('jordan');
do $$ declare n int; begin
  select count(*) into n from public.api_credentials;
  if n <> 0 then raise exception 'FAIL: scheduler sees credentials'; end if;
  begin
    perform public.revoke_api_credential(pg_temp.fx('cred'));
    raise exception 'FAIL: scheduler revoked';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform * from public.api_authenticate('0123456789abcdef', pg_temp.hash('secret-one'));
    raise exception 'FAIL: authenticated may call api_authenticate';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.api_plans(pg_temp.fx('cred'), '2027-01-01', '2028-01-01', null, null, null, 10);
    raise exception 'FAIL: authenticated may call api_plans';
  exception when insufficient_privilege then null; end;
end $$;

-- ============================================== service-role API access ====
reset role;
set local role service_role;
do $$
declare a record; n int; j jsonb;
begin
  -- Wrong secret: invalid, and the real quota is untouched.
  select * into a from public.api_authenticate('0123456789abcdef', pg_temp.hash('wrong'));
  if a.outcome <> 'invalid' or a.organization_id is not null then raise exception 'FAIL: wrong secret %', a; end if;
  select * into a from public.api_authenticate('ffffffffffffffff', pg_temp.hash('secret-one'));
  if a.outcome <> 'invalid' then raise exception 'FAIL: unknown prefix %', a; end if;
  -- Limit 2/minute: ok, ok, rate_limited.
  select * into a from public.api_authenticate('0123456789abcdef', pg_temp.hash('secret-one'));
  if a.outcome <> 'ok' or a.remaining <> 1 or a.organization_id <> pg_temp.fx('org') then raise exception 'FAIL: first auth %', a; end if;
  select * into a from public.api_authenticate('0123456789abcdef', pg_temp.hash('secret-one'));
  if a.outcome <> 'ok' or a.remaining <> 0 then raise exception 'FAIL: second auth %', a; end if;
  select * into a from public.api_authenticate('0123456789abcdef', pg_temp.hash('secret-one'));
  if a.outcome <> 'rate_limited' then raise exception 'FAIL: limit not enforced %', a; end if;
  if (select last_used_at from public.api_credentials where id = pg_temp.fx('cred')) is null then
    raise exception 'FAIL: last_used_at not recorded';
  end if;

  -- Published plans of the credential's own tenant only; drafts never.
  select count(*) into n from public.api_plans(pg_temp.fx('cred'), '2027-09-01', '2027-09-10', null, null, null, 50)
   where id in (pg_temp.fx('plan_pub'), pg_temp.fx('plan_draft'), pg_temp.fx('plan_other'));
  if n <> 1 then raise exception 'FAIL: plan listing returned % fixture plans', n; end if;
  if public.api_plan(pg_temp.fx('cred'), pg_temp.fx('plan_draft')) is not null then raise exception 'FAIL: draft readable'; end if;
  if public.api_plan(pg_temp.fx('cred'), pg_temp.fx('plan_other')) is not null then raise exception 'FAIL: other tenant readable'; end if;
  j := public.api_plan(pg_temp.fx('cred'), pg_temp.fx('plan_pub'));
  if jsonb_array_length(j -> 'times') <> 1 or jsonb_array_length(j -> 'items') <> 1 then raise exception 'FAIL: plan detail %', j; end if;
  if j::text like '%PRIVATE%' or j ? 'notes' then raise exception 'FAIL: plan detail leaks description/notes %', j; end if;
  -- Keyset pagination: after the published plan nothing in range follows.
  select count(*) into n from public.api_plans(pg_temp.fx('cred'), '2027-09-05', '2027-09-06', null,
    '2027-09-05 14:00+00', pg_temp.fx('plan_pub'), 50);
  if n <> 0 then raise exception 'FAIL: keyset page repeated rows'; end if;

  -- Songs: archived excluded; scope enforced.
  select count(*) into n from public.api_songs(pg_temp.fx('cred'), 'F17', null, 50);
  if n <> 1 then raise exception 'FAIL: songs returned %', n; end if;
  select count(*) into n from public.api_songs(pg_temp.fx('cred'), '%', null, 50) where title like 'F17%';
  if n <> 0 then raise exception 'FAIL: wildcard query not escaped'; end if;
  begin
    perform * from public.api_songs(pg_temp.fx('cred_plans'), null, null, 10);
    raise exception 'FAIL: plans-only credential read songs';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Revocation is effective on the next call.
set local role authenticated;
select pg_temp.as_user('owner');
select public.revoke_api_credential(pg_temp.fx('cred_plans'));
select public.revoke_api_credential(pg_temp.fx('cred_plans')); -- idempotent
reset role;
set local role service_role;
do $$ declare a record; begin
  select * into a from public.api_authenticate('3333333333333333', pg_temp.hash('secret-plans'));
  if a.outcome <> 'inactive' then raise exception 'FAIL: revoked credential %', a; end if;
  begin
    perform * from public.api_plans(pg_temp.fx('cred_plans'), '2027-01-01', '2028-01-01', null, null, null, 10);
    raise exception 'FAIL: revoked credential read plans';
  exception when sqlstate '28000' then null; end;
end $$;
reset role;

-- Issuer demoted → every credential they issued stops.
update public.organization_members set role = 'scheduler' where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('owner');
set local role service_role;
do $$ declare a record; begin
  select * into a from public.api_authenticate('0123456789abcdef', pg_temp.hash('secret-one'));
  if a.outcome <> 'inactive' then raise exception 'FAIL: demoted issuer credential %', a; end if;
end $$;
reset role;
update public.organization_members set role = 'owner' where organization_id = pg_temp.fx('org') and user_id = pg_temp.fx('owner');

-- ============================================================ webhooks =====
set local role authenticated;
select pg_temp.as_user('jordan');
do $$ begin
  perform public.create_webhook_endpoint(pg_temp.fx('org'), 'https://hooks.example.com/a', null, array['plan.published'], repeat('c', 40), 'abcd', 'wh-key-jordan');
  raise exception 'FAIL: scheduler registered a webhook';
exception when insufficient_privilege then null; end $$;

select pg_temp.as_user('owner');
do $$
declare r record; n int;
begin
  select * into r from public.create_webhook_endpoint(pg_temp.fx('org'), 'https://hooks.example.com/a', 'Display board',
    array['plan.unpublished', 'plan.published', 'plan.deleted'], repeat('c', 40), 'abcd', 'wh-key-owner-1');
  insert into f17_fx values ('ep', r.endpoint_id);
  select * into r from public.create_webhook_endpoint(pg_temp.fx('org'), 'https://hooks.example.com/a', 'again',
    array['plan.published', 'plan.deleted', 'plan.unpublished'], repeat('d', 40), 'zzzz', 'wh-key-owner-1');
  if not r.replayed or r.endpoint_id <> pg_temp.fx('ep') then raise exception 'FAIL: endpoint replay %', r; end if;
  begin
    perform public.create_webhook_endpoint(pg_temp.fx('org'), 'ftp://hooks.example.com', null, array['plan.published'], repeat('c', 40), 'abcd', 'wh-key-owner-ftp');
    raise exception 'FAIL: non-http url accepted';
  exception when check_violation then null; end;
  begin
    perform public.create_webhook_endpoint(pg_temp.fx('org'), 'https://hooks.example.com/b', null, array['people.updated'], repeat('c', 40), 'abcd', 'wh-key-owner-ev');
    raise exception 'FAIL: unknown event accepted';
  exception when check_violation then null; end;
  begin
    perform secret_ciphertext from public.webhook_endpoints limit 1;
    raise exception 'FAIL: ciphertext readable';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.webhook_events (organization_id, event_type, source_key, data)
    values (pg_temp.fx('org'), 'webhook.test', 'forged', '{}');
    raise exception 'FAIL: direct event insert allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- A member (Sam in org 1) sees no endpoints or deliveries; Sam's own org sees none of org 1's.
select pg_temp.as_user('sam');
do $$ declare n int; begin
  select count(*) into n from public.webhook_endpoints;
  if n <> 0 then raise exception 'FAIL: other tenant/member sees endpoints'; end if;
  begin
    perform public.send_webhook_test(pg_temp.fx('ep'));
    raise exception 'FAIL: member sent a test';
  exception when sqlstate 'P0002' then null; end;
end $$;
reset role;

-- Publication transitions record events; drafts and other edits do not.
update public.plans set title = 'Renamed draft' where id = pg_temp.fx('plan_draft');
update public.plans set title = 'Renamed published' where id = pg_temp.fx('plan_pub');
update public.plans set status = 'published' where id = pg_temp.fx('plan_draft');  -- plan.published
update public.plans set status = 'draft' where id = pg_temp.fx('plan_pub');        -- plan.unpublished
delete from public.plans where id = pg_temp.fx('plan_draft');                      -- plan.deleted (was published)
update public.plans set status = 'published' where id = pg_temp.fx('plan_other');  -- other tenant, no subscriber
do $$ declare n int; t text; begin
  select count(*), string_agg(event_type, ',' order by event_type) into n, t
    from public.webhook_events where organization_id = pg_temp.fx('org');
  if n <> 3 or t <> 'plan.deleted,plan.published,plan.unpublished' then raise exception 'FAIL: events % %', n, t; end if;
  if exists (select 1 from public.webhook_events where organization_id = pg_temp.fx('org2')) then
    raise exception 'FAIL: event recorded with no subscriber';
  end if;
  if exists (select 1 from public.webhook_events where data::text like '%Renamed%' or data ? 'title') then
    raise exception 'FAIL: event payload carries plan content';
  end if;
  select count(*) into n from public.webhook_deliveries where endpoint_id = pg_temp.fx('ep') and status = 'queued';
  if n <> 3 then raise exception 'FAIL: % queued deliveries', n; end if;
end $$;

-- Admin reads deliveries; a member does not.
set local role authenticated;
select pg_temp.as_user('owner');
do $$ begin
  if (select count(*) from public.webhook_deliveries where endpoint_id = pg_temp.fx('ep')) <> 3 then
    raise exception 'FAIL: admin cannot read deliveries';
  end if;
end $$;
select pg_temp.as_user('jordan');
do $$ begin
  if (select count(*) from public.webhook_deliveries) <> 0 then raise exception 'FAIL: scheduler reads deliveries'; end if;
end $$;
reset role;

-- Worker: claim, complete, retry, gone.
set local role service_role;
do $$
declare c record; ids uuid[]; v text; n int;
begin
  select array_agg(delivery_id order by occurred_at) into ids from public.claim_webhook_deliveries(10, 60);
  if cardinality(ids) <> 3 then raise exception 'FAIL: claimed %', cardinality(ids); end if;
  -- A second claim finds nothing (leased).
  select count(*) into n from public.claim_webhook_deliveries(10, 60);
  if n <> 0 then raise exception 'FAIL: double claim %', n; end if;
  -- Stale attempt number is ignored.
  v := public.complete_webhook_delivery(ids[1], 99, 'succeeded', 200, null, now(), 10, null);
  if v <> 'stale' then raise exception 'FAIL: stale completion %', v; end if;
  v := public.complete_webhook_delivery(ids[1], 1, 'succeeded', 204, null, now(), 10, null);
  if v <> 'succeeded' then raise exception 'FAIL: success %', v; end if;
  v := public.complete_webhook_delivery(ids[2], 1, 'retry', 503, 'http_503', now(), 10, null);
  if v <> 'queued' then raise exception 'FAIL: retry %', v; end if;
  if (select next_attempt_at from public.webhook_deliveries where id = ids[2]) < now() + interval '4 seconds' then
    raise exception 'FAIL: no backoff';
  end if;
  if (select count(*) from public.webhook_delivery_attempts where delivery_id in (ids[1], ids[2])) <> 2 then
    raise exception 'FAIL: attempts not recorded';
  end if;
  -- 410 Gone disables the endpoint; its waiting delivery is cancelled on the next claim.
  v := public.complete_webhook_delivery(ids[3], 1, 'gone', 410, 'http_410', now(), 10, null);
  if v <> 'failed' then raise exception 'FAIL: gone %', v; end if;
  if (select enabled or disabled_reason <> 'gone' from public.webhook_endpoints where id = pg_temp.fx('ep')) then
    raise exception 'FAIL: 410 did not disable';
  end if;
  update public.webhook_deliveries set next_attempt_at = now() where id = ids[2];
  select count(*) into n from public.claim_webhook_deliveries(10, 60);
  if n <> 0 or (select status from public.webhook_deliveries where id = ids[2]) <> 'cancelled' then
    raise exception 'FAIL: disabled endpoint still delivered';
  end if;
  -- No new events for a disabled endpoint.
  update public.plans set status = 'published' where id = pg_temp.fx('plan_pub');
  if exists (select 1 from public.webhook_events where data ->> 'plan_id' = pg_temp.fx('plan_pub')::text and event_type = 'plan.published') then
    raise exception 'FAIL: disabled endpoint subscribed';
  end if;
end $$;
reset role;

-- Re-enable (stale revision refused), retry a cancelled delivery, test ping, revoke.
set local role authenticated;
select pg_temp.as_user('owner');
do $$
declare rev int; d uuid; n int;
begin
  select revision into rev from public.webhook_endpoints where id = pg_temp.fx('ep');
  begin
    perform public.set_webhook_endpoint_enabled(pg_temp.fx('ep'), true, rev - 1);
    raise exception 'FAIL: stale revision accepted';
  exception when sqlstate 'PT409' then null; end;
  perform public.set_webhook_endpoint_enabled(pg_temp.fx('ep'), true, rev);
  select id into d from public.webhook_deliveries where endpoint_id = pg_temp.fx('ep') and status = 'cancelled' limit 1;
  perform public.retry_webhook_delivery(d);
  if (select status from public.webhook_deliveries where id = d) <> 'queued' then raise exception 'FAIL: retry'; end if;
  begin
    perform public.retry_webhook_delivery(d);
    raise exception 'FAIL: retrying a queued delivery accepted';
  exception when sqlstate 'PT409' then null; end;
  d := public.send_webhook_test(pg_temp.fx('ep'));
  if (select e.event_type from public.webhook_deliveries x join public.webhook_events e on e.id = x.event_id where x.id = d) <> 'webhook.test' then
    raise exception 'FAIL: test event';
  end if;
  perform public.revoke_webhook_endpoint(pg_temp.fx('ep'));
  select count(*) into n from public.webhook_deliveries where endpoint_id = pg_temp.fx('ep') and status = 'queued';
  if n <> 0 then raise exception 'FAIL: revoke left % queued', n; end if;
  begin
    perform public.send_webhook_test(pg_temp.fx('ep'));
    raise exception 'FAIL: test to revoked endpoint';
  exception when sqlstate 'PT409' then null; end;
end $$;
reset role;

-- Five permanently failed deliveries in a row disable an endpoint.
set local role authenticated;
select pg_temp.as_user('owner');
do $$ declare r record; begin
  select * into r from public.create_webhook_endpoint(pg_temp.fx('org'), 'https://hooks.example.com/f', null,
    array['plan.published'], repeat('c', 40), 'abcd', 'wh-key-owner-fail');
  insert into f17_fx values ('ep_fail', r.endpoint_id);
  for i in 1..5 loop perform public.send_webhook_test(r.endpoint_id); end loop;
end $$;
reset role;
set local role service_role;
do $$ declare c record; begin
  for c in select * from public.claim_webhook_deliveries(10, 60) loop
    perform public.complete_webhook_delivery(c.delivery_id, c.attempt, 'failed', 400, 'http_400', now(), 5, null);
  end loop;
  if (select enabled or disabled_reason <> 'failing' from public.webhook_endpoints where id = pg_temp.fx('ep_fail')) then
    raise exception 'FAIL: failing endpoint stayed enabled';
  end if;
end $$;
reset role;

select 'f17-developer-api: all checks passed' as result;
rollback;
