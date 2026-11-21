-- QA wave 8 review fixes (follow-up to 20261127000002 .. 20261127000700, which are applied and
-- are not edited). Each section names the finding it closes.
--
--   1. Realtime: a person-level access loss (archive, unlink, child, delete) rotates EVERY keyed
--      conversation the linked account could reach, including through plan-leader / scheduler /
--      team-manager capabilities, not only the ones it reached through rosters and assignments.
--   2. Realtime: moving a team membership (UPDATE of team_id / person_id) is an access loss for
--      the old team's conversation, like deleting it.
--   3. team_roster_people: archived people are left out; children show name and avatar only;
--      output is ordered and keyed by (team_id, person_id).
--   4. Song length checks count UTF-16 code units and trim like JavaScript, so they agree with
--      the shared Zod schema; themes, song_types and default_key are checked too.
--   5. private.claim_plan_copy_key gets back the ACL it had before 20261127000004 recreated it.
--   6. update_plan_with_times only assigns the columns present in p_fields, so an `UPDATE OF`
--      trigger fires only when its column was actually sent.

-- ===================================================================================== 1 ===
-- private.can_access_conversation requires private.is_adult_person for every path into a
-- conversation. people_org_profile_unique allows one People row per account per organization, so
-- when that row stops being an unarchived adult linked to the account, the account loses every
-- conversation in the organization -- including the ones it reached as a plan leader, team
-- scheduler or team manager. 20261127000700 only rotated the conversations reached through the
-- row's team memberships and released assignments, and did not handle DELETE.
--
-- Which conversations to rotate: those the account could access before the change and cannot
-- after it. "Before" is evaluated after the fact without a BEFORE trigger:
--   * the trigger only fires when the old row was a linked, unarchived adult (otherwise the
--     account had no conversation access in this organization at all);
--   * the active-membership and capability paths (is_active_member, can_schedule_team,
--     can_manage_team, is_plan_leader) read organization_members / access_grants / plans /
--     teams only, which a People change does not touch, so their current value is their value
--     before the change;
--   * the roster / assignment paths are looked up by the old row's id.
-- That set is filtered by "cannot access now" (private.can_access_conversation), so a
-- conversation the account still reaches is left alone. Only conversations with a key row
-- (somebody was issued the topic) are considered, and private.rotate_conversation_realtime_key
-- still rotates each conversation at most once per transaction.
--
-- DELETE: team_memberships cascade before this trigger fires (the RI trigger sorts first and its
-- own team_memberships_realtime_rotate rotates those team chats); assignments are ON DELETE
-- RESTRICT, so a person with assignments cannot be deleted. The capability paths are covered here.
create or replace function private.rotate_on_person_access_loss()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := old.profile_id;
  v_org  uuid := old.organization_id;
begin
  -- No access to lose; or the organization itself is being deleted (its cascade removes the
  -- conversations and keys, and there is nobody left to notify).
  if v_user is null or old.archived_at is not null or old.person_type = 'child'
     or not private.is_active_member(v_user, v_org)
     or not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  perform private.rotate_conversation_realtime_key(k.conversation_id)
     from private.conversation_realtime_keys k
     join public.conversations c on c.id = k.conversation_id
    where c.organization_id = v_org
      and case c.kind
            when 'team' then
                 exists (select 1 from public.team_memberships tm
                          where tm.team_id = c.team_id and tm.person_id = old.id)
              or private.can_schedule_team(v_user, c.team_id)
              or private.can_manage_team(v_user, c.team_id)
            else
                 exists (select 1 from public.assignments a
                          where a.plan_id = c.plan_id and a.person_id = old.id
                            and a.visibility = 'released' and a.status <> 'declined')
              or private.is_plan_leader(v_user, c.plan_id)
          end
      and not private.can_access_conversation(v_user, c.id);
  return null;
end;
$$;
revoke all on function private.rotate_on_person_access_loss() from public, anon, authenticated;

