import type { SongRow } from './database.js';
import type { SongBulkPatch } from '../schemas/song.js';

export interface SongBulkOutcome {
  id: string;
  before: SongRow;
  after: SongRow;
  outcome: 'updated';
}
export type SongBulkPreview = {
  id: string;
  organization_id: string;
  created_by: string;
  patch: SongBulkPatch;
  rows: SongBulkOutcome[];
  created_at: string;
  committed_at: string | null;
}

export type SongCurationEventRow = {
  id: string;
  organization_id: string;
  actor_id: string | null;
  target_kind: 'song' | 'arrangement';
  target_id: string;
  before_row: unknown;
  after_row: unknown;
  preview_id: string | null;
  created_at: string;
}
