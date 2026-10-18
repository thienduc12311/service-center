-- ============================================================================
-- F09 Pass A — categorized, audience-scoped notes and item discussion.
--
-- Notes
--   A plan (or one of its items) can carry any number of notes. Each note has
--   an optional category, an author/revision, and one explicit audience:
--     organization  every active member (what plans.notes always meant)
--     scheduled     people with a released, not-declined request on the plan
--     teams         members of, or people scheduled on, the chosen teams
--     leaders       plan editors and service-type schedulers only
--   Plan leaders (plans.edit on the plan, or scheduling.manage at the plan's
--   service type / organization) read every audience. RLS on plan_notes and
--   plan_note_teams is the only read path, so a private note cannot be
--   reached through a raw read, an embedded join or a count.
--
-- Compatible transition for the simple notes string
--   plans.notes stays. It is now the mirror of the plan's one *legacy* note
--   (category none, audience organization). Writing plans.notes (old web and
--   mobile clients, plan duplicate/create) upserts or removes that note;
--   editing that note through the new API rewrites plans.notes. Nothing with
--   another audience ever reaches plans.notes, so every existing reader of
--   the string (plan detail, mobile, duplicate) only ever sees what all
--   members could already see. Duplicating a plan copies only that string.
--
-- Item discussion
--   Each plan item has a comment thread readable by plan leaders and people
--   scheduled on the plan (the actual plan team, rechecked on every read).
--   Comments have client-chosen stable ids so a retried post is one logical
--   comment. Mentions are resolved against current access when the comment
--   is posted: a mention never grants access, and someone without access is
--   recorded as `no_access` and not notified. Notifications go through the
--   shared F00 outbox and the dispatcher rechecks access before sending.
--   Edits and deletes are audited (previous text kept for administrators).
-- ============================================================================

alter type public.delivery_template add value if not exists 'item_comment';
alter type public.notification_type add value if not exists 'comment_mention';
alter type public.notification_type add value if not exists 'comment_reply';

-- Composite targets so children can only name parents of the same tenant.
create unique index if not exists plans_id_org_key on public.plans (id, organization_id);
create unique index if not exists plan_items_id_plan_key on public.plan_items (id, plan_id);

-- ------------------------------------------------------------- helpers -----

create or replace function private.is_active_member(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = p_user and m.status = 'active');
$$;

-- Plan editors and schedulers at the plan's service type (or organization).
create or replace function private.is_plan_leader(p_user uuid, p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.capability_for(p_user, p.organization_id, 'plans.edit', p.service_type_id, null)
        or private.capability_for(p_user, p.organization_id, 'scheduling.manage', p.service_type_id, null)
      from public.plans p where p.id = p_plan
  ), false);
$$;

-- Released, not-declined request on the plan (optionally on one team).
create or replace function private.is_scheduled_on_plan(p_user uuid, p_plan uuid, p_team uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.assignments a
      join public.people pe on pe.id = a.person_id
     where a.plan_id = p_plan and pe.profile_id = p_user and pe.archived_at is null
       and a.visibility = 'released' and a.status <> 'declined'
       and (p_team is null or a.team_id = p_team));
$$;

create or replace function private.is_on_team(p_user uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.team_memberships tm
      join public.people pe on pe.id = tm.person_id
     where tm.team_id = p_team and pe.profile_id = p_user and pe.archived_at is null);
$$;