-- Fire only when the old row granted conversation access (linked, unarchived, adult) and the
-- change ends that grant for the old account.
drop trigger people_realtime_rotate on public.people;
create trigger people_realtime_rotate
  after update of archived_at, profile_id, person_type on public.people
  for each row
  when (old.profile_id is not null and old.archived_at is null and old.person_type <> 'child'
        and (new.archived_at is not null
             or new.profile_id is distinct from old.profile_id
             or new.person_type = 'child'))
  execute function private.rotate_on_person_access_loss();

create trigger people_realtime_rotate_delete
  after delete on public.people
  for each row
  when (old.profile_id is not null and old.archived_at is null and old.person_type <> 'child')
  execute function private.rotate_on_person_access_loss();

-- ===================================================================================== 2 ===
-- team_memberships_update lets roster editors change team_id / person_id. Moving a row off a
-- team (or onto another person) loses the old team's conversation for the old person unless
-- they still reach it some other way (another position on the team, a scheduling grant...).
-- An old person who is unlinked, archived or a child held no conversation access to lose.
create function private.rotate_on_team_membership_move()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select pe.profile_id into v_user
    from public.people pe
   where pe.id = old.person_id and pe.archived_at is null and pe.person_type <> 'child';
  if v_user is null then
    return null;
  end if;
  perform private.rotate_conversation_realtime_key(c.id)
     from public.conversations c
    where c.kind = 'team' and c.team_id = old.team_id
      and not private.can_access_conversation(v_user, c.id);
  return null;
end;
$$;
revoke all on function private.rotate_on_team_membership_move() from public, anon, authenticated;

create trigger team_memberships_realtime_rotate_update
  after update of team_id, person_id on public.team_memberships
  for each row
  when (old.team_id is distinct from new.team_id or old.person_id is distinct from new.person_id)
  execute function private.rotate_on_team_membership_move();

