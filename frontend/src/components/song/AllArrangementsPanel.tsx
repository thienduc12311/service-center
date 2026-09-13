import { formatDuration, type SongWithArrangements } from '@service-center/shared';
import { Badge, Button, EmptyState } from '../ui';

export interface AllArrangementsPanelProps {
  song: SongWithArrangements;
  canManage: boolean;
  onSelect: (arrangementId: string) => void;
  onAdd: () => void;
}

/** One line of the copyright block, shown only when the song carries it. */
const Detail = ({ label, value }: { label: string; value: string | null }) =>
  value ? (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700 dark:text-slate-300">{value}</dd>
    </div>
  ) : null;

/**
 * The song-level overview: what the library knows about the song, and every
 * arrangement of it side by side.
 */
export const AllArrangementsPanel = ({
  song,
  canManage,
  onSelect,
  onAdd,
}: AllArrangementsPanelProps) => (
  <div className="space-y-6">
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        Song Information
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Authors" value={song.author} />
        <Detail label="CCLI#" value={song.ccli_number} />
        <Detail label="Copyright" value={song.copyright} />
        <Detail label="Administration" value={song.administration} />
        <Detail label="Default key" value={song.default_key} />
        <Detail label="BPM" value={song.default_bpm === null ? null : String(song.default_bpm)} />
        <Detail label="Meter" value={song.meter} />
        <Detail label="Style" value={song.style} />
        <Detail label="Speed" value={song.speed} />
      </dl>
    </section>

    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Arrangements ({song.arrangements.length})
        </h2>
        {canManage && (
          <Button variant="secondary" className="!py-1 text-xs" onClick={onAdd}>
            Add an arrangement
          </Button>
        )}
      </div>

      {song.arrangements.length === 0 ? (
        <EmptyState
          title="No arrangements yet"
          description="An arrangement holds the key, tempo and chart a plan points at."
          action={
            canManage ? (
              <Button variant="secondary" onClick={onAdd}>
                Add an arrangement
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {song.arrangements.map((arrangement) => (
            <li key={arrangement.id}>
              <button
                type="button"
                onClick={() => onSelect(arrangement.id)}
                className="card w-full p-4 text-left transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white">
                    {arrangement.name}
                  </span>
                  {arrangement.is_default && (
                    <Badge tone="bg-brand-50 text-brand-700 ring-brand-600/20">Default</Badge>
                  )}
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  {[
                    arrangement.song_key ?? 'No key',
                    arrangement.capo === null ? null : `Capo ${arrangement.capo}`,
                    arrangement.bpm === null ? null : `${arrangement.bpm} bpm`,
                    arrangement.meter,
                    arrangement.length_seconds === null
                      ? null
                      : formatDuration(arrangement.length_seconds),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                <p className="mt-2 truncate text-xs text-slate-400">
                  {arrangement.sequence.length > 0
                    ? arrangement.sequence.join(', ')
                    : arrangement.chord_chart
                      ? 'Chart added'
                      : 'No chart yet'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
);
