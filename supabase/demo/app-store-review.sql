-- ============================================================================
-- App Store review demo account.
--
-- Creates (or refreshes) a sign-in account for Apple's App Review team that
-- owns an isolated demo organization — "Demo Community Church" — with teams,
-- songs, upcoming plans and assignments, so every main screen has content.
--
-- Unlike supabase/seed.sql (local-only, wiped by `db reset`), this script is
-- meant to run against a real database, including production. It is
-- idempotent: re-running it resets the reviewer's password, re-confirms the
-- email and adds plans for any upcoming Sundays that don't exist yet. It never
-- deletes anything and touches only the demo organization's rows.
--
-- The whole script is ONE statement (a single DO block), so it runs atomically
-- through `supabase db query`, the dashboard SQL editor, or psql alike.
--
-- The credentials are never committed: substitute the two placeholders into a
-- temporary copy and run that (the password must not contain a single quote):
--
--   f=$(mktemp) && sed -e 's/__REVIEWER_EMAIL__/appreview@yourdomain.com/' \
--     -e 's/__REVIEWER_PASSWORD__/a-strong-password/' \
--     supabase/demo/app-store-review.sql > "$f" \
--     && supabase db query --linked -f "$f"; rm -f "$f"
--
-- See docs/operations/app-store-submission.md.
-- ============================================================================