-- ===================================================================================== 3 ===
-- Coordinator decision (2026-11-21): minors' contact details and date of birth are not shown to
-- other members. A person with person_type = 'child' is returned with name and avatar only
-- (email, phone, birthdate NULL) to every caller; owners still read the full row through
-- `people`. Archived people are not part of a team's visible roster and are left out.
--
-- Key: (team_id, person_id) is unique in the output. A person can hold several team_memberships
-- rows on one team (one per position); DISTINCT ON collapses them, and every returned column
-- comes from people / profiles (one row per person: profiles.id is the primary key), so the
-- collapsed rows are identical. Rows are ordered by (team_id, person_id), the key the API pages on
-- with .order('team_id').order('person_id').range().
create or replace function public.team_roster_people(p_org uuid)
returns table (
  team_id    uuid,
  person_id  uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  email      text,
  phone      text,
  birthdate  date
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (tm.team_id, p.id)
         tm.team_id, p.id, p.first_name, p.last_name, p.avatar_url,
         case when p.person_type = 'child' then null else coalesce(pr.email, p.email) end,
         case when p.person_type = 'child' then null else coalesce(pr.phone, p.phone) end,
         case when p.person_type = 'child' then null else p.birthdate end
    from public.team_memberships tm
    join public.teams t on t.id = tm.team_id and t.organization_id = p_org
    join public.people p on p.id = tm.person_id and p.organization_id = p_org
                        and p.archived_at is null
    left join public.profiles pr on pr.id = p.profile_id
   where public.is_org_member(p_org)
   order by tm.team_id, p.id;
$$;
revoke execute on function public.team_roster_people(uuid) from public, anon;
grant execute on function public.team_roster_people(uuid) to authenticated;

comment on function public.team_roster_people(uuid) is
  'W8-NAT-D1: name and avatar of every unarchived rostered person, plus email, phone and birthdate for adults only (minors'' contact details and date of birth are not shown to other members, decision 2026-11-21), for any active member of the organization. One row per (team_id, person_id), ordered by that key. Other People fields stay owner-only.';

-- ===================================================================================== 4 ===
-- The API parses song rows with the shared Zod schema (packages/shared/src/schemas/song.ts,
-- songFieldsSchema / curatedSongRowSchema). Zod's .trim() is String.prototype.trim and .max()
-- counts UTF-16 code units; Postgres length() counts code points and btrim() strips spaces only.
-- A title of 150 emoji passed the old check and failed Zod (library 500). These helpers measure
-- the way JavaScript does, so the checks below say exactly what Zod says.

-- String.prototype.trim: WhiteSpace (TAB, VT, FF, SP, NBSP, ZWNBSP, Zs) and LineTerminator
-- (LF, CR, LS, PS). Spelled out rather than \s, whose meaning depends on the database locale.
create function private.js_trim(p text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select regexp_replace(p,
    '^[\u0009\u000a\u000b\u000c\u000d    -     　﻿]+|[\u0009\u000a\u000b\u000c\u000d    -     　﻿]+$',
    '', 'g');
$$;

-- JavaScript string length: one unit per BMP code point, two per astral (surrogate pair).
create function private.utf16_length(p text)
returns integer
language sql immutable strict parallel safe
set search_path = ''
as $$
  select length(p) + length(regexp_replace(p, '[^\U00010000-\U0010FFFF]', '', 'g'));
$$;

-- songTag list: z.array(nonEmpty.max(40)).max(20) -- at most 20 non-null entries, each 1..40
-- units after trimming, and a plain one-dimensional array (a nested array is not a string list).
create function private.song_tags_valid(p text[])
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select p is null
      or (coalesce(array_ndims(p), 1) = 1
          and cardinality(p) <= 20
          and not exists (
            select 1 from unnest(p) as t(v)
             where v is null or private.utf16_length(private.js_trim(v)) not between 1 and 40));
$$;

-- Used inside CHECK constraints, so every role that writes songs must be able to execute them
-- (they read no data).
grant execute on function private.js_trim(text), private.utf16_length(text), private.song_tags_valid(text[])
  to public;

alter table public.songs
  drop constraint songs_title_len,
  drop constraint songs_author_len,
  drop constraint songs_ccli_len,
  drop constraint songs_copyright_len,
  drop constraint songs_admin_len,
  drop constraint songs_meter_len,
  drop constraint songs_style_len,
  drop constraint songs_speed_len,
  drop constraint songs_notes_len;

alter table public.songs
  add constraint songs_title_len       check (private.utf16_length(private.js_trim(title)) between 1 and 200) not valid,
  add constraint songs_author_len      check (author is null or private.utf16_length(private.js_trim(author)) <= 200) not valid,
  add constraint songs_ccli_len        check (ccli_number is null or private.utf16_length(private.js_trim(ccli_number)) <= 40) not valid,
  add constraint songs_copyright_len   check (copyright is null or private.utf16_length(private.js_trim(copyright)) <= 300) not valid,
  add constraint songs_admin_len       check (administration is null or private.utf16_length(private.js_trim(administration)) <= 300) not valid,
  add constraint songs_default_key_len check (default_key is null or private.utf16_length(private.js_trim(default_key)) <= 8) not valid,
  add constraint songs_meter_len       check (meter is null or private.utf16_length(private.js_trim(meter)) <= 20) not valid,
  add constraint songs_style_len       check (style is null or private.utf16_length(private.js_trim(style)) <= 40) not valid,
  add constraint songs_speed_len       check (speed is null or private.utf16_length(private.js_trim(speed)) <= 40) not valid,
  add constraint songs_notes_len       check (notes is null or private.utf16_length(private.js_trim(notes)) <= 4000) not valid,
  add constraint songs_themes_valid     check (private.song_tags_valid(themes)) not valid,
  add constraint songs_song_types_valid check (private.song_tags_valid(song_types)) not valid;

-- Validate (SHARE UPDATE EXCLUSIVE: reads and writes continue). A constraint that legacy rows
-- violate stays NOT VALID -- still enforced for every new write -- and a warning names it.
do $$
declare
  c text;
begin
  foreach c in array array['songs_title_len', 'songs_author_len', 'songs_ccli_len', 'songs_copyright_len',
                           'songs_admin_len', 'songs_default_key_len', 'songs_meter_len', 'songs_style_len',
                           'songs_speed_len', 'songs_notes_len', 'songs_themes_valid', 'songs_song_types_valid']
  loop
    begin
      execute format('alter table public.songs validate constraint %I', c);
    exception when check_violation then
      raise warning 'constraint % left NOT VALID: legacy rows exceed the limit', c;
    end;
  end loop;
end $$;

-- ===================================================================================== 5 ===
-- 20261016000200 revoked claim_plan_copy_key from PUBLIC and granted it to authenticated;
-- 20261127000004 dropped and recreated it (new p_request_hash argument), which reset the ACL to
-- the default PUBLIC execute.
revoke execute on function private.claim_plan_copy_key(uuid, text, text, uuid, uuid, text) from public;
grant execute on function private.claim_plan_copy_key(uuid, text, text, uuid, uuid, text) to authenticated;

-- ===================================================================================== 6 ===
-- Same contract as 20261127000003 (one transaction; times win over service_date when the time
-- list has a service time; expected_revision is checked by apply_plan_time_changes), but the
-- UPDATE assigns only the columns whose keys are present in p_fields. Assigning every column
-- made every `UPDATE OF` trigger (plans_queue_reminders, plans_webhook_status,
-- plans_mirror_notes, plans_realtime_rotate) fire on a title-only PATCH. The column list is a
-- fixed whitelist and values are passed as a parameter, never interpolated. Keys outside the
-- whitelist are ignored, as before; when none of the six is present nothing is written.
create or replace function public.update_plan_with_times(
  p_plan_id              uuid,
  p_fields               jsonb,
  p_times                jsonb default null,
  p_expected_revision    bigint default null,
  p_impact_hash          text default null,
  p_orphan_resolutions   jsonb default '[]',
  p_notify               boolean default true,
  p_effect_key           text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fields       jsonb := coalesce(p_fields, '{}'::jsonb);
  v_result       jsonb := '{}'::jsonb;
  v_has_service  boolean;
  v_set          text;
  v_updated      uuid;
begin
  if p_times is not null then
    v_result := public.apply_plan_time_changes(
      p_plan_id, p_times, p_expected_revision, p_impact_hash,
      coalesce(p_orphan_resolutions, '[]'::jsonb), coalesce(p_notify, true), p_effect_key);
    v_has_service := exists (
      select 1 from jsonb_array_elements(p_times) t
       where coalesce(t->>'kind', 'service') = 'service');
    if v_has_service then
      v_fields := v_fields - 'service_date';
    end if;
  end if;

  select string_agg(format('%I = %s', f.col, f.expr), ', ' order by f.ord) into v_set
    from (values
      (1, 'title',           '$1->>''title'''),
      (2, 'service_type_id', '($1->>''service_type_id'')::uuid'),
      (3, 'service_date',    '($1->>''service_date'')::timestamptz'),
      (4, 'location',        '$1->>''location'''),
      (5, 'status',          '($1->>''status'')::public.plan_status'),
      (6, 'notes',           '$1->>''notes''')
    ) as f(ord, col, expr)
   where v_fields ? f.col;

  if v_set is not null then
    execute format('update public.plans p set %s where p.id = $2 returning p.id', v_set)
       into v_updated
      using v_fields, p_plan_id;
    if v_updated is null then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;
  return v_result;
end;
$$;
revoke execute on function public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text) from public, anon;
grant execute on function public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text) to authenticated;
