-- W10-FGH-D6: `save_file_content` (links and documents) replayed the first file
-- for a reused idempotency key even when the second request asked for another
-- URL, title or body (201 with the old file, the new payload dropped).
--
-- Like the W9-API-D1 fix for plan copies (20261128000200), a create now records
-- an md5 of its request (owner, kind, title, URL, body, category, audience,
-- sorted team/position ids) in `private.file_content_requests`. Same key + same
-- request replays; same key + another request, or a key first used for another
-- kind of file (an upload intent's key, say), is PT409 / hint
-- idempotency_key_reused, which the API answers as 409.
--
-- The hash lives in the private schema, not on `attachments`, so it never
-- appears in `private.file_json` / `select *` results. No client role has any
-- privilege on it; only the SECURITY DEFINER function (owner postgres) writes
-- it. Files created before this migration have no row and keep replaying.
-- Signature unchanged: CREATE OR REPLACE keeps the existing grants.

create table if not exists private.file_content_requests (
  attachment_id uuid primary key references public.attachments (id) on delete cascade,
  request_hash  text not null
);
revoke all on private.file_content_requests from public, anon, authenticated;
comment on table private.file_content_requests is
  'W10-FGH-D6: request hash of each link/document create, to refuse a reused idempotency key with another payload.';

-- ---- save_file_content (F14 body + request hash) ----
create or replace function public.save_file_content(
  p_owner_kind         public.file_owner_kind,
  p_owner_id           uuid,
  p_attachment         uuid,
  p_expected_revision  bigint,
  p_kind               public.file_kind,
  p_title              text,
  p_external_url       text,
  p_document_body      text,
  p_category           public.file_category,
  p_audience           public.file_audience,
  p_team_ids           uuid[],
  p_position_ids       uuid[],
  p_idempotency_key    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_owner    record;
  v_file     public.attachments;
  v_version  public.attachment_versions;
  v_title    text := btrim(coalesce(p_title, ''));
  v_body     text;
  v_number   int;
  v_bytes    bigint;
  v_hash     text;
  v_stored   text;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_kind not in ('link', 'document') then
    raise exception 'Use an upload for files' using errcode = '22023';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'The title must be 1–200 characters' using errcode = '22023';
  end if;
  if p_kind = 'document' then
    v_body := coalesce(p_document_body, '');
    if char_length(v_body) > 100000 then
      raise exception 'Documents are limited to 100,000 characters' using errcode = '22023';
    end if;
    v_bytes := octet_length(v_body);
  end if;

  if p_attachment is null then
    if char_length(coalesce(p_idempotency_key, '')) not between 1 and 200 then
      raise exception 'A request id is required' using errcode = '22023';
    end if;
    select * into v_owner from private.resolve_file_owner(p_owner_kind, p_owner_id);
    if not private.is_active_member(v_user, v_owner.organization_id) then
      raise exception 'That parent was not found' using errcode = 'P0002';
    end if;
    if not private.file_writer(v_user, v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.service_type_id) then
      raise exception 'You cannot add files here' using errcode = '42501';
    end if;
    -- W10-FGH-D6: what this create asks for, so a retry with the same key is
    -- told apart from a different request that reuses it.
    v_hash := md5(jsonb_build_object(
      'owner_kind', p_owner_kind,
      'owner_id', p_owner_id,
      'kind', p_kind,
      'title', v_title,
      'external_url', case when p_kind = 'link' then btrim(coalesce(p_external_url, '')) end,
      'document_body', v_body,
      'category', coalesce(p_category, 'other'),
      'audience', coalesce(p_audience, 'organization'),
      'team_ids', (select coalesce(jsonb_agg(distinct t order by t), '[]'::jsonb) from unnest(coalesce(p_team_ids, '{}')) t),
      'position_ids', (select coalesce(jsonb_agg(distinct p order by p), '[]'::jsonb) from unnest(coalesce(p_position_ids, '{}')) p)
    )::text);

    -- Replay: a document's first version carries the key; a link is matched by
    -- owner, title and URL created by this caller with the same key in its id.
    select a.* into v_file from public.attachments a
      join public.attachment_versions v on v.attachment_id = a.id
     where v.created_by = v_user and v.idempotency_key = p_idempotency_key and v.organization_id = v_owner.organization_id;
    if not found then
      select * into v_file from public.attachments a
       where a.id = private.file_link_id(v_owner.organization_id, v_user, p_idempotency_key);
    end if;
    if found then
      -- Same key, another request: never hand back the first file as if it
      -- were this one. Files created before 20261201000200 have no stored
      -- hash and keep replaying (their request is not recoverable).
      select request_hash into v_stored from private.file_content_requests where attachment_id = v_file.id;
      if v_file.kind <> p_kind or (v_stored is not null and v_stored <> v_hash) then
        raise exception 'This request id was already used for another file'
          using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      return jsonb_build_object('attachment', private.file_json(v_file.id), 'replayed', true);
    end if;

    insert into public.attachments (
      id, organization_id, owner_kind, plan_id, plan_item_id, song_id, arrangement_id, service_type_id, media_id,
      kind, title, category, audience, external_url, filename, mime_type, size_bytes, created_by, updated_by
    ) values (
      case when p_kind = 'link' then private.file_link_id(v_owner.organization_id, v_user, p_idempotency_key) else gen_random_uuid() end,
      v_owner.organization_id, p_owner_kind, v_owner.plan_id, v_owner.plan_item_id, v_owner.song_id,
      v_owner.arrangement_id, v_owner.service_type_id, v_owner.media_id, p_kind, v_title, coalesce(p_category, 'other'),
      coalesce(p_audience, 'organization'),
      case when p_kind = 'link' then btrim(p_external_url) end,
      case when p_kind = 'document' then left(private.file_safe_name(v_title), 190) || '.md' else v_title end,
      case when p_kind = 'document' then 'text/markdown' end, v_bytes, v_user, v_user
    ) returning * into v_file;
    insert into private.file_content_requests (attachment_id, request_hash) values (v_file.id, v_hash);
    perform private.set_file_audience_targets(v_file.id, v_file.audience, p_team_ids, p_position_ids);
  else
    select * into v_file from public.attachments where id = p_attachment for update;
    if not found or not private.can_read_attachment(v_user, p_attachment) then
      raise exception 'File not found' using errcode = 'P0002';
    end if;
    if not private.can_write_attachment(v_user, p_attachment) then
      raise exception 'You cannot change this file' using errcode = '42501';
    end if;
    if v_file.kind <> p_kind then
      raise exception 'This file is not a %', p_kind using errcode = '22023';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_file.revision then
      raise exception 'This file changed since you opened it' using errcode = 'PT409', hint = 'file_changed';
    end if;
    update public.attachments
       set title = v_title,
           external_url = case when p_kind = 'link' then btrim(p_external_url) else external_url end,
           filename = case when p_kind = 'link' then v_title else left(private.file_safe_name(v_title), 190) || '.md' end,
           revision = revision + 1, updated_at = now(), updated_by = v_user
     where id = v_file.id returning * into v_file;
  end if;

  if p_kind = 'document' then
    select coalesce(max(version_number), 0) + 1 into v_number
      from public.attachment_versions where attachment_id = v_file.id;
    insert into public.attachment_versions (
      attachment_id, organization_id, version_number, status, filename, mime_type, declared_size,
      size_bytes, document_body, base_version_id, idempotency_key, finalized_at, finalized_by, created_by
    ) values (
      v_file.id, v_file.organization_id, v_number, 'ready', v_file.filename, 'text/markdown', v_bytes,
      v_bytes, v_body, v_file.current_version_id, case when p_attachment is null then p_idempotency_key end,
      now(), v_user, v_user
    ) returning * into v_version;
    update public.attachments
       set current_version_id = v_version.id, size_bytes = v_bytes, mime_type = 'text/markdown'
     where id = v_file.id;
  end if;

  return jsonb_build_object('attachment', private.file_json(v_file.id), 'replayed', false);
end;
$$;
