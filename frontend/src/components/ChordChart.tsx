import { useMemo } from 'react';
import {
  parseChordPro,
  renderChordProChart,
  renderLineAsText,
  type ChartNotation,
} from '@service-center/shared';

export interface ChordChartProps {
  chordpro: string;
  /** The key the stored chart is written in. Needed to transpose or convert. */
  sourceKey?: string | null;
  /** Transpose into this key. Null renders the original. */
  targetKey?: string | null;
  notation?: ChartNotation;
}

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
  const song = useMemo(
    () => parseChordPro(renderChordProChart(chordpro, { sourceKey, targetKey, notation }).chordpro),
    [chordpro, sourceKey, targetKey, notation],
  );

  if (song.sections.length === 0) {
    return <p className="text-sm text-slate-400">No chord chart yet.</p>;
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
              const { chordRow, lyricRow } = renderLineAsText(line);
              return (
                <div key={lineIndex}>
                  {chordRow && <div className="font-semibold text-brand-700">{chordRow}</div>}
                  <div className="text-slate-800">{lyricRow || ' '}</div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
