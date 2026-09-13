import { useState } from 'react';
import { CHART_NOTATION_LABELS, type ChartNotation } from '@service-center/shared';
import { KeyGrid } from './KeySelect';

/** How the chart is currently being shown: a key, or a key-independent system. */
export interface ChartView {
  /** Null means the arrangement's own key. */
  targetKey: string | null;
  notation: ChartNotation;
}

export interface ChartNotationSelectProps {
  value: ChartView;
  onChange: (view: ChartView) => void;
}

export const ORIGINAL_KEY_VIEW: ChartView = { targetKey: null, notation: 'chords' };

const viewLabel = ({ targetKey, notation }: ChartView): string =>
  notation === 'chords' ? (targetKey ?? 'Original Key') : CHART_NOTATION_LABELS[notation];

/**
 * The one control that drives the chart: pick a key to transpose into, or a
 * key-independent notation to read it in.
 */
export const ChartNotationSelect = ({ value, onChange }: ChartNotationSelectProps) => {
  const [open, setOpen] = useState(false);

  const choose = (view: ChartView) => {
    onChange(view);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Chart key and notation"
        className="input flex w-44 items-center justify-between text-left"
      >
        <span>{viewLabel(value)}</span>
        <span aria-hidden="true" className="text-xs text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close chart options"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="card absolute z-50 mt-1 w-56 overflow-hidden p-0">
            <div className="p-2">
              <button
                type="button"
                onClick={() => choose(ORIGINAL_KEY_VIEW)}
                aria-pressed={value.notation === 'chords' && value.targetKey === null}
                className={`w-full rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  value.notation === 'chords' && value.targetKey === null
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'
                }`}
              >
                Original Key
              </button>
            </div>

            <KeyGrid
              quality="major"
              value={value.notation === 'chords' ? value.targetKey : null}
              onSelect={(key) => choose({ targetKey: key, notation: 'chords' })}
            />

            <div className="grid grid-cols-2">
              {(['numbers', 'numerals'] as const).map((notation) => (
                <button
                  key={notation}
                  type="button"
                  onClick={() => choose({ targetKey: null, notation })}
                  aria-pressed={value.notation === notation}
                  className={`border-b border-r border-slate-200 px-2 py-2 text-sm transition ${
                    value.notation === notation ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-slate-100'
                  }`}
                >
                  {CHART_NOTATION_LABELS[notation]}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => choose({ targetKey: null, notation: 'lyrics' })}
              aria-pressed={value.notation === 'lyrics'}
              className={`block w-full px-2 py-2 text-sm transition ${
                value.notation === 'lyrics' ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-slate-100'
              }`}
            >
              {CHART_NOTATION_LABELS.lyrics}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
