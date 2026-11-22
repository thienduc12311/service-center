import { formatDuration, parseDuration, type PlanItemType, type PlanTemplateItem } from '@service-center/shared';

/** The item form's fields while someone edits them (length as typed, "4:30"). */
export interface TemplateItemDraft {
  itemType: PlanItemType;
  title: string;
  songId: string | null;
  /** Title of the chosen song, shown beside the picker. */
  songTitle: string | null;
  arrangementId: string | null;
  keyOverride: string | null;
  length: string;
  description: string;
}

/** Why a draft cannot become a template item yet (a `templates:itemForm.errors.*` key). */
export type TemplateItemProblem = 'songRequired' | 'titleRequired' | 'length';

/** Either the item to store or what is wrong with the draft. */
export type TemplateItemResult = { ok: true; item: PlanTemplateItem } | { ok: false; problem: TemplateItemProblem };

/** Longest item a template accepts (the schema's bound, 10 hours). */
const MAX_LENGTH_SECONDS = 36_000;

export const emptyTemplateItemDraft = (itemType: PlanItemType): TemplateItemDraft => ({
  itemType,
  title: '',
  songId: null,
  songTitle: null,
  arrangementId: null,
  keyOverride: null,
  length: '',
  description: '',
});

export const templateItemDraftFrom = (item: PlanTemplateItem): TemplateItemDraft => ({
  itemType: item.item_type,
  title: item.title,
  songId: item.song_id,
  songTitle: item.song_id ? item.title : null,
  arrangementId: item.arrangement_id,
  keyOverride: item.key_override,
  length: item.length_seconds > 0 ? formatDuration(item.length_seconds) : '',
  description: item.description ?? '',
});

/**
 * The template item a draft describes. A header carries a title only; a
 * song keeps its song, arrangement and key (its title defaults to the
 * song's); anything else drops song fields.
 */
export const templateItemFromDraft = (draft: TemplateItemDraft): TemplateItemResult => {
  const isSong = draft.itemType === 'song';
  const title = draft.title.trim() || (isSong ? (draft.songTitle ?? '') : '');
  if (isSong && !draft.songId) return { ok: false, problem: 'songRequired' };
  if (!title) return { ok: false, problem: 'titleRequired' };
  let lengthSeconds = 0;
  if (draft.itemType !== 'header' && draft.length.trim()) {
    const parsed = parseDuration(draft.length);
    if (parsed === null || parsed > MAX_LENGTH_SECONDS) return { ok: false, problem: 'length' };
    lengthSeconds = parsed;
  }
  return {
    ok: true,
    item: {
      item_type: draft.itemType,
      title,
      song_id: isSong ? draft.songId : null,
      arrangement_id: isSong ? draft.arrangementId : null,
      key_override: isSong ? draft.keyOverride : null,
      length_seconds: lengthSeconds,
      description: draft.itemType === 'header' ? null : draft.description.trim() || null,
    },
  };
};
