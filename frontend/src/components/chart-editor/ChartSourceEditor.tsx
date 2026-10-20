import { Trans, useTranslation } from 'react-i18next';
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
}: ChartSourceEditorProps) => {
  const { t } = useTranslation(['songs', 'common']);
  return (
  <div className="flex h-full flex-col gap-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="chart-title">
          {t('songInfo.fields.title')}
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
          {t('arrangement.fields.name')}
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
          {t('chartEditor.currentKey')}
        </label>
        <KeySelect
          id="chart-key"
          value={values.songKey}
          disabled={disabled}
          onChange={(key) => onChange('songKey', key)}
          resetLabel={t('arrangement.noKey')}
        />
      </div>

      <div>
        <span className="label">{t('arrangement.fields.sequence')}</span>
        <button
          type="button"
          className="input flex w-full items-center justify-between text-left disabled:opacity-60"
          onClick={onEditSequence}
          disabled={disabled}
        >
          <span className={values.sequence.length ? '' : 'text-slate-400'}>
            {values.sequence.length ? values.sequence.join(', ') : t('chartEditor.addSequence')}
          </span>
          <span aria-hidden="true" className="ml-2 shrink-0 text-xs text-slate-400">
            {t('common:actions.edit')}
          </span>
        </button>
      </div>
    </div>

    <div className="flex min-h-0 flex-1 flex-col">
      <label className="label" htmlFor="chart-source">
        {t('chartEditor.lyricsAndChords')}
      </label>
      <textarea
        id="chart-source"
        className="input min-h-64 flex-1 resize-none whitespace-pre font-mono text-sm leading-6"
        spellCheck={false}
        value={values.source}
        disabled={disabled}
        placeholder={t('chartEditor.sourcePlaceholder')}
        onChange={(event) => onChange('source', event.target.value)}
      />
      <p className="mt-1.5 text-xs text-slate-500">
        <Trans
          t={t}
          i18nKey="chartEditor.sourceHelp"
          components={[<code key="example" className="rounded bg-slate-100 px-1 dark:bg-slate-800" />]}
        />
      </p>
    </div>
  </div>
  );
};
