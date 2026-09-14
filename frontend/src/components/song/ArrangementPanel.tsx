import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  chartFormattingFromRow,
  formatDuration,
  renderChordProChart,
  type ArrangementRow,
  type ChartDocument,
  type SongWithArrangements,
} from '@service-center/shared';
import { openChartInNewTab } from '../../lib/chart-export';
import { useChartPdfExport } from '../../hooks/chart-export';
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
 * can be read in any key or notation here, opened as a standalone page or a
 * PDF, or taken into the chart editor to be rewritten.
 */
export const ArrangementPanel = ({
  song,
  arrangement,
  canManage,
  onEdit,
  onDelete,
}: ArrangementPanelProps) => {
  const [view, setView] = useState<ChartView>(ORIGINAL_KEY_VIEW);
  const pdf = useChartPdfExport();

  const sourceKey = arrangement.song_key ?? song.default_key ?? null;
  // Ask the shared renderer what this view resolves to, so the readout and the
  // chart below it can never disagree.
  const rendered = renderChordProChart(arrangement.chord_chart ?? '', {
    sourceKey,
    targetKey: view.targetKey,
    notation: view.notation,
  });

  const chartEditorPath = `/songs/${song.id}/arrangements/${arrangement.id}/chart`;

  /** The chart's document, exactly as the chart editor's preview renders it. */
  const chartDocument = (): ChartDocument => ({
    title: song.title,
    key: rendered.key,
    arrangementName: arrangement.name,
    author: song.author,
    sequence: arrangement.sequence,
    copyright: song.copyright,
    chordpro: rendered.chordpro,
    formatting: chartFormattingFromRow(arrangement),
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {arrangement.chord_chart && (
            <>
              <Button variant="secondary" onClick={() => openChartInNewTab(chartDocument())}>
                View page
              </Button>
              <Button
                variant="secondary"
                onClick={() => pdf.download(chartDocument())}
                loading={pdf.isExporting}
              >
                Download PDF
              </Button>
            </>
          )}
          {canManage && (
            <Link to={chartEditorPath}>
              <Button variant="secondary">
                {arrangement.chord_chart ? 'Lyrics & Chords' : 'Add chart'}
              </Button>
            </Link>
          )}
        </div>
      </div>

      <ErrorNotice error={pdf.error} />

      <div className="card p-5">
        {arrangement.chord_chart ? (
          <ChordChart
            chordpro={arrangement.chord_chart}
            sourceKey={sourceKey}
            targetKey={view.targetKey}
            notation={view.notation}
          />
        ) : (
          <EmptyState
            title="No chord chart yet"
            description="Write one in the chart editor to transpose it, export it, and read it as numbers or numerals."
            action={
              canManage ? (
                <Link to={chartEditorPath}>
                  <Button variant="secondary">Add chart</Button>
                </Link>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
};
