import { Link } from 'react-router-dom';
import {
  formatDuration,
  renderChartContext,
  resolvePlanItemChartContext,
  type PlanDetail,
  type PlanItemDetail,
} from '@service-center/shared';
import { ChordChart } from '../ChordChart';

export interface RehearseTabProps {
  plan: PlanDetail;
}

/**
 * The songs of the plan, in order, with their charts — what a band reads.
 * Each chart goes through the same resolver as the song book and the mobile
 * app: the item's arrangement (or the default it inherits), its service key
 * and its own sequence. The chart is rendered in that key once, so the key
 * shown above it is the key of the chords below it.
 */
export const RehearseTab = ({ plan }: RehearseTabProps) => {
  const songs = plan.items.filter((item) => item.item_type === 'song');

  if (songs.length === 0) {
    return (
      <div className="card px-6 py-16 text-center text-sm text-slate-500">
        No songs for this plan yet. Add an item from the Order tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {songs.map((item) => <RehearseSong key={item.id} item={item} />)}
    </div>
  );
};

const RehearseSong = ({ item }: { item: PlanItemDetail }) => {
  const context = resolvePlanItemChartContext(item);
  const ready = context.status === 'ready' ? context : null;
  const rendered = ready ? renderChartContext(ready) : null;
  // When the chart cannot be moved to the service key, label it with the key
  // it is written in only if the chords are shown as written.
  const keyLabel = rendered?.status === 'ready' ? (rendered.key ?? ready?.displayKey) : ready?.displayKey;

  return (
    <article className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        {item.song ? (
          <Link to={`/songs/${item.song.id}`} className="font-medium hover:underline">
            {item.title}
          </Link>
        ) : (
          <span className="font-medium">{item.title}</span>
        )}
        <span className="text-sm text-slate-500">
          <span className="sr-only">Service key </span>{keyLabel ?? '—'}
        </span>
        {ready?.arrangement && <span className="text-sm text-slate-500">{ready.arrangement.name}</span>}
        {ready?.arrangement?.bpm && (
          <span className="text-sm text-slate-400">{ready.arrangement.bpm} bpm</span>
        )}
        <span className="ml-auto text-sm tabular-nums text-slate-400">
          {formatDuration(item.length_seconds)}
        </span>
      </header>
      {ready && ready.sequence.length > 0 && (
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
          Sequence{ready.sequenceFromPlan ? ' for this plan' : ''}: {ready.sequence.join(' · ')}
        </p>
      )}
      <div className="px-4 py-4">
        {context.status === 'unavailable' ? (
          <p role="status" className="text-sm text-rose-700">
            The arrangement chosen for this item is no longer available. Edit the item to choose another.
          </p>
        ) : rendered?.status === 'unavailable' ? (
          <p role="status" className="text-sm text-slate-500">
            {rendered.reason === 'no_chart'
              ? 'No chord chart on this arrangement yet.'
              : `This chart's written key is missing or unreadable, so it can't be shown in ${ready?.displayKey ?? 'the service key'}. Set the arrangement's key in the song library.`}
          </p>
        ) : rendered ? (
          // Already in the service key: render as given, no second transpose.
          <ChordChart chordpro={rendered.chordpro} />
        ) : null}
      </div>
    </article>
  );
};
