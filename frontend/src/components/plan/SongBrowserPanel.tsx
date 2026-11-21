import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MUSICAL_KEYS,
  SONG_SPEEDS,
  SONG_TYPES,
  SONG_USAGE_WINDOW_WEEKS,
  SONG_VOCABULARY_LABEL_KEYS,
  keyedPlanItemRequest,
  newPlanItemRequest,
  type CreatePlanItemRequest,
  type PlanDetail,
  type SongListItem,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useSongPages } from '../../hooks/queries';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Button, ErrorNotice, IconButton, Notice, Segmented, tabbableElements } from '../ui';
import { SongSearchList, songListSource, type SongRowState } from './SongSearchList';
import {
  EMPTY_SONG_BROWSER_FILTERS,
  HIDE_RECENT_WEEKS,
  SONG_BROWSER_TABS,
  activeSongFilterCount,
  songBrowserQuery,
  songDefaults,
  type BrowserArrangement,
  type SongBrowserFilters,
  type SongBrowserTab,
} from './songBrowser';
import { advanceInsertPoint, type OrderInsertPoint } from './insertPoint';
import { usePlanItemInsert } from './usePlanItemInsert';

export interface SongBrowserPanelProps {
  plan: PlanDetail;
  /** Where added songs go; advances past each song added there. */
  insertPoint: OrderInsertPoint;
  onInsertPointChange: (point: OrderInsertPoint) => void;
  /** Opens the header / free-form item form at the same insert point. */
  onAddOther: () => void;
  onClose: () => void;
  /** "Now" for the rotation window and "last used" ages; injectable for tests. */
  now?: Date;
}

/** A song added during this visit: what Undo removes and where the insert point was before it. */
interface AddedSong {
  songId: string;
  itemId: string;
  title: string;
  previousPoint: OrderInsertPoint;
}

/** How long the "Added · Undo" toast stays. */
const TOAST_MS = 8000;

const sideBySide = () => window.matchMedia?.('(min-width: 80rem)');
const isDrawerModal = () => !sideBySide()?.matches;
const subscribeToDrawerWidth = (onChange: () => void) => {
  const width = sideBySide();
  width?.addEventListener('change', onChange);
  return () => width?.removeEventListener('change', onChange);
};

const chipClass = (active: boolean): string =>
  `input h-8 w-auto py-0 pr-7 pl-2.5 text-xs ${active ? '!border-brand-400 !bg-brand-50 !text-brand-800 dark:!bg-brand-500/15 dark:!text-brand-100' : ''}`;

/**
 * F11 song browser: a side panel (a full-screen sheet on small screens) that
 * keeps the order visible beside it. Suggested / Recently added / All A–Z,
 * a calm server search, filter chips, and rows that say whether a song is in
 * this plan or was sung recently. [+] adds at once with the song's default
 * arrangement and key, at the insert point, and the panel stays open with an
 * Undo for the last add. Adds run one at a time, in the order clicked, so
 * several songs added at one point keep that order.
 */
