import { Link } from 'react-router-dom';
import {
  describeItemLeader,
  formatDuration,
  resolveItemLeader,
  resolvePlanItemChartContext,
  type PlanDetail,
  type PlanItemDetail,
  type PlanSchedule,
  type PlannedItemTime,
} from '@service-center/shared';
import { Badge, Button } from '../ui';

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

const clockIn = (timeZone: string) => (instant: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant));

const SEGMENT_BADGE = { pre: 'Before service', post: 'After service' } as const;

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
  const clock = clockIn(timeZone);
  const slots = new Map(schedule.items.map((slot) => [slot.item_id, slot]));
  const overrun = schedule.warnings.find((warning) => warning.code === 'runs_over');
  const misplaced = new Set(schedule.warnings.flatMap((warning) => (warning.code === 'segment_out_of_order' && warning.item_id ? [warning.item_id] : [])));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          <p>
            {plan.counts.items} item{plan.counts.items === 1 ? '' : 's'} · {formatDuration(schedule.service_seconds)} in the service
            {schedule.pre_seconds > 0 && ` · ${formatDuration(schedule.pre_seconds)} before`}
            {schedule.post_seconds > 0 && ` · ${formatDuration(schedule.post_seconds)} after`}
          </p>
          {schedule.planned_finish_at && (
            <p>
              Starts {clock(schedule.service_starts_at!)} · planned finish{' '}
              <strong className="font-semibold text-slate-700">{clock(schedule.planned_finish_at)}</strong>
              <span className="text-xs"> ({timeZone})</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {serviceTimes.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Time for
              <select className="input w-auto py-1" value={selectedTimeId ?? ''} onChange={(event) => onSelectTime(event.target.value)}>
                {serviceTimes.map((time) => (
                  <option key={time.id} value={time.id}>{time.name ?? 'Service'} · {clock(time.starts_at)}</option>
                ))}
              </select>
            </label>
          )}
          <Button variant="secondary" onClick={onPrint}>Print order</Button>
          {canManage && (
            <Button variant="secondary" onClick={onAddItem}>
              Add item
            </Button>
          )}
        </div>
      </div>

      {overrun && (
        <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-600/20">
          The service items run {formatDuration(overrun.seconds ?? 0)} past the scheduled end. No item has been shortened.
        </p>
      )}
      {serviceTimes.length === 0 && plan.items.length > 0 && (
        <p className="mb-3 text-xs text-slate-500">Add a service time to see when each item starts.</p>
      )}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[4.5rem_3.5rem_1fr_auto] items-center gap-3 border-b border-slate-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          <span>Start</span>
          <span>Len</span>
          <span>Title</span>
          <span />
        </div>

        {plan.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Nothing in the order yet.{' '}
            {canManage ? 'Add a song, a header or a free-form item to get started.' : ''}
          </p>
        ) : (
          <ol className="divide-y divide-slate-100" aria-busy={busy}>
            {plan.items.map((item, index) => (
              <OrderRow
                key={item.id}
                item={item}
                index={index}
                slot={slots.get(item.id) ?? null}
                clock={clock}
                leader={describeItemLeader(resolveItemLeader({ item, assignments: plan.assignments, positionNames }))}
                misplaced={misplaced.has(item.id)}
                canManage={canManage}
                busy={busy}
                isFirst={index === 0}
                isLast={index === plan.items.length - 1}
                onMove={onMoveItem}
                onEdit={() => onEditItem(item)}
                onRemove={() => onRemoveItem(item)}
                onDiscuss={() => onDiscussItem(item)}
                noteCount={itemNoteCounts.get(item.id) ?? 0}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

interface OrderRowProps {
  item: PlanItemDetail;
  index: number;
  slot: PlannedItemTime | null;
  clock: (instant: string) => string;
  leader: string | null;
  misplaced: boolean;
  canManage: boolean;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onEdit: () => void;
  onRemove: () => void;
  onDiscuss: () => void;
  noteCount: number;
}

const controlClass = 'min-h-8 min-w-8 rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent';

const OrderRow = ({ item, index, slot, clock, leader, misplaced, canManage, busy, isFirst, isLast, onMove, onEdit, onRemove, onDiscuss, noteCount }: OrderRowProps) => {
  const discuss = (
    <button
      type="button"
      onClick={onDiscuss}
      aria-label={`Notes and discussion for ${item.title}`}
      className="rounded px-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-brand-600"
    >
      💬{noteCount > 0 ? ` ${noteCount} note${noteCount === 1 ? '' : 's'}` : ''}
    </button>
  );
  const controls = (
    <div className="flex shrink-0 items-center gap-0.5">
      {item.item_type !== 'header' && discuss}
      {canManage && <>
        <button type="button" aria-label={`Edit ${item.title}`} onClick={onEdit} className={`${controlClass} text-xs`}>
          Edit
        </button>
        <button type="button" aria-label={`Move ${item.title} up`} disabled={isFirst || busy} onClick={() => onMove(index, -1)} className={controlClass}>
          ↑
        </button>
        <button type="button" aria-label={`Move ${item.title} down`} disabled={isLast || busy} onClick={() => onMove(index, 1)} className={controlClass}>
          ↓
        </button>
        <button type="button" aria-label={`Remove ${item.title}`} disabled={busy} onClick={onRemove} className={`${controlClass} hover:text-rose-600`}>
          ×
        </button>
      </>}
    </div>
  );

  if (item.item_type === 'header') {
    return (
      <li className="grid grid-cols-[4.5rem_3.5rem_1fr_auto] items-center gap-3 bg-slate-50 px-4 py-2">
        <span />
        <span />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {item.title}
        </h3>
        {controls}
      </li>
    );
  }

  const context = resolvePlanItemChartContext(item);
  const segment = item.service_segment ?? 'service';

  return (
    <li className="grid grid-cols-[4.5rem_3.5rem_1fr_auto] items-start gap-3 px-4 py-3">
      <span className="text-sm tabular-nums text-slate-600">{slot ? clock(slot.starts_at) : '—'}</span>
      <span className="text-sm tabular-nums text-slate-400">
        {formatDuration(item.length_seconds)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {item.song ? (
            <Link to={`/songs/${item.song.id}`} className="font-medium hover:underline">
              {item.title}
            </Link>
          ) : (
            <span className="font-medium">{item.title}</span>
          )}
          {item.item_type === 'song' && context.status === 'ready' && (
            <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">
              <span className="sr-only">Service key </span>{context.displayKey ?? '—'}
            </Badge>
          )}
          {item.item_type === 'song' && context.status === 'unavailable' && (
            <Badge tone="bg-rose-50 text-rose-700 ring-rose-600/20">Arrangement unavailable</Badge>
          )}
          {segment !== 'service' && (
            <Badge tone={misplaced ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : 'bg-sky-50 text-sky-700 ring-sky-600/20'}>
              {SEGMENT_BADGE[segment]}{misplaced ? ' — listed among service items' : ''}
            </Badge>
          )}
          {context.status === 'ready' && context.arrangement?.bpm && (
            <span className="text-xs text-slate-400">{context.arrangement.bpm} bpm</span>
          )}
        </div>
        {context.status === 'ready' && (context.arrangement || context.sequence.length > 0) && (
          <p className="mt-0.5 text-xs text-slate-500">
            {context.arrangement?.name}
            {context.sequence.length > 0 && ` · ${context.sequence.join(' · ')}`}
            {context.sequenceFromPlan && ' (this plan)'}
          </p>
        )}
        {item.description && <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>}
        {leader && (
          <p className={`mt-0.5 text-xs ${leader.endsWith(': unfilled') ? 'text-amber-700' : 'text-slate-500'}`}>
            Led by {leader}
          </p>
        )}
      </div>
      {controls}
    </li>
  );
};
