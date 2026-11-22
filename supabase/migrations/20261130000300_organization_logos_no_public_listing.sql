-- SEC-010: the organization-logos bucket no longer lists every church.
--
-- "public reads organization logos" (20260905000100) granted SELECT on the
-- bucket's storage.objects rows to everyone, so anyone holding the public anon
-- key could call POST /storage/v1/object/list/organization-logos and read
-- every organization's id from the folder names. The bucket is public, so a
-- logo's public URL is served without any SELECT policy; the app only uploads
-- (no upsert) and builds public URLs. Reading the rows themselves is now
-- limited to members of the organization the folder belongs to, the same
-- folder rule the write policies use.

drop policy if exists "public reads organization logos" on storage.objects;

create policy "members read their organization logos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'organization-logos'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
