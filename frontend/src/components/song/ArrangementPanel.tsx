import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  formatDuration,
  renderChordProChart,
  toChordPro,
  type ArrangementRow,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice } from '../ui';
import { ChordChart } from '../ChordChart';
import { ChartNotationSelect, ORIGINAL_KEY_VIEW, type ChartView } from '../ChartNotationSelect';

export interface ArrangementPanelProps {
  song: SongWithArrangements;
  arrangement: ArrangementRow;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <span className="text-slate-500">
    {label}: <span className="font-medium text-slate-800 dark:text-slate-200">{value}</span>
  </span>
);

const ICON_BUTTON =
  'grid size-8 place-items-center rounded-lg text-slate-500 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-40';

/**
 * One arrangement: its tempo and section order, and the chart itself, which
 * can be read in any key or notation and edited in place.
 */
export const ArrangementPanel = ({
  song,
  arrangement,
  canManage,
  onEdit,
  onDelete,
}: ArrangementPanelProps) => {
  const invalidate = useInvalidateOrg();
  const [view, setView] = useState<ChartView>(ORIGINAL_KEY_VIEW);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const saveChart = useMutation({
    mutationFn: () => api.updateArrangement(arrangement.id, { chord_chart: toChordPro(draft) }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });

  const startEditing = () => {
    setDraft(arrangement.chord_chart ?? '');
    saveChart.reset();
    setEditing(true);
  };

  const sourceKey = arrangement.song_key ?? song.default_key ?? null;
  // Ask the shared renderer what this view resolves to, so the readout and the
  // chart below it can never disagree.
  const rendered = renderChordProChart(arrangement.chord_chart ?? '', {
    sourceKey,
    targetKey: view.targetKey,
    notation: view.notation,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {arrangement.name}
            </h2>
            {arrangement.is_default && (
              <Badge tone="bg-brand-50 text-brand-700 ring-brand-600/20">Default</Badge>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {arrangement.length_seconds !== null && (
              <Stat label="Length" value={formatDuration(arrangement.length_seconds)} />
            )}
            {arrangement.bpm !== null && <Stat label="BPM" value={String(arrangement.bpm)} />}
            {arrangement.meter && <Stat label="Meter" value={arrangement.meter} />}
            <Stat label="Key" value={sourceKey ?? '—'} />
            {arrangement.capo !== null && <Stat label="Capo" value={String(arrangement.capo)} />}
          </div>

          {arrangement.sequence.length > 0 && (
            <p className="mt-1.5 text-sm text-slate-500">
              Sequence:{' '}
              <span className="text-slate-700 dark:text-slate-300">
                {arrangement.sequence.join(', ')}
              </span>
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button type="button" className={ICON_BUTTON} onClick={onEdit} aria-label="Edit this arrangement">
              ✎
            </button>
            <button
              type="button"
              className={`${ICON_BUTTON} hover:text-rose-600`}
              onClick={onDelete}
              aria-label="Delete this arrangement"
            >
              🗑
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ChartNotationSelect value={view} onChange={setView} />

        {rendered.semitones !== 0 && (
          <span className="text-xs text-slate-400">
            transposed {rendered.semitones > 6 ? rendered.semitones - 12 : rendered.semitones}{' '}
            semitones
          </span>
        )}

        {canManage && !editing && (
          <Button variant="secondary" className="ml-auto" onClick={startEditing}>
            {arrangement.chord_chart ? 'Edit chart' : 'Add chart'}
          </Button>
        )}
      </div>

      <div className="card p-5">
        {editing ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Paste chords above lyrics, or write ChordPro with the chords in square brackets —{' '}
              <code className="rounded bg-slate-100 px-1">A[G]mazing grace</code>. Either is saved
              as ChordPro.
            </p>
            <textarea
              className="input font-mono"
              rows={20}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Chord chart source"
            />
            <ErrorNotice error={saveChart.error} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button loading={saveChart.isPending} onClick={() => saveChart.mutate()}>
                Save chart
              </Button>
            </div>
          </div>
        ) : arrangement.chord_chart ? (
          <ChordChart
            chordpro={arrangement.chord_chart}
            sourceKey={sourceKey}
            targetKey={view.targetKey}
            notation={view.notation}
          />
        ) : (
          <EmptyState
            title="No chord chart yet"
            description="Paste one in ChordPro format to transpose it and read it as numbers or numerals."
            action={
              canManage ? (
                <Button variant="secondary" onClick={startEditing}>
                  Add chart
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
};