revoke execute on function private.is_active_member(uuid, uuid) from public, anon;
revoke execute on function private.is_plan_leader(uuid, uuid) from public, anon;
revoke execute on function private.is_scheduled_on_plan(uuid, uuid, uuid) from public, anon;
revoke execute on function private.is_on_team(uuid, uuid) from public, anon;
grant execute on function private.is_active_member(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_plan_leader(uuid, uuid) to authenticated, service_role;
grant execute on function private.is_scheduled_on_plan(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function private.is_on_team(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------- categories -----

create type public.note_audience as enum ('organization', 'scheduled', 'teams', 'leaders');

create table public.note_categories (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- Null: offered on every service type.
  service_type_id   uuid,
  name              text not null check (char_length(btrim(name)) between 1 and 60),
  default_audience  public.note_audience not null default 'organization',
  sort_order        int not null default 0,
  archived_at       timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint note_categories_service_type_fk foreign key (service_type_id, organization_id)
    references public.service_types (id, organization_id) on delete cascade
);
create unique index note_categories_name_key
  on public.note_categories (organization_id, service_type_id, lower(btrim(name))) nulls not distinct;
create unique index note_categories_id_org_key on public.note_categories (id, organization_id);
create index note_categories_service_type_idx on public.note_categories (service_type_id);
create index note_categories_created_by_idx on public.note_categories (created_by);
create trigger note_categories_updated before update on public.note_categories
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------- notes -----

create table public.plan_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  plan_id          uuid not null,
  plan_item_id     uuid,
  category_id      uuid,
  audience         public.note_audience not null default 'organization',
  body             text not null check (char_length(btrim(body)) between 1 and 8000),
  -- The note plans.notes mirrors. At most one per plan.
  is_legacy        boolean not null default false,
  revision         int not null default 1 check (revision > 0),
  created_by       uuid references public.profiles (id) on delete set null,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint plan_notes_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint plan_notes_item_fk foreign key (plan_item_id, plan_id)
    references public.plan_items (id, plan_id) on delete cascade,
  constraint plan_notes_category_fk foreign key (category_id, organization_id)
    references public.note_categories (id, organization_id) on delete set null (category_id),
  constraint plan_notes_legacy_shape check (
    not is_legacy or (plan_item_id is null and category_id is null and audience = 'organization')
  )
);
create unique index plan_notes_one_legacy on public.plan_notes (plan_id) where is_legacy;
create unique index plan_notes_id_org_key on public.plan_notes (id, organization_id);
create index plan_notes_plan_idx on public.plan_notes (plan_id, plan_item_id);
create index plan_notes_item_idx on public.plan_notes (plan_item_id) where plan_item_id is not null;
create index plan_notes_category_idx on public.plan_notes (category_id) where category_id is not null;
create index plan_notes_organization_idx on public.plan_notes (organization_id);
create index plan_notes_created_by_idx on public.plan_notes (created_by);
create index plan_notes_updated_by_idx on public.plan_notes (updated_by);

create table public.plan_note_teams (
  note_id          uuid not null,
  organization_id  uuid not null,
  team_id          uuid not null,
  primary key (note_id, team_id),
  constraint plan_note_teams_note_fk foreign key (note_id, organization_id)
    references public.plan_notes (id, organization_id) on delete cascade,
  constraint plan_note_teams_team_fk foreign key (team_id, organization_id)
    references public.teams (id, organization_id) on delete cascade
);
create index plan_note_teams_team_idx on public.plan_note_teams (team_id);
create index plan_note_teams_organization_idx on public.plan_note_teams (organization_id);

create or replace function private.plan_note_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger plan_notes_revision before update on public.plan_notes
  for each row execute function private.plan_note_revision();

-- A category must be offered on the plan's service type and be live when a
-- note is filed under it.
create or replace function private.guard_plan_note_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_category public.note_categories;
begin
  if new.category_id is null or (tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id) then
    return new;
  end if;
  select * into v_category from public.note_categories where id = new.category_id;
  if v_category.archived_at is not null then
    raise exception 'This note category is archived' using errcode = '22023';
  end if;
  if v_category.service_type_id is not null and not exists (
    select 1 from public.plans p where p.id = new.plan_id and p.service_type_id = v_category.service_type_id
  ) then
    raise exception 'This note category belongs to another service type' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_plan_note_category() from public, anon, authenticated;
create trigger plan_notes_guard_category before insert or update of category_id on public.plan_notes
  for each row execute function private.guard_plan_note_category();

-- Who may read one note. Security definer so it can read assignments and
-- memberships regardless of the caller's own RLS; always evaluated for the
-- signed-in caller by the policies below. It takes the note's own columns
-- (not its id) so it also decides a row being inserted, which an id lookup
-- inside the statement could not see yet.
create or replace function private.can_read_plan_note(
  p_user uuid, p_note uuid, p_org uuid, p_plan uuid, p_audience public.note_audience
)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member(p_user, p_org) and (
    p_audience = 'organization'
    or private.is_plan_leader(p_user, p_plan)
    or (p_audience = 'scheduled' and private.is_scheduled_on_plan(p_user, p_plan, null))
    or (p_audience = 'teams' and exists (
          select 1 from public.plan_note_teams nt
           where nt.note_id = p_note
             and (private.is_on_team(p_user, nt.team_id)
                  or private.is_scheduled_on_plan(p_user, p_plan, nt.team_id)
                  or private.can_schedule_on_plan(p_user, p_plan, nt.team_id))))
  );
$$;
revoke execute on function private.can_read_plan_note(uuid, uuid, uuid, uuid, public.note_audience) from public, anon;
grant execute on function private.can_read_plan_note(uuid, uuid, uuid, uuid, public.note_audience) to authenticated, service_role;

-- ------------------------------------------------- plans.notes mirror ------
-- A transaction-local flag stops the two mirror triggers from re-entering.

create or replace function private.mirror_plan_notes_to_legacy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_body text := nullif(btrim(new.notes), '');
begin
  if coalesce(current_setting('service_center.notes_mirror', true), 'off') = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.notes is not distinct from old.notes then
    return null;
  end if;
  perform set_config('service_center.notes_mirror', 'on', true);
  if v_body is null then
    delete from public.plan_notes where plan_id = new.id and is_legacy;
  else
    insert into public.plan_notes (organization_id, plan_id, audience, body, is_legacy, created_by, updated_by)
    values (new.organization_id, new.id, 'organization', left(v_body, 8000), true,
            (select auth.uid()), (select auth.uid()))
    on conflict (plan_id) where is_legacy
    do update set body = excluded.body, updated_by = excluded.updated_by;
  end if;
  perform set_config('service_center.notes_mirror', 'off', true);
  return null;
end;
$$;
revoke execute on function private.mirror_plan_notes_to_legacy() from public, anon, authenticated;
create trigger plans_mirror_notes after insert or update of notes on public.plans
  for each row execute function private.mirror_plan_notes_to_legacy();

create or replace function private.mirror_legacy_note_to_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  if coalesce(current_setting('service_center.notes_mirror', true), 'off') = 'on' then
    return null;
  end if;
  if not (coalesce(new.is_legacy, false) or coalesce(old.is_legacy, false)) then
    return null;
  end if;
  perform set_config('service_center.notes_mirror', 'on', true);
  update public.plans
     set notes = (select n.body from public.plan_notes n where n.plan_id = v_plan and n.is_legacy)
   where id = v_plan;
  perform set_config('service_center.notes_mirror', 'off', true);
  return null;
end;
$$;
revoke execute on function private.mirror_legacy_note_to_plan() from public, anon, authenticated;
create trigger plan_notes_mirror_legacy after insert or update or delete on public.plan_notes
  for each row execute function private.mirror_legacy_note_to_plan();

-- Backfill: every existing notes string becomes its plan's legacy note.
insert into public.plan_notes (organization_id, plan_id, audience, body, is_legacy, created_by, updated_by, created_at, updated_at)
select p.organization_id, p.id, 'organization', left(btrim(p.notes), 8000), true, p.created_by, p.created_by, p.created_at, p.updated_at
  from public.plans p
 where nullif(btrim(p.notes), '') is not null
on conflict do nothing;

-- One atomic save: note, its teams and the revision check. Security invoker,
-- so the write policies below decide (plans.edit on the plan).
create or replace function public.save_plan_note(
  p_plan               uuid,
  p_note               uuid,
  p_item               uuid,
  p_category           uuid,
  p_audience           public.note_audience,
  p_team_ids           uuid[],
  p_body               text,
  p_expected_revision  int
)
returns public.plan_notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan  public.plans;
  v_row   public.plan_notes;
  v_teams uuid[] := coalesce((select array_agg(distinct t) from unnest(coalesce(p_team_ids, '{}')) t), '{}');
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found or not private.can_edit_plan((select auth.uid()), p_plan) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_audience = 'teams' and cardinality(v_teams) = 0 then
    raise exception 'Choose at least one team for a team note' using errcode = '22023';
  end if;
  if p_audience <> 'teams' then v_teams := '{}'; end if;
  if cardinality(v_teams) > 50 then
    raise exception 'Choose at most 50 teams' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_teams) t
              where not exists (select 1 from public.teams tt where tt.id = t and tt.organization_id = v_plan.organization_id)) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  if p_note is null then
    insert into public.plan_notes (organization_id, plan_id, plan_item_id, category_id, audience, body, created_by, updated_by)
    values (v_plan.organization_id, p_plan, p_item, p_category, p_audience, btrim(p_body),
            (select auth.uid()), (select auth.uid()))
    returning * into v_row;
  else
    select * into v_row from public.plan_notes where id = p_note and plan_id = p_plan for update;
    if not found then
      raise exception 'Note not found' using errcode = 'P0002';
    end if;
    if p_expected_revision is distinct from v_row.revision then
      raise exception 'This note changed since you opened it' using errcode = 'PT409', hint = 'note_stale';
    end if;
    update public.plan_notes
       set plan_item_id = p_item,
           category_id = p_category,
           audience = p_audience,
           body = btrim(p_body),
           updated_by = (select auth.uid()),
           -- Giving the mirrored note another shape makes it an ordinary note
           -- (and clears plans.notes); it never carries private text there.
           is_legacy = v_row.is_legacy and p_item is null and p_category is null and p_audience = 'organization'
     where id = p_note
    returning * into v_row;
    delete from public.plan_note_teams where note_id = v_row.id and team_id <> all (v_teams);
  end if;

  insert into public.plan_note_teams (note_id, organization_id, team_id)
  select v_row.id, v_row.organization_id, t from unnest(v_teams) t
  on conflict do nothing;
  return v_row;
