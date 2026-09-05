-- ============================================================================
-- Demo data. Applied automatically by `supabase db reset`.
-- All demo accounts use the password: password123
-- ============================================================================

-- pgcrypto (crypt/gen_salt) lives in `extensions` on Supabase.
set search_path = public, extensions;

-- ------------------------------------------------------------- accounts ----
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'avery@example.com',  'Avery Nguyen'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'jordan@example.com', 'Jordan Blake'),
      ('33333333-3333-4333-8333-333333333333'::uuid, 'sam@example.com',    'Sam Rivera'),
      ('44444444-4444-4444-8444-444444444444'::uuid, 'riley@example.com',  'Riley Chen'),
      ('55555555-5555-4555-8555-555555555555'::uuid, 'morgan@example.com', 'Morgan Patel')
    ) as t(id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, crypt('password123', gen_salt('bf')), now(),
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
end $$;

-- --------------------------------------------------------- organization ----
insert into organizations (id, name, slug, timezone) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Riverside Community Church', 'riverside', 'America/Toronto')
on conflict do nothing;

insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'scheduler'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'member'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'member'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'member')
on conflict do nothing;

insert into service_types (id, organization_id, name, description, sort_order) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sunday Morning', 'Weekly 10am gathering', 0),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Midweek Prayer', 'Wednesday evenings', 1)
on conflict do nothing;

-- ---------------------------------------------------- teams & positions ----
insert into teams (id, organization_id, service_type_id, name, color, sort_order) values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Worship Band', '#6366f1', 0),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Production',   '#0ea5e9', 1),
  ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Hospitality',  '#f59e0b', 2)
on conflict do nothing;

insert into team_positions (id, team_id, name, sort_order) values
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'Worship Leader',  0),
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001', 'Acoustic Guitar', 1),
  ('dddddddd-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000001', 'Electric Guitar', 2),
  ('dddddddd-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000001', 'Bass',            3),
  ('dddddddd-0000-4000-8000-000000000005', 'cccccccc-0000-4000-8000-000000000001', 'Drums',           4),
  ('dddddddd-0000-4000-8000-000000000006', 'cccccccc-0000-4000-8000-000000000001', 'Keys',            5),
  ('dddddddd-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-000000000002', 'Front of House',  0),
  ('dddddddd-0000-4000-8000-000000000008', 'cccccccc-0000-4000-8000-000000000002', 'Lyrics',          1),
  ('dddddddd-0000-4000-8000-000000000009', 'cccccccc-0000-4000-8000-000000000002', 'Camera',          2),
  ('dddddddd-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-000000000003', 'Greeter',         0)
on conflict do nothing;

