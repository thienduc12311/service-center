import { matchesSearch } from './list-search';

/**
 * Shaping for `SearchableOptionSheet`: small option sets stay a chip wall;
 * larger ones become a searchable, grouped list (large-list review §2,
 * "Org data, 15–100": type-to-filter, grouping, likely options first).
 */

/** At most this many options render as chips; more switch to a searchable list. */
export const OPTION_CHIP_LIMIT = 12;

/** One choice in a searchable option list. */
export interface SearchableOption {
  value: string;
  /** The label on its own (chips, and rows when there are no groups). */
  label: string;
  /** Shorter label used inside a group, where the group title already says the rest. */
  groupedLabel?: string;
  /** The group this option belongs to (a team, a service type); null/absent for ungrouped. */
  groupKey?: string | null;
  groupLabel?: string | null;
  /** A secondary line, searched too. */
  detail?: string | null;
}

/** A titled run of options, ready for a `SectionList`. */
export interface OptionSection {
  key: string;
  /** Null for options without a group. */
  title: string | null;
  data: SearchableOption[];
}

/** Single choice (radio) or several (checkboxes). */
export type OptionSelectMode = 'single' | 'multi';

export interface OptionGroupingOrder {
  /** Group keys shown first, in this order (e.g. the plan's own service type). */
  leadingGroupKeys?: readonly string[];
}

/** Whether `count` options are too many for a chip wall. */
export const usesSearchableList = (count: number, limit: number = OPTION_CHIP_LIMIT): boolean => count > limit;

/** Options whose label, group or detail match every word of `query` (accent-insensitive). */
export const filterOptions = (options: readonly SearchableOption[], query: string): SearchableOption[] =>
  options.filter((option) => matchesSearch(query, [option.label, option.groupedLabel, option.groupLabel, option.detail]));

const UNGROUPED = '';

/**
 * Options in sections by group, each group where it first appears, except the
 * leading groups, which come first. Ungrouped options form one untitled
 * section at the top.
 */
export const groupOptions = (options: readonly SearchableOption[], order: OptionGroupingOrder = {}): OptionSection[] => {
  const sections = new Map<string, OptionSection>();
  for (const option of options) {
    const key = option.groupKey ?? UNGROUPED;
    let section = sections.get(key);
    if (!section) {
      section = { key, title: key === UNGROUPED ? null : (option.groupLabel ?? null), data: [] };
      sections.set(key, section);
    }
    section.data.push(option);
  }
  const leading = order.leadingGroupKeys ?? [];
  const rank = (key: string): number => {
    if (key === UNGROUPED) return -1;
    const index = leading.indexOf(key);
    return index === -1 ? leading.length : index;
  };
  // Array sort is stable, so groups keep their first-seen order within a rank.
  return [...sections.values()].sort((a, b) => rank(a.key) - rank(b.key));
};

/** Filter, then group: what the searchable list shows for `query`. */
export const optionSections = (
  options: readonly SearchableOption[],
  query: string,
  order: OptionGroupingOrder = {},
): OptionSection[] => groupOptions(filterOptions(options, query), order);

/** The selection after tapping `value`: replaces it (single) or toggles it (multi). */
export const nextSelection = (mode: OptionSelectMode, current: readonly string[], value: string): string[] => {
  if (mode === 'single') return [value];
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
};

/** The labels of the selected options, in option order (unknown values are skipped). */
export const selectedLabels = (options: readonly SearchableOption[], selected: readonly string[]): string[] =>
  options.filter((option) => selected.includes(option.value)).map((option) => option.label);
