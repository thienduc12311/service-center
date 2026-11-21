-- W8-RES-D3 -- creating a plan or item note is safe to retry.
--
-- * `plan_notes` records the optional client key a note was created with and
--   the request it carried (item, category, audience, sorted teams, trimmed
--   body). (plan, author, key) is unique, so the key is scoped to the caller:
--   another author's identical key is an unrelated create.
-- * `save_plan_note` takes `p_idempotency_key` (create only; an edit ignores
--   it). The same key and request returns the original note flagged
--   `replayed`; the same key with a different request is refused with PT409
--   `idempotency_key_reused`. A key is optional so older clients keep working.
-- * Still security invoker: the plan_notes write policies and
--   `private.can_edit_plan` decide every write, and the replay lookup runs
--   after that check, so a caller who cannot edit the plan learns nothing.
--   No policy changes. The key columns carry no secret: the unique index only
--   ever matches the author's own rows.
-- * The return type changes from the row to jsonb {note, replayed}, so the old
--   signature is dropped (an overload with a defaulted argument would make
--   the old positional call ambiguous).

alter table public.plan_notes
  add column idempotency_key     text,
  add column idempotency_request jsonb,
  add constraint plan_notes_idempotency_shape check (
    (idempotency_key is null and idempotency_request is null)
    or (char_length(idempotency_key) between 8 and 200 and idempotency_request is not null)
  );

-- Partial: unkeyed notes (the vast majority) cost nothing. Its leading plan_id
-- also serves the plan lookup the replay does.
create unique index plan_notes_idempotency_key_unique
  on public.plan_notes (plan_id, created_by, idempotency_key)
  where idempotency_key is not null;

drop function public.save_plan_note(uuid, uuid, uuid, uuid, public.note_audience, uuid[], text, int);

create function public.save_plan_note(
  p_plan               uuid,
  p_note               uuid,
  p_item               uuid,
  p_category           uuid,
  p_audience           public.note_audience,
  p_team_ids           uuid[],
  p_body               text,
  p_expected_revision  int,
  p_idempotency_key    text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan    public.plans;
  v_row     public.plan_notes;
  v_teams   uuid[] := coalesce((select array_agg(distinct t) from unnest(coalesce(p_team_ids, '{}')) t), '{}');
  v_request jsonb;
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found or not private.can_edit_plan((select auth.uid()), p_plan) then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_audience <> 'teams' then v_teams := '{}'; end if;

  -- What the key stands for. Teams are sorted so their order never matters.
  v_request := jsonb_build_object(
    'item', p_item,
    'category', p_category,
    'audience', p_audience,
    'teams', to_jsonb(array(select t from unnest(v_teams) t order by t)),
    'body', btrim(p_body));

  if p_note is null and p_idempotency_key is not null then
    select * into v_row from public.plan_notes
     where plan_id = p_plan and created_by = (select auth.uid()) and idempotency_key = p_idempotency_key;
    if found then
      if v_row.idempotency_request <> v_request then
        raise exception 'That idempotency key was used for a different note'
          using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      return jsonb_build_object('note', to_jsonb(v_row), 'replayed', true);
    end if;
  end if;

  if p_audience = 'teams' and cardinality(v_teams) = 0 then
    raise exception 'Choose at least one team for a team note' using errcode = '22023';
  end if;
  if cardinality(v_teams) > 50 then
    raise exception 'Choose at most 50 teams' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_teams) t
              where not exists (select 1 from public.teams tt where tt.id = t and tt.organization_id = v_plan.organization_id)) then
    raise exception 'Team not found' using errcode = 'P0002';
  end if;

  if p_note is null then
    begin
      insert into public.plan_notes (organization_id, plan_id, plan_item_id, category_id, audience, body, created_by, updated_by,
                                     idempotency_key, idempotency_request)
      values (v_plan.organization_id, p_plan, p_item, p_category, p_audience, btrim(p_body),
              (select auth.uid()), (select auth.uid()),
              p_idempotency_key, case when p_idempotency_key is not null then v_request end)
      returning * into v_row;
    exception when unique_violation then
      -- A parallel retry with the same key won the race: replay its note.
      if p_idempotency_key is null then raise; end if;
      select * into v_row from public.plan_notes
       where plan_id = p_plan and created_by = (select auth.uid()) and idempotency_key = p_idempotency_key;
      if not found then raise; end if;
      if v_row.idempotency_request <> v_request then
        raise exception 'That idempotency key was used for a different note'
          using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      return jsonb_build_object('note', to_jsonb(v_row), 'replayed', true);
    end;
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
  return jsonb_build_object('note', to_jsonb(v_row), 'replayed', false);
end;
$$;
revoke execute on function public.save_plan_note(uuid, uuid, uuid, uuid, public.note_audience, uuid[], text, int, text) from public, anon;
grant execute on function public.save_plan_note(uuid, uuid, uuid, uuid, public.note_audience, uuid[], text, int, text) to authenticated;
