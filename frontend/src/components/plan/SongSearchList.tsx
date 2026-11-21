import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SongListItem } from '@service-center/shared';
import { useFormatters } from '../../i18n';
import { Icon } from '../icons';
import { ErrorNotice, Spinner } from '../ui';
import { ListFooter } from '../ListFooter';
import {
  activeArrangements,
  isRecentlyUsed,
  songDefaults,
  usageAge,
  type BrowserArrangement,
} from './songBrowser';

/** The page of songs on screen and how to get more; from `useSongPages`. */
export interface SongListSource {
  rows: readonly SongListItem[];
  /** Every match on the server; null until the first page arrives. */
  total: number | null;
  /** The first page is loading and nothing is on screen yet. */
  loading: boolean;
  /** A new search or filter is loading; the previous rows stay. */
  refreshing: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onShowMore: () => void;
  error: unknown;
}

/** How a row reads against the plan being edited. */
export interface SongRowState {
  /** Already in the plan (the server's `in_plan`, or added during this visit). */
  inPlan: boolean;
  /** An add for this song is in flight. */
  adding: boolean;
}

export interface SongSearchListProps {
  /** Accessible name of the search box. */
  searchLabel: string;
  placeholder: string;
  text: string;
  onTextChange: (text: string) => void;
  songs: SongListSource;
  /** Adds (or chooses) the song; `arrangement` is the one picked in the expanded row, if any. */
  onPick: (song: SongListItem, arrangement: BrowserArrangement | null) => void;
  /** Accessible name of a row's pick button. */
  pickLabel: (song: SongListItem, state: SongRowState) => string;
  rowState?: (song: SongListItem) => SongRowState;
  /** The plan's date: songs sung within two weeks of it get a soft warning. */
  planDate?: string;
  /** Tighter rows and a shorter list, for a form (Edit item). */
  compact?: boolean;
  /** Rows expand to show their arrangements, and one can be picked before adding. */
  expandable?: boolean;
  /** Tabs and filters, between the search box and the list. */
  toolbar?: ReactNode;
  autoFocus?: boolean;
  emptyText: string;
  /** "Now" for "last used 3 weeks ago"; injectable for tests. */
  now: Date;
}

const NO_STATE: SongRowState = { inPlan: false, adding: false };

/** "used 5× · last used 2 weeks ago", in the displayed language. */
const usageLine = (t: TFunction<['plans', 'common']>, formatDate: (value: string) => string, song: SongListItem, now: Date): string => {
  const parts: string[] = [];
  if (song.usage_count > 0) parts.push(t('songBrowser.usedCount', { count: song.usage_count }));
  if (song.last_scheduled_at) {
    const age = usageAge(song.last_scheduled_at, now);
    parts.push(
      age.unit === 'upcoming'
        ? t('songBrowser.scheduledOn', { date: formatDate(song.last_scheduled_at) })
        : t('songBrowser.lastUsed', { ago: age.unit === 'today' ? t('songBrowser.ago.today') : t(`songBrowser.ago.${age.unit}`, { count: age.count }) }),
    );
  } else {
    parts.push(t('songBrowser.neverUsed'));
  }
  return parts.join(' · ');
};

/**
 * The song browser's list: a calm server search (the caller debounces and
 * keeps previous rows), rows that carry what the choice needs (key, tempo,
 * author, how often and how lately it was sung, whether it is already in the
 * plan), keyboard picking (↑ ↓ Enter from the search box) and an honest
 * "Showing x of y · Show more" footer. Used full-size in the Add songs panel
 * and compact in Edit item's "Change song".
 */
