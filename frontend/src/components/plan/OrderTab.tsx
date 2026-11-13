import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  formatDuration,
  resolveItemLeader,
  resolvePlanItemChartContext,
  type ItemLeader,
  type PlanDetail,
  type PlanItemDetail,
  type PlanSchedule,
  type PlannedItemTime,
} from '@service-center/shared';
import { useState } from 'react';
import { Badge, Button } from '../ui';
import { Icon } from '../icons';
import { LinkMediaModal } from '../media/LinkMediaModal';
import { useFormatters } from '../../i18n';

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
  onAddItem: () => void;
  onEditItem: (item: PlanItemDetail) => void;
  onMoveItem: (index: number, direction: -1 | 1) => void;
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
  onAddItem,
  onEditItem,
  onMoveItem,
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
  const misplaced = new Set(schedule.warnings.flatMap((warning) => (warning.code === 'segment_out_of_order' && warning.item_id ? [warning.item_id] : [])));

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
          {canManage && (
            <Button icon="plus" onClick={onAddItem}>
              {t('orderTab.addItem')}
            </Button>
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

      <div className="card overflow-hidden">
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
              <Button size="sm" icon="plus" className="mt-1" onClick={onAddItem}>
                {t('orderTab.addItem')}
              </Button>
            )}
          </div>
        ) : (
          <ol className={`row-list transition-opacity ${busy ? 'opacity-70' : ''}`} aria-busy={busy}>
            {plan.items.map((item, index) => (
              <OrderRow
                key={item.id}
                item={item}
                index={index}
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
              />
            ))}
          </ol>
        )}
        {mediaItem && <LinkMediaModal plan={plan} item={mediaItem} onClose={() => setMediaItem(null)} />}
      </div>
    </div>
  );
};

interface OrderRowProps {
  item: PlanItemDetail;
  index: number;
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
}

/**
 * Start · length · title · controls on sm+. On a phone the length column folds
 * under the start time and the controls drop to their own line under the title.
 */
const ROW_GRID =
  'grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 sm:grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_auto]';

const controlClass =
  'inline-grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200';

const OrderRow = ({ item, index, slot, clock, leader, misplaced, canManage, busy, isFirst, isLast, onMove, onEdit, onRemove, onDiscuss, onMedia, noteCount }: OrderRowProps) => {
  const { t } = useTranslation(['plans', 'common']);
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
        <button type="button" aria-label={t('orderTab.editItem', { title: item.title })} onClick={onEdit} title={t('common:actions.edit')} className={controlClass}>
          <Icon name="pencil" className="size-4" />
        </button>
        {item.item_type === 'item' && (
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
      <li className={`${ROW_GRID} items-center bg-slate-50 px-4 py-2 dark:bg-slate-900/50`}>
        <span />
        <span className="hidden sm:block" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          {item.title}
        </h3>
        {controls}
      </li>
    );
  }

  const context = resolvePlanItemChartContext(item);
  const segment = item.service_segment ?? 'service';

  return (
    <li className={`${ROW_GRID} items-start px-4 py-3 transition hover:bg-slate-50/60 dark:hover:bg-slate-900/40`}>
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
