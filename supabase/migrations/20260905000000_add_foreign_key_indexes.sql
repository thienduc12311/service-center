-- Index foreign-key columns that are not already covered by the leading
-- columns of an existing index. This keeps joins and cascading deletes from
-- degrading into full-table scans as organizations grow.

create index if not exists teams_service_type_id_idx on public.teams (service_type_id);
create index if not exists team_memberships_position_id_idx on public.team_memberships (position_id);
create index if not exists songs_created_by_idx on public.songs (created_by);
create index if not exists plans_created_by_idx on public.plans (created_by);
create index if not exists plan_items_song_id_idx on public.plan_items (song_id);
create index if not exists plan_items_arrangement_id_idx on public.plan_items (arrangement_id);
create index if not exists assignments_team_id_idx on public.assignments (team_id);
create index if not exists assignments_position_id_idx on public.assignments (position_id);
create index if not exists assignments_created_by_idx on public.assignments (created_by);
create index if not exists attachments_arrangement_id_idx on public.attachments (arrangement_id);
create index if not exists attachments_created_by_idx on public.attachments (created_by);
create index if not exists chord_sheet_imports_created_by_idx on public.chord_sheet_imports (created_by);
create index if not exists chord_sheet_imports_song_id_idx on public.chord_sheet_imports (song_id);
create index if not exists chord_sheet_imports_arrangement_id_idx on public.chord_sheet_imports (arrangement_id);