end;
$$;
revoke execute on function public.save_plan_note(uuid, uuid, uuid, uuid, public.note_audience, uuid[], text, int) from public, anon;
grant execute on function public.save_plan_note(uuid, uuid, uuid, uuid, public.note_audience, uuid[], text, int) to authenticated;

-- ----------------------------------------------------- item discussion -----

-- Plan leaders and the people scheduled on the plan.
create or replace function private.can_read_item_thread(p_user uuid, p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_active_member(p_user, p.organization_id)
       and (private.is_plan_leader(p_user, p.id) or private.is_scheduled_on_plan(p_user, p.id, null))
      from public.plans p where p.id = p_plan
  ), false);
$$;
revoke execute on function private.can_read_item_thread(uuid, uuid) from public, anon;
grant execute on function private.can_read_item_thread(uuid, uuid) to authenticated, service_role;

-- For the delivery worker (service role) to recheck a recipient.
create or replace function public.user_can_read_item_thread(p_user uuid, p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_read_item_thread(p_user, p_plan);
$$;
revoke execute on function public.user_can_read_item_thread(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_can_read_item_thread(uuid, uuid) to service_role;

create table public.plan_item_comments (
  -- Chosen by the client, so a retried post is the same comment.
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  plan_id           uuid not null,
  plan_item_id      uuid not null,
  author_id         uuid not null references public.profiles (id) on delete cascade,
  author_person_id  uuid references public.people (id) on delete set null,
  body              text not null,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint plan_item_comments_plan_fk foreign key (plan_id, organization_id)
    references public.plans (id, organization_id) on delete cascade,
  constraint plan_item_comments_item_fk foreign key (plan_item_id, plan_id)
    references public.plan_items (id, plan_id) on delete cascade,
  constraint plan_item_comments_body check (
    (deleted_at is null and char_length(btrim(body)) between 1 and 4000)
    or (deleted_at is not null and body = '')
  )
);
create index plan_item_comments_thread_idx on public.plan_item_comments (plan_item_id, created_at desc, id desc);
create index plan_item_comments_plan_idx on public.plan_item_comments (plan_id);
create index plan_item_comments_organization_idx on public.plan_item_comments (organization_id);
create index plan_item_comments_author_idx on public.plan_item_comments (author_id);
create index plan_item_comments_author_person_idx on public.plan_item_comments (author_person_id);
create index plan_item_comments_deleted_by_idx on public.plan_item_comments (deleted_by);

create table public.plan_item_comment_mentions (
  comment_id       uuid not null references public.plan_item_comments (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  -- Resolved when the comment was posted; a mention never grants access.
  resolution       text not null check (resolution in ('notified', 'no_access', 'no_login')),
  primary key (comment_id, person_id)
);
create index plan_item_comment_mentions_person_idx on public.plan_item_comment_mentions (person_id);
create index plan_item_comment_mentions_organization_idx on public.plan_item_comment_mentions (organization_id);

-- Edits, deletes and moderation of discussion content (shared with F09
-- conversations). Previous text is kept for administrators only.
create table public.discussion_audit_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  subject_type     text not null check (subject_type in ('item_comment', 'conversation_message')),
  subject_id       uuid not null,
  action           text not null check (action in ('edited', 'deleted', 'hidden', 'restored', 'report_dismissed')),
  actor_id         uuid references public.profiles (id) on delete set null,
  previous_body    text,
  reason           text check (reason is null or char_length(reason) <= 500),
  created_at       timestamptz not null default now()
);
create index discussion_audit_events_subject_idx on public.discussion_audit_events (subject_type, subject_id, created_at desc);
create index discussion_audit_events_organization_idx on public.discussion_audit_events (organization_id, created_at desc);
create index discussion_audit_events_actor_idx on public.discussion_audit_events (actor_id);

alter table public.delivery_effects
  add column comment_id uuid references public.plan_item_comments (id) on delete cascade;
create index delivery_effects_comment_idx on public.delivery_effects (comment_id) where comment_id is not null;

-- Deep links for the feed.
alter table public.notifications
  add column plan_item_id uuid references public.plan_items (id) on delete cascade;
create index notifications_plan_item_idx on public.notifications (plan_item_id) where plan_item_id is not null;

-- Posts a comment, resolves mentions under current access and enqueues one
-- outbox effect, in one transaction. Replaying the same id returns the
-- stored comment (replayed = true); the id on a different thread or by
-- another author is refused.
create or replace function public.post_item_comment(
  p_comment_id   uuid,
  p_plan_item    uuid,
  p_body         text,
  p_mentions     uuid[]
)
returns table (comment_id uuid, replayed boolean, effect_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor   uuid := (select auth.uid());
  v_item    public.plan_items;
  v_plan    public.plans;
  v_person  uuid;
  v_found   public.plan_item_comments;
  v_effect  uuid;
  v_body    text := btrim(coalesce(p_body, ''));
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_item from public.plan_items where id = p_plan_item;
  if found then select * into v_plan from public.plans where id = v_item.plan_id; end if;
  if v_item.id is null or not private.can_read_item_thread(v_actor, v_item.plan_id) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'A comment needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_mentions, '{}')) > 20 then
    raise exception 'Mention at most 20 people' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('item-comment:' || p_comment_id::text, 0));
  select * into v_found from public.plan_item_comments where id = p_comment_id;
  if found then
    if v_found.author_id <> v_actor or v_found.plan_item_id <> p_plan_item then
      raise exception 'This comment id is already used' using errcode = 'PT409', hint = 'comment_id_conflict';
    end if;
    return query select v_found.id, true,
      (select e.id from public.delivery_effects e where e.comment_id = v_found.id limit 1);
    return;
  end if;

  v_person := private.current_person(v_plan.organization_id);
  insert into public.plan_item_comments (id, organization_id, plan_id, plan_item_id, author_id, author_person_id, body)
  values (p_comment_id, v_plan.organization_id, v_plan.id, v_item.id, v_actor, v_person, v_body);

  insert into public.plan_item_comment_mentions (comment_id, organization_id, person_id, resolution)
  select p_comment_id, v_plan.organization_id, pe.id,
         case when pe.profile_id is null then 'no_login'
              when private.can_read_item_thread(pe.profile_id, v_plan.id) then 'notified'
              else 'no_access' end
    from public.people pe
   where pe.id = any (coalesce(p_mentions, '{}'))
     and pe.organization_id = v_plan.organization_id
     and pe.id is distinct from v_person;

  insert into public.delivery_effects (organization_id, effect_key, template, plan_id, comment_id, created_by)
  values (v_plan.organization_id, 'item-comment:' || p_comment_id, 'item_comment', v_plan.id, p_comment_id, v_actor)
  returning id into v_effect;

  -- Mentioned people with access: feed + push. Earlier participants in the
  -- thread who still have access: feed only.
  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select v_plan.organization_id, v_effect, pe.profile_id, pe.id, c.channel
    from public.plan_item_comment_mentions m
    join public.people pe on pe.id = m.person_id
    cross join unnest(array['in_app', 'push']::public.delivery_channel[]) c(channel)
   where m.comment_id = p_comment_id and m.resolution = 'notified';

  insert into public.deliveries (organization_id, effect_id, recipient_id, recipient_person_id, channel)
  select distinct v_plan.organization_id, v_effect, pe.profile_id, pe.id, 'in_app'::public.delivery_channel
    from public.plan_item_comments c
    join public.people pe on pe.organization_id = v_plan.organization_id and pe.profile_id = c.author_id
   where c.plan_item_id = v_item.id and c.id <> p_comment_id and c.deleted_at is null
     and c.author_id <> v_actor
     and private.can_read_item_thread(c.author_id, v_plan.id)
     and not exists (select 1 from public.plan_item_comment_mentions m
                      where m.comment_id = p_comment_id and m.person_id = pe.id)
  on conflict do nothing;

  return query select p_comment_id, false, v_effect;
end;
$$;
revoke execute on function public.post_item_comment(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.post_item_comment(uuid, uuid, text, uuid[]) to authenticated;

-- The author edits their own live comment while they still have access.
create or replace function public.edit_item_comment(p_comment_id uuid, p_body text)
returns public.plan_item_comments
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.plan_item_comments;
  v_body  text := btrim(coalesce(p_body, ''));
begin
  select * into v_row from public.plan_item_comments where id = p_comment_id for update;
  if not found or not private.can_read_item_thread(v_actor, v_row.plan_id) then
    raise exception 'Comment not found' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_actor then
    raise exception 'Only the author can edit a comment' using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'This comment was deleted' using errcode = 'PT409', hint = 'comment_deleted';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'A comment needs 1 to 4000 characters' using errcode = '22023';
  end if;
  if v_body = v_row.body then return v_row; end if;
  insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id, previous_body)
  values (v_row.organization_id, 'item_comment', v_row.id, 'edited', v_actor, v_row.body);
  update public.plan_item_comments set body = v_body, edited_at = now() where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.edit_item_comment(uuid, text) from public, anon;
grant execute on function public.edit_item_comment(uuid, text) to authenticated;

-- The author, or a plan editor (moderation), removes a comment. The thread
-- keeps a "deleted" placeholder; administrators keep the audit text.
-- Repeating the call returns the same deleted row.
create or replace function public.delete_item_comment(p_comment_id uuid, p_reason text default null)
returns public.plan_item_comments
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_row   public.plan_item_comments;
begin
  select * into v_row from public.plan_item_comments where id = p_comment_id for update;
  if not found or not private.can_read_item_thread(v_actor, v_row.plan_id) then
    raise exception 'Comment not found' using errcode = 'P0002';
  end if;
  if v_row.author_id <> v_actor and not private.can_edit_plan(v_actor, v_row.plan_id) then
    raise exception 'Only the author or a plan editor can delete a comment' using errcode = '42501';
  end if;
  if v_row.deleted_at is not null then return v_row; end if;
  insert into public.discussion_audit_events (organization_id, subject_type, subject_id, action, actor_id, previous_body, reason)
  values (v_row.organization_id, 'item_comment', v_row.id, 'deleted', v_actor, v_row.body, nullif(btrim(p_reason), ''));
  update public.plan_item_comments
     set body = '', deleted_at = now(), deleted_by = v_actor
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.delete_item_comment(uuid, text) from public, anon;
grant execute on function public.delete_item_comment(uuid, text) to authenticated;

-- ------------------------------------------------------------------ rls ----
alter table public.note_categories            enable row level security;
alter table public.plan_notes                 enable row level security;
alter table public.plan_note_teams            enable row level security;
alter table public.plan_item_comments         enable row level security;
alter table public.plan_item_comment_mentions enable row level security;
alter table public.discussion_audit_events    enable row level security;

create policy note_categories_select on public.note_categories
  for select to authenticated using ((select public.is_org_member(organization_id)));
create policy note_categories_insert on public.note_categories
  for insert to authenticated with check (
    (select private.capability_for((select auth.uid()), organization_id, 'plans.edit', service_type_id, null)));
create policy note_categories_update on public.note_categories
  for update to authenticated
  using ((select private.capability_for((select auth.uid()), organization_id, 'plans.edit', service_type_id, null)))
  with check ((select private.capability_for((select auth.uid()), organization_id, 'plans.edit', service_type_id, null)));
-- No delete: categories are archived, so filed notes keep their label.

create policy plan_notes_select on public.plan_notes
  for select to authenticated using (
    private.can_read_plan_note((select auth.uid()), id, organization_id, plan_id, audience));
create policy plan_notes_insert on public.plan_notes
  for insert to authenticated with check (
    not is_legacy and private.can_edit_plan((select auth.uid()), plan_id));
create policy plan_notes_update on public.plan_notes
  for update to authenticated
  using (private.can_edit_plan((select auth.uid()), plan_id))
  with check (private.can_edit_plan((select auth.uid()), plan_id));
create policy plan_notes_delete on public.plan_notes
  for delete to authenticated using (private.can_edit_plan((select auth.uid()), plan_id));

create policy plan_note_teams_select on public.plan_note_teams
  for select to authenticated using (exists (
    select 1 from public.plan_notes n where n.id = note_id
       and private.can_read_plan_note((select auth.uid()), n.id, n.organization_id, n.plan_id, n.audience)));
create policy plan_note_teams_write on public.plan_note_teams
  for all to authenticated
  using (exists (select 1 from public.plan_notes n where n.id = note_id
                  and private.can_edit_plan((select auth.uid()), n.plan_id)))
  with check (exists (select 1 from public.plan_notes n where n.id = note_id
                       and private.can_edit_plan((select auth.uid()), n.plan_id)));

create policy plan_item_comments_select on public.plan_item_comments
  for select to authenticated using (private.can_read_item_thread((select auth.uid()), plan_id));
-- Writes go through the functions above only.

create policy plan_item_comment_mentions_select on public.plan_item_comment_mentions
  for select to authenticated using (exists (
    select 1 from public.plan_item_comments c
     where c.id = comment_id and private.can_read_item_thread((select auth.uid()), c.plan_id)));

create policy discussion_audit_events_select on public.discussion_audit_events
  for select to authenticated using ((select public.is_org_admin(organization_id)));

grant select, insert, update on public.note_categories to authenticated;
grant select, insert, update, delete on public.plan_notes, public.plan_note_teams to authenticated;
grant select on public.plan_item_comments, public.plan_item_comment_mentions, public.discussion_audit_events to authenticated;
revoke insert, update, delete, truncate on public.plan_item_comments, public.plan_item_comment_mentions,
  public.discussion_audit_events from anon, authenticated;
revoke all on public.note_categories, public.plan_notes, public.plan_note_teams, public.plan_item_comments,
  public.plan_item_comment_mentions, public.discussion_audit_events from anon;
grant all on public.note_categories, public.plan_notes, public.plan_note_teams, public.plan_item_comments,
  public.plan_item_comment_mentions, public.discussion_audit_events to service_role;

-- Caller-bound check the API uses to tell "no access" (404) from "empty".
create or replace function public.can_read_item_thread(p_plan uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_read_item_thread((select auth.uid()), p_plan);
$$;
revoke execute on function public.can_read_item_thread(uuid) from public, anon;
grant execute on function public.can_read_item_thread(uuid) to authenticated;
