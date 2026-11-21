-- Large-list UX (docs/plans/large-list-ux-review.md §5): search that ignores
-- accents and case, splits the query into words, and treats %, _ and \ as
-- plain text; songs list usage sorts/filters; media list computed in SQL.
--
-- Search model: every searchable table gets a stored, generated `search_text`
-- column = private.search_fold(<the fields it is searched by>), with a GIN
-- trigram index. A query is folded the same way, split on whitespace, and
-- every word must appear somewhere in search_text (AND). The fields are joined
-- with spaces and a word never contains a space, so this matches the client's
-- `matchesSearch(query, fields)` exactly.
--
-- Additive only: new columns, indexes, functions and appended view columns.
-- Adding a stored generated column rewrites the table once (ACCESS EXCLUSIVE
-- for the duration); these tables are small per organization.

-- ------------------------------------------------------------ extensions --
-- pg_trgm already exists (init migration, `public` schema); `if not exists`
-- leaves it where it is, so existing trigram indexes are untouched.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------- fold helpers --

-- Postgres' unaccent() is only STABLE (its dictionary could change), so it
-- cannot appear in a generated column or index. With the dictionary named
-- explicitly the result is fixed for a given input; this wrapper says so.
-- đ/Đ are mapped explicitly as well, to match the client's foldForSearch even
-- if the unaccent rules file changes. Lowercased last, so "Đ" -> "d".
create function private.search_fold(p_text text) returns text
language sql immutable strict parallel safe set search_path = '' as $$
  select lower(translate(extensions.unaccent('extensions.unaccent'::regdictionary, p_text), 'đĐ', 'dD'));
$$;
comment on function private.search_fold(text) is
  'Large-list search: unaccent + đ->d + lowercase. Immutable so generated search_text columns and their trigram indexes can use it.';

