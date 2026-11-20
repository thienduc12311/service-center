-- One request-scoped read for membership selection, effective access, and
-- disabled-church messages. /me additionally needs full organization rows
-- and access for every active membership.
create function public.my_org_context(p_org uuid default null, p_all boolean default false)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with memberships as materialized (
    select m.organization_id, m.role, m.access_mode, m.platform_access_expires_at
      from public.organization_members m
     where m.user_id = (select auth.uid())
       and m.status = 'active'
       and (m.platform_access_expires_at is null or m.platform_access_expires_at > now())
  ), selected as (
    select coalesce(p_org, (select organization_id from memberships
                             where (select count(*) from memberships) = 1)) as id
  )
  select jsonb_build_object(
    'memberships', coalesce(
      (select jsonb_agg(to_jsonb(m) || jsonb_build_object(
        'organization', to_jsonb(o),
        'access', case when (p_all and o.id is not null) or m.organization_id = (select id from selected)
                  then coalesce(
                    (select jsonb_agg(to_jsonb(a)) from public.my_effective_access(m.organization_id) a),
                    '[]'::jsonb)
                  else '[]'::jsonb end
      ))
         from memberships m
         left join public.organizations o on p_all and o.id = m.organization_id),
      '[]'::jsonb),
    'disabled_organizations', coalesce(
      (select jsonb_agg(to_jsonb(d) order by d.organization_name) from public.my_disabled_organizations() d),
      '[]'::jsonb)
  );
$$;

revoke execute on function public.my_org_context(uuid, boolean) from public, anon, service_role;
grant execute on function public.my_org_context(uuid, boolean) to authenticated;
