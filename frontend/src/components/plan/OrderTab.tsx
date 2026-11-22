import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  formatDuration,
  itemIdsAfterDrop,
  planItemCarriesMedia,
  resolveItemLeader,
  resolvePlanItemChartContext,
  type ItemLeader,
  type PlanDetail,
  type PlanItemDetail,
  type PlanSchedule,
  type PlannedItemTime,
} from '@service-center/shared';
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type AutoScrollOptions,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Button } from '../ui';
import { Icon } from '../icons';
import { LinkMediaModal } from '../media/LinkMediaModal';
import { MediaThumbnail } from '../media/MediaThumbnail';
import { ItemDetailsView } from './ItemDetailsView';
import { useFormatters } from '../../i18n';
import { INSERT_AT_END, type OrderInsertPoint } from './insertPoint';
import { QuickAddLine } from './QuickAddLine';
import { ClearOrderDialog } from './ClearOrderDialog';
import { OrderShortcutsDialog } from './OrderShortcutsDialog';
import { isActivatableTarget, isTextEntryTarget, orderShortcutFor, shortcutScopeOf } from './orderShortcuts';

export interface OrderTabProps {
  plan: PlanDetail;
  canManage: boolean;
  /** F11: planned times for the selected service time (derived). */
  schedule: PlanSchedule;
  /** The organization's IANA zone; times show as the congregation reads them. */
  timeZone: string;
  /** Service times the order can be timed against. */
  serviceTimes: ReadonlyArray<{ id: string; name: string | null; starts_at: string }>;
  selectedTimeId: string | null;
  onSelectTime: (timeId: string) => void;
  /** Position names for unfilled leader positions. */
  positionNames: ReadonlyMap<string, string>;
  /** True while an order change is saving or the plan is refreshing. */
  busy: boolean;
  /** Opens the song browser adding at `point` (the header button appends). */
  onAddSongs: (point: OrderInsertPoint) => void;
  /** Opens the header / free-form item form adding at `point`. */
  onAddOther: (point: OrderInsertPoint) => void;
  /** Where the open song browser is adding; null when it is closed. */
  insertPoint: OrderInsertPoint | null;
  onEditItem: (item: PlanItemDetail) => void;
  onMoveItem: (index: number, direction: -1 | 1) => void;
  /** A drag-and-drop: the full order, saved with one request. */
  onReorderItems: (itemIds: string[]) => void;
  onRemoveItem: (item: PlanItemDetail) => void;
  onPrint: () => void;
  /** F09: open an item's notes and discussion. */
  onDiscussItem: (item: PlanItemDetail) => void;
  /** F09: how many notes on each item the reader can see. */
  itemNoteCounts: ReadonlyMap<string, number>;
}

/** An item leader in words, and whether it still needs someone. */
interface LeaderLine {
  text: string;
  unfilled: boolean;
}

/** "Sam Rivera", "Worship Leader: unfilled", "Keys: A, B" in the displayed language. */
const describeLeader = (t: TFunction<['plans', 'common']>, list: (items: readonly string[]) => string, leader: ItemLeader): LeaderLine | null => {
  switch (leader.kind) {
    case 'none':
      return null;
    case 'person':
      return { text: leader.name ?? t('leader.someoneOnRoster'), unfilled: false };
    case 'position': {
      const position = leader.position_name ?? t('leader.position');
      if (leader.holders.length === 0) return { text: t('leader.unfilled', { position }), unfilled: true };
      const names = leader.holders.map((holder) => {
        const name = holder.name ?? t('common:fallback.someone');
        return holder.prepared ? t('leader.notYetAsked', { name }) : name;
      });
      return { text: t('leader.holders', { position, names: list(names) }), unfilled: false };
    }
  }
};

/**
 * Scroll the page only when the pointer is right at the window's edge, and
 * gently: dnd-kit's default (the outer 20% of the window, fast) runs a drag
 * near the bottom of a laptop screen to the end of the list.
 */
const ORDER_AUTO_SCROLL = { threshold: { x: 0, y: 0.06 }, acceleration: 3 } as const satisfies AutoScrollOptions;

