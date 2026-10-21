-- F11 — adding an item to the order is safe to retry and appends atomically.
--
-- * `add_plan_item` locks the plan (as edit/reorder/remove do), assigns the
--   next `sort_order` inside that lock and inserts the item, so two editors
--   appending at once get distinct positions instead of sharing one.
-- * With an idempotency key, the (plan, caller, key) is recorded with the item
--   it made. A retry after a lost response returns that same item; the same
--   key with a different body is refused (PT409 `idempotency_key_reused`).
--   A key is optional so older clients keep working, unkeyed.
-- * Security invoker: `plan_items_write` and `plan_items_validate_refs` still
--   decide every insert. The plan lock serializes same-key retries; the unique
--   key is the backstop.

create table public.plan_item_create_operations (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.plans (id) on delete cascade,
  created_by       uuid not null references public.profiles (id) on delete cascade,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 200),
  -- The body the key was first used with, compared on every replay.
  request          jsonb not null,
  -- Null once that item is removed: a replay then reports it gone rather
  -- than adding it a second time.
  item_id          uuid references public.plan_items (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint plan_item_create_operations_key_unique unique (plan_id, created_by, idempotency_key)
);
create index plan_item_create_operations_created_by_idx on public.plan_item_create_operations (created_by);
create index plan_item_create_operations_item_idx on public.plan_item_create_operations (item_id)
  where item_id is not null;

alter table public.plan_item_create_operations enable row level security;
create policy plan_item_create_operations_select on public.plan_item_create_operations
  for select to authenticated using (
    created_by = (select auth.uid()) and (select public.can_edit_plan(plan_id))
  );
create policy plan_item_create_operations_insert on public.plan_item_create_operations
  for insert to authenticated with check (
    created_by = (select auth.uid()) and (select public.can_edit_plan(plan_id))
  );
revoke update, delete, truncate on public.plan_item_create_operations from anon, authenticated;

/**
 * Appends one item (or places it at `sort_order` when the body names one).
 * Returns the item, the plan's content revision and whether this call
 * replayed an earlier one with the same key.
 */
create or replace function public.add_plan_item(
  p_plan_id uuid,
  p_item jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_op public.plan_item_create_operations;
  v_item public.plan_items;
  v_type public.plan_item_type;
  v_title text;
  v_seq text[];
  v_sort int;
begin
  if jsonb_typeof(p_item) is distinct from 'object' then
    raise exception 'Send the item to add' using errcode = '22023';
  end if;
  perform private.lock_plan_for_order_edit(p_plan_id, null);

  if p_idempotency_key is not null then
    select * into v_op from public.plan_item_create_operations
     where plan_id = p_plan_id and created_by = (select auth.uid()) and idempotency_key = p_idempotency_key;
    if found then
      if v_op.request <> p_item then
        raise exception 'That idempotency key was used for a different item'
          using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      select * into v_item from public.plan_items where id = v_op.item_id;
      if not found then
        raise exception 'That item was added and then removed' using errcode = 'P0002';
      end if;
      return jsonb_build_object(
        'item', to_jsonb(v_item),
        'content_revision', (select content_revision from public.plans where id = p_plan_id),
        'replayed', true);
    end if;
  end if;

  v_type := coalesce((p_item ->> 'item_type')::public.plan_item_type, 'item');
  v_title := p_item ->> 'title';
  -- A song item may omit the title; it takes the song's own.
  if v_title is null and v_type = 'song' then
    select s.title into v_title from public.songs s where s.id = (p_item ->> 'song_id')::uuid;
    v_title := coalesce(v_title, 'Untitled song');
  end if;
  if jsonb_typeof(p_item -> 'sequence_override') = 'array' then
    v_seq := array(select jsonb_array_elements_text(p_item -> 'sequence_override'));
  end if;
  -- Under the plan lock, so a concurrent append waits and then sees this row.
  v_sort := coalesce(
    (p_item ->> 'sort_order')::int,
    (select coalesce(max(sort_order) + 1, 0) from public.plan_items where plan_id = p_plan_id));

  insert into public.plan_items (
    plan_id, item_type, title, song_id, arrangement_id, key_override, sequence_override,
    length_seconds, description, leader_person_id, leader_position_id, service_segment, sort_order
  ) values (
    p_plan_id, v_type, v_title,
    (p_item ->> 'song_id')::uuid,
    (p_item ->> 'arrangement_id')::uuid,
    p_item ->> 'key_override',
    v_seq,
    coalesce((p_item ->> 'length_seconds')::int, 0),
    p_item ->> 'description',
    (p_item ->> 'leader_person_id')::uuid,
    (p_item ->> 'leader_position_id')::uuid,
    coalesce(p_item ->> 'service_segment', 'service'),
    v_sort
  )
  returning * into v_item;

  if p_idempotency_key is not null then
    insert into public.plan_item_create_operations (plan_id, created_by, idempotency_key, request, item_id)
    values (p_plan_id, (select auth.uid()), p_idempotency_key, p_item, v_item.id);
  end if;

  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'content_revision', (select content_revision from public.plans where id = p_plan_id),
    'replayed', false);
end;
$$;
revoke execute on function public.add_plan_item(uuid, jsonb, text) from public, anon;
grant execute on function public.add_plan_item(uuid, jsonb, text) to authenticated, service_role;
