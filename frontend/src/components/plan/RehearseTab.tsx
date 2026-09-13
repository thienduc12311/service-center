import { Link } from 'react-router-dom';
import { formatDuration, type PlanDetail } from '@service-center/shared';
import { ChordChart } from '../ChordChart';

export interface RehearseTabProps {
  plan: PlanDetail;
}

/** The songs of the plan, in order, with their charts — what a band reads. */
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
      {songs.map((item) => (
        <article key={item.id} className="card overflow-hidden">
          <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            {item.song ? (
              <Link to={`/songs/${item.song.id}`} className="font-medium hover:underline">
                {item.title}
              </Link>
            ) : (
              <span className="font-medium">{item.title}</span>
            )}
            <span className="text-sm text-slate-500">
              {item.key_override ?? item.arrangement?.song_key ?? item.song?.default_key ?? '—'}
            </span>
            {item.arrangement?.bpm && (
              <span className="text-sm text-slate-400">{item.arrangement.bpm} bpm</span>
            )}
            <span className="ml-auto text-sm tabular-nums text-slate-400">
              {formatDuration(item.length_seconds)}
            </span>
          </header>
          <div className="px-4 py-4">
            {item.arrangement?.chord_chart ? (
              <ChordChart chordpro={item.arrangement.chord_chart} />
            ) : (
              <p className="text-sm text-slate-400">
                No chord chart on this arrangement yet.
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
};
