import { Link } from 'react-router-dom';
import { formatDuration, type PlanDetail, type PlanItemDetail } from '@service-center/shared';
import { Badge, Button } from '../ui';

export interface OrderTabProps {
  plan: PlanDetail;
  canManage: boolean;
  onAddItem: () => void;
  onMoveItem: (index: number, direction: -1 | 1) => void;
  onRemoveItem: (itemId: string) => void;
}

export const OrderTab = ({
  plan,
  canManage,
  onAddItem,
  onMoveItem,
  onRemoveItem,
}: OrderTabProps) => (
  <div>
    <div className="mb-3 flex items-center justify-between">
      <p className="text-sm text-slate-500">
        {plan.counts.items} item{plan.counts.items === 1 ? '' : 's'} ·{' '}
        {formatDuration(plan.total_length_seconds)} of programmed time
      </p>
      {canManage && (
        <Button variant="secondary" onClick={onAddItem}>
          Add item
        </Button>
      )}
    </div>

    <div className="card overflow-hidden">
      <div className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 border-b border-slate-200 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
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
        <ol className="divide-y divide-slate-100">
          {plan.items.map((item, index) => (
            <OrderRow
              key={item.id}
              item={item}
              index={index}
              canManage={canManage}
              isFirst={index === 0}
              isLast={index === plan.items.length - 1}
              onMove={onMoveItem}
              onRemove={() => onRemoveItem(item.id)}
            />
          ))}
        </ol>
      )}
    </div>
  </div>
);

interface OrderRowProps {
  item: PlanItemDetail;
  index: number;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: () => void;
}

const OrderRow = ({ item, index, canManage, isFirst, isLast, onMove, onRemove }: OrderRowProps) => {
  const controls = canManage && (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`Move ${item.title} up`}
        disabled={isFirst}
        onClick={() => onMove(index, -1)}
        className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Move ${item.title} down`}
        disabled={isLast}
        onClick={() => onMove(index, 1)}
        className="px-1 text-slate-300 hover:text-slate-600 disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        aria-label={`Remove ${item.title}`}
        onClick={onRemove}
        className="px-1 text-slate-300 hover:text-rose-500"
      >
        ×
      </button>
    </div>
  );

  if (item.item_type === 'header') {
    return (
      <li className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 bg-slate-50 px-4 py-2">
        <span />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {item.title}
        </h3>
        {controls}
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[4rem_1fr_auto] items-start gap-3 px-4 py-3">
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
          {item.item_type === 'song' && (
            <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">
              {item.key_override ?? item.arrangement?.song_key ?? item.song?.default_key ?? '—'}
            </Badge>
          )}
          {item.arrangement?.bpm && (
            <span className="text-xs text-slate-400">{item.arrangement.bpm} bpm</span>
          )}
        </div>
        {item.description && <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>}
      </div>
      {controls}
    </li>
  );
};
