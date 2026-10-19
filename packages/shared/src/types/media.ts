/**
 * F14 Pass B: reusable media bundles and stage layouts.
 *
 * A media bundle is library content separate from songs and song books. Its
 * files are F13 files owned by the bundle (`owner_kind = 'media'`), so their
 * versions, audiences and Storage access are the F13 ones. An order item of
 * type `item` links one bundle; usage history is those items.
 */
import type { FileSummary } from './files.js';

export type MediaRow = {
  id: string;
  organization_id: string;
  title: string;
  creator: string | null;
  duration_seconds: number | null;
  themes: string[];
  tags: string[];
  notes: string | null;
  thumbnail_file_id: string | null;
  /** Hidden from pickers from this date (organization timezone) on. */
  archive_on: string | null;
  archived_at: string | null;
  archived_by: string | null;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

export interface MediaSummary {
  id: string;
  title: string;
  creator: string | null;
  duration_seconds: number | null;
  themes: string[];
  tags: string[];
  notes: string | null;
  thumbnail_file_id: string | null;
  archive_on: string | null;
  archived_at: string | null;
  /** Archived now or its archive date has arrived. */
  is_archived: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
  /** Number of plan items that use it (any date). */
  usage_count: number;
  last_used_on: string | null;
}

/** One plan item that uses a bundle. */
export interface MediaUsage {
  plan_id: string;
  plan_title: string;
  service_date: string;
  item_id: string;
  item_title: string;
}

export interface MediaDetail extends MediaSummary {
  files: FileSummary[];
  /** Newest service date first (bounded). */
  usage: MediaUsage[];
  can_edit: boolean;
  can_add_files: boolean;
}

export interface MediaList {
  media: MediaSummary[];
  can_create: boolean;
}

// --------------------------------------------------------- stage layouts --

export type StageBackground = 'blank' | 'stage' | 'thrust' | 'round';

export type StageObjectKind = 'person' | 'gear' | 'label';

/**
 * One placed object in a unit square: `x`/`y` is its centre and `w`/`h` its
 * size as fractions of the stage, so any output size draws the same layout.
 */
export interface StageObject {
  id: string;
  kind: StageObjectKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  label: string;
  color: string | null;
  /** People only: the Person placed, and `label` is their name when placed. */
  person_id?: string | null;
}

export type StageLayoutTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  background: StageBackground;
  objects: StageObject[];
  archived_at: string | null;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

export type PlanStageLayoutRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  template_id: string | null;
  name: string;
  background: StageBackground;
  objects: StageObject[];
  refreshed_at: string | null;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

export interface StageLayoutTemplateList {
  templates: StageLayoutTemplateRow[];
  can_manage: boolean;
}

/** Someone the plan currently staffs, as a layout compares against. */
export interface StageRosterPerson {
  person_id: string;
  name: string;
  /** Team and position names of every non-declined request on the plan. */
  roles: string[];
  /** Not yet released to the person (visible to schedulers only). */
  prepared: boolean;
  /** Archived from the roster since. */
  archived: boolean;
}

export type StageLayoutIssueKind =
  /** Placed, but no longer (or never) scheduled on this plan. */
  | 'not_scheduled'
  /** Placed, but archived from the roster. */
  | 'departed'
  /** Placed under a name that has since changed. */
  | 'renamed'
  /** Scheduled on the plan but not placed on this layout. */
  | 'unplaced';

export interface StageLayoutIssue {
  kind: StageLayoutIssueKind;
  person_id: string;
  /** The placed object, when there is one. */
  object_id: string | null;
  /** The name to show: current when known, else the captured label. */
  name: string;
}

export interface PlanStageLayoutView {
  layout: PlanStageLayoutRow;
  roster: StageRosterPerson[];
  issues: StageLayoutIssue[];
}

export interface PlanStageLayouts {
  plan_id: string;
  layouts: PlanStageLayoutView[];
  roster: StageRosterPerson[];
  can_edit: boolean;
}
