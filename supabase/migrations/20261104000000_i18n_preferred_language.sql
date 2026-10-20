-- i18n: a Person's preferred language per church, and the recipient language
-- captured on every newly queued delivery.
--
--   * `people.preferred_language` is nullable text. Null means "Automatic"
--     (follow the device), which is distinct from explicitly choosing
--     English, so existing people are not backfilled.
--   * Allowed codes are a check constraint, not an enum: adding a language is
--     an additive constraint replacement in a new migration, deployed before
--     any client offers that language. The codes must match the shared
--     registry (packages/shared/src/i18n/locales.ts); supabase/tests/i18n-
--     preferred-language.sql checks that they do.
--   * Managers edit the field through the existing people.manage policy.
--     Members edit only their own value, only through
--     set_my_language_preference(): the general people update policy is not
--     loosened, so self-service cannot touch names, contact, medical or link
--     columns.
--   * The field is readable wherever the full Person row already is (self,
--     people.view_private, people.manage) and is not part of the
--     people_directory projection.
--   * Deliveries record the recipient's language when queued (trigger), so
--     a retry renders the same text even if the preference changes later.
--     Deliveries queued before this migration keep a null locale and are
--     rendered in English.
--
-- Additive only: no data is rewritten. The constraints are added NOT VALID
-- and validated separately so the brief exclusive lock does not scan rows.

-- ========================================================= people ======

alter table public.people add column if not exists preferred_language text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'people_preferred_language_check'
       and conrelid = 'public.people'::regclass
  ) then
    alter table public.people
      add constraint people_preferred_language_check
      check (preferred_language in ('en', 'vi')) not valid;
  end if;
end $$;
alter table public.people validate constraint people_preferred_language_check;

comment on column public.people.preferred_language is
  'Canonical language code chosen for this church (en, vi); null = Automatic. Must match the shared locale registry.';

-- Column-level select, like every other readable people column (the medical
-- note stays unselectable). Row access is still decided by people_select.
grant select (preferred_language) on public.people to authenticated;

-- ============================================ self-service read/write ======

-- The caller's own preference in one church. Requires an active membership
-- there; the Person is found through the organization and the caller's own
-- login, never from a client-supplied Person id.
create or replace function public.my_language_preference(p_organization_id uuid)
returns table (person_linked boolean, preferred_language text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_members m
     where m.organization_id = p_organization_id and m.user_id = v_user and m.status = 'active'
  ) then
    -- Indistinguishable from an unknown church: membership is not leaked.
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  return query
    select true, p.preferred_language
      from public.people p
     where p.organization_id = p_organization_id and p.profile_id = v_user
     limit 1;
  if not found then
    -- A legacy member without a linked Person: Automatic, and saving is refused.
    return query select false, null::text;
  end if;
end;
$$;
revoke execute on function public.my_language_preference(uuid) from public, anon;
grant execute on function public.my_language_preference(uuid) to authenticated, service_role;

-- Saves only `preferred_language` on the caller's own Person in one church.
-- Returns person_linked = false (and changes nothing) when no Person is
-- linked; never creates a Person. Last successful write wins.
create or replace function public.set_my_language_preference(
  p_organization_id uuid,
  p_preferred_language text
)
returns table (person_linked boolean, preferred_language text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_preferred_language is not null and p_preferred_language not in ('en', 'vi') then
    raise exception 'Unsupported language' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members m
     where m.organization_id = p_organization_id and m.user_id = v_user and m.status = 'active'
  ) then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  return query
    update public.people p
       set preferred_language = p_preferred_language
     where p.organization_id = p_organization_id and p.profile_id = v_user
    returning true, p.preferred_language;
  if not found then
    return query select false, null::text;
  end if;
end;
$$;
revoke execute on function public.set_my_language_preference(uuid, text) from public, anon;
grant execute on function public.set_my_language_preference(uuid, text) to authenticated, service_role;

-- ===================================================== deliveries ======

alter table public.deliveries add column if not exists locale text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'deliveries_locale_check'
       and conrelid = 'public.deliveries'::regclass
  ) then
    alter table public.deliveries
      add constraint deliveries_locale_check
      check (locale in ('en', 'vi')) not valid;
  end if;
end $$;
alter table public.deliveries validate constraint deliveries_locale_check;

comment on column public.deliveries.locale is
  'Recipient language captured at enqueue (en, vi); retries reuse it. Null on pre-i18n deliveries, rendered in English.';

-- Every enqueue path (release, reminders, responses, messages, chat,
-- availability) inserts here, so capturing at insert covers all of them
-- without changing those functions. An explicit locale is kept.
create or replace function private.capture_delivery_locale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.locale is null then
    select p.preferred_language into new.locale
      from public.people p
     where p.id = new.recipient_person_id;
    new.locale := coalesce(new.locale, 'en');
  end if;
  return new;
end;
$$;
revoke execute on function private.capture_delivery_locale() from public, anon, authenticated;

drop trigger if exists deliveries_capture_locale on public.deliveries;
create trigger deliveries_capture_locale
  before insert on public.deliveries
  for each row execute function private.capture_delivery_locale();
