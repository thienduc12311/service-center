import { KeySelect } from '../KeySelect';
import type { ChartEditorFormValues } from './types';

export interface ChartSourceEditorProps {
  values: ChartEditorFormValues;
  /** Read-only for anyone without permission to edit the song library. */
  disabled: boolean;
  onChange: <K extends keyof ChartEditorFormValues>(
    field: K,
    value: ChartEditorFormValues[K],
  ) => void;
  onEditSequence: () => void;
}

/**
 * The editing half of the split screen: what the chart says, and the three
 * things printed above it — the song's title, the arrangement's name and the
 * key it is written in.
 */
export const ChartSourceEditor = ({
  values,
  disabled,
  onChange,
  onEditSequence,
}: ChartSourceEditorProps) => (
  <div className="flex h-full flex-col gap-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="chart-title">
          Song Title
        </label>
        <input
          id="chart-title"
          className="input"
          value={values.title}
          disabled={disabled}
          onChange={(event) => onChange('title', event.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="chart-arrangement-name">
          Arrangement Name
        </label>
        <input
          id="chart-arrangement-name"
          className="input"
          value={values.arrangementName}
          disabled={disabled}
          onChange={(event) => onChange('arrangementName', event.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="chart-key">
          Current Key
        </label>
        <KeySelect
          id="chart-key"
          value={values.songKey}
          disabled={disabled}
          onChange={(key) => onChange('songKey', key)}
          resetLabel="No key"
        />
      </div>

      <div>
        <span className="label">Sequence</span>
        <button
          type="button"
          className="input flex w-full items-center justify-between text-left disabled:opacity-60"
          onClick={onEditSequence}
          disabled={disabled}
        >
          <span className={values.sequence.length ? '' : 'text-slate-400'}>
            {values.sequence.length ? values.sequence.join(', ') : 'Add a sequence'}
          </span>
          <span aria-hidden="true" className="ml-2 shrink-0 text-xs text-slate-400">
            Edit
          </span>
        </button>
      </div>
    </div>

    <div className="flex min-h-0 flex-1 flex-col">
      <label className="label" htmlFor="chart-source">
        Lyrics and Chords
      </label>
      <textarea
        id="chart-source"
        className="input min-h-64 flex-1 resize-none whitespace-pre font-mono text-sm leading-6"
        spellCheck={false}
        value={values.source}
        disabled={disabled}
        placeholder={'C                 G\n Amazing grace how sweet the sound'}
        onChange={(event) => onChange('source', event.target.value)}
      />
      <p className="mt-1.5 text-xs text-slate-500">
        Put the chords on their own line above the words, or write ChordPro inline —{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">A[G]mazing grace</code>.
        Either way it is saved as ChordPro.
      </p>
    </div>
  </div>
);
