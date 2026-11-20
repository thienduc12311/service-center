-- PERF-006. Run against a seeded, isolated local database with ON_ERROR_STOP.
begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('00600000-0000-4000-8000-000000000001', 'perf-org-admin@example.test', '{"full_name":"Context Admin"}');
insert into private.platform_admins (user_id) values ('00600000-0000-4000-8000-000000000001');

insert into public.organizations (id, name, slug) values
  ('00600000-0000-4000-8000-000000000002', 'Second Church', 'perf-second-church'),
  ('00600000-0000-4000-8000-000000000003', 'Foreign Church', 'perf-foreign-church');
insert into public.organization_members (organization_id, user_id, role) values
  ('00600000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'owner'),
  ('00600000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'member'),
  ('00600000-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444', 'owner');

insert into public.access_grants (organization_id, user_id, capability, scope_type, team_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
        'teams.manage', 'team', 'cccccccc-0000-4000-8000-000000000001');

do $$
begin
  if has_function_privilege('anon', 'public.my_org_context(uuid,boolean)', 'execute')
     or has_function_privilege('service_role', 'public.my_org_context(uuid,boolean)', 'execute') then
    raise exception 'Only authenticated callers should be allowed to resolve organization context';
  end if;
end;
$$;

set local role authenticated;
do $$
begin
  if public.my_org_context(p_all => true) is distinct from '{"memberships":[],"disabled_organizations":[]}'::jsonb then
    raise exception 'A request without auth.uid() returned organization context';
  end if;
end;
$$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  ctx jsonb := public.my_org_context();
begin
  if jsonb_array_length(ctx->'memberships') <> 1
     or not ctx->'memberships' @> '[{"role":"owner","organization":null,"access":[{"source":"role:owner","capability":"people.manage"}]}]'::jsonb then
    raise exception 'A sole active membership should resolve owner access without the organization record';
  end if;
end;
$$;

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  riverside constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  second_church constant uuid := '00600000-0000-4000-8000-000000000002';
  foreign_church constant uuid := '00600000-0000-4000-8000-000000000003';
  ctx jsonb;
  membership jsonb;
  expected_access jsonb;
begin
  -- No implicit org with several memberships, or if the selected org is foreign.
  foreach ctx in array array[public.my_org_context(), public.my_org_context(foreign_church)]
  loop
    if jsonb_array_length(ctx->'memberships') <> 2
       or exists (select 1 from jsonb_array_elements(ctx->'memberships') m
                   where m->>'organization_id' = foreign_church::text or m->'access' <> '[]'::jsonb) then
      raise exception 'Ambiguous or foreign selection returned unauthorized organization context';
    end if;
  end loop;

  ctx := public.my_org_context(riverside);
  if not ctx->'memberships' @> jsonb_build_array(
       jsonb_build_object('organization_id', riverside, 'access',
         '[{"capability":"teams.manage","scope_type":"team","scope_id":"cccccccc-0000-4000-8000-000000000001","source":"grant"}]'::jsonb),
       jsonb_build_object('organization_id', second_church, 'access', '[]'::jsonb))
     or exists (select 1 from jsonb_array_elements(ctx->'memberships') m
                 where m->>'organization_id' = second_church::text and m->'access' <> '[]'::jsonb) then
    raise exception 'Explicit selection should resolve scoped access for only the selected org';
  end if;

  ctx := public.my_org_context(p_all => true);
  for membership in select m from jsonb_array_elements(ctx->'memberships') m
  loop
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into expected_access
      from public.my_effective_access((membership->>'organization_id')::uuid) a;
    if not (membership->'access' @> expected_access and expected_access @> (membership->'access'))
       or membership->'organization' is distinct from
          (select to_jsonb(o) from public.organizations o where id = (membership->>'organization_id')::uuid) then
      raise exception 'All-org context diverges from existing organization or access reads';
    end if;
  end loop;
  if jsonb_array_length(ctx->'memberships') <> 2 then
    raise exception 'All-org context should have two memberships';
  end if;
end;
$$;
reset role;

delete from public.access_grants
 where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = '33333333-3333-4333-8333-333333333333';
select public.set_organization_platform_status(
  '00600000-0000-4000-8000-000000000001', '00600000-0000-4000-8000-000000000002', 'disabled', 'Context test'
);
select * from public.grant_platform_access(
  '00600000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 1
);

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  ctx jsonb := public.my_org_context();
begin
  if jsonb_array_length(ctx->'memberships') <> 1 or ctx->'memberships'->0->'access' <> '[]'::jsonb
     or not ctx->'disabled_organizations' @> '[{"organization_name":"Second Church","role":"owner","disabled_reason":"Context test"}]'::jsonb then
    raise exception 'Revoked grant or disabled owner context did not update on the next call';
  end if;
end;
$$;

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$
declare
  ctx jsonb := public.my_org_context('00600000-0000-4000-8000-000000000002');
begin
  if jsonb_array_length(ctx->'memberships') <> 2
     or not ctx->'disabled_organizations' @> '[{"organization_name":"Second Church","role":"member","disabled_reason":null}]'::jsonb then
    raise exception 'Disabled organization reason should be redacted for members';
  end if;
end;
$$;

set local request.jwt.claim.sub = '00600000-0000-4000-8000-000000000001';
do $$
declare
  membership jsonb := public.my_org_context(p_all => true)->'memberships'->0;
begin
  if (membership->>'platform_access_expires_at')::timestamptz is distinct from now() + interval '1 hour'
     or not membership @> '{"role":"owner","access":[{"capability":"people.manage","source":"role:owner"}]}'::jsonb then
    raise exception 'Temporary owner should have owner access and carry its expiration timestamp';
  end if;
end;
$$;
reset role;

update public.organization_members set platform_access_expires_at = now()
 where user_id = '00600000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  if public.my_org_context('aaaaaaaa-0000-4000-8000-000000000001') is distinct from
     '{"memberships":[],"disabled_organizations":[]}'::jsonb then
    raise exception 'An expired platform owner still resolved as a member';
  end if;
end;
$$;

reset role;
update public.organization_members set status = 'inactive'
 where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
begin
  if public.my_org_context('aaaaaaaa-0000-4000-8000-000000000001')->'memberships' is distinct from '[]'::jsonb then
    raise exception 'The deactivated membership still resolves';
  end if;
end;
$$;

rollback;
