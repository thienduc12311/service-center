-- ============================================================================
-- F09 Pass B — targeted operational messages.
--
-- A leader chooses an audience (members of teams they schedule, people with
-- confirmed/pending released requests on a plan, people who signed up for a
-- plan opening), previews the resolved Persons with duplicates merged and
-- people who cannot be reached listed, and then explicitly sends.
--
-- Contract
--   preview_operational_message(org, audience) → { audience_hash, recipients[] }
--     Sends nothing. The hash covers each Person, their reasons and whether
--     they are reachable, so a material change between preview and send is
--     refused (PT409 audience_changed) instead of silently mailing someone
--     the sender never reviewed.
--   send_operational_message(...) → { message_id, effect_id, replayed }
--     One transaction: message, versioned recipient snapshot (who, why,
--     included/excluded and the name used for variables), one F00 outbox
--     effect and one delivery per reachable Person per channel. Replaying the
--     same idempotency key returns the first send; the same key with
--     different content is refused.
--   Subject/body may use an allowlisted set of {{variables}}; any other
--   variable is refused. Values are stored at send time and escaped when the
--   email is rendered.
--   The delivery worker rechecks, per recipient, that they are still an
--   active, non-archived member and still in the audience for at least one
--   reason before sending. The recipient snapshot itself is never rewritten.
--   Reading a message later is allowed for its sender, administrators and
--   recipients who are still active members.
--   Scheduler Reply-To: the email's Reply-To is the sender. Replies are
--   ordinary email; no inbound email is ingested.
-- ============================================================================

alter type public.delivery_template add value if not exists 'operational_message';
alter type public.notification_type add value if not exists 'operational_message';

-- --------------------------------------------------------- templates -------