-- The LIKE patterns for a search query: one '%word%' per whitespace-separated
-- folded word, with \, % and _ escaped so user input is matched literally.
-- An empty or null query gives an empty array (`like all ('{}')` is true).
create function private.search_like_patterns(p_query text) returns text[]
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(array_agg(
      '%' || replace(replace(replace(t.word, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      order by t.ord), '{}')
    from regexp_split_to_table(private.search_fold(coalesce(p_query, '')), '\s+') with ordinality as t(word, ord)
   where t.word <> '';
$$;
comment on function private.search_like_patterns(text) is
  'Large-list search: the escaped %word% LIKE patterns of a query; every pattern must match (AND).';

-- Generated columns evaluate the function as the writing role, and the list
-- RPCs below run as the caller: both API roles need EXECUTE. Neither function
-- reads any table.
revoke all on function private.search_fold(text), private.search_like_patterns(text) from public, anon;
grant execute on function private.search_fold(text), private.search_like_patterns(text) to authenticated, service_role;

-- ------------------------------------------------------- search columns --

-- Songs: title, author and CCLI number. The first lyric line lives inside the
-- arrangements' chord charts (ChordPro text), not on the song, so it is not
-- part of search_text.
alter table public.songs add column search_text text generated always as (
  private.search_fold(title || ' ' || coalesce(author, '') || ' ' || coalesce(ccli_number, ''))
) stored;
create index songs_search_text_trgm on public.songs using gin (search_text gin_trgm_ops);

-- People: the name and campus, which every member may already read through
-- people_directory. Email/phone are private (owner-only column grants), so
-- they are NOT stored here; the owner-only people_owner_search view appends
-- them at read time instead.
alter table public.people add column search_text text generated always as (
  private.search_fold(first_name || ' ' || coalesce(last_name, '') || ' ' || coalesce(campus, ''))
) stored;
grant select (search_text) on public.people to authenticated;
create index people_search_text_trgm on public.people using gin (search_text gin_trgm_ops);

alter table public.media add column search_text text generated always as (private.search_fold(title)) stored;
create index media_search_text_trgm on public.media using gin (search_text gin_trgm_ops);

alter table public.plans add column search_text text generated always as (private.search_fold(title)) stored;
create index plans_search_text_trgm on public.plans using gin (search_text gin_trgm_ops);

-- ------------------------------------------------------------ people views --
-- Both views are re-created with columns appended (create or replace keeps
-- owner, grants and security_barrier). New columns:
--   search_text  what a search matches (see above; the owner view adds the
--                contact email/phone the People list displays)
--   listed       whether the People list shows the row: no login, or a login
--                whose membership is not inactive (the rule listPeoplePage has
--                always applied in code), so a total can be counted in SQL.

create or replace view public.people_directory
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.campus, p.person_type, p.created_at, p.updated_at,
         p.archived_at,
         (p.archived_at is null and (p.profile_id is null or exists (
            select 1 from public.organization_members m
             where m.organization_id = p.organization_id and m.user_id = p.profile_id
               and m.status = 'active'))) as schedulable,
         p.sort_name,
         p.search_text,
         (p.profile_id is null or exists (
            select 1 from public.organization_members m
             where m.organization_id = p.organization_id and m.user_id = p.profile_id
               and m.status <> 'inactive')) as listed
    from public.people p
   where public.is_org_member(p.organization_id);

revoke insert, update, delete, truncate, trigger, references
  on public.people_directory from authenticated, anon, public, service_role;
grant select on public.people_directory to authenticated, service_role;

create or replace view public.people_owner_search
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.email, p.phone, p.campus, p.archived_at, p.sort_name,
         coalesce(pr.email, p.email) as contact_email,
         coalesce(pr.phone, p.phone) as contact_phone,
         p.search_text || ' ' || private.search_fold(
           coalesce(pr.email, p.email, '') || ' ' || coalesce(pr.phone, p.phone, '')) as search_text,
         (p.profile_id is null or exists (
            select 1 from public.organization_members m
             where m.organization_id = p.organization_id and m.user_id = p.profile_id
               and m.status <> 'inactive')) as listed
    from public.people p
    left join public.profiles pr on pr.id = p.profile_id
   where private.is_people_owner(p.organization_id);

revoke all on public.people_owner_search from public, anon, authenticated, service_role;
grant select on public.people_owner_search to authenticated;

-- ------------------------------------------------------------ songs list --
-- Redefines F15's list_curated_songs (same signature and grants; still
-- SECURITY INVOKER, so songs, plans and plan_items RLS all apply).
--
-- New query keys:
--   q                    accent-insensitive, multi-word (AND), literal text,
--                        over title, author and CCLI number
--   sort                 + 'last_used' (last_scheduled_at desc nulls last, title)
--                        + 'most_used' (usage_count desc, title)
--   service_type_id      scopes usage_count and scheduled_from/scheduled_to
--   not_scheduled_since  only songs with no plan on/after that instant
--                        (never-scheduled songs included)
--   plan_id              rows get in_plan = true when that plan has the song
-- New row fields:
--   usage_count  distinct plans in the 12 weeks before now containing the song
--                (scoped by service_type_id when given)
--   in_plan      false when no plan_id is given
-- last_scheduled_at stays organization-wide (any plan, past or future).
--
-- Usage is aggregated in one pass over the organization's song plan items
-- (instead of a correlated subquery per song), and arrangements are attached
-- to the requested page only.
create or replace function public.list_curated_songs(p_org uuid, p_query jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  with params as (
    select coalesce(p_query->>'archive', 'active') as archive,
      coalesce(p_query->>'sort', 'title') as sort,
      private.search_like_patterns(p_query->>'q') as patterns,
      (p_query->>'service_type_id')::uuid as service_type_id,
      (p_query->>'plan_id')::uuid as plan_id,
      (p_query->>'not_scheduled_since')::timestamptz as not_scheduled_since,
      (p_query->>'scheduled_from')::timestamptz as scheduled_from,
      (p_query->>'scheduled_to')::timestamptz as scheduled_to,
      now() - interval '12 weeks' as usage_from,
      greatest(1, coalesce((p_query->>'page')::int, 1)) as page,
      greatest(1, least(200, coalesce((p_query->>'per_page')::int, 25))) as per_page
  ), usage as (
    select i.song_id,
      max(p.service_date) as last_scheduled_at,
      count(distinct p.id) filter (where p.service_date >= v.usage_from and p.service_date < now()
        and (v.service_type_id is null or p.service_type_id = v.service_type_id)) as usage_count,
      coalesce(bool_or(p.id = v.plan_id), false) as in_plan,
      coalesce(bool_or((v.service_type_id is null or p.service_type_id = v.service_type_id)
        and (v.scheduled_from is null or p.service_date >= v.scheduled_from)
        and (v.scheduled_to is null or p.service_date < v.scheduled_to)), false) as in_window
      from public.plan_items i
      join public.plans p on p.id = i.plan_id
     cross join params v
     where p.organization_id = p_org and i.song_id is not null
     group by i.song_id
  ), filtered as (
    select s.*, u.last_scheduled_at, coalesce(u.usage_count, 0) as usage_count, coalesce(u.in_plan, false) as in_plan
      from public.songs s
     cross join params v
      left join usage u on u.song_id = s.id
     where s.organization_id = p_org
       and case v.archive when 'active' then s.archived_at is null
         when 'archived' then s.archived_at is not null else true end
       and s.search_text like all (v.patterns)
       and (p_query->>'theme' is null or s.themes @> array[p_query->>'theme'])
       and (p_query->>'song_type' is null or s.song_types @> array[p_query->>'song_type'])
       and (p_query->>'style' is null or s.style = p_query->>'style')
       and (p_query->>'speed' is null or s.speed = p_query->>'speed')
       and (p_query->>'author' is null or s.author ilike '%' || replace(replace(replace(p_query->>'author', '\', '\\'), '%', '\%'), '_', '\_') || '%')
       -- Musical constraints must match the same active arrangement, or the song defaults.
       and ((p_query->>'key' is null and p_query->>'bpm_min' is null and p_query->>'bpm_max' is null)
         or ((p_query->>'key' is null or s.default_key = p_query->>'key')
           and (p_query->>'bpm_min' is null or s.default_bpm >= (p_query->>'bpm_min')::int)
           and (p_query->>'bpm_max' is null or s.default_bpm <= (p_query->>'bpm_max')::int))
         or exists (select 1 from public.arrangements a where a.song_id = s.id and a.archived_at is null
           and (p_query->>'key' is null or a.song_key = p_query->>'key')
           and (p_query->>'bpm_min' is null or a.bpm >= (p_query->>'bpm_min')::int)
           and (p_query->>'bpm_max' is null or a.bpm <= (p_query->>'bpm_max')::int)))
       and ((v.scheduled_from is null and v.scheduled_to is null) or coalesce(u.in_window, false))
       and (v.not_scheduled_since is null or u.last_scheduled_at is null or u.last_scheduled_at < v.not_scheduled_since)
  ), ordered as (
    select f.*, row_number() over (order by
      case when v.sort = 'recent' then f.updated_at end desc,
      case when v.sort = 'last_used' then f.last_scheduled_at end desc nulls last,
      case when v.sort = 'most_used' then f.usage_count end desc,
      case when v.sort <> 'recent' then f.title end,
      f.id) as rn
      from filtered f cross join params v
  ), page as (
    select o.* from ordered o cross join params v
     where o.rn > (v.page::bigint - 1) * v.per_page and o.rn <= v.page::bigint * v.per_page
  )
  select jsonb_build_object('page', v.page, 'per_page', v.per_page, 'total', (select count(*) from filtered),
    'data', coalesce((select jsonb_agg(
        (to_jsonb(pg) - 'rn' - 'search_text') || jsonb_build_object('arrangements', coalesce((
          select jsonb_agg(to_jsonb(a) order by a.is_default desc, a.name, a.id)
            from public.arrangements a where a.song_id = pg.id
             and (v.archive <> 'active' or a.archived_at is null)), '[]'::jsonb))
        order by pg.rn) from page pg), '[]'::jsonb))
    from params v;
$$;
revoke all on function public.list_curated_songs(uuid, jsonb) from public, anon;
grant execute on function public.list_curated_songs(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ media list --
-- The Media library list, computed in SQL so the archived filter applies
-- before the row cap and usage counts are exact. SECURITY INVOKER: media,
-- plan_items and plans RLS apply (usage counts only plans the caller sees,
-- as the item-by-item read did).
--
-- Query keys: q (search, as above), include_archived (boolean),
-- today (the organization's local date, which the API computes with its
-- invalid-timezone fallback; archive_on <= today means archived),
-- media_id (one bundle: the detail page's counts), limit (1..200, default 200).
-- Result: { media: [row + is_archived, usage_count, last_used_on], total, truncated }.
-- usage_count counts plan items (one plan can use a bundle twice), matching
-- the detail page's "used in" list; last_used_on is the latest service date.
create function public.list_media(p_org uuid, p_query jsonb default '{}') returns jsonb
language sql stable security invoker set search_path = '' as $$
  with params as (
    select coalesce((p_query->>'include_archived')::boolean, false) as include_archived,
      private.search_like_patterns(p_query->>'q') as patterns,
      (p_query->>'media_id')::uuid as media_id,
      coalesce((p_query->>'today')::date, current_date) as today,
      greatest(1, least(200, coalesce((p_query->>'limit')::int, 200))) as row_limit
  ), visible as (
    select m.*, (m.archived_at is not null or (m.archive_on is not null and m.archive_on <= v.today)) as is_archived
      from public.media m cross join params v
     where m.organization_id = p_org
       and m.search_text like all (v.patterns)
       and (v.media_id is null or m.id = v.media_id)
       and (v.include_archived or not (m.archived_at is not null or (m.archive_on is not null and m.archive_on <= v.today)))
  ), page as (
    select vis.* from visible vis order by vis.title, vis.id limit (select row_limit from params)
  ), usage as (
    select i.media_id, count(*) as usage_count, max(p.service_date) as last_used_on
      from public.plan_items i
      join public.plans p on p.id = i.plan_id
     where i.media_id in (select id from page)
     group by i.media_id
  ), counted as (select count(*) as total from visible)
  select jsonb_build_object(
    'total', c.total,
    'truncated', c.total > v.row_limit,
    'media', coalesce((select jsonb_agg(
        (to_jsonb(pg) - 'search_text') || jsonb_build_object(
          'usage_count', coalesce(u.usage_count, 0), 'last_used_on', u.last_used_on)
        order by pg.title, pg.id)
      from page pg left join usage u on u.media_id = pg.id), '[]'::jsonb))
    from params v cross join counted c;
$$;
revoke all on function public.list_media(uuid, jsonb) from public, anon;
grant execute on function public.list_media(uuid, jsonb) to authenticated;
