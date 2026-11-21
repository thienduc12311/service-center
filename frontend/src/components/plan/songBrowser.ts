import {
  SONG_USAGE_WINDOW_WEEKS,
  initialArrangementFor,
  type ArrangementRow,
  type ListSongsQuery,
  type SongListItem,
} from '@service-center/shared';

/**
 * The song browser's pure parts: which `GET /songs` query each tab and filter
 * sends, and how a row's usage reads. Kept apart from the components so the
 * query contract is testable without rendering.
 */

/** The browser's tabs: the church's rotation, new songs, or the whole library. */
export type SongBrowserTab = 'suggested' | 'recent' | 'all';

export const SONG_BROWSER_TABS: readonly SongBrowserTab[] = ['suggested', 'recent', 'all'];

/** The filter chips. Empty strings are "any". */
export interface SongBrowserFilters {
  key: string;
  speed: string;
  theme: string;
  songType: string;
  /** Leave out songs scheduled in the last `HIDE_RECENT_WEEKS` weeks. */
  hideRecent: boolean;
}

export const EMPTY_SONG_BROWSER_FILTERS: SongBrowserFilters = { key: '', speed: '', theme: '', songType: '', hideRecent: false };

/** Rows per page; "Show more" loads the next one. */
export const SONG_BROWSER_PAGE_SIZE = 20;
/** "Hide songs used in the last 3 weeks". */
export const HIDE_RECENT_WEEKS = 3;
/** A song sung this close to the plan's date gets a soft warning. */
export const RECENT_USE_WARNING_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** What the browser needs to know about the plan it adds to. */
export interface SongBrowserContext {
  planId: string;
  /** Null: the plan has no service type, so the rotation is church-wide. */
  serviceTypeId: string | null;
  now: Date;
}

export interface SongBrowserQueryInput extends SongBrowserContext {
  tab: SongBrowserTab;
  /** The settled search text; empty is no search. */
  q: string;
  filters: SongBrowserFilters;
}

/** The `GET /songs` query (without paging) for one state of the browser. */
export type SongBrowserQuery = Omit<Partial<ListSongsQuery>, 'page'>;

const TAB_SORT: Record<SongBrowserTab, NonNullable<ListSongsQuery['sort']>> = {
  suggested: 'most_used',
  recent: 'recent',
  all: 'title',
};

/**
 * Suggested is the rotation: songs used with this service type (church-wide
 * without one) in the last `SONG_USAGE_WINDOW_WEEKS` weeks, most used first.
 * A search looks through the whole library in the tab's order, so the
 * rotation's matches still come first under Suggested. Every query names the
 * plan, so rows already in it come back marked.
 */
export const songBrowserQuery = ({ tab, q, filters, planId, serviceTypeId, now }: SongBrowserQueryInput): SongBrowserQuery => {
  const search = q.trim();
  return {
    sort: TAB_SORT[tab],
    plan_id: planId,
    per_page: SONG_BROWSER_PAGE_SIZE,
    ...(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
    ...(tab === 'suggested' && !search
      ? { scheduled_from: new Date(now.getTime() - SONG_USAGE_WINDOW_WEEKS * WEEK_MS).toISOString() }
      : {}),
    ...(search ? { q: search } : {}),
    ...(filters.key ? { key: filters.key } : {}),
    ...(filters.speed ? { speed: filters.speed } : {}),
    ...(filters.theme.trim() ? { theme: filters.theme.trim() } : {}),
    ...(filters.songType ? { song_type: filters.songType } : {}),
    ...(filters.hideRecent
      ? { not_scheduled_since: new Date(now.getTime() - HIDE_RECENT_WEEKS * WEEK_MS).toISOString() }
      : {}),
  };
};

/** How many filter chips are set (the search and tab are not filters). */
export const activeSongFilterCount = (filters: SongBrowserFilters): number =>
  [filters.key, filters.speed, filters.theme.trim(), filters.songType].filter(Boolean).length + (filters.hideRecent ? 1 : 0);

/** True when the song was scheduled within two weeks either side of the plan's date. */
export const isRecentlyUsed = (lastScheduledAt: string | null, planDate: string): boolean => {
  if (!lastScheduledAt) return false;
  const gap = Math.abs(Date.parse(planDate) - Date.parse(lastScheduledAt));
  return Number.isFinite(gap) && gap <= RECENT_USE_WARNING_DAYS * DAY_MS;
};

/** How long ago something happened, in the largest whole unit. */
export type UsageAge =
  | { unit: 'today' }
  | { unit: 'upcoming' }
  | { unit: 'days' | 'weeks' | 'months' | 'years'; count: number };

export const usageAge = (instant: string, now: Date): UsageAge => {
  const elapsed = now.getTime() - Date.parse(instant);
  if (elapsed < 0) return { unit: 'upcoming' };
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 1) return { unit: 'today' };
  if (days < 14) return { unit: 'days', count: days };
  if (days < 60) return { unit: 'weeks', count: Math.floor(days / 7) };
  if (days < 365) return { unit: 'months', count: Math.floor(days / 30) };
  return { unit: 'years', count: Math.floor(days / 365) };
};

/** The arrangement fields a row shows and the add uses. */
export type BrowserArrangement = Pick<
  ArrangementRow,
  'id' | 'name' | 'song_key' | 'bpm' | 'sequence' | 'is_default' | 'archived_at' | 'length_seconds'
>;

/** The default a one-click add uses: the song's default arrangement, its key and tempo. */
export interface SongDefaults {
  arrangement: BrowserArrangement | null;
  key: string | null;
  bpm: number | null;
}

export const songDefaults = (song: Pick<SongListItem, 'arrangements' | 'default_key' | 'default_bpm'>): SongDefaults => {
  const arrangement = initialArrangementFor(song.arrangements);
  return {
    arrangement,
    key: arrangement?.song_key ?? song.default_key ?? null,
    bpm: arrangement?.bpm ?? song.default_bpm ?? null,
  };
};

/** Arrangements a new item can use: archived ones are never offered. */
export const activeArrangements = (song: Pick<SongListItem, 'arrangements'>): BrowserArrangement[] =>
  song.arrangements.filter((arrangement) => !arrangement.archived_at);