export const SongSearchList = ({
  searchLabel,
  placeholder,
  text,
  onTextChange,
  songs,
  onPick,
  pickLabel,
  rowState,
  planDate,
  compact = false,
  expandable = false,
  toolbar,
  autoFocus = false,
  emptyText,
  now,
}: SongSearchListProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Arrangement picked per song in its expanded row; absent is the song's default. */
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(() => new Map());
  const rows = songs.rows;
  const active = Math.min(highlight, Math.max(rows.length - 1, 0));
  const activeSong = rows[active] ?? null;
  const formatDate = (value: string) => format.date(value, 'medium');

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    if (activeSong) document.getElementById(`${baseId}-row-${activeSong.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeSong, baseId]);

  const arrangementFor = (song: SongListItem): BrowserArrangement | null => {
    const id = chosen.get(song.id);
    return (id ? activeArrangements(song).find((arrangement) => arrangement.id === id) : null) ?? null;
  };

  const pick = (song: SongListItem) => onPick(song, arrangementFor(song));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight(Math.min(active + 1, Math.max(rows.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(Math.max(active - 1, 0));
    } else if (event.key === 'Enter') {
      // Never submit a surrounding form from the search box.
      event.preventDefault();
      if (activeSong && !(rowState?.(activeSong) ?? NO_STATE).adding) pick(activeSong);
    }
  };

  const showEmpty = !songs.loading && rows.length === 0 && !songs.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <label className="sr-only" htmlFor={`${baseId}-search`}>{searchLabel}</label>
        <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          id={`${baseId}-search`}
          type="search"
          autoComplete="off"
          className="input !pl-9 !pr-9"
          value={text}
          placeholder={placeholder}
          aria-describedby={`${baseId}-hint`}
          onChange={(event) => {
            onTextChange(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />
        {songs.refreshing && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400">
            <Spinner className="size-4" />
          </span>
        )}
        <span id={`${baseId}-hint`} className="sr-only">{t('songBrowser.keyboardHint')}</span>
      </div>

      {toolbar}

      {/* What Enter would add, for screen-reader users moving with the arrows. */}
      <p className="sr-only" aria-live="polite">
        {activeSong && rows.length > 0 ? t('songBrowser.highlighted', { title: activeSong.title }) : ''}
      </p>

      <ErrorNotice error={songs.error} />

      <div className={`min-h-0 overflow-y-auto ${compact ? 'max-h-64' : 'flex-1'}`}>
        {songs.loading ? (
          <div className="flex justify-center py-8 text-slate-400"><Spinner /></div>
        ) : showEmpty ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
        ) : (
          <ul className="space-y-0.5" aria-label={searchLabel}>
            {rows.map((song, index) => {
              const state = rowState?.(song) ?? NO_STATE;
              const defaults = songDefaults(song);
              const picked = arrangementFor(song);
              const key = picked ? picked.song_key ?? defaults.key : defaults.key;
              const bpm = picked ? picked.bpm ?? defaults.bpm : defaults.bpm;
              const recent = Boolean(planDate) && !state.inPlan && isRecentlyUsed(song.last_scheduled_at, planDate!);
              const arrangements = activeArrangements(song);
              const isExpanded = expandable && expanded === song.id;
              const isActive = index === active;
              return (
                <li
                  key={song.id}
                  id={`${baseId}-row-${song.id}`}
                  data-active={isActive || undefined}
                  className={`rounded-lg ${isActive ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <div className={`flex items-start gap-2 ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}>
                    {expandable && (
                      <button
                        type="button"
                        className="mt-0.5 inline-grid size-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-expanded={isExpanded}
                        aria-label={t(isExpanded ? 'songBrowser.collapse' : 'songBrowser.expand', { title: song.title })}
                        disabled={arrangements.length === 0}
                        onClick={() => setExpanded(isExpanded ? null : song.id)}
                      >
                        <Icon name="chevronDown" className={`size-4 transition ${isExpanded ? '' : '-rotate-90'}`} />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-white">{song.title}</span>
                        {(key || bpm) && (
                          <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                            {[key, bpm ? t('songBrowser.bpm', { bpm }) : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {[song.author, usageLine(t, formatDate, song, now)].filter(Boolean).join(' · ')}
                      </p>
                      {(state.inPlan || recent) && (
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs font-medium">
                          {state.inPlan && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                              <Icon name="check" className="size-3.5" />
                              {t('songBrowser.inPlan')}
                            </span>
                          )}
                          {recent && (
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                              <Icon name="alert" className="size-3.5" />
                              {t('songBrowser.recentWarning')}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`inline-grid size-8 shrink-0 place-items-center rounded-lg transition disabled:opacity-50 ${
                        state.inPlan
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : 'bg-brand-600 text-white hover:bg-brand-700'
                      }`}
                      aria-label={pickLabel(song, state)}
                      title={pickLabel(song, state)}
                      disabled={state.adding}
                      onClick={() => pick(song)}
                    >
                      {state.adding ? <Spinner className="size-4" /> : <Icon name={state.inPlan ? 'check' : 'plus'} className="size-4" />}
                    </button>
                  </div>
                  {isExpanded && (
                    <fieldset className="px-10 pb-2">
                      <legend className="sr-only">{t('songBrowser.arrangementFor', { title: song.title })}</legend>
                      <div className="space-y-1">
                        {arrangements.map((arrangement) => {
                          const selected = (picked ?? defaults.arrangement)?.id === arrangement.id;
                          return (
                            <label key={arrangement.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-xs hover:bg-white/70 dark:hover:bg-slate-900/60">
                              <input
                                type="radio"
                                name={`${baseId}-arr-${song.id}`}
                                className="mt-0.5"
                                checked={selected}
                                onChange={() => setChosen((current) => new Map(current).set(song.id, arrangement.id))}
                              />
                              <span className="min-w-0">
                                <span className="font-medium text-slate-800 dark:text-slate-100">
                                  {arrangement.is_default ? t('songBrowser.arrangementDefault', { name: arrangement.name }) : arrangement.name}
                                </span>
                                {(arrangement.song_key || arrangement.bpm) && (
                                  <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                                    {[arrangement.song_key, arrangement.bpm ? t('songBrowser.bpm', { bpm: arrangement.bpm }) : null].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                                {arrangement.sequence.length > 0 && (
                                  <span className="block truncate text-slate-500 dark:text-slate-400">{arrangement.sequence.join(' · ')}</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ListFooter
          shown={rows.length}
          total={songs.total}
          onShowMore={songs.hasMore ? songs.onShowMore : undefined}
          loading={songs.loadingMore}
        />
      </div>
    </div>
  );
};

/** Adapts `useSongPages` to the list's source shape. */
export interface SongPagesLike {
  rows: readonly SongListItem[];
  total: number | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isPlaceholderData: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => unknown;
  error: unknown;
}

export const songListSource = (pages: SongPagesLike): SongListSource => ({
  rows: pages.rows,
  total: pages.total,
  loading: pages.isLoading && pages.rows.length === 0,
  refreshing: pages.isPlaceholderData || (pages.isFetching && !pages.isFetchingNextPage && !pages.isLoading),
  hasMore: pages.hasNextPage,
  loadingMore: pages.isFetchingNextPage,
  onShowMore: () => void pages.fetchNextPage(),
  error: pages.error,
});