export const SongBrowserPanel = ({ plan, insertPoint, onInsertPointChange, onAddOther, onClose, now: nowProp }: SongBrowserPanelProps) => {
  const { t } = useTranslation(['plans', 'songs', 'common']);
  const titleId = useId();
  const modal = useSyncExternalStore(subscribeToDrawerWidth, isDrawerModal);
  const invalidate = useInvalidateOrg();
  const insert = usePlanItemInsert(plan.id);
  // Fixed for the visit, so the query (and its cache key) stays stable.
  const [now] = useState(() => nowProp ?? new Date());

  const [tab, setTab] = useState<SongBrowserTab>('suggested');
  const [text, setText] = useState('');
  const [filters, setFilters] = useState<SongBrowserFilters>(EMPTY_SONG_BROWSER_FILTERS);
  const q = useDebouncedValue(text);
  const theme = useDebouncedValue(filters.theme);
  const query = songBrowserQuery({ tab, q, filters: { ...filters, theme }, planId: plan.id, serviceTypeId: plan.service_type_id, now });
  const songs = useSongPages(query);

  const [added, setAdded] = useState<readonly AddedSong[]>([]);
  const [adding, setAdding] = useState<ReadonlySet<string>>(() => new Set());
  const [toast, setToast] = useState<AddedSong | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notPlaced, setNotPlaced] = useState<string | null>(null);

  // Adds and undos run one after another; the insert point is read when each runs.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const point = useRef(insertPoint);
  useLayoutEffect(() => {
    point.current = insertPoint;
  }, [insertPoint]);
  // The last unanswered add per song: a retry reuses its idempotency key.
  const pendingBodies = useRef(new Map<string, CreatePlanItemRequest>());

  // Capture the opener before the search field's autofocus effect runs.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const setPoint = (next: OrderInsertPoint) => {
    point.current = next;
    onInsertPointChange(next);
  };

  const run = (task: () => Promise<void>) => {
    chain.current = chain.current.then(task).catch((failure: unknown) => setError(failure));
  };

  const addSong = (song: SongListItem, arrangement: BrowserArrangement | null) => {
    setAdding((current) => new Set(current).add(song.id));
    run(async () => {
      const at = point.current;
      const key = arrangement ? (arrangement.song_key ?? song.default_key) : songDefaults(song).key;
      const body = keyedPlanItemRequest(
        newPlanItemRequest(
          {
            itemType: 'song',
            title: '',
            // An arrangement picked in the expanded row is the one the item starts on.
            song: arrangement ? { ...song, arrangements: [arrangement] } : song,
            keyOverride: key ?? null,
            length: '',
            description: '',
          },
          t('itemKind.song'),
        ),
        pendingBodies.current.get(song.id) ?? null,
        () => crypto.randomUUID(),
      );
      pendingBodies.current.set(song.id, body);
      try {
        const result = await insert(body, at);
        pendingBodies.current.delete(song.id);
        setPoint(advanceInsertPoint(at, result.item.id));
        const entry: AddedSong = { songId: song.id, itemId: result.item.id, title: song.title, previousPoint: at };
        setAdded((current) => [...current, entry]);
        setToast(entry);
        setError(null);
        setNotPlaced(result.placed ? null : song.title);
      } catch (failure) {
        setError(failure);
      } finally {
        setAdding((current) => {
          const next = new Set(current);
          next.delete(song.id);
          return next;
        });
        await invalidate();
      }
    });
  };

  const undo = (entry: AddedSong) => {
    setToast(null);
    run(async () => {
      try {
        await api.deletePlanItem(plan.id, entry.itemId);
        setAdded((current) => current.filter((other) => other.itemId !== entry.itemId));
        const current = point.current;
        if (current.kind === 'after' && current.itemId === entry.itemId) setPoint(entry.previousPoint);
        setNotPlaced(null);
      } catch (failure) {
        setError(failure);
      } finally {
        await invalidate();
      }
    });
  };

  const rowState = (song: SongListItem): SongRowState => ({
    inPlan: song.in_plan || added.some((entry) => entry.songId === song.id),
    adding: adding.has(song.id),
  });

  const vocabularyLabel = (value: string): string => {
    const key = SONG_VOCABULARY_LABEL_KEYS[value];
    return key ? t(key, { ns: 'songs' }) : value;
  };

  const anchorTitle = (itemId: string): string | null =>
    plan.items.find((item) => item.id === itemId)?.title ?? added.find((entry) => entry.itemId === itemId)?.title ?? null;
  const insertText =
    insertPoint.kind === 'end'
      ? t('songBrowser.insertAtEnd')
      : insertPoint.itemId === null
        ? t('songBrowser.insertAtStart')
        : t('songBrowser.insertAfter', { title: anchorTitle(insertPoint.itemId) ?? t('songBrowser.chosenItem') });

  const filterCount = activeSongFilterCount(filters);
  const setFilter = <K extends keyof SongBrowserFilters>(key: K, value: SongBrowserFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    if (!modal || event.key !== 'Tab') return;

    const elements = tabbableElements(event.currentTarget);
    const first = elements[0];
    const last = elements.at(-1);
    if (event.target === (event.shiftKey ? first : last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };

  const searching = q.trim().length > 0;
  const emptyText =
    tab === 'suggested' && !searching && filterCount === 0
      ? t('songBrowser.noSuggested', { weeks: SONG_USAGE_WINDOW_WEEKS })
      : t('songBrowser.noSongs');

  const toolbar = (
    <div className="space-y-2">
      <Segmented<SongBrowserTab>
        label={t('songBrowser.tabsLabel')}
        value={tab}
        onChange={setTab}
        className="w-full [&>button]:flex-1 [&>button]:justify-center"
        items={SONG_BROWSER_TABS.map((value) => ({ value, label: t(`songBrowser.tabs.${value}`) }))}
      />
      {tab === 'suggested' && !searching && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {plan.service_type
            ? t('songBrowser.suggestedHint', { serviceType: plan.service_type.name, weeks: SONG_USAGE_WINDOW_WEEKS })
            : t('songBrowser.suggestedHintChurch', { weeks: SONG_USAGE_WINDOW_WEEKS })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('songBrowser.filters.label')}>
        <select aria-label={t('songBrowser.filters.key')} className={chipClass(Boolean(filters.key))} value={filters.key} onChange={(event) => setFilter('key', event.target.value)}>
          <option value="">{t('songBrowser.filters.anyKey')}</option>
          {MUSICAL_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
        <select aria-label={t('songBrowser.filters.tempo')} className={chipClass(Boolean(filters.speed))} value={filters.speed} onChange={(event) => setFilter('speed', event.target.value)}>
          <option value="">{t('songBrowser.filters.anyTempo')}</option>
          {SONG_SPEEDS.map((speed) => <option key={speed} value={speed}>{vocabularyLabel(speed)}</option>)}
        </select>
        <select aria-label={t('songBrowser.filters.type')} className={chipClass(Boolean(filters.songType))} value={filters.songType} onChange={(event) => setFilter('songType', event.target.value)}>
          <option value="">{t('songBrowser.filters.anyType')}</option>
          {SONG_TYPES.map((type) => <option key={type} value={type}>{vocabularyLabel(type)}</option>)}
        </select>
        <input
          aria-label={t('songBrowser.filters.theme')}
          placeholder={t('songBrowser.filters.theme')}
          className={`${chipClass(Boolean(filters.theme.trim()))} w-28 !pr-2.5`}
          maxLength={40}
          value={filters.theme}
          onChange={(event) => setFilter('theme', event.target.value)}
        />
        {filterCount > 0 && (
          <button type="button" className="px-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={() => setFilters(EMPTY_SONG_BROWSER_FILTERS)}>
            {t('songBrowser.filters.clear')}
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="size-4 rounded border-slate-300 dark:border-slate-700" checked={filters.hideRecent} onChange={(event) => setFilter('hideRecent', event.target.checked)} />
        {t('songBrowser.filters.hideRecent', { count: HIDE_RECENT_WEEKS })}
      </label>
    </div>
  );

  return (
    <section
      role="dialog"
      aria-modal={modal}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="animate-slide-in-right fixed inset-0 z-40 flex flex-col bg-app-surface shadow-2xl shadow-slate-950/20 xl:inset-y-0 xl:left-auto xl:w-[26rem] xl:border-l xl:border-app-border"
    >
      <header className="flex items-start justify-between gap-3 border-b border-app-border px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            {t('songBrowser.title')}
            {added.length > 0 && (
              <span className="ml-2 align-middle text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('songBrowser.addedCount', { count: added.length })}</span>
            )}
          </h2>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{insertText}</p>
        </div>
        <IconButton icon="close" label={t('common:actions.close')} size="sm" onClick={onClose} className="-mr-2" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
        {notPlaced && <Notice tone="warning">{t('songBrowser.notPlaced', { title: notPlaced })}</Notice>}
        <ErrorNotice error={error} />
        <SongSearchList
          searchLabel={t('songBrowser.searchLabel')}
          placeholder={t('songBrowser.searchPlaceholder')}
          text={text}
          onTextChange={setText}
          settledText={q.trim()}
          songs={songListSource(songs)}
          onPick={addSong}
          pickLabel={(song, state) => t(state.inPlan ? 'songBrowser.addAgain' : 'songBrowser.add', { title: song.title })}
          rowState={rowState}
          planDate={plan.service_date}
          expandable
          toolbar={toolbar}
          autoFocus
          emptyText={emptyText}
          now={now}
        />
      </div>

      <footer className="relative flex items-center justify-between gap-2 border-t border-app-border bg-slate-50/70 px-5 py-3 dark:bg-slate-950/40">
        <button type="button" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={onAddOther}>
          {t('songBrowser.addOther')}
        </button>
        <Button onClick={onClose}>{t('songBrowser.done')}</Button>
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 -top-14 flex justify-center px-4">
            <div
              role="status"
              className="animate-pop-in pointer-events-auto flex items-center gap-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg shadow-slate-900/20 dark:bg-slate-100 dark:text-slate-900"
            >
              <span className="max-w-56 truncate">{t('songBrowser.addedToast', { title: toast.title })}</span>
              <button
                type="button"
                onClick={() => undo(toast)}
                className="font-semibold text-brand-300 hover:text-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 dark:text-brand-700 dark:hover:text-brand-800"
              >
                {t('songBrowser.undo')}
              </button>
            </div>
          </div>
        )}
      </footer>
    </section>
  );
};