do $$
declare
  v_email    text := lower(trim('__REVIEWER_EMAIL__'));
  v_password text := '__REVIEWER_PASSWORD__';
  v_org      constant uuid := 'a99e0000-0000-4000-8000-000000000001';
  v_reviewer uuid;
  u record;
  base_sunday date := (current_date + ((7 - extract(dow from current_date)::int) % 7))::date;
  i int;
  v_date date;
  v_plan uuid;
  service_start timestamptz;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'reviewer email "%" is not a valid email address — substitute __REVIEWER_EMAIL__', v_email;
  end if;
  -- Split so the placeholder substitution doesn't rewrite this check too.
  if v_password = '__REVIEWER_' || 'PASSWORD__' then
    raise exception 'substitute the reviewer password placeholder before running';
  end if;
  if length(v_password) < 8 then
    raise exception 'reviewer password must be at least 8 characters';
  end if;

  -- ----------------------------------------------------------- accounts ----
  -- The reviewer: reuse an existing account with this email, else create one.
  select id into v_reviewer from auth.users where lower(email) = v_email limit 1;

  if v_reviewer is null then
    v_reviewer := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_reviewer, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'App Review'),
      now(), now()
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           banned_until = null,
           updated_at = now()
     where id = v_reviewer;
  end if;

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_reviewer::text, v_reviewer,
    jsonb_build_object('sub', v_reviewer::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  ) on conflict do nothing;

  update public.profiles set full_name = coalesce(full_name, 'App Review') where id = v_reviewer;

  -- Teammates fill out the roster. They can't sign in: each gets a random,
  -- discarded password, and example.com never receives mail.
  for u in
    select * from (values
      ('a99e0000-0000-4000-8000-0000000000b1'::uuid, 'appreview.jordan@example.com', 'Jordan Blake'),
      ('a99e0000-0000-4000-8000-0000000000b2'::uuid, 'appreview.sam@example.com',    'Sam Rivera'),
      ('a99e0000-0000-4000-8000-0000000000b3'::uuid, 'appreview.riley@example.com',  'Riley Chen'),
      ('a99e0000-0000-4000-8000-0000000000b4'::uuid, 'appreview.morgan@example.com', 'Morgan Patel')
    ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', u.full_name),
      now(), now()
    ) on conflict (id) do nothing;

    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), u.id::text, u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email),
      'email', now(), now(), now()
    ) on conflict do nothing;
  end loop;

  -- ------------------------------------------------------- organization ----
  insert into public.organizations (id, name, slug, timezone)
  values (v_org, 'Demo Community Church', 'app-review-demo', 'America/Toronto')
  on conflict do nothing;

  insert into public.organization_members (organization_id, user_id, role) values
    (v_org, v_reviewer, 'owner'),
    (v_org, 'a99e0000-0000-4000-8000-0000000000b1', 'scheduler'),
    (v_org, 'a99e0000-0000-4000-8000-0000000000b2', 'member'),
    (v_org, 'a99e0000-0000-4000-8000-0000000000b3', 'member'),
    (v_org, 'a99e0000-0000-4000-8000-0000000000b4', 'member')
  on conflict do nothing;

  -- Re-running must leave the reviewer an active owner even if someone
  -- demoted or deactivated them in the meantime.
  update public.organization_members
     set role = 'owner', status = 'active'
   where organization_id = v_org and user_id = v_reviewer;

  insert into public.service_types (id, organization_id, name, description, sort_order) values
    ('a99e0000-0000-4000-8001-000000000001', v_org, 'Sunday Morning', 'Weekly 10am gathering', 0),
    ('a99e0000-0000-4000-8001-000000000002', v_org, 'Midweek Prayer', 'Wednesday evenings', 1)
  on conflict do nothing;

  -- -------------------------------------------------- teams & positions ----
  insert into public.teams (id, organization_id, service_type_id, name, color, sort_order) values
    ('a99e0000-0000-4000-8002-000000000001', v_org, 'a99e0000-0000-4000-8001-000000000001', 'Worship Band', '#6366f1', 0),
    ('a99e0000-0000-4000-8002-000000000002', v_org, 'a99e0000-0000-4000-8001-000000000001', 'Production',   '#0ea5e9', 1),
    ('a99e0000-0000-4000-8002-000000000003', v_org, 'a99e0000-0000-4000-8001-000000000001', 'Hospitality',  '#f59e0b', 2)
  on conflict do nothing;

  insert into public.team_positions (id, team_id, name, sort_order) values
    ('a99e0000-0000-4000-8003-000000000001', 'a99e0000-0000-4000-8002-000000000001', 'Worship Leader',  0),
    ('a99e0000-0000-4000-8003-000000000002', 'a99e0000-0000-4000-8002-000000000001', 'Acoustic Guitar', 1),
    ('a99e0000-0000-4000-8003-000000000003', 'a99e0000-0000-4000-8002-000000000001', 'Electric Guitar', 2),
    ('a99e0000-0000-4000-8003-000000000004', 'a99e0000-0000-4000-8002-000000000001', 'Bass',            3),
    ('a99e0000-0000-4000-8003-000000000005', 'a99e0000-0000-4000-8002-000000000001', 'Drums',           4),
    ('a99e0000-0000-4000-8003-000000000006', 'a99e0000-0000-4000-8002-000000000001', 'Keys',            5),
    ('a99e0000-0000-4000-8003-000000000007', 'a99e0000-0000-4000-8002-000000000002', 'Front of House',  0),
    ('a99e0000-0000-4000-8003-000000000008', 'a99e0000-0000-4000-8002-000000000002', 'Lyrics',          1),
    ('a99e0000-0000-4000-8003-000000000009', 'a99e0000-0000-4000-8002-000000000002', 'Camera',          2),
    ('a99e0000-0000-4000-8003-00000000000a', 'a99e0000-0000-4000-8002-000000000003', 'Greeter',         0)
  on conflict do nothing;

  insert into public.team_memberships (team_id, user_id, position_id) values
    ('a99e0000-0000-4000-8002-000000000001', v_reviewer, 'a99e0000-0000-4000-8003-000000000001'),
    ('a99e0000-0000-4000-8002-000000000001', v_reviewer, 'a99e0000-0000-4000-8003-000000000002'),
    ('a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8000-0000000000b2', 'a99e0000-0000-4000-8003-000000000003'),
    ('a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8000-0000000000b2', 'a99e0000-0000-4000-8003-000000000004'),
    ('a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8000-0000000000b3', 'a99e0000-0000-4000-8003-000000000005'),
    ('a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8000-0000000000b4', 'a99e0000-0000-4000-8003-000000000006'),
    ('a99e0000-0000-4000-8002-000000000002', 'a99e0000-0000-4000-8000-0000000000b1', 'a99e0000-0000-4000-8003-000000000007'),
    ('a99e0000-0000-4000-8002-000000000002', 'a99e0000-0000-4000-8000-0000000000b3', 'a99e0000-0000-4000-8003-000000000008'),
    ('a99e0000-0000-4000-8002-000000000003', 'a99e0000-0000-4000-8000-0000000000b4', 'a99e0000-0000-4000-8003-00000000000a')
  on conflict do nothing;

  -- ------------------------------------------------------------- songs -----
  -- Public-domain hymns only, so the review build shows no licensed lyrics.
  insert into public.songs (id, organization_id, title, author, ccli_number, default_key, default_bpm, meter, themes) values
    ('a99e0000-0000-4000-8004-000000000001', v_org, 'Amazing Grace', 'John Newton', '22025', 'G', 72, '3/4', '{grace,salvation,classic}'),
    ('a99e0000-0000-4000-8004-000000000002', v_org, 'Holy, Holy, Holy', 'Reginald Heber', '1156', 'D', 84, '4/4', '{trinity,adoration}'),
    ('a99e0000-0000-4000-8004-000000000003', v_org, 'Come Thou Fount of Every Blessing', 'Robert Robinson', '108389', 'D', 76, '4/4', '{grace,devotion}'),
    ('a99e0000-0000-4000-8004-000000000004', v_org, 'Be Thou My Vision', 'Traditional Irish', '30639', 'E', 68, '3/4', '{devotion,guidance}')
  on conflict do nothing;

  insert into public.arrangements (id, song_id, name, song_key, bpm, meter, length_seconds, sequence, chord_chart, is_default) values
    ('a99e0000-0000-4000-8005-000000000001', 'a99e0000-0000-4000-8004-000000000001', 'Band Arrangement', 'G', 72, '3/4', 285,
     '{V1,V2,V3}',
     '{title: Amazing Grace}
{key: G}
{tempo: 72}

{start_of_verse: Verse 1}
A[G]mazing grace how [C]sweet the [G]sound
That saved a wretch like [D]me
I [G]once was lost, but [C]now am [G]found
Was [Em]blind but [D]now I [G]see
{end_of_verse}

{start_of_verse: Verse 2}
''Twas [G]grace that taught my [C]heart to [G]fear
And grace my fears re[D]lieved
How [G]precious did that [C]grace ap[G]pear
The [Em]hour I [D]first be[G]lieved
{end_of_verse}', true),
    ('a99e0000-0000-4000-8005-000000000002', 'a99e0000-0000-4000-8004-000000000002', 'Default Arrangement', 'D', 84, '4/4', 240, '{V1,V2,V3,V4}', null, true),
    ('a99e0000-0000-4000-8005-000000000003', 'a99e0000-0000-4000-8004-000000000003', 'Default Arrangement', 'D', 76, '4/4', 300, '{V1,V2,V3}', null, true),
    ('a99e0000-0000-4000-8005-000000000004', 'a99e0000-0000-4000-8004-000000000004', 'Default Arrangement', 'E', 68, '3/4', 260, '{V1,V2,V3}', null, true)
  on conflict do nothing;

  -- ------------------------------------------------------------- plans -----
  -- The next four Sundays from today. Plan ids are derived from the date, so a
  -- re-run (e.g. before resubmitting a build weeks later) adds only the Sundays
  -- that are missing and leaves existing plans — and any reviewer edits — alone.
  for i in 0..3 loop
    v_date := base_sunday + (i * 7);
    -- md5 → uuid, with the version/variant nibbles forced to v4 so the id
    -- passes strict uuid validators in the API and clients.
    v_plan := overlay(overlay(md5('app-review-demo-plan:' || v_date::text) placing '4' from 13) placing '8' from 17)::uuid;
    service_start := (v_date + time '10:00') at time zone 'America/Toronto';

    insert into public.plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
    values (
      v_plan, v_org, 'a99e0000-0000-4000-8001-000000000001',
      to_char(v_date, 'FMMonth FMDD') || ' — Sunday Morning',
      service_start,
      'Main Auditorium',
      (case when i < 2 then 'published' else 'draft' end)::public.plan_status,
      case when i = 0 then 'Communion Sunday — leave space after the message.' else null end,
      v_reviewer
    )
    on conflict (id) do nothing;

    -- A plan seeded by an earlier run keeps its contents as they are; only a
    -- new plan gets its times, items and teammates.
    if found then
    insert into public.plan_times (plan_id, kind, name, starts_at, ends_at) values
      (v_plan, 'rehearsal', 'Band Rehearsal', service_start - interval '2 days' + interval '9 hours', service_start - interval '2 days' + interval '11 hours'),
      (v_plan, 'rehearsal', 'Soundcheck',     service_start - interval '90 minutes',                  service_start - interval '30 minutes'),
      (v_plan, 'service',   'Service',        service_start,                                          service_start + interval '90 minutes');

    insert into public.plan_items (plan_id, item_type, title, song_id, arrangement_id, key_override, length_seconds, description, sort_order) values
      (v_plan, 'header', 'Pre-Service',  null, null, null,   0, null, 0),
      (v_plan, 'item',   'Countdown',    null, null, null, 300, 'Roll the countdown video', 1),
      (v_plan, 'item',   'Welcome',      null, null, null, 180, null, 2),
      (v_plan, 'header', 'Worship Set',  null, null, null,   0, null, 3),
      (v_plan, 'song',   'Amazing Grace',                     'a99e0000-0000-4000-8004-000000000001', 'a99e0000-0000-4000-8005-000000000001', 'G', 285, null, 4),
      (v_plan, 'song',   'Holy, Holy, Holy',                  'a99e0000-0000-4000-8004-000000000002', 'a99e0000-0000-4000-8005-000000000002', 'D', 240, null, 5),
      (v_plan, 'song',   'Come Thou Fount of Every Blessing', 'a99e0000-0000-4000-8004-000000000003', 'a99e0000-0000-4000-8005-000000000003', 'D', 300, 'Modulate on the last verse', 6),
      (v_plan, 'header', 'Message',      null, null, null,    0, null, 7),
      (v_plan, 'item',   'Sermon',       null, null, null, 1800, null, 8),
      (v_plan, 'song',   'Be Thou My Vision', 'a99e0000-0000-4000-8004-000000000004', 'a99e0000-0000-4000-8005-000000000004', 'E', 260, 'Response song', 9);

    insert into public.assignments (plan_id, user_id, team_id, position_id, status, notified_at) values
      (v_plan, 'a99e0000-0000-4000-8000-0000000000b2', 'a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8003-000000000003', (case when i = 0 then 'confirmed' else 'unconfirmed' end)::public.assignment_status, now()),
      (v_plan, 'a99e0000-0000-4000-8000-0000000000b3', 'a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8003-000000000005', (case when i = 1 then 'declined'  else 'unconfirmed' end)::public.assignment_status, now()),
      (v_plan, 'a99e0000-0000-4000-8000-0000000000b4', 'a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8003-000000000006', 'unconfirmed', now()),
      (v_plan, 'a99e0000-0000-4000-8000-0000000000b1', 'a99e0000-0000-4000-8002-000000000002', 'a99e0000-0000-4000-8003-000000000007', 'confirmed',   now());
    end if;

    -- On every run, new plan or not, make sure the current reviewer leads
    -- worship: confirmed for the first Sunday, and left unconfirmed after
    -- that so they can try accepting/declining a request. (Matters when the
    -- reviewer email changes between runs.)
    insert into public.assignments (plan_id, user_id, team_id, position_id, status, notified_at)
    select v_plan, v_reviewer, 'a99e0000-0000-4000-8002-000000000001', 'a99e0000-0000-4000-8003-000000000001',
           (case when i = 0 then 'confirmed' else 'unconfirmed' end)::public.assignment_status, now()
     where not exists (select 1 from public.assignments where plan_id = v_plan and user_id = v_reviewer);
  end loop;

  raise notice 'App Store review demo account % is ready.', v_email;
end $$;
