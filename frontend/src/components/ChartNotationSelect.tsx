import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ORIGINAL_CHART_VIEW, type ChartNotation, type ChartViewSelection, type KeyQuality, type TranslationKey } from '@service-center/shared';
import { KeyGrid, KeyQualityTabs } from './KeySelect';

/** How the chart is currently being shown: a key, or a key-independent system. */
export type ChartView = ChartViewSelection;

export interface ChartNotationSelectProps {
  value: ChartView;
  onChange: (view: ChartView) => void;
}

export const ORIGINAL_KEY_VIEW: ChartView = ORIGINAL_CHART_VIEW;

/**
 * Catalog keys for the notation names, by value. Replaces the English
 * CHART_NOTATION_LABELS from the shared package for display.
 */
export const CHART_NOTATION_LABEL_KEYS: Readonly<Record<ChartNotation, TranslationKey<'songs'>>> = {
  chords: 'notation.chords',
  numbers: 'notation.numbers',
  numerals: 'notation.numerals',
  lyrics: 'notation.lyrics',
};

const viewLabel = ({ targetKey, notation }: ChartView, t: TFunction<'songs'>): string =>
  notation === 'chords' ? (targetKey ?? t('notation.originalKey')) : t(CHART_NOTATION_LABEL_KEYS[notation]);

/**
 * The one control that drives the chart: pick a key to transpose into, or a
 * key-independent notation to read it in.
 */
export const ChartNotationSelect = ({ value, onChange }: ChartNotationSelectProps) => {
  const { t } = useTranslation('songs');
  const [open, setOpen] = useState(false);
  // A chart transposed into a minor key opens on the minor grid, so the key it
  // is currently in is the one highlighted.
  const [quality, setQuality] = useState<KeyQuality>(
    value.targetKey?.endsWith('m') ? 'minor' : 'major',
  );

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
        aria-label={t('notation.selectLabel')}
        className="input flex min-w-44 items-center justify-between text-left"
      >
        <span>{viewLabel(value, t)}</span>
        <span aria-hidden="true" className="text-xs text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t('notation.close')}
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
                {t('notation.originalKey')}
              </button>
            </div>

            <KeyQualityTabs value={quality} onChange={setQuality} />

            <KeyGrid
              quality={quality}
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
                  {t(CHART_NOTATION_LABEL_KEYS[notation])}
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
              {t(CHART_NOTATION_LABEL_KEYS.lyrics)}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
