import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  parseChordPro,
  renderChordProChart,
  renderLineAsText,
  styledLyricRuns,
  type ChartNotation,
  type ChordProLine,
} from '@service-center/shared';

export interface ChordChartProps {
  chordpro: string;
  /** The key the stored chart is written in. Needed to transpose or convert. */
  sourceKey?: string | null;
  /** Transpose into this key. Null renders the original. */
  targetKey?: string | null;
  notation?: ChartNotation;
}

export interface ChordChartLyricsProps {
  line: ChordProLine;
}

/** A line's words, with any `<b>`, `<i>` or `<u>` formatting applied. */
const ChordChartLyrics = ({ line }: ChordChartLyricsProps) => {
  if (!line.lyrics) return <> </>;
  if (!line.marks) return <>{line.lyrics}</>;
  return (
    <>
      {styledLyricRuns(line).map((run, index) => (
        <span
          key={index}
          className={[run.bold && 'font-bold', run.italic && 'italic', run.underline && 'underline'].filter(Boolean).join(' ')}
        >
          {run.text}
        </span>
      ))}
    </>
  );
};

/**
 * Renders ChordPro as chords-above-lyrics. Column alignment is what makes a
 * chart readable on stage, so each line is emitted as two monospace rows.
 *
 * Transposition and notation go through the same shared renderer the API uses,
 * so what is shown here matches what `GET /arrangements/:id/chart` returns.
 */
export const ChordChart = ({
  chordpro,
  sourceKey = null,
  targetKey = null,
  notation = 'chords',
}: ChordChartProps) => {
  const { t } = useTranslation('songs');
  const song = useMemo(
    () => parseChordPro(renderChordProChart(chordpro, { sourceKey, targetKey, notation }).chordpro),
    [chordpro, sourceKey, targetKey, notation],
  );

  if (song.sections.length === 0) {
    return <p className="text-sm text-slate-400">{t('chordChart.empty')}</p>;
  }

  return (
    <div className="space-y-5">
      {song.sections.map((section, sectionIndex) => (
        <section key={sectionIndex}>
          {(section.label || section.type !== 'none') && (
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-600">
              {section.label ?? section.type}
            </h4>
          )}
          <div className="chord-chart">
            {section.lines.map((line, lineIndex) => {
              if (line.kind === 'note') {
                return (
                  <div key={lineIndex} className="font-sans italic text-slate-500 dark:text-slate-400">
                    <ChordChartLyrics line={line} />
                  </div>
                );
              }
              const { chordRow } = renderLineAsText(line);
              return (
                <div key={lineIndex}>
                  {chordRow && <div className="font-semibold text-brand-700">{chordRow}</div>}
                  <div className="text-slate-800">
                    <ChordChartLyrics line={line} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
