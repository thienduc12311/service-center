import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
import { useLanguage } from '../../i18n';
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

/** One labelled readout in the arrangement header. */
interface StatProps {
  label: string;
  value: string;
}

const Stat = ({ label, value }: StatProps) => {
  const { t } = useTranslation('songs');
  return (
    <span className="text-slate-500">
      <Trans
        t={t}
        i18nKey="arrangementPanel.stat"
        values={{ label, value }}
        components={[<span key="value" className="font-medium text-slate-800 dark:text-slate-200" />]}
      />
    </span>
  );
};

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
  const { t } = useTranslation(['songs', 'common']);
  const { locale } = useLanguage();
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
    locale,
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
              <Badge tone="bg-brand-50 text-brand-700 ring-brand-600/20">{t('arrangement.defaultBadge')}</Badge>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {arrangement.length_seconds !== null && (
              <Stat label={t('arrangement.fields.length')} value={formatDuration(arrangement.length_seconds)} />
            )}
            {arrangement.bpm !== null && <Stat label={t('arrangement.fields.bpm')} value={String(arrangement.bpm)} />}
            {arrangement.meter && <Stat label={t('arrangement.fields.meter')} value={arrangement.meter} />}
            <Stat label={t('arrangement.fields.key')} value={sourceKey ?? '—'} />
            {arrangement.capo !== null && <Stat label={t('arrangement.fields.capo')} value={String(arrangement.capo)} />}
          </div>

          {arrangement.sequence.length > 0 && (
            <p className="mt-1.5 text-sm text-slate-500">
              <Trans
                t={t}
                i18nKey="arrangementPanel.sequence"
                values={{ sequence: arrangement.sequence.join(', ') }}
                components={[<span key="sequence" className="text-slate-700 dark:text-slate-300" />]}
              />
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button type="button" className={ICON_BUTTON} onClick={onEdit} aria-label={t('arrangementPanel.edit')}>
              ✎
            </button>
            <button
              type="button"
              className={`${ICON_BUTTON} hover:text-rose-600`}
              onClick={onDelete}
              aria-label={t('arrangementPanel.delete')}
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
            {t('arrangementPanel.transposed', {
              count: rendered.semitones > 6 ? rendered.semitones - 12 : rendered.semitones,
            })}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {arrangement.chord_chart && (
            <>
              <Button variant="secondary" onClick={() => openChartInNewTab(chartDocument())}>
                {t('arrangementPanel.viewPage')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => pdf.download(chartDocument())}
                loading={pdf.isExporting}
              >
                {t('chartEditor.downloadPdf')}
              </Button>
            </>
          )}
          {canManage && (
            <Link to={chartEditorPath}>
              <Button variant="secondary">
                {arrangement.chord_chart ? t('addSong.fields.chart') : t('arrangementPanel.addChart')}
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
            title={t('arrangementPanel.emptyTitle')}
            description={t('arrangementPanel.emptyDescription')}
            action={
              canManage ? (
                <Link to={chartEditorPath}>
                  <Button variant="secondary">{t('arrangementPanel.addChart')}</Button>
                </Link>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
};
