-- ============================================================================
-- Remove the OCR chord-sheet import feature.
--
-- Charts are now typed or pasted directly into an arrangement, so the import
-- pipeline (upload → vision model → accept) and the daily AI quota that
-- rationed it are gone. This drops their tables and functions and removes the
-- obsolete bucket from the application-facing storage policies.
--
-- DESTRUCTIVE: every `chord_sheet_imports` row is deleted. Songs and
-- arrangements created from past imports are untouched — they are ordinary
-- rows in `songs`/`arrangements` and only referenced *from* the import table,
-- never the other way round.
--
-- Supabase requires objects and buckets to be deleted through the Storage API;
-- direct SQL deletion only removes metadata and is rejected on hosted projects.
-- Empty and delete the `chord-sheets` bucket separately after this migration.
-- ============================================================================

drop table if exists public.chord_sheet_imports;
drop table if exists public.ai_import_usage;

-- Only `chord_sheet_imports.status` ever used this enum.
drop type if exists public.import_status;

drop function if exists public.ai_import_quota_status(uuid, integer);
drop function if exists public.consume_ai_import_quota(uuid, integer);
-- Added solely to resolve the quota's local-midnight reset.
drop function if exists public.org_timezone(uuid);

-- ------------------------------------------------------------- storage ----
-- The three attachment policies were written to cover both buckets; narrow
-- them to `attachments` before the bucket itself goes.
drop policy if exists "org members read attachments"    on storage.objects;
drop policy if exists "org members write attachments"   on storage.objects;
drop policy if exists "org managers delete attachments" on storage.objects;

create policy "org members read attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org members write attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org managers delete attachments" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_manage_org(((storage.foldername(name))[1])::uuid)
  );
