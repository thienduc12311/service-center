import type { CreatePlanItemRequest } from '../schemas/plan.js';
import { parseDuration } from './dates.js';
import { MAX_ITEM_LENGTH_SECONDS } from './plan-item-draft.js';

/**
 * Faster order-of-service editing: the quick-add line ("Welcome 3:00",
 * "# Worship") and the order a drag-and-drop produces. Pure, so the website
 * and the native app read a typed line the same way.
 */

/** The longest title the add endpoint accepts. */
export const MAX_QUICK_ADD_TITLE_LENGTH = 200;

/** What a quick-add line creates. */
export type QuickAddItemType = 'item' | 'header';

/** One parsed quick-add line. */
export interface QuickAddEntry {
  itemType: QuickAddItemType;
  title: string;
  /** Null when the line named no length (a header never has one). */
  lengthSeconds: number | null;
}

/** Why a line cannot be added yet; each is `plans:quickAdd.errors.<problem>`. */
export type QuickAddProblem = 'empty' | 'titleRequired' | 'titleTooLong' | 'lengthFormat' | 'lengthRange';

export type QuickAddParseResult =
  | { ok: true; entry: QuickAddEntry }
  | { ok: false; problem: QuickAddProblem };

/** Digits separated by colons; only `m:ss` and `h:mm:ss` are valid lengths. */
const CLOCK_TOKEN = /^\d+(?::\d+)+$/;
/** `35m`, `90s`, `1h`, `1h30m`, `2m30s`, `5min`, `45sec`. */
const UNIT_TOKEN = /^(?:(\d+)h)?(?:(\d+)m(?:in)?)?(?:(\d+)s(?:ec)?)?$/i;
/** Separators left between a title and its length ("Welcome - 3:00"). */
const TRAILING_SEPARATORS = /[\s\-–—·,]+$/u;

/** How a trailing word reads as a length. */
type LengthToken = { kind: 'length'; seconds: number } | { kind: 'invalid' } | { kind: 'not-length' };

const readLengthToken = (token: string): LengthToken => {
  if (CLOCK_TOKEN.test(token)) {
    const seconds = parseDuration(token);
    return seconds === null ? { kind: 'invalid' } : { kind: 'length', seconds };
  }
  const unit = UNIT_TOKEN.exec(token);
  if (unit && (unit[1] ?? unit[2] ?? unit[3]) !== undefined) {
    const [hours, minutes, seconds] = [unit[1], unit[2], unit[3]].map((part) => Number(part ?? 0)) as [number, number, number];
    return { kind: 'length', seconds: hours * 3600 + minutes * 60 + seconds };
  }
  return { kind: 'not-length' };
};

const checkedTitle = (title: string): QuickAddProblem | null => {
  if (!title) return 'titleRequired';
  if (title.length > MAX_QUICK_ADD_TITLE_LENGTH) return 'titleTooLong';
  return null;
};

/**
 * Reads one quick-add line. A leading `#` makes a header ("# Worship"). For
 * an item, a last word that is a length (`3:00`, `1:02:03`, `5m`, `90s`,
 * `1h30m`) sets its length and the rest is the title; any other last word,
 * including a bare number ("Psalm 23"), stays part of the title.
 */
export const parseQuickAddLine = (input: string): QuickAddParseResult => {
  const line = input.trim();
  if (!line) return { ok: false, problem: 'empty' };

  if (line.startsWith('#')) {
    const title = line.replace(/^#+/, '').trim();
    const problem = checkedTitle(title);
    return problem ? { ok: false, problem } : { ok: true, entry: { itemType: 'header', title, lengthSeconds: null } };
  }

  const lastSpace = line.search(/\s\S+$/);
  const lastWord = lastSpace === -1 ? line : line.slice(lastSpace).trim();
  const length = readLengthToken(lastWord);
  if (length.kind === 'invalid') return { ok: false, problem: 'lengthFormat' };
  if (length.kind === 'not-length') {
    const problem = checkedTitle(line);
    return problem ? { ok: false, problem } : { ok: true, entry: { itemType: 'item', title: line, lengthSeconds: null } };
  }

  const title = (lastSpace === -1 ? '' : line.slice(0, lastSpace)).replace(TRAILING_SEPARATORS, '');
  const problem = checkedTitle(title);
  if (problem) return { ok: false, problem };
  if (length.seconds > MAX_ITEM_LENGTH_SECONDS) return { ok: false, problem: 'lengthRange' };
  return { ok: true, entry: { itemType: 'item', title, lengthSeconds: length.seconds } };
};

/** The add-item body for a parsed line (the server appends it at the end). */
export const quickAddRequest = (entry: QuickAddEntry): CreatePlanItemRequest => ({
  item_type: entry.itemType,
  title: entry.title,
  length_seconds: entry.itemType === 'header' ? 0 : (entry.lengthSeconds ?? 0),
});

/**
 * The full order after dropping `activeId` where `overId` was; null when the
 * drop changes nothing or names an id that is not in the order. Sent whole
 * with the plan revision, like a step move.
 */
export const itemIdsAfterDrop = (ids: readonly string[], activeId: string, overId: string): string[] | null => {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
};

/** What `itemsInOrder` needs from an item. */
export interface OrderedItem {
  id: string;
  sort_order: number;
}

/**
 * The items rearranged to `ids` with `sort_order` renumbered from 0, for an
 * optimistic order on screen. Returns the items unchanged when `ids` is not
 * exactly the same set of items.
 */
export const itemsInOrder = <T extends OrderedItem>(items: readonly T[], ids: readonly string[]): T[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return [...items];
  return ids.map((id, index) => ({ ...byId.get(id)!, sort_order: index }));
};