export const OrderTab = ({
  plan,
  canManage,
  schedule,
  timeZone,
  serviceTimes,
  selectedTimeId,
  onSelectTime,
  positionNames,
  busy,
  onAddSongs,
  onAddOther,
  insertPoint,
  onEditItem,
  onMoveItem,
  onReorderItems,
  onRemoveItem,
  onPrint,
  onDiscussItem,
  itemNoteCounts,
}: OrderTabProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const clock = (instant: string): string => format.time(instant, { timeZone });
  // F14: linking a media bundle is its own revisioned action.
  const [mediaItem, setMediaItem] = useState<PlanItemDetail | null>(null);
  const slots = new Map(schedule.items.map((slot) => [slot.item_id, slot]));
  const overrun = schedule.warnings.find((warning) => warning.code === 'runs_over');
  // "Only 9am" badges name each service time as the time picker does.
  const timeLabels = new Map(serviceTimes.map((time) => [time.id, time.name ?? clock(time.starts_at)]));
  const misplaced = new Set(schedule.warnings.flatMap((warning) => (warning.code === 'segment_out_of_order' && warning.item_id ? [warning.item_id] : [])));
  const order = useOrderKeyboard({ plan, canManage, busy, onEditItem, onMoveItem, onRemoveItem });
  const [clearing, setClearing] = useState(false);
  const itemIds = plan.items.map((item) => item.id);
  const titleOf = (id: UniqueIdentifier): string => plan.items.find((item) => item.id === id)?.title ?? '';
  const positionOf = (id: UniqueIdentifier): number => itemIds.indexOf(String(id)) + 1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('orderTab.drag.start', { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t('orderTab.drag.over', { title: titleOf(active.id), position: positionOf(over.id), count: itemIds.length }) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t('orderTab.drag.end', { title: titleOf(active.id), position: positionOf(over.id), count: itemIds.length }) : undefined,
    onDragCancel: ({ active }) => t('orderTab.drag.cancel', { title: titleOf(active.id) }),
  };
  // One reorder request per drop; nothing while another order change saves.
  const dropped = ({ active, over }: DragEndEvent) => {
    order.setDragging(false);
    if (!over || busy) return;
    const ids = itemIdsAfterDrop(itemIds, String(active.id), String(over.id));
    if (ids) onReorderItems(ids);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm text-slate-500 dark:text-slate-400">
          <p className="flex items-start gap-1.5">
            <Icon name="clock" className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <span>
            {[
              t('common:count.items', { count: plan.counts.items }),
              t('orderTab.inService', { duration: formatDuration(schedule.service_seconds) }),
              ...(schedule.pre_seconds > 0 ? [t('orderTab.before', { duration: formatDuration(schedule.pre_seconds) })] : []),
              ...(schedule.post_seconds > 0 ? [t('orderTab.after', { duration: formatDuration(schedule.post_seconds) })] : []),
            ].join(' · ')}
            </span>
          </p>
          {schedule.planned_finish_at && (
            <p className="mt-0.5 pl-[22px]">
              <Trans
                t={t}
                i18nKey="orderTab.plannedFinish"
                values={{ start: clock(schedule.service_starts_at!), finish: clock(schedule.planned_finish_at), timeZone }}
                components={[<strong key="finish" className="font-semibold text-slate-700 dark:text-slate-200" />, <span key="zone" className="text-xs" />]}
              />
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {serviceTimes.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              {t('orderTab.timeFor')}
              <select className="input h-9 w-auto py-1" value={selectedTimeId ?? ''} onChange={(event) => onSelectTime(event.target.value)}>
                {serviceTimes.map((time) => (
                  <option key={time.id} value={time.id}>{t('orderTab.serviceTimeOption', { name: time.name ?? t('timeKind.service'), time: clock(time.starts_at) })}</option>
                ))}
              </select>
            </label>
          )}
          <Button variant="secondary" icon="document" onClick={onPrint}>{t('orderTab.printOrder')}</Button>
          <ShortcutsButton label={t('orderTab.shortcuts')} onClick={() => order.setHelpOpen(true)} />
          {canManage && (
            <>
              {plan.items.length > 0 && (
                <Button variant="secondary" icon="trash" disabled={busy} onClick={() => setClearing(true)}>
                  {t('orderTab.clearOrder')}
                </Button>
              )}
              <Button variant="secondary" icon="plus" onClick={() => onAddOther(INSERT_AT_END)}>
                {t('orderTab.addOther')}
              </Button>
              <Button icon="music" onClick={() => onAddSongs(INSERT_AT_END)}>
                {t('orderTab.addSongs')}
              </Button>
            </>
          )}
        </div>
      </div>

      {overrun && (
        <p
          role="status"
          className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25"
        >
          <Icon name="alert" className="mt-px size-4 shrink-0" />
          {t('orderTab.overrun', { duration: formatDuration(overrun.seconds ?? 0) })}
        </p>
      )}
      {serviceTimes.length === 0 && plan.items.length > 0 && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Icon name="info" className="size-3.5 shrink-0" />
          {t('orderTab.addServiceTimeHint')}
        </p>
      )}

      <div ref={order.containerRef} className="card overflow-hidden">
        <div className={`${ROW_GRID} items-center border-b border-app-border bg-slate-50/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:bg-slate-900/40 dark:text-slate-500`}>
          <span>{t('orderTab.columnStart')}</span>
          <span className="hidden sm:block">{t('orderTab.columnLength')}</span>
          <span>{t('orderTab.columnTitle')}</span>
          <span />
        </div>

        {plan.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="grid size-10 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/20">
              <Icon name="plans" className="size-5" />
            </span>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              {canManage ? t('orderTab.emptyCanManage') : t('orderTab.empty')}
            </p>
            {canManage && (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button size="sm" icon="music" onClick={() => onAddSongs(INSERT_AT_END)}>
                  {t('orderTab.addSongs')}
                </Button>
                <Button size="sm" variant="secondary" icon="plus" onClick={() => onAddOther(INSERT_AT_END)}>
                  {t('orderTab.addOther')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            autoScroll={ORDER_AUTO_SCROLL}
            accessibility={{ announcements, screenReaderInstructions: { draggable: t('orderTab.drag.instructions') } }}
            onDragStart={() => order.setDragging(true)}
            onDragCancel={() => order.setDragging(false)}
            onDragEnd={dropped}
          >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy} disabled={!canManage || busy}>
          <ol className={`row-list transition-opacity ${busy ? 'opacity-70' : ''}`} aria-busy={busy}>
            {insertPoint?.kind === 'after' && insertPoint.itemId === null && <InsertMarker />}
            {plan.items.map((item, index) => (
              <Fragment key={item.id}>
              <OrderRow
                item={item}
                index={index}
                selected={order.selectedId === item.id}
                onSelect={() => order.select(item.id)}
                rowRef={order.rowRef(item.id)}
                slot={slots.get(item.id) ?? null}
                clock={clock}
                leader={describeLeader(t, format.list, resolveItemLeader({ item, assignments: plan.assignments, positionNames }))}
                misplaced={misplaced.has(item.id)}
                canManage={canManage}
                busy={busy}
                isFirst={index === 0}
                isLast={index === plan.items.length - 1}
                onMove={onMoveItem}
                onEdit={() => onEditItem(item)}
                onRemove={() => onRemoveItem(item)}
                onDiscuss={() => onDiscussItem(item)}
                onMedia={() => setMediaItem(item)}
                noteCount={itemNoteCounts.get(item.id) ?? 0}
                timeLabels={timeLabels}
                onInsertAfter={() => onAddSongs({ kind: 'after', itemId: item.id })}
                onInsertBefore={index === 0 ? () => onAddSongs({ kind: 'after', itemId: null }) : undefined}
              />
              {insertPoint?.kind === 'after' && insertPoint.itemId === item.id && <InsertMarker />}
              </Fragment>
            ))}
            {insertPoint?.kind === 'end' && <InsertMarker />}
          </ol>
          </SortableContext>
          </DndContext>
        )}
        {canManage && <QuickAddLine planId={plan.id} inputRef={order.quickAddRef} />}
        {mediaItem && <LinkMediaModal plan={plan} item={mediaItem} onClose={() => setMediaItem(null)} />}
      </div>
      <p role="status" aria-live="polite" className="sr-only">{order.announcement}</p>
      <OrderShortcutsDialog open={order.helpOpen} canManage={canManage} onClose={() => order.setHelpOpen(false)} />
      {clearing && <ClearOrderDialog open plan={plan} onClose={() => setClearing(false)} />}
    </div>
  );
};

interface ShortcutsButtonProps {
  label: string;
  onClick: () => void;
}

/** The "?" button beside the order's actions (hidden on touch-size screens). */
const ShortcutsButton = ({ label, onClick }: ShortcutsButtonProps) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-keyshortcuts="Shift+?"
    onClick={onClick}
    className="hidden size-9 place-items-center rounded-lg text-slate-500 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 hover:text-slate-800 sm:inline-grid dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
  >
    <Icon name="help" className="size-4" />
  </button>
);

interface UseOrderKeyboardInput {
  plan: PlanDetail;
  canManage: boolean;
  busy: boolean;
  onEditItem: (item: PlanItemDetail) => void;
  onMoveItem: (index: number, direction: -1 | 1) => void;
  onRemoveItem: (item: PlanItemDetail) => void;
}

/** The order's selection, keyboard shortcuts and screen-reader announcements. */
interface OrderKeyboard {
  selectedId: string | null;
  select: (id: string | null) => void;
  rowRef: (id: string) => (element: HTMLLIElement | null) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  quickAddRef: RefObject<HTMLInputElement | null>;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  setDragging: (dragging: boolean) => void;
  announcement: string;
}

/**
 * Shortcuts apply while focus is on the page or inside the order (not in a
 * text field, not in a dialog, not during a drag). The selected row takes
 * focus, so a screen reader reads it, and a polite status line says which
 * item of how many is selected.
 */
const useOrderKeyboard = ({ plan, canManage, busy, onEditItem, onMoveItem, onRemoveItem }: UseOrderKeyboardInput): OrderKeyboard => {
  const { t } = useTranslation('plans');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const quickAddRef = useRef<HTMLInputElement | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const dragging = useRef(false);
  const focusPending = useRef(false);
  const items = plan.items;
  const selectedIndex = selectedId === null ? -1 : items.findIndex((item) => item.id === selectedId);

  // A removed item cannot stay selected.
  useEffect(() => {
    if (selectedId !== null && selectedIndex === -1) setSelectedId(null);
  }, [selectedId, selectedIndex]);

  // Keep keyboard focus on the selected row, also after it moved.
  useEffect(() => {
    if (!focusPending.current || selectedId === null) return;
    const row = rows.current.get(selectedId);
    if (row && document.activeElement !== row) row.focus();
  }, [selectedId, items]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const index = id === null ? -1 : items.findIndex((item) => item.id === id);
      setAnnouncement(index === -1 ? '' : t('orderTab.selected', { title: items[index]!.title, position: index + 1, count: items.length }));
    },
    [items, t],
  );

  const rowRef = useCallback(
    (id: string) => (element: HTMLLIElement | null) => {
      if (element) rows.current.set(id, element);
      else rows.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || dragging.current) return;
      const target = event.target;
      const container = containerRef.current;
      const scope = container ? shortcutScopeOf(target, container) : null;
      if (!scope) return;
      const onPage = scope === 'page';
      if (isTextEntryTarget(target) || document.querySelector('[aria-modal="true"]')) return;
      const shortcut = orderShortcutFor(event);
      if (!shortcut) return;

      const selected = selectedIndex === -1 ? null : items[selectedIndex]!;
      const step = (direction: 1 | -1) => {
        if (!items.length) return;
        const next =
          selectedIndex === -1
            ? direction === 1 ? 0 : items.length - 1
            : Math.min(items.length - 1, Math.max(0, selectedIndex + direction));
        focusPending.current = true;
        select(items[next]!.id);
      };

      switch (shortcut) {
        case 'help':
          setHelpOpen(true);
          break;
        case 'focus-quick-add':
          if (!canManage || !quickAddRef.current) return;
          quickAddRef.current.focus();
          break;
        case 'select-next':
        case 'select-previous':
          // Arrows on the page itself keep scrolling until a row is selected.
          if (onPage && !selected && event.key.startsWith('Arrow')) return;
          step(shortcut === 'select-next' ? 1 : -1);
          break;
        case 'deselect':
          if (!selected) return;
          focusPending.current = false;
          select(null);
          break;
        case 'move-down':
        case 'move-up': {
          const direction = shortcut === 'move-down' ? 1 : -1;
          const destination = selectedIndex + direction;
          if (!canManage || !selected || busy || destination < 0 || destination >= items.length) return;
          focusPending.current = true;
          onMoveItem(selectedIndex, direction);
          setAnnouncement(t('orderTab.drag.end', { title: selected.title, position: destination + 1, count: items.length }));
          break;
        }
        case 'edit':
          // Enter on a button or link keeps doing what that control does.
          if (!canManage || !selected || (event.key === 'Enter' && isActivatableTarget(target))) return;
          onEditItem(selected);
          break;
        case 'remove':
          if (!canManage || !selected || busy) return;
          onRemoveItem(selected);
          break;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, canManage, items, onEditItem, onMoveItem, onRemoveItem, select, selectedIndex, t]);

  return {
    selectedId,
    select: (id) => {
      focusPending.current = false;
      select(id);
    },
    rowRef,
    containerRef,
    quickAddRef,
    helpOpen,
    setHelpOpen,
    setDragging: (value) => {
      dragging.current = value;
    },
    announcement,
  };
};