create table public.message_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Null: shared with every sender in the organization. Otherwise personal.
  owner_id         uuid references public.profiles (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  subject          text not null check (char_length(btrim(subject)) between 1 and 200),
  body             text not null check (char_length(btrim(body)) between 1 and 8000),
  revision         int not null default 1 check (revision > 0),
  archived_at      timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index message_templates_name_key
  on public.message_templates (organization_id, owner_id, lower(btrim(name))) nulls not distinct
  where archived_at is null;
create index message_templates_owner_idx on public.message_templates (owner_id);
create index message_templates_created_by_idx on public.message_templates (created_by);
create index message_templates_updated_by_idx on public.message_templates (updated_by);

create or replace function private.message_template_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger message_templates_revision before update on public.message_templates
  for each row execute function private.message_template_revision();

-- May send operational messages at all (some scheduling or team scope).
create or replace function private.can_send_messages(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.capability_anywhere(p_user, p_org, 'scheduling.manage')
      or private.capability_anywhere(p_user, p_org, 'teams.manage');
$$;
revoke execute on function private.can_send_messages(uuid, uuid) from public, anon;
grant execute on function private.can_send_messages(uuid, uuid) to authenticated, service_role;

-- A shared template is maintained by organization-wide schedulers/admins; a
-- personal one by its owner while they may still send.
create or replace function private.can_write_message_template(p_user uuid, p_org uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_owner is null then private.capability_for(p_user, p_org, 'scheduling.manage', null, null)
    else p_owner = p_user and private.can_send_messages(p_user, p_org)
  end;
$$;
revoke execute on function private.can_write_message_template(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_write_message_template(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------- messages -------

create table public.operational_messages (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  plan_id              uuid,
  -- The reviewed selection: { plan_id, team_ids, include }.
  audience             jsonb not null,
  audience_hash        text not null check (char_length(audience_hash) = 32),
  -- Content identity for idempotent replays.
  request_hash         text not null check (char_length(request_hash) = 32),
  subject              text not null check (char_length(btrim(subject)) between 1 and 200),
  body                 text not null check (char_length(btrim(body)) between 1 and 8000),
  -- Non-recipient variable values captured at send time.
  variables            jsonb not null default '{}',
  template_id          uuid references public.message_templates (id) on delete set null,
  template_revision    int,
  recipient_count      int not null check (recipient_count >= 0),
  excluded_count       int not null check (excluded_count >= 0),
  idempotency_key      text not null check (char_length(idempotency_key) between 8 and 200),
  created_by           uuid not null references public.profiles (id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint operational_messages_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete set null (plan_id),
  constraint operational_messages_key unique (organization_id, created_by, idempotency_key)
);
create unique index operational_messages_id_org_key on public.operational_messages (id, organization_id);
create index operational_messages_org_created_idx on public.operational_messages (organization_id, created_at desc);
create index operational_messages_plan_idx on public.operational_messages (plan_id) where plan_id is not null;
create index operational_messages_created_by_idx on public.operational_messages (created_by, created_at desc);
create index operational_messages_template_idx on public.operational_messages (template_id) where template_id is not null;

create table public.operational_message_recipients (
  message_id       uuid not null,
  organization_id  uuid not null,
  person_id        uuid not null references public.people (id) on delete cascade,
  -- Snapshot at send time; never rewritten when membership later changes.
  profile_id       uuid references public.profiles (id) on delete set null,
  first_name       text not null,
  last_name        text,
  reasons          text[] not null,
  has_login        boolean not null,
  has_email        boolean not null,
  status           text not null check (status in ('included', 'excluded_no_address', 'excluded_by_sender')),
  primary key (message_id, person_id),
  constraint operational_message_recipients_message_fk foreign key (message_id, organization_id)
    references public.operational_messages (id, organization_id) on delete cascade
);
create index operational_message_recipients_person_idx on public.operational_message_recipients (person_id);
create index operational_message_recipients_profile_idx on public.operational_message_recipients (profile_id) where profile_id is not null;
create index operational_message_recipients_organization_idx on public.operational_message_recipients (organization_id);

alter table public.delivery_effects
  add column operational_message_id uuid references public.operational_messages (id) on delete cascade;
create index delivery_effects_operational_message_idx on public.delivery_effects (operational_message_id)
  where operational_message_id is not null;

alter table public.notifications
  add column operational_message_id uuid references public.operational_messages (id) on delete cascade;
create index notifications_operational_message_idx on public.notifications (operational_message_id)
  where operational_message_id is not null;

-- ----------------------------------------------------------- variables -----
-- The allowlist. Kept in step with MESSAGE_TEMPLATE_VARIABLES in
-- @service-center/shared.
create or replace function private.message_unknown_variables(p_text text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1]), '{}')
    from regexp_matches(coalesce(p_text, ''), '\{\{\s*([^{}\s]*)\s*\}\}', 'g') m
   where m[1] not in ('first_name', 'last_name', 'full_name', 'organization_name',
                      'plan_title', 'plan_date', 'sender_name');
$$;
revoke execute on function private.message_unknown_variables(text) from public, anon;
grant execute on function private.message_unknown_variables(text) to authenticated, service_role;

-- ------------------------------------------------------------ audience -----
-- Resolves an audience for the signed-in caller. Every named team and plan
-- must be one the caller schedules (or manages, for team members); anything
-- else is "not found", so the call cannot be used to probe other scopes.
-- Prepared (unreleased) requests never count.
create or replace function private.resolve_message_audience(p_user uuid, p_org uuid, p_audience jsonb)
returns table (person_id uuid, reasons text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan    uuid := nullif(p_audience->>'plan_id', '')::uuid;
  v_teams   uuid[] := coalesce((select array_agg(distinct t::uuid) from jsonb_array_elements_text(coalesce(p_audience->'team_ids', '[]')) t), '{}');
  v_include text[] := coalesce((select array_agg(distinct i) from jsonb_array_elements_text(coalesce(p_audience->'include', '[]')) i), '{}');
  v_service_type uuid;
begin
  if cardinality(v_include) = 0 or not (v_include <@ array['team_members', 'scheduled_confirmed', 'scheduled_pending', 'signups']) then
    raise exception 'Choose who should receive the message' using errcode = '22023';
  end if;
  if cardinality(v_teams) > 50 then
    raise exception 'Choose at most 50 teams' using errcode = '22023';
  end if;
  if v_plan is not null then
    select p.service_type_id into v_service_type from public.plans p where p.id = v_plan and p.organization_id = p_org;
    if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  elsif v_include && array['scheduled_confirmed', 'scheduled_pending', 'signups'] then
    raise exception 'Choose a plan for scheduled or signed-up people' using errcode = '22023';
  end if;
  if 'team_members' = any (v_include) and cardinality(v_teams) = 0 then
    raise exception 'Choose at least one team' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_teams) t
     where not exists (select 1 from public.teams tt where tt.id = t and tt.organization_id = p_org)
        or not (
          (v_plan is not null and private.can_schedule_on_plan(p_user, v_plan, t))
          or (v_plan is null and (private.can_schedule_team(p_user, t) or private.can_manage_team(p_user, t)))
        )
  ) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  return query
  with candidates as (
    select tm.person_id as pid, 'team_member'::text as reason
      from public.team_memberships tm
     where 'team_members' = any (v_include) and tm.team_id = any (v_teams)
    union all
    select a.person_id, case when a.status = 'confirmed' then 'scheduled_confirmed' else 'scheduled_pending' end
      from public.assignments a
     where v_plan is not null and a.plan_id = v_plan and a.visibility = 'released'
       and ((a.status = 'confirmed' and 'scheduled_confirmed' = any (v_include))
            or (a.status = 'unconfirmed' and 'scheduled_pending' = any (v_include)))
       and (case when cardinality(v_teams) > 0 then a.team_id = any (v_teams)
                 else private.can_schedule_on_plan(p_user, v_plan, a.team_id) end)
    union all
    select c.person_id, 'signup'
      from public.opportunity_claims c
      join public.signup_opportunities o on o.id = c.opportunity_id
     where v_plan is not null and 'signups' = any (v_include) and o.plan_id = v_plan
       and c.status in ('awaiting_approval', 'confirmed')
       and (case when cardinality(v_teams) > 0 then o.team_id = any (v_teams)
                 else private.can_schedule_on_plan(p_user, v_plan, o.team_id) end)
  )
  select c.pid, array_agg(distinct c.reason order by c.reason)
    from candidates c
    join public.people pe on pe.id = c.pid and pe.organization_id = p_org and pe.archived_at is null
   where pe.profile_id is null or private.is_active_member(pe.profile_id, p_org)
   group by c.pid;
end;
$$;
revoke execute on function private.resolve_message_audience(uuid, uuid, jsonb) from public, anon;
grant execute on function private.resolve_message_audience(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function private.message_audience_rows(p_user uuid, p_org uuid, p_audience jsonb)
returns table (person_id uuid, profile_id uuid, first_name text, last_name text, reasons text[], has_login boolean, has_email boolean)
language sql stable security definer set search_path = '' as $$
  select pe.id, pe.profile_id, pe.first_name, pe.last_name, r.reasons,
         pe.profile_id is not null,
         (nullif(btrim(pe.email), '') is not null
          or exists (select 1 from public.profiles pr where pr.id = pe.profile_id and nullif(btrim(pr.email), '') is not null))
    from private.resolve_message_audience(p_user, p_org, p_audience) r
    join public.people pe on pe.id = r.person_id
   order by pe.last_name nulls last, pe.first_name, pe.id;
$$;
revoke execute on function private.message_audience_rows(uuid, uuid, jsonb) from public, anon;
grant execute on function private.message_audience_rows(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function private.message_audience_hash(p_user uuid, p_org uuid, p_audience jsonb)
returns text language sql stable security definer set search_path = '' as $$
  select md5(coalesce(string_agg(
           r.person_id::text || ':' || array_to_string(r.reasons, ',') || ':' || r.has_login::text || ':' || r.has_email::text,
           '|' order by r.person_id), ''))
    from private.message_audience_rows(p_user, p_org, p_audience) r;
$$;
revoke execute on function private.message_audience_hash(uuid, uuid, jsonb) from public, anon;
grant execute on function private.message_audience_hash(uuid, uuid, jsonb) to authenticated, service_role;

-- Names and readiness only. Never addresses.
create or replace function public.preview_operational_message(p_organization_id uuid, p_audience jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not private.is_active_member(v_actor, p_organization_id) or not private.can_send_messages(v_actor, p_organization_id) then
    raise exception 'Not allowed to send messages here' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'audience_hash', private.message_audience_hash(v_actor, p_organization_id, p_audience),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', r.person_id,
        'first_name', r.first_name,
        'last_name', r.last_name,
        'reasons', to_jsonb(r.reasons),
        'has_login', r.has_login,
        'has_email', r.has_email,
        'reachable', r.has_login or r.has_email
      ))
      from private.message_audience_rows(v_actor, p_organization_id, p_audience) r
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.preview_operational_message(uuid, jsonb) from public, anon;
grant execute on function public.preview_operational_message(uuid, jsonb) to authenticated;

create or replace function public.send_operational_message(
  p_organization_id      uuid,
  p_audience             jsonb,
  p_subject              text,
  p_body                 text,
  p_template_id          uuid,
  p_excluded_person_ids  uuid[],
  p_expected_audience_hash text,
  p_idempotency_key      text
)
returns table (message_id uuid, effect_id uuid, replayed boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_actor     uuid := (select auth.uid());
  v_subject   text := btrim(coalesce(p_subject, ''));
  v_body      text := btrim(coalesce(p_body, ''));
  v_excluded  uuid[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_excluded_person_ids, '{}')) x), '{}');
  v_request   text;
  v_existing  public.operational_messages;
  v_hash      text;
  v_plan      public.plans;
  v_template  public.message_templates;
  v_message   uuid;
  v_effect    uuid;
  v_unknown   text[];
  v_vars      jsonb;
  v_included  int;
  v_excl_count int;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not private.is_active_member(v_actor, p_organization_id) or not private.can_send_messages(v_actor, p_organization_id) then
    raise exception 'Not allowed to send messages here' using errcode = '42501';
  end if;
  if char_length(v_subject) not between 1 and 200 or char_length(v_body) not between 1 and 8000 then
    raise exception 'A message needs a subject (up to 200 characters) and a body (up to 8000)' using errcode = '22023';
  end if;
  v_unknown := private.message_unknown_variables(v_subject || ' ' || v_body);
  if cardinality(v_unknown) > 0 then
    raise exception 'Unknown variable: %', array_to_string(v_unknown, ', ') using errcode = '22023', detail = 'unknown_variable';
  end if;

  v_request := md5(jsonb_build_object(
    'audience', p_audience, 'subject', v_subject, 'body', v_body,
    'template', p_template_id, 'excluded', to_jsonb(v_excluded))::text);

  -- Concurrent retries with one key wait here, then replay the first.
  perform pg_advisory_xact_lock(hashtextextended(
    'operational-message:' || p_organization_id || ':' || v_actor || ':' || p_idempotency_key, 0));
  select * into v_existing from public.operational_messages m
   where m.organization_id = p_organization_id and m.created_by = v_actor and m.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_request then
      raise exception 'This idempotency key was used for a different message' using errcode = 'PT409', hint = 'idempotency_key_reused';
    end if;
    return query select v_existing.id,
      (select e.id from public.delivery_effects e where e.operational_message_id = v_existing.id limit 1), true;
    return;
  end if;

  v_hash := private.message_audience_hash(v_actor, p_organization_id, p_audience);
  if v_hash is distinct from p_expected_audience_hash then
    raise exception 'The audience changed since the preview; review the recipients again'
      using errcode = 'PT409', hint = 'audience_changed';
  end if;

  if p_template_id is not null then
    select * into v_template from public.message_templates t
     where t.id = p_template_id and t.organization_id = p_organization_id
       and (t.owner_id is null or t.owner_id = v_actor);
    if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
  end if;

  if nullif(p_audience->>'plan_id', '') is not null then
    select * into v_plan from public.plans p where p.id = (p_audience->>'plan_id')::uuid;
  end if;
  v_vars := jsonb_build_object(
    'organization_name', (select o.name from public.organizations o where o.id = p_organization_id),
    'organization_timezone', (select o.timezone from public.organizations o where o.id = p_organization_id),
    'plan_title', v_plan.title,
    'plan_date', v_plan.service_date,
    'sender_name', coalesce((select nullif(btrim(pr.full_name), '') from public.profiles pr where pr.id = v_actor), 'Your leader'));

  insert into public.operational_messages (
    organization_id, plan_id, audience, audience_hash, request_hash, subject, body, variables,
    template_id, template_revision, recipient_count, excluded_count, idempotency_key, created_by
  ) values (
    p_organization_id, v_plan.id, p_audience, v_hash, v_request, v_subject, v_body, v_vars,
    v_template.id, v_template.revision, 0, 0, p_idempotency_key, v_actor
  ) returning id into v_message;

  insert into public.operational_message_recipients (
    message_id, organization_id, person_id, profile_id, first_name, last_name, reasons, has_login, has_email, status
  )
  select v_message, p_organization_id, r.person_id, r.profile_id, r.first_name, r.last_name, r.reasons,
         r.has_login, r.has_email,
         case when r.person_id = any (v_excluded) then 'excluded_by_sender'
              when not (r.has_login or r.has_email) then 'excluded_no_address'
              else 'included' end
    from private.message_audience_rows(v_actor, p_organization_id, p_audience) r;

  select count(*) filter (where status = 'included'), count(*) filter (where status <> 'included')
    into v_included, v_excl_count
    from public.operational_message_recipients where message_id = v_message;
  if v_included = 0 then
    raise exception 'Nobody in this audience can be reached' using errcode = '22023', detail = 'no_recipients';
  end if;
  update public.operational_messages set recipient_count = v_included, excluded_count = v_excl_count where id = v_message;

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, operational_message_id, created_by)
  values (p_organization_id, 'operational-message:' || v_message, 'operational_message', v_plan.id, v_message, v_actor)
  returning id into v_effect;

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select p_organization_id, v_effect, r.profile_id, r.person_id, c.channel
    from public.operational_message_recipients r
    cross join lateral unnest(
      case when r.profile_id is null then array['email']::public.delivery_channel[]
           when r.has_email then array['in_app', 'push', 'email']::public.delivery_channel[]
           else array['in_app', 'push']::public.delivery_channel[] end
    ) c(channel)
   where r.message_id = v_message and r.status = 'included';

  return query select v_message, v_effect, false;
end;
$$;
revoke execute on function public.send_operational_message(uuid, jsonb, text, text, uuid, uuid[], text, text) from public, anon;
grant execute on function public.send_operational_message(uuid, jsonb, text, text, uuid, uuid[], text, text) to authenticated;

-- The worker's recheck before sending to one recipient: still an active,
-- non-archived member and still in the audience for one of the reasons
-- recorded at send time. The recorded reasons are not rewritten.
create or replace function public.operational_message_recipient_current(p_message uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.operational_message_recipients r
      join public.operational_messages m on m.id = r.message_id
      join public.people pe on pe.id = r.person_id and pe.organization_id = m.organization_id
     where r.message_id = p_message and r.person_id = p_person and r.status = 'included'
       and pe.archived_at is null
       and (pe.profile_id is null or private.is_active_member(pe.profile_id, m.organization_id))
       and (
         ('team_member' = any (r.reasons) and exists (
            select 1 from public.team_memberships tm
             where tm.person_id = pe.id
               and tm.team_id in (select t::uuid from jsonb_array_elements_text(coalesce(m.audience->'team_ids', '[]')) t)))
         or ((r.reasons && array['scheduled_confirmed', 'scheduled_pending']) and exists (
            select 1 from public.assignments a
             where a.plan_id = m.plan_id and a.person_id = pe.id and a.visibility = 'released' and a.status <> 'declined'))
         or ('signup' = any (r.reasons) and exists (
            select 1 from public.opportunity_claims c
              join public.signup_opportunities o on o.id = c.opportunity_id
             where o.plan_id = m.plan_id and c.person_id = pe.id and c.status in ('awaiting_approval', 'confirmed')))
       )
  );
$$;
revoke execute on function public.operational_message_recipient_current(uuid, uuid) from public, anon, authenticated;
grant execute on function public.operational_message_recipient_current(uuid, uuid) to service_role;

-- Per recipient and channel, for the sender and administrators.
create or replace function public.operational_message_outcomes(p_message uuid)
returns table (
  person_id uuid, first_name text, last_name text, reasons text[], recipient_status text,
  delivery_id uuid, channel public.delivery_channel, delivery_status public.delivery_status,
  error_code text, attempts int, completed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_message public.operational_messages;
begin
  select * into v_message from public.operational_messages where id = p_message;
  if not found or not (
    (v_message.created_by = (select auth.uid()) and private.is_active_member((select auth.uid()), v_message.organization_id))
    or public.is_org_admin(v_message.organization_id)
  ) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  return query
  select r.person_id, r.first_name, r.last_name, r.reasons, r.status,
         d.id, d.channel, d.status, d.last_error_code, d.attempts, d.completed_at
    from public.operational_message_recipients r
    left join public.delivery_effects e on e.operational_message_id = r.message_id
    left join public.deliveries d on d.effect_id = e.id and d.recipient_person_id = r.person_id
   where r.message_id = p_message
   order by r.last_name nulls last, r.first_name, r.person_id, d.channel;
end;
$$;
revoke execute on function public.operational_message_outcomes(uuid) from public, anon;
grant execute on function public.operational_message_outcomes(uuid) to authenticated;

-- Re-queues only failed or uncertain deliveries of one message (optionally
-- for chosen Persons). Skipped (no address/device), cancelled and successful
-- deliveries are left alone. Repeating the call changes nothing more.
create or replace function public.retry_operational_message(p_message uuid, p_person_ids uuid[] default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_message public.operational_messages;
  v_count   int;
begin
  select * into v_message from public.operational_messages where id = p_message;
  if not found or not (
    (v_message.created_by = (select auth.uid())
       and private.is_active_member((select auth.uid()), v_message.organization_id)
       and private.can_send_messages((select auth.uid()), v_message.organization_id))
    or public.is_org_admin(v_message.organization_id)
  ) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  with retried as (
    update public.deliveries d
       set status = 'queued',
           next_attempt_at = now(),
           max_attempts = d.attempts + 1,
           manual_retries = d.manual_retries + 1,
           completed_at = null,
           provider_call_started_at = null
      from public.delivery_effects e
     where e.operational_message_id = p_message and d.effect_id = e.id
       and d.status in ('failed', 'ambiguous')
       and (p_person_ids is null or d.recipient_person_id = any (p_person_ids))
    returning d.id
  )
  select count(*) into v_count from retried;
  return v_count;
end;
$$;
revoke execute on function public.retry_operational_message(uuid, uuid[]) from public, anon;
grant execute on function public.retry_operational_message(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------------ rls ----
alter table public.message_templates              enable row level security;
alter table public.operational_messages           enable row level security;
alter table public.operational_message_recipients enable row level security;

create policy message_templates_select on public.message_templates
  for select to authenticated using (
    (owner_id is null and (select private.can_send_messages((select auth.uid()), organization_id)))
    or owner_id = (select auth.uid()));
create policy message_templates_insert on public.message_templates
  for insert to authenticated with check (
    (select private.can_write_message_template((select auth.uid()), organization_id, owner_id)));
create policy message_templates_update on public.message_templates
  for update to authenticated
  using ((select private.can_write_message_template((select auth.uid()), organization_id, owner_id)))
  with check ((select private.can_write_message_template((select auth.uid()), organization_id, owner_id)));

-- Recipients can read what was sent to them while they remain active members.
create or replace function private.is_message_recipient(p_user uuid, p_message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.operational_message_recipients r
      join public.operational_messages m on m.id = r.message_id
     where r.message_id = p_message and r.profile_id = p_user and r.status = 'included'
       and private.is_active_member(p_user, m.organization_id));
$$;
revoke execute on function private.is_message_recipient(uuid, uuid) from public, anon;
grant execute on function private.is_message_recipient(uuid, uuid) to authenticated, service_role;

create policy operational_messages_select on public.operational_messages
  for select to authenticated using (
    (created_by = (select auth.uid()) and (select private.is_active_member((select auth.uid()), organization_id)))
    or (select public.is_org_admin(organization_id))
    or private.is_message_recipient((select auth.uid()), id));
create policy operational_message_recipients_select on public.operational_message_recipients
  for select to authenticated using (
    exists (select 1 from public.operational_messages m
             where m.id = message_id
               and ((m.created_by = (select auth.uid()) and private.is_active_member((select auth.uid()), m.organization_id))
                    or public.is_org_admin(m.organization_id)))
    or (profile_id = (select auth.uid()) and private.is_active_member((select auth.uid()), organization_id)));

grant select, insert, update on public.message_templates to authenticated;
grant select on public.operational_messages, public.operational_message_recipients to authenticated;
revoke insert, update, delete, truncate on public.operational_messages, public.operational_message_recipients from authenticated;
revoke all on public.message_templates, public.operational_messages, public.operational_message_recipients from anon;
grant all on public.message_templates, public.operational_messages, public.operational_message_recipients to service_role;
