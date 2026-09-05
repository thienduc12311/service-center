-- ============================================================================
-- Phase 2 — import a chord sheet from an image.
--
-- The table is created up front so Phase 1 clients can already upload and list
-- imports; the OCR worker in backend/src/services/chord-import fills in the
-- recognised text and the parsed ChordPro.
-- ============================================================================

create type public.import_status as enum ('pending', 'processing', 'succeeded', 'failed');

create table public.chord_sheet_imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,

  storage_path     text not null,           -- chord-sheets/<org_id>/<uuid>.jpg
  original_filename text,
  status           public.import_status not null default 'pending',

  provider         text,                    -- which OCR/vision backend ran
  raw_text         text,                    -- text as recognised
  parsed_chordpro  text,                    -- normalised ChordPro
  detected_title   text,
  detected_key     text,
  confidence       numeric(4,3) check (confidence is null or confidence between 0 and 1),
  error_message    text,

  -- Set once the operator accepts the result and it becomes a real song.
  song_id          uuid references public.songs (id) on delete set null,
  arrangement_id   uuid references public.arrangements (id) on delete set null,

  processing_started_at  timestamptz,
  processing_finished_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.chord_sheet_imports (organization_id, created_at desc);
create index on public.chord_sheet_imports (status) where status in ('pending', 'processing');

create trigger set_updated_at before update on public.chord_sheet_imports
  for each row execute function public.set_updated_at();

alter table public.chord_sheet_imports enable row level security;

create policy chord_sheet_imports_select on public.chord_sheet_imports
  for select using (public.is_org_member(organization_id));
create policy chord_sheet_imports_write on public.chord_sheet_imports
  for all using (public.can_manage_org(organization_id))
  with check (public.can_manage_org(organization_id));
