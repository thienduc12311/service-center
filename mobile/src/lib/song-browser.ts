import {
  SONG_USAGE_WINDOW_WEEKS,
  initialArrangementFor,
  type ListSongsQuery,
  type NewPlanItemDraft,
  type SongListItem,
} from '@service-center/shared';
import { matchesSearch } from './list-search';

/**
 * The plan's song browser (large-list review §3.1): what the default view
 * shows, how tabs and filter chips map onto `GET /songs`, and how each row
 * describes a song's recent use. Pure, so the query each tab sends is tested.
 */

/** The browser's three starting views. */
export type SongBrowserTab =
  /** Songs this service type used in the last 12 weeks, most used first (the rotation). */
  | 'suggested'
  /** Newest songs first, the ones that are easy to forget. */
  | 'recent'
  /** The whole library A–Z. */
  | 'title';

export const SONG_BROWSER_TABS: readonly SongBrowserTab[] = ['suggested', 'recent', 'title'];

/** Rows per page; a phone screen and a half, so the next page is ready before the end. */
export const SONG_BROWSER_PAGE_SIZE = 30;

/** "Hide songs used in the last 3 weeks". */
export const HIDE_USED_WEEKS = 3;

/** A song sung within this many days of the plan's date gets a soft warning. */
export const RECENT_USE_WARNING_DAYS = 14;

/** The filter chips under the search box. Null means "any". */
export interface SongBrowserFilters {
  key: string | null;
  /** One of `SONG_SPEEDS` (stored in English; only the caption is translated). */
  speed: string | null;
  theme: string | null;
  songType: string | null;
  hideRecentlyUsed: boolean;
}

export const NO_SONG_FILTERS: SongBrowserFilters = { key: null, speed: null, theme: null, songType: null, hideRecentlyUsed: false };

/** How many filter chips are switched on (the tab is not a filter). */
export const activeSongFilterCount = (filters: SongBrowserFilters): number =>
  [filters.key, filters.speed, filters.theme, filters.songType].filter(Boolean).length + (filters.hideRecentlyUsed ? 1 : 0);

/** What the browser knows about the plan it adds to. */
export interface SongBrowserContext {
  planId: string;
  /** The plan's service type; null makes "Suggested" church-wide. */
  serviceTypeId: string | null;
  /** ISO instant the browser opened; fixed so pages don't shift while scrolling. */
  openedAt: string;
}

export interface SongBrowserQueryInput {
  tab: SongBrowserTab;
  filters: SongBrowserFilters;
  /** The settled (debounced) search text. */
  search: string;
  context: SongBrowserContext;
}

/** The `GET /songs` parameters for one view, without the page. */
export type SongBrowserQuery = Omit<Partial<ListSongsQuery>, 'page' | 'per_page'>;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `weeks` weeks before `iso`, as the API's ISO datetime. */
export const weeksBefore = (iso: string, weeks: number): string => new Date(Date.parse(iso) - weeks * WEEK_MS).toISOString();

/**
 * The query one view sends. Every view names the plan (rows say "in this
 * plan") and its service type (usage counts are this service's). Suggested
 * only lists the rotation while browsing; once the planner types a search it
 * looks through the whole library, still most-used first, so a song outside
 * the rotation can be found without switching tabs.
 */
export const songBrowserQuery = ({ tab, filters, search, context }: SongBrowserQueryInput): SongBrowserQuery => {
  const q = search.trim();
  const query: SongBrowserQuery = {
    archive: 'active',
    plan_id: context.planId,
    sort: tab === 'suggested' ? 'most_used' : tab === 'recent' ? 'recently_added' : 'title',
  };
  if (q) query.q = q;
  if (context.serviceTypeId) query.service_type_id = context.serviceTypeId;
  if (tab === 'suggested' && !q) {
    query.scheduled_from = weeksBefore(context.openedAt, SONG_USAGE_WINDOW_WEEKS);
    query.scheduled_to = context.openedAt;
  }
  if (filters.key) query.key = filters.key;
  if (filters.speed) query.speed = filters.speed;
  if (filters.theme) query.theme = filters.theme;
  if (filters.songType) query.song_type = filters.songType;
  if (filters.hideRecentlyUsed) query.not_scheduled_since = weeksBefore(context.openedAt, HIDE_USED_WEEKS);
  return query;
};

/**
 * Whether the song was (or is) scheduled within `days` of the plan's date —
 * a soft "sung recently" warning, never a block. A song already in this plan
 * is marked as such instead, so the caller leaves those out.
 */
export const isRecentlyUsed = (lastScheduledAt: string | null, planDate: string, days: number = RECENT_USE_WARNING_DAYS): boolean => {
  if (!lastScheduledAt) return false;
  const last = Date.parse(lastScheduledAt);
  const plan = Date.parse(planDate);
  if (Number.isNaN(last) || Number.isNaN(plan)) return false;
  return Math.abs(plan - last) <= days * DAY_MS;
};

/** How long ago a song was last used, in the coarsest unit that still reads naturally. */
export type SongAge =
  | { unit: 'today' }
  | { unit: 'days' | 'weeks' | 'months' | 'years'; count: number }
  /** Its latest plan is still ahead (`last_scheduled_at` counts future plans). */
  | { unit: 'upcoming' };

/** "Today", "5 days", "3 weeks", "4 months", "2 years" — or an upcoming plan. */
export const songAge = (lastScheduledAt: string, now: string): SongAge => {
  const diff = Date.parse(now) - Date.parse(lastScheduledAt);
  // A plan later today still reads as "today", not as upcoming.
  if (diff < -12 * 60 * 60 * 1000) return { unit: 'upcoming' };
  const days = Math.max(0, Math.floor(diff / DAY_MS));
  if (days === 0) return { unit: 'today' };
  if (days < 14) return { unit: 'days', count: days };
  if (days < 60) return { unit: 'weeks', count: Math.floor(days / 7) };
  if (days < 365) return { unit: 'months', count: Math.floor(days / 30) };
  return { unit: 'years', count: Math.floor(days / 365) };
};

/**
 * Themes to offer in the theme filter: those on songs already loaded that
 * match what was typed (accent-insensitive), A–Z, at most `limit`. There is no
 * theme vocabulary endpoint; typed text can always be used as is.
 */
export const themeSuggestions = (songs: readonly Pick<SongListItem, 'themes'>[], query: string, limit = 20): string[] => {
  const seen = new Map<string, string>();
  for (const song of songs) {
    for (const theme of song.themes ?? []) {
      const key = theme.trim().toLowerCase();
      if (key && !seen.has(key) && matchesSearch(query, [theme])) seen.set(key, theme.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, limit);
};

/**
 * The add body's draft for a one-tap add: the song with its starting
 * arrangement's key (else the song's default key), as the old form picked it.
 */
export const songAddDraft = (song: SongListItem): NewPlanItemDraft => ({
  itemType: 'song',
  title: '',
  song,
  keyOverride: initialArrangementFor(song.arrangements)?.song_key ?? song.default_key ?? null,
  length: '',
  description: '',
});
