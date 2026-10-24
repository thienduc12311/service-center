import {
  formatDuration,
  setPlanItemMediaSchema,
  type ListMediaRequest,
  type MediaSummary,
  type PlanDetail,
  type PlanItemDetail,
  type SetPlanItemMediaInput,
} from '@service-center/shared';

/**
 * MOB-030: F14 media bundles on the website's contracts (`mediaList`,
 * `media`, `setPlanItemMedia`) and its F13 files (`files('media', id)`,
 * `createFileUploadIntent`, `finalizeFile`). The phone browses, opens and
 * links existing bundles and adds permitted files to them; creating,
 * editing, archiving and deleting a bundle, and choosing its thumbnail, stay
 * website workflows (no native media-record authoring).
 */

/** The list request as the website's library sends it: blank search left out. */
export const mediaListRequest = (query: string, includeArchived: boolean): ListMediaRequest => ({
  ...(query.trim() ? { q: query.trim() } : {}),
  ...(includeArchived ? { include_archived: true } : {}),
});

/** The secondary line of a bundle row: creator, length and themes (website `LinkMediaModal`). */
export const mediaSummaryLine = (media: Pick<MediaSummary, 'creator' | 'duration_seconds' | 'themes'>): string =>
  [media.creator, media.duration_seconds ? formatDuration(media.duration_seconds) : null, ...media.themes]
    .filter(Boolean)
    .join(' · ');

/** Only a regular order item can carry a bundle (the server refuses songs and headers with 400). */
export const canLinkMedia = (item: Pick<PlanItemDetail, 'item_type'>, canEditPlan: boolean): boolean =>
  canEditPlan && item.item_type === 'item';

/**
 * The link (or clear, with null) body: always checked against the plan
 * revision the screen shows, so a link chosen over a changed order is
 * refused (409 `plan_revision_stale`) instead of applied to the wrong state.
 */
export const mediaLinkBody = (mediaId: string | null, plan: Pick<PlanDetail, 'content_revision'>): SetPlanItemMediaInput =>
  setPlanItemMediaSchema.parse({ media_id: mediaId, expected_revision: plan.content_revision });

/** Pickers offer only bundles that are not archived; an item already using one keeps it. */
export const linkableMedia = (media: readonly MediaSummary[]): MediaSummary[] => media.filter((row) => !row.is_archived);