interface OrderRowProps {
  item: PlanItemDetail;
  index: number;
  /** The row the keyboard shortcuts act on. */
  selected: boolean;
  onSelect: () => void;
  rowRef: (element: HTMLLIElement | null) => void;
  slot: PlannedItemTime | null;
  clock: (instant: string) => string;
  leader: LeaderLine | null;
  misplaced: boolean;
  canManage: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onEdit: () => void;
  onRemove: () => void;
  onDiscuss: () => void;
  onMedia: () => void;
  noteCount: number;
  /** Service time id → its short name, for the "Only …" badge. */
  timeLabels: ReadonlyMap<string, string>;
  /** Opens the song browser adding right after this item. */
  onInsertAfter: () => void;
  /** First row only: opens the song browser adding before it. */
  onInsertBefore?: () => void;
}

/** The dashed "new songs go here" line while the song browser is open. */
const InsertMarker = () => {
  const { t } = useTranslation('plans');
  return (
    <li className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-300">
      <span className="h-px flex-1 border-t border-dashed border-brand-400" />
      {t('orderTab.insertingHere')}
      <span className="h-px flex-1 border-t border-dashed border-brand-400" />
    </li>
  );
};

interface InsertButtonProps {
  /** `inside-*` sits within the row, for the list's first and last edges (the card clips overflow). */
  edge: 'top' | 'bottom' | 'inside-top' | 'inside-bottom';
  label: string;
  onClick: () => void;
}