insert into team_memberships (team_id, user_id, position_id) values
  ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'dddddddd-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'dddddddd-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'dddddddd-0000-4000-8000-000000000003'),
  ('cccccccc-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'dddddddd-0000-4000-8000-000000000004'),
  ('cccccccc-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'dddddddd-0000-4000-8000-000000000005'),
  ('cccccccc-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'dddddddd-0000-4000-8000-000000000006'),
  ('cccccccc-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'dddddddd-0000-4000-8000-000000000007'),
  ('cccccccc-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'dddddddd-0000-4000-8000-000000000008'),
  ('cccccccc-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'dddddddd-0000-4000-8000-00000000000a')
on conflict do nothing;

-- --------------------------------------------------------------- songs -----
insert into songs (id, organization_id, title, author, ccli_number, default_key, default_bpm, meter, themes) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Amazing Grace', 'John Newton', '22025', 'G', 72, '3/4', '{grace,salvation,classic}'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Holy, Holy, Holy', 'Reginald Heber', '1156', 'D', 84, '4/4', '{trinity,adoration}'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Come Thou Fount of Every Blessing', 'Robert Robinson', '108389', 'D', 76, '4/4', '{grace,devotion}'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'Be Thou My Vision', 'Traditional Irish', '30639', 'E', 68, '3/4', '{devotion,guidance}')
on conflict do nothing;

insert into arrangements (id, song_id, name, song_key, bpm, meter, length_seconds, sequence, chord_chart, is_default) values
  ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'Band Arrangement', 'G', 72, '3/4', 285,
   '{V1,V2,C,V3,C}',
   '{title: Amazing Grace}
{key: G}
{tempo: 72}

{start_of_verse: Verse 1}
A[G]mazing grace how [C]sweet the [G]sound
That saved a wretch like [D]me
I [G]once was lost, but [C]now am [G]found
Was [Em]blind but [D]now I [G]see
{end_of_verse}

{start_of_chorus}
My [C]chains are [G]gone, I''ve been set [D]free
My [Em]God my [C]Saviour has ransomed [G]me
{end_of_chorus}', true),
  ('ffffffff-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000002', 'Default Arrangement', 'D', 84, '4/4', 240, '{V1,V2,V3,V4}', null, true),
  ('ffffffff-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000003', 'Default Arrangement', 'D', 76, '4/4', 300, '{V1,V2,V3}', null, true),
  ('ffffffff-0000-4000-8000-000000000004', 'eeeeeeee-0000-4000-8000-000000000004', 'Default Arrangement', 'E', 68, '3/4', 260, '{V1,V2,V3}', null, true)
on conflict do nothing;

-- --------------------------------------------------------------- plans -----
-- Four upcoming Sundays, generated relative to today so the calendar is never
-- empty regardless of when the demo is seeded.
do $$
declare
  base_sunday date := (current_date + ((7 - extract(dow from current_date)::int) % 7))::date;
  i int;
  plan_id uuid;
  service_start timestamptz;
begin
  for i in 0..3 loop
    plan_id := gen_random_uuid();
    service_start := ((base_sunday + (i * 7)) + time '10:00')::timestamptz;

    insert into plans (id, organization_id, service_type_id, title, service_date, location, status, notes, created_by)
    values (
      plan_id,
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000001',
      to_char(base_sunday + (i * 7), 'FMMonth FMDD') || ' — Sunday Morning',
      service_start,
      'Main Auditorium',
      case when i = 0 then 'published' else 'draft' end,
      case when i = 0 then 'Communion Sunday — leave space after the message.' else null end,
      '11111111-1111-4111-8111-111111111111'
    );

    insert into plan_times (plan_id, kind, name, starts_at, ends_at) values
      (plan_id, 'rehearsal', 'Band Rehearsal', service_start - interval '2 days' + interval '9 hours', service_start - interval '2 days' + interval '11 hours'),
      (plan_id, 'rehearsal', 'Soundcheck',     service_start - interval '90 minutes',                  service_start - interval '30 minutes'),
      (plan_id, 'service',   'Service',        service_start,                                          service_start + interval '90 minutes');

    insert into plan_items (plan_id, item_type, title, song_id, arrangement_id, key_override, length_seconds, description, sort_order) values
      (plan_id, 'header', 'Pre-Service',  null, null, null,   0, null, 0),
      (plan_id, 'item',   'Countdown',    null, null, null, 300, 'Roll the countdown video', 1),
      (plan_id, 'item',   'Welcome',      null, null, null, 180, null, 2),
      (plan_id, 'header', 'Worship Set',  null, null, null,   0, null, 3),
      (plan_id, 'song',   'Amazing Grace',                    'eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001', 'G', 285, null, 4),
      (plan_id, 'song',   'Holy, Holy, Holy',                 'eeeeeeee-0000-4000-8000-000000000002', 'ffffffff-0000-4000-8000-000000000002', 'D', 240, null, 5),
      (plan_id, 'song',   'Come Thou Fount of Every Blessing','eeeeeeee-0000-4000-8000-000000000003', 'ffffffff-0000-4000-8000-000000000003', 'D', 300, 'Modulate on the last chorus', 6),
      (plan_id, 'header', 'Message',      null, null, null,   0, null, 7),
      (plan_id, 'item',   'Sermon',       null, null, null, 1800, null, 8),
      (plan_id, 'song',   'Be Thou My Vision','eeeeeeee-0000-4000-8000-000000000004', 'ffffffff-0000-4000-8000-000000000004', 'E', 260, 'Response song', 9);

    insert into assignments (plan_id, user_id, team_id, position_id, status, notified_at) values
      (plan_id, '11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'confirmed',   now()),
      (plan_id, '33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000003', case when i = 0 then 'confirmed' else 'unconfirmed' end, now()),
      (plan_id, '44444444-4444-4444-8444-444444444444', 'cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000005', case when i = 1 then 'declined'  else 'unconfirmed' end, now()),
      (plan_id, '55555555-5555-4555-8555-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000006', 'unconfirmed', now()),
      (plan_id, '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000007', 'confirmed',   now());
  end loop;
end $$;

-- ----------------------------------------------------------- blockouts -----
insert into blockouts (organization_id, user_id, starts_at, ends_at, reason) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444',
   (current_date + 14)::timestamptz, (current_date + 21)::timestamptz, 'Vacation'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555',
   (current_date + 6)::timestamptz, (current_date + 8)::timestamptz, 'Out of town')
on conflict do nothing;
