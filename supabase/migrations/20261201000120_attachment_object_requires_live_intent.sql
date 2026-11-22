-- W10-FGH-D5: a signed upload PUT after `abandon_file_version` still stored
-- the object, leaving bytes in the `attachments` bucket that no file version
-- points at (and that the removal queue, already drained for that path, never
-- sees again).
--
-- The "upload intent writes attachments" policy (20261030000000) only runs for
-- the `authenticated` role. A signed upload URL is checked by Storage when it
-- is *created*; the upload itself is written by `supabase_storage_admin`, the
-- table owner, so RLS no longer applies. A trigger does run for every role:
-- an object may enter the `attachments` bucket (or be moved/renamed into it)
-- only at the exact path of a version that is still `pending` and unexpired.
-- Abandoned (`failed`), expired and deleted intents are refused, so Storage
-- answers the late PUT with an error and stores nothing.
--
-- Every legitimate write to this bucket is an upload intent (the API never
-- uploads there itself; legacy objects already exist and are not re-inserted).
-- Updates that keep the name (Storage's metadata write after an upload) are
-- not checked.

create or replace function private.require_live_attachment_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id <> 'attachments' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.bucket_id is not distinct from old.bucket_id then
    return new;
  end if;
  if not exists (
    select 1 from public.attachment_versions v
     where v.storage_path = new.name
       and v.status = 'pending'
       and v.upload_expires_at > now()
  ) then
    raise exception 'This upload is no longer expected' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.require_live_attachment_upload() from public, anon, authenticated;

drop trigger if exists attachments_require_live_upload on storage.objects;
create trigger attachments_require_live_upload
  before insert or update of name, bucket_id on storage.objects
  for each row
  when (new.bucket_id = 'attachments')
  execute function private.require_live_attachment_upload();