const INSERT_EDGE_CLASS: Record<InsertButtonProps['edge'], string> = {
  top: '-top-3',
  bottom: '-bottom-3',
  'inside-top': 'top-0.5',
  'inside-bottom': 'bottom-0.5',
};

/** A small "+" on a row's edge: opens the song browser adding at that spot. Shown on hover or focus (always on touch). */
const InsertButton = ({ edge, label, onClick }: InsertButtonProps) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`absolute left-1/2 z-10 inline-grid size-6 -translate-x-1/2 place-items-center rounded-full bg-app-surface text-brand-600 opacity-0 shadow-sm ring-1 ring-brand-300 transition group-hover:opacity-100 hover:bg-brand-600 hover:text-white focus-visible:opacity-100 pointer-coarse:opacity-100 dark:text-brand-300 dark:ring-brand-500/40 ${
      INSERT_EDGE_CLASS[edge]
    }`}
  >
    <Icon name="plus" className="size-3.5" />
  </button>
);

/**
 * Start · length · title · controls on sm+. On a phone the length column folds
 * under the start time and the controls drop to their own line under the title.
 */
const ROW_GRID =
  'grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 sm:grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_auto]';

const controlClass =
  'inline-grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200';

const OrderRow = ({ item, index, selected, onSelect, rowRef, slot, clock, leader, misplaced, canManage, busy, isFirst, isLast, onMove, onEdit, onRemove, onDiscuss, onMedia, noteCount, timeLabels, onInsertAfter, onInsertBefore }: OrderRowProps) => {
  const { t } = useTranslation(['plans', 'common']);
  // Drag-and-drop: the row moves, the grip button is the handle (pointer or keyboard).
  const sortable = useSortable({ id: item.id, disabled: !canManage || busy });
  const rowProps = {
    ref: (element: HTMLLIElement | null) => {
      sortable.setNodeRef(element);
      rowRef(element);
    },
    style: { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition } satisfies CSSProperties,
    tabIndex: selected ? 0 : -1,
    'aria-current': selected ? ('true' as const) : undefined,
    onClick: onSelect,
  };
  const rowState = `outline-none ${selected ? 'z-[1] ring-2 ring-inset ring-brand-500 dark:ring-brand-400' : ''} ${
    sortable.isDragging ? 'z-20 bg-app-surface opacity-80 shadow-lg' : ''
  }`;
  const format = useFormatters();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const limitedTo = (item.item_times ?? []).flatMap((time) => {
    const label = timeLabels.get(time.plan_time_id);
    return label ? [label] : [];
  });
  const timesBadge = limitedTo.length > 0 && (
    <Badge tone="bg-violet-50 text-violet-700 ring-violet-600/20">{t('orderTab.onlyTimes', { times: format.list(limitedTo) })}</Badge>
  );
  const hasDetails = item.item_type !== 'header' && Boolean(item.details?.trim());
  // No "+" while any row is being dragged: they would sit over the rows' captions.
  const insertButtons = canManage && !sortable.active && (
    <>
      {onInsertBefore && <InsertButton edge="inside-top" label={t('orderTab.insertAtStart')} onClick={onInsertBefore} />}
      <InsertButton edge={isLast ? 'inside-bottom' : 'bottom'} label={t('orderTab.insertAfter', { title: item.title })} onClick={onInsertAfter} />
    </>
  );
  const discuss = (
    <button
      type="button"
      onClick={onDiscuss}
      aria-label={t('orderTab.notesFor', { title: item.title })}
      title={t('orderTab.notesFor', { title: item.title })}
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-1.5 text-xs transition hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800 dark:hover:text-brand-200 ${
        noteCount > 0 ? 'font-medium text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500'
      }`}
    >
      <Icon name="chat" className="size-4" />
      {noteCount > 0 && <span>{t('orderTab.noteCount', { count: noteCount })}</span>}
    </button>
  );
  const controls = (
    <div className="col-start-2 -ml-1.5 flex shrink-0 flex-wrap items-center gap-0.5 sm:col-start-auto sm:ml-0">
      {item.item_type !== 'header' && discuss}
      {canManage && <>
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={t('orderTab.dragHandle', { title: item.title })}
          title={t('orderTab.dragHandle', { title: item.title })}
          disabled={busy}
          className={`${controlClass} cursor-grab touch-none active:cursor-grabbing`}
        >
          <Icon name="grip" className="size-4" />
        </button>
        <button type="button" aria-label={t('orderTab.editItem', { title: item.title })} onClick={onEdit} title={t('common:actions.edit')} className={controlClass}>
          <Icon name="pencil" className="size-4" />
        </button>
        {planItemCarriesMedia(item.item_type) && (
          <button type="button" aria-label={t('orderTab.mediaFor', { title: item.title })} onClick={onMedia} title={t('orderTab.media')} className={controlClass}>
            <Icon name="media" className="size-4" />
          </button>
        )}
        <button type="button" aria-label={t('orderTab.moveUp', { title: item.title })} disabled={isFirst || busy} onClick={() => onMove(index, -1)} className={controlClass}>
          <Icon name="chevronDown" className="size-4 rotate-180" />
        </button>
        <button type="button" aria-label={t('orderTab.moveDown', { title: item.title })} disabled={isLast || busy} onClick={() => onMove(index, 1)} className={controlClass}>
          <Icon name="chevronDown" className="size-4" />
        </button>
        <button type="button" aria-label={t('orderTab.removeItem', { title: item.title })} disabled={busy} onClick={onRemove} className={`${controlClass} hover:!text-rose-600 dark:hover:!text-rose-400`}>
          <Icon name="close" className="size-4" />
        </button>
      </>}
    </div>
  );

  if (item.item_type === 'header') {
    return (
      <li {...rowProps} className={`${ROW_GRID} group relative items-center bg-slate-50 px-4 py-2 dark:bg-slate-900/50 ${rowState}`}>
        {insertButtons}
        <span />
        <span className="hidden sm:block" />
        <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          {item.title}
          {timesBadge}
        </h3>
        {controls}
      </li>
    );
  }

  const context = resolvePlanItemChartContext(item);
  const segment = item.service_segment ?? 'service';

  return (
    <li {...rowProps} className={`${ROW_GRID} group relative items-start px-4 py-3 transition hover:bg-slate-50/60 dark:hover:bg-slate-900/40 ${rowState}`}>
      {insertButtons}
      <span className="pt-0.5 text-sm font-medium tabular-nums text-slate-700 dark:text-slate-200">
        {slot ? clock(slot.starts_at) : '—'}
        <span className="block text-xs font-normal text-slate-400 sm:hidden">{formatDuration(item.length_seconds)}</span>
      </span>
      <span className="hidden pt-0.5 text-sm tabular-nums text-slate-400 sm:block dark:text-slate-500">
        {formatDuration(item.length_seconds)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {item.song ? (
            <Link to={`/songs/${item.song.id}`} className="inline-flex items-center gap-1.5 font-medium text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-200">
              <Icon name="music" className="size-3.5 shrink-0 text-brand-500 dark:text-brand-300" />
              {item.title}
            </Link>
          ) : item.item_type === 'media' ? (
            <span className="inline-flex min-w-0 items-center gap-2 font-medium text-slate-900 dark:text-white">
              <MediaThumbnail fileId={item.media?.thumbnail_file_id} alt={t('orderTab.mediaItem', { title: item.media?.title ?? item.title })} />
              {item.title}
            </span>
          ) : (
            <span className="font-medium text-slate-900 dark:text-white">{item.title}</span>
          )}
          {item.item_type === 'song' && context.status === 'ready' && (
            <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">
              <span className="sr-only">{t('orderTab.serviceKey')} </span>{context.displayKey ?? '—'}
            </Badge>
          )}
          {item.item_type === 'song' && context.status === 'unavailable' && (
            <Badge tone="bg-rose-50 text-rose-700 ring-rose-600/20">{t('orderTab.arrangementUnavailable')}</Badge>
          )}
          {segment !== 'service' && (
            <Badge tone={misplaced ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-sky-50 text-sky-700 ring-sky-600/20'}>
              {misplaced ? t(`orderTab.segmentBadgeMisplaced.${segment}`) : t(`orderTab.segmentBadge.${segment}`)}
            </Badge>
          )}
          {timesBadge}
          {context.status === 'ready' && context.arrangement?.bpm && (
            <span className="text-xs text-slate-400">{t('orderTab.bpm', { bpm: context.arrangement.bpm })}</span>
          )}
        </div>
        {context.status === 'ready' && (context.arrangement || context.sequence.length > 0) && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {context.arrangement?.name}
            {context.sequence.length > 0 && ` · ${context.sequence.join(' · ')}`}
            {context.sequenceFromPlan && ` ${t('orderTab.sequenceThisPlan')}`}
          </p>
        )}
        {item.description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{item.description}</p>}
        {hasDetails && (
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-label={t(detailsOpen ? 'orderTab.hideDetails' : 'orderTab.showDetails', { title: item.title })}
            onClick={() => setDetailsOpen((open) => !open)}
            className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
          >
            <Icon name="chevronDown" className={`size-3.5 transition ${detailsOpen ? '' : '-rotate-90'}`} />
            {t('orderTab.details')}
          </button>
        )}
        {hasDetails && detailsOpen && (
          <ItemDetailsView markdown={item.details} className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/50" />
        )}
        {leader && (
          <p className={`mt-0.5 inline-flex items-center gap-1 text-xs ${leader.unfilled ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
            <Icon name="person" className="size-3 shrink-0" />
            {t('orderTab.ledBy', { leader: leader.text })}
          </p>
        )}
        {item.media && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-sky-700 dark:text-sky-300">
            <Icon name="media" className="size-3 shrink-0" />
            <span>
            <Trans
              t={t}
              i18nKey={item.media.archived ? 'orderTab.mediaLinkArchived' : 'orderTab.mediaLink'}
              values={{ title: item.media.title }}
              components={[<Link key="media" className="hover:underline" to={`/media/${item.media.id}`} />]}
            />
            </span>
          </p>
        )}
      </div>
      {controls}
    </li>
  );
};
