-- Flexible plan generation: a larger, still bounded batch.
--
-- * The API now expands weekly, monthly-by-weekday and monthly-by-day
--   recurrences (packages/shared `lib/plan-recurrence.ts`) and sends up to
--   52 plans per batch (was 12). The database stays the last check: between
--   1 and 52 plans, local dates strictly ascending (so no duplicates), and
--   every date within 731 days (two years) of the first.
-- * The cap was measured in a rolled-back local transaction with a template
--   of 25 items (8 songs), 10 needs over 3 teams, a 9-person roster and 2
--   times: `generate_plans_from_template` took ~1.04 s for 52 plans and
--   `preview_plan_generation` ~0.46 s, linear at ~20 ms per plan — well
--   under the signed-in 8 s statement timeout. Before this migration the
--   same 52-plan commit took ~2.1 s.
-- * Most of that difference: `private.canonical_song_content` (F15 song
--   merge, run once per proposed plan through `plan_template_preview`)
--   joined template items to `public.songs` with a sequential scan of every
--   organization's songs, evaluating the songs RLS policy per row (~26 ms
--   per plan with ~200 songs; it grows with the whole table). It now looks
--   up only the songs the items name, by primary key. Same result, same
--   invoker rights and RLS.
-- * No table, column, policy or grant changes. Both functions keep their
--   signatures, so existing grants stay in place.

-- ------------------------------------------------- canonical song content --

create or replace function private.canonical_song_content(p_content jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select case when jsonb_typeof(p_content -> 'items') = 'array' then jsonb_set(p_content, '{items}', coalesce((
   with e as materialized (
     select value, ordinality, nullif(value ->> 'song_id', '')::uuid as song_id
       from jsonb_array_elements(p_content -> 'items') with ordinality
   ), s as materialized (
     -- An = ANY(array) of the named ids is an index scan on songs_pkey; a
     -- join let the planner scan every song through RLS.
     select x.id, x.merged_into_song_id, x.merged_default_arrangement_id
       from public.songs x
      where x.id = any(array(select e.song_id from e where e.song_id is not null))
   )
   select jsonb_agg(case when s.merged_into_song_id is not null then e.value || jsonb_build_object(
     'song_id', s.merged_into_song_id,
     'arrangement_id', coalesce(nullif(e.value ->> 'arrangement_id', '')::uuid, s.merged_default_arrangement_id))
     else e.value end order by e.ordinality)
   from e left join s on s.id = e.song_id), '[]')) else p_content end
$$;

-- ------------------------------------------------------ bounded generation

-- p_plans: [{local_date 'YYYY-MM-DD', title, service_date, times:[{starts_at, ends_at}]}]
-- resolved by the API from the template's wall-clock times in the
-- organization's timezone; each is re-verified against that intent here.
-- Dates must be strictly ascending and span at most 731 days. Keep the cap
-- and span in step with MAX_GENERATED_PLANS / MAX_SERIES_SPAN_DAYS.
create or replace function private.plan_generation_preview(
  p_org         uuid,
  p_revision_id uuid,
  p_components  text[],
  p_plans       jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tpl     public.plan_templates;
  v_tz      text;
  v_el      jsonb;
  v_date    date;
  v_service timestamptz;
  v_title   text;
  v_rows    jsonb := '[]'::jsonb;
  v_preview jsonb;
  v_first   date;
  v_prev    date;
begin
  select t.* into v_tpl
    from public.plan_template_revisions r join public.plan_templates t on t.id = r.template_id
   where r.id = p_revision_id and t.organization_id = p_org;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.kind <> 'plan' then
    perform private.f10_bad('Only a plan template can create plans');
  end if;
  if p_plans is null or jsonb_typeof(p_plans) <> 'array' or jsonb_array_length(p_plans) not between 1 and 52 then
    perform private.f10_bad('Create between 1 and 52 plans at a time');
  end if;
  select timezone into v_tz from public.organizations where id = p_org;

  for v_el in select value from jsonb_array_elements(p_plans) loop
    begin
      v_date := (v_el ->> 'local_date')::date;
      v_service := (v_el ->> 'service_date')::timestamptz;
    exception when others then
      perform private.f10_bad('Each plan needs a date');
    end;
    if v_date is null or v_service is null or (v_service at time zone v_tz)::date <> v_date then
      perform private.f10_bad('Preview the dates again');
    end if;
    if v_date = v_prev then
      perform private.f10_bad(format('%s is listed twice', v_date));
    end if;
    if v_date < v_prev then
      perform private.f10_bad('List the plans in date order');
    end if;
    v_first := coalesce(v_first, v_date);
    if v_date - v_first > 731 then
      perform private.f10_bad('Plans must fall within two years of the first date');
    end if;
    v_prev := v_date;
    v_title := nullif(btrim(v_el ->> 'title'), '');
    if v_title is null or char_length(v_title) > 200 then
      perform private.f10_bad('Each plan needs a title of at most 200 characters');
    end if;
    v_preview := private.plan_template_preview(
      p_org, v_tpl.service_type_id, null, v_date, p_revision_id, 'append',
      array(select distinct c from unnest(p_components || array['times']) c order by c),
      coalesce(v_el -> 'times', '[]'::jsonb), null);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'local_date', v_date, 'title', v_title, 'service_date', v_service, 'preview', v_preview,
      'existing_plans', coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.service_date, p.id)
          from public.plans p
         where p.organization_id = p_org and p.service_type_id is not distinct from v_tpl.service_type_id
           and (p.service_date at time zone v_tz)::date = v_date
      ), '[]'::jsonb)));
  end loop;

  return jsonb_build_object(
    'template_id', v_tpl.id, 'service_type_id', v_tpl.service_type_id, 'revision_id', p_revision_id,
    'timezone', v_tz, 'plans', v_rows);
end;
$$;
