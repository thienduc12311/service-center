-- ============================================================================
-- Template authoring: copy a plan template (or section) into a new template.
--
-- duplicate_plan_template copies the source's CURRENT revision into a new
-- template (revision 1) with an optional new name and an optional new
-- service type. It goes through save_plan_template, so the copy gets exactly
-- the checks a hand-made template gets: plans.edit at the target scope, the
-- active-name uniqueness rule and plan_template_normalize on every reference.
--
-- What "applies there" means for staffing in the copy
--   needed position  the position still exists (not plan-only) in this
--                    organization, and its team serves the target service
--                    type (a service_type_teams row), or the team serves no
--                    service type at all (a general team)
--   roster entry     the same for its team (and its position, when set),
--                    and the Person is still active in the organization
--   An organization-wide target (service type null) accepts any team.
-- Entries that do not apply are never copied silently: without
-- p_drop_unavailable the function writes nothing and returns how many would
-- be left out, so the caller can ask the person first.
--
-- Access
--   source  read through the caller's own RLS (plan_templates_select:
--           plans.edit at its service type, or anywhere for an org-wide one);
--           another organization's template reads as not found
--   target  plans.edit at exactly the target scope (42501 otherwise), the
--           same rule as creating a template
-- Nothing is deleted or changed on the source.
-- ============================================================================

-- Whether one template staffing entry can be used in a template of
-- p_service_type. Definer: a Person hidden by people_owner_privacy still
-- counts as active, exactly as plan_template_normalize treats it. It answers
-- only yes/no about ids the caller already holds in a template they can read,
-- and is reached only from duplicate_plan_template after its write check.
create or replace function private.plan_template_entry_applies(
  p_org          uuid,
  p_service_type uuid,
  p_team         uuid,
  p_position     uuid,
  p_person       uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.teams t
            where t.id = p_team and t.organization_id = p_org
              and (
                p_service_type is null
                or exists (select 1 from public.service_type_teams stt
                            where stt.team_id = t.id and stt.service_type_id = p_service_type)
                or not exists (select 1 from public.service_type_teams stt where stt.team_id = t.id)
              )
         )
     and (p_position is null or exists (
           select 1 from public.team_positions tp
            where tp.id = p_position and tp.team_id = p_team and tp.plan_id is null
         ))
     and (p_person is null or exists (
           select 1 from public.people p
            where p.id = p_person and p.organization_id = p_org and p.archived_at is null
         ));
$$;
revoke execute on function private.plan_template_entry_applies(uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.plan_template_entry_applies(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.duplicate_plan_template(
  p_organization_id     uuid,
  p_template_id         uuid,
  p_name                text default null,
  -- False keeps the source's service type; true uses p_service_type_id
  -- (null there means every service type).
  p_change_service_type boolean default false,
  p_service_type_id     uuid default null,
  p_drop_unavailable    boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_src            public.plan_templates;
  v_content        jsonb;
  v_target         uuid;
  v_name           text;
  v_needs          jsonb;
  v_roster         jsonb;
  v_dropped_needs  int;
  v_dropped_roster int;
  v_saved          jsonb;
begin
  -- RLS decides whether the caller may read the source at all.
  select * into v_src from public.plan_templates
   where id = p_template_id and organization_id = p_organization_id;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  select r.content into v_content from public.plan_template_revisions r
   where r.template_id = v_src.id and r.revision = v_src.current_revision;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;

  v_target := case when p_change_service_type then p_service_type_id else v_src.service_type_id end;
  if v_target is not null and not exists (
    select 1 from public.service_types s where s.id = v_target and s.organization_id = p_organization_id
  ) then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  if not private.plan_template_access(v_uid, p_organization_id, v_target, true) then
    raise exception 'Only a plan editor for this service type can save templates' using errcode = '42501';
  end if;

  v_name := left(coalesce(nullif(btrim(p_name), ''), v_src.name || ' (copy)'), 120);
  if exists (
    select 1 from public.plan_templates t
     where t.organization_id = p_organization_id and t.kind = v_src.kind
       and t.service_type_id is not distinct from v_target
       and t.archived_at is null and lower(btrim(t.name)) = lower(btrim(v_name))
  ) then
    raise exception 'Another active template already uses this name' using errcode = '22023', hint = 'template_invalid';
  end if;

  select coalesce(jsonb_agg(e.value order by e.ord) filter (where e.applies), '[]'::jsonb),
         count(*) filter (where not e.applies)
    into v_needs, v_dropped_needs
    from (
      select n.value, n.ord,
             coalesce(private.plan_template_entry_applies(
               p_organization_id, v_target,
               (select tp.team_id from public.team_positions tp where tp.id = (n.value ->> 'position_id')::uuid),
               (n.value ->> 'position_id')::uuid, null), false) as applies
        from jsonb_array_elements(coalesce(nullif(v_content -> 'needs', 'null'::jsonb), '[]'::jsonb)) with ordinality n(value, ord)
    ) e;

  select coalesce(jsonb_agg(e.value order by e.ord) filter (where e.applies), '[]'::jsonb),
         count(*) filter (where not e.applies)
    into v_roster, v_dropped_roster
    from (
      select r.value, r.ord,
             coalesce(private.plan_template_entry_applies(
               p_organization_id, v_target,
               (r.value ->> 'team_id')::uuid,
               nullif(r.value ->> 'position_id', '')::uuid,
               (r.value ->> 'person_id')::uuid), false) as applies
        from jsonb_array_elements(coalesce(nullif(v_content -> 'roster', 'null'::jsonb), '[]'::jsonb)) with ordinality r(value, ord)
    ) e;

  if (v_dropped_needs > 0 or v_dropped_roster > 0) and not p_drop_unavailable then
    return jsonb_build_object(
      'template_id', null, 'revision', null,
      'unavailable', jsonb_build_object('needs', v_dropped_needs, 'roster', v_dropped_roster)
    );
  end if;

  v_content := v_content || jsonb_build_object('needs', v_needs, 'roster', v_roster);
  v_saved := public.save_plan_template(
    p_organization_id, null, null, v_src.kind, v_target, v_name, v_src.description, v_content, null, null
  );
  return v_saved || jsonb_build_object(
    'unavailable', jsonb_build_object('needs', v_dropped_needs, 'roster', v_dropped_roster)
  );
end;
$$;
revoke execute on function public.duplicate_plan_template(uuid, uuid, text, boolean, uuid, boolean) from public, anon;
grant execute on function public.duplicate_plan_template(uuid, uuid, text, boolean, uuid, boolean) to authenticated;
